/**
 * Local integrity diagnostics when DEBUG_INTEGRITY=true (no I/O beyond console).
 */

export function isIntegrityDebugEnabled(): boolean {
  const raw = process.env.DEBUG_INTEGRITY
  return raw === 'true' || raw === '1'
}

export type IntegrityDebugPayload = {
  phase: string
  rawLength: number
  normalizedLength: number
  renderedLength?: number
  last30: string
  ruleTriggered?: string
  gateResult?: string
  promptIntent?: string
  integrityStatus?: string
  renderable?: boolean
  degraded?: boolean
  stabilityMode?: boolean
  relaxedCasual?: boolean
}

export function logIntegrityDebug(payload: IntegrityDebugPayload): void {
  if (!isIntegrityDebugEnabled()) return
  console.debug('[DEBUG_INTEGRITY]', JSON.stringify(payload))
}

export function integrityDebugTail(text: string, chars = 30): string {
  const t = text.trim()
  if (!t) return ''
  return t.length <= chars ? t : t.slice(-chars)
}
