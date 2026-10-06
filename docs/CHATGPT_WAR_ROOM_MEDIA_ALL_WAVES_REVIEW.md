# CHATGPT REVIEW — WAR ROOM MEDIA ALL WAVES (1–8)
# Commander: Mark | 2026-09-17 | Personal Assistant + Research Swarm + densify
# Paste this entire document into ChatGPT for review
# RESEARCH COMPLETE for Waves 1–6 stamped; Waves 7–8 folded from densify + prior Pass 3 locks (confirm if PA2 stamps differ)
# BUILD HELD until Commander authorizes · Media ≠ Terra · no commit/push/deploy without auth

==================================================
YOUR ROLE
==================================================
Review this densified research for Commander Mark’s **War Room Media** module (War Room OS Electron/Next sibling — NOT Cesium Terra / God’s Eye).

Chain: COMMANDER → WAR ROOM → TERRA → COUNCIL → ASTRA.
Media is a sibling feature. Do not merge into Terra globe.

Return:
1. Critique — gaps, legal risks, overclaims
2. Confirm or revise BEST PATH in ≤10 bullets
3. Minimal build plan (phases) for Cursor / War Room Engineer
4. Acceptance tests
5. Decisions still needed from Mark (UNVERIFIED)

Do not invent War Room roadmap numbers.
Do not recommend TuneIn/Broadcastify scrape, pirate radio, or paywall scrape.
Do not claim 100% of Earth’s stations are VERIFIED.

==================================================
PRODUCT GOAL (COMMANDER)
==================================================
War Room Media tabs: Radio · News · Weather · Podcasts · Saved
- Play local → all 50 US states → every continent radio (lawful discovery + VERIFIED pins)
- Free local + free global news (RSS/API)
- Weather media (NWS CAP duck, radar honesty, NWR)
- Podcasts (discover + play-from-origin)
- Emergency / alerts / scanner only lawful
- UX: VERIFIED badge, Alert ducking, GO TO INTEL, SEND TO COUNCIL, OPEN OFFICIAL SITE

Screenshot baseline 2026-09-17: Radio tab, Ohio stations (~10), WAPS VERIFIED PAUSED, Alert ducking OFF, Mesonet radar available, Terra behind God's Eye ACTIVE WITH GAPS.

==================================================
OWNERSHIP / STREAM CLASSES
==================================================
STREAM_ONLY — play live URL; do not archive/redistribute
LINK_OUT — open official site/app; do not embed/scrape
HOLD — missing official URL / unverified / keyed
REFUSE — illegal / ToS-hostile / encrypted PS / scrape / pirate

Player stack (LOCKED):
1. HTML5 / howler progressive (MP3/AAC)
2. hls.js for HLS
3. mpv sidecar on Linux if CORS blocks
4. Health = GET audio bytes (Range OK) — never HEAD-alone

==================================================
WAVE 1 — OHIO RADIO DENSIFY (DONE)
==================================================
READY discovery: Radio Browser `state=Ohio` / stateExact
READY GET STREAM_ONLY (examples):
- WAPS / Summit — streamer2.legatocommunications.com (carry Pass3)
- Ideastream / WKSU family — live.ideastream.org (wcpn/wksu4/wksu3 GET audio/mpeg)
- WJCU — streaming.jcu.edu
- WOSU/WOSA — wosu.streamguys1.com
- WGUC/WVXU — stream.cinradio.org
- WOBN Creek; other official mounts from densify file

PARTIAL: iHeart WTAM/WMMS/WNIR — STREAM_ONLY CORS/mpv
HOLD: WKNR — no official URL
NEVER PIN: legacy audio1.ideastream.org/wcpn128.mp3 (dead/mislabeled)

VERIFIED badge only after GET audio bytes + provenance.

==================================================
WAVE 2 — US-50 + EVERY CONTINENT (DONE · Earth PARTIAL)
==================================================
Scorecard:
| Envelope | Status |
|---|---|
| radio_US_states | READY discovery — 50/50 states ≥1 Radio Browser hit; DC needs aliases |
| radio_OH densify | READY — official + RB |
| radio_NA | PARTIAL — US+CA+MX country rollups |
| radio_EU | PARTIAL — country ISO READY |
| radio_AS / SA / OC / AF | PARTIAL — country rollups; sample densify later |
| radio_AN | HOLD / sparse (~11 RB) |
| Earth completeness | PARTIAL — never claim 100% |

Discovery stack READY:
- Radio Browser API (docs.radio-browser.info) — metadata community; playback = station ToS
- Official station listen pages (gold for STREAM_ONLY)
- Xiph Icecast YP dir.xiph.org/yp.xml (cache)
- IPRD public-radio M3U catalogs

Adapter rules: store stationuuid + url_resolved; GET Range health; call /json/url/{uuid} on play; User-Agent required; no hard-pin one mirror forever.

REFUSE: TuneIn / Broadcastify scrape; pirate re-encodes; inventing VERIFIED from directory UUID alone.

==================================================
WAVE 3 — FREE LOCAL OH NEWS (DONE)
==================================================
READY RSS (metadata + LINK-OUT article):
Cleveland.com · Signal Cleveland · Ohio Capital Journal · Toledo Blade · WCPO · WOSU · WVXU · Vindy

PARTIAL: Ideastream news RSS — empty items observed
HOLD: Beacon / Dispatch Arc 404 → homepage LINK-OUT
REFUSE: paywall scrape · invent · applying radio VERIFIED badge to news rows

==================================================
WAVE 4 — FREE GLOBAL / WIRE (DONE)
==================================================
READY RSS (metadata + LINK-OUT):
NPR · BBC · Guardian · NYT · WashPost · PBS · Al Jazeera · France24 · RFI · DW · UN · ReliefWeb
Optional: GDACS · NASA · Politico · The Hill · Axios · tech · Hacker News

HOLD / REQUIRE_AUTH: AP/Reuters public wire · NewsAPI · GNews · Guardian Open Platform
REFUSE: paywall scrape · invent · densify ≠ all Earth wires claimed complete

==================================================
WAVE 5 — WEATHER MEDIA (DONE)
==================================================
| Item | Status |
|---|---|
| NWS CAP `api.weather.gov/alerts/active?area=OH` | READY OWNABLE — User-Agent required |
| Alert ducking | PARTIAL wiring · policy LOCKED: duck Media radio Extreme\|Severe only |
| NOAA Weather Radio (e.g. WWG57) | PARTIAL third-party STREAM or LINK-OUT |
| Mesonet MRMS / IEM radar | READY STREAM + show product age (screenshot: RADAR AVAILABLE) |
| RainViewer | PARTIAL license gate (personal OK; not commercial default) |
| Fake LIVE radar without timestamp | REFUSE |

Separate buses: Media radio duck ≠ Terra weather toast spam. prefers-reduced-motion: still duck audio; skip particle flash.

==================================================
WAVE 6 — PODCASTS (DONE)
==================================================
READY: iTunes Search / Podcasts API discovery
REQUIRE_AUTH: Podcast Index (HMAC)
Play: resolve feedUrl → enclosure → play-from-origin only (STREAM_ONLY on-demand)
Curate OH/news pins: Sound of Ideas · ONN · Up First (examples)
REFUSE: rehost / mirror podcast files

==================================================
WAVE 7 — EMERGENCY / SCANNER / ALERTS (FOLDED · prior + Legal)
==================================================
READY:
- NWS CAP / IPAWS-style public alerts (same as W5)
- Optional NOAA Weather Radio LINK_OUT / third-party STREAM with badge

LINK_OUT only:
- Broadcastify / scanner viewers in browser — do not scrape for in-app ingest

HOLD / REFUSE:
- Encrypted public-safety
- Illegal intercept / decode
- US scanner rebroadcast into app without clear lawful grant (Legal: 605 risk → HOLD/REFUSE)
- Inventing live police CAD audio

==================================================
WAVE 8 — MEDIA ↔ TERRA / COUNCIL UX (FOLDED · Science + UI)
==================================================
LOCKED behaviors:
- VERIFIED = GET-proven audio + provenance (never auto from RB uuid)
- Alert ducking toggle (screenshot OFF) — Extreme/Severe only when ON
- GO TO INTEL — hand location/context to Terra/Live Intel (no merge of player into globe)
- SEND TO COUNCIL — thin Observed packet only:

```
{
  kind: "media_observation",
  observedAt,
  stationPin?: { id, name, streamUrl, homepageUrl, licenseClass, attribution, protocol, health, lastOkAt },
  alert?: { id, event, severity, area, onset, expires, sourceUrl, honesty },
  radarContext?: { layerId, productTime, STREAM_ONLY: true },
  provenance: [{ provider, license, retrievedAt }],
  commanderNotes?: { source: "commander_notes" }
}
```

- OPEN OFFICIAL SITE / SOURCE — required for LINK_OUT and attribution
- Coverage honesty: when Terra shows NO_COVERAGE, Media must not fake local news/cam audio
- Media ≠ Terra; no autoplay spam

==================================================
LEGAL (FOLDED)
==================================================
- NWS CAP: public domain / INGEST OK with attribution + User-Agent
- News RSS: metadata + LINK-OUT; no paywall body scrape
- Podcasts: play enclosure from origin
- Radio: official embed or LINK_OUT; station ToS binds playback
- Scanner: LINK_OUT preferred; rebroadcast HOLD/REFUSE
- REFUSE: pirate, TuneIn scrape, Broadcastify scrape ingest

==================================================
PROPOSED PRESET SCHEMA
==================================================
id, name, streamUrl (nullable), viewerUrl, genre, region/state/country,
source (official|radio-browser|rss|nws-cap|podcast|link-out),
licenseClass (STREAM_ONLY|LINK_OUT|HOLD|REFUSE),
attribution, healthCheck (GET), lastVerified, continent?, notes

==================================================
PROPOSED BUILD ORDER (when Commander authorizes)
==================================================
0. Keep Media as War Room OS module (not Terra)
1. Radio Browser adapter + Ohio VERIFIED pin set + GET health
2. US-50 state picker + DC aliases + country ISO continental tabs (discovery first; VERIFIED on play-prove)
3. News tab: OH READY RSS + global READY RSS (metadata + LINK-OUT)
4. Weather: CAP poll area=OH + duck Extreme/Severe + Mesonet age label
5. Podcasts: iTunes search → enclosure play-from-origin; Podcast Index after key
6. Emergency: CAP + NWR link-out; scanner LINK_OUT only
7. UX: VERIFIED rules, ducking toggle, GO TO INTEL, SEND TO COUNCIL packet
8. Deferred: AP/Reuters keys, RainViewer commercial, full continental VERIFIED densify

==================================================
UNIFIED REFUSE
==================================================
TuneIn/Broadcastify scrape · pirate radio · paywall scrape · encrypted PS · invent VERIFIED ·
fake 100% Earth stations · radio VERIFIED badge on news · Media merged into Terra ·
autoplay spam · HEAD-only health · fake LIVE radar without timestamp · podcast rehost

==================================================
COMPANION FILES (Nebula docs/)
==================================================
- WAR_ROOM_MEDIA_WAVE1_2_RADIO.md
- CHATGPT_WAR_ROOM_MEDIA_REVIEW_PROMPT.md (Pass 3 baseline)
- TERRA_ALLTOGETHER_CHATGPT_PACK.md (Terra — separate)

==================================================
WHAT CHATGPT SHOULD RETURN
==================================================
1. Critique of densify vs Pass 3 baseline
2. BEST PATH ≤10 bullets
3. Minimal phased build plan
4. Acceptance tests (50-state discovery works; VERIFIED only after GET; CAP duck Severe+ only; news LINK-OUT; no scrape)
5. Mark decisions still open (Podcast Index key? RainViewer? any scanner LINK_OUT allowlist?)

STOP — AWAIT COMMANDER IMPLEMENT AUTHORIZATION
