/**
 * Independent verifiers for Mission 12 hard-engineering fixtures.
 * Inspect real SQLite files, Electron processes, and disk state.
 * Worker never receives these hidden oracle values.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import http from 'node:http'
import { foundryNodeExecutable } from './foundryProjectIsolation'
import { resolveRepoRoot } from '@/lib/repo/paths'
import type {
  FoundryEngineeringBenchmark,
  FoundryGraduationCriterionResult,
  FoundryGraduationHiddenOracle,
  FoundryGraduationVerificationMethod,
} from './foundryEngineeringGraduationTypes'
import type { IndependentVerifyResult } from './foundryEngineeringGraduationVerifiers'

function row(criterionId: string, required: boolean, passed: boolean, method: FoundryGraduationVerificationMethod, detail: string): FoundryGraduationCriterionResult {
  return { criterionId, required, passed, method, detail }
}

function read(projectRoot: string, rel: string): string | null {
  const abs = path.join(projectRoot, rel)
  if (!existsSync(abs) || !statSync(abs).isFile()) return null
  return readFileSync(abs, 'utf8')
}

function nodeRun(projectRoot: string, args: string[], timeoutMs = 8000): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(foundryNodeExecutable(), args, { cwd: projectRoot, encoding: 'utf8', timeout: timeoutMs })
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' }
}

async function waitPort(childStdout: Promise<string>, timeoutMs = 4000): Promise<number> {
  const text = await Promise.race([
    childStdout,
    new Promise<string>(resolve => setTimeout(() => resolve(''), timeoutMs)),
  ])
  const match = /PORT=(\d+)/.exec(text)
  return match ? Number(match[1]) : 0
}

function startServer(projectRoot: string, file: string): { proc: ReturnType<typeof spawn>; stdout: Promise<string> } {
  const proc = spawn(foundryNodeExecutable(), [file], { cwd: projectRoot, env: { ...process.env, PORT: '0' } })
  let buf = ''
  const stdout = new Promise<string>(resolve => {
    proc.stdout?.on('data', chunk => {
      buf += String(chunk)
      if (buf.includes('PORT=')) resolve(buf)
    })
    proc.on('exit', () => resolve(buf))
  })
  return { proc, stdout }
}

async function httpJson(port: number, method: string, urlPath: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  return await new Promise(resolve => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: urlPath,
      headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {},
    }, res => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        let json: unknown = null
        try { json = data ? JSON.parse(data) : null } catch { json = data }
        resolve({ status: res.statusCode ?? 0, json })
      })
    })
    req.on('error', () => resolve({ status: 0, json: null }))
    if (payload) req.write(payload)
    req.end()
  })
}

function sqliteHeader(projectRoot: string, rel: string): boolean {
  const abs = path.join(projectRoot, rel)
  if (!existsSync(abs)) return false
  const buf = readFileSync(abs)
  return buf.subarray(0, 16).toString('utf8') === 'SQLite format 3\0'
}

function foundryElectronBin(): string | null {
  const bin = path.join(resolveRepoRoot(), 'desktop/node_modules/electron/dist/electron')
  return existsSync(bin) ? bin : null
}

function countMarkedElectron(mark: string): number {
  const result = spawnSync('ps', ['-eo', 'pid,args'], { encoding: 'utf8' })
  return (result.stdout || '')
    .split('\n')
    .filter(line => line.includes(mark) && /electron/i.test(line))
    .length
}

function stopDesktop(proc: ReturnType<typeof spawn>): void {
  const pid = proc.pid
  try { proc.kill('SIGTERM') } catch { /* */ }
  if (pid) {
    try { process.kill(-pid, 'SIGTERM') } catch { /* */ }
  }
  const started = Date.now()
  while (Date.now() - started < 1500) {
    if (proc.exitCode !== null) break
    spawnSync('sleep', ['0.08'])
  }
  try { proc.kill('SIGKILL') } catch { /* */ }
  if (pid) {
    try { process.kill(-pid, 'SIGKILL') } catch { /* */ }
  }
}

async function runElectron(projectRoot: string, args: string[], mark: string, timeoutMs = 12_000): Promise<{ stdout: string; stderr: string; status: number | null }> {
  const bin = foundryElectronBin()
  if (!bin) return { stdout: '', stderr: 'ELECTRON_UNAVAILABLE', status: null }
  const env = { ...process.env, DISPLAY: process.env.DISPLAY || ':0', ELECTRON_ENABLE_LOGGING: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  const proc = spawn(bin, args, {
    cwd: projectRoot,
    env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  proc.stdout?.on('data', chunk => { stdout += String(chunk) })
  proc.stderr?.on('data', chunk => { stderr += String(chunk) })
  const done = new Promise<void>(resolve => {
    proc.on('exit', () => resolve())
    setTimeout(() => resolve(), timeoutMs)
  })
  await done
  if (proc.exitCode === null) stopDesktop(proc)
  await new Promise(resolve => setTimeout(resolve, 400))
  const orphans = countMarkedElectron(mark)
  if (orphans > 0) {
    const listed = spawnSync('ps', ['-eo', 'pid,args'], { encoding: 'utf8' })
    for (const line of (listed.stdout || '').split('\n')) {
      if (!line.includes(mark) || !/electron/i.test(line)) continue
      const pid = Number(line.trim().split(/\s+/)[0])
      if (pid) {
        try { process.kill(pid, 'SIGKILL') } catch { /* */ }
      }
    }
  }
  return { stdout, stderr, status: proc.exitCode }
}

export async function verifyHardEngineering(input: {
  benchmark: FoundryEngineeringBenchmark
  projectRoot: string
  hidden: FoundryGraduationHiddenOracle | null
}): Promise<IndependentVerifyResult | null> {
  const { benchmark, projectRoot, hidden } = input
  const methods: FoundryGraduationVerificationMethod[] = ['FILE_INSPECT']
  const notes: string[] = []
  const forbiddenShortcutHits: string[] = []
  const criteria: FoundryGraduationCriterionResult[] = []
  const id = benchmark.benchmarkId

  if (id === 'GRAD-D-FULLSTACK-V3') {
    methods.push('HTTP', 'JSON_PERSISTENCE', 'NODE_RUNTIME', 'TEST_RUNNER')
    const app = read(projectRoot, 'app.js') || ''
    const testSrc = read(projectRoot, 'app.test.mjs') || ''
    const tests = existsSync(path.join(projectRoot, 'app.test.mjs')) ? nodeRun(projectRoot, ['--test', 'app.test.mjs']) : { status: 1, stdout: '', stderr: 'missing tests' }
    if (!existsSync(path.join(projectRoot, 'server.mjs'))) {
      for (const item of benchmark.acceptanceCriteria) criteria.push(row(item.criterionId, item.required, false, 'HTTP', 'server missing'))
    } else {
      const started = startServer(projectRoot, 'server.mjs')
      try {
        const port = await waitPort(started.stdout)
        if (!port) {
          for (const item of benchmark.acceptanceCriteria) criteria.push(row(item.criterionId, item.required, false, 'HTTP', 'no port'))
        } else {
          const health = await httpJson(port, 'GET', '/health')
          const bad = await httpJson(port, 'POST', '/shifts', { slot: 'thu-am' })
          const worker = String(hidden?.values.worker ?? 'hidden-cleo')
          const slot = String(hidden?.values.slot ?? 'thu-am')
          const url = pathToFileURL(path.join(projectRoot, 'app.js')).href
          const script = `import { createRoster } from '${url}'; const desk = createRoster('http://127.0.0.1:${port}'); const listed = await desk.bookShift(${JSON.stringify(worker)}, ${JSON.stringify(slot)}); console.log(JSON.stringify({ listed, last: desk.lastBoard, err: desk.lastError }))`
          const ui = nodeRun(projectRoot, ['--input-type=module', '-e', script], 12_000)
          let parsed: { listed?: unknown; last?: Array<{ worker?: string }> } = {}
          try { parsed = JSON.parse(ui.stdout.trim().split('\n').at(-1) || '{}') } catch { notes.push(ui.stderr) }
          const listed = await httpJson(port, 'GET', '/shifts')
          const persist = (read(projectRoot, 'shifts.json') || '').includes(worker)
          const lastHas = JSON.stringify(parsed.last ?? parsed.listed ?? '').includes(worker)
          criteria.push(row('FW1', true, health.status === 200, 'HTTP', String(health.status)))
          criteria.push(row('FW2', true, bad.status === 400, 'HTTP', String(bad.status)))
          criteria.push(row('FW3', true, lastHas && persist && ui.status === 0, 'HTTP', `${lastHas}/${persist}/${ui.status}`))
          criteria.push(row('FW4', true, JSON.stringify(listed.json).includes(worker), 'HTTP', String(listed.status)))
          criteria.push(row('FW5', true, /export function createRoster/.test(app) && /fetch\(/.test(app) && /createRoster exported/.test(testSrc) && tests.status === 0, 'TEST_RUNNER', tests.stderr.slice(0, 80)))
        }
      } finally {
        started.proc.kill('SIGTERM')
      }
    }
    return { criteria, methods: [...new Set(methods)], forbiddenShortcutHits, notes, uiVerificationMethod: 'DOM_PARSE' }
  }

  if (id === 'GRAD-DA-DATABASE-V1') {
    methods.push('NODE_RUNTIME', 'TEST_RUNNER')
    const src = read(projectRoot, 'store.mjs') || ''
    if (/:memory:/.test(src)) forbiddenShortcutHits.push(':memory: only')
    if (/writeFileSync\(.*parts\.db/.test(src) && !/DatabaseSync/.test(src)) forbiddenShortcutHits.push('JSON pretending to be SQLite')
    const tests = existsSync(path.join(projectRoot, 'store.test.mjs')) ? nodeRun(projectRoot, ['--test', 'store.test.mjs'], 12_000) : { status: 1, stdout: '', stderr: 'missing tests' }
    const sku = String(hidden?.values.sku ?? 'HID-CLE')
    const qty = Number(hidden?.values.qty ?? 7)
    const url = pathToFileURL(path.join(projectRoot, 'store.mjs')).href
    const setup = nodeRun(projectRoot, ['--input-type=module', '-e', `
import { existsSync, rmSync } from 'node:fs'
import { openDb, init, add, find, setQty, remove, withTxn } from '${url}'
try { rmSync('parts.db') } catch {}
const db = openDb()
init(db)
add(db, ${JSON.stringify(sku)}, 3)
setQty(db, ${JSON.stringify(sku)}, ${qty})
const row = find(db, ${JSON.stringify(sku)})
let threw = false
try { add(db, ${JSON.stringify(sku)}, 1) } catch { threw = true }
add(db, 'tmp-del', 1)
remove(db, 'tmp-del')
const gone = find(db, 'tmp-del')
let rolled = true
try {
  withTxn(db, () => { add(db, 'tx-roll', 1); throw new Error('x') })
} catch {}
const tx = find(db, 'tx-roll')
db.close()
console.log(JSON.stringify({ qty: row && row.qty, threw, gone, tx, persist: existsSync('parts.db') }))
`], 10_000)
    let parsed: { qty?: number; threw?: boolean; gone?: unknown; tx?: unknown; persist?: boolean } = {}
    try { parsed = JSON.parse(setup.stdout.trim().split('\n').at(-1) || '{}') } catch { notes.push(setup.stderr) }
    const header = sqliteHeader(projectRoot, 'parts.db')
    const restart = nodeRun(projectRoot, ['--input-type=module', '-e', `
import { DatabaseSync } from 'node:sqlite'
const db = new DatabaseSync('parts.db')
const row = db.prepare('SELECT sku, qty FROM parts WHERE sku = ?').get(${JSON.stringify(sku)})
console.log(JSON.stringify(row || {}))
db.close()
`])
    let restarted: { sku?: string; qty?: number } = {}
    try { restarted = JSON.parse(restart.stdout.trim().split('\n').at(-1) || '{}') } catch { notes.push(restart.stderr) }
    criteria.push(row('DA1', true, header, 'FILE_INSPECT', header ? 'sqlite header' : 'not sqlite'))
    criteria.push(row('DA2', true, Number(parsed.qty) === qty && parsed.gone == null, 'NODE_RUNTIME', JSON.stringify(parsed)))
    criteria.push(row('DA3', true, parsed.threw === true, 'NODE_RUNTIME', String(parsed.threw)))
    criteria.push(row('DA4', true, parsed.tx == null, 'NODE_RUNTIME', JSON.stringify(parsed.tx)))
    criteria.push(row('DA5', true, restarted.sku === sku && Number(restarted.qty) === qty, 'NODE_RUNTIME', JSON.stringify(restarted)))
    criteria.push(row('DA6', true, tests.status === 0, 'TEST_RUNNER', tests.stderr.slice(0, 80)))
    notes.push('database-engine=node:sqlite')
    return { criteria, methods: [...new Set(methods)], forbiddenShortcutHits, notes, uiVerificationMethod: 'NODE_RUNTIME' }
  }

  if (id === 'GRAD-DA-DATABASE-V2') {
    methods.push('NODE_RUNTIME', 'TEST_RUNNER')
    const src = read(projectRoot, 'catalog.mjs') || ''
    if (/:memory:/.test(src)) forbiddenShortcutHits.push(':memory: only')
    const tests = existsSync(path.join(projectRoot, 'catalog.test.mjs')) ? nodeRun(projectRoot, ['--test', 'catalog.test.mjs'], 12_000) : { status: 1, stdout: '', stderr: 'missing tests' }
    const author = String(hidden?.values.author ?? 'hidden-nia')
    const title = String(hidden?.values.title ?? 'Hidden Codex')
    const year = Number(hidden?.values.year ?? 1998)
    const url = pathToFileURL(path.join(projectRoot, 'catalog.mjs')).href
    const setup = nodeRun(projectRoot, ['--input-type=module', '-e', `
import { rmSync } from 'node:fs'
import { openDb, init, addAuthor, addBook, booksByAuthor, migrate, setYear } from '${url}'
try { rmSync('catalog.db') } catch {}
const db = openDb()
init(db)
const a = addAuthor(db, ${JSON.stringify(author)})
addAuthor(db, 'decoy')
addBook(db, ${JSON.stringify(title)}, a.id)
let fk = false
try { addBook(db, 'Nope', 99999) } catch { fk = true }
const filtered = booksByAuthor(db, a.id)
migrate(db)
setYear(db, ${JSON.stringify(title)}, ${year})
db.close()
console.log(JSON.stringify({ authorId: a && a.id, fk, filtered, titles: (filtered || []).map(r => r.title) }))
`], 10_000)
    let parsed: { fk?: boolean; titles?: string[] } = {}
    try { parsed = JSON.parse(setup.stdout.trim().split('\n').at(-1) || '{}') } catch { notes.push(setup.stderr) }
    const header = sqliteHeader(projectRoot, 'catalog.db')
    const restart = nodeRun(projectRoot, ['--input-type=module', '-e', `
import { DatabaseSync } from 'node:sqlite'
const db = new DatabaseSync('catalog.db')
const book = db.prepare('SELECT title, year, author_id FROM books WHERE title = ?').get(${JSON.stringify(title)})
const author = db.prepare('SELECT name FROM authors WHERE id = ?').get(book && book.author_id)
console.log(JSON.stringify({ book, author }))
db.close()
`])
    let restarted: { book?: { title?: string; year?: number }; author?: { name?: string } } = {}
    try { restarted = JSON.parse(restart.stdout.trim().split('\n').at(-1) || '{}') } catch { notes.push(restart.stderr) }
    criteria.push(row('DB1', true, header, 'FILE_INSPECT', header ? 'sqlite header' : 'not sqlite'))
    criteria.push(row('DB2', true, restarted.author?.name === author && restarted.book?.title === title, 'NODE_RUNTIME', JSON.stringify(restarted)))
    criteria.push(row('DB3', true, parsed.fk === true, 'NODE_RUNTIME', String(parsed.fk)))
    criteria.push(row('DB4', true, Array.isArray(parsed.titles) && parsed.titles.includes(title) && parsed.titles.length === 1, 'NODE_RUNTIME', JSON.stringify(parsed.titles)))
    criteria.push(row('DB5', true, Number(restarted.book?.year) === year, 'NODE_RUNTIME', JSON.stringify(restarted.book)))
    criteria.push(row('DB6', true, tests.status === 0, 'TEST_RUNNER', tests.stderr.slice(0, 80)))
    notes.push('database-engine=node:sqlite not PostgreSQL')
    return { criteria, methods: [...new Set(methods)], forbiddenShortcutHits, notes, uiVerificationMethod: 'NODE_RUNTIME' }
  }

  if (id === 'GRAD-DK-DESKTOP-V1') {
    methods.push('NODE_RUNTIME')
    const bin = foundryElectronBin()
    if (!bin) {
      for (const item of benchmark.acceptanceCriteria) criteria.push(row(item.criterionId, item.required, false, 'NOT_AVAILABLE', 'electron binary missing'))
      notes.push('DESKTOP_ORPHANS=0')
      return { criteria, methods: [...new Set(methods)], forbiddenShortcutHits, notes, uiVerificationMethod: 'NOT_AVAILABLE' }
    }
    const title = String(hidden?.values.title ?? 'hidden-cleo-note')
    const mark = `wrdesk-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
    const run = await runElectron(projectRoot, ['main.js', '--save', title, 'keep', '--mark', mark], mark)
    const orphans = countMarkedElectron(mark)
    notes.push(`DESKTOP_ORPHANS=${orphans}`)
    notes.push('desktop-framework=electron not all frameworks')
    const notesJson = read(projectRoot, 'notes.json') || ''
    const main = read(projectRoot, 'main.js') || ''
    criteria.push(row('DK1', true, /WINDOW_READY/.test(run.stdout), 'NODE_RUNTIME', run.stdout.slice(0, 120) || run.stderr.slice(0, 120)))
    criteria.push(row('DK2', true, notesJson.includes(title) && /SAVED=1/.test(run.stdout), 'FILE_INSPECT', notesJson.slice(0, 80)))
    criteria.push(row('DK3', true, /ipcMain\.handle\(\s*['"]save-note['"]/.test(main), 'FILE_INSPECT', 'ipc'))
    criteria.push(row('DK4', true, orphans === 0 && /SAVED=/.test(run.stdout), 'NODE_RUNTIME', `orphans=${orphans} status=${run.status}`))
    criteria.push(row('DK5', true, Boolean(read(projectRoot, 'preload.js')) && Boolean(read(projectRoot, 'index.html')), 'FILE_INSPECT', 'ui'))
    if (orphans > 0) forbiddenShortcutHits.push('orphan electron child')
    return { criteria, methods: [...new Set(methods)], forbiddenShortcutHits, notes, uiVerificationMethod: 'DOM_PARSE' }
  }

  if (id === 'GRAD-DK-DESKTOP-V2') {
    methods.push('NODE_RUNTIME')
    const bin = foundryElectronBin()
    if (!bin) {
      for (const item of benchmark.acceptanceCriteria) criteria.push(row(item.criterionId, item.required, false, 'NOT_AVAILABLE', 'electron binary missing'))
      notes.push('DESKTOP_ORPHANS=0')
      return { criteria, methods: [...new Set(methods)], forbiddenShortcutHits, notes, uiVerificationMethod: 'NOT_AVAILABLE' }
    }
    const fileName = String(hidden?.values.fileName ?? 'probe-cleo.txt')
    if (!existsSync(path.join(projectRoot, fileName))) writeFileSync(path.join(projectRoot, fileName), 'hello world')
    const mark = `wrmeta-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
    const run = await runElectron(projectRoot, ['main.js', '--stat', fileName, '--mark', mark], mark)
    const orphans = countMarkedElectron(mark)
    notes.push(`DESKTOP_ORPHANS=${orphans}`)
    notes.push('desktop-framework=electron not all frameworks')
    const meta = read(projectRoot, 'meta.json') || ''
    const main = read(projectRoot, 'main.js') || ''
    const expectedSize = Number(hidden?.values.bytes ?? 11)
    criteria.push(row('DL1', true, /WINDOW_READY/.test(run.stdout), 'NODE_RUNTIME', run.stdout.slice(0, 120) || run.stderr.slice(0, 120)))
    criteria.push(row('DL2', true, run.stdout.includes(`SIZE=${expectedSize}`) && run.stdout.includes(`NAME=${fileName}`), 'NODE_RUNTIME', run.stdout.slice(0, 160)))
    criteria.push(row('DL3', true, meta.includes(fileName) && meta.includes(String(expectedSize)), 'FILE_INSPECT', meta.slice(0, 80)))
    criteria.push(row('DL4', true, orphans === 0 && /STATED=1/.test(run.stdout), 'NODE_RUNTIME', `orphans=${orphans}`))
    criteria.push(row('DL5', true, /function fileMeta/.test(read(projectRoot, 'meta.js') || '') && Boolean(read(projectRoot, 'preload-meta.js')) && /file-meta/.test(main), 'FILE_INSPECT', 'fileMeta+preload'))
    if (orphans > 0) forbiddenShortcutHits.push('orphan electron child')
    return { criteria, methods: [...new Set(methods)], forbiddenShortcutHits, notes, uiVerificationMethod: 'DOM_PARSE' }
  }

  if (id === 'GRAD-LV-LEGACY-V1') {
    methods.push('NODE_RUNTIME', 'TEST_RUNNER')
    const src = read(projectRoot, 'lib/util.js') || ''
    const rewrite = !existsSync(path.join(projectRoot, 'lib/util.js')) || !/var tally/.test(src) || !/module\.exports/.test(src) || !/Item:' \+ name|Item:" \+ name/.test(src.replace(/\s/g, '')) && !/return 'Item:' \+ name/.test(src)
    const rewriteCount = (!existsSync(path.join(projectRoot, 'lib/util.js')) || !/var tally/.test(src) || !/module\.exports/.test(src)) ? 1 : 0
    notes.push(`LEGACY_REWRITE=${rewriteCount}`)
    if (rewriteCount) forbiddenShortcutHits.push('legacy rewrite shortcut')
    const tests = nodeRun(projectRoot, ['--test', 'util.test.mjs'])
    const script = `
import { createRequire } from 'node:module'
const require = createRequire(${JSON.stringify(path.join(projectRoot, 'util.test.mjs'))})
const util = require(${JSON.stringify(path.join(projectRoot, 'lib/util.js'))})
const qty = ${Number(hidden?.values.qty ?? 10)}
console.log(JSON.stringify({
  tally: util.tally([{ qty: 2 }, { qty: 3 }]),
  label: util.label('bolt'),
  discount: util.tallyDiscount([{ qty }], 10),
}))
`
    const run = nodeRun(projectRoot, ['--input-type=module', '-e', script])
    let parsed: { tally?: number; label?: string; discount?: number } = {}
    try { parsed = JSON.parse(run.stdout.trim().split('\n').at(-1) || '{}') } catch { notes.push(run.stderr) }
    const expectedDiscount = Number(hidden?.values.discounted ?? 9)
    criteria.push(row('LV1', true, parsed.tally === 5, 'NODE_RUNTIME', String(parsed.tally)))
    criteria.push(row('LV2', true, parsed.label === 'Item:bolt', 'NODE_RUNTIME', String(parsed.label)))
    criteria.push(row('LV3', true, parsed.discount === expectedDiscount, 'NODE_RUNTIME', String(parsed.discount)))
    criteria.push(row('LV4', true, rewriteCount === 0 && /function label/.test(src), 'FILE_INSPECT', rewrite ? 'rewritten' : 'kept'))
    criteria.push(row('LV5', true, tests.status === 0, 'TEST_RUNNER', tests.stderr.slice(0, 80)))
    return { criteria, methods: [...new Set(methods)], forbiddenShortcutHits, notes, uiVerificationMethod: 'NODE_RUNTIME' }
  }

  if (id === 'GRAD-LV-LEGACY-V2') {
    methods.push('NODE_RUNTIME', 'TEST_RUNNER')
    const src = read(projectRoot, 'lib/compute.js') || ''
    const helper = read(projectRoot, 'lib/add-pair.js') || ''
    const rewriteCount = (!existsSync(path.join(projectRoot, 'lib/compute.js')) || !/module\.exports/.test(src) || !/function compute\s*\(/.test(src)) ? 1 : 0
    notes.push(`LEGACY_REWRITE=${rewriteCount}`)
    if (rewriteCount) forbiddenShortcutHits.push('legacy rewrite shortcut')
    const tests = nodeRun(projectRoot, ['--test', 'compute.test.mjs'])
    const a = Number(hidden?.values.a ?? 4)
    const b = Number(hidden?.values.b ?? 13)
    const sum = Number(hidden?.values.sum ?? a + b)
    const script = `
import { createRequire } from 'node:module'
const require = createRequire(${JSON.stringify(path.join(projectRoot, 'compute.test.mjs'))})
const { compute, computeAsync } = require(${JSON.stringify(path.join(projectRoot, 'lib/compute.js'))})
compute(${a}, ${b}, async (err, value) => {
  const asyncValue = await computeAsync(${a}, ${b})
  console.log(JSON.stringify({ err, value, asyncValue }))
})
`
    const run = nodeRun(projectRoot, ['--input-type=module', '-e', script], 8_000)
    let parsed: { err?: unknown; value?: number; asyncValue?: number } = {}
    try { parsed = JSON.parse(run.stdout.trim().split('\n').at(-1) || '{}') } catch { notes.push(run.stderr) }
    criteria.push(row('LW1', true, parsed.err == null && parsed.value === sum, 'NODE_RUNTIME', JSON.stringify(parsed)))
    criteria.push(row('LW2', true, parsed.asyncValue === sum, 'NODE_RUNTIME', String(parsed.asyncValue)))
    criteria.push(row('LW3', true, /addPair/.test(src) && /function addPair/.test(helper), 'FILE_INSPECT', 'shared helper'))
    criteria.push(row('LW4', true, rewriteCount === 0, 'FILE_INSPECT', rewriteCount ? 'rewritten' : 'kept'))
    criteria.push(row('LW5', true, tests.status === 0, 'TEST_RUNNER', tests.stderr.slice(0, 80)))
    return { criteria, methods: [...new Set(methods)], forbiddenShortcutHits, notes, uiVerificationMethod: 'NODE_RUNTIME' }
  }

  if (id === 'GRAD-RF-REFACTOR-V1') {
    methods.push('NODE_RUNTIME', 'TEST_RUNNER')
    const a = read(projectRoot, 'src/a.mjs') || ''
    const b = read(projectRoot, 'src/b.mjs') || ''
    const blank = read(projectRoot, 'src/blank.mjs') || ''
    const testSrc = read(projectRoot, 'src/blank.test.mjs') || ''
    const tests = nodeRun(projectRoot, ['--test', 'src/blank.test.mjs'])
    const urlA = pathToFileURL(path.join(projectRoot, 'src/a.mjs')).href
    const urlB = pathToFileURL(path.join(projectRoot, 'src/b.mjs')).href
    const run = nodeRun(projectRoot, ['--input-type=module', '-e', `import { cleanName } from '${urlA}'; import { cleanCode } from '${urlB}'; console.log(JSON.stringify({ n: cleanName('  ${String(hidden?.values.name ?? 'nia')}  '), z: cleanName('  '), c: cleanCode(' ab ') }))`])
    let parsed: { n?: string; z?: unknown; c?: string } = {}
    try { parsed = JSON.parse(run.stdout.trim().split('\n').at(-1) || '{}') } catch { notes.push(run.stderr) }
    const extracted = /export function isBlank/.test(blank) && (a.includes("from './blank.mjs'") || a.includes('from "./blank.mjs"')) && (b.includes("from './blank.mjs'") || b.includes('from "./blank.mjs"'))
    const cosmetic = /export function isBlank/.test(a) && !extracted
    if (cosmetic) forbiddenShortcutHits.push('rename-only cosmetic refactor')
    criteria.push(row('RF1', true, parsed.n === String(hidden?.values.name ?? 'nia') && parsed.z == null && parsed.c === 'AB', 'NODE_RUNTIME', JSON.stringify(parsed)))
    criteria.push(row('RF2', true, /export function isBlank/.test(blank), 'FILE_INSPECT', blank.slice(0, 80)))
    criteria.push(row('RF3', true, extracted, 'FILE_INSPECT', `a=${/blank\\.mjs/.test(a)} b=${/blank\\.mjs/.test(b)}`))
    criteria.push(row('RF4', true, tests.status === 0 && /cleanName/.test(testSrc) && /cleanCode/.test(testSrc), 'TEST_RUNNER', tests.stderr.slice(0, 80)))
    return { criteria, methods: [...new Set(methods)], forbiddenShortcutHits, notes, uiVerificationMethod: 'NODE_RUNTIME' }
  }

  if (id === 'GRAD-RF-REFACTOR-V2') {
    methods.push('NODE_RUNTIME', 'TEST_RUNNER')
    const service = read(projectRoot, 'src/service.mjs') || ''
    const repo = read(projectRoot, 'src/repo.mjs') || ''
    const testSrc = read(projectRoot, 'src/service.test.mjs') || ''
    const tests = nodeRun(projectRoot, ['--test', 'src/service.test.mjs'])
    const key = String(hidden?.values.key ?? 'hidden-kade')
    const url = pathToFileURL(path.join(projectRoot, 'src/service.mjs')).href
    const run = nodeRun(projectRoot, ['--input-type=module', '-e', `import { getItem, setItem } from '${url}'; setItem(${JSON.stringify(key)}, 'keep'); console.log(JSON.stringify({ got: getItem(${JSON.stringify(key)}) }))`])
    let parsed: { got?: string } = {}
    try { parsed = JSON.parse(run.stdout.trim().split('\n').at(-1) || '{}') } catch { notes.push(run.stderr) }
    const extracted = /export function load/.test(repo) && /export function save/.test(repo) && (service.includes("from './repo.mjs'") || service.includes('from "./repo.mjs"'))
    if (!extracted && /function load/.test(service)) forbiddenShortcutHits.push('rename-only cosmetic refactor')
    criteria.push(row('RG1', true, parsed.got === 'keep', 'NODE_RUNTIME', JSON.stringify(parsed)))
    criteria.push(row('RG2', true, /export function load/.test(repo) && /export function save/.test(repo), 'FILE_INSPECT', repo.slice(0, 80)))
    criteria.push(row('RG3', true, extracted, 'FILE_INSPECT', extracted ? 'separated' : 'still inline'))
    criteria.push(row('RG4', true, tests.status === 0 && /roundtrip/.test(testSrc), 'TEST_RUNNER', tests.stderr.slice(0, 80)))
    return { criteria, methods: [...new Set(methods)], forbiddenShortcutHits, notes, uiVerificationMethod: 'NODE_RUNTIME' }
  }

  if (id === 'GRAD-DP-DATA-V1') {
    methods.push('NODE_RUNTIME', 'TEST_RUNNER')
    const tests = nodeRun(projectRoot, ['--test', 'pipeline.test.mjs'])
    const sku = String(hidden?.values.sku ?? 'HID-CLE')
    const hiddenCsv = `sku,price,qty\n${sku},2,3\nbad\nBBB,4,5\n`
    writeFileSync(path.join(projectRoot, 'hidden-input.csv'), hiddenCsv)
    const url = pathToFileURL(path.join(projectRoot, 'pipeline.mjs')).href
    const run = nodeRun(projectRoot, ['--input-type=module', '-e', `
import { readFileSync, writeFileSync } from 'node:fs'
import { processCsv } from '${url}'
const out = processCsv(readFileSync('hidden-input.csv', 'utf8'))
writeFileSync('summary.json', JSON.stringify(out) + '\\n')
console.log(JSON.stringify(out))
`])
    let parsed: { rows?: Array<{ sku?: string }>; errors?: number; total?: number } = {}
    try { parsed = JSON.parse(run.stdout.trim().split('\n').at(-1) || '{}') } catch { notes.push(run.stderr) }
    const summary = read(projectRoot, 'summary.json') || ''
    criteria.push(row('DP1', true, JSON.stringify(parsed.rows || []).includes(sku), 'FILE_INSPECT', JSON.stringify(parsed.rows)))
    criteria.push(row('DP2', true, Number(parsed.total) === Number(hidden?.values.total ?? 26), 'NODE_RUNTIME', String(parsed.total)))
    criteria.push(row('DP3', true, Number(parsed.errors) === Number(hidden?.values.errors ?? 1), 'NODE_RUNTIME', String(parsed.errors)))
    criteria.push(row('DP4', true, summary.includes('"total"') && summary.includes(sku), 'FILE_INSPECT', summary.slice(0, 80)))
    criteria.push(row('DP5', true, tests.status === 0, 'TEST_RUNNER', tests.stderr.slice(0, 80)))
    return { criteria, methods: [...new Set(methods)], forbiddenShortcutHits, notes, uiVerificationMethod: 'NODE_RUNTIME' }
  }

  if (id === 'GRAD-DP-DATA-V2') {
    methods.push('NODE_RUNTIME', 'TEST_RUNNER')
    const tests = nodeRun(projectRoot, ['--test', 'events.test.mjs'])
    const url = pathToFileURL(path.join(projectRoot, 'events.mjs')).href
    const run = nodeRun(projectRoot, ['--input-type=module', '-e', `
import { readFileSync, writeFileSync } from 'node:fs'
import { processJsonl } from '${url}'
const raw = readFileSync('events.jsonl', 'utf8')
const out = processJsonl(raw)
writeFileSync('report.json', JSON.stringify(out) + '\\n')
const errLines = raw.split(/\\n/).filter(line => line && (() => { try { JSON.parse(line); return false } catch { return true } })())
writeFileSync('errors.jsonl', errLines.join('\\n') + (errLines.length ? '\\n' : ''))
console.log(JSON.stringify(out))
`])
    let parsed: { unique?: number; groups?: Record<string, number>; errors?: number } = {}
    try { parsed = JSON.parse(run.stdout.trim().split('\n').at(-1) || '{}') } catch { notes.push(run.stderr) }
    const report = read(projectRoot, 'report.json') || ''
    const errors = read(projectRoot, 'errors.jsonl') || ''
    const unique = Number(hidden?.values.unique ?? 22)
    criteria.push(row('DQ1', true, Number(parsed.unique) === unique, 'FILE_INSPECT', String(parsed.unique)))
    criteria.push(row('DQ2', true, typeof parsed.groups?.pack === 'number' && parsed.groups.pack >= 1, 'NODE_RUNTIME', JSON.stringify(parsed.groups)))
    criteria.push(row('DQ3', true, errors.includes('{bad') || Number(parsed.errors) === Number(hidden?.values.errorLines ?? 1), 'FILE_INSPECT', errors.slice(0, 40)))
    criteria.push(row('DQ4', true, report.includes('"unique"'), 'FILE_INSPECT', report.slice(0, 80)))
    criteria.push(row('DQ5', true, tests.status === 0, 'TEST_RUNNER', tests.stderr.slice(0, 80)))
    return { criteria, methods: [...new Set(methods)], forbiddenShortcutHits, notes, uiVerificationMethod: 'NODE_RUNTIME' }
  }

  if (id === 'GRAD-LP-LIBRARY-V1') {
    methods.push('NODE_RUNTIME', 'TEST_RUNNER')
    const pkg = read(projectRoot, 'package.json') || ''
    let parsedPkg: { name?: string; version?: string; exports?: unknown } = {}
    try { parsedPkg = JSON.parse(pkg) } catch { /* */ }
    const tests = nodeRun(projectRoot, ['--test', 'src/index.test.mjs'])
    const consumer = nodeRun(projectRoot, ['consumer/use.mjs'])
    const url = pathToFileURL(path.join(projectRoot, 'src/index.mjs')).href
    const raw = String(hidden?.values.raw ?? '$12.50')
    const cents = Number(hidden?.values.cents ?? 1250)
    const run = nodeRun(projectRoot, ['--input-type=module', '-e', `import { parseCents } from '${url}'; let threw=false; try { parseCents('nope') } catch { threw=true }; console.log(JSON.stringify({ cents: parseCents(${JSON.stringify(raw)}), threw }))`])
    let parsed: { cents?: number; threw?: boolean } = {}
    try { parsed = JSON.parse(run.stdout.trim().split('\n').at(-1) || '{}') } catch { notes.push(run.stderr) }
    criteria.push(row('LP1', true, parsedPkg.name === 'foundry-money-lite' && Boolean(parsedPkg.version) && Boolean(parsedPkg.exports), 'FILE_INSPECT', pkg.slice(0, 120)))
    criteria.push(row('LP2', true, parsed.cents === cents, 'NODE_RUNTIME', String(parsed.cents)))
    criteria.push(row('LP3', true, parsed.threw === true, 'NODE_RUNTIME', String(parsed.threw)))
    criteria.push(row('LP4', true, consumer.status === 0 && consumer.stdout.includes('CENTS=1250'), 'NODE_RUNTIME', consumer.stdout.trim()))
    criteria.push(row('LP5', true, tests.status === 0, 'TEST_RUNNER', tests.stderr.slice(0, 80)))
    notes.push('library-language=javascript/node not rust/python')
    return { criteria, methods: [...new Set(methods)], forbiddenShortcutHits, notes, uiVerificationMethod: 'NODE_RUNTIME' }
  }

  if (id === 'GRAD-LP-LIBRARY-V2') {
    methods.push('NODE_RUNTIME', 'TEST_RUNNER')
    const pkg = read(projectRoot, 'package.json') || ''
    let parsedPkg: { name?: string; exports?: Record<string, string> } = {}
    try { parsedPkg = JSON.parse(pkg) } catch { /* */ }
    const tests = nodeRun(projectRoot, ['--test', 'src/kit.test.mjs'])
    const consumer = nodeRun(projectRoot, ['consumer/use.mjs'])
    const url = pathToFileURL(path.join(projectRoot, 'src/index.mjs')).href
    const run = nodeRun(projectRoot, ['--input-type=module', '-e', `import { slugify, titleCase } from '${url}'; console.log(JSON.stringify({ slug: slugify('Shift Board'), title: titleCase('shift board') }))`])
    let parsed: { slug?: string; title?: string } = {}
    try { parsed = JSON.parse(run.stdout.trim().split('\n').at(-1) || '{}') } catch { notes.push(run.stderr) }
    const exportsMap = parsedPkg.exports || {}
    const privateExport = Object.keys(exportsMap).some(key => /words/.test(key))
    criteria.push(row('LQ1', true, parsedPkg.name === 'foundry-text-kit' && Boolean(exportsMap['.']) && Boolean(exportsMap['./slug'] || exportsMap['./title'] || exportsMap['.']), 'FILE_INSPECT', pkg.slice(0, 160)))
    criteria.push(row('LQ2', true, parsed.slug === 'shift-board' && parsed.title === 'Shift Board', 'NODE_RUNTIME', JSON.stringify(parsed)))
    criteria.push(row('LQ3', true, !privateExport && existsSync(path.join(projectRoot, 'src/words.mjs')), 'FILE_INSPECT', privateExport ? 'words exported' : 'private'))
    criteria.push(row('LQ4', true, consumer.status === 0 && /SLUG=shift-board/.test(consumer.stdout) && /TITLE=Shift Board/.test(consumer.stdout), 'NODE_RUNTIME', consumer.stdout.trim()))
    criteria.push(row('LQ5', true, tests.status === 0, 'TEST_RUNNER', tests.stderr.slice(0, 80)))
    notes.push('library-language=javascript/node not rust/python')
    return { criteria, methods: [...new Set(methods)], forbiddenShortcutHits, notes, uiVerificationMethod: 'NODE_RUNTIME' }
  }

  return null
}
