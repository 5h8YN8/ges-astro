/**
 * page-schema.ts
 *
 * Builds the JSON-LD @graph for a generated page from its PageRecord.
 *
 * Two rules govern everything here:
 *
 *  1. Nothing is hand written per page. The graph and the rendered markup read
 *     the same record, so FAQ text on the page and FAQ text in the schema are
 *     the same strings by construction.
 *
 *  2. No node is emitted whose truth condition the page cannot satisfy. A
 *     HowTo without steps, a FAQPage without answers, or an Article on a page
 *     that is not an article all claim something the page does not deliver.
 *     Missing markup costs a little. Markup that lies costs the domain.
 */

import {
  isArticleRole,
  SPEAKABLE_SELECTORS,
  type Faq,
  type PageRecord,
} from "./page-contract";

export interface SchemaOptions {
  siteUrl: string;
  organizationName: string;
  organizationLogo?: string;
  /** Absolute URL of the page. Defaults to `${siteUrl}/${slug}/`. */
  pageUrl?: string;
}

type Node = Record<string, unknown>;

function trimSlashes(s: string): string {
  return s.replace(/^\/+|\/+$/g, "");
}

function absolute(url: string, siteUrl: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `${siteUrl.replace(/\/+$/, "")}/${trimSlashes(url)}/`;
}

/**
 * The FAQ pairs that back the FAQPage node.
 *
 * The canonical question and its gated answer always lead. That is the whole
 * point of the answer gate: the page's own question is the first thing an
 * engine can extract, bound to prose the page actually opens with. Additional
 * pairs follow, with any duplicate of the canonical question dropped.
 */
export function faqPairsFor(record: PageRecord): Faq[] {
  const lead: Faq = { question: record.canonicalQuestion, answer: record.answer };
  const norm = (q: string) => q.toLowerCase().replace(/[?.!]/g, "").trim();

  const rest = (record.faqs ?? []).filter(
    (f) => norm(f.question) !== norm(record.canonicalQuestion)
  );

  return [lead, ...rest];
}

export function buildPageSchema(record: PageRecord, opts: SchemaOptions): object {
  const siteUrl = opts.siteUrl.replace(/\/+$/, "");
  const url = opts.pageUrl ?? absolute(record.slug, siteUrl);
  const orgId = `${siteUrl}/#organization`;

  const graph: Node[] = [];

  // -- Organization ---------------------------------------------------------
  graph.push({
    "@type": "Organization",
    "@id": orgId,
    name: opts.organizationName,
    url: `${siteUrl}/`,
    ...(opts.organizationLogo
      ? { logo: { "@type": "ImageObject", url: absolute(opts.organizationLogo, siteUrl) } }
      : {}),
  });

  // -- BreadcrumbList -------------------------------------------------------
  // Only when the page actually sits below the root.
  const segments = trimSlashes(record.slug).split("/").filter(Boolean);
  if (segments.length) {
    graph.push({
      "@type": "BreadcrumbList",
      "@id": `${url}#breadcrumb`,
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${siteUrl}/` },
        ...segments.map((segment, i) => ({
          "@type": "ListItem",
          position: i + 2,
          name: segment.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          item: `${siteUrl}/${segments.slice(0, i + 1).join("/")}/`,
        })),
      ],
    });
  }

  // -- WebPage --------------------------------------------------------------
  // `mentions` carries the internal link graph. Speakable points only at
  // selectors the renderer emits; see SPEAKABLE_SELECTORS.
  const mentions = (record.internal_links ?? [])
    .map((l) => absolute(l.target_url, siteUrl))
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .map((id) => ({ "@type": "WebPage", "@id": id }));

  graph.push({
    "@type": "WebPage",
    "@id": `${url}#webpage`,
    url,
    name: record.canonicalQuestion,
    description: record.meta_description,
    publisher: { "@id": orgId },
    ...(mentions.length ? { mentions } : {}),
    speakable: {
      "@type": "SpeakableSpecification",
      cssSelector: [...SPEAKABLE_SELECTORS],
    },
  });

  // -- Article --------------------------------------------------------------
  if (isArticleRole(record.role)) {
    graph.push({
      "@type": "Article",
      "@id": `${url}#article`,
      mainEntityOfPage: { "@id": `${url}#webpage` },
      headline: record.title,
      description: record.meta_description,
      publisher: { "@id": orgId },
      ...(record.datePublished ? { datePublished: record.datePublished } : {}),
      ...(record.dateModified ? { dateModified: record.dateModified } : {}),
    });
  }

  // -- HowTo ----------------------------------------------------------------
  // Only from sections that genuinely contain ordered steps. A HowTo built out
  // of narrative prose is a claim the page does not support.
  const stepSection = record.sections.find((s) => s.content_type === "steps");
  if (stepSection) {
    const steps = stepSection.content
      .split("\n")
      .map((line) => line.replace(/^(?:step\s*)?\d+[.):\s]+/i, "").trim())
      .filter(Boolean);

    if (steps.length >= 2) {
      graph.push({
        "@type": "HowTo",
        "@id": `${url}#howto`,
        name: stepSection.heading,
        step: steps.map((text, i) => ({
          "@type": "HowToStep",
          position: i + 1,
          text,
        })),
      });
    }
  }

  // -- FAQPage --------------------------------------------------------------
  // Always present, because every record carries a canonical question and a
  // gated answer. This is what the 34 faq-typed strategy rows never got.
  const faqs = faqPairsFor(record);
  if (faqs.length) {
    graph.push({
      "@type": "FAQPage",
      "@id": `${url}#faq`,
      mainEntity: faqs.map((f) => ({
        "@type": "Question",
        name: f.question,
        acceptedAnswer: { "@type": "Answer", text: f.answer },
      })),
    });
  }

  // -- Product / Offer / Service -------------------------------------------
  // Commercial roles only, and never with a rating: this renderer has no
  // review evidence behind it, so aggregateRating would be fabricated.
  if (record.role === "product_detail" || record.role === "pricing") {
    const productId = `${url}#product`;
    graph.push({
      "@type": "Product",
      "@id": productId,
      name: record.title,
      description: record.meta_description,
      brand: { "@id": orgId },
    });
    graph.push({
      "@type": "Offer",
      "@id": `${url}#offer`,
      itemOffered: { "@id": productId },
      url,
    });
  }

  if (record.role === "feature_detail") {
    graph.push({
      "@type": "Service",
      "@id": `${url}#service`,
      name: record.title,
      description: record.meta_description,
      provider: { "@id": orgId },
    });
  }

  // -- ItemList -------------------------------------------------------------
  if (record.role === "comparison" || record.role === "alternative") {
    const items = record.sections
      .filter((s) => s.content_type === "comparison_table")
      .map((s, i) => ({ "@type": "ListItem", position: i + 1, name: s.heading }));

    if (items.length) {
      graph.push({
        "@type": "ItemList",
        "@id": `${url}#comparison`,
        itemListElement: items,
      });
    }
  }

  return { "@context": "https://schema.org", "@graph": graph };
}
