# Research Engine — Provider Matrix

Status as of this build. "Configured" reflects only env-variable presence in
the runtime environment this was built in — it will differ per-deploy based
on which Vercel env vars the Commander has actually set. "Implemented" is a
property of the code, not the environment.

**READY** = implemented, and its required env is present in this environment.
**DEGRADED** = implemented, but a live call returned a non-2xx / partial result during testing.
**BLOCKED** = a required credential/endpoint/permission problem prevents implementation.
**NOT YET IMPLEMENTED** = registered (env-detection works) but no adapter exists yet — honest, not a failure.

**"Unit tested" below means**: an adapter-specific mocked-fetch test exists in
`lib/research-engine/diagnostics/validation.ts` (checks `re_42`–`re_99`) that
invokes the real exported adapter's `run()` — not just a shared utility
function — with a mocked HTTP response and asserts on the normalized output
shape (provider id, title/entity identity, canonical/source URL,
`retrievedAt`/provenance, bounded result count) plus at least one malformed-
or upstream-error case. It is **static/mocked coverage, not live
verification** — see the Terminology section of
`RESEARCH_ENGINE_ARCHITECTURE.md` for the full set of distinctions this repo
uses, and `RESEARCH_ENGINE_RUNBOOK.md` for how to run an explicit, manual
live check against the real upstream API.

| Provider | Category | Env (required) | Implemented | Unit tested | Status | Notes |
|---|---|---|---|---|---|---|
| Exa | general_web | `EXA_API_KEY` | Yes | Yes (`re_44`, `re_45`) | READY* | POST /search with content snippets. Capability: `search` only — no `getById`. |
| GitHub | code | `GITHUB_TOKEN` | Yes | Yes (`re_42`, `re_43`) | READY* | Repo search only this phase (`GET /search/repositories`); no code/issue/PR/commit/release search. Capability: `search` only. |
| SAM.gov | government_contracts | `SAM_GOV_API_KEY` | Yes | Yes (`re_205`–`re_214`, `re_340`–`re_347`, `re_395`–`re_398`, mocked) | READY* — MOCK-VALIDATED, NOT LIVE-VERIFIED | GET /opportunities/v2/search only. `postedFrom`/`postedTo` mandatory per docs, default bounded 90-day window. Repair pass: invalid dates, a reversed range, and a range over 365 days are all rejected outright (`re_340`–`re_347`) — never silently corrected/swapped/clamped. `api_key` is a required query param (no header alternative documented); redacted from logs. `active`/set-aside never fabricated when absent. A separate, revenue-focused SAM.gov adapter already exists at `lib/opportunity-agents/sources` — different purpose, not reused here. |
| FMCSA | transportation | `FMCSA_WEB_KEY` | No | — | BLOCKED — MISSING AUTHORITATIVE CONTRACT | Official docs confirm host/auth/field names but never document the response envelope (bare vs. `content`-wrapped vs. array); no test credential available in this runtime to resolve via a controlled live probe. See `docs/RESEARCH_REMAINING_15_BUILD_REPORT.md`. |
| NCBI / PubMed | scholarly | none required (`NCBI_API_KEY` optional) | Yes | Yes (`re_46`, `re_47`) | READY | ESearch+ESummary (JSON) + EFetch (XML) for top result's abstract, behind one search call. Capability: `search` only — `getById`/`related` are not independently callable. |
| FRED | economics | `FRED_API_KEY` | Yes | Yes (`re_48`, `re_49`) | READY* | Series search + observations for the top match, both produced by one call. Capabilities `search`+`timeSeries` describe the two output shapes, not two dispatched operations. |
| Semantic Scholar | scholarly | none (optional key) | Yes | Yes (`re_147`–`re_156`, `re_365`–`re_374`, `re_375`–`re_378`, mocked) | READY | GET /graph/v1/paper/search only (never `/paper/search/bulk`). Works unauthenticated at a shared, lower rate limit; optional key sent via `x-api-key` header. No citations/references/PDF fields requested. Repair pass: `paperId` is mandatory (never falls back to title), `authors` only iterated after an `Array.isArray` guard, `url` only trusted as `canonicalUrl` on the exact `www.semanticscholar.org` origin (`re_365`–`re_374`). Capability: `search` only. |
| arXiv | scholarly | none (`ARXIV_API_BASE_URL` optional) | Yes | Yes (`re_50`, `re_51`) | READY | Atom/XML, throttled to ~1 request/3s. Capability: `search` only. |
| Crossref | scholarly | none (mailto/UA optional) | Yes | Yes (`re_52`, `re_53`) | READY | Works without `CROSSREF_MAILTO`, at reduced priority. Capability: `search` only — no DOI getById lookup. |
| NASA Open APIs | space_earth | `NASA_API_KEY` | Yes | Yes (`re_215`–`re_224`, `re_399`–`re_402`, mocked) | READY* — MOCK-VALIDATED, NOT LIVE-VERIFIED | GET /neo/rest/v1/feed (NeoWs) only — one narrow capability, not a generic NASA proxy, not a duplicate of `nasa_gibs`. Date range clamped server-side to the documented ≤7-day maximum regardless of caller input. No image/file download. |
| NASA GIBS (Earth Imagery) | space_earth | `NASA_GIBS_WMTS_BASE_URL` | Yes (pre-existing) | Yes (`re_65`, `re_66`; also pre-existing `lib/earth-intelligence/validation.ts`) | READY* | Reused via `lib/earth-intelligence/*`, not rebuilt. `mapLayers` means "lists curated layers as documents" — it does not fetch or render a live tile. No network call at all. |
| USPTO Open Data Portal | patents | `USPTO_API_KEY` | No | — | BLOCKED — DOCUMENTATION CONFLICT | ODP presents a family of separate per-product APIs, each with its own OpenAPI doc this session could not confirm is current; the legacy PatentsView API's migration status is unclear from official pages reviewed. See build report. |
| CourtListener | legal | `COURTLISTENER_API_TOKEN` | Yes | Yes (`re_157`–`re_166`, `re_357`–`re_364`, `re_379`–`re_382`, mocked) | READY* — MOCK-VALIDATED, NOT LIVE-VERIFIED | REST API v4 GET /search/?type=o (case-law opinion clusters) only. Token required per official docs. Repair pass: `canonicalUrl` resolved via `new URL(relativePath, trustedOrigin)` and post-validated (not naive string concatenation) — a result with an unsafe/off-host `absolute_url` is skipped (`re_357`–`re_364`). Capability: `search` only. |
| Internet Archive | web_archive | `INTERNET_ARCHIVE_USER_AGENT_BASE` | Yes | Yes (`re_167`–`re_176`, `re_348`–`re_356`, `re_383`–`re_386`, mocked) | READY | GET /advancedsearch.php with a fixed allowlisted field list only — no unrestricted advanced-search passthrough. Repair pass: caller text is escaped and wrapped as a literal-only Solr/Lucene phrase before being placed in `q`, so field selectors/boolean operators/wildcards/range syntax in caller text can never be interpreted as query syntax (`re_348`–`re_356`). Capability: `search` only. |
| Wayback Machine | web_archive | none required | Yes | Yes (`re_177`–`re_193`, `re_232`–`re_276`, `re_322`, `re_324`–`re_327`, `re_332`–`re_335`, `re_387`–`re_390`, mocked) | READY | CDX Server API only (GET /cdx/search/cdx); Availability API deliberately not used (different host). Query text is the target URL, SSRF-validated, never fetched. Repair pass: the SSRF target-URL validator now also rejects IPv4-mapped IPv6 literals in their WHATWG-normalized compressed-hex form (`::ffff:7f00:1`, not just dotted-decimal `::ffff:127.0.0.1`) — see `RESEARCH_ENGINE_SECURITY.md`; regression matrix expanded to `re_232`–`re_276`. Micro-repair: an explicit nonstandard target port (e.g. `:8443`) is rejected, not accepted (`re_322`, `re_324`–`re_327`); a no-port URL or explicit default port (`:443`) remains allowed (`re_332`–`re_335`). Capability: `historicalCaptures` only — no `compareCaptures`. |
| World Bank Indicators | global_development | none required | Yes | Yes (`re_54`–`re_58`, five cases: multi-observation normalize, bounded count, honest empty, documented API error, malformed shape) | READY | Two-array response shape handled; `mrnev=1` removed so a real time series (not just the single most-recent value) is returned; query = `CODE` or `CODE for COUNTRY` |
| World Bank Data Catalog | global_development | none required | No | — | BLOCKED — MISSING AUTHORITATIVE CONTRACT | No documentation prose page distinct from the live DDH operational API surface could be located within the URL-safety rules. See build report. |
| World Bank Projects | global_development | none required | No | — | BLOCKED — DOCUMENTATION CONFLICT | Unresolved v2/v3 API generation conflict, re-confirmed this build phase (not newly live-derived). See build report. |
| World Bank Finances | global_development | none required | No | — | BLOCKED — MISSING AUTHORITATIVE CONTRACT | Socrata-based; no official page names a single stable current dataset id — guessing one would be a fabricated endpoint. See build report. |
| World Bank Climate | climate_environment | none required | No | — | BLOCKED — DOCUMENTATION CONFLICT | Two distinct allowlisted hosts exist for this provider; this session could not confirm either currently exposes a stable, non-deprecated query API. See build report. |
| IMF SDMX | economics | `IMF_API_SUBSCRIPTION_KEY` | No | — | BLOCKED — MISSING AUTHORITATIVE CONTRACT | Two documented SDMX API generations exist (legacy `dataservices.imf.org`, newer `api.imf.org`); no single current dataflow id/key structure could be confirmed without live catalog probing. Subscription key must go in `Ocp-Apim-Subscription-Key` header, never a query param, whenever this is implemented. See build report. |
| USGS Water Data | hydrology_hazards | none required (`USGS_WATER_API_KEY` optional) | Yes | Yes (`re_67`–`re_79`, plus repair coverage `re_125`–`re_129`, eighteen cases total) | READY | OGC API v0, `daily` collection only. Public read is unauthenticated; the optional key raises rate limits and is sent only via `X-Api-Key`, never a query param. Query text must carry an explicit site number (`site <8-15 digits>`); optional `parameter <code>` / `statistic <id>` filters. Capabilities: `timeSeries`+`geoSearch` (one query, two output views). `geoFeatures` coordinates are validated (finite, in-range) before use; malformed geometry never blocks the underlying observation. |
| USGS Earthquake Catalog | hydrology_hazards | none required | Yes | Yes (`re_59`, `re_60`) | READY | Public, unauthenticated GeoJSON. Capabilities: `search`+`geoSearch` (one query, two output views) — no distinct getById-by-event-id. |
| USGS Real-Time Earthquake Feeds | hydrology_hazards | none required | Yes | Yes (`re_80`–`re_88`, plus repair coverage `re_113`–`re_119`, sixteen cases total) | READY | Public, unauthenticated. Fixed path template only (`/summary/{magnitude}_{period}.geojson`); magnitude/period drawn exclusively from documented allowlists, arbitrary text falls back to the conservative default (`4.5`/`day`). Fetch-on-request only — one upstream call per uncached run, never background-polled. Capability: `list` only. Unparseable JSON or a non-array `features` field is rejected as `parse_error`, never fabricated into an empty success; `geoFeatures` coordinates are validated (finite, in-range) before use. |
| USGS National Map | geospatial | none required | No | — | BLOCKED — MISSING AUTHORITATIVE CONTRACT | Official docs page is an unreadable client-rendered Swagger shell; official PDF returned 403; two budgeted controlled live probes both timed out (504). See `docs/RESEARCH_CONTROLLED_PROBE_LOG.md` and the build report. |
| USGS ScienceBase | geospatial | none required | Yes | Yes (`re_89`–`re_99`, plus repair coverage `re_120`–`re_124`, sixteen cases total) | READY | Public, unauthenticated read-only catalog. `run()` dispatches to `/item/{id}` only when the whole query text is a validated 24-hex-char item id, else to a bounded `/items/` search; next-links are never auto-followed and no attachment/resource URL is ever fetched. Capabilities: `search`+`getById`, both actually dispatched (not just declared). Search-mode unparseable JSON or a non-array `items` field is rejected as `parse_error`, never fabricated into an empty success (matching `getById`'s existing behavior). |
| Library of Congress | cultural_heritage | none required | Yes | Yes (`re_61`, `re_62`) | READY | Global JSON search only. Capability: `search` only — no getById. |
| Wikidata | knowledge_graph | `WIKIMEDIA_USER_AGENT_BASE` | Yes | Yes (`re_63`, `re_64`) | READY* | Action API search + entity labels/descriptions/aliases, both behind one search call; no SPARQL exposed. Capability: `search` only — entity enrichment is not an independently callable getById. |
| Common Crawl | web_archive | `COMMON_CRAWL_USER_AGENT_BASE`, `COMMON_CRAWL_COLLECTION_ID` | Yes | Yes (`re_194`–`re_204`, `re_277`–`re_321`, `re_323`, `re_328`–`re_331`, `re_336`–`re_339`, `re_391`–`re_394`, mocked) | READY | CDX-compatible Index Server API GET /{collectionId}-index only. `COMMON_CRAWL_COLLECTION_ID` is a new required Commander-set env var — this build does not auto-discover "the current" crawl id (would require a disallowed live `collinfo.json` fetch). No WARC retrieval — filename/offset/length pointers never read into output. Repair pass: shares the same expanded SSRF target-URL regression matrix as Wayback (`re_277`–`re_321`) — see `RESEARCH_ENGINE_SECURITY.md`. Micro-repair: an explicit nonstandard target port (e.g. `:8443`) is rejected, not accepted (`re_323`, `re_328`–`re_331`); a no-port URL or explicit default port (`:443`) remains allowed (`re_336`–`re_339`). Capability: `historicalCaptures` only (bounded URL lookup, no free-text search). |

`*` = READY pending the actual credential being present in the deployed
environment; code path is complete and unit-tested against mocked responses
(see the `re_NN` check ids above, in
`lib/research-engine/diagnostics/validation.ts`), but no live call was made
during this build (see `RESEARCH_ENGINE_RUNBOOK.md` for how to run an
explicit, manual live check).

## Summary

- **21 of 29 implemented**: the original 14 (Exa, GitHub, NCBI/PubMed, FRED,
  arXiv, Crossref, NASA GIBS (reused), World Bank Indicators, USGS
  Earthquake Catalog, Library of Congress, Wikidata, USGS Water Data, USGS
  Real-Time Earthquake Feeds, USGS ScienceBase) plus **7 added in the
  "Remaining 15" build phase**: Semantic Scholar, CourtListener, Internet
  Archive, Wayback Machine, Common Crawl, SAM.gov, NASA Open APIs (NeoWs
  feed only). See `docs/RESEARCH_REMAINING_15_BUILD_REPORT.md` for the full
  per-provider contract proof, controlled-verification status, and
  classification for each.
- **8 of 29 registered but not implemented, each with a documented
  blocker**: FMCSA (response envelope undocumented), USPTO (per-product API
  family, current path unclear), USGS National Map (docs unreadable, PDF
  403, two controlled live probes timed out), World Bank Data Catalog,
  World Bank Projects (pre-existing v2/v3 conflict, re-confirmed not
  newly live-derived), World Bank Finances, World Bank Climate, IMF SDMX.
  Full blocker text for each is in `docs/RESEARCH_REMAINING_15_BUILD_REPORT.md`.
- **All 21 implemented adapters have adapter-specific mocked tests**
  (`re_42`–`re_99` for the original 14, `re_147`–`re_224` for the 7 added
  this phase, in `diagnostics/validation.ts`) that invoke the real exported
  adapter, not just shared utilities. A subsequent narrow repair pass
  expanded behavioral coverage for the 7 Remaining-15 adapters specifically
  — SSRF regression (`re_232`–`re_339`, which includes the explicit
  nonstandard-target-port rejection matrix at `re_322`–`re_339` — an
  explicit nonstandard port such as `:8443` is rejected for both `wayback`
  and `common_crawl`, while a no-port URL or an explicit *default* port
  (`:443`/`:80`, which the WHATWG `URL` parser normalizes to empty) remains
  allowed), SAM.gov date-range validation (`re_340`–`re_347`), Internet
  Archive literal-query encoding (`re_348`–`re_356`), CourtListener
  canonical-URL hardening (`re_357`–`re_364`), Semantic Scholar item
  hardening (`re_365`–`re_374`), and HTTP 401/403/429/503 coverage for all 7
  (`re_375`–`re_402`) — bringing the total validation harness to 405 checks
  (`re_225`, the source-text `.run(` occurrence count, is a structural
  sanity check only, not a measure of this behavioral coverage — see
  `RESEARCH_ENGINE_SECURITY.md`).
- **Controlled live schema verification** (Commander amendment, this
  phase): two bounded, logged, GET-only probes were made against
  `usgs_national_map` (both timed out, no data obtained); one **pre-amendment
  unauthorized** probe against the same provider is quarantined and was not
  used as evidence. No other live provider call occurred in this phase. See
  `docs/RESEARCH_CONTROLLED_PROBE_LOG.md` for the complete, auditable list.
- **Batch 1A Repair** (malformed-response handling + test-completeness gaps
  an independent audit found): `re_113`–`re_129` fix and cover two
  correctness defects (`usgsEarthquakeFeed.ts` and `usgsScienceBase.ts`
  search mode both previously turned an unparseable/malformed response into
  a fabricated `ok:true` empty success instead of `parse_error`) plus
  coordinate-validation hardening across all three Batch 1A adapters. See
  `RESEARCH_ENGINE_ARCHITECTURE.md`'s "Batch 1A Repair" section. No live
  provider call occurred during this repair either.
- **Batch 1A Final Micro-Repair** (response-shape fail-closed validation): a
  second, independent audit found `usgsWater.ts` had the same class of
  defect the Batch 1A Repair above missed — it did not validate the parsed
  response shape before slicing `features`, risking either a fabricated
  empty success or an unhandled `TypeError` on a malformed body. It was also
  found that `usgsEarthquakeFeed.ts` and `usgsScienceBase.ts` search mode
  both treated a *missing* collection field as an honest empty result on an
  unverifiable contract assumption. `re_130`–`re_146` fix and cover: strict
  object/array shape validation for `usgsWater.ts`'s `features`, and
  fail-closed (`parse_error`) handling of missing/`null`/non-array
  `features`/`items` in the other two — an explicit `[]` remains the only
  honest empty result. See `RESEARCH_ENGINE_ARCHITECTURE.md`'s "Batch 1A
  Final Micro-Repair" section. No live provider call occurred during this
  repair either. Total validation checks: 149 (132 pre-existing + 17 new),
  all mocked.
- No provider's *documents/search results* were live-verified in this build
  phase — every "Yes" in "Unit tested" above means mocked-fetch coverage
  only. The two `usgs_national_map` controlled probes verified only
  connectivity/response structure (and both failed with a timeout), never
  document content, per the Terminology section of
  `RESEARCH_ENGINE_ARCHITECTURE.md` and the "MOCK-VALIDATED, NOT
  LIVE-VERIFIED" label used above.

Every one of the 29 — implemented or not — reports an accurate,
non-fabricated configuration status (`configured` / `unavailable` / `pending`
— there is no `disabled` status; no disable mechanism exists in this build)
via `GET /api/research/providers`.
