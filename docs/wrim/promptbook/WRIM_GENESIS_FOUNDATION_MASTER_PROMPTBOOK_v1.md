# WRIM Genesis Foundation Master Promptbook v1

Authoritative curriculum and execution contract for Higher Visions University / War Room OS.

This document is the human-readable companion to the machine-readable graph in this directory and the runner `scripts/wrim-environment/wrim_foundation.py`.

**Ra'el is not WRIM.** WRIM Genesis is the Foundation model program. Ra'el is a future sovereign orchestration layer. Do not relabel WRIM checkpoints as Ra'el.

## Live state after this build

| Field | Value |
|---|---|
| CURRENT_SCHOOL | SCHOOL_05_NATURAL_ENTRY |
| CURRENT_MISSION | NATURAL_ENTRY_NE1_REVIEW |
| TRAINING_AUTHORIZATION | OFF |
| CANONICAL | STEP_400 |
| PARENT | WRIM1-UH1-AC2-EA1-000010/step-25 |
| MOD_02A_IMPORTED | YES |
| MOD_02A_ROUTER_PROOF | PASS |
| RMR1_PRODUCTION_READY | NO |
| RMR1_EXTRA_UNSEEN_RECALL | 0.45 |
| RMR1_TWO_TOKEN_REGRESSION_OPEN | YES |
| NE1_IMPLEMENTED | NO |

Do **not** rerun MOD-02A by default. Import its completed evidence. School 04 is experimental-pass with remaining generalization and two-token regression work. School 04B is a callable remediation lane, not the current school.

## Canonical and parent

- Canonical remains **STEP_400**. Hash `f82f4364b16842ca3d43427251299f1ad38d5104f24013251f2ebc6af6607af8`.
- Experimental parent: `WRIM1-UH1-AC2-EA1-000010/step-25` hash `8e6505954602961d7b432362b67633aa1cc798f7a7b4262624edb3ed213323fb`.
- Architecture: WRIM-G-20M-v1-option-A-UH1-AC2-EA1-RA1. d_model=256, layers=18, heads=4, d_ff=768, ctx=512, vocab=15126.
- EA1 B32 16640 pre_lm_head entry. RA1 B32 16640 pre_lm_head span token2+. NA1 experimental, **not in route table**.
- Stage3 = 6/6. Floor 5/6, never 4/6. Global base drift 0. Document parity PASS.

## Proven routes

- **STRUCTURED:** EA1 + RA1. Protected identity: phrase 17, blue 3, no 5, dog 5, cat 4, two 6, three 10, paraphrase 3.
- **NATURAL:** EA1 + BYPASS (RA1 off, NA1 off). Official greedy 3, extra-unseen 1.
- EA1-off + BYPASS: official 2, extra 0. EA1 helps natural entry. Do not remove EA1 globally.
- RA1 hurts natural continuation.

## School 04 — Response-mode routing (completed experimental proof)

MOD-02A is **implemented and completed**. Linear(256→2)+bias = 514 parameters. Input `pre_ea1`. Outputs STRUCTURED / NATURAL. Per-response latch until EOS. Fail-closed STRUCTURED.

| Metric | Value |
|---|---|
| Train / val / extra | 96 / 32 / 20 |
| Val accuracy / FN | 1.0 / 0.0 |
| Extra-unseen recall | 9/20 = 0.45 |
| Analysis probe extra | 13/20 = 0.65 |
| Threshold | 0.75 validation-only |
| Learned vs always-structured official natural | 3 vs 1 |
| Learned extra greedy | 0 (oracle-bypass extra 1 fail-closed on `no`) |
| Two-token val learned vs always-structured | 1 vs 3 |

**ROUTER_PRODUCTION_READY = NO.** **ROUTER_REGRESSION_OPEN = YES.** Leakage audit MEDIUM (Say/Reply/Print/Halt, target echo, `no` in both families). Do not install RMR1 in War Room runtime. Do not hide the 0.45 vs 0.65 gap.

School 04B (router data remediation) remains callable. Do **not** block School 05 solely because production routing remains incomplete. The response-mode architecture itself is proven.

## School 05 — Natural entry (current)

Token1 natural entry is the primary Foundation bottleneck. Gold token1 unlocks 3→6 official and 1→9 extra continuation under bypass.

Current mission **NATURAL_ENTRY_NE1_REVIEW** is diagnostic and decision, not automatic NE1 construction.

Decide among:

- A. Data/objective redesign using current EA1
- B. Bounded NE1 entry specialist proof
- C. Another evidence-supported entry mechanism

NE1 may be built only if: token1 remains earliest failure; gold-token1 still strongly exceeds free greedy; EA1 useful but insufficient; router/mode selection is not the primary failure; leakage audited; objective defined without training on held-out eval.

If justified later: NE1 B32, entry-only, pre_lm_head, natural mode only, zero-init, train NE1 only, freeze base/EA1/RA1/router/lm_head/tok_emb/transformer. Capacity proof uses **oracle NATURAL** (NE1 token1, BYPASS token2+). Do not mix RMR1 generalization into the first NE1 test. Structured route EA1+RA1 stays deterministic.

Budget if later authorized: 102400 natural-entry tokens, extend once to 204800 total if held-out geometry improves and is safe.

## Schools 06–15

06 Natural continuation (do not revive NA1 unless entry is established and bypass span is proven insufficient).  
07 Natural generalization (split train/val/extra/family/paraphrase/adversarial; never merge public scores).  
08 Multi-turn context-window conversation (not persistent memory).  
09 Instruction following.  
10 General language.  
11 Reasoning foundation (small, measurable, no advanced-reasoning claims).  
12 Structured output (do not regress code/JSON NLL).  
13 Tool-use readiness (War Room governs tools).  
14 Self-evaluation / uncertainty.  
15 Foundation graduation on frozen `WRIM-FOUNDATION-GRADUATION-1-v1.0.0`. Never train on it. Never self-promote. Return to Commander.

## Ra'el bridge

Designed only after Foundation graduation authorization. Phases RAEL-00 … RAEL-10. No Ra'el training in this program.

## Execution engine

Runner: `PYTHONPATH=. python wrim_foundation.py <cmd>` from `scripts/wrim-environment`.

Commands: status, plan, run-current-stage, resume, evaluate, verify, report, pause, abort-safe, show-ledger, show-capability, show-next-boundary, dry-run, test, crash-recover, bootstrap.

The engine is a state machine. Ordinary bugs are fixed and continued. Scientific lane exhaustion (3 distinct strategies) returns to Commander. Single trainer lock remains. No unauthorized optimizer. Token replay protection uses authorization epoch + durable cursor.

## Return to Commander

Graduation review, canonical promotion, architecture beyond preauthorized small adapters, scientific lane exhausted, new corpus source, model scale, master budget expansion, frozen-hash violation, trainer governance failure, unresolved grad hard-stop, eval contamination, security, model promotion, Stage3B, Ra'el execution.

Do not return for syntax errors, eval-script bugs, one failed LR, or a recoverable crash.

## Artifacts

Experimental MOD-02A report and router weights live under the WRIM data root. They are experimental, not production, not canonical.
