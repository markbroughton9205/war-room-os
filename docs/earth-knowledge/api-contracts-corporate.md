# API contracts — government/corporate transparency batch (Checkpoint 4)

## 1. Open Contracting Partnership / OCDS Data Registry

**Verdict: do not build a dedicated adapter — this is a discovery/bulk-download portal, not a unified query API.**

- `data.open-contracting.org` is a search-and-discovery tool over ~50+ independent national/city OCDS publishers. It helps a human find and download whole datasets (JSON/Excel/CSV bulk files) per publisher — it does **not** expose one unified REST search API across all publishers' live contracting data.
- Individual publishers use heterogeneous access methods themselves — some have their own REST APIs (e.g. Montréal, Italy's infrastructure ministry), most are bulk-file-only. There is no single host/endpoint contract that represents "OCDS" as a whole.
- Correct classification: **BULK_ONLY** (federated discovery layer over per-publisher bulk files), not MISSING and not a fake unified API. If OCDS-sourced procurement data is wanted later, the right move is a dedicated adapter against one specific national publisher's own REST API (e.g. `usaspending.gov`, already a separate registry candidate) — not against the registry itself.

## 2. OpenSanctions API

- Host to allowlist: `api.opensanctions.org`
- Endpoint: `GET /search/{dataset}?q={text}&limit={n}` — `{dataset}` is a required path segment; use `default` for the merged cross-database search scope (documented explicitly: "a collection of sources (e.g. `sanctions`, `peps` or `default`)").
- Auth: **required.** `Authorization: ApiKey <key>` header (confirmed exact header name/format from official docs). Free for non-commercial use (journalism/civil-society/academic — sign up for a free key), pay-as-you-go metered billing for commercial use above a free allowance. No unauthenticated tier — a key is always required, even the free one.
- Response fields (from OpenAPI spec): per result — `id` (stable entity ID), `caption` (display name), `schema` (entity type, e.g. `Person`/`Company`/`Sanction`), `properties` (key-value attributes), `datasets` (source dataset membership), `first_seen`, `last_seen`, `last_change` (timestamps), `target` (boolean — true if this is a sanctioned/watchlisted entity vs. a peripheral/related record).
- Canonical URL: `https://www.opensanctions.org/entities/{id}/`.
- Env var: `OPENSANCTIONS_API_KEY` (required).
- Not independently live-confirmed this pass (no key available) — field names are from the official OpenAPI spec, which is authoritative but should get one real live-verification pass once a Commander registers a key.

## 3. UK Companies House API

- Host to allowlist: `api.company-information.service.gov.uk`
- Endpoint: `GET /search/companies?q={text}&items_per_page={n}`
- Auth: **required.** HTTP Basic Authentication — API key as the username, password left blank (confirmed live convention: `curl -u {API_KEY}: https://api.company-information.service.gov.uk/...`). Free registration at the Companies House Developer Hub (register an application as an "API Key" type), no approval gate, standard signup.
- Response fields (per the long-stable, well-documented public schema — not independently re-fetched live this pass since a key is required): `items[]` each with `company_number` (stable ID), `title` (company name), `company_status` (e.g. `active`/`dissolved`), `company_type`, `date_of_creation`, `address_snippet`, `description`.
- Canonical URL: `https://find-and-update.company-information.service.gov.uk/company/{company_number}`.
- Env var: `COMPANIES_HOUSE_API_KEY` (required).
- Rate limit: documented 600 requests per 5-minute window per key.

## Summary

OpenSanctions and Companies House are both real, well-documented, genuinely machine-queryable REST APIs — build both adapters, but they ship as `IMPLEMENTED_CREDENTIAL_BLOCKED` (neither has a usable unauthenticated tier). OCDS/Open Contracting is **not** a unified API and should not get a dedicated adapter — correctly classify it as `BULK_ONLY` in the completion registry rather than building a fake wrapper or leaving it MISSING.
