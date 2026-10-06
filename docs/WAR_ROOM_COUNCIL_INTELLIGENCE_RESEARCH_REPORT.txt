# WAR ROOM COUNCIL — MULTI-AGENT INTELLIGENCE RESEARCH REPORT
# Commander: Mark | RESEARCH ONLY — DO NOT MODIFY CODE / BUILD / COMMIT / DEPLOY
# Date: 2026-09-20 (America/New_York, ET)
# Canonical: /home/box/war-room-council-intel/WAR_ROOM_COUNCIL_INTELLIGENCE_RESEARCH_REPORT.md
# Fold: Waves 1–8 + Evidence Scout §3 + Science W3–6 schemas + Legal W7 locks + Blind Spot WAVE_8 AT suite + Historian WAVE_1_HISTORIAN (Appendix E)
# Labels: VERIFIED FACT | INFERENCE | RECOMMENDATION | PROPOSED WR
# Locks: VERIFY BEFORE CLAIM · UNKNOWN ≠ READY · evidence > prose · Capability ≠ authority
# Boundaries: Council ≠ Foundry ≠ Terra ≠ Media ≠ HVS · Builds HOLD
# Architecture (ONE): Evidence-Board Council (EBC) / Evidence-Board Supervisor-Worker (EBSW)

---

## 1. Executive findings

1. **Current Council fails as intelligence** because shared-context sequential chat + personality seats + optional/absent tools produce paraphrase clusters, not verified claims. (VERIFIED FACT mechanisms: anchoring, sycophancy, ASA; see §2–3.)
2. **Recommended architecture (ONE):** **Evidence-Board Council (EBC)** — mission classifier → conditional agent set → independent tool-first first-pass (hidden peers) → append-only evidence board → LUMEN verify + PHOENIX challenge → AURORA evidence-only synthesis → typed completion state. Orchestration substrate: graph/state machine (LangGraph-class) or equivalent WR kernel; **not** free group chat.
3. **Simple mission ≠ six agents.** SYSTEM_STATUS / SOCIAL_CHECKIN use min set; DEEP_RESEARCH scales workers. Always-six is a cost trap and fake specialization.
4. **Temporal memory is mandatory:** HISTORICAL / LAST_VERIFIED / CURRENT_LIVE. Stale evidence may be relevant by similarity; supersession + fail-closed release required.
5. **Replace** "Adaptive Council · Partial match · Advisory only" **with typed completion states** (VERIFIED, PARTIALLY_VERIFIED, UNVERIFIED, CONTRADICTED, TOOL_BLOCKED, STALE, BUDGET_EXHAUSTED, REFUSED).
6. **Preserve:** War Room orchestration, Commander authority, local/sovereign + frontier providers, Browser Broker, WRIM/Ra'el future, tool authority, provenance, truthful health planes (entity ≠ backing ≠ cloud).

---

## 2. Why current fails

| Mechanism | What happens | Evidence class |
|---|---|---|
| Anchoring | First seat text frames later seats; paraphrase | VERIFIED FACT — conformity / sycophantic anchors literature (Wave 1) |
| Peer sycophancy | Agreement without new evidence; modal conformity up to ~85% in unguided debate | VERIFIED FACT — arXiv:2605.00914; Peacemaker/Troublemaker arXiv:2509.23055 |
| Agentic scaffolding amplification (ASA) | Extra reconsider rounds can *drop* accuracy (~6.3 pp) | VERIFIED FACT — arXiv:2608.21377 |
| Sequential shared transcript | Conformity rises with majority size and time | VERIFIED FACT — BenchForm-class studies |
| Personality ≠ job | Role flavor does not improve tasks; interchangeable prose | VERIFIED FACT — Zheng et al. arXiv:2311.10054 |
| No-tools / prose-only | Claims without probes; UNKNOWN presented as READY | INFERENCE from WR behavior + Adaptive Assembly "Advisory only" UI path |
| Always-full roster | Cost without info gain; fake specialization | INFERENCE + Anthropic over-spawn failure mode (VERIFIED FACT practice) |
| Poetic / advisory fillers | "Partial match / Advisory only" hides gaps | VERIFIED FACT — WR `UNIFIED_ADAPTIVE_COUNCIL_ASSEMBLY.md` advisory labels; Commander failure mode in MISSION_BRIEF |

**INFERENCE:** Echo is expected under shared-context decoding with agreement bias—not "laziness."

**Diagnostic signature:** high pairwise lexical overlap; soft "I concur"; empty tool logs; outputs interchangeable after stripping callsigns; accuracy worse after extra reconsider rounds.

---

## 3. Research sources

> Densified catalog: Appendix A (Evidence Scout). Table below is the operational pin set used throughout this report; Appendix A adds official repos, sycophancy pins, and citation hygiene.


| # | Title | Org | URL | Date | Finding used |
|---|---|---|---|---|---|
| 1 | How we built our multi-agent research system | Anthropic | https://www.anthropic.com/engineering/multi-agent-research-system | 2025-06-13 | Orchestrator–worker; separate contexts; parallel subagents; citation agent; scale effort to complexity; ~15× token cost |
| 2 | AutoGen: Enabling Next-Gen LLM Applications via Multi-Agent Conversation | Microsoft Research | https://www.microsoft.com/en-us/research/wp-content/uploads/2023/08/LLM_agent.pdf | 2023 | Conversation patterns; debate flexible but echo-prone if chat-primary |
| 3 | MetaGPT: Meta Programming for a Multi-Agent Collaborative Framework | DeepWisdom / ICLR | https://arxiv.org/abs/2308.00352 | 2024 | SOP + structured documents > free dialogue |
| 4 | ChatDev | OpenBMB | https://arxiv.org/abs/2307.07924 | 2023+ | Chat-chain software agents; dialogue echo risk |
| 5 | Mixture-of-Agents | Together / Duke et al. | https://arxiv.org/abs/2406.04692 | 2024-06 | Layered propose→aggregate; use aggregation *after* independence |
| 6 | Improving Factuality via Multiagent Debate | Du et al. | https://arxiv.org/abs/2305.14325 | 2023 | Debate helps when gated; not first-pass shared chat |
| 7 | Judging LLM-as-a-Judge (MT-Bench) | Zheng et al. | https://arxiv.org/abs/2306.05685 | 2023 | Position/verbosity biases; simultaneous eval better |
| 8 | SWE-agent: Agent-Computer Interfaces | Princeton | https://arxiv.org/abs/2405.15793 | 2024 | Interface design > persona; tool UX lesson |
| 9 | ReAct | Yao et al. | https://arxiv.org/abs/2210.03629 | 2022 | Act/observe before final answer |
| 10 | LangGraph multi-agent docs / architecture blogs | LangChain | https://docs.langchain.com/oss/python/langgraph/overview | 2025–2026 | Stateful graph; parallel super-steps; supervisor patterns |
| 11 | OpenAI Agents SDK — multi-agent | OpenAI | https://openai.github.io/openai-agents-python/multi_agent/ | current | `as_tool` manager retains control vs handoffs |
| 12 | CrewAI docs | CrewAI | https://docs.crewai.com | current | Role crews; sequential default = echo risk |
| 13 | The Cost of Consensus | (arXiv) | https://arxiv.org/html/2605.00914 | 2026 | Unguided debate → sycophancy; isolated self-correction can win |
| 14 | Too Many Cooks (multi-agent reliability) | ACM AI Letters | https://dl.acm.org/doi/10.1145/3847307 | ~2025–26 | Correlated hallucination; family diversity ≠ independence |
| 15 | Peacemaker or Troublemaker | (arXiv) | https://arxiv.org/html/2509.23055v1 | 2025 | Sycophancy collapses disagreement; mix independence |
| 16 | Temporal Validity in Retrieval Memory | (arXiv) | https://arxiv.org/html/2606.26511 | 2026 | Bi-temporal supersession; RAG stale-fact failure |
| 17 | TEPA: Revoking Stale Memories | (arXiv) | https://arxiv.org/html/2608.07429v2 | 2026 | Keyed revoke from active retrieval; audit retain |
| 18 | Eywa: Provenance-Grounded Memory | (arXiv) | https://arxiv.org/html/2605.30771v1 | 2026 | Evidence before belief |
| 19 | Governed Persistent Memory (GPM) | (arXiv) | https://arxiv.org/html/2608.12476 | 2026 | Fail-closed claim release |
| 20 | OpenTelemetry GenAI observability | OTel | https://opentelemetry.io/blog/2026/genai-observability/ | 2026 | Spans for agent/tool/tokens/latency |
| 21 | Personas / role prompts not reliably helpful | Zheng et al. Findings EMNLP | https://arxiv.org/abs/2311.10054 | 2024 | Identity flavor ≠ capability |
| 22 | Blackboard LLM multi-agent systems | (arXiv) | https://arxiv.org/abs/2507.01701 | 2025 | Structured shared workspace |
| 23 | WR Council Continuity & Routing | War Room | `docs/architecture/COUNCIL_CONTINUITY_AND_ROUTING.md` | internal | Seat ≠ backing; truthful health planes |
| 24 | WR Council Request-State Contract | War Room | `docs/architecture/COUNCIL_REQUEST_STATE_CONTRACT.md` | internal | Readiness ≠ completion; fallback lineage |
| 25 | WR Research-First Orchestration | War Room | `docs/WR_COUNCIL_RESEARCH_FIRST_ORCHESTRATION.md` | internal | Evidence packet before deliberation; FAST skip |
| 26 | WR Adaptive Council Assembly | War Room | `docs/architecture/UNIFIED_ADAPTIVE_COUNCIL_ASSEMBLY.md` | internal | Mission classify + advisory presets; "Advisory only" |
| 27 | WR Agent Capability Matrix | War Room | `docs/AGENT_CAPABILITY_MATRIX.md` | internal | CAPABILITY ≠ AUTHORITY; Terra/Council/ASTRA boundaries |

---

## 4. Architectures compared

| System | Core mechanism | Anti-echo | Tool-first | Parallel independent | WR fit |
|---|---|---|---|---|---|
| AutoGen / Agent Framework | Conversation / actors | Low if chat-primary | Yes | Possible | Med — avoid free chat |
| LangGraph | Stateful graph | High if designed | Yes | Yes | **High** substrate |
| CrewAI | Role crews | Low–Med sequential | Yes | Limited | Med — no backstory-brain |
| MetaGPT | SOP + structured docs | **High** | Yes | Pipeline | **High** — steal doc bus |
| ChatDev | Chat chain | Low–Med | Partial | Limited | Med |
| OpenAI Agents SDK | Handoff vs as_tool | Med–High (as_tool) | Yes | Yes | **High** manager pattern |
| Anthropic Research | Orchestrator + parallel subagents | **High** (separate ctx) | Required | **Yes** | **Highest** reference |
| MoA | Layered shared proposals | Low mid-layer | N/A | Proposers | Med — aggregate post-independence |
| Debate / Verifier | Adversarial + judge | Med–High if isolated | Should | Then argue | High gated |
| Blackboard | Shared structured state | **High** | Yes | Yes | **High** Evidence Board |
| Planner/Executor/Verifier | Plan→act→check | Med–High | Yes | Via DAG | **High** |
| SWE-agent | ACI tool UX | N/A | Central | N/A | High analogy |

**Do not adopt brands blindly.** Steal: Anthropic parallel independent contexts + MetaGPT structured artifacts + blackboard SoT + LangGraph/as_tool control + SWE-agent interface discipline.

---

## 5. Recommended WR Council architecture (ONE concrete)

### Name
**Evidence-Board Council (EBC)**

### Pipeline (normative)

```
Commander mission
  → MissionClassifier (deterministic-first; LLM only if ambiguous)
  → AssemblyPlan (selected agents, tools, budgets, TTL, participation preset)
  → [optional] Shared research/evidence packet (research-first; once)
  → Round-1 workers IN PARALLEL, peer_visibility=HIDDEN, tool-first contracts
  → Submit structured envelopes → Evidence Board (append-only)
  → Novelty + similarity gate
  → LUMEN: simultaneous verify of sealed claim set
  → PHOENIX: claim-level adversarial pass (cap 1 unless conflicts remain)
  → [optional] Gap wave: only for LUMEN/PHOENIX tagged gaps; disjoint tasks
  → AURORA: synthesize from board only (no worker chat; no new facts)
  → Typed completion_state + MissionTelemetry
  → Commander (authority preserved; Council advisory for actions)
```

### Hard rules
1. No free multi-agent chat as coordination medium.
2. No CURRENT_LIVE / READY without tool/live evidence inside mission TTL when mission requires it.
3. Agent count from classifier — not fixed six.
4. Seat identity ≠ provider backing (preserve continuity doctrine).
5. Council does not execute Foundry/ASTRA mutations; ENGINEERING class = analysis/plan + handoff.

### Why this one (not a menu)
Maximizes anti-echo (hidden first-pass) + verification (LUMEN/PHOENIX) + cost control (conditional invocation) + WR fit (research-first packet, request-state axes, Terra/tool boundaries) using mechanisms with primary-source support. Alternatives that keep shared sequential chat fail §2.

---

## 6. Agent functional contracts

Callsigns are **routing IDs only**. No backstory. Capability = tools + schemas + metrics + omit rules.

### ORION — Investigation / ops findings
- **Job:** Primary-source / probe-backed findings on assigned sub-questions (status probes, repo/config, assigned research slice).
- **Tools:** Health/status, logs, repo/config read, search/fetch as allowlisted.
- **Output:** Claims + evidence_ids; no synthesis essay.
- **Omit:** Pure format (NOVA); pure adversarial (PHOENIX); trivial social ping.
- **Fail:** Paraphrase peers; invent citations; READY without probe.

### LUMEN — Verifier
- **Job:** Check claims vs evidence; SUPPORTED|UNSUPPORTED|CONTRADICTED|UNKNOWN.
- **Tools:** Re-fetch/re-read cited sources; rubric scorer.
- **Input:** Sealed claim set **simultaneously** (not conversational rebuttal).
- **Omit:** No claims yet; trivial non-factual.
- **Fail:** Sycophantic agree-with-author; style judging.

### PULSAR — Live / current intel
- **Job:** Time-sensitive retrieval; refresh stale board items; dated sources.
- **Tools:** Live search / Browser Broker; dated fetch.
- **Omit:** Historical/static doctrine; no time component; SYSTEM_STATUS without external deps.
- **Fail:** Undated "recently"; SEO-farm preference.

### NOVA — Structure / local / schema
- **Job:** Normalize, tabulate, schema-validate, entity-resolve; local continuity seat when used as model backing is separate from this *function*.
- **Tools:** Schema validator; optional transform/code exec under policy.
- **Omit:** Single short factual answer; no multi-entity compare.
- **Fail:** Invent cells; silent coercion.

### PHOENIX — Adversarial challenge
- **Job:** Attack overconfident claims; require missing probe / contradicting evidence / falsifying test.
- **Output:** CONFLICT/RISK with `required_test`; cannot close by rephrase.
- **Omit:** Trivial lookup; already hard-failed LUMEN; budget floor.
- **Fail:** Performative disagreement; endless reconsider (ASA).

### AURORA — Evidence-constrained synthesizer
- **Job:** Commander-facing brief from **surviving board only**; preserve provenance; label VERIFIED FACT | INFERENCE | RECOMMENDATION.
- **Forbidden:** New facts; upgrading honesty; raw chat mixture; auto-execute.
- **Omit:** Single LUMEN-clean fact already answered; structured-only NOVA final.
- **Fail:** False consensus; dropped provenance; poetic filler.

**Cross-cutting contract fields:** agent_id, mission_id, tools_allowed/forbidden, output_schema, novelty_rule OR OMIT_REASON, peer_visibility, max_tool_calls, max_rounds, label_policy.

---

## 7. Mission classifier

### Types
SYSTEM_STATUS | DEEP_RESEARCH | ARCHITECTURE_REVIEW | INCIDENT_RESPONSE | ENGINEERING | CURRENT_INTEL | DOCUMENT_ANALYSIS | SOCIAL_CHECKIN (fast lane)

### Method
Deterministic keyword/policy first (align WR `classifyMission` / `classifyCouncilTurn`). LLM assist only if ambiguous. Never call providers for SOCIAL_CHECKIN classification cost if rules suffice.

### Classifier output
```json
{
  "mission_class": "SYSTEM_STATUS",
  "confidence": 0.9,
  "required_capabilities": ["ops_probe", "adversarial_review", "synthesis"],
  "selected_agents": ["ORION", "LUMEN", "PHOENIX", "AURORA"],
  "required_tools": ["wr.core.health", "wr.ui.health", "wr.ports.list"],
  "evidence_requirement": "CURRENT_LIVE",
  "ttl_seconds": 120,
  "participation_preset": "focused",
  "budget_tokens": 50000,
  "budget_ms": 45000,
  "phoenix_required": true,
  "aurora_required": true,
  "uncertainty_flags": []
}
```

### Default sets (RECOMMENDATION)
| Class | Agents | Notes |
|---|---|---|
| SOCIAL_CHECKIN | 0–1 | Roster ping; no research; no Aurora essay |
| SYSTEM_STATUS | ORION, LUMEN, PHOENIX, AURORA | PULSAR off unless external dep; NOVA if inventory |
| CURRENT_INTEL | PULSAR, LUMEN, NOVA?, PHOENIX?, AURORA | Live tools required |
| DEEP_RESEARCH | Planner + 2–5 workers (ORION/PULSAR) + LUMEN + PHOENIX + AURORA | Disjoint subquestions |
| ARCHITECTURE_REVIEW | ORION, NOVA, PHOENIX, AURORA | Repo/docs tools |
| INCIDENT_RESPONSE | ORION, LUMEN, PHOENIX, AURORA (+PULSAR) | Live probes |
| ENGINEERING | NOVA, ORION, PHOENIX, AURORA | Analysis only; Foundry executes |
| DOCUMENT_ANALYSIS | NOVA, LUMEN, PHOENIX, AURORA | Doc tools |

**Test:** "Status on War Room" → SYSTEM_STATUS; not DEEP_RESEARCH; not six agents including idle PULSAR.

---

## 8. Task decomposition

Decomposer emits tasks:
```json
{
  "task_id": "t1",
  "owner": "ORION",
  "objective": "Probe Core health endpoint",
  "tools": ["wr.core.health"],
  "acceptance": "evidence row with status_code + retrieved_at",
  "depends_on": [],
  "parallel_group": "R1"
}
```

Rules:
- Prefer disjoint Round-1 tasks for parallel.
- Every SYSTEM_STATUS / CURRENT_INTEL / INCIDENT task has tool allowlist.
- No task whose acceptance is "write eloquent paragraph."
- ENGINEERING: no Foundry execute tools on Council path.

---

## 9. Parallel worker design

### Helps
Independent subquestions; separate contexts; I/O-bound tools; Anthropic-style wall-clock wins on breadth research.

### Hurts
Homogeneous debate without tools; correlated hallucination; duplicate `(tool, args_hash)`; always-six on simple missions; write contention on same resource.

### Protocol
1. `peer_visibility=HIDDEN` until valid schema submit.
2. Non-overlapping subquestions + tool-call caps.
3. Dedup tool fingerprints across workers.
4. Early stop on sufficiency / budget / zero novelty.
5. Second wave only for tagged gaps.

**Simple mission ≠ six agents** — acceptance-tested.

---

## 10. Evidence board

**Source of truth:** Mission Evidence Board (blackboard), not chat log.

| Partition | Contents |
|---|---|
| Mission | class, question, agents, budgets, TTL |
| Evidence | append-only records |
| Claims | status machine nodes |
| Conflicts | PHOENIX/LUMEN contradiction sets |
| Tasks | work items + owners |
| Decisions | AURORA finals; Commander overrides (separate authority lane) |

Links: `supports` | `contradicts` | `derived_from` | `stale_of` | `supersedes`

Write rules: append/version; tag agent_id, round, timestamp; chat may mirror UI but board wins.

---

## 11. Agent output schema

> Full TypeScript-shaped types + `can_verify` / novelty algorithms: Appendix B (Science W3–6 densify).


Common envelope (reject if missing):

```json
{
  "agent_id": "ORION|LUMEN|PULSAR|NOVA|PHOENIX|AURORA",
  "mission_id": "string",
  "round": 1,
  "claims": [{
    "claim_id": "c1",
    "text": "...",
    "status": "PROPOSED",
    "evidence_ids": ["e1"],
    "confidence": 0.0,
    "label": "VERIFIED_FACT|INFERENCE|RECOMMENDATION",
    "temporal_layer": "HISTORICAL|LAST_VERIFIED|CURRENT_LIVE"
  }],
  "evidence": [{
    "evidence_id": "e1",
    "kind": "live_telemetry|tool_result|repo_config|log|primary_external|secondary_external|inference|model_prior",
    "summary": "...",
    "pointer": "...",
    "retrieved_at": "ISO-8601",
    "tool_name": "...",
    "ok": true,
    "temporal_layer": "CURRENT_LIVE"
  }],
  "contradictions": [],
  "risks": [],
  "tests_recommended": [],
  "unknowns": [],
  "novelty": {"adds": ["NEW_EVIDENCE"], "suppressed": false},
  "omit_reason": null,
  "tokens_used": 0,
  "latency_ms": 0
}
```

Prose fields optional and **non-authoritative**.

---

## 12. Claim / evidence / provenance

### Evidence hierarchy (top wins on conflict)
1. live_telemetry  
2. tool_result  
3. repo_config  
4. logs  
5. primary_external  
6. secondary_external  
7. inference  
8. model_prior  

**Cannot promote model_prior to VERIFIED.**

### Claim status machine
`PROPOSED → SUPPORTED → VERIFIED | UNVERIFIED | CONTRADICTED | STALE | TOOL_BLOCKED | WITHDRAWN`

### Provenance required fields
source, retrieved_at, tool_name or url, optional hash, license_class where external; agent_id; mission_id; temporal_layer; supersedes_id.

### Provenance ≠ truth
Provenance proves origin; LUMEN/PHOENIX + hierarchy decide support.

---

## 13. Tool-first policy

**VERIFY BEFORE CLAIM.**

1. SYSTEM_STATUS / INCIDENT / CURRENT_INTEL: no positive operational claim without live_telemetry or tool_result inside TTL.
2. Tool allowlist per agent/mission (capability ≠ authority).
3. Tool failure → TOOL_BLOCKED or UNKNOWN; never invent.
4. Hierarchy enforced at board write time.
5. Namespaced tools (examples): `wr.core.health`, `wr.ui.health`, `wr.ports.list`, `wr.git.branch`, `wr.logs.tail`, `broker.fetch`.
6. Shared evidence packet: research once, fan-out read-only (WR research-first).
7. Ban poetic status lexicon in validator (poised, quiet before the storm, ready and waiting, etc.).

**Test:** Disable health tool → ORION TOOL_BLOCKED; AURORA cannot emit system READY.

---

## 14. Anti-echo design

1. Independent first-pass; hidden peers until submit.  
2. Novelty rule: ≥1 of NEW_EVIDENCE | NEW_CLAIM | NEW_CONTRADICTION | NEW_RISK | NEW_TEST | NEW_CAUSAL_EXPLANATION **or** OMIT_REASON.  
3. Similarity gate vs board/peers (lexical/embedding τ).  
4. Tool-log required for ORION/PULSAR factual submits.  
5. LUMEN simultaneous sealed-set scoring (not author chat).  
6. No free debate in Round 1; optional gated debate only on sealed alternatives.  
7. Metrics: pairwise similarity ↓; unique sources ↑; unsupported claim rate ↓; duplicate tool queries ↓.

---

## 15. Revision policy

| Allowed | Forbidden |
|---|---|
| Revise when new evidence_id arrives | Revise solely because outnumbered |
| Revise to demote claim after LUMEN/PHOENIX | "I agree with the consensus" without evidence |
| Gap-wave workers for tagged unknowns | Unlimited reconsider loops (ASA) |
| Stand firm with evidence citation | Paraphrase peer as "building on" |

Max PHOENIX hard passes: 1 default; +1 only if open CONFLICT and budget remains. Position change requires `evidence_delta` field.

---

## 16. Phoenix design

1. Rank claims by impact × confidence × thin_evidence.  
2. For top claims: demand missing probe OR run contradictory tool OR cite contradicting evidence.  
3. Emit CONFLICT `{claim_ids, reason, required_test}` or RISK.  
4. Cannot close CONFLICT by rephrasing — only new evidence or withdrawal.  
5. Suppressed if novelty rule fails (anti-echo).  
6. Success metric: ≥1 status demotion or new required_test on overconfident boards.  
7. **Test:** Plant "Council READY" with no probe → CONFLICT opened; AURORA cannot READY.

---

## 17. Aurora synthesis design

- **Input:** Board snapshot only (evidence, claims, conflicts, unknowns, tool_blocks).  
- **Forbidden:** Raw worker chat; inventing probes; honesty upgrades; Foundry/Terra mutation.  
- **Output:** Final schema (§18) with verified_facts / partial / unverified / conflicts / unknowns / tool_blocks / risks / next_actions.  
- **Authority:** `advisory: true`; `commander_authority: REQUIRED_FOR_ACTION` for any execute recommendation.  
- New factual needs → re-queue ORION/PULSAR; AURORA does not invent.

---

## 18. Completion / confidence states

Replace vague Partial match / Advisory only:

| State | Meaning |
|---|---|
| VERIFIED | Critical claims verified with required-layer evidence inside TTL |
| PARTIALLY_VERIFIED | Some critical verified; unknowns/conflicts remain |
| UNVERIFIED | Claims exist; evidence insufficient |
| CONTRADICTED | Open CONFLICT on critical claim |
| TOOL_BLOCKED | Required tools failed/denied |
| STALE | Evidence older than mission TTL / wrong temporal layer |
| BUDGET_EXHAUSTED | Stopped early; report known + gaps |
| REFUSED | Policy/authority refuse |

**UNKNOWN ≠ READY.** No READY alias that hides UNKNOWN. UI may always show advisory for action recommendations; that is separate from completion_state.

Confidence: numeric 0–1 derived from verified critical claim ratio × evidence rank × open conflict penalty — not poetic adjectives.

---

## 19. Temporal memory

| Layer | Meaning | Allowed use |
|---|---|---|
| HISTORICAL | True for past interval; may be superseded | As-of, audit |
| LAST_VERIFIED | Last successful verification + method | Default when live probe not run; must label |
| CURRENT_LIVE | Fresh tool/probe this mission inside TTL | Status READY claims |

**Stale handling:** keyed supersession (TEPA); fail-closed release (GPM); never label LAST_VERIFIED as live; PHOENIX challenges CURRENT_LIVE without this-round tool provenance.

Fields: temporal_layer, valid_from/to, observed_at, retrieved_at, verified_at, verification_method, supersedes_id, stale_reason.

Align with Terra freshness/coverage and Search content_hash stale withhold patterns already in WR.

---

## 20. Observability

> Legal locks on telemetry/vendor traces: Appendix C (secrets out of vendor spans; OWNABLE local MissionTelemetry; REQUIRE-AUTH for export).


One telemetry trace per Commander mission/round (`MissionTelemetryV1`):

- mission: id, class, agent_count, budgets, early_stop_reason  
- agent spans: id, provider/model, tokens, latency, outcome  
- tool spans: name, args_fingerprint, latency, ok  
- claims/evidence counts; phoenix challenges; aurora exclusions  
- cost estimate from token×price table (versioned)

Prefer OpenTelemetry GenAI semantic conventions; span-link parallel agents by `run_id`. Preserve request-state axes: readiness ≠ completion; fallback lineage; prior-response lineage only when delivery proven.

Ban: telemetry that is only a poetic status string.

---

## 21. Latency / cost

| Knob | Rule |
|---|---|
| Participation preset | focused / standard / comprehensive from classifier |
| Agent count | Min set for class; scale workers only for breadth |
| Model tier | Local/NOVA for classify/draft; frontier for PHOENIX/AURORA when stakes high |
| Shared packet | One research fan-out |
| Tool dedup | Short-circuit duplicate fingerprints |
| Early stop | Sufficiency, budget, zero novelty |
| Round cap | Prefer ≤2 substantive rounds post first-pass |

**Expect** multi-agent research ≈4×–15× single-chat tokens when fully engaged (Anthropic VERIFIED FACT). Therefore omit agents aggressively on narrow missions.

---

## 22. Failure handling

> Plus Legal addendum (Appendix C): authority missing → REFUSED; provenance incomplete → schema reject; vendor retention unknown → HOLD frontier.


| Failure | Behavior |
|---|---|
| Partial tool/worker failure | Continue with remaining evidence; mark gaps |
| All required tools fail | TOOL_BLOCKED; no fake live evidence |
| Provider fail | Fallback lineage recorded; never erase primary failure (request-state contract) |
| Schema-invalid agent output | Reject; retry once or OMIT |
| Novelty/similarity fail | Quarantine; revise or OMIT |
| Budget exhaust | BUDGET_EXHAUSTED + known facts |
| Open critical CONFLICT | CONTRADICTED; AURORA surfaces conflict; no false consensus |
| Classifier ambiguous | Ask Commander or conservative DEEP_RESEARCH with hard budget |
| ENGINEERING execute request | REFUSED at Council; handoff to Foundry/ASTRA under Commander authority |

---

## 23. EXAMPLE — Status on War Room

**Commander:** "Status on War Room"

### Classification
- mission_class: `SYSTEM_STATUS`
- confidence: 0.93
- selected_agents: ORION, LUMEN, PHOENIX, AURORA  
- not selected: PULSAR (no external-intel need), NOVA (no schema inventory asked)
- required_tools: `wr.core.health`, `wr.ui.health`, `wr.ports.list`, optional `wr.git.branch`
- evidence_requirement: CURRENT_LIVE; ttl_seconds: 120
- participation_preset: focused

### Tasks (parallel R1)
| task_id | owner | objective |
|---|---|---|
| t1 | ORION | Probe Core health |
| t2 | ORION | Probe UI health |
| t3 | ORION | List critical ports / process health snapshot |

(Peers hidden; single ORION worker with three tool tasks OR two ORION instances if parallelized — still not six personas.)

### Tools (example results)
- e1: wr.core.health → 200, ok=true, retrieved_at=2026-09-20T20:40:00-04:00, CURRENT_LIVE  
- e2: wr.ui.health → 200, ok=true, same  
- e3: wr.ports.list → :3847,:3848 listening  
- e4: Anthropic cloud key → NOT_CONFIGURED (backing plane; not entity death)

### Evidence board claims
- c1: "Core HTTP health OK" SUPPORTED by e1 → LUMEN VERIFIED  
- c2: "UI HTTP health OK" SUPPORTED by e2 → VERIFIED  
- c3: "All cloud Council providers READY" PROPOSED without tool → PHOENIX CONFLICT (e4 shows NOT_CONFIGURED); demoted  
- c4: "War Room entity continuity READY_LOCAL/HYBRID" from routing policy + local backing — LAST_VERIFIED/CURRENT_LIVE per continuity rules; must not claim OpenAI READY

### Conflicts
- CONFLICT-1: c3 vs e4 — required_test: list cloudState per seat; do not equate entity health to cloud READY

### Phoenix
Challenges c3; upheld; c3 → CONTRADICTED/WITHDRAWN

### Aurora final (abridged)
```json
{
  "mission_class": "SYSTEM_STATUS",
  "completion_state": "PARTIALLY_VERIFIED",
  "confidence": 0.72,
  "verified_facts": [
    {"text": "Core health endpoint returned 200", "evidence_ids": ["e1"], "temporal_layer": "CURRENT_LIVE"},
    {"text": "UI health endpoint returned 200", "evidence_ids": ["e2"], "temporal_layer": "CURRENT_LIVE"}
  ],
  "conflicts": [{"id": "CONFLICT-1", "summary": "Cloud provider READY claim contradicted by NOT_CONFIGURED backing"}],
  "unknowns": ["Full Terra live feed health not probed this mission"],
  "tool_blocks": [],
  "risks": ["Do not report commercial provider READY when NOT_CONFIGURED"],
  "next_actions": [{"action": "Probe Terra health if Commander needs world-state plane", "owner": "ORION|Commander"}],
  "advisory": true,
  "commander_authority": "REQUIRED_FOR_ACTION"
}
```

**Forbidden output:** "Adaptive Council · Partial match · Advisory only — the room stands ready, poised in quiet strength."

---

## 24. Before vs After

| Dimension | Before | After (EBC) |
|---|---|---|
| Coordination | Shared sequential chat | Hidden parallel first-pass + board |
| Roles | Personality seats | Functional contracts + omit table |
| Tools | Optional / absent | Tool-first gates by mission |
| Evidence | Prose citations optional | Append-only board + hierarchy |
| Verification | Soft peer agree | LUMEN sealed-set + PHOENIX conflicts |
| Synthesis | Mix conversation | AURORA board-only |
| Completion | Poetic / Partial match / Advisory only | Typed completion_state |
| Agent count | Often all seats | Classifier min set |
| Temporal | Collapsed "current" | HISTORICAL / LAST_VERIFIED / CURRENT_LIVE |
| Cost | High fixed | Budgets + early stop + dedup |
| Authority | Blurred | Council advisory; Commander executes |

---

## 25. Implementation roadmap PHASE 1–5

Research→prompt/schema/orchestration design only in this report; phases are engineering sequence when Commander authorizes code.

### PHASE 1 — Contracts & classifier
- Freeze agent contracts + output JSON schema + ban-list for poetic status.  
- Deterministic mission classifier + omit table.  
- Wire SOCIAL_CHECKIN / SYSTEM_STATUS min paths.  
- **Exit:** "Status on War Room" selects ≤4 agents; schema reject on prose-only.

### PHASE 2 — Evidence board & tool-first
- Board partitions + claim status machine + evidence hierarchy.  
- Tool allowlists; VERIFY BEFORE CLAIM gates.  
- Shared research packet reuse (existing research-first).  
- **Exit:** No READY without tool evidence on SYSTEM_STATUS fixtures.

### PHASE 3 — Anti-echo parallel runtime
- Hidden peer first-pass; novelty + similarity gates.  
- Parallel workers with disjoint tasks; tool fingerprint dedup.  
- **Exit:** Pairwise submit similarity below τ on fixture suite; duplicate tool query rate ↓.

### PHASE 4 — Phoenix + Aurora + completion states
- Phoenix conflict protocol; Aurora board-only final schema.  
- Replace UI completion strings with typed states.  
- Align with request-state contract axes.  
- **Exit:** Planted false READY caught; Aurora refuses upgrade.

### PHASE 5 — Temporal memory + telemetry + cost controls
- Temporal layers + supersession; MissionTelemetryV1 / OTel.  
- Budgets, early stop, participation presets authoritative (not advisory-only).  
- **Exit:** Stale-as-live impossible on fixtures; cost of SOCIAL_CHECKIN ≪ DEEP_RESEARCH by measured margin.

---

## 26. Engineering acceptance tests (concrete)

> Core suite below. **Mandatory CI expansion:** Appendix D Blind Spot AT-* IDs (AT-ORION-1 … AT-BOARD-CHAT). EBC must not ship UI without both.


1. **Schema reject:** Agent returns only poetic prose → invalid; not boarded.  
2. **Classifier:** "Hi council" → SOCIAL_CHECKIN; agents ≤1; no research.  
3. **Classifier:** "Status on War Room" → SYSTEM_STATUS; PULSAR not required; agents ≤4.  
4. **Tool gate:** Health tools disabled → completion_state TOOL_BLOCKED or UNVERIFIED; never READY.  
5. **Hierarchy:** Claim with only model_prior → cannot VERIFIED.  
6. **Phoenix:** Plant READY without probe → CONFLICT; Aurora not READY.  
7. **Anti-echo:** Two ORION workers same mission → similarity gate flags near-duplicate submits.  
8. **Hidden peers:** Worker prompt context contains zero sibling draft tokens pre-submit (instrumented).  
9. **Temporal:** Superseded fact as-of T0 returns HISTORICAL; current returns new; status path without probe cannot label CURRENT_LIVE.  
10. **Aurora isolation:** Strip board evidence → Aurora cannot emit verified_facts.  
11. **Fallback lineage:** Primary provider fail + fallback success → primary failure still recorded.  
12. **Cost:** SOCIAL_CHECKIN token_count < 15% of DEEP_RESEARCH median on fixtures.  
13. **Early stop:** All critical claims VERIFIED after R1 → no R2 spawn.  
14. **Boundary:** ENGINEERING mission attempting Foundry execute tool → REFUSED.  
15. **Continuity:** Missing OPENAI_API_KEY → cloudState NOT_CONFIGURED; entity may be READY_LOCAL; UI must not say OpenAI READY.  
16. **Novelty:** Submit with no novelty tag and no OMIT_REASON → reject.  
17. **Telemetry:** Completed mission exposes agent_count, tool_count, latency_ms, estimated_cost, completion_state.  
18. **Conflict surfacing:** Open CONFLICT appears in Aurora output conflicts[]; not smoothed away.

---

## 27. FINAL RECOMMENDATION

**Adopt Evidence-Board Council (EBC) as the single War Room Council intelligence architecture.**

**WHY**
1. Attacks the actual failure mode (shared-context echo + no-tools prose + poetic completion), not symptoms.  
2. Composes best-supported mechanisms: Anthropic independent parallel workers, MetaGPT structured artifacts, blackboard SoT, sealed-set verification, adversarial claim challenges, evidence-constrained aggregation.  
3. Fits existing WR doctrine: research-first packets, seat≠backing, readiness≠completion, CAPABILITY≠AUTHORITY, Council≠Foundry≠Terra.  
4. Controls cost/latency via classifier-driven agent sets, early stop, and tool dedup — **simple mission ≠ six agents**.  
5. Makes status truthful: typed completion states + temporal layers + Phoenix on READY claims.

**Do not** ship another always-on six-voice panel with advisory poetic banners. **Do** implement Phases 1–5 in order when Commander authorizes engineering.

---


---

## APPENDIX A — Evidence Scout primary source densify (§3 expansion)

Access date VERIFIED links: **2026-09-20 ET**. Full catalog: `EVIDENCE_SCOUT_PRIMARY_SOURCES.md`. Citation hygiene: do **not** cite arXiv:2308.01263 as sycophancy (that is XSTest); correct Sharma et al. sycophancy = **arXiv:2310.13548**.

### A.1 Official docs & repos (VERIFIED HTTP 200 this pass)

| System | Primary URLs | Mechanism extract for WR | Date note |
|---|---|---|---|
| AutoGen (Microsoft) | https://github.com/microsoft/autogen · https://microsoft.github.io/autogen/stable/ | Conversable agents; tool modes; group chat — **avoid chat as SoT** | Docs live 2026-09-20 |
| Microsoft Agent Framework | https://github.com/microsoft/agent-framework · https://learn.microsoft.com/en-us/agent-framework/overview/ | Agents + explicit workflows + tools/MCP | 2026 |
| LangGraph | https://github.com/langchain-ai/langgraph · https://docs.langchain.com/oss/python/langgraph/overview | Explicit graph state; parallel super-steps; supervisor/subagents | 2024–2026 |
| CrewAI | https://github.com/crewAIInc/crewAI · https://docs.crewai.com/ | Role/goal + tasks — steal **job contracts**, not backstory theatre | current |
| MetaGPT | https://github.com/geekan/MetaGPT · https://arxiv.org/abs/2308.00352 | SOPs + structured artifacts > free dialogue | ICLR 2024 |
| ChatDev | https://github.com/OpenBMB/ChatDev · https://arxiv.org/abs/2307.07924 | Chat-chain — **wrong product shape for intel** | ACL 2024 |
| OpenAI Agents SDK | https://openai.github.io/openai-agents-python/ · handoffs + tracing | Typed handoffs; `as_tool` manager; built-in spans | 2025–2026 |
| Anthropic tool use | https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview | Official tool schemas | current |
| Anthropic multi-agent research eng | https://www.anthropic.com/engineering/multi-agent-research-system | Orchestrator–worker; separate contexts; scale effort; ~15× tokens | 2025-06-13 |
| Anthropic writing tools for agents | https://www.anthropic.com/engineering/writing-tools-for-agents | Few high-signal tools; namespaces; concise returns; eval-driven | 2025-09-11 |
| OpenAI Structured Outputs | https://openai.com/index/introducing-structured-outputs-in-the-api/ | Strict JSON Schema adherence | 2024-08 |

### A.2 Papers / patterns

| Title | Authors/Org | URL | Date | Finding used |
|---|---|---|---|---|
| Mixture-of-Agents | Wang et al. (Together/Duke/Stanford) | https://arxiv.org/abs/2406.04692 | 2024 / ICLR 2025 | Independent L1 proposers → aggregators |
| Multiagent Debate | Du et al. | https://arxiv.org/abs/2305.14325 · ICML https://proceedings.mlr.press/v235/du24e.html | 2023/2024 | Propose then critique; not first-pass shared chat |
| MAD (asymmetric) | Liang et al. | https://arxiv.org/abs/2305.19118 | 2023 | Debater vs judge |
| Should we be going MAD? | Smit et al. | https://proceedings.mlr.press/v235/smit24a.html | ICML 2024 | Cost/accuracy tradeoffs; calibrate agreement |
| Multi-LLM Debate interventions | Estornell & Liu | NeurIPS 2024 | 2024 | Diversity/quality pruning vs shared misconception |
| ReAct | Yao et al. | https://arxiv.org/abs/2210.03629 | ICLR 2023 | Act/observe before claim |
| Reflexion | Shinn et al. | https://arxiv.org/abs/2303.11366 | NeurIPS 2023 | Revise after evaluator failure |
| SWE-agent | Yang et al. (Princeton) | https://arxiv.org/abs/2405.15793 | NeurIPS 2024 | ACI: specialist = interface + tools |
| Towards Understanding Sycophancy | Sharma et al. / Anthropic | https://arxiv.org/abs/2310.13548 | 2023 | Agree-with-user over truth |
| Simple synthetic data reduces sycophancy | Wei et al. / Google | https://arxiv.org/abs/2308.03958 | 2023 | Sycophancy mitigations |
| Peacemaker or Troublemaker | — | https://arxiv.org/abs/2509.23055 | 2025 | Inter-agent sycophancy collapses disagreement |
| Easier to Mislead Than to Correct | — | https://arxiv.org/abs/2606.01637 | 2026 | Peer answers → harmful revision |
| Hidden Anchors in Multi-Agent Deliberation | — | https://arxiv.org/abs/2606.19494 | 2026 | Internal anchors pull opinions |
| Persona Inconstancy | Wynn et al. | https://arxiv.org/pdf/2405.03862 | 2024 | Conformity; private post-check recovers diversity |
| When “A Helpful Assistant” Is Not Helpful | Zheng et al. | https://arxiv.org/abs/2311.10054 | 2024 | Persona flavor ≠ capability |
| Blackboard LLM multi-agent | — | https://arxiv.org/abs/2507.01701 | 2025 | Structured shared workspace |
| Temporal Validity / TEPA / Eywa / GPM | various | arXiv:2606.26511, 2608.07429, 2605.30771, 2608.12476 | 2026 | Stale memory, revoke, provenance-before-belief, fail-closed release |

### A.3 Classic / secondary
- Tversky & Kahneman (1974) anchoring — SECONDARY classic.
- Blackboard overview: https://en.wikipedia.org/wiki/Blackboard_system — SECONDARY; ACM Hearsay-II often paywalled.

### A.4 Mechanism takeaway (VERIFIED FACT → RECOMMENDATION)
Copy **independence + tools + evidence board + verifier**; do **not** copy chat-theatre brands as the Council product.

---

## APPENDIX B — Science densify: algorithms & schemas (Waves 3–6)

Source: `waves/SCIENCE_W3-6_SCHEMAS_ALGORITHMS.md` (foldable; does not reopen locks).

### B.1 Mission loop (PROPOSED WR)
```
function run_mission(mission):
  plan = classify_and_decompose(mission)
  workers = plan.selected_agents - {AURORA}   # Aurora never Round-1 author
  results = parallel_map(workers, λ a → a.first_pass(plan.tasks[a], peer=NONE))
  for r in results:
    if not schema_ok(r): reject(r); continue
    if not novelty_ok(r, board): suppress(r); telemetry.echo++
    else: board.append(r.evidence, r.claims)
  lumen.verify(board.claims, tools=plan.tools)
  phoenix.challenge(rank_claims(board), tools=plan.tools)
  return aurora.synthesize(board.snapshot())
```
Early stop if all critical VERIFIED ∧ conflicts.empty ∧ budget_ok.

### B.2 Novelty gate (LOCKED rule)
Accept iff ≥1 of: NEW_EVIDENCE | NEW_CLAIM | CONTRADICTION | RISK | TEST | CAUSAL_EXPLANATION.
Soft echo: cosine > 0.92 and near-duplicate claim text with only NEW_CLAIM → suppress.

### B.3 can_verify (SYSTEM_STATUS / INCIDENT)
Critical claims require evidence rank ≤ 2 (live_telemetry|tool_result) and CURRENT_LIVE within TTL; model_prior alone → never VERIFIED; open CONFLICT → false.

### B.4 Confidence formula (RECOMMENDATION)
```
confidence = clamp(0..1,
  0.15*has_any_evidence + 0.25*has_rank_le_2 + 0.20*multi_source_agree
  + 0.15*fresh_within_ttl + 0.15*lumen_verified + 0.10*phoenix_clear
  − 0.30*open_conflict − 0.20*stale)
```

### B.5 Completion state machine
```
if policy_refuse → REFUSED
if required_tools_blocked → TOOL_BLOCKED
if any critical CONTRADICTED → CONTRADICTED
if any critical STALE without CURRENT_LIVE refresh → STALE
if all critical VERIFIED ∧ no CONFLICT → VERIFIED
if some critical VERIFIED → PARTIALLY_VERIFIED
if budget.exhausted → BUDGET_EXHAUSTED
else → UNVERIFIED
# INVARIANT: UNKNOWN ≠ READY. No READY alias. advisory:true always for Council.
```

### B.6 Default TTLs (tune per deploy)
| Mission class | TTL |
|---|---|
| SYSTEM_STATUS | 60–120 s |
| INCIDENT_RESPONSE | 30–60 s |
| CURRENT_INTEL | 5–15 min |
| DEEP_RESEARCH / ARCHITECTURE / DOCUMENT | 24 h docs; live probes still short |
| ENGINEERING (intel-only) | repo snapshot @ retrieved_at |

Stale promotion forbidden without new CURRENT_LIVE tool_result.

### B.7 TypeScript-shaped canonical types (PROPOSED WR)
EvidenceKind, ClaimLabel, ClaimStatus, Evidence, Claim, AgentEnvelope — as specified in SCIENCE densify file (§C). Board edges: `supports | contradicts | derived_from | stale_of | supersedes`.

---

## APPENDIX C — Legal / authority / provenance locks (Wave 7)

Source: `waves/LEGAL_W7_LOCKS.md`. Not legal advice. Classes: OWNABLE | STREAM_ONLY | REQUIRE-AUTH | HOLD | REFUSE.

### C.1 Capability ≠ authority
- **OWNABLE:** Tool capability ≠ authority. Authority = Commander-granted allowlist per agent × mission × tool.
- **REFUSE:** Auto-escalate because tool exists; invent credentials; treat Browser Broker deny as soft-success; VERIFIED from model_prior.
- **HOLD:** Tool outside allowlist → TOOL_BLOCKED evidence; continue others; never silent invent.

### C.2 Provenance of web / browser evidence
- **OWNABLE:** Evidence must carry kind, source/url, retrieved_at, tool_name, ok; optional hash; license_class PUBLIC|PROVIDER_AUTH|COMMANDER_PRIVATE|STREAM_ONLY.
- **STREAM_ONLY:** Broker/live fetch — cite pointer+timestamp; do not treat restricted HTML scrape as OWNABLE corpus.
- **REFUSE:** Promote secondary/model_prior over live/tool; drop provenance; hotlink-as-ingest without license.
- **HOLD:** Broker deny/timeout → UNVERIFIED or TOOL_BLOCKED.

### C.3 Mission log observability
- **OWNABLE:** Local round telemetry on sovereign store Commander controls.
- **REQUIRE-AUTH:** Export/share off-box; PII/secrets redaction first.
- **HOLD:** Vendor tracing (OpenAI Agents spans) may leave network — STREAM_ONLY unless ZDR/MAM + contract.
- **REFUSE:** Log secrets/cookies/COMMANDER_PRIVATE into vendor traces; fake green when tools failed.

### C.4 Frontier APIs (OpenAI / Anthropic class)
- **VERIFIED FACT:** OpenAI API customer content not used for training by default (as of 2023-03-01); abuse-monitoring retention up to ~30 days; ZDR/MAM require approval; stateful endpoints retain app state even under ZDR. https://developers.openai.com/api/docs/guides/your-data
- **VERIFIED FACT:** Anthropic commercial ZDR available to approved orgs; carveouts for law/misuse; feature eligibility partial. https://platform.claude.com/docs/en/manage-claude/api-and-data-retention
- **OWNABLE:** Prefer local/sovereign for COMMANDER_PRIVATE workers; frontier optional for Phoenix/Aurora with redaction.
- **REQUIRE-AUTH:** Paid org keys; Commander opt-in before private ops to frontier.
- **REFUSE:** Consumer free tiers for private ops; training opt-in; dump full board without redaction; claim ZDR while using ZDR-ineligible stateful features.

### C.5 Legal failure-table addendum
| Failure | Behavior |
|---|---|
| Authority missing | REFUSED; do not execute tool |
| Provenance incomplete | Schema reject / claim stays PROPOSED |
| Vendor retention unknown | HOLD frontier; prefer local |
| Secrets in trace | REFUSE write; scrub + alert Commander |

---

## APPENDIX D — Blind Spot contract attack → §26 acceptance suite expansion

Source: `waves/WAVE_8_BLIND_SPOT_CONTRACT_ATTACK.md`. EBC fails closed if gates soft. **Adopt EBC only if AT-* suite is CI-gated.**

### Residual failure modes (INFERENCE + RECOMMENDATION)
1. Echo survives when workers share identical tool allowlists (hidden peers ≠ diverse evidence) → fingerprint dedup + disjoint tasks.
2. UNKNOWN/LAST_VERIFIED bleeds into READY via UI aliases / empty critical_claim_set → hard critical set + ban READY alias.
3. AURORA summarizes board **prose** if claim.text is essays → claim-shape max tokens + scrub chat partition.
4. Cost blows up: wide classifier / unbounded Phoenix+gap / frontier always-on → hard seat cap + Phoenix ≤2 + local classify.
5. VERIFIED overclaim: LUMEN citation-only / secondary stack / TTL ignore → mandatory re-probe sample + hierarchy + TTL demote.

### Seeded acceptance tests (ADD to engineering CI — complements §26)

| ID | Scenario | Expected | FAIL if |
|---|---|---|---|
| AT-ORION-1 | Parallel identical health probes | Dedup to one evidence | Triple identical probe rows |
| AT-LUMEN-1 | Fabricated evidence_id | UNVERIFIED | VERIFIED without re-check |
| AT-LUMEN-2 | model_prior only | Not VERIFIED | VERIFIED |
| AT-PULSAR-1 | Broker denied | TOOL_BLOCKED / no URL claims | Invented URL |
| AT-NOVA-1 | Port dump | Typed JSON inventory | Prose-only accepted |
| AT-PHOENIX-1 | READY no CURRENT_LIVE | CONFLICT + demotion | Silent pass |
| AT-PHOENIX-2 | Rhetoric-only challenge | Not counted success | Counted success |
| AT-AURORA-1 | Empty board | No verified_facts | Facts emitted |
| AT-AURORA-2 | Critical UNKNOWN open | Not VERIFIED/READY | VERIFIED/READY alias |
| AT-AURORA-3 | Prose-only board (no evidence rows) | Reject / empty facts | Factual brief |
| AT-READY-1 | Health tools off | TOOL_BLOCKED/UNVERIFIED | READY or poetic synonym |
| AT-READY-2 | LAST_VERIFIED only | Not CURRENT_LIVE | CURRENT_LIVE label |
| AT-READY-3 | Ban-list poetry | Reject | Accepted |
| AT-COST-1 | "Status on War Room" | ≤4 agents; PULSAR off | 6 seats / PULSAR on |
| AT-COST-2 | Phoenix loops | Hard passes ≤2 | Unbounded |
| AT-COST-3 | SOCIAL_CHECKIN / focused status | Local classify; frontier optional | Frontier always |
| AT-COST-4 | Duplicate tool fingerprints | Coalesce / early stop | Spam board |
| AT-HIER-1 | Secondary-only evidence | Not VERIFIED | VERIFIED |
| AT-TTL-1 | Evidence age > TTL | STALE / demote | Still VERIFIED |
| AT-CONFLICT-1 | Open CONFLICT | In conflicts[] | Smoothed VERIFIED |
| AT-CLAIM-SHAPE | Essay claim.text >N tokens / no evidence_ids | Schema reject | Boarded |
| AT-BOARD-CHAT | Chat partition reachable to Aurora | Unreachable | Used in brief |

### Contract hardening verdict
| Seat | Keep | Hardening |
|---|---|---|
| ORION | Yes | Tool fingerprint disjointness; no narrative health |
| LUMEN | Yes | Independent re-probe sample; never citation-only VERIFIED |
| PULSAR | Yes | Omit on SYSTEM_STATUS; provenance hard-fail |
| NOVA | Yes | Machine schema only; omit when unused |
| PHOENIX | Yes | Success = demotion \| required_test \| counter-evidence only |
| AURORA | Yes | Board-only; no READY with critical UNKNOWN; no chat partition |

---



---

## APPENDIX E — Historian lineage fold (WAVE_1_HISTORIAN.md)

**Source:** `waves/WAVE_1_HISTORIAN.md` · Avenue: Historian · RESEARCH ONLY · 2026-09-20 ET  
**Purpose:** Prior-art lineages Wave 1 mechanism survey under-specified (HTN, ICS/NIMS, supervisor–worker depth, panel≠intel). Labels: VERIFIED FACT | INFERENCE | RECOMMENDATION.

### E.1 Panel ≠ intel + War Room typed boundaries

| Pattern | Optimized for | Failure as “intel team” | Label |
|---|---|---|---|
| Talk-show / roundtable panel | Fluency, turn-taking, personality contrast | Anchoring; harmony; no evidence objects | INFERENCE (maps Wave 1 failure chain) |
| ChatDev-style company chat chains | Software narrative via dialogue | Cascading hallucination; chat as medium | VERIFIED FACT (ChatDev arXiv:2307.07924; MetaGPT critique arXiv:2308.00352) |
| Personality seats without job contracts | UX identity | Fake specialization | INFERENCE |
| Adaptive “Partial match / Advisory only” | Planner shadow telemetry | Misread as mission health | VERIFIED FACT (WR shadow readout / Adaptive Council labels) |

**Historian lock (RECOMMENDATION):** *Panel* = multi-speaker conversation UX. *Intel* = observe → claim → challenge → synthesize under Commander authority. Do not inherit panel as Council SoT.

| Module | Owns | Does NOT own |
|---|---|---|
| **Council** | Reasoning / multi-agent intel; claims, challenges, synthesis | Foundry builds; Terra globe; Media radio; HVS NLE |
| **Foundry** | Engineering / build | Intel deliberation SoT |
| **Terra / God’s Eye** | Globe, layers, Live Intel *observed* world-state; may SEND TO COUNCIL Observed Data | Media stack; Council analysis; HVS timeline |
| **Media Player** | WR OS audio (radio/news/podcasts) | Terra Cesium; HVS; Council |
| **HVS** | Studio production (NLE / creative / AI Director) | Media densify; Terra; Council intel |

**Hard locks:** HVS ≠ Media ≠ Terra; Terra Live Intel packet separates Observed Data | Council Analysis | Commander Annotation; **capability ≠ authority**; Commander Decide preserved. Council may consume Terra Observed Data and recommend Foundry work — must not absorb module ownership or Act without Commander.

### E.2 Lineage 1 — Blackboard systems

| Era | Milestone | Role |
|---|---|---|
| mid-1970s | HEARSAY-II (CMU/DARPA) | KS post hypotheses to shared multilevel board |
| 1980 | Erman, Hayes-Roth, Lesser, Reddy — ACM Computing Surveys | Canonical blackboard cooperation under uncertainty |
| 1984–85 | Hayes-Roth BB1 (STAN-CS-84-1034) | Domain + control blackboards; control KS |
| 1986 | Nii — Blackboard Systems (AI Magazine) | Survey / KE perspective |
| 2025 | Han & Zhang LbMAS arXiv:2507.01701 | LLM agents R/W shared board; cleaner/conflict roles |

**Primary sources:** Erman et al. 1980 DOI 10.1145/356810.356816; Hayes-Roth BB1 STAN-CS-84-1034; Nii 1986; arXiv:2507.01701.

| STEAL | AVOID |
|---|---|
| Structured board as sole specialist medium (not chat) | Dumping seat essays onto “board” |
| Separate domain (claims/evidence) vs control (agenda) boards | 1980s rule-engine as SoR |
| Agenda-scheduled KS activation (not always-six) | Unbounded board growth without TTL/cleaner |
| Explicit conflict objects; Commander override of control | Treating board consensus as Commander Decide |
| LbMAS cleaner / provenance hygiene (narrow) | Private debate spaces that never republish structured outcomes |

### E.3 Lineage 2 — Hierarchical planners (HTN / SHOP → LLM crews)

| Era | Milestone |
|---|---|
| 1970s | NONLIN (Tate); early HTN |
| 1994 | Erol/Hendler/Nau UMCP; HTN complexity |
| 1998–99 | SHOP (IJCAI-99) — plan in execution order |
| 2001–03 | SHOP2 (JAIR 2003) |
| 2023–26 | Soft HTN: CrewAI hierarchical; LangGraph subgraphs; manager+tools |

**STEAL:** Mission → typed subtasks with method preconditions; primitive tasks = tool operators; plan order respects known world state (SHOP); manager validates subtask completeness not prose.  
**AVOID:** Equating LLM manager with Commander; sequential hierarchical chat as default (anchoring); fake HTN via backstory; always-expand to all agents; classical HTN engine as Council SoR.

### E.4 Lineage 3 — Incident-command / intel-analysis workflows

| Era | Milestone |
|---|---|
| 1970–74 | FIRESCOPE → ICS |
| 2003–04 | HSPD-5 → NIMS; IRTPA / SAT push |
| 2008/2017 | FEMA NIMS doctrine |
| 1999 | Heuer *Psychology of Intelligence Analysis* — ACH |
| late 1970s–90s | Boyd OODA |
| 2000s– | SANS PICERL IR cycle |

**Sources:** FEMA NIMS 2017/2008; FIRESCOPE ICS history; Heuer 1999 (CIA CSI); Boyd Discourse/Patterns; SANS 504-B PICERL; Dhami et al. 2019 ACH empirical caution.

| STEAL | AVOID |
|---|---|
| ICS functional sections → seat **jobs** (not cosplay) | Autonomous Contain/Eradicate/Act |
| Unity of command: Decide = Commander | Full ICS org chart every status mission |
| Typed mission packet (IAP-like) | ACH checklist = truth (mixed empirics) |
| PICERL stage gates for INCIDENT + Lessons memos | Invented classified tradecraft |
| OODA: Observe/Orient in Council; Decide=Commander; Act elsewhere | Council “Decides”; merge Terra panel UX into Council SoT |
| ACH: rival hypotheses; score inconsistency; prefer disconfirm | |

### E.5 Lineage 4 — Debate architectures

| Era | Milestone |
|---|---|
| 2018 | Irving/Christiano/Amodei — AI safety via debate (arXiv:1805.00899) |
| 2023–24 | Du et al. Multiagent Debate (arXiv:2305.14325 / ICML 2024) |
| 2025 | Peacemaker vs Troublemaker (arXiv:2509.23055); Talk Isn't Always Cheap (arXiv:2509.05396) |
| Parallel | Separate verifier / executable check track |

**STEAL:** Independent first positions before critique; Phoenix = explicit troublemaker objective; preserve disagreement into synthesis; generate≠verify; anonymize claim packets; prefer evidence/executable checks over rhetorical win.  
**AVOID:** Debate theater without tools; peacemaker Aurora; majority vote as truth; unbounded rounds; equating Irving training-debate with Council product UX.

### E.6 Lineage 5 — Supervisor–worker patterns

| Era | Milestone |
|---|---|
| Classic OS/HPC | Master–worker pools |
| 2004 | Dean & Ghemawat MapReduce (OSDI) |
| 2010s | Celery / k8s jobs / Airflow DAGs |
| 2023–26 | AutoGen runtime; LangGraph Send; CrewAI manager; OpenAI agents-as-tools vs handoffs |

**STEAL:** Code-orchestrated fan-out of independent workers; typed task→typed result; master re-runs failed probes; agents-as-tools (orchestrator retains control); stage-scoped handoffs; dynamic worker count / early stop.  
**AVOID:** LLM supervisor narrating poetry; handoff of Commander authority; unbounded worker chat; always-N workers; requiring MapReduce cloud brand.

### E.7 Cross-lineage verdict

```
Classic BA + HTN + ICS/OODA + ACH + Debate/verifier + Master–worker
    ⟶  "intel team" architecture

Product UX pressure: Panel chat + personality seats + advisory shadow labels
    ⟶  locked failure mode
```

**RECOMMENDATION:** WR under-applied blackboard/HTN/ICS/ACH/worker lineage and over-applied panel lineage. Realign Council to intel lineage; preserve typed module boundaries and Commander Decide.

### E.8 Consolidated STEAL vs AVOID (Historian top lists)

**STEAL:** (1) Evidence Board as blackboard (dual domain/control); (2) HTN-like mission→subtasks with preconditions, primitive=tool; (3) Parallel independent workers before peer visibility; (4) Phoenix = ACH + troublemaker; (5) Aurora reads board + challenge outcomes, never chat-as-truth; (6) OODA/ICS Decide=Commander; (7) PICERL gates for IR + typed lessons; (8) Orchestrator retains control; capability≠authority.

**AVOID:** (1) Panel chat as SoT; (2) Sequential manager chat default; (3) Personality-without-contract; (4) Debate without evidence; peacemaker synthesis; (5) Majority vote as truth/Decide; (6) Autonomous ICS Act; (7) Merge Council↔Terra/Media/HVS; (8) Essay dumps on blackboard; always-all-agents.

### E.9 Historian source index (H1–H25 class)

Hearsay-II 1980; BB1 1984; Nii 1986; LbMAS arXiv:2507.01701; UMCP/HTN/SHOP/SHOP2 (UMD Nau lineage); FEMA NIMS; FIRESCOPE ICS; Heuer 1999; Boyd Discourse; SANS PICERL; Dhami ACH 2019; Irving debate 2018; Du MAD 2023/24; Peacemaker/Troublemaker 2025; Talk Isn't Always Cheap 2025; MapReduce 2004; OpenAI Agents orchestration docs; CrewAI hierarchical docs; MetaGPT/ChatDev (shared Wave 1); WR typed-boundary stamps (Council/Media/Terra/HVS).

**Fold note:** Historian unique primaries complement §3 / Appendix A — prefer union in rollups; do not double-count blindly.


## Document control / mirrors

| Path | Role |
|---|---|
| `/home/box/war-room-council-intel/WAR_ROOM_COUNCIL_INTELLIGENCE_RESEARCH_REPORT.md` | Canonical |
| `/workspace/war-room-council-intel/WAR_ROOM_COUNCIL_INTELLIGENCE_RESEARCH_REPORT.md` | Workspace mirror |
| `/workspace/terra-swarm/WAR_ROOM_COUNCIL_INTELLIGENCE_RESEARCH_REPORT.md` | Terra-swarm mirror |
| `/workspace/terra-swarm/council-waves/WAR_ROOM_COUNCIL_INTELLIGENCE_RESEARCH_REPORT.md` | PA Nebula council-waves |
| `/home/box/council-intelligence/WAR_ROOM_COUNCIL_INTELLIGENCE_RESEARCH_REPORT.md` | Sibling sync |

Wave stamps: `waves/WAVE_1.md` … `WAVE_8.md` + `COUNCIL_WAVE_*` under terra-swarm/council-waves.

**Stamp: WAVE_8 DONE | Historian Appendix E folded | MASTER REPORT READY**

END REPORT (merged fold + Historian Appendix E)
