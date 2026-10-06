/**
 * One terminal result for a Commander round.
 * A later successful synthesis replaces pending and provider-warning lines.
 * An earlier seat failure does not keep the round failed.
 */

export type CommanderRoundTerminal = 'IDLE' | 'COMPLETE' | 'PARTIAL' | 'BLOCKED' | 'FAILED'

export type TranscriptLine = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  pending?: boolean
}

const STALE_PROVIDER_LINE = /Provider issues —|did not complete this Council round|Provider issue —/i

export function resolveRoundTerminal(input: {
  readableFinal: string | null
  missionFailed?: boolean
  partial?: boolean
  blocked?: boolean
}): CommanderRoundTerminal {
  if (input.blocked) return 'BLOCKED'
  const text = input.readableFinal?.trim() ?? ''
  if (text && input.partial) return 'PARTIAL'
  if (text) return 'COMPLETE'
  if (input.missionFailed) return 'FAILED'
  return 'IDLE'
}

export function isPreExecutionStreamFailure(code: string | null | undefined): boolean {
  return code === 'chat_route_error'
    || code === 'validation_failed_before_execution'
    || code === 'stream_ended_without_final'
    || code === 'stream_runtime_error'
    || code === 'stream_transport_unavailable'
}

export function humanTerminalFailure(detail: string | null | undefined): string {
  const raw = (detail ?? '').replace(/\s+/g, ' ').trim()
  if (!raw) return 'Council could not complete this round.'
  if (/authenticated session required|chat_route_error|stream_ended|not found|supabase/i.test(raw)) {
    return 'Council could not complete this round.'
  }
  if (/\b(MODEL_UNAVAILABLE|AURORA_EMPTY|ROUTING_FAILED|CONTEXT_FAILED|TIMEOUT|STREAM_FINAL_MISSING)\b/.test(raw)) {
    return raw.length > 240 ? raw.slice(0, 240) : raw
  }
  const cleaned = raw.replace(/[0-9a-f]{8}-[0-9a-f-]{20,}/gi, '').trim()
  if (!cleaned || cleaned.length > 240 || /^(error|failed)$/i.test(cleaned) || /claim_|e-[a-z]+|tool_blocked|provider stack/i.test(cleaned)) {
    return 'Council could not complete this round.'
  }
  return cleaned
}

export function commitFinalTranscript(
  lines: readonly TranscriptLine[],
  final: { id: string; content: string; pendingId?: string | null },
): TranscriptLine[] {
  const content = final.content.trim()
  if (!content) return [...lines]
  const kept = lines.filter(line => {
    if (line.pending) return false
    if (line.id !== final.id && (line.role === 'assistant' || line.role === 'system') && STALE_PROVIDER_LINE.test(line.content)) {
      return false
    }
    return true
  })
  const pendingIndex = final.pendingId ? kept.findIndex(line => line.id === final.pendingId) : -1
  if (pendingIndex >= 0) {
    const next = kept.slice()
    next[pendingIndex] = { id: final.id, role: 'assistant', content }
    return next
  }
  if (kept.some(line => line.role === 'assistant' && (line.id === final.id || line.content === content))) {
    return kept.map(line => line.id === final.id || (line.role === 'assistant' && line.content === content)
      ? { ...line, id: final.id, content, pending: false }
      : line)
  }
  return [...kept, { id: final.id, role: 'assistant', content }]
}

export function shellClearsAfterTerminal(terminal: CommanderRoundTerminal): boolean {
  return terminal === 'COMPLETE' || terminal === 'PARTIAL' || terminal === 'FAILED' || terminal === 'BLOCKED'
}

const FINDINGS_COMPLETION = new Set([
  'PARTIALLY_VERIFIED',
  'UNVERIFIED',
  'TOOL_BLOCKED',
  'BUDGET_EXHAUSTED',
])

/** Readable research under these states stays a synthesis. It is not a fake VERIFIED complete. */
export function evidenceCompletionKeepsFindings(state: string | null | undefined): boolean {
  return FINDINGS_COMPLETION.has((state ?? '').trim().toUpperCase())
}

/**
 * The legacy web-tool watchdog aborts the decree controller at 45s.
 * A Council status or deep-research round owns that controller instead.
 */
export function legacyWebToolOwnsRound(input: {
  toolIntent: boolean
  missionClass: string | null | undefined
}): boolean {
  if (!input.toolIntent) return false
  const mission = (input.missionClass ?? '').toUpperCase()
  return mission !== 'DEEP_RESEARCH' && mission !== 'SYSTEM_STATUS'
}

/**
 * After a slim session switch the deliberation turn is gone.
 * The persisted Aurora reply is still the terminal Commander message.
 */
/**
 * Aurora's board synthesis is a Commander terminal, not a provider diagnostic.
 * The provider integrity gate must not replace it with a fallback notice.
 */
export function isCommanderSynthesisMessage(input: {
  messageType?: string | null
  familyName?: string | null
  turnRole?: string | null
  content?: string | null
  hasEvidenceBoard?: boolean
}): boolean {
  if (input.messageType !== 'response') return false
  if (!input.content?.trim()) return false
  if (input.turnRole === 'council_synthesis') return true
  const name = (input.familyName ?? '').toUpperCase()
  if (name === 'AURORA' && input.hasEvidenceBoard) return true
  return name === 'AURORA' && /what i found|sources:/i.test(input.content)
}

/** Deliberation messages are grouped as `deliberation:<session>:turn:<decreeId>`. */
export function decreeTurnMatchesOperationKey(key: string | null | undefined, decreeId: string | null | undefined): boolean {
  if (!key || !decreeId) return false
  const turn = `turn:${decreeId}`
  return key === turn || key.endsWith(`:${turn}`)
}

export function persistedAuroraIsTerminalBrief(input: {
  messageType?: string | null
  familyName?: string | null
  provider?: string | null
  content?: string | null
  hasDeliberationTurn?: boolean
  hasProgress?: boolean
}): boolean {
  if (input.hasDeliberationTurn || input.hasProgress) return false
  if (input.messageType !== 'response') return false
  const name = (input.familyName ?? '').toUpperCase()
  const provider = (input.provider ?? '').toLowerCase()
  if (name !== 'AURORA' && provider !== 'chatgpt') return false
  return Boolean(input.content?.trim())
}
