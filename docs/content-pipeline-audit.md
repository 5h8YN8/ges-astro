# Content generation pipeline: template map, defect audit, corrected workflow

Two things live in this document:

1. **Template map** — where page templates actually live across the GES stack, and which
   workflow does what.
2. **Defect audit** — the `humaninthelooptalent.com/insights` run (121 pages from a 120-row
   `content-strategy.json`), attributed stage by stage, plus the corrected workflow and a
   consolidate-vs-rewrite recommendation.

Evidence base: the n8n workflows 7.4 / 7.5 / 7.6 / 7.7 (live, read via the n8n MCP on
2026-08-15), the synced skill folder, `5h8YN8/ges-astro`, and `5h8YN8/humaninthelooptalent-astro`
at `2468843`.

---

## Build status

Remediation is being built as parallel components, then swapped in, so no live client
pipeline is edited mid-flight.

| Component | State |
|---|---|
| `product_detail` page-type contract | Done. [`templates/product-detail.md`](templates/product-detail.md), seeded from `vibe-test-labs-astro` |
| Renderer aligned to the record contract | Done. [`templates/frontend-contract.md`](templates/frontend-contract.md). Build gate live in `src/lib/page-contract.ts` |
| **7.12 GES Page Gates** (n8n `fzuyBXwrmo1XxSxh`) | Done, inactive. Contract, similarity, statistic-ledger and answer-judge gates as a callable sub-workflow. Verified in both directions: a record carrying the real defects returns 9 violations across all four gates; a clean record passes with zero. Needs its `anthropicApi` credential bound before live use |
| **7.6b GES Content Creator (gated)** (n8n `0KLZkXkRC4fo2iD5`) | Built, inactive, credentials bound. Outline planner, sibling-prose context, statistic ledger, canonical-question binding, 7.12 gates before any write, full-document deploy with JSON-LD in the head, and all Supabase I/O on the managed credential. Not yet run end to end; not wired to 7.5 |
| **7.1b GES Org Schema Builder** (n8n `GLRsvTn7TGkXJahO`) | Built, inactive, on `/ges-schema-b`. Eleven fixes to the org graph, verified against a stress payload |
| `faq` page type | **Fixed.** `strategy_pages.page_type` and `generated_pages.page_role` CHECK constraints now accept `faq`, and 7.4 maps `faq_page` to `faq` instead of `guide` |
| 7.4 dropping `reasoning` and `confidence` | **Fixed.** Columns added and always written; see below |
| Service-role JWT hardcoded in node code | Removed from 7.1b and 7.6b, which use the `supabaseApi` credential. Still hardcoded in live 7.1, 7.4, 7.6 and 7.7. **The key must be rotated** |
| Consolidation of the existing 116 pages | Not started. Plan validated, see §2.3 |

> **`process.env` is not available in this instance's Code sandbox.** Confirmed by execution: a Code node
> reading it fails with "process is not defined". n8n Code nodes also cannot use credentials, so any Code
> node that fetched data had to carry a service-role key in its source. The fix is a split: **HTTP Request
> nodes with a managed credential do the I/O, Code nodes stay pure transforms.** Three RPCs back that split
> (`ges_page_context`, `ges_save_generated_page`, `ges_record_deploy`), which also collapses eight sequential
> reads into one round trip.
>
> The same sandbox limit had been corrupting live data: 7.4 `Prepare Strategy Pages` probed for the
> `reasoning` and `confidence` columns via `process.env`, threw, and the throw was swallowed by its `catch`,
> so both fields were dropped from every strategy page ever generated. The columns did not exist either.
> Both are fixed: the columns were added and the probe removed.
| Consolidation of the existing 116 pages | Not started. Plan validated, see §2.3 |

---

## Part 1 — Template map

### 1.1 The live page-creation chain (n8n)

| Workflow | Role |
|---|---|
| **7.4 GES Content Strategy Generator** | Claude generates a question bank → DataForSEO volumes → rank + dedupe → `content_strategies` + `strategy_pages` rows |
| **7.5 GES Page Ingestion** (`POST /ges-rewrite`) | Two modes. **URL mode:** fetch a live page, strip `script/style/nav/footer/header`, take `main`/`article`/`section` text (8 000 char cap), Claude detects `page_role` + `primary_question` + `missing_elements`. **Strategy mode:** load the `strategy_pages` row via the `strategy-page-context` edge function. Both chain into 7.6 |
| **7.6 GES Content Creator** | The actual template. Load Context → Assemble System Prompt → Claude → Validate Output → Em Dash Scan → Build JSON-LD → save → GitHub deploy |
| **7.7 GES Multi-Format Delivery** | Renders an artifact + signs a URL. **Not wired into the 7.6 chain** |
| **7.8 Link Builder / 7.9 Refresh Scanner / 7.10 Sitemap Importer** | Post-publish link graph, staleness scan, and the URL allowlist 7.6 reads from |

### 1.2 Updating an existing page (semantic links + JSON-LD + FAQ)

This is 7.5 URL mode → 7.6 "rewrite mode" (the branch in *Assemble System Prompt* that fires
when both `current_url` and `extracted_text` are present). Mechanically:

- **Semantic links are allowlist-constrained, not free text.** *Load Context* builds a single
  deduped `link_allowlist` from three sources, in priority order: `sitemap_urls` (populated by
  7.10) > already-generated pages for the org > sibling `strategy_pages` (including unbuilt ones,
  flagged `planned`). The prompt then says: minimum 3 `internalLinks`, every URL **must** come
  from that list, do not invent URLs, and each link carries a typed relationship
  (`parent | child | related | comparison | next-step | supporting`).
- **JSON-LD is built in code, not by the model.** *Build JSON-LD* emits an `@graph`:
  `Organization`, `Person`, `BreadcrumbList`, `WebPage` (with `speakable` + `mentions`),
  `Article`, `HowTo` (guide/pillar only), `FAQPage`, `Product` + `Offer` (pricing/product_detail),
  `Service`, `ItemList` (comparison/alternative). The `internalLinks` the model chose become
  `WebPage.mentions` — that is the semantic-link graph in schema form.
- **FAQ is universal.** The system prompt demands a minimum of 6 FAQs on every page regardless of
  role, and `SCHEMA_BY_ROLE` lists `FAQPage` for all 12 roles.

**The gap that matters:** *Prepare Deploy* base64s **only** the body HTML built from
`content_sections` and PUTs it to `ges-content/pages/<org_id>/<slug>.html`. It does not inject the
JSON-LD `<script>`, a `<head>`, or the FAQ markup. The schema exists only in Supabase
(`generated_pages.json_output`). So "we emit JSON-LD" is true at the data layer and false at the
published artifact, unless the consuming site reads `json_output` itself. 7.7's renderer is worse
— a bare `<h1>/<h2>/<p>` dump with no schema at all, and its description over-claims
(Webflow/Shopify/React/GDoc are named but the format map only handles html/md/json/txt).

### 1.3 Is there a saved product page template?

Two different things are called "product":

- **In GES: no.** `product_detail` and `pricing` are role keys only — a ~6-line intent/depth/focus
  block in `PAGE_RULES`, plus a branch in *Build JSON-LD* that adds `Product` + `Offer` + `Service`
  nodes. There is no layout, no section order, no template file.
- **In the dropship skills: yes on paper, missing on disk.** `dropship-product-launch/SKILL.md`
  Step 6 says *"Always use the exact template in `references/page-template.md`"* and describes a
  20-section review page (answer box, 4 buy buttons, lab results, FAQ, "Also Tested"). That skill
  folder contains **only `SKILL.md`** — `references/page-template.md`,
  `references/schema-templates.md`, `references/aeo-writing-guide.md`,
  `scripts/generate-astro-page.js`, `scripts/create-shopify-product.js` and
  `scripts/verify-deployment.js` are all referenced and all absent. Step 6c likewise calls
  `scripts/check-template-drift.js`, which does not exist either.

The only intact `.astro` page template in the skill set is
`best-of-articles/references/page-template.md` (roundup format: BreadcrumbList + WebPage +
Article + ItemList + N × Product + FAQPage). `dropship-site-setup` still has
`references/astro-layout.md` and `scripts/create-shopify-product.js`.

**So:** a product-page run today would improvise the 20-section structure from SKILL.md prose.
Restoring `dropship-product-launch/references/*` is the smallest high-value fix in the skill layer.

### 1.4 What the FAQ / AEO / SEO page templates actually are

- **There is no `faq` page type anywhere in the system.** 7.5's detector *can* return `faq_page`,
  but every layer maps it away: 7.4 `Prepare Strategy Pages` maps `faq_page → guide`, 7.5
  `Parse Claude Response` maps `faq`/`faq_page → guide`, 7.6 `safeRole()` does the same, and the
  `generated_pages.page_role` CHECK constraint has no faq value. FAQ survives only as a *section*,
  never as a page type.
- **"AEO/SEO templates" = role keys on one universal schema.** Every page, every role, is generated
  against a single `UNIVERSAL_OUTPUT_SCHEMA` with 12 blocks: `meta`, `hero`, `depthSection`,
  `supportingQuestions`, `tradeoffs`, `comparisonContext`, `authoritySignals`, `faqs`,
  `conversionPath`, `internalLinks`, `aiAnswerBox`, `sourcesAndReferences`. The only per-page
  variation is `PAGE_RULES[role]` — roughly six lines of intent/depth/focus, from a set of 12
  roles. `seo_content`, `guide` and `pillar` are those "SEO/AEO templates".
- **Front-end render templates in `ges-astro`:** `src/components/AEOPage.astro` (TOC, sections
  dispatched by `content_type`, proof points, tradeoffs, FAQ block with `FAQPage` microdata,
  entity references, related resources, CTA) and `src/utils/aeo-renderer.ts` (semantic HTML
  rendering, first-occurrence internal-link injection, em-dash/smart-quote sanitiser). **Neither
  is wired to anything** — no page imports `AEOPage`, and `what-is-aeo.astro` carries its own
  inline `Article` + `FAQPage` JSON-LD instead.

> **Security note:** `7.6 → Load Context` has the Supabase **service_role** JWT hardcoded in node
> code (`SB_KEY`). It should move to an n8n credential and the key should be rotated.

---

## Part 2 — Audit of the `humaninthelooptalent.com/insights` run

### 2.0 Which generator produced these pages

Not the n8n path. The published pages use `src/layouts/InsightLayout.astro` +
`src/data/content-strategy.json` in `humaninthelooptalent-astro`; the n8n path writes flat HTML to
`ges-content/pages/<org_id>/`. The strategy file's field set (`icp`, `buyerIntent`, `pageType`,
`subpath`, `questionType`) matches the `aeo-content-strategy` skill's taxonomy, not 7.4's
(`seo_keyword`, `intent_stage`, `priority_score`). This was a Claude-driven scaffold run.

That distinction matters for the fix list, but **not** for the diagnosis: both generators share the
same three structural properties — one shared skeleton, no sibling-body context, and no blocking
gate — so every defect below has a twin in the n8n pipeline.

Independently re-measured on `2468843`: 120 strategy rows (34 `faq`, 10 `pillar`, 70 `blog`,
3 `comparison`, 2 `case_study`, 1 `cluster`) across 6 subpaths; 120 question pages + 6 hub indexes
+ 2 hand-written = 128 `.astro` files. 44 pages contain `55.8`. 4 pages pass an `answer` prop.
**0** pages pass a `faq` prop. 116 of 120 meta descriptions come from a 5-variant boilerplate.

### 2.1 Defect attribution

| # | Defect | Stage | Cause class | Gate that would have caught it |
|---|---|---|---|---|
| 1 | 116/121 in one near-duplicate cluster (4 034 pairs ≥50% 5-gram Jaccard) | **Drafting** (inherited from outline) | **Prompt + context.** One skeleton for all 120 questions, and the generator never saw a sibling *body* — only sibling *titles/slugs*, and only for linking | Inter-page n-gram similarity gate. **Does not exist** in either pipeline |
| 2 | 9/10 pillar pages share the same three H2s (`The Framework` / `What the Data Shows` / `The Super IC…` \| `The Equity Trap…`) | **Outline** | **Prompt.** The outline is a fixed skeleton keyed on `pageType`; all 10 pillars got the identical ~6-line pillar rule | Heading-set uniqueness check (Jaccard over the H2 set of same-`pageType` siblings) |
| 3 | 44/121 repeat GitHub Copilot 55.8% | **Drafting** | **Context.** One company-intelligence blob injected identically into every prompt, marked "your ONLY source of facts", plus a "minimum 3 proof points" floor. Convergence is the designed outcome | Statistic-usage ledger with a per-stat cap across the run |
| 4 | 4/121 open by answering their own question | **Drafting** (+ handoff, see #7) | **Prompt with no validator.** "Answer-first, always" is an instruction; nothing checks it. Compounded by the page answering its *rewritten* title, not the canonical question | First-paragraph-answers-canonical-question gate. **Does not exist** |
| 5 | Templated meta descriptions, 9 ungrammatical (`A educational` ×6, `A implementation` ×3) | **Schema/scaffold** | **Prompt/template.** A 5-variant string keyed on `questionType`/`buyerIntent` covers 116/120 pages; the article was hardcoded `A` | Meta-description uniqueness + basic prose lint (a/an, length, leading-boilerplate share) |
| 6 | 34 rows typed `pageType:"faq"`, no page emits `FAQPage` | **Schema** | **Missing gate + a taxonomy that erases the type.** `InsightLayout` emits `FAQPage` only when a page passes `answer`; 4 do, 0 pass `faq`. In n8n the same intent is erased three times over by `faq → guide` mappings | "`pageType==faq` ⇒ page emits `FAQPage` with ≥1 pair whose `name` equals the canonical question" |
| 7 | Titles diverge from the strategy file's canonical question; only the title flowed downstream | **Question → draft handoff** | **Contract.** The model is allowed to restate the question as a title, and the title becomes the identity of the page. In 7.6 this is literal: `title: hero.primaryQuestion` | Assert the canonical question is carried as its own field and that the emitted answer is bound to it, not to the title |

**Direct answers to the three questions asked:**

1. **Which stage?** One outline defect (#2), three drafting defects (#1, #3, #4), two schema/render
   defects (#5, #6), one handoff-contract defect (#7). Question generation is **not** at fault —
   the 120 questions are genuinely distinct and well mapped to the journey.
2. **Which cause class?** Prompt (#2, #5), context (#1, #3), contract (#7), missing gate (#4, #6),
   with #1 being both prompt and context. No defect is explained by missing gates alone — but
   every one of them would have been *caught* by a gate.
3. **Do the gates exist?** **No inter-page similarity check exists**, and **no
   answers-its-own-question check exists**, in either pipeline. 7.6's `Validate Output` only
   accumulates non-blocking `quality_warnings` (`missing_title`, `no_faqs`, `no_sources`…) and the
   run proceeds regardless; the only hard gate anywhere is the em-dash scan. Notably the org
   already owns the right pattern — `dropship-product-launch` Step 6c specifies
   `check-template-drift.js` with block-at-50%/warn-at-35% 8-gram thresholds — it was simply never
   built or applied here.

### 2.2 Corrected workflow

Stage order, with the gate that closes each stage. A gate marked **HARD** blocks publish.

**Stage 1 — Strategy (unchanged).** Keep `content-strategy.json` as the source of truth. Add one
required field per row: `canonicalQuestion` (verbatim, immutable) and treat `slug` as derived from
it. Nothing downstream may rewrite it.

**Stage 2 — Per-page outline.** Replace the shared skeleton. For each row, generate an outline
*from that question*: 3–6 H2s derived from the question's own sub-claims, plus the required
evidence types. Input: the canonical question, `questionType`, `buyerIntent`, `icp`, and **the H2
sets of every already-outlined sibling in the same subpath**.
→ **GATE (HARD): heading uniqueness.** Reject if the H2 set overlaps any sibling's by more than
50%, or if any H2 string has already been used twice anywhere in the run.

**Stage 3 — Drafting with sibling visibility.** Pass the generator: the outline, the client
research, the stat ledger (below), and the *opening paragraph plus H2 set* of the 3–5 nearest
already-written siblings (nearest by subpath, then by question embedding). Instruct it explicitly
to differentiate — "these pages already exist and already say X; this page must not restate it".
This is the single highest-leverage change: it converts self-differentiation from a hope into an
input.

**Stage 4 — Statistics ledger.** Maintain a run-scoped ledger `{stat_fingerprint → [slugs]}`.
Before drafting, hand the generator the stats already at cap.
→ **GATE (HARD):** any single statistic may appear on at most **3 pages** or **5%** of the run,
whichever is larger. Over cap → the draft must substitute or drop it. Also flag any run where the
top 5 stats cover more than 30% of pages: that is a research-depth problem, not a drafting one.

**Stage 5 — Differentiation gate.**
→ **GATE (HARD): >40% n-gram similarity to any existing page ⇒ reject.** Shingle the visible body
text into 5-grams, compare by Jaccard against every published page and every page drafted earlier
in the run, report the top-3 offenders and the shared shingles, and send the draft back to Stage 3
with those shingles as an explicit avoid-list. Two rejections in a row on the same page ⇒ stop and
flag it as a merge candidate rather than a page. (Boilerplate — nav, CTA, footer — must be stripped
before shingling or every page trivially fails.)

**Stage 6 — Answer gate.**
→ **GATE (HARD): the first paragraph must directly answer the canonical question.** Two checks in
series: (a) cheap structural check — the first `<p>` after the H1 is ≥40 words, contains no
"in this article/we'll cover" opener, and is not a question; (b) an LLM judge given only the
canonical question and the first paragraph, asked "does this paragraph answer this question on its
own, without the rest of the page?" — binary, with the failure reason returned. The judged answer
text becomes the `answer` prop. `InsightLayout` already has the right hook and the right docstring
for this; it is simply unpopulated on 116 pages.

**Stage 7 — Schema emission from the strategy file.** Build `FAQPage` from
`canonicalQuestion` + the gated first-paragraph answer, never from the title. Absorbed sibling
questions become additional `mainEntity` pairs.
→ **GATE (HARD):** `pageType == "faq"` ⇒ `FAQPage` present and its first `Question.name` string-
equals the canonical question. Also assert `Article.headline` is present and the description is not
one of the boilerplate variants.

**Stage 8 — Publish, then verify.** Fetch each live URL and re-assert: 200, JSON-LD present and
parseable, `FAQPage` present where required, and the rendered first paragraph matches what the
answer gate approved.

**Corresponding n8n changes (so other clients don't repeat this):**

| Where | Change |
|---|---|
| 7.6 *Assemble System Prompt* | Add a per-page outline step; feed sibling **bodies**, not just slugs; inject the stat ledger |
| 7.6 *Validate Output* | Promote `quality_warnings` to hard failures for the gates above; stop letting a page save with `no_faqs` |
| 7.6 *Validate Output* | Stop setting `title` from `hero.primaryQuestion` — carry `canonical_question` through from `strategy_pages.question` and bind `FAQPage` to it |
| 7.6 *Prepare Deploy* | Emit a real document: `<head>`, the `json_ld` from *Build JSON-LD* as a `<script type="application/ld+json">`, and FAQ markup. Today the schema never reaches the artifact |
| 7.6 (new nodes) | `Similarity Gate` and `Answer Gate` between *Em Dash Scan* and *Build JSON-LD* |
| 7.4 / 7.5 / 7.6 role maps | Stop collapsing `faq_page → guide`; either add `faq` to the `page_role` CHECK constraint or carry the original type in a `source_page_type` column so schema emission can branch on it |
| 7.6 *Load Context* | Move the hardcoded service_role JWT to a credential; rotate the key |

### 2.3 Consolidate vs rewrite

**Recommendation: consolidate. 121 → 22.**

Rewriting 116 pages in place is the wrong trade even with the corrected workflow. The questions
cluster genuinely — five different phrasings of "what is a super IC" are one page's worth of intent,
not five — so a rewrite would produce 116 *differentiated but thin* pages competing with each other
for the same citation. Fewer, denser pages, each answering one canonical question up front and
carrying its absorbed siblings as real `FAQPage` entries, is both the better AEO structure and
about a sixth of the work.

`humaninthelooptalent-astro` already carries `CONSOLIDATION-PLAN.md` (merged as PR #13). I checked
it against the strategy file and it holds up: **22 targets (17 new + 5 kept), 116 redirects, all 120
strategy slugs plus `first-ai-era-hire` accounted for, no orphans, no slug outside the strategy
set.** The 5 kept anchors are exactly the 5 hand-written pages that fell outside the duplicate
cluster. Adopt it as-is.

| Subpath | Target pages | Absorbs |
|---|---|---|
| `super-ic` | `what-is-a-super-ic`, `hiring-and-keeping-super-ics` | 10 |
| `hire-automate-or-super-ic` | `decision-framework`, `roi-of-automating-vs-hiring` | 11 |
| `ai-native-org-design` | `how-ai-native-teams-are-structured`, `making-an-existing-team-ai-native` | 13 |
| `workforce-architecture` | `what-is-workforce-architecture`, `how-many-people-do-you-need`, `scaling-without-losing-leverage` | 16 |
| *(root)* | `first-ai-era-hire` **(keep)** | 2 |
| `post-funding-hiring` | `post-funding-org-design`, `hiring-rate-after-a-raise`, `first-management-layer`, `scaling-without-losing-velocity`, `minimum-team-size-scale-to-series-a` **(keep)** | 25 |
| `startup-recruiting` | `best-hiring-framework-early-stage-startups` **(keep)**, `first-engineering-hires`, `sourcing-and-finding-talent`, `interviewing-and-evaluating`, `offers-onboarding-retention`, `scale-recruiting-without-hiring-recruiter` **(keep)**, `use-recruiter-or-hire-myself-seed-stage` **(keep)** | 44 |

Three amendments to the plan before execution:

1. **Write the 17 new bodies from scratch through the corrected workflow.** Do not stitch the
   existing duplicate bodies together — that carries the 55.8% stat and the shared H2s straight
   into the consolidated set. Each new page enters at Stage 2 with its own outline.
2. **The stat ledger applies to the consolidated set too.** At 22 pages the cap should be 2 pages
   per statistic. 55.8% currently sits on 44 pages; it belongs on one.
3. **301, don't delete, and keep the redirects permanent.** The 116 URLs have been live and
   indexed; the redirect map in the plan is complete and should ship in the same deploy as the
   merged pages, not after.

Expected end state: 22 pages, each opening with a gated direct answer to one canonical question,
each carrying a multi-question `FAQPage` built from the strategy file, and no two pages above 40%
5-gram similarity.
