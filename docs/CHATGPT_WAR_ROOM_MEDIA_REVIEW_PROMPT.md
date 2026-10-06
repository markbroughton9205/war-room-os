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
