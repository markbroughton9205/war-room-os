# GI-ENG-01 — Engineering Plan (Commander Approve Gate)
# Mission: PathClassifier + SHORT_PATH + MultimodalEnvelope (+ capture_truth)
# Commander: Mark | Mode: PLAN ONLY — NO CODE / BUILD / COMMIT / PUSH / DEPLOY until explicit approve
# Stamp: 2026-09-22 ~09:25 EDT (America/New_York)
# Authorized: GI-ENG-01 planning only (Mark) — code still LOCKED
# Labels: VERIFIED FACT | RESEARCH FINDING | INFERENCE | RECOMMENDATION

---

## 0. Document control

| Field | Value |
|---|---|
| Plan path (canonical) | `/home/box/divine-council-gi/GI_ENG_01_PLAN.md` |
| Mirror | `/workspace/terra-swarm/divine-council-gi/GI_ENG_01_PLAN.md` |
| Mission ID | `GI-ENG-01` |
| Aligns to | Report §54 first eng mission; also first **code slice** of folded `DC-GI-P0-KERNEL` |
| SoT (primary) | `/home/box/divine-council-gi/WAR_ROOM_DIVINE_COUNCIL_GENERAL_INTELLIGENCE_RESEARCH_REPORT.md` §§5,36–40,48–50,54 |
| SoT (GI-ENG-01 naming / fixtures) | `/workspace/terra-swarm/divine-council-gi/WAR_ROOM_DIVINE_COUNCIL_GENERAL_INTELLIGENCE_RESEARCH_REPORT.md` §§5,12,36–40,46,48–50,54 |
| Contracts | `waves/WAVE_SCIENCE_ENVELOPES_MEMORY.md` · `WAVE_6_7_BRAIN_CONTRACTS.md` · `WAVE_1_PRODUCT_MAP_GAPS.md` · `WAVE_G_CONTRACTS_SOVEREIGNTY.md` |
| Code audit tip (READ-ONLY) | `/workspace/war-room-os-audit` @ `10a3d34c0d49d9b0106263de36cb02ab859e5a1e` (2026-09-17 EDT) |
| Nebula live tree | **UNKNOWN_NEEDS_APPROVAL** — `/home/chosenone/Codex/war-room-os/lib/council` not readable this session; Shell has no `machineId`; stay on audit tip |

**Hard locks (carry into every implement step):**
- CAPABILITY ≠ AUTHORITY
- seat ≠ provider
- no fake LISTENING
- no always-six
- Foundry not mutated
- no install / deploy
- FORBIDDEN: Council2 / Browser2 / Foundry2 / Memory2 / parallel tool registry
- Extend EBC / Broker / Terra / HVS / Media — call, don’t clone

---

## 1. Mission title + one-sentence goal

**Title:** `GI-ENG-01 PathClassifier + SHORT_PATH + MultimodalEnvelope`

**Goal:** Add the GMII front-door spine — typed multimodal ingress, honest path classification (SHORT | AGENT | HANDOFF), a short-path runtime that never spins six seats, and `capture_truth` / AuthorityMatrix stubs — by **extending** existing `lib/council/**` + conversation-runtime + permissions, with WR-GA fixtures 1/2/7/8 as the acceptance skeleton.

---

## 2. In scope / non-goals (match report §54)

### 2.1 IN SCOPE (this mission only)

| # | Deliverable | Report cite |
|---|---|---|
| 1 | **PathClassifier** result type + rules-first classifier (LLM only if ambiguous) → `SHORT_PATH` \| `AGENT_PATH` \| `HANDOFF` | terra §5, §54; Science §6; home §5 / §53 |
| 2 | **SHORT_PATH runtime contract** — ≤1 backing model, ≤1 low-risk tool optional, `seats_used=[]`, stream/reply via ResponseLayer fields | terra §5–6, §54; Science PATH-01 |
| 3 | **MultimodalEnvelope** schema + validators (align Science `CommanderTurn` / `OutputEnvelope`; attachments → AssetRef+hash) | terra §37, §54; Science §§1–2; home §36 |
| 4 | **`capture_truth` enum** + VoiceSession stub fields; UI LISTENING gated | terra §12, §54; Blind Spot DC-BS-02; home §12 |
| 5 | **AuthorityMatrix stub rows** for multimodal / voice / ingest / handoff tools (OWNABLE \| REQUIRE_AUTH \| HOLD \| REFUSE) | terra §36, §48; WAVE_G §38; home §38 |
| 6 | Wire ShortPath into **existing** model router / live pipeline **hooks only** (no new provider stack) | terra §54; audit `lib/model-router/**` |
| 7 | ResponseLayer field stubs: `path_used`, `capture_truth?`, `authority_decisions`, `completion_state` | terra §35; Science OE-* |
| 8 | WR-GA fixtures **1, 2, 7, 8** skeleton (tests may fail red until implement; harness + gold labels land) | terra §46, §48#11, §54 |

### 2.2 NON-GOALS (explicit — still forbidden after plan approve until later missions)

| Forbidden in GI-ENG-01 | Why |
|---|---|
| Realtime provider integration (OpenAI Realtime / Gemini Live) | P7 / Phase E polish — truth enum first |
| Computer-use / OSWorld agent | Late phase; sandbox not designed here |
| HVS / Media NLE / CapCut features | Callable planes only; no SoT merge |
| MCP marketplace / connector sprawl | Phase F; fixture 8 is **authority deny** only |
| Foundry execution / git / patch / deploy changes | Foundry HOLD; handoff **interface stub only** |
| EBC board rewrite / full seat expansion rewrite | Preserve wiring; AGENT path remains existing live-orchestration |
| UI chrome redesign | Truthfulness hooks only (`capture_truth` → no fake LISTENING) |
| Install, deploy, Nebula mutate, production ship | Builds HOLD + no install/deploy lock |
| New always-six / personality panel | DC-BS-06 |
| Second tool/memory registry | DC-BS-04 |

### 2.3 Relationship to folded `DC-GI-P0-KERNEL`

Home-box folded report §54 names **`DC-GI-P0-KERNEL`** (full P0: envelopes, authority, classifier, room/session/mission IDs, EBC preserve, observability stubs, Broker+Foundry typed handoffs).

**RECOMMENDATION:** Treat `GI-ENG-01` as **slice A** of that kernel (classifier + SHORT_PATH + MultimodalEnvelope + capture_truth + Authority stubs + WR-GA 1/2/7/8). Remaining P0 items (full Mission Center IDs, Broker/Foundry ModuleCallContract completeness, observability spans) → `GI-ENG-02+` after GI-ENG-01 greens.

---

## 3. Architecture touchpoints (extend existing — no Council2)

### 3.1 Normative pipeline (after GI-ENG-01)

```
CommanderTurn / MultimodalEnvelope
  → PathClassifier (rules first)
      ├─ SHORT_PATH → ShortPathRuntime (±1 OWNABLE tool) → OutputEnvelope / ResponseLayer
      ├─ AGENT_PATH → existing EBC / live-orchestration (conditional seats; not always-six)
      └─ HANDOFF → ModuleCallContract stub → Foundry | Broker | Terra | HVS | Media
  → authority gate on every side-effect tool
  → MissionTelemetry stub fields (path_used, placement, capture_truth?)
```

### 3.2 Box audit modules to EXTEND (VERIFIED FACT — cite real paths)

Audit root: `/workspace/war-room-os-audit` @ `10a3d34c`.

| Concern | Existing path (READ-ONLY audit) | GI-ENG-01 action |
|---|---|---|
| Decree intent heuristics | `lib/council/intentClassifier.ts` | Keep; **do not replace**. PathClassifier sits **above** / beside it as GMII path SoT |
| Routing intent/skills | `lib/council/routing/IntentEngine.ts`, `CouncilDecisionEngine.ts`, `SkillRouter.ts`, `EntityRouter.ts`, `ApprovalGate.ts`, `types.ts`, `index.ts` | Add path decision type; feed SHORT vs AGENT vs HANDOFF into decision path |
| Live social short-circuit | `lib/council/live-orchestration/socialCheckin.ts` | Generalize into SHORT_PATH rule inputs (greeting / check-in) |
| Live pipeline | `lib/council/liveChatPipeline.ts` | Hook: if SHORT_PATH → skip full roster expansion |
| Live orchestration | `lib/council/live-orchestration/roundMachine.ts`, `floorScheduler.ts`, `councilPathCanary.ts`, `streamContract.ts` | AGENT_PATH only; SHORT must not enter round machine |
| Family roster (seat≠provider partial) | `lib/council/familyRoster.ts` | Consume `identityName` as seat; never bind PathClassifier to `provider` string |
| Brain / model selection | `lib/council/brain-selection/**`, `lib/model-router/**` | SHORT_PATH uses one backend via existing router |
| Conversation runtime | `lib/conversation-runtime/types.ts`, `sessionStore.ts`, `persist.ts`, `continuation.ts` | Attach envelope ids / path_used on turn records (additive fields) |
| Execution / approvals | `lib/council/execution-gate/**`, `lib/council/approval-authority/**`, `lib/council/approval-issuance/**`, `lib/council/routing/ApprovalGate.ts` | Map matrix decisions → existing gate states |
| Permissions policy | `lib/permissions/policy.ts`, `dangerousActionRegistry.ts`, `approvalEnvelope.ts`, `standingPermissions.ts` | AuthorityMatrix stubs align to `email_send` etc. already dangerous |
| Runtime truth | `lib/council/runtimeTruth.ts`, `lib/council/runtimeTruth/evidenceLedger.ts` | completion_state / no poetic READY |
| Skills registry | `lib/council/skills/CouncilSkillRegistry.ts` | Namespace extension later; GI-ENG-01 only stub multimodal tool rows via AuthorityMatrix — **no Skill2** |
| Command authority | `lib/council/commandAuthority.ts` | Preserve Commander decree authority doctrine |
| Council mode / render | `lib/council/councilMode.ts`, `councilRenderGate.ts` | SHORT_PATH must not force full-team render |
| Full team gate | `lib/council/fullTeamGate.ts` | SHORT_PATH must bypass / refuse always-six |

### 3.3 Nebula note

Prior WAVE_1: Nebula `machineId=153e10ec-c150-4a0e-b21e-d01ccfbe33d6` / `/home/chosenone/Codex/war-room-os` **UNKNOWN_NEEDS_APPROVAL**. This plan’s proposed paths are **war-room-os relative**; reconcile against Nebula tip only after Mark unlocks remote READ.

---

## 4. Schemas (normative sketches — PLAN only)

### 4.1 PathClassifier result

```typescript
/** GI-ENG-01 — PathClassifier result (RECOMMENDATION) */
type CouncilPath = "SHORT_PATH" | "AGENT_PATH" | "HANDOFF";

type MissionClassHint =
  | "CHITCHAT" | "SIMPLE_QA" | "FORMAT" | "SOCIAL_CHECKIN"
  | "SYSTEM_STATUS" | "INCIDENT_RESPONSE" | "DEEP_RESEARCH"
  | "ARCHITECTURE_REVIEW" | "ENGINEERING" | "MEDIA_PROD"
  | "WORLD_QUERY" | "UNKNOWN";

interface PathClassifierResult {
  path: CouncilPath;
  mission_class: MissionClassHint;
  confidence: number;                 // 0..1
  rules_fired: string[];              // deterministic audit
  tools_needed_est: 0 | 1 | "many";
  risk_class: "LOW" | "MED" | "HIGH" | "CRITICAL";
  handoff_target?: "FOUNDRY" | "BROWSER_BROKER" | "TERRA" | "HVS" | "MEDIA";
  seats_recommended: string[];        // empty on SHORT_PATH; never default-six
  ambiguous: boolean;                 // true → ask OR conservative AGENT_PATH w/ budget
  reason: string;                     // ops NL
}
```

**Rules (Science §6 + terra §5):**

| Input signal | Path |
|---|---|
| Greeting / SOCIAL_CHECKIN / trivial QA / format; risk=LOW; tools≤1 | `SHORT_PATH` |
| SYSTEM_STATUS / INCIDENT / DEEP_RESEARCH / ARCHITECTURE_REVIEW | `AGENT_PATH` (EBC conditional) |
| Explicit code mutate / patch / test-fix in repo | `HANDOFF` → FOUNDRY (optional AGENT analyze first) |
| Professional timeline / ThemeSpec / CapCut-class | `HANDOFF` → HVS |
| World-state / Cesium / live sensors | `HANDOFF` or AGENT+Terra read — Terra SoR |
| Ambiguous | Prefer `AGENT_PATH` with hard budget **or** `NEEDS_CLARIFICATION` — never always-six |

### 4.2 SHORT_PATH runtime contract

```typescript
interface ShortPathRuntimeRequest {
  envelope: MultimodalEnvelope;       // validated
  path: "SHORT_PATH";                 // assert
  allow_tools: boolean;               // default false; max 1 if true
  tool_allowlist: string[];           // OWNABLE / LOW only
  model_route: {
    lane: "classify_or_short";
    placement: "LOCAL" | "HYBRID" | "CLOUD";  // honesty required
  };
  budget: { tokens?: number; wall_ms?: number };
}

interface ShortPathRuntimeResult {
  path_used: "SHORT_PATH";
  seats_used: [];                     // HARD: empty
  tool_trace_public: { step: number; label: string; ok: boolean }[];
  output: OutputEnvelopeFields;       // see 4.3 egress subset
  authority_decisions: AuthorityDecision[];
  capture_truth?: CaptureTruth;       // if voice channel active
}
```

**Invariants:**
1. `seats_used.length === 0` always.
2. Must not call `family-deliberation` / full `roundMachine` roster.
3. Must not claim `VERIFIED` for live ops without tool evidence.
4. Cost of SHORT_PATH ≪ AGENT DEEP_RESEARCH (fixture 10 later; log placeholders now).

### 4.3 MultimodalEnvelope + capture_truth

Align Science `CommanderTurn` as the **ingress** MultimodalEnvelope; keep `OutputEnvelope` as egress (Science §2).

```typescript
type CaptureTruth =
  | "capturing"            // live mic/session proven
  | "muted"
  | "permission_denied"
  | "device_unavailable"
  | "idle"
  | "unavailable";         // agent box / no device — honest

interface AssetRef {
  asset_id: string;
  content_hash: string;              // required for binaries
  storage: "LOCAL" | "HYBRID" | "CLOUD_ORIGIN";
  bytes?: number;
  mime: string;
}

type TurnPart =
  | { kind: "text"; content_type: "text/plain" | "text/markdown"; text: string }
  | { kind: "file"; content_type: string; asset_ref: AssetRef; name?: string }
  | { kind: "image"; content_type: string; asset_ref: AssetRef; alt?: string }
  | { kind: "audio"; content_type: string; asset_ref: AssetRef; duration_ms?: number }
  | { kind: "video"; content_type: string; asset_ref: AssetRef; duration_ms?: number }
  | { kind: "uri"; url: string; fetch_policy: "LINK_OUT" | "BROKER_FETCH" | "REFUSE" }
  | { kind: "structured"; content_type: "application/json"; data: object };

/** Ingress — MultimodalEnvelope ≡ CommanderTurn (Science §1) */
interface MultimodalEnvelope {
  turn_id: string;
  room_id: string;
  session_id: string;
  mission_id?: string;
  ts: string;
  actor: { kind: "COMMANDER"; user_id: string };
  parts: TurnPart[];
  intent_hint?: MissionClassHint;    // never sole authority
  authority: {
    policy_profile: string;
    allow_side_effects: boolean;     // default false
  };
  voice?: {
    voice_session_id?: string;
    capture_truth: CaptureTruth;     // REQUIRED if voice UI path
  };
  correlation: { reply_to_turn_id?: string; thread_id?: string };
}

/** Egress subset GI-ENG-01 must populate */
interface OutputEnvelopeFields {
  output_id: string;
  in_reply_to: string;
  path: "SHORT" | "AGENT" | "EBC" | "HANDOFF";
  completion_state:
    | "VERIFIED" | "PARTIALLY_VERIFIED" | "UNVERIFIED"
    | "CONTRADICTED" | "TOOL_BLOCKED" | "STALE"
    | "BUDGET_EXHAUSTED" | "REFUSED" | "NEEDS_CLARIFICATION";
  advisory: true;
  body: { summary: string; unknowns: string[]; risks: string[] };
  tool_trace_public: { step: number; label: string; ok: boolean }[];
  seats_used: string[];
  path_used: CouncilPath;
  capture_truth?: CaptureTruth;
  authority_decisions: AuthorityDecision[];
  next_actions: { label: string; requires_commander: boolean }[];
}
```

**LISTENING lock:** UI may show LISTENING **iff** `capture_truth === "capturing"` **and** `voice_session_id` present. `permission_denied` | `device_unavailable` | `idle` | `unavailable` → honest non-listening UI (fixture 7).

### 4.4 AuthorityMatrix stub rows (multimodal tools)

```typescript
type AuthorityClass = "OWNABLE" | "REQUIRE_AUTH" | "HOLD" | "REFUSE";
// (+ STREAM_ONLY for broker/vendor — EBC Appendix C; map to HOLD/REQUIRE_AUTH in stubs)

interface AuthorityDecision {
  tool_id: string;                   // ops-only
  resource?: string;
  decision: "auto" | "ask" | "deny";
  authority_class: AuthorityClass;
  actor: "POLICY" | "COMMANDER" | "SYSTEM";
  reason: string;
  ts: string;
  grant_id?: string;
}

interface AuthorityMatrixRow {
  tool_id: string;
  nl_labels: string[];
  owner_module: "Council" | "Broker" | "Foundry" | "Terra" | "HVS" | "Media" | "Connector";
  risk_class: "LOW" | "MED" | "HIGH" | "CRITICAL";
  authority_class: AuthorityClass;
  allowed_paths: CouncilPath[];      // e.g. email.send never on SHORT auto
  notes: string;
}
```

**Stub rows to land in GI-ENG-01 (data only — no live send/mic):**

| tool_id | nl_labels | owner | authority_class | notes |
|---|---|---|---|---|
| `council.chat.short` | “Answer briefly” | Council | OWNABLE | SHORT_PATH default |
| `files.ingest` | “Attach file” | Council | OWNABLE | hash required; no parse-all |
| `vision.ingest` | “Look at image” | Council | OWNABLE | AssetRef; no fake SEEING |
| `audio.asr` | “Transcribe audio” | Council | OWNABLE / REQUIRE_AUTH if cloud | HOLD if retention unknown |
| `voice.session.start` | “Start voice session” | Council | REQUIRE_AUTH | sets capture_truth |
| `voice.capture` | “Use microphone” | Council | REQUIRE_AUTH | LISTENING only if capturing |
| `email.draft` | “Draft email” | Connector | OWNABLE (draft) | no send |
| `email.send` | “Send email” | Connector | REQUIRE_AUTH | fixture 8 → ASK/deny without grant |
| `foundry.handoff` | “Send to Foundry” | Foundry | REQUIRE_AUTH | ModuleCallContract stub; **no git** |
| `broker.research` | “Research on the web” | Broker | STREAM_ONLY→HOLD/REQUIRE_AUTH | no Council scrape |
| `hvs.job` | “Open in HVS” | HVS | REQUIRE_AUTH | handoff only |
| `terra.query` | “Query world state” | Terra | OWNABLE (read) | no Terra write from chat |
| `media.gen.thin` | “Make a simple image” | Media | REQUIRE_AUTH if paid cloud | ≠ HVS NLE |
| `computer_use.*` | — | — | REFUSE (this mission) | stub row deny |
| `council.git.push` | — | — | REFUSE | Foundry-only forever |

Map into existing `lib/permissions/policy.ts` dangerous kinds (`email_send`, …) and `execution-gate` blocked types — **extend tables, do not fork policy engines**.

---

## 5. File/module change list (proposed under war-room-os — PLAN only)

> Paths are **proposed** relative to war-room-os. Implement only after §10 approve. Prefer new files under `lib/council/gi/` to avoid Council2 while isolating GMII spine.

### 5.1 NEW (proposed)

| Path | Role |
|---|---|
| `lib/council/gi/types.ts` | CouncilPath, CaptureTruth, PathClassifierResult, AuthorityMatrixRow |
| `lib/council/gi/pathClassifier.ts` | Rules-first classifier; wraps/consults `intentClassifier` + `socialCheckin` |
| `lib/council/gi/pathClassifier.rules.ts` | Pure rule table (testable) |
| `lib/council/gi/multimodalEnvelope.ts` | Schema types + parse/validate |
| `lib/council/gi/multimodalEnvelope.assert.ts` | CT-01…03 rejects |
| `lib/council/gi/captureTruth.ts` | CaptureTruth helpers; `canShowListening()` |
| `lib/council/gi/shortPathRuntime.ts` | SHORT_PATH contract executor (calls model-router) |
| `lib/council/gi/authorityMatrix.stub.ts` | Stub rows §4.4 |
| `lib/council/gi/authorityMatrix.ts` | Lookup → AuthorityDecision |
| `lib/council/gi/responseLayer.ts` | Map OutputEnvelopeFields → Commander-facing brief |
| `lib/council/gi/index.ts` | Public exports |
| `lib/council/gi/pathClassifier.validation.ts` | Unit/behavior validation |
| `lib/council/gi/shortPathRuntime.validation.ts` | seats_used=[] etc. |
| `lib/council/gi/captureTruth.validation.ts` | Fake LISTENING negative tests |
| `tests/gi/wr-ga/fixture-01-short-path.ts` | WR-GA 1 |
| `tests/gi/wr-ga/fixture-02-system-status.ts` | WR-GA 2 skeleton |
| `tests/gi/wr-ga/fixture-07-voice-truth.ts` | WR-GA 7 |
| `tests/gi/wr-ga/fixture-08-email-send-ask.ts` | WR-GA 8 |
| `tests/gi/wr-ga/harness.ts` | Minimal runner / gold labels |
| `docs/architecture/GI_ENG_01_SPINE.md` | Implementer note (optional) |

### 5.2 MODIFY (proposed — thin hooks)

| Path | Change |
|---|---|
| `lib/council/liveChatPipeline.ts` | Early PathClassifier; SHORT bypass full expansion |
| `lib/council/routing/CouncilDecisionEngine.ts` | Record `path` on RoutingNote / decisionPath |
| `lib/council/routing/types.ts` | Add `path?: CouncilPath` additive field |
| `lib/council/live-orchestration/socialCheckin.ts` | Export signals reused by pathClassifier.rules (no behavior break) |
| `lib/conversation-runtime/types.ts` | Optional `path_used`, `envelope_turn_id`, `capture_truth` on turn record |
| `lib/council/councilRenderGate.ts` / `fullTeamGate.ts` | SHORT_PATH → do not force full team |
| `lib/permissions/policy.ts` or sibling | Register multimodal stub kinds if missing (email.send already present) |

### 5.3 DO NOT TOUCH (this mission)

| Path / area | Reason |
|---|---|
| `lib/native-builder/**`, Foundry APIs | Foundry HOLD — handoff stub only in `gi/` |
| `lib/terra/**` SoR writers | Call-only |
| HVS / Media NLE trees | Call-only |
| Browser Broker scrape engines | Handoff stub only |
| `familyRoster.ts` provider labels rewrite | seat≠provider cleanup = later; classifier must ignore provider |
| New `lib/council2/**` or twin registries | Forbidden |

---

## 6. Implementation steps (ordered, dependency-safe)

> **Do not start until §10 Commander approve.** Steps assume approve unlocks **code for GI-ENG-01 only**.

1. **Reconcile tip** — Diff audit `10a3d34c` vs Nebula (if unlocked); adjust paths; no code yet beyond plan amend if Mark requires.
2. **Land types** — `gi/types.ts` + CaptureTruth + PathClassifierResult + AuthorityDecision (compile-only).
3. **MultimodalEnvelope validate** — parse/reject missing hash, dual inline+url, empty parts; CT-01…03 green.
4. **AuthorityMatrix stubs** — data file + lookup; wire `email.send` → ask/deny; no network.
5. **capture_truth helpers** — `canShowListening(env)`; unit tests for denied/unavailable.
6. **PathClassifier rules** — pure functions; gold table (hi→SHORT; status→AGENT; fix bug→HANDOFF Foundry; CapCut→HANDOFF HVS).
7. **PathClassifier facade** — compose `socialCheckin` + `intentClassifier` signals; never use provider brand as seat.
8. **ShortPathRuntime** — single model-router call; enforce seats=[]; max 1 OWNABLE tool; emit OutputEnvelopeFields.
9. **ResponseLayer stub** — summary + completion_state + path_used + capture_truth?; ban claim-id dump / poetic READY.
10. **Hook liveChatPipeline** — feature-flag `GI_ENG_01_SHORT_PATH=1` (default off until Mark says on); SHORT early-return.
11. **Render / fullTeam gates** — SHORT never opens six-seat theatre.
12. **WR-GA harness + fixtures 1,2,7,8** — skeleton; 1 and 7 must be enforceable unit-level; 2 and 8 may assert classifier/authority decisions without full EBC/email.
13. **Negative pack** — always-six on “hi”; LISTENING on permission_denied; Council git.push; silent email.send.
14. **Stop** — no install/deploy; no Foundry mutate; report fixture results to Commander; await GI-ENG-02.

---

## 7. Acceptance tests / fixtures (WR-GA 1, 2, 7, 8 skeleton)

Aligned to terra §46 + Blind Spot GA-01/02/07/08 themes.

| ID | Scenario | Pass criteria |
|---|---|---|
| **WR-GA-1** | “Hi Council” / trivial QA | `path=SHORT_PATH`; `seats_used=[]`; no family-deliberation / roundMachine; ResponseLayer has no debate panel; completion_state ≠ fake READY |
| **WR-GA-2** | “Status on War Room” | `path=AGENT_PATH`; mission_class SYSTEM_STATUS; **not** six seats by default; if tools down → TOOL_BLOCKED visible (skeleton may mock gate); GA-08: UNKNOWN≠READY |
| **WR-GA-7** | Voice envelope with `capture_truth=permission_denied` (or device_unavailable) | `canShowListening()===false`; UI contract field ≠ LISTENING; no STT invented transcript |
| **WR-GA-8** | Tool `email.send` without grant | AuthorityDecision `ask` or `deny`; maps to existing dangerous `email_send` policy; no send side effect; audit reason present |

**Also required unit IDs (Science / WAVE_G):**

| ID | Pass |
|---|---|
| PATH-01 | “What is EBC?” → SHORT · seats=[] |
| PATH-02 | “Status on War Room” → AGENT (EBC-class) |
| PATH-03 | “Fix this bug in repo” → HANDOFF Foundry |
| CT-01 | Image-only turn validates with AssetRef |
| CT-03 | Missing content_hash → refuse ingest |
| OE-01 | SHORT never lists seats as debate panel |
| AUTH-03 | capability ∧ deny → visible TOOL_BLOCKED/REFUSED |
| GA-01 | All I/O typed envelopes (fixture envelope round-trip) |
| GA-02 | Module routing: code→Foundry handoff stub, not Council patch |

**CI posture:** Harness may run on box audit checkout when Mark unlocks builds; **no PRODUCTION_PROVEN** claim from skeleton alone.

---

## 8. Risks + rollbacks

| Risk | Class | Mitigation | Rollback |
|---|---|---|---|
| Hook breaks live Council chat | runtime | Feature flag default **off**; canary via `councilPathCanary.ts` patterns | Flip flag off; revert pipeline hook commit |
| Classifier sends everything SHORT (under-verify) | safety | Ambiguous → AGENT/clarify; gold negatives for SYSTEM_STATUS | Tighten rules; disable SHORT flag |
| Classifier sends everything AGENT (always-six cost) | cost/echo | Explicit SHORT table; AT-COST style assert on “hi” | Expand SHORT rules; enforce seats=[] |
| Fake LISTENING regresses in UI | honesty | Single `canShowListening` SoT; fixture 7 in CI | Remove LISTENING badge binding |
| Authority stub diverges from `lib/permissions` | safety | Stub rows call into existing policy helpers | Delete stub auto paths; deny-by-default |
| Accidental Foundry/Terra mutate | ownership | No imports that write Foundry/Terra SoR; REFUSE rows | Revert; rely on Foundry HOLD |
| Twin registry creep | architecture | Only `authorityMatrix.stub` + existing skills | Delete new registry files |
| Nebula tip differs from audit | process | Reconcile before merge; UNKNOWN≠READY | Hold merge until remote read |
| Plan treated as shipped | process | Builds HOLD; §10 gate text | Commander rejects; research continues |

---

## 9. Effort estimate (engineer-days, honest ranges)

| Slice | Days (1 eng) | Notes |
|---|---|---|
| Types + envelope validators + capture_truth | 1.0–1.5 | Mostly pure TS |
| PathClassifier rules + facade + tests | 1.5–2.5 | Gold table iteration |
| AuthorityMatrix stubs + policy map | 0.5–1.0 | Align to existing permissions |
| ShortPathRuntime + model-router wire | 1.5–3.0 | Highest uncertainty (live pipeline) |
| liveChatPipeline / render gate hooks + flag | 1.0–2.0 | Regression risk |
| ResponseLayer stub | 0.5–1.0 | |
| WR-GA harness + fixtures 1/2/7/8 | 1.0–2.0 | 2 & 8 skeleton depth varies |
| Nebula reconcile / PR hygiene | 0.5–1.5 | If remote unlocked |
| **Total** | **7.5–14.5 eng-days** | Assume ~1.5–3 calendar weeks part-interrupt; **not** a weekend |

**Buffer:** +2 days if liveChatPipeline entanglement worse than audit suggests; +2 if Nebula diverges hard.

---

## 10. Exact Commander approval gate text

### APPROVE PLAN → ALLOW CODE (what unlocks)

Mark reply (exact intent): **`APPROVE GI-ENG-01 PLAN — ALLOW CODE`**

Unlocks **only**:
1. Creating/modifying files listed in §5 under war-room-os (or Nebula equivalent after reconcile).
2. Implementing PathClassifier, MultimodalEnvelope validators, capture_truth, AuthorityMatrix stubs, ShortPathRuntime, ResponseLayer stubs, WR-GA 1/2/7/8 skeleton.
3. Feature-flagged hooks into `liveChatPipeline` / render gates.
4. Unit/validation tests on box; local typecheck of touched packages.
5. Draft PR description / patch for Commander review — **still no deploy**.

### STILL FORBIDDEN after that approve (need separate go)

- Install / production deploy / Nebula service restart as “ship”
- Foundry code execution changes, git push, repair loops, HVU
- Realtime voice provider integration
- Computer-use broker
- HVS/Media/Terra SoT changes
- MCP marketplace / live email send
- Enabling SHORT_PATH flag in production without explicit **`ENABLE GI-ENG-01 SHORT_PATH`**
- Claiming PRODUCTION_PROVEN / research-sold-as-shipped
- Any Council2 / registry2
- Mutating EBC research artifacts as if they were runtime SoT

### REJECT / HOLD PLAN

Mark reply: **`REJECT GI-ENG-01 PLAN`** or **`HOLD GI-ENG-01`** → zero code; revise plan only.

### Scope freeze

Approve does **not** silently expand into `DC-GI-P0-KERNEL` remainder or GI-ENG-02. Those need their own plans.

---

## 11. Relationship to Foundry HOLD and EBC research HOLD

| Track | Status (this stamp) | Relation to GI-ENG-01 |
|---|---|---|
| **EBC research** (`/home/box/war-room-council-intel/…`) | RESEARCH COMPLETE · **Builds HOLD** — architecture locked; not runtime-proven on Nebula | GI-ENG-01 **preserves** EBC pipeline for AGENT_PATH; does not implement full board/LUMEN/PHOENIX rewrite; SOCIAL_CHECKIN generalization feeds SHORT_PATH |
| **Foundry SE research** (`/home/box/foundry-standalone-engineer/…`) | RESEARCH · **HOLD build until Commander approve** · HOLD HVU | GI-ENG-01 may add **typed handoff stub** (`foundry.handoff` REQUIRE_AUTH) only; **Foundry not mutated**; no patch/git/deploy from Council |
| **Divine Council GI research** | RESEARCH folded · Builds HOLD | This plan is the first eng mission post-research; code still locked until §10 |
| **GI-ENG-01 implement** | **PLAN ONLY** until Mark approve | Slice A of P0 kernel |

**Joint rule:** Foundry HOLD and EBC HOLD remain in force for their respective execution surfaces even after GI-ENG-01 code approve. GI-ENG-01 must not be used as a wedge to “just fix Foundry” or “ship full EBC.”

---

## Appendix A — SoT citation map

| Plan § | Primary cites |
|---|---|
| Goal / scope | terra §54; home §54; Engineer `DC-GI-P0-KERNEL` |
| Conversation / paths | terra §5; home §5; Science §6; WAVE_1 §1.5 |
| Envelopes | Science §§1–2; home §36; terra §37; WAVE_6_7 §12 |
| capture_truth | terra §12; WAVE_C voice; DC-BS-02 |
| Authority | terra §36; home §38; WAVE_G §38; EBC Appendix C |
| Observability / placement | home §§39–40; WAVE_G §§39–40 |
| Foundation / phases / tests | terra §§48–50; home §§48–50 |
| Fixtures | terra §46; Blind Spot GA-01/02/07/08 |
| Non-goals | terra §52; home §52 |

## Appendix B — Audit tip inventory (key council clusters)

Verified present under `/workspace/war-room-os-audit/lib/council/`:
`routing/`, `approval-authority/`, `approval-issuance/`, `execution-gate/`, `live-orchestration/`, `brain-selection/`, `skills/`, `family-deliberation/`, `session-orchestration/`, `memory-write-gate/`, `runtimeTruth/`, `auto-mode-sandbox/`, plus root `intentClassifier.ts`, `liveChatPipeline.ts`, `familyRoster.ts`, `commandAuthority.ts`, `fullTeamGate.ts`, `councilRenderGate.ts`.

Conversation: `/workspace/war-room-os-audit/lib/conversation-runtime/**`.  
Permissions: `/workspace/war-room-os-audit/lib/permissions/**`.  
Model router: `/workspace/war-room-os-audit/lib/model-router/**`.

---

## Stamp

```
GI-ENG-01_PLAN READY FOR COMMANDER
Paths:
  /home/box/divine-council-gi/GI_ENG_01_PLAN.md
  /workspace/terra-swarm/divine-council-gi/GI_ENG_01_PLAN.md
Mode: PLAN ONLY — no code until APPROVE GI-ENG-01 PLAN — ALLOW CODE
Locks: CAPABILITY≠AUTHORITY · seat≠provider · no fake LISTENING · no always-six · Foundry not mutated · no install/deploy
```

*End GI-ENG-01 plan — Divine Council GI*
