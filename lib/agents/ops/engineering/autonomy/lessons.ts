import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { Cause, CommandRecord, Diagnosis } from './types'

/**
 * Lessons from earlier missions: when a command that had to recover is DELIVERED, what failed and what resolved it is recorded; when a later command has a matching failure (same
 * fingerprint or cause) or a similar request, the lesson is put in front of the builder as DATA (it may not apply). Nothing here is invented: a lesson exists only because a real
 * failure was diagnosed and the command was then verified and delivered.
 */
export type Lesson = { id: string; at: string; commandId: string; cause: Cause; fingerprint: string; problem: string; resolution: string; keywords: string[]; paths: string[] }

const file = (adir: string) => path.join(adir, 'lessons.jsonl')
const STOP = new Set('the a an and or of to in on for with is are be it this that from by as at into add make build change foundry'.split(' '))
export const keywordsOfText = (t: string): string[] => [...new Set((t.toLowerCase().match(/[a-z][a-z0-9]{3,}/g) ?? []).filter((w) => !STOP.has(w)))].slice(0, 24)

/** What is known to resolve a failure of this shape. The table holds fixes this system has actually applied successfully (the first entry came from the spaceship cursor mission). */
export function resolutionHint(d: Pick<Diagnosis, 'cause' | 'summary' | 'detail'>): string {
  const t = `${d.summary} ${d.detail}`
  if (/window is not defined|document is not defined|localStorage is not defined|matchMedia|prerender/i.test(t)) return 'A client component read a browser global while rendering, which crashes the production build (server prerender). Resolved by starting from a server-safe initial value and reading window/document/localStorage/matchMedia only inside useEffect or event handlers.'
  if (/no test file|test file is missing|planned test file/i.test(t)) return 'The planned test file was not written. Resolved by creating the test file with node:test tests for every exported function.'
  if (/error TS\d+/i.test(t)) return 'The repository type check failed in a file the mission wrote. Resolved by fixing exactly the reported TS errors (right import path, right type) without changing behaviour.'
  if (/NO_CHANGE|changed no file|no file inside its write scope/i.test(t)) return 'The repair attempt wrote no change. Resolved by giving the builder the exact file and line of the defect (static analysis) or by routing the repair to a different qualified local model.'
  if (/Module not found|Can.t resolve/i.test(t)) return 'An import pointed at a file that does not exist. Resolved by correcting the import path to the real module.'
  return ''
}

export function lessonsFromCommand(cmd: CommandRecord): Lesson[] {
  if (cmd.state !== 'DELIVERED') return []
  const out: Lesson[] = []
  const paths = [...new Set(cmd.steps.flatMap((s) => s.subtask.targets.map((t) => t.path)))].slice(0, 12)
  const kw = keywordsOfText(cmd.text)
  for (const list of Object.values(cmd.diagnoses ?? {})) for (const d of list) {
    if (d.cause === 'resource' || d.cause === 'external') continue // those pass by themselves; nothing to teach a builder
    const resolution = resolutionHint(d) || `Resolved after ${cmd.steps.reduce((n, s) => n + s.missions.length, 0)} mission attempt(s) by a changed strategy (${[...new Set(cmd.steps.flatMap((s) => s.missions.map((m) => m.strategy)))].join(', ')}).`
    out.push({ id: `les-${createHash('sha256').update(cmd.id + d.fingerprint).digest('hex').slice(0, 10)}`, at: new Date().toISOString(), commandId: cmd.id, cause: d.cause, fingerprint: d.fingerprint, problem: d.summary.slice(0, 240), resolution: resolution.slice(0, 500), keywords: [...new Set([...kw, ...keywordsOfText(d.summary)])].slice(0, 28), paths })
  }
  return out
}

export function readLessons(adir: string): Lesson[] {
  if (!existsSync(file(adir))) return []
  return readFileSync(file(adir), 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l) as Lesson] } catch { return [] } })
}
export function recordLessons(adir: string, lessons: Lesson[]): number {
  if (!lessons.length) return 0
  mkdirSync(adir, { recursive: true })
  const have = new Set(readLessons(adir).map((l) => l.id))
  let n = 0
  for (const l of lessons) { if (have.has(l.id)) continue; appendFileSync(file(adir), JSON.stringify(l) + '\n'); n++ }
  return n
}

/** Top lessons for a situation: the same failure fingerprint counts most, then the same cause, then overlap with the request words and the files involved. */
export function retrieveLessons(adir: string, q: { text?: string; cause?: Cause; fingerprint?: string; paths?: string[] }, limit = 3): Lesson[] {
  const words = new Set(keywordsOfText(q.text ?? ''))
  const scored = readLessons(adir).map((l) => {
    let s = 0
    if (q.fingerprint && l.fingerprint === q.fingerprint) s += 8
    if (q.cause && l.cause === q.cause) s += 3
    s += Math.min(4, l.keywords.filter((k) => words.has(k)).length)
    if (q.paths?.length) s += Math.min(3, l.paths.filter((p) => q.paths!.includes(p)).length * 2)
    return { l, s }
  }).filter((x) => x.s >= 4).sort((a, b) => b.s - a.s)
  const seen = new Set<string>(); const out: Lesson[] = []
  for (const { l } of scored) { if (seen.has(l.resolution)) continue; seen.add(l.resolution); out.push(l); if (out.length >= limit) break }
  return out
}

export const lessonsBlock = (ls: Lesson[]): string => ls.length ? `\n\nLESSONS FROM EARLIER MISSIONS (data from this system's own history; they may not apply here):\n${ls.map((l) => `- [${l.id}] Problem seen before: ${l.problem}\n  What resolved it: ${l.resolution}`).join('\n')}` : ''
