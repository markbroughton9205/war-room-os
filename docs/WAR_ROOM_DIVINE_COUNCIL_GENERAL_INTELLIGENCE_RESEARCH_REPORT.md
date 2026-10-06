# WAR ROOM / DIVINE COUNCIL — GENERAL MULTIMODAL INTELLIGENCE RESEARCH REPORT
**Commander:** Mark | **Date:** 2026-09-22 (America/New_York, ET) | **Mode:** RESEARCH ONLY  
**Hard stop:** No code / build / commit / push / deploy  
**Canonical:** `/home/box/divine-council-general-intel/WAR_ROOM_DIVINE_COUNCIL_GENERAL_INTELLIGENCE_RESEARCH_REPORT.md`  
**Extends:** EBC (`war-room-council-intel`) · Foundry SE (`foundry-standalone-engineer`) · HVS / Media / Terra boundaries  
**Labels:** VERIFIED FACT | RESEARCH FINDING | INFERENCE | RECOMMENDATION  
**Locks:** No Council2/Browser2/Foundry2/duplicate memory or tool registry · Capability ≠ authority · Seat ≠ provider · Casual chat ≠ full Council mission · No fake LISTENING · HVS ≠ Media Player ≠ Terra ≠ Council  

**Architecture one-liner:** Divine Council GMII = Short-path conversational front door + Evidence-Board Council mission brain + multimodal I/O envelopes + typed handoffs to Browser/Foundry/Terra/HVS/Media — on **one** authority / tool-registry / memory spine.

---

## 1. Executive findings

1. **Product:** Divine Council should become War Room’s **General Multimodal Intelligence Interface (GMII)** — natural conversation, tool use, multimodal ingest/output, research, artifacts, connectors, durable missions — **without** abandoning Evidence-Board Council (EBC). (RECOMMENDATION)
2. **Preserve EBC pipeline:** classify → conditional workers → append-only evidence board → LUMEN → PHOENIX → AURORA; substrate graph/state-machine class. (VERIFIED FACT — prior EBC report)
3. **Add PathClassifier:** SHORT_PATH vs AGENT_PATH vs HANDOFF. Casual chat must not spawn six agents. (RECOMMENDATION; aligns SOCIAL_CHECKIN + Anthropic scale-to-complexity)
4. **Module boundaries hold:** Council ≠ Foundry ≠ Browser Broker ≠ Terra ≠ Media Player ≠ HVS. Extend with envelopes/handoffs — never duplicate stacks. (VERIFIED FACT — WR doctrine + HVS/Foundry reports)
5. **MultimodalEvidence + MultimodalEnvelope** are the integration joints; Media gen plane ≠ HVS NLE ≠ Media Player. (RECOMMENDATION)
6. **Capability ≠ authority** extends to email.send, computer_use, foundry.patch, hvs.render, payments. (RECOMMENDATION)
7. **Voice:** realtime APIs exist (OpenAI Realtime; Gemini Live) but **LISTENING UI requires capture_truth**. (RESEARCH FINDING + HARD LOCK)
8. **Eval:** WR-owned General Assistant Eval is primary; GAIA/WebArena/OSWorld/SWE-* are regression/reference only. (RECOMMENDATION)
9. **Foundation before features:** PathClassifier, envelopes, authority matrix, registry namespace extension, board kinds, short-path, ingest, observability, handoff contracts, eval harness. (RECOMMENDATION)
10. **First eng mission:** PathClassifier + SHORT_PATH + MultimodalEnvelope(+capture_truth) + Authority stubs + fixtures — not computer-use, not HVS, not connector sprawl. (RECOMMENDATION)

---

## 2. Product definition

**Divine Council GMII** is the Commander’s persistent multi-agent command room elevated to a general intelligence interface: talk, attach files/images/audio/video, get short answers or verified multi-agent briefs, hand work to specialist WR modules, track durable missions.

| It is | It is not |
|---|---|
| Front door + EBC brain + handoffs | Chatbot-only wrapper |
| Multimodal + tools + missions | Personality panel theatre |
| Extension of WR modules | Council2 / Browser2 / Foundry2 |
| Advisory for Act | Autonomous Commander replacement |

Label: **RECOMMENDATION** (product), grounded in Commander MISSION_BRIEF (**VERIFIED FACT** intent).

---

## 3. Current War Room capability map

| Surface | Present (audit/research) | Maturity note |
|---|---|---|
| Council seats / continuity routing | Yes — seat≠backing doctrine | VERIFIED FACT docs |
| Adaptive assembly / classify | Partial — advisory presets risk | EBC diagnoses failure |
| Evidence-Board Council | Research-complete; implement HOLD | Prior report |
| Browser Broker | Research/fetch path | Extend, don’t fork |
| Foundry Engineering Core | Typed actions, gated repair, completion truth culture | SE gaps P0 organizational |
| Terra world-state | Observed Data plane | Council must not absorb |
| Media Player | Playback/densify | ≠ HVS |
| HVS | NLE/creative research architecture | Callable studio |
| Local models (Ollama path) | Local text path | Multimodal local incomplete |
| Tool authority matrix | Capability≠authority doctrine | Must extend modalities |
| Unified multimodal envelopes | **Missing** | Gap |
| Short-path GMII lane | Partial via SOCIAL_CHECKIN only | Gap |
| Realtime voice w/ capture_truth | **Missing / unsafe if faked** | Gap |
| Artifact workspace | Incomplete vs Canvas-class | Gap |
| MCP into WR registry | Not proven as unified | Gap |
| Mission Center projection | Incomplete | Gap |

Nebula live runtime not re-probed this mission; box research uses prior reports + audit docs. Label gaps **INFERENCE** where live process absent.

---

## 4. Gap analysis vs general multimodal assistants

Public GMII expectations (ChatGPT/Claude/Gemini-class) vs WR:

| Capability cluster | Public bar | WR gap |
|---|---|---|
| Natural chat | Default | Need SHORT_PATH first-class |
| Tools | Function calling / MCP | Extend registry + policy |
| Vision/files | Attach & reason | Envelope + ingest |
| Voice | Realtime S2S | Capture truth + provider |
| Artifacts | Canvas | Artifact service |
| Deep research | Multi-agent browse | EBC + Broker |
| Computer use | OSWorld-hard | Late, sandboxed |
| Coding | IDE agents | **Foundry owns** |
| Connectors | Email/calendar | MCP + OAuth + authority |
| Memory | Personalization | Tiered spine, no Memory2 |

**INFERENCE:** Closing gaps by cloning a single vendor assistant would violate sovereignty and module ownership. Close via WR architecture.

---

## 5. Conversation architecture

```
Turn
 └─ PathClassifier (rules first; LLM only if ambiguous)
      ├─ SHORT_PATH: one backing model (± light tools); stream reply
      ├─ AGENT_PATH: EBC AssemblyPlan → board → verify → synthesize
      └─ HANDOFF: typed ModuleCallContract → Foundry|Browser|Terra|HVS|Media
```

**Rules (RECOMMENDATION):**
- Greetings / trivial QA → SHORT_PATH (EBC SOCIAL_CHECKIN generalization).
- “Status of X” operational → AGENT_PATH SYSTEM_STATUS min roster + probes.
- “Build/fix code” → HANDOFF Foundry (Council may AGENT_PATH analyze first).
- “Edit this timeline professionally” → HANDOFF HVS.
- Peer chat among seats is **not** the coordination medium (EBC lock).

Refs: Anthropic multi-agent research (scale effort); OpenAI agents-as-tools (manager retains control); EBC §7.

---

## 6. Reasoning and Q&A (short-path vs agent-path)

| Mode | When | Mechanism | Fail closed |
|---|---|---|---|
| Short-path reason | Non-critical, no live ops claim | Model ± ReAct tools | No CURRENT_LIVE READY without tool |
| Agent-path reason | Contested, multi-source, ops, research | EBC board + LUMEN/PHOENIX | Typed completion_state |
| Tool-backed QA | Facts needing fetch/file | ReAct / tool calls | TOOL_BLOCKED ≠ invent |

**VERIFIED FACT:** ReAct interleaves reasoning and acting (Yao et al., arXiv:2210.03629).  
**VERIFIED FACT:** Unguided multi-agent debate amplifies sycophancy; EBC hides peers Round-1.  
**RECOMMENDATION:** Short-path may use tools; it must not impersonate full Council verification UX.

---

## 7. Writing and editing

| Dimension | Spec |
|---|---|
| Use case | Drafts, rewrite, briefs, structured docs |
| Component | ShortPathWriter + ArtifactVersioning; AGENT_PATH if claims need verify |
| I/O | prompt+refs → ArtifactRef |
| Owner module | Council (compose) / Artifact service (store) |
| Models/tools | text LLMs; linters/schema optional |
| Storage | artifact blob + versions |
| Permissions | sandbox write; publish gated |
| Provenance | model, params, parent_id, timestamp |
| Failures | POLICY_REFUSED; BUDGET_EXHAUSTED |
| Local/cloud | both, labeled |
| OSS candidates | markdown toolchain; pandoc later |
| Eval | instruction fidelity; no silent fact invent on documented sources |
| Deps | §5 PathClassifier, §17 Artifacts |
| Priority | P1 |

---

## 8. Coding via Foundry handoff

| Dimension | Spec |
|---|---|
| Use case | Implement/repair/verify software |
| Component | `FoundryMissionHandoff` envelope from Council |
| I/O | goal, acceptance stubs, constraints, evidence_ids → Foundry Mission Contract |
| Owner | **Foundry** executes; Council analyzes/advises |
| Models/tools | Foundry Engineering Core ACI (SWE-agent lesson: interface > persona) |
| Storage | Foundry mission event log |
| Permissions | Council **cannot** patch/push/deploy |
| Provenance | handoff_id links Council mission ↔ Foundry mission |
| Failures | HANDOFF_REJECTED; FOUNDRY_BLOCKED |
| Local/cloud | Foundry local-sovereign preference per SE report |
| OSS | OpenHands mechanisms steal-list for Foundry — not Council |
| Eval | dry-run handoff fixtures; SWE-bench is Foundry regression only |
| Deps | Foundry SE Phase A+; §39 contracts |
| Priority | P0 contract · Foundry build separate |

**No Foundry2.** (HARD LOCK)

---

## 9. Image understanding

| Dimension | Spec |
|---|---|
| Use case | Caption, OCR, UI screenshot QA, chart read |
| Component | VisionIngest → short-path or MultimodalEvidence |
| I/O | image blob → text claims + evidence pointer |
| Owner | Council ingest; Broker may attach screenshots; Terra frames stay Observed Data |
| Models/tools | cloud VLM / local VLM |
| Storage | blob + hash + mission link |
| Permissions | user-attached default; external upload policy |
| Provenance | mime, hash, model_id, retrieved_at |
| Failures | UNSUPPORTED_MIME; VISION_BLOCKED |
| Local/cloud | hybrid |
| OSS | open VLMs (quality gap honest) |
| Eval | fixture images; VisualWebArena later for broker |
| Deps | §37 envelopes |
| Priority | P0 envelope · P1 quality |

---

## 10. Image generation + Media / HVS boundaries

| Path | Owner | Notes |
|---|---|---|
| Casual image gen | Media generation plane (callable) | Provider APIs + provenance |
| Studio / timeline / Character Bible / STARRDOM | **HVS** | Not Council |
| Playback / densify | **Media Player** | Not HVS |
| Map imagery as world fact | **Terra Observed Data** | Council analysis separate |

**VERIFIED FACT (HVS locks):** HVS ≠ Media Player ≠ Terra.  
**RECOMMENDATION:** Council routes; never embeds NLE.

---

## 11. Audio, ASR, and diarization

| Dimension | Spec |
|---|---|
| Use case | Transcribe meetings, voice notes, diarize speakers |
| Component | AudioIngest → ASR (±diarization) → transcript evidence |
| I/O | audio → text (+speaker labels) |
| Owner | Council tools |
| Models/tools | Whisper-class; cloud ASR; pyannote-class diarization (license review) |
| Storage | audio blob + transcript artifact |
| Permissions | mic/file consent |
| Provenance | asr_model, confidences |
| Failures | NO_AUDIO; ASR_EMPTY |
| Local/cloud | local whisper viable; cloud for quality/latency |
| Eval | WER on fixtures; speaker count accuracy |
| Deps | §37, §12 |
| Priority | P1 |

---

## 12. Realtime voice architecture

**RESEARCH FINDING:** Production S2S options include OpenAI Realtime API (WebRTC/WebSocket/SIP; tool calling; MCP remote) and Gemini Live API (WebSocket; audio+image; functionDeclarations). Cascade pipelines (Pipecat-class) remain portable.

**RECOMMENDED WR shape:**
1. `VoiceSession` with `capture_truth ∈ {capturing, muted, permission_denied, device_unavailable, idle}`.
2. Provider adapter behind WR session (do not hard-lock one vendor).
3. Tools invoked from voice still hit **AuthorityMatrix**.
4. Escalation to EBC converts voice turn → text mission packet (board remains text/structured).
5. **UI may show LISTENING only if capture_truth=capturing.**

Priority: P1 session+truth · P2 provider polish. Fake LISTENING = ship-blocker.

---

## 13. Video pipelines

Understand ≠ edit ≠ play.

| Stage | Owner |
|---|---|
| Sample frames / clip QA / ASR | Council multimodal |
| Long-form index | Large-file pipeline §15 |
| Professional edit / AI Director | HVS |
| Playback | Media Player |

OSWorld/VisualWebArena show multimodal GUI grounding remains difficult (**RESEARCH FINDING**). Do not claim general video-agent autonomy in V1.

Priority: P2 understand · HVS separate roadmap.

---

## 14. Document and file understanding

Ingest → MIME detect → parse → chunk → retrieve → answer with citations.  
Tools: `files.ingest`, `files.extract`, `files.retrieve`.  
Owner: Council. Storage: mission blobs + index.  
OSS: poppler, Tesseract, structured extractors. Providers: Document AI optional.  
Failures: ENCRYPTED_PDF; PARSE_FAIL → TOOL_BLOCKED.  
Priority: **P0** (core GMII).

---

## 15. Large-file architecture

Never load entire large binaries into context. Progressive: metadata → outline → targeted chunk retrieve → optional map-reduce summarize with evidence nodes.  
Quota + virus scan policy. Dedup by hash.  
Deps: §14. Priority: P1.

---

## 16. Data analysis (NOVA)

NOVA function: schema validate, tabular transforms, sandboxed code exec, chart artifacts.  
Not a substitute for Foundry on WR source.  
Eval: correct aggregates on fixtures; no invented cells (EBC NOVA fail mode).  
Priority: P1.

---

## 17. Artifact workspace

Versioned artifacts (markdown, code, table, image, chart) with draft/publish states, diffs, mission links.  
Canvas-like UX **without** second document SoT outside WR storage.  
Publish gated. Provenance mandatory.  
Priority: P1 (after short-path + envelopes).

---

## 18. Deep research and Browser Broker

**Extend Browser Broker — no Browser2.**

EBC DEEP_RESEARCH: orchestrator plans disjoint subquestions; PULSAR/ORION call `broker.*` in parallel hidden contexts; shared research packet once; LUMEN citation check; AURORA synthesizes board only.

**VERIFIED FACT:** Anthropic multi-agent research uses orchestrator–worker, parallel subagents, citation agent; token cost can be ~15× single agent — scale to complexity.  
**VERIFIED FACT:** GAIA stresses tool-use + multimodal assistant questions (arXiv:2311.12983). WebArena: long-horizon web tasks (ICLR 2024).  

Priority: P0 Broker wiring into EBC · quality continuous.

---

## 19. Computer and desktop use

| Plane | Owner | Authority |
|---|---|---|
| Web browse/research | Browser Broker | policy |
| Repo engineer ACI | Foundry | Foundry security model |
| General GUI desktop | Computer-Use Broker (future) | always ask + sandbox |

**VERIFIED FACT:** OSWorld — humans ~72%, early agents ~12% (NeurIPS 2024). Treat as late phase.  
**RECOMMENDATION:** Do not put unconstrained OS clicker on SHORT_PATH.

Priority: P3 general · P2 sandboxed preview for generated apps under Foundry.

---

## 20. MCP and connectors

MCP = open protocol to expose tools/data to models (**VERIFIED FACT** — Anthropic MCP).  
WR adaptation: MCP servers map into **existing** namespaced tool registry + AuthorityMatrix. **No ToolRegistry2.**  
Anthropic guidance: namespacing, clear descriptions, eval with realistic tasks (**RESEARCH FINDING**).

Priority: P2 read-only connectors after foundation; mutate later.

---

## 21. Email and messaging

Read threads: connector tools. Send/reply: `authority=ask` + audit log + idempotency key.  
Never auto-send because model “wanted to help.”  
Priority: P2.

---

## 22. Calendar

List/read free-busy early; create/modify events gated. Conflict checks return evidence.  
Priority: P2.

---

## 23. Durable tasks

FSM: `QUEUED|RUNNING|WAITING_AUTHORITY|BLOCKED|COMPLETED|FAILED|CANCELLED`.  
Heartbeat + resume (share patterns with Foundry persistent mission runtime — module-scoped).  
Council durable research ≠ Foundry engineering ownership.  
Priority: P1.

---

## 24. Mission Center

Projection UI/API across Council/Foundry/Browser/Terra/HVS missions: status, evidence pack, approve/deny, cancel.  
Not a new orchestrator kernel.  
Priority: P1 (depends §23).

---

## 25. Multi-agent EBC expansion (multimodal)

**Preserve EBC.** Add classes & evidence kinds (Wave 5). Conditional rosters remain mandatory — multimodal does not imply always-six.  
Worker tool allowlists include vision/file/broker as needed. AURORA still board-only.  
Priority: P0 design · implement after PathClassifier.

---

## 26. Model routing

Seat callsign = routing ID / UX identity. Provider = backing selected by router (modality, sovereignty, cost, latency).  
Health planes: entity ≠ backing ≠ cloud (**VERIFIED FACT** continuity doctrine).  
Degrade honestly. Priority: P1.

---

## 27. Memory architecture

One spine, tiers (working / mission board / episodic / knowledge) with temporal layers HISTORICAL|LAST_VERIFIED|CURRENT_LIVE (**VERIFIED FACT** EBC).  
Supersession + fail-closed release. **No Memory2 product.** Priority: P1.

---

## 28. Multimodal memory

Pointers + embeddings to blobs; transcripts as first-class text; images as evidence with hashes; retention policy.  
Poisoning defense: untrusted browse content labeled; never auto-promote to doctrine.  
Priority: P2 (after §27).

---

## 29. Knowledge and search

Hybrid retrieval over approved corpora + mission artifacts; live web via Broker for CURRENT_LIVE.  
Priority: P1.

---

## 30. Media generation plane

Provider router for image/audio/short AV gen callable from Council.  
Production → HVS; playback → Media. Provenance + ToS. Sora live status: do not claim without fresh verify (HVS flag).  
Priority: P2.

---

## 31. Finance / enterprise (architecture only)

Read-only analytics first. Any payment/trade/wire = hard deny or multi-party Commander authority. Audit everything.  
**No autonomous finance agent.** Priority: P3 architecture docs only for now.

---

## 32. Math

Prefer executable verification (code/CAS) → artifact evidence.  
Priority: P2.

---

## 33. STEM tools

Scientific calculators, unit converters, sandboxed notebooks — results as evidence. Domain experts not replaced.  
Priority: P2.

---

## 34. Natural-language tool routing

SHORT_PATH: native tool calling / ReAct with allowlist.  
AGENT_PATH: per-agent allowlists + board.  
MCP tools discoverable but policy-filtered (too many tools → confusion; Anthropic tool-design lessons).  
Priority: P0 with foundation.

---

## 35. Human response layer

Must emit: `completion_state`, labels, provenance summary, `path_used`, `capture_truth` if voice, `authority_decisions`, next_actions (advisory).  
Ban poetic READY lexicon (EBC). Priority: P0.

---

## 36. Authority and permissions model

```
AuthorityDecision { tool, resource, decision: auto|ask|deny, actor, reason, ts }
```
Capability registry row never implies auto. Commander policy is SoT for Act.  
Council advisory recommendations cannot self-approve.  
Priority: **P0**.

---

## 37. Multimodal I/O envelopes

Canonical `MultimodalEnvelope` (Wave 6). All turns validate schema. Attachments become evidence or short-path context with hashes.  
Priority: **P0**.

---

## 38. Room / session / mission data model

Room → Session(s) → Turns → ShortResult | Mission(EBC|Handoff) → Board/Artifacts/Telemetry.  
Supports multi-mission concurrency under one Council room.  
Priority: P0 model · P1 persistence.

---

## 39. Cross-module call contracts (provenance envelopes)

`ModuleCallContract`: target, payload schema, idempotency_key, authority_token_ref, expected_evidence_schema, timeout, non-ownership clause.  
Return: evidence records for Council board when appropriate — modules keep SoR.  
Priority: **P0**.

---

## 40. Observability

Spans: classify, route, model, tool, board_write, verify, handoff, voice_session.  
Dashboards: path mix, cost, tool_block rate, authority asks, fake-listen attempts (should be zero).  
Align OTel GenAI practices (**RESEARCH FINDING**). Priority: P1.

---

## 41. Local vs cloud strategy

Hybrid with honest labels. Local: text, ASR, embeddings, some vision. Cloud: frontier reasoners, realtime voice, strong VLMs.  
Sovereignty mode can force local-only with capability degradation states — never fake parity.  
Priority: P0 policy · continuous provider work.

---

## 42. OSS survey (candidates)

| Area | Candidates | Role |
|---|---|---|
| Orchestration patterns | LangGraph, AutoGen/MAF, MetaGPT | Steal mechanisms |
| Coding harness | SWE-agent, OpenHands | Foundry lessons |
| Voice pipeline | Pipecat | Cascade option |
| ASR | Whisper / faster-whisper | Local ASR |
| Diarization | pyannote | Optional |
| Docs | poppler, Tesseract | Ingest |
| Protocol | MCP | Connectors |
| Media/HVS | FFmpeg, OTIO | Not Council core |

Licenses reviewed before adopt (**Legal lock**).

---

## 43. Build vs adapt vs provider matrix

| Item | Decision |
|---|---|
| PathClassifier, envelopes, authority, board kinds, response layer, WR-GA Eval | **BUILD** |
| EBC runtime | **ADAPT** prior research → code later |
| Browser/Foundry/Terra/HVS/Media | **EXTEND** |
| MCP | **ADAPT** into registry |
| Frontier LLM/VLM/Realtime/ASR | **PROVIDER** + local fallback |
| OSWorld computer-use stack | **ADAPT/late** or provider CU API behind broker |

---

## 44. Hardware

Nebula Linux CUDA preferred for local multimodal. Commander client needs real mic/camera permissions for voice/vision capture. Agent boxes ≠ user audio devices — never imply otherwise.  
Priority: document constraints P0; procure separate.

---

## 45. Benchmarks

| Benchmark | Citation | WR use |
|---|---|---|
| GAIA | arXiv:2311.12983 | General tool assistant regression |
| WebArena | Zhou et al., ICLR 2024 | Broker |
| VisualWebArena | visual web agents | Broker+vision |
| OSWorld | Xie et al., NeurIPS 2024 | Computer-use late |
| SWE-bench / SWE-agent | Jimenez et al.; Yang et al. arXiv:2405.15793 | Foundry only |
| ReAct | arXiv:2210.03629 | Short-path tool loop design |

Public benches **do not** prove WR authority/module boundaries — hence §46.

---

## 46. War Room General Assistant Eval (primary)

Fixture families:
1. SHORT_PATH social / trivial QA (≤1 model; no EBC roster spam)
2. SYSTEM_STATUS with tools (EBC min set; TOOL_BLOCKED if tools down)
3. Image+question multimodal
4. PDF+CSV analysis
5. Deep research via Broker (citations on board)
6. Foundry handoff dry-run (no Council patch)
7. Voice: permission_denied → UI must not show LISTENING
8. Authority: email.send → ASK
9. Boundary: “edit like CapCut” → HVS handoff not Media-gen-only claim
10. Cost: SHORT_PATH ≪ DEEP_RESEARCH

Pass bar: zero false READY; zero fake LISTENING; zero module collapse; provenance present; classifier accuracy on gold labels.

---

## 47. Dependency graph

```
[AuthorityMatrix]──────────────┐
[MultimodalEnvelope]──┐        │
[PathClassifier]──────┼────────┼──► ShortPathRuntime ──► ResponseLayer
                      │        │
                      ▼        ▼
              EBC Classifier+Board kinds ──► LUMEN/PHOENIX/AURORA
                      │
         File/Image Ingest Tools
                      │
              Artifact Workspace
                      │
         Browser Broker deep-research hooks
                      │
         Memory tier extension (same spine)
                      │
         VoiceSession(capture_truth) ± Realtime provider
                      │
         MCP read-only connectors → email/calendar
                      │
         Durable tasks + Mission Center projection
                      │
         Computer-Use Broker (sandbox)
                      │
         Media-gen plane + HVS/Media handoff polish
```

Foundry SE phases A→G remain **Foundry-owned** parallel track; Council only depends on **handoff contract** stability.

---

## 48. Must-build foundation list

1. PathClassifier (SHORT | AGENT | HANDOFF)  
2. MultimodalEnvelope schema + validation  
3. capture_truth for audio/video sessions  
4. AuthorityMatrix multimodal rows  
5. Tool registry **namespace extension** (no registry2)  
6. Evidence board multimodal evidence kinds  
7. ShortPathRuntime + ResponseLayer  
8. files.ingest / vision.ingest minimal tools  
9. ModuleCallContract for Foundry/Browser/HVS/Media/Terra  
10. Observability spans (classify/tool/handoff)  
11. WR-GA Eval harness skeleton + fixtures 1,2,7,8  
12. Honest health/backing labels in UI contracts  

---

## 49. Phased roadmap (dependency-derived)

| Phase | Name | Delivers | Depends | Exit test |
|---|---|---|---|---|
| A | Spine | Foundation 1–6,9,12 | — | Schema fixtures validate; deny paths work |
| B | Short door | ShortPath+Response+ingest tools | A | Fixtures 1,3,4 path-correct |
| C | EBC-MM | Multimodal classes+board kinds+Broker hooks | A,B + EBC core | Fixture 2,5; no always-six |
| D | Artifacts+Memory | Artifact workspace; memory tiers | B | Version+cite roundtrip |
| E | Voice truth | VoiceSession+capture_truth+(optional realtime) | A,B | Fixture 7 hard pass |
| F | Connectors | MCP read-only; email/calendar read; send=ASK | A,C | Fixture 8 |
| G | Durable UX | Durable FSM + Mission Center | C,D | Resume after reconnect |
| H | Computer-use | Sandboxed CU broker | C, authority | OSWorld smoke optional |
| I | Media plane | Gen plane + HVS/Media handoff polish | C,D | Fixture 9 |

**Do not** blindly use unrelated example phases from other programs. Foundry A–G stays on Foundry track.

---

## 50. Phase acceptance tests (summary)

- **A:** Envelope reject on missing fields; authority deny cannot auto; no second registry created.  
- **B:** “Hi Council” → SHORT_PATH; image QA returns provenance.  
- **C:** “Status on War Room” → SYSTEM_STATUS min agents + probes; research mission shows board citations.  
- **D:** Artifact edit produces immutable version chain.  
- **E:** Mic denied → UI ≠ LISTENING.  
- **F:** send email without approve → blocked.  
- **G:** Kill session mid-mission → resume or honest BLOCKED.  
- **H:** CU actions require ask+sandbox; no host escape.  
- **I:** “Professional timeline edit” → HVS handoff; casual sticker → media-gen plane.

---

## 51. Risks and failure modes

| Risk | Mitigation |
|---|---|
| Module collapse (Council absorbs HVS/Foundry) | Boundaries + handoff contracts + eval fixture 9 |
| Always-six cost explosion | PathClassifier + conditional assembly |
| Fake LISTENING | capture_truth hard gate |
| Authority bypass via tools | Matrix + audit; capability≠authority |
| Duplicate memory/tool registries | Explicit forbid; code review lock |
| Public-bench chasing | WR-GA Eval primary |
| Voice provider lock-in | Adapter interface |
| Computer-use host compromise | Late phase; sandbox; ask |
| Stale multimodal memory as live | Temporal layers + TTL |
| Foundry ownership ceded to Council chat coding | ENGINEERING → handoff only |

---

## 52. What not to build

- Council2 / Browser2 / Foundry2 / Terra2 / HVS2 / Media2  
- Parallel Memory OS or Tool Registry  
- Personality-only seats without contracts  
- Free multi-agent chat as SoT  
- Fake LISTENING / fake READY  
- Council-native codegen executor replacing Foundry  
- Unconstrained desktop agent on day one  
- Autonomous finance/email send  
- Collapsing HVS NLE into chat image gen  
- Treating Terra Council Analysis as Observed Data  

---

## 53. Final architecture

```
                    ┌──────────── Commander Authority ────────────┐
                    ▼                                             │
             Divine Council GMII UI (Room)                        │
                    ▼                                             │
              PathClassifier                                      │
        ┌───────────┼────────────┐                                │
        ▼           ▼            ▼                                │
   SHORT_PATH   AGENT_PATH    HANDOFF ─────────────────────────┐  │
   (± tools)       │              │                            │  │
        │          ▼              ▼                            ▼  │
        │     EBC Mission    ModuleCallContract      Foundry / Browser /
        │   board→L→P→A      (typed, idempotent)     Terra / HVS / Media
        │          │                                          │  │
        └────► ResponseLayer ◄──────── evidence/artifacts ────┘  │
                    │                                            │
                    └── ask/deny loops ──────────────────────────┘

Shared spine: AuthorityMatrix · ToolRegistry(namespaced) · Memory tiers · Observability
```

**ONE architecture name:** **Evidence-Board General Multimodal Interface (EBC-GMII)** — short door + EBC brain + module handoffs.

---

## 54. First engineering mission (post-research)

**Title:** `GI-ENG-01 PathClassifier + SHORT_PATH + MultimodalEnvelope`

**Scope:** Implement classifier rules, envelope schema/validators, capture_truth enum, AuthorityMatrix stubs for multimodal tools, ShortPathRuntime wiring to existing model router, ResponseLayer fields, WR-GA fixtures 1 & 7 & 8 skeleton.  

**Non-goals:** Realtime provider integration, computer-use, HVS features, MCP marketplace, Foundry execution changes, UI chrome beyond truthfulness hooks.  

**Acceptance:** Fixtures pass; no new module stacks; Builds still HOLD for unrelated systems until Commander orders implement track.

**HARD STOP after this research report — no implementation in this mission.**

---

# MANDATORY FINAL QUESTIONS (explicit answers)

### Q1. What must Divine Council be able to do to qualify as a serious general AI assistant?
**A:** Natural multi-turn conversation with short-path answers; tool-verified reasoning; writing/artifacts; multimodal ingest (image/audio/video/files); deep research via Browser Broker+EBC; durable missions with Mission Center; connectors under authority; Foundry handoff for coding; honest voice/UI states; WR General Assistant Eval progress — all on one spine, not a personality panel. (RECOMMENDATION)

### Q2. Which capabilities belong directly inside Council?
**A:** PathClassifier; SHORT_PATH dialogue; EBC mission brain (conditional seats, evidence board, LUMEN/PHOENIX/AURORA); mission/session memory; NL tool routing; ResponseLayer; MultimodalEnvelope ownership; Mission Center projection; authority checks before Act. (RECOMMENDATION)

### Q3. Which capabilities should be tools/services Council invokes?
**A:** Browser Broker; files/OCR/ASR/TTS/vision ingest; ArtifactWorkspace; data analysis sandbox (NOVA tools); MCP connectors (email/calendar/drive/GitHub); media-gen plane; computer-use broker (late); calculators/code-exec sandboxes; retrieval/embeddings. Council orchestrates; services execute. (RECOMMENDATION)

### Q4. Which capabilities belong specifically to Foundry?
**A:** Repo ACI, patches, terminal under policy, tests/build/repair loops, Engineering Mission Contract, completion truth — triggered only by `COUNCIL_FOUNDRY_HANDOFF` / ModuleCallContract. Council never owns git mutate/push/deploy. (RECOMMENDATION; Foundry SE report)

### Q5. Which belong to Higher Vision Studios / Media?
**A:** HVS = production NLE/creative timelines (callable studio). War Room Media / media-gen plane = playback + casual illustrative generation/edits. Neither collapses into Council chat. (RECOMMENDATION + VERIFIED boundary locks)

### Q6. What should remain Terra's responsibility?
**A:** World-state entities/events/locations/timelines/live signals/provenance — Observed Data plane. Council may query/cite Terra; must not rewrite Terra truth or absorb planetary fabric. (VERIFIED FACT doctrine)

### Q7. What infrastructure must be built BEFORE adding more models?
**A:** PathClassifier; MultimodalEnvelope + capture_truth; AuthorityMatrix multimodal rows; tool-registry namespace extension (no registry2); evidence board multimodal kinds; ShortPathRuntime + ResponseLayer; ingest tools; ModuleCallContracts; observability spans; WR-GA eval skeleton (§48). Models without this create theater. (RECOMMENDATION)

### Q8. What can run locally on Nebula Genesis today?
**A:** Local text backends (Ollama path), embeddings, lighter ASR/TTS candidates, some vision/OCR offline, dataframe/math sandboxes, Browser/Foundry on-machine under policy — within 32 GB RAM / 16 GB VRAM budgets (one heavy GPU owner at a time via arbiter). Not: frontier-class realtime S2S, strongest VLMs, licensed financial terminals. (RESEARCH FINDING / INFERENCE from hardware + WR local paths)

### Q9. What should remain optional frontier-provider capability?
**A:** Strongest reasoning/VLM, realtime voice, premium image/video gen, some document AI — behind adapters with honest health labels and sovereignty degrade mode. Never sole spine. (RECOMMENDATION)

### Q10. How should text, image, audio, video, files, browser, apps, and computer use share one unified task architecture?
**A:** CommanderTurn → modality processors → MultimodalEvidence on one board → PathClassifier (SHORT|AGENT|HANDOFF) → tools/ModuleCallContracts → Mission Center / artifacts — single authority + registry + memory spine. (RECOMMENDATION; EBC-GMII)

### Q11. How do we avoid creating ten separate AI subsystems that cannot cooperate?
**A:** Forbid *2 duplicates; one Tool Router/registry; one memory spine; typed ModuleCallContracts; Evidence Board as SoR for missions; PathClassifier as only front door. Eval fixtures refuse module collapse. (RECOMMENDATION)

### Q12. How should the Commander talk naturally while Council internally uses structured agents, tools, evidence, and missions?
**A:** ResponseLayer maps internal structured state → natural speech/text; hide tool IDs/claim IDs by default; Evidence/Meta/Inspector expose structure on demand; SHORT_PATH skips panel theater. (RECOMMENDATION)

### Q13. What evaluation suite will prove these capabilities actually work?
**A:** War Room General Assistant Eval (§46) + Blind Spot GA-01…GA-15 hardness primary; GAIA / WebArena / VisualWebArena / OSWorld / SWE-* as reference regressions only — not graduation theater. (RECOMMENDATION)

### Q14. What is the minimum foundation we build first?
**A:** §48 foundation list / Phase A Spine: PathClassifier, envelopes+capture_truth, AuthorityMatrix, registry namespace, board kinds, ShortPath, ingest, handoff contracts, observability, eval fixtures 1/2/7/8. (RECOMMENDATION)

### Q15. What exact engineering mission should follow this research?
**A:** `GI-ENG-01` — PathClassifier + SHORT_PATH + MultimodalEnvelope(+capture_truth) + Authority stubs + WR-GA fixtures skeleton (§54). Non-goals: realtime provider, computer-use, HVS, MCP marketplace, Foundry execution changes. Builds HOLD until Commander authorizes. (RECOMMENDATION)

---

## Appendix A — Primary sources (selected)

1. Mialon et al. — GAIA, arXiv:2311.12983  
2. Zhou et al. — WebArena, ICLR 2024  
3. VisualWebArena — visual web agent benchmark  
4. Xie et al. — OSWorld, NeurIPS 2024  
5. Yao et al. — ReAct, arXiv:2210.03629  
6. Yang et al. — SWE-agent, arXiv:2405.15793  
7. Jimenez et al. — SWE-bench  
8. Anthropic — Multi-agent research system engineering blog  
9. Anthropic — Model Context Protocol  
10. Anthropic — Writing effective tools for agents  
11. OpenAI — Realtime API / gpt-realtime  
12. Google — Gemini Live API docs  
13. LangGraph — multi-agent / supervisor docs  
14. Microsoft — AutoGen / Agent Framework lineage  
15. MetaGPT — arXiv:2308.00352  
16. OpenAI Agents SDK — handoffs vs as_tool  
17. WR — WAR_ROOM_COUNCIL_INTELLIGENCE_RESEARCH_REPORT (EBC)  
18. WR — FOUNDRY_STANDALONE_ENGINEER_RESEARCH_REPORT  
19. WR — HIGHER_VISION_STUDIOS_MASTER_MEDIA_PRODUCTION_RESEARCH_REPORT  
20. WR — COUNCIL_CONTINUITY_AND_ROUTING.md; AGENT_CAPABILITY_MATRIX.md  

## Appendix B — Wave stamp index

`waves/WAVE_1.md` … `waves/WAVE_8.md` under `/home/box/divine-council-general-intel/waves/`  
Mirrors: `/workspace/divine-council-general-intel/` · `/workspace/terra-swarm/divine-council-waves/`

## Appendix C — Per-capability checklist reminder

Each capability section §§7–33 includes: use case, component, I/O, owner module, models/tools, storage, permissions, provenance, failures, local/cloud, OSS, eval, deps, priority — densified in-wave where tabular.

---

**Document control**

| Path | Role |
|---|---|
| `/home/box/divine-council-general-intel/WAR_ROOM_DIVINE_COUNCIL_GENERAL_INTELLIGENCE_RESEARCH_REPORT.md` | Canonical |
| `/workspace/divine-council-general-intel/` | Workspace mirror |
| `/workspace/terra-swarm/divine-council-waves/` | Terra-swarm mirror |

**Stamp: WAVE_8 DONE | Waves 1–7 folded | MASTER REPORT READY | HARD STOP — NO IMPLEMENTATION**

END REPORT
