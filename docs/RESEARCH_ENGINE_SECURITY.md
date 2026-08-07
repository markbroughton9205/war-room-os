# Research Engine — Security

## No secret ever leaves the server

- Every provider env var is read only inside modules marked `import 'server-only'`.
- `GET /api/research/providers` returns `configStatus` (`configured` /
  `unavailable` / `pending` — there is no `disabled` value; no Research
  Engine disable mechanism exists in this build, so that status was removed
  from the type rather than left declared-but-unreachable) and the env
  **variable names** required/optional — never a value, length, or prefix.
  Every route response includes `secretsExposed: false` as an explicit,
  checkable contract.
- API keys that must travel in a URL (FRED, NCBI) are stripped by
  `security/redact.ts::redactUrlForLogging` before that URL is ever logged or
  surfaced in an error. Keys that support a header instead of a query param
  (documented per-provider in `RESEARCH_PROVIDER_MATRIX.md`, e.g. IMF's
  `Ocp-Apim-Subscription-Key`, USGS Water's `X-Api-Key`) must use the header —
  this is enforced by convention today and should be a validation-harness
  check as those adapters are implemented.
- No provider secret is ever prefixed `NEXT_PUBLIC_*` (`re_27` in the
  validation harness asserts this against the provider config source).
- `security/redact.ts::redactSecretsFromText` also strips generic
  `Authorization:`-style header values (not just `Bearer <token>`) and
  internal stack-frame/file-path fragments (e.g. `at Object.<anonymous>
  (…/providers/foo.ts:45:10)`) from any error text before it can reach a
  user-visible `ResearchProviderError`. `re_29` in the validation harness
  exercises the real `safeProviderFetch` error path with a synthetic secret,
  Authorization value, and stack-style path, and asserts none of them survive
  into the thrown error message — replacing a prior version of this check
  that asserted an unrelated `sourceUrl` property and never actually tested
  redaction.

## SSRF / open-proxy prevention

- `security/hostAllowlist.ts` is an allowlist, not a denylist: every provider
  has an explicit array of official hostnames it may ever contact.
  `safeProviderFetch` calls `assertAllowedProviderUrl` before the first
  request and re-validates on every redirect hop.
- HTTPS is enforced on every request and every redirect target.
- `POST /api/research/search` accepts only known `ResearchProviderId`s in its
  `providers` field (validated against the registry) — a caller can never
  point the engine at an arbitrary upstream host. There is no generic proxy
  endpoint.
- A Commander-set base-URL override (`USGS_WATER_API_BASE_URL`,
  `USGS_EARTHQUAKE_FEED_BASE_URL`, `USGS_SCIENCEBASE_API_BASE_URL`, and the
  other per-provider `*_BASE_URL` env vars) only changes which path an
  adapter builds a request against — it can never widen `hostAllowlist.ts`.
  `re_118`/`re_124`/`re_128` in the validation harness set one of these to a
  non-allowlisted HTTPS host, run the real adapter, and assert the mocked
  `fetch` is never invoked (the central allowlist throws first) and the
  request fails safely rather than escaping the mock or crashing the
  adapter.

## Malformed-response handling (never a fabricated empty success)

A parse failure or an unexpected response shape from a provider must become
an honest `ok:false` / `parse_error` `ResearchProviderResponse`, never a
silent `ok:true` with empty results — an empty success is indistinguishable
from "the provider legitimately had nothing to report" and would hide a
real upstream/parsing problem from the caller. A Batch 1A repair fixed two
places this guarantee was violated (`usgsEarthquakeFeed.ts`'s feed body,
`usgsScienceBase.ts`'s search-mode body — both previously used a `?? []`
fallback that treated `null`-from-unparseable and non-array shapes the same
as a legitimately empty array) — see `RESEARCH_ENGINE_ARCHITECTURE.md`'s
"Batch 1A Repair" section and `re_113`–`re_129` in
`diagnostics/validation.ts`.

A subsequent Final Micro-Repair closed two remaining gaps in this same
guarantee:

- `usgsWater.ts` had the same class of defect that repair missed: it only
  checked `safeJsonParse` for `null` and then evaluated
  `(data.features ?? []).slice(...)` unconditionally, so a non-object
  response, a non-array `features`, or a missing `features` field could
  become either a fabricated empty success or an unhandled `TypeError`
  (never surfaced as a safe `parse_error`). It now requires the parsed body
  to be a non-null, non-array object with `features` explicitly present as
  an array before treating anything as a result — including an empty one.
- `usgsEarthquakeFeed.ts` and `usgsScienceBase.ts` (search mode) both
  treated a **missing** collection field (`features` / `items`, as opposed
  to a present-but-wrong-shaped one) as an honest empty result, on the
  assumption that a missing field is a documented "empty feed"/"empty
  search" contract. This repository has no independently verifiable
  official upstream contract confirming that assumption, so both now fail
  closed: a missing collection field returns `parse_error` the same as
  `null` or a non-array value.

The rule, finalized: **an explicit empty array (`features: []`, `items: []`)
is the only shape treated as an honest successful empty result. A missing,
`null`, or any other non-array collection field is always `parse_error`,
and no raw JavaScript error text (e.g. `slice is not a function`) is ever
exposed in the response.** See `re_130`–`re_146` in
`diagnostics/validation.ts` for the regression coverage. No live provider
verification occurred for either repair.

## Redirects never leak credentials cross-host

`safeProviderFetch` follows redirects manually (`redirect: 'manual'`), caps
them (default 3), validates each target against the same host allowlist, and
strips any `Authorization` header before following a redirect to a different
hostname than the original request.

## Response-size / decompression-bomb protection

`safeProviderFetch` streams the response body and aborts once a byte cap
(default 8 MB, override per call) is exceeded, returning `truncated: true`
rather than buffering an unbounded body. `safeNdjsonParse` additionally caps
the number of lines parsed (default 5,000) for future NDJSON-based providers
(Common Crawl).

## Timeouts, retries, rate limits

- Every request has an `AbortController` timeout (default 12s).
- 429/502/503/504 responses are retried (default 2 retries) with
  exponential backoff + jitter, honoring `Retry-After` when present.
- `security/providerGate.ts` caps concurrent in-flight requests per provider
  (default 2) and opens a 30-second cooldown after 3 consecutive failures —
  a misbehaving upstream cannot be hammered by a burst of research requests.

## Prompt-injection / untrusted-content treatment

Every provider response is external, untrusted input. Adapters that surface
free-text content the provider itself wrote (Exa web snippets, Wikidata
community descriptions) attach a `warnings` entry stating the content is
untrusted evidence, not an instruction — this is a documentation/labeling
convention enforced at the point of construction
(`providers/exa.ts`, `providers/wikidata.ts`), not a runtime filter. No
provider response is ever `eval`'d, interpolated into a prompt as a system
instruction, or used to drive tool calls, file writes, or Council actions.

## XML parsing has no XXE surface

`security/xmlLite.ts` is a dependency-free tag/attribute extractor, not a
general XML parser: it never parses a `DOCTYPE` or resolves an external
entity, so there is no XXE class of vulnerability to exploit even against a
malicious upstream response. It only decodes the five standard XML character
entities plus numeric character references.

## Authorization

Every `/api/research/*` route calls `requireCommanderSession(...)` before
touching any provider or returning any data — there is no unauthenticated
Research Engine access, and no other role (including Baby Chat / signup
flows) has been granted access in this build. This reuses the existing
Commander session check (`lib/security/commanderSession.ts`) unchanged; the
Research Engine introduces no new auth mechanism.

## No write authority anywhere

Every implemented adapter issues only `GET` requests (Exa's `POST /search`
is a read-only search call, not a mutation). No adapter has a `create`,
`update`, `delete`, `submit`, `comment`, `merge`, or `dispatch` capability.
This is a structural property of the adapter contract
(`providers/adapter.ts`) — `run` and `healthCheck` are the only two methods
an adapter can expose, and neither accepts a payload that could represent a
provider-side mutation.

## No new persistence

No new Supabase table or migration was created. `cache/ttlCache.ts` is
in-process memory only (resets on redeploy) and `diagnostics/audit.ts` logs
structured, redacted metadata to the server log — it does not write to any
database. Nothing beyond the existing War Room approval/memory gates is
touched.

## Known gaps (tracked, not hidden)

- SPARQL endpoints (`WIKIDATA_SPARQL_ENDPOINT`,
  `WIKIDATA_SCHOLARLY_SPARQL_ENDPOINT`) are registered but unused — no
  arbitrary SPARQL execution is exposed, by simply not building that path
  yet rather than building and gating it. When it is built, the spec
  requires allowlisted query templates only, never passthrough.
- Circuit-breaker/cooldown state and the TTL cache are process-local; a
  multi-instance deploy will not share cooldown/cache state across
  instances. Acceptable for a soft rate limit, not a hard guarantee.
