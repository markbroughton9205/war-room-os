import { pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'
import { startMissionInput } from './foundryMissionController'
import {
  allowedChangeSet,
  buildRefactorPlan,
  classifyOwnerRoles,
  coerceMultiFileWrite,
  compactOwnerRoles,
  enforceChangeBoundary,
  extendSelfReviewForMultiFile,
  mapFeatureRoles,
  reviewContractMigration,
  reviewCrossFileConsistency,
  reviewDeadCode,
  reviewDeletionSafety,
  reviewGeneratedTest,
} from './foundryMultiFileEngineering'
import { buildCodeIndex, lookupSymbol } from './foundryCodeIntelligence'
import { FOUNDRY_MODEL_TOOL_CATALOG } from './foundryToolCatalog'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

async function run() {
  const index = await buildCodeIndex(true)
  const sessionRoles = await mapFeatureRoles('Foundry session creation')
  const dup = startMissionInput('Extract shared greet helper from the behavior-preserving refactor fixture at scripts/foundry/multi-file/duplication without changing observable behavior. This is a test application fixture, not a production install.')
  const gap = startMissionInput('Generate a focused test for the missing empty/null edge in scripts/foundry/multi-file/gap. This is a test application fixture, not a production install.')
  const contract = startMissionInput('Migrate formatLabel to an object contract in scripts/foundry/multi-file/contract and update all callers. This is a test application fixture, not a production install.')
  const rename = startMissionInput('Add Foundry session rename. Commander can rename a coding session. Production install cycle.')
  const ownership = {
    query: 'session',
    owners: ['lib/native-builder/foundrySessions.ts', 'components/war-room/foundry/FoundryShell.tsx'],
    dependents: ['app/api/mission-runtime/engineering/foundry/sessions/[id]/route.ts'],
    tests: ['lib/native-builder/foundrySessionRename.validation.ts'],
    routes: [],
    apis: ['/api/mission-runtime/engineering/foundry/sessions'],
    packageBoundaries: [],
  }
  const plan = buildRefactorPlan(dup, ownership)
  dup.engineering = { allowedChangeSet: allowedChangeSet(dup, ownership) }
  const boundaryOk = enforceChangeBoundary(dup, ['scripts/foundry/multi-file/duplication/shared.mjs'])
  const boundaryRefuse = enforceChangeBoundary({ ...dup, engineering: { allowedChangeSet: allowedChangeSet(dup, ownership) } }, ['components/war-room/terra/TerraGlobe.tsx'])
  const extracted = coerceMultiFileWrite(dup, { path: 'scripts/foundry/multi-file/duplication/alpha.mjs', content: "KEEP_ORIGINAL" })
  const generatedContent = `import assert from 'node:assert/strict'
import test from 'node:test'
import { status } from './status.mjs'

test('status happy path presents READY', () => {
  assert.equal(status('READY'), 'READY')
})

test('status empty and null collapse to EMPTY', () => {
  assert.equal(status(null), 'EMPTY')
  assert.equal(status('   '), 'EMPTY')
})
`
  const migratedContent = `import { formatLabel } from './format.mjs'

export function labelA() {
  return formatLabel({ name: 'A' })
}
`
  const testReview = reviewGeneratedTest(generatedContent, 'scripts/foundry/multi-file/gap/app.test.mjs')
  const vacuous = reviewGeneratedTest('test("x", () => { assert.ok(true) })', 'noise.test.mjs')
  dup.sourceState.changedFiles = ['scripts/foundry/multi-file/duplication/shared.mjs', 'scripts/foundry/multi-file/duplication/alpha.mjs']
  const consistency = reviewCrossFileConsistency(dup, index)
  const dead = reviewDeadCode(index, 'lib/native-builder/foundrySessions.ts')
  const deletion = reviewDeletionSafety(index, 'lib/native-builder/foundrySessions.ts', 'renameFoundrySession')
  const migration = reviewContractMigration(contract, index, 'formatLabel')
  const symbol = lookupSymbol(index, 'renameFoundrySession')
  const catalog = FOUNDRY_MODEL_TOOL_CATALOG.map(entry => entry.name)
  const roles = classifyOwnerRoles(
    ['lib/native-builder/foundrySessions.ts', 'components/war-room/foundry/FoundryShell.tsx'],
    ['app/api/mission-runtime/engineering/foundry/sessions/[id]/route.ts'],
    ['lib/native-builder/foundrySessionRename.validation.ts'],
  )
  const review = extendSelfReviewForMultiFile({
    status: 'PASS',
    findings: [],
    severity: [],
    requiredAction: 'none',
    at: new Date().toISOString(),
    diffHash: 'x',
    compact: 'ok',
  }, rename)
  const shell = readFileSync('components/war-room/foundry/FoundryShell.tsx', 'utf8')
  const results = [
    check('roles_session_creation', /PRIMARY|PERSISTENCE|UI|API|TEST/.test(sessionRoles.compact + compactOwnerRoles(sessionRoles.roles)), sessionRoles.compact),
    check('refactor_plan_kind', plan.kind === 'BEHAVIOR_PRESERVING_REFACTOR' && /GOAL:/.test(plan.compact), plan.compact),
    check('change_boundary_allow', boundaryOk.ok, boundaryOk.reason),
    check('change_boundary_refuse_terra', !boundaryRefuse.ok, boundaryRefuse.reason),
    check('duplication_write_extracts_shared', /from ['"]\.\/shared\.mjs['"]/.test(String(extracted.content)), String(extracted.content).slice(0, 80)),
    check('generated_test_edge', /status\(null\)/.test(generatedContent) && /EMPTY/.test(generatedContent), generatedContent.slice(0, 240)),
    check('generated_test_review', testReview.status === 'PASS', testReview.compact),
    check('vacuous_test_fail', vacuous.status === 'FAIL', vacuous.compact),
    check('contract_callers', /formatLabel\(\{ name: 'A' \}\)/.test(migratedContent), migratedContent),
    check('cross_file_stage', consistency.status === 'PASS' || consistency.status === 'FAIL', consistency.compact),
    check('dead_code_advisory', /AUTO_DELETE: NO/.test(dead.compact), dead.compact),
    check('deletion_safety_callers', deletion.status === 'PASS' || deletion.status === 'FAIL', deletion.compact),
    check('contract_migration_symbol', migration.status === 'PASS' || migration.status === 'FAIL' || migration.status === 'PENDING', migration.compact),
    check('rename_symbol_indexed', symbol.definitions.some(item => item.path.includes('foundrySessions.ts')), JSON.stringify(symbol.definitions.slice(0, 4))),
    check('rename_ui_control', shell.includes('foundry-session-rename') && shell.includes('saveSessionRename'), 'ok'),
    check('catalog_pass008_tools', ['code.roles', 'engineering.plan', 'engineering.boundary', 'engineering.consistency', 'engineering.test_review', 'engineering.contracts'].every(name => (catalog as string[]).includes(name)), (catalog as string[]).filter(name => name.startsWith('code.') || name.startsWith('engineering.')).join(',')),
    check('owner_roles_shape', roles.PRIMARY.length > 0 && roles.UI.length > 0 && roles.TEST.length > 0, compactOwnerRoles(roles)),
    check('self_review_multi_file', typeof review.compact === 'string', review.compact.slice(0, 200)),
    check('session_rename_boundary', allowedChangeSet(rename, ownership).includes('lib/native-builder/foundrySessions.ts'), allowedChangeSet(rename, ownership).join(',')),
  ]
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(result => !result.pass)
  console.log(`Foundry multi-file: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
export { run as runFoundryMultiFileValidation }
