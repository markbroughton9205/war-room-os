# API contracts — EPSS + OTX (Checkpoint 3: cyber evidence-class sources)

Adds the two remaining cyber evidence classes this codebase's mission wants distinguished:
PREDICTED_EXPLOITABILITY (EPSS) and COMMUNITY_REPORTED (OTX), alongside the existing
VULNERABILITY_EXISTS (osv_dev) and CONFIRMED_EXPLOITED (cisa_kev / nvd's mirrored field).

## 1. FIRST EPSS API

- Host to allowlist: `api.first.org`
- Endpoint: `GET /data/v1/epss?cve={cveId}` — also accepts a comma-separated batch: `?cve=CVE-A,CVE-B` (confirmed live, both single and 2-CVE batch return correct per-CVE rows). Optional `envelope` isn't needed; other documented params include `date` (historical score for a specific day) and `percentile-gt`/`epss-gt` filters — not required for a basic lookup.
- Auth: **none**. Fully public, no key, `"access":"public"` in the response envelope itself.
- Response format: JSON. Confirmed live: `{"status":"OK","status-code":200,"version":"1.0","access":"public","total":1,"offset":0,"limit":100,"data":[{"cve":"CVE-2021-44228","epss":"0.999990000","percentile":"1.000000000","date":"2026-08-23"}]}`. `epss` and `percentile` are both **decimal strings** (not numbers) in the range 0–1 — must be parsed with `Number()`, not assumed numeric.
- Stable ID: `cve` (the CVE ID itself; EPSS has no separate record ID — one row per CVE per day).
- Canonical URL: no EPSS-specific human page exists; use `https://nvd.nist.gov/vuln/detail/{cve}` (same convention as this codebase's existing `nvd`/`cisa_kev` adapters) or the FIRST EPSS calculator `https://www.first.org/epss/`.
- Rate limit: no documented hard numeric cap for the public API; be a well-behaved client (single concurrency, timeout) per FIRST's general etiquette.
- Evidence class: every EPSS record is, by definition, **PREDICTED_EXPLOITABILITY** (a 0–1 probability model output, explicitly not an observation of actual exploitation) — must never be conflated with `cisa_kev`'s CONFIRMED_EXPLOITED or `osv_dev`'s VULNERABILITY_EXISTS.
- Example confirmed live (2 separate live fetches): `GET https://api.first.org/data/v1/epss?cve=CVE-2021-44228` → `epss: "0.999990000"`; `GET .../epss?cve=CVE-2021-44228,CVE-2021-45046` → both rows returned correctly, `total: 2`.

## 2. AlienVault OTX (Open Threat Exchange) — now branded LevelBlue OTX

- Host to allowlist: `otx.alienvault.com` (the brand has moved to "LevelBlue" after AT&T's cybersecurity divestiture, but the API host and `otx.alienvault.com` domain are still the live, documented endpoint — confirmed via the official external-API doc page still being served from that host).
- Endpoint: `GET /api/v1/search/pulses?q={text}&limit={n}&page={n}` — searches all public community-contributed "pulses" (threat reports bundling indicators), not just the caller's subscribed ones (`/api/v1/pulses/subscribed` is a different, personal-feed endpoint — not used here since it requires a specific analyst's subscriptions, not a general search).
- Auth: **required header `X-OTX-API-KEY`** for reliable/full-rate use — confirmed exact header name from official docs and SDK examples (`curl ... -H "X-OTX-API-KEY: <key>"`). Free registration at otx.alienvault.com (no approval gate, standard signup). Documented rate tiers: **1,000 requests/hour unauthenticated, 10,000/hour with a key** — this implies at least some read endpoints tolerate unauthenticated calls at a lower rate, but this was not independently re-confirmed via a live unauthenticated call this research pass (no safe way to test the exact unauthenticated-vs-required boundary without a key in hand) — **recommend treating `OTX_API_KEY` as required** for this adapter rather than assuming the unauthenticated tier covers `/search/pulses` specifically, consistent with a fail-honest posture.
- Response format: JSON. Documented pulse fields: `id` (stable pulse ID), `name` (title), `description`, `author` (object: `username`, etc.), `created`, `modified` (dates), `tags[]`, `indicators[]` (each indicator has its own `indicator` value + `type`, e.g. IP/domain/hash/CVE), `TLP` (Traffic Light Protocol classification), `public` (bool), `subscriber_count`.
- Stable ID: pulse `id`.
- Canonical URL: `https://otx.alienvault.com/pulse/{id}`.
- Evidence class: OTX pulses are **COMMUNITY_REPORTED** — analyst-submitted, not vendor-confirmed or model-predicted; distinct from all three other cyber evidence classes already in this codebase.

## Flags / uncertainty

- **EPSS**: fully confirmed live this pass (2 real fetches, single + batch), no uncertainty.
- **OTX**: could not make a live authenticated test call (no `OTX_API_KEY` available in this research context) — field names and the search-pulses endpoint path are from official documentation and the SDK examples, not independently live-confirmed against a real response body. This is a genuine `IMPLEMENTED_CREDENTIAL_BLOCKED` candidate: build the adapter against the documented contract, mark `OTX_API_KEY` as required, and flag that the exact response shape should get one real live-verification pass once a Commander registers a key.
