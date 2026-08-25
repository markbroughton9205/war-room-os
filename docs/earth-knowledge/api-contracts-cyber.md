# API contracts — cybersecurity sources (OSV.dev, NVD, CISA KEV)

Researched directly from official docs for adapter-writing purposes. Exact field names below.

## 1. OSV.dev

- Host to allowlist: `api.osv.dev` (https only)
- Endpoint: `POST https://api.osv.dev/v1/query`
- Auth: none (public, no key)
- Rate limits: not publicly documented/enforced by a published number — be conservative (client-side throttle).
- Request body (JSON), one of:
  - `{ "commit": "<sha>" }`
  - `{ "version": "<version>", "package": { "name": "<pkg>", "ecosystem": "<eco>" } }` (ecosystem e.g. `PyPI`, `npm`, `Go`, `crates.io`, `Maven`, `RubyGems`, `NuGet`)
  - `{ "package": { "purl": "pkg:npm/left-pad@1.3.0" } }`
  - Use either `version` or a versioned `purl`, never both — 400 if violated.
  - Optional `page_token` for pagination (returned as `next_page_token` when >1000 results or query takes >20s).
- Response body:
  ```json
  { "vulns": [ {
      "id": "OSV-2021-1234",
      "summary": "string",
      "details": "string",
      "modified": "RFC3339 timestamp",
      "published": "RFC3339 timestamp",
      "aliases": ["CVE-2021-XXXXX"],
      "references": [ { "type": "ADVISORY", "url": "https://..." } ],
      "affected": [ {
        "package": { "name": "string", "ecosystem": "string", "purl": "string" },
        "ranges": [ { "type": "ECOSYSTEM|SEMVER|GIT", "repo": "string", "events": [ { "introduced": "string", "fixed": "string" } ] } ],
        "versions": ["string"],
        "database_specific": {},
        "ecosystem_specific": {}
      } ],
      "severity": [ { "type": "CVSS_V3", "score": "CVSS:3.1/..." } ],
      "schema_version": "string"
    } ],
    "next_page_token": "string"
  }
  ```
- Evidence class: OSV records are `VULNERABILITY_EXISTS` (community/ecosystem-reported vulnerability data) — no exploitation-status field. There is no separate `/v1/querybatch` needed for a single-query adapter.
- Canonical URL for a record: `https://osv.dev/vulnerability/{id}`.
- Stable ID: `id` (e.g. `GHSA-...`, `OSV-...`, `PYSEC-...`); `aliases[]` often includes the CVE ID.

## 2. NVD CVE API 2.0

- Host to allowlist: `services.nvd.nist.gov` (https only)
- Endpoint: `GET https://services.nvd.nist.gov/rest/json/cves/2.0`
- Auth: optional `apiKey` **header** (not query param). Unauthenticated: 5 requests / rolling 30s window. With `apiKey` header: 50 requests / rolling 30s window. NIST recommends spacing requests regardless.
- Key query params: `cveId` (single, e.g. `CVE-2024-1234`), `keywordSearch` (free text against description), `cveIds` (comma list, max 100, newer param — `cveId` still works for single lookups), `pubStartDate`/`pubEndDate` and `lastModStartDate`/`lastModEndDate` (ISO-8601, max 120-day span, must be paired), `cvssV3Severity` (LOW/MEDIUM/HIGH/CRITICAL), `cweId`, `hasKev` (flag — filter to CISA KEV-listed CVEs only), `startIndex`, `resultsPerPage` (max 2000, default 2000).
- Response shape:
  ```json
  { "resultsPerPage": 20, "startIndex": 0, "totalResults": 1,
    "vulnerabilities": [ { "cve": {
      "id": "CVE-2024-1234",
      "published": "2024-01-01T00:00:00.000",
      "lastModified": "2024-01-02T00:00:00.000",
      "vulnStatus": "Analyzed",
      "descriptions": [ { "lang": "en", "value": "string" } ],
      "metrics": { "cvssMetricV31": [ { "cvssData": { "baseScore": 9.8, "baseSeverity": "CRITICAL", "vectorString": "CVSS:3.1/..." } } ] },
      "references": [ { "url": "https://...", "source": "string" } ],
      "cisaExploitAdd": "2024-01-05",
      "cisaActionDue": "2024-01-26",
      "cisaRequiredAction": "string",
      "cisaVulnerabilityName": "string"
    } } ]
  }
  ```
- Evidence classes present natively in one response: `cisaExploitAdd` non-null → `CONFIRMED_EXPLOITED` (NVD mirrors CISA KEV status inline); absence of that field but presence of a CVE record → `VULNERABILITY_EXISTS`; NVD has no EPSS/predicted-exploitability field itself (EPSS is a separate FIRST.org API, not in scope here) — do not fabricate a `PREDICTED_EXPLOITABILITY` value from NVD data.

## 3. CISA KEV catalog

- Confirmed current URL: `https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json`
- Host to allowlist: `www.cisa.gov`
- Access mechanism: static bulk JSON file (not a query API) — `GET`, no params, no auth, refreshed by CISA periodically (typically daily). This is a `BULK_ONLY`-shaped source: fetch whole file, filter client-side.
- Top-level shape: `{ "title": "string", "catalogVersion": "YYYY.MM.DD", "dateReleased": "RFC3339", "count": <int>, "vulnerabilities": [ {...} ] }`
- Per-entry fields: `cveID`, `vendorProject`, `product`, `vulnerabilityName`, `dateAdded` (YYYY-MM-DD), `shortDescription`, `requiredAction`, `dueDate` (YYYY-MM-DD), `knownRansomwareCampaignUse` ("Known"|"Unknown"), `notes`, `cwes` (array of CWE IDs).
- Evidence class: every entry in this catalog is by definition `CONFIRMED_EXPLOITED` (that is the entire meaning of KEV membership) — this is the strongest of the four cyber evidence classes and should be tagged as such distinctly from NVD's `cisaExploitAdd` mirror field.
- Because the whole file must be downloaded and filtered client-side (no server-side query params), an adapter should cache the parsed catalog and filter in-memory by CVE ID / vendor / product substring per request, capping response size the same way other bulk-shaped sources in this codebase do.

Uncertain / flag for adapter author: OSV.dev has no documented formal rate limit — treat conservatively (reuse the existing per-provider throttle/backoff pattern already used for arXiv). NVD's `hasKev` param and `cisaExploitAdd` field give partial KEV coverage already, but the mission wants CISA KEV as its own distinct source/adapter regardless (not treated as DUPLICATE_COVERAGE) since it's a different authority tier (Tier A CISA direct feed vs. NVD's mirrored field) and the canonical `CONFIRMED_EXPLOITED` classification source.
