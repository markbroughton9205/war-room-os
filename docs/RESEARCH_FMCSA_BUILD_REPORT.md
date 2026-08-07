# Research Engine — FMCSA Build Report (Blocked Provider 1 of 8)

This is the narrow, single-provider build phase that resolved the one
blocker preventing `fmcsa` (FMCSA QCMobile API) from being implemented,
documented as `BLOCKED — MISSING AUTHORITATIVE CONTRACT` in
`docs/RESEARCH_REMAINING_15_BUILD_REPORT.md` (section 7) and
`docs/RESEARCH_PROVIDER_MATRIX.md`. That prior classification was correct at
the time: no official source this session could then read documented the
response envelope, and no `FMCSA_WEB_KEY` was available to resolve it via a
controlled live probe.

## What changed

`FMCSA_WEB_KEY` became available in a later, Commander-controlled session.
Two separate, narrowly authorized, structure-only controlled probes were
made — never more than one live request per authorized session, per the
Commander's explicit gating — against the one official documentation-
published sample USDOT number, **44110** (found in the "Example" column of
the endpoint table on the official FMCSA Developer page
`https://mobile.fmcsa.dot.gov/QCDevsite/docs/qcApi`, reused consistently
across the `/basics`, `/docket-numbers`, and `/authority` example rows for
the same `/carriers/:dotNumber` endpoint family — this is why it qualifies
as an official example rather than an arbitrary real carrier record).

Both probes returned HTTP 200, `application/hal+json;charset=UTF-8`, 2096
bytes. Full run details (sanitized, no raw values) are recorded in
`docs/RESEARCH_CONTROLLED_PROBE_LOG.md`, Probes 3 and 4.

## Proven contract

- **Top-level type**: object — `{ content: object, retrievalDate: string }`
- **Content wrapper**: `content` is an object (not an array, not a bare
  carrier record) containing `_links` (HAL links — never followed) and
  `carrier` (the actual record)
- **Carrier-record path**: `content.carrier`
- **`dotNumber`**: `content.carrier.dotNumber`, type `number`
- **`legalName`**: `content.carrier.legalName`, type `string`
- Also present at `content.carrier` (confirmed structurally, values never
  recorded): `dbaName`, `allowedToOperate`, `statusCode`, `oosDate`,
  `phyStreet`/`phyCity`/`phyState`/`phyZipcode`/`phyCountry`,
  `safetyRating`, `safetyRatingDate`, `reviewDate`, `reviewType`,
  `commonAuthorityStatus`, `contractAuthorityStatus`, `brokerAuthorityStatus`,
  insurance-on-file/required flags, crash/inspection counters, and nested
  `carrierOperation`/`censusTypeId` objects.
- **`retrievalDate`**: present at the top level, type `string`. Its meaning
  is undocumented by any official source read this session — it is **not**
  treated as the carrier record's publication or update date anywhere in
  the adapter.

**Not proven, and not guessed**: the empty-result shape (no probe was made
against a non-matching USDOT — only the documented example, which matches),
and the full error-response body shape for any non-2xx status. The adapter
fails closed for both rather than fabricating a contract.

## What was built

`lib/research-engine/providers/fmcsa.ts` — a narrow, read-only adapter:

1. **Input syntax**: exact match `usdot <digits>` (1-8 digits). This digit
   bound is a **War Room-imposed conservative safety constraint**, not an
   official FMCSA rule — no official source this session read publishes a
   formal USDOT digit-length limit. Free text, multiple identifiers,
   name-style input, and docket-style input are all rejected before any
   network call. The matched digits are **canonicalized** to a decimal
   string via `Number(digits)` before URL construction, cache-key
   construction, or the returned-identity comparison (see item 3 below):
   the value must be a finite, safe, positive integer no greater than
   99,999,999, so leading zeros collapse (`usdot 044110` canonicalizes
   identically to `usdot 44110`, and the two share one cache entry) and
   `usdot 0` is rejected before any fetch.
2. **One endpoint**: `GET https://mobile.fmcsa.dot.gov/qc/services/carriers/{usdot}`,
   authenticated via `webKey` as a query parameter (per the documented
   contract — no header alternative exists), read only from
   `process.env.FMCSA_WEB_KEY`.
3. **One result per call, identity-checked**: the response is parsed
   strictly against the proven `content.carrier` shape; a numeric
   `dotNumber` (finite, safe integer, positive, ≤99,999,999) and a bounded
   non-empty string `legalName` (≤256 characters) are both required, **and**
   the returned `dotNumber` must exactly equal the canonicalized requested
   USDOT — or the response is rejected as `parse_error` with zero documents
   and is never cached under any key. No speculative alternate envelope,
   and no structurally valid record for a *different* carrier, is ever
   accepted. (Repair, independent-audit HIGH finding: the requested-vs-
   returned identity check was missing in the original build; see
   "Independent-audit repair pass" below.)
4. **Normalization**: one `ResearchDocument` is produced, using
   `providers/shared.ts::makeDocument`. `title` = `legalName`;
   `providerRecordId`/`identifiers.fmcsa_dot_number` = `dotNumber`
   (stringified); `canonicalUrl`/`sourceUrl` = the sanitized endpoint
   (never includes `webKey`); bounded optional carrier fields (`dbaName`,
   `allowedToOperate`, `statusCode`, `oosDate`, safety-rating fields,
   authority-status fields; each ≤256 characters, rejected — never
   truncated — and treated as absent if exceeded) are included in
   `identifiers` only when present — never fabricated when null or missing.
   `phyStreet`/`phyZipcode` are deliberately excluded (more precise
   contact-like data than the task calls for); only
   `phyCity`/`phyState`/`phyCountry` feed the `geography` field. Telephone,
   email, and any crash/inspection/driver-level detail are excluded
   entirely from this v1 adapter.
5. **Caching**: TTL cache keyed only on the canonicalized USDOT digits
   (`fmcsa:carrier:{usdot}`) — `webKey` is never part of the cache key, and
   a rejected (malformed, oversized, or wrong-carrier) response is never
   cached under any key.
6. **Security**: uses the shared `safeProviderFetch` exclusively (host
   allowlist, HTTPS-only, size cap, provider gate) with `maxRedirects: 0`
   (any redirect at all is treated as an unexpected condition, never
   followed) **and `maxRetries: 0`** (an FMCSA-only override of
   `safeProviderFetch`'s shared 2-retry default — no other provider's retry
   behavior changed) and a 65,536-byte response cap. Combined, this bounds
   every FMCSA execution to at most one real upstream fetch regardless of
   outcome — success, any 4xx/5xx, a timeout/network failure, or a redirect
   response all cost exactly one request, never more. `webkey` was added to
   the shared `SECURITY/redact.ts` secret-query-parameter allowlist (case-
   insensitively), so it is stripped from any logged URL or error message
   — this benefits every current and future provider using that parameter
   name, not just FMCSA. (Repair, independent-audit MEDIUM finding: prior
   to `maxRetries: 0`, the shared default of 2 retries meant 429/503/
   timeout/redirect conditions could cost up to 3 real upstream fetches,
   contradicting the "one provider call maximum" claim below; see
   "Independent-audit repair pass".)
7. **No writes, no pagination, no sub-resource calls, no name search, no
   docket-number search** — the adapter constructs exactly one URL shape
   and never follows the HAL `_links` present in the response body.

## Error handling

| Condition | Result |
|---|---|
| `FMCSA_WEB_KEY` missing | `not_configured`, zero documents |
| Input doesn't match `usdot <digits>` | rejected before any fetch, zero documents |
| HTTP 429 | `rate_limited` |
| Any other non-2xx (400/401/403/404/500/503/…) | `upstream_error` — no dedicated `not_found` category exists in this build's `ResearchProviderError` type, so 404 also becomes `upstream_error` rather than a fabricated distinct state |
| Malformed JSON / HTML body | `parse_error` |
| Missing `content`, non-object `content`, non-object `carrier`, missing/wrong-typed/invalid-range `dotNumber` (non-finite, non-integer, non-positive, or >99,999,999), or missing/empty/whitespace-only/oversized (>256 char) `legalName` | `parse_error` — never a guess at an alternate envelope |
| Returned `dotNumber` numerically valid but does not equal the requested (canonicalized) USDOT | `parse_error`, zero documents, never cached under any key |
| Oversized response (>65,536 bytes) | `parse_error` (rejected before parsing) |
| Redirect of any kind | rejected, never followed, costs exactly one upstream fetch (`maxRetries: 0`) |
| Timeout / network error | `upstream_error`, message passed through the shared redactor, costs exactly one upstream fetch (`maxRetries: 0`) |

A 200 response that fails structural validation, numeric-range validation,
or requested-vs-returned identity comparison is never treated as an honest
empty success — it is always `parse_error`.

## Independent-audit repair pass

An independent audit of the original build (`docs/RESEARCH_CONTROLLED_PROBE_LOG.md`-
adjacent review, verdict **PASS WITH CONDITIONS — REPAIR BEFORE COMMIT**)
found one HIGH and several MEDIUM/LOW gaps, all repaired in this pass
without any new live FMCSA request:

- **HIGH — wrong-carrier normalization/cache poisoning**: the original
  parser accepted any structurally valid `content.carrier` response as a
  match for the requested USDOT, with no comparison between the two. Fixed
  by comparing the canonicalized requested USDOT against `String(dotNumber)`
  after structural/numeric validation; a mismatch is `parse_error`, zero
  documents, never cached.
- **MEDIUM — returned `dotNumber` numeric range**: negative, non-integer,
  and unsafe-integer values were previously accepted (only `typeof` +
  `Number.isFinite` were checked). Fixed with a shared
  `Number.isSafeInteger && > 0 && <= 99,999,999` bound applied to both the
  requested and returned identifier.
- **MEDIUM — unbounded `legalName`**: no maximum length existed. Fixed with
  a 256-character bound (rejected, never truncated); the same bound now
  applies to every other optional carrier string field.
- **MEDIUM — retry/redirect amplification**: `safeProviderFetch`'s shared
  2-retry default meant 429/503/timeout/redirect conditions could cost up
  to 3 real upstream fetches despite the adapter's "one provider call
  maximum" claim. Fixed with an FMCSA-only `maxRetries: 0` override; every
  execution now costs at most one real upstream fetch under every observed
  condition (success, every tested 4xx/5xx, timeout, redirect).
- **MEDIUM — test-harness gaps**: `re_617` (one-call-maximum) previously
  exercised only the success path, and `re_641` (redirect) never counted
  fetch calls, so retry/redirect amplification could occur without any test
  failing. `re_641` was converted to use the call-counting test helper;
  `re_607` (which had asserted a `dotNumber: 0` mismatch was valid — the
  test that made the wrong-carrier gap visible to the audit) was rewritten
  to assert the mismatch is rejected and never cached; the call-counting
  helper itself was hardened to throw on any fetch beyond what a test
  explicitly authorizes, rather than silently replaying the last mocked
  response. 25 new tests (`re_654`–`re_678`) cover the returned-identity
  mismatch, every numeric-range edge case (zero, negative, decimal, unsafe
  integer, NaN, Infinity), requested-zero rejection, leading-zero
  canonicalization and shared cache identity, `legalName` bounds, exactly-
  one-fetch guarantees under 429/503/timeout/redirect, mixed-case and
  URL-encoded WebKey redaction, and test-isolation (provider gate/cache/
  fetch-hook restoration).
- **LOW — stale documentation**: `docs/RESEARCH_PROVIDER_MATRIX.md` still
  read "All 21 implemented adapters" after FMCSA brought the count to 22;
  corrected.

No production `FMCSA_WEB_KEY` was used and no live network request was made
during this repair pass — all new/repaired tests use mocked `fetch` only.

## Validation

81 dedicated mocked tests (`re_600`–`re_680`) in
`lib/research-engine/diagnostics/validation.ts` exercise the real exported
`fmcsaAdapter.run()` against a mocked `fetch` — normalization (success path,
each mapped field, null-field and zero-value edge cases, `retrievalDate`
never fabricating a publish/update date), input validation (invalid/free-
text/multiple/overlong/zero identifiers, name/docket-style input, all
rejected without a network call), requested-USDOT canonicalization
(leading-zero collapse and shared cache identity), returned-`dotNumber`
identity and numeric-range validation (mismatch, zero, negative, decimal,
unsafe integer, a malformed-JSON body containing an illegal NaN token,
valid-JSON overflow to Infinity), `legalName` bounds (empty, whitespace-only,
oversized, exactly-at-bound), exact request construction (host, path,
method, no pagination params, HAL links never followed), every
malformed-envelope variant, HTTP 400/401/403/404/429/500/502/503/504/
timeout/oversized/redirect handling with an explicit exactly-one-fetch
assertion for every retryable/redirect condition — the complete
`safeProviderFetch` retryable-status set (429, 502, 503, 504) is each
individually proven to cost exactly one upstream fetch under FMCSA's
`maxRetries: 0` override — WebKey secrecy (absent from the cache key,
serialized errors, source URL, and network-error text; mixed-case parameter
names and URL-encoded values fully redacted by the shared redactors),
provider-gate/cache/fetch-hook isolation, and the final registry/descriptor
invariants (29/22/7 split, descriptor-registry set equality, the exact
remaining seven blocked provider IDs). All 486 Research Engine validation
tests pass (0 failures, 0 duplicate IDs).
`pnpm exec tsc --noEmit`, `pnpm exec eslint`, and `pnpm run build` all pass
with zero errors/warnings.

No live network request was made during validation, the repair pass, or the
build/lint/type checks — only the two controlled probes recorded in
`docs/RESEARCH_CONTROLLED_PROBE_LOG.md` ever touched the real FMCSA API.

## Final LOW-finding cleanup

A subsequent independent re-audit of the repair pass above found 0 critical,
0 high, and 0 medium findings, and 2 LOW findings, both closed in this
narrow cleanup pass with **no production adapter behavior changed** and
**no live provider request made**:

- `re_660` was renamed from `re_660_fmcsa_returned_nan_dot_number_rejected`
  to `re_660_fmcsa_invalid_json_nan_literal_is_parse_error`. The old name
  claimed the test proved rejection of a JavaScript `NaN` value reaching the
  numeric validator; in fact `NaN` is not legal JSON syntax, so `JSON.parse`
  throws before any value reaches that validator. The renamed test now
  truthfully asserts a malformed-JSON body containing the illegal `NaN`
  token is rejected as `parse_error` on exactly one fetch. Valid-JSON
  non-finite behavior remains separately covered by `re_661`
  (`1e400` parses successfully to `Infinity`, then fails
  `Number.isSafeInteger`).
- Two new tests, `re_679` (HTTP 502) and `re_680` (HTTP 504), close the
  remaining gap in exactly-one-fetch coverage: `re_671` (429) and `re_672`
  (503) already existed, but the shared `safeProviderFetch` retryable-status
  set also includes 502 and 504. `re_679`/`re_680` prove those two statuses
  also cost exactly one upstream fetch under FMCSA's `maxRetries: 0`
  override, completing coverage of the full retryable set (429, 502, 503,
  504).

## Provider state after this phase

- 29 registered, **22 implemented**, **7 blocked**
- Remaining blocked providers (unchanged by this phase): `uspto`,
  `world_bank_data_catalog`, `world_bank_projects`, `world_bank_finances`,
  `world_bank_climate`, `imf_sdmx`, `usgs_national_map`

## What this build does not claim

- Not production-deployed, not merged, not pushed.
- No production `FMCSA_WEB_KEY` was installed anywhere in the repository.
- Not fully live-verified: only a single matching-carrier 200 response was
  ever observed. The empty-result contract and the full error-response body
  shape for any non-2xx status were never live-tested — the adapter's
  conservative fail-closed behavior for those cases is a deliberate design
  choice, not a proven contract.
- No name search, no docket-number search, no pagination, no sub-resource
  data (BASICS, cargo, operation classification, out-of-service, docket
  numbers, authority detail beyond the three status fields already present
  on the base carrier record) is implemented in this v1 adapter.
- Not a claim that all 29 providers are implemented — 7 remain honestly
  blocked with documented reasons, unchanged by this phase.
- The independent-audit repair pass made no additional live FMCSA request —
  every repaired and new test (`re_607`, `re_641`, `re_654`–`re_678`) uses
  mocked `fetch` only. The empty-result contract and the full error-response
  body shape for any non-2xx status remain unproven for the same reason as
  above; the repair pass narrowed the accepted *shape and identity* of a
  200 response, it did not add live verification.
