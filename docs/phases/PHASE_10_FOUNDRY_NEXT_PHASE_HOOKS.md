# Phase 10 — Integration hooks for NEXT-FOUNDRY-ENGINEERING

Nothing here is implemented knowledge/skill storage. Mark's research proposal and the Kimi knowledge bundle (Desktop `warroom upgrade plan`) were
read and left intact; they are research corpus, not a War Room capability. These are the seams the next phase can attach to.

| Next-phase need | Existing hook | Shape today |
|---|---|---|
| Durable engineering knowledge | `lib/agents/ops/engineering/lessons.ts` (`Lesson`, `captureLessons`, `lessonsFor`) | Lessons are evidence-linked (assignment + failure) corrections by error class and task class. A knowledge store can ingest `lesson` records and promote them (Commander approved) into curated knowledge; `lessonsFor` is the single retrieval seam. |
| Executable skills | `AgentSpec.toolScope`, `ENGINEERING_TOOLS`, `runFeatureWorkflow` step protocol | A skill = a named, versioned recipe that plans slices and gates; it must run through `assign` (tool scope, limits, Commander gate for writes). |
| Automatic recall | `WorkflowDeps.lessons` callback (called per file and per repair prompt) | Swap the callback for a retriever over knowledge + lessons; prompt budget is already bounded. |
| Phase 9 learning | Phase 9 recursive-learning event model | Emit engineering outcomes (actual executor, tokens, verifier score) as events; not yet wired. |
| Model selection | `lib/agents/forge/routing.ts` (`routeFor`) | Evidence-only per task class; wiring into assignment execution is pending first full-score evidence. |
| Training-example curation | Debug ledger (`FAILURE` -> `REPAIR` -> `VALIDATION ORIGINAL_FIXED`) and verifier-passed assignments | Verified fix triples are the clean source; secrets are already refused by the log. Curation needs Commander approval and redaction review. |

Rules the next phase must keep: Commander approval gates, no secrets in persisted state, UNKNOWN when unmeasured, scripted-double evidence never counted as capability.
