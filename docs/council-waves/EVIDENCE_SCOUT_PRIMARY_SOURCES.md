# Evidence Scout — Primary Sources Catalog
# Mission: War Room Council redesign (specialists + tools/evidence, not paraphrase panel)
# RESEARCH ONLY | Stamp date: 2026-09-20 (America/New_York) | UTC prove: 2026-09-21T00:45Z
# Labels: VERIFIED (HTTP 200 this pass) | PARTIAL | UNVERIFIED | SECONDARY
# Usable in: waves/WAVE_1.md · Report §3 Research Sources
# REFUSE: invented citations; brand worship without mechanism extract

---

## 1. Framework / SDK primary sources (official)

| System | Primary URLs (VERIFIED 200 unless noted) | What it contributes (mechanism, not brand) | Date note |
|---|---|---|---|
| **AutoGen** (Microsoft) | https://github.com/microsoft/autogen · https://microsoft.github.io/autogen/stable/ | Multi-agent chat, tool-calling agents, group chat patterns; docs note migration path to Agent Framework | Docs live 2026-09-20 |
| **Microsoft Agent Framework (MAF)** | https://github.com/microsoft/agent-framework · https://learn.microsoft.com/en-us/agent-framework/overview/ | Successor framing: agents + explicit workflows + tools/MCP; enterprise orchestration | Learn overview 200 |
| **LangGraph** | https://github.com/langchain-ai/langgraph · https://langchain-ai.github.io/langgraph/ · https://docs.langchain.com/oss/python/langgraph/overview | Explicit graph state machine; edges/nodes; durable runs — **typed control flow** vs free chat | Overview 200 |
| **CrewAI** | https://github.com/crewAIInc/crewAI · https://docs.crewai.com/ · https://docs.crewai.com/en/concepts/agents | Role/goal/backstory agents + task assignment — useful **job contracts**; risk of persona theatre if no tools | Docs 200 |
| **MetaGPT** | https://github.com/geekan/MetaGPT · paper https://arxiv.org/abs/2308.00352 (200) | SOPs / role assembly line for software — **structured handoffs** | Paper title VERIFIED |
| **ChatDev** | https://github.com/OpenBMB/ChatDev · paper https://arxiv.org/abs/2307.07924 (200) | Communicative agents for software — chat-chain; **do not cargo-cult as intel core** | Paper VERIFIED |
| **OpenAI Agents SDK** | https://openai.github.io/openai-agents-python/ · handoffs https://openai.github.io/openai-agents-python/handoffs/ · guide https://platform.openai.com/docs/guides/agents | Agents, tools, runners, **handoffs** — typed transfers | Docs 200 |
| **Anthropic tool use** | https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview · alt https://docs.anthropic.com/en/docs/build-with-claude/tool-use | Official tool-use / function-calling pattern for Claude | Both 200 |

**Council extract:** Prefer **LangGraph-style explicit state**, **OpenAI/Anthropic tool schemas**, **Crew/MetaGPT job contracts**, **MAF/AutoGen orchestration lessons** — not ChatDev-style endless chat as the intelligence product.

---

## 2. Patterns / papers (primary)

| Pattern | Primary citation | URL | HTTP | Mechanism for Council |
|---|---|---|---|---|
| **Mixture-of-Agents (MoA)** | Wang et al., *Mixture-of-Agents Enhances Large Language Model Capabilities* | https://arxiv.org/abs/2406.04692 · ICLR 2025 PDF https://proceedings.iclr.cc/paper_files/paper/2025/file/5434be94e82c54327bb9dcaf7fca52b6-Paper-Conference.pdf · code https://github.com/togethercomputer/moa | 200 / PDF ok / 200 | Layered proposers → aggregators; **not** free debate; compare vs MAD/Reconcile in paper |
| **Multi-agent debate** | Du et al., *Improving Factuality and Reasoning… through Multiagent Debate* | https://arxiv.org/abs/2305.14325 · ICML proc https://proceedings.mlr.press/v235/du24e.html | 200 / 200 | Symmetric propose/debate rounds |
| **MAD (asymmetric debate)** | Liang et al., *Encouraging Divergent Thinking… Multi-Agent Debate* | https://arxiv.org/abs/2305.19118 | 200 | Debater vs judge roles |
| **ReAct** | Yao et al., *ReAct: Synergizing Reasoning and Acting in Language Models* | https://arxiv.org/abs/2210.03629 · html https://arxiv.org/html/2210.03629 | 200 | Thought↔Act↔Obs loop — **tool-first** |
| **Reflexion** | Shinn et al., *Reflexion: Language Agents with Verbal Reinforcement Learning* | https://arxiv.org/abs/2303.11366 · html https://arxiv.org/html/2303.11366 | 200 | Verbal self-reflection memory after failure — **not** peer paraphrase |
| **SWE-agent** | Yang et al., *SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering* | https://arxiv.org/abs/2405.15793 · https://github.com/SWE-agent/SWE-agent · https://swe-agent.com/ | 200 / 200 / 200 | ACI + tools for real tasks — **specialist = interface + tools** |
| **Blackboard systems** | Classic AI architecture (Hearsay-II / blackboard control) | Overview SECONDARY: https://en.wikipedia.org/wiki/Blackboard_system (200). ACM classic often paywalled (dl.acm.org 403 this egress) | PARTIAL | Shared **evidence board**; specialists post hypotheses/evidence; control KS — maps to Council evidence board |

---

## 3. Sycophancy / anchoring / conformity (evidence against paraphrase panels)

| Claim | Source | URL | HTTP | Council implication |
|---|---|---|---|---|
| User–LLM **sycophancy** (agree with user over truth) | Sharma et al., *Towards Understanding Sycophancy in Language Models* | https://arxiv.org/abs/2310.13548 · Anthropic research page https://www.anthropic.com/research/towards-understanding-sycophancy-in-language-models | 200 / 200 | Judge/synthesis agents can sycophantically endorse fluent wrong answers |
| Inter-agent sycophancy / **disagreement collapse** in debate | *Peacemaker or Troublemaker: How Sycophancy Shapes Multi-Agent Debate* | https://arxiv.org/abs/2509.23055 | 200 | Shared sequential essays → premature consensus; peacemaker personas worse |
| Peer consensus **easier to mislead than correct** | *Easier to Mislead Than to Correct…* | https://arxiv.org/abs/2606.01637 | 200 | Seeing peer answers → harmful revision > beneficial; verify peers don’t just aggregate |
| **Hidden anchors** in multi-agent deliberation | *Hidden Anchors in Multi-Agent LLM Deliberation* | https://arxiv.org/abs/2606.19494 | 200 | Internal anchors pull opinions; classical consensus models incomplete |
| Classical human **anchoring** | Tversky & Kahneman, *Judgment under Uncertainty* (Science 1974) | Cite classic; Scholar/publisher (not re-fetched full PDF this pass) | SECONDARY classic | First fluent speaker frames later agents |
| Consensus trap / majority corruption | *The Consensus Trap…* arXiv:2604.17139 | https://arxiv.org/abs/2604.17139 | (listed; treat as supporting) | Voting/debate ≠ truth without independence + verification |

**Design rule (RECOMMENDATION from evidence):** Independent first-pass with **hidden peer outputs**; revision only on **evidence delta**; Phoenix verifies claims; Aurora synthesizes **verified evidence board**, not chat transcripts.

---

## 4. Anti-patterns (VERIFIED literature + INFERENCE for WR)

| Anti-pattern | Why it fails | Source class |
|---|---|---|
| Paraphrase panel / echo chain | Sycophancy + anchoring | §3 papers VERIFIED |
| Personality without tools | Fake specialization | INFERENCE + SWE-agent contrast VERIFIED |
| Judge summarizes prose | Judge sycophancy risk | MADS sycophancy VERIFIED |
| MoA/debate without independence | Collapse / conformity | MoA vs debate + conformity papers |
| ChatDev-as-intel-core | Optimizes for software chat theatre | ChatDev paper VERIFIED — wrong product shape |

---

## 5. Stamp notes for WAVE_1 + Report §3

- Fold this file’s tables into **WAVE_1 architecture survey** (frameworks + mechanisms).
- Report **§3 Research Sources** should list every VERIFIED URL above with access date **2026-09-20**.
- Do **not** cite arXiv:2308.01263 as sycophancy — that ID is XSTest (VERIFIED wrong title this pass). Correct sycophancy paper: **2310.13548**.

---

## 6. Probe log (selected)

All framework/docs/paper URLs in §§1–3 marked VERIFIED were HTTP-probed 200 from Scout egress 2026-09-21T00:45Z unless noted PARTIAL/SECONDARY.
