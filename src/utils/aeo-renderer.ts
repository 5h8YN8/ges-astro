/**
 * aeo-renderer.ts
 *
 * Utility functions for rendering AEO page content into clean semantic HTML.
 * Used by AEOPage.astro to convert structured content fields into markup
 * that is optimized for AI engine crawlers.
 *
 * Rules enforced throughout:
 *  - No em dashes (replaced with commas or hyphens as appropriate)
 *  - No JavaScript-dependent content
 *  - No inline styles (Tailwind classes only, applied at the component layer)
 */

export interface InternalLink {
  anchor_text: string;
  target_url: string;
  target_title: string;
}

export type ContentType =
  | "narrative"
  | "steps"
  | "comparison_table"
  | "definition"
  | "data_point";

// ---------------------------------------------------------------------------
// sanitizeForCrawlers
// ---------------------------------------------------------------------------

/**
 * Strips patterns that confuse AI crawlers or introduce unwanted characters.
 * - Replaces em dashes (U+2014) and double hyphens used as em dashes with
 *   a comma-space so prose flows naturally without losing meaning.
 * - Collapses multiple blank lines.
 * - Trims leading/trailing whitespace.
 */
export function sanitizeForCrawlers(html: string): string {
  return html
    // Em dash (U+2014) -> comma space
    .replace(/\u2014/g, ", ")
    // Double hyphen used as em dash (spaced or not)
    .replace(/\s*--\s*/g, ", ")
    // Horizontal ellipsis (U+2026) -> three periods
    .replace(/\u2026/g, "...")
    // Smart left double quote
    .replace(/\u201C/g, '"')
    // Smart right double quote
    .replace(/\u201D/g, '"')
    // Smart left single quote / apostrophe
    .replace(/\u2018/g, "'")
    // Smart right single quote / apostrophe
    .replace(/\u2019/g, "'")
    // Collapse 3+ blank lines to 2
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------------------
// injectInternalLinks
// ---------------------------------------------------------------------------

/**
 * Scans raw HTML content for occurrences of each link's anchor_text and
 * wraps the first match per link with an <a> tag pointing to target_url.
 *
 * Rules:
 *  - Case-insensitive match but preserves original casing in the output.
 *  - Only replaces the FIRST occurrence of each anchor text to avoid
 *    over-linking.
 *  - Will not inject a link inside an existing <a> tag.
 *  - Skips anchor texts shorter than 3 characters.
 */
export function injectInternalLinks(
  html: string,
  links: InternalLink[]
): string {
  let result = html;

  for (const link of links) {
    const { anchor_text, target_url, target_title } = link;

    if (!anchor_text || anchor_text.length < 3) continue;
    if (!target_url) continue;

    // Build a regex that matches the anchor text outside of HTML tags.
    // We use a simple approach: match the text, then verify it is not
    // already inside an <a ... > by checking if the nearest preceding
    // tag is not an unclosed <a>.
    const escaped = anchor_text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(${escaped})`, "i");

    // Guard: check if the match sits inside an existing link by scanning
    // the string around the match position.
    const match = result.match(pattern);
    if (!match || match.index === undefined) continue;

    const before = result.slice(0, match.index);
    // Count unclosed <a tags before this position
    const openAs = (before.match(/<a[\s>]/gi) || []).length;
    const closeAs = (before.match(/<\/a>/gi) || []).length;
    if (openAs > closeAs) {
      // We are inside an existing anchor, skip.
      continue;
    }

    const titleAttr = target_title
      ? ` title="${target_title.replace(/"/g, "&quot;")}"`
      : "";

    result = result.replace(
      pattern,
      `<a href="${target_url}"${titleAttr} class="text-purple-400 underline hover:text-purple-300 transition-colors">$1</a>`
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// renderSectionContent
// ---------------------------------------------------------------------------

/**
 * Converts raw section content text into semantic HTML based on content_type.
 *
 * "narrative"        -> Splits on double newlines into <p> tags.
 * "steps"            -> Parses numbered lines (1. / 1) / Step 1:) into <ol><li>.
 * "comparison_table" -> Parses pipe-delimited or labeled rows into <table>.
 * "definition"       -> Parses "Term: definition" pairs into <dl><dt><dd>.
 * "data_point"       -> Wraps in <figure> with first line as data, rest as figcaption.
 */
export function renderSectionContent(
  content: string,
  contentType: ContentType | string
): string {
  const clean = sanitizeForCrawlers(content);

  switch (contentType) {
    case "narrative":
      return renderNarrative(clean);
    case "steps":
      return renderSteps(clean);
    case "comparison_table":
      return renderComparisonTable(clean);
    case "definition":
      return renderDefinition(clean);
    case "data_point":
      return renderDataPoint(clean);
    default:
      // Unknown type: fall back to narrative
      return renderNarrative(clean);
  }
}

// ---------------------------------------------------------------------------
// Internal render helpers
// ---------------------------------------------------------------------------

function renderNarrative(content: string): string {
  const paragraphs = content
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const html = paragraphs
    .map((p) => {
      // If the paragraph itself contains newlines, they become <br> within
      // the paragraph rather than being treated as list items.
      const inner = p.replace(/\n/g, "<br />");
      return `<p>${inner}</p>`;
    })
    .join("\n");

  return `<div class="section-narrative prose-dark space-y-4">\n${html}\n</div>`;
}

function renderSteps(content: string): string {
  const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);

  // Detect numbered step patterns: "1.", "1)", "Step 1:", "Step 1."
  const stepPattern = /^(?:step\s*)?\d+[.):\s]+/i;

  const stepLines = lines.filter((l) => stepPattern.test(l));

  if (stepLines.length === 0) {
    // No explicit numbers: treat each non-empty line as a step
    const items = lines
      .map((l) => `  <li class="text-white/75">${l}</li>`)
      .join("\n");
    return `<ol class="section-steps list-decimal list-outside pl-6 space-y-3 text-white/75">\n${items}\n</ol>`;
  }

  // Build grouped items: collect any un-numbered continuation lines under
  // the previous step.
  const groups: string[][] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (stepPattern.test(line)) {
      if (current.length) groups.push(current);
      // Strip the numbering prefix so the <ol> counter is the only number.
      current = [line.replace(stepPattern, "").trim()];
    } else {
      current.push(line);
    }
  }
  if (current.length) groups.push(current);

  const items = groups
    .map((g) => {
      const [head, ...rest] = g;
      const extra = rest.length
        ? `<p class="mt-1 text-white/55 text-sm">${rest.join(" ")}</p>`
        : "";
      return `  <li class="text-white/75">${head}${extra}</li>`;
    })
    .join("\n");

  return `<ol class="section-steps list-decimal list-outside pl-6 space-y-3 text-white/75">\n${items}\n</ol>`;
}

function renderComparisonTable(content: string): string {
  const lines = content
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  // Strategy 1: pipe-delimited table  | col1 | col2 | col3 |
  const pipeLines = lines.filter((l) => l.includes("|"));
  if (pipeLines.length >= 2) {
    return renderPipeTable(pipeLines);
  }

  // Strategy 2: "Label: value" colon-delimited pairs rendered as two columns
  const colonLines = lines.filter((l) => /^[^:]+:[^:]+$/.test(l));
  if (colonLines.length >= 2) {
    return renderColonTable(colonLines);
  }

  // Strategy 3: Alternating label/value lines (every odd = label, even = value)
  if (lines.length >= 4 && lines.length % 2 === 0) {
    return renderAlternatingTable(lines);
  }

  // Fallback: render as a simple narrative
  return renderNarrative(content);
}

function renderPipeTable(lines: string[]): string {
  // Split on | and trim cells
  const rows = lines.map((l) =>
    l
      .split("|")
      .map((c) => c.trim())
      .filter(Boolean)
  );

  if (rows.length === 0) return renderNarrative(lines.join("\n"));

  // First row is header, skip separator rows (all dashes/spaces)
  const isSeparator = (row: string[]) =>
    row.every((c) => /^[-: ]+$/.test(c));

  const nonSep = rows.filter((r) => !isSeparator(r));
  const [header, ...body] = nonSep;

  const thead = `<thead><tr class="border-b border-white/10">${header
    .map(
      (h) =>
        `<th class="text-left py-2 px-3 text-white/50 font-semibold text-sm">${h}</th>`
    )
    .join("")}</tr></thead>`;

  const tbody = `<tbody>${body
    .map(
      (row, i) =>
        `<tr class="${i < body.length - 1 ? "border-b border-white/5" : ""}">${row
          .map(
            (c, ci) =>
              `<td class="py-2.5 px-3 text-sm ${ci === 0 ? "font-medium text-white/80" : "text-white/65"}">${c}</td>`
          )
          .join("")}</tr>`
    )
    .join("")}</tbody>`;

  return `<div class="overflow-x-auto my-2">
  <table class="section-comparison w-full text-sm border-collapse">
    ${thead}
    ${tbody}
  </table>
</div>`;
}

function renderColonTable(lines: string[]): string {
  const pairs = lines.map((l) => {
    const colon = l.indexOf(":");
    return [l.slice(0, colon).trim(), l.slice(colon + 1).trim()];
  });

  const rows = pairs
    .map(
      ([label, value]) =>
        `<tr class="border-b border-white/5">
      <td class="py-2.5 pr-4 font-medium text-white/80 text-sm w-1/3">${label}</td>
      <td class="py-2.5 text-white/65 text-sm">${value}</td>
    </tr>`
    )
    .join("\n");

  return `<div class="overflow-x-auto my-2">
  <table class="section-comparison w-full text-sm border-collapse">
    <tbody>${rows}</tbody>
  </table>
</div>`;
}

function renderAlternatingTable(lines: string[]): string {
  const pairs: [string, string][] = [];
  for (let i = 0; i < lines.length - 1; i += 2) {
    pairs.push([lines[i], lines[i + 1]]);
  }
  return renderColonTable(pairs.map(([a, b]) => `${a}: ${b}`));
}

function renderDefinition(content: string): string {
  const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);

  // Match "Term: definition" or "Term - definition" patterns
  const pairs: Array<{ term: string; def: string }> = [];
  let pendingTerm = "";

  for (const line of lines) {
    const colonMatch = line.match(/^([^:]+):\s+(.+)$/);
    const dashMatch = line.match(/^([^-]+)\s+-\s+(.+)$/);

    if (colonMatch) {
      pairs.push({ term: colonMatch[1].trim(), def: colonMatch[2].trim() });
    } else if (dashMatch) {
      pairs.push({ term: dashMatch[1].trim(), def: dashMatch[2].trim() });
    } else if (!pendingTerm) {
      // Treat as a term, next line may be the definition
      pendingTerm = line;
    } else {
      // This line is the definition for the pending term
      pairs.push({ term: pendingTerm, def: line });
      pendingTerm = "";
    }
  }

  // Handle any remaining pending term without a definition
  if (pendingTerm) {
    pairs.push({ term: pendingTerm, def: "" });
  }

  if (pairs.length === 0) return renderNarrative(content);

  const items = pairs
    .map(
      ({ term, def }) =>
        `  <div class="py-3 border-b border-white/5 last:border-0">
    <dt class="font-semibold text-white/90 text-sm mb-1">${term}</dt>
    ${def ? `<dd class="text-white/65 text-sm ml-0">${def}</dd>` : ""}
  </div>`
    )
    .join("\n");

  return `<dl class="section-definition divide-y divide-white/5">\n${items}\n</dl>`;
}

function renderDataPoint(content: string): string {
  const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);

  if (lines.length === 0) return "";

  const [dataLine, ...captionLines] = lines;
  const caption = captionLines.join(" ").trim();

  return `<figure class="section-data my-4 p-5 rounded-xl bg-purple-600/10 border border-purple-500/20 text-center">
  <p class="text-3xl font-bold text-white leading-tight mb-2">${dataLine}</p>
  ${caption ? `<figcaption class="text-sm text-white/55">${caption}</figcaption>` : ""}
</figure>`;
}
