/**
 * Caption cue identity: overlapping identical text is one cue, not two burn-ins.
 */
export function uniqueCaptionCues<T extends { text: string; start: { ticks: number }; end: { ticks: number } }>(cues: T[]): T[] {
  const out: T[] = []
  for (const cue of cues) {
    const text = cue.text.trim()
    const duplicate = out.find(existing => (
      existing.text.trim() === text
      && existing.start.ticks < cue.end.ticks
      && existing.end.ticks > cue.start.ticks
    ))
    if (duplicate) continue
    out.push(cue)
  }
  return out
}
