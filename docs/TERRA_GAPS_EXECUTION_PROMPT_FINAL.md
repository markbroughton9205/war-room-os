# TERRA GAPS → SOLUTIONS → EXECUTION PROMPT (FINAL)
# Commander: Mark | War Room Research + Personal Assistant | 2026-09-16/17
# Paste into ChatGPT / Cursor. Build only what Commander approves.
# No Terra2. No Wave 5 without auth green. No commit/push/deploy without Commander auth.

## BEST PATH (one liner)
Phase 0 Commander-session auth → Phase 1 coverage router (auto-enable covering / mute others; yellow only if covering set empty) → Phase 2 OHGO keyed LIVE near 39.13/-84.58 → Phase 3 KYTC RealTime (TRIMARC HTTPS; not WGS84WM) → Wave1 511NY/Caltrans stills. HOLDs stay HOLD. No Terra2. No Wave5 without auth green.

## WHY YELLOW AT CINCINNATI TODAY
ON/HK/QC yellow is geographically correct (regional feeds). Feels broken because those layers stay toggled ON in Ohio. Fix = router mute + enable OHGO (+ KYTC south of river). City/Centracs/OKI = honest NO_COVERAGE (private IP / no public API).

## GAP TABLE
| Gap | State | BEST NEXT | Owner |
|---|---|---|---|
| Coverage router | OPEN | bbox/admin registry + mute/auto-enable | Cursor |
| OHGO cams | PARTIAL/READY | Resume keyed adapter; prove cam near Cincy | Cursor→Commander |
| KYTC RealTime | READY w/ caveats | Adapter after OHGO; TRIMARC JPEG only | Cursor |
| Nearby honesty UX | OPEN | Yellow iff covering set empty | Cursor |
| HOLD cams (PA/MI/Turnpike/TfNSW/DriveBC TLS/UK NH/TDX) | HOLD | No scrape | Commander |
| Wave2 regionals | DEFERRED | After Wave1 | Commander |
| Auth 401 live-intel/layers | OPEN / UNVERIFIED freshness | Fix session before Wave5 | Cursor |
| Live Intel UX | PARTIAL / UNVERIFIED | Spec then UI post-auth | Cursor |
| Click→info | OPEN / UNVERIFIED | Pick + card | Cursor |
| DEM ownable vs ion | PARTIAL / UNVERIFIED live | Classify; prefer ownable/self-host | Engineer |
| Listings/IDX | HOLD | Legal/RESO only | Legal/Commander |
| Notes/questionnaire | OPEN | Defer or thin panel | Cursor |
| Begin-sim/scenario | DEFERRED | After live layers stable | Commander |
| Mapillary/Panoramax | OPEN research | Ship only if COMMERCIAL_OK; Vistas RESEARCH_ONLY | Research→Cursor |
| Cincy streets/OKI/Centracs | NO_COVERAGE/UNUSABLE | Honest yellow; refuse private | — |
| House# roof labels | OPEN | Uneven OSM ≠ Maps | Cursor |
| Google Street View parity | HOLD/opt-in | No scrape | Commander |
| Overture Addresses Alpha | OPEN | Not GERS-stable | Engineer |
| SPaT live signals | mostly NO_COVERAGE | OSM static ≠ LIVE | — |
| Media Player (WR OS) | research DONE / build held | Separate module — not Terra camera phases | PA2/Commander |

UNVERIFIED until probe: OHGO cam density at Cincy (needs key), live `/terra` DEM which provider, Live Intel/click freshness (3848).

## MISSION
Close Terra/God’s Eye gaps in ordered phases. Stack stays CesiumJS (no Terra2). Research locks from War Room Research 2026-09-16 apply. Build only what Commander approves.

## REFUSE
- Terra2 / second globe
- Wave 5 without Commander-session auth green on live-intel/layers
- Private cameras, auth bypass, HTML scrape (Ohio Turnpike / MI / viewer-only)
- Fake markers; STALE→LIVE without new image bytes
- Centracs / private IPs (e.g. 10.10.9.9); inventing cams for yellow areas
- Google Street View / Maps scrape or ML-from-Google
- Mapillary Vistas as production dependency (RESEARCH_ONLY / NC-SA)
- IDX/listings without Legal gate; encrypted public-safety audio as in-app scanner
- Folding War Room Media Player into Terra camera phases (separate module)

## PHASE 0 — Auth gate
Clear Commander-session 401 on live-intel / layers.
Acceptance: authenticated GET → 200; AUTH_FAIL health distinct from NO_COVERAGE.

## PHASE 1 — Coverage router (makes yellow trustworthy)
Provider registry: id, coverage (admin codes and/or bbox/polygon), authClass, freshnessPolicy, enabledDefault.
On fly-to/pan: covering set = providers intersecting view center + Nearby radius (Cincinnati = OH + KY cross-border).
Auto-enable covering providers; mute non-covering (do NOT leave ON/HK/QC on in Ohio).
Nearby Cameras queries ONLY covering providers, then distance filter (40–80 km).
Yellow NO_COVERAGE only when covering set empty OR zero Online cams in radius — never because a remote regional toggle is on.
Acceptance: at Cincinnati, ON/HK/QC muted; yellow only if OHGO/KYTC (when enabled) yield no cams.

## PHASE 2 — OHGO (Ohio green)
PUBLIC_KEY + refreshed JPEGs; federation schema; region=cincinnati and/or lat/lon filter near 39.13/-84.58.
Reuse prior adapter / PR #43 base — no mocks; health LIVE/STALE from lastUpdated.
Acceptance: ≥1 real JPEG marker near Cincinnati after keyed sample; no-key → AUTH_FAIL not fake coverage.

## PHASE 3 — KYTC RealTime (Northern KY / south of river)
ArcGIS TrafficCameras_Ext_Prd status=Online + TRIMARC HTTPS JPEG snapshots.
Do NOT use stale Ky_WebCams_WGS84WM http 404 layer.
Attribution KYTC/TRIMARC; layer OFF until proved then include in covering set for KY.
Acceptance: Northern KY cams appear in Nearby when viewing Cincinnati metro.

## PHASE 4 — Wave1 finish
511NY stills (link-out/official stills path); Caltrans CWWP2 stills.
All HOLD providers stay HOLD (PA license, MI HTML_VIEWER_ONLY, Turnpike HTML_VIEWER_ONLY, TfNSW key, DriveBC TLS UNVERIFIED, UK NH RESTRICTED, TDX member-only). No scrape.

## PHASE 5 — Live Intel UX + click→info (after Phase 0)
Complete panel/hover patterns; entity pick → info card from ownable or stream-attributed data.
Acceptance: click building/cam/entity shows card; no auto-expand chat regressions.

## PHASE 6 — DEM classify
Live-check which terrain is active on /terra. Label ion World Terrain/Imagery/OSM Buildings as STREAM_ONLY; prefer ownable/self-host (e.g. Re:Earth / OpenTopography→CTOD) where product requires possess.
Acceptance: UI/docs never claim “ownable DEM” for ion stream.

## PHASE 7 — Street intel (license gate)
MapillaryJS dual-pane and/or Panoramax only if COMMERCIAL_OK for intended use; Meta hosted dump = STREAM_ONLY; Vistas = RESEARCH_ONLY — not production.
No Google Street View.

## DEFER / OTHER GATES
- Listings/IDX: Legal + RESO only — HOLD until cleared
- Notes/questionnaire: thin panel or defer
- Begin-sim/scenario: after live layers stable
- Wave2 regionals (WA/GA/AB/…): after Wave1 + Evidence byte-proof
- Overture Addresses Alpha: not GERS-stable — don’t treat as MLS-grade
- SPaT live signal phase: mostly NO_COVERAGE — don’t fake from OSM static
- House-number roof labels: OSM uneven — optional, not Maps parity

## GLOBAL ACCEPTANCE
- No fake coverage; health ∈ {LIVE, STALE, OFFLINE, AUTH_FAIL, NO_COVERAGE}
- Session-auth ≠ coverage geography
- Merge/push only with Commander approval
- Media Player remains separate WR OS track (research DONE; build held pending Mark)
