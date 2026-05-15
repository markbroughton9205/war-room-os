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

/** True when a decree is asking for sequential system diagnostics (not generic council chat). */
export function isSequentialDiagnosticIntent(decreeText: string): boolean {
  const t = decreeText.trim()
  if (!t) return false
  return KEYWORDS.some(re => re.test(t))
}
