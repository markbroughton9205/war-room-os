/**
 * UI-only helpers for muting legacy council diagnostic copy in operator view.
 */

const OLD_OPERATOR_DIAGNOSTIC_PATTERNS = [
  /provider response incomplete/i,
  /fallback summary used/i,
  /degraded response quality/i,
  /excluded from synthesis and repair packets/i,
  /\bfallback\b/i,
  /\bretry\b/i,
  /integrity snapshot|runtime integrity|protocol artifact/i,
  /sequential diagnostic|diagnostic session complete|diagnostic queue/i,
  /red team hold/i,
] as const

export function isOldOperatorDiagnosticText(text: string): boolean {
  const normalized = text.trim()
  if (!normalized) return false
  return OLD_OPERATOR_DIAGNOSTIC_PATTERNS.some(pattern => pattern.test(normalized))
}

export function isOldOperatorDiagnosticMessage(input: {
  content: string
  messageType: string
  degraded?: boolean
}): boolean {
  if (input.degraded && input.messageType === 'response') return true
  return isOldOperatorDiagnosticText(input.content)
}

export type OperatorDiagnosticVisibility = 'hidden' | 'degraded_notice' | 'normal'

/**
 * Pure visibility decision for a council message's diagnostic/degraded copy.
 *
 * A message from the CURRENT council operation is never fully hidden, even when "Show old
 * diagnostics" is muted — that setting exists to hide historical noise, not this round's own
 * failure notice. It still renders as a clearly-labeled degraded/failure notice (`'degraded_notice'`),
 * never as an ordinary-looking successful reply and never silently dropped.
 */
export function resolveOperatorDiagnosticVisibility(input: {
  content: string
  messageType: string
  degraded?: boolean
  diagnosticsOpen?: boolean
  councilPassthroughMode?: boolean
  operatorDiagnosticsMuted?: boolean
  isCurrentOperation?: boolean
}): OperatorDiagnosticVisibility {
  if (input.diagnosticsOpen || input.councilPassthroughMode) return 'normal'
  const isDiagnostic = isOldOperatorDiagnosticMessage({
    content: input.content,
    messageType: input.messageType,
    degraded: input.degraded,
  })
  if (!isDiagnostic) return 'normal'
  if (input.isCurrentOperation) return 'degraded_notice'
  return input.operatorDiagnosticsMuted ? 'hidden' : 'degraded_notice'
}
