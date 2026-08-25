# API contracts — central banks / energy statistics batch (Checkpoint 4)

Researched via live curl against real endpoints where possible, docs otherwise.

## 1. ECB Statistical Data Warehouse (SDW) SDMX API

- Host to allowlist: **`data-api.ecb.europa.eu`** — NOT `sdw-wsrest.ecb.europa.eu` (confirmed dead/unreachable live this pass; the API migrated hosts).
- Endpoint: `GET /service/data/{flowRef}/{key}?lastNObservations={n}&format=jsondata` (e.g. flowRef `EXR` = exchange rates, key `D.USD.EUR.SP00.A` = daily USD/EUR spot average).
- Auth: **none**, fully public SDMX-JSON.
- Response format: SDMX-JSON — **genuinely complex, not flat**. Top-level `dataSets[0].series` keyed by a dimension-index string (e.g. `"0:0:0:0:0"`), each with `observations: {"0": [value, ...flags], "1": [...], ...}` where the observation index (0, 1, 2...) maps positionally to `structure.dimensions.observation[0].values[]` (an ordered array of `{id, name, start, end}` date objects). Must zip observation index → date from the structure block; the value itself is `observations[i][0]`.
- Stable ID: the flowRef+key combination (e.g. `EXR:D.USD.EUR.SP00.A`) is the natural series id; individual observations get `{seriesKey}:{date}`.
- Canonical URL: no per-series human page; use `https://data.ecb.europa.eu/data/datasets/{flowRef}` as a reasonable stable link (dataset-level, not observation-level).
- Rate limit: no documented hard numeric cap for reasonable use.
- Example confirmed live: `GET https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?lastNObservations=3&format=jsondata` → 3 daily USD/EUR spot rates (e.g. `1.1605`), dates `2026-08-19`–`2026-08-21`.

## 2. Bank of Canada Valet API

- Host to allowlist: `www.bankofcanada.ca`
- Endpoint: `GET /valet/observations/{seriesName}/json?recent={n}` (e.g. `FXUSDCAD` = daily USD/CAD rate).
- Auth: **none**, fully public.
- Response format: clean flat JSON (the simplest of this batch). Confirmed live: `{"seriesDetail": {"FXUSDCAD": {"label": "USD/CAD", "description": "..."}}, "observations": [{"d": "2026-08-21", "FXUSDCAD": {"v": "1.3760"}}, ...]}`. Stable ID: series name (e.g. `FXUSDCAD`); observation date is `d`, value is nested under the series name key as `v` (a string, parse with `Number()`).
- Canonical URL: `https://www.bankofcanada.ca/rates/{category}/{series-slug}/` — no single reliable programmatic pattern; safe fallback is the API URL itself or `https://www.bankofcanada.ca/valet/observations/{seriesName}`.
- Rate limit: no documented hard numeric cap.
- Example confirmed live: `GET https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=3` → 3 daily rates, latest `1.3760` on `2026-08-21`.

## 3. BIS Data Portal (SDMX)

- Host to allowlist: `stats.bis.org` — NOT `data.bis.org` (confirmed 404 live this pass for the same path; `stats.bis.org` is the real API host).
- Endpoint: `GET /api/v2/data/dataflow/BIS/{dataflowId}/1.0/{key}?lastNObservations={n}&format=json` (e.g. dataflow `WS_CBPOL` = central bank policy rates, key `D.US` = daily, US).
- Auth: **none**, fully public.
- Response format: SDMX-JSON, same shape family as ECB's (`data.dataSets[0].series{key:{observations:{idx:[value,...]}}}`, `data.structure.dimensions.series[]`/`observation[]` for labels) — a real, non-trivial parse, structurally similar enough to ECB's that shared decode logic is reasonable if convenient, though each adapter can implement its own bounded version independently.
- Stable ID: dataflowId+key (e.g. `WS_CBPOL:D.US`).
- Canonical URL: `https://data.bis.org/topics/CBPOL` pattern varies by dataflow; no single reliable per-observation URL — use the API URL as sourceUrl.
- Rate limit: no documented hard numeric cap.
- Example confirmed live: `GET https://stats.bis.org/api/v2/data/dataflow/BIS/WS_CBPOL/1.0/D.US?lastNObservations=3&format=json` → US central bank policy rate `3.625` for 3 recent days.

## 4. US EIA API v2

- Host to allowlist: `api.eia.gov`
- Endpoint: `GET /v2/{energy-source}/{dataset}/data?api_key={key}&frequency={freq}&data[]={col}&facets[{dim}][]={val}&start={date}&end={date}&length={n}` (e.g. `/v2/electricity/retail-sales/data` for retail electricity prices).
- Auth: **required** `api_key` query param — free self-service registration at https://www.eia.gov/opendata/ (submit an email, key is emailed automatically, no approval gate, no wait).
- Response format (per official docs — **not independently live-confirmed this pass**: a test call with a placeholder key returned no response body/timed out from this research environment, and no valid key was available to test with; the shape below is from EIA's own documentation, not a live fetch): top-level wrapper is documented elsewhere in EIA's API as `{"response": {"total": "...", "dateFormat": "...", "frequency": "...", "data": [...]}, "request": {...}, "apiVersion": "..."}` — **flag: confirm the exact top-level wrapper key (`response.data` vs a bare `data`) with a real key before shipping the parser**, since sources disagree and this pass couldn't independently verify. Per-row fields (confirmed from docs): `period` (date), dimension id/description pairs (e.g. `stateid`/`stateDescription`), the requested data column(s) by name (e.g. `price`) plus a matching `{column}-units` field.
- Stable ID: no single numeric id; synthesize from `{dataset-path}:{period}:{facet-values}`.
- Canonical URL: no per-datapoint human page; use `https://www.eia.gov/electricity/data.php` (or the relevant EIA browse page) as a general reference, or the API URL as sourceUrl.
- Rate limit: not strictly published; standard fair-use expected.

## Flags / uncertainty

- **ECB and BIS both use genuinely complex SDMX-JSON** (dimension-indexed observations, not flat objects) — real parsing work, confirmed live for both, not guessed.
- **EIA v2 could not be live-confirmed this pass** (no valid API key available, and a `DEMO_KEY` test produced no response from this network) — build against the documented contract, but flag the top-level response-wrapper shape (`response.data` vs bare `data`) for one real live-verification pass once a Commander registers a free key. This is the only genuine uncertainty in this batch — ECB, Bank of Canada, and BIS are all fully live-confirmed with real field names.
