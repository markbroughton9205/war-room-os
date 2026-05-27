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
