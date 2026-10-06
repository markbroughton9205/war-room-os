# FOUNDRY_CLAWDCODE_OPEN_SOURCE_EMBEDDING_REPORT

First-slice embedding of MIT-licensed ClawdCode mechanisms into Foundry-native modules.
Not an external CLI. Not a second Foundry. No commit, push, or live deploy.

## 1. Exact upstream repo

https://github.com/kkkhs/ClawdCode

Public GitHub identity `kkkhs/ClawdCode`. npm package `clawdcode` 1.8.0. TypeScript CLI agent.

## 2. Upstream commit

`217a01369f9cb7d1ccc89c1fd9f50d6db2965b81`

Subject: `fix(docs-site): update Giscus repo-id and category-id`  
Date: 2026-02-09  
Author: 邝黄硕 / kkkhs

## 3. License

**MIT.** Confirmed from:

- GitHub API `license.spdx_id = MIT`
- `package.json` `"license": "MIT"`
- `LICENSE` file at the recorded commit

## 4. Attribution requirements

Preserve: `Copyright (c) 2026` and the MIT permission notice in all copies or substantial portions.

Recorded in:

- `docs/third-party/clawdcode.md` (full license text)
- Module headers on adapted Foundry files
- `CLAWDCODE_ATTRIBUTION_NOTICE` in `lib/native-builder/foundryClawdcodeProvenance.ts`

`MIT_ATTRIBUTION_PRESERVED = YES`

## 5. Architecture audited

See `docs/CLAWDCODE_ARCHITECTURE_AUDIT.md`.

Audited: `src/agent`, tools + 7-stage pipeline, permissions, context, session JSONL, MCP, Skills, hooks, streaming, cancellation, Zustand store, plan mode, providers, Ink UI.

## 6. Components reviewed

Agent loop, tool definitions, tool execution, permissions, context management, session persistence, MCP, Skills, hooks, streaming, cancellation, state, plan mode, Read/Write/Edit/Glob/Grep/Bash, sensitive-file detector, ChatService providers.

## 7. ADAPT list

- Bounded agent-loop helpers (turn cap, incomplete intent, consecutive failure, abort checks, result split)
- Typed streaming events
- Mission-scoped AbortController cancellation
- Layered context manager + compaction
- Planning Mode read-only catalog + mutation suppression + plan→execute approval
- SKILL.md compatibility importer → Capability Atlas
- MCP registry/governance (catalog only)
- Sensitive-path advisory + Tool Broker secret-file refusal

## 8. REFERENCE_ONLY list

- TokenCounter / js-tiktoken (Foundry `estimateTokens` is sufficient)
- Session JSONL store (Foundry missions/checkpoints already persist)
- 7-stage ExecutionPipeline shape
- Read/Write/Edit/Glob/Grep algorithms (Foundry tools already exist and are stronger on edit guarantees)
- Custom markdown commands (covered by SKILL.md importer)

## 9. DUPLICATE list

- Tool registry vs Foundry Tool Broker
- Zustand store vs Foundry mission store
- Permission authority vs Commander / mission permissions
- Skill registry vs Capability Atlas
- Provider routing vs FoundryModelRouter

## 10. Rejected components

- Entire `clawdcode/` vendored tree
- External `clawdcode` process
- Bash unrestricted shell
- YOLO permission mode
- Shell lifecycle hooks
- Ink TUI / slash commands
- Hardcoded provider keys / OpenAI-only ChatService
- Second Tool Broker, second Atlas, second Mission Controller
- `@modelcontextprotocol/sdk`, `yaml`, `js-tiktoken`, `openai`, `ink`, `zustand` as new Foundry deps
- Auto-spawn of MCP stdio servers

## 11. Security findings

1. Upstream Bash uses `child_process.exec` with `/bin/bash` — not imported.
2. Upstream hooks execute user shell — not imported.
3. Upstream MCP auto-connects/spawns servers and registers tools as Agent tools — Foundry catalogs only, invoke refused without Tool Broker, never spawned.
4. Upstream Read/Write/Edit take absolute paths without tool-level workspace containment — Foundry keeps bound workspace + Tool Broker.
5. Sensitive files were permission hints only — Foundry now refuses high-sensitivity reads (`SECRET_FILE_REFUSED`).
6. `yolo` mode auto-approves mutations — incompatible; not imported.

## 12. Dependency findings

No new npm dependencies. Reused `estimateTokens`, `randomUUID`, existing Tool Broker, Atlas store, mission store, research AbortControllers.

## 13. Agent-loop adaptation

`foundryAgentLoop.ts` helpers used by Mission Controller. Foundry remains the loop owner. Bounded turns, abort checks, consecutive-failure tracking, tool-result normalization.

## 14. Context-manager adaptation

`foundryContextManager.ts` builds layered packs: task, project facts, approved spec, recent observations, tool results, Engineering Memory, Atlas packs, conversation summary. Token estimate + compaction. Does not dump repositories.

## 15. Cancellation adaptation

`foundryAgentCancellation.ts` mission-scoped AbortController covering model, tool, research, browser, command, subtask. `cancelMission` aborts, stops owned processes, preserves history. Provider fetch combines timeout + mission abort.

## 16. Event-stream adaptation

Typed events: `AGENT_STARTED`, `THINKING`, `CONTENT`, `TOOL_REQUEST`, `TOOL_STARTED`, `TOOL_RESULT`, `REPLAN`, `TEST`, `ERROR`, `COMPLETE`. Persisted on the mission and projected to Commander UI (`data-testid="foundry-agent-events"`).

## 17. Plan-mode adaptation

`foundryPlanningMode.ts`: read-only catalog, mutation suppression at Tool Broker, Commander approval (`ENTER_EXECUTION`) required to leave Planning Mode. Foundry spec/planning remains authoritative.

## 18. Skill compatibility

`foundrySkillImporter.ts` + `capability.import_skill` Tool Broker atlas tool.

Import records: source, hash, license/provenance, skill id, instructions, tools referenced, validation requirements.

Imported status is `LEARNABLE` / `SOURCE_BACKED`, **never auto-PROVEN**.

## 19. MCP adaptation

`foundryMcpRegistry.ts`: project-scoped registry, tool discovery records, invoke requires a mission and still refuses auto-spawn. No MCP SDK. No unrestricted host authority.

## 20. Hook adaptation

Shell hooks rejected. Lifecycle event names adapted into Foundry agent events for audit/progress only.

## 21. Search adaptation

REFERENCE_ONLY. Foundry `workspace.search` already has `MAX_SEARCH_RESULTS` and path containment. No duplicate Glob/Grep APIs.

## 22. Edit adaptation

REFERENCE_ONLY for algorithms. Foundry `file.replace_unique` with anchors, baseline SHA, binding preservation remains authoritative. Unique-match failure shape was already present.

## 23. Bash/process adaptation

Bash tool rejected. FoundryTerminal / typed `terminal.execute` / owned `process.*` remain the only process path. Cancellation aborts owned processes via existing `process.stop`.

## 24. Tool Broker preservation

`FOUNDRY_TOOL_BROKER_PRESERVED = YES`

All filesystem, search, write, skill-import, and process calls in the acceptance task went through `executeEngineerTool`. No direct filesystem bypass. No Bash tool added.

## 25. Provider architecture preservation

`FOUNDRY_PROVIDER_ARCHITECTURE_PRESERVED = YES`

No imported provider keys. Model calls still use `FoundryModelRouter` / existing adapters. AbortSignal is additive.

## 26. Source provenance records

`docs/third-party/clawdcode.md` and `foundryClawdcodeProvenance.ts`.

## 27. Files changed

New:

- `lib/native-builder/foundryClawdcodeProvenance.ts`
- `lib/native-builder/foundryAgentEvents.ts`
- `lib/native-builder/foundryAgentCancellation.ts`
- `lib/native-builder/foundryContextManager.ts`
- `lib/native-builder/foundrySkillImporter.ts`
- `lib/native-builder/foundryMcpRegistry.ts`
- `lib/native-builder/foundryPlanningMode.ts`
- `lib/native-builder/foundrySensitivePathGuard.ts`
- `lib/native-builder/foundryAgentLoop.ts`
- `lib/native-builder/foundryClawdcodeAdaptation.validation.ts`
- `docs/third-party/clawdcode.md`
- `docs/CLAWDCODE_ARCHITECTURE_AUDIT.md`
- `docs/FOUNDRY_CLAWDCODE_OPEN_SOURCE_EMBEDDING_REPORT.md`

Modified:

- `lib/native-builder/foundryMissionController.ts`
- `lib/native-builder/foundryMissionTypes.ts`
- `lib/native-builder/foundryModelTypes.ts`
- `lib/native-builder/foundryModelProviders.ts`
- `lib/native-builder/foundryMissionView.ts`
- `lib/native-builder/foundryToolLifecycle.ts`
- `lib/native-builder/engineerTools.ts`
- `lib/native-builder/capability-atlas/tools.ts`
- `components/war-room/foundry/FoundryMissionControllerPanel.tsx`
- `package.json` (`validate:foundry-clawdcode-adaptation`)

No `clawdcode/` production namespace.

## 28. Acceptance task

Disposable FoundryProjects coding fixture under a temp `FOUNDRY_PROJECTS_ROOT`:

1. Inspect via `workspace.inspect` (Tool Broker)
2. Search via `workspace.search` (Tool Broker)
3. Planning Mode suppresses `file.write`
4. Commander-shaped `ENTER_EXECUTION` then `file.write` hello.js through Tool Broker
5. Stream typed events
6. Controlled cancel aborts work, status `CANCELLED`, history preserved
7. Session reload restores cancelled mission
8. Load test `SKILL.md` through Atlas compatibility (`LEARNABLE`, not PROVEN)

## 29. Clone-removal test

Research clone temporarily renamed to `clawdcode.off-foundry-embed`. Context manager + SKILL.md import still passed. Clone restored to `217a01369f9cb7d1ccc89c1fd9f50d6db2965b81`.

`CLONE_REMOVAL_TEST = PASS`

## 30. External ClawdCode processes

`CLAWDCODE_PROCESS_COUNT = 0` before and after clone-removal.

`EXTERNAL_CLAWDCODE_RUNTIME = NO`  
`UPSTREAM_RUNTIME_DEPENDENCY = NO`

## 31. Validation result

```
pnpm run validate:foundry-clawdcode-adaptation
Foundry ClawdCode adaptation: 35/35 PASS
```

Covered: license, attribution, upstream commit, no runtime clone dependency, agent loop/context/cancellation/events, Tool Broker preserved, no filesystem/shell bypass, Skill import, Atlas provenance, MCP governance, session persistence, path containment, secret handling, dependency licenses, clone-removal, no external clawdcode process.

## 32–36. Forbidden surfaces

| Surface | Modified |
|---|---|
| 32. Terra | **no** |
| 33. WRIM | **no** |
| 34. Harbor Desk | **no** |
| 35. Lane & Box | **no** |
| 36. Inventory Manager | **no** |

Wave 5 was not started.

## 37. Remaining blockers

- MCP is catalog/governance only. A future bounded MCP adapter can be added under Tool Broker; it must not auto-spawn or grant host authority.
- Shell hooks remain rejected.
- js-tiktoken-quality token counting was not imported (char/4 estimate is enough for this slice).
- Production packaging of this adaptation is deferred until Commander review (per order).
- No commit. No push. No live deploy.

## Required flags

```
CLAWDCODE_EMBEDDED = YES
EXTERNAL_CLAWDCODE_RUNTIME = NO
UPSTREAM_RUNTIME_DEPENDENCY = NO
MIT_ATTRIBUTION_PRESERVED = YES
FOUNDRY_TOOL_BROKER_PRESERVED = YES
FOUNDRY_AUTHORITY_MODEL_PRESERVED = YES
FOUNDRY_PROVIDER_ARCHITECTURE_PRESERVED = YES
CLONE_REMOVAL_TEST = PASS
```
