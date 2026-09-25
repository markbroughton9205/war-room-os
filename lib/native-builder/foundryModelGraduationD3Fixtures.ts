/**
 * Mission 11 model-driven D3 fixtures: TEST_REPAIR, FULL_STACK_APP, BACKEND v2/v3.
 * Distinct from Mission 08 H/D and Mission 10 CLI/bug/frontend/items-API.
 * Hidden oracles stay outside the project workspace. No reference solutions.
 */
import type {
  FoundryEngineeringBenchmark,
  FoundryEngineeringProjectClass,
  FoundryGraduationCriterion,
} from './foundryEngineeringGraduationTypes'
import { FOUNDRY_MODEL_DRIVEN_BUDGET, FOUNDRY_MODEL_DRIVEN_D3_BUDGET } from './foundryEngineeringGraduationTypes'
import type { GraduationFixtureMaterial } from './foundryEngineeringGraduationFixtures'

function criterion(id: string, description: string, verificationType: string, expectedOutcome: string, required = true): FoundryGraduationCriterion {
  return { criterionId: id, description, required, verificationType, expectedOutcome }
}

const HTTP_CHECKIN_SERVER = `import http from 'node:http'
import { readFileSync, writeFileSync } from 'node:fs'

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}
function load() { return JSON.parse(readFileSync(new URL('./checkins.json', import.meta.url), 'utf8')) }
function save(items) { writeFileSync(new URL('./checkins.json', import.meta.url), JSON.stringify(items) + '\\n') }

const server = http.createServer((req, res) => {
  const url = req.url || '/'
  if (req.method === 'GET' && url === '/health') return send(res, 200, { ok: true })
  if (req.method === 'GET' && url === '/checkins') return send(res, 200, load())
  if (req.method === 'POST' && url === '/checkins') {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}')
        if (!parsed.name) return send(res, 400, { error: 'name required' })
        const items = load()
        const item = { id: 'c' + (items.length + 1), name: String(parsed.name) }
        items.push(item)
        save(items)
        send(res, 201, item)
      } catch {
        send(res, 400, { error: 'invalid JSON' })
      }
    })
    return
  }
  send(res, 404, { error: 'not found' })
})
server.listen(Number(process.env.PORT || 0), '127.0.0.1', () => {
  const addr = server.address()
  if (addr && typeof addr === 'object') console.log('PORT=' + addr.port)
})
`

const HTTP_STUB = `import http from 'node:http'
function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}
const server = http.createServer((req, res) => {
  send(res, 500, { error: 'implement routes' })
})
server.listen(Number(process.env.PORT || 0), '127.0.0.1', () => {
  const addr = server.address()
  if (addr && typeof addr === 'object') console.log('PORT=' + addr.port)
})
`

const HTTP_SCORE_SERVER = `import http from 'node:http'
import { readFileSync, writeFileSync } from 'node:fs'

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}
function load() { return JSON.parse(readFileSync(new URL('./scores.json', import.meta.url), 'utf8')) }
function save(map) { writeFileSync(new URL('./scores.json', import.meta.url), JSON.stringify(map) + '\\n') }

const server = http.createServer((req, res) => {
  const url = req.url || '/'
  if (req.method === 'GET' && url === '/health') return send(res, 200, { ok: true })
  if (req.method === 'GET' && url === '/leaders') {
    const map = load()
    const leaders = Object.entries(map).map(([player, points]) => ({ player, points: Number(points) })).sort((a, b) => b.points - a.points)
    return send(res, 200, leaders)
  }
  if (req.method === 'POST' && url === '/score') {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}')
        if (!parsed.player) return send(res, 400, { error: 'player required' })
        const map = load()
        const next = Number(map[parsed.player] || 0) + Number(parsed.points || 0)
        map[parsed.player] = next
        save(map)
        send(res, 201, { player: parsed.player, points: next })
      } catch {
        send(res, 400, { error: 'invalid JSON' })
      }
    })
    return
  }
  send(res, 404, { error: 'not found' })
})
server.listen(Number(process.env.PORT || 0), '127.0.0.1', () => {
  const addr = server.address()
  if (addr && typeof addr === 'object') console.log('PORT=' + addr.port)
})
`

export function modelDrivenD3Benchmarks(): FoundryEngineeringBenchmark[] {
  return [
    {
      benchmarkId: 'GRAD-H-TEST-REPAIR-V1',
      letter: 'TR',
      projectClass: 'TEST_REPAIR',
      difficulty: 'D3',
      language: 'javascript',
      runtime: 'node',
      environment: 'local-disposable',
      startingFixture: 'invoice-tax-discount',
      missionPrompt: 'Some invoice tests fail. Diagnose whether product code is wrong, a test expectation is stale, or both. Keep tests that already describe correct behavior. Do not skip tests.',
      acceptanceCriteria: [
        criterion('TR1', 'hidden invoice total uses discount then tax', 'RUNTIME', 'hidden total'),
        criterion('TR2', 'stale test expectation corrected', 'FILE', 'stale 180 gone'),
        criterion('TR3', 'correct existing tests remain', 'FILE', '90 and 99 kept'),
        criterion('TR4', 'project tests pass', 'TEST', 'node --test'),
        criterion('TR5', 'no skipped or always-true tests', 'FILE', 'no skip'),
      ],
      forbiddenShortcuts: ['skip tests', 'always-true assertions', 'delete the correct tests', 'read hidden oracle'],
      timeoutMs: 45_000,
      resourceBudget: FOUNDRY_MODEL_DRIVEN_BUDGET,
      expectedArtifacts: ['src/price.mjs', 'src/price.test.mjs'],
      expectedTests: ['src/price.test.mjs'],
      independentVerifier: 'verifyTestRepairInvoice',
      writeSet: ['src/price.mjs', 'src/price.test.mjs'],
      outOfScopePaths: ['.foundry-expected.json'],
      networkRequired: false,
      suite: 'fast',
      variationKeys: ['list', 'discountPct', 'taxPct'],
    },
    {
      benchmarkId: 'GRAD-H-TEST-REPAIR-V2',
      letter: 'TS',
      projectClass: 'TEST_REPAIR',
      difficulty: 'D3',
      language: 'javascript',
      runtime: 'node',
      environment: 'local-disposable',
      startingFixture: 'age-parse-validation',
      missionPrompt: 'Age parsing tests disagree. Diagnose whether parseAge implementation is wrong, a test expectation is stale, or both. Keep tests that already describe correct behavior. Do not skip tests.',
      acceptanceCriteria: [
        criterion('TS1', 'hidden parseAge cases: whole digits vs junk', 'RUNTIME', 'hidden parse'),
        criterion('TS2', 'stale parseInt expectation corrected', 'FILE', '12px is not 12'),
        criterion('TS3', 'correct whole-number test remains', 'FILE', "parseAge('21') === 21"),
        criterion('TS4', 'project tests pass', 'TEST', 'node --test'),
        criterion('TS5', 'no skipped or always-true tests', 'FILE', 'no skip'),
      ],
      forbiddenShortcuts: ['skip tests', 'always-true assertions', 'delete the correct tests', 'read hidden oracle'],
      timeoutMs: 45_000,
      resourceBudget: FOUNDRY_MODEL_DRIVEN_D3_BUDGET,
      expectedArtifacts: ['src/parse.mjs', 'src/parse.test.mjs'],
      expectedTests: ['src/parse.test.mjs'],
      independentVerifier: 'verifyTestRepairParse',
      writeSet: ['src/parse.mjs', 'src/parse.test.mjs'],
      outOfScopePaths: ['.foundry-expected.json'],
      networkRequired: false,
      suite: 'full',
      variationKeys: ['rawAge'],
    },
    {
      benchmarkId: 'GRAD-H-TEST-REPAIR-V3',
      letter: 'TT',
      projectClass: 'TEST_REPAIR',
      difficulty: 'D3',
      language: 'javascript',
      runtime: 'node',
      environment: 'local-disposable',
      startingFixture: 'tokenize-join-mismatch',
      missionPrompt: 'Tokenizer and joiner live in two files. Tests disagree. Diagnose whether product code is wrong, a test expectation is stale, or both. Keep tests that already describe correct tokenize behavior. Do not skip tests.',
      acceptanceCriteria: [
        criterion('TT1', 'hidden joinTokens uses comma separator', 'RUNTIME', 'hidden join'),
        criterion('TT2', 'stale no-separator expectation corrected', 'FILE', "ab expectation gone"),
        criterion('TT3', 'correct tokenize test remains', 'FILE', 'tokenize kept'),
        criterion('TT4', 'project tests pass', 'TEST', 'node --test'),
        criterion('TT5', 'no skipped or always-true tests', 'FILE', 'no skip'),
      ],
      forbiddenShortcuts: ['skip tests', 'always-true assertions', 'delete the tokenize test', 'read hidden oracle'],
      timeoutMs: 45_000,
      resourceBudget: FOUNDRY_MODEL_DRIVEN_D3_BUDGET,
      expectedArtifacts: ['src/tokens.mjs', 'src/join.mjs', 'src/join.test.mjs'],
      expectedTests: ['src/join.test.mjs'],
      independentVerifier: 'verifyTestRepairJoin',
      writeSet: ['src/tokens.mjs', 'src/join.mjs', 'src/join.test.mjs'],
      outOfScopePaths: ['.foundry-expected.json'],
      networkRequired: false,
      suite: 'full',
      variationKeys: ['parts'],
    },
    {
      benchmarkId: 'GRAD-D-FULLSTACK-V1',
      letter: 'FQ',
      projectClass: 'FULL_STACK_APP',
      difficulty: 'D3',
      language: 'javascript',
      framework: 'vanilla',
      runtime: 'node',
      environment: 'local-disposable',
      startingFixture: 'checkin-desk',
      missionPrompt: 'Build a local check-in desk: Node HTTP backend plus frontend client. UI checkIn posts to the API, backend persists, UI lastList reflects the response. Not a notes app.',
      acceptanceCriteria: [
        criterion('FQ1', 'GET /health 200', 'HTTP', 'ok'),
        criterion('FQ2', 'POST /checkins missing name is 400', 'HTTP', '400'),
        criterion('FQ3', 'UI checkIn persists hidden name and lastList includes it', 'HTTP', 'integration'),
        criterion('FQ4', 'GET /checkins lists the hidden name', 'HTTP', 'list'),
        criterion('FQ5', 'createDesk exported and starter test still present', 'TEST', 'export + test'),
      ],
      forbiddenShortcuts: ['in-memory only', 'static fake lastList', 'read hidden oracle', 'cloud service'],
      timeoutMs: 60_000,
      resourceBudget: FOUNDRY_MODEL_DRIVEN_D3_BUDGET,
      expectedArtifacts: ['server.mjs', 'app.js', 'checkins.json', 'app.test.mjs'],
      expectedTests: ['app.test.mjs'],
      independentVerifier: 'verifyFullStackCheckin',
      writeSet: ['server.mjs', 'app.js', 'checkins.json', 'app.test.mjs'],
      outOfScopePaths: ['.foundry-expected.json', '.env'],
      networkRequired: false,
      suite: 'fast',
      variationKeys: ['guestName'],
    },
    {
      benchmarkId: 'GRAD-D-FULLSTACK-V2',
      letter: 'FV',
      projectClass: 'FULL_STACK_APP',
      difficulty: 'D3',
      language: 'javascript',
      framework: 'vanilla',
      runtime: 'node',
      environment: 'local-disposable',
      startingFixture: 'scoreboard',
      missionPrompt: 'Build a local scoreboard: Node HTTP backend plus frontend client. addScore posts points, backend sums per player, GET /leaders returns ranking, UI leaders() reflects it. Not a check-in desk or notes CRUD clone.',
      acceptanceCriteria: [
        criterion('FV1', 'GET /health 200', 'HTTP', 'ok'),
        criterion('FV2', 'POST /score missing player is 400', 'HTTP', '400'),
        criterion('FV3', 'UI addScore accumulates hidden player points and leaders ranks them', 'HTTP', 'integration'),
        criterion('FV4', 'scores.json persistence', 'FILE', 'scores.json'),
        criterion('FV5', 'createBoard exported and starter test still present', 'TEST', 'export + test'),
      ],
      forbiddenShortcuts: ['in-memory only', 'static fake leaders', 'read hidden oracle', 'cloud service'],
      timeoutMs: 60_000,
      resourceBudget: FOUNDRY_MODEL_DRIVEN_D3_BUDGET,
      expectedArtifacts: ['server.mjs', 'app.js', 'scores.json', 'app.test.mjs'],
      expectedTests: ['app.test.mjs'],
      independentVerifier: 'verifyFullStackScoreboard',
      writeSet: ['server.mjs', 'app.js', 'scores.json', 'app.test.mjs'],
      outOfScopePaths: ['.foundry-expected.json', '.env'],
      networkRequired: false,
      suite: 'full',
      variationKeys: ['player', 'points'],
    },
    {
      benchmarkId: 'GRAD-C-BACKEND-V2',
      letter: 'BA',
      projectClass: 'BACKEND_API',
      difficulty: 'D3',
      language: 'javascript',
      runtime: 'node',
      environment: 'local-disposable',
      startingFixture: 'books-library-api',
      missionPrompt: 'Build a books library HTTP API: list, create, lookup, update title, delete. Validate missing title. Persist books.json. Not the items health-create API.',
      acceptanceCriteria: [
        criterion('BA1', 'GET /health 200', 'HTTP', 'ok'),
        criterion('BA2', 'POST /books missing title is 400', 'HTTP', '400'),
        criterion('BA3', 'POST creates hidden title and GET /books/:id returns it', 'HTTP', 'lookup'),
        criterion('BA4', 'PUT updates title; DELETE removes; unknown id 404', 'HTTP', 'update-delete'),
        criterion('BA5', 'books.json persistence', 'FILE', 'books.json'),
        criterion('BA6', 'starter test still present and passes', 'TEST', 'node --test'),
      ],
      forbiddenShortcuts: ['in-memory only', 'always 200', 'read hidden oracle'],
      timeoutMs: 45_000,
      resourceBudget: FOUNDRY_MODEL_DRIVEN_D3_BUDGET,
      expectedArtifacts: ['server.mjs', 'books.json', 'server.test.mjs'],
      expectedTests: ['server.test.mjs'],
      independentVerifier: 'verifyBackendBooks',
      writeSet: ['server.mjs', 'books.json', 'server.test.mjs'],
      outOfScopePaths: ['.foundry-expected.json', '.env'],
      networkRequired: false,
      suite: 'fast',
      variationKeys: ['title'],
    },
    {
      benchmarkId: 'GRAD-C-BACKEND-V3',
      letter: 'BB',
      projectClass: 'BACKEND_API',
      difficulty: 'D3',
      language: 'javascript',
      runtime: 'node',
      environment: 'local-disposable',
      startingFixture: 'ledger-api',
      missionPrompt: 'Build a local ledger HTTP API: post signed amounts, lookup txn, GET /balance as the running sum. Validate non-numeric amount. Persist ledger.json. Not a books or items API.',
      acceptanceCriteria: [
        criterion('BB1', 'GET /health 200', 'HTTP', 'ok'),
        criterion('BB2', 'POST /txns missing/non-numeric amount is 400', 'HTTP', '400'),
        criterion('BB3', 'hidden txns persist and GET /txns/:id works', 'HTTP', 'lookup'),
        criterion('BB4', 'GET /balance equals the hidden running sum', 'HTTP', 'balance'),
        criterion('BB5', 'ledger.json persistence', 'FILE', 'ledger.json'),
        criterion('BB6', 'starter test still present and passes', 'TEST', 'node --test'),
      ],
      forbiddenShortcuts: ['in-memory only', 'hardcode hidden balance', 'read hidden oracle'],
      timeoutMs: 45_000,
      resourceBudget: FOUNDRY_MODEL_DRIVEN_D3_BUDGET,
      expectedArtifacts: ['server.mjs', 'ledger.json', 'server.test.mjs'],
      expectedTests: ['server.test.mjs'],
      independentVerifier: 'verifyBackendLedger',
      writeSet: ['server.mjs', 'ledger.json', 'server.test.mjs'],
      outOfScopePaths: ['.foundry-expected.json', '.env'],
      networkRequired: false,
      suite: 'full',
      variationKeys: ['amounts'],
    },
    {
      benchmarkId: 'GRAD-I-FEATURE-V2',
      letter: 'FX',
      projectClass: 'FEATURE_EXTENSION' as FoundryEngineeringProjectClass,
      difficulty: 'D3',
      language: 'javascript',
      runtime: 'node',
      environment: 'local-disposable',
      startingFixture: 'report-cli-rows',
      missionPrompt: 'Extend the existing report CLI. Preserve --help and --rows. Add --unique and --total across src/report.mjs and src/cli.mjs without weakening existing rows coverage.',
      acceptanceCriteria: [
        criterion('FX1', 'existing --rows still prints ROW_COUNT', 'CLI', 'rows preserved'),
        criterion('FX2', '--unique prints UNIQUE=<n> for hidden names', 'CLI', 'hidden unique'),
        criterion('FX3', '--total prints TOTAL=<n> of hidden amounts', 'CLI', 'hidden total'),
        criterion('FX4', 'unknown flags still exit 2', 'CLI', 'exit 2'),
        criterion('FX5', 'tests pass and still assert rows', 'TEST', 'node --test'),
      ],
      forbiddenShortcuts: ['break --rows', 'delete existing tests', 'hardcode hidden total'],
      timeoutMs: 45_000,
      resourceBudget: FOUNDRY_MODEL_DRIVEN_D3_BUDGET,
      expectedArtifacts: ['src/cli.mjs', 'src/report.mjs', 'src/report.test.mjs', 'report.json'],
      expectedTests: ['src/report.test.mjs'],
      independentVerifier: 'verifyFeatureV2',
      writeSet: ['src/cli.mjs', 'src/report.mjs', 'src/report.test.mjs', 'report.json'],
      outOfScopePaths: ['.foundry-expected.json'],
      networkRequired: false,
      suite: 'full',
      variationKeys: ['names'],
    },
  ]
}

export function seedD3Fixture(benchmark: FoundryEngineeringBenchmark, variant = 'v1'): GraduationFixtureMaterial | null {
  if (benchmark.benchmarkId === 'GRAD-H-TEST-REPAIR-V1') {
    const list = 200
    const discountPct = 10
    const taxPct = 10
    const expected = Math.round((list * (1 - discountPct / 100)) * (1 + taxPct / 100))
    return {
      variant,
      hidden: { list, discountPct, taxPct, expected },
      files: {
        'src/price.mjs': 'export function invoiceTotal(list, discountPct, taxPct) {\n  return list - (list * discountPct / 100) + (list * taxPct / 100)\n}\n',
        'src/price.test.mjs': `import test from 'node:test'
import assert from 'node:assert/strict'
import { invoiceTotal } from './price.mjs'
test('zero tax applies discount only', () => { assert.equal(invoiceTotal(100, 10, 0), 90) })
test('legacy tax on original list', () => { assert.equal(invoiceTotal(200, 20, 10), 180) })
test('tax after discount', () => { assert.equal(invoiceTotal(100, 10, 10), 99) })
`,
      },
    }
  }
  if (benchmark.benchmarkId === 'GRAD-H-TEST-REPAIR-V2') {
    return {
      variant,
      hidden: { raw: '08', parsed: 8, junk: '12px' },
      files: {
        'src/parse.mjs': 'export function parseAge(raw) {\n  return Number.parseInt(String(raw), 10)\n}\n',
        'src/parse.test.mjs': `import test from 'node:test'
import assert from 'node:assert/strict'
import { parseAge } from './parse.mjs'
test('accepts whole number', () => { assert.equal(parseAge('21'), 21) })
test('legacy parseInt junk', () => { assert.equal(parseAge('12px'), 12) })
`,
      },
    }
  }
  if (benchmark.benchmarkId === 'GRAD-H-TEST-REPAIR-V3') {
    return {
      variant,
      hidden: { parts: 'q,r,s', expected: 'q,r,s' },
      files: {
        'src/tokens.mjs': 'export function tokenize(text) {\n  return String(text).trim().split(/\\s+/).filter(Boolean)\n}\n',
        'src/join.mjs': "import { tokenize } from './tokens.mjs'\nexport { tokenize }\nexport function joinTokens(parts) {\n  return parts.join('')\n}\n",
        'src/join.test.mjs': `import test from 'node:test'
import assert from 'node:assert/strict'
import { tokenize, joinTokens } from './join.mjs'
test('tokenize splits words', () => { assert.deepEqual(tokenize('a b'), ['a', 'b']) })
test('legacy join no separator', () => { assert.equal(joinTokens(['a', 'b']), 'ab') })
`,
      },
    }
  }
  if (benchmark.benchmarkId === 'GRAD-D-FULLSTACK-V1') {
    const guestName = variant === 'v2' ? 'hidden-remy' : 'hidden-cleo'
    return {
      variant,
      hidden: { guestName },
      files: {
        'checkins.json': '[]\n',
        'server.mjs': HTTP_CHECKIN_SERVER,
        'index.html': '<!doctype html><html><body><div id="root"></div><script type="module" src="./app.js"></script></body></html>\n',
        'app.js': `export function createDesk(baseUrl) {
  return {
    lastList: [],
    lastError: null,
    async checkIn(name) {
      const res = await fetch(baseUrl + '/wrong', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) })
      this.lastError = 'fix the URL and GET /checkins into lastList'
      return res.status
    },
  }
}
`,
        'app.test.mjs': `import test from 'node:test'
import assert from 'node:assert/strict'
import { createDesk } from './app.js'
test('createDesk exported', () => { assert.equal(typeof createDesk, 'function') })
`,
      },
    }
  }
  if (benchmark.benchmarkId === 'GRAD-D-FULLSTACK-V2') {
    const player = variant === 'v2' ? 'hidden-nova' : 'hidden-kade'
    return {
      variant,
      hidden: { player, first: 4, second: 9, total: 13 },
      files: {
        'scores.json': '{}\n',
        'server.mjs': HTTP_SCORE_SERVER,
        'index.html': '<!doctype html><html><body><div id="root"></div><script type="module" src="./app.js"></script></body></html>\n',
        'app.js': `export function createBoard(baseUrl) {
  return {
    lastLeaders: [],
    lastError: null,
    async addScore(player, points) {
      const res = await fetch(baseUrl + '/wrong', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ player, points }) })
      this.lastError = 'fix POST /score then GET /leaders into lastLeaders'
      return res.status
    },
    async leaders() { return this.lastLeaders },
  }
}
`,
        'app.test.mjs': `import test from 'node:test'
import assert from 'node:assert/strict'
import { createBoard } from './app.js'
test('createBoard exported', () => { assert.equal(typeof createBoard, 'function') })
`,
      },
    }
  }
  if (benchmark.benchmarkId === 'GRAD-C-BACKEND-V2') {
    const title = variant === 'v2' ? 'Hidden Atlas' : 'Hidden Codex'
    return {
      variant,
      hidden: { title, updated: `${title} Revised` },
      files: {
        'books.json': '[]\n',
        'server.test.mjs': `import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
test('books store file exists', () => { assert.equal(existsSync('books.json'), true) })
test('server source implements POST', () => { assert.match(readFileSync(new URL('./server.mjs', import.meta.url), 'utf8'), /POST/) })
`,
      },
    }
  }
  if (benchmark.benchmarkId === 'GRAD-C-BACKEND-V3') {
    return {
      variant,
      hidden: { first: 12, second: -5, balance: 7 },
      files: {
        'ledger.json': '[]\n',
        'server.test.mjs': `import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
test('ledger store file exists', () => { assert.equal(existsSync('ledger.json'), true) })
test('server source implements POST', () => { assert.match(readFileSync(new URL('./server.mjs', import.meta.url), 'utf8'), /POST/) })
`,
      },
    }
  }
  if (benchmark.benchmarkId === 'GRAD-I-FEATURE-V2') {
    const hiddenRows = [
      { name: 'remo', amount: 5 },
      { name: 'lia', amount: 6 },
      { name: 'kade', amount: 9 },
    ]
    return {
      variant,
      hidden: { unique: 3, total: 20, rows: JSON.stringify(hiddenRows) },
      files: {
        'report.json': JSON.stringify([{ name: 'ada', amount: 4 }, { name: 'nia', amount: 7 }, { name: 'ada', amount: 0 }], null, 2) + '\n',
        'src/report.mjs': `import { readFileSync } from 'node:fs'
const file = new URL('../report.json', import.meta.url)
export function loadRows() { return JSON.parse(readFileSync(file, 'utf8')) }
export function rowCount() { return loadRows().length }
`,
        'src/cli.mjs': `import { rowCount } from './report.mjs'
const args = process.argv.slice(2)
if (args[0] === '--help' || args.length === 0) { console.log('Usage: --help | --rows'); process.exit(0) }
if (args[0] === '--rows') { console.log('ROW_COUNT=' + rowCount()); process.exit(0) }
console.error('invalid'); process.exit(2)
`,
        'src/report.test.mjs': `import test from 'node:test'
import assert from 'node:assert/strict'
import { rowCount } from './report.mjs'
test('rows counted', () => { assert.equal(rowCount(), 3) })
`,
      },
    }
  }
  return null
}

export function publicD3Brief(benchmark: FoundryEngineeringBenchmark): string | null {
  if (benchmark.benchmarkId === 'GRAD-H-TEST-REPAIR-V1') {
    return [
      'Inspect src/price.mjs and src/price.test.mjs. Some tests fail because product code and a test expectation disagree.',
      'Required formula: invoiceTotal(list, discountPct, taxPct) MUST return Math.round((list * (1 - discountPct / 100)) * (1 + taxPct / 100)). Example: invoiceTotal(100, 10, 10) is 99. Use Math.round so integer tests pass; 90 * 1.1 is not exactly 99 in IEEE float.',
      'Replace the current body that adds tax to the original list. Then file.write src/price.test.mjs so every assertion matches that formula. Keep tests whose expected values already match. If a test expects a different number, that expectation is stale — change only that expected number. Do not skip tests. Do not make assertions always true.',
    ].join(' ')
  }
  if (benchmark.benchmarkId === 'GRAD-H-TEST-REPAIR-V2') {
    return [
      'Inspect src/parse.mjs and src/parse.test.mjs. Some tests fail because product code and a test expectation disagree.',
      'parseAge(raw) MUST return Number(raw) only when the entire string matches /^\\d+$/ (backslash-d, meaning digits 0-9). Do not write =d+ or parseInt. Example: parseAge("21")===21, parseAge("08")===8, parseAge("12px")===null, parseAge("x")===null.',
      'FIRST file.write path=src/parse.mjs with that implementation. THEN file.write path=src/parse.test.mjs: keep parseAge("21")===21; change the stale expected value for 12px from 12 to null. Do not skip tests. Do not delete the whole-number test.',
    ].join(' ')
  }
  if (benchmark.benchmarkId === 'GRAD-H-TEST-REPAIR-V3') {
    return [
      'Inspect src/tokens.mjs, src/join.mjs, and src/join.test.mjs. Multi-file module. Some tests fail.',
      'tokenize already splits on whitespace — keep it. joinTokens(parts) MUST return parts.join(",") e.g. joinTokens(["a","b"]) === "a,b". The current join("") concatenation is wrong.',
      'Then file.write path=src/join.mjs with join(",") and file.write path=src/join.test.mjs so every assertion matches commas. Keep the tokenize test. If a test expects "ab" with no comma, that expectation is stale — change only that expected string. Do not skip tests. Do not keep two contradictory join expectations.',
    ].join(' ')
  }
  if (benchmark.benchmarkId === 'GRAD-D-FULLSTACK-V1') {
    return [
      'The local check-in API in server.mjs already listens and implements GET /health, GET /checkins, POST /checkins with name validation and checkins.json persistence. Do not rewrite server.mjs unless it is broken.',
      'Repair app.js createDesk(baseUrl). Replace "/wrong" with "/checkins". async checkIn(name) MUST: POST JSON { name } to baseUrl+"/checkins"; if status 400 set lastError and return null; then GET baseUrl+"/checkins", assign JSON array to this.lastList, return this.lastList.',
      'Keep app.test.mjs. file.write path=app.js. Localhost only.',
    ].join(' ')
  }
  if (benchmark.benchmarkId === 'GRAD-D-FULLSTACK-V2') {
    return [
      'The local scoreboard API in server.mjs already implements GET /health, GET /leaders (sorted), POST /score with player validation and scores.json persistence. Do not rewrite server.mjs unless it is broken.',
      'Repair app.js createBoard(baseUrl). Replace "/wrong" with "/score". async addScore(player, points) MUST POST JSON { player, points } then GET /leaders into this.lastLeaders. async leaders() returns lastLeaders.',
      'Keep app.test.mjs. file.write path=app.js.',
    ].join(' ')
  }
  if (benchmark.benchmarkId === 'GRAD-C-BACKEND-V2') {
    return [
      'Build a REST-style Node HTTP API in server.mjs as an ES module. Do not use require(). FIRST ACTION: file.write path=server.mjs. Keep it compact. Do not only run tests.',
      'Listen on 127.0.0.1 with port = Number(process.env.PORT || 0). You MUST print the bound port from server.address().port: const addr = server.address(); if (addr && typeof addr === "object") console.log("PORT=" + addr.port);',
      'GET /health 200 { ok: true }. GET /books 200 array from books.json. POST /books JSON {title}: missing title 400 {error:"title required"}; else append {id,title}, persist, 201. GET /books/:id 200 or 404. PUT /books/:id updates title or 404. DELETE /books/:id 204 or 404. Else 404 {error:"not found"}.',
      'Read POST/PUT body via req on data/end. Use node:http and fs readFileSync/writeFileSync. Keep server.test.mjs.',
    ].join(' ')
  }
  if (benchmark.benchmarkId === 'GRAD-C-BACKEND-V3') {
    return [
      'Build a REST-style Node HTTP API in server.mjs as an ES module. Do not use require(). FIRST ACTION: file.write path=server.mjs. Keep it compact. Do not only run tests.',
      'Listen on 127.0.0.1 with port = Number(process.env.PORT || 0). Print PORT=server.address().port after listen.',
      'Persist ledger.json array of {id,amount}. Every branch MUST check req.method. Do not write if (req.url === "/txns") without method — that makes POST return the GET list.',
      'GET /health 200 {ok:true}. GET /txns 200 array. POST /txns JSON {amount}: if typeof amount !== "number" or not finite then 400 {error:"amount required"}; else append {id:String, amount}, persist, 201. Use string ids so GET /txns/:id matches. GET /balance 200 {balance} as sum of amounts. Else 404.',
      'Read POST body via req on data/end. Do not hardcode the balance. Keep server.test.mjs.',
    ].join(' ')
  }
  if (benchmark.benchmarkId === 'GRAD-I-FEATURE-V2') {
    return [
      'This report CLI already supports --help and --rows using src/report.mjs + src/cli.mjs.',
      'Preserve --rows ROW_COUNT. Add uniqueNames() and totalAmount() in src/report.mjs.',
      'Import them in src/cli.mjs. --unique prints UNIQUE=<distinct name count>. --total prints TOTAL=<sum of amount>. Unknown flags still exit 2.',
      'Keep existing rows test. Do not hardcode hidden totals.',
    ].join(' ')
  }
  return null
}
