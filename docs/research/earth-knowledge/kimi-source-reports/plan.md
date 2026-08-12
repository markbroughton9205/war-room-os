# War Room OS — African Research Data-Source Discovery: Execution Plan

## Goal
Deliver a verified MASTER API REGISTRY of machine-accessible data sources (APIs, datasets, archives, knowledge graphs, OAI-PMH, IIIF, bulk downloads) covering African history, human origins, archaeology, genetics, museums, governments, economics, maps, academic literature, diaspora/slave trade. NOT a history report.

## Rules (from mission brief)
- Never invent APIs/endpoints/keys. Verify operational as of 2026; mark DISCONTINUED + replacement.
- Distinguish access types: API / DATASET / BULK DOWNLOAD / SEARCH INTERFACE / DIGITAL ARCHIVE / KNOWLEDGE GRAPH / IIIF / OAI-PMH.
- Each source must answer the 24-field schema (name, org, URLs, endpoint, coverage, auth, cost, rate limits, protocol, formats, license, commercial use, bulk, full-text vs metadata, authority, integration difficulty, WAR_ROOM env var name, example request, limitations).
- Prioritize programmatic queryability; prioritize African-primary-perspective sources.

## Stage 1 — Parallel Research (8 explore subagents, background, custom role `africa_datasource_hunter`)
- Agent 1: Tier 2 — Human origins / paleoanthropology / ancient DNA / population genetics / radiocarbon / paleoclimate
- Agent 2: Tier 3a — Ancient & precolonial African civilizations primary sources (Egypt, Nubia, Aksum, West African empires, manuscripts: Timbuktu, Endangered Archives, etc.)
- Agent 3: Tier 3b/9 — African diaspora, trans-Atlantic slave trade (SlaveVoyages etc.), colonization & independence archives, oral history
- Agent 4: Tier 4 — Museums, archives, manuscript collections, IIIF, OAI-PMH, digital libraries (incl. African institutions)
- Agent 5: Tier 5 — African governments, African Union, national statistics offices, elections, conflict data (ACLED, V-Dem, etc.)
- Agent 6: Tier 6 — Economics/population/development/trade (World Bank, AfDB, UN, IMF, ITC, etc.)
- Agent 7: Tier 7 — Maps/GIS/environment + Tier 10 specialized/rare sources + GitHub datasets + Internet Archive + digitized newspapers
- Agent 8: Tier 8 — Academic literature + knowledge graphs (Wikidata, OpenAlex, CORE, etc.) + Tier 1 candidate synthesis

Each agent returns sources in the 24-field schema, marked by access type, verified-live as of 2026.

## Stage 2 — Cross-validation & Integration (orchestrator + 1 verifier subagent)
- Merge all findings, dedupe, flag unverified entries, check discontinued claims.
- Build tiered registry + MASTER API REGISTRY table + sections A–J (top 25, signup links, no-key list, bulk, primary sources, semantic querying, overlap, integration order, gaps).

## Stage 3 — Deliverable
- Write final registry to /mnt/agents/output/war_room_africa_api_registry.md (+ xlsx master table if useful).
