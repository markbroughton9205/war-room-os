/**
 * Conversational AURORA for SOCIAL_CHECKIN / simple chat.
 * NO_TOOL_REQUIRED still produces a Council response. Does not invent research facts.
 */
import { invokeCouncilSeat } from '@/lib/council/live-orchestration/backends/seatRouter'
import { stripHiddenReasoning } from '@/lib/council/nebula/thinkingStrip'
import type { SelfAwarenessSnapshot } from '@/lib/council/intelligence/types'

export const CONVERSATIONAL_FAILURE_CODES = [
  'MODEL_UNAVAILABLE',
  'AURORA_EMPTY',
  'ROUTING_FAILED',
  'CONTEXT_FAILED',
  'TIMEOUT',
] as const

export type ConversationalFailureCode = (typeof CONVERSATIONAL_FAILURE_CODES)[number]

export type ConversationalAuroraResult = {
  ok: boolean
  text: string
  failureCode: ConversationalFailureCode | null
  failure: string | null
  role: 'AURORA'
  provider: string | null
  model: string | null
  latencyMs: number
}

const AURORA_CONVERSATIONAL_SYSTEM = [
  'You are AURORA, the War Room Council synthesizer.',
  'This is a conversational Commander turn. Tools are not required.',
  'Answer naturally in one to four short sentences.',
  'Do not invent missions, browse the web, or state unverified external facts as proven.',
  'Do not mention claim IDs, tool IDs, seats as vendors, or hidden reasoning.',
  'If the Commander is greeting or checking in, acknowledge them as AURORA and offer to help with the current session.',
  'If they ask how you are functioning or what you can help with, use only the runtime receipts in the prompt. If a receipt is missing, say it is unknown.',
  'If they ask to summarize prior turns, use only the provided session transcript.',
].join(' ')

const WANTS_RUNTIME_TRUTH =
  /\b(functioning|operational status|how are you|what can you help|what can you do|current (?:operational )?status|what is online|what is connected)\b/i

export function wantsRuntimeTruthForConversation(text: string): boolean {
  return WANTS_RUNTIME_TRUTH.test(typeof text === 'string' ? text : '')
}

export function formatConversationalFailure(code: ConversationalFailureCode, detail?: string | null): string {
  const safe = (detail ?? '').replace(/\s+/g, ' ').trim().slice(0, 160)
  if (code === 'MODEL_UNAVAILABLE') {
    return safe
      ? `Council could not reach an approved model for this conversational turn (${code}). ${safe}`
      : `Council could not reach an approved model for this conversational turn (${code}).`
  }
  if (code === 'AURORA_EMPTY') {
    return `AURORA returned no conversational text (${code}).`
  }
  if (code === 'TIMEOUT') {
    return `Council conversational turn timed out (${code}).`
  }
  if (code === 'CONTEXT_FAILED') {
    return `Council could not compile conversational context (${code}).`
  }
  return safe
    ? `Council could not complete this conversational turn (${code}). ${safe}`
    : `Council could not complete this conversational turn (${code}).`
}

export function compactAwarenessReceipts(awareness: SelfAwarenessSnapshot | null | undefined): string {
  if (!awareness) return ''
  const providers = awareness.providers
    .map(row => `${row.id}=${row.healthy ? 'healthy' : 'unhealthy'}`)
    .join(', ')
  return [
    `install=${awareness.install_id ?? 'unknown'}`,
    `council=${awareness.council_state}`,
    `local_backend=${awareness.local_backend_state}`,
    `general_model=${awareness.general_model ?? 'unknown'}`,
    `core=${awareness.runtime_3847.pid ? `pid ${awareness.runtime_3847.pid}` : 'unknown'}`,
    `ui=${awareness.runtime_3848.pid ? `pid ${awareness.runtime_3848.pid}` : 'unknown'}`,
    providers ? `providers: ${providers}` : '',
  ].filter(Boolean).join('\n')
}

function failureCodeFromBackend(status: string | undefined, detail: string | undefined): ConversationalFailureCode {
  const blob = `${status ?? ''} ${detail ?? ''}`.toLowerCase()
  if (/timeout|timed ?out|abort/.test(blob)) return 'TIMEOUT'
  if (/unavailable|not_installed|no_local|missing|unassigned/.test(blob)) return 'MODEL_UNAVAILABLE'
  if (/empty/.test(blob)) return 'AURORA_EMPTY'
  return 'ROUTING_FAILED'
}

export async function generateConversationalAurora(input: {
  commanderMessage: string
  priorTurns?: readonly string[]
  awareness?: SelfAwarenessSnapshot | null
  signal?: AbortSignal
  timeoutMs?: number
}): Promise<ConversationalAuroraResult> {
  const started = Date.now()
  const text = typeof input.commanderMessage === 'string' ? input.commanderMessage.trim() : ''
  if (!text) {
    return {
      ok: false,
      text: formatConversationalFailure('CONTEXT_FAILED', 'empty commander message'),
      failureCode: 'CONTEXT_FAILED',
      failure: 'empty commander message',
      role: 'AURORA',
      provider: null,
      model: null,
      latencyMs: 0,
    }
  }
  const history = (input.priorTurns ?? []).map(row => String(row ?? '').trim()).filter(Boolean).slice(-8)
  const receipts = compactAwarenessReceipts(input.awareness)
  const userPrompt = [
    history.length ? `Session transcript:\n${history.map((row, index) => `${index + 1}. ${row}`).join('\n')}` : '',
    receipts ? `Runtime receipts:\n${receipts}` : '',
    `Commander: ${text}`,
  ].filter(Boolean).join('\n\n')

  const controller = new AbortController()
  const timeoutMs = input.timeoutMs ?? 45_000
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort()
  input.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const seatResult = await invokeCouncilSeat({
      seat: 'chatgpt',
      systemPrompt: AURORA_CONVERSATIONAL_SYSTEM,
      userPrompt,
      maxTokens: 400,
      signal: controller.signal,
      onDelta: () => {},
      timeoutKind: 'social',
    })
    const latencyMs = Date.now() - started
    const spoken = stripHiddenReasoning(seatResult.text ?? '').trim()
    if (seatResult.ok && spoken) {
      return {
        ok: true,
        text: spoken,
        failureCode: null,
        failure: null,
        role: 'AURORA',
        provider: seatResult.backend.provider ?? seatResult.backend.backendType ?? null,
        model: seatResult.backend.model ?? null,
        latencyMs,
      }
    }
    const code = !spoken && seatResult.ok
      ? 'AURORA_EMPTY'
      : failureCodeFromBackend(seatResult.backend.status, seatResult.backend.fallbackReason)
    const failure = seatResult.backend.fallbackReason ?? seatResult.backend.failureClass ?? code
    return {
      ok: false,
      text: formatConversationalFailure(code, failure),
      failureCode: code,
      failure,
      role: 'AURORA',
      provider: seatResult.backend.provider ?? seatResult.backend.backendType ?? null,
      model: seatResult.backend.model ?? null,
      latencyMs,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const code = /abort|timed? ?out/i.test(message) ? 'TIMEOUT' : 'ROUTING_FAILED'
    return {
      ok: false,
      text: formatConversationalFailure(code, message),
      failureCode: code,
      failure: message,
      role: 'AURORA',
      provider: null,
      model: null,
      latencyMs: Date.now() - started,
    }
  } finally {
    clearTimeout(timer)
    input.signal?.removeEventListener('abort', onAbort)
  }
}
