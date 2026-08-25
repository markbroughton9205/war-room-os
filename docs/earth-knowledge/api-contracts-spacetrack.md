# API contracts — space/satellite tracking batch (Checkpoint 5)

All 4 confirmed live via direct curl during this research pass (not just docs).

## 1. CelesTrak GP (orbital elements / TLE) data

- Host to allowlist: `celestrak.org`
- Endpoint: `GET /NORAD/elements/gp.php?CATNR={noradId}&FORMAT=json` — lookup by NORAD catalog number (getById-shaped). Also supports `GROUP=` (e.g. `stations`, `active`) for a bounded named-group listing instead of a single ID.
- Auth: **none**. Fully public, no key.
- Response format: JSON array (even for a single-ID lookup). Confirmed live fields (ISS, catalog 25544): `OBJECT_NAME`, `OBJECT_ID` (international designator, e.g. `"1998-067A"`), `EPOCH`, `NORAD_CAT_ID` (stable numeric ID), `MEAN_MOTION`, `ECCENTRICITY`, `INCLINATION`, `RA_OF_ASC_NODE`, `ARG_OF_PERICENTER`, `MEAN_ANOMALY`, `BSTAR`, `ELEMENT_SET_NO`, `REV_AT_EPOCH`.
- Stable ID: `NORAD_CAT_ID`. Canonical URL: no per-object human page; use `https://celestrak.org/satcat/table-satcat.php?NORAD_CAT_ID={id}` or the API URL itself.
- Rate limit: no documented hard numeric cap; a descriptive User-Agent is good etiquette (CelesTrak is a small volunteer-run service — be conservative).
- Example confirmed live: `GET https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=json` → `NORAD_CAT_ID: 25544`, `OBJECT_NAME: "ISS (ZARYA)"`.

## 2. JPL Horizons API

- Host to allowlist: `ssd.jpl.nasa.gov`
- Endpoint: `GET /api/horizons.api?format=json&COMMAND='{bodyId}'&OBJ_DATA='YES'&MAKE_EPHEM='NO'` — body lookup by JPL body ID (e.g. `499` = Mars, `1` = Ceres, `-125544` = ISS spacecraft code convention).
- Auth: **none**. Fully public, no key.
- Response format: JSON, but the payload itself is a **single large preformatted text blob** under `result` — not structured fields. Confirmed live (Mars, `COMMAND='499'`): `{"signature": {...}, "result": "...multi-KB fixed-width text with physical data (Vol. mean radius, Mass, GM, etc.)..."}`. There is no clean per-field JSON here — a real adapter should treat `result` as the document's summary/content text (comparable to how this codebase's `medlineplus` adapter handles a similarly unstructured field), not attempt to parse individual physical constants out of it.
- Stable ID: the caller-supplied `COMMAND` body ID. Canonical URL: no per-body human page; use `https://ssd.jpl.nasa.gov/horizons/app.html#/` as a general reference or the API URL as sourceUrl.
- Rate limit: no documented hard numeric cap for reasonable use; NASA/JPL asks for a descriptive User-Agent.
- Note: `MAKE_EPHEM='NO'` + `OBJ_DATA='YES'` gives the bounded physical-data-only response used above; a full ephemeris table (`MAKE_EPHEM='YES'`) would be a much larger, open-ended response and is not recommended for a bounded search-shaped adapter.

## 3. JPL Small-Body Database (SBDB) API

- Host to allowlist: `ssd-api.jpl.nasa.gov`
- Endpoint: `GET /sbdb.api?sstr={name}` — lookup by small-body name/designation (e.g. `Ceres`).
- Auth: **none**. Fully public, no key.
- Response format: clean structured JSON (unlike Horizons). Confirmed live (Ceres): `object.fullname` (e.g. `"1 Ceres (A801 AA)"`), `object.des` (designation, stable-ish), `object.spkid` (stable numeric SPK ID, e.g. `"20000001"` — the most reliable stable record ID), `object.kind`, `object.orbit_class.name`, `object.neo`/`object.pha` (booleans), `orbit.epoch`, `orbit.elements[]` (array of `{name, label, value, sigma, units}` — e.g. eccentricity, semi-major axis), `orbit.producer`, `orbit.last_obs`.
- Stable ID: `object.spkid`. Canonical URL: `https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr={spkid}`.
- Rate limit: no documented hard numeric cap for reasonable use.
- Example confirmed live: `GET https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=Ceres` → `spkid: "20000001"`, `fullname: "1 Ceres (A801 AA)"`, `orbit_class.name: "Main-belt Asteroid"`.

## 4. IAU Minor Planet Center — Designation Identifier API

- Host to allowlist: `data.minorplanetcenter.net`
- Endpoint: `GET /api/query-identifier` — **unusual: this is a GET request that requires a JSON request body** (not query params), confirmed live via the server's own Pydantic schema error messages when the body was malformed/missing. Body shape: `{"ids": ["<name-or-designation>", ...]}` (up to 100 per call, per docs), optional `group` (`"Minor Planets"`/`"Natural Satellites"`/`"Comets"`/`"Interstellar"`) and `comparison` (`"="`/`"ILIKE"`/`"%"`, default `"="`) fields.
- Auth: **none**. Fully public, no key. This is the young (2024-rollout) API the registry flagged — confirmed live and functional this pass, schema is stable and self-documenting (a malformed request returns the full JSON schema in the error body).
- Response format: JSON object keyed by the input id string. Confirmed live (`{"ids": ["Ceres"]}`): `Ceres.found` (count), `Ceres.name`, `Ceres.permid` (stable permanent ID, e.g. `"1"`), `Ceres.iau_designation` (e.g. `"(1)"`), `Ceres.object_type` (`["Minor Planet", 0]`), `Ceres.unpacked_primary_provisional_designation`, `Ceres.packed_permid`.
- Stable ID: `permid` when present (permanent designation), else the provisional designation.
- Canonical URL: no per-object human page confirmed live this pass; a reasonable fallback is `https://www.minorplanetcenter.net/db_search/show_object?object_id={permid}`.
- **Implementation flag — confirm before shipping**: this endpoint requires a body on a GET request (confirmed: POST to the same URL returns a hard 405). Standard `fetch()`/undici in Node.js does **not** reject a GET request with a body at the API level (unlike browsers, which do), so `safeProviderFetch(provider, url, { method: 'GET', body: ... })` should work in this codebase's Node-only server-side runtime — but this specific method+body combination should get one direct runtime smoke-test before shipping, since it's an unusual pattern not used by any other adapter in this codebase yet.

## Summary

All 4 sources are genuinely public, zero-auth-required APIs — no credential blockers. CelesTrak and SBDB are clean structured JSON, ready to build directly. JPL Horizons returns a large unstructured text blob rather than parsed fields — treat as content/summary text, not a source of individually-parsed physical constants. IAU MPC's Designation Identifier API is real and live-confirmed but uses the unusual GET-with-JSON-body pattern — flagged for a runtime smoke-test given it's a new pattern for this codebase (every other adapter uses GET-with-query-params or POST-with-body, never GET-with-body).
