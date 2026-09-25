/**
 * Mission 09 model-driven graduation.
 * The routed model must produce the implementation. Reference apply is forbidden.
 * Cursor is optional via FoundryModelRouter; not a core dependency.
 * No OS daemon. No production package/install/activate.
 */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { foundryNodeExecutable, getFoundryProjectsRoot } from './foundryProjectIsolation'
import { evaluateVerdictLayer, projectReadyFromVerdict } from './foundryVerdictLayer'
import { evaluateCommandCenterReplan } from './foundryReplanEngine'
import { refuseAutomaticBudgetIncrease } from './foundryResourceGovernor'
import { loadActiveResourceBudget } from './foundryContractStore'
import {
  authorizeUnattendedEnvelope,
  beginUnattendedDurableAction,
  completeUnattendedDurableAction,
  completeUnattendedEnvelope,
  refuseUnattendedGitMutation,
  startUnattendedEnvelope,
  unattendedToolBrokerWrite,
} from './foundryUnattendedEngineer'
import { FoundryModelRouter } from './foundryModelRouter'
import { configuredFoundryModels } from './foundryModelProviders'
import { FOUNDRY_MODEL_TOOL_CATALOG } from './foundryToolCatalog'
import type { FoundryMissionPermissions } from './foundryMissionTypes'
import type { FoundryModelContext, FoundryModelProviderId, FoundryModelRequestKind, FoundryModelToolDescription } from './foundryModelTypes'
import {
  EMPTY_GRADUATION_GOVERNANCE,
  EMPTY_MODEL_DRIVEN_GOVERNANCE,
  EMPTY_RESOURCE_SUMMARY,
  FOUNDRY_GRADUATION_SCHEMA_VERSION,
  FOUNDRY_MODEL_DRIVEN_BUDGET,
  FOUNDRY_MODEL_DRIVEN_D3_BUDGET,
  FOUNDRY_MODEL_DRIVEN_GRADUATION_BENCHMARK_IDS,
  FOUNDRY_MODEL_DRIVEN_OPTIONAL_BENCHMARK_IDS,
  type FoundryEngineeringBenchmark,
  type FoundryGraduationAttemptRecord,
  type FoundryGraduationFailureClass,
  type FoundryGraduationHiddenOracle,
  type FoundryGraduationRun,
  type FoundryGraduationRunResult,
  type FoundryModelDrivenGovernanceCounts,
  type FoundryModelRouteCallRecord,
} from './foundryEngineeringGraduationTypes'
import {
  listGraduationRuns,
  persistCertification,
  saveGraduationAttempt,
  saveGraduationRun,
  saveHiddenOracle,
  writeGraduationReport,
} from './foundryEngineeringGraduationStore'
import { getGraduationBenchmark, seedFixture } from './foundryEngineeringGraduationFixtures'
import { independentlyVerify } from './foundryEngineeringGraduationVerifiers'
import { bindEvidence, prepareGraduationMission } from './foundryEngineeringGraduationHarness'
import { fixtureIdentityFor, publicMultiFixtureBrief } from './foundryModelGraduationFixtures'
import { publicD3Brief } from './foundryModelGraduationD3Fixtures'
import { publicHardEngineeringBrief } from './foundryHardEngineeringFixtures'
import { publicFinalClassBrief } from './foundryFinalClassCoverageFixtures'

const MODEL_GRAD_PERMISSIONS: FoundryMissionPermissions = {
  filesystem: true,
  terminal: true,
  browser: false,
  computerUse: false,
  tests: true,
  lint: false,
  typecheck: false,
  build: false,
  package: false,
  installProduction: false,
  activateInstall: false,
  installedRuntimeControl: false,
  process: false,
  commit: false,
  push: false,
  liveDeploy: false,
  internetResearch: false,
}

const ALLOWED_TOOL_NAMES = [
  'workspace.inspect',
  'workspace.search',
  'file.read',
  'file.write',
  'file.replace_unique',
  'project.inspect',
  'test.run',
  'terminal.execute',
  'engineering.diagnose',
  'engineering.plan',
  'engineering.baseline',
  'code.owners',
  'code.impact',
] as const

const MAX_REPLANS = 3
const STAGNATION_REPEAT = 3
const GOVERNANCE_ONLY = new Set(['M', 'N', 'O', 'P', 'Q', 'R', 'S'])

export function normalizeModelGraduationBenchmarkId(id: string): string {
  const trimmed = id.trim()
  if (trimmed === 'GRAD-G-BUG-FIX' || trimmed === 'BUG_FIX' || trimmed === 'G') return 'GRAD-G-BUGFIX'
  if (trimmed === 'CLI' || trimmed === 'CLI_TOOL' || trimmed === 'E') return 'GRAD-E-CLI'
  if (trimmed === 'FRONTEND' || trimmed === 'FRONTEND_APP' || trimmed === 'B') return 'GRAD-B-FRONTEND'
  if (trimmed === 'BACKEND' || trimmed === 'BACKEND_API' || trimmed === 'C') return 'GRAD-C-BACKEND'
  if (trimmed === 'CLI_V2' || trimmed === 'GRAD-E-CLI-V2') return 'GRAD-E-CLI-V2'
  if (trimmed === 'CLI_V3' || trimmed === 'GRAD-E-CLI-V3') return 'GRAD-E-CLI-V3'
  if (trimmed === 'BUG_FIX_V2' || trimmed === 'GRAD-G-BUG-FIX-V2') return 'GRAD-G-BUGFIX-V2'
  if (trimmed === 'BUG_FIX_V3' || trimmed === 'GRAD-G-BUG-FIX-V3') return 'GRAD-G-BUGFIX-V3'
  if (trimmed === 'FRONTEND_V2') return 'GRAD-B-FRONTEND-V2'
  if (trimmed === 'FRONTEND_V3') return 'GRAD-B-FRONTEND-V3'
  if (trimmed === 'D3' || trimmed === 'FEATURE_EXTENSION' || trimmed === 'GRAD-I-FEATURE-D3') return 'GRAD-I-FEATURE-D3'
  if (trimmed === 'TEST_REPAIR_V1' || trimmed === 'TEST_REPAIR') return 'GRAD-H-TEST-REPAIR-V1'
  if (trimmed === 'TEST_REPAIR_V2') return 'GRAD-H-TEST-REPAIR-V2'
  if (trimmed === 'TEST_REPAIR_V3') return 'GRAD-H-TEST-REPAIR-V3'
  if (trimmed === 'FULL_STACK_V1' || trimmed === 'FULL_STACK' || trimmed === 'FULL_STACK_APP') return 'GRAD-D-FULLSTACK-V1'
  if (trimmed === 'FULL_STACK_V2') return 'GRAD-D-FULLSTACK-V2'
  if (trimmed === 'BACKEND_V2') return 'GRAD-C-BACKEND-V2'
  if (trimmed === 'BACKEND_V3') return 'GRAD-C-BACKEND-V3'
  if (trimmed === 'FEATURE_EXTENSION_V2' || trimmed === 'FEATURE_V2') return 'GRAD-FX-FEATURE-V2'
  if (trimmed === 'FEATURE_EXTENSION_V3' || trimmed === 'FEATURE_V3') return 'GRAD-FZ-FEATURE-V3'
  if (trimmed === 'STATIC_WEB_V1' || trimmed === 'STATIC_WEB') return 'GRAD-SW-STATIC-V1'
  if (trimmed === 'FULL_STACK_V3') return 'GRAD-D-FULLSTACK-V3'
  if (trimmed === 'DATABASE_V1' || trimmed === 'DATABASE_APP' || trimmed === 'DATABASE') return 'GRAD-DA-DATABASE-V1'
  if (trimmed === 'DATABASE_V2') return 'GRAD-DA-DATABASE-V2'
  if (trimmed === 'DESKTOP_V1' || trimmed === 'DESKTOP_APP' || trimmed === 'DESKTOP') return 'GRAD-DK-DESKTOP-V1'
  if (trimmed === 'DESKTOP_V2') return 'GRAD-DK-DESKTOP-V2'
  if (trimmed === 'LEGACY_V1' || trimmed === 'LEGACY_CODE_MODIFICATION' || trimmed === 'LEGACY') return 'GRAD-LV-LEGACY-V1'
  if (trimmed === 'LEGACY_V2') return 'GRAD-LV-LEGACY-V2'
  if (trimmed === 'REFACTOR_V1' || trimmed === 'REFACTOR') return 'GRAD-RF-REFACTOR-V1'
  if (trimmed === 'REFACTOR_V2') return 'GRAD-RF-REFACTOR-V2'
  if (trimmed === 'DATA_PROCESSING_V1' || trimmed === 'DATA_PROCESSING' || trimmed === 'DATA_V1') return 'GRAD-DP-DATA-V1'
  if (trimmed === 'DATA_PROCESSING_V2' || trimmed === 'DATA_V2') return 'GRAD-DP-DATA-V2'
  if (trimmed === 'LIBRARY_PACKAGE_V1' || trimmed === 'LIBRARY_PACKAGE' || trimmed === 'LIBRARY_V1') return 'GRAD-LP-LIBRARY-V1'
  if (trimmed === 'LIBRARY_PACKAGE_V2' || trimmed === 'LIBRARY_V2') return 'GRAD-LP-LIBRARY-V2'
  return trimmed
}

export function selectModelGraduationBenchmarkIds(): string[] {
  const env = process.env.FOUNDRY_GRADUATION_BENCHMARKS?.trim() || process.env.FOUNDRY_MODEL_GRADUATION_BENCHMARKS?.trim()
  if (env) return env.split(',').map(item => normalizeModelGraduationBenchmarkId(item)).filter(Boolean)
  return [...FOUNDRY_MODEL_DRIVEN_GRADUATION_BENCHMARK_IDS]
}

export async function probeModelGraduationProviders(): Promise<{
  available: boolean
  models: Array<{ provider: string; model: string | null }>
  reason: string
}> {
  const models = await configuredFoundryModels()
  if (!models.length) {
    return { available: false, models: [], reason: 'MODEL_PROVIDER_UNAVAILABLE' }
  }
  return {
    available: true,
    models: models.map(item => ({ provider: item.provider, model: item.model })),
    reason: 'configured',
  }
}

function budgetFor(benchmark: FoundryEngineeringBenchmark) {
  return benchmark.difficulty === 'D3' || benchmark.difficulty === 'D4'
    ? FOUNDRY_MODEL_DRIVEN_D3_BUDGET
    : FOUNDRY_MODEL_DRIVEN_BUDGET
}

function fixtureGapHint(benchmark: FoundryEngineeringBenchmark, projectRoot: string): string {
  const parseSrc = readProjectFile(projectRoot, 'src/parse.mjs') || ''
  const parseTest = readProjectFile(projectRoot, 'src/parse.test.mjs') || ''
  const joinSrc = readProjectFile(projectRoot, 'src/join.mjs') || ''
  const joinTest = readProjectFile(projectRoot, 'src/join.test.mjs') || ''
  const priceSrc = readProjectFile(projectRoot, 'src/price.mjs') || ''
  const priceTest = readProjectFile(projectRoot, 'src/price.test.mjs') || ''
  const app = readProjectFile(projectRoot, 'app.js') || ''
  const server = readProjectFile(projectRoot, 'server.mjs') || ''
  if (benchmark.benchmarkId === 'GRAD-H-TEST-REPAIR-V1' && /list - \(list \* discountPct/.test(priceSrc)) {
    return 'NEXT_REQUIRED_FILE=src/price.mjs still adds tax to the original list. file.write path=src/price.mjs now with Math.round((list * (1 - discountPct / 100)) * (1 + taxPct / 100)).'
  }
  if (benchmark.benchmarkId === 'GRAD-H-TEST-REPAIR-V1' && /invoiceTotal\(200,\s*20,\s*10\),\s*180/.test(priceTest)) {
    return 'NEXT_REQUIRED_FILE=src/price.test.mjs still has a stale expected total. file.write path=src/price.test.mjs now so every assertion matches the required formula.'
  }
  if (benchmark.benchmarkId === 'GRAD-H-TEST-REPAIR-V2' && /parseInt/.test(parseSrc)) {
    return 'NEXT_REQUIRED_FILE=src/parse.mjs still uses parseInt. FIRST file.write path=src/parse.mjs returning Number(raw) only when /^\\d+$/ else null. Then file.write the test file.'
  }
  if (benchmark.benchmarkId === 'GRAD-H-TEST-REPAIR-V2' && !/\\d\+|\[0-9\]/.test(parseSrc)) {
    return 'NEXT_REQUIRED_FILE=src/parse.mjs regex is missing digit class. file.write path=src/parse.mjs with if (/^\\d+$/.test(String(raw))) return Number(raw); else return null; The pattern is backslash-d-plus, not =d+.'
  }
  if (benchmark.benchmarkId === 'GRAD-H-TEST-REPAIR-V2' && /parseAge\('12px'\),\s*12/.test(parseTest)) {
    return 'NEXT_REQUIRED_FILE=src/parse.test.mjs still expects parseInt junk. file.write path=src/parse.test.mjs now: keep parseAge(\'21\'), 21 and change the 12px expected value to null.'
  }
  if (benchmark.benchmarkId === 'GRAD-H-TEST-REPAIR-V3' && /join\(''\)/.test(joinSrc)) {
    return 'NEXT_REQUIRED_FILE=src/join.mjs still concatenates. FIRST file.write path=src/join.mjs with parts.join(","). Then file.write the test file.'
  }
  if (benchmark.benchmarkId === 'GRAD-H-TEST-REPAIR-V3' && /joinTokens\(\['a',\s*'b'\]\),\s*'ab'/.test(joinTest)) {
    return 'NEXT_REQUIRED_FILE=src/join.test.mjs still expects concatenation. file.write path=src/join.test.mjs now: keep tokenize and change expected join to \'a,b\'.'
  }
  if (benchmark.expectedArtifacts.includes('app.js') && /\/wrong/.test(app)) {
    return 'NEXT_REQUIRED_FILE=app.js still fetches /wrong. file.write path=app.js now.'
  }
  const store = readProjectFile(projectRoot, 'store.mjs') || ''
  if (benchmark.benchmarkId === 'GRAD-DA-DATABASE-V1' && /:memory:/.test(store)) {
    return 'NEXT_REQUIRED_FILE=store.mjs still opens :memory:. file.write path=store.mjs now with DatabaseSync("parts.db"), UNIQUE sku, and withTxn BEGIN/COMMIT/ROLLBACK.'
  }
  const catalog = readProjectFile(projectRoot, 'catalog.mjs') || ''
  if (benchmark.benchmarkId === 'GRAD-DA-DATABASE-V2' && (/:memory:/.test(catalog) || !/foreign_keys/.test(catalog))) {
    return 'NEXT_REQUIRED_FILE=catalog.mjs. file.write path=catalog.mjs with DatabaseSync("catalog.db"), PRAGMA foreign_keys = ON, booksByAuthor WHERE author_id, and migrate ALTER TABLE books ADD COLUMN year.'
  }
  const mainJs = readProjectFile(projectRoot, 'main.js') || ''
  const saveJs = readProjectFile(projectRoot, 'save.js') || ''
  if (benchmark.benchmarkId === 'GRAD-DK-DESKTOP-V1' && /wrong\.json/.test(saveJs)) {
    return 'NEXT_REQUIRED_FILE=save.js still writes wrong.json. file.write path=save.js so saveNote writes notes.json and returns true. Do not edit main.js. Then COMPLETE.'
  }
  if (benchmark.benchmarkId === 'GRAD-DK-DESKTOP-V1' && /notes\.json/.test(saveJs) && /WINDOW_READY/.test(mainJs)) {
    return ''
  }
  const metaJs = readProjectFile(projectRoot, 'meta.js') || ''
  if (benchmark.benchmarkId === 'GRAD-DK-DESKTOP-V2' && (/size: 0/.test(metaJs) || !/statSync/.test(metaJs))) {
    return 'NEXT_REQUIRED_FILE=meta.js fileMeta still returns size 0. file.write path=meta.js using fs.statSync and path.basename. Do not edit main.js. Then COMPLETE.'
  }
  if (benchmark.benchmarkId === 'GRAD-DK-DESKTOP-V2' && /statSync/.test(metaJs) && /WINDOW_READY/.test(mainJs)) {
    return ''
  }
  if (benchmark.benchmarkId === 'GRAD-RF-REFACTOR-V1' && existsSync(path.join(projectRoot, 'src/blank.mjs'))) {
    const aSrc = readProjectFile(projectRoot, 'src/a.mjs') || ''
    const bSrc = readProjectFile(projectRoot, 'src/b.mjs') || ''
    if (!/blank\.mjs/.test(aSrc) || !/blank\.mjs/.test(bSrc)) {
      return 'NEXT_REQUIRED_FILE=src/a.mjs and src/b.mjs must import { isBlank } from "./blank.mjs". file.write both files. Tests check the import.'
    }
  }
  if (benchmark.benchmarkId === 'GRAD-RF-REFACTOR-V2' && existsSync(path.join(projectRoot, 'src/repo.mjs'))) {
    const serviceSrc = readProjectFile(projectRoot, 'src/service.mjs') || ''
    if (!/repo\.mjs/.test(serviceSrc)) {
      return 'NEXT_REQUIRED_FILE=src/service.mjs still inlines JSON. file.write path=src/service.mjs importing { load, save } from "./repo.mjs".'
    }
  }
  const pkgJson = readProjectFile(projectRoot, 'package.json') || ''
  if (benchmark.benchmarkId === 'GRAD-LP-LIBRARY-V1' && !/"exports"/.test(pkgJson)) {
    return 'NEXT_REQUIRED_FILE=package.json missing exports. file.write path=package.json with "exports": { ".": "./src/index.mjs" }.'
  }
  if (benchmark.benchmarkId === 'GRAD-LP-LIBRARY-V2' && !/"exports"/.test(pkgJson)) {
    return 'NEXT_REQUIRED_FILE=package.json missing exports. file.write path=package.json exporting ".", "./slug", and "./title". Do not export ./words.'
  }
  const utilJs = readProjectFile(projectRoot, 'lib/util.js') || ''
  if (benchmark.benchmarkId === 'GRAD-LV-LEGACY-V1' && !/tallyDiscount/.test(utilJs)) {
    return 'NEXT_REQUIRED_FILE=lib/util.js. Add tallyDiscount(items, pct) returning tally(items) * (1 - pct/100). Keep var tally, label, and module.exports. Do not rewrite to ESM.'
  }
  const computeJs = readProjectFile(projectRoot, 'lib/compute.js') || ''
  if (benchmark.benchmarkId === 'GRAD-LV-LEGACY-V2' && !/computeAsync/.test(computeJs)) {
    return 'NEXT_REQUIRED_FILE=lib/compute.js. Keep compute(a,b,cb). Add computeAsync(a,b) Promise via addPair. Keep CommonJS.'
  }
  if (benchmark.benchmarkId === 'GRAD-RF-REFACTOR-V1' && !existsSync(path.join(projectRoot, 'src/blank.mjs'))) {
    return 'NEXT_REQUIRED_FILE=src/blank.mjs missing. file.write path=src/blank.mjs exporting isBlank, then file.write src/a.mjs and src/b.mjs to import it.'
  }
  if (benchmark.benchmarkId === 'GRAD-RF-REFACTOR-V2' && !existsSync(path.join(projectRoot, 'src/repo.mjs'))) {
    return 'NEXT_REQUIRED_FILE=src/repo.mjs missing. file.write path=src/repo.mjs with load/save, then file.write src/service.mjs to import them.'
  }
  const pipeline = readProjectFile(projectRoot, 'pipeline.mjs') || ''
  if (benchmark.benchmarkId === 'GRAD-DP-DATA-V1' && /continue/.test(pipeline) && !/errors \+= 1|errors\+\+|errors = errors \+ 1/.test(pipeline)) {
    return 'NEXT_REQUIRED_FILE=pipeline.mjs skips bad rows without counting them. file.write path=pipeline.mjs adding errors += 1 in the invalid-row branch before continue.'
  }
  const events = readProjectFile(projectRoot, 'events.mjs') || ''
  if (benchmark.benchmarkId === 'GRAD-DP-DATA-V2' && /unique \+= 1/.test(events) && !/seen/.test(events)) {
    return 'NEXT_REQUIRED_FILE=events.mjs still counts duplicate ids. file.write path=events.mjs using a Set of seen ids and continue on duplicates.'
  }
  const money = readProjectFile(projectRoot, 'src/index.mjs') || ''
  if (benchmark.benchmarkId === 'GRAD-LP-LIBRARY-V1' && /replace\('\$', ''\)/.test(money) && !/\* 100/.test(money)) {
    return 'NEXT_REQUIRED_FILE=src/index.mjs still returns dollars not cents. file.write path=src/index.mjs with Math.round(Number(stripped)*100) and throw on invalid. Also add package.json exports.'
  }
  const slug = readProjectFile(projectRoot, 'src/slug.mjs') || ''
  if (benchmark.benchmarkId === 'GRAD-LP-LIBRARY-V2' && /join\(''\)/.test(slug)) {
    return 'NEXT_REQUIRED_FILE=src/slug.mjs still concatenates. file.write path=src/slug.mjs with lowercase hyphen join. file.write src/title.mjs to capitalize words. Add package.json exports without ./words.'
  }
  const notesStore = readProjectFile(projectRoot, 'store.mjs') || ''
  const notesServer = readProjectFile(projectRoot, 'server.mjs') || ''
  if (benchmark.benchmarkId === 'GRAD-FX-FEATURE-V2') {
    const archiveFn = notesStore.split('export function archiveNote')[1]?.split('export function')[0] || ''
    if (!/save\s*\(/.test(archiveFn)) {
      return 'NEXT_REQUIRED_FILE=store.mjs archiveNote sets archived but does not save. file.write path=store.mjs adding save(items) in archiveNote and restoreNote after changing archived. Then add server archive routes.'
    }
    if (!/\/notes\/archive/.test(notesServer) || !/archiveNote\s*\(/.test(notesServer)) {
      return 'NEXT_REQUIRED_FILE=server.mjs missing POST /notes/archive. file.write path=server.mjs adding POST /notes/archive and POST /notes/restore JSON { id } plus GET /notes?archived=1 via listArchived(). Keep POST /notes. Then COMPLETE.'
    }
    return ''
  }
  if (benchmark.benchmarkId === 'GRAD-FZ-FEATURE-V3') {
    if (!/>=/.test(notesStore)) {
      return 'NEXT_REQUIRED_FILE=store.mjs listMinPriority still returns every task. file.write path=store.mjs so listMinPriority(min) returns load().filter(task => task.priority >= min). Keep addTask and setPriority. Then COMPLETE after server query exists.'
    }
    if (!/\/tasks\/priority/.test(notesServer) || !/setPriority\s*\(/.test(notesServer)) {
      return 'NEXT_REQUIRED_FILE=server.mjs missing POST /tasks/priority. file.write path=server.mjs adding POST /tasks/priority JSON { id, priority } calling setPriority. Keep GET /tasks minPriority and POST /tasks. Then COMPLETE.'
    }
    return ''
  }
  const siteApp = readProjectFile(projectRoot, 'app.js') || ''
  const siteCss = readProjectFile(projectRoot, 'styles.css') || ''
  if (benchmark.benchmarkId === 'GRAD-SW-STATIC-V1' && /return items/.test(siteApp) && !/includes\(/.test(siteApp) && !/indexOf\(/.test(siteApp)) {
    return 'NEXT_REQUIRED_FILE=app.js applyFilter still returns every item. file.write path=app.js filtering name/tag by query.toLowerCase() and saving localStorage.setItem("atelier-filter", query). Then write styles.css @media and about.html.'
  }
  if (benchmark.benchmarkId === 'GRAD-SW-STATIC-V1' && !/localStorage/.test(siteApp)) {
    return 'NEXT_REQUIRED_FILE=app.js missing localStorage. file.write path=app.js calling localStorage.setItem("atelier-filter", input.value) on Apply before render. Keep applyFilter. Then COMPLETE after styles.css @media and about.html exist.'
  }
  if (benchmark.benchmarkId === 'GRAD-SW-STATIC-V1' && !/@media/.test(siteCss)) {
    return 'NEXT_REQUIRED_FILE=styles.css missing @media. file.write path=styles.css with @media (max-width: 640px) { nav a { display: block; } } Then file.write path=about.html.'
  }
  if (benchmark.benchmarkId === 'GRAD-SW-STATIC-V1' && !existsSync(path.join(projectRoot, 'about.html'))) {
    return 'NEXT_REQUIRED_FILE=about.html missing. file.write path=about.html with h1 About North Atelier and a link to index.html. Then COMPLETE. Do not add a server.'
  }
  if (benchmark.benchmarkId === 'GRAD-SW-STATIC-V1' && existsSync(path.join(projectRoot, 'about.html')) && /@media/.test(siteCss) && /localStorage/.test(siteApp)) {
    return ''
  }
  if (benchmark.expectedArtifacts.includes('server.mjs') && !existsSync(path.join(projectRoot, 'server.mjs'))) {
    return 'NEXT_REQUIRED_FILE=server.mjs is missing. FIRST ACTION file.write path=server.mjs now. Do not COMPLETE. Do not only run tests.'
  }
  if (benchmark.expectedArtifacts.includes('server.mjs') && existsSync(path.join(projectRoot, 'server.mjs')) && !/POST/.test(server)) {
    return 'NEXT_REQUIRED_FILE=server.mjs missing POST routes. file.write path=server.mjs now with GET /health and resource POST. Do not COMPLETE.'
  }
  if (benchmark.benchmarkId === 'GRAD-C-BACKEND-V3' && /else if \(req\.url === ['\"]\/txns['\"]\)/.test(server)) {
    return 'NEXT_REQUIRED_FILE=server.mjs GET /txns is swallowing POST. file.write path=server.mjs checking req.method on every branch. Use string ids. Do not COMPLETE.'
  }
  return ''
}

function publicWorkerBrief(benchmark: FoundryEngineeringBenchmark): string {
  const finalClass = publicFinalClassBrief(benchmark)
  if (finalClass) return finalClass
  const hard = publicHardEngineeringBrief(benchmark)
  if (hard) return hard
  const d3 = publicD3Brief(benchmark)
  if (d3) return d3
  const expansion = publicMultiFixtureBrief(benchmark)
  if (expansion) return expansion
  if (benchmark.letter === 'E') {
    return [
      'Build a Node CLI in this isolated project.',
      'Required behavior: --help prints Usage and exits 0; --name greets using the person field from data.json (Hello <name>) and exits 0; --sum reads numbers from data.json and prints their arithmetic total; unknown flags exit 2; success commands exit 0.',
      'Add cli.mjs and cli.test.mjs. cli.mjs is an ES module: do not use require(). Read data.json with fs.readFileSync + JSON.parse. Tests must look like: import test from "node:test"; import assert from "node:assert/strict"; import { spawnSync } from "node:child_process"; test("help", () => { const r = spawnSync(process.execPath, ["cli.mjs","--help"], { encoding:"utf8" }); assert.match(r.stdout, /Usage/i); assert.equal(r.status, 0); }); Use r.status not r.exitCode. Trim or match stdout; do not require exact bytes. Do not hardcode the sum. Do not read files outside this project.',
    ].join(' ')
  }
  if (benchmark.letter === 'G') {
    return [
      'Inspect this calculator module, diagnose the failing behavior, and repair it.',
      'Preserve existing multiply behavior. Add must be arithmetically correct. Keep and pass project tests. Do not be told the faulty line. Do not edit files outside the write set.',
    ].join(' ')
  }
  if (benchmark.letter === 'B') {
    return [
      'Repair the JavaScript frontend module so createApp() returns working behavior.',
      'increment must increase count by 1 and return the new count. validateEmail(email) must return false for invalid emails and true for valid emails; do not always return true.',
      'submit(name, email) must not throw. If email is invalid, return null. If email is valid, record the name and return that name string.',
      'Export createApp from app.js. Tests may be added in app.test.mjs. Do not fake interactions with static output. No backend.',
    ].join(' ')
  }
  if (benchmark.letter === 'C') {
    return [
      'Build a REST-style Node API in server.mjs: GET /health 200, GET /items, POST /items with name validation (400 when missing), persist to data.json, unknown routes 404, print PORT=<n> on listen.',
    ].join(' ')
  }
  return benchmark.missionPrompt
}

function publicSuccessCriteria(benchmark: FoundryEngineeringBenchmark): string[] {
  return benchmark.acceptanceCriteria
    .filter(item => item.required)
    .map(item => item.description)
}

function assertDisposable(projectRoot: string): void {
  const root = path.resolve(projectRoot)
  const blocked = /Harbor Desk|Lane & Box|Inventory Manager|\/terra\/|\/wrim\/|higher-vision|hvs/i
  if (blocked.test(root) || (root.includes(path.resolve(process.cwd())) && /app\/\(war-room\)/.test(root))) {
    throw new Error('GRADUATION_PROTECTED_TARGET')
  }
  const projects = path.resolve(getFoundryProjectsRoot())
  if (!root.startsWith(projects)) throw new Error('GRADUATION_OUTSIDE_FOUNDRY_PROJECTS')
}

function writeSeedFile(projectRoot: string, rel: string, content: string): void {
  const dest = path.join(projectRoot, rel)
  mkdirSync(path.dirname(dest), { recursive: true })
  writeFileSync(dest, content, 'utf8')
}

function listProjectFiles(projectRoot: string): Array<{ path: string; size: number }> {
  if (!existsSync(projectRoot)) return []
  const names = readdirSync(projectRoot, { recursive: true }) as string[]
  const out: Array<{ path: string; size: number }> = []
  for (const name of names.sort()) {
    const abs = path.join(projectRoot, name)
    const info = statSync(abs)
    if (!info.isFile()) continue
    out.push({ path: name.replace(/\\/g, '/'), size: info.size })
  }
  return out
}

function readProjectFile(projectRoot: string, rel: string): string | null {
  const abs = path.join(projectRoot, rel)
  if (!existsSync(abs) || !statSync(abs).isFile()) return null
  return readFileSync(abs, 'utf8')
}

function isForbiddenWorkerPath(rel: string): boolean {
  const norm = rel.replace(/\\/g, '/')
  return (
    /(^|\/)graduation\/hidden\//.test(norm)
    || /(^|\/)\.foundry-expected\.json$/.test(norm)
    || /(^|\/)\.env$/.test(norm)
    || /foundryEngineeringGraduation(Verifiers|Fixtures)/.test(norm)
    || /referenceSolution/.test(norm)
    || /FOUNDRY_CONTRACTS_ROOT/.test(norm)
  )
}

function leakScan(text: string, hidden: FoundryGraduationHiddenOracle, publicFiles: Record<string, string>): number {
  let leaks = 0
  for (const value of Object.values(hidden.values)) {
    const token = String(value)
    if (!token || token.length < 4) continue
    if (/^\d+$/.test(token)) continue
    if (/^(keep|true|false|null|none|body|name|size|test|main|file|from|with|this)$/i.test(token)) continue
    if (token.length < 8 && !/[A-Z]/.test(token) && !/[-_.]/.test(token)) continue
    const inPublic = Object.entries(publicFiles).some(([rel, content]) => content.includes(token) || rel === token || rel.endsWith(`/${token}`) || rel.includes(token))
    if (!inPublic && text.includes(token)) leaks += 1
  }
  if (/(?:^|[^a-z])graduation\/hidden|\.foundry-expected\.json/.test(text) && /FOUNDRY_CONTRACTS_ROOT|readFileSync\(.*hidden/.test(text)) leaks += 1
  return leaks
}

function detectTestWeakening(projectRoot: string, beforeTests: Record<string, string>): number {
  let count = 0
  for (const [rel, before] of Object.entries(beforeTests)) {
    const after = readProjectFile(projectRoot, rel)
    if (after == null) {
      count += 1
      continue
    }
    if (/test\.skip|assert\.(ok|equal)\(\s*true\s*,\s*true|assert\.equal\([^,]+,\s*[^)]+\)\s*;?\s*\/\/ always/.test(after)) count += 1
    if (/multiply\(3,\s*4\),\s*12/.test(before) && !/multiply\(3,\s*4\),\s*12/.test(after)) count += 1
    if (/keepPositive/.test(before) && !/keepPositive/.test(after)) count += 1
    if (/quote\('nope'/.test(before) && !/quote\('nope'/.test(after)) count += 1
    if (/invoiceTotal\(100,\s*10,\s*0\),\s*90/.test(before) && !/invoiceTotal\(100,\s*10,\s*0\),\s*90/.test(after)) count += 1
    if (/parseAge\('21'\),\s*21/.test(before) && !/parseAge\('21'\),\s*21/.test(after)) count += 1
    if (/tokenize\('a b'\)/.test(before) && !/tokenize\('a b'\)/.test(after)) count += 1
    if (/createDesk exported/.test(before) && !/createDesk exported/.test(after)) count += 1
    if (/createBoard exported/.test(before) && !/createBoard exported/.test(after)) count += 1
    if (/createRoster exported/.test(before) && !/createRoster exported/.test(after)) count += 1
    if (/uses file db/.test(before) && !/uses file db/.test(after)) count += 1
    if (/tallyDiscount/.test(before) && !/tallyDiscount/.test(after)) count += 1
    if (/shared blank/.test(before) && !/shared blank/.test(after)) count += 1
    if (/aggregates valid rows/.test(before) && !/aggregates valid rows/.test(after)) count += 1
    if (/a imports blank/.test(before) && !/a imports blank/.test(after)) count += 1
    if (/service imports repo/.test(before) && !/service imports repo/.test(after)) count += 1
    if (/package exports/.test(before) && !/package exports/.test(after)) count += 1
    if (/server source implements POST/.test(before) && !/server source implements POST/.test(after)) count += 1
    if (/import assert from ['\"]node:assert/.test(before) && !/import assert from ['\"]node:assert/.test(after)) count += 1
    if (/archive hides note/.test(before) && !/archive hides note/.test(after)) count += 1
    if (/priority filter/.test(before) && !/priority filter/.test(after)) count += 1
    if (/filter narrows services/.test(before) && !/filter narrows services/.test(after)) count += 1
    if (/responsive css present/.test(before) && !/responsive css present/.test(after)) count += 1
    if (/server source implements archive/.test(before) && !/server source implements archive/.test(after)) count += 1
    if (/server source implements priority/.test(before) && !/server source implements priority/.test(after)) count += 1
    if (/persists filter query/.test(before) && !/persists filter query/.test(after)) count += 1
  }
  const created = ['cli.test.mjs', 'app.test.mjs', 'src/math.test.mjs', 'src/window.test.mjs', 'src/quote.test.mjs', 'src/inventory.test.mjs', 'src/price.test.mjs', 'src/parse.test.mjs', 'src/join.test.mjs', 'server.test.mjs', 'src/report.test.mjs', 'store.test.mjs', 'catalog.test.mjs', 'util.test.mjs', 'compute.test.mjs', 'src/blank.test.mjs', 'src/service.test.mjs', 'pipeline.test.mjs', 'events.test.mjs', 'src/index.test.mjs', 'src/kit.test.mjs', 'site.test.mjs']
  for (const rel of created) {
    const text = readProjectFile(projectRoot, rel)
    if (text && /assert\.(ok|equal)\(\s*true\s*,\s*true/.test(text)) count += 1
  }
  return count
}

function allowedTools(): FoundryModelToolDescription[] {
  return FOUNDRY_MODEL_TOOL_CATALOG.filter(item => (ALLOWED_TOOL_NAMES as readonly string[]).includes(item.name))
}

function durable(counts: FoundryModelDrivenGovernanceCounts, input: {
  missionId: string
  actionId: string
  actionClass: string
  kind: 'model' | 'tool' | 'test' | 'write' | 'replan' | 'verify'
  mutating: boolean
  tool?: string
  provider?: string
  model?: string
  writeSet?: string[]
  summary: string
  ok: boolean
}): boolean {
  const started = beginUnattendedDurableAction({
    missionId: input.missionId,
    actionId: input.actionId,
    actionClass: input.actionClass,
    kind: input.kind,
    mutating: input.mutating,
    tool: input.tool,
    provider: input.provider,
    model: input.model,
    writeSet: input.writeSet,
  })
  if (!started.ok) {
    counts.MODEL_ACTION_WITHOUT_DURABLE_ID_COUNT += 1
    return false
  }
  completeUnattendedDurableAction(input.actionId, { ok: input.ok, summary: input.summary })
  return true
}

function recordSpecialVerify(
  counts: FoundryModelDrivenGovernanceCounts,
  missionId: string,
  runId: string,
  suffix: string,
  verify: { methods: string[]; criteria: Array<{ required: boolean; passed: boolean; criterionId: string }> },
  benchmark: FoundryEngineeringBenchmark,
): void {
  const ok = verify.criteria.filter(item => item.required).every(item => item.passed)
  const summary = verify.criteria.filter(item => item.required && !item.passed).map(item => item.criterionId).join(',') || 'ok'
  if (verify.methods.includes('HTTP')) {
    durable(counts, { missionId, actionId: `${runId}-http-${suffix}`, actionClass: 'HTTP_VERIFY', kind: 'verify', mutating: false, summary, ok })
  }
  if (benchmark.projectClass === 'DATABASE_APP') {
    durable(counts, { missionId, actionId: `${runId}-db-${suffix}`, actionClass: 'DATABASE_VERIFY', kind: 'verify', mutating: false, summary, ok })
  }
  if (benchmark.projectClass === 'DESKTOP_APP') {
    durable(counts, { missionId, actionId: `${runId}-desktop-${suffix}`, actionClass: 'DESKTOP_RUN', kind: 'verify', mutating: false, summary, ok })
  }
}

function applyHardGovernance(counts: FoundryModelDrivenGovernanceCounts, verifyNotes: string[]): void {
  for (const note of verifyNotes) {
    const orphans = /DESKTOP_ORPHANS=(\d+)/.exec(note)
    if (orphans) counts.DESKTOP_FIXTURE_ORPHAN_PROCESS_COUNT += Number(orphans[1])
    const rewrite = /LEGACY_REWRITE=(\d+)/.exec(note)
    if (rewrite) counts.LEGACY_REWRITE_SHORTCUT_COUNT += Number(rewrite[1])
  }
}

function executeWorkerTool(input: {
  missionId: string
  runId: string
  projectRoot: string
  benchmark: FoundryEngineeringBenchmark
  toolName: string
  args: Record<string, unknown>
  counts: FoundryModelDrivenGovernanceCounts
  hidden: FoundryGraduationHiddenOracle
}): { ok: boolean; reason: string; excerpt?: string; error?: string; mutating: boolean } {
  const relRaw = typeof input.args.path === 'string' ? input.args.path : ''
  const rel = relRaw.replace(/^\/+/, '').replace(/\\/g, '/')
  if (rel && (isForbiddenWorkerPath(rel) || rel.includes('..'))) {
    input.counts.HIDDEN_ORACLE_READ_BY_ENGINEER_COUNT += 1
    return { ok: false, reason: 'FORBIDDEN_PATH', error: 'Worker may not read hidden oracle or verifier infrastructure.', mutating: false }
  }
  if (input.toolName === 'workspace.inspect' || input.toolName === 'project.inspect') {
    const files = listProjectFiles(input.projectRoot)
    return { ok: true, reason: 'inspect', excerpt: JSON.stringify({ projectRoot: 'isolated-fixture', files }, null, 2).slice(0, 4_000), mutating: false }
  }
  if (input.toolName === 'workspace.search') {
    const query = String(input.args.query ?? '')
    const prefix = typeof input.args.pathPrefix === 'string' ? input.args.pathPrefix : ''
    const hits: string[] = []
    for (const file of listProjectFiles(input.projectRoot)) {
      if (prefix && !file.path.startsWith(prefix)) continue
      const text = readProjectFile(input.projectRoot, file.path) ?? ''
      if (query && text.includes(query)) hits.push(file.path)
    }
    return { ok: true, reason: 'search', excerpt: hits.slice(0, 40).join('\n'), mutating: false }
  }
  if (input.toolName === 'file.read') {
    if (!rel) return { ok: false, reason: 'PATH_REQUIRED', error: 'path required', mutating: false }
    const text = readProjectFile(input.projectRoot, rel)
    if (text == null) return { ok: false, reason: 'NOT_FOUND', error: `${rel} not found`, mutating: false }
    return { ok: true, reason: 'read', excerpt: text.slice(0, 6_000), mutating: false }
  }
  if (input.toolName === 'file.write' || input.toolName === 'file.replace_unique') {
    if (!rel) return { ok: false, reason: 'PATH_REQUIRED', error: 'path required', mutating: true }
    if (input.benchmark.outOfScopePaths.some(item => rel === item || rel.endsWith(`/${item}`))) {
      return { ok: false, reason: 'NEEDS_COMMANDER', error: `Out of scope: ${rel}`, mutating: true }
    }
    if (input.benchmark.writeSet.length && !input.benchmark.writeSet.includes(rel)) {
      return { ok: false, reason: 'NEEDS_COMMANDER', error: `Not in write set: ${rel}`, mutating: true }
    }
    let content = typeof input.args.content === 'string' ? input.args.content : ''
    if (input.toolName === 'file.replace_unique') {
      const existing = readProjectFile(input.projectRoot, rel) ?? ''
      const match = typeof input.args.matchText === 'string' ? input.args.matchText : ''
      const replacement = typeof input.args.replacementText === 'string' ? input.args.replacementText : ''
      if (match) {
        const parts = existing.split(match)
        if (parts.length !== 2) return { ok: false, reason: 'MATCH_NOT_UNIQUE', error: 'matchText must occur exactly once', mutating: true }
        content = parts[0] + replacement + parts[1]
      } else {
        content = replacement || existing
      }
    }
    const write = unattendedToolBrokerWrite({
      missionId: input.missionId,
      actionId: `${input.runId}-w-${createHash('sha256').update(`${rel}:${content}`).digest('hex').slice(0, 12)}`,
      relPath: rel,
      content,
      workspaceRoot: input.projectRoot,
    })
    if (write.brokerBypass) input.counts.MODEL_DIRECT_FILESYSTEM_WRITE_COUNT += 1
    let excerpt = write.ok ? `wrote ${rel} (${content.length} bytes)` : write.reason
    if (write.ok && /\.(mjs|js|cjs)$/.test(rel)) {
      if (/server\.mjs$/.test(rel)) {
        const listen = spawnSync(foundryNodeExecutable(), [rel], {
          cwd: input.projectRoot,
          encoding: 'utf8',
          timeout: 2_000,
          env: { ...process.env, PORT: '0' },
        })
        const text = `${listen.stdout || ''}\n${listen.stderr || ''}`
        excerpt += `\nLISTEN ${text.slice(0, 400)}`
        if (/PORT=0\b/.test(text) && !/PORT=[1-9]/.test(text)) {
          excerpt += '\nHINT: PORT=0 is wrong. Print server.address().port after listen, not process.env.PORT. Example: const addr = server.address(); if (addr && typeof addr === "object") console.log("PORT=" + addr.port)'
        }
        if (/req\.url === ['\"]\/txns['\"]/.test(content) && !/req\.method === ['\"]GET['\"] && req\.url === ['\"]\/txns['\"]/.test(content) && !/req\.method===['\"]GET['\"]&&req\.url===['\"]\/txns['\"]/.test(content)) {
          excerpt += '\nSTOP: GET /txns branch is missing req.method so POST /txns is swallowed. file.write path=server.mjs again. Every route must check method AND path. Use string ids.'
        }
        if (/\.mjs$/.test(rel) && /require\(/.test(content)) {
          excerpt += '\nHINT: server.mjs is ESM. Do not use require(). Use import { readFileSync, writeFileSync } from "node:fs"; JSON.parse(readFileSync(new URL("./checkins.json", import.meta.url), "utf8")) or the persist file for this fixture.'
        }
        if (input.benchmark.expectedArtifacts.includes('app.js') && !/fetch\(/.test(readProjectFile(input.projectRoot, 'app.js') || '')) {
          excerpt += '\nHINT: app.js createDesk/createBoard must fetch(baseUrl + route). file.write path=app.js. Do not leave lastError="not implemented".'
        }
      } else {
        if (/meta\.js$/.test(rel) && input.benchmark.benchmarkId === 'GRAD-DK-DESKTOP-V2' && /statSync/.test(content) && !/name: 'wrong'/.test(content)) {
          excerpt += '\nSTOP: meta.js uses statSync. Do not edit further. COMPLETE. main.js is out of write-set.'
        }
        if (/main\.js$/.test(rel) && /require\(['"]electron['"]\)/.test(content)) {
          excerpt += '\nSMOKE skipped: Electron main cannot be executed with node. Keep console.log("WINDOW_READY").'
          if (input.benchmark.benchmarkId === 'GRAD-DK-DESKTOP-V1' && /notes\.json/.test(content) && /WINDOW_READY/.test(content) && /save-note/.test(content)) {
            excerpt += '\nSTOP: notes.json path is correct. Do not edit main.js again. COMPLETE.'
          }
          if (input.benchmark.benchmarkId === 'GRAD-DK-DESKTOP-V2' && /statSync/.test(content) && /WINDOW_READY/.test(content)) {
            excerpt += '\nSTOP: fileMeta uses statSync. Do not edit main.js again. COMPLETE.'
          }
        } else {
          if (/main\.js$/.test(rel) && !/WINDOW_READY/.test(content)) {
            excerpt += '\nSTOP: main.js must console.log("WINDOW_READY"). Do not drop the Electron window. Change only saveNote/fileMeta.'
          }
          const smokeArgs = rel === 'cli.mjs' || rel.endsWith('/cli.mjs') || rel.endsWith('/src/cli.mjs')
            ? [rel, '--help']
            : [rel]
          const smoke = spawnSync(foundryNodeExecutable(), smokeArgs, { cwd: input.projectRoot, encoding: 'utf8', timeout: 6_000 })
          excerpt += `\nSMOKE exit=${smoke.status}\n${(smoke.stdout || '') + (smoke.stderr || '')}`.slice(0, 2_000)
          if (smoke.status !== 0 && /cli\.mjs$/.test(rel)) {
            excerpt += '\nHINT: cli.mjs is ESM. Do not use require or __dirname. Use import { readFileSync, writeFileSync } from "node:fs"; JSON.parse(readFileSync(new URL("./records.json", import.meta.url), "utf8")) or the fixture file next to the CLI. --convert must write output.json via writeFileSync.'
          }
          if (/cli\.mjs$/.test(rel)) {
            const nope = spawnSync(foundryNodeExecutable(), [rel, '--nope'], { cwd: input.projectRoot, encoding: 'utf8', timeout: 6_000 })
            excerpt += `\nSMOKE --nope exit=${nope.status} (must be 2 for unknown flags)`
            const extra = rel.endsWith('src/cli.mjs')
              ? spawnSync(foundryNodeExecutable(), [rel, '--count'], { cwd: input.projectRoot, encoding: 'utf8', timeout: 6_000 })
              : spawnSync(foundryNodeExecutable(), [rel, '--max'], { cwd: input.projectRoot, encoding: 'utf8', timeout: 6_000 })
            excerpt += `\nSMOKE extra exit=${extra.status} stdout=${(extra.stdout || '').slice(0, 80)} stderr=${(extra.stderr || '').slice(0, 120)}`
          }
          if (/app\.js$/.test(rel) && !existsSync(path.join(input.projectRoot, 'server.mjs')) && input.benchmark.expectedArtifacts.includes('server.mjs')) {
            excerpt += '\nHINT: This fixture also requires server.mjs. file.write path=server.mjs immediately. Frontend lastList must come from HTTP GET after POST, not a local fake array.'
          }
        }
      }
    }
    if (write.ok && input.benchmark.expectedTests.length && !/\.test\.(mjs|js)$/.test(rel)) {
      for (const testRel of input.benchmark.expectedTests) {
        if (!existsSync(path.join(input.projectRoot, testRel))) continue
        const tests = spawnSync(foundryNodeExecutable(), ['--test', testRel], { cwd: input.projectRoot, encoding: 'utf8', timeout: 10_000 })
        excerpt += `\nAUTO_TEST ${testRel} exit=${tests.status}\n${(tests.stdout || '') + (tests.stderr || '')}`.slice(0, 2_500)
        if (tests.status !== 0) excerpt += '\nHINT: If two tests disagree, one expectation is stale. Implement the behavior from the brief, then file.write the test file so every assertion matches that behavior. Do not skip tests. Do not keep two contradictory tests for the same input.'
        const gap = fixtureGapHint(input.benchmark, input.projectRoot)
        if (gap) excerpt += `\nSTOP: ${gap}`
      }
    }
    if (write.ok && /\.test\.(mjs|js)$/.test(rel)) {
      const tests = spawnSync(foundryNodeExecutable(), ['--test', rel], { cwd: input.projectRoot, encoding: 'utf8', timeout: 10_000 })
      excerpt += `\nNODE_TEST exit=${tests.status}\n${(tests.stdout || '') + (tests.stderr || '')}`.slice(0, 3_000)
      excerpt += '\nHINT: spawnSync returns .status not .exitCode. stdout includes a trailing newline; use trim() or assert.match. Use process.execPath not the string "node" if PATH is minimal.'
      excerpt += '\nREQUIRED IMPORTS: import test from "node:test"; import assert from "node:assert/strict"; import { spawnSync } from "node:child_process"; Always pass { encoding: "utf8" } to spawnSync so stdout is a string.'
    }
    return { ok: write.ok, reason: write.reason, excerpt, error: write.ok ? undefined : write.reason, mutating: true }
  }
  if (input.toolName === 'test.run' || input.toolName === 'terminal.execute') {
    const tests = input.benchmark.expectedTests.length ? input.benchmark.expectedTests : ['--test']
    const args = tests[0] === '--test' ? ['--test'] : ['--test', ...tests]
    const result = spawnSync(foundryNodeExecutable(), args, { cwd: input.projectRoot, encoding: 'utf8', timeout: 12_000 })
    let excerpt = `${result.stdout || ''}\n${result.stderr || ''}`
    if (existsSync(path.join(input.projectRoot, 'cli.mjs')) || existsSync(path.join(input.projectRoot, 'src/cli.mjs'))) {
      const cliRel = existsSync(path.join(input.projectRoot, 'cli.mjs')) ? 'cli.mjs' : 'src/cli.mjs'
      const help = spawnSync(foundryNodeExecutable(), [cliRel, '--help'], { cwd: input.projectRoot, encoding: 'utf8', timeout: 6_000 })
      excerpt += `\nCLI --help exit=${help.status}\n${help.stdout || ''}\n${help.stderr || ''}`
    }
    excerpt = excerpt.slice(0, 4_000)
    if (result.status !== 0) {
      excerpt += '\nHINT: node:test files must use import test from "node:test". spawnSync returns .status not .exitCode. stdout has a trailing newline — trim() or assert.match(/Usage/i). Use process.execPath as the executable.'
    }
    if ((readProjectFile(input.projectRoot, 'server.mjs') || '').includes('implement routes')) {
      excerpt += '\nSTOP: server.mjs is still the 500 stub. Do not keep running tests. file.write path=server.mjs now with GET /health, resource routes, and persistence.'
    }
    const serverSrc = readProjectFile(input.projectRoot, 'server.mjs') || ''
    if (serverSrc.includes('/health') && !/POST/.test(serverSrc)) {
      excerpt += '\nSTOP: server.mjs only has GET /health. file.write path=server.mjs to add POST/GET/PUT/DELETE resource routes. Do not keep running tests.'
    }
    return { ok: result.status === 0, reason: `exit ${result.status}`, excerpt, error: result.status === 0 ? undefined : excerpt.slice(0, 800), mutating: false }
  }
  if (input.toolName === 'engineering.diagnose' || input.toolName === 'engineering.plan' || input.toolName === 'engineering.baseline' || input.toolName === 'code.owners' || input.toolName === 'code.impact') {
    return {
      ok: true,
      reason: input.toolName,
      excerpt: JSON.stringify({
        PRIMARY_OWNER: input.benchmark.writeSet,
        ALLOWED_WRITE_SET: input.benchmark.writeSet,
        BASELINE_CAPTURED: true,
        NEXT: 'Use file.write or file.replace_unique on write-set files, then test.run. MAP/IMPACT/BASELINE are satisfied for this small isolated fixture.',
      }, null, 2),
      mutating: false,
    }
  }
  return { ok: false, reason: 'TOOL_NOT_EXPOSED', error: `Tool ${input.toolName} is not available in this benchmark worker.`, mutating: false }
}

function visibleFileExcerpts(projectRoot: string): Array<{ source: string; text: string }> {
  return listProjectFiles(projectRoot).map(file => ({
    source: file.path,
    text: (readProjectFile(projectRoot, file.path) ?? '').slice(0, 4_000),
  }))
}

function buildContext(input: {
  missionId: string
  benchmark: FoundryEngineeringBenchmark
  projectRoot: string
  findings: string[]
  changedFiles: string[]
  recentToolResults: FoundryModelContext['recentToolResults']
  recentErrors: FoundryModelContext['recentErrors']
  loopWarning?: string
}): FoundryModelContext {
  const excerpts = visibleFileExcerpts(input.projectRoot)
  return {
    missionId: input.missionId,
    missionKind: 'application',
    userRequest: `${publicWorkerBrief(input.benchmark)} Visible project files are included below. For these small files, file.write with path, content, and reason is the correct mutation. Then call test.run.`,
    goal: publicWorkerBrief(input.benchmark),
    successCriteria: publicSuccessCriteria(input.benchmark),
    constraints: [
      'Mutations only through Tool Broker file.write / file.replace_unique. Args: path (string), content or replacementText (string), reason (string).',
      'Stay inside the isolated project write set. Do not read verifier source or expected-answer files outside this project.',
      'Do not weaken tests, skip tests, or change acceptance criteria.',
      'Do not commit, push, deploy, package, install, or activate.',
      'Do not claim PASS; the independent verifier is authoritative.',
      'MAP/IMPACT/BASELINE are satisfied for this small isolated fixture. Implement next.',
      ...input.benchmark.forbiddenShortcuts.map(item => `Forbidden: ${item}`),
      `Write set: ${input.benchmark.writeSet.join(', ') || '(none)'}`,
    ],
    permissions: MODEL_GRAD_PERMISSIONS,
    phase: 'EXECUTING',
    plan: [
      { id: 'inspect', title: 'Inspect isolated fixture', status: 'done' },
      { id: 'implement', title: 'Implement required behavior', status: 'active' },
      { id: 'test', title: 'Run tests', status: 'pending' },
    ],
    hypotheses: [],
    changedFiles: input.changedFiles,
    importantFindings: [
      'CURRENT_INTENT=PATCH_SOURCE',
      'NEXT_REQUIRED_ACTION=TOOL',
      'RECOMMENDED_TOOL_CLASS=file.write',
      `MISSING_REQUIRED_FILES=${input.benchmark.expectedArtifacts.filter(rel => !existsSync(path.join(input.projectRoot, rel))).join(',') || 'none'}`,
      fixtureGapHint(input.benchmark, input.projectRoot),
      `VISIBLE_FILES:\n${excerpts.map(item => `--- ${item.source} ---\n${item.text}`).join('\n')}`,
      ...input.findings.slice(-8),
    ],
    relevantExcerpts: excerpts,
    visualEvidence: [],
    recentToolResults: input.recentToolResults.slice(-8),
    recentErrors: input.recentErrors.slice(-8),
    unresolvedQuestions: [],
    completionGate: { complete: false, missing: publicSuccessCriteria(input.benchmark), detail: 'Independent verifier has not passed.' },
    loopWarning: input.loopWarning,
    tools: allowedTools(),
  }
}

function snapshotArtifacts(benchmarkId: string, projectRoot: string): void {
  const dest = path.join(resolveRepoRoot(), 'tmp/foundry-model-graduation/last', benchmarkId)
  mkdirSync(dest, { recursive: true })
  for (const file of listProjectFiles(projectRoot)) {
    const text = readProjectFile(projectRoot, file.path)
    if (text == null) continue
    const target = path.join(dest, file.path)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, text, 'utf8')
  }
}

function sanitizeVerifierDetail(detail: string | undefined, hidden: FoundryGraduationHiddenOracle): string {
  let text = String(detail ?? '')
  for (const value of Object.values(hidden.values)) {
    const token = String(value)
    if (token.length >= 2) text = text.split(token).join('[hidden]')
  }
  return text.slice(0, 160)
}

export class FoundryModelGraduationHarness {
  constructor(private readonly options: {
    benchmarkIds?: string[]
    includeOptionalBackend?: boolean
    pinProvider?: FoundryModelProviderId | null
  } = {}) {}

  listBenchmarks(): FoundryEngineeringBenchmark[] {
    const ids = (this.options.benchmarkIds?.length ? this.options.benchmarkIds : selectModelGraduationBenchmarkIds())
      .map(normalizeModelGraduationBenchmarkId)
    const stretch = this.options.includeOptionalBackend || process.env.FOUNDRY_MODEL_GRADUATION_STRETCH === '1'
    const selected = stretch ? [...ids, ...FOUNDRY_MODEL_DRIVEN_OPTIONAL_BENCHMARK_IDS.filter(id => !ids.includes(id))] : ids
    return selected.map(id => getGraduationBenchmark(id)).filter((item): item is FoundryEngineeringBenchmark => Boolean(item))
  }

  async runSuite(): Promise<{
    runs: FoundryGraduationRun[]
    reportPath: string
    providerProbe: Awaited<ReturnType<typeof probeModelGraduationProviders>>
  }> {
    const probe = await probeModelGraduationProviders()
    const runs: FoundryGraduationRun[] = []
    if (!probe.available) {
      const blocked = this.listBenchmarks()
      for (const benchmark of blocked) {
        runs.push(this.blockedRun(benchmark, 'MODEL_PROVIDER_UNAVAILABLE', 'PROVIDER'))
      }
    } else {
      for (const benchmark of this.listBenchmarks()) {
        runs.push(await this.runModelDrivenBenchmark(benchmark.benchmarkId))
      }
    }
    const reportPath = writeGraduationReport({
      schemaVersion: FOUNDRY_GRADUATION_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      suite: 'model-driven',
      providerProbe: probe,
      runs,
    }, 'FOUNDRY_MODEL_DRIVEN_GRADUATION_REPORT.json')
    return { runs, reportPath, providerProbe: probe }
  }

  private blockedRun(
    benchmark: FoundryEngineeringBenchmark,
    reason: string,
    failureClass: FoundryGraduationFailureClass,
  ): FoundryGraduationRun {
    const runId = `GR-${randomUUID()}`
    const run: FoundryGraduationRun = {
      schemaVersion: FOUNDRY_GRADUATION_SCHEMA_VERSION,
      runId,
      benchmarkId: benchmark.benchmarkId,
      projectClass: benchmark.projectClass,
      missionId: `gm-${runId.slice(0, 8)}`,
      fixtureId: `${benchmark.benchmarkId}:blocked`,
      variant: 'v1',
      projectRoot: '',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      result: 'BLOCKED',
      failureClass,
      criteria: benchmark.acceptanceCriteria.map(item => ({
        criterionId: item.criterionId,
        required: item.required,
        passed: false,
        method: 'NOT_AVAILABLE',
        detail: reason,
      })),
      passedRequiredCount: 0,
      requiredCount: benchmark.acceptanceCriteria.filter(item => item.required).length,
      forbiddenShortcutHits: [],
      resourceUsage: { ...EMPTY_RESOURCE_SUMMARY },
      providers: [],
      models: [],
      toolFamilies: [],
      evidenceRefs: [runId],
      verificationMethods: ['NOT_AVAILABLE'],
      projectReady: false,
      verdict: null,
      governance: { ...EMPTY_GRADUATION_GOVERNANCE },
      unattendedAuthorized: false,
      notes: [reason],
      engineeringMode: 'model-driven',
      modelRouteCalls: [],
      modelDrivenGovernance: { ...EMPTY_MODEL_DRIVEN_GOVERNANCE },
    }
    saveGraduationRun(run)
    return run
  }

  async runModelDrivenBenchmark(id: string, opts: { variant?: string } = {}): Promise<FoundryGraduationRun> {
    const benchmark = getGraduationBenchmark(normalizeModelGraduationBenchmarkId(id))
    if (!benchmark) throw new Error(`Unknown benchmark ${id}`)
    const runId = `GR-${randomUUID()}`
    const attemptId = `GA-${randomUUID()}`
    const missionId = `gm-${runId.slice(0, 8)}`
    const started = Date.now()
    const projectRoot = path.join(getFoundryProjectsRoot(), 'graduation', runId, benchmark.benchmarkId.toLowerCase())
    assertDisposable(projectRoot)
    mkdirSync(projectRoot, { recursive: true })

    const verifierPath = path.join(resolveRepoRoot(), 'lib/native-builder/foundryEngineeringGraduationVerifiers.ts')
    const verifierHashStart = createHash('sha256').update(readFileSync(verifierPath)).digest('hex')
    const criteriaSnapshot = JSON.stringify(benchmark.acceptanceCriteria)

    const material = seedFixture(benchmark, opts.variant ?? 'v1')
    const identity = fixtureIdentityFor(benchmark, material.hidden, material.variant)
    const publicFiles: Record<string, string> = { ...material.files }
    for (const [rel, content] of Object.entries(material.files)) writeSeedFile(projectRoot, rel, content)
    const hidden: FoundryGraduationHiddenOracle = { runId, benchmarkId: benchmark.benchmarkId, values: material.hidden }
    saveHiddenOracle(hidden)
    const beforeTests: Record<string, string> = {}
    for (const rel of benchmark.expectedTests) {
      const text = readProjectFile(projectRoot, rel)
      if (text != null) beforeTests[rel] = text
    }

    const { graph, mission, acceptance } = prepareGraduationMission({
      missionId,
      projectRoot,
      benchmark,
      resourceBudget: budgetFor(benchmark),
    })
    refuseAutomaticBudgetIncrease(missionId)

    const governance = { ...EMPTY_GRADUATION_GOVERNANCE }
    const counts: FoundryModelDrivenGovernanceCounts = { ...EMPTY_MODEL_DRIVEN_GOVERNANCE }
    const budget = budgetFor(benchmark)
    const notes: string[] = [
      'engineeringMode:model-driven',
      'referenceApply:disabled',
      'verification ignores model self-report',
      `resourceBudget=${budget.maxModelCalls}calls/${budget.maxWallClockMs}ms`,
    ]
    const providers: string[] = []
    const models: string[] = []
    const toolFamilies = new Set<string>()
    const resourceUsage = { ...EMPTY_RESOURCE_SUMMARY }
    const routeCalls: FoundryModelRouteCallRecord[] = []
    const actions: FoundryGraduationAttemptRecord['actions'] = []
    const patches: string[] = []
    const testLog: FoundryGraduationAttemptRecord['tests'] = []
    const findings: string[] = []
    const changedFiles: string[] = []
    const recentToolResults: FoundryModelContext['recentToolResults'] = [{
      tool: 'workspace.inspect',
      ok: true,
      reason: 'seed-visible-files',
      excerpt: JSON.stringify(visibleFileExcerpts(projectRoot), null, 2).slice(0, 6_000),
    }]
    const recentErrors: FoundryModelContext['recentErrors'] = []
    const fingerprints: string[] = []
    let replans = 0
    let loopWarning: string | undefined
    let realModelRoute = false
    let initialPlan = ''
    let failureClass: FoundryGraduationFailureClass | null = null

    const auth = authorizeUnattendedEnvelope({ missionId, graph, commanderConfirmed: true })
    if (!auth.ok) notes.push(auth.reason)
    const startedEnv = startUnattendedEnvelope({ missionId, graph })
    const unattendedAuthorized = startedEnv.status === 'ACTIVE' || auth.ok
    notes.push(`continuePromptRequired=${startedEnv.continuePromptRequired ? 1 : 0}`)
    if (startedEnv.continuePromptRequired) counts.MODEL_GRADUATION_CONTINUE_PROMPT_COUNT += 1

    const commit = refuseUnattendedGitMutation('commit')
    const push = refuseUnattendedGitMutation('push')
    const deploy = refuseUnattendedGitMutation('deploy')
    if (commit.count) governance.BENCHMARK_AUTO_COMMIT_COUNT += commit.count
    if (push.count) governance.BENCHMARK_AUTO_PUSH_COUNT += push.count
    if (deploy.count) governance.BENCHMARK_DEPLOY_COUNT += deploy.count

    const router = new FoundryModelRouter()
    let kind: FoundryModelRequestKind = 'chooseNextAction'
    let lastVerify: Awaited<ReturnType<typeof independentlyVerify>> | null = null
    let result: FoundryGraduationRunResult = 'FAIL'

    const maxCalls = budget.maxModelCalls
    for (let turn = 0; turn < maxCalls; turn += 1) {
      if (Date.now() - started > budget.maxWallClockMs) {
        failureClass = 'RESOURCE'
        result = 'BLOCKED'
        notes.push('wall-clock budget exhausted')
        break
      }
      const context = buildContext({
        missionId,
        benchmark,
        projectRoot,
        findings,
        changedFiles,
        recentToolResults,
        recentErrors,
        loopWarning,
      })
      const contextText = JSON.stringify(context)
      if (turn === 0) counts.BENCHMARK_SOLUTION_LEAK_COUNT += leakScan(contextText, hidden, publicFiles)

      const actionId = `${runId}-model-${turn}`
      durable(counts, {
        missionId,
        actionId,
        actionClass: 'MODEL_CALL',
        kind: 'model',
        mutating: false,
        summary: kind,
        ok: true,
      })
      let routed
      try {
        routed = await router.route(kind, { kind, context }, {
          missionId,
          graphId: graph.graphId,
          requestedProvider: this.options.pinProvider ?? null,
          pinProvider: this.options.pinProvider ?? null,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        recentErrors.push({ klass: 'PROVIDER', message: message.slice(0, 400) })
        if (!realModelRoute) {
          failureClass = 'PROVIDER'
          result = 'BLOCKED'
          notes.push(`MODEL_PROVIDER_UNAVAILABLE: ${message.slice(0, 200)}`)
          break
        }
        kind = 'diagnoseFailure'
        continue
      }
      resourceUsage.modelCalls += 1
      resourceUsage.tokens += Math.ceil(contextText.length / 4) + (routed.response.ok ? Math.ceil((routed.response.rawText || '').length / 4) : 0)
      const fallbackOccurred = routed.attempts.length > 1 || routed.reason === 'FALLBACK'
      routeCalls.push({
        callId: actionId,
        kind,
        requestedProvider: routed.requestedProvider,
        selectedProvider: routed.selectedProvider,
        selectedModel: routed.selectedModel,
        reason: routed.reason,
        fallbackOccurred,
        ok: routed.response.ok,
        latencyMs: routed.response.latencyMs,
        tokens: Math.ceil(contextText.length / 4),
        estimatedCostUsd: 0,
        failureClass: routed.response.ok ? null : routed.response.failureClass,
        decision: routed.response.ok ? routed.response.decision.decision : null,
      })
      if (routed.selectedProvider) providers.push(routed.selectedProvider)
      if (routed.selectedModel) models.push(routed.selectedModel)
      if (turn === 0) {
        notes.push(`firstRoute=${routed.selectedProvider}:${routed.selectedModel} reason=${routed.reason} attempts=${routed.attempts.map(item => `${item.provider}:${item.ok ? 'ok' : (item.error ?? 'fail').slice(0, 80)}`).join('|')}`)
      }
      if (routed.response.ok && routed.selectedProvider && routed.selectedProvider !== 'none' && routed.selectedModel !== 'harness-reference') {
        realModelRoute = true
      }

      if (!routed.response.ok) {
        recentErrors.push({ klass: routed.response.failureClass, message: routed.response.error.slice(0, 400) })
        if (!realModelRoute && (routed.response.failureClass === 'UNAVAILABLE' || routed.response.failureClass === 'PROVIDER')) {
          failureClass = 'PROVIDER'
          result = 'BLOCKED'
          notes.push(`MODEL_PROVIDER_UNAVAILABLE: ${routed.response.error.slice(0, 200)}`)
          break
        }
        if (routed.response.failureClass === 'TIMEOUT' || routed.response.failureClass === 'CONTEXT_LIMIT') {
          failureClass = 'PROVIDER'
          kind = 'diagnoseFailure'
          continue
        }
        kind = 'diagnoseFailure'
        continue
      }

      const decision = routed.response.decision
      if (!initialPlan) initialPlan = decision.reasoningSummary
      if (decision.planChanges?.findings) findings.push(...decision.planChanges.findings)
      findings.push(decision.reasoningSummary)

      if (decision.decision === 'TOOL' && decision.tool) {
        toolFamilies.add(decision.tool.name)
        const fingerprint = createHash('sha256').update(`${decision.tool.name}:${JSON.stringify(decision.tool.args)}`).digest('hex')
        fingerprints.push(fingerprint)
        const repeats = fingerprints.filter(item => item === fingerprint).length
        if (repeats >= STAGNATION_REPEAT) {
          loopWarning = 'Repeated identical tool request. Choose a different action or REPLAN.'
          if (replans < MAX_REPLANS) {
            const task = graph.tasks.find(item => item.mutating) ?? graph.tasks[0]
            task.status = 'FAILED'
            task.blocker = 'Stagnation: repeated identical patch/tool.'
            const replan = evaluateCommandCenterReplan({
              graph,
              taskId: task.taskId,
              observation: { taskId: task.taskId, fingerprint, ok: false, kind: 'failure', detail: 'repeated identical action' },
              missionContract: mission,
              acceptanceContract: acceptance,
            })
            replans += 1
            resourceUsage.replans += 1
            durable(counts, {
              missionId,
              actionId: `${runId}-replan-${replans}`,
              actionClass: replan.record.level === 'L2' ? 'L2_REPLAN' : replan.record.level === 'L1' ? 'L1_REPLAN' : 'L0_STEER',
              kind: 'replan',
              mutating: false,
              summary: replan.record.level,
              ok: replan.applied,
            })
            if (replan.record.level === 'L3') {
              result = 'NEEDS_COMMANDER'
              failureClass = 'CONTRACT'
              notes.push('L3 requires Commander')
              break
            }
            kind = 'replan'
            continue
          }
          failureClass = 'IMPLEMENTATION'
          notes.push('stagnation after max replans')
          break
        }
        const observation = executeWorkerTool({
          missionId,
          runId,
          projectRoot,
          benchmark,
          toolName: decision.tool.name,
          args: decision.tool.args,
          counts,
          hidden,
        })
        resourceUsage.toolCalls += 1
        if (decision.tool.name === 'test.run' || decision.tool.name === 'terminal.execute') {
          resourceUsage.testRuns += 1
          testLog.push({ ok: observation.ok, detail: observation.excerpt?.slice(0, 200) ?? observation.reason })
          durable(counts, {
            missionId,
            actionId: `${runId}-test-${resourceUsage.testRuns}`,
            actionClass: 'TEST',
            kind: 'test',
            mutating: false,
            tool: decision.tool.name,
            summary: observation.reason,
            ok: observation.ok,
          })
        }
        if (typeof decision.tool.args.path === 'string' && observation.ok && (decision.tool.name === 'file.write' || decision.tool.name === 'file.replace_unique')) {
          changedFiles.push(String(decision.tool.args.path))
          patches.push(String(decision.tool.args.path))
          snapshotArtifacts(benchmark.benchmarkId, projectRoot)
          const mid = await independentlyVerify({ benchmark, projectRoot, hidden })
          const publicFails = mid.criteria.filter(item => item.required && !item.passed).map(item => `${item.criterionId} failed (${sanitizeVerifierDetail(item.detail, hidden)})`)
          if (publicFails.length) {
            recentErrors.push({ klass: 'VERIFICATION', message: publicFails.join('; ').slice(0, 400) })
            findings.push(`Independent verifier after write: ${publicFails.join('; ')}`)
          } else {
            findings.push('Independent verifier: all required criteria currently pass. You may COMPLETE.')
          }
        }
        actions.push({
          tool: decision.tool.name,
          ok: observation.ok,
          path: typeof decision.tool.args.path === 'string' ? String(decision.tool.args.path) : undefined,
          reason: observation.reason,
        })
        recentToolResults.push({
          tool: decision.tool.name,
          ok: observation.ok,
          reason: observation.reason,
          excerpt: observation.excerpt?.slice(0, 2_000),
          error: observation.error,
        })
        if (!observation.ok) recentErrors.push({ klass: 'TOOLING', message: observation.error ?? observation.reason })
        if (decision.tool.name === 'test.run' || decision.tool.name === 'terminal.execute') {
          const mid = await independentlyVerify({ benchmark, projectRoot, hidden })
          const publicFails = mid.criteria.filter(item => item.required && !item.passed).map(item => `${item.criterionId} failed (${sanitizeVerifierDetail(item.detail, hidden)})`)
          if (publicFails.length) {
            recentErrors.push({ klass: 'VERIFICATION', message: publicFails.join('; ').slice(0, 400) })
            findings.push(`Independent verifier: ${publicFails.join('; ')}`)
          }
        }
        const gap = fixtureGapHint(benchmark, projectRoot)
        if (gap) loopWarning = gap
        kind = observation.ok ? 'chooseNextAction' : 'diagnoseFailure'
        continue
      }

      if (decision.decision === 'REPLAN') {
        if (replans >= MAX_REPLANS) {
          notes.push('max replans reached')
          failureClass = 'PLANNING'
          break
        }
        const task = graph.tasks.find(item => item.mutating) ?? graph.tasks[0]
        task.status = 'FAILED'
        task.blocker = decision.reasoningSummary
        const replan = evaluateCommandCenterReplan({
          graph,
          taskId: task.taskId,
          observation: { taskId: task.taskId, fingerprint: `replan-${replans}`, ok: false, kind: 'failure', detail: decision.reasoningSummary },
          missionContract: mission,
          acceptanceContract: acceptance,
        })
        replans += 1
        resourceUsage.replans += 1
        durable(counts, {
          missionId,
          actionId: `${runId}-replan-${replans}`,
          actionClass: replan.record.level === 'L2' ? 'L2_REPLAN' : replan.record.level === 'L1' ? 'L1_REPLAN' : 'L0_STEER',
          kind: 'replan',
          mutating: false,
          summary: replan.record.level,
          ok: replan.applied,
        })
        if (replan.record.level === 'L3') {
          result = 'NEEDS_COMMANDER'
          failureClass = 'CONTRACT'
          break
        }
        kind = 'chooseNextAction'
        continue
      }

      if (decision.decision === 'BLOCKED') {
        failureClass = 'PLANNING'
        notes.push(decision.blocker?.blocker ?? 'model blocked')
        break
      }

      if (decision.decision === 'COMPLETE') {
        lastVerify = await independentlyVerify({ benchmark, projectRoot, hidden })
        durable(counts, {
          missionId,
          actionId: `${runId}-verify-${turn}`,
          actionClass: 'VERIFY',
          kind: 'verify',
          mutating: false,
          summary: lastVerify.criteria.filter(item => item.required && !item.passed).map(item => item.criterionId).join(',') || 'all-required-passed',
          ok: lastVerify.criteria.filter(item => item.required).every(item => item.passed),
        })
        const required = lastVerify.criteria.filter(item => item.required)
        const allRequired = required.length > 0 && required.every(item => item.passed) && lastVerify.forbiddenShortcutHits.length === 0
        if (allRequired) {
          result = 'PASS'
          break
        }
        const publicFails = required.filter(item => !item.passed).map(item => `${item.criterionId} failed (${sanitizeVerifierDetail(item.detail, hidden)})`)
        recentErrors.push({ klass: 'VERIFICATION', message: publicFails.join('; ').slice(0, 400) })
        findings.push(`Independent verifier rejected completion: ${publicFails.join('; ')}`)
        const gap = fixtureGapHint(benchmark, projectRoot)
        if (gap) {
          loopWarning = `COMPLETE is forbidden. ${gap}`
          findings.push(loopWarning)
        }
        kind = 'diagnoseFailure'
      }
    }

    if (JSON.stringify(benchmark.acceptanceCriteria) !== criteriaSnapshot) counts.BENCHMARK_CRITERIA_MUTATION_COUNT += 1
    const verifierHashEnd = createHash('sha256').update(readFileSync(verifierPath)).digest('hex')
    if (verifierHashEnd !== verifierHashStart) counts.VERIFIER_MUTATION_COUNT += 1
    counts.MODEL_TEST_WEAKENING_COUNT += detectTestWeakening(projectRoot, beforeTests)
    const written = listProjectFiles(projectRoot)
      .filter(file => /\.(mjs|js|cjs|ts|html|css)$/.test(file.path) || file.path === 'package.json' || file.path.endsWith('/package.json'))
      .map(file => `${file.path}:${readProjectFile(projectRoot, file.path) ?? ''}`)
      .join('\n')
    counts.BENCHMARK_SOLUTION_LEAK_COUNT += leakScan(written, hidden, publicFiles)
    if (/sk_live_|BEGIN RSA PRIVATE KEY|SUPABASE_SERVICE_ROLE_KEY/.test(written)) counts.MODEL_GRADUATION_SECRET_LEAK_COUNT += 1

    snapshotArtifacts(benchmark.benchmarkId, projectRoot)
    lastVerify = await independentlyVerify({ benchmark, projectRoot, hidden })
    durable(counts, {
      missionId,
      actionId: `${runId}-verify-final`,
      actionClass: 'VERIFY',
      kind: 'verify',
      mutating: false,
      summary: lastVerify.criteria.filter(item => item.required && !item.passed).map(item => item.criterionId).join(',') || 'final',
      ok: lastVerify.criteria.filter(item => item.required).every(item => item.passed),
    })
    recordSpecialVerify(counts, missionId, runId, 'final', lastVerify, benchmark)
    applyHardGovernance(counts, lastVerify.notes)
    bindEvidence({ missionId, mission, acceptance, criteria: lastVerify.criteria })
    const verdict = evaluateVerdictLayer({
      missionId,
      graphId: graph.graphId,
      engineeringClass: 'STANDALONE_ENGINEER',
      missionContract: mission,
      acceptanceContract: acceptance,
      reviewOutcome: 'PASS',
      executorResult: 'PROPOSED_COMPLETE',
    })
    const required = lastVerify.criteria.filter(item => item.required)
    const passedRequired = required.filter(item => item.passed)
    const allRequired = required.length > 0 && passedRequired.length === required.length && lastVerify.forbiddenShortcutHits.length === 0
    if (result !== 'BLOCKED' && result !== 'NEEDS_COMMANDER') {
      result = allRequired ? 'PASS' : passedRequired.length ? 'PARTIAL' : 'FAIL'
    }
    if (result === 'PASS' && (!realModelRoute || counts.REFERENCE_SOLUTION_APPLY_COUNT > 0 || counts.REFERENCE_IMPLEMENTATION_WRITE_COUNT > 0 || counts.REFERENCE_FALLBACK_AFTER_MODEL_FAILURE_COUNT > 0)) {
      counts.FALSE_MODEL_DRIVEN_PASS_COUNT += 1
      result = 'FAIL'
      notes.push('FALSE_MODEL_DRIVEN_PASS prevented')
    }
    const projectReady = projectReadyFromVerdict({
      engineeringClass: 'STANDALONE_ENGINEER',
      tasksComplete: allRequired && result === 'PASS',
      verdict,
      missionContract: mission,
      acceptanceContract: acceptance,
    })
    if (projectReady && (result !== 'PASS' || required.some(item => !item.passed))) {
      governance.PROJECT_READY_WITH_FAILED_CRITERION_COUNT += 1
    }
    if (result !== 'PASS' && !failureClass) {
      failureClass = result === 'BLOCKED' ? 'PROVIDER' : (benchmark.letter === 'G' ? 'DEBUGGING' : 'IMPLEMENTATION')
    }

    const totals = loadActiveResourceBudget(missionId)?.totals
    resourceUsage.wallClockMs = Date.now() - started
    resourceUsage.estimatedCostUsd = totals?.estimatedCostUsd ?? 0
    resourceUsage.actualCostUsd = totals?.actualCostUsd ?? null
    resourceUsage.replans = replans
    notes.push(`actionTrace=${actions.map(item => `${item.tool}:${item.ok ? 'ok' : 'fail'}`).join(',') || 'none'}`)
    notes.push(`patches=${patches.join(',') || 'none'}`)

    completeUnattendedEnvelope(missionId)

    const attempt: FoundryGraduationAttemptRecord = {
      attemptId,
      runId,
      benchmarkId: benchmark.benchmarkId,
      provider: providers.at(-1) ?? null,
      model: models.at(-1) ?? null,
      initialPlan,
      actions,
      patches,
      tests: testLog,
      verifierResult: result,
      failureClass,
      resourceUse: resourceUsage,
      createdAt: new Date().toISOString(),
    }
    saveGraduationAttempt(attempt)

    const run: FoundryGraduationRun = {
      schemaVersion: FOUNDRY_GRADUATION_SCHEMA_VERSION,
      runId,
      benchmarkId: benchmark.benchmarkId,
      projectClass: benchmark.projectClass,
      missionId,
      fixtureId: `${identity.fixtureId}:model-driven`,
      variant: material.variant,
      projectRoot,
      startedAt: new Date(started).toISOString(),
      finishedAt: new Date().toISOString(),
      result,
      failureClass,
      criteria: lastVerify.criteria,
      passedRequiredCount: passedRequired.length,
      requiredCount: required.length,
      forbiddenShortcutHits: lastVerify.forbiddenShortcutHits,
      resourceUsage,
      providers: [...new Set(providers)],
      models: [...new Set(models)],
      toolFamilies: [...toolFamilies],
      evidenceRefs: [runId, attemptId],
      verificationMethods: lastVerify.methods,
      projectReady: Boolean(projectReady && result === 'PASS'),
      verdict: verdict.result,
      governance,
      unattendedAuthorized,
      notes: [
        ...notes,
        ...lastVerify.notes,
        `realModelRoute=${realModelRoute ? 'PASS' : 'FAIL'}`,
        `uiVerification=${lastVerify.uiVerificationMethod}`,
      ],
      engineeringMode: 'model-driven',
      modelRouteCalls: routeCalls,
      modelDrivenGovernance: counts,
      attemptHistoryRef: attemptId,
      fixtureIdentity: identity,
    }
    saveGraduationRun(run)
    if (!GOVERNANCE_ONLY.has(benchmark.letter)) {
      persistCertification(
        benchmark.projectClass,
        benchmark.language,
        listGraduationRuns().filter(item => item.projectClass === benchmark.projectClass && !GOVERNANCE_ONLY.has(item.benchmarkId.split('-')[1] ?? '')),
      )
    }
    return run
  }
}
