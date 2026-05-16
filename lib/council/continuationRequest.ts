import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'

export type ContinuationRequestStatus = 'pending' | 'approved' | 'summarized' | 'held' | 'rejected'

export type ContinuationRequestKind =
  | 'analysis_depth'
  | 'autonomous_continuation'
  | 'contradiction'
  | 'runtime_emergency'

export type ContinuationRequest = {
  id: string
  family: CouncilOrchestrationFamily
  kind: ContinuationRequestKind
  message: string
  status: ContinuationRequestStatus
  createdAt: string
  reasonKey: string
}

const PERMISSION_FRAMING =
  /\b(if\s+you(?:'d|\s+would)\s+like|want\s+me\s+to|shall\s+i|would\s+you\s+like|say\s+the\s+word|your\s+call|just\s+say|let\s+me\s+know\s+if|permission\s+to\s+continue|continue\s+analysis\?)\b/i

const FURTHER_ANALYSIS = /\b(further\s+analysis|deeper\s+dive|continue\s+(?:the\s+)?breakdown|more\s+depth|drill\s+down\s+further|expand\s+on\s+this)\b/i

const AUTONOMOUS_CONTINUE =
  /\b(i(?:'ll|\s+will)\s+keep\s+going|allow\s+me\s+to\s+continue|let\s+me\s+continue\s+unpack|going\s+deeper\s+without)\b/i

const CONTRADICTION =
  /\b(unresolved\s+contradiction|contradiction\s+detected|conflicting\s+(?:signal|evidence|runtime|fact)|cannot\s+reconcile|material\s+contradiction)\b/i

const MATERIAL_FOLLOWUP =
  /\b(materially\s+(?:changes?|change)\s+(?:the\s+)?conclusion|important\s+strategic\s+(?:analysis|concern|risk)|additional\s+(?:architectural|strategic|risk)\s+(?:concern|analysis)|changes\s+my\s+recommendation)\b/i

const RUNTIME_EMERGENCY =
  /\b(runtime\s+(?:emergency|failure|integrity|contradiction)|emergency\s+(?:condition|alert)|data\s+loss|security\s+risk|provider\s+(?:failure|degradation)|hold\s+required)\b/i

const LOW_VALUE_CONTINUATION =
  /\b(happy\s+to\s+elaborate|more\s+thoughts|i\s+can\s+say\s+more|another\s+angle|if\s+helpful|for\s+fun|quick\s+note)\b/i

/** True when output pressures continuation without permission-style framing. */
export function detectContinuationPressure(text: string): boolean {
  const t = (text ?? '').trim()
  if (!t || t.length < 12) return false
  if (LOW_VALUE_CONTINUATION.test(t)) return false
  if (PERMISSION_FRAMING.test(t)) {
    return CONTRADICTION.test(t) || MATERIAL_FOLLOWUP.test(t) || RUNTIME_EMERGENCY.test(t)
  }
  return FURTHER_ANALYSIS.test(t) || AUTONOMOUS_CONTINUE.test(t)
}

function classifyContinuation(text: string): { kind: ContinuationRequestKind; message: string; reasonKey: string } | null {
  const t = (text ?? '').trim()
  if (!detectContinuationPressure(t)) return null
  if (RUNTIME_EMERGENCY.test(t)) {
    return {
      kind: 'runtime_emergency',
      message: 'Runtime or emergency condition may materially affect the council answer.',
      reasonKey: 'runtime_emergency',
    }
  }
  if (CONTRADICTION.test(t)) {
    return {
      kind: 'contradiction',
      message: 'Unresolved contradiction may change the conclusion.',
      reasonKey: 'unresolved_contradiction',
    }
  }
  if (MATERIAL_FOLLOWUP.test(t)) {
    return {
      kind: 'analysis_depth',
      message: 'Additional strategic analysis may materially change the recommendation.',
      reasonKey: 'material_followup',
    }
  }
  if (AUTONOMOUS_CONTINUE.test(t)) {
    return {
      kind: 'autonomous_continuation',
      message: 'Council output attempted to continue without explicit operator permission.',
      reasonKey: 'autonomous_continuation',
    }
  }
  if (FURTHER_ANALYSIS.test(t)) {
    return {
      kind: 'analysis_depth',
      message: 'Council output requested more depth after completing its turn.',
      reasonKey: 'analysis_depth',
    }
  }
  return null
}

export function buildContinuationRequestFromModelOutput(args: {
  family: CouncilOrchestrationFamily
  text: string
}): ContinuationRequest | null {
  const classified = classifyContinuation(args.text)
  if (!classified) return null
  const pf = (args.text.match(/\bprimary\s+finding\b/gi) ?? []).length
  if (pf >= 2) return null
  return {
    id: `cr-${Date.now()}-${args.family}-${classified.reasonKey}`,
    family: args.family,
    kind: classified.kind,
    message: classified.message,
    status: 'pending',
    createdAt: new Date().toISOString(),
    reasonKey: classified.reasonKey,
  }
}
