/**
 * WR-Engineer Phase 4 bounded inspect loop.
 *
 * Commander request → model may request inspect tools → observations feed back → final response
 * (optional proposal). The loop talks to the model only through ModelAdapter — never a hardcoded
 * provider. Hitting MAX_TOOL_CALLS / context bound stops the turn with a readable response and
 * does not fabricate a proposal.
 */
import { INSPECT_TURN_INSTRUCTIONS, parseInspectTurnResponse } from './inspectContract'
import {
  MAX_PROMPT_EXCERPT_BYTES,
  MAX_TOOL_CALLS_PER_TURN,
  MAX_TOTAL_CONTEXT_BYTES,
} from './inspectBounds'
import { executeInspectTool } from './inspectTools'
import { turnPhaseForTool, type EngineeringTurnEvidence, type TurnPhase } from './turnEvidence'
import type { ModelAdapter } from './types'
import type { EngineeringSession } from './session/types'
import type { StructuredResponseParseResult } from './structuredResponse'

export type InspectLoopHooks = {
  onPhase?: (phase: TurnPhase) => Promise<void>
  onToolStarted?: (tool: string, target: string, summary: string) => Promise<void>
  onToolFinished?: (tool: string, target: string, summary: string, outcome: 'PASS' | 'FAIL') => Promise<void>
}

export type InspectLoopResult = {
  structured: StructuredResponseParseResult
  boundedStop: boolean
  boundReason?: string
  turn: EngineeringTurnEvidence
}

function excerpt(text: string, maxBytes: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return { text, truncated: false }
  return { text: text.slice(0, maxBytes), truncated: true }
}

export function buildTurnObservationPrompt(turn: EngineeringTurnEvidence, remainingToolCalls: number): string {
  const chunks: string[] = []
  let used = 0
  const push = (label: string, body: string, allowTruncate = true): void => {
    const remaining = MAX_TOTAL_CONTEXT_BYTES - used
    if (remaining <= 0) return
    const block = allowTruncate ? excerpt(body, Math.min(MAX_PROMPT_EXCERPT_BYTES, remaining)) : { text: body.slice(0, remaining), truncated: body.length > remaining }
    const rendered = `<<< ${label} >>>\n${block.text}${block.truncated ? '\n[truncated — raw observed text retained for matchText validation]' : ''}\n<<< END ${label} >>>`
    chunks.push(rendered)
    used += Buffer.byteLength(rendered, 'utf8')
  }

  push('TURN_BUDGET', JSON.stringify({
    remainingToolCalls,
    maxToolCalls: MAX_TOOL_CALLS_PER_TURN,
    filesRead: turn.readFiles.length,
    searches: turn.searches.length,
    gitObservations: turn.gitObservations.length,
  }), false)

  for (const obs of turn.observations) {
    if (used >= MAX_TOTAL_CONTEXT_BYTES) break
    if (obs.tool === 'read_file' && obs.status === 'PASS' && obs.filePath && turn.readFileContents[obs.filePath]) {
      const record = turn.readFileContents[obs.filePath]
      push(`READ ${record.relPath} hash=${record.contentHash.slice(0, 12)} bytes=${record.bytesRead} truncated=${record.truncated}`, record.content)
      continue
    }
    push(`OBS ${obs.tool} ${obs.status}`, JSON.stringify({
      summary: obs.summary,
      query: obs.query,
      matchCount: obs.matchCount,
      returnedPaths: obs.returnedPaths,
      branch: obs.branch,
      head: obs.head,
      dirty: obs.dirty,
      error: obs.status === 'FAIL' ? obs.summary : undefined,
    }))
  }

  if (used >= MAX_TOTAL_CONTEXT_BYTES) {
    push('CONTEXT_BOUND', 'Further raw excerpts omitted — use result_reference summaries. Do not invent file contents.', false)
  }

  return chunks.join('\n\n')
}

export function turnContextBytes(turn: EngineeringTurnEvidence): number {
  return Buffer.byteLength(buildTurnObservationPrompt(turn, 0), 'utf8')
}

function boundedLimitMessage(turn: EngineeringTurnEvidence, reason: string): string {
  const reads = turn.readFiles.map(f => f.relPath).join(', ') || 'none'
  return `[BOUNDED_LIMIT] ${reason} Observations preserved: ${turn.toolCallCount} tool call(s), files read: ${reads}. No proposal was fabricated.`
}

export async function runInspectTurnLoop(
  session: EngineeringSession,
  modelAdapter: ModelAdapter,
  identityContext: string,
  commanderRequest: string,
  turn: EngineeringTurnEvidence,
  hooks: InspectLoopHooks = {},
): Promise<InspectLoopResult> {
  await hooks.onPhase?.('THINKING')

  for (let step = 0; step <= MAX_TOOL_CALLS_PER_TURN; step += 1) {
    const remaining = Math.max(0, MAX_TOOL_CALLS_PER_TURN - turn.toolCallCount)
    if (turn.rawObservedBytes > MAX_TOTAL_CONTEXT_BYTES) {
      const reason = `Total inspect context exceeded ${MAX_TOTAL_CONTEXT_BYTES} bytes.`
      return {
        structured: { result: { kind: 'response_only', response: boundedLimitMessage(turn, reason) }, parseAttempted: false, parseFailed: false },
        boundedStop: true,
        boundReason: reason,
        turn,
      }
    }

    const systemPrompt = [
      identityContext,
      `<<< INSPECT_TURN_CONTRACT >>>\n${INSPECT_TURN_INSTRUCTIONS}\n<<< END INSPECT_TURN_CONTRACT >>>`,
      buildTurnObservationPrompt(turn, remaining),
    ].join('\n\n')

    const result = await modelAdapter.invoke({
      systemPrompt,
      userPrompt: commanderRequest,
      maxTokens: 2000,
    })

    if (!result.ok) {
      return {
        structured: {
          result: {
            kind: 'response_only',
            response: `${result.epistemicStatus}: unable to produce a reply right now — ${result.error ?? 'no further detail available'}.`,
          },
          parseAttempted: false,
          parseFailed: false,
        },
        boundedStop: false,
        turn,
      }
    }

    const parsed = parseInspectTurnResponse(result.text)
    if (parsed.kind === 'final') {
      await hooks.onPhase?.('ANALYZING')
      return { structured: parsed.structured, boundedStop: false, turn }
    }

    if (parsed.kind === 'tool_request_invalid') {
      if (turn.toolCallCount >= MAX_TOOL_CALLS_PER_TURN) {
        const reason = `Tool-call limit reached (${MAX_TOOL_CALLS_PER_TURN}) after a malformed tool request.`
        return {
          structured: { result: { kind: 'response_only', response: boundedLimitMessage(turn, reason) }, parseAttempted: true, parseFailed: true, parseError: parsed.error },
          boundedStop: true,
          boundReason: reason,
          turn,
        }
      }
      turn.observations.push({
        observationId: `invalid-${turn.toolCallCount + 1}`,
        sessionId: turn.sessionId,
        turnId: turn.turnId,
        tool: 'invalid_tool_request',
        arguments: {},
        repositoryId: turn.repositoryId,
        nodeId: turn.nodeId,
        status: 'FAIL',
        summary: parsed.error,
        resultReference: 'parse:invalid',
        occurredAt: new Date().toISOString(),
      })
      turn.toolCallCount += 1
      await hooks.onToolFinished?.('invalid_tool_request', '', parsed.error, 'FAIL')
      continue
    }

    if (turn.toolCallCount >= MAX_TOOL_CALLS_PER_TURN) {
      const reason = `Tool-call limit reached (${MAX_TOOL_CALLS_PER_TURN} calls per turn).`
      return {
        structured: { result: { kind: 'response_only', response: boundedLimitMessage(turn, reason) }, parseAttempted: false, parseFailed: false },
        boundedStop: true,
        boundReason: reason,
        turn,
      }
    }

    const target = String(parsed.request.arguments.relPath ?? parsed.request.arguments.query ?? parsed.request.arguments.pathPrefix ?? '')
    await hooks.onPhase?.(turnPhaseForTool(parsed.request.tool))
    await hooks.onToolStarted?.(parsed.request.tool, target, `starting ${parsed.request.tool}`)
    const executed = await executeInspectTool(session, turn, parsed.request.tool, parsed.request.arguments)
    await hooks.onToolFinished?.(parsed.request.tool, executed.observation.filePath ?? target, executed.observation.summary, executed.ok ? 'PASS' : 'FAIL')
    if (turn.rawObservedBytes > MAX_TOTAL_CONTEXT_BYTES) {
      const reason = `Total inspect context exceeded ${MAX_TOTAL_CONTEXT_BYTES} bytes.`
      return {
        structured: { result: { kind: 'response_only', response: boundedLimitMessage(turn, reason) }, parseAttempted: false, parseFailed: false },
        boundedStop: true,
        boundReason: reason,
        turn,
      }
    }
  }

  const reason = `Tool-call limit reached (${MAX_TOOL_CALLS_PER_TURN} calls per turn).`
  return {
    structured: { result: { kind: 'response_only', response: boundedLimitMessage(turn, reason) }, parseAttempted: false, parseFailed: false },
    boundedStop: true,
    boundReason: reason,
    turn,
  }
}
