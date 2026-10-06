# WAR ROOM MEDIA — Wave 1+2 Radio Densify (RESEARCH ONLY)
# Commander: Mark | Assembled: Grok Bot executor | 2026-09-17 ~21:00 ET
# Extends: CHATGPT_WAR_ROOM_MEDIA_REVIEW_PROMPT.md (do not ignore)
# Scope expand: Ohio densify + US-50 coverage pattern + every continent catalogs
# NO CODE EDITS. No scrape/TuneIn/Broadcastify ingest. No pirate/proprietary app steal.

==================================================
0. BASELINE FROM PRIOR PROMPT (PRESERVED)
==================================================
War Room Media = sibling War Room OS module (Electron/Next), NOT Terra / God’s Eye.
Chain: COMMANDER → WAR ROOM → TERRA → COUNCIL → ASTRA.

Stream classes (unchanged):
- STREAM_ONLY — play live URL; do not archive/redistribute
- LINK_OUT — open official site/app; do not embed/scrape
- HOLD — missing official URL or unverified
- REFUSE — illegal / ToS-hostile / encrypted PS / scrape paths

Player stack (unchanged): howler progressive → hls.js → mpv sidecar; health = GET bytes (HEAD can 502).
Alerts: NWS CAP `https://api.weather.gov/alerts/active?area=OH`; duck only Severe/Extreme.
Scanners: LINK_OUT only. REFUSE Broadcastify/TuneIn scrape.

Prior Ohio SHIP list: Ideastream family (WKSU/WCLV/JazzNEO/Folk Alley), WAPS, WJCU.
PARTIAL (CORS/mpv): iHeart WTAM/WMMS, WNIR.
HOLD: WKNR until official homepage stream documented.
NEVER PIN: legacy `audio1.ideastream.org/wcpn128.mp3` (prior Pass 3: dead/400; Wave1 GET saw 200 audio but same footprint as WCLV — do not trust as WCPN news).

==================================================
1. WAVE 1 — LAWFUL STREAM DISCOVERY
==================================================

## 1.1 Radio Browser API (primary discovery index)
Docs: https://docs.radio-browser.info/
Server discovery: DNS `all.api.radio-browser.info` (or SRV `_api._tcp.radio-browser.info`); do **not** hard-pin one mirror forever.
Example mirrors: `https://de1.api.radio-browser.info`, `https://nl1.api.radio-browser.info`
Auth: none. Always send descriptive `User-Agent: WarRoomMedia/<ver>`.

Key endpoints (JSON):
| Purpose | Path |
|---|---|
| Advanced search | `GET /json/stations/search?...` |
| By state | `GET /json/stations/bystateexact/{state}` or search `state=&stateExact=true` |
| By country | `GET /json/stations/bycountrycodeexact/US` |
| By name | `GET /json/stations/byname/{term}` |
| By UUID | `GET /json/stations/byuuid/{uuid}` |
| Click (popularity) | `GET /json/url/{stationuuid}` — call when user plays |
| Servers list | `GET /json/servers` |
| Stats | `GET /json/stats` |

Useful search params: `countrycode`, `state`, `stateExact`, `name`, `tag`, `tagList`, `codec`, `bitrateMin`, `is_https`, `has_geo_info`, `hidebroken=true`, `order`, `limit`, `offset`.

**Lawful use rule:** Radio Browser is a **community index**. Treat `url` / `url_resolved` as **candidates**. Before STREAM_ONLY pin:
1. Prefer URL published on station **official** listen page / Icecast status / StreamGuys status.
2. Confirm GET returns audio/* (range or first few KB).
3. Record provenance: `source=radio-browser|official`, homepage, lastVerified.
4. Use `stationuuid` (not numeric id) for favorites.

Ohio discovery examples (live 2026-09-17):
```
https://de1.api.radio-browser.info/json/stations/search?countrycode=US&state=Ohio&stateExact=true&hidebroken=true&limit=5000
https://de1.api.radio-browser.info/json/stations/search?countrycode=US&name=WAPS&hidebroken=true
```
Observed: Ohio `stateExact=true` → **75** stations; `state=Ohio` contains → **97**.

## 1.2 Station official pages (gold for STREAM_ONLY)
Pattern: open `{callsign} listen` / `/listen-live` / Ideastream “Streaming Media Players” links / public Icecast `status.xsl`.
Examples:
- Ideastream listen hub: https://www.ideastream.org/listen-online
- WOSU listen: https://www.wosu.org/listen-live (+ Icecast https://wosu.streamguys1.com/status.xsl)
- WJCU listen: https://www.wjcu.org/listen (publishes AAC/MP3 mounts)
- WAPS / The Summit: https://thesummit.fm/ (stream worldwide; official app)
- Cincinnati Public Radio: https://cinradio.org/listen/
- WCBE: https://www.wcbe.org/listen
- WVXU ways to listen: https://www.wvxu.org/ways-to-listen
- WYSO: https://www.wyso.org/

## 1.3 Public Icecast / Xiph directories
- Human directory: https://dir.xiph.org/
- Machine XML (heavy — cache, do not hammer): http://dir.xiph.org/yp.xml
- YP docs: https://www.icecast.org/docs/icecast-latest/yp/
- Experimental JSON historically unstable — prefer Radio Browser + official mounts over experimental Xiph JSON for shipping.

## 1.4 Global free catalogs (lawful indexes, not scrapers)
| Catalog | URL / API | Notes |
|---|---|---|
| Radio Browser | https://docs.radio-browser.info/ | ~63k stations (mirror-dependent); best general API |
| IPRD (International Public Radio Directory) | https://iprd-org.github.io/iprd/ | Curated public-radio M3U; catalog https://iprd-org.github.io/iprd/site_data/metadata/catalog.json ; by-country https://iprd-org.github.io/iprd/site_data/by_country/us.m3u ; all https://iprd-org.github.io/iprd/site_data/all_stations.m3u ; GitHub https://github.com/iprd-org/iprd |
| Xiph Icecast YP | http://dir.xiph.org/yp.xml | Public Icecast listings; cache |
| Station-official StreamGuys / Tritons / Creek / SecureNetSystems status pages | per-station | Best STREAM_ONLY confirmation |

## 1.5 Explicit REFUSE (Wave 1)
- TuneIn / iHeart / proprietary app **scrape** or unofficial private APIs for ingest
- Broadcastify scrape for in-app scanner playback (LINK_OUT viewer OK)
- Pirate / unauthorized re-encodes of commercial streams
- Encrypted public-safety intercept
- Pinning dead or mislabeled legacy Ideastream WCPN URL as news

==================================================
2. WAVE 2 — OHIO DENSIFY (beyond ~10 UI presets)
==================================================

UI context: Radio tab shows ~10 Ohio stations; WAPS 91.3 The Summit = VERIFIED PAUSED.
Goal: densify Akron / Cleveland / Columbus NPR, AM news/talk, campus, classical/jazz, sports — with **public** URL patterns.

### 2.1 GET-probed 2026-09-17 ET (research health; progressive GET)
| Station | Candidate URL | GET | Content-Type | Class note |
|---|---|---|---|---|
| WAPS Summit | `http://streamer2.legatocommunications.com/wapshq` | 200 | audio/mpeg | STREAM_ONLY candidate (RB+probe; confirm on thesummit.fm) |
| WKSU HD1 AAC | `http://stream.wksu.org/wksu1-64.aac` | 200 | audio/aac | STREAM_ONLY |
| WKSU Classical HD3 | `https://stream.wksu.org/wksu3.mp3.128` | 200 | audio/mpeg | STREAM_ONLY |
| WKSU News & More HD4 | `https://live.ideastream.org/wksu4.128.mp3` | 200 | audio/mpeg | STREAM_ONLY |
| WCLV (legacy host) | `http://audio1.ideastream.org/wclv.mp3` | 200 | audio/mpeg | Prefer `https://live.ideastream.org/wclv.aac` from RB |
| WCPN legacy | `http://audio1.ideastream.org/wcpn128.mp3` | 200 | audio/mpeg | **NEVER PIN** — prior Pass3 dead; content suspect |
| WJCU MP3 | `http://streaming.jcu.edu:8000/wjcu-mp3-hi` | 200 | audio/mpeg | STREAM_ONLY (official listen page) |
| WOSU NPR 128 | `https://wosu.streamguys1.com/NPR_128` | 200 | audio/aacp | STREAM_ONLY (status.xsl public) |
| WOSA Classical 128 | `https://wosu.streamguys1.com/Classical_128` | 200 | audio/aacp | STREAM_ONLY |
| WGUC | `https://stream.cinradio.org/wguc` | 200 | audio/mpeg | STREAM_ONLY |
| 97.1 The Fan | `https://radiohio.streamguys1.com/cols/wbnsfm.mp3` | 200 | audio/mpeg | STREAM_ONLY candidate |
| WMMS iHeart | `https://stream.revma.ihrhls.com/zc1741` | 302 | (redirect) | PARTIAL — HLS/CORS; mpv/link-out |
| WOBN Otterbein | `https://wobn.stream.creek.org/LIVE` | 200 | audio/mpeg | STREAM_ONLY campus |

### 2.2 Ohio densify table (call signs + public patterns)
**Northeast Ohio / Akron–Cleveland**
| Call / Brand | Role | Official / public pattern | Matrix |
|---|---|---|---|
| WAPS 91.3 The Summit | AAA / community | `http://streamer2.legatocommunications.com/wapshq` ; homepage https://thesummit.fm/ | READY |
| WKSU 89.7 | NPR news | `http://stream.wksu.org/wksu1-64.aac` ; https://www.ideastream.org/listen-online | READY |
| WKSU HD2 Folk Alley | Folk | `https://freshgrass.streamguys1.com/...` via folkalley.com (RB lists irish/classic/freshcuts mounts) | READY / PARTIAL (pick official Folk Alley page) |
| WKSU HD3 All Classical | Classical | `https://stream.wksu.org/wksu3.mp3.128` | READY |
| WKSU HD4 News & More | News mix | `https://live.ideastream.org/wksu4.128.mp3` | READY |
| WCLV 90.3 | Classical | Prefer `https://live.ideastream.org/wclv.aac` | READY |
| JazzNEO | Jazz | Ideastream listen hub / jazzneo.org (pin only after official mount confirmed) | PARTIAL |
| WJCU 88.7 | Campus | `http://streaming.jcu.edu:8000/wjcu-mp3-hi` or `.../wjcu-aac-hi` ; https://www.wjcu.org/listen | READY |
| WTAM 1100 | AM news | iHeart `https://stream.revma.ihrhls.com/zc1749` ; https://wtam.iheart.com/ | PARTIAL |
| WMMS 100.7 | Rock | `https://stream.revma.ihrhls.com/zc1741` ; https://wmms.iheart.com/ | PARTIAL |
| WNIR 100.1 | Talk | StreamTheWorld `.../WNIRFMAAC_SC` ; http://wnir.com/ | PARTIAL |
| WKNR 850 | Sports | RB: `http://stream.abacast.net/direct/goodkarma-wknrammp3-ibc2` — verify on station site before SHIP | HOLD |

**Columbus / Central**
| Call / Brand | Role | Pattern | Matrix |
|---|---|---|---|
| WOSU 89.7 NPR | NPR news | `https://wosu.streamguys1.com/NPR_128` (also NPR_64, NPR_256); .m3u from https://www.wosu.org/listen-live | READY |
| WOSA Classical 101 | Classical | `https://wosu.streamguys1.com/Classical_128` | READY |
| WCBE 90.5 | NPR / public | StreamTheWorld `WCBEFM` redirect or `_SC` ; https://www.wcbe.org/listen | PARTIAL→READY after official confirm |
| WBNS-FM 97.1 The Fan | Sports | `https://radiohio.streamguys1.com/cols/wbnsfm.mp3` | READY |
| WOBN Otterbein | Campus | `https://wobn.stream.creek.org/LIVE` | READY |

**Cincinnati / SW / Dayton / Athens / Toledo**
| Call / Brand | Role | Pattern | Matrix |
|---|---|---|---|
| WVXU 91.7 | NPR | `https://stream.cinradio.org/wvxu` | READY |
| WGUC 90.9 | Classical | `https://stream.cinradio.org/wguc` (also cpr2.streamguys.net/wguc in RB) | READY |
| WYSO 91.3 | NPR Yellow Springs | StreamTheWorld `WYSOFM_SC` ; https://www.wyso.org/ | PARTIAL |
| WOUB-FM / AM | Athens NPR | StreamTheWorld `WOUBFM_SC` / `WOUBAM_SC` ; https://woub.org/ | PARTIAL |
| WGTE-FM | Toledo NPR | StreamTheWorld `WGTEFM_SC` ; https://www.wgte.org/ | PARTIAL |

### 2.3 Official stream URL host patterns (public)
| Host pattern | Typical use |
|---|---|
| `*.streamguys1.com/{mount}` | Public/NPR Icecast (WOSU, Folk Alley, RadioOhio, Browns net) |
| `stream.wksu.org/wksu{N}-64.aac` / `wksu{N}.mp3.128` | Ideastream WKSU channels |
| `live.ideastream.org/{channel}` | Ideastream live CDN |
| `streaming.jcu.edu:8000/wjcu-*` | WJCU Icecast |
| `streamer2.legatocommunications.com/wapshq` | WAPS |
| `stream.cinradio.org/{wvxu\|wguc}` | Cincinnati Public Radio |
| `*.streamtheworld.com/.../{CALL}FM_SC` or `livestream-redirect/{CALL}FM.mp3` | Many pub/comm stations |
| `stream.revma.ihrhls.com/zc{id}` | iHeart progressive/HLS — PARTIAL |
| `ice*.securenetsystems.net/{CALL}` | Many regional commercial |
| `*.stream.creek.org/LIVE` | Campus (WOBN) |

==================================================
3. US-50 COVERAGE PATTERN (scope expand)
==================================================

### 3.1 Discovery algorithm (lawful, not “100% Earth”)
For each of the 50 states (+ DC as special):
1. **Index pass:** Radio Browser
   `GET /json/stations/search?countrycode=US&state={StateName}&stateExact=true&hidebroken=true&limit=5000`
2. **Messy-tag pass:** many US rows have blank/city/typo `state` (of ~8185 US stations in RB stats, only ~2962 hit clean stateExact names in this research pass). Supplement with:
   - `tag={state}` / metro tags
   - `name={callsign}` when known
   - IPRD `by_country/us.m3u` for public-radio subset
3. **Official verify pass:** homepage listen link → pin STREAM_ONLY only if GET-audio OK
4. **Commercial / iHeart / Tritons:** default PARTIAL (play if CORS allows) else LINK_OUT
5. **Scorecard:** count READY / PARTIAL / HOLD / UNFILLABLE — **never claim 100% Earth or 100% US dial**

### 3.2 Radio Browser stateExact snapshot (2026-09-17, hidebroken=true)
All **50 states ≥5** stations (discovery READY for densify). DC `District of Columbia` stateExact = **0** (use name/tag/city).

| State | Count | State | Count |
|---|---:|---|---:|
| Alabama | 64 | Montana | 18 |
| Alaska | 34 | Nebraska | 9 |
| Arizona | 42 | Nevada | 24 |
| Arkansas | 18 | New Hampshire | 10 |
| California | 445 | New Jersey | 40 |
| Colorado | 59 | New Mexico | 34 |
| Connecticut | 24 | New York | 250 |
| Delaware | 17 | North Carolina | 80 |
| Florida | 178 | North Dakota | 18 |
| Georgia | 31 | **Ohio** | **75** |
| Hawaii | 21 | Oklahoma | 12 |
| Idaho | 23 | Oregon | 55 |
| Illinois | 97 | Pennsylvania | 119 |
| Indiana | 46 | Rhode Island | 6 |
| Iowa | 27 | South Carolina | 26 |
| Kansas | 23 | South Dakota | 12 |
| Kentucky | 29 | Tennessee | 81 |
| Louisiana | 46 | Texas | 150 |
| Maine | 17 | Utah | 56 |
| Maryland | 41 | Vermont | 16 |
| Massachusetts | 50 | Virginia | 129 |
| Michigan | 59 | Washington | 98 |
| Minnesota | 88 | West Virginia | 18 |
| Mississippi | 27 | Wisconsin | 58 |
| Missouri | 56 | Wyoming | 6 |
| District of Columbia | 0 | | |

US-50 matrix (index layer only):
- **READY** (index): 50/50 states have ≥5 RB stateExact hits
- **PARTIAL**: DC + any station whose only URL is iHeart/app-gated
- **HOLD**: call signs without official stream documented
- **UNFILLABLE**: no lawful public stream (encrypted/geo-blocked/ToS-forbid embed) — LINK_OUT or omit

Ship order recommendation: Ohio densify first → contiguous Great Lakes/PA/KY/IN → then remaining states by commander priority — not fake global completeness.

==================================================
4. CONTINENTAL CATALOGS (AF/AS/EU/NA/SA/OC/AN)
==================================================

Radio Browser countrycode rollup (2026-09-17, approximate continent buckets; **OTHER** = codes not in static ISO sets / territories):

| Continent | Countries in bucket | Station rows (approx) | Catalog approach |
|---|---:|---:|---|
| **EU** Europe | 46 | ~31,229 | RB `countrycode` + IPRD country M3Us; public broadcasters (BBC, DLF, RAI…) prefer official |
| **NA** North America | 24 | ~13,397 | RB + US-50 pattern + Canada/Mexico official |
| **AS** Asia | 49 | ~9,261 | RB; verify official; respect geo/licensing |
| **SA** South America | 12 | ~5,365 | RB; many Icecast/Shoutcast public mounts |
| **OC** Oceania | 19 | ~2,448 | RB; AU/NZ public ABC/RNZ official first |
| **AF** Africa | 54 | ~1,606 | RB; thinner coverage — PARTIAL expected |
| **AN** Antarctica | 1 | ~11 | Novelty / research only; HOLD for product |
| OTHER | 38 | ~486 | Review case-by-case |

**Total ~63.8k** station rows across countrycodes — **not** “every station on Earth.” Many are duplicates, broken-but-not-yet-hidden, or non-official mirrors.

Continental densify pattern:
1. RB `bycountrycodeexact/{CC}` with `hidebroken=true`
2. IPRD `by_country/{cc}.m3u` when public-radio focused
3. Official public-broadcaster hubs (BBC Sounds link-out if ToS requires; DLF/France Inter/NPR member stations when mounts public)
4. Score READY only after GET + official provenance

**Scorecard honesty:** Earth coverage = **PARTIAL**. EU/NA densest; AF/AN sparse; AN effectively non-product. Never ship a “100% Earth” badge.

==================================================
5. MATRIX SUMMARY (Wave 1+2)
==================================================

| Capability | Status | Notes |
|---|---|---|
| Lawful discovery (Radio Browser) | **READY** | Documented free API + User-Agent |
| Official page / Icecast verify | **READY** | Pattern established |
| Xiph YP XML | **PARTIAL** | Cache; heavy; secondary |
| IPRD global public radio | **PARTIAL** | Good M3U/JSON; cache GitHub Pages |
| Ohio densify beyond 10 | **READY** (core NPR/campus) / **PARTIAL** (iHeart/STW) / **HOLD** (WKNR) | See §2 |
| US-50 index densify | **READY** index / **PARTIAL** verified pins | 50 states ≥5 RB; DC HOLD on stateExact |
| Continental catalogs | **PARTIAL** | EU/NA strong; AF/AN weak |
| 100% Earth radio | **UNFILLABLE** | Refuse fake completeness claim |
| Pirate / scraped proprietary apps | **REFUSE** | Hard rule |
| TuneIn/Broadcastify ingest | **REFUSE** | LINK_OUT only for scanners |

==================================================
6. WAVES 3–8 STUBS (outline only — next research packs)
==================================================

### Wave 3 — Local news RSS (Ohio-first → US metros)
- Ideastream / WKSU news RSS from official sites
- Beacon Journal / cleveland.com (check ToS; prefer official RSS)
- Columbus Dispatch / Cincinnati Enquirer — LINK_OUT if full-text blocked
- Statehouse / AP member feeds only if licensed or official public RSS
- Schema: title, url, source, published, region, licenseClass
- Matrix stub: PARTIAL (RSS list) / HOLD (paywalled)

### Wave 4 — Global news
- Lawful: BBC World Service radio stream (official), Reuters/AP **public** pages, NPR Hourly (if stream/RSS official)
- REFUSE: scrape paywalled bodies; no Google News HTML scrape as owned content
- Cross-link Council “SEND TO COUNCIL” with citation URL only

### Wave 5 — Weather
- NWS CAP: `https://api.weather.gov/alerts/active?area={ST}` (User-Agent required)
- Forecast: `api.weather.gov` points/grid (already War Room adjacent)
- Mesonet/IEM radar: LINK/embed only per IEM terms (UI already notes available)
- NOAA Weather Radio streams: HOLD until lawful stream verified per market
- Alert ducking: OFF by default (UI); duck only Severe/Extreme when enabled

### Wave 6 — Podcasts
- Prefer official RSS 2.0 / Podcast Index / Apple podcast RSS **as published by show**
- Ideastream / WOSU / NPR show feeds from station sites
- Playback: STREAM_ONLY episode enclosures; no archive redistribute
- Saved tab: local favorites metadata only

### Wave 7 — Emergency
- NWS CAP + IPAWS/WEA is receive-only (no fake alert generation)
- County EMA / Ready.gov LINK_OUT
- EAS audio: HOLD — only if agency-published stream
- Scanner: LINK_OUT Broadcastify viewer; REFUSE encrypted PS

### Wave 8 — UX densify
- Tabs: Radio | News | Weather | Podcasts | Saved (match screenshot)
- Buttons: GO TO INTEL | SOURCE | OPEN OFFICIAL SITE | SEND TO COUNCIL
- Provenance chip on every preset (provider, licenseClass, lastVerified)
- Health: GET probe on select; mark stale if fail
- Alert ducking toggle; Mesonet/IEM radar affordance
- Keep Terra God’s Eye separate (ACTIVE WITH GAPS is Terra debt — do not merge Media into globe)

==================================================
7. ACCEPTANCE TESTS (research → later build)
==================================================
1. WAPS plays from Legato URL or official page mount; paused state restores
2. WKSU / WOSU / WJCU progressive GET plays without scrape
3. Dead/mislabeled WCPN legacy never appears as SHIP
4. iHeart stations either play via HLS/mpv or LINK_OUT — never scraped
5. US-50 densify UI can list ≥1 READY or PARTIAL per state from RB index (except honest HOLD for gaps)
6. Continent browser shows AF…AN with real counts — no “100% Earth”
7. CAP duck only Severe/Extreme when toggle ON
8. No TuneIn/Broadcastify ingest code paths

==================================================
8. OPEN DECISIONS FOR MARK
==================================================
1. Pin WAPS Legato URL as SHIP now, or wait for HTTPS official mount?
2. iHeart: PARTIAL in-player vs LINK_OUT only?
3. US-50 ship cadence: Ohio-only v1 vs all-50 index with lazy verify?
4. Continental: browse-all continents in v1 or NA+EU first?
5. WKNR: chase official Good Karma stream page or keep HOLD?

---
End Wave 1+2 research. Next: Wave 3 local news RSS densify pack (separate file) when commanded.
