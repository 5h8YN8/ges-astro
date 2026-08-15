/**
 * A reference PageRecord.
 *
 * Two jobs: it documents the exact shape 7.6 must emit, and it is the fixture
 * the contract test renders. Keep it valid. If a change to the contract makes
 * this record invalid, that is the signal to update the generator too.
 */
import type { PageRecord } from "../lib/page-contract";

export const exampleRecord: PageRecord = {
  slug: "answers/what-is-answer-engine-optimization",
  role: "faq",
  canonicalQuestion: "What is answer engine optimization?",
  title: "What Is Answer Engine Optimization?",
  answer:
    "Answer engine optimization is the practice of structuring content, data and markup so that AI answer engines cite your brand directly in a generated response. It optimizes for being quoted inside an answer rather than for ranking in a list of links, which changes what matters: factual density, explicit structure and machine readable claims instead of keyword placement and backlink volume.",
  meta_description:
    "Answer engine optimization structures content so AI engines cite your brand inside generated answers rather than ranking it in a list of links.",
  sections: [
    {
      heading: "How answer engines choose what to cite",
      heading_level: 2,
      content_type: "narrative",
      content:
        "An answer engine assembles a response from passages it can attribute. A passage becomes citable when it states a claim plainly, in one place, with enough surrounding context that the claim survives being lifted out of the page.\n\nThat is a different target from a ranked result. A page can rank well and still never be quoted, because its answer is distributed across six paragraphs of narrative that lose their meaning when separated.",
    },
    {
      heading: "Making a page citable",
      heading_level: 2,
      content_type: "steps",
      content:
        "1. Answer the page's question in the first paragraph, in full, without preamble.\n2. State each supporting claim once, in its own block, with the numbers attached.\n3. Emit structured data whose text matches the rendered text exactly.\n4. Link to the pages that back each claim, using anchor text that names the claim.",
    },
  ],
  faqs: [
    {
      question: "What is answer engine optimization?",
      answer:
        "It is the practice of structuring content and markup so AI answer engines cite your brand directly inside a generated response rather than merely listing it as a link.",
    },
    {
      question: "How is answer engine optimization different from SEO?",
      answer:
        "SEO optimizes for position in a list of links. Answer engine optimization optimizes for being quoted inside a synthesized answer, which rewards factual density and explicit structure over keyword placement and backlink volume.",
    },
  ],
  tradeoffs: {
    pros: [
      "Citations carry the brand name into the answer itself, where a link would not appear.",
      "Structured, factual pages are cheaper to keep accurate than narrative content.",
    ],
    cons: [
      "Citation share is harder to measure than rank position.",
      "Answer engines change how they select passages more often than search engines change ranking.",
    ],
  },
  proof_points: [
    "Six engines account for most AI answer traffic: ChatGPT, Perplexity, Claude, Google AI Overview, Gemini and Copilot.",
  ],
  entity_references: [
    { name: "Schema.org", type: "Standard", context: "Vocabulary used for structured data" },
  ],
  internal_links: [
    {
      anchor_text: "structured data for AI engines",
      target_url: "/what-is-aeo/",
      target_title: "What is Answer Engine Optimization (AEO)?",
      relationship: "parent",
    },
  ],
  sources: [
    { label: "Schema.org FAQPage specification", url: "https://schema.org/FAQPage", type: "documentation" },
  ],
  cta: {
    text: "See how often AI engines cite your brand",
    subtext: "A free report across the six engines that matter.",
    href: "/report/new/",
    label: "Get your free AEO score",
  },
  datePublished: "2026-08-15",
  dateModified: "2026-08-15",
  statistics: ["six-engines-majority-share"],
};
