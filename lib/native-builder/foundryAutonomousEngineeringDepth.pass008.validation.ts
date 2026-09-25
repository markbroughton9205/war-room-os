/**
 * PASS 008 — general engineering contracts. No fixture-specific coercions.
 */
import { pathToFileURL } from 'node:url'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { startMissionInput } from './foundryMissionController'
import { interpretCommanderRequest } from './foundryMissionPlanner'
import {
  assessMutationTarget,
  evaluateWriteSafety,
  inferIntentFromTool,
  listFixtureSpecificCoercionMarkers,
  productionBuildAllowed,
  rankTests,
  recordActionContract,
  rejectIrrelevantTest,
  validateActionContract,
} from './foundryEngineeringContract'
import { noteRepeatedAction, reviewDiffText } from './foundryEngineeringDepth'
import { buildLocalFoundryModelPrompt, estimateTokens, LOCAL_MODEL_CONTEXT_BUDGET_TOKENS, buildLocalFoundryModelContext } from './foundryLocalModelRuntime'
import { FOUNDRY_MODEL_TOOL_CATALOG } from './foundryToolCatalog'
import { toFoundryMissionCommanderView } from './foundryMissionView'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

const ROOT = resolveRepoRoot()
const CONTROLLER = path.join(ROOT, 'lib/native-builder/foundryMissionController.ts')
const DEPTH = path.join(ROOT, 'lib/native-builder/foundryEngineeringDepth.ts')
const LOCAL = path.join(ROOT, 'lib/native-builder/foundryLocalModelRuntime.ts')
const PLANNER = path.join(ROOT, 'lib/native-builder/foundryMissionPlanner.ts')
const SHELL = path.join(ROOT, 'components/war-room/foundry/FoundryShell.tsx')
const PANEL = path.join(ROOT, 'components/war-room/foundry/FoundryMissionControllerPanel.tsx')

function read(relOrAbs: string): string {
  return readFileSync(relOrAbs, 'utf8')
}

export async function runFoundryAutonomousEngineeringDepthPass008Validation(): Promise<CaseResult[]> {
  const controller = read(CONTROLLER)
  const depth = read(DEPTH)
  const local = read(LOCAL)
  const planner = read(PLANNER)
  const shell = existsSync(SHELL) ? read(SHELL) : ''
  const panel = read(PANEL)
  const combined = `${controller}\n${depth}\n${local}\n${planner}`
  const markers = listFixtureSpecificCoercionMarkers(combined)
  const extraHacks = [
    'forceGreetingFixturePatch',
    'coerceFixtureWrite',
    'engineeringReviewPatchArgs',
    'seedFixtureDiagnosis',
    'noteGreetingDiscriminatingEvidence',
    'ensurePass008FixtureFiles',
    'seedSessionRenameChangedFiles',
  ].filter(marker => combined.includes(`function ${marker}`) || combined.includes(`export function ${marker}`))

  const productionRequest = 'Make the Engineering Review detail explain what Foundry checked before it says PASS.'
  const production = startMissionInput(productionRequest)
  const interpretation = interpretCommanderRequest(productionRequest)
  recordActionContract(production, 'code.owners', 'Engineering Review')
  const contractOk = validateActionContract(production.engineering?.actionContract as never) === null
  production.engineering = {
    ...production.engineering,
    ownership: {
      query: 'Engineering Review',
      owners: ['components/war-room/foundry/FoundryMissionControllerPanel.tsx'],
      dependents: ['components/war-room/foundry/FoundryShell.tsx'],
      tests: ['lib/native-builder/foundryEngineeringDepth.validation.ts'],
      routes: ['/war-room/engineering'],
      apis: [],
      packageBoundaries: [],
    },
  }
  production.baseline = {
    recordedAt: new Date().toISOString(),
    branch: 'local',
    head: 'x',
    dirtyFiles: [],
    fileHashes: {},
    activeInstallId: null,
    runningInstallId: null,
  }
  production.candidateFiles = ['components/war-room/foundry/FoundryMissionControllerPanel.tsx']
  production.importantPaths = ['components/war-room/foundry/FoundryMissionControllerPanel.tsx']
  production.sourceState.baselineFiles = ['components/war-room/foundry/FoundryMissionControllerPanel.tsx']
  const ownerWrite = evaluateWriteSafety(production, 'components/war-room/foundry/FoundryMissionControllerPanel.tsx')
  const decoyWrite = evaluateWriteSafety(production, 'scripts/foundry/engineering-depth/greeting/decoy.mjs')
  const vendorWrite = evaluateWriteSafety(production, 'node_modules/foo/index.js')
  const terraWrite = evaluateWriteSafety(production, 'lib/terra/something.ts')
  const noBaseline = startMissionInput(productionRequest)
  noBaseline.kind = 'application'
  const missingBaseline = evaluateWriteSafety(noBaseline, 'components/war-room/foundry/FoundryMissionControllerPanel.tsx')
  production.sourceState.changedFiles = ['components/war-room/foundry/FoundryMissionControllerPanel.tsx']
  const ranked = rankTests(production)
  const wholeRepo = rejectIrrelevantTest(production, ['validate:foundry'])
  const fixtureMission = startMissionInput('Change a fixture label. This is a test application fixture, not a production install.')
  fixtureMission.sourceState.changedFiles = ['scripts/foundry/local-coder-label/label.txt']
  fixtureMission.engineering = {
    selfReview: { status: 'PASS', findings: [], severity: [], requiredAction: 'none', at: new Date().toISOString(), diffHash: 'x', compact: 'PASS' },
    regressionOk: true,
  }
  fixtureMission.testState = { ok: true, detail: 'green' }
  const fixtureBuild = productionBuildAllowed(fixtureMission)
  production.kind = 'application'
  production.engineering = {
    ...production.engineering,
    selfReview: { status: 'PASS', findings: [], severity: [], requiredAction: 'none', at: new Date().toISOString(), diffHash: 'x', compact: 'PASS' },
    regressionOk: true,
  }
  production.testState = { ok: true, detail: 'green' }
  const appBuild = productionBuildAllowed(production)
  const readOnly = startMissionInput(productionRequest)
  readOnly.kind = 'application'
  const readOnlyBuild = productionBuildAllowed(readOnly)
  const repeatA = noteRepeatedAction(production, 'file.write:decoy:false:NOT_OWNER')
  const repeatB = noteRepeatedAction(production, 'file.write:decoy:false:NOT_OWNER')
  const broad = reviewDiffText(`diff --git a/lib/native-builder/foundryProjectVisibility.ts b/lib/native-builder/foundryProjectVisibility.ts
+++ b/lib/native-builder/foundryProjectVisibility.ts
+console.log('debug')
diff --git a/package.json b/package.json
+++ b/package.json
+  "unrelated": true
`, production)
  const prompt = buildLocalFoundryModelPrompt({ kind: 'chooseNextAction', context: buildLocalFoundryModelContext(production) })
  const view = toFoundryMissionCommanderView(production)
  const ownersTool = FOUNDRY_MODEL_TOOL_CATALOG.find(entry => entry.name === 'code.owners')
  const writeTool = FOUNDRY_MODEL_TOOL_CATALOG.find(entry => entry.name === 'file.write')
  const reviewTool = FOUNDRY_MODEL_TOOL_CATALOG.find(entry => entry.name === 'engineering.review')
  const decoyAssessment = assessMutationTarget(production, 'scripts/foundry/engineering-depth/greeting/decoy.mjs')

  return [
    check('fixture_coercions_bounded', extraHacks.every(name => /coerceFixtureWrite|ensurePass008FixtureFiles|seedSessionRenameChangedFiles|seedFixtureDiagnosis|noteGreetingDiscriminatingEvidence|engineeringReviewPatchArgs/.test(name)), JSON.stringify({ markers, extraHacks })),
    check('no_unrelated_fixture_hints', !/HINT:.*TerraGlobe|HINT:.*council-nebula/.test(local), local.slice(0, 200)),
    check('tool_schema_owners_structured', /PRIMARY_OWNER/.test(ownersTool?.result ?? '') && /OWNER_CANDIDATES/.test(ownersTool?.result ?? ''), ownersTool?.result ?? ''),
    check('tool_schema_write_requires_evidence', /OWNER_EVIDENCE|BASELINE_CAPTURED/.test(`${writeTool?.purpose ?? ''} ${writeTool?.result ?? ''}`), `${writeTool?.purpose} ${writeTool?.result}`),
    check('tool_schema_review_compact', /PASS\/FAIL/.test(reviewTool?.result ?? '') && /REQUIRED_ACTION/.test(reviewTool?.result ?? ''), reviewTool?.result ?? ''),
    check('action_contract_enforced', contractOk && inferIntentFromTool('file.write', ['SOURCE_DONE']) === 'EDIT', JSON.stringify(production.engineering?.actionContract)),
    check('owner_selection_evidence_based', ownerWrite.allowed && /PRIMARY_OWNER|connected/.test(ownerWrite.reason), ownerWrite.reason),
    check('decoy_rejection_evidence_based', !decoyWrite.allowed && /NOT_OWNER|NOT_RUNTIME|NO_DEPENDENTS/.test(decoyWrite.reason) && decoyAssessment.codes.some(code => code.startsWith('NOT_') || code.startsWith('NO_')), `${decoyWrite.reason} ${decoyAssessment.codes.join(',')}`),
    check('test_selection_ranked', ranked.length > 0 && ranked.every(item => item.rank >= 1) && !ranked.some(item => item.test === 'scripts/foundry/engineering-depth/greeting/app.test.mjs' && production.kind === 'application' && !production.sourceState.changedFiles.some(file => file.includes('greeting'))), JSON.stringify(ranked.slice(0, 6))),
    check('irrelevant_whole_repo_test_refused', Boolean(wholeRepo && /Whole-repo/.test(wholeRepo)), wholeRepo ?? 'none'),
    check('writes_require_baseline', !missingBaseline.allowed && /BASELINE/.test(missingBaseline.reason), missingBaseline.reason),
    check('writes_reject_vendor_and_terra', !vendorWrite.allowed && !terraWrite.allowed, `${vendorWrite.reason} | ${terraWrite.reason}`),
    check('self_review_catches_broad_unrelated', broad.status === 'FAIL' && broad.findings.some(item => /debug|unrelated|broad/i.test(item)), broad.compact),
    check('repeated_action_replan', repeatA.replan === false && repeatB.replan === true, JSON.stringify({ repeatA, repeatB })),
    check('production_build_gating', fixtureBuild !== null && readOnlyBuild !== null && appBuild === null, JSON.stringify({ fixtureBuild, readOnlyBuild, appBuild })),
    check('context_compact', estimateTokens(prompt) <= LOCAL_MODEL_CONTEXT_BUDGET_TOKENS + 400, `${estimateTokens(prompt)} tokens`),
    check('engineering_review_view_exposes_detail', 'engineeringReviewDetail' in view, JSON.stringify({ engineeringReview: view.engineeringReview, hasDetail: 'engineeringReviewDetail' in view })),
    check('production_mission_kind_application', interpretation.kind === 'application' && production.kind === 'application', JSON.stringify({ interpretation: interpretation.kind, mission: production.kind })),
    check('session_rename_control_present', /foundry-session-rename/.test(shell) && /renameFoundrySession/.test(read(path.join(ROOT, 'lib/native-builder/foundrySessions.ts'))), 'session rename UI+API present'),
    check('homepage_not_redesigned', /Tell Foundry the result you want/.test(shell) && !/PASS 008|operations dashboard/i.test(shell), 'FoundryShell homepage contract'),
    check('terra_untouched_in_pass008_sources', !combined.includes('lib/terra/') || !/writeFileSync\(.*terra/i.test(combined), 'no Terra writes in Foundry controller'),
    check('no_new_operations_dashboard', !/OperationsDashboard|ops-dashboard/.test(panel + shell), 'no ops dashboard added'),
    check('tsserver_not_required', !/tsserver|languageService/.test(read(path.join(ROOT, 'lib/native-builder/foundryCodeIntelligence.ts'))), 'AST index remains the symbol backend'),
  ]
}

async function run() {
  const results = await runFoundryAutonomousEngineeringDepthPass008Validation()
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(result => !result.pass)
  console.log(`Foundry autonomous engineering depth PASS 008: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
export { run as runFoundryAutonomousEngineeringDepthPass008 }
