# COUNCIL WAVE 1 — HISTORIAN LINEAGE SUPPLEMENT
# STATUS: COMPLETE | 2026-09-20 ~20:50 ET | RESEARCH ONLY — no war-room-os code changes
# Avenue: Avenger Historian · Labels: VERIFIED FACT | INFERENCE | RECOMMENDATION
# Parent: waves/WAVE_1.md (§L fold; Evidence owns §J; panel densify §K) · Mission: COUNCIL_8_WAVES.md Historian lane
# Scope: LINEAGE maps (timeline / prior art / how we got here) — extend thin Wave 1 spots (HTN, ICS/NIMS, supervisor-worker); do not wholesale duplicate §B survey

---

## 0. Purpose

Wave 1 §B already surveys **mechanisms** in modern frameworks (AutoGen, LangGraph, MetaGPT, debate papers, IR one-liners). This Historian deliverable answers: **where did those mechanisms come from**, what prior art already solved (or failed at) War Room’s echo/panel problem, and what to **STEAL vs AVOID** when designing Council as an intel/reasoning layer.

---

## 1. PANEL ≠ INTEL LINEAGE + WAR ROOM TYPED BOUNDARIES

**Sibling densify stamp:** [`HISTORIAN_PANEL_NE_INTEL_BOUNDARIES.md`](./HISTORIAN_PANEL_NE_INTEL_BOUNDARIES.md) (folded as WAVE_1 §K). This file owns full five-avenue *lineage* timelines + steal/avoid; §K owns compressed panel≠intel / module HARD boundaries.


### 1.1 Panel lineage (what Council must *not* inherit as SoT)

| Pattern | What it optimized for | Failure when used as “intel team” | Label |
|---|---|---|---|
| Talk-show / roundtable panel | Rhetorical fluency, turn-taking, personality contrast | Anchoring on first speaker; harmony; no evidence objects | INFERENCE (maps to WAVE_1 §A.1–A.7) |
| ChatDev-style company chat chains | Software narrative via dialogue | Cascading hallucination; chat as medium | VERIFIED FACT (ChatDev arXiv:2307.07924; MetaGPT critique arXiv:2308.00352) |
| Personality-named seats without job contracts | UX identity | Fake specialization | INFERENCE (WAVE_1 §A.3) |
| Adaptive “Partial match / Advisory only” readout | Planner shadow telemetry | Misread as mission health | VERIFIED FACT (WR shadowReadout / AdaptiveCouncilReadout — WAVE_1 §A.8) |

**Historian lock:** *Panel* = multi-speaker conversation UX. *Intel* = structured observe → claim → challenge → synthesize under Commander authority. War Room’s locked failure narrative is panel-shaped runtime on an intel-shaped product goal. **RECOMMENDATION:** treat panel as anti-pattern lineage for Council SoT, not as heritage to preserve.

### 1.2 Prior War Room typed boundaries (do not merge)

| Module | Owns | Does NOT own | Prior lock source (box) |
|---|---|---|---|
| **Council** | Reasoning / multi-agent intel layer; claims, challenges, synthesis for Commander | Building software (Foundry); world-state globe; radio player; studio NLE | `COUNCIL_8_WAVES.md` Locks; `MISSION_BRIEF.md` |
| **Foundry** | Engineering / build | Intel deliberation SoT | Mission preserve list |
| **Terra / God’s Eye** | Globe, layers, Live Intel *observed* world-state; may **SEND TO COUNCIL** Observed Data | Media Player radio stack; Council analysis; HVS timeline | `LIVE_INTEL_PANEL_REVAMP_EXECUTION_PROMPT_FINAL.md`; `GODS_EYE_FINAL_SUMMARY.md` |
| **Media Player** | Sibling WR OS audio module (radio/news/podcasts/CAP duck; STREAM_ONLY\|LINK_OUT\|HOLD\|REFUSE) | Terra Cesium; HVS studio; Council | `CHATGPT_WAR_ROOM_MEDIA_REVIEW_PROMPT.md`; HVS Historian |
| **HVS (Higher Vision Studios)** | **NEW** major section — native studio production (NLE + CapCut-style creative + AI Director) | Media Player densify; Terra; Council intel | `higher-vision-studios/HVS_8_WAVES.md`; `historian-wave1-lineage.md` |

**Hard locks (VERIFIED FACT from prior WR research stamps):**
- HVS ≠ Media Player ≠ Terra
- Media Player ≠ Terra (do not merge radio into globe)
- Terra Live Intel → Council packet separates **Observed Data** | **Council Analysis** | **Commander Annotation**
- **Commander authority preserved**; **capability ≠ authority** (adaptive `tool_eligible` ≠ granted probe rights — WAVE_1 §A.4/E)

**RECOMMENDATION:** Council may *consume* Terra Observed Data and *recommend* Foundry work; it must not absorb Terra/Media/HVS module ownership or act without Commander Decide.

---

## 2. LINEAGE 1 — BLACKBOARD SYSTEMS

### 2.1 Timeline (brief)

| Era | Milestone | Role in lineage |
|---|---|---|
| mid-1970s | HEARSAY-II speech understanding (CMU / DARPA) | First major blackboard: independent **knowledge sources (KS)** post **hypotheses** to shared multilevel board; focus-of-attention scheduler |
| 1980 | Erman, Hayes-Roth, Lesser, Reddy — ACM Computing Surveys | Canonical description of blackboard cooperation under uncertainty |
| 1984–85 | Barbara Hayes-Roth **BB1** (STAN-CS-84-1034 / HPP-84-16) | Explicit **domain + control** blackboards; control KS; explain/learn about own control |
| 1986 | H. Penny Nii — *Blackboard Systems* (AI Magazine) | Survey / knowledge-engineering perspective of BA |
| 1980s–90s | Domain adaptations (sensor fusion, image understanding, etc.) | Pattern spreads beyond speech |
| 2025 | Han & Zhang — LLM blackboard MAS (LbMAS), arXiv:2507.01701 | Agents read/write shared board; control unit selects who acts; public/private spaces; cleaner/conflict-resolver roles |

### 2.2 Key primary sources

1. Erman, Hayes-Roth, Lesser, Reddy (1980). *The Hearsay-II Speech-Understanding System…* ACM Computing Surveys 12(2). https://doi.org/10.1145/356810.356816  
2. Hayes-Roth, B. (1984). *BB1: An architecture for blackboard systems that control, explain, and learn about their own behavior.* Stanford CS-TR-84-1034. PDF: http://i.stanford.edu/pub/cstr/reports/cs/tr/84/1034/CS-TR-84-1034.pdf · catalog: http://i.stanford.edu/TR/CS-TR-84-1034.html  
3. Nii, H.P. (1986). Blackboard systems (AI Magazine survey lineage — cited throughout BA literature; DOI class 10.1609/aimag.v7i3.550).  
4. Han & Zhang (2025). *Exploring Advanced LLM Multi-Agent Systems Based on Blackboard Architecture.* arXiv:2507.01701 https://arxiv.org/abs/2507.01701 · HTML: https://arxiv.org/html/2507.01701  

### 2.3 STEAL for War Room Council

| Steal | Why | Label |
|---|---|---|
| Shared **structured** board as sole communication medium among specialists | KS do not chat; they post hypotheses/partial solutions | VERIFIED FACT (Hearsay-II / BB1) → RECOMMENDATION (Evidence Board = blackboard) |
| Separate **domain** board (claims/evidence) from **control** board (agenda: who runs next, mission stage) | BB1’s dual-board insight | VERIFIED FACT → RECOMMENDATION |
| Opportunistic / agenda-scheduled activation (right KS for current board state) | Avoids always-six-agents every mission | VERIFIED FACT (BA) + INFERENCE (WR cost trap) |
| Explicit conflict / inconsistency objects on board | Phoenix challenges *objects*, not tone | INFERENCE → RECOMMENDATION |
| Cleaner / provenance hygiene on board (LbMAS cleaner role as prior art) | Token + signal control | VERIFIED FACT (arXiv:2507.01701) → RECOMMENDATION (narrow) |
| Human override of control recommendation (BB1 UI: accept override) | Maps to Commander authority | VERIFIED FACT (BB1) → RECOMMENDATION |

### 2.4 AVOID

| Avoid | Why | Label |
|---|---|---|
| Dumping raw seat essays onto the “board” | Recreates chat log as SoT; defeats BA | RECOMMENDATION |
| 1980s rule-engine complexity as implementation SoR | LLM ergonomics differ; pattern ≠ Lisp KS rewrite | RECOMMENDATION |
| Unbounded blackboard growth without cleaner / TTL / typed layers | Prompt bloat; stale claims | INFERENCE |
| Treating LbMAS “consensus on blackboard” as Commander Decide | Consensus ≠ authority | RECOMMENDATION |
| Private debate spaces that never re-publish structured outcomes | Shadow essays outside audit | RECOMMENDATION |

---

## 3. LINEAGE 2 — HIERARCHICAL PLANNERS (HTN / SHOP → LLM CREWS)

### 3.1 Timeline (brief)

| Era | Milestone | Role |
|---|---|---|
| 1970s | NONLIN (Tate), early HTN practice | Hierarchical decomposition of tasks into subtasks |
| 1990–91 | SIPE-2 (Wilkins), O-PLAN (Currie & Tate) | Applied HTN planning systems |
| 1994 | Erol, Hendler, Nau — UMCP; HTN complexity/expressivity | Formal soundness/completeness for HTN |
| 1998–99 | Nau et al. — ordered task decomposition; **SHOP** (IJCAI-99) | Plan in execution order; know full world state at each step |
| 2001–03 | **SHOP2** (JAIR 2003) — IPC 2002 distinguished performance | Partial-order subtasks + temporal/metric domains |
| 2023–26 | LLM “hierarchical crews / managers” (CrewAI hierarchical process; manager agents; LangGraph subgraphs; OpenAI manager+tools) | Soft HTN: decompose mission → tasks → specialist agents — usually **without** formal method preconditions |

### 3.2 Key primary sources

1. Erol, Hendler, Nau (1994). *UMCP: A Sound and Complete Procedure for Hierarchical Task-Network Planning.* https://www.cs.umd.edu/~nau/papers/erol1994umcp.pdf  
2. Erol, Hendler, Nau (1994). *HTN Planning: Complexity and Expressivity.* AAAI-94. https://www.cs.umd.edu/~nau/papers/erol1994htn.pdf  
3. Nau, Cao, Lotem, Muñoz-Avila (1999). *SHOP: Simple Hierarchical Ordered Planner.* IJCAI-99. https://www.cs.umd.edu/~nau/papers/nau1999shop.pdf  
4. Nau et al. (2003). *SHOP2: An HTN Planning System.* JAIR 20:379–404. https://www.cs.umd.edu/~nau/papers/nau2003shop2.pdf · https://www.jair.org/index.php/jair/article/view/10362  
5. UMD SHOP project overview: http://www.cs.umd.edu/projects/shop/description.html  
6. Modern soft-HTN docs (mechanism, not formal HTN): CrewAI hierarchical process https://docs.crewai.com/edge/en/learn/hierarchical-process ; OpenAI Agents orchestration https://openai.github.io/openai-agents-python/multi_agent/

### 3.3 STEAL for War Room Council

| Steal | Why | Label |
|---|---|---|
| **Task networks**: mission → typed subtasks with methods/operators | SYSTEM_STATUS decomposes to probe set; IR to PICERL stages | VERIFIED FACT (HTN) → RECOMMENDATION |
| Plan in an order that respects **known world state** (SHOP insight) | Don’t claim health before Observe probes | VERIFIED FACT → RECOMMENDATION |
| Explicit **method preconditions** (when a decomposition is legal) | Mission classifier gates which seats/tools activate | VERIFIED FACT → RECOMMENDATION |
| Primitive tasks = **executable** actions (operators), not essays | Maps to tool_result requirements | INFERENCE → RECOMMENDATION |
| Manager validates **completeness of subtask outcomes**, not prose style | Soft HTN usable without crowning manager as Commander | RECOMMENDATION |

### 3.4 AVOID

| Avoid | Why | Label |
|---|---|---|
| Equating CrewAI/LLM “manager” with Commander | Authority lock; manager is orchestration, not Decide | RECOMMENDATION |
| Hierarchical **sequential** crew as default intel path | Recreates anchoring (WAVE_1 §B.3 / §C) | VERIFIED FACT (mechanism risk) |
| Fake HTN: backstory roles without preconditions/operators | Personality-over-job | INFERENCE |
| Full classical HTN engine as Council SoR | Overkill; borrow *concepts*, not UMCP rewrite | RECOMMENDATION |
| Expanding task tree until always-all-agents | Cost trap; HTN should prune | RECOMMENDATION |

---

## 4. LINEAGE 3 — INCIDENT-COMMAND / INTEL-ANALYSIS WORKFLOWS

### 4.1 Timeline (brief)

| Era | Milestone | Role |
|---|---|---|
| 1970 | Southern CA wildfire coordination failures → FIRESCOPE | Birth of multi-agency incident management need |
| 1974 | FIRESCOPE Field Command Operations System → renamed **Incident Command System (ICS)** | Standardized on-scene command structure |
| 1980s–90s | ICS spreads beyond wildfire | Common language: Command / Ops / Planning / Logistics / Finance-Admin |
| 2003–04 | HSPD-5 → **NIMS**; IRTPA 2004 pushes structured analytic techniques | National template; SAT mandate class for IC |
| 2008 / 2017 | FEMA NIMS doctrine updates | Current public ICS/NIMS baseline |
| 1970s–99 | Heuer SATs; *Psychology of Intelligence Analysis* (1999) — **ACH** | Disconfirmation-oriented analytic method |
| late 1970s–90s | Boyd **OODA** briefings (*Patterns of Conflict*; *Discourse on Winning and Losing*) | Observe–Orient–Decide–Act decision cycle |
| 2000s– | SANS IR teaching cycle **PICERL** | Prepare–Identify–Contain–Eradicate–Recover–Lessons |

### 4.2 Key primary sources

1. FEMA (2017). *National Incident Management System.* https://www.fema.gov/sites/default/files/2020-07/fema_nims_doctrine-2017.pdf  
2. FEMA (2008). *NIMS* (prior doctrine PDF). https://www.fema.gov/sites/default/files/2020-07/national_incident_management_system_dec2008.pdf  
3. FIRESCOPE ICS history (Cal OES): https://firescope.caloes.ca.gov/SiteCollectionDocuments/ICS%20History%20and%20Progression.pdf  
4. Heuer, R.J. Jr. (1999). *Psychology of Intelligence Analysis* (CIA CSI). PDF: https://www.cia.gov/resources/csi/static/9a5f1162fd0932c29bfed1c030edf4ae/Pyschology-of-Intelligence-Analysis.pdf — ACH in Ch. 8  
5. Boyd materials: *Patterns of Conflict* (1986 briefing) archive PDF class; *A Discourse on Winning and Losing* (govinfo/Air University compilation): https://www.govinfo.gov/content/pkg/GOVPUB-D301-PURL-gpo94257/pdf/GOVPUB-D301-PURL-gpo94257.pdf  
6. SANS 504-B PICERL cheat-sheet (2016): https://www.sans.org/media/score/504-incident-response-cycle.pdf  
7. Empirical caution on ACH: Dhami et al. (2019) *Applied Cognitive Psychology* — ACH mixed effects; process ≠ guaranteed accuracy. https://onlinelibrary.wiley.com/doi/full/10.1002/acp.3550  

### 4.3 STEAL for War Room Council

| Steal | Why | Label |
|---|---|---|
| ICS **functional sections** metaphor → seat **jobs** (Ops=probes, Planning=claims board, Intel/Phoenix=challenge) — not personality cosplay | Clear span of control | INFERENCE → RECOMMENDATION |
| **Unity of command / Commander as IC** | Decide/Act authority stays human | VERIFIED FACT (ICS doctrine) → RECOMMENDATION |
| Incident Action Plan–like **typed mission packet** (objectives, resources, stage) | Replaces essay mission prompts | RECOMMENDATION |
| PICERL as **mission-stage gates** for INCIDENT_RESPONSE (and Lessons → Reflexion memos) | Stage-gated tools | VERIFIED FACT (SANS 504-B) → RECOMMENDATION |
| OODA split: Observe=probes; Orient=board; **Decide=Commander**; Act=Foundry/ops under authority | Prevents autonomous Act | VERIFIED FACT (OODA) + WR lock → RECOMMENDATION |
| ACH-style: list rival hypotheses; score **inconsistency**; prefer disconfirmation | Phoenix job core | VERIFIED FACT (Heuer) → RECOMMENDATION |
| Audit trail / matrix as product (ACH benefit even when answer uncertain) | Provenance for Aurora | VERIFIED FACT → RECOMMENDATION |

### 4.4 AVOID

| Avoid | Why | Label |
|---|---|---|
| Autonomous Contain/Eradicate/Act without Commander | NIMS/ICS are human command systems; WR authority lock | RECOMMENDATION |
| Cosplaying full ICS org chart every status mission | Bureaucracy theater | RECOMMENDATION |
| Treating ACH checklist completion as truth | Empirical mixed results (Dhami 2019) | VERIFIED FACT |
| Inventing classified tradecraft / fake “secret” SATs | Out of scope; public Heuer only | RECOMMENDATION |
| Collapsing OODA so Council “Decides” | Capability ≠ authority | RECOMMENDATION |
| Merging Terra Live Intel panel UX into Council deliberation SoT | Typed boundary | VERIFIED FACT (prior locks) |

---

## 5. LINEAGE 4 — DEBATE ARCHITECTURES

### 5.1 Timeline (brief)

| Era | Milestone | Role |
|---|---|---|
| 2018 | Irving, Christiano, Amodei — *AI safety via debate* | Two agents argue; **weaker judge** picks; scalable oversight framing |
| 2023–24 | Du et al. — Multiagent Debate (arXiv:2305.14325 / ICML 2024) | Multiple LLM instances critique/revise; factuality gains **when disagreement preserved** |
| 2023–25 | ChatEval / Exchange-of-Thought / MultiPersona class | Role-play debate variants (often consensus-seeking) |
| 2025 | Peacemaker vs Troublemaker (arXiv:2509.23055); Talk Isn't Always Cheap (arXiv:2509.05396) | Inter-agent sycophancy; majority tyranny; persuasive falsehoods; debate can **degrade** |
| 2025–26 | Identity skew / anonymization (ACL 2026 long.650 class) | Prestige/identity biases peer weight |
| Parallel track | Separate **verifier / reward model / executable check** | Generate ≠ verify objectives |

### 5.2 Key primary sources

1. Irving, Christiano, Amodei (2018). *AI safety via debate.* arXiv:1805.00899 https://arxiv.org/abs/1805.00899 · OpenAI note: https://openai.com/index/debate/  
2. Du et al. (2023/2024). *Improving Factuality and Reasoning through Multiagent Debate.* arXiv:2305.14325 https://arxiv.org/abs/2305.14325 · PMLR: https://proceedings.mlr.press/v235/du24e.html  
3. Yao et al. (2025). *Peacemaker or Troublemaker…* arXiv:2509.23055  
4. *Talk Isn't Always Cheap…* (2025) arXiv:2509.05396  
5. *When Identity Skews Debate* — ACL 2026 anthology 2026.acl-long.650 (cited WAVE_1 §F.1)  

### 5.3 STEAL for War Room Council

| Steal | Why | Label |
|---|---|---|
| Independent first positions before critique (Du setup) | Cuts anchoring | VERIFIED FACT → RECOMMENDATION |
| Explicit **adversarial / troublemaker** objective for Phoenix | Anti-peacemaker | VERIFIED FACT (2509.23055) → RECOMMENDATION |
| Preserve disagreement into synthesis inputs | Flat harmony = failure | VERIFIED FACT → RECOMMENDATION |
| Separate generate vs verify (Irving judge / verifier class) | Aurora must not be style judge | VERIFIED FACT (class) → RECOMMENDATION |
| Anonymize claim packets in review (strip seat prestige) | Identity bias mitigation | VERIFIED FACT → RECOMMENDATION |
| Prefer executable / evidence checks over rhetorical win | SWE-bench spirit | INFERENCE → RECOMMENDATION |

### 5.4 AVOID

| Avoid | Why | Label |
|---|---|---|
| Debate theater without tools/evidence | Literature: accuracy can fall | VERIFIED FACT |
| Peacemaker synthesizer (Aurora as harmony summarizer) | Judge sycophancy | VERIFIED FACT |
| Majority vote as truth | Tyranny of the majority | VERIFIED FACT (2509.05396) |
| Unlimited debate rounds | Cost; collapse to paraphrase | INFERENCE |
| Equating Irving training-debate with Council product UX | Different purpose (oversight training vs intel runtime) | RECOMMENDATION |

---

## 6. LINEAGE 5 — SUPERVISOR–WORKER PATTERNS

### 6.1 Timeline (brief)

| Era | Milestone | Role |
|---|---|---|
| Classic OS / HPC | Master–worker / boss–worker pools | Central dispatcher assigns tasks; workers return results |
| 2004 | Dean & Ghemawat — **MapReduce** (OSDI) | Master schedules map/reduce; workers execute partitions; fault re-exec |
| 2010s | Celery / queue workers; Kubernetes jobs; Airflow DAGs | Production orchestrator + workers |
| 2023–26 | LLM orchestrators: AutoGen runtime, LangGraph, CrewAI manager, OpenAI **Agents as tools** vs **Handoffs** | Soft master–worker; LLM may *be* the supervisor |

### 6.2 Key primary sources

1. Dean & Ghemawat (2004). *MapReduce: Simplified Data Processing on Large Clusters.* OSDI. PDF: https://static.googleusercontent.com/media/research.google.com/en/us/archive/mapreduce-osdi04.pdf · https://research.google.com/archive/mapreduce.html  
2. OpenAI Agents SDK — Agent orchestration (manager+tools vs handoffs): https://openai.github.io/openai-agents-python/multi_agent/  
3. AutoGen Core agent runtime / message delivery (WAVE_1 §B.1 URLs)  
4. LangGraph graph API / `Send` fan-out (WAVE_1 §B.2)  

### 6.3 STEAL for War Room Council

| Steal | Why | Label |
|---|---|---|
| **Code-orchestrated** fan-out of independent workers (MapReduce / asyncio.gather / LangGraph parallel) | Parallel first-pass without peer conditioning | VERIFIED FACT → RECOMMENDATION |
| Typed task assignment + typed result schema | Workers return claims/evidence IDs, not essays | RECOMMENDATION |
| Master tracks failures and **re-runs** failed probes | IR reliability | VERIFIED FACT (MapReduce fault model) → RECOMMENDATION |
| **Agents-as-tools**: orchestrator retains control; specialists are bounded | Supervisor ≠ Commander; still retains synthesis hook | VERIFIED FACT (OpenAI docs) → RECOMMENDATION |
| Handoffs only when specialist must **own** a bounded stage (e.g., Phoenix challenge stage) | Prevents perpetual chat ownership drift | VERIFIED FACT → RECOMMENDATION |
| Dynamic worker count / early stop | Cost/latency (Wave 7) | RECOMMENDATION |

### 6.4 AVOID

| Avoid | Why | Label |
|---|---|---|
| LLM supervisor that narrates worker results into poetry | Echo at one level up | RECOMMENDATION |
| Handoff that transfers **Commander authority** | Authority lock | RECOMMENDATION |
| Unbounded worker chat among themselves | Recreates panel | RECOMMENDATION |
| Always-N workers regardless of mission | Cost trap | INFERENCE |
| Treating MapReduce brand / cloud dependency as required | Pattern portable locally | RECOMMENDATION |

---

## 7. CROSS-LINEAGE: HOW WE GOT TO WAR ROOM COUNCIL’S PROBLEM

```
Classic BA (hypotheses on board)
    + HTN (mission → executable subtasks)
    + ICS/OODA (human command; stage gates)
    + ACH (rival hypotheses; disconfirm)
    + Debate/verifier (adversarial check)
    + Master–worker (parallel probes)
        ⟶  "intel team" architecture

Meanwhile product UX pressure favored:
Panel chat + personality seats + advisory shadow labels
        ⟶  locked failure mode (WAVE_1 §A.9)
```

**Historian verdict (RECOMMENDATION):** War Room does not lack prior art — it under-applied blackboard/HTN/ICS/ACH/worker lineage and over-applied panel lineage. Fix = realign Council to the intel lineage while preserving typed module boundaries and Commander Decide.

---

## 8. CONSOLIDATED STEAL vs AVOID (Historian top lists)

### 8.1 Top STEAL items (for fold / Wave 8)

1. Evidence Board as **blackboard** (structured hypotheses only; dual domain/control)  
2. HTN-like mission → subtasks with **preconditions** and **primitive=tool** operators  
3. Parallel independent workers (MapReduce/LangGraph-class fan-out) before any peer visibility  
4. Phoenix = ACH + troublemaker/verifier job (disconfirm; challenge objects)  
5. Aurora consumes **board + challenge outcomes**, never chat transcript as truth  
6. OODA/ICS: Observe/Orient in Council; **Decide = Commander**; Act elsewhere under authority  
7. PICERL stage gates for IR missions + Lessons → typed postmortems  
8. Orchestrator retains control (agents-as-tools); capability ≠ authority; handoffs stage-scoped  

### 8.2 Top AVOID items

1. Panel/roundtable chat as Council SoT  
2. Sequential hierarchical manager chat (anchoring)  
3. Personality-without-contract specialization  
4. Debate without tools/evidence; peacemaker synthesis  
5. Majority vote / consensus as truth or as Commander Decide  
6. Autonomous ICS Act/Contain  
7. Merging Council into Terra / Media Player / HVS (or reverse)  
8. Dumping essays onto the “blackboard”; always-all-agents  

---

## 9. SOURCE INDEX (Historian avenue)

| # | Source | URL / locator |
|---|---|---|
| H1 | Erman et al. 1980 Hearsay-II | https://doi.org/10.1145/356810.356816 |
| H2 | Hayes-Roth BB1 1984 STAN-CS-84-1034 | http://i.stanford.edu/pub/cstr/reports/cs/tr/84/1034/CS-TR-84-1034.pdf |
| H3 | Nii blackboard survey 1986 (AI Mag DOI class) | 10.1609/aimag.v7i3.550 |
| H4 | Han & Zhang LLM blackboard 2025 | https://arxiv.org/abs/2507.01701 |
| H5 | Erol/Hendler/Nau UMCP 1994 | https://www.cs.umd.edu/~nau/papers/erol1994umcp.pdf |
| H6 | Erol/Hendler/Nau HTN complexity 1994 | https://www.cs.umd.edu/~nau/papers/erol1994htn.pdf |
| H7 | Nau et al. SHOP 1999 | https://www.cs.umd.edu/~nau/papers/nau1999shop.pdf |
| H8 | Nau et al. SHOP2 JAIR 2003 | https://www.cs.umd.edu/~nau/papers/nau2003shop2.pdf |
| H9 | FEMA NIMS 2017 | https://www.fema.gov/sites/default/files/2020-07/fema_nims_doctrine-2017.pdf |
| H10 | FEMA NIMS 2008 | https://www.fema.gov/sites/default/files/2020-07/national_incident_management_system_dec2008.pdf |
| H11 | FIRESCOPE ICS history | https://firescope.caloes.ca.gov/SiteCollectionDocuments/ICS%20History%20and%20Progression.pdf |
| H12 | Heuer Psychology of Intelligence Analysis 1999 | https://www.cia.gov/resources/csi/static/9a5f1162fd0932c29bfed1c030edf4ae/Pyschology-of-Intelligence-Analysis.pdf |
| H13 | Boyd Discourse / Patterns compilation | https://www.govinfo.gov/content/pkg/GOVPUB-D301-PURL-gpo94257/pdf/GOVPUB-D301-PURL-gpo94257.pdf |
| H14 | SANS 504-B PICERL | https://www.sans.org/media/score/504-incident-response-cycle.pdf |
| H15 | Dhami et al. ACH empirical 2019 | https://onlinelibrary.wiley.com/doi/full/10.1002/acp.3550 |
| H16 | Irving et al. AI safety via debate 2018 | https://arxiv.org/abs/1805.00899 |
| H17 | Du et al. Multiagent Debate 2023/24 | https://arxiv.org/abs/2305.14325 |
| H18 | Peacemaker/Troublemaker 2025 | arXiv:2509.23055 |
| H19 | Talk Isn't Always Cheap 2025 | arXiv:2509.05396 |
| H20 | Dean & Ghemawat MapReduce 2004 | https://static.googleusercontent.com/media/research.google.com/en/us/archive/mapreduce-osdi04.pdf |
| H21 | OpenAI Agents orchestration docs | https://openai.github.io/openai-agents-python/multi_agent/ |
| H22 | CrewAI hierarchical process docs | https://docs.crewai.com/edge/en/learn/hierarchical-process |
| H23 | MetaGPT arXiv:2308.00352 | (shared with WAVE_1 §F) |
| H24 | ChatDev arXiv:2307.07924 | (shared with WAVE_1 §F) |
| H25 | WR typed-boundary stamps | `COUNCIL_8_WAVES.md`; Media/Terra/HVS prompts; `higher-vision-studios/historian-wave1-lineage.md` |

**Historian unique primary count: 25** (H1–H25). Overlap with WAVE_1 §F acknowledged; do not double-count blindly in Wave 8 rollup — prefer union.

---

## 10. HANDOFF

- Folded summary → `WAVE_1.md` §L  
- Wave 2+: role contracts should cite ICS-job + ACH-Phoenix, not panel personas  
- Wave 4: Evidence Board ≡ BA domain blackboard  
- Wave 5: mission classifier ≡ soft HTN method selection  
- Wave 6: Phoenix/Aurora ≡ verifier + board reader  
- Blind Spot: watch panel relapse, ACH-as-theater, manager-as-Commander, module merges  

**STATUS: HISTORIAN LINEAGE SUPPLEMENT COMPLETE — research only**
