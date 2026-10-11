import { groundTests } from './testGrounding'
import { storageEnvVars } from './persistenceContract'
import { testCalls } from './testContract'

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
export type VariantKey = 'CUSTOM_PATH' | 'DEFAULT_PATH' | 'PERSISTENCE' | 'IDS'
export type TestPlan = {
  entry: string
  storageVars: string[]
  harnessPath: string
  tests: PlannedTest[]
  files: { path: string; criteria: number[] }[]
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

export function buildTestPlan(acceptance: string[], packageJson: string | null): TestPlan | null {
  const entry = startEntry(packageJson)
  if (!entry) return null
  const vars = storageEnvVars(acceptance)
  const tests: PlannedTest[] = acceptance.map((a, i) => {
    const id = i + 1
    const http = ROUTE.test(a)
    if (!http && META.test(a)) return { criterion_id: id, behavior: a, level: 'NOT_IN_SUITE', preconditions: 'n/a', action: 'n/a', expected_result: 'n/a', state_requirements: [], isolation_requirements: [], priority: 'COVERED_ELSEWHERE', source: 'acceptance-contract', covered_by: 'this contract test suite existing, grounded and passing' } as PlannedTest
    if (!http && UI.test(a)) return { criterion_id: id, behavior: a, level: 'NOT_IN_SUITE', preconditions: 'n/a', action: 'n/a', expected_result: 'n/a', state_requirements: [], isolation_requirements: [], priority: 'COVERED_ELSEWHERE', source: 'acceptance-contract', covered_by: 'the independent verifier (page and browser-script checks)' } as PlannedTest
    const persists = /\b(persist|restart|survive|disk)\w*/i.test(a)
    const envNamed = vars.filter((v) => a.includes(v))
    const defaultPath = /default:?\s*([\w./-]+\.\w+)/i.exec(a)?.[1]
    const recipe = envNamed.length ? `STORAGE LOCATION RECIPE: create data through the API, then assert.ok(existsSync(app.storageFile('${envNamed[0]}'))) (import { existsSync } from 'node:fs'). app.storageFile(VAR) is a path inside a temp directory and its file NAME is not the default name, so never assert anything about the name${defaultPath ? `. For the default location use withApp(async (app) => { ...create data through the API...; assert.ok(existsSync(app.cwd + '/${defaultPath}')) }, { defaultStorage: true })` : ''}` : ''
    const variants = variantsOf(a, envNamed[0], defaultPath, persists)
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
  for (let i = 0; i < required.length; i += MAX_CRITERIA_PER_FILE) {
    const group = required.slice(i, i + MAX_CRITERIA_PER_FILE)
    const p = `test/contract.api-${files.length + 1}.test.mjs`
    files.push({ path: p, criteria: group.map((t) => t.criterion_id) })
    for (const t of group) t.file = p
  }
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
    ...rows.map((t) => `  [C${t.criterion_id}] ${t.behavior}${t.variants?.length ? `\n     VARIANTS (write EXACTLY one separate, independent test per variant; each name is "[C${t.criterion_id}] <KEY>: <a short description in your own words, under 90 characters, NOT the recipe text>"; a test proves ONLY its own variant and never mixes two): ${t.variants.map((v) => `${v.key} -> ${v.recipe.replace(/\[C#\]/g, `[C${t.criterion_id}]`)}`).join(' || ')}` : ''}${t.clauses?.length ? `\n     CLAUSES (write ONE separate test per clause, each named [C${t.criterion_id}] followed by the clause words; each test asserts only that clause's status and nothing from the other clauses): ${t.clauses.map((c, k) => `(${k + 1}) ${c}`).join(' | ')}` : ''}\n     preconditions: ${t.preconditions}\n     action: ${t.action}\n     expected: ${t.expected_result}${t.state_requirements.length ? `\n     state: ${t.state_requirements.join('; ')}` : ''}`),
    elsewhere.length ? `NOT TESTED IN THIS FILE (covered elsewhere, do not write tests for them): ${elsewhere.map((t) => `[C${t.criterion_id}] ${t.covered_by}`).join('; ')}` : '',
    `HOW TO WRITE THEM: every test talks to the real server through the harness. Do NOT import anything from ../src or ../server; do NOT create files, temp paths or ports yourself; do NOT keep state in variables outside a test. Every test starts its own fresh server with withApp, so tests are independent by construction.`,
    `HARNESS API (import { withApp } from './support/harness.mjs'):`,
    `  await withApp(async (app) => { ... })  -> app.get(path) | app.post(path, body) | app.put(path, body) | app.patch(path, body) | app.del(path) each return { status, body, text } (body = parsed JSON or null)`,
    `  app.restart() restarts the server on the SAME data (persistence); app.storageFile(VARIABLE) is the data file path; withApp(fn, { defaultStorage: true }) runs without the storage variables in a private working directory (app.cwd).`,
    `EXAMPLE (shape only):\nimport test from 'node:test'\nimport assert from 'node:assert'\nimport { withApp } from './support/harness.mjs'\n\ntest('[C${rows[0]?.criterion_id ?? 1}] <behavior from the plan>', () => withApp(async (app) => {\n  const r = await app.post('/api/things', { name: 'a' })\n  assert.strictEqual(r.status, 201)\n  assert.strictEqual(r.body.name, 'a')\n}))`,
    `STATE RULE: before the request a test is about, bring the data to the state it needs using ONLY requests the contract allows (for a state machine, walk the allowed moves one step at a time from the initial state; never jump straight to a state, and never assume a state you did not create in that same test). A request the contract forbids is the thing being tested, never the way to get ready.\n    RULES: name each test starting with [C<number>] of the single plan row it proves; cover EVERY row above with at least one test; at most two tests per row (a row with VARIANTS: exactly one test per variant); assert only what the row's criterion states (status codes, named fields and values, counts) and never exact error wording, id values (beyond numeric/increasing), ordering of unrelated fields or timing; no test.skip, test.todo or .only; every test must contain a real assertion about the response; at most about ${40 + 25 * rows.length + 18 * rows.reduce((n, r) => n + (r.variants?.length ?? 0), 0)} lines in total.`,
  ].filter(Boolean).join('\n')
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
    const tag = /\[C(\d{1,2})\]/.exec(c.name)
    if (!tag) out.push({ code: 'UNTAGGED', detail: `"${c.name.slice(0, 60)}" is not named with [C<number>]` })
    else if (!assigned.has(Number(tag[1]))) out.push({ code: 'FOREIGN_CRITERION', detail: `"${c.name.slice(0, 60)}" proves C${tag[1]}, which is not assigned to ${rel} (assigned: ${[...assigned].map((n) => 'C' + n).join(', ')})` })
  }
  const tagged = new Set(calls.map((c) => Number(/\[C(\d{1,2})\]/.exec(c.name)?.[1])).filter(Boolean))
  for (const c of calls) if (c.name.length > 140) out.push({ code: 'NAME_TOO_LONG', detail: `"${c.name.slice(0, 50)}..." has a ${c.name.length}-character name; name the test with a short description (under 90 characters), never the recipe text` })
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
