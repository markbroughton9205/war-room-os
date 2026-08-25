# API contracts — gov/econ batch (Census, Congress.gov, GovInfo, SEC EDGAR, ORCID, ReliefWeb)

Researched for direct adapter implementation in `lib/research-engine/providers/`. Not exhaustive
API docs — just the shape needed to write a real `run()`/`healthCheck()`.

## 1. US Census API (ACS 1-year detailed tables)

- Host to allowlist: `api.census.gov`
- Endpoint: `GET https://api.census.gov/data/{year}/acs/acs1?get=NAME,{variables}&for={geo}&key={key}`
- Example: `https://api.census.gov/data/2024/acs/acs1?get=NAME,B01001_001E&for=state:*&key=KEY`
- Auth: `key` query param, **optional** — works unauthenticated at a lower rate limit (documented: unkeyed calls are rate-limited per IP, keyed calls get a much higher limit). Env: `CENSUS_API_KEY` (optional).
- Response shape: **JSON array-of-arrays**, not array-of-objects — first row is header (column names), subsequent rows are values, positionally matched. E.g. `[["NAME","B01001_001E","state"],["Alabama","5108468","01"]]`. Adapter must zip header row with each data row.
- No single stable "record id" field — synthesize one from geography FIPS code + variable + year.
- No title/date/org fields in the traditional sense — this is tabular statistical data, not documents. Best normalized as one `ResearchDocument` per geography row, or as `timeSeries` if querying multiple years.
- Rate limit: 500 queries/day unauthenticated per documented policy (varies by dataset), much higher with key.

## 2. Congress.gov API (bills)

- Host to allowlist: `api.congress.gov`
- Endpoint: `GET https://api.congress.gov/v3/bill/{congress}/{billType}?api_key={key}&format=json&limit={n}` (billType/congress omittable for a general recent-bills list: `GET /v3/bill?api_key=...`)
- Auth: **required**, `api_key` query param. This is an **api.data.gov** key (see below — same key model as GovInfo, NOT necessarily the same literal key value unless the Commander reuses one key for both signups, but the *auth mechanism* is identical: api.data.gov issues the key). Env: `CONGRESS_GOV_API_KEY` (required).
- Response JSON fields (under `bills[]`): `congress` (number), `number` (string), `type` (HR/S/HJRES/etc), `title`, `url` (API self-link, not public page — public page is `https://www.congress.gov/bill/{congress}th-congress/{type}/{number}`), `updateDate`, `updateDateIncludingText`, `originChamber`, `latestAction: {actionDate, text}`, `introducedDate`.
- Stable record id: `{congress}-{type}-{number}` (e.g. `118-hr-3076`).
- Rate limit: 5,000 requests/hour (standard api.data.gov default; Congress.gov may differ — treat conservatively).

## 3. GovInfo API (collections / published packages)

- Host to allowlist: `api.govinfo.gov`
- Endpoint (date-bounded collection listing, GET, no request body — simplest to implement safely): `GET https://api.govinfo.gov/collections/{collectionCode}/{lastModifiedStartDate}?offsetMark=*&pageSize=100&api_key={key}`. `lastModifiedStartDate` is ISO8601 e.g. `2026-01-01T00:00:00Z`. `collectionCode` examples: `BILLS`, `FR` (Federal Register), `CFR`, `USCOURTS`.
  - NOTE: GovInfo also has a POST `/search` endpoint (free-text, JSON body) which is more broadly useful but POST-with-JSON-body is a different shape than every other adapter in this codebase (all are GET). Prefer the GET `/collections/.../{date}` endpoint for the initial adapter to match the established GET-only pattern; document the POST search endpoint as a documented-but-not-implemented capability if time allows.
- Auth: **required**, `api_key` query param — api.data.gov key. Env: `GOVINFO_API_KEY` (required). **Same api.data.gov signup mechanism as Congress.gov** — confirmed both ride api.data.gov's shared key infrastructure, so document that a Commander can reuse one api.data.gov key for both `CONGRESS_GOV_API_KEY` and `GOVINFO_API_KEY` env vars (still two separate env var names since the underlying services are independently addressed and could be revoked independently).
- Response fields: `packages[]` with `packageId`, `title`  (sometimes absent on the listing endpoint — may need a follow-up `/packages/{packageId}/summary` call for title; if so, first pass can normalize using packageId as title fallback), `dateIssued`, `lastModified`, `collectionCode`, `packageLink` (canonical URL to package detail JSON), `docClass`.
- Stable record id: `packageId`.
- Rate limit: 1,200/min, 40/sec (api.data.gov standard defaults).

## 4. SEC EDGAR (full-text search + company facts)

- Hosts to allowlist: `efts.sec.gov` (full-text search), `data.sec.gov` (structured company data)
- Auth: **none** — no API key of any kind. **But every request MUST send a descriptive `User-Agent` header** identifying the requester, per SEC's fair-access policy (https://www.sec.gov/os/webmaster-faq#developers): format is free text but must include an organization/individual name and a contact email, e.g. `"War Room Research Engine research@example.com"`. Requests with a generic/missing User-Agent get HTTP 403. Env: no API key env var needed; reuse the codebase's existing `*_USER_AGENT_BASE` convention (see `internet_archive`/`common_crawl`/`wikidata` adapters) — e.g. `SEC_EDGAR_USER_AGENT_BASE` (required, since a fabricated default UA would violate SEC's identification requirement).
- Full-text search endpoint: `GET https://efts.sec.gov/LATEST/search-index?q={query}&forms={formType}&dateRange=custom&startdt={YYYY-MM-DD}&enddt={YYYY-MM-DD}`. Response: `{ hits: { total: {value}, hits: [ { _id, _source: { cik, display_names, file_type, file_date, root_form, adsh (accession number) } } ] } }`.
- Company submissions endpoint (structured, needs a known CIK — not free-text searchable, so best used as a `getById` capability keyed by CIK or ticker-resolved-to-CIK): `GET https://data.sec.gov/submissions/CIK{10-digit-zero-padded}.json` → `{ cik, name, tickers, sic, filings: { recent: { accessionNumber[], form[], filingDate[], primaryDocument[] } } }` (parallel arrays, not array-of-objects — zip by index).
- Stable record id: accession number (`adsh` / `accessionNumber`, format `0000320193-24-000123`).
- Canonical URL: `https://www.sec.gov/Archives/edgar/data/{cik}/{accessionNumberNoDashes}/{primaryDocument}`.
- Rate limit: documented ~10 requests/second per user/IP; SEC actively blocks abusive clients.

## 5. ORCID public API

- Host to allowlist: `pub.orcid.org` (data) + `orcid.org` (OAuth token endpoint — different host, both needed in allowlist)
- **Auth is NOT optional despite "public" branding**: ORCID's public API requires an OAuth 2.0 `client_credentials` bearer token even for public-data reads. There is no unauthenticated query path for `/v3.0/search` or `/v3.0/expanded-search`. This is a genuine `IMPLEMENTED_CREDENTIAL_BLOCKED` case (client id/secret required), not merely an optional-key case like Census/NCBI/Semantic Scholar.
- Registration: free — anyone can register a "Public Client" via "Developer Tools" in their own ORCID record settings (https://orcid.org/developer-tools) to get a `client_id`/`client_secret` pair. No approval wait, but does require an individual ORCID account owned by the Commander.
- Token endpoint: `POST https://orcid.org/oauth/token` with `Content-Type: application/x-www-form-urlencoded` body `client_id={id}&client_secret={secret}&grant_type=client_credentials&scope=/read-public` → JSON `{ access_token, token_type: "bearer", expires_in, scope }`.
- Search endpoint: `GET https://pub.orcid.org/v3.0/expanded-search/?q={query}&start=0&rows=10` with header `Authorization: Bearer {access_token}` and `Accept: application/json`. Response: `{ "expanded-result": [ { "orcid-id", "given-names", "family-names", "credit-name", "institution-name": [] } ], "num-found" }`.
- Env vars: `ORCID_CLIENT_ID` (required), `ORCID_CLIENT_SECRET` (required).
- Stable record id / canonical URL: `orcid-id` (e.g. `0000-0002-1825-0097`) → `https://orcid.org/{orcid-id}`.
- Token caching: access tokens are long-lived (documented ~20 years for client-credentials `/read-public` tokens in practice, though the response `expires_in` should still be honored) — adapter should cache the token in-memory (module-level, like `arxiv`'s throttle pattern) rather than re-fetching per request.
- Rate limit: not strictly published for the public API; treat conservatively (reuse existing per-provider gate).

## 6. ReliefWeb API (reports/updates)

- Host to allowlist: `api.reliefweb.int`
- Endpoint: `GET https://api.reliefweb.int/v2/reports?appname={appname}&query[value]={text}&limit={n}` (GET with bracket-style query params is supported as an alternative to POST-with-JSON-body; prefer GET to match the established GET-only pattern in this codebase).
- Auth: **no API key** — but an `appname` query parameter is mandatory (identifies the calling application for ReliefWeb's own monitoring; **as of 2025-11-01 ReliefWeb requires appnames to be pre-approved** — an arbitrary string is no longer guaranteed to work, though ReliefWeb's docs don't describe a hard-blocking mechanism for unregistered names as of this research pass). Env: `RELIEFWEB_APPNAME` (required — a Commander-chosen identifying string, requested via ReliefWeb's contact process per their Nov 2025 policy change; treat as a required "credential-like" env var even though it's not secret).
- Response fields: `data[]` with `id`, `fields: { title, url, url_alias, date: { original, created }, source: [ { name } ], format: [ { name } ], primary_country: { name }, body }`.
- Stable record id: `id` (ReliefWeb internal report id, numeric).
- Rate limit: max 1,000 results per call, max 1,000 calls/day (documented).

## Cross-cutting notes

- Congress.gov and GovInfo both ride api.data.gov's key infrastructure — same signup flow (https://api.data.gov/signup/), but treat as two independent required env vars since they're independently revocable.
- SEC EDGAR and ReliefWeb are the only two of these six with **no real credential** — both should build out to `LIVE_IMPLEMENTED` candidates once live-tested, same tier as arxiv/wikidata/usgs_earthquake.
- ORCID is the one genuine `IMPLEMENTED_CREDENTIAL_BLOCKED` in this batch — build the full OAuth-token-fetch + search adapter, but it cannot reach `LIVE_IMPLEMENTED` without a Commander-registered `ORCID_CLIENT_ID`/`ORCID_CLIENT_SECRET`.
- Census, Congress.gov, and GovInfo are `IMPLEMENTED_CREDENTIAL_BLOCKED` (Census technically works unauthenticated as this codebase's `pendingWhenUnconfigured` pattern already models for NCBI/Semantic Scholar — recommend treating Census the same way: optional key, works unauthenticated at a lower rate).
