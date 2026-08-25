# API contracts — abuse.ch threat-intel batch (Checkpoint 3: cybersecurity)

Researched directly from current abuse.ch docs pages. **Critical finding: abuse.ch changed policy in 2023-2024 — an `Auth-Key` header is now MANDATORY for all three APIs below, for query/read access, not just higher rate limits.** This is a real policy change from the older fully-open era; do not assume unauthenticated access works. All three should ship as `IMPLEMENTED_CREDENTIAL_BLOCKED`, not `LIVE_IMPLEMENTED`, until a Commander registers a free key at https://auth.abuse.ch/ (one account can generate keys for all abuse.ch services).

Evidence class for all three: **COMMUNITY_REPORTED** (abuse.ch is a respected but community/nonprofit-run threat-intel aggregator, not a government-authoritative source like CISA KEV) — keep distinct from `CONFIRMED_EXPLOITED`/`VULNERABILITY_EXISTS`.

## 1. MalwareBazaar API

- Host to allowlist: `mb-api.abuse.ch`
- Base URL: `https://mb-api.abuse.ch/api/v1/`
- Method: **POST only**, form-encoded body
- Auth: **`Auth-Key` HTTP header, mandatory.** Exact doc wording: "In order to interact with the MalwareBazaar API, you need to obtain an `Auth-Key` first" / "Whenever you interact with the MalwareBazaar API, you must include the HTTP header `Auth-Key`." Free signup at auth.abuse.ch.
- Useful query: body `query=get_taginfo&tag={text}&limit={n}` (search by malware family/tag) or `query=get_info&hash={hash}` (lookup by SHA256/MD5/SHA1)
- Response fields (`query_status`, then per-sample): `sha256_hash` (stable id), `md5_hash`, `sha1_hash`, `file_name`, `file_size`, `file_type`, `signature` (malware family name), `first_seen`, `last_seen`, `tags[]`, `intelligence.clamav`
- Canonical URL: `https://bazaar.abuse.ch/sample/{sha256_hash}/`
- Env var: `MALWAREBAZAAR_AUTH_KEY` (required)

## 2. ThreatFox API

- Host to allowlist: `threatfox-api.abuse.ch`
- Base URL: `https://threatfox-api.abuse.ch/api/v1/`
- Method: **POST only**, JSON body
- Auth: **`Auth-Key` HTTP header, mandatory.** Same wording pattern as MalwareBazaar.
- Useful query: body `{"query": "search_ioc", "search_term": "{text}"}` (free-text IOC search)
- Response fields: top-level `query_status`, `data[]` with `id` (stable numeric id), `ioc` (the indicator value), `ioc_type` (e.g. `domain`, `url`, `md5_hash`), `threat_type`, `threat_type_desc`, `malware`, `malware_printable`, `confidence_level` (0-100, a PREDICTED/community-scored confidence, not a government confirmation), `first_seen`, `last_seen`, `reporter`, `reference`, `tags[]`
- Canonical URL: `https://threatfox.abuse.ch/ioc/{id}/`
- Env var: `THREATFOX_AUTH_KEY` (required)

## 3. URLhaus API

- Host to allowlist: `urlhaus-api.abuse.ch`
- Base URL: `https://urlhaus-api.abuse.ch/v1/`
- Method: mixed — GET for `/urls/recent/`, POST (form-encoded) for `/host/`, `/url/`, `/tag/`, `/payload/`, `/signature/`
- Auth: **`Auth-Key` HTTP header, mandatory** for all query endpoints (confirmed on the dedicated urlhaus-api.abuse.ch docs page, distinct from the submission-focused urlhaus.abuse.ch/api/ page which is about reporting new malicious URLs, not querying).
- Useful query: POST `/host/` with body `host={domain_or_ip}` (query malicious-URL history for a host) — a free-text/URL-shaped query maps naturally to this
- Response fields: `query_status`, `url_count`, `urls[]` with `id`, `url`, `url_status` (online/offline/unknown), `date_added`, `threat` (e.g. `malware_download`), `tags[]`, `reporter`, `urlhaus_reference` (canonical URL to the record)
- Env var: `URLHAUS_AUTH_KEY` (required)

## Summary

All three abuse.ch APIs are legitimate, well-documented, real machine-callable REST/JSON APIs — genuinely `IMPLEMENTED_CREDENTIAL_BLOCKED`, not `SEARCH_INTERFACE_ONLY` or `MISSING`. Build all three adapters with real fetch+parse (correct contract, ready to go live the moment a Commander registers keys), but they cannot reach `LIVE_IMPLEMENTED` in this environment since no `*_AUTH_KEY` exists in `.env.local`. One free abuse.ch account can generate all three keys at once via https://auth.abuse.ch/.
