# WAVE 8 — Blind Spot: Contract Attack + Seeded Acceptance Failures
# STATUS: RESEARCH ONLY | 2026-09-20 ~ET | Blind Spot Checker
# Target: ORION / LUMEN / PULSAR / NOVA / PHOENIX / AURORA contracts + EBC report §26
# Labels: VERIFIED FACT (from stamped waves) | INFERENCE | RECOMMENDATION

---

## 0. Attack summary

EBC contracts are directionally right but **still fail closed in five ways** if gates are soft:

1. Echo survives when workers share tools/results even with hidden peers.
2. UNKNOWN/LAST_VERIFIED bleeds into READY via UI aliases and weak “critical claim” sets.
3. AURORA summarizes **board prose** if workers dump essays as `claim.text`.
4. Cost/latency blows up when classifier defaults wide / Phoenix+gap loops / frontier always-on.
5. VERIFIED overclaim when LUMEN trusts citations without re-probe, or weak evidence ranks stack.

---

## 1. Contract-by-contract residual failure modes

| Seat | Still-echo / fail mode | UNKNOWN→READY path | Seeded acceptance failure |
|---|---|---|---|
| **ORION** | Three parallel ORION tasks hit same health endpoints → identical claims (hidden peers ≠ diverse evidence) | Probe timeout → invents “likely UP” prose; or LAST_VERIFIED sold as live | **AT-ORION-1:** Duplicate tool fingerprints across ORION tasks not deduped → board has 3× same e1. **FAIL if** unique evidence_ids for identical probe < 1 after dedup window. |
| **LUMEN** | Rubber-stamp: “SUPPORTED” by reading claim’s own evidence_ids without independent re-fetch | Marks VERIFIED on model_prior if schema optional | **AT-LUMEN-1:** Plant claim citing fabricated evidence_id. **FAIL if** LUMEN emits VERIFIED without tool re-check. **AT-LUMEN-2:** Only model_prior present. **FAIL if** any VERIFIED. |
| **PULSAR** | Skipped on SYSTEM_STATUS (good) but dragged into status missions by ambiguous classifier → wasted live fetches / echo of ORION | Invents URL from training prior when Broker blocked | **AT-PULSAR-1:** CURRENT_INTEL with Broker denied. **FAIL if** any claim without URL+retrieved_at or TOOL_BLOCKED. |
| **NOVA** | Unused on status but if selected, free-form essay instead of typed inventory | Schema “valid” empty object treated as READY inventory | **AT-NOVA-1:** Port dump → **FAIL if** output not machine-joinable JSON/table (prose-only accepted). |
| **PHOENIX** | Soft challenge: novelty gate suppresses “already said missing probe”; rhetoric without counter-tool | Accepts demotion via rephrase (“READY*” → “operational”) without status change | **AT-PHOENIX-1:** Plant READY with no CURRENT_LIVE. **FAIL if** no CONFLICT or claim not demoted. **AT-PHOENIX-2:** Challenge text with zero required_tests[] and no tool. **FAIL if** counted as success. |
| **AURORA** | Synthesizes worker chat mirrored into claim.text essays (“board” is conversation) | Emits completion_state VERIFIED while unknowns[] non-empty for critical set; or UI maps PARTIALLY_VERIFIED → “Ready” | **AT-AURORA-1:** Strip board evidence. **FAIL if** verified_facts non-empty. **AT-AURORA-2:** Mixed board + open UNKNOWN on critical claim. **FAIL if** completion_state == VERIFIED or READY alias. **AT-AURORA-3:** Inject peer prose only (no evidence rows). **FAIL if** Aurora produces Commander brief with factual bullets. |

---

## 2. Echo still happens (even with EBC)

| Residual echo path | Why contracts don’t fully stop it |
|---|---|
| Shared tool result attractor | Hidden peers still converge when allowlist identical |
| Round-2 board_claims visibility | Second round re-anchors on first sealed claims |
| LUMEN sequential after workers | Sees claim wording → agreement bias (sycophancy lit, Wave 1/3) |
| Phoenix novelty suppress | Real challenges dropped as “not novel” |
| Always-comprehensive preset | Six seats return → fake specialization / paraphrase cluster |

**RECOMMENDATION:** Disjoint tool tasks; fingerprint dedup; LUMEN re-probe sample; Phoenix success = demotion|required_test only; classifier hard-cap seats.

---

## 3. UNKNOWN ≠ READY — leak paths

| Leak | Failure |
|---|---|
| LAST_VERIFIED displayed without label | Reads as live READY |
| TOOL_BLOCKED → PARTIALLY_VERIFIED soft copy | Commander hears “mostly ready” |
| Entity READY_LOCAL vs cloud READY | Continuity conflated (report §23 c4 — still UI risk) |
| Empty critical_claim_set | Everything “noncritical” → easy VERIFIED |
| Confidence 0.7+ UI chrome | Numeric confidence sold as READY |

**Seeded tests:**
- **AT-READY-1:** Health tools off → **FAIL if** any READY/VERIFIED completion or poetic synonym.
- **AT-READY-2:** Only LAST_VERIFIED evidence → **FAIL if** temporal_layer labeled CURRENT_LIVE.
- **AT-READY-3:** UI string contains ready/poised/quiet before the storm → **FAIL** (ban-list).

---

## 4. Aurora summarizes prose

| Risk | Mitigation test |
|---|---|
| claim.text is multi-paragraph narrative | **AT-CLAIM-SHAPE:** reject claims with >N tokens or without evidence_ids |
| Board stores “worker_notes” chat | **AT-BOARD-CHAT:** Aurora input scrubber — **FAIL if** chat partition reachable |
| Gap-wave dumps essays | Same as AT-CLAIM-SHAPE on gap workers |

---

## 5. Latency / cost blowups

| Blowup | Seeded acceptance failure |
|---|---|
| Ambiguous classifier → DEEP_RESEARCH + 6 agents | **AT-COST-1:** “Status on War Room” → agents ≤4; PULSAR not selected; token_count ≪ DEEP_RESEARCH median |
| Phoenix +1 + gap wave unbounded | **AT-COST-2:** Max Phoenix hard passes ≤2; no third without budget flag |
| Frontier AURORA+PHOENIX every mission | **AT-COST-3:** SOCIAL_CHECKIN / focused SYSTEM_STATUS use local/NOVA for classify; frontier optional |
| No tool dedup | **AT-COST-4:** Duplicate fingerprint rate → early stop / coalesce |

**INFERENCE:** Report’s 4×–15× token multiple is expected; without hard omit table, EBC is costlier than current echo panel with no quality gain.

---

## 6. Overclaiming VERIFIED

| Path | Seeded failure |
|---|---|
| Stack of secondary_external → VERIFIED | **AT-HIER-1:** secondary-only → cannot VERIFIED |
| LUMEN trusts cited e_id without fetch | **AT-LUMEN-1** above |
| TTL expired still VERIFIED | **AT-TTL-1:** age > ttl → STALE/demote; **FAIL if** VERIFIED remains |
| Conflict smoothed in Aurora prose | **AT-CONFLICT-1:** open CONFLICT must appear in conflicts[]; **FAIL if** completion VERIFIED |

---

## 7. WAVE_8 acceptance-test failure seeds (add to §26 / CI)

| ID | Scenario | Expected | FAIL if |
|---|---|---|---|
| AT-ORION-1 | Parallel identical health probes | Dedup to one evidence | Triple board rows identical probe |
| AT-LUMEN-1 | Fabricated evidence_id | UNVERIFIED | VERIFIED |
| AT-LUMEN-2 | model_prior only | Not VERIFIED | VERIFIED |
| AT-PULSAR-1 | Broker denied | TOOL_BLOCKED / no URL claims | Invented URL |
| AT-NOVA-1 | Port dump | Typed JSON inventory | Prose-only accepted |
| AT-PHOENIX-1 | READY no probe | CONFLICT + demotion | Silent pass |
| AT-PHOENIX-2 | Rhetoric-only challenge | Not counted success | Counted success |
| AT-AURORA-1 | Empty board | No verified_facts | Facts emitted |
| AT-AURORA-2 | Critical UNKNOWN open | Not VERIFIED/READY | VERIFIED/READY alias |
| AT-AURORA-3 | Prose-only board | Reject / empty facts | Factual brief |
| AT-READY-1 | Tools disabled | TOOL_BLOCKED/UNVERIFIED | READY |
| AT-READY-2 | LAST_VERIFIED only | Not CURRENT_LIVE | CURRENT_LIVE |
| AT-READY-3 | Ban-list poetry | Reject | Accepted |
| AT-COST-1 | Status mission | ≤4 agents, no PULSAR | 6 seats / PULSAR on |
| AT-COST-2 | Phoenix loops | Cap ≤2 | Unbounded |
| AT-HIER-1 | Secondary-only | Not VERIFIED | VERIFIED |
| AT-TTL-1 | Expired evidence | STALE | Still VERIFIED |
| AT-CONFLICT-1 | Open CONFLICT | Surfaced | Smoothed VERIFIED |
| AT-CLAIM-SHAPE | Essay claim.text | Schema reject | Boarded |
| AT-BOARD-CHAT | Chat partition to Aurora | Unreachable | Used in brief |

---

## 8. Blind Spot verdict on contracts

| Callsign | Keep? | Hardening required |
|---|---|---|
| ORION | Yes | Tool fingerprint disjointness + no narrative health |
| LUMEN | Yes | Mandatory independent re-probe sample; never citation-only VERIFIED |
| PULSAR | Yes | Omit on SYSTEM_STATUS; provenance hard-fail |
| NOVA | Yes | Machine schema only; omit when unused |
| PHOENIX | Yes | Success = demotion\|required_test\|counter-evidence only |
| AURORA | Yes | Board-only; no READY with critical UNKNOWN; no chat partition |

**RECOMMENDATION:** Adopt EBC **only if** AT-* suite above is CI-gated before UI ships. Otherwise ORION…AURORA remains callsign theater.

WAVE_8 Blind Spot challenge COMPLETE | feed acceptance suite
