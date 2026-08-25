# API contracts — weather/climate/space-weather batch (Checkpoint 5)

Researched via live HTTP calls against real endpoints during this pass (except NOAA CDO, which needs a token — documented from official docs, host+endpoint existence confirmed live).

## 1. Open-Meteo

- Host to allowlist: `api.open-meteo.com`
- Endpoint: `GET /v1/forecast?latitude={lat}&longitude={lon}&current={vars}&hourly={vars}&forecast_days={n}` — bounded lat/lon point forecast, no free-text search (geocoding is a separate host, not evaluated here).
- Auth: **none required**, fully public, no key.
- Response format: JSON. Confirmed live: `latitude`, `longitude`, `elevation`, `timezone`, `current: {time, interval, temperature_2m, wind_speed_10m}` (units in `current_units`), `hourly: {time: [...], temperature_2m: [...]}` (parallel arrays, zip by index).
- No stable "record ID" — this is a live snapshot, not a document store; synthesize an id from `{lat}:{lon}:{time}`.
- Canonical URL: no per-point human page; use `https://open-meteo.com/en/docs` as a general reference or the API URL itself as sourceUrl.
- Rate limit: no key needed; documented fair-use ~10,000 calls/day for non-commercial use.
- Example confirmed live: `GET https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.41&current=temperature_2m,wind_speed_10m&hourly=temperature_2m&forecast_days=1` → `current.temperature_2m: 12.7`, 24 hourly values.

## 2. NOAA NCEI Climate Data Online (CDO) API v2

- Host to allowlist: **`www.ncei.noaa.gov`** — note the modern host is `ncei.noaa.gov`, not the older `ncdc.noaa.gov` naming still used in some doc URLs; confirmed live (`www.ncdc.noaa.gov` docs page itself documents the `ncei.noaa.gov` API host).
- Endpoint: `GET /cdo-web/api/v2/data?datasetid={id}&startdate={date}&enddate={date}&locationid={id}&limit={n}` (also `/datasets`, `/stations`, `/locations` for discovery/lookup).
- Auth: **required token**, obtained free via NOAA's token request page (email-based, token emailed automatically, no approval gate). Sent via header: `token: <token>` (confirmed via docs; a request without one returns `{"status":"400","message":"Token parameter is required."}` — confirmed live).
- Response format: JSON. Confirmed from docs: list endpoints return `{metadata: {resultset: {limit, count, offset}}, results: [...]}`. Datasets: `id`, `name`, `datacoverage`, `mindate`, `maxdate`. Data values: `date`, `datatype`, `station`, `value`, `attributes`.
- Env var: `NOAA_CDO_TOKEN` (required).
- Canonical URL: no per-record human page; use `https://www.ncei.noaa.gov/cdo-web/` as reference.
- Rate limit: **5 requests/second, 10,000 requests/day per token** (documented exactly).
- Not independently live-confirmed beyond host/endpoint existence + the documented 400 error shape (no token available this pass) — recommend one live-verification pass once a Commander registers a token.

## 3. Met.no Locationforecast API

- Host to allowlist: `api.met.no`
- Endpoint: `GET /weatherapi/locationforecast/2.0/compact?lat={lat}&lon={lon}` — bounded point forecast.
- Auth: **none required.** **Important finding, not what was expected**: a descriptive User-Agent is NOT strictly required by the server (confirmed live: requests with no User-Agent, or with `curl/8.7.1`, all return 200) — **but their WAF specifically blocks any User-Agent string containing the literal substring `test@example.com`** (confirmed live via 5 side-by-side probes: `"WarRoomResearchEngine/1.0"` → 200, `"MyApp/1.0"` → 200, `"MyApp/1.0 (contact@realdomain.org)"` → 200, `"MyApp/1.0 test@example.com"` → 403, `"curl/8.7.1 test@example.com"` → 403). This is a narrow WAF rule against a known placeholder/spam-flagged email pattern, not a general auth or UA-format requirement — **whoever builds this adapter must avoid the literal placeholder `test@example.com` in any default User-Agent string** (use a real-looking domain placeholder or omit the email entirely).
- Response format: JSON (GeoJSON-flavored). Confirmed live: `type: "Feature"`, `geometry.coordinates: [lon, lat, elevation]`, `properties.meta.updated_at`, `properties.timeseries[]` each with `time` (ISO datetime) and `data.instant.details` (`air_temperature`, `air_pressure_at_sea_level`, `wind_speed`, `relative_humidity`, `cloud_area_fraction`, etc.).
- No stable record ID — synthesize from `{lat}:{lon}:{time}`.
- Canonical URL: no per-point human page; use `https://www.yr.no/` (their public-facing forecast site) as a general reference, or omit and rely on the API URL as sourceUrl.
- Rate limit: no hard documented numeric cap; they ask for a real, identifying User-Agent (any non-blocked format) and honoring `Expires`/`Last-Modified` caching headers for polite reuse.
- Example confirmed live: `GET https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=52.52&lon=13.41` → `air_temperature: 12.6`, `air_pressure_at_sea_level: 1021.6`.

## 4. NOAA Space Weather Prediction Center (SWPC) JSON services

- Host to allowlist: `services.swpc.noaa.gov`
- Access mechanism: **static JSON files** (bulk-shaped, no query params) at fixed paths, e.g. `GET /products/noaa-scales.json` (NOAA space-weather severity scales, confirmed live) — other useful fixed files include `/products/solar-wind/plasma-7-day.json`, `/json/goes/primary/xrays-7-day.json`.
- Auth: **none**, fully public, no key.
- Response format: JSON, shape varies per file. Confirmed live for `noaa-scales.json`: a numeric-keyed object (`"0"`, `"1"`, `"2"`, ... = today, +1 day, +2 day forecasts), each with `DateStamp`, `TimeStamp`, and `R`/`S`/`G` sub-objects (Radio blackout / Solar radiation storm / Geomagnetic storm scales) each with `Scale`, `Text`, and probability fields.
- No stable record ID in the traditional sense — this is a small, fixed set of named forecast files; synthesize an id from `{filename}:{DateStamp}`.
- Canonical URL: `https://www.swpc.noaa.gov/noaa-scales-explanation` (or the specific product page) as a general reference; the API URL itself as sourceUrl.
- Rate limit: no documented hard cap; served as static files (effectively CDN-cached), very tolerant.
- Example confirmed live: `GET https://services.swpc.noaa.gov/products/noaa-scales.json` → today's `R.Scale: "0"`, `G.Scale: "0"` (i.e. no active radio blackout or geomagnetic storm).

## Summary

All 4 confirmed genuinely public with real field names. **Open-Meteo, Met.no, and NOAA SWPC are zero-auth and ready to build as `LIVE_IMPLEMENTED` candidates.** NOAA CDO requires a free, no-approval-gate token (`NOAA_CDO_TOKEN`) — build as `IMPLEMENTED_CREDENTIAL_BLOCKED` until a Commander registers one. The one real surprise this pass: Met.no's "required descriptive User-Agent" (as commonly cited in secondary sources) turned out to be a myth on closer live testing — the actual constraint is narrower and different (a WAF block on the literal string `test@example.com` specifically, not a general User-Agent-format requirement). No other uncertainty flags.
