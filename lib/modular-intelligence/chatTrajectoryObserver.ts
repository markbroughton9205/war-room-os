import { captureRuntimeTrajectory } from './runtimeTrajectoryCapture'
import type { CapturedRuntimeTrajectory } from './runtimeTrajectoryCapture'

type ResearchMark = {
  tool_id: 'research' | 'web'
  query: string
  ok: boolean
  error: string | null
  duration_ms: number | null
  provider: string
  result_meta: Record<string, unknown>
}

export type ChatTrajectorySession = {
  markLiveResearch: (mark: ResearchMark) => void
  markCouncilResearchTeam: (mark: Omit<ResearchMark, 'tool_id'> & { tool_id?: 'research' }) => void
  markNoToolReason: (reason: string | null) => void
  flushFromResponse: (payload: Record<string, unknown>) => CapturedRuntimeTrajectory | null
}

export function createChatTrajectorySession(init: {
  requestText: string
  conversationId: string | null
  requestId: string | null
}): ChatTrajectorySession {
  let flushed = false
  let research: ResearchMark | null = null
  let noToolReason: string | null = null

  const flush = (payload: Record<string, unknown>): CapturedRuntimeTrajectory | null => {
    if (flushed) return null
    flushed = true
    const live = payload.liveResearchAttempted === true || research !== null
    try {
      if (live) {
        const mark = research
        const outcome = captureRuntimeTrajectory({
          request_text: init.requestText,
          conversation_id: init.conversationId,
          request_id: init.requestId,
          decision: 'TOOL',
          tool_id: mark?.tool_id ?? 'research',
          arguments: mark?.query ? { query: mark.query } : {},
          router_validation_status: 'VALID',
          execution_status: mark ? (mark.ok ? 'ok' : 'error') : 'ok',
          tool_result_status: mark ? (mark.ok ? 'ok' : 'error') : 'ok',
          tool_result: mark?.result_meta ?? { liveResearchAttempted: true },
          error: mark?.error ?? null,
          source_type: 'REAL_RUNTIME',
          insertion_point: 'app/api/chat/execute.ts:withTrace',
          duration_ms: mark?.duration_ms ?? null,
          provider: mark?.provider ?? 'runLiveResearchRouter',
          context_dependence: init.conversationId ? 'CONTEXT_DEPENDENT' : 'STANDALONE',
          context_ref: init.conversationId,
          provenance: { path: 'council_chat' },
        })
        return outcome.record ?? null
      }
      const outcome = captureRuntimeTrajectory({
        request_text: init.requestText,
        conversation_id: init.conversationId,
        request_id: init.requestId,
        decision: 'NO_TOOL',
        tool_id: null,
        arguments: {},
        router_validation_status: 'VALID',
        execution_status: 'not_executed',
        tool_result_status: 'not_executed',
        tool_result: { decision: 'NO_TOOL' },
        error: null,
        no_tool_reason: noToolReason,
        source_type: 'REAL_RUNTIME',
        insertion_point: 'app/api/chat/execute.ts:withTrace',
        context_dependence: init.conversationId ? 'CONTEXT_DEPENDENT' : 'STANDALONE',
        context_ref: init.conversationId,
        provenance: { path: 'council_chat' },
      })
      return outcome.record ?? null
    } catch (err) {
      console.error(
        '[trajectory-observer] chat flush failed:',
        err instanceof Error ? err.message : err,
      )
      return null
    }
  }

  return {
    markLiveResearch(mark) {
      research = mark
    },
    markCouncilResearchTeam(mark) {
      research = { tool_id: 'research', ...mark }
    },
    markNoToolReason(reason) {
      noToolReason = reason
    },
    flushFromResponse: flush,
  }
}
