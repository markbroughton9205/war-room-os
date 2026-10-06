# SCIENCE DENSIFY — Waves 3–6 Schemas + Algorithms
# Avenue: Science Analyst | RESEARCH ONLY | 2026-09-20
# Purpose: Concrete foldables for PA2 / Wave 8 report. Does not reopen WAVE locks.
# Labels: VERIFIED FACT | INFERENCE | RECOMMENDATION

---

## A. Parallel vs sequential (Wave 3) — algorithm

**RECOMMENDATION:** Round-1 **parallel**; Round-2+ **sequential or limited re-fan** only when board events require it.

```
function run_mission(mission):
  plan = classify_and_decompose(mission)          # Wave 5
  workers = plan.selected_agents - {AURORA}       # Aurora never Round-1 author
  # ROUND 1 — parallel, peer_visibility=none
  results = parallel_map(workers, λ a → a.first_pass(plan.tasks[a], peer=NONE))
  for r in results:
    if not schema_ok(r): reject(r); continue
    if not novelty_ok(r, board): suppress(r); telemetry.echo++
    else: board.append(r.evidence, r.claims)
  # ROUND 2 — LUMEN verify (board claims only)
  lumen.verify(board.claims, tools=plan.tools)
  # ROUND 3 — PHOENIX claim-level adversarial
  phoenix.challenge(rank_claims(board), tools=plan.tools)
  # ROUND 4 — AURORA synthesis (board snapshot only)
  return aurora.synthesize(board.snapshot())
```

**When sequential instead:** single-thread dependency chains (`depends_on` non-empty and no disjoint cut); tool rate-limits; or budget forces one worker.

**Early stop:**
```
if critical_claims.all(status in {VERIFIED}) and conflicts.empty and budget_ok:
  skip remaining rounds → Aurora
```

---

## B. Information-gain / anti-echo (Wave 3) — scoring

**Novelty rule (LOCKED):** accept iff contribution adds ≥1 of  
`NEW_EVIDENCE | NEW_CLAIM | CONTRADICTION | RISK | TEST | CAUSAL_EXPLANATION`

```
function novelty_ok(contrib, board) → bool:
  gain = 0
  if any e in contrib.evidence where e.evidence_id ∉ board.evidence_ids: gain += NEW_EVIDENCE
  if any c in contrib.claims where normalize(c.text) ∉ board.claim_texts: gain += NEW_CLAIM
  if contrib.contradictions: gain += CONTRADICTION
  if contrib.risks: gain += RISK
  if contrib.tests_recommended: gain += TEST
  if contrib.causal_explanations: gain += CAUSAL_EXPLANATION
  if gain == 0: return false
  # Soft echo gate (INFERENCE — tune threshold)
  if max_cosine(embed(contrib.prose), board.recent_prose) > 0.92 and gain ⊆ {NEW_CLAIM} \
     and claim_text_near_duplicate: return false
  return true
```

**Revision allow predicate:**
```
allow_revision iff (
  new_tool_result ∨ phoenix_conflict_open ∨ claim.stale ∨ schema_fail ∨ commander_reask
) ∧ ¬(paraphrase_only ∨ poetry_only)
max_revisions_per_claim_per_round = 1 unless new evidence_id
```

---

## C. Claim–evidence schemas (Wave 4) — canonical types

```typescript
type EvidenceKind =
  | "live_telemetry" | "tool_result" | "repo_config" | "log"
  | "primary_external" | "secondary_external" | "inference" | "model_prior";

type ClaimLabel = "VERIFIED_FACT" | "INFERENCE" | "RECOMMENDATION";

type ClaimStatus =
  | "PROPOSED" | "SUPPORTED" | "VERIFIED" | "UNVERIFIED"
  | "CONTRADICTED" | "STALE" | "TOOL_BLOCKED" | "WITHDRAWN";

interface Evidence {
  evidence_id: string;
  kind: EvidenceKind;
  summary: string;
  pointer: string;           // url | path | tool_span_id
  retrieved_at: string;      // ISO-8601
  tool_name?: string;
  ok: boolean;
  hash?: string;
  license_class?: "PUBLIC" | "PROVIDER_AUTH" | "COMMANDER_PRIVATE" | "STREAM_ONLY";
  temporal_layer: "HISTORICAL" | "LAST_VERIFIED" | "CURRENT_LIVE";
  as_of?: string;            // required if HISTORICAL
  ttl_s?: number;            // mission-class default if omitted
}

interface Claim {
  claim_id: string;
  text: string;
  status: ClaimStatus;
  evidence_ids: string[];
  confidence: number;        // 0..1 calibrated; not vibes
  label: ClaimLabel;
  last_verified_at?: string;
  critical: boolean;         // classifier/decomposer marks
}

interface AgentEnvelope {
  agent_id: "ORION"|"LUMEN"|"PULSAR"|"NOVA"|"PHOENIX"|"AURORA";
  mission_id: string;
  round: number;
  claims: Claim[];
  evidence: Evidence[];
  contradictions: { claim_ids: string[]; reason: string; evidence_ids?: string[] }[];
  risks: { text: string; severity: "low"|"med"|"high"; evidence_ids?: string[] }[];
  tests_recommended: { text: string; owner?: string }[];
  causal_explanations: { text: string; evidence_ids: string[] }[];
  unknowns: string[];
  novelty: { adds: string[]; suppressed: boolean };
  tokens_used: number;
  latency_ms: number;
}
```

**Board edge types:** `supports | contradicts | derived_from | stale_of`

---

## D. Evidence hierarchy + promotion (Wave 4/6)

**Rank (high→low):**  
1 live_telemetry 2 tool_result 3 repo_config 4 log 5 primary_external 6 secondary_external 7 inference 8 model_prior

```
function can_verify(claim, board) → bool:
  ev = board.evidence[claim.evidence_ids]
  if none(ev): return false
  if all(e.kind == model_prior for e in ev): return false   # never VERIFIED
  if claim.requires_live and none(e.temporal_layer == CURRENT_LIVE and fresh(e)): return false
  if any conflict open on claim: return false
  best = max_rank(ev)
  return best <= 4 or (best <= 6 and mission_class in {DEEP_RESEARCH, CURRENT_INTEL, DOCUMENT_ANALYSIS})
  # SYSTEM_STATUS / INCIDENT: require rank ≤ 2 (telemetry|tool) for critical claims

function on_conflict(e_high, e_low):
  if rank(e_high) < rank(e_low): prefer e_high; open CONFLICT if both critical
  never promote lower over higher without new tool_result
```

---

## E. VERIFY BEFORE CLAIM (Wave 6) — gate

```
function propose_claim(agent, text, label, critical):
  if mission_class in {SYSTEM_STATUS, INCIDENT_RESPONSE} and critical:
    result = run_required_tools(agent.allowlist)
    if result.blocked: emit Claim(status=TOOL_BLOCKED); return
    if result.empty: emit Claim(status=UNVERIFIED) + unknown; return
    attach evidence(kind=tool_result|live_telemetry, retrieved_at=now, CURRENT_LIVE)
  emit Claim(status=PROPOSED|SUPPORTED, evidence_ids=...)
  # Forbidden: READY/VERIFIED from model_prior alone
```

**Ban-list (validator):** poetic readiness fillers (“quiet before the storm”, “poised”, “ready and waiting”, “Adaptive Council · Partial match” as sole status).

---

## F. Confidence + completion state machines (Wave 6/7 seed)

### Claim confidence (RECOMMENDATION formula)
```
confidence =
  0.15 * has_any_evidence
+ 0.25 * has_rank_le_2
+ 0.20 * multi_source_agree
+ 0.15 * fresh_within_ttl
+ 0.15 * lumen_verified
+ 0.10 * phoenix_clear
− 0.30 * open_conflict
− 0.20 * stale
clamp 0..1
```

### Completion state machine
```
STATES = VERIFIED | PARTIALLY_VERIFIED | UNVERIFIED | CONTRADICTED
       | TOOL_BLOCKED | STALE | BUDGET_EXHAUSTED | REFUSED

function completion(board, budget):
  if policy_refuse: return REFUSED
  if required_tools_blocked: return TOOL_BLOCKED
  if any critical CONTRADICTED: return CONTRADICTED
  if any critical STALE and no CURRENT_LIVE refresh: return STALE
  if all critical VERIFIED and no CONFLICT: return VERIFIED
  if some critical VERIFIED: return PARTIALLY_VERIFIED
  if budget.exhausted: return BUDGET_EXHAUSTED
  return UNVERIFIED

# INVARIANT: UNKNOWN ≠ READY. No READY alias.
# advisory: true always for Council output (Commander authority)
```

### Aurora final envelope (authoritative)
```json
{
  "mission_id": "...",
  "mission_class": "SYSTEM_STATUS",
  "completion_state": "PARTIALLY_VERIFIED",
  "confidence": 0.55,
  "verified_facts": [{"text":"...","evidence_ids":["e1"]}],
  "partial_facts": [],
  "unverified": [],
  "conflicts": [],
  "unknowns": [],
  "tool_blocks": [],
  "risks": [],
  "next_actions": [{"action":"...","owner":"ORION|Commander"}],
  "advisory": true,
  "commander_authority": "REQUIRED_FOR_ACTION"
}
```

---

## G. Temporal / stale facts (Wave 4/6)

| Layer | Meaning | Write rule |
|---|---|---|
| HISTORICAL | True at `as_of`; not current | Never imply CURRENT_LIVE |
| LAST_VERIFIED | Last successful check | Update only on tool ok |
| CURRENT_LIVE | `now - retrieved_at ≤ TTL` | Else auto-demote → STALE |

**Default TTLs (RECOMMENDATION — tune per deploy):**
| Mission class | TTL |
|---|---|
| SYSTEM_STATUS | 60–120 s |
| INCIDENT_RESPONSE | 30–60 s |
| CURRENT_INTEL | 5–15 min |
| DEEP_RESEARCH / ARCHITECTURE / DOCUMENT | 24 h (docs); live probes still short TTL |
| ENGINEERING (intel-only) | repo snapshot @ retrieved_at |

```
function refresh_or_stale(claim):
  for e in claim.evidence:
    if e.temporal_layer == CURRENT_LIVE and age(e) > ttl(mission, e):
      e.temporal_layer = LAST_VERIFIED
      claim.status = STALE
      claim.confidence = min(claim.confidence, 0.4)
```

**Stale promotion forbidden:** STALE/HISTORICAL cannot become VERIFIED without new CURRENT_LIVE tool_result.

---

## H. Phoenix rank + challenge (Wave 6)

```
score(claim) = impact_weight(claim) * claim.confidence * thin_evidence_penalty
thin_evidence_penalty = 1.5 if only model_prior|inference else 1.0 if single source else 0.7

for claim in top_k(score):
  emit CONFLICT or required_test
  close only via new evidence_id or WITHDRAWN — never paraphrase
```

---

## I. Fold notes for PA2
- Aligns existing WAVE_3…WAVE_6 locks; densifies algorithms/schemas only.
- Council ≠ Foundry ≠ Terra ≠ Media ≠ HVS.
- Capability ≠ authority; `commander_authority: REQUIRED_FOR_ACTION`.
- Acceptance tests already listed in wave stamps — keep; add novelty gate + TTL demotion unit tests.

SCIENCE_W3-6 DENSIFY READY FOR FOLD
