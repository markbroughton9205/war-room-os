# COUNCIL WAVE 1 — FAILURE MECHANISMS + MULTI-AGENT SYSTEMS SURVEY
# STATUS: COMPLETE (research deliverable) | 2026-09-20 ~20:45 ET | RESEARCH ONLY
# Labels: VERIFIED (cited) | INFERENCE | PROPOSED FOR WAR ROOM
# Folds → Report §§1–4 | No code / commit / push / deploy | Do not modify war-room-os
# Mission: COUNCIL_INTELLIGENCE_MISSION.md · Plan: COUNCIL_8_WAVES_PLAN.md

---

## 0. Executive findings (top mechanisms)

| # | Finding | Label | Council implication |
|---|---|---|---|
| 1 | Shared sequential peer context produces **inter-agent sycophancy** and **anchoring** on the first fluent speaker | VERIFIED (literature) + INFERENCE (WR path) | First-pass seats must not see peer essays |
| 2 | Free-form essay turns optimize for **rhetorical coherence**, not **falsifiable claims** | INFERENCE | Require claim/evidence schemas |
| 3 | Personality-over-job prompts fake specialization without **job-gated tools/outputs** | INFERENCE | Role = contract + tools + metrics |
| 4 | Without **mandatory tools / probes**, status missions invent readiness from priors | INFERENCE | SYSTEM_STATUS → probe gate |
| 5 | Revision-without-evidence-delta collapses to **paraphrase** | VERIFIED (failure literature) + INFERENCE | Info-gain rule for REVISE |
| 6 | Aurora-as-prose-summarizer is **judge sycophancy** risk | VERIFIED (MADS papers) | Aurora synthesizes verified claims only |
| 7 | "Partial match / Advisory only" labels **shadow planning vs execution**, not mission completion | VERIFIED (WR code) | Replace with typed completion states |
| 8 | Best external mechanisms to copy: **blackboard + structured SOPs + independent first pass + tool loop + adversarial verifier**; avoid cargo-cult ChatDev chat chains as the intel core | PROPOSED FOR WAR ROOM | See §C comparison table |

---

## A. CURRENT FAILURE MECHANISMS (not agent personalities)

Locked observational target (mission):  
`ORION narrative → LUMEN echo → PHOENIX soft challenge → revisions paraphrase → AURORA summarizes prose`  
plus UI/status gloss: `"Adaptive Council · Partial match · Advisory only"` without runtime probes/tools/evidence.

### A.1 Shared sequential context → anchoring + sycophancy

**Mechanism.** When agent B's prompt includes agent A's full (or even brief) narrative before B forms an independent position, B's generation is conditioned on A's tokens. Classical **anchoring** (Tversky & Kahneman, 1974) predicts insufficient adjustment from the first number/frame. LLM analogues:

| Effect | Definition (operational) | Evidence |
|---|---|---|
| User–LLM sycophancy | Prefer answers matching user beliefs over truth | Sharma et al., 2023/2024 — *Towards Understanding Sycophancy in Language Models*, arXiv:2310.13548 |
| Inter-agent sycophancy (MADS) | Excessive alignment with peers; harmony over role objective | Yao/Peacemaker-Troublemaker, 2025 — arXiv:2509.23055 |
| Disagreement collapse | Premature consensus on incorrect conclusion | Same; also Estornell & Liu 2024 "tyranny of the majority" cited in arXiv:2509.05396 |
| Identity bias | Weight peer/self identity over content | ACL 2026 *When Identity Skews Debate* — anonymization reduces bias |
| Correct→incorrect flip | Seeing peer reasoning causes abandoning a correct answer | *Talk Isn't Always Cheap*, arXiv:2509.05396 |

**War Room mapping (INFERENCE from architecture + mission lock).**  
Family-deliberation runtime builds prompts with `priorTurns` (`lib/council/family-deliberation/runtime.ts`). Even when briefs are compressed (validation case `deliberation_01_family_b_receives_a_id_and_content`), **any** peer conclusion text before independent freeze is an anchor. Scout-swarm already experiments with `INDEPENDENT_DISCOVERY` isolation (`lib/council/scout-swarm/prompts.ts`) — that is the *correct* anti-echo direction, but the locked failure mode remains the essay-panel path where isolation is absent or incomplete.

**Label:** VERIFIED (cognitive/AI literature) + INFERENCE (WR sequential conditioning) + PROPOSED (hide peer outputs until freeze).

### A.2 Free-form essay turns

**Mechanism.** Unconstrained natural-language turns reward:

1. Narrative continuity with prior speakers  
2. Confident tone (judge preference for persuasive falsehoods documented in Agarwal & Khanna 2025, cited in arXiv:2509.05396)  
3. Length and style matching (judge sycophancy / stylistic echo — arXiv:2509.23055)

They do **not** force: claim IDs, tool call IDs, evidence IDs, UNKNOWN markers, or contradiction lists.

**War Room mapping.** Mission poetic REFUSE examples ("quiet before the storm", "poised for action", "ready and waiting") are symptoms of essay optimization under status prompts without probe gates.

**Label:** INFERENCE (mechanism) · PROPOSED (structured returns mandatory for SYSTEM_STATUS).

### A.3 Personality-over-job prompts

**Mechanism.** Naming seats ORION/LUMEN/PHOENIX/AURORA (or ARCHITECT/STRATEGIST/…) plus flavor text creates **appearance** of specialization. Without:

- distinct tool allowlists  
- distinct output schemas  
- success metrics per role  
- refusal to speak outside job  

…models converge to the same next-token distribution conditioned on the shared mission text. PersonalityVersion fields (`personalityVersion: 'genesis-1'` in `CouncilEntityRegistry.ts`) are identity metadata, not job enforcement.

**Literature link.** Role prompts alone underperform **SOP + structured artifacts** (MetaGPT: documents/diagrams over chat — Hong et al., arXiv:2308.00352). ChatDev's instructor/assistant chat chains still suffer cascading hallucination when structure is weak (Qian et al., ChatDev, arXiv:2307.07924).

**Label:** INFERENCE · PROPOSED (Wave 2 owns contracts; Wave 1 flags the failure class).

### A.4 No mandatory tools / probes

**Mechanism.** ReAct (Yao et al., 2022/2023) and computer-use / tool-use loops treat **action** as part of reasoning. Absent a required tool step, the model fills gaps from parametric memory — catastrophic for "Status on War Room" where truth is in runtime, ports, logs, branch, Core/UI health.

Anthropic tool-use pattern (official docs): model emits `tool_use` → client executes → `tool_result` returns — authority stays in the harness, not the essay. OpenAI Agents SDK / computer tool: structured actions + screenshot/observation loop. SWE-agent / OpenHands: agent–computer interface (ACI) so the model cannot "claim" a patch without touching the environment.

**War Room mapping.** Adaptive assembly marks `tool_eligible` / `research_eligible` as capability vocabulary (`UNIFIED_ADAPTIVE_COUNCIL_ASSEMBLY.md`) but Phase 48-C3B1 is explicitly **advisory planning only** — "Recommended assembly — not used for execution." Capability vocabulary ≠ tool authority.

**Label:** VERIFIED (tool-loop literature + WR advisory docs) · PROPOSED (mission-type → mandatory probe set).

### A.5 No structured claims / evidence

**Mechanism.** Without atomic claims (`claim_id`, `claim_text`, `evidence_ids[]`, `confidence`, `status`), Phoenix cannot challenge *objects* — only prose tone. Blackboard architectures (Hayes-Roth BB1; classic AI) exist precisely so specialists post **partial results** to a shared structure, not essays to each other.

MetaGPT's core claim: agents communicate through **documents and diagrams**, reducing irrelevant/missing content vs ChatDev-style dialogue (arXiv:2308.00352 §3).

Scout-swarm already defines `AtomicClaim`, `PhoenixChallengeResult`, private ledgers — evidence that War Room researchers already know the direction; Wave 1's diagnosis is that the **default Commander-visible path** still behaves as essay council.

**Label:** INFERENCE (gap between schemas-in-code and behavior-in-mission) · PROPOSED (evidence board as SoT for Aurora).

### A.6 Revision = paraphrase

**Mechanism.** If REVISE is allowed whenever challenged, and the only new input is peer text, the optimal policy under sycophancy is to rephrase agreement. Papers show debate can **degrade** accuracy vs single-agent when diversity collapses (arXiv:2509.05396).

**Required rule (PROPOSED):** REVISE only if (a) new evidence ID, (b) claim status change with rationale, or (c) explicit STAND_FIRM with challenge addressed. Pure lexical novelty without evidence delta = suppress.

Family-deliberation already parses `DECISION: STAND_FIRM|REVISE` (`revisionDecision.ts`) — the missing piece is **evidence-delta gating**, not more prompt adjectives.

### A.7 Aurora summarizes prose

**Mechanism.** Centralized judge/synthesizer that reads debate transcripts inherits **judge sycophancy**: preferring polished, confident, harmonious narratives (arXiv:2509.23055). Du et al. multiagent debate (ICML 2024 / arXiv:2305.14325) improves factuality when agents **critique and revise with disagreement preserved** — not when a summarizer flattens conflict into soothing prose.

**PROPOSED:** Aurora input = frozen claims + challenge outcomes + evidence graph only; raw seat essays optional for audit, never for synthesis truth.

### A.8 Vague "Partial match" / "Advisory only"

**VERIFIED in War Room code (read-only audit of `war-room-os-audit` checkout — not a live Nebula claim):**

| String | Actual meaning | File |
|---|---|---|
| `Partial match` | Adaptive **recommendation** family set vs **actual** execution family set partially overlaps | `shadowReadout.ts` `STATUS_LABELS.partial_match` |
| `Advisory only` | Shadow plan did not control execution | `AdaptiveCouncilReadout.tsx`; assembly doc |
| `Recommended assembly — not used for execution` | Phase 48-C3B1 scope lock | `UNIFIED_ADAPTIVE_COUNCIL_ASSEMBLY.md` |

**Failure class for Commander UX:** these labels are misread as **mission completion / health** states. They answer "did shadow planner agree with who spoke?" — not "are Core/UI/Council/Foundry/Terra probed and verified?"

**PROPOSED (Wave 6/7):** replace Commander-facing completion with typed states: `VERIFIED | PARTIALLY_VERIFIED | UNVERIFIED | CONTRADICTED | TOOL_BLOCKED | …` — leave Partial match as internal planner telemetry only.

### A.9 Failure chain (causal, not personality)

```
Mission text (status)
  → no mandatory probes
  → seat A free-form narrative (anchor)
  → seats B..N see A (sycophancy / echo)
  → Phoenix challenges tone, not claims
  → REVISE paraphrases
  → Aurora summarizes conversation
  → UI shows Partial match / Advisory only
  → Commander receives poetic readiness ≠ evidence
```

Each arrow is a **mechanism** Wave 3–6 can cut. Personality renames do not cut any arrow.

---

## B. SYSTEMS SURVEY — MECHANISMS (primary sources)

For each system: problem solved · mechanism relevant to Council · what NOT to copy · license/platform notes.

### B.1 AutoGen (Microsoft)

| Field | Content |
|---|---|
| Primary sources | AutoGen v0.4 release — Microsoft Research article (Jan 2025): https://www.microsoft.com/en-us/research/articles/autogen-v0-4-reimagining-the-foundation-of-agentic-ai-for-scale-extensibility-and-robustness/ ; DevBlog: https://devblogs.microsoft.com/autogen/autogen-reimagined-launching-autogen-0-4/ ; Core docs Agent Runtime: https://microsoft.github.io/autogen/stable/user-guide/core-user-guide/framework/agent-and-agent-runtime.html ; Message/communication: https://microsoft.github.io/autogen/0.4.4/user-guide/core-user-guide/framework/message-and-communication.html |
| Problem solved | Scalable multi-agent apps with explicit runtime, typed messages, pub/sub + direct messaging |
| Mechanism for Council | **Actor-model runtime**; agents handle typed messages; delivery decoupled from agent logic; `RoundRobinGroupChat` / `SelectorGroupChat` at AgentChat layer; observability affordances |
| NOT to copy | Unbounded free chat as default intel protocol; assuming Microsoft stack is War Room SoT; treating Magentic-One web generalist as Council replacement |
| License / platform | OSS (see GitHub microsoft/autogen); Python; note: Microsoft has pointed new work toward Agent Framework — verify maintenance status before dependency lock **(INFERENCE: check repo status at implement time)** |
| Label | VERIFIED (official docs) |

**Council takeaway:** adopt **typed message contracts + runtime-managed lifecycle**, not AutoGen branding.

### B.2 LangGraph (LangChain)

| Field | Content |
|---|---|
| Primary sources | Graph API: https://docs.langchain.com/oss/python/langgraph/graph-api ; StateGraph reference; multi-agent handoffs docs |
| Problem solved | Controllable agent workflows as graphs with shared state, reducers, parallel super-steps, checkpoints, human-in-the-loop |
| Mechanism for Council | **State schema + reducers**; nodes as pure/toolful functions; **parallel nodes in one super-step**; conditional edges; `Send` for map-reduce fan-out; `Command` for handoffs; private state channels |
| NOT to copy | Unbounded `messages` list as the only state (recreates essay transcript SoT); LangSmith cloud as mandatory (sovereignty conflict unless optional); treating graph framework as substitute for evidence ontology |
| License / platform | LangGraph OSS; Python/JS; LangChain ecosystem |
| Label | VERIFIED (official docs fetched 2026-09-20) |

**Council takeaway:** **graph orchestration + parallel first-pass nodes + typed state channels** for Mission Board / Evidence — keep essays off the SoT channel.

### B.3 CrewAI

| Field | Content |
|---|---|
| Primary sources | Docs Crews: https://docs.crewai.com/edge/en/concepts/crews ; Hierarchical process: https://docs.crewai.com/edge/en/learn/hierarchical-process ; GitHub: https://github.com/crewaiinc/crewAI |
| Problem solved | Role-based crews with sequential or hierarchical manager delegation; Flows for event-driven control |
| Mechanism for Council | Explicit **role/goal/backstory** agents + **task** objects; hierarchical manager validates outcomes; tool assignment at agent or task level |
| NOT to copy | Default **sequential** process (recreates anchoring); backstory-as-personality without schemas; assuming manager LLM = Commander |
| License / platform | MIT-class OSS (confirm LICENSE file at pin); Python; SaaS optional |
| Label | VERIFIED (official docs) |

**Council takeaway:** hierarchical validation is useful **if** manager validates **evidence completeness**, not prose quality. Prefer Flows-like control for SYSTEM_STATUS pipelines.

### B.4 MetaGPT

| Field | Content |
|---|---|
| Primary sources | Paper: *MetaGPT: Meta Programming for a Multi-Agent Collaborative Framework*, arXiv:2308.00352 (HTML https://arxiv.org/html/2308.00352v7 ); GitHub: https://github.com/FoundationAgents/MetaGPT |
| Problem solved | Cascading hallucinations from naive LLM chaining in software-company simulation |
| Mechanism for Council | **SOPs encoded as prompt sequences**; assembly-line role specialization; **structured artifacts** (PRD, design, APIs) as communication medium; publish-subscribe message pool; executable feedback |
| NOT to copy | Software-company role cosplay for every War Room mission; assuming Code=SOP(Team) covers intel/IR missions without adaptation |
| License / platform | OSS (MIT per project docs — verify at pin); Python |
| Label | VERIFIED (paper) |

**Council takeaway:** **highest-value import** — structured intermediate deliverables beat chat. Map to Evidence Board / Claim objects.

### B.5 ChatDev

| Field | Content |
|---|---|
| Primary sources | *ChatDev: Communicative Agents for Software Development*, arXiv:2307.07924 ; GitHub OpenBMB/ChatDev |
| Problem solved | End-to-end software generation via multi-agent "company" with chat chains |
| Mechanism for Council | Phase chat chains (design/coding/testing); instructor–assistant dual; communicative dehallucination attempts |
| NOT to copy | **Chat as primary medium** for Council intel (MetaGPT explicitly criticizes this); waterfall company metaphor for status probes |
| License / platform | Apache-2.0 (typical ChatDev — verify at pin); research prototype quality variance |
| Label | VERIFIED (paper) |

**Council takeaway:** study as **negative control** for essay-council failure modes.

### B.6 OpenAI Agents SDK

| Field | Content |
|---|---|
| Primary sources | GitHub: https://github.com/openai/openai-agents-python ; Tools/computer use guides on OpenAI developers docs |
| Problem solved | Lightweight multi-agent orchestration: Agents, Tools, Handoffs, Guardrails, Sessions, tracing |
| Mechanism for Council | **Handoffs** between specialized agents; **guardrails**; tools as first-class; computer tool = structured UI actions + observation; provider-agnostic clients |
| NOT to copy | Hosted-only tools that break local/sovereign path; treating handoff chat history as evidence SoT without schemas |
| License / platform | MIT (Agents SDK — verify); Python + JS/TS; works with non-OpenAI models but computer tool semantics are OpenAI-shaped |
| Label | VERIFIED (official repo/docs) |

**Council takeaway:** **handoffs + guardrails + tool loop**; keep Browser Broker / local probes as War Room's ACI, not OpenAI computer-use as sole path.

### B.7 Anthropic tool-use / computer use

| Field | Content |
|---|---|
| Primary sources | Tool use how-it-works: https://platform.claude.com/docs/en/agents-and-tools/tool-use/how-tool-use-works ; Computer use: https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool ; Research: https://www.anthropic.com/research/developing-computer-use (Oct 2024 public beta lineage) |
| Problem solved | Reliable agent loops where model proposes tools; client retains execution authority; desktop/browser control via screenshots + actions |
| Mechanism for Council | **Client-executed tool loop**; `tool_use` / `tool_result` pairing; computer use = observe→act→observe; permission/hooks patterns in Claude Agent SDK harness |
| NOT to copy | Unconstrained computer use on Nebula without Commander/tool-authority policy; prompt-injection exposure on untrusted UI |
| License / platform | API proprietary; patterns are portable; Claude Agent SDK Claude-only |
| Label | VERIFIED (official docs) |

**Council takeaway:** **VERIFY BEFORE CLAIM** ≡ no status claim without matching `tool_result`. Capability ≠ authority — align with War Room lock.

### B.8 Mixture-of-Agents (MoA)

| Field | Content |
|---|---|
| Primary sources | Wang et al., *Mixture-of-Agents Enhances Large Language Model Capabilities*, arXiv:2406.04692 (ICLR 2025 proceedings PDF also available) |
| Problem solved | Aggregate strengths of heterogeneous LLMs via layered proposers + aggregators |
| Mechanism for Council | Layered architecture: multiple proposers → aggregators synthesize prior layer outputs; open-source MoA competitive on AlpacaEval 2.0 (paper: 65.1% vs GPT-4o 57.5% on reported metric) |
| NOT to copy | Blind aggregation of **unverified essays** (amplifies sycophancy if proposers are correlated); MoA as substitute for tools |
| License / platform | Paper + reference implementations (Together AI lineage); method is prompt-pattern portable |
| Label | VERIFIED (paper) |

**Council takeaway:** heterogeneous proposers good; aggregator must consume **claims/evidence**, not vibes. Optional for multi-provider War Room seats.

### B.9 LLM debate / verifier papers

| Work | Mechanism | Council relevance | Source |
|---|---|---|---|
| Du et al. 2023/2024 Multiagent Debate | Independent instances critique/revise over rounds | Disagreement can raise factuality **if** preserved | arXiv:2305.14325 ; PMLR/ICML 2024 |
| Peacemaker vs Troublemaker 2025 | Operationalize inter-agent sycophancy; persona spectrum | Phoenix ≈ controlled troublemaker; avoid peacemaker Aurora | arXiv:2509.23055 |
| Talk Isn't Always Cheap 2025 | Failure modes: majority tyranny, sycophantic flips, persuasive falsehoods | Debate ≠ automatic quality | arXiv:2509.05396 |
| Identity anonymization 2026 | Remove identity markers to equalize weights | Freeze claims without seat prestige cues in review packets | ACL 2026 long.650 |
| Verifier / reward models (general) | Separate generate vs verify | Phoenix/verifier as distinct job with different objective | Literature class; pair with SWE-bench style executable checks where possible |

**NOT to copy:** debate theater without tools; judge that rewards style.

### B.10 Blackboard architecture (classic AI)

| Field | Content |
|---|---|
| Primary sources | Hayes-Roth BB1 / blackboard control (Stanford CS-TR-84-1034 lineage: http://infolab.stanford.edu/TR/CS-TR-84-1034.html ); modern LLM blackboard: *Exploring Advanced LLM Multi-Agent Systems Based on Blackboard Architecture*, arXiv:2507.01701 |
| Problem solved | Opportunistic cooperation among knowledge sources posting partial results to shared board; control KS schedules who runs |
| Mechanism for Council | **Shared structured board** (not chat log); specialists read/write hypotheses, evidence, conflicts; controller selects KS by agenda |
| NOT to copy | 1980s rule-engine complexity without LLM ergonomics; letting board become another dump of essays |
| License / platform | Classical pattern — public domain concept; modern papers OSS vary |
| Label | VERIFIED (classic + 2025 LLM blackboard paper) |

**Council takeaway:** **Evidence Board = blackboard**. Aurora reads board, not IRC.

### B.11 ReAct

| Field | Content |
|---|---|
| Primary sources | Yao et al., *ReAct: Synergizing Reasoning and Acting in Language Models* — https://ysymyth.github.io/papers/react_llm.pdf ; ICLR 2023 |
| Problem solved | Interleave Thought / Action / Observation to reduce hallucination on knowledge + decision tasks |
| Mechanism for Council | Force **Action** before high-stakes claims; observation grounds next thought |
| NOT to copy | Unbounded thought traces as Commander-facing output; tool spam without mission gating |
| Label | VERIFIED (paper) |

### B.12 Reflexion

| Field | Content |
|---|---|
| Primary sources | Shinn et al., *Reflexion: Language Agents with Verbal Reinforcement Learning*, NeurIPS 2023 — https://papers.neurips.cc/paper_files/paper/2023/file/1b44b878bb782e6954cd888628510e90-Paper-Conference.pdf |
| Problem solved | Improve agents via verbal self-reflection stored in episodic memory after failures |
| Mechanism for Council | Post-mission reflection memos keyed to failure modes (tool blocked, contradiction, paraphrase revise) — **not** mid-round poetic self-talk |
| NOT to copy | Reflection replacing external evidence; reflecting on personality |
| Label | VERIFIED (paper) |

### B.13 SWE-agent / OpenHands-class

| Field | Content |
|---|---|
| Primary sources | SWE-agent: *Agent-Computer Interfaces Enable Automated Software Engineering*, NeurIPS 2024 — https://proceedings.neurips.cc/paper_files/paper/2024/file/5a7c947568c1b1328ccc5230172e1e7c-Paper-Conference.pdf ; OpenHands: GitHub https://github.com/OpenHands/OpenHands ; paper *OpenHands: An Open Platform for AI Software Developers as Generalist Agents* (arXiv:2407.16741 / ICLR 2025) |
| Problem solved | Coding agents that actually edit/run code via ACI rather than inventing diffs |
| Mechanism for Council | **Agent–Computer Interface** design: constrained commands (`open`, `edit`, `run`, search) with feedback; sandboxed execution; event streams; delegation |
| NOT to copy | Turning Council into a coding agent; unconstrained shell on production Nebula |
| License / platform | SWE-agent / OpenHands: OSS (OpenHands historically MIT — verify); sandbox required |
| Label | VERIFIED (papers + GitHub) |

**Council takeaway:** design **War Room ACI** — status probes, log tails, port checks, Browser Broker — with the same discipline SWE-agent applies to `edit`.

### B.14 Incident-response / intel analysis workflow patterns

| Pattern | Mechanism | Council mapping | Sources |
|---|---|---|---|
| SANS PICERL | Prepare → Identify → Contain → Eradicate → Recover → Lessons | Mission types; stage-gated tools | SANS IR frameworks (industry standard summaries) |
| OODA | Observe–Orient–Decide–Act | Observe=probes; Orient=claims board; Decide=Commander; Act=Foundry/ops (authority split) | Boyd OODA (classic) |
| Structured Analytic Techniques | Key Assumptions Check, ACH, contrarian analysis | Phoenix jobs; Lumen verification | Heuer / tradecraft manuals (class of practice) |
| Agentic SOC orchestration | Specialized agents + shared incident state + human approval | Coordinator ≠ Commander; approval gates | Google Cloud Architecture Center — Agentic AI security ops workflows; Clouseau / STAIR-class research papers |

**NOT to copy:** autonomous containment actions without Commander authority; inventing classified tradecraft.

**Label:** VERIFIED (public IR frameworks + public agentic SOC docs) · PROPOSED mapping.

---

## C. COMPARISON TABLE — architecture pattern → War Room Council fit

Fit dimensions: **Sovereign** (local/frontier optional) · **Tool authority** (harness executes) · **Evidence** (structured provenance) · **Commander** (human authority preserved).

Scoring: **H** high fit · **M** medium · **L** low · **—** anti-fit if used naively.

| Architecture pattern | Sovereign | Tool authority | Evidence | Commander | Fit notes | Label |
|---|---|---|---|---|---|---|
| Sequential group chat (AutoGen RoundRobin / Crew sequential / ChatDev chains) | M | L | L | M | Recreates anchoring/echo | VERIFIED mechanism risk |
| Parallel independent proposers → freeze | H | M | H | H | Cuts A.1; MoA/debate first round | PROPOSED |
| Typed state graph (LangGraph-class) | H | H | H | H | Mission pipeline + reducers for evidence lists | PROPOSED |
| Actor runtime + typed messages (AutoGen Core-class) | H | H | M | H | Good bus; still need schemas | PROPOSED (infra) |
| Hierarchical manager crew | M | M | M | L–M | Manager ≠ Commander; OK for sub-task QA | INFERENCE |
| SOP + structured artifacts (MetaGPT-class) | H | M | H | H | Strong for Foundry-adjacent + intel packets | PROPOSED |
| Blackboard / evidence board | H | H | H | H | Best SoT for Aurora/Phoenix | PROPOSED |
| ReAct / tool loop / computer-use | H* | H | H | H | *if tools are local/Broker | PROPOSED |
| MoA layered aggregation | H | L | M | M | Only aggregate verified claims | PROPOSED (narrow) |
| Debate + adversarial verifier | H | M | H | H | Phoenix = verifier job | PROPOSED |
| Reflexion episodic memory | H | — | M | H | Post-mission, typed failure codes | PROPOSED |
| SWE-agent ACI | H | H | H | H | Template for probe ACI | PROPOSED |
| Adaptive shadow planner labels | H | — | L | M | Keep internal; not completion UX | VERIFIED current WR |
| Personality panel without tools | H | L | L | M | Current failure mode | VERIFIED failure |

\*Sovereign remains H only when tool backends are local/Ollama/Browser Broker/self-hosted; cloud computer-use is optional frontier.

---

## D. MECHANISM IMPORT LIST (Wave 1 → later waves)

| Mechanism | Source class | Target wave | PROPOSED FOR WAR ROOM |
|---|---|---|---|
| Hide peer outputs until POSITION_FREEZE | Debate failure lit + scout-swarm isolation | 3 | Yes |
| Claim/evidence schema as SoT | MetaGPT + blackboard | 4 | Yes |
| Mission → mandatory tool set | ReAct + IR workflows | 5 | Yes |
| Info-gain revision gate | Sycophancy papers | 3 | Yes |
| Phoenix as troublemaker/verifier | arXiv:2509.23055 + Du debate | 6 | Yes |
| Aurora reads board not chat | Judge sycophancy lit | 6 | Yes |
| Typed completion states | Replace Partial match UX | 6–7 | Yes |
| Graph/actor orchestration | LangGraph / AutoGen Core | 8 architecture | Yes (pattern, not brand lock) |
| ACI for probes | SWE-agent / OpenHands / Anthropic tool loop | 5–8 | Yes |
| MoA multi-provider proposers | Wang 2024 | optional | Only with evidence constraints |

---

## E. WAR ROOM LOCKS CHECK (Wave 1 compliance)

| Lock | Wave 1 stance |
|---|---|
| Council = reasoning layer | Survey mechanisms for reasoning+tools; Foundry not replaced |
| Foundry = builder | SWE-agent patterns inform Foundry later; not Council SoT |
| Terra = world-state | Status probes may read Terra health; Terra ≠ Council |
| Commander authority | No autonomous Act; OODA Decide stays human |
| Local/sovereign + optional frontier | Prefer patterns that work offline; cloud tools optional |
| Browser Broker | Treat as ACI backend for web observe |
| Tool authority explicit | Client/harness executes; model proposes |
| Evidence provenance | Board + claim IDs |
| Truthful health | UNKNOWN ≠ READY; no poetic status |
| Capability ≠ authority | Adaptive `tool_eligible` ≠ granted probe rights |
| Builds HOLD | Research only — no war-room-os code changes this wave |

---

## F. SOURCE INDEX (Wave 1)

### F.1 Cognitive / multi-agent failure

1. Sharma et al. — *Towards Understanding Sycophancy in Language Models* — arXiv:2310.13548  
2. Yao et al. — *Peacemaker or Troublemaker: How Sycophancy Shapes Multi-Agent Debate* — arXiv:2509.23055  
3. *Talk Isn't Always Cheap: Understanding Failure Modes in Multi-Agent Debate* — arXiv:2509.05396  
4. *When Identity Skews Debate* — ACL 2026 (anthology 2026.acl-long.650)  
5. Du et al. — *Improving Factuality and Reasoning through Multiagent Debate* — arXiv:2305.14325 / ICML 2024  
6. Tversky & Kahneman — Judgment under Uncertainty: Heuristics and Biases (anchoring) — 1974 (classic)

### F.2 Frameworks / official docs

7. AutoGen v0.4 MSR article + DevBlog + Core agent runtime docs (2024–2025)  
8. LangGraph Graph API docs — docs.langchain.com (fetched 2026-09-20)  
9. CrewAI Crews + Hierarchical process docs + GitHub crewAIInc/crewAI  
10. OpenAI Agents SDK GitHub + computer use developer docs  
11. Anthropic tool-use + computer-use platform docs + computer-use research post  

### F.3 Papers — systems & methods

12. MetaGPT — arXiv:2308.00352  
13. ChatDev — arXiv:2307.07924  
14. Mixture-of-Agents — arXiv:2406.04692  
15. ReAct — Yao et al. PDF / ICLR 2023  
16. Reflexion — NeurIPS 2023  
17. SWE-agent — NeurIPS 2024  
18. OpenHands — arXiv:2407.16741 / ICLR 2025 + GitHub OpenHands/OpenHands  
19. LLM Blackboard MAS — arXiv:2507.01701  
20. Hayes-Roth BB1 / blackboard TR lineage — Stanford CS-TR-84-1034  

### F.4 IR / SOC workflow (public)

21. SANS incident response framework (PICERL) — industry documentation class  
22. Google Cloud Architecture Center — Agentic AI orchestrate security ops workflows  
23. Boyd OODA loop — classic decision cycle (public doctrine)

### F.5 War Room internal (read-only citations; not external claims)

24. `COUNCIL_INTELLIGENCE_MISSION.md` — locked failure narrative  
25. `lib/council/adaptive-assembly/shadowReadout.ts` — Partial match semantics  
26. `components/council/AdaptiveCouncilReadout.tsx` — Advisory only  
27. `docs/architecture/UNIFIED_ADAPTIVE_COUNCIL_ASSEMBLY.md` — advisory planner scope  
28. `lib/council/scout-swarm/prompts.ts` — independent discovery / Aurora inputs  
29. `lib/council/family-deliberation/runtime.ts` — priorTurns conditioning  
30. `lib/council/entities/CouncilEntityRegistry.ts` — personalityVersion identity metadata  

**Source count (unique primary entries above): 30** (6 failure-lit + 5 framework-doc clusters + 9 systems papers + 3 IR + 7 WR-internal).

---

## G. BLIND SPOTS / REFUSE (Wave 1)

| REFUSE | Why |
|---|---|
| "Adopt AutoGen/CrewAI/LangGraph wholesale" | Brand ≠ mechanism; sovereignty + Commander locks |
| "More vivid personalities will fix echo" | Personality-over-job is a failure mechanism |
| "Debate always improves accuracy" | Literature shows frequent degradation |
| "Partial match means system health Partial" | Category error — planner telemetry |
| "Aurora should sound more decisive" | Style ≠ verification |
| Invented APIs / fake probe endpoints | No implementation this wave; no fabricated runtime |

---

## H. HANDOFF TO WAVE 2+

Wave 2: convert §A.3 into **role contracts** with success metrics (ORION/LUMEN/PULSAR/NOVA/PHOENIX/AURORA).  
Wave 3: implement research design for parallel first-pass + info-gain revision (cut A.1/A.6).  
Wave 4: schemas for claims/evidence board (cut A.5/A.7).  
Wave 5: mission classifier + mandatory tools (cut A.4).  
Wave 6–7: Phoenix/Aurora/states/telemetry (cut A.7/A.8).  
Wave 8: fold + Status walkthrough + acceptance tests.

---

## I. WAVE 1 COMPLETION CHECKLIST

- [x] Failure mechanisms diagnosed (not personalities)  
- [x] Cognitive/AI literature cited (sycophancy, anchoring, groupthink/MADS)  
- [x] Systems surveyed with primary sources + dates/URLs where available  
- [x] Comparison table vs sovereign / tool authority / evidence / Commander  
- [x] Labels VERIFIED | INFERENCE | PROPOSED FOR WAR ROOM used  
- [x] No poetic filler; no code implementation  
- [x] ≥350 lines substantive cited content  
- [x] Folds to report §§1–4  

**STATUS: WAVE 1 RESEARCH DELIVERABLE COMPLETE**
