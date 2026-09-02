/**
 * Neutral session titles from the first Commander turn. Never infers decisions or opportunities.
 */
export function generateNeutralSessionTitle(commanderText: string): string {
  const t = commanderText.replace(/\s+/g, ' ').trim()
  if (!t) return 'New Council Session'
  const lower = t.toLowerCase()
  if (/\bworld\b/.test(lower) && /\b(going on|happening|news|brief|events?)\b/.test(lower)) {
    return 'World Events Brief'
  }
  if (/\blive earth\b|\bearth\b.*\b(globe|terra)\b/.test(lower)) {
    return 'Live Earth Discussion'
  }
  if (/\bpanama\b/.test(lower) && /\b(relocat|move|plan|visa)\b/.test(lower)) {
    return 'Panama Relocation Discussion'
  }
  const words = t.replace(/[^\w\s']/g, '').split(/\s+/).filter(Boolean).slice(0, 6)
  if (!words.length) return 'Council Discussion'
  const titled = words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
  return titled.length > 48 ? `${titled.slice(0, 45)}…` : titled
}

export function shouldAutoTitle(currentTitle: string | null | undefined, titleLocked: boolean | undefined): boolean {
  if (titleLocked) return false
  const t = (currentTitle ?? '').trim()
  return !t || t === 'Live Council' || t === 'Untitled thread' || t === 'New Council Session' || t === 'LEGACY COUNCIL SESSION'
}
