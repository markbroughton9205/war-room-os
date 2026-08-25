# API contracts — GIS/earth observation batch 2 (Checkpoint 5)

All 4 researched via live HTTP calls during this pass (Nominatim: exactly one call, per their strict rate-limit policy below).

## 1. Nominatim (OpenStreetMap geocoding)

- Host to allowlist: `nominatim.openstreetmap.org`
- Endpoint: `GET /search?q={text}&format=json&limit={n}` — genuine free-text geocoding search.
- Auth: **none**, but usage policy is strict and must be followed exactly:
  - **Absolute max 1 request/second** (their docs: "An absolute maximum of 1 request per second"). No burst allowance.
  - **A valid HTTP `User-Agent` identifying the application is required**; a `Referer` header is an acceptable alternative for browser apps. Requests with a generic/missing UA may be blocked without warning.
  - No heavy/bulk use of the public instance — it's community-funded, not for high-volume querying (large-scale geocoding should self-host or use a commercial provider instead). This adapter should be a single bounded lookup per call, never batched.
- Response format: JSON array. Confirmed live: `place_id` (stable numeric id), `osm_type`/`osm_id`, `lat`/`lon` (strings), `display_name` (full formatted address), `name`, `class`/`type` (e.g. `boundary`/`administrative`), `boundingbox` (array of 4 strings), `importance`, `addresstype`.
- Canonical URL: construct as `https://www.openstreetmap.org/{osm_type}/{osm_id}` (osm_type needs singular-to-full-word mapping: `node`→`node`, `way`→`way`, `relation`→`relation`, already full words in the response).
- Stable ID: `place_id` (Nominatim-internal, can change on reindex) or `{osm_type}:{osm_id}` (more stable, OSM's own identifier).
- Example confirmed live: `GET https://nominatim.openstreetmap.org/search?q=Paris%2C%20France&format=json&limit=1` → `place_id: 97683695`, `osm_type: "relation"`, `osm_id: 71525`, `lat: "48.8534951"`, `display_name: "Paris, Île-de-France, France métropolitaine, France"`.
- **Must add a module-level throttle enforcing ≥1000ms between requests**, same pattern already used by this codebase's `arxiv` adapter (3.1s throttle) — Nominatim's limit is stricter to respect (1 req/s hard ceiling, no exceptions documented).

## 2. NASA Earthdata CMR (Common Metadata Repository) API

- Host to allowlist: `cmr.earthdata.nasa.gov`
- Endpoint: `GET /search/collections.json?keyword={text}&page_size={n}` — free-text collection (dataset) search. A parallel `/search/granules.json` exists for individual data-file-level search within one collection, not used here (collection-level search is the useful bounded entry point).
- Auth: **none required for search** — confirmed live, unauthenticated. Earthdata Login (auth) is only required for actually downloading data files, not for searching metadata.
- Response format: JSON. Confirmed live: `feed.entry[]`, each with `entry_id` / `short_name` (stable dataset shortname, e.g. `MYD00F`), `title`/`dataset_id`, `version_id`, `data_center` (owning DAAC), `organizations[]`, `summary`, `time_start`/`time_end`, `boxes[]` (spatial bounding box as `"south west north east"` string), `processing_level_id`.
- Canonical URL: `https://cmr.earthdata.nasa.gov/search/concepts/{concept-id}` if a concept id is present (not always in the collections.json shortcut response) — otherwise construct `https://search.earthdata.nasa.gov/search/granules?p={entry_id}` as the human-facing search UI link.
- Stable ID: `short_name` + `version_id` combination, or `entry_id` when present.
- Rate limit: no strict published numeric cap for reasonable use; standard fair-use expected.

## 3. Copernicus Data Space Ecosystem (CDSE) — OData Catalog API

- Host to allowlist: `catalogue.dataspace.copernicus.eu`
- Endpoint: `GET /odata/v1/Products?$filter={odata-filter}&$top={n}` — OData v4 query syntax, e.g. `$filter=Collection/Name eq 'SENTINEL-2' and contains(Name,'{text}')`.
- Auth: **none required for catalog SEARCH** — confirmed live via a real unauthenticated call returning real Sentinel-2 product metadata. **A separate OAuth2 password-grant token (from `identity.dataspace.copernicus.eu`, client_id `cdse-public`) is required only for actually downloading product files** (`Online: true` products' binary content), not for searching/listing metadata — this adapter only needs the metadata search, so no credential is required.
- Response format: JSON (OData). Confirmed live: `value[]`, each with `Id` (stable UUID), `Name` (product filename, e.g. `S2A_MSIL1C_...SAFE`), `ContentLength`, `OriginDate`/`PublicationDate`/`ModificationDate`, `Online` (bool), `S3Path`, `Footprint` (WKT polygon string), `GeoFootprint` (GeoJSON polygon), `Checksum[]`.
- Canonical URL: no direct human page per product; construct `https://browser.dataspace.copernicus.eu/?zoom=5&product={Id}` as a reasonable Copernicus Browser deep link, or omit and rely on sourceUrl = the API URL.
- Stable ID: `Id` (UUID).
- Rate limit: no documented hard numeric cap for reasonable search use.

## 4. OpenTopography Global DEM API

- Host to allowlist: `portal.opentopography.org`
- Endpoint: `GET /API/globaldem?demtype={type}&south={lat}&north={lat}&west={lon}&east={lon}&outputFormat=GTiff&API_Key={key}` — bounding-box elevation-raster request. `demtype` is one of a fixed enum (`SRTMGL3`, `SRTMGL1`, `AW3D30`, `COP30`, `COP90`, `NASADEM`, etc.).
- Auth: **required**, `API_Key` query param — confirmed exact param name live (an invalid key produces `"Not a valid format API Key: <value>"`, confirming the server reads that exact param name; a request with no key at all produces `"API Key required for access"`). Free self-service registration ("My Account" section of the OpenTopography portal), no approval gate documented.
- Response format: **binary raster** (GeoTIFF/other DEM formats), not JSON — this is fundamentally a file-download API, not a metadata-search API. A `ResearchDocument`-shaped adapter can only usefully report "here is a DEM tile covering this bounding box" as one synthesized record (id from the bbox+demtype), not decode actual elevation values into document fields.
- Canonical URL: no per-request human page; use `https://opentopography.org/` as a general reference, or the constructed request URL (with the key redacted) as sourceUrl.
- Rate limit: documented free-tier caps — **200 calls/24h for academic accounts, 50 calls/24h for non-academic** — notably low; the adapter should be used sparingly and this limit documented for the Commander.
- Env var: `OPENTOPOGRAPHY_API_KEY` (required).

## Summary

Nominatim, NASA CMR, and CDSE catalog search are all genuinely public/unauthenticated and confirmed live this pass — real field names, not guessed. **Nominatim's 1 req/sec hard rate limit and mandatory descriptive User-Agent must be enforced in the adapter itself** (a throttle, same pattern as `arxiv`), not just documented, since violating it risks the shared public instance blocking War Room's IP. CDSE is a pleasant surprise: the OAuth2 token is only needed for file download, not metadata search, so this adapter ships fully live/unauthenticated despite CDSE's reputation as an auth-gated platform. OpenTopography is `IMPLEMENTED_CREDENTIAL_BLOCKED` (real key required, confirmed via live 401 responses) and is fundamentally a binary-file API rather than a metadata-search API — build it as a bounded single-tile-request adapter, not a search-shaped one.
