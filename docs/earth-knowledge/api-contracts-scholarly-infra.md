# API contracts — open scholarly infrastructure batch (Checkpoint 6)

All confirmed live via direct HTTP calls during this research pass (not just docs).

## 1. ROR (Research Organization Registry) API v2

- Host to allowlist: `api.ror.org`
- Endpoint: `GET /v2/organizations?query={text}` — genuine free-text search.
- Auth: **none required**, fully public.
- Response format: JSON. Confirmed live: `number_of_results`, `items[]`. Per item: `id` (stable ROR URI, e.g. `https://ror.org/00f54p054`), `names[]` (array of `{value, lang, types[]}` — types include `ror_display`/`label`/`alias`/`acronym`; the `ror_display` entry is the canonical display name), `links[]` (`{type: "website"|"wikipedia", value}`), `established` (year), `domains[]`, `locations[]`.
- Stable ID: the `id` URI itself (e.g. `https://ror.org/00f54p054`) — also serves as canonicalUrl directly.
- Rate limit: no documented hard numeric cap for reasonable use.
- Example confirmed live: `GET https://api.ror.org/v2/organizations?query=Stanford` → `id: "https://ror.org/00f54p054"`, display name "Stanford University", established 1891.

## 2. OpenCitations Index REST API v2

- Host to allowlist: `opencitations.net`
- Endpoint: `GET /index/api/v2/citation-count/doi:{doi}` — citation-count lookup by DOI (getById-shaped, not free-text search). Other endpoints exist for full citation/reference lists (`/citations/doi:{doi}`, `/references/doi:{doi}`) — not evaluated this pass, citation-count is the simplest bounded entry point.
- **Important: the bare `opencitations.net` host 301-redirects** — confirmed live (`HTTP/1.1 301 Moved Permanently`) to the same path on what resolves as the canonical host after following the redirect; the adapter must either allow-list the final redirected host or follow via `safeProviderFetch`'s existing redirect-following logic (already used by other adapters) rather than treating the redirect as an error.
- Auth: **none required** for basic use; an optional free access token (via their token-request form) raises rate limits — not required for a bounded single-DOI lookup.
- Response format: JSON array. Confirmed live: `GET .../citation-count/doi:10.1038/nature12373` → `[{"count": "1806"}]` — a single-element array with a `count` field (string, not number — parse with `Number()`).
- Stable ID: the DOI itself (no separate numeric record ID for this endpoint).
- Canonical URL: `https://doi.org/{doi}`.
- Rate limit: documented as generous for the free unauthenticated tier; be a well-behaved single-concurrency client.

## 3. bioRxiv / medRxiv API

- Host to allowlist: `api.biorxiv.org`
- Endpoint: `GET /details/{server}/{doi}` (`server` = `biorxiv` or `medrxiv`) — a DOI-keyed detail lookup (getById-shaped), not free-text search. A date-range listing endpoint also exists (`/details/{server}/{start_date}/{end_date}/{cursor}`) for bulk day-by-day harvesting, not used here.
- Auth: **none required**, fully public, no key.
- Response format: JSON. Confirmed live (`GET /details/biorxiv/10.1101/339747`): `messages: [{status: "ok"}]`, `collection: [{title, authors, author_corresponding, author_corresponding_institution, doi, date, version, license, category, jatsxml (URL to full XML), abstract}]`. A DOI with no matching preprint returns `messages: [{status: "no posts found"}]` and an empty `collection` — an honest empty result, not an error.
- Stable ID: `doi`. Canonical URL: `https://www.biorxiv.org/content/{doi}` (or medrxiv.org for that server).
- Rate limit: no documented hard numeric cap for reasonable use.

## 4. HAL Search API (France, archive ouverte)

- Host to allowlist: `api.archives-ouvertes.fr`
- Endpoint: `GET /search/?q={text}&rows={n}&wt=json` — genuine Solr-backed free-text search.
- Auth: **none required**, fully public.
- Response format: JSON (Solr response envelope). Confirmed live: `response.numFound`, `response.docs[]`. Per doc (default field set is minimal — `docid`, `label_s` (a full pre-formatted citation string), `uri_s` (canonical URL, e.g. `https://hal.science/hal-05309397v1`)); a richer field list (title, authors, abstract, publication date as separate fields) is available by adding `&fl=title_s,authorFullName_s,producedDate_s,...` to the query — recommend requesting an explicit field list rather than relying on the default `label_s` blob.
- Stable ID: `docid`, or the `hal-XXXXXXX` id embeddable from `uri_s`.
- Canonical URL: `uri_s` directly.
- Rate limit: no documented hard numeric cap for reasonable use.
- Example confirmed live: `GET https://api.archives-ouvertes.fr/search/?q=climate+change&rows=1&wt=json` → `numFound: 45574`, first doc `uri_s: "https://hal.science/hal-05309397v1"`.

## 5. BASE Search API (Bielefeld Academic Search Engine)

- **Access model has changed from a simple free-signup key — confirmed live this pass.**
- Host: `api.base-search.net`. A live unauthenticated test call (`GET /cgi-bin/BaseHttpSearchInterface.fcgi?func=PerformSearch&query=climate&format=json&hits=1`) returned HTTP 200 with body `{"error": "Access denied for IP address ... and user agent ..."}` — the API enforces an IP-address allowlist per credential, not just an API-key header.
- Their current documentation (base-search.net) states API access requires **submitting an application via a contact form**, after which "within a few days" BASE manually emails an API key — this is an **approval-gated process**, not the free instant self-service signup pattern most other sources in this codebase use (e.g. NOAA CDO, EIA).
- Combined with the confirmed IP-allowlisting enforcement, this is a genuine friction point for a codebase deployed on infrastructure without a single static outbound IP (e.g. typical serverless/cloud hosting) — even with an approved key, the calling server's IP would need to be registered with BASE and kept in sync with any IP changes.
- Recommend classification: `IMPLEMENTED_CREDENTIAL_BLOCKED` at best (build the adapter against the documented contract, since the response shape can be inferred from BASE's interface guide), but flag the IP-allowlisting requirement explicitly as an extra deployment-environment blocker beyond just "get a key" — a Commander should know that a static egress IP may also be needed.

## Summary

ROR, OpenCitations, bioRxiv/medRxiv, and HAL are all genuinely public, zero-auth, confirmed-live sources — ready to build as `LIVE_IMPLEMENTED`. OpenCitations requires following one 301 redirect (`opencitations.net` → canonical host) via the existing redirect-following mechanism, not a hardcoded final host. BASE Search is the one real friction point in this batch: approval-gated key issuance **plus** IP-allowlist enforcement confirmed live — build the adapter for completeness but expect it to stay `IMPLEMENTED_CREDENTIAL_BLOCKED` even after a key is issued unless the deployment has a stable, registerable egress IP.
