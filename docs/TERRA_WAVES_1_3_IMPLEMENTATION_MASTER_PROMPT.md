# TERRA — WAVES 1–3 IMPLEMENTATION MASTER PROMPT
# Commander: Mark
# Canonical source: Nebula live-council-intelligence-repair @ 10a3d34 or newer descendant
# Research locks: 2026-09-16 / 2026-09-17
# CURRENT DELTA authoritative
# Auth split ACTIVE: PUBLIC | PROVIDER_AUTH | COMMANDER_PRIVATE
# Saved: 2026-09-17 by Personal Assistant — BUILD HELD until Commander authorizes a slice

MISSION

Implement FILL TERRA Waves 1–3 from the CURRENT implementation truth.

Do NOT replay research.
Do NOT treat RESEARCH DONE as IMPLEMENTED.
Do NOT rebuild already-present adapters.
Do NOT create Terra2.
Do NOT redo Phase 0 auth.
Do NOT fake coverage.
Do NOT scrape.
Do NOT push/commit/deploy/package unless explicitly authorized by Commander.

==================================================
SOURCE OF TRUTH
==================================================

CANONICAL IMPLEMENTATION SOURCE:

Nebula:
live-council-intelligence-repair
HEAD = 10a3d34 or newer descendant

DO NOT BUILD FROM:
GitHub main @ 822c333

Reason:
main lacks already-present OHGO / Caltrans / 511NY work.

DO NOT RE-ADD:

OHGO
Caltrans
existing 511NY adapter
existing GIBS stack
existing regional ON/QC/HK/Digitraffic integrations
existing USGS
existing partial EONET
existing current coverageFederation

==================================================
CURRENT IMPLEMENTATION TRUTH
==================================================

AUTH:
PUBLIC / PROVIDER_AUTH / COMMANDER_PRIVATE = ACTIVE

GOD'S EYE:
ACTIVE_WITH_GAPS

CAMERA FEDERATION:
PARTIAL

STRICT IMPLEMENTATION DONE ROWS:
NONE

RESEARCH STATUS:

Wave 1 research = READY / PARTIAL depending row
Wave 2 research = DONE
Wave 3 research = DONE

Wave research completion DOES NOT equal implementation completion.

==================================================
CURRENT SOURCE STATE
==================================================

SOURCE PRESENT:

coverageFederation
OHGO
Caltrans
Digitraffic / Ontario / Québec / Hong Kong
511NY gated provider-auth path
wzdx_kytc zones (NOT KYTC camera stills)
wsdot zones (NOT WSDOT Cameras.json)
NWS alerts partial
USGS
EONET partial
GIBS imagery stack

SOURCE MISSING:

KYTC TRIMARC stills
MRMS
NDDOT
WSDOT Cameras.json
Singapore traffic-images
NZTA cameras
Iceland cameras
Trafikverket Sweden
AZ511 camera adapter
Spain DGT
Catalonia SCT
GDACS
EPA RadNet
NRC Event Notifications
IAEA news link-out
NASA FIRMS
AWC METAR
full coverage-router UX

==================================================
RUNTIME TRUTH
==================================================

DEV 3001 = DOWN

INSTALLED:
3848 UI = UP
3847 Core = UP

health = 200 degraded

Without Commander session:

coverage-state = 401
live-intel = 200 AUTH_REQUIRED
weather = 401

Therefore:

OHGO = SOURCE PRESENT / RUNTIME RE-PROVE REQUIRED
Caltrans = SOURCE PRESENT / RUNTIME RE-PROVE REQUIRED
GIBS = SOURCE PRESENT / RUNTIME RE-PROVE REQUIRED
511NY = SOURCE PRESENT / PROVIDER_AUTH / RUNTIME UNVERIFIED

Do not call them LIVE again until re-proven in installed 3848 with session where needed.

==================================================
IMPLEMENTATION ORDER
==================================================

Execute in this order:

WAVE 1 P0
1. Coverage Router UX
2. KYTC TRIMARC still cameras
3. NWS CAP Severe+ toast → flyTo → drawer
4. MRMS ImageryLayer
5. 511NY provider-auth finish
6. Re-prove OHGO / Caltrans / GIBS on installed 3848

WAVE 2
7. Keyless camera densification:
   - WSDOT Cameras.json
   - NDDOT
   - Singapore
   - NZTA
   - Iceland
   - verify Digitraffic Finland
8. Wave 2 hazard/aviation:
   - USGS empty/truth states
   - FIRMS
   - AWC METAR
   - IAEA link-out
   - RadNet when ready
   - NRC only when egress clears

WAVE 3
9. Spain DGT
10. Catalonia SCT
11. GDACS
12. EONET completion / envelope cleanup

WAVE 4
only after:
keys
legal
egress
new lawful evidence

==================================================
WAVE 1 P0 — COVERAGE ROUTER
==================================================

CURRENT:
PARTIAL

Existing:
coverageFederation
bbox truth
some provider coverage metadata

MISSING:

- full mute UI for non-covering providers
- auto-enable covering providers
- Nearby cameras = covering providers only
- Cincinnati = Ohio + Kentucky coverage union
- yellow only when covering provider is empty / zero Online
- city-level acceptance tests
- foreign-region providers muted in Ohio

REQUIRED:

Provider registry must express lawful coverage envelope.

When active location changes:

covering providers:
ACTIVE / ELIGIBLE

non-covering providers:
MUTED / NOT_COVERING

Nearby camera query:
must query/filter covering providers only

Do NOT display:

Ontario
Québec
Hong Kong

as covering Akron/Cincinnati.

CINCINNATI:

covering camera federation must include:
OHGO
KYTC

Centracs / OKI:
NO_COVERAGE

No fake city cameras.

ACCEPTANCE LOCATIONS:

Akron, Ohio
Cincinnati, Ohio/Kentucky
California
New York
Spain
Catalonia
Singapore

Return:

COVERAGE_ROUTER = DONE only if:
- provider coverage classification works
- Nearby respects it
- mute UI works
- yellow semantics correct
- foreign providers stay muted outside coverage

==================================================
WAVE 1 P0 — KYTC
==================================================

STATUS:
RESEARCH READY
IMPLEMENTATION MISSING

Important:

existing wzdx_kytc != KYTC camera stills

Implement separate KYTC camera provider.

Use:

KYTC RealTime / TrafficCameras
TRIMARC HTTPS JPEG stills

Do NOT use:
dead WGS84WM HTTP 404 path

Requirements:

provider adapter
catalog
coverage envelope
real JPEG
attribution
truthful empty/error states
Cincinnati south-bank densification

No scrape.

==================================================
WAVE 1 P0 — NWS CAP
==================================================

STATUS:
PARTIAL

Existing:
NWS alerts layer

MISSING:
Severe+ interaction UX

Required:

api.weather.gov/alerts
proper User-Agent

Severe / Extreme:
toast
→ VIEW
→ flyTo real geometry/bbox
→ weather drawer

Avoid double-spam with Media/NWS logic.

Do not fabricate geometry.

Reuse existing alert truth lifecycle.

==================================================
WAVE 1 P0 — MRMS
==================================================

STATUS:
MISSING

Implement:

Mesonet MRMS / documented lawful radar path

Cesium ImageryLayer
over existing GIBS/base

Truth:

STREAM_ONLY
real frame timestamp
real attribution
polite cache
no fake radar
no particles-as-measured-weather

If unavailable:
truthful stale/error/no-coverage state

==================================================
WAVE 1 P0 — 511NY
==================================================

STATUS:
SOURCE PRESENT
PROVIDER_AUTH
RUNTIME UNVERIFIED

Finish:

official stills

VideoUrl:
link-out only

Credential:
provider-auth model

Commander supplies key outside chat.

Do not expose key client-side.

Re-prove in installed 3848 once configured.

==================================================
WAVE 1 P0 — RE-PROVE BASELINE
==================================================

After Wave 1 implementation:

prove installed 3848:

OHGO
Caltrans
GIBS

Do not rely on source presence.

Return for each:

SOURCE_PRESENT =
REGISTERED =
COVERAGE_ROUTED =
RUNTIME_REACHABLE =
REAL_DATA =
UI_CONNECTED =
TRUTH_STATE =

==================================================
WAVE 2 — KEYLESS CAMERAS
==================================================

Implement in this order:

1. WSDOT
2. NDDOT
3. Singapore
4. NZTA
5. Iceland
6. verify Digitraffic Finland existing state

--------------------------------------------------
WSDOT
--------------------------------------------------

Research-proven:

https://data.wsdot.wa.gov/mobile/Cameras.json

~1705 camera records

real stills:
images.wsdot.wa.gov

Implement:
PUBLIC
Washington coverage only
real image truth
attribution

Do not confuse with existing WSDOT zones work.

--------------------------------------------------
NDDOT
--------------------------------------------------

Research-proven:

geojson_nc/cameras.json
FullPath JPEG pattern

Implement:
PUBLIC
North Dakota coverage only
real JPEG verification
truthful empty/error

--------------------------------------------------
SINGAPORE
--------------------------------------------------

Research-proven:

api.data.gov.sg/v1/transport/traffic-images

Implement:
PUBLIC
Singapore coverage only

--------------------------------------------------
NZTA
--------------------------------------------------

Research-proven:

journeys cameras.json
trafficnz.info/camera/{id}.jpg

~313

Respect NZTA terms.

Implement:
PUBLIC where allowed
NZ-only coverage

--------------------------------------------------
ICELAND
--------------------------------------------------

Research-proven:

gagnaveita.vegagerdin.is/api/vefmyndavelar2014_1

Slod JPEG fields

~500

Implement:
PUBLIC
Iceland coverage

--------------------------------------------------
DIGITRAFFIC FINLAND
--------------------------------------------------

Existing Finland support may already be present.

Do NOT duplicate.

Audit first.

If missing/incomplete:
use weathercam API
real preset JPEG:
weathercam.digitraffic.fi/{preset}.jpg

==================================================
WAVE 2 — KEYED CAMERA PROVIDERS
==================================================

TRAFIKVERKET SWEDEN:
PUBLIC_KEY
research-proven JPEG path

AZ511:
keyed
adapter currently missing
implement provider-auth path

Do not call BLOCKED simply because adapter is missing.

==================================================
WAVE 2 — HAZARD / AVIATION
==================================================

USGS:
SOURCE PRESENT
verify truth/empty states
do not duplicate adapter

FIRMS:
NASA FIRMS
MAP_KEY
adapter missing
requires disclaimer
no fake fire markers

AWC METAR:
JSON
research ready
implement aviation envelope

IAEA:
NEWS link-out only
do not map as nuclear hazard geometry

RADNET:
EPA station data
implement only when source/runtime proof is sufficient

NRC EVENT NOTIFICATIONS:
BLOCKED_EGRESS until proven reachable

Do not fake around blocked egress.

==================================================
WAVE 2 — HOLD / BLOCKED
==================================================

BLOCKED / PARTIAL:

NRC EN
DriveBC JPEG/TLS
FIRMS without MAP_KEY

HOLD:

PA
MI
Ohio Turnpike
TfNSW
UK National Highways
INDOT
MnDOT
FL511 SOAP
Travel-IQ without keys
CARS without keys
Duke until Legal clears
RainViewer commercial default

Do NOT reopen without new lawful evidence.

==================================================
WAVE 3 — DGT
==================================================

STATUS:
RESEARCH READY
IMPLEMENTATION MISSING

Spain DGT:

camaras.json
~1918 proven JPEG records

Implement:
PUBLIC
Spain coverage
real JPEG
attribution
truthful error/empty

==================================================
WAVE 3 — CATALONIA SCT
==================================================

STATUS:
RESEARCH READY
IMPLEMENTATION MISSING

Catalonia SCT:

WFS
RenderService
~328

Implement separately.

Score:

cameras_EU =
DGT ∪ SCT

Do NOT double-count SCT cameras as DGT cameras.

==================================================
WAVE 3 — GDACS
==================================================

STATUS:
RESEARCH READY
IMPLEMENTATION MISSING

Use:

events4app GeoJSON

Purpose:
multi-hazard / Live Intel

Do NOT count GDACS as haz_nuclear.

Implement:
feed normalization
real geometry
source/provenance
truthful lifecycle

==================================================
WAVE 3 — EONET
==================================================

STATUS:
PARTIAL

Existing EONET layer/source present.

Audit before changing.

Complete only missing:

normalization
coverage/envelope
Live Intel/hazard integration
truth states

Do NOT duplicate existing feed.

Do NOT count EONET as haz_nuclear.

==================================================
WAVE 3 — CTBTO
==================================================

STATUS:
CONFIRMED_UNFILLABLE

Public Terra feed:
NO

NDC / vDEC access model only

Do not ingest.
Do not scrape.
Do not create fake nuclear coverage.

==================================================
WAVE 4 BACKLOG
==================================================

Do not block Waves 1–3 on these.

CARS keys
NRC egress
RadNet completion
Korea ITS
Duke Legal
Travel-IQ
i-TRAFFIC ZA
LatAm/Africa/ME lawful feeds
broader EU
Live Intel RSS
ReliefWeb appname
US 511 triage
DriveBC JPEG proof
per-envelope gap closure

==================================================
OTHER OPEN TERRA GAPS
==================================================

These are NOT part of Waves 1–3 camera/hazard implementation unless explicitly needed:

local news
GPS
click→info
building ownership/inspect
street intelligence
remaining gaps priorities 4–8

Keep them separate.

==================================================
LIVE INTEL LANE
==================================================

PROMPT READY:

LIVE_INTEL_PANEL_REVAMP_EXECUTION_PROMPT_FINAL.md

BUILD HELD unless Commander explicitly opens it.

Local news still PARTIAL.

Do not merge this lane into camera provider implementation.

==================================================
LUXURY WEATHER LANE
==================================================

PROMPT READY:

TERRA_LUXURY_WEATHER_EXECUTION_PROMPT_FINAL.md

BUILD HELD unless Commander explicitly opens it.

Measured:
GIBS
future MRMS

Particles:
presentation only
not measured weather

==================================================
MEDIA LANE
==================================================

WAR ROOM MEDIA is separate.

Do NOT merge Media Player into Terra.

Media launcher may remain in War Room shell/rail according to existing product design.

No autoplay.

==================================================
AUTH RULES
==================================================

PUBLIC:
no Commander auth requirement for public Earth data

PROVIDER_AUTH:
server-side provider credentials

COMMANDER_PRIVATE:
private Commander data/location

OHGO:
PROVIDER_AUTH

511NY:
PROVIDER_AUTH

Do NOT force Commander session requirements onto lawful public Earth layers.

==================================================
COVERAGE SCORECARD
==================================================

Report coverage per envelope ONLY.

Use:

cameras_US
cameras_CA
cameras_EU
cameras_APAC
cameras_LatAm_ME_AF

weather_CONUS
weather_global

haz_quakes
haz_fire
haz_storm
haz_nuclear
haz_multihazard

maritime
aviation
places
outage
live_intel

No composite "Terra 90%" claim.

Each denominator must be explicit.

Remainder statuses:

DONE
PARTIAL
HOLD
BLOCKED_EGRESS
CONFIRMED_UNFILLABLE

==================================================
REFUSE
==================================================

NO:

scraping
fake camera markers
fake radar
fake nuclear maps
fake plume modeling
Google imagery ripping
USIE
DIY explosion classifier
CTBTO bot
HOLD reopening without new API
RainViewer commercial default without clearance
particles represented as measured weather
War Room Media merged into Terra
invented cameras for HTML portals
DGT/SCT double-counting
GDACS/EONET/USGS counted as nuclear
Terra2
Phase 0 auth rewrite
fake 90%
provider coverage outside real region

==================================================
IMPLEMENTATION DISCIPLINE
==================================================

For every provider/slice:

1. audit existing source first
2. do not duplicate existing adapters
3. implement smallest lawful slice
4. registry
5. coverage envelope
6. normalization
7. auth model
8. health/truth states
9. real data proof
10. UI connection
11. installed 3848 proof where possible

Do not call DONE because:
file exists
adapter compiles
research found endpoint

DONE requires runtime truth.

==================================================
COMMIT / PUSH / PACKAGE RULE
==================================================

Until Commander explicitly authorizes:

NO COMMIT
NO PUSH
NO DEPLOY
NO PACKAGE
NO REINSTALL

Implementation may occur only for Commander-approved slice.

If this prompt is being used for planning/audit only:

DO NOT MODIFY FILES.

==================================================
RETURN FORMAT
==================================================

FILL_TERRA_IMPLEMENTATION_REPORT

CANONICAL_SOURCE =
SOURCE_HEAD =

WAVE_1 =
COVERAGE_ROUTER =
KYTC =
NWS_CAP =
MRMS =
511NY =

BASELINE_REPROOF =
OHGO =
CALTRANS =
GIBS =

WAVE_2 =
WSDOT =
NDDOT =
SINGAPORE =
NZTA =
ICELAND =
DIGITRAFFIC_FI =
TRAFIKVERKET_SE =
AZ511 =

USGS =
FIRMS =
AWC_METAR =
RADNET =
NRC_EN =
IAEA =

WAVE_3 =
DGT =
SCT =
GDACS =
EONET =
CTBTO =

WAVE_4_BACKLOG =

COVERAGE_SCORECARD =

HOLD =
BLOCKED =
UNFILLABLE =

SOURCE_STATUS =
DEV_STATUS =
INSTALLED_3848_STATUS =

FILES_CHANGED =
VALIDATIONS =
RUNTIME_PROOF =
VISUAL_PROOF =
SCREENSHOT_PATHS =

NEXT_REQUIRED_SLICE =

OVERALL =

STOP.
