# WAR ROOM OS / TERRA — COMPLETE RESEARCH + EXECUTION PACK FOR CHATGPT

- **Commander:** Mark
- **Date:** 2026-09-17
- **Standing order:** RESEARCH ONLY until Commander reopens builds — prompts are for ChatGPT/Cursor review; do not commit/push/deploy without authorization
- **Auth baseline:** PUBLIC / PROVIDER_AUTH / COMMANDER_PRIVATE ACTIVE; OHGO LIVE; Caltrans LIVE; 511NY PARTIAL; camera federation PARTIAL
- **Coverage Debt:** NO_COVERAGE is not acceptable steady state; hunt lawful feeds; never fake green
- **Team that produced this:** Personal Assistant (lead), Personal Assistant 2, Evidence Scout, Context Historian, Science Analyst, Blind Spot Checker, Legal Researcher, War Room Research, War Room Engineer (parity lane)

## Truth-audit lanes IN SO FAR (partial — cloud agent still running)

- **Context Historian:** Wave DONE stamp = research proven only. Never claimed IMPLEMENTED: router ship, KYTC/MRMS/CAP Terra wire, any W2/W3 P0 adapter, Media Player, Live Intel HUD, weather lux particles. Known LIVE claims (still need SOURCE↔DEV↔3848 re-prove): OHGO, Caltrans, GIBS, ON/QC/HK/Digitraffic regional.
- **Science Analyst:** DONE requires registry+bbox router on 3848; CAP toast→flyTo→drawer; MRMS ImageryLayer+tile 200; nuclear only after egress+markers. Wave DONE ≠ code DONE.
- **Evidence Scout:** sent PA2 Waves 1–3 byte/API research shortlist (READY/PARTIAL/BLOCKED/UNFILLABLE) — research only.

- **STALE docs to ignore if conflict:** TERRA_GAPS_EXECUTION_PROMPT_FINAL (use CURRENT DELTA instead)

## What ChatGPT should do

1. Reconcile pack into one implementation-ready delta.
2. Never treat RESEARCH DONE as LIVE.
3. Preserve refuse lines (no scrape, no Terra2, no fake coverage, no DNA edit, research-only until reopen).
4. Return a single prioritized build order for when Commander reopens.

---

The source documents below are reproduced verbatim and in the requested order. Section framing markers are assembly metadata; source content between each pair of markers is unchanged.


===== BEGIN SOURCE 01: CHATGPT_FULL_WAR_ROOM_TERRA_PROMPT.md =====
# CHATGPT / CURSOR — FULL WAR ROOM · TERRA · GOD'S EYE PROMPT
# Commander: Mark | Assembled: Personal Assistant | 2026-09-16/17
# Paste this entire document into ChatGPT or Cursor as authoritative context.
# Do NOT invent roadmap numbers. Do NOT create Terra2/Council2/ASTRA2.
# Do NOT print secrets (OHGO_API_KEY, Cesium ion token). Do NOT commit/push/deploy without Commander auth.

==================================================
ROLE
==================================================
You are helping Commander Mark build War Room OS — a sovereign stack.
Chain: COMMANDER → WAR ROOM → TERRA → COUNCIL → ASTRA → bounded tools.
- Terra = world-state Oracle (CesiumJS God's Eye / camera on Earth)
- Council = reasoning / synthesis
- ASTRA = action only when Commander authorizes
God's Eye = live awareness UX **inside** Terra — not a replacement for Terra.

==================================================
CURRENT PLATFORM TRUTH (2026-09-16)
==================================================
- Nebula Genesis Linux; War Room OS 0.2.0 installed
- UI 127.0.0.1:3848 · Core 3847 · Dev Next 3001 (different runtimes)
- Repo → 3848 requires: build → .next/standalone → prepare desktop → rebuild deb/AppImage → reinstall
- Do NOT patch /opt unless authorized
- Data root: ~/.local/share/war-room-os
- Repo paths: Linux /home/chosenone/Codex/war-room-os · Windows C:\Users\markb\Documents\Codex\war-room-os

==================================================
TERRA VERIFIED ON 3848
==================================================
ACTIVE: NASA GIBS Daily, Cesium World Terrain, ion World Imagery + labels, OSM Buildings (assets 1/2/3/96188 HTTP 200)
Cinematic orbit, compact UX, polar artifact fixed.
Token: NEXT_PUBLIC_CESIUM_ION_TOKEN in .env.local — never print.
ion World Terrain/Imagery = STREAM_ONLY under Cesium ion ToS (not possess/offline dump).
Ownable DEM (OpenTopography COP30/NASADEM/SRTM) remains parallel lane for offline/sim.

Immediate blocker (NOT Cesium): Commander-session auth — /api/terra/live-intel and /api/terra/layers/* 401 on installed 3848 until wr_local_session continuity fixed.

==================================================
HARD CLAIM SPLITS
==================================================
POSSIBLE ≠ SHIPPED · STREAM ≠ POSSESS · WORLD-STATE ≠ SCENARIO
COMMANDER_NOTES ≠ MLS TRUTH · FOOTPRINT ≠ BLUEPRINT · LINK-OUT ≠ INGEST
personal click + personal save — never call workaround/go-around
Wave 5 / WRIM training: OFF unless Commander authorizes

==================================================
GOD'S EYE ENHANCEMENT (RESEARCH DIRECTIVE SUMMARY)
==================================================
Zoom: PLANET → COUNTRY → CITY → NEIGHBORHOOD → STREET → BUILDING/ROAD/SIGNAL/CAMERA/VEHICLE/EVENT
Domains: EARTH · URBAN · MOBILITY · STREET INTEL · INTELLIGENCE
Better-than-Google (real only): live intel, multilingual + original language first, event-local time, provenance, conflict overlays, aviation/maritime/traffic/cameras, open building IDs, Council, Commander notes, own capture/3D, coverage honesty — NO fake Street View parity.
Coverage labels: GLOBAL/REGIONAL/LOCAL/DATASET_DEPENDENT/PROVIDER_DEPENDENT/NO_COVERAGE + STATIC/NEAR_REALTIME/LIVE
Ownership: OWNABLE/SELF_HOSTABLE/STREAM_ONLY/RESEARCH_ONLY/NONCOMMERCIAL/COMMERCIAL_OK/ATTRIBUTION/SHARE_ALIKE/AUTH/PAID

Street intel (lawful): MapillaryJS + Panoramax dual-pane; Mapillary hosted = STREAM_ONLY; Vistas = RESEARCH_ONLY (NC-SA); own-capture COLMAP/Nerfstudio/GS/ODM only; NO Google SV/Maps as ML training.
GH/HF/forges: MapillaryJS, Panoramax, Re:Earth, CTOD/Tiletopia, Overture, OSGeo, OpenTopography, Copernicus, Codeberg/GitLab/SourceHut/Software Heritage — no dark-web/leaks.

==================================================
TRAFFIC CAMERA FEDERATION — RESEARCH RESULTS
==================================================
Mission: lawful PUBLIC traffic cameras only. No private residential. No auth bypass. No hacked/leaked feeds.
Terra camera UI may fail from Commander-session auth — not provider failure.

## Baseline verified (pre-expand)
1. Fintraffic Digitraffic (FI) — public JPEG + metadata
2. Ontario 511 — large inventory, public JPEGs
3. Hong Kong TD — public images + Last-Modified
4. Québec 511/MTMD — WFS metadata; JPEG behavior differs

## Build order LOCKED by Commander (research STOPPED for expand waves)
1. **OHGO (Ohio)** — PUBLIC_KEY + refreshed JPEGs · field map locked · live header `Authorization: ApiKey …` returns 200 · OHGO_API_KEY in war-room-os/.env.local (gitignored) · register https://publicapi.ohgo.com/accounts/registration · cameras https://publicapi.ohgo.com/docs/v1/cameras
2. **511NY** — stills verified; VideoUrl = link-out only
3. **Caltrans CWWP2** — stills; stream fair-use limits

## Cursor-ready / next expand candidates (NOT in build order yet)
- Alberta 511 (PNG), Singapore LTA, NZTA, Trafikverket SE
- Wave 2 research (need key + byte-prove): WSDOT, 511GA, MB 511, NL 511, Korea ITS Type 3 stills
- Pending: DriveBC image TLS UNVERIFIED; TfNSW HOLD until API key

## HOLD / NO_COVERAGE this research
PA (license), MI + Ohio Turnpike (HTML_VIEWER_ONLY), JP cams, FR stills, DE empty, UK NH, TW member-only, LatAm/ME/Africa sparse — do not force adapters

## Normalized camera schema
id, provider, agency, country, region, road, locationName, lat, lon, direction, bearing, feedType, imageUrl, streamUrl, viewerUrl, lastUpdated, freshnessState, coverageState, authState, license, attribution, sourceUrl
Health: LIVE | STALE | OFFLINE | NO_COVERAGE | AUTH_REQUIRED | RATE_LIMITED | UNAVAILABLE — never call stale LIVE
UX: cluster at global zoom; markers at road zoom; click→inspect; Cesium cluster→marker→inspect

==================================================
LISTINGS / NOTES / SIM (STANDING LOCKS)
==================================================
Listings: LINK-OUT until IDX; refuse scrape/headless/unofficial APIs/iframe/auto-OCR
Notes: source=commander_notes; opt-in Council; never upgrade to MLS truth
Sim: DEM→imagery→buildings→begin-sim→AI scenario; Cesium for Unreal later on OWNED tiles; architecture lesson from GTA/inZOI only — no game assets/code
World-state tags: dem|osm|overture|sentinel · Scenario: generated|scenario

==================================================
ENGINEERING PRIORITY (CURRENT)
==================================================
1. Fix Commander-session auth on 3848 (live-intel + layers)
2. OHGO adapter live (in progress with War Room Engineer / Cursor cloud agent) → then 511NY → Caltrans
3. Live Intel UX (EARTH/LOCAL/HEADLINES/BREAKING/EVENTS/CONFLICT/WORLD TIME; original language first)
4. Ownable DEM lane (keep ion online)
5. Click→info, notes, begin-sim later

==================================================
REFUSE
==================================================
Private cams · auth bypass · hacked/leaked feeds · Google Earth/Maps/Photorealistic offline extract · Zillow scrape · fiction upgraded to Earth · dark-web/cracked engines · inventing intel/geopolitics

==================================================
YOUR JOB WHEN GIVEN A TASK
==================================================
1. Respect CURRENT PRODUCT TRUTH and research results above
2. Prefer smallest diffs against existing Cesium /terra stack
3. Classify sources with ownership + coverage labels; say UNVERIFIED when not verified
4. Never print API keys or ion tokens
5. No commit/push/deploy without explicit Commander authorization
6. When proposing adapters, fill schema fields you can prove and leave others empty


==================================================
APPENDIX A — TERRA DEVELOPMENT CURSOR PROMPT (FULL)
==================================================

# CURSOR PROMPT — War Room Terra Development (from Terra Research Swarm)
# Commander: Mark | Lead synthesis: Personal Assistant
# Paste into ChatGPT / Cursor as the authoritative product + engineering brief.
# AUTHORITATIVE SESSION UPDATE LOCKED 2026-09-16 — supersedes older DEM-unavailable / migration-freeze assumptions where they conflict.
# Do NOT invent roadmap numbers. Do NOT create Terra2/Council2/ASTRA2. Do NOT merge Terra into Council or ASTRA.
# Do NOT say "workaround" or "go-around" for personal click + personal save.
# Wave 5: do not start without explicit Commander authorization. WRIM training OFF.

## CURRENT PLATFORM (2026-09-16)
- War Room OS 0.2.0 on Nebula Genesis Linux
- Installed UI 127.0.0.1:3848 · Core 3847 · Dev Next 3001 (different runtimes)
- Repo → 3848 requires: build → .next/standalone → prepare desktop → rebuild deb/AppImage → reinstall
- Do NOT patch /opt unless authorized
- Data root: ~/.local/share/war-room-os
- Icon: desktop/assets/war-room-os.png · Name=War Room OS

## TERRA VERIFIED ON 3848
- NASA GIBS Daily ACTIVE (independent of ion)
- Cesium World Terrain ACTIVE · World Imagery + labels ACTIVE · OSM Buildings ACTIVE (assets 1/2/3/96188)
- Terrain heights available; polar artifact fixed; cinematic orbit; compact UX
- Token: NEXT_PUBLIC_CESIUM_ION_TOKEN in .env.local — never print
- Allowed origins include :3001 and :3848 localhost/127.0.0.1

## IMMEDIATE PRIORITY
1. Fix Commander-session continuity (wr_local_session / requireCommanderSession) so /api/terra/live-intel and /api/terra/layers/* return 200 on installed 3848 (401 is session gate, NOT Cesium; AIS/maritime/aviation not the cause)
2. Live Intel compact surface: EARTH · LOCAL · HEADLINES · BREAKING · EVENTS · CONFLICT · WORLD TIME — glance→hover→inspect→expand; globe stays hero
3. Original language first (originalLanguage/originalHeadline/originalSummary) + optional English toggle; translationState; never overwrite source with translation
4. World time via coordinate→IANA (not Commander machine TZ); event time = source + local + UTC
5. Conflict intel: neutral evidence CONFIRMED|REPORTED|DISPUTED|UNVERIFIED; no advocacy/speculation-as-fact
6. Provenance required; SEND TO COUNCIL keeps Observed Data | Council Analysis | Commander Annotation separate
7. Then: ownable DEM lane (keep ion World Terrain; no silent ellipsoid) → imagery → buildings → click→info → notes → begin-sim → scenario → IDX when authorized

## Mission
Improve Terra (God's Eye Cesium globe at `/terra`) to feel like Google Maps, then better — on an OWNED stack with provenance.
Goals: zoom buildings, click→info, first-person ground view, live enrich without warehousing Earth, personal notes/questionnaire → optional Council, later click→begin-sim + type-to-AI scenario builds ("imagine"), lawful for-sale via IDX when authorized.

Terra = world-state Oracle (camera/archive of Earth with receipts).
Council = meaning / reasoning.
ASTRA = action only when Commander authorizes.
Scenario/AI imagine = sandbox on top of Earth, never silent rewrite of verified world-state.

---

## Evidence Scout — lawful sources & locks

### World-state (ingest / own)
- DEM: OpenTopography API — COP30/NASADEM/SRTM — https://portal.opentopography.org/apidocs/
- Imagery: Copernicus Sentinel-2 (credit notice) — https://dataspace.copernicus.eu/ · https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice
- Buildings: Overture Buildings (ODbL, GeoParquet) — https://docs.overturemaps.org/guides/buildings/
- OSM footprints/tags (ODbL) — https://www.openstreetmap.org/copyright · Overpass https://wiki.openstreetmap.org/wiki/Overpass_API
- Places/POIs: Overture Places + OSM amenities — https://docs.overturemaps.org/guides/places/
- History enrich: Wikidata CC0 — https://www.wikidata.org/w/rest.php/wikibase/v1 · Wikipedia CC BY-SA — https://en.wikipedia.org/wiki/Wikipedia:Reuse

### Click card / live enrich (thin local)
- Local: building id (OSM way / GERS) + geometry + short TTL cache
- Live: Overpass / Wikidata / Overture DuckDB bbox-or-id — https://docs.overturemaps.org/getting-data/duckdb/
- Coverage honesty: live | cached | stale | no_coverage | auth_required | partial
- Product scale: self-host Overpass; public Overpass rate-limits (~100 q / ~10 MB/day class)

### Listing / for-sale
- NO public merge API for Zillow+Realtor+Trulia
- Link-out only until IDX: new-tab when address exists; hide if no address
- Zillow ToS: no automated obtain; personal view/save/print/email without automation; no display of other Zillow data without approval — https://www.zillow.com/corporate/terms-of-use/
- Realtor/Move: link limits; no framing — https://www.realtor.com/terms-of-use/
- Lawful summarize: MLS/IDX/RESO when participant-authorized — https://dd.reso.org/DD2.1/Property/ · NAR IDX 7.58
- IDX card fields (when feed exists): ListingKey, StandardStatus, ListPrice, BedroomsTotal, baths, LivingArea, address, lat/lon, AttributionContact, ModificationTimestamp — local MLS may restrict

### REFUSE
- Google Photorealistic 3D Tiles / Maps / Earth download, cache, offline, extract, game export — https://developers.google.com/maps/documentation/tile/policies
- Scrape / headless / discard-HTML / unofficial Zillow APIs / private-app fetch of listing pages
- Planet-wide interior blueprints as default layer
- Auto-screenshot/OCR of listing pages by Terra
- Upgrading commander_notes or scenario meshes into verified Earth/MLS truth

### Personal path (NOT a workaround — name exactly)
- Mark opens listing → OS screenshot → attaches to private note = **personal click + personal save**
- Portal shots: local/high-caution; Council default = paraphrase + URL (or Mark's own exterior photo)
- Questionnaire: empty prompts Mark answers; `source=commander_notes`; opt-in to Council

### Sim / imagine
- Own stack → Cesium / Cesium for Unreal — https://cesium.com/platform/cesium-for-unreal
- Tag: `source=dem|osm|overture|sentinel` vs `source=generated|scenario`
- Order: DEM → imagery drape → building tiles → begin-sim → AI scenario agent
- Installed Terra: Cesium World Terrain ACTIVE. Long-term ownable DEM still parallel (OpenTopography/COP30/NASADEM/SRTM); never silent ellipsoid fallback

---

## Context Historian — lineage & War Room claims

### Public lineage
- Keyhole → Google Earth 2005; Cesium open 2012 / 1.0 2014; Google plugin ended 2015 → Cesium migrations
- Overture Maps Foundation Dec 2022
- Google Photorealistic 3D Tiles = look stream, not possessable
- Cesium for Unreal/Unity = sim on YOUR tiles
- For-sale on maps = MLS/IDX privilege; Zillow public API sunset 2021; Bridge/RESO for approved parties
- Unofficial "read then tell / discard HTML" = automated obtain dead end

### War Room prior claims (inventory only — no new roadmap numbers)
- `docs/terra/AUTOMATIC_URBAN_DETAIL.md` PASS (9571af1): auto roads + footprints historically; **2026-09-16 installed Terra**: World Terrain + OSM Buildings ACTIVE on 3848 — treat session update as newer verified runtime truth
- **CORRECTION:** that PASS does NOT document click→info panel — click UX is OPEN
- #13 Terra→Council bridge PASS (ad888b7)
- Phase G: Google Photorealistic DEFERRED / NOT WIRED
- `terraOracleContract.ts` / #21: Terra = WORLD_STATE_SOURCE; does NOT authorize action; coverageState + councilReviewState
- NAVIGATION_AGENT implemented; PHONE_APP NOT

### Already claimed vs still open
- Closed: auto footprints/roads, Terra↔Council bridge, Oracle contract, Google tiles deferred, DEM unavailable recorded
- Open: live-intel Commander-session 401, Live Intel UX+i18n+world time, click→info panel, ownable DEM lane, self-host Overpass, FPS/Street View parity, IDX feed, questionnaire UI, begin-sim, AI scenario agent, planet photoreal offline

---

## Science Analyst — Cesium mechanism

### Two layers (never merge)
1. WORLD-STATE: DEM + imagery + buildings — measured Earth
2. SCENARIO: AI/Commander builds — `source=generated|scenario`

### Click → info (ESTABLISHED)
- `scene.pick` / `drillPick` → feature props — Cesium docs
- Thin local + async enrich; cancel on new pick; don't block render loop
- War Room click PANEL not shipped yet

### LOD / FPS
- 3D Tiles + SSE; self-host for scale
- No built-in Street View; WASD walk ~1.7m AGL needs real DEM
- Footprint ≠ blueprint

### Sim
- DEM + collision → begin-sim; type-to-AI places catalog/procedural assets tagged generated
- Expect satellite/digital-twin look, not Google street photoreal
- Scenario ≠ real-world action authorization

### Build order (dependency)
1. Wire ownable DEM
2. Drape open imagery
3. Building tiles (or extrude; watch downtown cost)
4. Click → skeleton → open-API enrich + outbound listing buttons
5. Personal notes + questionnaire (local); optional Council opt-in
6. Begin-sim
7. AI scenario agent
8. IDX only when authorized

---

## Blind Spot Checker — claim hygiene

### Hard splits
1. POSSIBLE ≠ SHIPPED
2. STREAM ≠ POSSESS
3. PERSONAL CLICK + PERSONAL SAVE ≠ workaround
4. PRIVATE ≠ scrape hall pass
5. WORLD-STATE ≠ SCENARIO
6. COMMANDER_NOTES ≠ MLS truth
7. FOOTPRINT ≠ BLUEPRINT
8. LINK-OUT ≠ INGEST

### Anti-patterns (REJECT if proposed)
- "Private so ToS doesn't apply"
- "We only read / discard HTML / unofficial API"
- "Download Google Earth into Unreal"
- "Auto-fill questionnaire from Zillow"
- "Clickable props already shipped because urban-detail PASS"
- "Begin sim" on ellipsoid without calling heights fake
- Mixing notes / IDX / open-API / scenario into one unlabeled truth blob
- Saying workaround/go-around for personal click + personal save

### Better than Google
- REAL: provenance, coverage honesty, owned stack, labeled scenario fiction, Council evidence
- DO NOT CLAIM YET: photoreal facades, Street View parity, Zillow-class cards without IDX, Google-smooth on public Overpass

---

## Legal Researcher — licenses, ToS, copyright, IDX, privacy (cite published grants; never invent law)

### Decision vocabulary (use these labels in code/docs)
- INGEST — Terra may store/display under the cited grant (with attribution where required)
- LINK-OUT — new-tab only; do not fetch/iframe/redisplay their content
- REQUIRE-AUTH — needs MLS/IDX/RESO (or written approval) before summarize/display
- REFUSE — do not build

### World-state (INGEST with credit)
- Copernicus Sentinel: free/full/open reproduce/adapt/combine for lawful use; notice `Copernicus Sentinel data [Year]` or `Contains modified Copernicus Sentinel data [Year]` — https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice
- DEM: only products with published open terms (verify each OpenTopography/product license before ship)
- OSM + Overture: ODbL — attribution + share-alike on derived databases — https://www.openstreetmap.org/copyright · Overture docs
- Wikidata: CC0 · Wikipedia: CC BY-SA reuse (prefer facts + cite; don’t paste prose) — https://www.wikidata.org/wiki/Wikidata:Data_access · https://en.wikipedia.org/wiki/Wikipedia:Reuse
- Lawful drone/phone photogrammetry Mark owns → mesh/3D Tiles OK

### Google Earth / Maps / Photorealistic 3D Tiles — REFUSE as possessable
- Map Tiles API: visualization only; no pre-fetch, store, cache, offline, extract, image analysis, geodata extraction — https://developers.google.com/maps/documentation/tile/policies
- Stream ≠ possess. No Google rip → Unreal/offline game. Attribution rules apply only if you lawfully stream (War Room: deferred/not wired)

### Listing storefronts (Zillow / Trulia / Realtor)
- Zillow ToS: limited personal license; copy **without automated processes** only to view/save/print/fax/email; BAN automated queries (scrapers/robots/“any other automated activity with the purpose of obtaining information”); BAN displaying other Zillow data without written approval — https://www.zillow.com/corporate/terms-of-use/
- Realtor/Move: link-creation limits (homepage notice); no framing — https://www.realtor.com/terms-of-use/
- LINK-OUT: new-tab when address exists; hide if no address. REFUSE: scrape, headless, discard-HTML, unofficial APIs, iframe, Terra agent fetch “for” Mark
- “Private / personal Terra” is NOT a hall pass for automated obtain
- REQUIRE-AUTH for portal-class price/beds/photos/summary inside Terra: MLS participant + IDX/RESO feed

### IDX / RESO (when authorized) — INGEST for display under participant control
- NAR IDX Policy Statement 7.58 — https://www.nar.realtor/handbook-on-multiple-listing-policy/advertising-print-and-electronic-section-1-internet-data-exchange-idx-policy-policy-statement-7-58
- Must: identify listing firm + listing participant email/phone (prominent, typeface ≥ median of listing data); identify brokerage operating the display; participant control of display
- Refresh downloads + auto-fed displays ≥ every 12 hours; pull expired/withdrawn / seller “no internet” listings promptly (local MLS may be stricter — UNVERIFIED until vendor chosen)
- Do not modify other participants’ listing content; non-MLS facts clearly separated + source labeled
- IDX for display only — not redistribute MLS DB; refuse confidential participant-only fields
- Field names: RESO DD Property / IDX payload — https://dd.reso.org/DD2.1/Property/ · https://dd.reso.org/DD2.1/xref/payload/IDX/
- Until feed connected: card shows auth_required (+ optional link hub)

### Blueprints / interiors
- Architectural works generally copyrighted (US). Footprint ≠ blueprint. REFUSE planet-wide interior plans as default layer
- LINK-OUT when lawful URL exists (listing marketing image, permit portal, owner-supplied). Overlay only with rights to that asset

### Personal click + personal save (NOT a workaround — never call it go-around)
- Mark opens listing in his browser → OS screenshot → he attaches to private note = closest to personal save path
- REFUSE Terra auto-screenshot / OCR / headless grab
- Portal screenshots in Terra: HIGH CAUTION / local-only (display + copyright residual risk). REFUSE by default forwarding portal listing photos to Council
- Prefer: paraphrase in Mark’s words + outbound URL; or Mark’s own exterior photo; or OSM/Wiki shots with attribution

### Notes / questionnaire → Council
- INGEST: empty prompts + Mark’s typed answers + timestamp + building id + URL he opened → source=commander_notes
- REFUSE auto-fill from portal HTML
- Council: OPT-IN send only; never upgrade commander_notes to MLS/listing truth; keep buckets separate (notes | open-API | IDX | scenario)
- Privacy: notes on others’ homes stay local until Mark opts in

### Sim / type-to-AI builds
- INGEST sim geometry only from owned/open grants above
- Scenario objects: source=generated|scenario — fiction layer; never upgrade to verified Earth
- Catalog/asset packs: obey their licenses; don’t treat model output as free rehost of third-party copyrighted props
- Scenario ≠ authorization to act in the real world

### Cursor anti-patterns (Legal — reject)
- Private so ToS doesn’t apply
- We only read / discard HTML / unofficial listing API
- Download Google Earth into Unreal
- Use GTA / RAGE / inZOI / other game engines' code or assets
- Auto-fill / auto-screenshot listing pages
- Workaround / go-around for personal click + personal save
- Summarize Zillow/Trulia/Realtor into the card without IDX
- Mixing commander_notes / IDX / open-API / scenario into one unlabeled truth blob

### Confidence
- High: Google stream-only; Zillow automated + display bans; NAR IDX attribution/refresh baselines; Sentinel open notice; ODbL; link-out vs ingest split
- Medium: residual risk of private portal screenshots living inside Terra UI
- UNVERIFIED until chosen: specific MLS vendor field/media/refresh/attribution extras

---


## Sim architecture lock (GTA / inZOI lesson — architecture only)

Rockstar uses a private engine (RAGE) + streamed handmade city + character physics (Euphoria). inZOI uses Unreal Engine 5 + World Partition + life-sim AI. Terra does NOT copy those engines, maps, cars, or assets (copyrighted). Steal the architecture only:

- Stream tiles; never load the whole planet
- Simulate only the neighborhood in view
- People/vehicles = cheap scenario AI on top, tagged `source=generated|scenario`
- Real Earth geometry from owned stack (DEM + Sentinel + OSM/Overture), not a game city

### What to build on
- Globe already in War Room: CesiumJS at `/terra` (keep; do not create Terra2)
- Click-to-begin-sim later: **Cesium for Unreal** on the same owned 3D Tiles (optional Cesium for Unity)
- Unreal World Partition / Cesium streaming = GTA-like feel on real Earth
- REFUSE: GTA/RAGE/inZOI code or assets; Google Photorealistic tiles as offline sim content

### Honest order
DEM wired → imagery drape → building tiles → begin-sim → AI scenario agent

---

## Acceptance criteria (Cursor / Engineer)
- [ ] Commander-session auth fixed on 3848 for live-intel + layers
- [ ] Live Intel categories + original language + world time
- [ ] Ownable DEM foundation progress (ion World Terrain remains ACTIVE)
- [ ] Click building → skeleton props → async open-API enrich with coverage honesty
- [ ] Outbound listing buttons (new tab) when address present; hidden otherwise
- [ ] No portal HTML ingest; no Google tile offline store
- [ ] Personal notes + questionnaire on building id; `commander_notes`; opt-in Council only
- [ ] Manual screenshot attach allowed; Terra auto-capture forbidden
- [ ] Begin-sim only after DEM + collision; AI builds tagged `generated|scenario`
- [ ] No GTA/RAGE/inZOI assets or leaked game code; Unreal+Cesium on owned tiles only
- [ ] IDX path stubbed as `auth_required` until real feed
- [ ] Wave 4 frozen; no Wave 5 in this work
- [ ] Brief language never says workaround/go-around for personal click + personal save

## Cursor instructions
Implement against existing War Room Cesium `/terra` stack. Prefer smallest diffs. Preserve Terra Oracle boundaries. Do not invent new master-roadmap numbers. Do not create Terra2. Validate with existing `validate:terra*` scripts where applicable. Prefer self-host plans over public Overpass for product traffic. Ask Commander before any MLS vendor choice or paid ion/Google keys.


==================================================
APPENDIX B — GOD'S EYE RESEARCH DIRECTIVE (FULL)
==================================================

# COMMANDER RESEARCH DIRECTIVE — GOD'S EYE ENHANCEMENT SWARM
(Reconstructed from Mark’s ChatGPT → War Room Research paste, via Personal Assistant 2, 2026-09-16)

## MISSION
Evolve War Room Terra’s GOD’S EYE into the strongest lawful/open Earth-awareness system. Cursor integrates identified OSS. Do NOT replace Terra.
- Terra = CesiumJS world-state
- God’s Eye = live awareness UX inside Terra

## CURRENT PRODUCT TRUTH (verify live)
CesiumJS, NASA GIBS, Cesium World Terrain, ion World Imagery, OSM Buildings, Live Intel, Earth Intel, headlines/events/conflict, world time + event-local time, original-language + optional EN translation, fly-to, provenance, Send to Council, Commander annotation, desktop on 3848.

## GOD’S EYE ZOOM LADDER
PLANET → COUNTRY → CITY → NEIGHBORHOOD → STREET → BUILDING / ROAD / SIGNAL / CAMERA / VEHICLE / EVENT
Always with truthful world-state + provenance.

## DOMAINS
- EARTH: terrain, imagery, elevation, weather, quakes, volcanoes, wildfire, storms, hazards
- URBAN: buildings, roads, names, addresses, house numbers, intersections, signals, signs, lanes, infra
- MOBILITY: traffic, closures, transit, aircraft, maritime, rail
- STREET INTEL: panoramas, lights, signs, lanes, sidewalks, buildings, entrances, vehicles, furniture, object recognition
- INTELLIGENCE: news, headlines, breaking, events, conflict, disruption, provenance

## RESEARCH TARGETS (verify official repos + licenses)
MapillaryJS, Mapillary Vistas, Panoramax, Re:Earth Terrain, Re:Earth Buildings, Overture Maps, OSM/Overpass tags (addr:*, highway, lanes, maxspeed, traffic_signals, crossing, traffic_sign, surveillance public-only, public_transport, railway, building, entrance), traffic cameras (DOT/511/DATEX II — no private cams), traffic signals (static vs SPaT/MAP/NTCIP/V2X LIVE), mobility feeds, street-level 3D recon (COLMAP/OpenMVG/OpenMVS/Nerfstudio/GS/ODM — lawful imagery only; NO Google SV/Maps as training input), Hugging Face street models (license / commercial / local RTX 5060 Ti 16GB fit).

## BETTER-THAN-GOOGLE DIMENSIONS (claim only what is real)
Live intel, multilingual reporting, event-local time, provenance, conflict overlays, aviation/maritime/traffic/cameras, open building IDs, native names, Council, Commander notes, own imagery/3D, open data, offline regional, transparent coverage.
Do NOT claim visual parity where it doesn’t exist.

## COVERAGE TRUTH LABELS
GLOBAL / REGIONAL / LOCAL / DATASET_DEPENDENT / PROVIDER_DEPENDENT / NO_COVERAGE
STATIC / NEAR_REALTIME / LIVE

## OWNERSHIP MATRIX
OWNABLE / SELF_HOSTABLE / STREAM_ONLY / RESEARCH_ONLY / NONCOMMERCIAL / COMMERCIAL_OK / ATTRIBUTION / SHARE_ALIKE / AUTH / PAID

## VISTAS RULE
Keep Mapillary Vistas in research/eval. If NC blocks commercial: RESEARCH/EVAL lane + find permissive peers.

## PRIOR ART NOTE
MapLibre fill-extrusion / deck.gl / Streets GL / HF GLPN / StreetCLIP / Open3DMap = prior art only — not a Terra engine swap. Refuse Google imagery → ML training.


==================================================
APPENDIX C — TRAFFIC CAMERA FEDERATION DIRECTIVE (FULL)
==================================================

# COMMANDER DEEP RESEARCH DIRECTIVE — GLOBAL PUBLIC TRAFFIC CAMERA FEDERATION

MISSION: Find the strongest lawful/public traffic-camera sources for War Room Terra / God's Eye.
- Do NOT research private residential cameras
- Do NOT bypass authentication
- Do NOT use hacked, leaked, credential-stolen, or restricted feeds
- Goal: broadest PUBLIC / AUTHORIZED traffic-camera federation for Terra

## CURRENT VERIFIED WAR ROOM STATE
Adapters / verified activity:
1. Fintraffic Digitraffic — Finland roads, live station metadata, public JPEG
2. Ontario 511 — large public camera inventory, public JPEGs verified
3. Hong Kong Transport Department — public traffic camera image host, live Last-Modified
4. Québec 511 / MTMD — WFS camera metadata, public viewer; direct JPEG behavior differs

Blocker: Terra UI camera inspection not verified because urban APIs behind Commander-session auth.
Do NOT mistake that auth issue for provider failure.

## RESEARCH OBJECTIVE
PUBLIC traffic-camera systems worldwide with usable programmatic access.
Prioritize: official DOT, 511, municipal traffic depts, state/provincial APIs, national highway agencies, open-data portals, public still-image endpoints, public live video where explicitly permitted, WFS/GeoJSON/JSON/XML/DATEX II metadata, GTFS-RT adjacent road incidents where useful, open CCTV where explicitly public.

## REGIONS
US (esp. OH, PA, MI, NY, CA, TX, FL, IL, GA, WA, CO, AZ, NV, NC, VA, MD, MA) + cities/counties/tolls
OHIO PRIORITY: OHGO, Summit/Akron, Cleveland, Turnpike, freeway cams, incidents, construction, RWIS, metadata APIs, image/stream URLs, ToS, refresh — verify API/image access not just browser
CANADA: ON/QC/BC DriveBC/AB/MB/SK/NB/NS/NL
EUROPE: Finland Digitraffic, NO, SE Trafikverket, DK, NL NDW, DE Autobahn, FR Bison Futé, UK National Highways, IE TII, ES DGT, IT ANAS, CH, ATFINAG, PL GDDKiA, CZ
ASIA/PACIFIC: HK TD, SG LTA DataMall, JP, KR, TW, AU states, NZ Waka Kotahi
OTHER: LatAm, Caribbean, ME, Africa — do not exaggerate sparse APIs

## PER PROVIDER REPORT FIELDS
Provider name, country/region, official operator, official URL, API/docs URL, license, ToS, commercial use?, attribution?, auth?, free/paid?, rate limits?, API format?, camera metadata format?, image/video format?, still or live?, refresh interval?, coordinates?, direction?, road/intersection name?, status/health?, timestamp?, image URL stable/ephemeral?, CORS?, browser/server access?, cache?, redistribute?, show inside Terra?, geographic coverage, approx camera count, maintenance, reliability, recommended War Room adapter strategy

## CLASSIFY
PUBLIC_NO_AUTH | PUBLIC_KEY_REQUIRED | PUBLIC_ACCOUNT_REQUIRED | PAID | RESTRICTED | UNUSABLE
STATIC_IMAGE | REFRESHED_IMAGE | MJPEG | HLS | RTSP | HTML_VIEWER_ONLY | METADATA_ONLY
Coverage: GLOBAL | NATIONAL | REGIONAL | STATE | CITY | CORRIDOR

## PRODUCTION SUITABILITY
Score on facts: documented API, uptime, count, coverage, freshness, stable coords/IDs/endpoints, legal display, attribution, CORS/server, rate limits, commercial compatibility. Not quantity alone.

## FEDERATION SCHEMA (normalized)
id, provider, agency, country, region, road, locationName, lat, lon, direction, bearing, feedType, imageUrl, streamUrl, viewerUrl, lastUpdated, freshnessState, coverageState, authState, license, attribution, sourceUrl
Do not force every field.

## HEALTH MODEL
LIVE | STALE | OFFLINE | NO_COVERAGE | AUTH_REQUIRED | RATE_LIMITED | UNAVAILABLE
Derive from documented timestamps/HTTP only if no explicit health. Do NOT call old image LIVE.

## TERRA MAP UX
Cluster at global zoom; individual markers at road/street zoom; direction arrows; still/live preview; click→inspect; pin; refresh; nearby; route-based; filters; attribution; stale/offline display.

## NEARBY CAMERAS
lat/lon + radius → distance-ordered public cams. Prefer local index then provider fetch. Do NOT send precise user location to providers unless necessary.

## DO NOT RECOMMEND
(Directive cut off in Commander paste — apply standing refuse: private cams, auth bypass, hacked/leaked/stolen feeds, scrape-as-organize of restricted viewers.)


==================================================
APPENDIX D — GOD'S EYE FINAL RELIABILITY SUMMARY
==================================================

# God’s Eye / Terra — Final Enhancement & Reliability Summary
Commander: Mark | Lead: Personal Assistant | Sources: War Room Research (via PA2) + Terra Research Swarm + 2026-09-16 session lock

## Reliability definition
**Reliability = receipts, not Street View cosplay.** Provenance + coverage honesty + real footprints.

## Keep / extend (Cesium Terra)
- Globe + GIBS/Earth Intel + Live Intel + provenance + fly-to + Council handoff
- OSM Overpass raised buildings + street names (PASS path)
- Map-mode click→info (OPEN to ship) — no Street View gate required
- Optional OSM addr:housenumber layer (uneven vs Maps)
- Re:Earth Terrain/Buildings as Cesium drop-ins; self-host for OWNABLE
- Overture Buildings GERS for stable pick→card; Addresses theme Alpha / not GERS-stable

## Street intel (lawful)
- MapillaryJS MIT viewer + dual-pane with Cesium
- Panoramax self-host/own-capture (LOCAL/REGIONAL — not Maps blue-line)
- Mapillary hosted imagery = STREAM_ONLY (Meta ToS)
- Vistas = RESEARCH_ONLY (CC BY-NC-SA) — no commercial dependence
- No clean COMMERCIAL_OK Vistas twin yet

## Ownable vs stream
- ion World Terrain/Imagery/OSM Buildings = STREAM_ONLY (ACTIVE on 3848)
- OpenTopography→CTOD / self-host DEM = OWNABLE height
- Google Street View / Photorealistic = paid stream opt-in OR skip — NO open Maps-parity Street View; NO scrape/ML-from-Google

## Traffic
STATIC signal/cam locations from OSM/agency ≠ LIVE red/green or private cams. SPaT/511 = REGIONAL/PROVIDER_DEPENDENT.

## Better than Google (real)
Provenance, multilingual/local reporting, event-local time, Council, Commander notes, own capture/3D twins, coverage honesty labels.

## GH / HF / forges hit
MapillaryJS, Panoramax, Re:Earth, CTOD/Tiletopia, COLMAP/Nerfstudio/GS/ODM, MapLibre/deck.gl/Streets GL (prior art only); HF Vistas/StreetCLIP/GLPN-style.
Next lawful forges: Codeberg, GitLab, SourceHut, OSGeo, Software Heritage, Overture, OpenTopography, Copernicus — no dark-web/leaks.

## Immediate reliability order
1. Fix Commander-session auth on 3848 (live-intel 401)
2. Live Intel UX (original language + world time + provenance)
3. Dual-pane MapillaryJS/Panoramax + coverage honesty
4. OSM/Overture house numbers + map-mode click→info
5. Ownable DEM lane (keep ion online)
6. Vistas eval only; optional Google SV only if Mark opts in
7. Begin-sim / scenario later on owned tiles

## Refuse
Scrape, Google offline rip, leaked games, fiction upgraded to Earth, private cams, NC datasets in commercial path.
===== END SOURCE 01: CHATGPT_FULL_WAR_ROOM_TERRA_PROMPT.md =====

===== BEGIN SOURCE 02: TERRA_DEVELOPMENT_CURSOR_PROMPT.md =====
# CURSOR PROMPT — War Room Terra Development (from Terra Research Swarm)
# Commander: Mark | Lead synthesis: Personal Assistant
# Paste into ChatGPT / Cursor as the authoritative product + engineering brief.
# AUTHORITATIVE SESSION UPDATE LOCKED 2026-09-16 — supersedes older DEM-unavailable / migration-freeze assumptions where they conflict.
# Do NOT invent roadmap numbers. Do NOT create Terra2/Council2/ASTRA2. Do NOT merge Terra into Council or ASTRA.
# Do NOT say "workaround" or "go-around" for personal click + personal save.
# Wave 5: do not start without explicit Commander authorization. WRIM training OFF.

## CURRENT PLATFORM (2026-09-16)
- War Room OS 0.2.0 on Nebula Genesis Linux
- Installed UI 127.0.0.1:3848 · Core 3847 · Dev Next 3001 (different runtimes)
- Repo → 3848 requires: build → .next/standalone → prepare desktop → rebuild deb/AppImage → reinstall
- Do NOT patch /opt unless authorized
- Data root: ~/.local/share/war-room-os
- Icon: desktop/assets/war-room-os.png · Name=War Room OS

## TERRA VERIFIED ON 3848
- NASA GIBS Daily ACTIVE (independent of ion)
- Cesium World Terrain ACTIVE · World Imagery + labels ACTIVE · OSM Buildings ACTIVE (assets 1/2/3/96188)
- Terrain heights available; polar artifact fixed; cinematic orbit; compact UX
- Token: NEXT_PUBLIC_CESIUM_ION_TOKEN in .env.local — never print
- Allowed origins include :3001 and :3848 localhost/127.0.0.1

## IMMEDIATE PRIORITY
1. Fix Commander-session continuity (wr_local_session / requireCommanderSession) so /api/terra/live-intel and /api/terra/layers/* return 200 on installed 3848 (401 is session gate, NOT Cesium; AIS/maritime/aviation not the cause)
2. Live Intel compact surface: EARTH · LOCAL · HEADLINES · BREAKING · EVENTS · CONFLICT · WORLD TIME — glance→hover→inspect→expand; globe stays hero
3. Original language first (originalLanguage/originalHeadline/originalSummary) + optional English toggle; translationState; never overwrite source with translation
4. World time via coordinate→IANA (not Commander machine TZ); event time = source + local + UTC
5. Conflict intel: neutral evidence CONFIRMED|REPORTED|DISPUTED|UNVERIFIED; no advocacy/speculation-as-fact
6. Provenance required; SEND TO COUNCIL keeps Observed Data | Council Analysis | Commander Annotation separate
7. Then: ownable DEM lane (keep ion World Terrain; no silent ellipsoid) → imagery → buildings → click→info → notes → begin-sim → scenario → IDX when authorized

## Mission
Improve Terra (God's Eye Cesium globe at `/terra`) to feel like Google Maps, then better — on an OWNED stack with provenance.
Goals: zoom buildings, click→info, first-person ground view, live enrich without warehousing Earth, personal notes/questionnaire → optional Council, later click→begin-sim + type-to-AI scenario builds ("imagine"), lawful for-sale via IDX when authorized.

Terra = world-state Oracle (camera/archive of Earth with receipts).
Council = meaning / reasoning.
ASTRA = action only when Commander authorizes.
Scenario/AI imagine = sandbox on top of Earth, never silent rewrite of verified world-state.

---

## Evidence Scout — lawful sources & locks

### World-state (ingest / own)
- DEM: OpenTopography API — COP30/NASADEM/SRTM — https://portal.opentopography.org/apidocs/
- Imagery: Copernicus Sentinel-2 (credit notice) — https://dataspace.copernicus.eu/ · https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice
- Buildings: Overture Buildings (ODbL, GeoParquet) — https://docs.overturemaps.org/guides/buildings/
- OSM footprints/tags (ODbL) — https://www.openstreetmap.org/copyright · Overpass https://wiki.openstreetmap.org/wiki/Overpass_API
- Places/POIs: Overture Places + OSM amenities — https://docs.overturemaps.org/guides/places/
- History enrich: Wikidata CC0 — https://www.wikidata.org/w/rest.php/wikibase/v1 · Wikipedia CC BY-SA — https://en.wikipedia.org/wiki/Wikipedia:Reuse

### Click card / live enrich (thin local)
- Local: building id (OSM way / GERS) + geometry + short TTL cache
- Live: Overpass / Wikidata / Overture DuckDB bbox-or-id — https://docs.overturemaps.org/getting-data/duckdb/
- Coverage honesty: live | cached | stale | no_coverage | auth_required | partial
- Product scale: self-host Overpass; public Overpass rate-limits (~100 q / ~10 MB/day class)

### Listing / for-sale
- NO public merge API for Zillow+Realtor+Trulia
- Link-out only until IDX: new-tab when address exists; hide if no address
- Zillow ToS: no automated obtain; personal view/save/print/email without automation; no display of other Zillow data without approval — https://www.zillow.com/corporate/terms-of-use/
- Realtor/Move: link limits; no framing — https://www.realtor.com/terms-of-use/
- Lawful summarize: MLS/IDX/RESO when participant-authorized — https://dd.reso.org/DD2.1/Property/ · NAR IDX 7.58
- IDX card fields (when feed exists): ListingKey, StandardStatus, ListPrice, BedroomsTotal, baths, LivingArea, address, lat/lon, AttributionContact, ModificationTimestamp — local MLS may restrict

### REFUSE
- Google Photorealistic 3D Tiles / Maps / Earth download, cache, offline, extract, game export — https://developers.google.com/maps/documentation/tile/policies
- Scrape / headless / discard-HTML / unofficial Zillow APIs / private-app fetch of listing pages
- Planet-wide interior blueprints as default layer
- Auto-screenshot/OCR of listing pages by Terra
- Upgrading commander_notes or scenario meshes into verified Earth/MLS truth

### Personal path (NOT a workaround — name exactly)
- Mark opens listing → OS screenshot → attaches to private note = **personal click + personal save**
- Portal shots: local/high-caution; Council default = paraphrase + URL (or Mark's own exterior photo)
- Questionnaire: empty prompts Mark answers; `source=commander_notes`; opt-in to Council

### Sim / imagine
- Own stack → Cesium / Cesium for Unreal — https://cesium.com/platform/cesium-for-unreal
- Tag: `source=dem|osm|overture|sentinel` vs `source=generated|scenario`
- Order: DEM → imagery drape → building tiles → begin-sim → AI scenario agent
- Installed Terra: Cesium World Terrain ACTIVE. Long-term ownable DEM still parallel (OpenTopography/COP30/NASADEM/SRTM); never silent ellipsoid fallback

---

## Context Historian — lineage & War Room claims

### Public lineage
- Keyhole → Google Earth 2005; Cesium open 2012 / 1.0 2014; Google plugin ended 2015 → Cesium migrations
- Overture Maps Foundation Dec 2022
- Google Photorealistic 3D Tiles = look stream, not possessable
- Cesium for Unreal/Unity = sim on YOUR tiles
- For-sale on maps = MLS/IDX privilege; Zillow public API sunset 2021; Bridge/RESO for approved parties
- Unofficial "read then tell / discard HTML" = automated obtain dead end

### War Room prior claims (inventory only — no new roadmap numbers)
- `docs/terra/AUTOMATIC_URBAN_DETAIL.md` PASS (9571af1): auto roads + footprints historically; **2026-09-16 installed Terra**: World Terrain + OSM Buildings ACTIVE on 3848 — treat session update as newer verified runtime truth
- **CORRECTION:** that PASS does NOT document click→info panel — click UX is OPEN
- #13 Terra→Council bridge PASS (ad888b7)
- Phase G: Google Photorealistic DEFERRED / NOT WIRED
- `terraOracleContract.ts` / #21: Terra = WORLD_STATE_SOURCE; does NOT authorize action; coverageState + councilReviewState
- NAVIGATION_AGENT implemented; PHONE_APP NOT

### Already claimed vs still open
- Closed: auto footprints/roads, Terra↔Council bridge, Oracle contract, Google tiles deferred, DEM unavailable recorded
- Open: live-intel Commander-session 401, Live Intel UX+i18n+world time, click→info panel, ownable DEM lane, self-host Overpass, FPS/Street View parity, IDX feed, questionnaire UI, begin-sim, AI scenario agent, planet photoreal offline

---

## Science Analyst — Cesium mechanism

### Two layers (never merge)
1. WORLD-STATE: DEM + imagery + buildings — measured Earth
2. SCENARIO: AI/Commander builds — `source=generated|scenario`

### Click → info (ESTABLISHED)
- `scene.pick` / `drillPick` → feature props — Cesium docs
- Thin local + async enrich; cancel on new pick; don't block render loop
- War Room click PANEL not shipped yet

### LOD / FPS
- 3D Tiles + SSE; self-host for scale
- No built-in Street View; WASD walk ~1.7m AGL needs real DEM
- Footprint ≠ blueprint

### Sim
- DEM + collision → begin-sim; type-to-AI places catalog/procedural assets tagged generated
- Expect satellite/digital-twin look, not Google street photoreal
- Scenario ≠ real-world action authorization

### Build order (dependency)
1. Wire ownable DEM
2. Drape open imagery
3. Building tiles (or extrude; watch downtown cost)
4. Click → skeleton → open-API enrich + outbound listing buttons
5. Personal notes + questionnaire (local); optional Council opt-in
6. Begin-sim
7. AI scenario agent
8. IDX only when authorized

---

## Blind Spot Checker — claim hygiene

### Hard splits
1. POSSIBLE ≠ SHIPPED
2. STREAM ≠ POSSESS
3. PERSONAL CLICK + PERSONAL SAVE ≠ workaround
4. PRIVATE ≠ scrape hall pass
5. WORLD-STATE ≠ SCENARIO
6. COMMANDER_NOTES ≠ MLS truth
7. FOOTPRINT ≠ BLUEPRINT
8. LINK-OUT ≠ INGEST

### Anti-patterns (REJECT if proposed)
- "Private so ToS doesn't apply"
- "We only read / discard HTML / unofficial API"
- "Download Google Earth into Unreal"
- "Auto-fill questionnaire from Zillow"
- "Clickable props already shipped because urban-detail PASS"
- "Begin sim" on ellipsoid without calling heights fake
- Mixing notes / IDX / open-API / scenario into one unlabeled truth blob
- Saying workaround/go-around for personal click + personal save

### Better than Google
- REAL: provenance, coverage honesty, owned stack, labeled scenario fiction, Council evidence
- DO NOT CLAIM YET: photoreal facades, Street View parity, Zillow-class cards without IDX, Google-smooth on public Overpass

---

## Legal Researcher — licenses, ToS, copyright, IDX, privacy (cite published grants; never invent law)

### Decision vocabulary (use these labels in code/docs)
- INGEST — Terra may store/display under the cited grant (with attribution where required)
- LINK-OUT — new-tab only; do not fetch/iframe/redisplay their content
- REQUIRE-AUTH — needs MLS/IDX/RESO (or written approval) before summarize/display
- REFUSE — do not build

### World-state (INGEST with credit)
- Copernicus Sentinel: free/full/open reproduce/adapt/combine for lawful use; notice `Copernicus Sentinel data [Year]` or `Contains modified Copernicus Sentinel data [Year]` — https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice
- DEM: only products with published open terms (verify each OpenTopography/product license before ship)
- OSM + Overture: ODbL — attribution + share-alike on derived databases — https://www.openstreetmap.org/copyright · Overture docs
- Wikidata: CC0 · Wikipedia: CC BY-SA reuse (prefer facts + cite; don’t paste prose) — https://www.wikidata.org/wiki/Wikidata:Data_access · https://en.wikipedia.org/wiki/Wikipedia:Reuse
- Lawful drone/phone photogrammetry Mark owns → mesh/3D Tiles OK

### Google Earth / Maps / Photorealistic 3D Tiles — REFUSE as possessable
- Map Tiles API: visualization only; no pre-fetch, store, cache, offline, extract, image analysis, geodata extraction — https://developers.google.com/maps/documentation/tile/policies
- Stream ≠ possess. No Google rip → Unreal/offline game. Attribution rules apply only if you lawfully stream (War Room: deferred/not wired)

### Listing storefronts (Zillow / Trulia / Realtor)
- Zillow ToS: limited personal license; copy **without automated processes** only to view/save/print/fax/email; BAN automated queries (scrapers/robots/“any other automated activity with the purpose of obtaining information”); BAN displaying other Zillow data without written approval — https://www.zillow.com/corporate/terms-of-use/
- Realtor/Move: link-creation limits (homepage notice); no framing — https://www.realtor.com/terms-of-use/
- LINK-OUT: new-tab when address exists; hide if no address. REFUSE: scrape, headless, discard-HTML, unofficial APIs, iframe, Terra agent fetch “for” Mark
- “Private / personal Terra” is NOT a hall pass for automated obtain
- REQUIRE-AUTH for portal-class price/beds/photos/summary inside Terra: MLS participant + IDX/RESO feed

### IDX / RESO (when authorized) — INGEST for display under participant control
- NAR IDX Policy Statement 7.58 — https://www.nar.realtor/handbook-on-multiple-listing-policy/advertising-print-and-electronic-section-1-internet-data-exchange-idx-policy-policy-statement-7-58
- Must: identify listing firm + listing participant email/phone (prominent, typeface ≥ median of listing data); identify brokerage operating the display; participant control of display
- Refresh downloads + auto-fed displays ≥ every 12 hours; pull expired/withdrawn / seller “no internet” listings promptly (local MLS may be stricter — UNVERIFIED until vendor chosen)
- Do not modify other participants’ listing content; non-MLS facts clearly separated + source labeled
- IDX for display only — not redistribute MLS DB; refuse confidential participant-only fields
- Field names: RESO DD Property / IDX payload — https://dd.reso.org/DD2.1/Property/ · https://dd.reso.org/DD2.1/xref/payload/IDX/
- Until feed connected: card shows auth_required (+ optional link hub)

### Blueprints / interiors
- Architectural works generally copyrighted (US). Footprint ≠ blueprint. REFUSE planet-wide interior plans as default layer
- LINK-OUT when lawful URL exists (listing marketing image, permit portal, owner-supplied). Overlay only with rights to that asset

### Personal click + personal save (NOT a workaround — never call it go-around)
- Mark opens listing in his browser → OS screenshot → he attaches to private note = closest to personal save path
- REFUSE Terra auto-screenshot / OCR / headless grab
- Portal screenshots in Terra: HIGH CAUTION / local-only (display + copyright residual risk). REFUSE by default forwarding portal listing photos to Council
- Prefer: paraphrase in Mark’s words + outbound URL; or Mark’s own exterior photo; or OSM/Wiki shots with attribution

### Notes / questionnaire → Council
- INGEST: empty prompts + Mark’s typed answers + timestamp + building id + URL he opened → source=commander_notes
- REFUSE auto-fill from portal HTML
- Council: OPT-IN send only; never upgrade commander_notes to MLS/listing truth; keep buckets separate (notes | open-API | IDX | scenario)
- Privacy: notes on others’ homes stay local until Mark opts in

### Sim / type-to-AI builds
- INGEST sim geometry only from owned/open grants above
- Scenario objects: source=generated|scenario — fiction layer; never upgrade to verified Earth
- Catalog/asset packs: obey their licenses; don’t treat model output as free rehost of third-party copyrighted props
- Scenario ≠ authorization to act in the real world

### Cursor anti-patterns (Legal — reject)
- Private so ToS doesn’t apply
- We only read / discard HTML / unofficial listing API
- Download Google Earth into Unreal
- Use GTA / RAGE / inZOI / other game engines' code or assets
- Auto-fill / auto-screenshot listing pages
- Workaround / go-around for personal click + personal save
- Summarize Zillow/Trulia/Realtor into the card without IDX
- Mixing commander_notes / IDX / open-API / scenario into one unlabeled truth blob

### Confidence
- High: Google stream-only; Zillow automated + display bans; NAR IDX attribution/refresh baselines; Sentinel open notice; ODbL; link-out vs ingest split
- Medium: residual risk of private portal screenshots living inside Terra UI
- UNVERIFIED until chosen: specific MLS vendor field/media/refresh/attribution extras

---


## Sim architecture lock (GTA / inZOI lesson — architecture only)

Rockstar uses a private engine (RAGE) + streamed handmade city + character physics (Euphoria). inZOI uses Unreal Engine 5 + World Partition + life-sim AI. Terra does NOT copy those engines, maps, cars, or assets (copyrighted). Steal the architecture only:

- Stream tiles; never load the whole planet
- Simulate only the neighborhood in view
- People/vehicles = cheap scenario AI on top, tagged `source=generated|scenario`
- Real Earth geometry from owned stack (DEM + Sentinel + OSM/Overture), not a game city

### What to build on
- Globe already in War Room: CesiumJS at `/terra` (keep; do not create Terra2)
- Click-to-begin-sim later: **Cesium for Unreal** on the same owned 3D Tiles (optional Cesium for Unity)
- Unreal World Partition / Cesium streaming = GTA-like feel on real Earth
- REFUSE: GTA/RAGE/inZOI code or assets; Google Photorealistic tiles as offline sim content

### Honest order
DEM wired → imagery drape → building tiles → begin-sim → AI scenario agent

---

## Acceptance criteria (Cursor / Engineer)
- [ ] Commander-session auth fixed on 3848 for live-intel + layers
- [ ] Live Intel categories + original language + world time
- [ ] Ownable DEM foundation progress (ion World Terrain remains ACTIVE)
- [ ] Click building → skeleton props → async open-API enrich with coverage honesty
- [ ] Outbound listing buttons (new tab) when address present; hidden otherwise
- [ ] No portal HTML ingest; no Google tile offline store
- [ ] Personal notes + questionnaire on building id; `commander_notes`; opt-in Council only
- [ ] Manual screenshot attach allowed; Terra auto-capture forbidden
- [ ] Begin-sim only after DEM + collision; AI builds tagged `generated|scenario`
- [ ] No GTA/RAGE/inZOI assets or leaked game code; Unreal+Cesium on owned tiles only
- [ ] IDX path stubbed as `auth_required` until real feed
- [ ] Wave 4 frozen; no Wave 5 in this work
- [ ] Brief language never says workaround/go-around for personal click + personal save

## Cursor instructions
Implement against existing War Room Cesium `/terra` stack. Prefer smallest diffs. Preserve Terra Oracle boundaries. Do not invent new master-roadmap numbers. Do not create Terra2. Validate with existing `validate:terra*` scripts where applicable. Prefer self-host plans over public Overpass for product traffic. Ask Commander before any MLS vendor choice or paid ion/Google keys.
===== END SOURCE 02: TERRA_DEVELOPMENT_CURSOR_PROMPT.md =====

===== BEGIN SOURCE 03: GODS_EYE_COMMANDER_RESEARCH_DIRECTIVE.md =====
# COMMANDER RESEARCH DIRECTIVE — GOD'S EYE ENHANCEMENT SWARM
(Reconstructed from Mark’s ChatGPT → War Room Research paste, via Personal Assistant 2, 2026-09-16)

## MISSION
Evolve War Room Terra’s GOD’S EYE into the strongest lawful/open Earth-awareness system. Cursor integrates identified OSS. Do NOT replace Terra.
- Terra = CesiumJS world-state
- God’s Eye = live awareness UX inside Terra

## CURRENT PRODUCT TRUTH (verify live)
CesiumJS, NASA GIBS, Cesium World Terrain, ion World Imagery, OSM Buildings, Live Intel, Earth Intel, headlines/events/conflict, world time + event-local time, original-language + optional EN translation, fly-to, provenance, Send to Council, Commander annotation, desktop on 3848.

## GOD’S EYE ZOOM LADDER
PLANET → COUNTRY → CITY → NEIGHBORHOOD → STREET → BUILDING / ROAD / SIGNAL / CAMERA / VEHICLE / EVENT
Always with truthful world-state + provenance.

## DOMAINS
- EARTH: terrain, imagery, elevation, weather, quakes, volcanoes, wildfire, storms, hazards
- URBAN: buildings, roads, names, addresses, house numbers, intersections, signals, signs, lanes, infra
- MOBILITY: traffic, closures, transit, aircraft, maritime, rail
- STREET INTEL: panoramas, lights, signs, lanes, sidewalks, buildings, entrances, vehicles, furniture, object recognition
- INTELLIGENCE: news, headlines, breaking, events, conflict, disruption, provenance

## RESEARCH TARGETS (verify official repos + licenses)
MapillaryJS, Mapillary Vistas, Panoramax, Re:Earth Terrain, Re:Earth Buildings, Overture Maps, OSM/Overpass tags (addr:*, highway, lanes, maxspeed, traffic_signals, crossing, traffic_sign, surveillance public-only, public_transport, railway, building, entrance), traffic cameras (DOT/511/DATEX II — no private cams), traffic signals (static vs SPaT/MAP/NTCIP/V2X LIVE), mobility feeds, street-level 3D recon (COLMAP/OpenMVG/OpenMVS/Nerfstudio/GS/ODM — lawful imagery only; NO Google SV/Maps as training input), Hugging Face street models (license / commercial / local RTX 5060 Ti 16GB fit).

## BETTER-THAN-GOOGLE DIMENSIONS (claim only what is real)
Live intel, multilingual reporting, event-local time, provenance, conflict overlays, aviation/maritime/traffic/cameras, open building IDs, native names, Council, Commander notes, own imagery/3D, open data, offline regional, transparent coverage.
Do NOT claim visual parity where it doesn’t exist.

## COVERAGE TRUTH LABELS
GLOBAL / REGIONAL / LOCAL / DATASET_DEPENDENT / PROVIDER_DEPENDENT / NO_COVERAGE
STATIC / NEAR_REALTIME / LIVE

## OWNERSHIP MATRIX
OWNABLE / SELF_HOSTABLE / STREAM_ONLY / RESEARCH_ONLY / NONCOMMERCIAL / COMMERCIAL_OK / ATTRIBUTION / SHARE_ALIKE / AUTH / PAID

## VISTAS RULE
Keep Mapillary Vistas in research/eval. If NC blocks commercial: RESEARCH/EVAL lane + find permissive peers.

## PRIOR ART NOTE
MapLibre fill-extrusion / deck.gl / Streets GL / HF GLPN / StreetCLIP / Open3DMap = prior art only — not a Terra engine swap. Refuse Google imagery → ML training.
===== END SOURCE 03: GODS_EYE_COMMANDER_RESEARCH_DIRECTIVE.md =====

===== BEGIN SOURCE 04: GODS_EYE_FINAL_SUMMARY.md =====
# God’s Eye / Terra — Final Enhancement & Reliability Summary
Commander: Mark | Lead: Personal Assistant | Sources: War Room Research (via PA2) + Terra Research Swarm + 2026-09-16 session lock

## Reliability definition
**Reliability = receipts, not Street View cosplay.** Provenance + coverage honesty + real footprints.

## Keep / extend (Cesium Terra)
- Globe + GIBS/Earth Intel + Live Intel + provenance + fly-to + Council handoff
- OSM Overpass raised buildings + street names (PASS path)
- Map-mode click→info (OPEN to ship) — no Street View gate required
- Optional OSM addr:housenumber layer (uneven vs Maps)
- Re:Earth Terrain/Buildings as Cesium drop-ins; self-host for OWNABLE
- Overture Buildings GERS for stable pick→card; Addresses theme Alpha / not GERS-stable

## Street intel (lawful)
- MapillaryJS MIT viewer + dual-pane with Cesium
- Panoramax self-host/own-capture (LOCAL/REGIONAL — not Maps blue-line)
- Mapillary hosted imagery = STREAM_ONLY (Meta ToS)
- Vistas = RESEARCH_ONLY (CC BY-NC-SA) — no commercial dependence
- No clean COMMERCIAL_OK Vistas twin yet

## Ownable vs stream
- ion World Terrain/Imagery/OSM Buildings = STREAM_ONLY (ACTIVE on 3848)
- OpenTopography→CTOD / self-host DEM = OWNABLE height
- Google Street View / Photorealistic = paid stream opt-in OR skip — NO open Maps-parity Street View; NO scrape/ML-from-Google

## Traffic
STATIC signal/cam locations from OSM/agency ≠ LIVE red/green or private cams. SPaT/511 = REGIONAL/PROVIDER_DEPENDENT.

## Better than Google (real)
Provenance, multilingual/local reporting, event-local time, Council, Commander notes, own capture/3D twins, coverage honesty labels.

## GH / HF / forges hit
MapillaryJS, Panoramax, Re:Earth, CTOD/Tiletopia, COLMAP/Nerfstudio/GS/ODM, MapLibre/deck.gl/Streets GL (prior art only); HF Vistas/StreetCLIP/GLPN-style.
Next lawful forges: Codeberg, GitLab, SourceHut, OSGeo, Software Heritage, Overture, OpenTopography, Copernicus — no dark-web/leaks.

## Immediate reliability order
1. Fix Commander-session auth on 3848 (live-intel 401)
2. Live Intel UX (original language + world time + provenance)
3. Dual-pane MapillaryJS/Panoramax + coverage honesty
4. OSM/Overture house numbers + map-mode click→info
5. Ownable DEM lane (keep ion online)
6. Vistas eval only; optional Google SV only if Mark opts in
7. Begin-sim / scenario later on owned tiles

## Refuse
Scrape, Google offline rip, leaked games, fiction upgraded to Earth, private cams, NC datasets in commercial path.
===== END SOURCE 04: GODS_EYE_FINAL_SUMMARY.md =====

===== BEGIN SOURCE 05: TRAFFIC_CAMERA_FEDERATION_DIRECTIVE.md =====
# COMMANDER DEEP RESEARCH DIRECTIVE — GLOBAL PUBLIC TRAFFIC CAMERA FEDERATION

MISSION: Find the strongest lawful/public traffic-camera sources for War Room Terra / God's Eye.
- Do NOT research private residential cameras
- Do NOT bypass authentication
- Do NOT use hacked, leaked, credential-stolen, or restricted feeds
- Goal: broadest PUBLIC / AUTHORIZED traffic-camera federation for Terra

## CURRENT VERIFIED WAR ROOM STATE
Adapters / verified activity:
1. Fintraffic Digitraffic — Finland roads, live station metadata, public JPEG
2. Ontario 511 — large public camera inventory, public JPEGs verified
3. Hong Kong Transport Department — public traffic camera image host, live Last-Modified
4. Québec 511 / MTMD — WFS camera metadata, public viewer; direct JPEG behavior differs

Blocker: Terra UI camera inspection not verified because urban APIs behind Commander-session auth.
Do NOT mistake that auth issue for provider failure.

## RESEARCH OBJECTIVE
PUBLIC traffic-camera systems worldwide with usable programmatic access.
Prioritize: official DOT, 511, municipal traffic depts, state/provincial APIs, national highway agencies, open-data portals, public still-image endpoints, public live video where explicitly permitted, WFS/GeoJSON/JSON/XML/DATEX II metadata, GTFS-RT adjacent road incidents where useful, open CCTV where explicitly public.

## REGIONS
US (esp. OH, PA, MI, NY, CA, TX, FL, IL, GA, WA, CO, AZ, NV, NC, VA, MD, MA) + cities/counties/tolls
OHIO PRIORITY: OHGO, Summit/Akron, Cleveland, Turnpike, freeway cams, incidents, construction, RWIS, metadata APIs, image/stream URLs, ToS, refresh — verify API/image access not just browser
CANADA: ON/QC/BC DriveBC/AB/MB/SK/NB/NS/NL
EUROPE: Finland Digitraffic, NO, SE Trafikverket, DK, NL NDW, DE Autobahn, FR Bison Futé, UK National Highways, IE TII, ES DGT, IT ANAS, CH, ATFINAG, PL GDDKiA, CZ
ASIA/PACIFIC: HK TD, SG LTA DataMall, JP, KR, TW, AU states, NZ Waka Kotahi
OTHER: LatAm, Caribbean, ME, Africa — do not exaggerate sparse APIs

## PER PROVIDER REPORT FIELDS
Provider name, country/region, official operator, official URL, API/docs URL, license, ToS, commercial use?, attribution?, auth?, free/paid?, rate limits?, API format?, camera metadata format?, image/video format?, still or live?, refresh interval?, coordinates?, direction?, road/intersection name?, status/health?, timestamp?, image URL stable/ephemeral?, CORS?, browser/server access?, cache?, redistribute?, show inside Terra?, geographic coverage, approx camera count, maintenance, reliability, recommended War Room adapter strategy

## CLASSIFY
PUBLIC_NO_AUTH | PUBLIC_KEY_REQUIRED | PUBLIC_ACCOUNT_REQUIRED | PAID | RESTRICTED | UNUSABLE
STATIC_IMAGE | REFRESHED_IMAGE | MJPEG | HLS | RTSP | HTML_VIEWER_ONLY | METADATA_ONLY
Coverage: GLOBAL | NATIONAL | REGIONAL | STATE | CITY | CORRIDOR

## PRODUCTION SUITABILITY
Score on facts: documented API, uptime, count, coverage, freshness, stable coords/IDs/endpoints, legal display, attribution, CORS/server, rate limits, commercial compatibility. Not quantity alone.

## FEDERATION SCHEMA (normalized)
id, provider, agency, country, region, road, locationName, lat, lon, direction, bearing, feedType, imageUrl, streamUrl, viewerUrl, lastUpdated, freshnessState, coverageState, authState, license, attribution, sourceUrl
Do not force every field.

## HEALTH MODEL
LIVE | STALE | OFFLINE | NO_COVERAGE | AUTH_REQUIRED | RATE_LIMITED | UNAVAILABLE
Derive from documented timestamps/HTTP only if no explicit health. Do NOT call old image LIVE.

## TERRA MAP UX
Cluster at global zoom; individual markers at road/street zoom; direction arrows; still/live preview; click→inspect; pin; refresh; nearby; route-based; filters; attribution; stale/offline display.

## NEARBY CAMERAS
lat/lon + radius → distance-ordered public cams. Prefer local index then provider fetch. Do NOT send precise user location to providers unless necessary.

## DO NOT RECOMMEND
(Directive cut off in Commander paste — apply standing refuse: private cams, auth bypass, hacked/leaked/stolen feeds, scrape-as-organize of restricted viewers.)
===== END SOURCE 05: TRAFFIC_CAMERA_FEDERATION_DIRECTIVE.md =====

===== BEGIN SOURCE 06: TERRA_GAPS_CURRENT_DELTA_EXECUTION.md =====
# TERRA GAPS — CURRENT DELTA EXECUTION
# Commander: Mark | Authoritative as of ChatGPT review + runtime evidence | 2026-09-17
# SUPERSEDES: TERRA_GAPS_EXECUTION_PROMPT_FINAL.md (partially stale — do NOT re-execute completed phases)

IMPORTANT:
The older TERRA_GAPS_EXECUTION_PROMPT_FINAL is now partially stale.

Do NOT re-execute completed phases.

Current verified baseline:

PUBLIC / PROVIDER_AUTH / COMMANDER_PRIVATE auth split = ACTIVE
PUBLIC Earth data no longer Commander-gated
OHGO = LIVE
OHGO cameras/events/road weather = LIVE
Caltrans = LIVE
511NY = PARTIAL / provider credential required
camera federation = PARTIAL but active
local news = PARTIAL
GPS = PARTIAL
God's Eye = ACTIVE_WITH_GAPS

No Terra2.
No fake coverage.
No commit/push/deploy/package without Commander authorization.

==================================================
FIRST — CURRENT STATE RECONCILIATION
==================================================

Before changing code:

Compare the older Terra gaps plan against CURRENT runtime state.

For every old phase mark:

DONE
PARTIAL
STALE
STILL_REQUIRED

Do not rebuild completed work.

Return the exact remaining gaps only.

==================================================
PRIORITY 1 — CAMERA FEDERATION CLEANUP
==================================================

Audit remaining camera gaps.

Current known:

OHGO = LIVE
Caltrans = LIVE
Ontario 511 = regional
Québec 511 = regional
Hong Kong TD = regional
Fintraffic = regional
511NY = PARTIAL / provider credential
KYTC = research-approved but not yet runtime-proven

Determine whether KYTC is still worth adding.

If yes:

- use official KYTC/TRIMARC source only
- no HTML scraping
- no stale WGS84WM layer
- prove real catalog/still bytes
- normalize into existing camera schema
- include only inside Kentucky coverage envelope
- make Cincinnati cross-river Nearby federation work honestly

Do not add KYTC merely because the old plan listed it.

==================================================
PRIORITY 2 — CAMERA PROVIDER REGISTRY TRUTH
==================================================

Audit duplicate and overlapping provider definitions.

Known risk:

camera metadata currently exists across:
- coverage federation
- nearby camera envelopes
- traffic layer definitions

Also investigate reported duplicate:
caltrans_cctv

Do NOT create another registry.

Goal:
one authoritative provider metadata source where practical,
or at minimum deterministic consistency checks.

Avoid broad refactor unless runtime risk justifies it.

==================================================
PRIORITY 3 — LOCAL SOURCE HEALTH SEMANTICS
==================================================

Fix only after confirming current behavior.

Known defect:

registry seed ACTIVE
!=
current runtime health

Coverage classification currently may use historical seed state
instead of CURRENTLY_HEALTHY source state.

Required conceptual distinction:

CONFIGURED
RETRIEVAL_VERIFIED
CURRENTLY_HEALTHY
STALE
BLOCKED
NO_FEED
UNAVAILABLE

Coverage classifier should not count a runtime-failed feed merely because
its registry seed says ACTIVE.

Preserve:
RICH
PARTIAL
SPARSE
NO_COVERAGE

but document deterministic meaning.

Do not optimize labels for appearance.
Use runtime truth.

==================================================
PRIORITY 4 — BUILDING VISUAL QUALITY
==================================================

This remains an explicit Commander requirement.

Identify the exact renderer producing crude olive/brown block buildings.

Compare:

custom OSM/Overpass extrusion
Cesium OSM Buildings
imagery-only
Re:Earth Buildings evaluation

Goal:

CRUDE_EXTRUSION = DISABLED_BY_DEFAULT
BUILDING_METADATA = PRESERVED
CLICK_PICKABILITY = PRESERVED where possible
REAL IMAGERY = visually dominant

Do not remove building intelligence.

Do not replace one ugly block renderer with another.

Visual A/B screenshots required.

==================================================
PRIORITY 5 — CLICK → INFO COMPLETION
==================================================

Current proven:
ground
Live Intel
traffic cameras

Audit remaining classes:

building
road
traffic signal
aircraft
vessel

For each require:

PICK
IDENTITY
SOURCE
PROVENANCE
INSPECT
ASYNC ENRICH
STALE REQUEST CANCELLATION

Do not report fully implemented from code presence.

==================================================
PRIORITY 6 — GPS
==================================================

Current state:

GPS = PARTIAL

Known Linux dependencies:

GeoClue2
xdg-desktop-portal
Electron geolocation permission
secure 127.0.0.1 / HTTPS context

Do not invent coordinates.

Determine exact remaining runtime blocker.

Do not install or reconfigure host services without Commander authorization.

==================================================
PRIORITY 7 — STREET INTELLIGENCE
==================================================

Keep license gate.

Allowed lanes to evaluate:

Mapillary hosted imagery
Panoramax
own imagery

Vistas = RESEARCH_ONLY
No Google Street View scraping
No Google tile ripping
No Google-derived ML reconstruction

Do not promote a provider without commercial/runtime license proof.

==================================================
PRIORITY 8 — OWNABLE / SELF-HOSTABLE EARTH STACK
==================================================

Classify current Terra dependencies as:

OWNED
SELF_HOSTABLE
STREAM_ONLY
RESEARCH_ONLY
LICENSE_RESTRICTED

Explicitly classify:

Cesium World Terrain
ion imagery
Cesium OSM Buildings
OpenTopography
Re:Earth
OSM/Overpass
Overture
Sentinel/Copernicus

Do not call streamed ion assets OWNED.

==================================================
DEFER
==================================================

Do not start:

Wave 5
Begin-sim
scenario agent
IDX/listings
WRIM training
Terra2
Council2
ASTRA2

War Room Media stays a separate War Room OS module.

==================================================
RETURN FIRST
==================================================

Before implementation return:

TERRA_CURRENT_GAP_RECONCILIATION

OLD_PHASE_0 =
OLD_PHASE_1 =
OLD_PHASE_2 =
OLD_PHASE_3 =
OLD_PHASE_4 =
OLD_PHASE_5 =
OLD_PHASE_6 =
OLD_PHASE_7 =

CURRENT_TOP_GAPS =
1.
2.
3.
4.
5.

KYTC_STILL_NEEDED =
CAMERA_REGISTRY_DEFECT =
LOCAL_HEALTH_DEFECT =
BUILDING_VISUAL_DEFECT =
CLICK_INFO_GAPS =
GPS_BLOCKER =
STREET_INTEL_GAPS =
OWNABLE_STACK_GAPS =

PROPOSED_FILES =
RUNTIME_TEST_PLAN =
RISKS =

Then STOP.

No implementation yet.
No commit.
No push.
No deploy.
No package/reinstall.
===== END SOURCE 06: TERRA_GAPS_CURRENT_DELTA_EXECUTION.md =====

===== BEGIN SOURCE 07: LIVE_INTEL_PANEL_REVAMP_EXECUTION_PROMPT_FINAL.md =====
# LIVE INTEL PANEL REVAMP — EXECUTION PROMPT (FINAL)
# Commander: Mark | War Room Research + Personal Assistant | 2026-09-16/17
# Supersedes LIVE_INTEL_PANEL_REVAMP_EXECUTION_PROMPT_DRAFT.md
# Aligns with TERRA_GAPS_CURRENT_DELTA_EXECUTION.md — do NOT reopen Phase 0 auth rewrite

## BEST PATH
1) RECON return-first: map Live Intel panel + item type + `/api/terra/live-intel` (paths UNVERIFIED until recon) — STOP after recon report
2) HUD visual: compact war-room cards on existing EARTH/LOCAL/HEADLINES/BREAKING/EVENTS/CONFLICT/WORLD TIME rail — glance→hover→inspect→expand; globe stays hero
3) mediaPreview schema: `{ type: none|poster|hls_mute|yt_mute_embed|official_embed, posterUrl?, previewUrl?, embedProvider?, licenseClass: PUBLIC|PROVIDER_AUTH|COMMANDER_PRIVATE, provenance, originalLang, optionalEn? }` + honesty CONFIRMED|REPORTED|DISPUTED|UNVERIFIED
4) Preview: poster default; mute lawful preview only on hover; one shared muted video or ≤1 YT iframe; teardown on leave/scroll/category change (~100ms)
5) Preserve SEND TO COUNCIL = Observed Data (media URLs + provenance) | Council Analysis | Commander Annotation
6) Align CURRENT DELTA PARTIAL — public intel stays public

## REFUSE
- HTML scrape / yt-dlp / CORS-proxy steal of video
- Autoplay with sound on glance
- Multiple concurrent YT/video previews
- Invented thumbs / fake LIVE without provenance
- Sidebar-eats-globe
- Protected media on public cards
- Merge Media Player radio into Live Intel hover
- Reopen Phase 0 auth wholesale
- Upgrade honesty tier because video plays
- Invent rows when feed empty

## MISSION
Revamp Terra Live Intel into a futuristic War Room global news station HUD. Research locks 2026-09-16 apply. Build only with Commander go. Cesium globe stays hero. Media Player = separate module — do not merge.

## CONSTRAINTS
- Auth split ACTIVE: PUBLIC | PROVIDER_AUTH | COMMANDER_PRIVATE — public intel stays public
- CURRENT DELTA: Live Intel UX PARTIAL — evolve existing panel; do NOT reopen stale Phase 0 session rewrite
- Original language first + optional English; provenance required
- Honesty: CONFIRMED | REPORTED | DISPUTED | UNVERIFIED — never fake intel
- Compact: glance → hover → inspect → expand
- No scrape; lawful embeds/thumbs only

## PHASE 0 — RECON (return-first)
Map Live Intel panel TSX, item/types, `/api/terra/live-intel` (+ layer siblings). Report LIVE_INTEL_RECON (paths, fields, poll cadence, SEND TO COUNCIL wiring). STOP for Commander review before UI code.

## PHASE 1 — HUD cards (visual only)
War-room density: category chips, severity/honesty badges, provenance line, original-lang headline (+ optional EN). Keep compact overlay; pointer-events on panel only. No permanent huge sidebar.
Acceptance: categories still work; globe readable; no fake rows.

## PHASE 2 — mediaPreview schema
Extend intel items with mediaPreview as above. Populate only from lawful provider fields already in feed or Commander-approved embeds — never scrape HTML for video URLs.
YT thumb only when item already has lawful video id: `https://i.ytimg.com/vi/{ID}/hqdefault.jpg`
Acceptance: items without media → type none; protected media never on PUBLIC cards.

## PHASE 3 — Mute hover preview
Poster first. On pointerenter: if lawful preview → attach ONE shared muted player:
- hls_mute: hls.js + `<video muted playsInline>` when CORS-open .m3u8
- yt_mute_embed: `youtube.com/embed/{ID}?autoplay=1&mute=1&playsinline=1` (≤1 autoplay YT; keep Referer; RMF)
- official_embed: publisher-documented embed only
On pointerleave/blur/scroll/category change: teardown ≤100ms (pause, clear src, destroy hls/iframe).
prefers-reduced-motion → poster only.
Acceptance: never sound on glance; never >1 preview; leave cancels; CORS fail → poster.

## PHASE 4 — Inspect + SEND TO COUNCIL
Inspect drawer for full item; unmute only if product allows AND user gesture.
Council packet: Observed Data may include posterUrl/previewUrl/embedProvider + provenance; analysis/annotation stay out of Observed.
Acceptance: SEND TO COUNCIL still works; media provenance preserved.

## PHASE 5 — Perf / a11y / poll
Continuous poll of live-intel JSON; do not invent items when empty. No prefetch of many HLS playlists. IntersectionObserver optional teardown if card <~50% visible.
Acceptance: Cesium rAF stable; reduced-motion honored.

## GLOBAL ACCEPTANCE
- Mute-only hover; leave cancels
- Public ≠ private media
- Globe still hero
- No scrape; no Media Player merge; no Phase 0 auth reopen
- Merge/push only with Commander approval
===== END SOURCE 07: LIVE_INTEL_PANEL_REVAMP_EXECUTION_PROMPT_FINAL.md =====

===== BEGIN SOURCE 08: TERRA_LUXURY_WEATHER_EXECUTION_PROMPT_FINAL.md =====
# TERRA LUXURY WEATHER EFFECT + NOTIFICATIONS — EXECUTION PROMPT (FINAL)
# Commander: Mark | War Room Research + PA co-lead | 2026-09-16/17
# Align TERRA_GAPS_CURRENT_DELTA_EXECUTION.md — do NOT reopen Phase 0 auth rewrite

## BEST PATH
1) RECON return-first: GIBS layer IDs + any ImageryLayer/CAP/OHGO-weather hooks → STOP
2) NWS CAP PUBLIC alerts → severity-throttled toast (Severe+) → flyTo bbox → detail drawer
3) Truth overlay: Iowa Mesonet MRMS (US, polite cache) OR RainViewer only if Mark's use = personal/edu (else commercial clearance / paid OWM) as ImageryLayer; GIBS stays base; attribution on
4) Lux: ONE camera-tied ParticleSystem (soft rain/snow) driven by radar/CAP intensity — presentation only, never "measured"; reduced-motion / high altitude = radar+polygons only
5) Outages: NWS-related + utility link-out; Duke Energy public ArcGIS candidate if fields/ToS cleared; no HTML scrape
6) Optional Media CAP duck reuse (same severity gate) — don't double-spam

## REFUSE
Fake radar · Google weather rip · scrape AEP/FE/PowerOutage.us · claim particles as measured weather · RainViewer as commercial WR default without clearance · melt IEM · sound/toast spam · Phase 0 auth reopen · merge Media Player radio into weather · permanent huge weather sidebar

## MISSION
Add a luxurious weatherman-style weather layer to Terra/Cesium with notifications and a detail panel for live weather + outages. Research lock 2026-09-16 (War Room Research + PA co-lead). Build only with Commander go. Globe stays hero. CURRENT DELTA: do NOT reopen Phase 0 auth rewrite. Public Earth feeds stay public. Media Player = separate module.

## LAYER TRUTH MODEL
- MEASURED STREAM_ONLY: NASA GIBS (base, already ACTIVE), radar tiles (Mesonet MRMS and/or RainViewer), NWS CAP polygons/text
- PRESENTATION ONLY: Cesium ParticleSystem rain/snow/lightning accents — never labeled as instrument truth
- Provenance + attribution always visible on measured layers

## LICENSE GATES
- GIBS: PUBLIC STREAM_ONLY — keep as base drape
- Iowa State Mesonet MRMS/RIDGE TMS: public-domain materials + NOAA acknowledge; STREAM_ONLY; polite cache; don't overload IEM (mesonet.agron.iastate.edu/ogc/)
- RainViewer public maps API (api.rainviewer.com/public/weather-maps.json): PERSONAL_OK/EDUCATIONAL, attribution required, STREAM_ONLY, ~2h history / ~10-min frames — NOT free commercial SLA. Use as default ONLY if Commander confirms personal/edu; else get commercial clearance OR use Mesonet (US) / paid OpenWeatherMap tiles
- NWS api.weather.gov/alerts (+ CAP): PUBLIC; User-Agent required
- Outages: prefer NWS outage-related alerts + link-out to utility portals. Duke Energy public ArcGIS FeatureServer is a CANDIDATE ingest after field+ToS check. AEP Ohio / FirstEnergy / PowerOutage.us HTML = REFUSE scrape unless official API

## PHASE 0 — RECON (return-first)
Map existing Terra GIBS ImageryLayer IDs, any CAP/alert hooks, OHGO road-weather (note: cams ≠ cinematic radar). Report WEATHER_RECON. STOP for Commander review.

## PHASE 1 — Alerts + notification UX
Poll NWS alerts (start area=OH; design for global bbox later). User-Agent required.
Toast only Severe+ (or Commander threshold) with honesty label + provenance.
On click/go: Cesium flyTo alert bbox → detail drawer: alert text, onset/expires, links, radar timestamp, outage section (link-out or cleared Duke layer).
Optional: reuse Media CAP audio duck at same severity — never double-spam toast+duck+sound.
Acceptance: Severe+ toast→flyTo→drawer works; Minor/Moderate default no toast; AUTH_FAIL ≠ NO_COVERAGE.

## PHASE 2 — Measured radar overlay
Add ImageryLayer radar on top of GIBS:
- Primary US: Mesonet MRMS/RIDGE TMS with polite cache + attribution
- Optional global/personal: RainViewer tiled frames if license gate allows
Animate recent frames for weatherman scrub; soft opacity (~0.35–0.55).
Acceptance: real tiles only; attribution visible; no invented reflectivity; GIBS still base.

## PHASE 3 — Luxury presentation (particles)
ONE ParticleSystem (rain/snow switch) in camera frustum; wind updateCallback; rate from radar/CAP intensity bins; restrained lightning optional (hard throttle).
Pause/destroy at high altitude or when weather card inactive.
prefers-reduced-motion OR Commander toggle → radar + CAP polygons only (no particles/lightning).
Acceptance: particles never labeled as measured; GPU stable on RTX 5060-class (target ~2k–8k particles in view); reduced-motion path works.

## PHASE 4 — Outages section
Drawer section: NWS outage-related alerts + deep link to utility outage map.
If Duke public FeatureServer cleared: optional overlay with provenance; else link-out only.
Acceptance: no scraped HTML; no fake outage polygons.

## PHASE 5 — Live Intel / EARTH tie-in
Weather/alert cards can surface in Live Intel EARTH category with same provenance/honesty; mediaPreview rules from Live Intel lock apply if video/thumbs added later — no scrape.
Acceptance: EARTH intel + weather drawer stay consistent; globe readable.

## GLOBAL ACCEPTANCE
- Measured vs presentation visually/documented distinct
- License gate enforced for RainViewer commercial
- No fake coverage; health labels honest
- Globe remains hero
- Merge/push only with Commander approval
===== END SOURCE 08: TERRA_LUXURY_WEATHER_EXECUTION_PROMPT_FINAL.md =====

===== BEGIN SOURCE 09: CHATGPT_WAR_ROOM_MEDIA_REVIEW_PROMPT.md =====
# CHATGPT REVIEW PROMPT — War Room Media Player
# Commander: Mark | Assembled: Personal Assistant | 2026-09-16/17
# Paste this entire document into ChatGPT. Ask ChatGPT to: review for gaps, legal risk, better OSS, and a minimal build plan for War Room OS (Electron/Next). Do NOT invent War Room roadmap numbers. Do NOT recommend scrape/TuneIn/Broadcastify ingest. Do NOT merge this into Terra globe.

==================================================
YOUR ROLE
==================================================
You are reviewing research for Commander Mark’s **War Room Media** module — a sovereign media player inside War Room OS (NOT Terra / God’s Eye globe).

Chain stays: COMMANDER → WAR ROOM → TERRA → COUNCIL → ASTRA.
Media is a sibling War Room OS feature, not Terra2.

==================================================
PRODUCT GOAL
==================================================
A War Room media player that can:
1) Play local / regional radio (Ohio-first: Akron / Cleveland / Summit)
2) Surface news/talk where lawful streams exist
3) Show weather / emergency warnings (NWS CAP) and optionally duck audio on severe alerts
4) Offer police/scanner **only** as lawful public options (prefer link-out)

==================================================
RESEARCH CONSENSUS (3 PASSES) — TREAT AS BASELINE
==================================================

## Architecture
- **Ship as War Room OS module** (Electron desktop UI), not inside Cesium Terra
- Discovery: Radio Browser API + **station-official** stream URLs
- Playback: progressive first; HLS fallback; optional mpv sidecar on Linux
- Provenance on every source (provider, URL, license/class, attribution)

## Ownership / stream classes
- STREAM_ONLY — play live URL; do not archive/redistribute
- LINK_OUT — open official site/app; do not embed/scrape
- HOLD — missing official URL or unverified
- REFUSE — illegal / ToS-hostile / encrypted PS / scrape paths

## Ohio starter playlist (Pass 3)

### SHIP (GET-proven progressive, STREAM_ONLY)
- Ideastream family: WKSU, WCLV, JazzNEO, Folk Alley (progressive streams GET-proven)
- WAPS (proven earlier)
- WJCU

### STREAM_ONLY with CORS / mpv fallback
- iHeart: WTAM, WMMS
- WNIR

### HOLD
- WKNR — until official homepage stream URL is documented

### NEVER PIN
- Legacy `audio1.ideastream.org/wcpn128.mp3` — returns 400 (dead)

## Player stack (Pass 3)
1. Primary: HTML5 audio + **howler** for progressive streams
2. Then: **hls.js** for HLS feeds
3. Then: **mpv sidecar** on Linux if browser CORS blocks (Electron)
4. Health check: **GET** audio/bytes only — HEAD requests can 502 (trap)

## Alerts (NWS CAP — Ohio)
- Endpoint pattern: `https://api.weather.gov/alerts/active?area=OH`
- Poll ≤ 30 seconds
- **Duck radio audio only on Severe / Extreme**
- Lesser alerts: banner / list only (no duck spam)
- NOAA Weather Radio: optional later; verify lawful stream before pin

## Scanners / police
- **Link-out only** (e.g. Broadcastify viewer in browser)
- No proven agency-published Akron/Cleveland stream for embed
- REFUSE: encrypted public-safety, illegal intercept, scrape of scanner sites for in-app playback

## Explicit REFUSE
- TuneIn / Broadcastify **scrape or unofficial API ingest**
- Google / proprietary radio archives as owned content
- Turning Terra globe into a radio app
- Private/illegal scanner intercept
- Pinning dead Ideastream legacy WCPN URL

==================================================
PRESETS SCHEMA (PROPOSED)
==================================================
id
name
streamUrl (nullable if link-out)
viewerUrl (for link-out)
genre (music|news|talk|jazz|folk|other)
region (e.g. OH-Akron, OH-Cleveland)
source (official|radio-browser|nws-cap|link-out)
licenseClass (STREAM_ONLY|LINK_OUT|HOLD|REFUSE)
attribution
healthCheck (GET)
lastVerified
notes

==================================================
WAR ROOM OS FIT
==================================================
- Desktop: War Room OS Electron (Linux + Windows)
- UI: Media panel / route — presets, now playing, alert banner, duck toggle
- Do not block Terra session auth work; Media is separate
- Secrets: none required for NWS CAP (User-Agent required by api.weather.gov) or public streams; do not commit stream scrapers

==================================================
WHAT CHATGPT SHOULD RETURN
==================================================
1. **Critique** — gaps, legal risks, overclaims in the research above
2. **Confirm or revise** BEST PATH in ≤10 bullets
3. **Minimal build plan** for War Room Engineer / Cursor (phases: presets+player → CAP alerts+duck → link-out scanners)
4. **Acceptance tests** (stream plays, dead URL rejected, CAP duck only Severe+, no scrape)
5. **Anything UNVERIFIED** you still need Mark to decide

Do not invent new War Room master-roadmap item numbers.
Do not recommend committing keys or scraping commercial radio apps.
===== END SOURCE 09: CHATGPT_WAR_ROOM_MEDIA_REVIEW_PROMPT.md =====

===== BEGIN SOURCE 10: FILL_TERRA_COVERAGE_DEBT_FINAL.md =====
# FILL TERRA / COVERAGE DEBT — RESEARCH FINAL (2026-09-17)
# Research only until Commander reopens builds

## CINCINNATI TRUTH
Yellow on ON/HK/QC at Cincy = correct geography. Fix = coverage router mute + densify OHGO (LIVE) + KYTC RealTime (READY). City streets/Centracs/OKI stay honest NO_COVERAGE (no public API).

## P0 WHEN BUILDS REOPEN
1) Coverage router
2) KYTC RealTime TRIMARC HTTPS stills
3) NWS CAP toast→flyTo→drawer (Severe+)
4) Mesonet MRMS ImageryLayer
5) 511NY stills finish

## FILL MATRIX
| Pri | Provider | Domain | Geo | Auth | Status |
|---|---|---|---|---|---|
| P0 | Coverage router | CAM UX | global | n/a | OPEN |
| P0 | KYTC RealTime | CAM | N KY/Cincy S | PUBLIC | READY |
| P0 | NWS CAP | WX/HAZ | US | PUBLIC+UA | READY |
| P0 | IEM MRMS | WX | CONUS | PUBLIC | READY |
| P0 | 511NY stills | CAM | NY | credential | PARTIAL |
| P1 | USGS quakes | HAZ | global | PUBLIC | READY |
| P1 | NASA FIRMS | HAZ fire | global | MAP_KEY | READY+quota |
| P1 | AWC METAR | AV/WX | airports | PUBLIC | READY |
| P1 | Duke FeatureServer | OUTAGE | DEM/OH-KY | PUBLIC | CANDIDATE |
| P1 | AIS finish | MAR | oceans | varies | PARTIAL |
| P1 | Live Intel feeds | NEWS | local→global | varies | PARTIAL |
| P2 | WSDOT / 511GA / WisTransPortal | CAM | WA/GA/WI | keys/public | Wave2 |
| P2 | Overture buildings | PLACES | global | PUBLIC | buildings OK |
| P2 | RainViewer | WX | global | none | PERSONAL_OK gate |
| DONE | OHGO, Caltrans, GIBS, ON/QC/HK/Digitraffic | — | — | — | LIVE |
| HOLD | PA/MI/Turnpike/TfNSW/DriveBC/UK NH/INDOT/MnDOT | CAM | — | — | HOLD |
| NO_COVERAGE | Centracs/OKI/Cincy streets | CAM | Cincy | — | honest |

## CURSOR PROMPT
(see chat paste from Personal Assistant)
===== END SOURCE 10: FILL_TERRA_COVERAGE_DEBT_FINAL.md =====

===== BEGIN SOURCE 11: FILL_TERRA_ALL_WAVES_COMBINED_PROMPT.md =====
# FILL TERRA — ALL WAVES COMBINED EXECUTION PROMPT (AUTHORITATIVE)
# Waves 1–3 DONE lock · Wave 4 backlog · 2026-09-17

MISSION: FILL TERRA lawful coverage — implement only Commander-approved slices. CesiumJS stack. Auth split ACTIVE (PUBLIC|PROVIDER_AUTH|COMMANDER_PRIVATE). CURRENT DELTA authoritative. No Terra2. No Phase 0 auth rewrite. No Wave rebuilds. Research locks 2026-09-16/17. Build only when Commander says implement.

SCORECARD: per-envelope % only (cameras_US|CA|EU|APAC|LatAm_ME_AF, weather_CONUS|global, haz_quakes|fire|storm|nuclear|multihazard, maritime, aviation, places, outage, live_intel). Never fake composite 90%. Remainder = HOLD|BLOCKED_EGRESS|CONFIRMED_UNFILLABLE.

REFUSE: scrape; fake markers/radar/nuke maps; Google rip; USIE; DIY explosion classifier; invent plumes; HOLD reopen without new API; RainViewer as commercial default; particles as measured weather; Media Player merge into Terra; invent cams for HTML portals; double-count DGT as Catalonia; count GDACS/EONET/USGS as haz_nuclear.

=== WAVE 1 P0 (Ohio debt / honesty first) ===
1) Coverage router — mute non-covering; auto-enable covering; Nearby = covering only; yellow only if empty/zero Online. Cincy = OH+KY.
2) KYTC RealTime TRIMARC HTTPS stills (not WGS84WM 404s)
3) NWS CAP toast→flyTo→drawer (User-Agent; Severe+)
4) Mesonet MRMS ImageryLayer on GIBS base
5) 511NY stills finish
BASELINE LIVE: OHGO, Caltrans, GIBS, ON/QC/HK Digitraffic (regional)
Cincy streets/Centracs/OKI = honest NO_COVERAGE

=== WAVE 2 DONE (proven densify) ===
CAM P0 keyless: WSDOT Cameras.json ~1705; NDDOT geojson_nc+FullPath; SG data.gov.sg traffic-images; NZ journeys+trafficnz ~313; Iceland Vegagerðin ~500
CAM P1: Digitraffic FI weathercam ~809; Trafikverket SE; AZ511 (key)
HAZ: USGS GeoJSON; FIRMS MAP_KEY; nuclear = RadNet stations + NRC EN when egress; IAEA NEWS link-out
AV: AWC METAR
HOLD: PA/MI/Turnpike/TfNSW/DriveBC/UK NH/INDOT/MnDOT/FL511 SOAP/…
UNFILLABLE: TxDOT plain stills; DelDOT legacy 404

=== WAVE 3 DONE (proven densify) ===
CAM: Spain DGT camaras.json ~1918 JPEG; Catalonia SCT WFS+RenderService ~328 — score cameras_EU as DGT∪SCT (non-overlapping)
HAZ/Live Intel multihazard: GDACS events4app GeoJSON; NASA EONET api/v3/events — NOT haz_nuclear
CTBTO public Terra feed = CONFIRMED_UNFILLABLE (NDC/vDEC)

=== WAVE 4 BACKLOG (do not block Wave1–3 implement) ===
CARS AB/MB (+SK/NS/NL…) per-host key+GET; NRC EN egress prove; Korea ITS reachability; Duke Legal vs link-out; Travel-IQ keyed US + i-TRAFFIC ZA; LatAm/Africa/ME if PUBLIC stills/JSON; broader EU/Basque; Live Intel RSS densify + ReliefWeb appname; US 511 leftover triage; gap closure → candidate or CONFIRMED_UNFILLABLE

IMPLEMENT ORDER (Commander pick slices):
Wave1 P0 → Wave2 keyless cams → Wave3 DGT/SCT + GDACS/EONET → Wave4 when keys/Legal/egress clear.

RETURN FIRST per slice: FILL_MATRIX row statuses DONE|PARTIAL|HOLD|UNFILLABLE|WAVE4 then STOP unless Commander approves next slice.
===== END SOURCE 11: FILL_TERRA_ALL_WAVES_COMBINED_PROMPT.md =====

===== BEGIN SOURCE 12: FILL_TERRA_WAVE2_DONE.md =====
# FILL TERRA WAVE 2 — DONE (2026-09-17)
Stamped DONE per Commander finish order. Wave3 backlog separate. No fake 90%.
See Personal Assistant chat for full matrix + Cursor prompt delta.
===== END SOURCE 12: FILL_TERRA_WAVE2_DONE.md =====

===== BEGIN SOURCE 13: FILL_TERRA_WAVE2_PARTIAL.md =====
# FILL TERRA WAVE 2 — PARTIAL (2026-09-17)
# Not DONE — densify still open. No fake 90% claim.

## Blocking DONE
AB/MB keys+byte-prove · remaining US 511 · more EU DATEX triage · APAC beyond SG/NZ · Duke Legal · NRC EN egress byte-prove

## P0 proven this wave
WSDOT Cameras.json ~1705 · SG traffic-images · NZ journeys ~313

## P1
Digitraffic FI weathercam · Trafikverket SE · AZ511 · 511 AB/MB (keys UNVERIFIED live) · COtrip signup · NRC EN · EPA RadNet · Duke candidate

## HOLD / UNFILLABLE
FL511 SOAP · DriveBC · TfNSW · PA/MI/Turnpike · UK NH · many EU DATEX · TxDOT CONFIRMED_UNFILLABLE · Cincy Centracs/OKI NO_COVERAGE

## Cursor delta
See Personal Assistant chat paste for full mission block.
===== END SOURCE 13: FILL_TERRA_WAVE2_PARTIAL.md =====

# ========== L. TRUTH-AUDIT TEAM FOLDS (2026-09-17 afternoon) ==========

## War Room Engineer — parity BLOCKED this run
SOURCE vs DEV:3001 vs INSTALLED:3848 = ALL UNVERIFIED from Engineer lane.
Cause: agent could not target Nebula Shell; no war-room-os on shared box; ports 3001/3848 not listening on box.
Research locks only (not code proof):
- Claimed LIVE/ACTIVE: OHGO, Caltrans, GIBS, ON/QC/HK, Digitraffic regional
- Wave1 P0 still research debt: router OPEN; KYTC/CAP/MRMS READY; 511NY PARTIAL
- Wave2/3 DONE stamps = research densify only — do NOT treat as in_source/wired/installed
Implement/runtime parity = UNVERIFIED until Nebula-local Shell or Cursor cloud agent repo grep lands.

## Legal Researcher — HOLD/UNFILLABLE stay lawful
- **CTBTO IMS/IDC:** Secure Web Portal = State Signatory–nominated only; vDEC = org contract + confidentiality; REFUSE scrape/bot; LINK-OUT public CTBTO pages OK. CONFIRMED_UNFILLABLE as free Earth layer.
- **NRC split:** Public ADAMS via APS API (subscription key) + RSS = lawful keyed public path. Prefer API over UI scrape. Non-public / SGI / non-PARS = REFUSE. Facility maps from public docs = cite ADAMS ML#; don’t invent restricted layers.
- **Keyed states:** HOLD until key + ToS (REQUIRE-AUTH). REFUSE scrape of keyed/login walls. No key = UNFILLABLE for that jurisdiction, not a bypass.
- Global: no scrape paths in FILL plan. Prior locks (Zillow/Google possess/ion stream≠export) unchanged. Not legal advice.

## Context Historian + Science Analyst (earlier this turn)
See cover page. Wave DONE ≠ IMPLEMENTED ≠ LIVE ≠ VISUALLY VERIFIED.

# ========== M. NEBULA PARITY SNAPSHOT (Personal Assistant, 2026-09-17 ~15:16 ET) ==========
# READ ONLY — SOURCE vs DEV:3001 vs INSTALLED:3848. Not visual verification.

## Process / ports (Nebula-Genesis)
- INSTALLED UI 127.0.0.1:3848 = LISTENING (next-server)
- Core 127.0.0.1:3847 = LISTENING (war-room-os)
- DEV 3001 = DOWN this run
- /api/health @3848 = HTTP 200 status degraded (application healthy)

## Live API smoke @3848 (no session cookie)
- /api/terra/coverage-state → 401 Unauthorized
- /api/terra/live-intel → 200 (~86KB) but authState=AUTH_REQUIRED
- /api/terra/layers/weather → 401 Authenticated Commander session required

## SOURCE code (lib + app/api/terra + components) — file keyword presence ≠ LIVE
| Item | SOURCE | Notes |
|---|---|---|
| Coverage federation (COVERED/PARTIAL/NO_COVERAGE) | PRESENT | `lib/terra/coverageFederation.ts` — not named coverageRouter; bbox mute/enable architecture exists |
| OHGO cameras/events/road weather | PRESENT | registry + adapters |
| Caltrans CCTV | PRESENT | `caltrans_cctv`; live-acceptance tests exist |
| Digitraffic / ON / QC / HK cams | PRESENT | in roadTrafficSourceRegistry + coverageFederation |
| 511NY | PRESENT / PARTIAL | registry id `511ny` / `ny511_cameras`; PROVIDER_AUTH; unauthenticated = not_configured |
| KYTC RealTime TRIMARC stills | MISSING | trimarc=0; KYTC in code is **wzdx_kytc** work zones only, NOT camera stills |
| Mesonet MRMS ImageryLayer | MISSING | mrms=0 in lib/app/components |
| WSDOT Cameras.json stills | MISSING as cams | `wzdx_wsdot` work zones present; not Wave2 Cameras.json adapter |
| NDDOT | MISSING | nddot=0 |
| Spain DGT / Catalonia SCT | MISSING | camaras/DGT=0 |
| GDACS | MISSING | gdacs=0 |
| NASA EONET | KEYWORD PRESENT | eonet hits; treat wiring as UNVERIFIED until adapter+runtime prove |
| NASA FIRMS / GIBS | KEYWORD PRESENT | firms/gibs hits in matrix/layers |
| NWS CAP toast→flyTo→drawer | UNVERIFIED | weather.gov/nws keyword hits; not proven as Terra toast/flyTo UX |
| RadNet / NRC EN | MISSING | radnet=0 |
| Wave2 SG/NZ/Iceland cams | UNVERIFIED/MISSING in this scoped grep | not found as dedicated adapters in this pass |

## Truth labels for ChatGPT
- RESEARCH DONE (Waves 1–3) ≠ SOURCE PRESENT ≠ LIVE RUNTIME ≠ VISUALLY VERIFIED
- Engineer lane was blocked; this Nebula pass supersedes Engineer UNVERIFIED for ports + keyword presence only
- Still NOT proven this pass: UI mute behavior on Cincy fly-to, real OHGO/Caltrans still bytes via UI, MRMS tiles on globe, CAP toast
- Wave1 P0 still debt for ChatGPT delta: finish KYTC **camera** path (not only WZDx), MRMS layer, CAP UX, 511NY key, prove coverageFederation mute on foreign regionals


# ========== N. PA2 TRUTH REPORT + LEGAL DELTA (fold 2026-09-17) ==========

## PA2 research ladder (authoritative for RESEARCH column)
RESEARCH PROVEN ≠ IMPLEMENTED ≠ LIVE RUNTIME ≠ VISUALLY VERIFIED
Wave 2/3 DONE stamps = research sets closed only.

WAVE_1_RESEARCH: router OPEN design; KYTC RealTime READY; NWS CAP READY; MRMS READY; 511NY PARTIAL; OHGO/Caltrans/GIBS/ON·QC·HK·Digitraffic RESEARCH LIVE locks; Centracs/Cincy streets/OKI CONFIRMED_UNFILLABLE.

WAVE_2_RESEARCH READY: WSDOT · SG · NZ · FI weathercam · NDDOT · Iceland · USGS · AWC METAR
PARTIAL: Travel-IQ · CARS AB/MB · FIRMS MAP_KEY · WisDOT filter · RadNet docs
BLOCKED_EGRESS: NRC EN 403
UNFILLABLE: CTBTO public · TxDOT stills · DelDOT 404 · MD video-only
HOLD: PA/MI/Turnpike/TfNSW/UK NH/INDOT/MnDOT-until-ToS/FL511 SOAP
NOTE: DriveBC HighwayCams reclass below — remove from UNFILLABLE if previously listed.

WAVE_3_RESEARCH READY: DGT∪SCT · GDACS · EONET (multihazard ≠ nuclear)
UNFILLABLE: CTBTO public · LatAm HTML portals
→ Wave4: CARS keys · NRC egress · Korea · Duke Legal · Travel-IQ · LatAm if PUBLIC JSON · DriveBC OGL-BC CSV prove

## Legal delta (PA2 / Legal Researcher)
- DriveBC HighwayCams → **NOT CONFIRMED_UNFILLABLE**. Official CSV under **OGL-BC** with image URLs (catalogue.data.gov.bc.ca/dataset/bc-highwaycams). Official open path + attribution; hotlink/TTL/caching UNVERIFIED — prove INGEST vs LINK-OUT before build. Other DriveBC TLS HOLDs may still apply — don’t confuse surfaces.
- Stands: USIE REFUSE · CTBTO UNFILLABLE · TxDOT UNFILLABLE · LatAm HTML UNFILLABLE · PA/Turnpike/TfNSW/UK NH/FL511 = REQUIRE-AUTH HOLD · Duke LINK-OUT · TfNSW REQUIRE-AUTH not UNFILLABLE · no scrape→fill.

## Blind spot
Do not report Wave 2/3 P0 or router as IMPLEMENTED/LIVE/VISUAL from research stamps.
Do not use READY-row counts as scorecard % toward 90%.
OHGO/Caltrans/GIBS “LIVE” in CURRENT DELTA need 3848 re-prove (see section M Nebula parity).

## Science DONE bar
IMPLEMENTED = code wired · LIVE RUNTIME = 3848 health probe · VISUALLY VERIFIED = Commander eyeball — Scout byte-prove alone never clears those.

## CORRECTION to PA2 “ALL UNVERIFIED” runtime block
Superseded by section M Nebula parity (Personal Assistant). Use M for SOURCE/ports/smoke; use this section N for research + legal.



# ========== O. MERGED TRUTH REPORT (cloud main 822c333 vs Nebula 10a3d34) ==========
See companion file FILL_TERRA_WAVES_1_3_TRUTH_REPORT_MERGED.md (also in docs/).
CRITICAL: GitHub main lacks OHGO/Caltrans/511NY; Nebula local branch has them. Cloud MISSING on those rows is correct for main only. Wave1 P0 KYTC TRIMARC / MRMS / full router / CAP toast still MISSING on both. ANY full DONE row = NO.
