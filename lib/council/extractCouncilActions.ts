/**
 * Conservative extraction of proposed follow-ups from model text.
 * Returns plain strings suitable for action queue payloads (no fabricated rows).
 */
export function extractProposedCouncilActions(text: string): string[] {
  const lines = text.split(/\r?\n/)
  const out: string[] = []
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (/^- \[[ x]\]\s+/i.test(line)) {
      const rest = line.replace(/^- \[[ x]\]\s+/i, '').trim()
      if (rest.length >= 3) out.push(rest.slice(0, 800))
      continue
    }
    if (/^-\s+\[\s*\]\s+/.test(line)) {
      const rest = line.replace(/^-\s+\[\s*\]\s+/, '').trim()
      if (rest.length >= 3) out.push(rest.slice(0, 800))
      continue
    }
    if (/^ACTION:\s*/i.test(line)) {
      const rest = line.replace(/^ACTION:\s*/i, '').trim()
      if (rest.length >= 3) out.push(rest.slice(0, 800))
    }
  }
  return [...new Set(out)].slice(0, 12)
}
