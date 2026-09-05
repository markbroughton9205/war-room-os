/**
 * WR-Engineer Phase 4 inspect-turn model contract.
 *
 * Extends Phase 3's wr-engineer-proposal fence with an inspect-tool fence so a future local or
 * native WR-Engineer model can request READ_FILE/SEARCH_FILES/etc. without rewriting the agent
 * loop. Provider-agnostic: ModelAdapter still only returns text; this module parses that text.
 *
 * Never throws. Malformed fences degrade to `tool_request_invalid` (so the loop can feed the
 * error back) rather than crashing the session.
 */
import { parseStructuredModelResponse, type StructuredResponseParseResult } from './structuredResponse'

export const INSPECT_TOOL_NAMES = [
  'read_file',
  'search_files',
  'list_repo_tree',
  'git_status',
  'git_diff',
  'git_log',
  'inspect_project_metadata',
  'inspect_runtime',
] as const
export type InspectToolName = (typeof INSPECT_TOOL_NAMES)[number]

export function isInspectToolName(value: string): value is InspectToolName {
  return (INSPECT_TOOL_NAMES as readonly string[]).includes(value)
}

export function normalizeInspectToolName(raw: string): InspectToolName | null {
  const lowered = raw.trim().toLowerCase()
  if (isInspectToolName(lowered)) return lowered
  return null
}

export type InspectToolRequest = {
  kind: 'tool_request'
  tool: InspectToolName
  arguments: Record<string, unknown>
}

export type InspectTurnParseResult =
  | { kind: 'tool_request'; request: InspectToolRequest; parseAttempted: true; parseFailed: false }
  | { kind: 'tool_request_invalid'; error: string; parseAttempted: true; parseFailed: true }
  | { kind: 'final'; structured: StructuredResponseParseResult }

const TOOL_FENCE_RE = /```wr-engineer-tool\s*([\s\S]*?)```/
const TURN_FENCE_RE = /```wr-engineer-turn\s*([\s\S]*?)```/

export const INSPECT_TURN_INSTRUCTIONS = `
You are inspecting a repository before you may propose any code change. You may request one
inspection tool per reply by emitting a single fenced block:

\`\`\`wr-engineer-tool
{ "tool": "read_file", "arguments": { "relPath": "repo/relative/path.ts" } }
\`\`\`

Supported tools (read-only; you cannot write files, run commands, apply edits, or roll back):
- read_file { "relPath": "..." }
- search_files { "query": "...", "pathPrefix"?: "..." }
- list_repo_tree { "pathPrefix"?: "...", "maxDepth"?: number }
- git_status {}
- git_diff {}
- git_log { "limit"?: number }
- inspect_project_metadata {}
- inspect_runtime {}

Paths must be repository-relative — never absolute, never containing "..". Do not pass a different
repositoryId than this session's bound repository.

When you have enough OBSERVED evidence, write your engineering answer. If you also have a concrete
patch, include a wr-engineer-proposal fence as previously instructed. A proposal may ONLY target
files you actually read in THIS turn; matchText must appear exactly once in that observed content.

If you are only explaining, do not include a proposal block. Do not fabricate file contents.
`.trim()

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function parseToolPayload(parsed: unknown): InspectTurnParseResult {
  const obj = asObject(parsed)
  if (!obj) return { kind: 'tool_request_invalid', error: 'tool JSON is not an object', parseAttempted: true, parseFailed: true }

  const kind = obj.kind
  if (kind === 'final_response') {
    const response = typeof obj.response === 'string' ? obj.response : ''
    const proposalJson = obj.proposal !== undefined
      ? `\n\n\`\`\`wr-engineer-proposal\n${JSON.stringify(obj.proposal, null, 2)}\n\`\`\`\n`
      : ''
    return { kind: 'final', structured: parseStructuredModelResponse(`${response}${proposalJson}`) }
  }

  if (kind !== undefined && kind !== 'tool_request') {
    return { kind: 'tool_request_invalid', error: `unknown turn kind: ${String(kind)}`, parseAttempted: true, parseFailed: true }
  }

  const toolRaw = obj.tool
  if (typeof toolRaw !== 'string' || !toolRaw.trim()) {
    return { kind: 'tool_request_invalid', error: 'missing or empty "tool"', parseAttempted: true, parseFailed: true }
  }
  const tool = normalizeInspectToolName(toolRaw)
  if (!tool) {
    return { kind: 'tool_request_invalid', error: `unknown tool: ${toolRaw}`, parseAttempted: true, parseFailed: true }
  }

  const args = obj.arguments
  if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args))) {
    return { kind: 'tool_request_invalid', error: '"arguments" must be an object when present', parseAttempted: true, parseFailed: true }
  }

  return {
    kind: 'tool_request',
    request: { kind: 'tool_request', tool, arguments: asObject(args) ?? {} },
    parseAttempted: true,
    parseFailed: false,
  }
}

/**
 * Parses a model reply into either one inspect tool request or a Phase 3 final response.
 * A wr-engineer-tool / wr-engineer-turn tool_request fence takes priority over a proposal fence
 * so the loop can keep inspecting. Never throws.
 */
export function parseInspectTurnResponse(rawText: string): InspectTurnParseResult {
  const toolFence = rawText.match(TOOL_FENCE_RE)
  const turnFence = rawText.match(TURN_FENCE_RE)
  const fence = toolFence ?? turnFence
  if (fence) {
    const jsonText = (fence[1] ?? '').trim()
    try {
      return parseToolPayload(JSON.parse(jsonText))
    } catch (error) {
      return {
        kind: 'tool_request_invalid',
        error: error instanceof Error ? error.message : String(error),
        parseAttempted: true,
        parseFailed: true,
      }
    }
  }

  return { kind: 'final', structured: parseStructuredModelResponse(rawText) }
}

export function wrapInspectToolRequest(tool: InspectToolName, args: Record<string, unknown> = {}): string {
  return `\`\`\`wr-engineer-tool\n${JSON.stringify({ tool, arguments: args }, null, 2)}\n\`\`\`\n`
}
