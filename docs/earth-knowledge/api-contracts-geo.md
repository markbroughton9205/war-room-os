# API contracts — geospatial/statistics (research notes for adapter implementation)

Research only, no code. Feeds directly into `lib/research-engine/providers/*` adapters.

## 1. OpenStreetMap Overpass API

- **Host to allowlist:** `overpass-api.de` (primary, most stable official public instance). Other public mirrors exist (Kumi Systems `overpass.kumi.systems`, Geofabrik) but are not the default — pick one primary, do not allowlist all of them speculatively.
- **Endpoint:** `POST https://overpass-api.de/api/interpreter`, body = raw Overpass QL text (`Content-Type: text/plain` or form-encoded `data=` param — form-encoded is more broadly compatible with `fetch`).
- **Auth:** none. No API key of any kind.
- **Example query** (bounded search by name/tag within a bbox, JSON output):
  ```
  [out:json][timeout:25];
  node[name~"query",i](south,west,north,east);
  out body 20;
  ```
  `south,west,north,east` = bbox floats; `~"query",i` = case-insensitive substring match on the `name` tag; `out body N` caps result count.
- **Response shape (JSON):** `{ version, generator, elements: [{ type: "node"|"way"|"relation", id: number, lat, lon, tags: { [key]: string } }] }`. No canonical URL field — construct one as `https://www.openstreetmap.org/{type}/{id}`. No per-element timestamp in `out body`; use `out meta` for `timestamp`/`version`/`changeset` if needed (heavier response).
- **Rate limits:** ~10,000 queries/day and ~1GB/day informally tolerated on the main instance; on HTTP 429, back off ≥30s. No documented per-second limit but keep concurrency to 1 and add a generous timeout (Overpass queries can be slow). Must send a descriptive `User-Agent`.
- **Record ID:** `${type}/${id}` (e.g. `node/123456`) is the natural stable identifier.

## 2. GeoNames API

- **Host to allowlist:** `secure.geonames.org` (HTTPS endpoint; the plain `api.geonames.org` is HTTP-only and must not be used from a server that requires HTTPS-only egress).
- **Endpoint:** `GET https://secure.geonames.org/searchJSON`
- **Auth:** requires a registered `username` query parameter — NOT a secret API key, but still a required credential. Acquisition: Commander registers a free account at `https://www.geonames.org/login/`, confirms the emailed verification link, then enables "free web services" on the account page (`https://www.geonames.org/manageaccount`). Store as `GEONAMES_USERNAME` env var (not secret-shaped, but still required-env per the provider descriptor pattern).
- **Params:** `q` (free-text query), `maxRows` (result cap), `username` (required), optional `lang`, `country`, `featureClass`.
- **Response fields:** `{ totalResultsCount, geonames: [{ geonameId, name, toponymName, lat, lng, countryCode, countryName, fcode, fcodeName, population, adminName1 }] }`. Record ID = `geonameId`. Canonical URL: `https://www.geonames.org/{geonameId}`.
- **Rate limits:** free accounts get 30,000 credits/day (search = 1+ credits depending on result count), 1 credit/sec avg — no documented hard per-request cap beyond that.

## 3. Eurostat REST API (dissemination / statistics)

- **Host to allowlist:** `ec.europa.eu`
- **Endpoint:** `GET https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/{datasetCode}?format=JSON&lang=EN&{dimension filters}` — e.g. `.../data/DEMO_R_D3DENS?format=JSON&lang=EN&geo=BE&TIME=2025`.
- **Auth:** none. Fully public.
- **Response format:** JSON-stat 2.0 — NOT a simple array. Shape: `{ version, class: "dataset", label, dimension: { [dimId]: { label, category: { index: {code:pos}, label: {code:label} } } }, id: [dimIds...], size: [dims...], value: { [flatIndex]: number } }`. Adapter must decode the JSON-stat flat-index encoding to pull out (dimension combo → value) pairs — this is real parsing work, not a trivial map. A minimal-viable first adapter can report the dataset's dimension/label metadata plus a bounded sample of decoded value points rather than a full N-dimensional decode.
- **Discovery:** dataset codes (e.g. `DEMO_R_D3DENS`) come from the Eurostat data browser / catalog; a query's free-text can't be mapped to a dataset code without a lookup step — this adapter likely needs a fixed default dataset or a text→code lookup table rather than true free-text search (flag this as a design constraint, not a blocker).
- **Rate limits:** no documented hard limit for reasonable use; be a well-behaved client (timeout, single concurrent request, honest User-Agent).

## Open items / uncertainty flags

- **GeoNames signup is a real manual step** — cannot be automated or defaulted; `GEONAMES_USERNAME` will be `IMPLEMENTED_CREDENTIAL_BLOCKED` until the Commander actually registers an account, distinct from a "just add a secret" credential.
- **Overpass instance stability**: public Overpass mirrors occasionally go down/rate-limit independently; `overpass-api.de` is the most commonly cited stable default but has no formal SLA. Adapter should fail closed (upstream_error) on non-200/timeout rather than silently retry against an unlisted mirror.
- **Eurostat free-text search is not a native API capability** — the REST API is dataset-code-addressed, not full-text searchable server-side. This is a real design constraint for the adapter, not a research gap.
