# API contracts — physics/math academic databases batch (Checkpoint 6)

Researched via live HTTP calls during this pass (NASA ADS documented from its official GitHub docs repo — no live call possible without a token).

## 1. INSPIRE-HEP REST API

- Host to allowlist: `inspirehep.net`
- Endpoint: `GET /api/literature?q={text}&size={n}&fields={csv}` — genuine free-text search across high-energy-physics literature.
- Auth: **none required**, fully public, no key.
- Response format: JSON. Confirmed live: `hits.hits[]`, each with `id` (stable numeric control_number, e.g. `819311`), `metadata.titles[]` (`{title, source}`), `metadata.arxiv_eprints[]` (`{value, categories}`), `metadata.earliest_date`, `metadata.publication_info` (when requested via `fields=`), `links.bibtex`/`json`/`json-expanded` (self-referential format links, not a canonical human page). Canonical URL: construct as `https://inspirehep.net/literature/{id}`.
- Rate limit: no documented hard numeric cap for reasonable use.
- Example confirmed live: `GET https://inspirehep.net/api/literature?q=title%20Higgs%20boson&size=1&fields=titles,arxiv_eprints,earliest_date` → `id: "819311"`, title "Higgs boson otherwise", arxiv `0905.0206`.

## 2. HEPData

- Host to allowlist: `www.hepdata.net`
- **Endpoint (confirmed working): `GET /record/{inspireId}?format=json`** — a record-ID lookup (getById-shaped), confirmed live returning real JSON (data tables, DOIs, download links).
- **The `/search/?q=...&format=json` free-text endpoint is blocked by a Cloudflare bot challenge** (confirmed live: returns an HTML "Just a moment..." JS-challenge page, not JSON, even with `format=json` requested) — **no programmatic free-text search is actually accessible**, contrary to what the existence of a `/search/` URL might suggest. Build this adapter as `getById` only (INSPIRE literature ID → HEPData record), not search.
- Auth: none required for the record endpoint.
- Response format: JSON. Confirmed live fields: `data_tables[]` (each with `id`, `name`, `description`, `doi`, `data.{csv,json,yaml,root,yoda}` download links), `breadcrumb_text` (author-list-style string, usable as a title fallback), `access_count.sum`.
- Rate limit: **60 requests/hour** (confirmed via live `x-ratelimit-limit: 60` response header) — notably low, keep this adapter's calls sparing.
- No stable free-text search path exists — record it as `getById`-only capability, not oversold as `search`.

## 3. zbMATH Open API

- Host to allowlist: `api.zbmath.org`
- Endpoint: `GET /v1/document/_search?search_string={text}&results_per_page={n}` — genuine free-text search.
- Auth: **none required**, fully public, no key.
- Response format: JSON. Confirmed live: top-level `result[]` + `status`. Per document: `id` (internal numeric id), `identifier` (stable zbMATH identifier, e.g. `"0688.10043"` — the actual stable/citable id, prefer this over the internal numeric `id`), `title.title`, `contributors.authors[]` (`{name, codes, aliases}`), `year`, `language`, `zbmath_url` (canonical URL), `keywords[]`, `msc` (Mathematics Subject Classification codes).
- Rate limit: no documented hard numeric cap for reasonable use.
- Example confirmed live: `GET https://api.zbmath.org/v1/document/_search?search_string=prime+numbers&results_per_page=1` → `identifier: "0688.10043"`, title "On prime-additive numbers", authors Erdős/Hegyvári.

## 4. OEIS (Online Encyclopedia of Integer Sequences)

- Host to allowlist: `oeis.org` — **the main host works fine and is NOT degraded**; only the separate `api.oeis.org` subdomain (mentioned in the registry) appears to be a deprecated/unmaintained alias — use `oeis.org` directly.
- Endpoint: `GET /search?q={text}&fmt=json` — free-text or sequence-data search (comma-separated number lists work directly as the query).
- Auth: **none required**, fully public, no key.
- Response format: JSON array (top-level bare array, no wrapper object). Confirmed live: each entry has `number` (stable sequence number, e.g. `45`), `id` (legacy M-number/N-number), `data` (comma-separated sequence values as one string), `name` (description/title), `comment[]`, `formula[]`, `author`, `references`. Canonical URL: `https://oeis.org/A{number padded to 6 digits}` (e.g. `A000045`).
- Rate limit: no documented hard numeric cap; be a well-behaved single-concurrency client.
- Example confirmed live: `GET https://oeis.org/search?q=1,1,2,3,5,8&fmt=json` → `number: 45`, name "Fibonacci numbers: F(n) = F(n-1) + F(n-2)...".

## 5. NASA ADS (Astrophysics Data System) API

- Host to allowlist: `api.adsabs.harvard.edu`
- Endpoint: `GET /v1/search/query?q={text}&fl={csv}` — genuine free-text search (Solr-syntax query language).
- Auth: **required**. `Authorization: Bearer <token>` header (exact format confirmed from ADS's own GitHub docs repo, `adsabs/adsabs-dev-api`). Token obtained free via: (1) create an account and log in at ui.adsabs.harvard.edu, (2) click "Generate a new key" under user profile → API Token settings (`https://ui.adsabs.harvard.edu/#user/settings/token`) — self-service, no approval gate.
- Response format: JSON (Solr-response-shaped). Confirmed from docs: `response.docs[]`, each with `bibcode` (the stable ADS record identifier, e.g. `"2011ApJ...737..103S"` — used for both `fl=` requests and as the canonical id), plus any other requested `fl=` fields (`title`, `author[]`, `abstract`, `year`, `pub`, `doi[]`). Canonical URL: `https://ui.adsabs.harvard.edu/abs/{bibcode}/abstract`.
- Rate limit: **documented per-endpoint quota, default commonly 5,000 queries/day per token** — exact remaining/limit/reset values are returned in `X-RateLimit-Limit`/`X-RateLimit-Remaining`/`X-RateLimit-Reset` response headers (confirmed from docs, not independently live-tested since no token is available in this research context).
- Env var: `NASA_ADS_API_TOKEN` (required).
- Not independently live-confirmed this pass (no token available) — endpoint path, auth header format, and the `bibcode` field name are all confirmed directly from ADS's own official GitHub documentation repository (`adsabs/adsabs-dev-api`), which is authoritative, not guessed.

## Summary

INSPIRE-HEP, zbMATH, and OEIS are all genuinely public, zero-auth, confirmed-live `LIVE_IMPLEMENTED` candidates with real field names verified via direct HTTP calls this pass. **HEPData has a real, working record-lookup endpoint (`getById` by INSPIRE ID, confirmed live) but its free-text search endpoint is blocked by a Cloudflare bot challenge** — build as `getById` only, do not oversell as `search`; also respect its low 60 req/hour rate limit. **NASA ADS requires a free, no-approval-gate Bearer token** — build as `IMPLEMENTED_CREDENTIAL_BLOCKED` until a Commander registers one at ui.adsabs.harvard.edu; contract is confirmed from ADS's own authoritative GitHub docs repo, not guessed. No commercial gating or unresolvable blockers for any of the 5.
