# Local Specialist Pool, Residency Governor and rack-node seam

Status: implemented (opt-in), validated, proven on live hardware (see the evidence directory named below). Follows Phase 10 (engine `d79a3037`, receipt in `PHASE_10_FINAL_RECEIPT.md`).

## Assumptions (no written plan existed)
The Commander's order named "Local Specialist Pool + Resource Governor + future rack-node architecture" but no document in the repository, the session history or the Desktop notes defined it. This design is derived from what the repository already records and from the Phase 10 evidence:
- `FIRST_POOL` (`lib/agents/forge/registry.ts`) is the declared pool: Devstral Small 2 24B (builder), Qwen3 14B (review/light), Qwen2.5-Coder 14B (baseline), Devstral 123B (FUTURE_HEAVY, never implicit).
- Phase 10 docs list "load management: eviction/serialization of large models" as designed-not-implemented and needed before the 123B is revisited.
- The gold rounds showed the cost of unmanaged residency on a 16 GB GPU: a resident helper next to the 24B builder made the next builder call stall; helpers that unload at once (`keep_alive 0`) fixed it.
- Standing rules kept: loopback model calls only, no hosted/frontier provider, UNKNOWN is never zero, evidence-only routing, Commander approval for anything that changes authority.
If the intended plan differs, this slice is small, opt-in and isolated (`lib/agents/forge/{pool,governor,node,poolRuntime,poolView,poolViewModel}.ts`) and can be redirected.

## Specialist Pool (`pool.ts`)
Roles: BUILDER, TEST_REVIEWER, TEST_WRITER, TEST_CANDIDATE, ESCALATION. BUILDER is the evidence route for `complete_feature` (`routeFor`); with no evidence no builder is assigned and nothing is defaulted. Helpers are chosen by status/role, never by size or name. A BASELINE model may offer a competing test file but is never routed for builds. ESCALATION is always `NEVER_IMPLICIT`. Residency: one builder RESIDENT (keep-alive 10m), every helper TRANSIENT (keep-alive 0).

## Residency Governor (`governor.ts`)
Hardware, not money (the mission budget governor in `lib/native-builder/foundryResourceGovernor.ts` is unrelated). Per node: one generation at a time (queue in order); admit a resident model as is; plan eviction when a model does not fit next to the residents (transient first, the builder last, only as many as needed when sizes are measured; everything when unmeasured, and the decision says basis UNKNOWN); refuse a model that cannot fit VRAM+RAM, a heavy model without an explicit decision, and an unreachable runtime. Unloads are loopback `keep_alive 0`. A bounded decision log (50) is kept by the process that runs missions.

## Nodes (`node.ts`) - the rack seam
The only callable node is the local Ollama over loopback. A rack node can be RECORDED only with an explicit Commander approval + note and a private-network endpoint (RFC1918, `.local`, `.lan`; no credentials in the URL); public/hosted endpoints are never registered; a recorded rack node is not callable in this version (no remote model call exists). `placeOnNode` reports FITS / UNKNOWN_CAPACITY / TOO_LARGE / NO_NODE honestly.

## Surfaces
- `GET /api/foundry/agents/ops?section=pool` (Commander session): roles, node, what is resident now (asks `/api/ps`), nodes, notes. Read-only: it never loads, unloads or generates.
- Foundry panel (`/war-room/engineering/agents`): "Local Specialist Pool" section.
- Harness: `SPECIALIST_POOL=1` runs the builder and helpers through the governor (default off; the gold-round behaviour is unchanged when it is off). The mission report carries `specialistPool.decisions`.

## Also changed in this stage
Provenance: a file Foundry generated from the contract is no longer recorded as the assignment's executor; its traceability names `foundry:contract-test-generator`.

## Not done
Remote model execution, node health probing and scheduling across nodes, per-role context-size policy, measured residency for the 123B, a Commander UI to register a rack node. The governor does not yet throttle on measured GPU temperature or contention from other processes.
