import { pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'
import { buildCodeIndex, compactOwnership, lookupDependents, lookupSymbol, mapOwnership } from './foundryCodeIntelligence'
import {
  classifyFailure,
  compactImpact,
  noteRepeatedAction,
  reviewDiffText,
  selectRegressionSet,
  selectRelevantTests,
  isTestFile,
} from './foundryEngineeringDepth'
import {
  evaluateWriteSafety,
  productionBuildAllowed,
  rankTests,
} from './foundryEngineeringContract'
import {
  compactMemoryHits,
  ensureEngineeringMemoryBootstrap,
  engineeringMemoryLayout,
  recallFeatureOwnership,
} from './foundryEngineeringMemory'
import { startMissionInput } from './foundryMissionController'
import { buildLocalFoundryModelContext, estimateTokens, LOCAL_MODEL_CONTEXT_BUDGET_TOKENS } from './foundryLocalModelRuntime'
import { FOUNDRY_MODEL_TOOL_CATALOG } from './foundryToolCatalog'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

async function run() {
  const index = await buildCodeIndex(true)
  const ownership = await mapOwnership('Foundry project list visibility registry', index)
  const symbol = lookupSymbol(index, 'classifyFoundryProject')
  const visibilityDependents = lookupDependents(index, 'lib/native-builder/foundryProjectVisibility.ts')
  const mission = startMissionInput('Change Foundry project list behavior without touching Terra.')
  mission.candidateFiles = ownership.owners.slice(0, 6)
  mission.importantPaths = ownership.owners.slice(0, 6)
  const { buildImpactMap } = await import('./foundryEngineeringDepth')
  const impact = await buildImpactMap(mission, ownership.owners.slice(0, 6))
  const selected = await selectRelevantTests(mission)
  const impl = startMissionInput('Fix the engineering-depth impl-bug fixture. Expected SYSTEM READY. Implementation currently outputs SYSTEM RDY. The TEST is correct. This is a test application fixture, not a production install.')
  const stale = startMissionInput('The engineering-depth stale-expect fixture implementation is correct. The test still expects SYSTEM RDY. Classify TEST_EXPECTATION_OUTDATED and update only the test. This is a test application fixture, not a production install.')
  const implDiag = classifyFailure(impl, "AssertionError: expected 'SYSTEM RDY' to equal 'SYSTEM READY'")
  const staleDiag = classifyFailure(stale, "AssertionError [ERR_ASSERTION]: Expected: 'SYSTEM RDY'\nActual: 'SYSTEM READY'")
  const authDiag = classifyFailure(startMissionInput('Inspect trusted desktop login wall.'), 'Unauthorized wr_local_session desktop trust /login')
  const repeatA = noteRepeatedAction(mission, 'workspace.search:{"query":"x"}:true:')
  const repeatB = noteRepeatedAction(mission, 'workspace.search:{"query":"x"}:true:')
  const review = reviewDiffText(`diff --git a/lib/native-builder/foundryProjectVisibility.ts b/lib/native-builder/foundryProjectVisibility.ts
+++ b/lib/native-builder/foundryProjectVisibility.ts
+console.log('debug')
+debugger
`, mission)
  const authReview = reviewDiffText(`diff --git a/desktop/src/main.cjs b/desktop/src/main.cjs
+++ b/desktop/src/main.cjs
-ensureTrustedDesktopCommander()
-verifyDesktopTrustProof(header)
`, { ...mission, sourceState: { ...mission.sourceState, changedFiles: ['desktop/src/main.cjs'] } })
  const authMission = startMissionInput('Harden trusted desktop auto-entry without weakening remote /login.')
  authMission.kind = 'application'
  authMission.candidateFiles = ['desktop/src/main.cjs', 'middleware.ts']
  authMission.sourceState.changedFiles = ['desktop/src/main.cjs']
  const { buildImpactMap: buildImpact } = await import('./foundryEngineeringDepth')
  await buildImpact(authMission, ['desktop/src/main.cjs', 'middleware.ts'])
  const authRegression = await selectRegressionSet(authMission)
  const store = await ensureEngineeringMemoryBootstrap()
  const feature = recallFeatureOwnership(store, 'Foundry project list')
  const layout = engineeringMemoryLayout()
  const trusted = store.facts.find(fact => fact.topic === 'trusted-desktop-auto-entry')
  const compactPrompt = JSON.stringify(buildLocalFoundryModelContext(mission))
  const catalogHasOwners = FOUNDRY_MODEL_TOOL_CATALOG.some(entry => entry.name === 'code.owners')
  const catalogHasReview = FOUNDRY_MODEL_TOOL_CATALOG.some(entry => entry.name === 'engineering.review')
  const compact = compactImpact(impact)
  const results = [
    check('code_intelligence_index', index.fileCount > 50 && Boolean(index.files['lib/native-builder/foundryProjectVisibility.ts']), String(index.fileCount)),
    check('ownership_map_project_list', ownership.owners.some(file => /foundryProjectVisibility|FoundryShell|workspaceRegistry/.test(file)), compactOwnership(ownership)),
    check('symbol_lookup', symbol.definitions.some(item => item.path.includes('foundryProjectVisibility.ts')), JSON.stringify(symbol.definitions.slice(0, 4))),
    check('reference_lookup', symbol.references.length + visibilityDependents.length > 0, JSON.stringify({ refs: symbol.references.slice(0, 6), dependents: visibilityDependents.slice(0, 6) })),
    check('dependency_mapping', (index.files['lib/native-builder/foundryProjectVisibility.ts']?.imports.length ?? 0) >= 1, JSON.stringify(index.files['lib/native-builder/foundryProjectVisibility.ts']?.imports.slice(0, 6))),
    check('impact_analysis', impact.owners.length > 0 && compact.includes('TARGET_FILES:') && compact.includes('SECURITY_SURFACES:'), compact),
    check('baseline_capture_shape', Array.isArray(mission.candidateFiles) && mission.candidateFiles.length > 0, mission.candidateFiles.join(',')),
    check('implementation_plan_intents', mission.plan.some(step => step.intent === 'SELF_REVIEW') && mission.plan.some(step => step.intent === 'BASELINE') && mission.plan.some(step => step.intent === 'DIAGNOSE'), mission.plan.map(step => step.intent).join(',')),
    check('self_diff_review', review.findings.some(item => /debug/i.test(item)), review.compact),
    check('self_diff_review_auth', authReview.findings.some(item => /auth weakening/i.test(item)), authReview.compact),
    check('test_selection', selected.length >= 0 && selected.every(item => item.startsWith('validate:') || isTestFile(item) || item.includes('foundry')), selected.join(',')),
    check('auth_regression_selection', authRegression.includes('validate:trusted-desktop-auth'), authRegression.join(',')),
    check('impl_vs_test_bug', implDiag.classification === 'IMPLEMENTATION_BUG', JSON.stringify(implDiag)),
    check('impl_vs_test_stale', staleDiag.classification === 'TEST_EXPECTATION_OUTDATED', JSON.stringify(staleDiag)),
    check('auth_failure_classification', authDiag.classification === 'AUTH_FAILURE', JSON.stringify(authDiag)),
    check('repeated_action_detection', repeatA.replan === false && repeatB.replan === true && repeatB.count >= 2, JSON.stringify({ repeatA, repeatB })),
    check('engineering_memory_feature', Boolean(feature && feature.owners.some(file => file.includes('foundryProjectVisibility'))), JSON.stringify(feature)),
    check('memory_provenance', Boolean((feature?.sourceMissionId ?? feature?.sourceMission) && feature?.lastVerified), JSON.stringify({ sourceMissionId: feature?.sourceMissionId ?? feature?.sourceMission, lastVerified: feature?.lastVerified, confidence: feature?.confidence })),
    check('memory_layout', ['features', 'files', 'tests', 'relationships'].every(kind => existsSync(layout[kind as keyof typeof layout])), JSON.stringify(layout)),
    check('memory_trusted_desktop', Boolean(trusted && !trusted.stale && (trusted.sourceMissionId ?? trusted.sourceMission)), JSON.stringify({ topic: trusted?.topic, stale: trusted?.stale, sourceMissionId: trusted?.sourceMissionId })),
    check('memory_repo_wins_note', compactMemoryHits(store.facts.slice(0, 1)).includes('conf=') || compactMemoryHits([]).includes('Current repo wins'), compactMemoryHits(store.facts.slice(0, 2))),
    check('local_model_compact_context', estimateTokens(compactPrompt) <= LOCAL_MODEL_CONTEXT_BUDGET_TOKENS * 3 && !/giant diff|full journal/.test(compactPrompt), String(estimateTokens(compactPrompt))),
    check('catalog_engineering_tools', catalogHasOwners && catalogHasReview, FOUNDRY_MODEL_TOOL_CATALOG.filter(entry => entry.name.startsWith('code.') || entry.name.startsWith('engineering.')).map(entry => entry.name).join(',')),
    check('write_safety_rejects_unmapped_decoy', (() => {
      const decoyMission = startMissionInput('Fix unused decoy trap. This is a test application fixture, not a production install.')
      decoyMission.engineering = { ownership: { query: 'greeting', owners: ['scripts/foundry/engineering-depth/greeting/app.mjs'], dependents: [], tests: ['scripts/foundry/engineering-depth/greeting/app.test.mjs'], routes: [], apis: [], packageBoundaries: [] } }
      decoyMission.baseline = { recordedAt: new Date().toISOString(), fileHashes: {}, branch: 'local', head: 'x', dirtyFiles: [], activeInstallId: null, runningInstallId: null }
      const safety = evaluateWriteSafety(decoyMission, 'scripts/foundry/engineering-depth/greeting/decoy.mjs')
      return safety.allowed === false && /NOT_OWNER|NOT_RUNTIME|NO_DEPENDENTS/.test(safety.reason)
    })(), 'decoy writes must be refused with evidence'),
    check('ranked_tests_prefer_associated', (() => {
      const testMission = startMissionInput('Fix unused decoy trap. This is a test application fixture, not a production install.')
      testMission.sourceState.changedFiles = ['scripts/foundry/engineering-depth/greeting/greeting.txt']
      const ranked = rankTests(testMission)
      return ranked.some(item => item.test.includes('engineering-depth/greeting') && item.rank <= 2)
    })(), 'ranked tests must prefer associated files'),
    check('production_build_refuses_fixture', productionBuildAllowed(startMissionInput('Change a fixture label. This is a test application fixture, not a production install.')) !== null, 'fixture missions cannot package'),
  ]
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(result => !result.pass)
  console.log(`Foundry engineering depth: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
export { run as runFoundryEngineeringDepthValidation }
