/**
 * page-contract.ts
 *
 * The typed contract between the generator (n8n 7.6) and the renderer.
 *
 * Everything the generator produces is a data record. The renderer owns all
 * markup and all structured data, and both read this one object, so rendered
 * content and JSON-LD cannot fall out of sync. This is the record-to-layout
 * inversion documented in docs/templates/product-detail.md, generalised to
 * every page type.
 *
 * `validatePageRecord` is the last gate in the pipeline. It runs at build time,
 * so a record that violates the contract fails the build rather than publishing
 * a broken page. Keep every check here cheap and deterministic: the semantic
 * gates (similarity, does-the-answer-answer-the-question) run upstream.
 */

// ---------------------------------------------------------------------------
// Page roles
// ---------------------------------------------------------------------------

/**
 * The roles a page may take.
 *
 * `faq` is first class here deliberately. Upstream, 7.4 / 7.5 / 7.6 all collapse
 * faq onto `guide`, which is why 34 strategy rows typed as faq produced pages
 * with no FAQPage schema. The renderer refuses to lose the distinction.
 */
export const PAGE_ROLES = [
  "homepage",
  "pillar",
  "guide",
  "faq",
  "seo_content",
  "problem",
  "use_case",
  "industry",
  "feature_detail",
  "product_detail",
  "comparison",
  "alternative",
  "pricing",
] as const;

export type PageRole = (typeof PAGE_ROLES)[number];

/** Roles whose pages carry an Article node. */
const ARTICLE_ROLES: PageRole[] = [
  "pillar",
  "guide",
  "faq",
  "seo_content",
  "problem",
  "use_case",
  "industry",
  "comparison",
  "alternative",
];

export function isArticleRole(role: PageRole): boolean {
  return ARTICLE_ROLES.includes(role);
}

/** Roles that must emit a FAQPage node when the record carries FAQs. */
export function requiresFaqPage(role: PageRole): boolean {
  return role === "faq";
}

// ---------------------------------------------------------------------------
// Record parts
// ---------------------------------------------------------------------------

export type SectionContentType =
  | "narrative"
  | "steps"
  | "comparison_table"
  | "definition"
  | "data_point";

export interface Section {
  heading: string;
  heading_level: 2 | 3;
  content: string;
  content_type: SectionContentType;
  subsections?: Section[];
}

export interface Faq {
  question: string;
  answer: string;
}

/**
 * Pros and cons are independent lists, not paired rows.
 *
 * The previous shape was `{ pro, con }[]`, which silently forced the two
 * columns to be the same length and implied a pairing that does not exist.
 * The generator emits `{ pros: [], cons: [] }`; this matches it.
 */
export interface Tradeoffs {
  pros: string[];
  cons: string[];
}

export interface InternalLink {
  anchor_text: string;
  /** Site-relative path or absolute URL. Must come from the upstream allowlist. */
  target_url: string;
  target_title: string;
  relationship: LinkRelationship;
}

export const LINK_RELATIONSHIPS = [
  "parent",
  "child",
  "related",
  "comparison",
  "next-step",
  "supporting",
] as const;

export type LinkRelationship = (typeof LINK_RELATIONSHIPS)[number];

export const SOURCE_TYPES = [
  "documentation",
  "study",
  "industry-report",
  "standard",
  "guideline",
  "internal",
] as const;

export type SourceType = (typeof SOURCE_TYPES)[number];

export interface Source {
  label: string;
  url?: string;
  type: SourceType;
}

export interface EntityReference {
  name: string;
  type: string;
  context?: string;
}

export interface Cta {
  text: string;
  subtext?: string;
  href: string;
  label: string;
}

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

export interface PageRecord {
  // -- identity -------------------------------------------------------------
  slug: string;
  role: PageRole;

  /**
   * The question exactly as it appears in the content strategy. Immutable.
   *
   * The generator may not rewrite this. `title` is written for the SERP;
   * this is what a person actually asks an answer engine, and it is what the
   * FAQPage node and the answer gate are both bound to.
   */
  canonicalQuestion: string;

  /** Headline shown as the H1. A restatement of canonicalQuestion, not a new question. */
  title: string;

  /**
   * The direct answer to `canonicalQuestion`, in one short paragraph.
   *
   * This is the first prose on the page and the FAQPage acceptedAnswer. It is
   * required: a page that cannot answer its own question up front should not
   * publish. Upstream, an LLM judge approves this text against the canonical
   * question before it ever reaches here.
   */
  answer: string;

  meta_description: string;

  // -- body -----------------------------------------------------------------
  sections: Section[];
  faqs?: Faq[];
  tradeoffs?: Tradeoffs;
  proof_points?: string[];
  entity_references?: EntityReference[];
  internal_links?: InternalLink[];
  sources?: Source[];
  cta?: Cta;

  // -- provenance -----------------------------------------------------------
  datePublished?: string;
  dateModified?: string;

  /**
   * Statistics used on this page, as stable fingerprints.
   *
   * Carried so the upstream ledger can cap reuse across a run. One statistic
   * appearing on 44 of 121 pages is what this field exists to prevent.
   */
  statistics?: string[];
}

// ---------------------------------------------------------------------------
// Fixed chrome
// ---------------------------------------------------------------------------

/**
 * CSS selectors for markup the layout owns and that is identical on every page.
 *
 * Two consumers:
 *  - the similarity gate strips these before shingling, so it scores only the
 *    prose that is supposed to differ;
 *  - `SPEAKABLE_SELECTORS` must be a subset of classes the renderer actually
 *    emits. Pointing speakable at classes that do not exist is the same as
 *    emitting no speakable at all.
 */
export const FIXED_CHROME_SELECTORS = [
  ".aeo-breadcrumb",
  ".aeo-toc",
  ".aeo-related",
  ".aeo-sources",
  ".aeo-cta",
  ".aeo-entities",
] as const;

export const SPEAKABLE_SELECTORS = [
  ".answer-box",
  ".faq",
  ".supporting-questions",
] as const;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ContractViolation {
  field: string;
  message: string;
}

function normalizeQuestion(q: string): string {
  return q
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[?.!,;:'"]/g, "")
    .trim();
}

/**
 * Checks a record against the parts of the contract that can be decided without
 * a model. Returns every violation rather than throwing on the first, so one
 * build reports the full list.
 */
export function validatePageRecord(record: PageRecord): ContractViolation[] {
  const v: ContractViolation[] = [];
  const push = (field: string, message: string) => v.push({ field, message });

  if (!record.slug?.trim()) push("slug", "required");
  if (!PAGE_ROLES.includes(record.role)) {
    push("role", `must be one of ${PAGE_ROLES.join(", ")}, got "${record.role}"`);
  }

  if (!record.canonicalQuestion?.trim()) {
    push("canonicalQuestion", "required and may not be derived from the title");
  }
  if (!record.title?.trim()) push("title", "required");

  // The answer gate. A page with no direct answer must not publish.
  const answerWords = record.answer?.trim().split(/\s+/).filter(Boolean).length ?? 0;
  if (answerWords < 25) {
    push("answer", `must be at least 25 words and answer the canonical question, got ${answerWords}`);
  }
  if (/^(in this (article|guide|post)|we'?ll (cover|explore|look)|this (page|article) )/i.test(record.answer ?? "")) {
    push("answer", "opens with a preamble instead of the answer");
  }
  if (record.answer?.trim().endsWith("?")) {
    push("answer", "is a question, not an answer");
  }

  if (!record.meta_description?.trim()) push("meta_description", "required");
  if (record.meta_description && record.meta_description.length > 160) {
    push("meta_description", `must be 160 characters or fewer, got ${record.meta_description.length}`);
  }
  // Catches "A educational guide for..." style boilerplate before it ships.
  if (/\bA (?=[aeiou])/.test(record.meta_description ?? "")) {
    push("meta_description", 'reads "A" before a vowel sound; the article is wrong');
  }

  if (!record.sections?.length) push("sections", "at least one section required");

  // FAQ must be bound to the canonical question, not to the title.
  const faqs = record.faqs ?? [];
  if (requiresFaqPage(record.role)) {
    if (!faqs.length) {
      push("faqs", `role "${record.role}" must carry FAQ pairs`);
    } else if (
      normalizeQuestion(faqs[0].question) !== normalizeQuestion(record.canonicalQuestion)
    ) {
      push(
        "faqs[0].question",
        "must string-equal canonicalQuestion after normalisation, so the FAQPage answers the page's own question"
      );
    }
  }
  faqs.forEach((f, i) => {
    if (!f.question?.trim()) push(`faqs[${i}].question`, "required");
    if (!f.answer?.trim()) push(`faqs[${i}].answer`, "required");
  });

  (record.internal_links ?? []).forEach((l, i) => {
    if (!l.target_url?.trim()) push(`internal_links[${i}].target_url`, "required");
    if (!l.anchor_text?.trim()) {
      push(`internal_links[${i}].anchor_text`, "required and must read naturally in a sentence");
    }
    if (!LINK_RELATIONSHIPS.includes(l.relationship)) {
      push(`internal_links[${i}].relationship`, `must be one of ${LINK_RELATIONSHIPS.join(", ")}`);
    }
  });

  (record.sources ?? []).forEach((s, i) => {
    if (!s.label?.trim()) push(`sources[${i}].label`, "required");
    if (!SOURCE_TYPES.includes(s.type)) {
      push(`sources[${i}].type`, `must be one of ${SOURCE_TYPES.join(", ")}`);
    }
  });

  return v;
}

/**
 * Build-time gate. Throws with every violation listed, so a bad record stops the
 * build instead of publishing a page that quietly fails its own contract.
 */
export function assertValidPageRecord(record: PageRecord): PageRecord {
  const violations = validatePageRecord(record);
  if (violations.length) {
    const detail = violations.map((x) => `  - ${x.field}: ${x.message}`).join("\n");
    throw new Error(
      `Page record for "${record.slug ?? "(no slug)"}" violates the page contract:\n${detail}`
    );
  }
  return record;
}
