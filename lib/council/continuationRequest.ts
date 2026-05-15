import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'

export type ContinuationRequestStatus = 'pending' | 'approved' | 'rejected'

export type ContinuationRequestKind = 'analysis_depth' | 'autonomous_continuation'

export type ContinuationRequest = {
  id: string
  family: CouncilOrchestrationFamily
  kind: ContinuationRequestKind
  message: string
  status: ContinuationRequestStatus
  createdAt: string
}

const PERMISSION_FRAMING =
  /\b(if\s+you(?:'d|\s+would)\s+like|want\s+me\s+to|shall\s+i|would\s+you\s+like|say\s+the\s+word|your\s+call|just\s+say|let\s+me\s+know\s+if)\b/i

const FURTHER_ANALYSIS = /\b(further\s+analysis|deeper\s+dive|continue\s+(?:the\s+)?breakdown|more\s+depth|drill\s+down\s+further|expand\s+on\s+this)\b/i

const AUTONOMOUS_CONTINUE =
  /\b(i(?:'ll|\s+will)\s+keep\s+going|allow\s+me\s+to\s+continue|let\s+me\s+continue\s+unpack|going\s+deeper\s+without)\b/i

/** True when output pressures continuation without permission-style framing. */
export function detectContinuationPressure(text: string): boolean {
  const t = (text ?? '').trim()
  if (!t || t.length < 12) return false
  if (PERMISSION_FRAMING.test(t)) return false
  return FURTHER_ANALYSIS.test(t) || AUTONOMOUS_CONTINUE.test(t)
}

export function buildContinuationRequestFromModelOutput(args: {
  family: CouncilOrchestrationFamily
  text: string
}): ContinuationRequest | null {
  if (!detectContinuationPressure(args.text)) return null
  const kind: ContinuationRequestKind = AUTONOMOUS_CONTINUE.test(args.text) ? 'autonomous_continuation' : 'analysis_depth'
  return {
    id: `cr-${Date.now()}-${args.family}`,
    family: args.family,
    kind,
    message: 'Council output asked for more depth or continuation without explicit permission framing.',
    status: 'pending',
    createdAt: new Date().toISOString(),
  }
}
