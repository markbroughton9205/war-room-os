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
- API keys that must travel in a URL (FRED, NCBI, FMCSA's `webKey`) are
  stripped by `security/redact.ts::redactUrlForLogging` before that URL is
  ever logged or surfaced in an error — `webkey` was added to the shared
  `SECRET_QUERY_PARAM_NAMES` allowlist (and the equivalent
  `redactSecretsFromText` regex) specifically for FMCSA, so every existing
  and future provider using that parameter name benefits automatically.
  Keys that support a header instead of a query param
  (documented per-provider in `RESEARCH_PROVIDER_MATRIX.md`, e.g. IMF's
  `Ocp-Apim-Subscription-Key`, USGS Water's `X-Api-Key`) must use the header —
  this is enforced by convention today and should be a validation-harness
  check as those adapters are implemented. An independent-audit repair pass
  added dedicated tests (`re_674`, `re_675` in `diagnostics/validation.ts`)
  confirming mixed-case parameter names (`webKey`/`WebKey`/`WEBKEY`/`webkey`)
  and URL-encoded secret values are both fully redacted, not just the exact
  lowercase/unencoded form used by the adapter itself — see
  `docs/RESEARCH_FMCSA_BUILD_REPORT.md`.
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

## Target-URL SSRF hardening (Wayback, Common Crawl)

`security/targetUrlValidator.ts::validateBoundedTargetUrl` validates every
caller-supplied "target URL" before it is ever sent — as a bounded lookup
query parameter only — to the Wayback CDX Server API or the Common Crawl
Index Server API. Neither adapter ever fetches the target URL itself; the
validator exists to stop the archive/index service from being used as an
SSRF proxy against internal network state via a crafted target URL. It
rejects, after relying on the WHATWG `URL` parser to canonicalize decimal/
hex/octal IPv4 host forms and IDNA-encode internationalized hostnames first
(so obfuscated numeric-IP forms cannot bypass a naive string check):
non-`http`/`https` schemes, embedded credentials (`user:pass@`), `localhost`/
`localhost.`, loopback IPv4 (`127.0.0.0/8`) and IPv6 (`::1`), RFC1918
(`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local and the cloud
metadata address (`169.254.0.0/16`, incl. `169.254.169.254`), IPv6 link-local
(`fe80::/10`), unique-local (`fc00::/7`), and multicast (`ff00::/8`), IPv4-mapped
IPv6 literals, other reserved/test ranges (`0.0.0.0/8`, CGNAT `100.64.0.0/10`,
the `192.0.2.0/24`/`198.18.0.0/15`/`198.51.100.0/24`/`203.0.113.0/24` test/
benchmark nets, multicast/reserved `224.0.0.0/4`+), and over-length URLs
(>2,048 chars).

**IPv4-mapped IPv6 literals — repair pass note.** An earlier version of this
validator matched IPv4-mapped IPv6 literals (`::ffff:a.b.c.d`) only in their
dotted-decimal spelling. The WHATWG `URL` parser normalizes a bracketed
literal like `[::ffff:127.0.0.1]` into the compressed hexadecimal form
`[::ffff:7f00:1]` before the validator ever sees `parsed.hostname`, so that
normalized form bypassed the old check entirely (confirmed for the loopback
and cloud-metadata addresses specifically). The validator now fully expands
any IPv6 hostname into its 8 constituent 16-bit groups (handling `::`
compression and an embedded trailing IPv4 literal) and detects an IPv4-mapped
address structurally — by group value, not by string pattern — so both the
dotted-decimal and compressed-hex spellings are caught identically. Policy:
**every** IPv4-mapped IPv6 literal is rejected outright, regardless of
whether the embedded IPv4 address would itself be public or private. This
fix does **not** add DNS resolution or DNS-rebinding protection of any kind —
validation remains deterministic, local string/structure parsing only; a
hostname that resolves to a private address at request time is not detected
here.

`re_232`–`re_276` (`wayback`) and `re_277`–`re_321` (`common_crawl`) in the
validation harness are the current SSRF regression matrix — each case is
exercised through the real adapter's `run()`, asserting `ok:false`, the exact
error category, and that the injected `fetch` is never invoked. The matrix
covers IPv6 (loopback/unspecified/link-local/unique-local/multicast),
IPv4-mapped IPv6 in both dotted-decimal and compressed-hex spellings,
alternative IPv4 encodings (decimal/hex/octal/short-form/CGNAT/RFC1918/
documentation ranges), hostname/authority edge cases (localhost variants,
embedded credentials, trailing-dot forms, encoded-`@` and backslash authority
confusion, malformed percent-encoding), and non-web schemes
(`file`/`ftp`/`data`/`javascript`/`blob`/`gopher`).

**Explicit nonstandard target ports are rejected — micro-repair note.** An
earlier version of this validator, and the tests documenting it, treated an
ordinary public HTTPS target using an explicit nonstandard port (e.g.
`https://example.com:8443/`) as acceptable. That was incorrect: `target_url`
is a caller-controlled bounded lookup parameter, and an explicit nonstandard
port widens the surface an archive/index service could be induced to probe on
a caller's behalf. `validateBoundedTargetUrl` now rejects any parsed URL
whose `URL.port` is non-empty, immediately after protocol validation and
before the target is ever placed in a provider request — so a rejected
target never reaches the injected `fetch`. The WHATWG `URL` parser normalizes
an explicit default port (`http://example.com:80/`, `https://example.com:443/`)
to an empty `port` value, so ordinary no-port URLs and explicit-default-port
URLs remain indistinguishable and stay allowed; only an explicit *nonstandard*
port is rejected. This adds no DNS resolution or DNS-rebinding protection —
the check is deterministic, local URL-structure parsing only, applied
identically to both `wayback` and `common_crawl`, the only two adapters that
accept a caller-supplied target URL.

`re_322` (`wayback`) and `re_323` (`common_crawl`) now prove that an ordinary
public HTTPS target using an explicit nonstandard port (`:8443`) is
**rejected** — `ok:false`, error category `unknown`, the injected `fetch`
never invoked, `documents` empty, and provider-gate/cache/environment state
restored. `re_324`–`re_327` (`wayback`) and `re_328`–`re_331` (`common_crawl`)
extend the rejected-port matrix to `:8080`, `:22`, and `:3000` on both
schemes. `re_332`–`re_335` (`wayback`) and `re_336`–`re_339` (`common_crawl`)
prove the opposite for the allowed cases — no-port `https`/`http` and
explicit-default-port `:443`/`:80` — each asserting `ok:true` and that the
mocked outbound provider request was made exactly once. All of these tests
run against the real adapter's `run()` with a mocked, network-free `fetch`;
none makes a live network request.

## Remaining-15 repair pass — caller-input hardening (SAM.gov, Internet Archive, CourtListener, Semantic Scholar)

An independent read-only audit of the Remaining-15 build identified one
High-severity finding (the IPv4-mapped IPv6 bypass above) plus four
Medium-severity caller-input-handling gaps. All four are fixed:

- **SAM.gov date-range validation.** `providers/samGov.ts` previously
  silently defaulted an unparseable caller `dateFrom`/`dateTo` to "not
  supplied" and never checked for a reversed range (`dateTo` before
  `dateFrom`) or a range spanning more than 365 calendar days. It now
  rejects all three outright — an invalid date, a reversed range, and a
  range over 365 days each become `ok:false` before any upstream request is
  built, with the final `postedFrom`/`postedTo` request range therefore
  never able to exceed the cap. Rejections use error category `unknown`
  (matching the convention the target-URL validator already uses for
  caller-input rejection elsewhere in this codebase — the shared
  `ResearchProviderError` type has no dedicated `invalid_request` category).
  `re_340`–`re_347` in the validation harness cover: a valid range, an
  invalid `dateFrom`, an invalid `dateTo`, a reversed range, an exactly-365-day
  range (accepted), a 366-day range (rejected), the default bounded window
  when no caller dates are supplied, and that the API key never leaks into a
  serialized date-range error. This is mocked validation of the adapter's own
  logic, not a live-verified claim about SAM.gov's own server-side behavior.
- **Internet Archive literal-only query.** `providers/internetArchive.ts`
  previously forwarded caller text directly into the Solr/Lucene `q`
  parameter unescaped, so a caller could use field selectors (`title:`),
  boolean operators, grouping, wildcards, and range syntax as if the engine
  exposed the full Internet Archive advanced-search grammar. Caller text is
  now encoded as a single escaped, double-quoted literal phrase before it is
  ever placed in `q` — Solr treats a quoted phrase's contents as literal
  terms to match, not as query syntax, so the caller's text can no longer be
  interpreted as anything but a search string. `fl[]` (fixed field list),
  `rows`, and `page` remain entirely code-controlled, never caller-influenced.
  `re_348`–`re_356` capture the real outbound request and prove `q` for
  inputs like `title:secret`, `foo OR mediatype:movies`, `*`, `(test)`,
  `"quoted"`, `backslash\value`, and `date:[1900 TO 2100]` round-trips back
  to exactly the caller's original text, that `fl[]` stays fixed regardless
  of caller input, and that raw control characters are stripped.
- **CourtListener canonical-URL resolution.** `providers/courtlistener.ts`
  previously built `canonicalUrl` by naively string-concatenating the fixed
  origin with the upstream `absolute_url` field, with no check that the
  result actually stayed on `www.courtlistener.com`. It now accepts only a
  relative path rooted at `/` (rejecting protocol-relative `//...` values,
  full off-host URLs, and backslash-authority-confusion forms outright),
  resolves it with `new URL(relativePath, trustedOrigin)`, and post-validates
  the resolved URL's protocol (`https:`), hostname (exactly
  `www.courtlistener.com`), port (default), and absence of embedded
  credentials before ever using it as `canonicalUrl`. A result whose
  `absolute_url` is present but fails this check is skipped entirely rather
  than surfaced with an unsafe or garbled URL; if every result in a
  non-empty upstream response is unsafe, the whole response becomes
  `parse_error` rather than a fabricated honest-empty success. `re_357`–`re_364`
  cover a normal relative opinion path, a protocol-relative override, a full
  off-host URL, a lookalike-suffix host (`www.courtlistener.com.evil.example`),
  backslash authority confusion, a newline-stripped protocol-relative bypass
  (proving the *post-resolution* hostname check — not just a pre-resolution
  string-prefix check — is what actually stops this class of attack, since
  the WHATWG URL parser strips embedded newlines before parsing), a mixed
  valid/invalid result set, and an all-invalid result set.
- **Semantic Scholar stable-ID and item hardening.** `providers/semanticScholar.ts`
  previously fell back to the paper's title when `paperId` was missing —
  titles are neither stable nor unique, so this produced a non-stable
  document identifier — and called `.map()` on `authors` without an
  `Array.isArray` guard, which would throw if an upstream record ever shaped
  `authors` unexpectedly. `paperId` is now mandatory (a record missing it is
  skipped, never using title as a fallback ID), `authors` is only iterated
  after an `Array.isArray` check with malformed entries dropped rather than
  crashing normalization, a non-object `externalIds` no longer risks a
  runtime error, and `url` is only trusted as `canonicalUrl` when it is a
  valid HTTPS URL on `www.semanticscholar.org`. As with CourtListener, a
  malformed record is skipped individually; an all-malformed non-empty
  response becomes `parse_error`. A bare `year` is preserved as-is (e.g.
  `"2024"`) and never expanded into a fabricated `YYYY-MM-DD` date.
  `re_365`–`re_374` cover missing/title-only `paperId`, non-array/`null`/
  malformed `authors`, a non-object `externalIds`, an off-origin `url`, a
  mixed valid/invalid result set, an all-invalid result set, and the bare-year
  behavior.

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
- **HTTP status coverage (repair pass).** Every failed HTTP status an
  adapter's own `search()` handles maps to the same safe `upstream_error`
  category rather than a fake success, for any status — this was previously
  exercised only via a generic HTTP 500 case per adapter. The validation
  harness now also covers 401, 403, 429, and 503 explicitly for all seven
  Remaining-15 adapters (`semantic_scholar`, `courtlistener`,
  `internet_archive`, `wayback`, `common_crawl`, `sam_gov`, `nasa`) —
  `re_375`–`re_402` — each asserting `ok:false`, `documents.length === 0`,
  category `upstream_error`, and that the raw upstream response body never
  leaks into the normalized error.

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

## Controlled live schema verification (Remaining 15 build phase)

For most of this build's history, "no live provider call" was an absolute
rule. During the "Remaining 15" phase, a genuine research gap on
`usgs_national_map` (its official docs page renders as a client-side
Swagger UI shell with no extractable static content) led to a disclosed
process violation — a live query URL with real parameters was fetched
before any live-verification policy existed — which was immediately
disclosed to the Commander rather than used as evidence. The Commander then
issued a narrow, explicit amendment authorizing a small number of bounded,
GET/HEAD-only, credential-free, logged structural probes against official
provider-owned hosts (max 2 per provider, max 30 total for the build),
strictly for confirming response *structure* (top-level type, collection
field, pagination fields) — never for inferring business/legal/scientific/
financial/status/eligibility/unit semantics, and never as a substitute for
documentation proof of ownership, auth mechanism, capability, or request
semantics. Every such probe — including the quarantined pre-amendment one —
is recorded in `docs/RESEARCH_CONTROLLED_PROBE_LOG.md` with its sanitized
URL, purpose, result, and an explicit confirmation that no credential was
used, no secret was printed, and no returned link or resource was fetched.
Two probes were made this phase (both against `usgs_national_map`, both
HTTP 504 timeouts yielding no data); per the amendment's own rule, a
provider whose contract a controlled probe cannot resolve remains
`implemented: false`.

## Known gaps (tracked, not hidden)

- SPARQL endpoints (`WIKIDATA_SPARQL_ENDPOINT`,
  `WIKIDATA_SCHOLARLY_SPARQL_ENDPOINT`) are registered but unused — no
  arbitrary SPARQL execution is exposed, by simply not building that path
  yet rather than building and gating it. When it is built, the spec
  requires allowlisted query templates only, never passthrough.
- Circuit-breaker/cooldown state and the TTL cache are process-local; a
  multi-instance deploy will not share cooldown/cache state across
  instances. Acceptable for a soft rate limit, not a hard guarantee.
