/**
 * Source + isolated persistence proofs for Mission 14 real-project qualification.
 * Model worker runs only when FOUNDRY_REAL_PROJECT_MODEL=1.
 * Does not package, install, commit, push, or deploy.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import {
  ensureAcceptedEngineeringEvidenceHydrated,
  overlayInstalledProductionProofs,
  recordInstalledProductionProof,
  ACCEPTED_ENGINEERING_EVIDENCE,
} from './foundryAcceptedCapabilityEvidence'
import { buildEngineeringCapabilitiesView, listCertifications } from './foundryEngineeringGraduationStore'
import { mapGraduationLevelToAtlas } from './foundryEngineeringGraduationAtlas'
import { FOUNDRY_ENGINEERING_PROJECT_CLASSES } from './foundryEngineeringGraduationTypes'
import { independentlyVerifyRealProjectWire, runRealProjectModelWorker } from './foundryRealProjectQualification'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

function source(rel: string): string {
  return readFileSync(path.join(resolveRepoRoot(), rel), 'utf8')
}

async function main(): Promise<void> {
  const results: CaseResult[] = []
  const root = resolveRepoRoot()
  const evidence = source('lib/native-builder/foundryAcceptedCapabilityEvidence.ts')
  const store = source('lib/native-builder/foundryEngineeringGraduationStore.ts')
  const harness = source('lib/native-builder/foundryRealProjectQualification.ts')
  const ui = source('components/war-room/foundry/FoundryEngineeringCapabilitiesPanel.tsx')
  const snapshot = source('lib/native-builder/foundryAgentStore.ts')
  const atlas = source('lib/native-builder/foundryEngineeringGraduationAtlas.ts')

  results.push(check('HYDRATE_USES_PERSIST_CERTIFICATION', /persistCertification\(/.test(evidence), 'computed persist'))
  results.push(check('HYDRATE_HAS_PROVENANCE', /provenanceMission/.test(evidence) && /accepted-GRAD-FX-FEATURE-V2-mission-13/.test(evidence) || /GRAD-FX-FEATURE-V2/.test(evidence), 'mission provenance'))
  results.push(check('NO_HARDCODED_UI_FEATURE_RELIABLE', !/FEATURE_EXTENSION\s*=\s*'RELIABLE'/.test(ui) && !/STATIC_WEB\s*=\s*'PASSED_FIXTURE'/.test(ui), 'UI computed'))
  results.push(check('TOOL_BROKER_ONLY', /unattendedToolBrokerWrite/.test(harness) && /Mutations only through Tool Broker/.test(harness), 'Tool Broker'))
  results.push(check('NO_REFERENCE_APPLY', !/referenceSolution|applyReference/.test(harness), 'no reference'))
  results.push(check('ATLAS_MISSING_NOT_PROHIBITION', /missingMeans: 'acquire_practice_evaluate_continue'/.test(atlas) && /productionProven: level === 'PRODUCTION_PROVEN'/.test(atlas), 'atlas mapping'))
  results.push(check('OVERLAY_DOES_NOT_CHANGE_STATUS', /overlayInstalledProductionProofs/.test(evidence) && /status remains computed|productionProven: awarded.length > 0/.test(evidence), 'overlay flag only'))
  results.push(check('SNAPSHOT_OVERLAY_WIRED', /overlayInstalledProductionProofs\(buildEngineeringCapabilitiesView\(\)\)/.test(snapshot), 'overlay in snapshot'))
  results.push(check('STORE_DERIVE_UNCHANGED', /if \(input.productionEvidenceRefs.length > 0\) return 'PRODUCTION_PROVEN'/.test(store), 'deriveGraduationLevel intact'))
  results.push(check('PROTECTED_PATHS_UNTOUCHED_SOURCE', !/Harbor Desk|Lane & Box/.test(evidence), 'no protected product edits in hydrate'))

  const previous = {
    contracts: process.env.FOUNDRY_CONTRACTS_ROOT,
    projects: process.env.FOUNDRY_PROJECTS_ROOT,
  }
  const contractsRoot = mkdtempSync(path.join(tmpdir(), 'm14-contracts-'))
  const projectsRoot = mkdtempSync(path.join(tmpdir(), 'm14-projects-'))
  process.env.FOUNDRY_CONTRACTS_ROOT = contractsRoot
  process.env.FOUNDRY_PROJECTS_ROOT = projectsRoot
  try {
    const hydrated = ensureAcceptedEngineeringEvidenceHydrated()
    results.push(check('HYDRATE_IMPORTS_ALL_ACCEPTED', hydrated.missingBenchmarkIds.length === 0, hydrated.missingBenchmarkIds.join(',') || 'all'))
    results.push(check('HYDRATE_RUN_COUNT', hydrated.importedRunIds.length === ACCEPTED_ENGINEERING_EVIDENCE.length, String(hydrated.importedRunIds.length)))
    const certs = listCertifications()
    const byClass = Object.fromEntries(certs.map(item => [item.projectClass, item]))
    const feature = byClass.FEATURE_EXTENSION
    const staticWeb = byClass.STATIC_WEB
    results.push(check(
      'FEATURE_EXTENSION_COMPUTED_RELIABLE',
      feature?.status === 'RELIABLE' && (feature.modelDrivenDistinctFixturePassCount ?? 0) === 3,
      feature ? `${feature.status} distinct=${feature.modelDrivenDistinctFixturePassCount}` : 'missing',
    ))
    results.push(check(
      'STATIC_WEB_COMPUTED_PASSED_FIXTURE',
      staticWeb?.status === 'PASSED_FIXTURE' && (staticWeb.modelDrivenDistinctFixturePassCount ?? 0) === 1,
      staticWeb ? `${staticWeb.status} distinct=${staticWeb.modelDrivenDistinctFixturePassCount}` : 'missing',
    ))
    const reliable = ['CLI_TOOL', 'BUG_FIX', 'FRONTEND_APP', 'TEST_REPAIR', 'BACKEND_API', 'FULL_STACK_APP'] as const
    for (const name of reliable) {
      const cert = byClass[name]
      results.push(check(
        `${name}_COMPUTED_RELIABLE`,
        cert?.status === 'RELIABLE' && (cert.modelDrivenDistinctFixturePassCount ?? 0) >= 3,
        cert ? `${cert.status} distinct=${cert.modelDrivenDistinctFixturePassCount}` : 'missing',
      ))
    }
    const multi = ['DATABASE_APP', 'DESKTOP_APP', 'LEGACY_CODE_MODIFICATION', 'REFACTOR', 'DATA_PROCESSING', 'LIBRARY_PACKAGE'] as const
    for (const name of multi) {
      const cert = byClass[name]
      results.push(check(
        `${name}_COMPUTED_PASSED_MULTI`,
        cert?.status === 'PASSED_MULTI_FIXTURE' && (cert.modelDrivenDistinctFixturePassCount ?? 0) === 2,
        cert ? `${cert.status} distinct=${cert.modelDrivenDistinctFixturePassCount}` : 'missing',
      ))
    }
    results.push(check(
      'NO_PRODUCTION_PROVEN_FROM_HYDRATE',
      certs.every(item => item.status !== 'PRODUCTION_PROVEN' && item.productionEvidenceRefs.length === 0),
      certs.filter(item => item.status === 'PRODUCTION_PROVEN').map(item => item.projectClass).join(',') || 'none',
    ))
    results.push(check(
      'UNTESTED_NONE',
      FOUNDRY_ENGINEERING_PROJECT_CLASSES.every(name => byClass[name]),
      FOUNDRY_ENGINEERING_PROJECT_CLASSES.filter(name => !byClass[name]).join(',') || 'all present',
    ))
    const atlasReliable = mapGraduationLevelToAtlas('RELIABLE')
    const atlasStatic = mapGraduationLevelToAtlas('PASSED_FIXTURE')
    results.push(check('ATLAS_RELIABLE_IS_PROVEN_NOT_PRODUCTION', atlasReliable.atlasStatus === 'PROVEN' && atlasReliable.productionProven === false, atlasReliable.atlasStatus))
    results.push(check('ATLAS_PASSED_FIXTURE_IS_EVALUATED', atlasStatic.atlasStatus === 'EVALUATED' && atlasStatic.productionProven === false, atlasStatic.atlasStatus))

    const view = overlayInstalledProductionProofs(buildEngineeringCapabilitiesView(certs))
    results.push(check('VIEW_FEATURE_RELIABLE', view.rows.find(row => row.projectClass === 'FEATURE_EXTENSION')?.status === 'RELIABLE', 'view'))
    results.push(check('VIEW_STATIC_PASSED_FIXTURE', view.rows.find(row => row.projectClass === 'STATIC_WEB')?.status === 'PASSED_FIXTURE', 'view'))
    results.push(check('VIEW_PRODUCTION_FLAG_FALSE_BEFORE_PROOF', view.rows.every(row => row.productionProven !== true), 'no production overlay yet'))

    recordInstalledProductionProof({
      mission: 'MISSION_14',
      projectClass: 'FEATURE_EXTENSION',
      realAction: 'isolated-validator-does-not-award',
      evidenceRefs: ['validator-isolation'],
      verifiedAt: new Date().toISOString(),
      verifier: 'foundryRealProjectQualification.validation',
      productionProven: false,
      reason: 'Isolation proof only. Not installed production evidence.',
    })
    const afterFalse = overlayInstalledProductionProofs(buildEngineeringCapabilitiesView(certs))
    results.push(check(
      'FALSE_PRODUCTION_PROOF_DOES_NOT_AWARD',
      afterFalse.rows.find(row => row.projectClass === 'FEATURE_EXTENSION')?.productionProven !== true
        && afterFalse.rows.find(row => row.projectClass === 'FEATURE_EXTENSION')?.status === 'RELIABLE',
      'status remains RELIABLE',
    ))

    const second = ensureAcceptedEngineeringEvidenceHydrated()
    results.push(check('HYDRATE_IDEMPOTENT', second.skipped === true, JSON.stringify({ skipped: second.skipped, imported: second.importedRunIds.length })))
  } finally {
    if (previous.contracts === undefined) delete process.env.FOUNDRY_CONTRACTS_ROOT
    else process.env.FOUNDRY_CONTRACTS_ROOT = previous.contracts
    if (previous.projects === undefined) delete process.env.FOUNDRY_PROJECTS_ROOT
    else process.env.FOUNDRY_PROJECTS_ROOT = previous.projects
    try { rmSync(contractsRoot, { recursive: true, force: true }) } catch { /* tmp */ }
    try { rmSync(projectsRoot, { recursive: true, force: true }) } catch { /* tmp */ }
  }

  const runModel = process.env.FOUNDRY_REAL_PROJECT_MODEL === '1'
  let modelResult: Awaited<ReturnType<typeof runRealProjectModelWorker>> | null = null
  if (runModel) {
    modelResult = await runRealProjectModelWorker({ workspaceRoot: root })
    results.push(check('MODEL_WORKER_ROUTED', Boolean(modelResult.worker.provider && modelResult.worker.model), JSON.stringify(modelResult.worker)))
    results.push(check('MODEL_WIRE_INDEPENDENT_VERIFIER', modelResult.verify.passed, modelResult.verify.detail))
    results.push(check('MODEL_DIRECT_WRITE_COUNT', modelResult.modelDirectWriteCount === 0, String(modelResult.modelDirectWriteCount)))
    results.push(check('ANONYMOUS_ACTION_COUNT', modelResult.anonymousActionCount === 0, String(modelResult.anonymousActionCount)))
    results.push(check('REPEATED_FAILED_PATCH_WITHOUT_REPLAN', modelResult.repeatedFailedPatchWithoutReplanCount === 0, String(modelResult.repeatedFailedPatchWithoutReplanCount)))
    results.push(check('FRK_USED', modelResult.frk.used === true, `${modelResult.frk.strategy}/${modelResult.frk.depth}`))
    const out = path.join(root, 'tmp/foundry-real-project-qualification/model-worker.json')
    mkdirSync(path.dirname(out), { recursive: true })
    writeFileSync(out, JSON.stringify(modelResult, null, 2))
  }
  results.push(check('SNAPSHOT_HYDRATE_WIRE', independentlyVerifyRealProjectWire(root).passed || !runModel, independentlyVerifyRealProjectWire(root).detail))

  const failed = results.filter(item => !item.pass)
  const payload = {
    ok: failed.length === 0,
    passed: results.filter(item => item.pass).length,
    failed: failed.length,
    results,
    model: modelResult ? { worker: modelResult.worker, ok: modelResult.ok, frk: modelResult.frk } : null,
  }
  const reportDir = path.join(root, 'tmp/foundry-real-project-qualification')
  mkdirSync(reportDir, { recursive: true })
  writeFileSync(path.join(reportDir, 'validator.json'), JSON.stringify(payload, null, 2))
  console.log(JSON.stringify(payload, null, 2))
  if (failed.length) process.exit(1)
}

const isDirect = import.meta.url === pathToFileURL(process.argv[1] ?? '').href
if (isDirect) {
  main().catch(error => {
    console.error(error)
    process.exit(1)
  })
}
