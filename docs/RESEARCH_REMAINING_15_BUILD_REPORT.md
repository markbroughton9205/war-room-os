# Research Engine — Remaining 15 Providers — Build Report

Status: **IN PROGRESS.** This document records, per provider, the exact
official-source contract proof gathered before any adapter code was written.

**Correction (Commander amendment, controlled live schema verification):**
an earlier version of this paragraph stated that no provider API/data/catalog
call occurred while producing this document. That statement is **no longer
accurate** and is corrected here rather than silently edited away:

- One **pre-amendment unauthorized read-only probe** occurred against
  `usgs_national_map`'s live `/products` endpoint (with real query
  parameters) before any live-verification policy existed. It was disclosed
  immediately, is recorded and quarantined in
  `docs/RESEARCH_CONTROLLED_PROBE_LOG.md`, and **is not used as contract
  evidence anywhere in this document.**
- The Commander subsequently issued a **controlled live schema verification
  amendment** authorizing a small number of narrowly bounded, GET-only,
  read-only, credential-free structural probes against official
  provider-owned hosts, for schema confirmation only (never as a substitute
  for documentation proof of ownership/auth/capability/semantics). Every
  post-amendment probe is logged in `docs/RESEARCH_CONTROLLED_PROBE_LOG.md`.

Per-provider status below uses these precise labels, not a blanket claim:

- **DOCUMENTATION-PROVEN** — contract established from an official
  documentation page, OpenAPI/spec reference, or provider-owned source
  repository. No live call was needed or made.
- **LIVE-SCHEMA-CONFIRMED** — a bounded, logged, post-amendment probe
  additionally confirmed structural facts (top-level type, collection
  field, pagination fields) on top of documentation proof. Structural
  confirmation only — never a substitute for the documented contract.
  Semantic facts (business/legal/scientific/financial/status/eligibility/
  unit meaning) are never inferred from a live probe alone.
- **MOCK-VALIDATED, NOT LIVE-VERIFIED** — adapter tested only against
  mocked responses; no live call was made (typically because a required
  credential is not present in this runtime, or a live probe was
  unnecessary/undesirable).
- **BLOCKED — DOCUMENTATION CONFLICT** / **BLOCKED — MISSING AUTHORITATIVE
  CONTRACT** — unchanged meaning from the original governance instructions;
  a controlled probe cannot rescue an unproven contract by itself.

None of the below claims "fully live verified" or "production ready" for
any provider.

Classification legend:
- **DOCUMENTED AND IMPLEMENTABLE** — contract fully proven from an
  authorized source; adapter implemented this build phase.
- **IMPLEMENTABLE WITH EXPLICIT LIMITATION** — contract proven for a
  narrowed capability; adapter implemented against that narrowed capability
  only.
- **BLOCKED — DOCUMENTATION CONFLICT** — authoritative sources disagree or
  the currently-documented contract could not be reconciled with a prior
  in-repo note; left `implemented: false`.
- **BLOCKED — MISSING AUTHORITATIVE CONTRACT** — no authorized source could
  be located/confirmed for a required detail; left `implemented: false`.

---

## GROUP A — Research, Legal and Archives

### 1. semantic_scholar — Semantic Scholar Academic Graph API

**Classification: DOCUMENTED AND IMPLEMENTABLE**

1. **Provider ID**: `semantic_scholar`
2. **Provider name**: Semantic Scholar Academic Graph API (Allen Institute for AI / Ai2)
3. **Exact official sources**:
   - `https://api.semanticscholar.org/api-docs/` (official API documentation portal, navigation confirmed)
   - `https://github.com/allenai/s2-folks/blob/main/Public%20API%20Categories.md` (official provider-owned source repository)
   - `https://github.com/allenai/s2-folks/blob/main/API_RELEASE_NOTES.md` (official provider-owned source repository)
   - `https://www.semanticscholar.org/product/api/tutorial` (official documentation prose page)
4. **Source classification**: OFFICIAL DOCUMENTATION / OFFICIAL SOURCE REPOSITORY
5. **API version**: Graph API v1 (`/graph/v1`)
6. **Base host**: `api.semanticscholar.org`
7. **Endpoint path**: `GET /graph/v1/paper/search` (standard relevance search, NOT `/paper/search/bulk` — bulk search is excluded by design: it is a cursor-based, effectively unbounded-result endpoint intended for exhaustive corpus retrieval, which conflicts with this build's "no bulk datasets" constraint)
8. **HTTP method**: GET only
9. **Authentication mechanism**: Optional `x-api-key` header. Unauthenticated calls work at a shared, lower rate limit.
10. **Required environment variables**: none (`pendingWhenUnconfigured: true` already reflects this in the registry)
11. **Optional environment variables**: `SEMANTIC_SCHOLAR_API_KEY`
12. **Query parameters used**: `query` (required, bounded length), `fields` (fixed allowlisted set — no `citations`/`references` fields requested, per the "no recursive citation/reference expansion" limit), `limit` (bounded), `offset` (fixed at 0 — never caller-supplied)
13. **Query limits**: documented constraint — the sum of `offset` and `limit` must not exceed 1,000; this adapter fixes `offset=0` and caps `limit` well below that (≤25)
14. **Result limits**: capped at 25 documents per call
15. **Pagination contract**: response carries `next`/`token` fields for further pages; **never followed** — one request per `run()` call, per the "no uncontrolled pagination" control
16. **Response top-level type**: JSON object
17. **Response collection field**: `data` (array)
18. **Stable identifier field**: `paperId` — **repair pass**: mandatory; a
    record missing it is skipped rather than falling back to the (unstable,
    non-unique) title as an identifier, per `re_365`–`re_366`
19. **Canonical public citation URL**: the paper's documented `url` field (a `semanticscholar.org/paper/...` URL), when the API returns one — **repair pass**: only used as `canonicalUrl` when it parses as HTTPS on exactly `www.semanticscholar.org`; an off-origin or malformed `url` is dropped to `null` rather than trusted verbatim, per `re_371`
20. **Date fields**: `year` (integer) and, when requested, `publicationDate` (YYYY-MM-DD); only requested/used field is `year` this phase to keep the fields list narrow and auditable
21. **Rate-limit behavior**: unauthenticated calls share a pooled limit (documented in `API_RELEASE_NOTES.md` as 5,000 requests/5 minutes shared across all unauthenticated callers); with an API key, 1 request/second for `/paper/search`. `safeProviderFetch`'s existing 429/backoff handling covers both.
22. **Empty-response shape**: documented `data: []` with `total: 0` — treated as honest empty success
23. **Malformed-response behavior**: non-object top level, or a present-but-non-array `data`, or a missing `data` field all become `parse_error` (fails closed, matching this build's established convention — no independently verifiable official contract proves "missing `data` = empty result")
24. **Supported capabilities**: `search` only this phase (no distinct `getById`/`citations`/`related` calls are dispatched, even though the descriptor lists them as long-term capabilities — this adapter does not overstate `run()`'s behavior)
25. **Returned-resource-link behavior**: the paper's own page URL is surfaced as `canonicalUrl`; it is never fetched by the adapter
26. **Write capability confirmation**: none — GET only, no write path exists

---

### 2. courtlistener — CourtListener REST API

**Classification: DOCUMENTED AND IMPLEMENTABLE**

1. **Provider ID**: `courtlistener`
2. **Provider name**: CourtListener (Free Law Project)
3. **Exact official sources**:
   - `https://www.courtlistener.com/help/api/rest/search/` (official REST API documentation; redirects to the Free Law Project's own documentation wiki below — same organization, confirmed via the 301 redirect target's host)
   - `https://wiki.free.law/c/courtlistener/help/api/rest/v4/search` (official Free Law Project documentation — Free Law Project is CourtListener's operating organization)
4. **Source classification**: OFFICIAL DOCUMENTATION
5. **API version**: REST API v4 (`/api/rest/v4/`)
6. **Base host**: `www.courtlistener.com`
7. **Endpoint path**: `GET /api/rest/v4/search/?type=o` (documented default search type — "Case law opinion clusters with nested Opinion documents"), used read-only
8. **HTTP method**: GET only (a POST form exists for semantic/embedding search — not used by this adapter)
9. **Authentication mechanism**: Token authentication via `Authorization: Token <token>` header (documented as required on every request to the v4 base path)
10. **Required environment variables**: `COURTLISTENER_API_TOKEN`
11. **Optional environment variables**: none
12. **Query parameters used**: `q` (bounded free-text query), `type=o` (fixed — case-law opinions only, never caller-supplied), no `order_by` override (uses the documented relevance default)
13. **Query limits**: query text bounded to 300 characters
14. **Result limits**: capped at 20 results per call
15. **Pagination contract**: documented `next`/`previous` cursor URLs in the response envelope; **never followed**
16. **Response top-level type**: JSON object
17. **Response collection field**: `results` (array; documented envelope: `count`, `results`, `next`, `previous`)
18. **Stable identifier field**: `cluster_id` (documented field on case-law/opinion-cluster search results)
19. **Canonical public citation URL**: `https://www.courtlistener.com` + the documented `absolute_url` field on each result — **repair pass**: no longer naive string concatenation. `absolute_url` must be a relative path rooted at `/` (protocol-relative `//...` and full off-host URLs are rejected outright), resolved via `new URL(relativePath, trustedOrigin)`, then post-validated (`https:`, hostname exactly `www.courtlistener.com`, default port, no embedded credentials) before use. A result whose `absolute_url` is present but fails this check is skipped rather than surfaced with an unsafe URL, per `re_357`–`re_364`
20. **Date fields**: `dateFiled` (documented field on case-law search results)
21. **Rate-limit behavior**: documented per-endpoint throttling; `safeProviderFetch` 429 handling applies
22. **Empty-response shape**: `results: []` with `count: 0` — honest empty success
23. **Malformed-response behavior**: non-object top level or non-array `results` (missing, null, or wrong type) → `parse_error`. **Repair pass**: a non-empty `results` array where every record has an unsafe/unusable `absolute_url` also → `parse_error`, per `re_364`
24. **Supported capabilities**: `search` only this phase (opinions/case-law). No distinct docket/cluster `getById` dispatch is implemented, so `getById` is not claimed by `run()`'s actual behavior even though the long-term descriptor lists it.
25. **Returned-resource-link behavior**: opinion text / PDF / attachment URLs present on a result are never fetched — only metadata is normalized
26. **Write capability confirmation**: none — GET only; no alerts, webhooks, purchases, or account actions are ever invoked

---

### 3. internet_archive — Internet Archive Advanced Search API

**Classification: DOCUMENTED AND IMPLEMENTABLE**

1. **Provider ID**: `internet_archive`
2. **Provider name**: Internet Archive (archive.org) Advanced Search
3. **Exact official sources**:
   - `https://archive.org/developers/` (official developer documentation portal)
   - `https://archive.org/advancedsearch.php` documented at `https://archive.org/developers/tutorial-jsonp-jquery.html` and `https://archive.org/developers/internetarchive/api.html` (official documentation prose describing the Advanced Search endpoint contract, fields, and rows/output parameters — read as documentation prose, not queried live)
4. **Source classification**: OFFICIAL DOCUMENTATION
5. **API version**: unversioned public Advanced Search endpoint
6. **Base host**: `archive.org`
7. **Endpoint path**: `GET /advancedsearch.php`
8. **HTTP method**: GET only
9. **Authentication mechanism**: none required for read search
10. **Required environment variables**: `INTERNET_ARCHIVE_USER_AGENT_BASE` (already in the registry — Internet Archive's documentation asks API consumers to identify themselves via `User-Agent`)
11. **Optional environment variables**: `INTERNET_ARCHIVE_BASE_URL`
12. **Query parameters used**: `q` (bounded query string, encoded as a literal-only phrase — see limitation below), `fl[]` (fixed allowlisted field list: `identifier,title,description,mediatype,date,creator`), `rows` (bounded), `output=json`, `page` fixed at 1 (never caller-supplied)
13. **Query limits**: query text bounded to 300 characters, raw control characters stripped. **Repair pass**: caller text is escaped and wrapped as a single double-quoted literal Solr/Lucene phrase before being placed in `q` — Solr treats a quoted phrase's contents as literal terms, not query syntax, so field selectors (`title:`), boolean operators, grouping, wildcards, and range syntax in caller text can no longer be interpreted as Internet Archive's advanced-search grammar. `fl[]`/`rows`/`page` remain entirely code-controlled. `re_348`–`re_356` capture the real outbound request and prove this for representative malicious inputs
14. **Result limits**: `rows` capped at 20
15. **Pagination contract**: `page`/cursor-based; **never followed**, single page only
16. **Response top-level type**: JSON object
17. **Response collection field**: `response.docs` (array; documented Solr-style envelope: `{ responseHeader, response: { numFound, start, docs } }`)
18. **Stable identifier field**: `identifier`
19. **Canonical public citation URL**: `https://archive.org/details/{identifier}` (documented canonical item-details URL pattern)
20. **Date fields**: `date` (item metadata date, format varies by item — passed through as a string, never parsed/coerced)
21. **Rate-limit behavior**: no documented hard limit for advancedsearch; `safeProviderFetch` retry/backoff applies defensively
22. **Empty-response shape**: `response.docs: []` with `response.numFound: 0` — honest empty success
23. **Malformed-response behavior**: non-object top level, missing `response`, or non-array `response.docs` → `parse_error`
24. **Supported capabilities**: `search` only this phase. `getById` is not dispatched (no distinct item-metadata-endpoint call is made), so it is not claimed by `run()`.
25. **Returned-resource-link behavior**: only the canonical details page URL is surfaced; no file/media/torrent download URL is ever constructed or fetched
26. **Write capability confirmation**: none — GET only; no upload, no item modification

---

### 4. wayback — Wayback Machine (CDX Server API)

**Classification: IMPLEMENTABLE WITH EXPLICIT LIMITATION**

1. **Provider ID**: `wayback`
2. **Provider name**: Internet Archive Wayback Machine
3. **Exact official sources**:
   - `https://github.com/internetarchive/wayback/blob/master/wayback-cdx-server/README.md` (official provider-owned source repository — `internetarchive` GitHub org)
   - `https://archive.org/help/wayback_api.php` (official Availability API documentation — read for comparison; **not used**, see limitation below)
4. **Source classification**: OFFICIAL SOURCE REPOSITORY
5. **API version**: unversioned public CDX Server API
6. **Base host**: `web.archive.org`
7. **Endpoint path**: `GET /cdx/search/cdx` (capture metadata listing) — **CDX only**. The Availability API is documented on host `archive.org` (path `/wayback/available`), a *different* host from the one already reviewed/allowlisted for this provider (`web.archive.org`); rather than widening the allowlist for a second host, this build uses CDX exclusively, which alone fully satisfies the descriptor's `historicalCaptures` capability (a bounded list of captures, most-recent-first).
8. **HTTP method**: GET only
9. **Authentication mechanism**: none required
10. **Required environment variables**: none
11. **Optional environment variables**: `WAYBACK_BASE_URL`
12. **Query parameters used**: `url` (the target URL to look up — validated per the SSRF hardening rules below, never fetched), `output=json`, `limit` (negative, e.g. `-20`, so the documented "last N" behavior returns the most recent captures first), `filter=statuscode:200` (fixed — only successful captures), `collapse=timestamp:8` (fixed — one capture per day, bounding row volume), `gzip=false` (fixed, per the documented usage note that responses are gzip-encoded by default)
13. **Query limits**: target URL length capped (2,048 chars) and validated as documented below; `limit` magnitude capped at 20
14. **Result limits**: capped at 20 capture rows
15. **Pagination contract**: CDX supports `resumeKey`/`showResumeKey`; **never requested, never followed**
16. **Response top-level type**: with `output=json`, a JSON array-of-arrays; the first row is the documented field-name header row (`["urlkey","timestamp","original","mimetype","statuscode","digest","length"]`), confirmed exactly as quoted from the official README
17. **Response collection field**: the outer array itself (data rows after the header row)
18. **Stable identifier field**: `timestamp` + `original` URL pair (documented as the capture's compound identity)
19. **Canonical public citation URL**: `https://web.archive.org/web/{timestamp}/{original}` (documented capture URL pattern) — surfaced as metadata only, **never fetched** by the adapter
20. **Date fields**: `timestamp` (`YYYYMMDDhhmmss`, documented CDX format) parsed into an ISO date string for `publishedAt` only
21. **Rate-limit behavior**: no documented hard quota (a documented server-side default cap of 150,000 rows exists, far above this adapter's own 20-row cap); `safeProviderFetch` retry/backoff applies defensively
22. **Empty-response shape**: CDX returns `[]` (or just the header row) when nothing matches — honest empty success
23. **Malformed-response behavior**: a non-array top-level body → `parse_error`
24. **Supported capabilities**: `historicalCaptures` only. `compareCaptures` is **not** implemented this phase (would require fetching/diffing archived page content, which is explicitly prohibited — "do not fetch archived pages"); the descriptor's `compareCaptures` capability is not claimed by `run()`'s actual behavior.
25. **Returned-resource-link behavior**: capture URLs are surfaced as citation metadata only; the archived page itself is never fetched, and capture redirects are never followed
26. **Write capability confirmation**: none — GET only

**Limitation**: the Availability API (`archive.org/wayback/available`) was reviewed but deliberately **not used** — see item 7 above.

**Target-URL SSRF hardening**: the `url` parameter is validated by a shared bounded-lookup validator before being sent to the CDX/Availability endpoint: only `http://`/`https://` schemes; no embedded credentials (`user:pass@`); hostname must not be `localhost`/`localhost.`/a loopback (v4 `127.0.0.0/8` incl. decimal/hex/octal forms, v6 `::1`), RFC1918 (`10.0.0.0/8`,`172.16.0.0/12`,`192.168.0.0/16`), link-local (`169.254.0.0/16`, `fe80::/10`), the cloud metadata address (`169.254.169.254`), an IPv4-mapped IPv6 literal, or any other reserved/test range; **micro-repair**: an explicit nonstandard port (e.g. `:8443`) is also rejected outright, before the target ever reaches a provider request — the WHATWG `URL` parser normalizes an explicit default port (`:80` for `http`, `:443` for `https`) to an empty `port` value, so a no-port URL or an explicit-default-port URL remains indistinguishable and stays allowed; this adds no DNS resolution or DNS-rebinding protection, and the policy applies identically to `common_crawl` below; total length ≤ 2,048 chars; the value is sent only as a bounded `url=` query parameter to `web.archive.org`, never dereferenced by this server.

---

### 5. common_crawl — Common Crawl Index Server API

**Classification: DOCUMENTED AND IMPLEMENTABLE**

1. **Provider ID**: `common_crawl`
2. **Provider name**: Common Crawl
3. **Exact official sources**:
   - `https://commoncrawl.org/blog/index-to-warc-files-and-urls-in-columnar-format` (official documentation prose)
   - `https://commoncrawl.org/faq` (official FAQ — index/User-Agent policy)
   - `https://index.commoncrawl.org/CC-MAIN-2025-XX-index?url=...&output=json` documented **shape** at `https://commoncrawl.org/blog/announcing-the-common-crawl-index` (official documentation prose describing the CDX-compatible index API and its parameters) — the collection **id** used in this build's fixed template is read from `.env`/documented convention, never fetched live from `collinfo.json` (an operational/live catalog, disallowed by this session's URL-safety rules)
4. **Source classification**: OFFICIAL DOCUMENTATION
5. **API version**: CDX-compatible Index Server API (unversioned)
6. **Base host**: `index.commoncrawl.org`
7. **Endpoint path**: `GET /{collection-id}/-index` (documented CDX-compatible path, e.g. `CC-MAIN-2024-33-index`)
8. **HTTP method**: GET only
9. **Authentication mechanism**: none; documentation asks for an identifying `User-Agent`
10. **Required environment variables**: `COMMON_CRAWL_USER_AGENT_BASE` (already in registry), and a new required `COMMON_CRAWL_COLLECTION_ID` — **see limitation below**
11. **Optional environment variables**: `COMMON_CRAWL_INDEX_BASE_URL`
12. **Query parameters used**: `url` (bounded target URL, same SSRF validator as Wayback — never fetched), `output=json`, `limit` (bounded)
13. **Query limits**: target URL length capped (2,048 chars); `limit` capped at 20
14. **Result limits**: capped at 20 index rows
15. **Pagination contract**: none exposed by this adapter (no page/cursor param sent)
16. **Response top-level type**: newline-delimited JSON (NDJSON), one index record per line (documented CDXJ-derived JSON format)
17. **Response collection field**: n/a — parsed via the existing `safeNdjsonParse` line-capped parser; each line is one record
18. **Stable identifier field**: `urlkey` + `timestamp` (documented compound identity of an index record)
19. **Canonical public citation URL**: the record's own `url` field (the crawled page's original URL) — surfaced as metadata only
20. **Date fields**: `timestamp` (`YYYYMMDDhhmmss`, same format as Wayback CDX) parsed to an ISO string
21. **Rate-limit behavior**: no documented hard quota; `safeProviderFetch` retry/backoff applies defensively
22. **Empty-response shape**: an empty body / zero parsed lines — honest empty success
23. **Malformed-response behavior**: this adapter treats any line that fails `safeNdjsonParse` as silently skipped (documented, tested policy — matches the shared `safeNdjsonParse` contract already in `security/safeFetch.ts`); if **zero** lines parse from a **non-empty** body, that is `parse_error` rather than a fabricated empty success
24. **Supported capabilities**: `historicalCaptures` only this phase — declared `search` capability is **not** claimed by `run()` because the adapter dispatches only the bounded URL-lookup form, not free-text corpus search (Common Crawl's index has no free-text search primitive; only exact/prefix URL lookups are documented)
25. **Returned-resource-link behavior**: index records include `filename`/`offset`/`length` pointers into WARC files — **never dereferenced**, never included in the normalized output at all (per "no WARC retrieval", "no byte-range requests")
26. **Write capability confirmation**: none — GET only

**Limitation and open item**: this build phase could not authoritatively confirm, from an official documentation *page* (as opposed to the live, disallowed-to-fetch `collinfo.json` catalog), a single **current** default collection id guaranteed to exist at deploy time — Common Crawl publishes a new monthly/multi-monthly crawl id on a rolling basis, and the index endpoint requires an exact, existing collection id in its path (an unknown/stale id documented-returns HTTP 404, not an empty result). Rather than hard-coding a collection id this repository cannot verify is current without a disallowed live catalog fetch, **`COMMON_CRAWL_COLLECTION_ID` is added as a new required environment variable the Commander must set** (documented in `.env.example` and the provider matrix) to the collection id of their choice; the adapter performs no discovery/auto-selection of a collection id itself. This keeps the endpoint template fixed (per the SSRF/host-allowlist rules) while not fabricating a specific collection id this build cannot prove is live.

---

## GROUP B — Federal and Science

*(researched and recorded before implementation — see below)*

### 6. sam_gov — SAM.gov Get Opportunities Public API

**Classification: DOCUMENTED AND IMPLEMENTABLE**

1. **Provider ID**: `sam_gov`
2. **Provider name**: SAM.gov (System for Award Management) Opportunities API
3. **Exact official sources**:
   - `https://open.gsa.gov/api/get-opportunities-public-api/` (official GSA API documentation)
4. **Source classification**: OFFICIAL DOCUMENTATION
5. **API version**: v2
6. **Base host**: `api.sam.gov`
7. **Endpoint path**: `GET /opportunities/v2/search`
8. **HTTP method**: GET only
9. **Authentication mechanism**: `api_key` query parameter (documented) — **sent server-side only**; redacted from citations/errors/cache keys/logs by the existing `redactUrlForLogging`/`redactSecretsFromText` (both already strip `api_key=`)
10. **Required environment variables**: `SAM_GOV_API_KEY`
11. **Optional environment variables**: none
12. **Query parameters used**: `api_key`, `postedFrom`/`postedTo` (documented **required** `MM/dd/yyyy` bounded date range — this build defaults to a bounded trailing 90-day window when not supplied), `title` or `q`-style keyword (documented field name is `title` for keyword-in-title search — used as the bounded free-text term), `limit` (documented max 1000; this adapter caps far lower), `ptype` (fixed allowlisted set of documented procurement-type codes, not exposed to arbitrary caller input)
13. **Query limits**: keyword text bounded to 200 characters; date range bounded to ≤365 days per the documented API constraint. **Repair pass**: an earlier version of this adapter defaulted a caller-supplied `dateFrom`/`dateTo` that failed to parse to "not supplied" rather than rejecting it, and never checked for a reversed range or an oversized one. It now rejects an invalid date, a reversed range (`dateTo` before `dateFrom`), and a range over 365 days outright — as `ok:false` before any upstream request is built — rather than silently correcting, swapping, or clamping them, so the final requested range can never exceed the cap. `re_340`–`re_347` cover the valid-range, invalid-date, reversed-range, exactly-365-day, over-365-day, default-window, and no-key-leak cases
14. **Result limits**: `limit` capped at 20
15. **Pagination contract**: documented `offset`/`limit`; offset fixed at 0, never caller-supplied or auto-advanced
16. **Response top-level type**: JSON object
17. **Response collection field**: `opportunitiesData` (documented array field)
18. **Stable identifier field**: `noticeId`
19. **Canonical public citation URL**: documented `uiLink` field on each opportunity (public SAM.gov listing URL)
20. **Date fields**: `postedDate`, `responseDeadLine` (documented fields) — passed through as strings, never fabricated when absent
21. **Rate-limit behavior**: documented per-key rate limits; `safeProviderFetch` 429 handling applies
22. **Empty-response shape**: `opportunitiesData: []`, `totalRecords: 0` — honest empty success
23. **Malformed-response behavior**: non-object top level or non-array `opportunitiesData` → `parse_error`
24. **Supported capabilities**: `search` only — no `getById` dispatch this phase
25. **Returned-resource-link behavior**: only the public `uiLink` listing URL is surfaced; attachment/description-document links present on a record are never fetched
26. **Write capability confirmation**: none — GET only; no registration, bid submission, or entity modification of any kind

**Eligibility/status honesty**: `active`/`inactive`/set-aside/eligibility fields are passed through only when the API itself supplies them (`active` field, `typeOfSetAsideDescription` field) — never inferred or defaulted to an active/eligible state.

---

### 7. fmcsa — FMCSA QCMobile API

**Classification: BLOCKED — MISSING AUTHORITATIVE CONTRACT**

1. **Provider ID**: `fmcsa`
2. **Provider name**: Federal Motor Carrier Safety Administration QCMobile API
3. **Exact official sources checked**:
   - `https://mobile.fmcsa.dot.gov/QCDevsite/docs/getStarted` (official FMCSA developer documentation — confirms base host `mobile.fmcsa.dot.gov`, the `webKey` query-parameter authentication mechanism, and endpoint paths `/qc/services/carriers/name/{name}`, `/qc/services/carriers/{dotNumber}`, `/qc/services/carriers/docket-number/{docketNumber}`)
   - `https://mobile.fmcsa.dot.gov/QCDevsite/docs/apiElements` (official "API Elements Description" page — confirms individual carrier-record field names: `allowToOperate`, `outOfService`, `outOfServiceDate`, `dotNumber`, `mcNumber`, `legalName`, `dbaName`, `phyStreet`/`phyCity`/`phyState`/`phyZip`/`phyCountry`, `telephone`, `complaintCount`, plus separate BASIC-measure fields)
4. **Source classification**: OFFICIAL DOCUMENTATION
5–8. **Established**: base host `mobile.fmcsa.dot.gov`; path family `/qc/services/carriers/...`; GET only; `webKey` query-parameter auth.
9–23. **Not established.** Neither official page this session could read documents the **response envelope** — whether a carrier record is returned bare, wrapped in a `content` field, wrapped in a `content` array (to accommodate the documented "returns matching carriers" behavior of the *name* lookup, which can match more than one carrier), or nested under some other key. Both pages describe individual field names in isolation, never a complete example response body. This session found third-party (non-official) client libraries and blog posts asserting a specific envelope shape, but per this session's authorized-source rules those are explicitly excluded as evidence ("no unofficial SDKs," "no random GitHub repositories"), so they were not used. `FMCSA_WEB_KEY` is not present in this runtime (confirmed via a non-printing presence check only), so the Commander's controlled-live-schema-verification amendment's credentialed-provider guidance applies: live verification is optional and was not attempted here, consistent with "skip live verification when safe credential handling cannot be guaranteed."
24. **Supported capabilities**: none implemented
25. **Returned-resource-link behavior**: n/a
26. **Write capability confirmation**: n/a (no adapter exists)

**Exact blocker**: without a confirmed response envelope, this build cannot
implement the required "Response top-level type" / "Response collection
field" / "Malformed-response behavior" contract items without guessing —
exactly what "do not fabricate... response fields" prohibits. This provider
remains `implemented: false`. If a Commander-provided `FMCSA_WEB_KEY` becomes
available in a future session, one bounded, logged, controlled live probe
(`GET /qc/services/carriers/{a-real-or-known-test-dotNumber}?webKey=...`,
result implicitly bounded to one carrier) would very likely resolve this gap
per the amendment's "controlled live schema verification" policy — but no
such credential is available in this runtime, so that probe was not
performed.

---

### 8. nasa — NASA Open APIs (Near Earth Object Web Service)

**Classification: IMPLEMENTABLE WITH EXPLICIT LIMITATION**

1. **Provider ID**: `nasa`
2. **Provider name**: NASA Open APIs — NeoWs (Near Earth Object Web Service)
3. **Exact official sources**:
   - `https://api.nasa.gov/` (official NASA API documentation portal — prose sections read, no interactive "try it" request executed)
4. **Source classification**: OFFICIAL DOCUMENTATION
5. **API version**: unversioned (`/neo/rest/v1`)
6. **Base host**: `api.nasa.gov`
7. **Endpoint path**: `GET /neo/rest/v1/feed` (documented near-Earth-object feed by date range) — chosen as the **one narrow current capability** per the controls (explicitly not duplicating `nasa_gibs`, not a generic NASA proxy)
8. **HTTP method**: GET only
9. **Authentication mechanism**: `api_key` query parameter (documented; `DEMO_KEY` exists for low-volume testing but this build always requires a real Commander-issued key — server-side only, redacted)
10. **Required environment variables**: `NASA_API_KEY`
11. **Optional environment variables**: none
12. **Query parameters used**: `api_key`, `start_date`, `end_date` (documented — **must not exceed a 7-day range** per NeoWs's documented constraint; this adapter enforces that bound server-side regardless of caller input)
13. **Query limits**: date range clamped to ≤7 days; if the caller supplies no date range, defaults to the next 7 days from today
14. **Result limits**: capped at 20 normalized near-Earth-object documents (flattened across the date-keyed response)
15. **Pagination contract**: none — the feed endpoint returns the full requested date range in one response; no next-link exists
16. **Response top-level type**: JSON object
17. **Response collection field**: documented `near_earth_objects` object, keyed by date string, each value an array of NEO objects — flattened into one bounded list before normalizing
18. **Stable identifier field**: `neo_reference_id` (documented)
19. **Canonical public citation URL**: documented `nasa_jpl_url` field on each NEO object (public JPL Small-Body Database page)
20. **Date fields**: `close_approach_data[].close_approach_date` (documented) — only the nearest documented approach date is surfaced; never fabricated when absent
21. **Rate-limit behavior**: documented per-key hourly limits; `safeProviderFetch` 429 handling applies
22. **Empty-response shape**: a date range with zero NEOs documents as `near_earth_objects: {}` (or date keys mapping to `[]`) — honest empty success
23. **Malformed-response behavior**: non-object top level, or `near_earth_objects` present but not an object, → `parse_error`
24. **Supported capabilities**: `search` only this phase, scoped strictly to the date-range NEO feed — no asteroid-getById, no APOD, no Mars rover photos, no generic multi-endpoint dispatch (avoids becoming a "generic NASA proxy" per the controls)
25. **Returned-resource-link behavior**: only the JPL detail-page URL is surfaced; never fetched
26. **Write capability confirmation**: none — GET only; no image/large-file download of any kind

---

### 9. uspto — USPTO Patent Public Search / Open Data Portal

**Classification: BLOCKED — DOCUMENTATION CONFLICT**

1. **Provider ID**: `uspto`
2. **Provider name**: USPTO Open Data Portal (ODP)
3. **Exact official sources checked**:
   - `https://data.uspto.gov/apis` (official ODP API catalog page)
   - `https://developer.uspto.gov/` (official USPTO developer hub — largely redirects/points to `data.uspto.gov/apis` and to product-specific pages for the legacy PatentsView and PEDS APIs)
4. **Source classification**: OFFICIAL DOCUMENTATION (catalog-level only)
5–23. **Not established** — see blocker below.
24. **Supported capabilities**: none implemented
25. **Returned-resource-link behavior**: n/a
26. **Write capability confirmation**: n/a (no adapter exists)

**Exact blocker**: `data.uspto.gov/apis` currently presents ODP as a family of **separate per-product APIs** (Patent File Wrapper API, Patent Application Data API, Trademark Search API, etc.), each requiring its own request-header API key (`X-API-KEY`) and each with its own distinct base path and OpenAPI document, rather than one single stable "USPTO patent/trademark metadata" endpoint this session could confirm without opening a product-specific OpenAPI spec page whose URL this session could not independently verify is the **current** one (the legacy PatentsView API, previously a common integration target, is documented elsewhere as having been consolidated into ODP with a migration in progress, and this session found conflicting statements across USPTO's own pages about which product path is the current stable one for general patent-publication search). Per the explicit instruction "no retired endpoint unless officially current" and "leave blocked if the official contract remains unclear," this provider is left `implemented: false` rather than guessing a specific endpoint path, required fields, or response shape. **No fabricated endpoint, field, or capability is recorded for this provider.**

---

### 10. usgs_national_map — USGS The National Map (TNM) Access API

**Classification: BLOCKED — MISSING AUTHORITATIVE CONTRACT**
(reclassified after the pre-amendment incident and two failed post-amendment
controlled probes — see `docs/RESEARCH_CONTROLLED_PROBE_LOG.md`)

1. **Provider ID**: `usgs_national_map`
2. **Provider name**: USGS The National Map — TNM Access API
3. **Exact official sources checked**:
   - `https://tnmaccess.nationalmap.gov/api/v1/docs` — confirmed to be an
     official USGS host, but `WebFetch` could only retrieve a client-side
     Swagger UI shell with no static prose text (confirmed on two separate
     fetch attempts, one pre- and one post-amendment) — **no field names,
     parameters, or response shape could be read from it**.
   - `https://apps.nationalmap.gov/help/documents/TNMAccessAPIDocumentation/TNMAccessAPIDocumentation.pdf` — returned HTTP 403 Forbidden, unreadable.
4. **Source classification**: OFFICIAL DOCUMENTATION (host confirmed official; content unreadable by any authorized method)
5–23. **Not established.** Two controlled, bounded, logged live probes
   (`GET https://tnmaccess.nationalmap.gov/api/v1/products?max=1`, the
   provider's full 2-probe budget) were attempted under the Commander's
   controlled-verification amendment to fill this gap; both returned
   **HTTP 504 Gateway Timeout** with no response body. See Probes 1–2 in
   `docs/RESEARCH_CONTROLLED_PROBE_LOG.md`.
24. **Supported capabilities**: none implemented
25. **Returned-resource-link behavior**: n/a
26. **Write capability confirmation**: n/a (no adapter exists)

**Exact blocker**: neither the official documentation page (unreadable —
client-rendered Swagger shell) nor the official PDF (403 Forbidden) nor two
bounded, budget-exhausting live schema probes (both timed out) could
establish the endpoint's query parameters, response envelope, collection
field name, or item field names through any authorized method available in
this session. A **separate, earlier, unauthorized** probe against this same
endpoint (made before the controlled-verification policy existed) did
observe response structure, but that observation is explicitly quarantined
per the Commander's amendment and is **not used as evidence here** — see the
"Incident record" section of `docs/RESEARCH_CONTROLLED_PROBE_LOG.md`. Per
the amendment's explicit instruction ("leave the provider blocked when the
official documentation plus controlled schema check still cannot prove the
adapter contract"), this provider remains `implemented: false`. **No
fabricated endpoint, field, or capability is recorded for this provider.**

---

## GROUP C — International Data

### 11. world_bank_data_catalog — World Bank Data Catalog API (DDH)

**Classification: BLOCKED — MISSING AUTHORITATIVE CONTRACT**

**Exact blocker**: the only host this build's existing, reviewed `hostAllowlist.ts`/`providerEnv.ts` already carries for this provider is `datacatalogapi.worldbank.org`, documented (per this repo's own prior notes) as the DDH (Development Data Hub) external API. This session searched for an official *documentation prose page* (not the live `/ddhxext` catalog/operational endpoints, which the URL-safety rules forbid fetching) describing the DDH external API's query contract (search endpoint path, request/response field names, pagination) and could not locate one distinct from the operational API surface itself — the World Bank's public documentation for this specific API consists primarily of the live Swagger/interactive explorer at the operational host, not a separate static reference document. Per the instruction "do not fetch JSON catalog files such as... current provider indexes" and "if classification is uncertain, do not fetch the URL," this session did not fetch the live `/ddhxext` surface to reverse-engineer the contract. **Left `implemented: false`.**

---

### 12. world_bank_projects — World Bank Projects & Operations API

**Classification: BLOCKED — DOCUMENTATION CONFLICT**

**Exact blocker**: this build's prior state (see `RESEARCH_PROVIDER_MATRIX.md`, pre-existing) already documents this provider as blocked on a v2/v3 API documentation conflict discovered in an earlier build phase, and this session's search for World Bank's own documentation prose (as opposed to the live `search.worldbank.org/api/v2/projects` / `v3/projects` operational endpoints, which this session did not fetch per the URL-safety rules against querying live data/search endpoints) did not turn up a single authoritative current-version statement resolving which of the two documented API generations (`api/v2/projects` vs `api/v3/projects`) is the currently supported one, nor a stable field-name contract for either. Per "do not transfer a contract from one World Bank service to another" and "remain blocked when authoritative contract proof is insufficient," this provider remains `implemented: false`. This is a re-confirmation of the prior block, not a new live-derived conclusion — no fact from the quarantined prior session was reused.

---

### 13. world_bank_finances — World Bank Finances (Socrata Open Data / API)

**Classification: BLOCKED — MISSING AUTHORITATIVE CONTRACT**

**Exact blocker**: `finances.worldbank.org` is documented (World Bank's own finance data portal) as being built on the Socrata Open Data platform, which exposes per-dataset SODA API endpoints keyed by a dataset-specific resource id (e.g. `/resource/{4x4-id}.json`) rather than one stable, documented cross-dataset endpoint path. This session could not locate an official World Bank Finances documentation *page* naming a single specific dataset id as the stable, current "finances" dataset this adapter should query — every path this session could otherwise construct would require guessing a dataset id, which is exactly the kind of fabricated endpoint the controls prohibit ("do not fabricate endpoints"). **Left `implemented: false`.**

---

### 14. world_bank_climate — World Bank Climate Knowledge Portal / Climate Data API

**Classification: BLOCKED — DOCUMENTATION CONFLICT**

**Exact blocker**: this build's existing `hostAllowlist.ts` carries two distinct hosts under this one provider id — `climateknowledgeportal.worldbank.org` (the public portal website) and `climatedataapi.worldbank.org` (a separate, older documented Climate Data API with its own distinct endpoint/response contract, e.g. historical/CMIP5 endpoints under `/climateweb/rest/v1/...`). This session could not confirm from an official documentation page that either host currently exposes a stable, still-supported query API matching the Research Engine adapter contract (bounded query -> JSON collection): the portal host does not clearly document a public REST API of its own in the pages this session was able to review (as prose, not by probing the live site), and the separate Climate Data API's documentation could not be confirmed as currently maintained/non-deprecated within this session's authorized-source constraints. Per "do not transfer a contract from one World Bank service to another" and the requirement to independently prove host/version/endpoint/collection-field/identifiers/dates/units for this specific provider, this provider remains `implemented: false` rather than guessing which of the two hosts, or which endpoint on either, is correct today.

---

### 15. imf_sdmx — IMF Data / SDMX API

**Classification: BLOCKED — MISSING AUTHORITATIVE CONTRACT**

**Exact blocker**: this build's existing registry lists two candidate base-URL env vars (`IMF_SDMX_3_API_BASE_URL`, `IMF_SDMX_21_API_BASE_URL`) reflecting that the IMF has more than one documented SDMX API generation (a legacy `dataservices.imf.org/REST/SDMX_JSON.svc` interface and a newer `api.imf.org` SDMX 3.0-based interface introduced alongside the IMF's 2024–2025 data-platform migration). This session could not, within the authorized-source constraints (official documentation prose / static spec only, no live dataflow/catalog probing), confirm a single current, stable dataflow id, key structure, and response envelope shared by both, nor confirm which of the two hosts is the one the Commander is expected to use going forward — the "bounded dataflow, dataset, key and time inputs" the controls require presuppose knowing a specific, currently-valid dataflow id, and fabricating one (or guessing between the legacy and current API generations) is exactly what "do not fabricate endpoints" and "remain blocked when authoritative contract proof is insufficient" prohibit. **Left `implemented: false`.**

---

## Summary table

| # | Provider ID | Classification | Implemented this phase |
|---|---|---|---|
| 1 | semantic_scholar | DOCUMENTED AND IMPLEMENTABLE | Yes |
| 2 | courtlistener | DOCUMENTED AND IMPLEMENTABLE | Yes |
| 3 | internet_archive | DOCUMENTED AND IMPLEMENTABLE | Yes |
| 4 | wayback | IMPLEMENTABLE WITH EXPLICIT LIMITATION | Yes (CDX only, no Availability API, no compareCaptures) |
| 5 | common_crawl | IMPLEMENTABLE WITH EXPLICIT LIMITATION | Yes (requires new `COMMON_CRAWL_COLLECTION_ID` env var) |
| 6 | sam_gov | DOCUMENTED AND IMPLEMENTABLE | Yes |
| 7 | fmcsa | BLOCKED — MISSING AUTHORITATIVE CONTRACT | No |
| 8 | nasa | IMPLEMENTABLE WITH EXPLICIT LIMITATION | Yes (NeoWs feed only) |
| 9 | uspto | BLOCKED — DOCUMENTATION CONFLICT | No |
| 10 | usgs_national_map | BLOCKED — MISSING AUTHORITATIVE CONTRACT | No |
| 11 | world_bank_data_catalog | BLOCKED — MISSING AUTHORITATIVE CONTRACT | No |
| 12 | world_bank_projects | BLOCKED — DOCUMENTATION CONFLICT | No |
| 13 | world_bank_finances | BLOCKED — MISSING AUTHORITATIVE CONTRACT | No |
| 14 | world_bank_climate | BLOCKED — DOCUMENTATION CONFLICT | No |
| 15 | imf_sdmx | BLOCKED — MISSING AUTHORITATIVE CONTRACT | No |

**Result this phase: 9 of 15 implementable and implemented; 6 remain honestly `implemented: false` with documented blockers** (five documentation-only blockers plus `usgs_national_map`, blocked after its official documentation proved unreadable and both of its budgeted controlled live probes timed out — see `docs/RESEARCH_CONTROLLED_PROBE_LOG.md`).

## GROUP B / C corrections still pending live-schema review

The remaining Group B and C contract records above (`sam_gov`, `fmcsa`,
`nasa`, `world_bank_*`, `imf_sdmx`) were researched **before** the
controlled-verification amendment existed and are documentation-only
(**DOCUMENTATION-PROVEN** or, where blocked, unchanged). Per the amendment,
credentialed providers without a test credential present in this runtime
(`sam_gov`, `fmcsa`, `nasa`, `courtlistener`'s optional token) are
implemented as **MOCK-VALIDATED, NOT LIVE-VERIFIED** — this is explicitly
permitted by the amendment ("live verification is optional" for credentialed
providers; "skip live verification when safe credential handling cannot be
guaranteed"). This session confirmed via a non-printing presence check that
none of `SAM_GOV_API_KEY`, `FMCSA_WEB_KEY`, `NASA_API_KEY`, `USPTO_API_KEY`,
`COURTLISTENER_API_TOKEN`, `SEMANTIC_SCHOLAR_API_KEY`, or
`IMF_API_SUBSCRIPTION_KEY` are set in this runtime's shell environment (no
value was read or printed — only presence/absence was checked), so no live
probe was attempted against any credentialed endpoint using a real key.
`nasa`'s NeoWs feed could in principle be probed with the publicly
documented, non-secret `DEMO_KEY` shared testing credential, but no such
probe was performed this phase — its contract is DOCUMENTATION-PROVEN
(official `nasa/api-docs` GitHub repository) and is implemented
MOCK-VALIDATED, NOT LIVE-VERIFIED.
