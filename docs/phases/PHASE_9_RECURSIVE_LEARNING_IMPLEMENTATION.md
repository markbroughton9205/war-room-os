# Phase 9 — Recursive Learning and Evaluation Systems: Implementation Scope (FROZEN)

Source of truth: `docs/phases/phase-9.md`. This document only decomposes it; the roadmap wins on any conflict.
The Foundry operator-polish track (`docs/foundry/FOUNDRY_OPERATOR_POLISH_SCOPE.md`) is NOT this phase.
`validate:ascension-phase9` belongs to the separate Ascension namespace and is untouched.

Code lives in `lib/recursive-learning/`. Validation: `pnpm run validate:recursive-learning`.
Evidence: `/home/chosenone/Documents/Codex/Seagate/war-room-backups/evidence/phase9-recursive-learning/`.

## Systems

| ID | System | Module |
|----|--------|--------|
| A | Evaluation Event Model (append-only, supersede-not-delete) | `eventModel.ts`, `store.ts` |
| B | Provider/Model scoring by task class (decay, smoothing, confidence) | `scoring.ts` |
| C | Workflow evaluation / ranking from measured outcomes | `scoring.ts` |
| D | Recurring failure analysis | `analysis.ts` |
| E | Strategic memory promotion candidates (approval-gated) | `proposals.ts` |
| F | Routing recommendations (evidence-cited) | `recommendations.ts` |
| G | Doctrine / architecture proposals (never self-applied) | `proposals.ts` |
| H | Operator evidence surface (drill-down to source events) | `evidence.ts` |
| I | Independent evaluation (oracle computed separately from the scorer) | `phase9.validation.ts` |

## Learning inputs
Commander approvals/rejections, validations, reviewer findings, provider/model performance, completion time,
cost/token usage (when available), retries/errors, rollbacks, user corrections, installed outcomes, repeated patterns.

## Permitted
evaluate, score, rank, detect, recommend, propose, surface evidence.

## Forbidden (enforced structurally, tested)
Silently rewriting governance; weakening security/auth; altering deployment rules; spending money; push/merge;
promoting strategic memory without Commander approval; concealing contradictory evidence.
The module exposes no function that applies a recommendation or mutates policy/config; proposals are data only.

## Out of scope
Terra World, VR, HVS expansion, DeepSeek/Hermes, Council replacement, kernel work, Ascension Phase 9, operator polish,
UI/route wiring (a later, separately approved slice), Supabase migrations.

## Acceptance tests (all required)
1 scores differ by task class · 2 one bad run does not permanently destroy ranking · 3 stale evidence decays ·
4 recurring failures detected · 5 contradictory evidence lowers confidence · 6 workflows rank from measured outcomes ·
7 routing recommendation cites evidence · 8 hard policy never silently mutated · 9 memory candidates cannot auto-promote ·
10 rejected recommendation stays auditable · 11 rollback negatively affects relevant evaluation ·
12 Commander correction affects evaluation · 13 cost/latency can influence recommendations ·
14 missing metrics remain UNKNOWN, not zero · 15 evaluation survives restart · 16 recommendation drills down to source evidence ·
17 evidence can be superseded without deletion · 18 failed validation cannot become success.

## Slices
S1 scope freeze · S2 event model + store (A, tests 14,15,17,18) · S3 scoring + workflows (B,C; 1,2,3,5,6,11,12,14) ·
S4 failure analysis + proposals (D,E,G; 4,9) · S5 recommendations + evidence (F,H; 7,8,10,13,16) ·
S6 independent evaluation + package script (I) · final checkpoint. No push/merge/deploy.
