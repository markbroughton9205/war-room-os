# WAR ROOM AGI — Wave 3 Active Learning Report

Date: 2026-08-29  
Verdict: **PASS**

## Scope and repository truth

- Authoritative development repository: `/Users/markbroughton/Developer/war-room-os`.
- Baseline retained: Wave 1 PASS and Wave 2 PASS.
- The repository began with substantial unrelated uncommitted work. Wave 3 changes were confined to the active-learning domain, claim extraction/learning-session integration, one additive migration, validations, and the package validation command.
- `/Users/markbroughton/WarRoomNode01` was not read, written, migrated, built, deployed, committed, or pushed.
- WRIM-1 training was not started. No training command or model-lab state transition was invoked.

## Delivered

1. KnowledgeGap-driven study planning with deterministic research questions and project/user scope.
2. Contradiction gaps produce `targeted_verification` missions, never arbitrary winner selection.
3. Generator, verifier, and evaluator identities are distinct in TypeScript and enforced by PostgreSQL.
4. Research mission completion resolves a gap only when provenance-linked verifier and evaluator evidence both pass.
5. Failure and Commander-correction signals produce deterministic curriculum priorities; corrections have greater weight and still require provenance.
6. Capability nodes change only from objective pass/fail evidence of approved kinds. Generated assertions, prose, poisoned inputs, and provenance-free inputs cannot change capability.
7. Code Operator hooks turn Native Builder repair/validation references into objective pass/fail learning evidence.
8. Terra evidence requires `observed_at` and `valid_until`; expired observations are rejected as current.
9. Prediction records remain pending until their verification time and can only be verified/falsified by scoped, provenance-linked outcome evidence.
10. Stronger deterministic claim extraction splits source-authored summaries into bounded sentence candidates, preserves SourceVersion evidence, and never self-verifies.
11. Training-candidate manifests admit only verified, provenance-linked, sufficiently evidenced, current, unpoisoned records. Contested, candidate, retracted, stale, poisoned, weak, and unapplied-correction records are excluded.
12. Evidence gates determine manifest eligibility. Eligibility, Commander authorization, and training state are separate. PostgreSQL rejects authorization before eligibility and training before authorization; the application permits only an explicit Commander actor to authorize after review. Authorization leaves training `not_started`, and Wave 3 contains no model-training start path.
13. Stored domain types contain observable actions, outcomes, ids, timestamps, and provenance only. No chain-of-thought or hidden reasoning field exists.
14. Existing provider-independent chat shell, Research Engine providers, Context Assembler, Prompt Intelligence, Terra, Native Builder, and sovereign-model-lab training state machine remain unchanged.

## Files

- `lib/active-learning/types.ts`
- `lib/active-learning/engine.ts`
- `lib/active-learning/store.ts`
- `lib/active-learning/index.ts`
- `lib/active-learning/engine.validation.ts`
- `lib/active-learning/postgrest.validation.ts`
- `lib/world-learning/claimExtraction.ts`
- `lib/world-learning/claimExtraction.validation.ts`
- `lib/world-learning/learningSession.ts`
- `supabase/war_room_phase52a_active_learning_curriculum.sql`
- `package.json`

## Exact validation evidence

### Deterministic application validation

Command: `pnpm run validate:agi-wave3`

- Context Assembler rank: 8/8 PASS
- Context Assembler assembly: 9/9 PASS
- Context Assembler security: 5/5 PASS
- Model Router: 11/11 PASS
- Next Action: 7/7 PASS
- Prompt Intelligence: 19/19 PASS
- Intent Pre-Router: 13/13 PASS
- Search ranking: 9/9 PASS
- World Learning contradiction detection: 3/3 PASS
- Wave 3 claim extraction: 2/2 PASS
- Wave 3 active-learning engine: 19/19 PASS

Wave 3 cases explicitly prove gap-to-mission generation, contradiction-targeted questions, role separation, verifier/evaluator gating, evidence-only capability changes, failure/correction curriculum weighting, Code Operator pass/fail evidence, training exclusions, Terra time scope, prediction verification, scope mismatch rejection, provenance-only manifests, no training authorization, and absence of hidden-reasoning fields.

### Static quality validation

- `pnpm exec tsc --noEmit` — PASS
- Targeted ESLint over all Wave 3 and modified World Learning files — PASS

### Disposable live PostgreSQL + PostgREST validation

The consolidated local base schema plus Phases 50, 51, and 52A were applied to a newly initialized disposable local PostgreSQL 16.15 database. Standalone PostgREST 16.2 was placed behind a local `/rest/v1` rewrite proxy, and the real `supabase-js` store path was exercised. The following live checks passed:

- scoped study mission persisted — PASS
- provenance-linked learning evidence persisted — PASS
- all five Phase 52A tables were visible in the PostgREST schema cache — PASS
- service-role reads/writes through PostgREST — PASS
- anon access denied — PASS (HTTP 401)
- KnowledgeGap mission, curriculum evidence, capability evidence, training manifest, and prediction verification persistence — PASS
- authorization A–J state/lineage/provenance checks — PASS
- authorized manifest remained `not_started` — PASS
- same generator/verifier identity rejected by constraint — PASS
- Terra observation without `valid_until` rejected — PASS
- eligible manifest with Commander identity could become authorized — PASS

The proxy and services were stopped and the temporary data directory was removed after validation. All endpoints were loopback-only (`127.0.0.1`); no configured remote/Supabase or production database was contacted.

## Remaining boundaries

1. Phase 52A has not been applied to any shared or production database, by mission restriction.
2. Study missions are exposed as domain/store APIs, not scheduled autonomously. A later approved runtime lane must decide cadence, budgets, provider choice, and Commander visibility before autonomous execution is enabled.
3. Training candidates remain manifests only. Commander authorization is now representable after eligibility, but authorization does not start training and no WRIM-1 model-training action exists in Wave 3.
4. No UI was added; this wave builds the governed intelligence spine and evidence gates.

## Verdict

**PASS.** Phase 52A works through an actual local PostgREST and `supabase-js` path. The former permanent authorization prohibition was replaced by explicit eligibility, Commander-authorization, and training-state guards. WRIM-1 remains untrained; production remained untouched.

## NEXT STEPS FOR OPERATOR

1. Required environment changes: no new environment variables.
2. Required SQL/migrations: after review, apply `supabase/war_room_phase52a_active_learning_curriculum.sql` to an approved non-production database first. Do not apply to production as part of this report.
3. Restart requirements: reload the PostgREST schema cache after applying the migration; restart the development server only if it was already running while the code changed.
4. Verification routes: no new public route was added. Run `pnpm run validate:agi-wave3`; then exercise the active-learning store from an approved local/non-production PostgREST harness.
5. Expected successful output: all validation suites pass; bad role combinations, timeless Terra evidence, premature authorization/training transitions, WRIM-0 lineage changes, and provenance-poor eligible manifests are rejected.
6. Feature flags: none added or changed. Autonomous scheduling and WRIM-1 training remain disabled.
7. Visible UI change: none expected.
8. Safe rollback: before shared database use, remove the new code/migration files and restore the three narrow edits. After a non-production migration apply, drop only the five Phase 52A tables after confirming no retained test evidence is needed.
