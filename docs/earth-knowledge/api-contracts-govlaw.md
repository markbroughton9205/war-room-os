# API contracts — government/law batch (Checkpoint 4)

Researched via live HTTP fetches against real endpoints during this research pass.

## 1. US Federal Register API

- Host to allowlist: `www.federalregister.gov`
- Endpoint: `GET /api/v1/documents.json?conditions[term]={text}&per_page={n}` — genuine free-text search across federal regulatory documents.
- Auth: **none required**, fully public, no key.
- Response format: JSON. Confirmed live top-level: `count`, `total_pages`, `next_page_url`, `results[]`. Per result: `document_number` (stable ID, e.g. `"2026-11091"`), `title`, `type` (`Proposed Rule`/`Rule`/`Notice`), `abstract`, `html_url` (canonical URL), `pdf_url`, `publication_date`, `agencies[]` (`{raw_name, name, id, slug}`), `excerpts` (search-match snippet).
- Canonical URL: `html_url`.
- Rate limit: no documented hard numeric cap; standard fair-use, no key/registration.
- Stable ID: `document_number`.

## 2. USAspending API

- Host to allowlist: `api.usaspending.gov`
- Auth: **none required** — confirmed via official docs: "Endpoints do not currently require any authorization."
- Most useful GET-based (no complex POST body) endpoints confirmed from docs:
  - `GET /api/v2/awards/{awardId}/` — single award detail by award ID (getById-shaped)
  - `GET /api/v2/references/toptier_agencies/` — list of federal agencies (useful for a keyword→agency lookup, same pattern as this codebase's eurostat/who_gho adapters)
  - `GET /api/v2/agency/{toptierAgencyCode}/awards/` — agency spending summary
  - Free-text award search itself lives on `POST /api/v2/search/spending_by_award/` (JSON body with `filters`/`fields` — a heavier POST-body shape, matches this codebase's existing osv_dev/rcsb_pdb POST pattern) — recommend building against this for a real search-shaped adapter rather than the narrower GET endpoints, since none of the GET endpoints support free-text search.
- Rate limit: no documented hard numeric cap for reasonable use.
- Stable ID: `generated_unique_award_id` (returned in spending_by_award results, per docs) or the numeric award ID for the /awards/{id}/ endpoint.
- Canonical URL: `https://www.usaspending.gov/award/{award_id}`.

## 3. OFAC Sanctions Lists (US Treasury Sanctions List Service / SLS)

- **This is genuinely BULK_ONLY, not a REST search API** — confirmed live. Host `sanctionslistservice.ofac.treas.gov` exposes a file-listing/download service, not a query endpoint.
- Confirmed live: `GET https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV` returns an HTTP 302 redirect to a **dynamic, pre-signed AWS S3 URL** (`*.s3.us-gov-west-1.amazonaws.com`, with `X-Amz-Expires=3600` — a 1-hour-expiring signed URL, different bucket/token every call).
- **Architectural friction for this codebase specifically**: War Room's existing `safeProviderFetch` redirect-following logic only follows redirects to hosts already on that provider's fixed host-allowlist (a deliberate SSRF protection — see `security/hostAllowlist.ts`). OFAC's redirect target is a dynamic, per-request S3 URL that cannot be pre-allowlisted as a fixed hostname. Building this adapter would require either (a) a new "follow one redirect to any HTTPS S3 host matching a bucket-name pattern" exception to the existing security model (a real security-relevant design decision, not a small code change), or (b) OFAC's separate `/api/sanctions-lists` endpoint (list of available files/metadata, confirmed to exist per docs, not independently live-fetched this pass) as a lighter-weight alternative that may not require following the redirect at all.
- Recommend: do **not** build this adapter in this checkpoint without a deliberate decision on the redirect-allowlist question — record as `BULK_ONLY` with this exact blocker documented, rather than forcing a fragile or security-loosening implementation.
- No auth required for any of this; free, no key.

## 4. UK legislation.gov.uk API

- Host to allowlist: `www.legislation.gov.uk`
- Endpoint: `GET /search/data.feed?title={text}` — Atom/XML feed, genuine free-text search (also supports faceted params like `type=`, `year=`).
- Auth: **none required**, fully public, no key.
- Response format: **Atom XML**, not JSON. Confirmed live: feed-level `openSearch:totalResults`, `leg:page`, `leg:morePages`. Per `<entry>`: `id` (stable URI, e.g. `http://www.legislation.gov.uk/id/eudn/2020/1745`), `title`, `link` (multiple `rel=` variants: self/alternate formats XML/RDF/HTML/PDF/CSV), `updated`, `published`, `ukm:DocumentMainType`, `ukm:Year`, `ukm:Number`, `summary`.
- Parsing: this codebase's existing `xmlLite.ts` tag-extraction helpers should cover this shape reasonably well (flat entry/content-style tags), similar to the `arxiv` adapter's Atom parsing — no need for a fully custom parser like `medlineplus.ts` needed.
- Canonical URL: the `id` field itself is a stable, dereferenceable URI; or construct the human HTML page via the `link rel="alternate" type="text/html"` entry.
- Rate limit: no documented hard numeric cap; standard fair-use expected.
- Stable ID: the `id` URI (e.g. `http://www.legislation.gov.uk/id/eudn/2020/1745`).

## Summary

3 of 4 are genuinely public, ready-to-build `LIVE_IMPLEMENTED` candidates (Federal Register, USAspending, legislation.gov.uk — all live-confirmed, no auth). **OFAC Sanctions Lists is a real, legitimate BULK_ONLY source but has a genuine architectural blocker specific to this codebase's redirect-allowlist security model** (dynamic pre-signed S3 redirect target, not a fixed host) — flag as an explicit `EXTERNAL_BLOCKER`/design-decision-pending item rather than building around it unsafely. USAspending's best search capability requires a POST body (`spending_by_award`), matching this codebase's existing POST-JSON pattern (osv_dev, rcsb_pdb, gnomad).
