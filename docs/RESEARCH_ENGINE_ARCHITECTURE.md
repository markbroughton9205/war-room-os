# Research Engine — Architecture

Status: **Phase 0 (foundation) complete. 22 of 29 providers implemented as of
the "Blocked Provider 1 of 8" (FMCSA) build phase; 7 remain honestly
`implemented: false` with a documented blocker each.** This is a staged
build — see `RESEARCH_PROVIDER_MATRIX.md` for exactly which providers are
implemented today, `docs/RESEARCH_REMAINING_15_BUILD_REPORT.md` and
`docs/RESEARCH_FMCSA_BUILD_REPORT.md` for the full contract proof and
blocker text behind the most recent build phases, `docs/RESEARCH_CONTROLLED_PROBE_LOG.md`
for the auditable list of every live provider request made during those
phases, and `RESEARCH_ENGINE_RUNBOOK.md` for how to add the rest.

## Terminology

These docs use the following terms precisely and do not use them
interchangeably:

- **Registered provider ID** — a `ResearchProviderId` with a descriptor in
  `config/providerEnv.ts::RESEARCH_PROVIDER_ENV`. All 29 spec providers are
  registered; registration alone makes configuration status visible but
  calls no adapter.
- **Implemented adapter** — a registered provider with a real
  `ResearchProviderAdapter` in `providers/registry.ts::IMPLEMENTED_PROVIDER_ADAPTERS`
  (22 of 29 today).
- **Adapter-specific mocked test** — a test in `diagnostics/validation.ts`
  that invokes a specific implemented adapter's real `run()` against a
  mocked `fetch` and asserts on its normalized output (checks `re_42`–`re_99`).
  This is what `RESEARCH_PROVIDER_MATRIX.md`'s "Unit tested" column means.
- **Shared-infrastructure validation** — a test in `diagnostics/validation.ts`
  that exercises a cross-cutting module (redaction, host allowlist, dedupe,
  routing, safe fetch) rather than one specific adapter (e.g. `re_04`–`re_22`).
- **Configured provider** — `providerConfigStatus()` returns `configured`:
  required env is present (or not required) **and** an adapter is
  implemented. Env-presence only, never a live call.
- **Unconfigured provider** — `providerConfigStatus()` returns `unavailable`
  (required env missing) or `pending` (no adapter yet, or optional-by-design
  and unset). There is no `disabled` status — no disable mechanism exists in
  this build.
- **Static validation** — anything `pnpm run validate:research-engine`,
  `tsc --noEmit`, or `eslint` proves: code shape, mocked-response handling,
  redaction, auth gating. Provably true without a network call.
- **Independent static audit** — a manual/external review of this same code
  (e.g. the review that produced this repair assignment) — not a script, not
  reproducible by re-running the validation harness.
- **Live verification** — an actual network call to a real upstream provider
  with real credentials returning a real response. **Has not occurred for
  any provider in this build.** See `RESEARCH_ENGINE_RUNBOOK.md` for the
  explicit, manual, Commander-triggered health-check path that would produce
  this.
- **UI integration** — a Research Console page rendering these results.
  **Does not exist.**
- **Council integration** — the multi-LLM Council (`lib/council*`) calling
  the Research Engine as a tool. **Does not exist.**
- **Durable workflow execution** — a workflow engine (LangGraph, Inngest,
  Workflow DevKit, or similar) orchestrating multi-step research runs with
  persistence/retry across process restarts. **Does not exist**; every
  request here is a single in-process `executeResearch()` call.

## What this is

A server-only, read-only, Commander-gated intelligence-gathering layer under
`lib/research-engine/` and `app/api/research/*`. It queries public/government
data providers (GitHub, arXiv, Crossref, FRED, USGS Earthquake Catalog/Water
Data/Real-Time Earthquake Feeds/ScienceBase, World Bank Indicators, Wikidata,
NCBI/PubMed, Exa, Library of Congress, NASA GIBS, Semantic Scholar,
CourtListener, Internet Archive, Wayback Machine, Common Crawl, SAM.gov, and
NASA Open APIs (NeoWs) today; 8 more registered but not yet implemented, each
with a documented blocker — see `docs/RESEARCH_REMAINING_15_BUILD_REPORT.md`),
normalizes their responses into one schema, and returns evidence with
citations. It never writes to any provider, never executes actions, and is
never reachable by an unauthenticated caller.

## Directory layout

```
lib/research-engine/
  core/types.ts            Shared types (ResearchDocument, ResearchQuery, ...)
  core/execute.ts           Orchestrates route -> call adapters -> dedupe -> cite
  config/providerEnv.ts     Env-presence registry for all 29 providers (server-only)
  security/hostAllowlist.ts Per-provider official-host allowlist
  security/safeFetch.ts     The one shared HTTP client every adapter must use
  security/xmlLite.ts       Dependency-free Atom/XML text extraction (no XXE surface)
  security/redact.ts        Secret redaction for URLs/error text
  security/providerGate.ts  Per-provider concurrency limit + failure cooldown
  cache/ttlCache.ts         In-memory TTL cache (no new DB/Redis)
  providers/adapter.ts      The adapter contract every provider implements
  providers/<name>.ts       One file per implemented provider
  providers/registry.ts     Maps provider id -> implemented adapter (or absent)
  routing/router.ts         Intent -> candidate providers -> configured+implemented subset
  normalization/dedupe.ts   Cross-provider deduplication by strongest identifier
  citations/citations.ts    Builds a citation strictly from fields already on the document
  diagnostics/audit.ts      Safe (redacted) audit-event logging
  diagnostics/validation.ts Hand-rolled test harness (this repo has no Jest/Vitest)

app/api/research/
  providers/route.ts                 GET  — env-presence status for all 29 providers
  providers/[provider]/health/route.ts GET  — explicit, cached live health check
  search/route.ts                    POST — multi-provider search
```

## Request flow

1. `POST /api/research/search` — Commander session required, body validated
   (bounded query length, known intent enum, known provider ids only, bounded
   `maxResults`).
2. `routeResearchQuery` (routing/router.ts) maps the request's intent (or
   explicit provider list) to a candidate provider list per the spec's
   routing table, then narrows to providers that are both **configured**
   (required env present) and **implemented** (an adapter exists). Every
   rejected provider carries a reason.
3. `executeResearch` (core/execute.ts) calls every selected adapter's `run()`
   concurrently via `Promise.all`. A single adapter throwing or returning
   `ok:false` never aborts the request — its failure becomes one
   `ResearchProviderResponse` with `ok:false`, and the rest proceed normally.
   This is the "fails partially and honestly" requirement from the spec.
4. Documents from every provider are merged, citations attached
   (`citations/citations.ts`), deduplicated by the strongest shared
   identifier (`normalization/dedupe.ts`), and capped to the request's
   `maxResults`.
5. A safe audit event is logged (`diagnostics/audit.ts`) — provider(s),
   redacted query hash, duration, result count, outcome. No raw query text
   or secret ever appears in the log line.

## Adapter contract

```ts
type ResearchProviderAdapter = {
  id: ResearchProviderId
  run: (query: ResearchQuery) => Promise<ResearchProviderResponse>
  healthCheck: () => Promise<ResearchHealthStatus>
}
```

`run` is capability-agnostic on purpose: an adapter decides internally
whether a query is a text search, a time-series lookup, or a geo query based
on its own declared capabilities in `config/providerEnv.ts`. Callers (the
router, the API routes) never need provider-specific method names.

Every adapter:
- Calls `safeProviderFetch` (never raw `fetch`) for every upstream request.
- Checks its own required env via `providerEnvDescriptor`/`isProviderEnvSatisfied`
  before doing any network I/O, returning `notConfiguredResponse` if absent.
- Wraps its network path in `withProviderGate` (concurrency limit + failure
  cooldown).
- Builds `ResearchDocument`s via `providers/shared.ts::makeDocument`, which
  fills in `retrievedAt`/`provenance`/defaults consistently.
- Never assigns `identifiers.doi`, `.pmid`, `.arxiv_id`, etc. unless the
  provider's own response actually supplied that value.

## NASA GIBS

NASA GIBS (spec item #11, Earth imagery) was **already implemented** before
this build, at `lib/earth-intelligence/*`, reviewed and shipped
(`feat(earth-intelligence): add reviewed NASA GIBS map`). This build does
**not** duplicate it. `lib/research-engine/providers/nasaGibs.ts` is a thin
wrapper that lists the existing curated layer registry
(`GIBS_LAYERS`) as research documents and calls the existing
`getGibsServerConfigStatus()` for health — actual tile URLs still come from
`lib/earth-intelligence/gibsTileUrl.ts`, unchanged.

## Batch 1A: USGS Water Data, Real-Time Earthquake Feeds, ScienceBase

Three providers were added under a controls-compliant, documentation-only
build phase (no live provider calls, no health/schema/catalog probing):

- **USGS Water Data** (`providers/usgsWater.ts`) — OGC API v0, `daily`
  collection only. `USGS_WATER_API_KEY` was corrected from `requiredEnv` to
  `optionalEnv`: the provider is public and reports `configured` with no key
  set; when present, the key is sent only via the `X-Api-Key` header, never
  a query param or cache key. Query text must carry an explicit
  monitoring-location site number (`site <8-15 digits>`); arbitrary free
  text is rejected rather than issuing an unbounded query. Null/missing
  observation values are preserved as `null`, never coerced to `0`.
- **USGS Real-Time Earthquake Feeds** (`providers/usgsEarthquakeFeed.ts`) —
  fixed path template only (`/summary/{magnitude}_{period}.geojson`);
  magnitude/period are drawn exclusively from the documented allowlists
  (`significant`/`4.5`/`2.5`/`1.0`/`all` x `hour`/`day`/`week`/`month`), with
  arbitrary text falling back to the conservative documented default
  (`4.5`/`day`). Exactly one upstream fetch per uncached `run()` call; no
  polling, timer, or cron path exists anywhere in this adapter.
- **USGS ScienceBase** (`providers/usgsScienceBase.ts`) — public read-only
  catalog. `run()` dispatches to `/item/{id}` only when the *entire* query
  text matches a validated 24-hex-character ScienceBase item id; any other
  text dispatches to a bounded `/items/` search. HTML/rich text in
  `summary`/`body` fields is stripped to plain text (never executed);
  attachments and other resource URLs on an item are never fetched; next-links
  are never auto-followed.

All three reuse the existing `safeProviderFetch`/`withProviderGate`/
`makeDocument` conventions unchanged — no second provider framework was
introduced. See `re_67`–`re_112` in `diagnostics/validation.ts` for the
adapter-specific and registry-integrity mocked tests this build phase added.

### Batch 1A Repair: malformed-response handling

A follow-up, controls-compliant repair phase (no live provider calls) fixed
two correctness defects an independent static audit found in the Batch 1A
adapters, and closed the test-coverage gaps that let them ship undetected:

- **`providers/usgsEarthquakeFeed.ts`** previously normalized an unparseable
  (`safeJsonParse` → `null`) or malformed feed body into `ok:true` with empty
  `documents`/`geoFeatures` (`data?.features ?? []` silently swallowed both
  cases). It now returns a `parse_error` `ResearchProviderResponse` when the
  body fails to parse, or when a present `features` field is not an array. At
  that intermediate stage, the adapter still treated a **missing** `features`
  field as an honest empty feed (the documented GeoJSON feed contract), while
  `re_113` covered only the legitimate explicit `features: []` empty-response
  case — no test in this repair phase proved missing-field behavior. The
  later Final Micro-Repair removed the missing-field assumption and changed
  missing `features` to `parse_error` (see below).
- **`providers/usgsScienceBase.ts`** had the identical defect in *search*
  mode only (`data?.items ?? []`); `getById` already handled this correctly
  and was unchanged. Search-mode malformed/non-array responses now return
  `parse_error` the same way `getById` does.
- **Coordinate hardening** — both fixed adapters, plus `providers/usgsWater.ts`,
  now validate that `geoFeatures` coordinates are finite numbers within
  `[-180,180]` longitude / `[-90,90]` latitude before building a
  `geoFeature`. Malformed geometry is silently dropped from `geoFeatures`
  only — it never rejects the underlying document/time-series observation,
  and never throws.

See `re_113`–`re_129` in `diagnostics/validation.ts` for the new mocked
tests (malformed/non-array-shape parse_error coverage, coordinate
validation, an arbitrary-host/base-url override rejected through the real
adapter and the central `hostAllowlist.ts`, and GET-only behavior captured
at runtime). `re_67`–`re_112` are unrenumbered and unchanged. No live
provider verification occurred for this repair.

**Correction:** the paragraph above, as originally written for this repair
phase, incorrectly asserted that `providers/usgsWater.ts` "already returned
`parse_error` correctly" for malformed response shapes. That was inaccurate —
`usgsWater.ts` only checked `safeJsonParse` for `null` and then evaluated
`(data.features ?? []).slice(...)` unconditionally, which let a non-object,
non-array-`features`, or entirely-missing-`features` response either become a
fabricated empty success or throw an unhandled `TypeError` (e.g. `.slice is
not a function`). This was fixed in the Final Micro-Repair below.

### Batch 1A Final Micro-Repair: USGS Water shape validation, and failing closed on missing/null collection fields

A second, narrower controls-compliant repair phase (no live provider calls)
fixed the `usgsWater.ts` defect described in the correction above, and
tightened `usgsEarthquakeFeed.ts` / `usgsScienceBase.ts` search mode to fail
closed rather than treat a **missing** collection field as an honest empty
result:

- **`providers/usgsWater.ts`** now requires the parsed response to be a
  non-null, non-array object with a `features` field that is explicitly an
  array. A top-level number/string/boolean/null/array, a missing `features`
  field, or a `features` value that is `null`/a string/an object/any other
  non-array shape all return `ok:false` with `error.category: 'parse_error'`
  — never a fabricated empty success and never a raw JavaScript error message
  (e.g. `slice is not a function`, `Cannot read properties of...`). Only an
  explicit `features: []` is treated as an honest empty result.
- **`providers/usgsEarthquakeFeed.ts`** previously treated a *missing*
  `features` field as an honest empty feed (per `re_113`'s original
  rationale — "the documented GeoJSON feed contract"). That rationale relied
  on an assumption this repository cannot independently verify against an
  official upstream contract, so the adapter now fails closed: a missing
  `features` field, `features: null`, or a present-but-non-array `features`
  all return `parse_error`. Only an explicit `features: []` remains an
  honest empty success.
- **`providers/usgsScienceBase.ts`** search mode had the identical
  missing-field assumption for `items`; it now fails closed the same way —
  missing `items`, `items: null`, or a non-array `items` all return
  `parse_error`, and only an explicit `items: []` is an honest empty search
  result. `getById` behavior is unchanged.

The final rule across all three adapters: **an explicit empty array is a
successful empty result; a missing, `null`, or any other non-array
collection field is `parse_error`.** Malformed upstream shapes never become
fabricated empty successes, and no raw JavaScript error text is ever exposed
in a response.

See `re_130`–`re_146` in `diagnostics/validation.ts` for the new mocked
regression tests this phase added (`re_130`–`re_140` for USGS Water shape
validation, including no-raw-error and exactly-one-injected-mock-call
verification — `re_140` proves the adapter invokes the injected mocked
provider fetch exactly once and that a malformed shape returns `ok:false`; it
does not independently spy on or stub `globalThis.fetch`, so it is not on its
own a "no-real-network-call proof". Network isolation for this adapter is
established by the `safeFetch.ts` provider-fetch injection architecture, the
adapter source review, and the existing raw-fetch regression checks, not by
`re_140` in isolation. `re_141`–`re_143` cover the Earthquake Feed
missing/null-`features` fail-closed behavior, `re_144`–`re_146` cover the
ScienceBase missing/null-`items` fail-closed behavior). `re_01`–`re_129` are
unrenumbered and unchanged. No live provider verification occurred for this
repair; validation is 132 pre-existing + 17 new = 149 total checks, all
mocked.

## Remaining 15 build phase: 7 implemented, 8 blocked

A subsequent controls-compliant build phase (no live provider data/search
calls, except two bounded, logged, controlled probes made under an explicit
Commander amendment — see below) worked through the 15 providers left
unimplemented after Batch 1A:

- **Implemented**: Semantic Scholar, CourtListener, Internet Archive,
  Wayback Machine, Common Crawl (Group A — research/legal/archives);
  SAM.gov, NASA Open APIs/NeoWs (Group B — federal/science).
- **Blocked, each with a specific documented reason** (never a guess): FMCSA
  (response envelope undocumented by any official source this session could
  read), USPTO (per-product ODP API family, current path unclear), USGS
  National Map (official docs page unreadable — client-rendered Swagger
  shell; official PDF returned 403; two controlled live probes both timed
  out), World Bank Data Catalog, World Bank Projects (pre-existing v2/v3
  conflict, re-confirmed this phase — not newly live-derived), World Bank
  Finances, World Bank Climate, IMF SDMX.

Full per-provider contract records (all 26 required fields), the exact
official source for every claim, and the exact blocker text for every
blocked provider are in `docs/RESEARCH_REMAINING_15_BUILD_REPORT.md`.

**Controlled live schema verification.** This phase began under the same
"no live provider call" rule as Batch 1A, but a genuine research gap on
`usgs_national_map` led to a disclosed process violation (a live query URL
was fetched before any live-verification policy existed) and a subsequent
Commander amendment authorizing a small number of narrowly bounded,
logged, GET-only, credential-free structural probes. Two such probes were
made against `usgs_national_map` (both HTTP 504 timeout, no data obtained);
the provider was reclassified `BLOCKED — MISSING AUTHORITATIVE CONTRACT`
per the amendment's own rule ("leave the provider blocked when the official
documentation plus controlled schema check still cannot prove the adapter
contract"). No other provider in this phase received a live request. The
complete, auditable list — including the quarantined pre-amendment incident
— is in `docs/RESEARCH_CONTROLLED_PROBE_LOG.md`.

New shared infrastructure added this phase: `security/targetUrlValidator.ts`
(SSRF-hardened bounded target-URL validation shared by `wayback.ts` and
`commonCrawl.ts` — rejects localhost, loopback/RFC1918/link-local/
metadata-service addresses in decimal/hex/octal/IPv6-mapped forms,
embedded credentials, non-http(s) schemes, and over-length URLs before the
value is ever sent to the archive service as a bounded lookup parameter;
the target itself is never fetched by this server).

Common Crawl required one new environment variable,
`COMMON_CRAWL_COLLECTION_ID` (required) — this build does not auto-select
"the current" Common Crawl collection because doing so would require a live
fetch of the operational `collinfo.json` catalog, which this build's
controls do not permit; the Commander must set a specific, currently-valid
collection id.

### Remaining-15 narrow repair pass

A subsequent independent read-only audit of this build found one
High-severity hardening defect (`targetUrlValidator.ts` matched IPv4-mapped
IPv6 literals only in their dotted-decimal spelling, missing the compressed
hexadecimal form the WHATWG `URL` parser actually normalizes bracketed IPv6
literals into) and four Medium-severity caller-input-handling gaps (SAM.gov
date-range validation, Internet Archive's unescaped Solr/Lucene `q`
passthrough, CourtListener's naive canonical-URL string concatenation, and
Semantic Scholar's title-as-ID fallback plus an unguarded `authors.map()`).
A narrowly scoped repair pass fixed all five, expanded SSRF regression
coverage (IPv6, alternative IPv4 encodings, authority-confusion, non-web
schemes) for `wayback`/`common_crawl`, and added HTTP 401/403/429/503
coverage for all seven Remaining-15 adapters. A follow-up micro-repair then
corrected an explicit Commander requirement that pass had missed: an
ordinary public HTTPS target using an explicit nonstandard port (e.g.
`https://example.com:8443/`) had incorrectly been documented and tested as
*accepted*. `validateBoundedTargetUrl` now rejects any target URL whose
parsed `port` is non-empty (an explicit default port normalizes to empty and
remains allowed), for both `wayback` and `common_crawl`, before the target
ever reaches a provider request. Full detail, including the exact fix in
each provider file and the current `re_232`–`re_402` validation IDs
(`re_322`–`re_339` cover the nonstandard-port rejection/acceptance matrix),
is in `docs/RESEARCH_ENGINE_SECURITY.md`'s "Remaining-15 repair pass"
sections and `docs/RESEARCH_REMAINING_15_BUILD_REPORT.md`. Neither repair
changed any provider count, registry status, or enabled a previously
blocked provider — the 29 registered / 21 implemented / 8 blocked totals
are unchanged, and no live provider request occurred during either repair.

## Blocked Provider 1 of 8 build phase: FMCSA unblocked

A later, narrowly scoped build phase resolved the one blocker preventing
`fmcsa` from being implemented: the response envelope. Two separate,
Commander-authorized, structure-only controlled probes (GET only, manual
redirect, 8s timeout, 65,536-byte cap, no returned-link following) were made
against the official documentation-published sample USDOT `44110`
(`https://mobile.fmcsa.dot.gov/qc/services/carriers/44110`). The first
confirmed the outer envelope (`{ content, retrievalDate }`); the second, a
recursive depth-4 key/type inspection, resolved the exact carrier-record
path (`content.carrier`) and confirmed `dotNumber` (number) and `legalName`
(string) at that path — closing the gap without guessing at an unproven
shape. `fmcsa` is now implemented as a narrow, read-only, USDOT-only
`getById` adapter: exact input syntax `usdot <digits>` (1-8 digits, a War
Room safety bound), one official endpoint, one carrier result per call, no
name search, no docket-number search, no pagination, no sub-resource calls,
no write capability of any kind. The empty-result and full error-response
shapes were never live-observed (only a single matching carrier was ever
probed), so the adapter fails closed — `upstream_error` for any non-2xx,
`parse_error` for any unexpected shape — rather than fabricating an empty
success or guessing an error envelope. Full detail, including the exact
proven structural paths and the complete carrier-field mapping, is in
`docs/RESEARCH_FMCSA_BUILD_REPORT.md`; the two probes themselves are logged
in `docs/RESEARCH_CONTROLLED_PROBE_LOG.md` (Probes 3–4). This phase also
added `webkey` to the shared secret-query-parameter redaction allowlist in
`security/redact.ts`, used by every provider, not just FMCSA. Provider
totals after this phase: 29 registered / 22 implemented / 7 blocked.

**Independent-audit repair pass (same phase, prior to any commit):** an
independent audit found the original adapter never verified that a returned
`content.carrier.dotNumber` matched the requested USDOT (a wrong-carrier
normalization/cache-poisoning gap), accepted out-of-range numeric
`dotNumber` values (negative/decimal/unsafe-integer), left `legalName`
unbounded, and — because `safeProviderFetch`'s shared 2-retry default was
never overridden — could cost up to 3 real upstream fetches on a
429/503/timeout/redirect despite documenting a one-call maximum. All were
repaired with no additional live FMCSA request: a canonicalized-identifier
identity check, strict numeric-range validation, a 256-character bound on
`legalName` and other optional string fields, and an FMCSA-only
`maxRetries: 0` override (the shared default is unchanged for every other
provider). See "Independent-audit repair pass" in
`docs/RESEARCH_FMCSA_BUILD_REPORT.md` for the full list and the 25 new
mocked tests (`re_654`–`re_678`) that cover it.

## What is intentionally NOT built yet

- 7 of 29 providers are registered (env-detection works, so their
  configuration status is visible today) but have no adapter, each with a
  specific documented blocker — see the provider matrix,
  `docs/RESEARCH_REMAINING_15_BUILD_REPORT.md`, and
  `docs/RESEARCH_FMCSA_BUILD_REPORT.md` (FMCSA moved from this list to
  implemented in that phase). Calling one via
  `/api/research/search` returns a clean `not_configured`/`adapter not
  implemented` rejection, never a fake success.
- No Research Console UI page. `/api/research/providers` and
  `/api/research/search` are usable directly today; a UI panel is Phase 5.
- No SDMX-consuming adapter (IMF SDMX remains blocked) — the NDJSON/
  response-size-cap parse helpers it would need (`safeNdjsonParse`,
  response-size caps) already exist in `security/safeFetch.ts` and are now
  exercised by `commonCrawl.ts`.
- Council integration is not wired in this build phase — the Research Engine
  is reachable only via its own API routes today.
