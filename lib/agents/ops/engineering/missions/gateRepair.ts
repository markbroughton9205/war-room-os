/** Repair of repository-gate failures (type check) in the files a mission wrote. Pure helpers; the runner makes the model call and records provenance. */

export const GATE_REPAIR_ROUNDS = 3
export const GATE_REPAIR_SYSTEM = 'You are a senior engineer fixing compile errors reported by the repository\'s own TypeScript check in ONE file you wrote. Change only what the errors require and keep the behaviour and every data-testid, export and import that does not need to change. Reply with the COMPLETE corrected file in a single fenced code block and nothing else.'

/** tsc lines look like `path(12,34): error TS2307: message`; returns messages grouped by file (relative path as tsc printed it). */
export function tscErrorsByFile(output: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const line of output.split('\n')) {
    const m = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/.exec(line.trim())
    if (!m) continue
    const list = out.get(m[1]) ?? []
    list.push(`line ${m[2]}: ${m[4]} ${m[5]}`)
    out.set(m[1], list)
  }
  return out
}

/** Only errors in files the mission wrote are the mission's to fix; an error elsewhere means the gate was red for another reason. */
export function splitErrors(byFile: Map<string, string[]>, missionFiles: string[]): { mine: Map<string, string[]>; others: string[] } {
  const mine = new Map<string, string[]>(); const others: string[] = []
  for (const [f, errs] of byFile) { if (missionFiles.includes(f)) mine.set(f, errs); else others.push(...errs.map((e) => `${f}: ${e}`)) }
  return { mine, others }
}

export function gateRepairPrompt(file: string, content: string, errors: string[], related: { path: string; text: string }[]): string {
  return [
    `FILE TO FIX: ${file}`,
    'The repository type check reports these errors in this file:',
    ...errors.map((e) => `- ${e}`),
    ...(related.length ? ['', 'FILES THIS ONE RELIES ON (already correct; do not rewrite them):', ...related.map((r) => `--- ${r.path}\n${r.text.slice(0, 3000)}`)] : []),
    '', 'CURRENT CONTENT OF THE FILE:', '```', content, '```',
    '', 'Reply with the complete corrected file in one fenced code block.',
  ].join('\n')
}

/** The first fenced block of a reply, or null when there is none or it looks truncated relative to the original. */
export function extractCorrected(reply: string, original: string): string | null {
  const m = /```[a-zA-Z]*\n([\s\S]*?)\n```/.exec(reply)
  const body = m?.[1]
  if (!body || body.trim().length < Math.min(60, original.length)) return null
  if (body.length < original.length * 0.6) return null
  return body.endsWith('\n') ? body : body + '\n'
}
