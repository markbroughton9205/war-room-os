import { changedRatio, extractJson, runModule } from './exec'
import type { Fixture } from './types'

/** DEBUGGER_TEST_SPECIALIST: a failing test report on a small module; the answer must name the root cause, deliver a fix that passes, and not rewrite the module. */
type Case = { id: string; buggy: string; fixed: string; test: string; cause: RegExp }
const HEAD = "import assert from 'node:assert/strict'\n"
const CASES: Case[] = [
  { id: 'id_reuse_after_delete', cause: /id|identifier|length|duplicate|unique|collision/i,
    buggy: "export function createStore() {\n  const items = []\n  return {\n    add(name) { const item = { id: items.length + 1, name }; items.push(item); return item },\n    remove(id) { const i = items.findIndex((x) => x.id === id); if (i >= 0) items.splice(i, 1) },\n    all() { return items.slice() },\n  }\n}\n",
    fixed: "export function createStore() {\n  const items = []\n  let next = 1\n  return {\n    add(name) { const item = { id: next++, name }; items.push(item); return item },\n    remove(id) { const i = items.findIndex((x) => x.id === id); if (i >= 0) items.splice(i, 1) },\n    all() { return items.slice() },\n  }\n}\n",
    test: "const s = createStore(); s.add('a'); s.add('b'); s.remove(1); s.add('c'); assert.deepEqual(s.all().map((x) => x.id), [2, 3])" },
  { id: 'wrong_status_codes', cause: /201|404|status/i,
    buggy: "export function handle(req, db) {\n  if (req.method === 'POST' && req.path === '/items') {\n    const item = { id: db.next++, ...req.body }\n    db.items.push(item)\n    return { status: 200, body: item }\n  }\n  if (req.method === 'GET' && req.path.startsWith('/items/')) {\n    const id = Number(req.path.split('/')[2])\n    const item = db.items.find((i) => i.id === id)\n    return { status: 200, body: item }\n  }\n  return { status: 404, body: { error: 'not found' } }\n}\n",
    fixed: "export function handle(req, db) {\n  if (req.method === 'POST' && req.path === '/items') {\n    const item = { id: db.next++, ...req.body }\n    db.items.push(item)\n    return { status: 201, body: item }\n  }\n  if (req.method === 'GET' && req.path.startsWith('/items/')) {\n    const id = Number(req.path.split('/')[2])\n    const item = db.items.find((i) => i.id === id)\n    if (!item) return { status: 404, body: { error: 'not found' } }\n    return { status: 200, body: item }\n  }\n  return { status: 404, body: { error: 'not found' } }\n}\n",
    test: "const db = { items: [], next: 1 }; const c = handle({ method: 'POST', path: '/items', body: { n: 1 } }, db); assert.equal(c.status, 201); assert.equal(handle({ method: 'GET', path: '/items/1' }, db).status, 200); assert.equal(handle({ method: 'GET', path: '/items/9' }, db).status, 404)" },
  { id: 'case_sensitive_filter', cause: /case|lower|insensitive/i,
    buggy: "export function search(items, q) {\n  return items.filter((i) => i.name.includes(q))\n}\n",
    fixed: "export function search(items, q) {\n  const needle = q.toLowerCase()\n  return items.filter((i) => i.name.toLowerCase().includes(needle))\n}\n",
    test: "assert.deepEqual(search([{ name: 'Apple' }, { name: 'pear' }], 'APP').map((x) => x.name), ['Apple'])" },
  { id: 'counter_not_initialised', cause: /init|NaN|undefined|zero|default/i,
    buggy: "export function countByStatus(tasks) {\n  const counts = {}\n  for (const t of tasks) counts[t.status]++\n  return counts\n}\n",
    fixed: "export function countByStatus(tasks) {\n  const counts = {}\n  for (const t of tasks) counts[t.status] = (counts[t.status] ?? 0) + 1\n  return counts\n}\n",
    test: "assert.deepEqual(countByStatus([{ status: 'open' }, { status: 'done' }, { status: 'open' }]), { open: 2, done: 1 })" },
  { id: 'update_overwrites_id', cause: /id|assign|merge|overwrit|patch/i,
    buggy: "export function update(items, id, patch) {\n  const item = items.find((i) => i.id === id)\n  if (!item) return null\n  Object.assign(item, patch)\n  return item\n}\n",
    fixed: "export function update(items, id, patch) {\n  const item = items.find((i) => i.id === id)\n  if (!item) return null\n  Object.assign(item, { ...patch, id: item.id })\n  return item\n}\n",
    test: "const items = [{ id: 1, t: 'a' }]; update(items, 1, { id: 99, t: 'b' }); assert.deepEqual(items, [{ id: 1, t: 'b' }])" },
  { id: 'pagination_offset', cause: /page|offset|1-based|zero|index|start/i,
    buggy: "export function paginate(items, page, size) {\n  return items.slice(page * size, page * size + size)\n}\n",
    fixed: "export function paginate(items, page, size) {\n  return items.slice((page - 1) * size, (page - 1) * size + size)\n}\n",
    test: "const xs = [1, 2, 3, 4, 5]; assert.deepEqual(paginate(xs, 1, 2), [1, 2]); assert.deepEqual(paginate(xs, 3, 2), [5])" },
  { id: 'set_lost_in_json', cause: /set|serial|json|stringify|array/i,
    buggy: "export function save(state) {\n  return JSON.stringify(state)\n}\nexport function load(text) {\n  const raw = JSON.parse(text)\n  return { ...raw, tags: new Set(raw.tags) }\n}\n",
    fixed: "export function save(state) {\n  return JSON.stringify({ ...state, tags: [...state.tags] })\n}\nexport function load(text) {\n  const raw = JSON.parse(text)\n  return { ...raw, tags: new Set(raw.tags) }\n}\n",
    test: "const back = load(save({ name: 'x', tags: new Set(['a', 'b']) })); assert.deepEqual([...back.tags], ['a', 'b']); assert.equal(back.name, 'x')" },
  { id: 'transition_unchecked', cause: /transition|allowed|valid|table|check/i,
    buggy: "const ALLOWED = { open: ['in_progress', 'closed'], in_progress: ['closed'], closed: [] }\nexport function transition(task, to) {\n  task.status = to\n  return task\n}\n",
    fixed: "const ALLOWED = { open: ['in_progress', 'closed'], in_progress: ['closed'], closed: [] }\nexport function transition(task, to) {\n  if (!ALLOWED[task.status]?.includes(to)) throw new Error('invalid transition')\n  task.status = to\n  return task\n}\n",
    test: "assert.equal(transition({ status: 'open' }, 'in_progress').status, 'in_progress'); assert.throws(() => transition({ status: 'closed' }, 'open'))" },
  { id: 'delete_by_position', cause: /index|position|id|splice|findIndex/i,
    buggy: "export function removeItem(items, id) {\n  items.splice(id, 1)\n  return items\n}\n",
    fixed: "export function removeItem(items, id) {\n  const i = items.findIndex((x) => x.id === id)\n  if (i >= 0) items.splice(i, 1)\n  return items\n}\n",
    test: "const xs = [{ id: 5 }, { id: 7 }, { id: 9 }]; assert.deepEqual(removeItem(xs, 7).map((x) => x.id), [5, 9])" },
  { id: 'persist_before_mutate', cause: /persist|before|order|after|stale|snapshot|save/i,
    buggy: "export function createRepo(write) {\n  const items = []\n  return {\n    add(item) { write(items); items.push(item) },\n    all() { return items },\n  }\n}\n",
    fixed: "export function createRepo(write) {\n  const items = []\n  return {\n    add(item) { items.push(item); write(items) },\n    all() { return items },\n  }\n}\n",
    test: "let saved = null; const r = createRepo((xs) => { saved = xs.map((x) => x.n) }); r.add({ n: 1 }); r.add({ n: 2 }); assert.deepEqual(saved, [1, 2])" },
]

const SYSTEM = 'You are a debugger. You are given a small module and its failing test report. Find the ROOT CAUSE, then give a minimal fix: change only what the cause requires and do not rewrite the module. Reply with one JSON object: {"root_cause": "<one or two sentences>", "fixed_code": "<the complete corrected file>"}.'

async function failureReport(c: Case): Promise<string> {
  const r = await runModule(`${c.buggy}\n${HEAD}${c.test}\n`)
  return (r.stderr || r.stdout).split('\n').filter((l) => !/^\s+at |^node:|^$/.test(l)).slice(0, 14).join('\n').slice(0, 1200)
}

export async function debuggerFixtures(): Promise<Fixture[]> {
  return Promise.all(CASES.map(async (c): Promise<Fixture> => {
    const report = await failureReport(c)
    return {
      id: `debugger/${c.id}`, role: 'DEBUGGER_TEST_SPECIALIST', system: SYSTEM, json: true, maxTokens: 900,
      prompt: `Module:\n\`\`\`js\n${c.buggy}\`\`\`\n\nFailing test report:\n${report}\n\nTest (for reference):\n${c.test}\n`,
      reference: JSON.stringify({ root_cause: `The root cause is about ${c.cause.source.split('|')[0] ?? ''} handling in this module`, fixed_code: c.fixed }),
      broken: JSON.stringify({ root_cause: 'unknown problem somewhere', fixed_code: c.buggy }),
      async check(reply) {
        const j = extractJson<{ root_cause?: unknown; fixed_code?: unknown }>(reply)
        if (!j || typeof j.fixed_code !== 'string' || typeof j.root_cause !== 'string') return { pass: false, detail: 'reply is not the requested JSON object' }
        if (j.root_cause.trim().length < 15) return { pass: false, detail: 'root cause is missing or too short' }
        if (!c.cause.test(j.root_cause)) return { pass: false, detail: `root cause does not identify the defect: "${j.root_cause.slice(0, 80)}"` }
        const r = await runModule(`${j.fixed_code}\n${HEAD}${c.test}\n`)
        if (!r.ok) return { pass: false, detail: `fix does not pass: ${(r.stderr.split('\n').find((l) => /Error/.test(l)) ?? `exit ${r.exitCode}`).slice(0, 120)}` }
        const ratio = changedRatio(c.buggy, j.fixed_code)
        return ratio > 0.5 ? { pass: false, detail: `passes but rewrote ${Math.round(ratio * 100)}% of the module` } : { pass: true, detail: `cause named, fix passes, ${Math.round(ratio * 100)}% changed` }
      },
    }
  }))
}
