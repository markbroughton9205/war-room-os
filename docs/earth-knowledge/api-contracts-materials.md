# API contracts — materials science databases batch (Checkpoint 6)

Researched via live HTTP calls against real endpoints during this pass.

## 1. Materials Project API (mp-api)

- Host to allowlist: `api.materialsproject.org` — confirmed live, HTTPS-only, real host (no http fallback needed).
- Endpoint: `GET /materials/summary/?formula={formula}&_limit={n}` — bounded search by chemical formula (also supports `elements=` for element-set search).
- Auth: **required**, `X-API-KEY` header (confirmed live: an unauthenticated request returns a clean `401 {"message":"No API key found in request"}`, not a vague error). Free self-service registration via a Materials Project account (dashboard issues the key immediately), no approval gate.
- Response format: JSON. Documented fields (not independently re-confirmed body-shape live, since a key is required): `material_id` (stable ID, e.g. `"mp-19770"`), `formula_pretty`, `formula_anonymous`, `nsites`, `volume`, `density`, `symmetry.crystal_system`, `symmetry.space_group_symbol`, `energy_above_hull`, `band_gap`, `is_stable`.
- Canonical URL: `https://next-gen.materialsproject.org/materials/{material_id}`.
- Env var: `MATERIALS_PROJECT_API_KEY` (required).
- Rate limit: no documented hard numeric cap for reasonable use with a valid key.

## 2. OQMD (Open Quantum Materials Database)

- Host to allowlist: **`oqmd.org`** — HTTPS confirmed live and fully functional (returned a real, complete JSON response). **No http-only blocker exists** — the concern that OQMD is HTTP-only is outdated; plain `http://` requests 301-redirect to `https://`, and HTTPS works directly without any redirect needed.
- Endpoint: `GET /oqmdapi/formationenergy?composition={formula}&limit={n}` — bounded search by chemical composition.
- Auth: **none required**, fully public, no key.
- Response format: JSON. Confirmed live (composition=Fe2O3): top-level `links` (pagination), `data[]` each with `name` (formula), `entry_id` (stable numeric ID), `calculation_id`, `composition`, `composition_generic`, `prototype`, `spacegroup`, `volume`, `natoms`, `band_gap`, `delta_e` (formation energy), `stability`. Top-level `meta.data_available` (total count).
- Canonical URL: no confirmed per-entry human page pattern; `https://oqmd.org/materials/entry/{entry_id}` is OQMD's documented UI pattern (not independently re-fetched this pass).
- Rate limit: no documented hard numeric cap for reasonable use.
- Example confirmed live: `GET https://oqmd.org/oqmdapi/formationenergy?composition=Fe2O3&limit=1` → `entry_id: 353416`, `name: "Fe2O3"`, `spacegroup: "Pm-3m"`, `delta_e: -0.935846740892949`, `data_available: 25`.

## 3. AFLOW — real finding: the classic AFLUX endpoint is dead; a live HTTPS OPTIMADE API exists instead

- **The documented "classic" AFLUX endpoint (`http://aflowlib.duke.edu/search/API/?...`) returns a genuine 404 on both http and https** — confirmed live via direct requests to the exact path published in AFLOW's own school-training slides and third-party docs. This is a real dead/moved endpoint, not a client-request-format issue (the server responds, cleanly, with "Not Found" — not a timeout or connection failure).
- **Real, current, live replacement: AFLOW's HTTPS OPTIMADE-standard API.** Host to allowlist: `aflow.org`.
  - `GET /API/optimade/info` — **confirmed live and fully working** (200, real JSON: `api_version: "1.1.0"`, `available_endpoints: ["info","links","structures","references"]`).
  - `GET /API/optimade/structures?filter={OPTIMADE filter}&page_limit={n}` — the actual data-query endpoint. **Confirmed live but currently returning a server-side `500 Internal Server Error`** on every tested query, including a bare no-filter request (`?page_limit=1`) — a real, current backend degradation on AFLOW's end (their own OPTIMADE implementation, `aflow-optimade-ng`), not a malformed-request issue on the client side. The `/info` endpoint proves the API and host are alive and correctly routed; `/structures` specifically is broken right now.
- Auth: **none required** for either endpoint (OPTIMADE is a public federated materials-database standard).
- Response format (OPTIMADE JSON:API standard, from `/info` and the OPTIMADE spec, not independently confirmed for `/structures` since it 500s): `data[]` each with `id` (stable AFLOW entry ID), `attributes.chemical_formula_reduced`, `attributes.elements`, `attributes.nsites`, `attributes.lattice_vectors`. `meta.data_returned`, `meta.more_data_available`.
- Canonical URL: no confirmed per-entry human page this pass; `https://aflow.org/material.php?id={id}` is AFLOW's documented UI pattern (not independently re-fetched).
- Rate limit: no documented hard numeric cap.

## Summary / recommendation

**Materials Project and OQMD are both ready to build.** OQMD ships as `LIVE_IMPLEMENTED` (fully confirmed live, no auth, HTTPS-native — the historical http-only concern is outdated). Materials Project ships as `IMPLEMENTED_CREDENTIAL_BLOCKED` (real host/endpoint/auth-error confirmed live; full response-body shape not independently re-verified since a key is required — recommend one live-verification pass once a Commander registers a free key).

**AFLOW needs a build-time decision, not a straightforward port of the registry's documented endpoint:** the classic AFLUX API the registry likely has in mind is genuinely dead (404, confirmed live). A real, live, HTTPS, zero-auth replacement exists (AFLOW's OPTIMADE API), and its `/info` endpoint works — but the actual `/structures` data-query endpoint is currently 500ing server-side on AFLOW's own backend, confirmed via multiple live attempts including a trivial no-filter request. Recommend classifying AFLOW as `IMPLEMENTED_ACCESS_DEGRADED` if an adapter is built against the real OPTIMADE `/structures` endpoint (the code path would be correct; the live upstream is presently broken), or documenting it as a live-verification-pending item for a future session when AFLOW's backend may have recovered — do not build against the dead classic AFLUX path.
