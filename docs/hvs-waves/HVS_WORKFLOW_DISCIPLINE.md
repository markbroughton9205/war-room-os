# HVS workflow discipline

Additive production order for substantial Higher Vision Studios work. Runtime behavior lives in `lib/media-command/workflow-discipline.ts`, `lib/media-command/lessons/`, and `lib/media-command/verification-classes.ts`. This document does not grant authority.

## Precedence

1. Commander authority
2. Rights and provenance (`rights.ts` stays fail-closed; UNKNOWN is not clearance)
3. `.hvsproj` project and timeline truth
4. FFmpeg execution rules
5. Render and existing QC truth
6. HVS mission contracts
7. Workflow discipline

## Stages

`PLAN → RESEARCH_PREPARE → CREATE → REVIEW → REFINE → QC → DELIVER`

Weak output or changed evidence: `STOPPED → REPLAN → REFINE` or `CREATE`. Default `maxReplans` is 3, then `NEEDS_HUMAN`.

Trivial single edits (one ripple trim, caption, volume, title, or timeline insert/remove) skip the loop, skip elegance review, and do not retrieve lessons unless asked.

## Boundaries

- Workflow state is on `HvsProductionSession`, not inside `HvsProject`.
- Lessons live in `{media-command}/knowledge/lessons/` with schema `hvs.lesson.v1`.
- Status is exactly `CANDIDATE | ACTIVE | CONFIRMED | SUPERSEDED | RETIRED`.
- Default scope is `HVS_ONLY`. One correction stays `CANDIDATE` and is not retrieved.
- Lessons are planning and review constraints. They are not EditOps.
- CREATE still uses EditOps and the existing planners. Retry re-executes the approved plan. Replan changes the plan.
- Verification is a matrix. There is no single creative pass. Blocking classes include project integrity, media, timeline, render, rights, provenance, and deterministic QC.
- `CREATIVE_INTENT_MATCH` compares only factual spec fields (duration, aspect, resolution, captions, theme, assets, beats, audio, render existence).
- `mayPublishAutomatically()` stays false. Commander remains delivery authority.
- Director, Cinema, 3D, and character plans stay subordinate. Foundry does not own lessons or creative completion.
- Blender remains non-canonical. Canonical 3D truth stays `Hvs3DScene`.

## G28

The 187-row matrix stays unchanged. `G28-01` remains TechniqueRecord `SHELL`. `G28-02` and `G28-03` are not marked complete. The implemented portion is the HVS lesson store under `knowledge/lessons/`, which is not a Foundry memory and not a VideoAgent.
