# Research Engine — Architecture

Status: **Phase 0 (foundation) complete, Phase 1 (primary providers) partially complete.**
This is a staged build — see `RESEARCH_PROVIDER_MATRIX.md` for exactly which
of the 29 providers in the assignment spec are implemented today, and
`RESEARCH_ENGINE_RUNBOOK.md` for how to add the rest.

## Terminology

These docs use the following terms precisely and do not use them
interchangeably:

- **Registered provider ID** — a `ResearchProviderId` with a descriptor in
  `config/providerEnv.ts::RESEARCH_PROVIDER_ENV`. All 29 spec providers are
  registered; registration alone makes configuration status visible but
  calls no adapter.
- **Implemented adapter** — a registered provider with a real
  `ResearchProviderAdapter` in `providers/registry.ts::IMPLEMENTED_PROVIDER_ADAPTERS`
  (14 of 29 today).
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
NCBI/PubMed, Exa, Library of Congress, NASA GIBS today; 15 more registered
but not yet implemented), normalizes their responses into one schema, and
returns evidence with citations. It never writes to any provider, never
executes actions, and is never reachable by an unauthenticated caller.

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

## What is intentionally NOT built yet

- 15 of 29 providers are registered (env-detection works, so their
  configuration status is visible today) but have no adapter — see the
  provider matrix. Calling one via `/api/research/search` returns a clean
  `not_configured`/`adapter not implemented` rejection, never a fake
  success. This includes all six providers considered but not authorized
  for the Batch 1A build phase: IMF SDMX, World Bank Data Catalog, World
  Bank Projects (blocked on a v2/v3 API documentation conflict), World Bank
  Finances, World Bank Climate, and USGS National Map.
- No Research Console UI page. `/api/research/providers` and
  `/api/research/search` are usable directly today; a UI panel is Phase 5.
- No SDMX/NDJSON/WARC-consuming adapters yet (IMF, Common Crawl) — the parse
  helpers they'll need (`safeNdjsonParse`, response-size caps) already exist
  in `security/safeFetch.ts`.
- Council integration is not wired in this build phase — the Research Engine
  is reachable only via its own API routes today.
