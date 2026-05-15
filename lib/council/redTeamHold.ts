/**
 * Detect when Red Team output should pause remaining diagnostic turns.
 * Conservative: explicit marker wins; otherwise keyword triad from Phase 2 spec.
 */
export function detectRedTeamRuntimeHold(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (/\[RUNTIME_HOLD\]/i.test(t)) return true
  const lower = t.toLowerCase()
  if (/\bhold\b/.test(lower) && /\bcontradiction\b/.test(lower)) return true
  if (/\bhold\b/.test(lower) && /\bpersist\b/.test(lower)) return true
  if (/\bcontradiction\b/.test(lower) && /\bpersist\b/.test(lower)) return true
  return false
}
