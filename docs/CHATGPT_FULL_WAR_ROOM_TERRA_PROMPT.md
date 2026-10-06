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
