# The three page-generation flows

How each flow runs end to end, what it guarantees, and where semantic links come from.

| | Flow | Entry point |
|---|---|---|
| 1 | Update an existing page | `POST /ges-rewrite { org_id, target_url }` |
| 2 | Create a new AEO page | 7.4, then `POST /ges-rewrite { org_id, strategy_page_id }` per page |
| 3 | Create a page that needs industry research | 7.13, then flow 2 |

7.5 chains to **7.6b**. 7.6 is deprecated; see Credentials below.

All three converge on **7.6b**, so they share one contract, one set of gates and one renderer.

---

## Shared spine

```
7.6b: Validate Auth
      -> Fetch Page Context      (RPC ges_page_context, supabaseApi credential)
      -> Shape Context           (pure transform: prose, stat ledger, link allowlist)
      -> Build Outline Prompt -> Claude: Plan Outline -> Parse Outline
      -> Assemble System Prompt -> Claude: Generate Content
      -> Map To Page Record -> Em Dash Scan
      -> Build Gate Payload -> Run Page Gates  (7.12)
      -> Gates Passed?
           true  -> Save Generated Page -> Emit Usage -> Prepare Deploy
                    -> Check Existing File -> Merge -> GitHub Deploy
                    -> Record Deploy -> Return Result
           false -> Return Gate Failure   (nothing written, nothing deployed)
```

Four gates run before anything is written: the record contract, inter-page similarity at 40%,
the statistic reuse cap, and an LLM judge on whether the opening paragraph answers the page's
own question. A blocked page returns its violations so the caller can regenerate against them.

**Deploy target.** The artifact is written to `5h8YN8/ges-content`, not to the client's site. All
three flows produce a page; publishing it is a separate step.

---

## Flow 1 — Updating an existing page

**7.5 URL mode.** SSRF-guards the URL, fetches it, strips `script/style/nav/footer/header`, takes
`<main>` then `<article>` then `<section>` (8,000 character cap), and has Claude detect the page
role, the primary question, the topics and the missing AEO elements.

**Anchor Rewrite Page** then upserts a row in a per-org `URL Rewrites` strategy, keyed on the URL
path, and forwards its id.

This step is what makes the rewrite path equivalent to the planned path. Without it a rewrite had
no strategy row, which meant no canonical question the model was forbidden to rewrite, no stable
slug, and **no siblings, therefore no internal links** — every guarantee built on that row was
inert on this path. The slug follows the live URL, so a rewrite keeps the address it already has.
Re-running a rewrite does not move the canonical question, since pages already linking to it would
be pointing at a different claim.

**7.6b** then runs the shared spine with one branch difference: because `current_url` and
`extracted_text` are both present, the prompt says *preserve every verifiable fact from the
existing page and restructure the rest*.

## Flow 2 — Creating a new AEO page

**7.4** takes `{ icp_id, vertical, volume_target, strategy_name }`, passes the intelligence-score
gate, generates the question bank, enriches with DataForSEO volumes, ranks and dedupes, and writes
`content_strategies` plus one `strategy_pages` row per question — including `reasoning` and
`confidence`, and preserving `faq` as a real page type.

Then one call per page: `POST /ges-rewrite { org_id, strategy_page_id }` → 7.5 strategy mode →
7.6b. The canonical question and slug come from the row, and the model cannot rename either.

**Order matters.** The statistic ledger and the sibling prose are rebuilt from `generated_pages`
on every run, so each page differentiates against everything already built. Generate pillars and
hubs first, then spokes. Expect blocks: a draft that trips the similarity gate returns violations
and writes nothing. Feed the violations into a retry rather than lowering the threshold.

## Flow 3 — Pages that need industry research

The gap this closes: 7.11 researches the *client* — products, proof points, competitors, ICP pain.
EUDR, LWG Gold versus Silver, ZDHC MRSL, CSRD Scope 3 are none of those. They are external facts
about rules and standards, and the generator is instructed to state nothing it has not been given.
Without a research step a regulatory page can only be vague or invented.

**7.13 GES Topic Research**, called before 7.6b:

1. Fetches the org's existing research and scores term overlap against this question. Two thirds
   coverage within `max_age_days` (default 120) means the call is skipped.
2. Otherwise queries Perplexity `sonar-pro` restricted to primary sources: regulation texts,
   standards bodies, official documentation, government publications, peer-reviewed research.
   Explicitly not blog posts, vendor marketing or news commentary.
3. Stores the result in `company_intelligence` under `regulatory`, `standards` or
   `industry_research`, so it is never confused with the client's own claims, and registers the
   named entities in `entity_registry`.

7.6b then picks that research up through `company_research` in the context bundle, and the
entities appear by name in the prompt.

**Paired gate.** A page whose text matches regulatory or standards language must cite at least one
source of type `standard`, `documentation`, `study` or `industry-report` **with a resolving URL**.
An internal source cannot establish what a regulation says.

Verified on a real EUDR question: irrelevant existing research scored 0 coverage, the result was
categorised `regulatory`, EUDR, ZDHC, MRSL and LWG were extracted as entities, and the EUR-Lex
text was taken as the primary source.

---

## Semantic links: yes, in all three, and now enforced

Links come from the **allowlist** built in `Shape Context`, widest first:

1. siblings in the same strategy
2. **any other page the org has planned or built** (`org_link_targets`)
3. the org's sitemap (`sitemap_urls`, populated by 7.10)
4. pages already generated

The model may only link to a URL on that list. `Map To Page Record` drops anything else before the
record is built, because an invented URL is both a broken link and a dangling `WebPage.mentions`
entry in the schema. Surviving links appear twice in the output: as a Related Resources block in
the HTML, and as `WebPage.mentions` in the JSON-LD — which is how an engine reads the site as a
connected graph rather than a pile of unrelated pages.

Two fixes were needed to make that true of all three flows:

- **Flow 1 produced zero links.** No strategy row meant no siblings, and if the org had no imported
  sitemap the allowlist was empty, so the prompt correctly instructed the model to emit no links at
  all. Anchoring the rewrite to a strategy row fixed the cause; widening the allowlist to all org
  pages fixed it a second time.
- **Nothing enforced it.** The contract validated links that were present but never required any.
  7.6b now passes `min_internal_links` to the gate, set to 3 when at least three approved targets
  exist and 0 when none do, so the gate can tell *nothing to link to* apart from *did not link*.

---

---

## Credentials: no workflow holds a key

The Supabase service-role key was deleted. Every workflow that had a copy pasted into node
source has been moved onto the `supabaseApi` credential, which injects the `apikey` and
`Authorization` headers itself.

| Workflow | Was | Now |
|---|---|---|
| 7.1 Org Schema Builder | key in 2 HTTP node headers | credential; save is now an upsert on `(org_id, domain)` |
| 7.2 Company Intelligence | key in 2 HTTP node headers | credential |
| 7.3 ICP Validator | key in 2 HTTP node headers | credential |
| 7.4 Content Strategy | key in 4 Code nodes and 1 HTTP node | credential; reads collapse into one `ges_strategy_context` RPC |
| 7.6 Content Creator | key in 4 Code nodes | **deprecated**, callers moved to 7.6b |
| 7.10 Sitemap Importer | key in 1 large Code node | credential; fetch and parse stay in Code, all I/O in HTTP nodes |
| 7.5, 7.7, 7.8, 7.9, 7.11, 7.12, 7.13, 7.14, 7.6b | already on the credential, or no Supabase call of their own | unchanged |

**8.3** holds no literal, but its four Supabase nodes authenticate with
`$env.SUPABASE_SERVICE_ROLE_KEY`. That names the key that was deleted, and expression-level env
access is blocked by default on n8n Cloud, so those nodes were likely never authenticating. It is
on the measurement side, which someone else owns, so it has been reported rather than changed.
**8.1 and 8.2** are not exposed over MCP and could not be inspected.

**The rule this enforces.** A Code node cannot hold an n8n credential, so any Supabase call
written inside one can only authenticate with a literal. Supabase I/O therefore belongs in HTTP
Request nodes, and Code nodes stay pure transforms. Where that would have meant three round
trips, an RPC collapses them into one.

**Where 7.6 went.** 7.6 held the key in four Code nodes and could not be repaired without
rebuilding it, and 7.6b already does the same job with publish gates in front of the write. Both
7.5 branches now chain to 7.6b; 7.6 is renamed and marked deprecated so nothing wires back to it.

---

## What the first live 7.14 run showed

Run against `isanextgenmaterials.com/compliance/certifications`. It completed and saved a bundle:
3 verified links, 4 FAQ pairs, `FAQPage` and `speakable` emitted together with the block, correct
breadcrumbs, no em dashes. All three verifications fired for real: one link was dropped for an
anchor not present in the copy, and the grounding judge removed one FAQ answer it could not
support. So the gates work.

Four problems the run exposed, none of them fixed yet:

1. **Soft 404s defeat the source check.** That URL does not exist. The site served its *homepage*
   with HTTP 200, so the new status check passed and the whole augmentation describes the
   homepage while being addressed to a compliance page. A status code is not enough; the check
   needs to compare the returned canonical or title against the requested path.
2. **The anchor verifier does not decode HTML entities.** `Awards & Certifications` was dropped as
   "not present in the page" when the page contains `Awards &amp; Certifications`. Real anchors
   are being discarded.
3. **Nothing checks that an anchor is topically related to its target.** The run linked the
   phrase `Macau Headquarters (MIT)` to a page about certifications. Verbatim-in-page and
   on-allowlist both passed; relevance was never asked about.
4. **FAQ answers can describe the page instead of answering.** One answer began "The page lists
   facilities including...". That is meta-commentary, not an answer a buyer or an engine wants.

**`sitemap_urls` for that org contains URLs that do not resolve.** Two of two sampled were dead,
one hard 404 and one soft. Worth an audit before anything runs in bulk against that list.

---

## Outstanding

- The four items above.
- 7.13 is not yet wired as an automatic pre-step. Call it directly, or add a branch in 7.6b that
  fires it when the page type or question matches regulatory or standards language.
- 8.3 authenticates with `$env.SUPABASE_SERVICE_ROLE_KEY`; 8.1 and 8.2 are not inspectable over
  MCP. All three belong to the measurement side.
- **7.9 selects every `strategy_pages` row in every org** with no org filter and no limit, then
  regenerates each stale one weekly. Nothing here changed that; it is worth a look before the
  next Monday run.
