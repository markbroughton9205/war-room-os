# CLAWDCODE_ARCHITECTURE_AUDIT

Audit of https://github.com/kkkhs/ClawdCode at commit
`217a01369f9cb7d1ccc89c1fd9f50d6db2965b81` (MIT).
Research clone: `~/.local/share/war-room-os/research/clawdcode/` (outside canonical War Room source).

Classifications: **ADAPT** · **REFERENCE_ONLY** · **DUPLICATE_OF_FOUNDRY** · **NOT_NEEDED** · **INCOMPATIBLE**

## Identity

ClawdCode is a Bun/Node CLI coding agent inspired by Claude Code: Ink TUI, OpenAI-compatible chat, seven built-in tools, MCP, Skills, hooks, Zustand store, session JSONL.

Foundry is already a sovereign Mission Controller + Tool Broker + Capability Atlas. ClawdCode must not become a second authority or an external process.

## Subsystems

| Subsystem | Upstream | Classification | Notes |
|---|---|---|---|
| Agent loop | `src/agent/Agent.ts` | **ADAPT** | Bounded turns (100), incomplete-intent nudge, consecutive tool-failure halt, abort checks, tool-result split. Used by Foundry Mission Controller; not a replacement. |
| Streaming callbacks | `LoopOptions` / ChatService | **ADAPT** | Mapped to Foundry typed events (AGENT_STARTED, THINKING, CONTENT, TOOL_*, REPLAN, TEST, ERROR, COMPLETE). |
| Cancellation | AbortSignal in loop and pipeline | **ADAPT** | Mission-scoped AbortController covering model, tool, research, browser, command, subtask. |
| Context manager | `src/context/*` | **ADAPT** | Layered packs, token estimate, retain-last compaction, orphan-tool filter. No whole-repo stuffing. |
| Token accounting | `TokenCounter.ts` + js-tiktoken | **REFERENCE_ONLY** | Foundry already has `estimateTokens` (chars/4). Do not add js-tiktoken. |
| Session JSONL persistence | `context/storage/*` | **REFERENCE_ONLY** | Foundry missions/checkpoints already persist. Keep Foundry identity. |
| Tool registry | `src/tools/registry.ts` | **DUPLICATE_OF_FOUNDRY** | Foundry Tool Broker + `FOUNDRY_MODEL_TOOL_CATALOG` are authoritative. |
| Execution pipeline (7 stages) | `ExecutionPipeline.ts` | **REFERENCE_ONLY** | Foundry already has authorization, locks, durable tools, formatting. Do not import a second pipeline. |
| Read / Write / Edit / Glob / Grep | `src/tools/builtin/*` | **REFERENCE_ONLY** | Algorithms compared; Foundry `file.read`, `file.replace_unique`, `workspace.search` already bounded and stronger on edit guarantees. |
| Bash | `src/tools/builtin/bash.ts` | **INCOMPATIBLE** | Unrestricted `exec` of shell strings. Foundry uses typed `terminal.execute` / owned processes. |
| Plan permission mode | `prompts/plan.ts`, `PermissionMode.PLAN` | **ADAPT** | Read-only catalog + mutation suppression + Commander approval to enter execution. Spec system stays Foundry. |
| Skills / SKILL.md | `src/skills/*` | **ADAPT** | Compatibility importer → Capability Atlas. Not a second registry. Not auto-PROVEN. |
| MCP | `src/mcp/*` | **ADAPT** (governance only) | Registry + discovery records. No SDK, no auto-spawn, invoke only via Tool Broker. |
| Hooks (shell) | `src/hooks/*` | **INCOMPATIBLE** | Arbitrary shell at lifecycle points is unsafe. Event names adapted; command hooks rejected. |
| Permission modes default/autoEdit/yolo/plan | `PermissionChecker.ts` | **INCOMPATIBLE** / **REFERENCE_ONLY** | `yolo` is incompatible with Commander authority. Sensitive-file patterns adapted as advisory. |
| Sensitive file detector | `SensitiveFileDetector.ts` | **ADAPT** | High-sensitivity reads refused through Tool Broker. |
| Providers / API keys | `ChatService.ts`, config | **INCOMPATIBLE** | Hardcoded provider keys and OpenAI-only routing. Foundry provider architecture preserved. |
| Ink TUI / themes | `src/ui/*` | **NOT_NEEDED** | Foundry Commander UI already exists. |
| Slash commands | `src/slash-commands/*` | **NOT_NEEDED** | Foundry missions/API are the operator surface. |
| Zustand store | `src/store/*` | **DUPLICATE_OF_FOUNDRY** | Foundry mission store + operations registry. |
| Sub-agent / Task | none substantial | **NOT_NEEDED** | Foundry Agent Command Center is canonical. |
| Custom markdown commands | `slash-commands/custom/*` | **REFERENCE_ONLY** | Similar to SKILL.md; importer covers the useful part. |

## Security findings (do not import)

1. **Bash tool** executes arbitrary shell via `child_process.exec` with `/bin/bash`. Dangerous-pattern denylist is incomplete (`rm -rf /` only in narrow form). Unrestricted spawn.
2. **Hooks** run user-configured shell commands with tool input on stdin — host-authority escape.
3. **MCP stdio servers** spawn configured commands; ClawdCode treats connected tools as Agent tools. Unrestricted host authority if a server is trusted.
4. **Read/Write/Edit** take absolute paths with no workspace containment in the tool itself (pipeline permission rules are glob-based, default ASK). Path traversal risk if permissions are YOLO.
5. **`.env` / credential files** are detected but only as permission hints, not hard Tool Broker refusals.
6. **yolo permission mode** auto-approves mutations. Incompatible with Commander approval doctrine.
7. **API keys** flow through env/`configManager` into the Agent constructor. Foundry must keep provider keys in existing provider architecture.

## Dependency findings (do not auto-import)

| Upstream dep | Action |
|---|---|
| `@modelcontextprotocol/sdk` | **Do not add.** Governance registry only. |
| `js-tiktoken` | **Do not add.** Use Foundry `estimateTokens`. |
| `yaml` | **Do not add.** Minimal SKILL.md frontmatter parser. |
| `openai` | **Do not add.** Foundry providers already exist. |
| `ink`, `zustand`, `glob`, `zod` | **Do not add** for this slice. Foundry already has search/UI/state. |
| `nanoid` | **Do not add.** Foundry uses `crypto.randomUUID`. |

## Comparison vs Foundry Mission Controller

ClawdCode loop: LLM → tool request → execute → observation → next turn.

Foundry already does this with richer gates (write set, ownership, baseline SHA, anchors, production lease). Adapt only: abort cleanliness, typed events, context packs, planning-mode reminder, SKILL.md import.
