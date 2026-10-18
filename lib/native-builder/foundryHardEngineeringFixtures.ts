/**
 * Mission 12 hard-engineering fixtures: FULL_STACK V3 plus DATABASE, DESKTOP,
 * LEGACY, REFACTOR, DATA_PROCESSING, LIBRARY_PACKAGE.
 * Distinct from Missions 08–11 catalogs. Hidden oracles stay outside the workspace.
 * No reference solutions.
 */
import type {
  FoundryEngineeringBenchmark,
  FoundryGraduationCriterion,
} from './foundryEngineeringGraduationTypes'
import { FOUNDRY_MODEL_DRIVEN_BUDGET, FOUNDRY_MODEL_DRIVEN_D3_BUDGET } from './foundryEngineeringGraduationTypes'
import type { GraduationFixtureMaterial } from './foundryEngineeringGraduationFixtures'

function criterion(id: string, description: string, verificationType: string, expectedOutcome: string, required = true): FoundryGraduationCriterion {
  return { criterionId: id, description, required, verificationType, expectedOutcome }
}

const HTTP_SHIFT_SERVER = `import http from 'node:http'
import { readFileSync, writeFileSync } from 'node:fs'

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}
function load() { return JSON.parse(readFileSync(new URL('./shifts.json', import.meta.url), 'utf8')) }
function save(items) { writeFileSync(new URL('./shifts.json', import.meta.url), JSON.stringify(items) + '\\n') }

const server = http.createServer((req, res) => {
  const url = req.url || '/'
  if (req.method === 'GET' && url === '/health') return send(res, 200, { ok: true })
  if (req.method === 'GET' && url === '/shifts') return send(res, 200, load())
  if (req.method === 'POST' && url === '/shifts') {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}')
        if (!parsed.worker || !parsed.slot) return send(res, 400, { error: 'worker required' })
        const items = load()
        const item = { id: 's' + (items.length + 1), worker: String(parsed.worker), slot: String(parsed.slot) }
        items.push(item)
        save(items)
        return send(res, 201, item)
      } catch {
        return send(res, 400, { error: 'invalid json' })
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

const DESKTOP_SAVE = `const fs = require('fs')
const path = require('path')
function saveNote(title, body) {
  fs.writeFileSync(path.join(process.cwd(), 'wrong.json'), JSON.stringify([{ title: title, body: body }]) + '\\n')
  return true
}
module.exports = { saveNote }
`

const DESKTOP_MAIN = `const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const { saveNote } = require('./save')

app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu')
app.disableHardwareAcceleration()
const mark = process.argv.includes('--mark') ? process.argv[process.argv.indexOf('--mark') + 1] : 'desk'
app.setPath('userData', path.join(process.cwd(), '.edata-' + mark))

function createWindow() {
  const win = new BrowserWindow({
    show: false,
    width: 420,
    height: 280,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), sandbox: false, offscreen: true },
  })
  win.loadFile('index.html')
  console.log('WINDOW_READY')
  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
    const saveAt = process.argv.indexOf('--save')
    if (saveAt >= 0) {
      const ok = saveNote(process.argv[saveAt + 1] || 'untitled', process.argv[saveAt + 2] || '')
      console.log(ok ? 'SAVED=1' : 'SAVED=0')
    }
    setTimeout(() => app.quit(), 50)
  }
  win.webContents.once('did-finish-load', finish)
  win.webContents.on('render-process-gone', finish)
  setTimeout(finish, 1200)
}

app.whenReady().then(createWindow)
ipcMain.handle('save-note', (_e, title, body) => saveNote(title, body))
`

const DESKTOP_META = `const fs = require('fs')
const path = require('path')
function fileMeta(rel) {
  return { name: 'wrong', size: 0 }
}
module.exports = { fileMeta }
`

const DESKTOP_STAT_MAIN = `const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('fs')
const path = require('path')
const { fileMeta } = require('./meta')

app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu')
app.disableHardwareAcceleration()
const mark = process.argv.includes('--mark') ? process.argv[process.argv.indexOf('--mark') + 1] : 'meta'
app.setPath('userData', path.join(process.cwd(), '.edata-' + mark))

function createWindow() {
  const win = new BrowserWindow({
    show: false,
    width: 420,
    height: 280,
    webPreferences: { preload: path.join(__dirname, 'preload-meta.js'), sandbox: false, offscreen: true },
  })
  win.loadFile('index.html')
  console.log('WINDOW_READY')
  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
    const statAt = process.argv.indexOf('--stat')
    if (statAt >= 0) {
      const meta = fileMeta(process.argv[statAt + 1] || '')
      if (meta && typeof meta.size === 'number') {
        console.log('SIZE=' + meta.size)
        console.log('NAME=' + meta.name)
        fs.writeFileSync(path.join(process.cwd(), 'meta.json'), JSON.stringify(meta) + '\\n')
        console.log('STATED=1')
      } else {
        console.log('STATED=0')
      }
    }
    setTimeout(() => app.quit(), 50)
  }
  win.webContents.once('did-finish-load', finish)
  win.webContents.on('render-process-gone', finish)
  setTimeout(finish, 1200)
}

app.whenReady().then(createWindow)
ipcMain.handle('file-meta', (_e, rel) => fileMeta(rel))
`

export function hardEngineeringBenchmarks(): FoundryEngineeringBenchmark[] {
  return [
    {
      benchmarkId: 'GRAD-D-FULLSTACK-V3',
      letter: 'FW',
      projectClass: 'FULL_STACK_APP',
      difficulty: 'D3',
      language: 'javascript',
      framework: 'vanilla',
      runtime: 'node',
      environment: 'local-disposable',
      startingFixture: 'shift-roster',
      missionPrompt: 'Build a local shift roster: Node HTTP backend plus frontend client. UI bookShift posts worker+slot, backend persists, UI lastBoard reflects GET /shifts. Not a check-in desk or scoreboard.',
      acceptanceCriteria: [
        criterion('FW1', 'GET /health 200', 'HTTP', 'ok'),
        criterion('FW2', 'POST /shifts missing worker is 400', 'HTTP', '400'),
        criterion('FW3', 'UI bookShift persists hidden worker and lastBoard includes it', 'HTTP', 'integration'),
        criterion('FW4', 'GET /shifts lists the hidden worker', 'HTTP', 'list'),
        criterion('FW5', 'createRoster exported, fetch used, starter test still present', 'TEST', 'export + test'),
      ],
      forbiddenShortcuts: ['in-memory only', 'static fake lastBoard', 'read hidden oracle', 'cloud service'],
      timeoutMs: 60_000,
      resourceBudget: FOUNDRY_MODEL_DRIVEN_D3_BUDGET,
      expectedArtifacts: ['server.mjs', 'app.js', 'shifts.json', 'app.test.mjs'],
      expectedTests: ['app.test.mjs'],
      independentVerifier: 'verifyFullStackRoster',
      writeSet: ['server.mjs', 'app.js', 'shifts.json', 'app.test.mjs'],
      outOfScopePaths: ['.foundry-expected.json', '.env'],
      networkRequired: false,
      suite: 'fast',
      variationKeys: ['worker', 'slot'],
    },
    {
      benchmarkId: 'GRAD-DA-DATABASE-V1',
      letter: 'DA',
      projectClass: 'DATABASE_APP',
      difficulty: 'D2',
      language: 'javascript',
      runtime: 'node',
      environment: 'local-disposable',
      startingFixture: 'sqlite-parts-bin',
      missionPrompt: 'Implement a SQLite parts store with node:sqlite DatabaseSync on parts.db. Schema, insert, query, update, delete, unique sku, transaction rollback, persist across close.',
      acceptanceCriteria: [
        criterion('DA1', 'parts.db is a real SQLite file (header SQLite format 3)', 'FILE', 'sqlite header'),
        criterion('DA2', 'insert/query/update/delete work for hidden sku', 'NODE', 'crud'),
        criterion('DA3', 'duplicate sku is rejected', 'NODE', 'unique'),
        criterion('DA4', 'failed transaction rolls back', 'NODE', 'txn'),
        criterion('DA5', 'row survives process restart via independent DatabaseSync open', 'NODE', 'restart'),
        criterion('DA6', 'starter tests pass', 'TEST', 'node --test'),
      ],
      forbiddenShortcuts: [':memory: only', 'JSON pretending to be SQLite', 'in-memory-only state', 'read hidden oracle'],
      timeoutMs: 45_000,
      resourceBudget: FOUNDRY_MODEL_DRIVEN_BUDGET,
      expectedArtifacts: ['store.mjs', 'parts.db', 'store.test.mjs'],
      expectedTests: ['store.test.mjs'],
      independentVerifier: 'verifySqliteParts',
      writeSet: ['store.mjs', 'store.test.mjs', 'parts.db'],
      outOfScopePaths: ['.foundry-expected.json'],
      networkRequired: false,
      suite: 'fast',
      variationKeys: ['sku'],
    },
    {
      benchmarkId: 'GRAD-DA-DATABASE-V2',
      letter: 'DB',
      projectClass: 'DATABASE_APP',
      difficulty: 'D3',
      language: 'javascript',
      runtime: 'node',
      environment: 'local-disposable',
      startingFixture: 'sqlite-authors-books',
      missionPrompt: 'Implement related SQLite entities: authors and books with foreign keys, filter by author, and a year column migration. Persist catalog.db.',
      acceptanceCriteria: [
        criterion('DB1', 'catalog.db is a real SQLite file', 'FILE', 'sqlite header'),
        criterion('DB2', 'hidden author+book persist with FK', 'NODE', 'related insert'),
        criterion('DB3', 'invalid author_id is rejected when foreign_keys are on', 'NODE', 'fk'),
        criterion('DB4', 'booksByAuthor filters hidden author', 'NODE', 'filter'),
        criterion('DB5', 'migrate adds year and setYear persists across restart', 'NODE', 'schema evolution'),
        criterion('DB6', 'starter tests pass', 'TEST', 'node --test'),
      ],
      forbiddenShortcuts: [':memory: only', 'JSON pretending to be SQLite', 'skip foreign keys', 'read hidden oracle'],
      timeoutMs: 60_000,
      resourceBudget: FOUNDRY_MODEL_DRIVEN_D3_BUDGET,
      expectedArtifacts: ['catalog.mjs', 'catalog.db', 'catalog.test.mjs'],
      expectedTests: ['catalog.test.mjs'],
      independentVerifier: 'verifySqliteCatalog',
      writeSet: ['catalog.mjs', 'catalog.test.mjs', 'catalog.db'],
      outOfScopePaths: ['.foundry-expected.json'],
      networkRequired: false,
      suite: 'full',
      variationKeys: ['author', 'title'],
    },
    {
      benchmarkId: 'GRAD-DK-DESKTOP-V1',
      letter: 'DK',
      projectClass: 'DESKTOP_APP',
      difficulty: 'D2',
      language: 'javascript',
      framework: 'electron',
      runtime: 'node',
      environment: 'local-disposable',
      startingFixture: 'electron-sticky-note',
      missionPrompt: 'Repair the local Electron sticky-note app so saveNote persists notes.json, the hidden window loads, --save works, and the process exits cleanly. Electron only.',
      acceptanceCriteria: [
        criterion('DK1', 'Electron window loads and prints WINDOW_READY', 'PROCESS', 'window'),
        criterion('DK2', '--save writes hidden title into notes.json', 'FILE', 'persist'),
        criterion('DK3', 'ipcMain save-note handler remains wired', 'FILE', 'ipc'),
        criterion('DK4', 'process exits cleanly with no leftover Electron child', 'PROCESS', 'clean exit'),
        criterion('DK5', 'preload/index.html still present', 'FILE', 'ui files'),
      ],
      forbiddenShortcuts: ['skip Electron binary', 'orphan child process', 'cloud sync', 'read hidden oracle'],
      timeoutMs: 45_000,
      resourceBudget: FOUNDRY_MODEL_DRIVEN_BUDGET,
      expectedArtifacts: ['main.js', 'save.js', 'preload.js', 'index.html', 'notes.json', 'save.test.mjs'],
      expectedTests: ['save.test.mjs'],
      independentVerifier: 'verifyDesktopNotes',
      writeSet: ['save.js'],
      outOfScopePaths: ['.foundry-expected.json', '.env'],
      networkRequired: false,
      suite: 'full',
      variationKeys: ['title'],
    },
    {
      benchmarkId: 'GRAD-DK-DESKTOP-V2',
      letter: 'DL',
      projectClass: 'DESKTOP_APP',
      difficulty: 'D3',
      language: 'javascript',
      framework: 'electron',
      runtime: 'node',
      environment: 'local-disposable',
      startingFixture: 'electron-file-meta',
      missionPrompt: 'Repair the local Electron file-metadata viewer so fileMeta returns size and name, --stat prints SIZE/NAME, meta.json persists, and the process exits cleanly. Different from sticky notes.',
      acceptanceCriteria: [
        criterion('DL1', 'Electron window loads WINDOW_READY', 'PROCESS', 'window'),
        criterion('DL2', '--stat prints SIZE and NAME for the probe file', 'PROCESS', 'stat'),
        criterion('DL3', 'meta.json persisted with size and name', 'FILE', 'persist'),
        criterion('DL4', 'clean exit, no leftover Electron child', 'PROCESS', 'clean exit'),
        criterion('DL5', 'ipcMain file-meta handler remains wired', 'FILE', 'ipc'),
      ],
      forbiddenShortcuts: ['reuse notes.json app', 'orphan child process', 'skip Electron', 'read hidden oracle'],
      timeoutMs: 45_000,
      resourceBudget: FOUNDRY_MODEL_DRIVEN_D3_BUDGET,
      expectedArtifacts: ['main.js', 'meta.js', 'preload-meta.js', 'index.html', 'meta.json', 'meta.test.mjs'],
      expectedTests: ['meta.test.mjs'],
      independentVerifier: 'verifyDesktopMeta',
      writeSet: ['meta.js'],
      outOfScopePaths: ['.foundry-expected.json', '.env'],
      networkRequired: false,
      suite: 'full',
      variationKeys: ['fileName'],
    },
    {
      benchmarkId: 'GRAD-LV-LEGACY-V1',
      letter: 'LV',
      projectClass: 'LEGACY_CODE_MODIFICATION',
      difficulty: 'D2',
      language: 'javascript',
      runtime: 'node',
      environment: 'local-disposable',
      startingFixture: 'cjs-tally-util',
      missionPrompt: 'This older CommonJS util must keep var tally, label, and module.exports. Add tallyDiscount without rewriting the project.',
      acceptanceCriteria: [
        criterion('LV1', 'existing tally behavior preserved', 'NODE', 'tally'),
        criterion('LV2', 'existing label calling convention preserved (Item:name)', 'NODE', 'label'),
        criterion('LV3', 'tallyDiscount applies percent off qty total', 'NODE', 'new behavior'),
        criterion('LV4', 'lib/util.js still CommonJS with var tally and module.exports', 'FILE', 'no rewrite'),
        criterion('LV5', 'starter tests pass', 'TEST', 'node --test'),
      ],
      forbiddenShortcuts: ['rewrite to ESM', 'delete lib/util.js', 'rename public API', 'read hidden oracle'],
      timeoutMs: 40_000,
      resourceBudget: FOUNDRY_MODEL_DRIVEN_BUDGET,
      expectedArtifacts: ['lib/util.js', 'index.js', 'util.test.mjs'],
      expectedTests: ['util.test.mjs'],
      independentVerifier: 'verifyLegacyTally',
      writeSet: ['lib/util.js', 'index.js', 'util.test.mjs'],
      outOfScopePaths: ['.foundry-expected.json'],
      networkRequired: false,
      suite: 'fast',
      variationKeys: ['qty'],
    },
    {
      benchmarkId: 'GRAD-LV-LEGACY-V2',
      letter: 'LW',
      projectClass: 'LEGACY_CODE_MODIFICATION',
      difficulty: 'D3',
      language: 'javascript',
      runtime: 'node',
      environment: 'local-disposable',
      startingFixture: 'callback-compute',
      missionPrompt: 'Preserve the old callback compute(a,b,cb) helper. Add computeAsync that returns a Promise with the same sum, without replacing the callback path.',
      acceptanceCriteria: [
        criterion('LW1', 'callback compute still calls cb(null, a+b)', 'NODE', 'callback preserved'),
        criterion('LW2', 'computeAsync resolves hidden a+b', 'NODE', 'promise'),
        criterion('LW3', 'shared helper addPair still used by both paths', 'FILE', 'shared helper'),
        criterion('LW4', 'lib/compute.js still CommonJS module.exports', 'FILE', 'no rewrite'),
        criterion('LW5', 'starter tests pass', 'TEST', 'node --test'),
      ],
      forbiddenShortcuts: ['delete callback API', 'rewrite entire project', 'hardcode hidden sum', 'read hidden oracle'],
      timeoutMs: 45_000,
      resourceBudget: FOUNDRY_MODEL_DRIVEN_D3_BUDGET,
      expectedArtifacts: ['lib/compute.js', 'lib/add-pair.js', 'compute.test.mjs'],
      expectedTests: ['compute.test.mjs'],
      independentVerifier: 'verifyLegacyCompute',
      writeSet: ['lib/compute.js', 'lib/add-pair.js', 'compute.test.mjs'],
      outOfScopePaths: ['.foundry-expected.json'],
      networkRequired: false,
      suite: 'full',
      variationKeys: ['a', 'b'],
    },
    {
      benchmarkId: 'GRAD-RF-REFACTOR-V1',
      letter: 'RF',
      projectClass: 'REFACTOR',
      difficulty: 'D2',
      language: 'javascript',
      runtime: 'node',
      environment: 'local-disposable',
      startingFixture: 'duplicate-blank-check',
      missionPrompt: 'Extract duplicated blank checks from src/a.mjs and src/b.mjs into src/blank.mjs isBlank. Preserve cleanName and cleanCode behavior. Not a rename-only edit.',
      acceptanceCriteria: [
        criterion('RF1', 'cleanName/cleanCode behavior preserved', 'NODE', 'behavior'),
        criterion('RF2', 'src/blank.mjs exports isBlank', 'FILE', 'extract'),
        criterion('RF3', 'both a.mjs and b.mjs import isBlank from blank.mjs', 'FILE', 'shared path'),
        criterion('RF4', 'tests remain green and still cover name/code', 'TEST', 'green'),
      ],
      forbiddenShortcuts: ['rename only', 'delete tests', 'change cleanName output', 'read hidden oracle'],
      timeoutMs: 40_000,
      resourceBudget: FOUNDRY_MODEL_DRIVEN_BUDGET,
      expectedArtifacts: ['src/a.mjs', 'src/b.mjs', 'src/blank.mjs', 'src/blank.test.mjs'],
      expectedTests: ['src/blank.test.mjs'],
      independentVerifier: 'verifyRefactorBlank',
      writeSet: ['src/a.mjs', 'src/b.mjs', 'src/blank.mjs', 'src/blank.test.mjs'],
      outOfScopePaths: ['.foundry-expected.json'],
      networkRequired: false,
      suite: 'full',
      variationKeys: ['name'],
    },
    {
      benchmarkId: 'GRAD-RF-REFACTOR-V2',
      letter: 'RG',
      projectClass: 'REFACTOR',
      difficulty: 'D2',
      language: 'javascript',
      runtime: 'node',
      environment: 'local-disposable',
      startingFixture: 'inline-data-access',
      missionPrompt: 'Separate data access: move JSON load/save out of src/service.mjs into src/repo.mjs load/save. Preserve getItem/setItem behavior.',
      acceptanceCriteria: [
        criterion('RG1', 'getItem/setItem behavior preserved for hidden key', 'NODE', 'behavior'),
        criterion('RG2', 'src/repo.mjs exports load and save', 'FILE', 'extract'),
        criterion('RG3', 'service.mjs imports load/save from repo.mjs', 'FILE', 'separation'),
        criterion('RG4', 'tests remain green', 'TEST', 'green'),
      ],
      forbiddenShortcuts: ['rename only', 'break persistence', 'delete tests', 'read hidden oracle'],
      timeoutMs: 40_000,
      resourceBudget: FOUNDRY_MODEL_DRIVEN_BUDGET,
      expectedArtifacts: ['src/service.mjs', 'src/repo.mjs', 'data.json', 'src/service.test.mjs'],
      expectedTests: ['src/service.test.mjs'],
      independentVerifier: 'verifyRefactorRepo',
      writeSet: ['src/service.mjs', 'src/repo.mjs', 'data.json', 'src/service.test.mjs'],
      outOfScopePaths: ['.foundry-expected.json'],
      networkRequired: false,
      suite: 'full',
      variationKeys: ['key'],
    },
    {
      benchmarkId: 'GRAD-DP-DATA-V1',
      letter: 'DP',
      projectClass: 'DATA_PROCESSING',
      difficulty: 'D2',
      language: 'javascript',
      runtime: 'node',
      environment: 'local-disposable',
      startingFixture: 'csv-parts-pipeline',
      missionPrompt: 'Parse CSV sku,price,qty. Validate, skip malformed rows into errors, aggregate total=price*qty, write deterministic summary.json preserving sku.',
      acceptanceCriteria: [
        criterion('DP1', 'hidden sku appears in summary.json rows', 'FILE', 'preserve field'),
        criterion('DP2', 'total equals hidden sum of valid price*qty', 'NODE', 'aggregate'),
        criterion('DP3', 'malformed rows counted in errors', 'NODE', 'malformed'),
        criterion('DP4', 'output is deterministic JSON', 'FILE', 'summary.json'),
        criterion('DP5', 'starter tests pass', 'TEST', 'node --test'),
      ],
      forbiddenShortcuts: ['drop sku', 'hardcode hidden total', 'ignore malformed', 'read hidden oracle'],
      timeoutMs: 40_000,
      resourceBudget: FOUNDRY_MODEL_DRIVEN_BUDGET,
      expectedArtifacts: ['pipeline.mjs', 'summary.json', 'pipeline.test.mjs'],
      expectedTests: ['pipeline.test.mjs'],
      independentVerifier: 'verifyCsvPipeline',
      writeSet: ['pipeline.mjs', 'summary.json', 'pipeline.test.mjs', 'input.csv'],
      outOfScopePaths: ['.foundry-expected.json'],
      networkRequired: false,
      suite: 'fast',
      variationKeys: ['sku'],
    },
    {
      benchmarkId: 'GRAD-DP-DATA-V2',
      letter: 'DQ',
      projectClass: 'DATA_PROCESSING',
      difficulty: 'D2',
      language: 'javascript',
      runtime: 'node',
      environment: 'local-disposable',
      startingFixture: 'jsonl-events-pipeline',
      missionPrompt: 'Process JSONL events: parse line by line, skip bad JSON into errors.jsonl, dedupe by id keeping first, group counts by kind, write report.json.',
      acceptanceCriteria: [
        criterion('DQ1', 'hidden id kept once after dedupe', 'FILE', 'dedupe'),
        criterion('DQ2', 'group counts match hidden kinds', 'NODE', 'group'),
        criterion('DQ3', 'malformed lines appear in errors.jsonl', 'FILE', 'error report'),
        criterion('DQ4', 'report.json deterministic', 'FILE', 'report'),
        criterion('DQ5', 'starter tests pass', 'TEST', 'node --test'),
      ],
      forbiddenShortcuts: ['load entire file as one JSON array only if it still streams lines', 'hardcode hidden counts', 'read hidden oracle'],
      timeoutMs: 45_000,
      resourceBudget: FOUNDRY_MODEL_DRIVEN_BUDGET,
      expectedArtifacts: ['events.mjs', 'report.json', 'errors.jsonl', 'events.test.mjs'],
      expectedTests: ['events.test.mjs'],
      independentVerifier: 'verifyJsonlPipeline',
      writeSet: ['events.mjs', 'report.json', 'errors.jsonl', 'events.test.mjs', 'events.jsonl'],
      outOfScopePaths: ['.foundry-expected.json'],
      networkRequired: false,
      suite: 'full',
      variationKeys: ['kind'],
    },
    {
      benchmarkId: 'GRAD-LP-LIBRARY-V1',
      letter: 'LP',
      projectClass: 'LIBRARY_PACKAGE',
      difficulty: 'D2',
      language: 'javascript',
      runtime: 'node',
      environment: 'local-disposable',
      startingFixture: 'money-lite-package',
      missionPrompt: 'Finish reusable package foundry-money-lite: parseCents public export, package.json exports, tests, consumer/use.mjs import proof, throw on invalid input.',
      acceptanceCriteria: [
        criterion('LP1', 'package.json name/version/exports present', 'FILE', 'metadata'),
        criterion('LP2', 'parseCents("$12.50") is 1250', 'NODE', 'parse'),
        criterion('LP3', 'invalid input throws', 'NODE', 'error'),
        criterion('LP4', 'consumer/use.mjs prints CENTS= from the package export', 'NODE', 'consumer'),
        criterion('LP5', 'package tests pass', 'TEST', 'node --test'),
      ],
      forbiddenShortcuts: ['skip consumer', 'always return 0', 'read hidden oracle'],
      timeoutMs: 40_000,
      resourceBudget: FOUNDRY_MODEL_DRIVEN_BUDGET,
      expectedArtifacts: ['package.json', 'src/index.mjs', 'src/index.test.mjs', 'consumer/use.mjs'],
      expectedTests: ['src/index.test.mjs'],
      independentVerifier: 'verifyMoneyPackage',
      writeSet: ['package.json', 'src/index.mjs', 'src/index.test.mjs', 'consumer/use.mjs'],
      outOfScopePaths: ['.foundry-expected.json'],
      networkRequired: false,
      suite: 'full',
      variationKeys: ['cents'],
    },
    {
      benchmarkId: 'GRAD-LP-LIBRARY-V2',
      letter: 'LQ',
      projectClass: 'LIBRARY_PACKAGE',
      difficulty: 'D2',
      language: 'javascript',
      runtime: 'node',
      environment: 'local-disposable',
      startingFixture: 'text-kit-package',
      missionPrompt: 'Finish reusable package foundry-text-kit with public slugify and titleCase, private splitWords not exported, consumer imports both.',
      acceptanceCriteria: [
        criterion('LQ1', 'package.json exports map for . and ./slug ./title', 'FILE', 'metadata'),
        criterion('LQ2', 'slugify and titleCase public behavior', 'NODE', 'exports'),
        criterion('LQ3', 'splitWords is not a public package export', 'FILE', 'private'),
        criterion('LQ4', 'consumer prints SLUG= and TITLE=', 'NODE', 'consumer'),
        criterion('LQ5', 'package tests pass', 'TEST', 'node --test'),
      ],
      forbiddenShortcuts: ['export splitWords from package.json', 'skip consumer', 'read hidden oracle'],
      timeoutMs: 40_000,
      resourceBudget: FOUNDRY_MODEL_DRIVEN_BUDGET,
      expectedArtifacts: ['package.json', 'src/index.mjs', 'src/slug.mjs', 'src/title.mjs', 'src/words.mjs', 'src/kit.test.mjs', 'consumer/use.mjs'],
      expectedTests: ['src/kit.test.mjs'],
      independentVerifier: 'verifyTextKitPackage',
      writeSet: ['package.json', 'src/index.mjs', 'src/slug.mjs', 'src/title.mjs', 'src/words.mjs', 'src/kit.test.mjs', 'consumer/use.mjs'],
      outOfScopePaths: ['.foundry-expected.json'],
      networkRequired: false,
      suite: 'full',
      variationKeys: ['phrase'],
    },
  ]
}

export function seedHardEngineeringFixture(benchmark: FoundryEngineeringBenchmark, variant = 'v1'): GraduationFixtureMaterial | null {
  if (benchmark.benchmarkId === 'GRAD-D-FULLSTACK-V3') {
    const worker = variant === 'v2' ? 'hidden-remy' : 'hidden-cleo'
    return {
      variant,
      hidden: { worker, slot: 'thu-am' },
      files: {
        'shifts.json': '[]\n',
        'server.mjs': HTTP_SHIFT_SERVER,
        'index.html': '<!doctype html><html><body><div id="root"></div><script type="module" src="./app.js"></script></body></html>\n',
        'app.js': `export function createRoster(baseUrl) {
  return {
    lastBoard: [],
    lastError: null,
    async bookShift(worker, slot) {
      const res = await fetch(baseUrl + '/wrong', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ worker, slot }) })
      this.lastError = 'fix POST /shifts then GET /shifts into lastBoard'
      return res.status
    },
  }
}
`,
        'app.test.mjs': `import test from 'node:test'
import assert from 'node:assert/strict'
import { createRoster } from './app.js'
test('createRoster exported', () => { assert.equal(typeof createRoster, 'function') })
`,
      },
    }
  }
  if (benchmark.benchmarkId === 'GRAD-DA-DATABASE-V1') {
    const sku = variant === 'v2' ? 'HID-REM' : 'HID-CLE'
    return {
      variant,
      hidden: { sku, qty: 7 },
      files: {
        'store.mjs': `import { DatabaseSync } from 'node:sqlite'

export function openDb() {
  return new DatabaseSync(':memory:')
}

export function init(db) {
  db.exec('CREATE TABLE IF NOT EXISTS parts (id INTEGER PRIMARY KEY, sku TEXT, qty INTEGER)')
}

export function add(db, sku, qty) {
  db.prepare('INSERT INTO parts (sku, qty) VALUES (?, ?)').run(sku, qty)
}

export function find(db, sku) {
  return db.prepare('SELECT sku, qty FROM parts WHERE sku = ?').get(sku) || null
}

export function setQty(db, sku, qty) {
  db.prepare('UPDATE parts SET qty = ? WHERE sku = ?').run(qty, sku)
}

export function remove(db, sku) {
  db.prepare('DELETE FROM parts WHERE sku = ?').run(sku)
}

export function withTxn(db, fn) {
  fn()
}
`,
        'store.test.mjs': `import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, rmSync } from 'node:fs'
import { openDb, init, add, find, setQty, remove, withTxn } from './store.mjs'

function fresh() {
  try { rmSync('parts.db') } catch {}
  const db = openDb()
  init(db)
  return db
}

test('uses file db', () => {
  const db = fresh()
  add(db, 'seed-sku', 1)
  db.close()
  assert.equal(existsSync('parts.db'), true)
})

test('crud', () => {
  const db = fresh()
  add(db, 'aaa', 2)
  assert.equal(find(db, 'aaa').qty, 2)
  setQty(db, 'aaa', 5)
  assert.equal(find(db, 'aaa').qty, 5)
  remove(db, 'aaa')
  assert.equal(find(db, 'aaa'), null)
  db.close()
})

test('unique sku', () => {
  const db = fresh()
  add(db, 'dup', 1)
  assert.throws(() => add(db, 'dup', 2))
  db.close()
})

test('txn rollback', () => {
  const db = fresh()
  try {
    withTxn(db, () => {
      add(db, 'tx', 9)
      throw new Error('boom')
    })
  } catch {}
  assert.equal(find(db, 'tx'), null)
  db.close()
})
`,
      },
    }
  }
  if (benchmark.benchmarkId === 'GRAD-DA-DATABASE-V2') {
    const author = variant === 'v2' ? 'hidden-ada' : 'hidden-nia'
    const title = variant === 'v2' ? 'Hidden Atlas' : 'Hidden Codex'
    return {
      variant,
      hidden: { author, title, year: 1998 },
      files: {
        'catalog.mjs': `import { DatabaseSync } from 'node:sqlite'

export function openDb() {
  return new DatabaseSync(':memory:')
}

export function init(db) {
  db.exec('CREATE TABLE IF NOT EXISTS authors (id INTEGER PRIMARY KEY, name TEXT)')
  db.exec('CREATE TABLE IF NOT EXISTS books (id INTEGER PRIMARY KEY, title TEXT, author_id INTEGER)')
}

export function addAuthor(db, name) {
  db.prepare('INSERT INTO authors (name) VALUES (?)').run(name)
  return db.prepare('SELECT id, name FROM authors WHERE name = ?').get(name)
}

export function addBook(db, title, authorId) {
  db.prepare('INSERT INTO books (title, author_id) VALUES (?, ?)').run(title, authorId)
}

export function booksByAuthor(db, authorId) {
  return db.prepare('SELECT title FROM books').all()
}

export function migrate(db) {}

export function setYear(db, title, year) {
  db.prepare('UPDATE books SET year = ? WHERE title = ?').run(year, title)
}
`,
        'catalog.test.mjs': `import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, rmSync } from 'node:fs'
import { openDb, init, addAuthor, addBook, booksByAuthor, migrate, setYear } from './catalog.mjs'

test('file db', () => {
  try { rmSync('catalog.db') } catch {}
  const db = openDb()
  init(db)
  addAuthor(db, 'tmp')
  db.close()
  assert.equal(existsSync('catalog.db'), true)
})

test('related filter', () => {
  try { rmSync('catalog.db') } catch {}
  const db = openDb()
  init(db)
  const a = addAuthor(db, 'Ann')
  const b = addAuthor(db, 'Bob')
  addBook(db, 'A1', a.id)
  addBook(db, 'B1', b.id)
  const rows = booksByAuthor(db, a.id)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].title, 'A1')
  db.close()
})

test('fk rejects bad author', () => {
  try { rmSync('catalog.db') } catch {}
  const db = openDb()
  init(db)
  assert.throws(() => addBook(db, 'Nope', 999))
  db.close()
})

test('migrate year', () => {
  try { rmSync('catalog.db') } catch {}
  const db = openDb()
  init(db)
  const a = addAuthor(db, 'Ann')
  addBook(db, 'A1', a.id)
  migrate(db)
  setYear(db, 'A1', 2001)
  const row = db.prepare('SELECT year FROM books WHERE title = ?').get('A1')
  assert.equal(row.year, 2001)
  db.close()
})
`,
      },
    }
  }
  if (benchmark.benchmarkId === 'GRAD-DK-DESKTOP-V1') {
    const title = variant === 'v2' ? 'hidden-remy-note' : 'hidden-cleo-note'
    return {
      variant,
      hidden: { title, body: 'keep' },
      files: {
        'package.json': '{"name":"desk-note","main":"main.js","type":"commonjs"}\n',
        'main.js': DESKTOP_MAIN,
        'save.js': DESKTOP_SAVE,
        'preload.js': `const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('desk', {
  save: (title, body) => ipcRenderer.invoke('save-note', title, body),
})
`,
        'index.html': '<!doctype html><html><body><h1>Notes</h1><button id="save">Save</button><script>document.getElementById("save").onclick=()=>window.desk.save("ui","from-ui")</script></body></html>\n',
        'save.test.mjs': `import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'
const src = readFileSync(new URL('./save.js', import.meta.url), 'utf8')
const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8')
test('saveNote writes notes.json', () => {
  assert.match(src, /notes\\.json/)
  assert.doesNotMatch(src, /wrong\\.json/)
})
test('window shell kept', () => {
  assert.match(main, /WINDOW_READY/)
  assert.match(main, /save-note/)
  assert.match(main, /require\\('.\\/save'\\)/)
})
`,
      },
    }
  }
  if (benchmark.benchmarkId === 'GRAD-DK-DESKTOP-V2') {
    const fileName = variant === 'v2' ? 'probe-remy.txt' : 'probe-cleo.txt'
    return {
      variant,
      hidden: { fileName, bytes: 11 },
      files: {
        'package.json': '{"name":"desk-meta","main":"main.js","type":"commonjs"}\n',
        'main.js': DESKTOP_STAT_MAIN,
        'meta.js': DESKTOP_META,
        'preload-meta.js': `const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('desk', {
  meta: (rel) => ipcRenderer.invoke('file-meta', rel),
})
`,
        'index.html': '<!doctype html><html><body><h1>Meta</h1><button id="stat">Stat</button><script>document.getElementById("stat").onclick=()=>window.desk.meta("probe.txt")</script></body></html>\n',
        [fileName]: 'hello world',
        'meta.test.mjs': `import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'
const src = readFileSync(new URL('./meta.js', import.meta.url), 'utf8')
const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8')
test('fileMeta uses statSync', () => {
  assert.match(src, /statSync/)
  assert.doesNotMatch(src, /name: 'wrong'/)
})
test('window shell kept', () => {
  assert.match(main, /WINDOW_READY/)
  assert.match(main, /file-meta/)
})
`,
      },
    }
  }
  if (benchmark.benchmarkId === 'GRAD-LV-LEGACY-V1') {
    const qty = variant === 'v2' ? 20 : 10
    return {
      variant,
      hidden: { qty, discounted: qty - qty / 10 },
      files: {
        'lib/util.js': `var tally = function (items) {
  var n = 0
  for (var i = 0; i < items.length; i++) {
    n = n + items[i].qty
  }
  return n
}
function label(name) {
  return 'Item:' + name
}
module.exports = {
  tally: tally,
  label: label,
}
`,
        'index.js': "var util = require('./lib/util')\nmodule.exports = util\n",
        'util.test.mjs': `import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const util = require('./lib/util.js')
test('tally', () => { assert.equal(util.tally([{ qty: 2 }, { qty: 3 }]), 5) })
test('label', () => { assert.equal(util.label('bolt'), 'Item:bolt') })
test('tallyDiscount', () => { assert.equal(util.tallyDiscount([{ qty: 10 }], 10), 9) })
`,
      },
    }
  }
  if (benchmark.benchmarkId === 'GRAD-LV-LEGACY-V2') {
    const a = variant === 'v2' ? 11 : 4
    const b = variant === 'v2' ? 8 : 13
    return {
      variant,
      hidden: { a, b, sum: a + b },
      files: {
        'lib/add-pair.js': 'function addPair(x, y) { return Number(x) + Number(y) }\nmodule.exports = { addPair: addPair }\n',
        'lib/compute.js': `var helpers = require('./add-pair')
function compute(a, b, cb) {
  cb(null, helpers.addPair(a, b))
}
module.exports = { compute: compute }
`,
        'compute.test.mjs': `import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { compute, computeAsync } = require('./lib/compute.js')
test('callback', () => new Promise((resolve, reject) => {
  compute(2, 3, (err, value) => {
    try { assert.equal(err, null); assert.equal(value, 5); resolve() } catch (error) { reject(error) }
  })
}))
test('async', async () => { assert.equal(await computeAsync(2, 3), 5) })
`,
      },
    }
  }
  if (benchmark.benchmarkId === 'GRAD-RF-REFACTOR-V1') {
    const name = variant === 'v2' ? 'ada' : 'nia'
    return {
      variant,
      hidden: { name },
      files: {
        'src/a.mjs': `export function cleanName(raw) {
  const s = String(raw).trim()
  if (!s) return null
  return s
}
`,
        'src/b.mjs': `export function cleanCode(raw) {
  const s = String(raw).trim()
  if (!s) return null
  return s.toUpperCase()
}
`,
        'src/blank.test.mjs': `import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isBlank } from './blank.mjs'
import { cleanName } from './a.mjs'
import { cleanCode } from './b.mjs'
test('shared blank', () => { assert.equal(isBlank('  '), true); assert.equal(isBlank('x'), false) })
test('name', () => { assert.equal(cleanName('  ada  '), 'ada'); assert.equal(cleanName('  '), null) })
test('code', () => { assert.equal(cleanCode(' ab '), 'AB'); assert.equal(cleanCode(''), null) })
test('a imports blank', () => { assert.match(readFileSync(new URL('./a.mjs', import.meta.url), 'utf8'), /from ['"]\\.\\/blank\\.mjs['"]/) })
test('b imports blank', () => { assert.match(readFileSync(new URL('./b.mjs', import.meta.url), 'utf8'), /from ['"]\\.\\/blank\\.mjs['"]/) })
`,
      },
    }
  }
  if (benchmark.benchmarkId === 'GRAD-RF-REFACTOR-V2') {
    const key = variant === 'v2' ? 'hidden-remy' : 'hidden-kade'
    return {
      variant,
      hidden: { key, value: 'keep' },
      files: {
        'data.json': '{}\n',
        'src/service.mjs': `import { readFileSync, writeFileSync } from 'node:fs'
export function getItem(key) {
  const data = JSON.parse(readFileSync(new URL('../data.json', import.meta.url), 'utf8'))
  return data[key] ?? null
}
export function setItem(key, value) {
  const data = JSON.parse(readFileSync(new URL('../data.json', import.meta.url), 'utf8'))
  data[key] = value
  writeFileSync(new URL('../data.json', import.meta.url), JSON.stringify(data) + '\\n')
  return value
}
`,
        'src/service.test.mjs': `import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { getItem, setItem } from './service.mjs'
import { load, save } from './repo.mjs'
test('roundtrip', () => {
  setItem('k', 'v')
  assert.equal(getItem('k'), 'v')
})
test('repo exports', () => {
  save({ z: 1 })
  assert.equal(load().z, 1)
})
test('service imports repo', () => {
  assert.match(readFileSync(new URL('./service.mjs', import.meta.url), 'utf8'), /from ['"]\\.\\/repo\\.mjs['"]/)
})
`,
      },
    }
  }
  if (benchmark.benchmarkId === 'GRAD-DP-DATA-V1') {
    const sku = variant === 'v2' ? 'HID-REM' : 'HID-CLE'
    return {
      variant,
      hidden: { sku, total: 26, errors: 1 },
      files: {
        'input.csv': `sku,price,qty
AAA,2,3
not-a-row
BBB,4,5
`,
        'pipeline.mjs': `export function processCsv(text) {
  const lines = String(text).replace(/\\r/g, '').split('\\n').filter(Boolean)
  const rows = []
  let errors = 0
  let total = 0
  for (const line of lines.slice(1)) {
    const parts = line.split(',')
    const price = Number(parts[1])
    const qty = Number(parts[2])
    if (parts.length !== 3 || !Number.isFinite(price) || !Number.isFinite(qty)) {
      continue
    }
    rows.push({ sku: parts[0], price, qty })
    total += price * qty
  }
  return { rows, errors, total }
}
`,
        'pipeline.test.mjs': `import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { processCsv } from './pipeline.mjs'
test('aggregates valid rows', () => {
  const out = processCsv(readFileSync('input.csv', 'utf8'))
  assert.equal(out.total, 26)
  assert.equal(out.errors, 1)
  assert.equal(out.rows.some(row => row.sku === 'AAA'), true)
})
`,
      },
    }
  }
  if (benchmark.benchmarkId === 'GRAD-DP-DATA-V2') {
    const kind = variant === 'v2' ? 'ship' : 'pack'
    const lines = [
      JSON.stringify({ id: 'e1', kind: 'pack', n: 1 }),
      '{bad',
      JSON.stringify({ id: 'e1', kind: 'pack', n: 9 }),
      JSON.stringify({ id: 'e2', kind, n: 1 }),
      JSON.stringify({ id: 'e3', kind: 'pack', n: 1 }),
    ]
    while (lines.length < 24) lines.push(JSON.stringify({ id: `pad${lines.length}`, kind: 'pack', n: 1 }))
    return {
      variant,
      hidden: { kind, unique: 22, errorLines: 1 },
      files: {
        'events.jsonl': lines.join('\n') + '\n',
        'events.mjs': `export function processJsonl(text) {
  const groups = {}
  let unique = 0
  let errors = 0
  for (const line of String(text).split('\\n')) {
    if (!line.trim()) continue
    let obj
    try { obj = JSON.parse(line) } catch { errors += 1; continue }
    unique += 1
    groups[obj.kind] = (groups[obj.kind] || 0) + 1
  }
  return { unique, groups, errors }
}
`,
        'events.test.mjs': `import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { processJsonl } from './events.mjs'
test('dedupes and groups', () => {
  const out = processJsonl(readFileSync('events.jsonl', 'utf8'))
  assert.equal(out.unique, 22)
  assert.equal(out.errors, 1)
  assert.equal(typeof out.groups.pack, 'number')
})
`,
      },
    }
  }
  if (benchmark.benchmarkId === 'GRAD-LP-LIBRARY-V1') {
    const cents = variant === 'v2' ? 1999 : 1250
    return {
      variant,
      hidden: { cents, raw: cents === 1999 ? '$19.99' : '$12.50' },
      files: {
        'package.json': '{"name":"foundry-money-lite","version":"1.0.0","type":"module"}\n',
        'src/index.mjs': `export function parseCents(raw) {
  return Number(String(raw).replace('$', ''))
}
`,
        'src/index.test.mjs': `import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseCents } from './index.mjs'
test('parses dollars', () => { assert.equal(parseCents('$12.50'), 1250) })
test('rejects junk', () => { assert.throws(() => parseCents('nope')) })
test('package exports', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.exports['.'], './src/index.mjs')
})
`,
        'consumer/use.mjs': `import { parseCents } from '../src/index.mjs'
console.log('CENTS=' + parseCents('$12.50'))
`,
      },
    }
  }
  if (benchmark.benchmarkId === 'GRAD-LP-LIBRARY-V2') {
    const phrase = variant === 'v2' ? 'Hello World' : 'Shift Board'
    return {
      variant,
      hidden: { phrase, slug: phrase.toLowerCase().replace(/\s+/g, '-'), title: phrase },
      files: {
        'package.json': '{"name":"foundry-text-kit","version":"1.0.0","type":"module"}\n',
        'src/words.mjs': 'export function splitWords(text) { return String(text).trim().split(/\\s+/).filter(Boolean) }\n',
        'src/slug.mjs': `import { splitWords } from './words.mjs'
export function slugify(text) { return splitWords(text).map(w => w.toLowerCase()).join('-') }
`,
        'src/title.mjs': `import { splitWords } from './words.mjs'
export function titleCase(text) { return splitWords(text).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ') }
`,
        'src/index.mjs': `export { slugify } from './slug.mjs'
export { titleCase } from './title.mjs'
`,
        'src/kit.test.mjs': `import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { slugify, titleCase } from './index.mjs'
test('slug', () => { assert.equal(slugify('Shift Board'), 'shift-board') })
test('title', () => { assert.equal(titleCase('shift board'), 'Shift Board') })
test('package exports', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.exports['.'], './src/index.mjs')
  assert.ok(pkg.exports['./slug'] || pkg.exports['./title'])
})
`,
        'consumer/use.mjs': `import { slugify, titleCase } from '../src/index.mjs'
console.log('SLUG=' + slugify('Shift Board'))
console.log('TITLE=' + titleCase('shift board'))
`,
      },
    }
  }
  return null
}

export function publicHardEngineeringBrief(benchmark: FoundryEngineeringBenchmark): string | null {
  if (benchmark.benchmarkId === 'GRAD-D-FULLSTACK-V3') {
    return [
      'The local shift API in server.mjs already listens and implements GET /health, GET /shifts, POST /shifts with worker/slot validation and shifts.json persistence. Do not rewrite server.mjs unless it is broken.',
      'Repair app.js createRoster(baseUrl). Replace "/wrong" with "/shifts". async bookShift(worker, slot) MUST: POST JSON { worker, slot } to baseUrl+"/shifts"; if status 400 set lastError and return null; then GET baseUrl+"/shifts", assign JSON array to this.lastBoard, return this.lastBoard.',
      'Keep app.test.mjs. file.write path=app.js. Localhost only.',
    ].join(' ')
  }
  if (benchmark.benchmarkId === 'GRAD-DA-DATABASE-V1') {
    return [
      'Inspect store.mjs. Replace the whole file. FIRST ACTION file.write path=store.mjs with this exact module:',
      'import { DatabaseSync } from "node:sqlite"',
      'export function openDb() { return new DatabaseSync("parts.db") }',
      'export function init(db) { db.exec("CREATE TABLE IF NOT EXISTS parts (id INTEGER PRIMARY KEY, sku TEXT NOT NULL UNIQUE, qty INTEGER NOT NULL)") }',
      'export function add(db, sku, qty) { db.prepare("INSERT INTO parts (sku, qty) VALUES (?, ?)").run(sku, qty) }',
      'export function find(db, sku) { return db.prepare("SELECT sku, qty FROM parts WHERE sku = ?").get(sku) || null }',
      'export function setQty(db, sku, qty) { db.prepare("UPDATE parts SET qty = ? WHERE sku = ?").run(qty, sku) }',
      'export function remove(db, sku) { db.prepare("DELETE FROM parts WHERE sku = ?").run(sku) }',
      'export function withTxn(db, fn) { db.exec("BEGIN"); try { fn(); db.exec("COMMIT") } catch (e) { db.exec("ROLLBACK"); throw e } }',
      'Do not use :memory:. Do not use JSON. Keep store.test.mjs.',
    ].join(' ')
  }
  if (benchmark.benchmarkId === 'GRAD-DA-DATABASE-V2') {
    return [
      'Replace catalog.mjs. FIRST ACTION file.write path=catalog.mjs:',
      'import { DatabaseSync } from "node:sqlite"',
      'export function openDb() { const db = new DatabaseSync("catalog.db"); db.exec("PRAGMA foreign_keys = ON"); return db }',
      'export function init(db) { db.exec("CREATE TABLE IF NOT EXISTS authors (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE)"); db.exec("CREATE TABLE IF NOT EXISTS books (id INTEGER PRIMARY KEY, title TEXT NOT NULL, author_id INTEGER NOT NULL, FOREIGN KEY(author_id) REFERENCES authors(id))") }',
      'export function addAuthor(db, name) { db.prepare("INSERT INTO authors (name) VALUES (?)").run(name); return db.prepare("SELECT id, name FROM authors WHERE name = ?").get(name) }',
      'export function addBook(db, title, authorId) { db.prepare("INSERT INTO books (title, author_id) VALUES (?, ?)").run(title, authorId) }',
      'export function booksByAuthor(db, authorId) { return db.prepare("SELECT title FROM books WHERE author_id = ?").all(authorId) }',
      'export function migrate(db) { try { db.exec("ALTER TABLE books ADD COLUMN year INTEGER") } catch {} }',
      'export function setYear(db, title, year) { db.prepare("UPDATE books SET year = ? WHERE title = ?").run(year, title) }',
      'Keep catalog.test.mjs. File DB, not :memory:.',
    ].join(' ')
  }
  if (benchmark.benchmarkId === 'GRAD-DK-DESKTOP-V1') {
    return [
      'Do not edit main.js. The Electron window already works.',
      'save.js currently writes wrong.json. FIRST ACTION file.write path=save.js:',
      'const fs = require("fs"); const path = require("path"); function saveNote(title, body) { fs.writeFileSync(path.join(process.cwd(), "notes.json"), JSON.stringify([{ title: title, body: body }]) + "\\n"); return true } module.exports = { saveNote }',
      'Then COMPLETE. Write-set is save.js only.',
    ].join(' ')
  }
  if (benchmark.benchmarkId === 'GRAD-DK-DESKTOP-V2') {
    return [
      'Do not edit main.js. The Electron window already works.',
      'meta.js currently returns { name: "wrong", size: 0 }. FIRST ACTION file.write path=meta.js:',
      'const fs = require("fs"); const path = require("path"); function fileMeta(rel) { const st = fs.statSync(rel); return { name: path.basename(rel), size: st.size } } module.exports = { fileMeta }',
      'Then COMPLETE. Write-set is meta.js only.',
    ].join(' ')
  }
  if (benchmark.benchmarkId === 'GRAD-LV-LEGACY-V1') {
    return [
      'lib/util.js is old CommonJS. Keep var tally, the for-loop, label returning "Item:" + name, and module.exports.',
      'Add tallyDiscount(items, pct) that returns tally(items) * (1 - pct/100). Example tallyDiscount([{qty:10}], 10) === 9.',
      'Do not rewrite the project to ESM. Do not delete lib/util.js. file.write path=lib/util.js adding the new export only. Keep util.test.mjs.',
    ].join(' ')
  }
  if (benchmark.benchmarkId === 'GRAD-LV-LEGACY-V2') {
    return [
      'Keep compute(a,b,cb) and addPair. Add: function computeAsync(a, b) { return Promise.resolve(helpers.addPair(a, b)) } and export it on module.exports.',
      'file.write path=lib/compute.js as CommonJS. Example: var helpers = require("./add-pair"); function compute(a,b,cb){ cb(null, helpers.addPair(a,b)) } function computeAsync(a,b){ return Promise.resolve(helpers.addPair(a,b)) } module.exports = { compute: compute, computeAsync: computeAsync }',
      'Keep compute.test.mjs.',
    ].join(' ')
  }
  if (benchmark.benchmarkId === 'GRAD-RF-REFACTOR-V1') {
    return [
      'file.write path=src/blank.mjs: export function isBlank(raw) { return !String(raw).trim() }',
      'file.write path=src/a.mjs: import { isBlank } from "./blank.mjs"; export function cleanName(raw) { if (isBlank(raw)) return null; return String(raw).trim() }',
      'file.write path=src/b.mjs: import { isBlank } from "./blank.mjs"; export function cleanCode(raw) { if (isBlank(raw)) return null; return String(raw).trim().toUpperCase() }',
      'Do not change return values. Keep tests.',
    ].join(' ')
  }
  if (benchmark.benchmarkId === 'GRAD-RF-REFACTOR-V2') {
    return [
      'file.write path=src/repo.mjs: import { readFileSync, writeFileSync } from "node:fs"; export function load() { return JSON.parse(readFileSync(new URL("../data.json", import.meta.url), "utf8")) } export function save(data) { writeFileSync(new URL("../data.json", import.meta.url), JSON.stringify(data) + "\\n") }',
      'file.write path=src/service.mjs: import { load, save } from "./repo.mjs"; export function getItem(key) { return load()[key] ?? null } export function setItem(key, value) { const data = load(); data[key] = value; save(data); return value }',
      'Keep tests.',
    ].join(' ')
  }
  if (benchmark.benchmarkId === 'GRAD-DP-DATA-V1') {
    return [
      'Inspect pipeline.mjs. Valid rows already aggregate. Malformed rows are skipped but errors stays 0.',
      'file.write path=pipeline.mjs so the invalid-row branch does errors += 1 before continue. Keep sku rows and total = price*qty. Example input.csv total 26 with 1 error.',
      'Keep pipeline.test.mjs.',
    ].join(' ')
  }
  if (benchmark.benchmarkId === 'GRAD-DP-DATA-V2') {
    return [
      'Inspect events.mjs. It already parses JSONL and counts errors, but it counts duplicate ids.',
      'file.write path=events.mjs adding a Set of seen ids. If obj.id was seen, continue without incrementing unique or groups. Keep first occurrence. Keep events.test.mjs.',
    ].join(' ')
  }
  if (benchmark.benchmarkId === 'GRAD-LP-LIBRARY-V1') {
    return [
      'file.write path=src/index.mjs: export function parseCents(raw) { const n = Math.round(Number(String(raw).replace(/[$,]/g, "")) * 100); if (!Number.isFinite(n)) throw new Error("invalid"); return n }',
      'file.write path=package.json: {"name":"foundry-money-lite","version":"1.0.0","type":"module","exports":{".":"./src/index.mjs"}}',
      'parseCents("$12.50")===1250. Throw on nope. Keep consumer/use.mjs and tests.',
    ].join(' ')
  }
  if (benchmark.benchmarkId === 'GRAD-LP-LIBRARY-V2') {
    return [
      'slugify and titleCase already behave correctly. package.json is missing exports.',
      'file.write path=package.json: {"name":"foundry-text-kit","version":"1.0.0","type":"module","exports":{".":"./src/index.mjs","./slug":"./src/slug.mjs","./title":"./src/title.mjs"}}',
      'Do not export ./words. Keep consumer and tests.',
    ].join(' ')
  }
  return null
}
