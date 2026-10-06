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
