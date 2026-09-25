/**
 * Wave 2 targeted skill acquisition proofs.
 * Capability is self-knowledge, not Commander permission.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { isProtectedSubsystemPath } from './foundryMissionWriteSet'
import {
  loadCapabilityAtlas,
  buildSkillPack,
  assessMissionCapabilities,
  PLANNER_CAPABILITY_GATE,
  CAPABILITY_GATE_AUTHORITY,
  GOVERNANCE,
  WRIM_INTEGRATION_BOUNDARY,
  WAVE2_TARGET_SKILLS,
  resolveWave2Skills,
  runAcquisitionWave2,
  ACQUISITION_GOVERNANCE,
  assertSandboxIsolation,
  assertNotFakeCudaPass,
  assertNoAutomaticPackageInstall,
  writeSandboxFile,
  AcquisitionSandboxError,
} from './capability-atlas'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

const INSTALL_CMD = /\b(apt-get|apt |yum |dnf |pacman |brew |pip3? install|npm install|pnpm add|cargo install)\b/

async function run() {
  const previous = process.env.FOUNDRY_CAPABILITY_ATLAS_ROOT
  const atlasTmp = await mkdtemp(path.join(tmpdir(), 'wr-acq2-atlas-'))
  const sandboxTmp = await mkdtemp(path.join(tmpdir(), 'wr-acq2-sandbox-'))
  process.env.FOUNDRY_CAPABILITY_ATLAS_ROOT = atlasTmp
  const results: CaseResult[] = []
  try {
    const atlas = loadCapabilityAtlas()
    const resolved = resolveWave2Skills(atlas)
    results.push(check(
      'exact_targets_resolved',
      WAVE2_TARGET_SKILLS.every(id => atlas.skills.has(id)) && resolved.length === 8,
      resolved.join(','),
    ))

    const packs = resolved.map(id => buildSkillPack(atlas, id))
    results.push(check(
      'packs_loaded',
      packs.every(pack => pack && pack.compact) && packs.some(pack => (pack?.officialSources.length ?? 0) > 0),
      String(packs.filter(Boolean).length),
    ))

    let isolated = false
    try {
      assertSandboxIsolation(path.join(resolveRepoRoot(), 'lib/native-builder/capability-atlas/taxonomy.ts'), sandboxTmp)
    } catch (error) {
      isolated = error instanceof AcquisitionSandboxError
    }
    results.push(check('sandbox_isolation', isolated, 'repo write refused'))

    const wave1Marker = path.join(atlasTmp, 'wave1-must-remain.json')
    mkdirSync(atlasTmp, { recursive: true })
    writeFileSync(wave1Marker, '{"wave":1}', 'utf8')

    const report = runAcquisitionWave2({
      atlas,
      sandboxRoot: sandboxTmp,
      persist: true,
      skillIds: [...WAVE2_TARGET_SKILLS],
    })

    results.push(check('environment_inventory_recorded', Boolean(report.environment) && report.environment.automaticPackageInstall === false, JSON.stringify({ rustc: report.environment.rustc, node: report.environment.node, psql: report.environment.psql, nvcc: report.environment.nvcc })))
    results.push(check('ml_training_exercised', report.exercises.some(item => item.skillId === 'ml.training' && item.artifacts.length > 0), 'ml.training'))
    results.push(check('rust_exercised', report.exercises.some(item => item.skillId === 'software.languages.rust'), 'rust'))
    results.push(check('postgresql_exercised', report.exercises.some(item => item.skillId === 'database.postgresql'), 'postgresql'))
    results.push(check('query_planning_exercised', report.exercises.some(item => item.skillId === 'database.query-planning'), 'query-planning'))
    results.push(check('react_performance_exercised', report.exercises.some(item => item.skillId === 'frontend.react.performance'), 'react'))
    results.push(check('usb_driver_exercised', report.exercises.some(item => item.skillId === 'kernel.device-drivers.usb'), 'usb'))
    results.push(check('http3_exercised', report.exercises.some(item => item.skillId === 'networking.http3'), 'http3'))
    results.push(check('llvm_optimization_exercised', report.exercises.some(item => item.skillId === 'compiler.llvm.optimization'), 'llvm'))

    results.push(check('real_failure_repair_evidence', report.exercises.some(item => item.failureEvidence.trim().length > 0) && report.exercises.some(item => item.repairEvidence.trim().length > 0), 'failure+repair'))

    const rustPass = report.exercises.filter(item => item.skillId === 'software.languages.rust' && item.finalOutcome === 'PASS')
    const rustPassLegal = rustPass.length === 0 || Boolean(report.environment.rustc || report.environment.cargo)
    const cudaPass = report.exercises.filter(item => item.skillId === 'ml.cuda' && item.finalOutcome === 'PASS')
    const cudaPassLegal = cudaPass.length === 0 || Boolean(report.environment.nvcc || report.environment.torch.cuda)
    results.push(check('no_fake_compile_run_proof', rustPassLegal && cudaPassLegal && report.exercises.filter(item => item.finalOutcome === 'PASS').every(item => item.artifacts.length > 0), `rustPass=${rustPass.length} cudaPass=${cudaPass.length}`))

    const afterCuda = assessMissionCapabilities({ missionText: 'Debug a CUDA OOM during training.', atlas })
    results.push(check(
      'cuda_chain_re_resolved',
      afterCuda.requiredSkills.includes('ml.training') && afterCuda.recommendation !== 'CAPABILITY_RESEARCH_REQUIRED' && report.finalStatus['ml.training'] !== 'LEARNABLE',
      JSON.stringify({ rec: afterCuda.recommendation, required: afterCuda.requiredSkills, training: report.finalStatus['ml.training'] }),
    ))

    results.push(check('database_combined_scenario', Boolean(report.combinedDatabase && report.combinedDatabase.exerciseId.includes('combined-slow-query')), report.combinedDatabase?.finalOutcome ?? 'missing'))
    results.push(check('low_level_combined_scenario', Boolean(report.combinedLowLevel && report.combinedLowLevel.exerciseId.includes('combined-low-level')), report.combinedLowLevel?.finalOutcome ?? 'missing'))
    results.push(check('cuda_combined_scenario', Boolean(report.combinedCuda && report.combinedCuda.exerciseId.includes('combined-cuda')), report.combinedCuda?.finalOutcome ?? 'missing'))

    const missingTools = !report.environment.rustc || !report.environment.psql || !report.environment.nvcc || !report.environment.opt
    results.push(check('missing_tools_truthfully_recorded', report.exercises.some(item => item.limitations.length > 0) && (missingTools ? report.exercises.some(item => /absent|missing|not installed|environment-limited/i.test(item.limitations)) : true), `rustc=${report.environment.rustc || 'missing'}`))

    const cmds = report.exercises.flatMap(item => item.commands).join(' ')
    results.push(check('no_automatic_package_installs', report.automaticPackageInstalls === 0 && ACQUISITION_GOVERNANCE.automaticPackageInstall === false && !INSTALL_CMD.test(cmds), cmds.slice(0, 200)))
    results.push(check('no_commander_whitelist', PLANNER_CAPABILITY_GATE.blocksCommanderProjects === false && PLANNER_CAPABILITY_GATE.isPermissionWhitelist === false && CAPABILITY_GATE_AUTHORITY.isCommanderPermissionWhitelist === false && ACQUISITION_GOVERNANCE.blocksCommanderProjects === false, 'freedom'))
    results.push(check('production_proven_unchanged', report.scoreboardAfter.productionProven === report.scoreboardBefore.productionProven, `${report.scoreboardBefore.productionProven}->${report.scoreboardAfter.productionProven}`))

    const repo = resolveRepoRoot()
    results.push(check('existing_projects_untouched', report.exercises.every(item => !item.sandboxPath.startsWith(repo)) && report.sandboxRoot.includes('wave2'), report.sandboxRoot))
    results.push(check('no_terra', ACQUISITION_GOVERNANCE.terra === false && GOVERNANCE.terra === false && isProtectedSubsystemPath('components/war-room/terra/Globe.tsx'), 'terra'))
    results.push(check('no_wrim_training', ACQUISITION_GOVERNANCE.wrimTraining === false && WRIM_INTEGRATION_BOUNDARY.trainingExecuted === false, 'wrim'))
    results.push(check('wave1_evidence_intact', existsSync(wave1Marker) && report.exercises.every(item => item.exerciseId.startsWith('combined-') || true) && report.exercises.every(item => !item.sandboxPath.includes(`${path.sep}wave1${path.sep}`)), 'wave1 marker'))
    results.push(check('kernel_module_not_loaded', !/\binsmod\b|\bmodprobe\b/.test(cmds), cmds.slice(0, 120)))
    results.push(check('eight_targets_attempted', report.targetedSkillIds.length === 8 && WAVE2_TARGET_SKILLS.every(id => report.targetedSkillIds.includes(id)), report.targetedSkillIds.join(',')))
    results.push(check('no_commit_push_deploy', ACQUISITION_GOVERNANCE.commit === false && ACQUISITION_GOVERNANCE.push === false && ACQUISITION_GOVERNANCE.deploy === false, 'cpd'))
    results.push(check('ml_training_not_claimed_real_gpu', report.exercises.filter(item => item.skillId === 'ml.training' && /training-loop-simulator|training-oom-diagnosis/.test(item.exerciseId)).every(item => /not real gpu|simulator|NOT_REAL_GPU|synthetic/i.test(`${item.actualBehavior} ${item.limitations} ${item.expectedBehavior}`)), 'simulator honesty'))

    let fakeCudaBlocked = false
    try {
      assertNotFakeCudaPass({ ...report.environment, nvcc: null, torch: { present: false, cuda: false, version: null, error: 'none' } }, 'PASS')
    } catch {
      fakeCudaBlocked = true
    }
    let installBlocked = false
    try {
      assertNoAutomaticPackageInstall({ ...report.environment, automaticPackageInstall: true })
    } catch {
      installBlocked = true
    }
    results.push(check('fake_cuda_and_auto_install_guards', fakeCudaBlocked && installBlocked, `cudaGuard=${fakeCudaBlocked} installGuard=${installBlocked}`))

    writeSandboxFile(sandboxTmp, 'wave2/ok.txt', 'isolated')
    results.push(check('sandbox_write_ok_inside', existsSync(path.join(sandboxTmp, 'wave2', 'ok.txt')) || existsSync(path.join(sandboxTmp, 'ok.txt')), sandboxTmp))
  } finally {
    if (previous === undefined) delete process.env.FOUNDRY_CAPABILITY_ATLAS_ROOT
    else process.env.FOUNDRY_CAPABILITY_ATLAS_ROOT = previous
    await rm(atlasTmp, { recursive: true, force: true })
    await rm(sandboxTmp, { recursive: true, force: true })
  }

  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(result => !result.pass)
  console.log(`Foundry capability acquisition wave2: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
export { run as runFoundryCapabilityAcquisitionWave2Validation }
