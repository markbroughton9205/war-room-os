# WAVE 6 — AGI GYM

Date: 2026-08-30  
Verdict: **WAVE 6 — PASS**

This wave has two distinct layers. They must not be collapsed.

## AGI GYM FRAMEWORK

Four bounded gyms remain operational. Observable trajectories only. No hidden chain-of-thought. Failures are preserved. Capability graphs have no AGI-percentage field.

This pass **corrects evidence semantics** so gym-derived records can be trusted as training-data truth:

1. **Objective evaluated vs objective satisfied.** `objectiveEvaluated` is true after an independent evaluation finishes, including verified failures. `objectiveSatisfied` is true only when `outcome === 'pass'`. `objectiveVerified` is now an alias of successful satisfaction, not “a run happened.”
2. **Research process vs claim verification.** A research gym may PASS because it extracted claims and left a conflict unresolved. That does **not** set `claimStatus = verified`. Vocabulary reused from World Learning: observed / candidate / supported / contested / verified / superseded / retracted.
3. **Terra temporal provenance.** Gym-to-canonical conversion copies the observation’s actual `validUntil` / `observedAt` / `verificationAt`. It does **not** rewrite validity to `completedAt + 24h`.
4. **Tool-use is a first-class source.** `ContinuousEvidenceSource` now includes `tool_use` (`tool_use_result`). Unknown gyms no longer collapse into `code_operator`. Additive migration: `supabase/war_room_phase56b_tool_use_evidence_source.sql` (not applied to production).

## LIVE FULL-SYSTEM GYM MATURITY

The gyms are **not** a live autonomous War Room. They do not prove full-system competence.

## Fixture vs live integration matrix

| Gym | Deterministic fixtures | Real persisted records | Live Research Engine / Terra / Code Operator | Future hook only |
|---|---|---|---|---|
| Code Operator | Yes — local file SHA-256 against an immutable Wave 4.2 manifest | Admission through Wave 5 `evaluateContinuousEvidence` | No live Native Builder repair in this gym | Live Code Operator missions remain the Native Builder path |
| Research Engine | Yes — summary + labeled agreement (`conflicting` / `single_source` / `corroborated`) | Claim status recorded; unverified claims **rejected** from positive training admission | Does not call live Research Engine providers | Live multi-source acquisition remains Wave 2/7 Supabase session path |
| Terra world-state | Yes — fixture coordinates and supplied `validUntil` | Canonical Terra admission (stale vs current) | No live sensor fetch; fixtures are **test-only**, not Terra training evidence | Live Terra observations remain the Terra layer path |
| Tool-use | Yes — bounded local `sha256`; uncontrolled tools fail | `source=tool_use` distinct from coding | No general tool runtime | Broader tool protocol remains future |

## Semantic tests (required)

- Passing mission: evaluated true, satisfied true
- Failing mission: evaluated true, satisfied false
- Failed mission feeds curriculum; it is not positive capability evidence
- Conflicting sources: mission PASS, claim **contested**, not verified
- Single-source extraction: mission PASS, claim **candidate**, not auto-verified
- Verified claim only when `verifierConfirmed` + corroborated
- Original Terra `validUntil` survives conversion; stale stays stale; no fabricated extra lifetime; prediction/verification timestamps remain distinct
- `code_operator` / `research_engine` / `terra` / `tool_use` remain distinct in aggregation

## Validation

TOTAL=30 EXPECTED=30 PASS=30 FAIL=0  

Wave 5 regression: TOTAL=34 EXPECTED=34 PASS=34 FAIL=0

Training was not started by gym execution.
