# Terra Foundation — Phase G1: Repository + License Analysis

**Upstream:** [`bilawalsidhu/gods-eye-view`](https://github.com/bilawalsidhu/gods-eye-view) ("God's Eye View V1")
**Inspected:** full shallow clone, commit at time of inspection (2026-08-25)
**Method:** repository truth — every claim below was read directly from the cloned upstream repo's own files (`package.json`, `LICENSE`, `DATA_SOURCES.md`, `vite.config.js`, `src/main.js`, `style.css`), not inferred from the README's marketing description.

---

## 1. Upstream repository — is it complete or a placeholder?

**Complete, working, actively maintained.** Not a placeholder or partial release. 428 files, a real `CHANGELOG.md`, `TESTING.md`, `SECURITY.md`, `CONTRIBUTING.md`, a working `npm test` (`scripts/run-unit-tests.mjs`), and a genuinely large surface area: 15+ live third-party data-source integrations, a 3,000+ line `vite.config.js` implementing dev-server proxy middleware for every one of them, a scene-direction/camera system (`src/scenes/director.js`, 1,391 lines), a full annotation system, and an OpenAI-Realtime-backed voice control layer.

## 2. License

**MIT** (`LICENSE`, copyright Bilawal Sidhu, 2026) — covers the **source code only**. The license file itself carries an explicit, prominent carve-out: bundled datasets under `src/data/local_data/` and everything fetched from third-party providers at runtime are **not** MIT and retain their own terms (documented exhaustively in `DATA_SOURCES.md` — ODbL, CC BY 4.0, CC BY-NC-SA, NASA/USGS/US-government public domain, proprietary BYOK terms for Google Maps Platform and TomTom, etc.).

**Compatibility determination:** MIT is fully compatible with proprietary/commercial use, including War Room's own codebase and license posture. **No blocker.** The only constraint that matters for this integration: if Terra ever bundles the same local datasets GEV ships (e.g. anything TeleGeography-sourced, marked NonCommercial), that specific dataset — not the code — must be dropped or separately licensed. **Nothing in Phase G touches those datasets**, so this constraint is noted, not yet triggered.

**Attribution obligation actually incurred by this mission:** none yet. Terra's Phase G code is original TypeScript/React, not copied from GEV's source. If a later phase copies actual GEV source lines (not just the architectural pattern of "use CesiumJS this way"), the MIT notice must be retained per-file or in a NOTICE file at that point. Framed here as a standing rule for future phases, not something violated now.

## 3. Framework, rendering engine, and stack

| Aspect | Upstream (God's Eye View V1) | War Room OS |
|---|---|---|
| App framework | **None** — vanilla ES modules, Vite-bundled, one `index.html` + `src/main.js` entry | Next.js 16.2.6 (App Router), React 19.2.4 |
| Rendering engine | **CesiumJS 1.124** (`cesium` npm package) — WebGL globe, photorealistic 3D tiles via Google Maps Platform, Cesium World Terrain via Cesium ion | `globe.gl` is already an installed dependency (`package.json`) but **verified unused** — no `.tsx`/`.ts` file anywhere in the repo imports it (checked via full-repo grep). `leaflet` is installed and genuinely used, but for a 2D slippy map (`components/earth-intelligence/EarthIntelligenceMap.tsx`, NASA GIBS satellite-imagery tiles) — a different, existing feature (Earth Intelligence), untouched by this mission and not a 3D globe. Neither is a photorealistic-3D-tiles-capable globe engine. |
| State management | Homegrown (`DataLayerManager`, `LAYER_STATE_REGISTRY`, `SceneDirector`) — no external state library | React state/hooks; War Room's own context providers (e.g. `WarRoomUiModeContext`) |
| Build tool | Vite 6 + `vite-plugin-cesium` (auto-copies Cesium static assets, injects `CESIUM_BASE_URL`) | Next.js/Turbopack — **no Cesium-aware plugin exists for Next.js**; static assets must be copied manually (see §4) |
| Backend | Vite dev-server `configureServer` Connect middlewares — ~15 proxy routes for OpenSky, CelesTrak, Overpass, GBFS, adsb.lol, AIS, FIRMS, TomTom, terrain heights, regional briefing, radio, etc. Real, working, key-brokering server code (not a demo stub). | Next.js API routes (`app/api/**/route.ts`); War Room's own Research Engine (`lib/research-engine/`, 42+ provider adapters already in this clone, 200+ on the device repo per its own git status) already covers an overlapping and much broader set of live sources |
| Styling | Hand-written `style.css` (247KB), CSS custom properties for theme (`--accent: #00d4ff` — cyan-primary, GEV's own brand) | Tailwind utility classes throughout War Room's existing components |
| Required client-exposed env vars | `GOOGLE_MAPS_API_KEY` (**hard requirement** — `main.js` throws on boot without it), optional `CESIUM_ION_TOKEN` | N/A |
| Required server-side env vars (optional features) | `OPENAI_API_KEY` (voice), `OPENSKY_CLIENT_ID`/`SECRET`, `FIRMS_MAP_KEY`, TomTom key, AIS key — each individually optional; app degrades that one layer to empty/keyless when absent | N/A |

## 4. CesiumJS + Next.js integration specifics (verified by building it, not assumed)

- CesiumJS resolves its `Workers/`, `Assets/`, `ThirdParty/`, and `Widgets/` directories from a global `window.CESIUM_BASE_URL` at import time. `vite-plugin-cesium` (upstream's build tool) handles this automatically; **no equivalent exists for Next.js**. Solved here with `scripts/copy-cesium-assets.mjs`, a small, original script that copies those four directories from `node_modules/cesium/Build/Cesium/` into `public/cesium/` on `predev`/`prebuild` — reproducible from the pinned `cesium` npm version, not committed to git (`public/cesium/` is gitignored, ~8–23MB of vendor binaries).
- Cesium requires `window`/WebGL — it cannot run during Next.js server-side rendering. Solved with a client-only component (`TerraGlobe.tsx`, `'use client'`) loaded via `next/dynamic` with `ssr: false` from `TerraShell.tsx`.
- Cesium's base widget stylesheet (`cesium/Build/Cesium/Widgets/widgets.css`) is imported directly from the installed package (not copied) — standard Cesium+bundler practice, required even with every default UI widget disabled, since Cesium's internal DOM structure depends on those CSS classes.
- **Verified working end-to-end**: `pnpm exec tsc --noEmit` clean, `pnpm exec eslint` clean, and `pnpm run build` (Turbopack production build) succeeds with `/terra` compiling as a route — not just typechecked, actually built.

## 5. KEEP / ADAPT / REPLACE / REJECT matrix

| Subsystem | Decision | Rationale |
|---|---|---|
| **CesiumJS as the rendering engine** | **ADAPT** | Photorealistic-3D-tiles-capable WebGL globe rendering is a large, hard-to-replicate capability War Room has no working equivalent for (see `globe.gl` row below). Using the same underlying library (a separate, Apache-2.0-licensed dependency of GEV, not GEV's own code) is the pragmatic foundation choice — but wrapped in original React/TypeScript, not GEV's vanilla-JS architecture. |
| **`globe.gl` (pre-existing War Room dependency)** | **REJECT** | Installed in `package.json` already, but verified unused anywhere in the codebase (no importing file found by repo-wide grep) — effectively dead weight, not an in-use alternative. Even if it were wired up, it does not offer Google Photorealistic 3D Tiles or Cesium World Terrain, the specific capability this mission is seeding from GEV. Left installed and untouched — removing unrelated dependencies is out of this mission's scope. |
| **`leaflet` (pre-existing War Room dependency)** | **NOT APPLICABLE — different feature, untouched** | Powers `components/earth-intelligence/EarthIntelligenceMap.tsx`, a 2D NASA-GIBS satellite-imagery map for the existing Earth Intelligence feature. Not a 3D globe, not evaluated as a Terra candidate, and per the mission's explicit instruction, not modified. |
| **GEV's app shell (`main.js`, `index.html`, vanilla ES modules, Vite entry)** | **REJECT** | Incompatible with Next.js/React by construction. Zero lines reused — Terra's shell (`TerraGlobe.tsx`, `TerraShell.tsx`) is original. |
| **GEV's state management (`DataLayerManager`, `SceneDirector`, `LAYER_STATE_REGISTRY`)** | **REJECT for Phase G** (possible ADAPT-for-pattern later) | Homegrown vanilla-JS state, not portable to React as-is. Not needed for Phase G's globe-foundation-only scope; a future phase may look at the *design* of `SceneDirector`'s camera-recipe system as a reference pattern without importing its code. |
| **GEV's ~15 live-data proxy middlewares (`vite.config.js`)** | **REJECT for direct reuse; REFERENCE ONLY for Phase H** | Vite Connect-middleware specific, not portable to Next.js API routes without a full rewrite. More importantly: several of these categories (weather, satellites, general research sources) overlap with War Room's own Research Engine (`lib/research-engine/`, already 42+ provider adapters in this clone alone), which is explicitly the system Terra is instructed to consume later, not duplicate. Individual parsing/normalization utilities (e.g. FIRMS CSV parsing, ADS-B fallback normalization) may be worth referencing for pattern only if/when a specific source isn't already covered by Research Engine — a Phase H decision, not this one. |
| **GEV's visual identity (cyan-primary `--accent: #00d4ff`, "GOD'S EYE VIEW" wordmark/logo)** | **REJECT** | Mission explicitly directs War Room's own visual language (neon green primary, amber alerts, cyan reserved for data layers only) — not GEV's branding. Terra's CSS uses War Room's existing Tailwind/dark-glass conventions from `EngineeringMissionConsole`/`BuilderWorkspace`, not GEV's stylesheet. |
| **GEV's CSS custom-property theming *mechanism*** | **ADAPT (pattern only)** | The idea of theme-driven CSS variables for glow/accent effects is sound and War Room already uses a comparable Tailwind-class-driven approach; no upstream code copied. |
| **Google Photorealistic 3D Tiles requirement** | **DEFERRED / NOT WIRED** | Hard-requires a billed `GOOGLE_MAPS_API_KEY`; none is configured in this environment. Rather than fabricate a "premium" appearance, Phase G ships with credential-free OpenStreetMap base imagery and honestly reports which tier is active (see `TerraGlobe.tsx`'s `TerraGlobeStatus`). Enabling photorealistic tiles later requires only a key — no architecture change. |
| **Cesium ion token (World Terrain, Bing imagery)** | **DEFERRED / NOT WIRED** | Same reasoning — optional, absent in this environment, honestly reported as absent, not faked. |
| **GEV's attribution/license-carve-out discipline (`DATA_SOURCES.md`)** | **ADAPT (practice, not the file)** | The *practice* of exhaustively documenting every third-party source's license and rendering required attribution on-screen is exactly right and will be followed when Terra actually wires live sources (Phase H+) — through War Room's own Earth Knowledge Registry / Research Engine provenance system, not a second copy of GEV's file. |
| **GEV's voice-control layer (OpenAI Realtime)** | **REJECT for Phase G** | Out of scope; not evaluated for later phases here. |

## 6. What this means architecturally

Terra's foundation takes exactly one thing from God's Eye View V1: **the choice to use CesiumJS as the globe rendering engine.** Everything else — the app framework, state management, backend/proxy layer, data-source integrations, and visual identity — is either already War Room's own (Next.js, React, Tailwind, Research Engine) or built fresh for this mission. This is consistent with the mission's own framing: *"the end product is NOT an embedded copy of God's Eye View... God's Eye View V1 is the seed implementation only."*

---
*Prepared by inspecting the real, cloned upstream repository — no claim above was asserted without reading the corresponding upstream file.*
