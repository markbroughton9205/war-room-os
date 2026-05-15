const KEYWORDS = [
  /\bstatus\b/i,
  /\bdiagnos/i,
  /\bintegrity\b/i,
  /\bruntime\b/i,
  /\baudit\b/i,
  /silent failures/i,
  /check systems/i,
  /what'?s wrong/i,
  /system review/i,
  /red team review/i,
]

export type DiagnosticIntentMode = 'none' | 'sequential_diagnostics' | 'runtime_audit' | 'repair_review'

/** True when a decree is asking for sequential system diagnostics (not generic council chat). */
export function isSequentialDiagnosticIntent(decreeText: string): boolean {
  const t = decreeText.trim()
  if (!t) return false
  return KEYWORDS.some(re => re.test(t))
}

/**
 * Classify Ra'el decree into diagnostic sequencer intent.
 * Order matters: stricter phrases before broad keyword matches.
 */
export function resolveDiagnosticIntentMode(decreeText: string): DiagnosticIntentMode {
  const t = decreeText.trim()
  if (!t) return 'none'
  if (/\brepair[-\s]?review\b|\brepair\s+approval\b|\bpost[-\s]?mortem\b/i.test(t)) return 'repair_review'
  if (/\bruntime\s+audit\b|\baudit\s+runtime\b|\bsystems\s+audit\b|\bintegrity\s+audit\b/i.test(t)) return 'runtime_audit'
  if (isSequentialDiagnosticIntent(t)) return 'sequential_diagnostics'
  return 'none'
}
