/**
 * Mission 10 distinct model-driven fixtures.
 * Not Mission 08/09 greeting-sum / increment-email / one-line add clones.
 * Hidden oracles stay outside the project workspace. No reference solutions.
 */
import { createHash } from 'node:crypto'
import type {
  FoundryEngineeringBenchmark,
  FoundryEngineeringProjectClass,
  FoundryGraduationCriterion,
  FoundryGraduationFixtureIdentity,
} from './foundryEngineeringGraduationTypes'
import { FOUNDRY_MODEL_DRIVEN_BUDGET } from './foundryEngineeringGraduationTypes'
import type { GraduationFixtureMaterial } from './foundryEngineeringGraduationFixtures'

function criterion(id: string, description: string, verificationType: string, expectedOutcome: string, required = true): FoundryGraduationCriterion {
  return { criterionId: id, description, required, verificationType, expectedOutcome }
}

export function hashCanonical(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function fixtureIdentityFor(
  benchmark: FoundryEngineeringBenchmark,
  hidden: Record<string, string | number | boolean>,
  variant = 'v1',
): FoundryGraduationFixtureIdentity {
  return {
    fixtureId: `${benchmark.benchmarkId}:${variant}`,
    fixtureFamily: benchmark.projectClass,
    variationHash: hashCanonical({
      benchmarkId: benchmark.benchmarkId,
      startingFixture: benchmark.startingFixture,
      writeSet: benchmark.writeSet,
      expectedArtifacts: benchmark.expectedArtifacts,
      variationKeys: benchmark.variationKeys,
    }),
    requirementsHash: hashCanonical({
      prompt: benchmark.missionPrompt,
      criteria: benchmark.acceptanceCriteria.map(item => ({
        id: item.criterionId,
        description: item.description,
        expected: item.expectedOutcome,
      })),
    }),
    hiddenOracleHash: hashCanonical({
      keys: Object.keys(hidden).sort(),
      values: hidden,
    }),
  }
}

export function modelDrivenMultiFixtureBenchmarks(): FoundryEngineeringBenchmark[] {
  return [
    {
      benchmarkId: 'GRAD-E-CLI-V2',
      letter: 'U',
      projectClass: 'CLI_TOOL',
      difficulty: 'D1',
      language: 'javascript',
      runtime: 'node',
      environment: 'local-disposable',
      startingFixture: 'json-convert-cli',
      missionPrompt: 'Build a Node CLI that converts records.json line totals (price * qty) into output.json and prints inventory stats. Not a greeting/sum CLI.',
      acceptanceCriteria: [
        criterion('U1', '--help prints usage', 'CLI', 'Usage'),
        criterion('U2', '--convert writes line totals and grand', 'FILE', 'output.json grand'),
        criterion('U3', '--stats prints COUNT and TOTAL matching hidden records', 'CLI', 'hidden stats'),
        criterion('U4', 'invalid input exits 2', 'CLI', 'exit 2'),
        criterion('U5', 'success exits 0', 'CLI', 'exit 0'),
        criterion('U6', 'tests exist and pass', 'TEST', 'node --test'),
      ],
      forbiddenShortcuts: ['hardcode the hidden grand total', 'read hidden oracle files'],
      timeoutMs: 30_000,
      resourceBudget: FOUNDRY_MODEL_DRIVEN_BUDGET,
      expectedArtifacts: ['cli.mjs', 'records.json', 'cli.test.mjs'],
      expectedTests: ['cli.test.mjs'],
      independentVerifier: 'verifyCliConvert',
      writeSet: ['cli.mjs', 'records.json', 'cli.test.mjs', 'output.json'],
      outOfScopePaths: ['.foundry-expected.json'],
      networkRequired: false,
      suite: 'full',
      variationKeys: ['sku', 'price', 'qty'],
    },
    {
      benchmarkId: 'GRAD-E-CLI-V3',
      letter: 'V',
      projectClass: 'CLI_TOOL',
      difficulty: 'D2',
      language: 'javascript',
      runtime: 'node',
      environment: 'local-disposable',
      startingFixture: 'csv-stats-cli',
      missionPrompt: 'Build a Node CLI that reads sample.csv and reports max score, floor mean, and case-insensitive name filter counts. Not a greeting/sum or JSON convert CLI.',
      acceptanceCriteria: [
        criterion('V1', '--help prints usage', 'CLI', 'Usage'),
        criterion('V2', '--max prints the maximum score', 'CLI', 'hidden max'),
        criterion('V3', '--mean prints Math.floor of the average score', 'CLI', 'hidden mean'),
        criterion('V4', '--filter NAME prints MATCHES=<count>', 'CLI', 'hidden matches'),
        criterion('V5', 'invalid input exits 2', 'CLI', 'exit 2'),
        criterion('V6', 'tests exist and pass', 'TEST', 'node --test'),
      ],
      forbiddenShortcuts: ['hardcode hidden max/mean', 'read hidden oracle files'],
      timeoutMs: 30_000,
      resourceBudget: FOUNDRY_MODEL_DRIVEN_BUDGET,
      expectedArtifacts: ['cli.mjs', 'sample.csv', 'cli.test.mjs'],
      expectedTests: ['cli.test.mjs'],
      independentVerifier: 'verifyCliCsv',
      writeSet: ['cli.mjs', 'sample.csv', 'cli.test.mjs'],
      outOfScopePaths: ['.foundry-expected.json'],
      networkRequired: false,
      suite: 'full',
      variationKeys: ['rows', 'filterName'],
    },
    {
      benchmarkId: 'GRAD-G-BUGFIX-V2',
      letter: 'W',
      projectClass: 'BUG_FIX',
      difficulty: 'D2',
      language: 'javascript',
      runtime: 'node',
      environment: 'local-disposable',
      startingFixture: 'off-by-one-window',
      missionPrompt: 'Inspect this list helper, diagnose the failing first-N behavior, and repair it. Preserve keepPositive. Do not be told the faulty line.',
      acceptanceCriteria: [
        criterion('W1', 'firstN returns the first n items', 'RUNTIME', 'hidden window'),
        criterion('W2', 'keepPositive unchanged', 'RUNTIME', 'positives kept'),
        criterion('W3', 'project tests pass', 'TEST', 'node --test'),
      ],
      forbiddenShortcuts: ['edit hidden oracle', 'change keepPositive instead of firstN'],
      timeoutMs: 30_000,
      resourceBudget: FOUNDRY_MODEL_DRIVEN_BUDGET,
      expectedArtifacts: ['src/window.mjs', 'src/window.test.mjs'],
      expectedTests: ['src/window.test.mjs'],
      independentVerifier: 'verifyBugFixWindow',
      writeSet: ['src/window.mjs', 'src/window.test.mjs'],
      outOfScopePaths: ['.foundry-expected.json'],
      networkRequired: false,
      suite: 'full',
      variationKeys: ['windowN'],
    },
    {
      benchmarkId: 'GRAD-G-BUGFIX-V3',
      letter: 'X',
      projectClass: 'BUG_FIX',
      difficulty: 'D3',
      language: 'javascript',
      runtime: 'node',
      environment: 'local-disposable',
      startingFixture: 'catalog-quote-mismatch',
      missionPrompt: 'A quote helper looks up catalog items and multiplies price by qty. Something in this multi-file module is wrong. Diagnose the interaction and repair it. Preserve unknown-id → null. Do not be told the faulty line.',
      acceptanceCriteria: [
        criterion('X1', 'quote by hidden id returns price * qty', 'RUNTIME', 'hidden quote'),
        criterion('X2', 'unknown id still returns null', 'RUNTIME', 'null'),
        criterion('X3', 'project tests pass', 'TEST', 'node --test'),
      ],
      forbiddenShortcuts: ['edit hidden oracle', 'lookup by name instead of id'],
      timeoutMs: 30_000,
      resourceBudget: FOUNDRY_MODEL_DRIVEN_BUDGET,
      expectedArtifacts: ['src/catalog.mjs', 'src/quote.mjs', 'src/quote.test.mjs'],
      expectedTests: ['src/quote.test.mjs'],
      independentVerifier: 'verifyBugFixQuote',
      writeSet: ['src/catalog.mjs', 'src/quote.mjs', 'src/quote.test.mjs'],
      outOfScopePaths: ['.foundry-expected.json'],
      networkRequired: false,
      suite: 'full',
      variationKeys: ['productId', 'qty'],
    },
    {
      benchmarkId: 'GRAD-B-FRONTEND-V2',
      letter: 'Y',
      projectClass: 'FRONTEND_APP',
      difficulty: 'D2',
      language: 'javascript',
      framework: 'vanilla',
      runtime: 'node',
      environment: 'local-disposable',
      startingFixture: 'filterable-catalog',
      missionPrompt: 'Repair createCatalog so visible items filter by name query and select toggles selection. Not a counter/email form.',
      acceptanceCriteria: [
        criterion('Y1', 'filter by query returns matching names', 'RUNTIME', 'hidden query'),
        criterion('Y2', 'empty query shows all items', 'RUNTIME', 'all visible'),
        criterion('Y3', 'select toggles selected ids', 'RUNTIME', 'selectedCount'),
        criterion('Y4', 'createCatalog is exported', 'FILE', 'export'),
        criterion('Y5', 'module imports', 'RUNTIME', 'node import succeeds'),
      ],
      forbiddenShortcuts: ['always return all items from visible', 'fake selectedCount'],
      timeoutMs: 30_000,
      resourceBudget: FOUNDRY_MODEL_DRIVEN_BUDGET,
      expectedArtifacts: ['index.html', 'app.js'],
      expectedTests: ['app.test.mjs'],
      independentVerifier: 'verifyFrontendCatalog',
      writeSet: ['index.html', 'app.js', 'app.test.mjs'],
      outOfScopePaths: ['server.js'],
      networkRequired: false,
      suite: 'full',
      variationKeys: ['query'],
    },
    {
      benchmarkId: 'GRAD-B-FRONTEND-V3',
      letter: 'Z',
      projectClass: 'FRONTEND_APP',
      difficulty: 'D3',
      language: 'javascript',
      framework: 'vanilla',
      runtime: 'node',
      environment: 'local-disposable',
      startingFixture: 'shop-tabs-cart',
      missionPrompt: 'Repair createShop: tab switching, add-to-cart quantities, derived cartTotal from prices, checkout that returns the total then clears the cart. Multiple interacting behaviors. Not a counter/email or filterable-list clone.',
      acceptanceCriteria: [
        criterion('Z1', 'setTab changes tab', 'RUNTIME', 'cart tab'),
        criterion('Z2', 'add increments quantity for a sku', 'RUNTIME', 'qty'),
        criterion('Z3', 'cartTotal uses hidden prices * qty', 'RUNTIME', 'hidden total'),
        criterion('Z4', 'checkout returns total then clears; empty cart checkout is null', 'RUNTIME', 'checkout'),
        criterion('Z5', 'createShop exported and imports', 'RUNTIME', 'export'),
      ],
      forbiddenShortcuts: ['hardcode cartTotal', 'checkout without clearing', 'static fake interaction output'],
      timeoutMs: 30_000,
      resourceBudget: FOUNDRY_MODEL_DRIVEN_BUDGET,
      expectedArtifacts: ['index.html', 'app.js'],
      expectedTests: ['app.test.mjs'],
      independentVerifier: 'verifyFrontendShop',
      writeSet: ['index.html', 'app.js', 'app.test.mjs'],
      outOfScopePaths: ['server.js'],
      networkRequired: false,
      suite: 'full',
      variationKeys: ['sku', 'qty'],
    },
    {
      benchmarkId: 'GRAD-I-FEATURE-D3',
      letter: 'FE',
      projectClass: 'FEATURE_EXTENSION' as FoundryEngineeringProjectClass,
      difficulty: 'D3',
      language: 'javascript',
      runtime: 'node',
      environment: 'local-disposable',
      startingFixture: 'inventory-cli-list-add',
      missionPrompt: 'Extend the existing inventory CLI. Preserve --list and --add. Add --remove NAME and --count across src/inventory.mjs and src/cli.mjs. Update tests without weakening existing list/add coverage.',
      acceptanceCriteria: [
        criterion('FE1', 'existing --list still prints items', 'CLI', 'list preserved'),
        criterion('FE2', 'existing --add still appends', 'CLI', 'add preserved'),
        criterion('FE3', '--remove deletes the hidden name', 'CLI', 'hidden remove'),
        criterion('FE4', '--count prints COUNT=<n> after hidden mutation', 'CLI', 'hidden count'),
        criterion('FE5', 'tests pass and still assert list/add', 'TEST', 'node --test'),
      ],
      forbiddenShortcuts: ['break --list or --add', 'delete existing tests', 'hardcode hidden count'],
      timeoutMs: 45_000,
      resourceBudget: FOUNDRY_MODEL_DRIVEN_BUDGET,
      expectedArtifacts: ['src/cli.mjs', 'src/inventory.mjs', 'src/inventory.test.mjs', 'inventory.json'],
      expectedTests: ['src/inventory.test.mjs'],
      independentVerifier: 'verifyFeatureD3',
      writeSet: ['src/cli.mjs', 'src/inventory.mjs', 'src/inventory.test.mjs', 'inventory.json'],
      outOfScopePaths: ['.foundry-expected.json', 'analytics.js'],
      networkRequired: false,
      suite: 'full',
      variationKeys: ['removeName'],
    },
  ]
}

export function seedMultiFixture(benchmark: FoundryEngineeringBenchmark, variant = 'v1'): GraduationFixtureMaterial | null {
  if (benchmark.benchmarkId === 'GRAD-E-CLI-V2') {
    const publicRows = [
      { sku: 'A', price: 4, qty: 3 },
      { sku: 'B', price: 2, qty: 5 },
    ]
    const hiddenRows = [
      { sku: 'HX', price: 9, qty: 4 },
      { sku: 'HY', price: 3, qty: 7 },
    ]
    const grand = hiddenRows.reduce((sum, row) => sum + row.price * row.qty, 0)
    return {
      variant,
      hidden: { grand, count: hiddenRows.length, rows: JSON.stringify(hiddenRows) },
      files: {
        'records.json': JSON.stringify({ rows: publicRows }, null, 2) + '\n',
        'cli.test.mjs': `import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
test('help', () => {
  const r = spawnSync(process.execPath, ['cli.mjs', '--help'], { encoding: 'utf8' })
  assert.equal(r.status, 0)
  assert.match(r.stdout, /Usage/i)
})
`,
      },
    }
  }
  if (benchmark.benchmarkId === 'GRAD-E-CLI-V3') {
    const publicCsv = 'name,score\nada,10\nnia,7\nada,5\n'
    const hiddenCsv = 'name,score\nremo,18\nlia,4\nremo,8\nlia,2\n'
    const scores = [18, 4, 8, 2]
    const max = Math.max(...scores)
    const mean = Math.floor(scores.reduce((a, b) => a + b, 0) / scores.length)
    return {
      variant,
      hidden: { max, mean, filterName: 'remo', matches: 2, csv: hiddenCsv },
      files: {
        'sample.csv': publicCsv,
        'cli.test.mjs': `import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
test('help', () => {
  const r = spawnSync(process.execPath, ['cli.mjs', '--help'], { encoding: 'utf8' })
  assert.equal(r.status, 0)
  assert.match(r.stdout, /Usage/i)
})
`,
      },
    }
  }
  if (benchmark.benchmarkId === 'GRAD-G-BUGFIX-V2') {
    const items = variant === 'v2' ? [2, 4, 6, 8, 10] : [10, 20, 30, 40, 50]
    const n = 3
    return {
      variant,
      hidden: { items: items.join(','), n, expected: items.slice(0, n).join(',') },
      files: {
        'src/window.mjs': 'export function firstN(items, n) { return items.slice(0, n - 1) }\nexport function keepPositive(nums) { return nums.filter(n => n > 0) }\n',
        'src/window.test.mjs': "import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport { keepPositive } from './window.mjs'\ntest('keepPositive', () => { assert.deepEqual(keepPositive([-1, 2, 0, 4]), [2, 4]) })\n",
      },
    }
  }
  if (benchmark.benchmarkId === 'GRAD-G-BUGFIX-V3') {
    return {
      variant,
      hidden: { productId: 'p1', qty: 4, expected: 20 },
      files: {
        'src/catalog.mjs': "export const items = [\n  { id: 'p1', name: 'Bolt', price: 5 },\n  { id: 'p2', name: 'Nut', price: 2 },\n]\nexport function findById(id) { return items.find(item => item.name === id) }\n",
        'src/quote.mjs': "import { findById } from './catalog.mjs'\nexport function quote(id, qty) {\n  const item = findById(id)\n  if (!item) return null\n  return item.price * qty\n}\n",
        'src/quote.test.mjs': "import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport { quote } from './quote.mjs'\ntest('unknown id is null', () => { assert.equal(quote('nope', 1), null) })\n",
      },
    }
  }
  if (benchmark.benchmarkId === 'GRAD-B-FRONTEND-V2') {
    return {
      variant,
      hidden: { query: 'amm', match: 'Gamma' },
      files: {
        'index.html': '<!doctype html><html><body><div id="root"></div><script type="module" src="./app.js"></script></body></html>\n',
        'app.js': `export function createCatalog(items = [
  { id: 'a', name: 'Alpha' },
  { id: 'b', name: 'Beta' },
  { id: 'c', name: 'Gamma' },
]) {
  return {
    items,
    query: '',
    selected: [],
    filter(q) { this.query = String(q); return this.visible() },
    visible() { return this.items },
    select(id) { return this.selected },
    selectedCount() { return this.selected.length },
  }
}
`,
      },
    }
  }
  if (benchmark.benchmarkId === 'GRAD-B-FRONTEND-V3') {
    return {
      variant,
      hidden: { sku: 'c', qty: 2, total: 22 },
      files: {
        'index.html': '<!doctype html><html><body><div id="root"></div><script type="module" src="./app.js"></script></body></html>\n',
        'app.js': `export function createShop() {
  return {
    tab: 'browse',
    prices: { a: 3, b: 7, c: 11 },
    cart: {},
    setTab(tab) { return this.tab },
    add(sku) { return 0 },
    cartTotal() { return 0 },
    checkout() { return 0 },
  }
}
`,
      },
    }
  }
  if (benchmark.benchmarkId === 'GRAD-I-FEATURE-D3') {
    const removeName = variant === 'v2' ? 'hidden-clamp' : 'hidden-gasket'
    return {
      variant,
      hidden: { removeName, remaining: 'lamp' },
      files: {
        'inventory.json': JSON.stringify([{ name: 'lamp' }], null, 2) + '\n',
        'src/inventory.mjs': `import { readFileSync, writeFileSync } from 'node:fs'
const file = new URL('../inventory.json', import.meta.url)
export function load() { return JSON.parse(readFileSync(file, 'utf8')) }
export function save(items) { writeFileSync(file, JSON.stringify(items, null, 2) + '\\n') }
export function listItems() { return load() }
export function addItem(name) {
  const items = load()
  items.push({ name: String(name) })
  save(items)
  return items
}
`,
        'src/cli.mjs': `import { listItems, addItem } from './inventory.mjs'
const args = process.argv.slice(2)
if (args[0] === '--help' || args.length === 0) { console.log('Usage: --help | --list | --add NAME'); process.exit(0) }
if (args[0] === '--list') { for (const item of listItems()) console.log(item.name); process.exit(0) }
if (args[0] === '--add') {
  if (!args[1]) { console.error('name required'); process.exit(2) }
  addItem(args[1]); process.exit(0)
}
console.error('invalid'); process.exit(2)
`,
        'src/inventory.test.mjs': `import test from 'node:test'
import assert from 'node:assert/strict'
import { listItems, addItem } from './inventory.mjs'
test('list has lamp', () => { assert.equal(listItems()[0].name, 'lamp') })
test('add appends', () => { const items = addItem('washer'); assert.equal(items.at(-1).name, 'washer') })
`,
      },
    }
  }
  return null
}

export function publicMultiFixtureBrief(benchmark: FoundryEngineeringBenchmark): string | null {
  if (benchmark.benchmarkId === 'GRAD-E-CLI-V2') {
    return [
      'Build a Node ES-module CLI in cli.mjs. Do not use require() or __dirname.',
      'Read records.json with: import { readFileSync, writeFileSync } from "node:fs"; const data = JSON.parse(readFileSync(new URL("./records.json", import.meta.url), "utf8")); Shape: { rows: [{ sku, price, qty }] }.',
      '--help prints Usage and exits 0.',
      '--convert must write output.json (not only stdout) as { lines: [{ sku, total }] , grand } where total = price * qty and grand is the sum of totals. Exit 0.',
      '--stats prints COUNT=<rowCount> TOTAL=<grand> using the same formula. Exit 0.',
      'Unknown flags such as --nope MUST call process.exit(2). Do not default to exit 0. Do not hardcode totals.',
      'Unknown flags exit 2. Do not hardcode totals.',
      'cli.test.mjs already exists with the required node:test imports. Keep those imports. You may add more tests that only use spawnSync(process.execPath, ..., { encoding:"utf8" }). Do not use undeclared readFileSync in tests.',
    ].join(' ')
  }
  if (benchmark.benchmarkId === 'GRAD-E-CLI-V3') {
    return [
      'Build a Node ES-module CLI in cli.mjs. Do not use require() or __dirname.',
      'Read sample.csv with: import { readFileSync } from "node:fs"; const text = readFileSync(new URL("./sample.csv", import.meta.url), "utf8");',
      'Parse CSV carefully: const rows = text.trim().split(/\\r?\\n/).slice(1).filter(line => line.includes(",")); then name and score from line.split(","). Use Number(score). Skip blank lines so scores are not NaN.',
      '--help prints Usage and exits 0.',
      '--max prints the maximum score as an integer and exits 0.',
      '--mean prints Math.floor of the average score and exits 0.',
      '--filter NAME prints MATCHES=<count> of case-insensitive name matches and exits 0.',
      'Unknown flags exit 2. Do not hardcode answers.',
      'cli.test.mjs already exists with node:test imports. Keep those imports. Extra tests may use only spawnSync with encoding utf8.',
    ].join(' ')
  }
  if (benchmark.benchmarkId === 'GRAD-G-BUGFIX-V2') {
    return [
      'Inspect src/window.mjs. Diagnose the failing first-N list behavior and repair it.',
      'keepPositive must remain: numbers strictly greater than 0. Keep and pass src/window.test.mjs.',
      'Do not be told the faulty line. Do not edit files outside the write set.',
    ].join(' ')
  }
  if (benchmark.benchmarkId === 'GRAD-G-BUGFIX-V3') {
    return [
      'Inspect src/catalog.mjs and src/quote.mjs. quote(id, qty) must return price * qty for a real id and null for unknown ids.',
      'This is a multi-file interaction bug. Preserve the unknown-id test. Do not be told the faulty line.',
    ].join(' ')
  }
  if (benchmark.benchmarkId === 'GRAD-B-FRONTEND-V2') {
    return [
      'Repair createCatalog() in app.js.',
      'filter(query) stores the query and visible() returns items whose name contains the query case-insensitively. Empty query shows all items.',
      'select(id) toggles id in selected (array of ids). selectedCount() returns selected.length.',
      'Do not always return all items from visible. Export createCatalog. Tests may be added in app.test.mjs.',
    ].join(' ')
  }
  if (benchmark.benchmarkId === 'GRAD-B-FRONTEND-V3') {
    return [
      'Repair createShop() in app.js.',
      'prices: { a: 3, b: 7, c: 11 }. setTab(tab) sets this.tab and returns it.',
      'add(sku) increments cart[sku] and returns the new quantity.',
      'cartTotal() returns sum of prices[sku] * qty for cart entries.',
      'checkout() returns null if cartTotal is 0; otherwise returns the total, then clears cart to {}.',
      'Do not hardcode totals. Do not fake interactions with static output. Export createShop.',
    ].join(' ')
  }
  if (benchmark.benchmarkId === 'GRAD-I-FEATURE-D3') {
    return [
      'This inventory CLI already supports --help, --list, and --add NAME using src/inventory.mjs + src/cli.mjs.',
      'Preserve --list and --add. Add export function removeItem(name) in src/inventory.mjs that deletes matching name and save().',
      'In src/cli.mjs you MUST import removeItem: import { listItems, addItem, removeItem } from "./inventory.mjs".',
      'Add --remove NAME that calls removeItem(args[1]) and exits 0. Add --count that prints COUNT=<n> using listItems().length and exits 0.',
      'Keep existing list/add tests; extend tests for remove/count. Unknown flags still exit 2.',
      'Do not break existing lamp inventory behavior.',
    ].join(' ')
  }
  if (benchmark.benchmarkId === 'GRAD-C-BACKEND') {
    return [
      'Build a REST-style Node HTTP API in server.mjs as an ES module. Do not use require().',
      'Listen on 127.0.0.1 with port = Number(process.env.PORT || 0). PORT 0 means ephemeral: you MUST print the bound port from server.address().port, NOT process.env.PORT.',
      'Required listen callback: const addr = server.address(); if (addr && typeof addr === "object") console.log("PORT=" + addr.port);',
      'GET /health → 200 JSON { ok: true }.',
      'GET /items → 200 JSON array from data.json.',
      'POST /items with JSON body: if name missing, 400 JSON { error: "name required" }. If valid, append { id, name }, persist data.json, 201 JSON item.',
      'Unknown routes → 404 JSON { error: "not found" }. Invalid JSON → 400.',
      'Use node:http and fs readFileSync/writeFileSync. Localhost only. No Express unless you fully implement the same behavior.',
    ].join(' ')
  }
  return null
}
