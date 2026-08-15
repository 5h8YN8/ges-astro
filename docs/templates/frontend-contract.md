# Frontend contract: what the renderer now requires from 7.6

The renderer in this repo was written against a shape 7.6 does not emit. This
documents the gap that existed, what changed on the frontend, and the exact
payload the generator must now produce.

Verified by build: `npm run build` renders the reference record with the full
graph, and `npx astro check` reports 0 errors.

---

## 1. The gap that existed

`AEOPage.astro` and 7.6's `Validate Output` disagreed on nearly every field.

| 7.6 emitted | Renderer expected | Result |
|---|---|---|
| `content_sections[{heading, body, content, section_type}]` | `sections[{heading, heading_level, content, content_type}]` | Nothing rendered |
| `tradeoffs: {pros:[{point}], cons:[{point}]}` | `tradeoffs: [{pro, con}][]` | Nothing rendered |
| `internal_links[{anchor_text, target_slug, context}]` | `internalLinks[{anchor_text, target_url, target_title}]` | No links, no `mentions` |
| `authoritySignals.proofPoints[{point}]` | `proof_points: string[]` | Nothing rendered |
| `conversionPath` | `cta` | Nothing rendered |
| `aiAnswerBox` | *no render target at all* | **The answer box did not exist** |
| `sourcesAndReferences` | *no render target at all* | Minimum 3 sources required upstream, rendered nowhere |
| — | `entity_references` | Required by renderer, never emitted |

Three findings matter beyond the field names:

1. **The speakable selectors pointed at nothing.** `Build JSON-LD` declared
   `[".hero", ".answer-summary", ".faqs", ".supporting-questions"]`. The renderer
   emitted none of those classes. Speakable markup naming absent selectors is
   equivalent to emitting no speakable markup at all.
2. **There was no answer box.** The generator's `aiAnswerBox` had no render
   target, so the answer-first gate had nowhere to put its output. This is the
   frontend half of "4 of 121 pages open with a direct answer".
3. **The tradeoffs shape was wrong on both sides.** The renderer's `{pro, con}[]`
   forced the two columns to equal length and implied a pairing between a
   specific pro and a specific con that does not exist.

Separately, `AEOPage.astro` emitted its JSON-LD as `<Fragment slot="schema">`
from inside its own template, intending to reach `BaseLayout`'s head slot. A
`slot` attribute inside a nested component targets that component's own slots,
not its grandparent's, so the schema would have rendered in the body.

## 2. What changed

**`src/lib/page-contract.ts`** (new). The typed record, plus
`validatePageRecord` / `assertValidPageRecord`.

- `faq` is a first-class page role. Upstream, 7.4 / 7.5 / 7.6 all collapse
  `faq → guide`; the renderer refuses to lose the distinction, which is what
  left 34 strategy rows with no FAQPage.
- `canonicalQuestion` and `answer` are required fields. A page that cannot
  answer its own question up front cannot be built.
- `FIXED_CHROME_SELECTORS` lists the blocks the layout owns, and
  `SPEAKABLE_SELECTORS` lists what the schema may point at.

**`src/lib/page-schema.ts`** (new). Builds the `@graph` from the record.
No node is emitted whose truth condition the page cannot satisfy: `HowTo` only
when a section genuinely holds two or more ordered steps, `Article` only for
article roles, `Product`/`Offer` only for commercial roles and never with an
`aggregateRating`, since this renderer has no review evidence behind it. That
rule is generalised from VTL's `tested` gate.

`faqPairsFor()` always leads with the canonical question and its gated answer,
then appends the remaining pairs with duplicates dropped. The FAQ block and the
`FAQPage` node call the same function, so the rendered text and the markup are
the same strings.

**`src/components/AEOPage.astro`** (rewritten). Takes the record, validates it,
emits the schema itself, renders in fixed order: breadcrumb, H1, **answer box**,
contents, sections, key facts, pros and cons, FAQ, **sources**, entities,
related resources, CTA. Publishes `data-fixed-chrome` on the article so the
similarity gate can read the strip list out of the rendered HTML rather than
keeping its own copy in sync.

**`src/layouts/BaseLayout.astro`.** Added a `schema` prop rendered into `<head>`.
The named slot stays for pages that pass a Fragment as a direct child.

**`src/utils/aeo-renderer.ts`.** Now imports its link and section-type
definitions from the contract instead of declaring its own.

**`src/fixtures/example-record.ts`** (new). A valid reference record, type
checked on every build, documenting the shape 7.6 must emit.

## 3. What 7.6 must now emit

One `PageRecord` per page, replacing the current 12-block AES object:

```jsonc
{
  "slug": "answers/what-is-answer-engine-optimization",
  "role": "faq",                    // 13 roles, faq included; no collapsing
  "canonicalQuestion": "...",       // verbatim from strategy_pages.question
  "title": "...",                   // SERP headline, restates the question
  "answer": "...",                  // >= 25 words, answers canonicalQuestion
  "meta_description": "...",        // <= 160 chars, not boilerplate
  "sections": [{ "heading", "heading_level", "content", "content_type" }],
  "faqs":    [{ "question", "answer" }],
  "tradeoffs": { "pros": ["..."], "cons": ["..."] },
  "proof_points": ["..."],
  "entity_references": [{ "name", "type", "context" }],
  "internal_links": [{ "anchor_text", "target_url", "target_title", "relationship" }],
  "sources": [{ "label", "url", "type" }],
  "cta": { "text", "subtext", "href", "label" },
  "statistics": ["stable-fingerprint"]   // feeds the reuse ledger
}
```

Node-level changes required in 7.6:

| Node | Change |
|---|---|
| *Validate Output* | Map the model output onto `PageRecord`. Stop setting `title` from `hero.primaryQuestion`; carry `canonical_question` through from `strategy_pages.question` and put the gated answer in `answer` |
| *Validate Output* | `internalLinks[].url` becomes `target_url`, `relationship` is preserved rather than flattened into `context`, and the resolved sibling title fills `target_title` |
| *Build JSON-LD* | Delete. The renderer builds the graph from the record, so schema and markup cannot be deployed apart |
| *Prepare Deploy* | Write a page that renders through `AEOPage`, or a full HTML document. Never a bare body fragment |
| *role mapping* | Stop collapsing `faq → guide` in 7.4 `Prepare Strategy Pages`, 7.5 `Parse Claude Response` and 7.6 `safeRole`, and add `faq` to the `generated_pages.page_role` CHECK constraint |

## 4. Validation split

The frontend gate is deliberately narrow: everything it checks is cheap and
deterministic, so it can run on every build.

| Check | Where |
|---|---|
| Required fields, role validity, link relationships, source types | `validatePageRecord` (build) |
| Answer length, preamble openers, answer-is-not-a-question | `validatePageRecord` (build) |
| `faqs[0].question` equals `canonicalQuestion` for faq roles | `validatePageRecord` (build) |
| Meta description length and the "A" before a vowel case | `validatePageRecord` (build) |
| Does the answer actually answer the question | LLM judge, upstream in 7.6 |
| Inter-page n-gram similarity | Similarity gate, upstream in 7.6 |
| Statistic reuse across a run | Ledger, upstream in 7.6 |

A record that fails the build gate throws with every violation listed at once,
naming the field and what is wrong with it.
