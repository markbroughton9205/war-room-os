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
| SAM.gov | government_contracts | `SAM_GOV_API_KEY` | No | — | NOT YET IMPLEMENTED | A separate, revenue-focused SAM.gov adapter already exists at `lib/opportunity-agents/sources` — different purpose, not reused here |
| FMCSA | transportation | `FMCSA_WEB_KEY` | No | — | NOT YET IMPLEMENTED | |
| NCBI / PubMed | scholarly | none required (`NCBI_API_KEY` optional) | Yes | Yes (`re_46`, `re_47`) | READY | ESearch+ESummary (JSON) + EFetch (XML) for top result's abstract, behind one search call. Capability: `search` only — `getById`/`related` are not independently callable. |
| FRED | economics | `FRED_API_KEY` | Yes | Yes (`re_48`, `re_49`) | READY* | Series search + observations for the top match, both produced by one call. Capabilities `search`+`timeSeries` describe the two output shapes, not two dispatched operations. |
| Semantic Scholar | scholarly | none (optional key) | No | — | NOT YET IMPLEMENTED (pending by design) | Marked `pending`, never retried in a loop when unauthenticated |
| arXiv | scholarly | none (`ARXIV_API_BASE_URL` optional) | Yes | Yes (`re_50`, `re_51`) | READY | Atom/XML, throttled to ~1 request/3s. Capability: `search` only. |
| Crossref | scholarly | none (mailto/UA optional) | Yes | Yes (`re_52`, `re_53`) | READY | Works without `CROSSREF_MAILTO`, at reduced priority. Capability: `search` only — no DOI getById lookup. |
| NASA Open APIs | space_earth | `NASA_API_KEY` | No | — | NOT YET IMPLEMENTED | Verify current NeoWs/other endpoint availability before implementing |
| NASA GIBS (Earth Imagery) | space_earth | `NASA_GIBS_WMTS_BASE_URL` | Yes (pre-existing) | Yes (`re_65`, `re_66`; also pre-existing `lib/earth-intelligence/validation.ts`) | READY* | Reused via `lib/earth-intelligence/*`, not rebuilt. `mapLayers` means "lists curated layers as documents" — it does not fetch or render a live tile. No network call at all. |
| USPTO Open Data Portal | patents | `USPTO_API_KEY` | No | — | BLOCKED (needs endpoint verification) | Verify current ODP OpenAPI spec before implementing |
| CourtListener | legal | `COURTLISTENER_API_TOKEN` | No | — | NOT YET IMPLEMENTED | |
| Internet Archive | web_archive | `INTERNET_ARCHIVE_USER_AGENT_BASE` | No | — | NOT YET IMPLEMENTED | |
| Wayback Machine | web_archive | none required | No | — | NOT YET IMPLEMENTED | |
| World Bank Indicators | global_development | none required | Yes | Yes (`re_54`–`re_58`, five cases: multi-observation normalize, bounded count, honest empty, documented API error, malformed shape) | READY | Two-array response shape handled; `mrnev=1` removed so a real time series (not just the single most-recent value) is returned; query = `CODE` or `CODE for COUNTRY` |
| World Bank Data Catalog | global_development | none required | No | — | NOT YET IMPLEMENTED | |
| World Bank Projects | global_development | none required | No | — | NOT YET IMPLEMENTED | |
| World Bank Finances | global_development | none required | No | — | NOT YET IMPLEMENTED | |
| World Bank Climate | climate_environment | none required | No | — | NOT YET IMPLEMENTED | |
| IMF SDMX | economics | `IMF_API_SUBSCRIPTION_KEY` | No | — | NOT YET IMPLEMENTED | Subscription key must go in `Ocp-Apim-Subscription-Key` header, never a query param — documented for the next implementer |
| USGS Water Data | hydrology_hazards | none required (`USGS_WATER_API_KEY` optional) | Yes | Yes (`re_67`–`re_79`, plus repair coverage `re_125`–`re_129`, eighteen cases total) | READY | OGC API v0, `daily` collection only. Public read is unauthenticated; the optional key raises rate limits and is sent only via `X-Api-Key`, never a query param. Query text must carry an explicit site number (`site <8-15 digits>`); optional `parameter <code>` / `statistic <id>` filters. Capabilities: `timeSeries`+`geoSearch` (one query, two output views). `geoFeatures` coordinates are validated (finite, in-range) before use; malformed geometry never blocks the underlying observation. |
| USGS Earthquake Catalog | hydrology_hazards | none required | Yes | Yes (`re_59`, `re_60`) | READY | Public, unauthenticated GeoJSON. Capabilities: `search`+`geoSearch` (one query, two output views) — no distinct getById-by-event-id. |
| USGS Real-Time Earthquake Feeds | hydrology_hazards | none required | Yes | Yes (`re_80`–`re_88`, plus repair coverage `re_113`–`re_119`, sixteen cases total) | READY | Public, unauthenticated. Fixed path template only (`/summary/{magnitude}_{period}.geojson`); magnitude/period drawn exclusively from documented allowlists, arbitrary text falls back to the conservative default (`4.5`/`day`). Fetch-on-request only — one upstream call per uncached run, never background-polled. Capability: `list` only. Unparseable JSON or a non-array `features` field is rejected as `parse_error`, never fabricated into an empty success; `geoFeatures` coordinates are validated (finite, in-range) before use. |
| USGS National Map | geospatial | none required | No | — | NOT YET IMPLEMENTED | |
| USGS ScienceBase | geospatial | none required | Yes | Yes (`re_89`–`re_99`, plus repair coverage `re_120`–`re_124`, sixteen cases total) | READY | Public, unauthenticated read-only catalog. `run()` dispatches to `/item/{id}` only when the whole query text is a validated 24-hex-char item id, else to a bounded `/items/` search; next-links are never auto-followed and no attachment/resource URL is ever fetched. Capabilities: `search`+`getById`, both actually dispatched (not just declared). Search-mode unparseable JSON or a non-array `items` field is rejected as `parse_error`, never fabricated into an empty success (matching `getById`'s existing behavior). |
| Library of Congress | cultural_heritage | none required | Yes | Yes (`re_61`, `re_62`) | READY | Global JSON search only. Capability: `search` only — no getById. |
| Wikidata | knowledge_graph | `WIKIMEDIA_USER_AGENT_BASE` | Yes | Yes (`re_63`, `re_64`) | READY* | Action API search + entity labels/descriptions/aliases, both behind one search call; no SPARQL exposed. Capability: `search` only — entity enrichment is not an independently callable getById. |
| Common Crawl | web_archive | `COMMON_CRAWL_USER_AGENT_BASE` | No | — | NOT YET IMPLEMENTED | |

`*` = READY pending the actual credential being present in the deployed
environment; code path is complete and unit-tested against mocked responses
(see the `re_NN` check ids above, in
`lib/research-engine/diagnostics/validation.ts`), but no live call was made
during this build (see `RESEARCH_ENGINE_RUNBOOK.md` for how to run an
explicit, manual live check).

## Summary

- **14 of 29 implemented**: Exa, GitHub, NCBI/PubMed, FRED, arXiv, Crossref,
  NASA GIBS (reused), World Bank Indicators, USGS Earthquake Catalog,
  Library of Congress, Wikidata, **USGS Water Data, USGS Real-Time
  Earthquake Feeds, USGS ScienceBase** (the three Batch 1A providers added
  this build; only these three were authorized for this build phase).
- **15 of 29 registered but not implemented**: SAM.gov, FMCSA, Semantic
  Scholar (pending by design), NASA (general), USPTO, CourtListener,
  Internet Archive, Wayback Machine, World Bank Data Catalog, World Bank
  Projects, World Bank Finances, World Bank Climate, IMF SDMX, USGS National
  Map, Common Crawl. World Bank Projects specifically remains unimplemented
  due to a v2/v3 API documentation conflict that was not resolved in this
  build phase.
- **All 14 implemented adapters now have adapter-specific mocked tests**
  (`re_42`–`re_99` in `diagnostics/validation.ts`) that invoke the real
  exported adapter, not just shared utilities.
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
- No provider was live-verified in this build phase — every "Yes" in "Unit
  tested" above means mocked-fetch coverage only, per the Terminology section
  of `RESEARCH_ENGINE_ARCHITECTURE.md`.

Every one of the 29 — implemented or not — reports an accurate,
non-fabricated configuration status (`configured` / `unavailable` / `pending`
— there is no `disabled` status; no disable mechanism exists in this build)
via `GET /api/research/providers`.
