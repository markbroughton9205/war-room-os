import { extractJson } from './exec'
import type { Fixture } from './types'

/**
 * ARCHITECT_REVIEWER: review an implementation against its contract. Seven variants each carry ONE seeded flaw against a stated criterion; three are
 * correct (they measure false rejection). A pass needs the right verdict AND, for a flawed variant, a finding that names the seeded problem.
 */
const CONTRACT = `Tasks service contract:
1. POST: title is required and must be a non-empty string, otherwise 400. New tasks have status "open". Success returns 201.
2. GET list: optional status filter returns only tasks with that status.
3. PATCH status: a task may only move open -> in_progress -> done, one step at a time. Any other move returns 409. Unknown id returns 404. Only the status field may change.
4. DELETE: removes the task and returns 204. Unknown id returns 404.
5. Every change is persisted to tasks.json before the call returns. The service must start with no tasks.json present.`

const BASE = `import fs from 'node:fs'
const FILE = 'tasks.json'
const ORDER = ['open', 'in_progress', 'done']
function load() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return [] } }
function save(tasks) { fs.writeFileSync(FILE, JSON.stringify(tasks)) }
export function createTask(body) {
  if (typeof body.title !== 'string' || !body.title.trim()) return { status: 400, body: { error: 'title required' } }
  const tasks = load()
  const task = { id: tasks.reduce((m, t) => Math.max(m, t.id), 0) + 1, title: body.title.trim(), status: 'open' }
  tasks.push(task); save(tasks)
  return { status: 201, body: task }
}
export function listTasks(query) {
  const tasks = load()
  return { status: 200, body: query.status ? tasks.filter((t) => t.status === query.status) : tasks }
}
export function patchTask(id, body) {
  const tasks = load(); const t = tasks.find((x) => x.id === id)
  if (!t) return { status: 404, body: { error: 'not found' } }
  if (ORDER.indexOf(body.status) !== ORDER.indexOf(t.status) + 1) return { status: 409, body: { error: 'invalid transition' } }
  t.status = body.status; save(tasks)
  return { status: 200, body: t }
}
export function deleteTask(id) {
  const tasks = load(); const i = tasks.findIndex((x) => x.id === id)
  if (i < 0) return { status: 404, body: { error: 'not found' } }
  tasks.splice(i, 1); save(tasks)
  return { status: 204, body: null }
}
`
const swap = (from: string, to: string) => { if (!BASE.includes(from)) throw new Error(`architect fixture: pattern not found: ${from}`); return BASE.replace(from, to) }

type Variant = { id: string; code: string; flaw: RegExp | null }
const VARIANTS: Variant[] = [
  { id: 'missing_title_validation', flaw: /title|validat|empty|required|400/i, code: swap("  if (typeof body.title !== 'string' || !body.title.trim()) return { status: 400, body: { error: 'title required' } }\n", '') },
  { id: 'any_transition_allowed', flaw: /transition|409|conflict|order|step|skip/i, code: swap("  if (ORDER.indexOf(body.status) !== ORDER.indexOf(t.status) + 1) return { status: 409, body: { error: 'invalid transition' } }\n", '') },
  { id: 'delete_not_persisted', flaw: /persist|save|write|file|disk|delete/i, code: swap('  tasks.splice(i, 1); save(tasks)\n', '  tasks.splice(i, 1)\n') },
  { id: 'filter_ignored', flaw: /filter|status|query/i, code: swap('  return { status: 200, body: query.status ? tasks.filter((t) => t.status === query.status) : tasks }', '  return { status: 200, body: tasks }') },
  { id: 'delete_unknown_204', flaw: /404|unknown|not found|missing|nonexist/i, code: swap("  if (i < 0) return { status: 404, body: { error: 'not found' } }\n  tasks.splice", '  tasks.splice') },
  { id: 'mass_assignment', flaw: /mass|assign|only (the )?status|other fields|whitelist|arbitrary|overwrite/i, code: swap('  t.status = body.status; save(tasks)', '  Object.assign(t, body); save(tasks)') },
  { id: 'crash_without_file', flaw: /missing file|ENOENT|not exist|startup|start|absent|no tasks\.json|throw|crash|try|catch/i, code: swap("function load() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return [] } }", "function load() { return JSON.parse(fs.readFileSync(FILE, 'utf8')) }") },
  { id: 'clean_original', flaw: null, code: BASE },
  { id: 'clean_uuid_ids', flaw: null, code: swap("id: tasks.reduce((m, t) => Math.max(m, t.id), 0) + 1,", 'id: tasks.length ? Math.max(...tasks.map((t) => t.id)) + 1 : 1,') },
  { id: 'clean_next_map', flaw: null, code: swap("if (ORDER.indexOf(body.status) !== ORDER.indexOf(t.status) + 1)", "if (ORDER[ORDER.indexOf(t.status) + 1] !== body.status)") },
]

const SYSTEM = 'You are an independent architecture reviewer. Check the implementation against EVERY numbered criterion of the contract. Report only real violations you can point to in the code; do not invent problems and do not report style. Reply with one JSON object: {"verdict": "PASS" or "FAIL", "flaws": [{"criterion": <number>, "problem": "<what is wrong and where>"}]}. PASS means flaws is empty.'

export function architectFixtures(): Fixture[] {
  return VARIANTS.map((v): Fixture => ({
    id: `architect/${v.id}`, role: 'ARCHITECT_REVIEWER', system: SYSTEM, json: true, maxTokens: 700,
    prompt: `${CONTRACT}\n\nImplementation:\n\`\`\`js\n${v.code}\`\`\`\n\nReview it against the contract.`,
    reference: JSON.stringify(v.flaw ? { verdict: 'FAIL', flaws: [{ criterion: 1, problem: v.flaw.source.split('|')[0] }] } : { verdict: 'PASS', flaws: [] }),
    broken: JSON.stringify(v.flaw ? { verdict: 'PASS', flaws: [] } : { verdict: 'FAIL', flaws: [{ criterion: 3, problem: 'invented problem' }] }),
    check(reply) {
      const j = extractJson<{ verdict?: unknown; flaws?: unknown }>(reply)
      if (!j || (j.verdict !== 'PASS' && j.verdict !== 'FAIL') || !Array.isArray(j.flaws)) return { pass: false, detail: 'reply is not the requested JSON object', klass: v.flaw ? 'flawed' : 'clean' }
      const flaws = j.flaws as { problem?: unknown }[]
      if (!v.flaw) return j.verdict === 'PASS' && flaws.length === 0 ? { pass: true, detail: 'correctly passed', klass: 'clean' } : { pass: false, detail: `false rejection: ${flaws.map((f) => String(f.problem).slice(0, 60)).join(' | ')}`, klass: 'clean' }
      if (j.verdict !== 'FAIL') return { pass: false, detail: 'missed the seeded flaw', klass: 'flawed' }
      const hit = flaws.some((f) => v.flaw!.test(String(f.problem)))
      return hit ? { pass: true, detail: 'named the seeded flaw', klass: 'flawed' } : { pass: false, detail: `failed it but named something else: ${flaws.map((f) => String(f.problem).slice(0, 60)).join(' | ')}`, klass: 'flawed' }
    },
  }))
}
