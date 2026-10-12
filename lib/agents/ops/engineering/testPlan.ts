import { groundTests } from './testGrounding'
import { storageEnvVars } from './persistenceContract'
import { testCalls } from './testContract'
import { deriveImplementationContract, type ImplementationContract } from './implContract'

/**
 * Contract-first test authoring (Phase 10). Before any model writes test code, Foundry turns the acceptance contract into a structured plan; the writer may only
 * implement tests from that plan. Behavioural criteria are proven at the HTTP contract level through a Foundry-owned harness that gives every test its own server
 * process, port and empty data directory, so tests cannot share state and test order cannot change a result. Criteria that a test suite cannot honestly prove
 * (the page, the existence of the tests themselves) are recorded as COVERED_ELSEWHERE with the reason; they are never silently dropped.
 */
export type PlannedTest = {
  criterion_id: number
  behavior: string
  level: 'HTTP' | 'NOT_IN_SUITE'
  preconditions: string
  action: string
  expected_result: string
  state_requirements: string[]
  isolation_requirements: string[]
  priority: 'REQUIRED' | 'COVERED_ELSEWHERE'
  source: 'acceptance-contract'
  covered_by?: string
  file?: string
  /** a criterion that names several statuses is split into one clause per status so each test proves exactly one expectation */
  clauses?: string[]
  /** a storage/persistence criterion is split into independent variants (CUSTOM_PATH, DEFAULT_PATH, PERSISTENCE, IDS); each needs its own test, named [C<n>] <KEY>: */
  variants?: { key: VariantKey; recipe: string }[]
}
export type VariantKey = 'CUSTOM_PATH' | 'DEFAULT_PATH' | 'PERSISTENCE' | 'IDS' | `FILTER_${string}`
export type TestPlan = {
  entry: string
  storageVars: string[]
  harnessPath: string
  tests: PlannedTest[]
  /** `generated`: the complete test file text, produced by Foundry from the contract (no model call writes it) */
  files: { path: string; criteria: number[]; generated?: string }[]
}

export const HARNESS_PATH = 'test/support/harness.mjs'
const ROUTE = /\b(GET|POST|PUT|PATCH|DELETE)\s+\//
const META = /\b(?:node |unit |automated )?tests?\b[^.]{0,40}\b(?:cover|exist|pass)\w*\b/i
const UI = /^\s*the (?:page|ui|screen)\b|\belements? (?:with )?ids?\b|\bbutton\b|\bbadge\b|\bfilter control\b/i
const MAX_CRITERIA_PER_FILE = 4

/** The server entry the harness starts: `scripts.start` of package.json, `node <file>`. Null when there is none (the plan then does not apply and the legacy flow runs). */
export function startEntry(packageJson: string | null): string | null {
  if (!packageJson) return null
  try { const s = (JSON.parse(packageJson).scripts ?? {}).start; const m = typeof s === 'string' ? /^node\s+(\S+\.m?js)\s*$/.exec(s.trim()) : null; return m ? m[1] : null } catch { return null }
}

const STATUS_IN = /(?<![\w./-])([1-5]\d\d)(?![\w./-])/g
const codesOf = (t: string): number[] => [...t.matchAll(STATUS_IN)].map((m) => Number(m[1]))
/**
 * Splits a criterion that names SEVERAL distinct statuses into clauses (';' and ',' boundaries; text without a status is carried by the clause it leads into, leading text
 * without a status becomes its own clause). Each coded clause names exactly one status, so a mismatching assertion can be judged against that clause alone. [] when the
 * criterion names fewer than two distinct statuses (nothing to split).
 */
export function clausesOf(criterion: string): string[] {
  if (new Set(codesOf(criterion)).size < 2) return []
  const split = (t: string) => t.split(/;\s*|,\s+(?:and\s+)?/).map((x) => x.trim()).filter(Boolean)
  // a piece that still carries two distinct statuses is split at " and "
  const pieces = split(criterion).flatMap((p) => (new Set(codesOf(p)).size > 1 ? p.split(/\s+and\s+/).map((x) => x.trim()).filter(Boolean) : [p]))
  const head: string[] = [], out: string[] = []
  for (const piece of pieces) {
    if (codesOf(piece).length) out.push(piece)
    else if (out.length) out[out.length - 1] = `${out[out.length - 1]}; ${piece}`
    else head.push(piece)
  }
  return [...(head.length ? [head.join('; ')] : []), ...out].filter((c) => c.length > 3)
}
/** The acceptance list used ONLY for deterministic status correction: the original criteria first (indices unchanged), then the clauses of multi-status criteria, with the parent criterion of every entry. */
export function correctionAcceptance(acceptance: string[]): { list: string[]; parent: number[] } {
  const list = [...acceptance], parent = acceptance.map((_, i) => i)
  acceptance.forEach((a, i) => { for (const c of clausesOf(a)) { list.push(c); parent.push(i) } })
  return { list, parent }
}

/**
 * Storage and persistence criteria are decomposed into INDEPENDENT variants with exact recipes, so the writer never invents the sequence and never mixes two
 * modes in one test: CUSTOM_PATH (env variable set by the harness; never the default path), DEFAULT_PATH (variable absent; never the custom path), PERSISTENCE
 * (create, capture, restart, reload, compare) and IDS (the next id continues after a restart, never reused; read from the API, never from memory).
 */
export function variantsOf(criterion: string, envVar: string | undefined, defaultPath: string | undefined, persists: boolean): { key: VariantKey; recipe: string }[] {
  const out: { key: VariantKey; recipe: string }[] = []
  if (envVar) out.push({ key: 'CUSTOM_PATH', recipe: `test('[C#] CUSTOM_PATH: ...', () => withApp(async (app) => { create a record through the API; assert.ok(existsSync(app.storageFile('${envVar}'))) })). Use withApp WITHOUT options (the harness sets ${envVar} to a file in the test's own data directory). Import { existsSync } from 'node:fs'. Never assert the file NAME and NEVER use defaultStorage or the default path in this test.` })
  if (envVar && defaultPath) out.push({ key: 'DEFAULT_PATH', recipe: `test('[C#] DEFAULT_PATH: ...', () => withApp(async (app) => { create a record through the API; assert.ok(existsSync(app.cwd + '/${defaultPath}')) }, { defaultStorage: true })). defaultStorage:true leaves ${envVar} UNSET in a private working directory. Never call app.storageFile and never assert the custom path in this test.` })
  if (persists) out.push({ key: 'PERSISTENCE', recipe: `1) create two records through the API and keep the response bodies (ids and every field)${/status/i.test(criterion) ? '; move the first record to another status using ONLY allowed moves, one step at a time' : ''}; 2) await app.restart(); 3) GET the collection again; 4) assert BOTH records are present with the same ids and the same field values${/status/i.test(criterion) ? ' (including the status the record was moved to)' : ''}. Compare against the API responses you kept, never against variables you did not read from the API.` })
  if (persists && /\bids?\b[^.]{0,60}\b(?:increas|reus|continu|unique)\w*|never reused/i.test(criterion)) out.push({ key: 'IDS', recipe: `1) create record A through the API and read its id; 2) await app.restart(); 3) create record B through the API and read its id; 4) assert B.id is a number greater than A.id (strictly increasing) and that B.id !== A.id. The sequence must come from the server's responses after the restart, never from in-memory counters in the test.` })
  return out
}


/**
 * A list criterion that selects by flag state ("?state=unread returns only unread alerts that are not archived") is a compound statement the writer keeps getting wrong in ONE test
 * (a population that never reaches the state it asserts on). It is split into one independent test per filter value (and one for the default view), each with an exact population recipe
 * built from the contract: which flag routes exist, which flag values the selection needs, and the rule that a flag that blocks later actions is applied last.
 */
export function filterVariantsOf(id: number, c: ImplementationContract): { key: VariantKey; recipe: string }[] {
  const tpl = (r: string) => r.replace(/:(\w+)/g, '${$1}')
  const flagRoutes = c.flags.map((f) => `${tpl(f.route)} sets ${f.name}=${f.sets}`)
  const blockers = [...new Set(c.conflicts.map((x) => x.flag))]
  const state = (r: { flag: string; value: boolean }[]) => r.map((x) => `${x.flag} is ${x.value}`).join(' and ') || 'any'
  const population = `Build the population through the API in the SAME test and keep every created id: create one item for each combination of the flags involved (${[...new Set(c.flags.map((f) => f.name))].join(', ') || 'the flags'}), then bring each item to its state with the flag routes (${flagRoutes.join('; ') || 'the contract routes'}) using the real id of that item (build the path from that id, for example by concatenating item.id into the path; never send a literal placeholder)${blockers.length ? `; apply the action that blocks others (${blockers.join(', ')}) LAST, because afterwards the other actions answer 409` : ''}. Write the population ONCE as a helper function declared at the top of the file (async function populate(app) { ... return the ids by state }) and call it from each filter test, so the tests stay short. Then GET the filtered list and compare the sorted ids with the ids of exactly the items whose state matches, so an item in another state must be absent.`
  const out: { key: VariantKey; recipe: string }[] = []
  for (const r of c.filterRules.filter((x) => x.criterion === id)) {
    const key = `FILTER_${r.value.toUpperCase().replace(/\W+/g, '_')}` as VariantKey
    out.push({ key, recipe: `${population} Selection: GET <list route>?${r.param}=${r.value} -> ${r.everything ? 'every item' : `items where ${state(r.requires)}`} (${r.clause}).` })
  }
  for (const d of c.defaultViews.filter((x) => x.criterion === id)) out.push({ key: 'FILTER_DEFAULT', recipe: `${population} Selection: ${d.route} with no query -> items where ${state(d.requires)} (${d.clause}).` })
  return out
}

/**
 * Tests for a list criterion that selects by flag state are GENERATED from the contract: the population (one item per combination of the flags involved, brought to its state through the
 * flag routes, the blocking action last), then one test per filter value and one for the default view that compares the exact set of ids. No model writes them, so they cost no model call
 * and cannot carry a population mistake. Null when the contract does not carry what the generator needs (no create route, a flag without a setter route, a setter route with extra parameters):
 * the criterion then falls back to model-written filter variants.
 */
export function generateFilterTests(id: number, c: ImplementationContract): string | null {
  const rules = c.filterRules.filter((r) => r.criterion === id), views = c.defaultViews.filter((d) => d.criterion === id)
  if (!rules.length && !views.length) return null
  const create = c.routes.find((r) => r.createsRecord)
  if (!create) return null
  const strip = (r: string) => r.replace(/^(?:GET|POST|PUT|PATCH|DELETE)\s+/, '')
  const listPath = strip(views[0]?.route ?? c.filters.find((f) => rules.some((r) => r.param === f.param))?.route ?? '')
  if (!listPath || /:/.test(listPath)) return null
  const names = [...new Set([...rules, ...views].flatMap((r) => r.requires.map((q) => q.flag)))]
  if (!names.length) return null
  const blockers = new Set(c.conflicts.map((x) => x.flag))
  const setters: Record<string, string> = {}
  for (const n of names) {
    const f = c.flags.find((x) => x.name === n && x.sets === true)
    const params = f ? [...f.route.matchAll(/:(\w+)/g)] : []
    if (!f || params.length !== 1) return null
    setters[n] = "'" + strip(f.route).replace(/:\w+/, "' + id + '") + "'"
  }
  const order = [...names.filter((n) => !blockers.has(n)), ...names.filter((n) => blockers.has(n))]
  const combos: Record<string, boolean>[] = []
  for (let m = 0; m < 1 << names.length; m++) combos.push(Object.fromEntries(names.map((n, i) => [n, !!(m & (1 << i))])))
  const body = Object.fromEntries(c.fields.filter((f) => f.required).map((f) => [f.name, f.values[0] ?? 'item']))
  const bodyExpr = (field: string | undefined) => (field ? `{ ${JSON.stringify(field)}: 'item ' + n }` : '{}')
  const textField = c.fields.find((f) => f.required && !f.values.length)?.name
  const extra = c.fields.filter((f) => f.required && f.values.length).map((f) => `${JSON.stringify(f.name)}: ${JSON.stringify(f.values[0])}`)
  const bodyJs = textField || extra.length ? `{ ${[textField ? `${JSON.stringify(textField)}: 'item ' + n` : '', ...extra].filter(Boolean).join(', ')} }` : bodyExpr(undefined)
  void body
  const pred = (r: { flag: string; value: boolean }[]) => (r.length ? r.map((q) => `s.${q.flag} === ${q.value}`).join(' && ') : 'true')
  const lines: string[] = [
    "import test from 'node:test'",
    "import assert from 'node:assert/strict'",
    "import { withApp } from './support/harness.mjs'",
    '',
    `const CREATE = ${JSON.stringify(strip(create.path))}`,
    `const LIST = ${JSON.stringify(listPath)}`,
    `const COMBOS = ${JSON.stringify(combos)}`,
    `const ORDER = ${JSON.stringify(order)}`,
    `const SETTER = { ${names.map((n) => `${JSON.stringify(n)}: (id) => ${setters[n]}`).join(', ')} }`,
    '',
    'async function populate(app) {',
    '  const items = []',
    '  let n = 0',
    '  for (const state of COMBOS) {',
    '    n += 1',
    `    const created = await app.post(CREATE, ${bodyJs})`,
    "    assert.ok(created.status >= 200 && created.status < 300, 'create answered ' + created.status)",
    '    const id = created.body.id',
    '    for (const flag of ORDER) {',
    '      if (!state[flag]) continue',
    '      const r = await app.post(SETTER[flag](id), {})',
    "      assert.ok(r.status >= 200 && r.status < 300, 'setting ' + flag + ' answered ' + r.status)",
    '    }',
    '    items.push({ id: String(id), state })',
    '  }',
    '  return items',
    '}',
    "const idsOf = (res) => { assert.ok(Array.isArray(res.body), 'the list is an array'); return res.body.map((x) => String(x.id)).sort() }",
    'const want = (items, pred) => items.filter((i) => pred(i.state)).map((i) => i.id).sort()',
    '',
  ]
  for (const r of rules) lines.push(
    `test(${JSON.stringify(`[C${id}] FILTER_${r.value.toUpperCase().replace(/\W+/g, '_')}: ?${r.param}=${r.value}`)}, () => withApp(async (app) => {`,
    '  const items = await populate(app)',
    `  const res = await app.get(LIST + ${JSON.stringify(`?${r.param}=${r.value}`)})`,
    '  assert.equal(res.status, 200)',
    `  assert.deepStrictEqual(idsOf(res), want(items, (s) => ${r.everything ? 'true' : pred(r.requires)}))`,
    '}))', '')
  for (const d of views) lines.push(
    `test(${JSON.stringify(`[C${id}] FILTER_DEFAULT: the list without a query`)}, () => withApp(async (app) => {`,
    '  const items = await populate(app)',
    '  const res = await app.get(LIST)',
    '  assert.equal(res.status, 200)',
    `  assert.deepStrictEqual(idsOf(res), want(items, (s) => ${pred(d.requires)}))`,
    '}))', '')
  return lines.join('\n')
}

/**
 * A state-count criterion ("GET /api/tasks/summary returns the number of tasks per status as {todo:n,doing:n,done:n}") is generated from the contract: tasks are created and walked to each
 * status along the ALLOWED transitions only (the writer kept jumping straight to a status or naming tasks after statuses), then the counts are compared exactly; an empty board answers all zeros.
 * Null when the contract does not carry what is needed (no create route, no PATCH route with a body field, a status that cannot be reached from the initial one).
 */
export function generateCounterTests(id: number, c: ImplementationContract): string | null {
  const strip = (r: string) => r.replace(/^(?:GET|POST|PUT|PATCH|DELETE)\s+/, '')
  const sum = c.routes.find((r) => r.criterion === id && r.method === 'GET' && !r.params.length && r.shape && Object.keys(r.shape).length >= 2 && Object.values(r.shape).every((v) => v === 'n'))
  const create = c.routes.find((r) => r.createsRecord)
  const move = c.routes.find((r) => r.method === 'PATCH' && r.bodyField && r.params.length === 1)
  if (!sum || !create || !move || !c.transitions.length) return null
  const keys = Object.keys(sum.shape!)
  const edges = c.transitions.filter((t) => t.allowed)
  const states = new Set(edges.flatMap((t) => [t.from, t.to]))
  if (!keys.every((k) => states.has(k))) return null
  const field = c.fields.find((f) => f.name === move.bodyField)
  const initial = field?.default && states.has(field.default) ? field.default : keys.find((k) => !edges.some((t) => t.to === k))
  if (!initial) return null
  const route: Record<string, string[]> = {}
  for (const k of keys) {
    const prev: Map<string, string | null> = new Map([[initial, null]]); const queue: string[] = [initial]
    while (queue.length) { const cur = queue.shift()!; for (const t of edges.filter((e) => e.from === cur)) if (!prev.has(t.to)) { prev.set(t.to, cur); queue.push(t.to) } }
    if (!prev.has(k)) return null
    const path: string[] = []; let at: string | null = k; while (at && at !== initial) { path.unshift(at); at = prev.get(at) ?? null }
    route[k] = path
  }
  const counts = Object.fromEntries(keys.map((k, i) => [k, i + 1]))
  const textField = c.fields.find((f) => f.required && !f.values.length)?.name
  const extra = c.fields.filter((f) => f.required && f.values.length).map((f) => `${JSON.stringify(f.name)}: ${JSON.stringify(f.values[0])}`)
  const bodyJs = textField || extra.length ? `{ ${[textField ? `${JSON.stringify(textField)}: 'item ' + n` : '', ...extra].filter(Boolean).join(', ')} }` : '{}'
  const movePath = "'" + strip(move.path).replace(/:\w+/, "' + id + '") + "'"
  const zeros = Object.fromEntries(keys.map((k) => [k, 0]))
  return [
    "import test from 'node:test'",
    "import assert from 'node:assert/strict'",
    "import { withApp } from './support/harness.mjs'",
    '',
    `const CREATE = ${JSON.stringify(strip(create.path))}`,
    `const SUMMARY = ${JSON.stringify(strip(sum.path))}`,
    `const COUNTS = ${JSON.stringify(counts)}`,
    `const ROUTE = ${JSON.stringify(route)}`,
    `const moveTo = (id) => ${movePath}`,
    '',
    'async function populate(app) {',
    '  let n = 0',
    '  for (const state of Object.keys(COUNTS)) {',
    '    for (let i = 0; i < COUNTS[state]; i++) {',
    '      n += 1',
    `      const created = await app.post(CREATE, ${bodyJs})`,
    "      assert.ok(created.status >= 200 && created.status < 300, 'create answered ' + created.status)",
    '      for (const step of ROUTE[state]) {',
    `        const r = await app.patch(moveTo(created.body.id), { ${JSON.stringify(move.bodyField)}: step })`,
    "        assert.ok(r.status >= 200 && r.status < 300, 'moving to ' + step + ' answered ' + r.status)",
    '      }',
    '    }',
    '  }',
    '}',
    '',
    `test(${JSON.stringify(`[C${id}] SUMMARY: counts per status`)}, () => withApp(async (app) => {`,
    '  await populate(app)',
    '  const res = await app.get(SUMMARY)',
    '  assert.equal(res.status, 200)',
    '  assert.deepStrictEqual(res.body, COUNTS)',
    '}))',
    '',
    `test(${JSON.stringify(`[C${id}] SUMMARY_EMPTY: an empty board counts zero`)}, () => withApp(async (app) => {`,
    '  const res = await app.get(SUMMARY)',
    '  assert.equal(res.status, 200)',
    `  assert.deepStrictEqual(res.body, ${JSON.stringify(zeros)})`,
    '}))',
    '',
  ].join('\n')
}

/**
 * A state-machine criterion ("PATCH /api/tasks/:id moves a task; allowed moves are ...; any other move is rejected with 409, an unknown status value with 400, an unknown id with 404")
 * is generated from the contract: every allowed move is made from a task walked to its source status along allowed moves, every other pair of statuses must answer the rejection
 * status, an unknown status value and an unknown id answer their statuses. The model-written version kept assuming a move the contract forbids (for example done -> todo).
 * Null when the contract does not carry what is needed.
 */
export function generateTransitionTests(id: number, c: ImplementationContract): string | null {
  const strip = (r: string) => r.replace(/^(?:GET|POST|PUT|PATCH|DELETE)\s+/, '')
  const move = c.routes.find((r) => r.criterion === id && r.method === 'PATCH' && r.bodyField && r.params.length === 1)
  const create = c.routes.find((r) => r.createsRecord)
  if (!move || !create) return null
  const edges = c.transitions.filter((t) => t.allowed)
  if (!edges.length) return null
  const field = c.fields.find((f) => f.name === move.bodyField)
  const states = [...new Set([...(field?.values ?? []), ...edges.flatMap((t) => [t.from, t.to])])]
  const initial = field?.default && states.includes(field.default) ? field.default : states.find((k) => !edges.some((t) => t.to === k))
  if (!initial) return null
  const reach: Record<string, string[]> = {}
  { const prev: Map<string, string | null> = new Map([[initial, null]]); const queue: string[] = [initial]
    while (queue.length) { const cur = queue.shift()!; for (const t of edges.filter((e) => e.from === cur)) if (!prev.has(t.to)) { prev.set(t.to, cur); queue.push(t.to) } }
    for (const k of states) { if (!prev.has(k)) continue; const path: string[] = []; let at: string | null = k; while (at && at !== initial) { path.unshift(at); at = prev.get(at) ?? null } reach[k] = path } }
  const allowed = edges.map((t) => [t.from, t.to]).filter(([f]) => reach[f])
  const rejected: string[][] = []
  for (const f of states) for (const t of states) if (f !== t && reach[f] && !edges.some((e) => e.from === f && e.to === t)) rejected.push([f, t])
  const code = (n: number) => move.statuses.includes(n)
  const textField = c.fields.find((f) => f.required && !f.values.length)?.name
  const extra = c.fields.filter((f) => f.required && f.values.length && f.name !== move.bodyField).map((f) => `${JSON.stringify(f.name)}: ${JSON.stringify(f.values[0])}`)
  const bodyJs = textField || extra.length ? `{ ${[textField ? `${JSON.stringify(textField)}: 'item ' + Date.now()` : '', ...extra].filter(Boolean).join(', ')} }` : '{}'
  const movePath = "'" + strip(move.path).replace(/:\w+/, "' + id + '") + "'"
  const bf = JSON.stringify(move.bodyField)
  const lines: string[] = [
    "import test from 'node:test'",
    "import assert from 'node:assert/strict'",
    "import { withApp } from './support/harness.mjs'",
    '',
    `const CREATE = ${JSON.stringify(strip(create.path))}`,
    `const ROUTE = ${JSON.stringify(reach)}`,
    `const ALLOWED = ${JSON.stringify(allowed)}`,
    `const REJECTED = ${JSON.stringify(rejected)}`,
    `const moveTo = (id) => ${movePath}`,
    '',
    'async function taskAt(app, state) {',
    `  const created = await app.post(CREATE, ${bodyJs})`,
    "  assert.ok(created.status >= 200 && created.status < 300, 'create answered ' + created.status)",
    '  const id = created.body.id',
    '  for (const step of ROUTE[state]) {',
    `    const r = await app.patch(moveTo(id), { ${bf}: step })`,
    "    assert.ok(r.status >= 200 && r.status < 300, 'moving to ' + step + ' answered ' + r.status)",
    '  }',
    '  return id',
    '}',
    '',
    `test(${JSON.stringify(`[C${id}] MOVES_ALLOWED: every allowed move works`)}, () => withApp(async (app) => {`,
    '  for (const [from, to] of ALLOWED) {',
    '    const id = await taskAt(app, from)',
    `    const r = await app.patch(moveTo(id), { ${bf}: to })`,
    "    assert.equal(r.status, 200, from + ' -> ' + to)",
    `    assert.equal(r.body[${bf}], to)`,
    '  }',
    '}))', '',
  ]
  if (rejected.length && code(409)) lines.push(
    `test(${JSON.stringify(`[C${id}] MOVES_REJECTED: every other move is rejected with 409`)}, () => withApp(async (app) => {`,
    '  for (const [from, to] of REJECTED) {',
    '    const id = await taskAt(app, from)',
    `    const r = await app.patch(moveTo(id), { ${bf}: to })`,
    "    assert.equal(r.status, 409, from + ' -> ' + to)",
    '  }',
    '}))', '')
  if (code(400)) lines.push(
    `test(${JSON.stringify(`[C${id}] STATUS_UNKNOWN: an unknown value is rejected with 400`)}, () => withApp(async (app) => {`,
    `  const id = await taskAt(app, ${JSON.stringify(initial)})`,
    `  const r = await app.patch(moveTo(id), { ${bf}: 'no-such-value' })`,
    '  assert.equal(r.status, 400)',
    '}))', '')
  if (code(404)) lines.push(
    `test(${JSON.stringify(`[C${id}] ID_UNKNOWN: an unknown id answers 404`)}, () => withApp(async (app) => {`,
    `  const r = await app.patch(moveTo(999999), { ${bf}: ${JSON.stringify(edges[0].to)} })`,
    '  assert.equal(r.status, 404)',
    '}))', '')
  return lines.join('\n')
}

export function buildTestPlan(acceptance: string[], packageJson: string | null): TestPlan | null {
  const entry = startEntry(packageJson)
  if (!entry) return null
  const vars = storageEnvVars(acceptance)
  const full = deriveImplementationContract(acceptance)
  const generated: Record<number, string> = {}
  const tests: PlannedTest[] = acceptance.map((a, i) => {
    const id = i + 1
    const http = ROUTE.test(a)
    if (!http && META.test(a)) return { criterion_id: id, behavior: a, level: 'NOT_IN_SUITE', preconditions: 'n/a', action: 'n/a', expected_result: 'n/a', state_requirements: [], isolation_requirements: [], priority: 'COVERED_ELSEWHERE', source: 'acceptance-contract', covered_by: 'this contract test suite existing, grounded and passing' } as PlannedTest
    if (!http && UI.test(a)) return { criterion_id: id, behavior: a, level: 'NOT_IN_SUITE', preconditions: 'n/a', action: 'n/a', expected_result: 'n/a', state_requirements: [], isolation_requirements: [], priority: 'COVERED_ELSEWHERE', source: 'acceptance-contract', covered_by: 'the independent verifier (page and browser-script checks)' } as PlannedTest
    const persists = /\b(persist|restart|survive|disk)\w*/i.test(a)
    const envNamed = vars.filter((v) => a.includes(v))
    const defaultPath = /default:?\s*([\w./-]+\.\w+)/i.exec(a)?.[1]
    const recipe = envNamed.length ? `STORAGE LOCATION RECIPE: create data through the API, then assert.ok(existsSync(app.storageFile('${envNamed[0]}'))) (import { existsSync } from 'node:fs'). app.storageFile(VAR) is a path inside a temp directory and its file NAME is not the default name, so never assert anything about the name${defaultPath ? `. For the default location use withApp(async (app) => { ...create data through the API...; assert.ok(existsSync(app.cwd + '/${defaultPath}')) }, { defaultStorage: true })` : ''}` : ''
    const gen = generateFilterTests(id, full) ?? generateCounterTests(id, full) ?? generateTransitionTests(id, full)
    if (gen) generated[id] = gen
    const variants = [...variantsOf(a, envNamed[0], defaultPath, persists), ...(gen ? [] : filterVariantsOf(id, full))]
    const state = [...(persists ? ['the data must be on disk: call app.restart() and read it back'] : []), ...envNamed.map((v) => `storage location comes from ${v}`)]
    return {
      criterion_id: id, behavior: a, level: 'HTTP',
      preconditions: persists ? 'a fresh server with an empty data directory' : 'a fresh server with an empty data directory (create what the request needs through the API first)',
      action: `${persists ? 'create data through the API, app.restart(), read it back through the API' : 'send the HTTP request(s) the criterion names'}${recipe ? `. ${recipe}` : ''}`,
      ...(clausesOf(a).length ? { clauses: clausesOf(a) } : {}),
      ...(variants.length ? { variants } : {}),
      expected_result: 'exactly what the criterion states (status codes, named fields and values, counts); nothing else',
      state_requirements: state,
      isolation_requirements: ['own server process', 'own port', 'own empty data directory (withApp)', ...envNamed.map((v) => `${v} points at a file inside that directory`)],
      priority: 'REQUIRED', source: 'acceptance-contract',
    } as PlannedTest
  })
  const required = tests.filter((t) => t.priority === 'REQUIRED')
  if (!required.length) return null
  const files: TestPlan['files'] = []
  const modelRows = required.filter((t) => !generated[t.criterion_id])
  for (let i = 0; i < modelRows.length; i += MAX_CRITERIA_PER_FILE) {
    const group = modelRows.slice(i, i + MAX_CRITERIA_PER_FILE)
    const p = `test/contract.api-${files.length + 1}.test.mjs`
    files.push({ path: p, criteria: group.map((t) => t.criterion_id) })
    for (const t of group) t.file = p
  }
  // each generated criterion is its own file (one set of helpers per file)
  for (const t of required.filter((x) => generated[x.criterion_id])) { const gp = `test/contract.generated-c${t.criterion_id}.test.mjs`; files.push({ path: gp, criteria: [t.criterion_id], generated: generated[t.criterion_id] }); t.file = gp }
  return { entry, storageVars: vars, harnessPath: HARNESS_PATH, tests, files }
}

/** The harness is generated, never model-written. Deterministic text, so it can be hashed and compared. */
export function harnessSource(entry: string, storageVars: string[]): string {
  return `// Foundry-owned test harness (generated; do not edit). withApp() starts the real server as a FRESH process on its own port with its own EMPTY data directory,
// so tests cannot share state and the order of tests cannot change a result.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const ENTRY = path.join(root, ${JSON.stringify(entry)})
const STORAGE_VARS = ${JSON.stringify(storageVars)}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function boot(dataDir, cwd, useStorageVars, extraEnv) {
  let lastError = 'HARNESS_SERVER_NOT_READY'
  for (let tries = 0; tries < 3; tries++) {
    const port = 21000 + Math.floor(Math.random() * 15000)
    const env = { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), ...(useStorageVars ? Object.fromEntries(STORAGE_VARS.map((v) => [v, path.join(dataDir, v + '.json')])) : {}), ...extraEnv }
    const child = spawn(process.execPath, [ENTRY], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (d) => { out += d }); child.stderr.on('data', (d) => { out += d })
    const base = 'http://127.0.0.1:' + port
    for (let i = 0; i < 80 && child.exitCode === null; i++) {
      try { await fetch(base + '/', { signal: AbortSignal.timeout(300) }); return { child, base } } catch { await sleep(100) }
    }
    lastError = (child.exitCode !== null ? 'HARNESS_SERVER_EXITED: ' : 'HARNESS_SERVER_NOT_READY: ') + out.slice(-300)
    if (child.exitCode === null) child.kill('SIGKILL')
    if (!/EADDRINUSE/.test(out)) break
  }
  throw new Error(lastError)
}
const stop = (c) => new Promise((resolve) => { if (c.exitCode !== null) return resolve(); c.once('exit', () => resolve()); c.kill('SIGTERM'); setTimeout(() => c.kill('SIGKILL'), 1500) })

/**
 * withApp(async (app) => { ... }, opts?)
 *   app.get(path) / app.post(path, body) / app.put(path, body) / app.patch(path, body) / app.del(path)  ->  { status, body, text }   (body is the parsed JSON or null)
 *   app.restart()                  stop the server and start a NEW process on the SAME data directory (proves persistence)
 *   app.storageFile(VARIABLE)      the data file path the server was given for that storage environment variable
 *   opts.defaultStorage = true     start WITHOUT the storage variables inside a private working directory: app.cwd is where the default data path is created
 */
export async function withApp(fn, opts = {}) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'wr-app-'))
  const cwd = opts.defaultStorage ? dataDir : root
  let current = await boot(dataDir, cwd, !opts.defaultStorage, opts.env ?? {})
  const request = async (method, p, body) => {
    const res = await fetch(current.base + p, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) })
    const text = await res.text()
    let parsed = null
    try { parsed = JSON.parse(text) } catch { parsed = null }
    return { status: res.status, body: parsed, text }
  }
  const app = {
    dataDir, cwd,
    get: (p) => request('GET', p), post: (p, b) => request('POST', p, b ?? {}), put: (p, b) => request('PUT', p, b ?? {}), patch: (p, b) => request('PATCH', p, b ?? {}), del: (p) => request('DELETE', p),
    storageFile: (v) => path.join(dataDir, v + '.json'),
    restart: async () => { await stop(current.child); current = await boot(dataDir, cwd, !opts.defaultStorage, opts.env ?? {}) },
  }
  try { return await fn(app) } finally { await stop(current.child); rmSync(dataDir, { recursive: true, force: true }) }
}
`
}

/** The writer's instructions for ONE planned test file: only the criteria assigned to it, the harness API, one worked example. */
export function planPromptFor(plan: TestPlan, file: string): string {
  const rows = plan.tests.filter((t) => t.file === file)
  const elsewhere = plan.tests.filter((t) => t.priority === 'COVERED_ELSEWHERE')
  return [
    `APPROVED TEST PLAN FOR ${file} (implement exactly these tests; invent no behaviour that is not in a row):`,
    ...rows.map((t) => `  [C${t.criterion_id}] ${t.behavior}${t.variants?.length ? `\n     VARIANTS (write EXACTLY one separate, independent test per variant; each name is "[C${t.criterion_id}] <KEY>: <a short description in your own words, under 60 characters, NOT the recipe text>"; a test proves ONLY its own variant and never mixes two): ${t.variants.map((v) => `${v.key} -> ${v.recipe.replace(/\[C#\]/g, `[C${t.criterion_id}]`)}`).join(' || ')}` : ''}${t.clauses?.length ? `\n     CLAUSES (write ONE separate test per clause, each named [C${t.criterion_id}] followed by the clause words; each test asserts only that clause's status and nothing from the other clauses): ${t.clauses.map((c, k) => `(${k + 1}) ${c}`).join(' | ')}` : ''}\n     preconditions: ${t.preconditions}\n     action: ${t.action}\n     expected: ${t.expected_result}${t.state_requirements.length ? `\n     state: ${t.state_requirements.join('; ')}` : ''}`),
    elsewhere.length ? `NOT TESTED IN THIS FILE (covered elsewhere, do not write tests for them): ${elsewhere.map((t) => `[C${t.criterion_id}] ${t.covered_by}`).join('; ')}` : '',
    `KEEP SETUP SHORT: a test needs at most a handful of requests. When it needs many items, create them in a for loop (for (let i = 0; i < 5; i++) await app.post(path, { title: 't' + i })); never write one statement per item.`,
    `HOW TO WRITE THEM: every test talks to the real server through the harness. Do NOT import anything from ../src or ../server; do NOT create files, temp paths or ports yourself; do NOT keep state in variables outside a test. Every test starts its own fresh server with withApp, so tests are independent by construction.`,
    `TEST NAMES: "[C<n>] <short behaviour label>", at most 60 characters after the tag, e.g. "[C<n>] list filters by state" or "[C<n>] unread count". NEVER copy the criterion text into a test name; the tag already links the test to its criterion.`,
    `HARNESS API (import { withApp } from './support/harness.mjs'):`,
    `  await withApp(async (app) => { ... })  -> app.get(path) | app.post(path, body) | app.put(path, body) | app.patch(path, body) | app.del(path) each return { status, body, text } (body = parsed JSON or null)`,
    `  app.restart() restarts the server on the SAME data (persistence); app.storageFile(VARIABLE) is the data file path; withApp(fn, { defaultStorage: true }) runs without the storage variables in a private working directory (app.cwd).`,
    `EXAMPLE (shape only):\nimport test from 'node:test'\nimport assert from 'node:assert'\nimport { withApp } from './support/harness.mjs'\n\ntest('[C${rows[0]?.criterion_id ?? 1}] <behavior from the plan>', () => withApp(async (app) => {\n  const r = await app.post('/api/things', { name: 'a' })\n  assert.strictEqual(r.status, 201)\n  assert.strictEqual(r.body.name, 'a')\n}))`,
    `STATE RULE: before the request a test is about, bring the data to the state it needs using ONLY requests the contract allows (for a state machine, walk the allowed moves one step at a time from the initial state; never jump straight to a state, and never assume a state you did not create in that same test). A request the contract forbids is the thing being tested, never the way to get ready.\n    RULES: name each test starting with [C<number>] of the single plan row it proves; cover EVERY row above with at least one test; at most two tests per row (a row with VARIANTS: exactly one test per variant); assert only what the row's criterion states (status codes, named fields and values, counts) and never exact error wording, id values (beyond numeric/increasing), ordering of unrelated fields or timing; no test.skip, test.todo or .only; every test must contain a real assertion about the response; at most about ${40 + 25 * rows.length + 18 * rows.reduce((n, r) => n + (r.variants?.length ?? 0), 0)} lines in total.`,
  ].filter(Boolean).join('\n')
}

/** Hard limit for a contract test name (tag and variant key included). Longer names are rewritten before the review; the test body is never touched. */
export const TEST_NAME_LIMIT = 80
export type NameRewrite = { file: string; criterion: number; from: string; to: string }
const shortLabel = (rest: string, room: number): string => {
  const clause = rest.replace(/\s+/g, ' ').trim().split(/\s*(?:;|:\s|\s[-\u2013\u2014]\s|\.\s)/)[0] ?? ''
  let out = clause
  if (out.length > room) { out = out.slice(0, room); const sp = out.lastIndexOf(' '); if (sp > room * 0.5) out = out.slice(0, sp) }
  return out.replace(/[\s,;:(\-]+$/, '').replace(/['"`\\]/g, '')
}
/** Deterministic NAME-only rewrite: "[C<n>] <KEY>: <criterion text...>" becomes "[C<n>] <KEY>: <short label>" when the name exceeds TEST_NAME_LIMIT. The criterion stays traceable through its tag; assertions and body are byte-identical. */
export function normalizeTestNames(rel: string, text: string): { content: string; rewrites: NameRewrite[] } {
  const calls = testCalls(rel, text), rewrites: NameRewrite[] = [], edits: { from: number; to: number; value: string }[] = []
  const used = new Set(calls.filter((c) => c.name.length <= TEST_NAME_LIMIT).map((c) => c.name))
  for (const c of calls) {
    if (c.name.length <= TEST_NAME_LIMIT) continue
    const tag = /^\s*(\[C(\d{1,2})\])\s*((?:CUSTOM_PATH|DEFAULT_PATH|PERSISTENCE|IDS)\s*:)?\s*/.exec(c.name)
    if (!tag) continue
    const head = `${tag[1]} ${tag[3] ? tag[3].replace(/\s+/g, '') + ' ' : ''}`
    const label = shortLabel(c.name.slice(tag[0].length), TEST_NAME_LIMIT - head.length) || 'contract behaviour'
    let name = head + label, n = 2
    while (used.has(name)) name = `${head}${label.slice(0, TEST_NAME_LIMIT - head.length - 3)} #${n++}`
    used.add(name)
    const m = /^\s*(?:test|it)(?:\.\w+)?\s*\(\s*(['"`])/.exec(c.text)
    if (!m) continue
    const q = m[1], open = c.start + m[0].length - 1
    let i = open + 1
    while (i < text.length && text[i] !== q) i += text[i] === '\\' ? 2 : 1
    if (i >= text.length) continue
    edits.push({ from: open + 1, to: i, value: name })
    rewrites.push({ file: rel, criterion: Number(tag[2]), from: c.name, to: name })
  }
  let content = text
  for (const e of edits.sort((a, b) => b.from - a.from)) content = content.slice(0, e.from) + e.value + content.slice(e.to)
  return { content, rewrites }
}

export type ReviewFinding = { code: string; detail: string }
/** Deterministic pre-execution review of a generated test file against its plan rows. Empty = the file may run. */
export function reviewTestFile(rel: string, text: string, plan: TestPlan): ReviewFinding[] {
  const rows = plan.tests.filter((t) => t.file === rel)
  const assigned = new Set(rows.map((t) => t.criterion_id))
  const out: ReviewFinding[] = []
  const calls = testCalls(rel, text)
  if (!calls.length) return [{ code: 'NO_TESTS', detail: 'the file defines no test(...) cases' }]
  if (!/from\s+['"]\.\/support\/harness\.mjs['"]/.test(text)) out.push({ code: 'NO_HARNESS', detail: "the tests must import { withApp } from './support/harness.mjs' and run every test inside withApp" })
  if (/from\s+['"]\.\.?\/(?:\.\.\/)?(?:src|server|public)\b/.test(text) || /import\s*\(\s*['"]\.\.\//.test(text)) out.push({ code: 'IMPORTS_IMPLEMENTATION', detail: 'contract tests must reach the implementation only through the harness (HTTP); remove imports from ../src or ../server' })
  if (/\b(?:tmpdir|mkdtemp\w*|writeFileSync|writeFile|unlinkSync|rmSync|createServer)\b|['"]\/tmp\//.test(text)) out.push({ code: 'OWN_FILES_OR_SERVER', detail: 'tests must not create files, temp paths or servers themselves; the harness owns the data directory (use app.storageFile(VARIABLE) and app.restart())' })
  if (/\bprocess\.env\.\w+\s*=/.test(text)) out.push({ code: 'MUTATES_ENV', detail: 'tests must not change process.env; pass settings through withApp options' })
  if (/^(?:let|var)\s/m.test(text)) out.push({ code: 'SHARED_STATE', detail: 'module-level mutable variables can leak state between tests; keep every value inside its own test' })
  if (/\b(?:test|it)\.(?:skip|todo|only)\b|\{\s*(?:skip|todo)\s*:\s*(?:true|['"])/.test(text)) out.push({ code: 'SKIPPED_TEST', detail: 'test.skip, test.todo and .only are not allowed' })
  for (const c of calls) {
    if (!/\bwithApp\s*\(/.test(c.text)) out.push({ code: 'NO_WITHAPP', detail: `"${c.name.slice(0, 60)}" does not run inside withApp` })
    const asserts = c.text.match(/\bassert(?:\.\w+)?\s*\(/g) ?? []
    if (!asserts.length) out.push({ code: 'NO_ASSERTION', detail: `"${c.name.slice(0, 60)}" asserts nothing` })
    if (/assert(?:\.ok|\.equal|\.strictEqual)?\s*\(\s*(?:true|1)\s*(?:,\s*(?:true|1)\s*)?[,)]/.test(c.text) && asserts.length <= 1) out.push({ code: 'TRIVIAL_ASSERTION', detail: `"${c.name.slice(0, 60)}" only makes a trivial assertion` })
    for (const m of c.text.matchAll(/\bapp\.(?:get|post|patch|put|delete)\s*\(\s*(['"`])((?:(?!\1)[^\\])*)\1/g)) {
      const lit = m[2].replace(/\$\{[^}]*\}/g, '')
      if (/\/:[A-Za-z_]\w*|<[A-Za-z_]\w*>|\{[A-Za-z_]\w*\}/.test(lit)) { out.push({ code: 'PLACEHOLDER_PATH', detail: `"${c.name.slice(0, 60)}" requests the template path ${m[2].slice(0, 60)}; a real request needs the real id (create the item first and use \`/api/.../\${created.body.id}/...\`)` }); break }
    }
    const tag = /\[C(\d{1,2})\]/.exec(c.name)
    if (!tag) out.push({ code: 'UNTAGGED', detail: `"${c.name.slice(0, 60)}" is not named with [C<number>]` })
    else if (!assigned.has(Number(tag[1]))) out.push({ code: 'FOREIGN_CRITERION', detail: `"${c.name.slice(0, 60)}" proves C${tag[1]}, which is not assigned to ${rel} (assigned: ${[...assigned].map((n) => 'C' + n).join(', ')})` })
  }
  const tagged = new Set(calls.map((c) => Number(/\[C(\d{1,2})\]/.exec(c.name)?.[1])).filter(Boolean))
  for (const c of calls) if (c.name.length > 140) out.push({ code: 'NAME_TOO_LONG', detail: `"${c.name.slice(0, 50)}..." has a ${c.name.length}-character name; name the test with a short description (under 60 characters), never the recipe text` })
  for (const row of rows) for (const v of row.variants ?? []) {
    const mine = calls.filter((c) => new RegExp(`\\[C${row.criterion_id}\\]\\s*${v.key}\\b`).test(c.name))
    if (!mine.length) { out.push({ code: 'MISSING_VARIANT', detail: `[C${row.criterion_id}] needs a separate test named "[C${row.criterion_id}] ${v.key}: ..." (${v.recipe.slice(0, 160)})` }); continue }
    for (const c of mine) {
      const t = c.text
      if (v.key === 'CUSTOM_PATH' && (/defaultStorage/.test(t) || /\bapp\.cwd\b/.test(t))) out.push({ code: 'VARIANT_MIXES_MODES', detail: `"${c.name.slice(0, 60)}" is the CUSTOM_PATH test and must not use defaultStorage or the default path` })
      if (v.key === 'CUSTOM_PATH' && !/storageFile\s*\(/.test(t)) out.push({ code: 'VARIANT_MISSING_ASSERT', detail: `"${c.name.slice(0, 60)}" must assert existsSync(app.storageFile(VARIABLE))` })
      if (v.key === 'DEFAULT_PATH' && (/storageFile\s*\(/.test(t) || !/defaultStorage\s*:\s*true/.test(t))) out.push({ code: 'VARIANT_MIXES_MODES', detail: `"${c.name.slice(0, 60)}" is the DEFAULT_PATH test: use { defaultStorage: true } and never app.storageFile` })
      if (v.key === 'DEFAULT_PATH' && !/app\.cwd/.test(t)) out.push({ code: 'VARIANT_MISSING_ASSERT', detail: `"${c.name.slice(0, 60)}" must assert existsSync(app.cwd + '/<default path>')` })
      if ((v.key === 'PERSISTENCE' || v.key === 'IDS') && !/app\.restart\s*\(/.test(t)) out.push({ code: 'VARIANT_MISSING_ASSERT', detail: `"${c.name.slice(0, 60)}" must call await app.restart() and read the data back through the API` })
      if (v.key === 'IDS' && !/\.id\b/.test(t)) out.push({ code: 'VARIANT_MISSING_ASSERT', detail: `"${c.name.slice(0, 60)}" must compare ids returned by the API before and after the restart` })
    }
  }
  for (const n of assigned) if (!tagged.has(n)) out.push({ code: 'MISSING_COVERAGE', detail: `no test proves [C${n}] (${plan.tests.find((t) => t.criterion_id === n)?.behavior.slice(0, 90)})` })
  return out
}
export const reviewProblem = (f: ReviewFinding[]): string | null => f.length ? `${f.slice(0, 6).map((x) => `${x.code}: ${x.detail}`).join('; ')}. Fix exactly these and keep every other test as it is.` : null

/** Prompt for the (separate, local) reviewer model. It judges against the plan only; it never writes code. */
export function reviewerPrompt(plan: TestPlan, file: string, text: string): string {
  const rows = plan.tests.filter((t) => t.file === file)
  return [
    `You review ONE generated test file against its approved plan. You do not write code.`,
    `PLAN ROWS:\n${rows.map((t) => `[C${t.criterion_id}] ${t.behavior}`).join('\n')}`,
    `TEST FILE ${file}:\n\`\`\`\n${text.slice(0, 6000)}\n\`\`\``,
    `Check: (1) every test asserts only what its plan row states (no invented semantics, no exact error wording, no assumed field names the row does not name); (2) no assertion is weaker than the row (a status code the row names must be asserted); (3) nothing the row requires is missing; (4) each test is independent. Reply with ONLY this JSON: {"verdict":"OK"} or {"verdict":"REVISE","problems":["<one concrete, quotable problem per item>"]}. Report only problems you can point to in the file; if unsure, answer OK.`,
  ].join('\n\n')
}
export function parseReviewerVerdict(text: string): { verdict: 'OK' | 'REVISE'; problems: string[] } | null {
  const m = /\{[\s\S]*\}/.exec(text); if (!m) return null
  try { const j = JSON.parse(m[0]) as { verdict?: string; problems?: unknown }; if (j.verdict === 'OK') return { verdict: 'OK', problems: [] }; if (j.verdict === 'REVISE' && Array.isArray(j.problems)) return { verdict: 'REVISE', problems: j.problems.filter((p): p is string => typeof p === 'string').slice(0, 4) } } catch { /* fall through */ }
  return null
}

export type DefectKind = 'IMPLEMENTATION_DEFECT' | 'TEST_DEFECT' | 'AMBIGUOUS' | 'ENVIRONMENT_DEFECT'
export type DefectVerdict = { kind: DefectKind; basis: string }
const ENV_FAILURE = /HARNESS_SERVER_(?:EXITED|NOT_READY)|EADDRINUSE|ECONNREFUSED|ECONNRESET|spawn \S+ ENOENT|ENOSPC|EMFILE|timed? ?out|AbortError|The operation was aborted/i
/**
 * Whose fault is a failing generated test? Evidence order: the harness/environment first; then the independent verifier (it is ground truth for the implementation);
 * then traceability (an ungrounded test has no contract basis); then whether the assertion demonstrably contradicts the contract text.
 */
export function classifyTestDefect(i: { verifierPassed: boolean; grounded: boolean; message: string; contradictsContract: boolean }): DefectVerdict {
  if (ENV_FAILURE.test(i.message)) return { kind: 'ENVIRONMENT_DEFECT', basis: 'the failure is a server start/connection/timing problem of the isolated run, not an assertion about behavior' }
  if (!i.verifierPassed) return { kind: 'IMPLEMENTATION_DEFECT', basis: 'the independent verifier does not pass: the implementation is not yet ground truth' }
  if (!i.grounded) return { kind: 'TEST_DEFECT', basis: 'the independent verifier passes and the test traces to no acceptance criterion' }
  if (i.contradictsContract) return { kind: 'TEST_DEFECT', basis: 'the independent verifier passes and the assertion contradicts the criterion it claims to prove' }
  return { kind: 'AMBIGUOUS', basis: 'the independent verifier passes and the test is grounded, but nothing in the contract text shows which side is wrong' }
}

/** Required coverage after the run: every REQUIRED criterion has at least one grounded test in the final suite. */
export function uncoveredCriteria(plan: TestPlan, files: Record<string, string>, acceptance: string[]): number[] {
  const covered = new Set<number>()
  for (const f of plan.files) { const text = files[f.path]; if (!text) continue; for (const g of groundTests(f.path, text, acceptance, 'plan')) if (g.confidence === 'TAGGED' && g.criterion_id && plan.tests.find((t) => t.criterion_id === g.criterion_id)?.file === f.path) covered.add(g.criterion_id) }
  // a criterion with variants is covered only when EVERY variant has its own grounded test
  const variantMissing = (t: PlannedTest) => (t.variants ?? []).some((v) => { const text = t.file ? files[t.file] : ''; return !text || !groundTests(t.file!, text, acceptance, 'plan').some((g) => g.confidence === 'TAGGED' && g.criterion_id === t.criterion_id && new RegExp(`\\[C${t.criterion_id}\\]\\s*${v.key}\\b`).test(g.name)) })
  return plan.tests.filter((t) => t.priority === 'REQUIRED' && (!covered.has(t.criterion_id) || variantMissing(t))).map((t) => t.criterion_id)
}

/** Pre-execution rejection of tests that trace to no criterion: they are removed BEFORE they run (recorded, never silent). Null when nothing is ungrounded or no grounded test would remain. */
export function dropUngrounded(rel: string, text: string, acceptance: string[]): { content: string; names: string[] } | null {
  const calls = testCalls(rel, text)
  const g = groundTests(rel, text, acceptance, 'plan')
  const bad = calls.filter((c) => g.some((x) => x.name === c.name && x.confidence === 'NONE'))
  if (!bad.length || calls.length - bad.length < 1) return null
  let out = text
  for (const c of [...bad].sort((a, b) => b.start - a.start)) out = out.slice(0, c.start) + `// REJECTED BEFORE EXECUTION (maps to no acceptance criterion): ${c.name}` + out.slice(c.end)
  return { content: out, names: bad.map((c) => c.name) }
}
export const REVIEWER_SYSTEM = 'You are Foundry\'s test reviewer. You judge generated tests against an approved plan and reply with one JSON object only.'

/**
 * IMPLEMENTATION_DEFECT repair (deterministic, bounded to the one declaration): the contract says the data file defaults to a path "under the working directory",
 * but the module anchors the default to its OWN directory (__dirname / import.meta.url), which puts the file outside the workspace, and the folder may not exist.
 * Rewrites only `process.env.VAR || <module-anchored expr>` to a cwd-anchored path and makes sure the folder exists. Null when the pattern is not present
 * (the file already honours the contract, or the shape is not recognised: nothing is guessed).
 */
export function repairDefaultStoragePath(src: string, envVar: string, defaultPath: string): { content: string; note: string } | null {
  if (/^\/|\.\.|[\\]/.test(defaultPath.replace(/^\.?\//, ''))) return null
  const esc = envVar.replace(/[^A-Z0-9_]/g, '')
  const re = new RegExp(`(\\b(?:const|let|var)\\s+(\\w+)\\s*=\\s*)process\\.env\\.${esc}(\\s*(?:\\|\\||\\?\\?)\\s*)([^\\n;]+)`)
  const m = re.exec(src)
  if (!m) return null
  const anchored = /__dirname|__filename|import\.meta/.test(m[4]) || /(?:join|resolve)\([^)]*\.\.[/\\]/.test(m[4])
  if (!anchored) return null
  if (!/^\s*import\s/m.test(src)) return null
  if (!/^\s*import\s/m.test(src)) return null
  const name = m[2]
  const fixed = `${m[1]}process.env.${esc}${m[3]}process.cwd() + ${JSON.stringify('/' + defaultPath.replace(/^\.?\//, ''))}`
  let out = src.slice(0, m.index) + fixed + src.slice(m.index + m[0].length)
  const after = out.indexOf('\n', m.index + fixed.length)
  const ensure = `\ntry { (await import('node:fs')).mkdirSync(String(${name}).replace(/[\\\\/][^\\\\/]*$/, ''), { recursive: true }) } catch { /* the folder is created on first write otherwise */ }`
  out = out.slice(0, after < 0 ? out.length : after) + ensure + out.slice(after < 0 ? out.length : after)
  return { content: out, note: `default ${esc} path anchored to the module directory -> process.cwd() + /${defaultPath}` }
}

/**
 * IMPLEMENTATION_DEFECT repair #2 (deterministic, fail closed): the default storage path is already cwd-based and equals the contract's path, but nothing ever creates its parent folder,
 * so the first write fails. Adds ONE guarded `mkdirSync(<parent of the default path>, { recursive: true })` that runs only when the env override is NOT set.
 * The chosen path is never touched. Null when: the declaration is not recognised, the default is not cwd-anchored, its literals do not resolve to the contract's path,
 * the parent cannot be derived (no folder, `..`, absolute), or the file already creates folders anywhere (ambiguous: nothing is guessed).
 */
export function repairMissingStorageDir(src: string, envVar: string, defaultPath: string): { content: string; note: string } | null {
  const esc = envVar.replace(/[^A-Z0-9_]/g, '')
  const want = defaultPath.replace(/^\.?\//, '')
  if (!esc || !want || /^\/|\.\.|[\\]/.test(want) || !want.includes('/')) return null
  if (/\bmkdir(?:Sync|p)?\s*\(/.test(src) || !/^\s*import\s/m.test(src)) return null
  const re = new RegExp(`\\b(?:const|let|var)\\s+\\w+\\s*=\\s*process\\.env\\.${esc}\\s*(?:\\|\\||\\?\\?)\\s*([^\\n;]+)`)
  const m = re.exec(src)
  if (!m) return null
  const expr = m[1]
  if (!/process\.cwd\(\)/.test(expr) || /__dirname|__filename|import\.meta|\.\./.test(expr)) return null
  const lits = [...expr.matchAll(/(['"`])([^'"`$]*)\1/g)].map((x) => x[2].replace(/^\/+|\/+$/g, '')).filter(Boolean)
  if (lits.join('/') !== want || /[`$]/.test(expr)) return null
  const parent = want.slice(0, want.lastIndexOf('/'))
  const lineEnd = src.indexOf('\n', m.index + m[0].length)
  const at = lineEnd < 0 ? src.length : lineEnd
  const ensure = `\nif (!process.env.${esc}) { try { (await import('node:fs')).mkdirSync(process.cwd() + ${JSON.stringify('/' + parent)}, { recursive: true }) } catch { /* the first write reports it */ } }`
  return { content: src.slice(0, at) + ensure + src.slice(at), note: `default ${esc} path ${want} is cwd-based but its folder ${parent}/ was never created -> mkdirSync(${parent}, recursive)` }
}

/**
 * The acceptance criteria that the FAILING checks are about (repair prompt context). A verifier prints the check name and observed values, not the expected ones; without the
 * contract sentence a repair model guesses the expectation and can flip-flop between two wrong defaults. Words are matched by overlap; at most two criteria are returned.
 */
export function criteriaForFailures(output: string, acceptance: string[]): string[] {
  const names = [...output.matchAll(/^(?:not ok \d+ - |\s*✖ )(.+)$/gm)].map((m) => m[1].replace(/\s*\(\d+(?:\.\d+)?ms\)\s*$/, ''))
  if (!names.length) return []
  const STOP = new Set(['the', 'and', 'with', 'that', 'for', 'are', 'its', 'not', 'from', 'into', 'any', 'all', 'only', 'one'])
  const words = (t: string) => new Set((t.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? []).filter((x) => !STOP.has(x)))
  const scored = new Map<number, number>()
  for (const n of names) {
    const w = words(n)
    acceptance.forEach((a, i) => { const aw = words(a); let hit = 0; for (const x of w) if (aw.has(x)) hit += 1; const score = hit / Math.sqrt(aw.size + 4); if (hit >= 3) scored.set(i, Math.max(scored.get(i) ?? 0, score)) })
  }
  return [...scored.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([i]) => acceptance[i])
}
