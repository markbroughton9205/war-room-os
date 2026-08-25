# API contracts — software bugs/advisories batch (Checkpoint 3)

All confirmed live via direct `curl` during this research pass (not just docs).

## 1. GitHub Advisory Database (GHSA)

- Host to allowlist: `api.github.com` (same host as the existing `github` adapter)
- Endpoint: `GET /advisories?ecosystem={eco}&per_page={n}` (ecosystem e.g. `npm`, `pip`, `rubygems`, `maven`, `go`, `composer`, `nuget`; optional `affects={package}` to scope to one package)
- Auth: **optional**. Unauthenticated: 60 requests/hour (confirmed live via `x-ratelimit-limit: 60` header). With the same `GITHUB_TOKEN` bearer token War Room's existing `github` adapter already uses (`Authorization: Bearer {token}` or `token {token}`), the standard authenticated GitHub REST rate limit applies (5,000/hour) — same token, same host, no new credential needed.
- Response format: JSON array. Confirmed live fields per advisory: `ghsa_id` (stable ID), `cve_id`, `summary`, `description`, `severity` (`low`/`medium`/`high`/`critical`), `cvss` (`{vector_string, score}` — often `null` for GHSA-native advisories without an NVD-assigned CVSS), `cvss_severities`, `published_at`, `updated_at`, `withdrawn_at` (non-null = advisory retracted), `html_url` (canonical URL), `vulnerabilities[]` (`{package: {ecosystem, name}, vulnerable_version_range, first_patched_version}`), and — **confirmed live, not in older docs** — `epss` (`{percentage, percentile}`), GitHub's own mirrored FIRST.org EPSS score.
- Evidence classes present in one response: a non-null `withdrawn_at` is a retraction signal; `epss.percentage` is a genuine **PREDICTED_EXPLOITABILITY** score (0-1 probability); presence of the advisory itself (not withdrawn) is **VULNERABILITY_EXISTS**/community-confirmed (GHSA advisories are curated, not just reported — closer to COMMUNITY_REPORTED than raw OSV, since GitHub Security Lab or the ecosystem maintainer reviews them). Distinct from `cisa_kev`'s CONFIRMED_EXPLOITED and `nvd`'s mirrored KEV field.
- Canonical URL: `html_url` field, e.g. `https://github.com/advisories/GHSA-66mm-25pp-rfff`.
- Rate limit: 60/hr unauthenticated, 5,000/hr with the existing `GITHUB_TOKEN`.
- Example confirmed live: `GET https://api.github.com/advisories?ecosystem=npm&per_page=1` → `ghsa_id: "GHSA-66mm-25pp-rfff"`, `severity: "critical"`, `epss: {percentage: 0.00508, percentile: 0.41336}`.

## 2. Go Vulnerability Database (vuln.go.dev)

- **Verdict: DUPLICATE_COVERAGE — do not build a dedicated adapter.** Confirmed live: `POST https://api.osv.dev/v1/query` with `{"package":{"name":"github.com/gin-gonic/gin","ecosystem":"Go"},"version":"1.6.0"}` returns real Go vulnerabilities (e.g. `GHSA-2c4m-59x9-fr2g`) — Go's vulnerability database is fully OSV-schema-native and already queryable through War Room's existing `osv_dev` adapter simply by passing `ecosystem: "Go"` (the adapter's query-text format `"<ecosystem>:<name>[@<version>]"` already supports this — e.g. `"Go:golang.org/x/text@0.3.6"`).
- The native `vuln.go.dev` site is a separate static index+per-ID-JSON-file structure (`GET https://vuln.go.dev/index/vulns.json` — full index, confirmed live 200 with `{id, modified, aliases}` per entry; `GET https://vuln.go.dev/ID/{id}.json` — confirmed live, same OSV-schema shape `{schema_version, id, modified, published, aliases, summary, details, affected}`). This is a real, legitimate access mechanism (BULK_ONLY-shaped: fetch-the-index-then-filter, no server-side query param), but functionally redundant with the live OSV.dev query already implemented — building a second adapter here would duplicate the same underlying data for no new capability.

## 3. endoflife.date API

- Host to allowlist: `endoflife.date`
- Endpoint: `GET /api/{product}.json` (product-slug-addressed, e.g. `python`, `nodejs`, `ubuntu` — not free-text search). `GET /api/all.json` returns the full list of ~380 valid product slugs (confirmed live), usable as a client-side keyword→slug lookup the same way this codebase's `eurostat`/`who_gho` adapters resolve a keyword to a dataset/indicator code.
- Auth: **none**, fully public, no key.
- Response format: JSON array of version-cycle objects. Confirmed live fields (querying `python`): `cycle` (e.g. `"3.14"`), `releaseDate`, `eol` (end-of-life date or `false`), `latest` (latest patch version), `latestReleaseDate`, `support` (end-of-support date), `lts` (boolean). No stable numeric ID field — synthesize one from `{product}:{cycle}`. No canonical URL field in the JSON; the documented stable human page is `https://endoflife.date/{product}`.
- Rate limit: no documented hard numeric cap; served from a Netlify CDN edge (fast, cached).
- Example confirmed live: `GET https://endoflife.date/api/python.json` → first entry `cycle: "3.14"`, `eol: "2030-10-31"`, `latest: "3.14.7"`.

## Summary

GHSA and endoflife.date are both genuinely public, ready-to-build `LIVE_IMPLEMENTED` candidates — GHSA reuses War Room's existing `GITHUB_TOKEN` (no new credential), endoflife.date needs none at all. Go Vulnerability Database should **not** get a dedicated adapter — it is DUPLICATE_COVERAGE with the already-implemented `osv_dev` provider (`ecosystem: "Go"`); record it as such in the completion registry rather than building redundant code.
