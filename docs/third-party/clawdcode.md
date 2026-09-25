# ClawdCode third-party attribution

Foundry embeds selected **mechanisms** from ClawdCode as Foundry-native modules.
This is not an external CLI integration. War Room does not vendor the upstream
repository and does not run `clawdcode` as a production process.

## Source repository

- **URL:** https://github.com/kkkhs/ClawdCode
- **Identity:** `kkkhs/ClawdCode` (public GitHub repository, SPDX MIT)
- **Package:** `clawdcode` 1.8.0
- **Commit:** `217a01369f9cb7d1ccc89c1fd9f50d6db2965b81`
- **Commit subject:** `fix(docs-site): update Giscus repo-id and category-id`
- **Commit date:** 2026-02-09
- **Author:** 邝黄硕 / kkkhs
- **Research clone (audit only, outside canonical source):** `~/.local/share/war-room-os/research/clawdcode/`

## License

MIT License. GitHub `license.spdx_id` = `MIT`. `package.json` `"license": "MIT"`.

Full license text as recorded at the source commit:

```
MIT License

Copyright (c) 2026

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Copyright notice

`Copyright (c) 2026`

The upstream LICENSE file records year-only copyright. Foundry preserves that notice.

## Files / mechanisms adapted

| Upstream file | Foundry destination | Purpose | Modifications |
|---|---|---|---|
| `src/agent/Agent.ts`, `src/agent/types.ts` | `lib/native-builder/foundryAgentLoop.ts`, `foundryAgentEvents.ts`, `foundryAgentCancellation.ts` | Bounded ReAct loop helpers, typed events, AbortSignal | Refactored into Foundry Mission Controller helpers. No second controller. |
| `src/context/ContextManager.ts`, `CompactionService.ts`, `types.ts` | `lib/native-builder/foundryContextManager.ts` | Layered context, token estimate, retain-last compaction | Uses Foundry `estimateTokens`. Never stuffs whole repos. Mission identity unchanged. |
| `src/skills/SkillLoader.ts`, `types.ts` | `lib/native-builder/foundrySkillImporter.ts` | SKILL.md frontmatter parse + Atlas import | Maps into Capability Atlas. Never auto-PROVEN. No yaml dependency. |
| `src/prompts/plan.ts`, permission plan mode | `lib/native-builder/foundryPlanningMode.ts` | Read-only catalog, mutation suppression, plan→execute approval | Commander/Tool Broker remain authority. |
| `src/mcp/McpRegistry.ts` | `lib/native-builder/foundryMcpRegistry.ts` | Project-scoped MCP catalog | No SDK. No auto-spawn. Invoke requires Tool Broker. |
| `src/tools/validation/SensitiveFileDetector.ts` | `lib/native-builder/foundrySensitivePathGuard.ts` | Sensitive-path classification | Advisory only; Tool Broker enforces read refusal for high-sensitivity files. |
| `src/hooks/types.ts` | `lib/native-builder/foundryAgentEvents.ts` | Lifecycle event names | Shell-command hooks **rejected** (unsafe). Events only. |

## Attribution requirement

Any substantial copy or adaptation must retain the MIT copyright notice and
permission notice above. Foundry records that notice here and in module headers.

## Runtime independence

- `CLAWDCODE_EMBEDDED = YES`
- `EXTERNAL_CLAWDCODE_RUNTIME = NO`
- `UPSTREAM_RUNTIME_DEPENDENCY = NO`

Deleting the research clone must not break Foundry.
