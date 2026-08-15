# `product_detail` — page-type contract

Seeded from `5h8YN8/vibe-test-labs-astro` (`src/layouts/ProductReviewLayout.astro` +
`src/components/product/*` + `src/lib/product.ts` + `src/config/store.ts`), generalised into a
portable contract that 7.6 can load per client.

This is the first entry in the template library described in
[`../content-pipeline-audit.md`](../content-pipeline-audit.md) §Part 2.2.

---

## 1. Why this one is the right seed

The VTL template is not a prose skeleton. It is a **record → layout inversion**, and that is the
property worth copying:

> *"Editorial prose stays per-page via named slots. Everything commercial — pricing, availability,
> trust copy, structured data, related-product logic, analytics — is centralised here and cannot
> drift between pages."* — `ProductReviewLayout.astro`

The generator produces a **typed record**, not HTML. The layout owns all rendering *and* all
structured data, both reading the same resolved object. Three consequences fall out of that, and
each one kills a defect from the insights audit at the root:

| Property | Defect it eliminates |
|---|---|
| `FaqSection` and the `FAQPage` node both read `product.faq` | FAQ text can never diverge from FAQ schema — and a page can't ship FAQ prose with no schema |
| Schema is a component in the layout, not a separate deploy step | JSON-LD can't fail to reach the artifact (7.6's current bug) |
| Only editorial slots vary per page; chrome is centralised | Boilerplate is *deliberately* identical and excluded from similarity scoring, so the gate measures only the prose that should differ |

It also encodes two integrity rules the GES pipeline has nowhere:

- **`tested` gate.** `Review` and `AggregateRating` are emitted only when `testResults.length > 0`.
  A page for an untested product renders "Not yet tested" and drops the rating nodes entirely,
  because publishing review markup for a review that didn't happen is a fabricated review.
- **Live-value binding.** `resolveProduct()` merges the static record with live Shopify price and
  stock, and both the rendered price and `Offer.price` read the merged result, so the two cannot
  disagree.

Generalise both. The `tested` pattern becomes the rule for every page type: **never emit a schema
node whose truth condition the page cannot satisfy.**

**Adoption note:** only 9 of 55 VTL product pages currently use `ProductReviewLayout`; the other 46
are hand-rolled `BaseLayout` pages with inline schema. Migrating those is a separate, mechanical
task — the template is proven, just not yet universal.

---

## 2. Record contract

What the generator must emit. Everything else is derived. Field names follow the VTL record; rename
only if the whole library renames together.

| Field | Type | Required | Notes |
|---|---|---|---|
| `slug` | string | ✓ | Matches the page filename and the strategy row |
| `canonicalQuestion` | string | ✓ | **Verbatim from the strategy file.** Never model-rewritten |
| `questionHeadline` | string | ✓ | The H1. Must be a restatement of `canonicalQuestion`, not a new question |
| `answerSnippet` | string | ✓ | 60–100 words, directly answers `canonicalQuestion`. Feeds the answer box, the meta description, `WebPage.description`, and `Product.description` |
| `name`, `brand`, `category` | string | ✓ | `category` must resolve through the same slugify as the category routes |
| `price`, `shopifyProductId`, `affiliateUrl` | string | ✓ | Commercial identity; price is overridden by live data at build |
| `image`, `images[]` | string | ✓ | CDN URLs |
| `verdict`, `verdictBadge`, `finalVerdictSummary` | string | ✓ | Per-product, never reused across pages |
| `vibeScore` | 0–100 | conditional | Required only when `testResults` is non-empty |
| `testResults[]` | `{category, score, summary}` | — | **Empty is a valid state** and suppresses all rating schema. Dimensions must suit this product type |
| `pros[]`, `cons[]` | string[] | ✓ | ≥1 honest limitation specific to this product |
| `howToUse[]` | string[] | — | Emits `HowTo`. Must reference this product's actual controls/parts |
| `faq[]` | `{question, answer}` | ✓ | 4–6 items. First entry's `question` **must string-equal `canonicalQuestion`** |
| `solutionSection`, `problemSection`, `viralReason` | string | ✓ | Card/grid copy. Must be unique per product |

Per-page editorial slots (optional, prose only): `what-worked`, `tradeoffs`, `who-its-for`,
`comparison`, plus the default slot for additional sections.

## 3. Section contract

Fixed order. `[F]` = fixed chrome owned by the layout, `[S]` = slotted editorial.

```
1. Breadcrumb                                        [F]
2. H1 (questionHeadline) + thumbnail                 [F]
3. Hero: gallery | answer box + primary buy control  [F]   .answer-box
4. What worked / Tradeoffs / Who it's for            [S]   falls back to pros/cons/solutionSection
5. Specifications table                              [F]
6. How It Compares                                   [S]   rendered only when the slot is filled
7. Additional editorial prose                        [S]
8. Evidence / testing methodology                    [F]   renders "Testing Status" when untested
9. FAQ                                               [F]   .faq .supporting-questions
10. Related products (in-stock only)                 [F]
11. Closing buy control                              [F]
```

Speakable CSS hooks: `.answer-box`, `.verdict-card`, `.faq`, `.supporting-questions`.
Similarity scoring must strip everything marked `[F]` before shingling.

## 4. Schema contract

One `@graph`, built from the resolved record, emitted inside the layout:

| Node | Condition |
|---|---|
| `BreadcrumbList` | always — Home → Category → Product |
| `WebPage` | always — with `mentions` (related products + category) and `speakable` |
| `Review` | **only when `testResults.length > 0`** |
| `Product` | always — `additionalProperty` from specs; `aggregateRating` only when tested |
| `Offer` | always — price from the merged live/static value, plus `shippingDetails` and `hasMerchantReturnPolicy` from store policy config |
| `HowTo` | when `howToUse` is non-empty |
| `FAQPage` | when `faq` is non-empty — built from the same array the FAQ section renders |
| `Person` (author) | always — `sameAs` the methodology URL |

Rating scale: Vibe Score 0–100 maps linearly to 1–5 for structured data (`1 + score/100*4`), because
`Review` markup is only valid on a conventional scale.

## 5. What is VTL-specific and must be parameterised

Everything below moves from hardcoded values into a per-client config row (VTL's `config/store.ts`
is the shape to copy):

- Site URL, currency, brand names, author identity, organisation `@id`
- Commerce policy: shipping rates, handling/transit days, return window and fees
- Scoring vocabulary: "Vibe Score" / verdict badge names / tiers → `scoreLabel`, `scoreTiers`, `verdictVocabulary`
- Commerce integration: Shopify Storefront resolution is one adapter. Clients without a storefront
  supply static price/availability and skip live merging
- Testing methodology copy and `minimumDays`

**Note:** `config/store.ts` in VTL contains a Shopify Storefront token in source. Storefront tokens
are public-scope by design, but the library version should still read it from an environment
variable rather than baking it into a template other clients copy.

## 6. How 7.6 consumes it

| Node | Change |
|---|---|
| *Load Context* | Load the `page_templates` row for `(client, page_type)`; put the record contract in the prompt as the required output shape |
| *Assemble System Prompt* | Replace `UNIVERSAL_OUTPUT_SCHEMA` for this page type with the record contract. Role rules shrink to tone/depth only — the template owns structure |
| *Validate Output* | Validate against the record contract. Missing required field ⇒ **hard fail**, not a warning |
| *Build JSON-LD* | Build from the template's schema contract with its conditions, instead of the one-size `@graph` |
| *Prepare Deploy* | Emit a page that renders through the layout — either an `.astro` page passing the record, or a full HTML document with the schema inlined. Never a bare body fragment |

## 7. Type-specific gates

On top of the global gates in the audit:

- `faq[0].question` string-equals `canonicalQuestion` — else fail
- `answerSnippet` answers `canonicalQuestion` (LLM judge, binary) — else fail
- `testResults` empty ⇒ **no** `Review`, `AggregateRating`, or `vibeScore` anywhere on the page
- `testResults` dimensions must not be byte-identical to another product in a different category
- Rendered price equals `Offer.price` after live resolution
- `verdict`, `viralReason`, `problemSection`, `solutionSection` unique against the last 10 records
- Similarity gate runs on slotted content only, with `[F]` sections stripped
