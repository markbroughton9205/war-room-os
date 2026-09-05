/**
 * WR-Engineer structured chat response contract.
 *
 * Same technique lib/native-builder/repairPlanner.ts's private `tryParseModelProposal` already uses
 * for hosted-model text (look for a well-defined marker in raw text, JSON.parse it, validate the
 * shape) — reimplemented here (not imported, since that function is private to repairPlanner.ts and
 * tied to native-builder's InspectionExcerpt/hash-computation flow) for WR-Engineer's own chat
 * responses. The parsed proposal shape is intentionally a STRICT SUBSET of
 * lib/native-builder/types.ts's StructuredPatch fields — no `expectedOriginalHash` is ever accepted
 * from the model (the bridge always re-derives it from live content; see nativeBuilderBridge.ts) and
 * `commanderConfirmed` is always forced false regardless of what the model claims (a delete
 * requires a real, separate confirmation step — free-text chat is not that).
 *
 * Never throws. A missing, malformed, or incomplete proposal block always falls back to
 * `{ kind: 'response_only' }` with the human-readable text preserved — see this file's docstring on
 * parseStructuredModelResponse.
 */
import type { NativeProposalConfidence, StructuredPatchOperation } from '@/lib/native-builder/types'

const SUPPORTED_MODEL_OPERATIONS: readonly StructuredPatchOperation[] = [
  'replace_range',
  'insert_after',
  'insert_before',
  'create_file',
  'delete_file',
]

export type ModelProposedPatch = {
  operation: StructuredPatchOperation
  file: string
  matchText?: string
  replacementText?: string
  newFileContent?: string
  /** Always false as parsed — see this file's header. */
  commanderConfirmed: false
}

export type ModelProposedChange = { file: string; reason: string; patch: ModelProposedPatch }

export type ModelProposal = {
  diagnosis: string
  confidence: NativeProposalConfidence
  changes: ModelProposedChange[]
  risks: string[]
  rollbackPlan: string
}

export type StructuredModelResponse =
  | { kind: 'response_only'; response: string }
  | { kind: 'response_with_proposal'; response: string; proposal: ModelProposal }

export type StructuredResponseParseResult = {
  result: StructuredModelResponse
  /** True whenever a `wr-engineer-proposal` fenced block was found at all — even if it went on to
   * fail parsing/validation. Distinguishes "model didn't propose anything" (parseAttempted: false,
   * ordinary) from "model tried and got it wrong" (parseAttempted: true, parseFailed: true — this is
   * the case the mission brief wants recorded as a tool event). */
  parseAttempted: boolean
  parseFailed: boolean
  parseError?: string
}

const FENCE_RE = /```wr-engineer-proposal\s*([\s\S]*?)```/

export const STRUCTURED_RESPONSE_INSTRUCTIONS = `
When your engineering answer includes a concrete, ready-to-review code change, end your reply with a
single fenced block exactly like this (replace the example content with a real one):

\`\`\`wr-engineer-proposal
{
  "diagnosis": "one paragraph explaining the root cause and the fix",
  "confidence": "low" | "medium" | "high",
  "changes": [
    { "file": "repo/relative/path.ts", "reason": "why this file changes",
      "patch": { "operation": "replace_range", "file": "repo/relative/path.ts",
                 "matchText": "exact existing text to find (must appear exactly once in the file)",
                 "replacementText": "the replacement text" } }
  ],
  "risks": ["..."],
  "rollbackPlan": "..."
}
\`\`\`

Only include this block when you have a specific file and exact matchText in mind from what you
actually read — never guess or fabricate file contents or paths. Supported "operation" values:
replace_range, insert_after, insert_before (all three need "matchText"), create_file (use
"newFileContent" instead of matchText/replacementText), delete_file (a Commander must separately and
explicitly confirm any deletion outside chat — never propose one from a chat message alone). Paths
must be repository-relative — never absolute, never containing "..".

If you are only explaining, answering, or asking a clarifying question, write your normal answer and
do not include this block at all.
`.trim()

function validateModelProposalShape(value: unknown): { ok: true; proposal: ModelProposal } | { ok: false; error: string } {
  if (!value || typeof value !== 'object') return { ok: false, error: 'proposal JSON is not an object' }
  const obj = value as Record<string, unknown>

  if (typeof obj.diagnosis !== 'string' || !obj.diagnosis.trim()) return { ok: false, error: 'missing or empty "diagnosis"' }
  if (obj.confidence !== 'low' && obj.confidence !== 'medium' && obj.confidence !== 'high') {
    return { ok: false, error: 'missing or invalid "confidence" (must be low|medium|high)' }
  }
  if (!Array.isArray(obj.changes) || obj.changes.length === 0) return { ok: false, error: 'missing or empty "changes" array' }

  const changes: ModelProposedChange[] = []
  for (const raw of obj.changes) {
    if (!raw || typeof raw !== 'object') return { ok: false, error: 'a "changes" entry is not an object' }
    const c = raw as Record<string, unknown>
    if (typeof c.file !== 'string' || !c.file.trim()) return { ok: false, error: 'a "changes" entry is missing "file"' }
    if (typeof c.reason !== 'string') return { ok: false, error: 'a "changes" entry is missing "reason"' }
    if (!c.patch || typeof c.patch !== 'object') return { ok: false, error: 'a "changes" entry is missing "patch"' }
    const patchObj = c.patch as Record<string, unknown>
    const operation = patchObj.operation
    if (typeof operation !== 'string' || !SUPPORTED_MODEL_OPERATIONS.includes(operation as StructuredPatchOperation)) {
      return { ok: false, error: `a "changes" entry has an unsupported or missing operation: ${String(operation)}` }
    }
    changes.push({
      file: c.file,
      reason: c.reason,
      patch: {
        operation: operation as StructuredPatchOperation,
        file: typeof patchObj.file === 'string' && patchObj.file ? patchObj.file : c.file,
        matchText: typeof patchObj.matchText === 'string' ? patchObj.matchText : undefined,
        replacementText: typeof patchObj.replacementText === 'string' ? patchObj.replacementText : undefined,
        newFileContent: typeof patchObj.newFileContent === 'string' ? patchObj.newFileContent : undefined,
        commanderConfirmed: false,
      },
    })
  }

  const risks = Array.isArray(obj.risks) ? obj.risks.filter((r): r is string => typeof r === 'string') : []
  const rollbackPlan = typeof obj.rollbackPlan === 'string' && obj.rollbackPlan ? obj.rollbackPlan : 'Not specified by WR-Engineer.'

  return { ok: true, proposal: { diagnosis: obj.diagnosis, confidence: obj.confidence, changes, risks, rollbackPlan } }
}

/**
 * Extracts an optional structured proposal from a raw model response. Never throws — a missing,
 * malformed, or incomplete `wr-engineer-proposal` block always degrades to `response_only` with the
 * readable text preserved (the text before the fenced block, or the full text with the broken block
 * stripped, or — failing that — the full raw text verbatim). This is the one function the rest of
 * WR-Engineer trusts to guarantee a session can never crash on bad model output.
 */
export function parseStructuredModelResponse(rawText: string): StructuredResponseParseResult {
  const match = rawText.match(FENCE_RE)
  if (!match) {
    return { result: { kind: 'response_only', response: rawText.trim() }, parseAttempted: false, parseFailed: false }
  }

  const beforeFence = rawText.slice(0, match.index).trim()
  const withoutFence = rawText.replace(FENCE_RE, '').trim()
  const fallbackResponseText = beforeFence || withoutFence || rawText.trim()
  const jsonText = (match[1] ?? '').trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch (error) {
    return {
      result: { kind: 'response_only', response: fallbackResponseText },
      parseAttempted: true,
      parseFailed: true,
      parseError: error instanceof Error ? error.message : String(error),
    }
  }

  const shape = validateModelProposalShape(parsed)
  if (!shape.ok) {
    return {
      result: { kind: 'response_only', response: fallbackResponseText },
      parseAttempted: true,
      parseFailed: true,
      parseError: shape.error,
    }
  }

  return {
    result: {
      kind: 'response_with_proposal',
      response: beforeFence || '(see proposed change below)',
      proposal: shape.proposal,
    },
    parseAttempted: true,
    parseFailed: false,
  }
}
