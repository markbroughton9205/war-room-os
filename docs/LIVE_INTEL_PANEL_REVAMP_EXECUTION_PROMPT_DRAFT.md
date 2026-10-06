# LIVE INTEL PANEL REVAMP — EXECUTION PROMPT (DRAFT)
# Commander: Mark | Personal Assistant | awaiting War Room Research FINAL
# Paste into ChatGPT/Cursor after FINAL stamp. Do NOT implement until Commander says go.
# Aligns with TERRA_GAPS_CURRENT_DELTA_EXECUTION.md — Live Intel UX is PARTIAL; auth split already ACTIVE.

## Mission
Revamp Terra Live Intel into a futuristic War Room **global news station** HUD:
- Future / ops-center look (not a flat list)
- Hover → mute autoplay video clip OR still image (NO sound)
- Continuous live feeds; provenance; original language first
- SEND TO COUNCIL preserved (Observed Data | Council Analysis | Commander Annotation)
- Globe stays hero — panel is compact; glance → hover → inspect → expand

## Current baseline (do not regress)
- Live Intel panel exists with categories: EARTH / LOCAL / HEADLINES / BREAKING / EVENTS / CONFLICT
- Status line: PUBLIC INTEL ACTIVE — protected sources need Commander session
- World time / scope footer present
- Three-way auth: PUBLIC / PROVIDER_AUTH / COMMANDER_PRIVATE = ACTIVE
- Do NOT reintroduce Commander-session gate on public Earth feeds

## Research questions (swarm filling)
1. Best HUD card patterns for war-room news walls
2. Lawful mute preview sources (official embeds, provider posters, YouTube mute if ToS OK)
3. Schema fields for mediaPreviewUrl / mediaPreviewType / posterUrl
4. Performance: only hovered row plays; teardown on mouseleave
5. Council packet with media provenance

## Refuse
- Scraping news HTML for video files
- Autoplay with sound
- Fake thumbnails / invented clips
- Huge permanent sidebar that buries the globe
- Playing protected/PROVIDER_AUTH media without proper auth
- Merging Media Player radio module into Live Intel (separate tracks)

## Proposed phases (DRAFT — swarm may revise)
0. Recon current Live Intel components + item schema — return file map then STOP if asked
1. Visual system: card chrome, density, category chips, severity accents
2. Preview layer: poster stills first; mute video only when lawful URL exists
3. Interaction: hover play/pause; inspect drawer; pin; SEND TO COUNCIL
4. Perf/a11y: one active preview; reduced-motion = stills only
5. Acceptance tests + screenshots

## Return first (when implementing later)
LIVE_INTEL_RECON =
CURRENT_COMPONENTS =
SCHEMA_GAPS =
LAWFUL_PREVIEW_OPTIONS =
BEST_PATH =
REFUSE =
PROPOSED_FILES =
RISKS =

Then STOP until Commander authorizes implementation.
