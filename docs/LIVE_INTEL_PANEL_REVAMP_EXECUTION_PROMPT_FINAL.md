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
