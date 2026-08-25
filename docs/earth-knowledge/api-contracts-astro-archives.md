# API contracts — astronomy archives batch (Checkpoint 5)

All 3 confirmed live via direct HTTP calls during this research pass (not just docs).

## 1. NASA Exoplanet Archive TAP service

- Host to allowlist: `exoplanetarchive.ipac.caltech.edu`
- Endpoint: `GET /TAP/sync?query={ADQL}&format=json` — Table Access Protocol, ADQL (SQL-like) query in the `query` param.
- **Use the `pscomppars` table, NOT `ps`.** `ps` has one row per *publication/reference* for a planet (confirmed live: querying `ps` for "Kepler-10 b" returned many near-duplicate rows, one per reference, with differing `pl_orbper`/`pl_rade` precision per source). `pscomppars` ("Planetary Systems Composite Parameters") has exactly one curated best-estimate row per planet — the right table for a search-shaped adapter.
- Example confirmed live: `GET https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query=SELECT+pl_name,hostname,discoverymethod,disc_year,pl_orbper+FROM+pscomppars+WHERE+pl_name=%27Kepler-10+b%27&format=json` → exactly one row: `{"pl_name":"Kepler-10 b","hostname":"Kepler-10","discoverymethod":"Transit","disc_year":2011,"pl_orbper":0.8374907}`.
- For a free-text name-substring search (not just exact match), ADQL supports `WHERE pl_name LIKE '%{text}%'` — bind/escape the caller's text as a literal ADQL string (double any embedded single-quotes) before interpolating, since there is no parameterized-query mechanism in a GET-based TAP sync call.
- Auth: **none required**, fully public, no key.
- Response format: **plain JSON array of flat objects** (not the metadata+data-array TAP-JSON convention SIMBAD uses below) — confirmed live, one object per row, keys exactly matching the requested `SELECT` column list.
- Stable ID: `pl_name` (planet name) is the natural key; no separate numeric ID in this table.
- Canonical URL: `https://exoplanetarchive.ipac.caltech.edu/overview/{urlencode(pl_name)}` (NASA's per-planet overview page pattern; not independently re-fetched this pass but is the documented stable scheme).
- Rate limit: no documented hard numeric cap; a well-behaved single-concurrency client is expected.

## 2. CDS SIMBAD TAP

- Host to allowlist: `simbad.cds.unistra.fr` (both http and https confirmed live and equivalent; use https for the allowlist).
- Endpoint: `GET /simbad/sim-tap/sync?request=doQuery&lang=adql&format=json&query={ADQL}` — standard IVOA TAP sync endpoint.
- Example confirmed live: `GET https://simbad.cds.unistra.fr/simbad/sim-tap/sync?request=doQuery&lang=adql&format=json&query=SELECT+main_id,ra,dec,otype+FROM+basic+WHERE+main_id=%27M31%27` → one row for M31 (Andromeda Galaxy).
- For substring/name search: `WHERE main_id LIKE '%{text}%'` against the `basic` table (same literal-escaping caveat as above — this is real user-facing SQL-injection-shaped surface if the caller's text isn't sanitized before interpolation, since TAP sync has no bind-parameter mechanism).
- Auth: **none required**, fully public, no key.
- Response format: **IVOA standard TAP-JSON** — `{"metadata":[{"name":"col1",...}, ...], "data":[[val1,val2,...], ...]}` — an array-of-arrays keyed positionally by the `metadata` column order, NOT an array of named objects. This is a genuinely different shape from the NASA Exoplanet Archive's plain-object-array response above, despite both being "TAP" — must be handled with an explicit column-index zip, not direct property access.
- Confirmed live fields for the `basic` table: `main_id` (stable identifier string, e.g. `"M  31"` — note SIMBAD's catalog IDs contain padding spaces, trim before display/URL use), `ra`/`dec` (degrees, ICRS J2000), `otype` (object type code, e.g. `"AGN"`).
- Canonical URL: `https://simbad.cds.unistra.fr/simbad/sim-id?Ident={urlencode(main_id)}` (SIMBAD's standard object-lookup page).
- Rate limit: no documented hard numeric cap; CDS asks for reasonable single-concurrency use.
- (VizieR, the other CDS service originally in scope, was not independently tested this pass — SIMBAD alone is sufficient for one adapter and is the more general-purpose "what is this astronomical object" lookup; VizieR is catalog-table-specific and would need its own per-catalog design. Recommend building against SIMBAD only for this checkpoint.)

## 3. MAST (Mikulski Archive for Space Telescopes)

- Host to allowlist: `mast.stsci.edu`
- Endpoint: `POST /api/v0/invoke`, form-encoded body with a single `request` field containing a JSON-encoded request object: `request={"service":"Mast.Caom.Cone","params":{"ra":<deg>,"dec":<deg>,"radius":<deg>},"format":"json","pagesize":<n>}` — a cone search (position + radius), not free-text. There is also a name-resolver service (`Mast.Name.Lookup`) that could be composed first to turn a caller's object name into RA/Dec, then feed the cone search — a two-call pattern like this codebase's `rcsb_pdb`/`string_db` adapters.
- Example confirmed live: cone search around RA=10.68, Dec=41.27 (M31's coordinates), radius=0.2° → real TESS observation records (`obs_collection`, `instrument_name`, `target_name`, `s_ra`/`s_dec`, `t_min`/`t_max` (MJD observation times), `proposal_pi`, `calib_level`, `dataproduct_type`).
- Auth: **none required**, fully public, no key.
- Response format: JSON, `{"status":"COMPLETE","msg":"","data":[{...}, ...]}` — flat array of objects.
- Stable ID: `obs_id` (observation ID string, e.g. `"tess-s0017-2-4"`).
- Canonical URL: no single per-observation human page confirmed live this pass; `https://mast.stsci.edu/portal/Mashup/Clients/Mast/Portal.html` (the general MAST portal) is a reasonable fallback, or omit canonicalUrl and rely on the API URL as sourceUrl.
- Rate limit: no documented hard numeric cap; standard fair-use expected.
- Two-call design note: `Mast.Name.Lookup` service (`request={"service":"Mast.Name.Lookup","params":{"input":"{name}"},"format":"json"}`) resolves a plain-text object name to RA/Dec — not independently live-tested this pass, but is the documented mechanism for a free-text-shaped adapter (resolve name → coordinates → cone search), matching the existing two-call precedent in this codebase.

## Flags / uncertainty

- **NASA Exoplanet Archive**: use `pscomppars`, not `ps` — confirmed live this pass that `ps` returns many duplicate/near-duplicate rows per planet (one per literature reference), which would look like a parsing bug if not deliberately avoided.
- **SIMBAD and NASA Exoplanet Archive both being "TAP" does NOT mean the same JSON shape** — SIMBAD uses the IVOA standard metadata+data-array-of-arrays convention; NASA Exoplanet Archive returns a plain array of named objects. Confirmed live for both, not assumed.
- **MAST's name-resolver (`Mast.Name.Lookup`) was not independently live-tested** this pass (only the coordinate-based cone search was) — the two-call name→coords→cone-search design is documented but should get one live-verification pass when the adapter is built.
- All three: no auth required, no commercial gating, no external blockers.
