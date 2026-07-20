# Phase 48-C4A: Unified Council Experience Runtime

## Purpose

Phase 48-C4A adds a unified, readable Council operation timeline to the existing War Room response surface. It does not change Council orchestration, provider routing, provider prompts, progress accounting, request closure, memory behavior, persistence, approvals, or execution policy.

The visible goal is to make each Commander request read as one coherent operation instead of scattered provider blocks or raw technical packets.

## Delivery Mode

The current War Room chat path is request/response, not a live event stream. For this phase, the UI therefore uses a completed ordered transcript fallback:

1. A Commander request is represented as a `CommanderOperation`.
2. Already-rendered message, provider, deliberation, and project packet metadata are adapted into ordered events.
3. The UI shows those events after the response exists.
4. No fake incremental thinking, typing, provider activity, or sequencing delay is introduced.

Live streaming can be designed later, but C4A does not simulate it.

## Universal Timeline Contract

Every supported visible Council operation can produce:

- request received
- request interpreted
- family response, failure, unavailable, skipped, lane assignment, approval state, or system status
- synthesis only when structured finality evidence exists
- operation completion only when authoritative terminal state exists
- final Commander briefing only when authoritative final output exists
- technical data, collapsed by default

The timeline is universal across:

- decrees
- questions
- status checks
- project orchestration packets
- research-style requests
- troubleshooting/debugging requests
- approval review requests
- direct invocation results
- stable group and full Council responses

## Truth Labels

C4A keeps these distinctions explicit:

- Assigned does not mean responded.
- Queued does not mean working.
- Planned does not mean executed.
- Family contribution does not mean synthesis.
- Message completion does not mean operation completion.
- Author identity does not prove synthesis.
- Message position does not prove finality.
- Unavailable does not mean skipped.
- Failed does not disappear.
- Control/system messages are not treated as a Council family.
- Actual provider output is marked only when a concrete provider message is attached.
- Natural-language provider prose is never parsed as provider execution status.

## Finality Rules

C4A uses truthful omission over invented completion. Ordinary family messages are contributions only. They do not create `synthesis_completed`, `operation_completed`, or "Commander briefing completed" cards.

Synthesis requires structured evidence such as an explicit final synthesis message type, a completed `council_synthesis` deliberation turn, or another explicit final-output flag supplied by the source data. Being last in the current render, being from ChatGPT, or containing prose such as "final answer" or "synthesis completed" is not enough.

Operation completion requires authoritative terminal state such as explicit request completion metadata. The adapter does not infer operation completion from the number of rendered messages, presence of provider output, or UI render completion.

Project packets remain on their distinct builder path and continue to show approval/runtime state from the project packet structure.

## Commander Briefing

The primary copy is readable and Commander-facing:

- request
- operation status
- Council activity
- final briefing only when final-output evidence exists
- open risks
- approval requirements
- next actions
- evidence status

For completed-transcript fallback operations that contain family contributions without final synthesis, the readable copy includes the family contributions and omits final Commander briefing text. This is intentional.

Raw technical data remains available only inside a collapsed technical section with its own copy control.

## Copy Behavior

Primary copy uses the readable operation formatter and only shows `Copied ✓` after the clipboard write resolves. Raw JSON copy is separate and labeled separately.

## Non-Goals

C4A does not:

- call providers
- select providers
- change prompts
- activate adaptive selection
- create or mutate progress events
- close requests
- save memory
- write to Supabase
- apply SQL
- create actions, missions, automations, or deployments
- bypass approval gates
- provide live incremental delivery

## Validation

The C4A validation suite covers universal request coverage, status truth, structured finality, multi-message grouping, sequence ordering, attribution, reply relationships, readable copy behavior, isolation from execution systems, and control/system identity boundaries.

Fifteen negative proofs are required for reviewer confidence:

- assigned rendered as responded
- provider contribution without output
- merged unattributed output
- fake thinking text
- synthesis before contributions
- inferred reply linkage
- raw JSON as primary presentation
- optimistic copy success before clipboard resolution
- primary copy using raw JSON
- family-selection write-back
- request completion override
- Control rendered as a family
- failed providers hidden
- unavailable providers treated as healthy/skipped
- arbitrary timeout-based provider pacing
