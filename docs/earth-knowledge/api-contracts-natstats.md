# API contracts — national statistics offices batch (Checkpoint 4)

All 3 confirmed live via direct curl during this research pass (not just docs).

## 1. Statistics Canada Web Data Service (WDS)

- Host to allowlist: `www150.statcan.gc.ca`
- Method: **POST only**, JSON array body (batch-shaped API — every call takes an array of request objects, even for one item)
- Metadata endpoint: `POST /t1/wds/rest/getCubeMetadata` body `[{"productId": <8-digit cube id>}]` — confirmed live (productId `18100004`, CPI monthly) → returns `cubeTitleEn`, `cubeStartDate`/`cubeEndDate`, `frequencyCode`, `dimension[]` (each with `member[]` — geography/category breakdowns), `nbSeriesCube`.
- Data endpoint: `POST /t1/wds/rest/getDataFromVectorsAndLatestNPeriods` body `[{"vectorId": <int>, "latestN": <int>}]` — confirmed live (vectorId `41690973`) → `vectorDataPoint[]` with `{refPer, value, releaseTime, frequencyCode}`.
- Auth: **none**. Fully public, no key.
- Stable ID: `vectorId` (a StatCan "vector" is one specific time series) or `productId` (a whole "cube"/table).
- Canonical URL: `https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid={productId}` (cube-level; no per-vector human page).
- Rate limit: no documented hard numeric cap; StatCan asks for reasonable batch sizes (their own docs recommend batching multiple vectors per call rather than looping).
- Note: there is no free-text search endpoint — a query must already be (or resolve to) a numeric `vectorId` or `productId`. A text-search-shaped adapter would need a fixed keyword→vectorId lookup table (same pattern as this codebase's `eurostat`/`who_gho` adapters) or accept the numeric ID directly.

## 2. UK Office for National Statistics (ONS) API

- Host to allowlist: `api.beta.ons.gov.uk` (the "beta" subdomain is the real, current, stable API host — not a placeholder despite the name; ONS has kept this name for years)
- Search endpoint: `GET /v1/search?q={text}&limit={n}` — confirmed live (`q=population`) → real free-text search, `count`, `items[]` with `title`, `summary`, `uri` (relative path — canonical URL is `https://www.ons.gov.uk` + uri), `release_date`, `type` (`bulletin`/`dataset`/etc.), `topics[]`.
- Auth: **none**. Fully public, no key.
- Stable ID: no numeric ID in search results — use `uri` (unique per publication) as the stable identifier.
- Canonical URL: `https://www.ons.gov.uk{uri}`.
- Rate limit: no documented hard numeric cap for the public API.

## 3. INSEE Melodi API (France) — NOT the older BDM/OAuth-gated API

- **Important finding: INSEE has migrated to a new, genuinely public "Melodi" open-data platform — confirmed live, zero auth required.** The older `api.insee.fr` BDM/Sirene APIs (documented elsewhere as OAuth2-gated) are being superseded; `api.insee.fr/melodi/` is the current, actively-served, public replacement — no API key, no OAuth, confirmed via direct unauthenticated live calls.
- Host to allowlist: `api.insee.fr`
- Catalog/search endpoint: `GET /melodi/catalog/all?q={text}&maxResult={n}` — confirmed live (`q=population`) → JSON array, each entry has `identifier` (stable dataset code, e.g. `DD_CNA_AGREGATS`), `title[]`/`abstract[]`/`description[]` (each an array of `{content, lang}` — bilingual fr/en), `numObservations`, `numSeries`, `temporal`, `spatial`.
- Data endpoint: `GET /melodi/data/{identifier}?maxResult={n}` — confirmed live (`DD_ESTIMATION_POPULATION`) → `{observations: [{attributes, dimensions: {GEO, TIME_PERIOD, ...}, measures: {OBS_VALUE_NIVEAU: {value}}}], identifier, title: {fr, en}, publisher}`.
- Auth: **none required** for Melodi (confirmed live, no key/header sent). This is a real, current policy — not an oversight; INSEE's Melodi docs describe it as their open-data API.
- Stable ID: `identifier` (dataset-level) — no single observation-level ID; synthesize one from `{identifier}:{dimensions joined}`.
- Canonical URL: no per-dataset human page confirmed live this pass; use `https://www.insee.fr/fr/statistiques/{identifier}` as a best-effort pattern, or omit canonicalUrl and rely on the API URL as sourceUrl.
- Rate limit: no documented hard numeric cap observed.

## Summary

All 3 confirmed live, genuinely public, zero-auth this pass. StatCan and INSEE Melodi both require resolving a query to a stable code (vectorId/productId or dataset identifier) rather than true single-call free-text-to-data search — StatCan has no search endpoint at all (recommend a small fixed vectorId lookup table, same pattern as eurostat), while INSEE Melodi *does* have a real catalog search endpoint that resolves text to `identifier` directly (two-call pattern: catalog search → data fetch, same shape as this codebase's `rcsb_pdb`/`string_db` two-call adapters). ONS has genuine one-call free-text search. No credential blockers for any of the three.
