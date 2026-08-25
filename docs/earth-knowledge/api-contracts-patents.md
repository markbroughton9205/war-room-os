# API contracts — patents batch (Checkpoint 6)

## 1. EPO OPS (European Patent Office Open Patent Services)

- Host to allowlist: `ops.epo.org`
- Auth: **required**, OAuth2 `client_credentials` grant. Register a free "Non-paying" developer account at the EPO Developer Portal (https://developers.epo.org) to get a consumer key/secret.
  - Token endpoint: `POST https://ops.epo.org/3.2/auth/accesstoken` — standard OAuth2 client_credentials request (`grant_type=client_credentials` form-encoded body, `Authorization: Basic base64(consumer_key:consumer_secret)` header). Returns a bearer token.
  - **Token expires every 20 minutes** — short-lived, must be cached and refreshed (module-level cache pattern, same as this codebase's `orcid` adapter).
  - Env vars: `EPO_OPS_CONSUMER_KEY`, `EPO_OPS_CONSUMER_SECRET` (both required).
- Base REST URL: `https://ops.epo.org/3.2/rest-services`
- Search endpoint: `GET /published-data/search?q={CQL}&Range={start}-{end}` (also has a `constituent` path segment variant, e.g. `/published-data/search/biblio?q=...`, to scope the response to bibliographic data only — recommended over the full default which is heavier).
- CQL query syntax: field-coded, e.g. `ti=electric AND pa=tesla` (`ti`=title, `ab`=abstract, `pa`=applicant, `AND`/`OR`/`NOT` boolean operators). A caller's free-text should be mapped to `ti={text}` for a title search, with any embedded `=`/quote characters stripped or escaped to prevent CQL injection (no bind-parameter mechanism, same class of concern as this codebase's ADQL/OData string-literal escaping already used for `nasa_exoplanet_archive`/`simbad`/`copernicus_dataspace`).
- **Response format: XML only** — no JSON option documented or found. Top-level wrapper `<world-patent-data>`, nested biblio records under `<exchange-documents>` /`<exchange-document>` per the EPO exchange-format schema; exact leaf element names for publication number/title/date were not independently confirmed live this pass (no credentials available to make a real authenticated call) — **flag for a live-verification pass once a Commander registers EPO_OPS_CONSUMER_KEY/SECRET**, since parsing will need this codebase's `xmlLite.ts` helpers and the exact tag names should be confirmed against a real response before shipping, not assumed from secondary docs.
- Stable ID: publication/document number (format varies, e.g. `EP1000000A1`).
- Canonical URL: `https://worldwide.espacenet.com/patent/search/family/.../publication/{docNumber}` — Espacenet is EPO's public search UI; exact URL pattern not independently confirmed this pass.
- Rate limit: documented per-hour/per-week quotas for the free "Non-paying" tier (specific numbers not independently confirmed this pass — check the developer portal at registration time).

## 2. PatentsView API

- **Verdict: DISCONTINUED, do not build a dedicated adapter.** Confirmed live this pass:
  - DNS lookup for `search.patentsview.org` and `api.patentsview.org` (the historical API hosts) both **fail to resolve** (NXDOMAIN) — the root domain `patentsview.org` itself still resolves fine, ruling out a general network issue.
  - `https://patentsview.org/apis/purpose` (the official API docs entry point) now returns a **301 permanent redirect** to `https://data.uspto.gov/support/transition-guide/patentsview` — USPTO's own "transition guide" page for PatentsView, confirming an official, permanent migration away from the standalone PatentsView API.
  - The redirect target is USPTO's **Open Data Portal (ODP)** — the exact same successor system this codebase's existing `uspto` provider is already declared against (currently `STUB_ONLY` per `config/providerEnv.ts`, not yet implemented).
- **This means PatentsView is not a distinct source needing its own adapter — it has been fully absorbed into the `uspto` provider's scope.** Classify the registry's "PatentsView" row as `DISCONTINUED`, with a note pointing to the existing `uspto` stub as its successor; do not build a redundant adapter, and do not mark it MISSING (it isn't missing, it's gone). If/when the existing `uspto` STUB_ONLY provider gets implemented against USPTO's real ODP API, that adapter inherently supersedes PatentsView's former functionality too.
- The transition guide page itself (`data.uspto.gov/support/transition-guide/patentsview`) is a JS-rendered Angular SPA behind an AWS WAF challenge script — its actual migration-guide content (e.g. old-query-to-new-API field mapping) could not be extracted via a plain HTTP fetch this pass; a headless-browser fetch would be needed to read the full guide text, not attempted here since the DISCONTINUED verdict for PatentsView itself doesn't depend on it.

## Summary

EPO OPS is a real, legitimate, credential-required source — build it as `IMPLEMENTED_CREDENTIAL_BLOCKED` (OAuth2 client_credentials, 20-minute token TTL, XML-only responses, exact biblio field names need one live-verification pass once real credentials exist). PatentsView is **not** a build target this checkpoint — it is officially discontinued and redirects to USPTO's ODP, the same system War Room's existing (stub) `uspto` provider already targets. Recommend the completion registry record PatentsView as `DISCONTINUED` with `uspto` referenced as its successor, and that a future checkpoint prioritize actually implementing the `uspto` stub over building anything new for PatentsView.
