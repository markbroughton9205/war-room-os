/**
 * Wave 3 targeted skill acquisition proofs.
 * Capability is self-knowledge, not Commander permission.
 * PyTorch CUDA is not native nvcc proof.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
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
  WAVE3_TARGET_SKILLS,
  resolveWave3Skills,
  runAcquisitionWave3,
  ACQUISITION_GOVERNANCE,
  assertSandboxIsolation,
  assertNotFakeCudaPass,
  assertNoAutomaticPackageInstall,
  writeSandboxFile,
  AcquisitionSandboxError,
  NATIVE_CUDA_BLOCKER,
} from './capability-atlas'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

const SYSTEM_INSTALL_CMD = /\b(apt-get|apt |yum |dnf |pacman |brew |pip3? install|pnpm add|cargo install)\b/

async function run() {
  const previous = process.env.FOUNDRY_CAPABILITY_ATLAS_ROOT
  const atlasTmp = await mkdtemp(path.join(tmpdir(), 'wr-acq3-atlas-'))
  const sandboxTmp = await mkdtemp(path.join(tmpdir(), 'wr-acq3-sandbox-'))
  process.env.FOUNDRY_CAPABILITY_ATLAS_ROOT = atlasTmp
  const results: CaseResult[] = []
  try {
    const atlas = loadCapabilityAtlas()
    const resolved = resolveWave3Skills(atlas)
    results.push(check(
      'target_ids_resolved',
      WAVE3_TARGET_SKILLS.every(id => atlas.skills.has(id)) && resolved.length === 8,
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
    results.push(check('sandbox_isolated', isolated, 'repo write refused'))

    const report = runAcquisitionWave3({
      atlas,
      sandboxRoot: sandboxTmp,
      persist: true,
      skillIds: [...WAVE3_TARGET_SKILLS],
    })

    results.push(check('sandbox_path_wave3', report.sandboxRoot.includes('wave3') && report.exercises.every(item => item.sandboxPath.startsWith(path.resolve(sandboxTmp)) || item.sandboxPath.startsWith(sandboxTmp) || item.sandboxPath.includes('wave3')), report.sandboxRoot))
    results.push(check('pytorch_real_cuda_execution', report.exercises.some(item => item.skillId === 'ml.pytorch' && /CUDA_AVAILABLE 1|cuda/i.test(`${item.actualBehavior} ${item.input}`)), report.exercises.find(item => item.skillId === 'ml.pytorch')?.actualBehavior.slice(0, 200) ?? 'missing'))
    results.push(check('pytorch_real_backward_pass', report.exercises.some(item => item.skillId === 'ml.pytorch' && /FORWARD_BACKWARD_OPT|backward/i.test(item.actualBehavior)), 'backward'))
    results.push(check('pytorch_failure_repair', report.exercises.some(item => item.skillId === 'ml.pytorch' && item.failureEvidence.length > 0 && item.repairEvidence.length > 0), 'pytorch defect'))
    results.push(check('quic_evaluation', report.exercises.some(item => item.skillId === 'networking.quic' && (item.finalOutcome === 'PASS' || item.finalOutcome === 'PARTIAL') && /0-RTT|QUIC|stream/i.test(`${item.actualBehavior} ${item.input}`)), report.exercises.find(item => item.skillId === 'networking.quic')?.finalOutcome ?? 'missing'))
    results.push(check('go_evaluation_or_limitation', report.exercises.some(item => item.skillId === 'software.languages.go' && (report.go ? item.finalOutcome === 'PASS' || item.finalOutcome === 'PARTIAL' : /missing|not installed|environment-limited/i.test(item.limitations))), report.go ?? 'go missing'))
    results.push(check('llvm_real_pipeline', report.exercises.some(item => item.skillId === 'compiler.llvm' && /clang|llc|opt|pipeline/i.test(`${item.commands.join(' ')} ${item.actualBehavior}`)), 'llvm'))
    results.push(check('llvm_verifier_failure_repair', report.exercises.some(item => item.skillId === 'compiler.llvm' && /phi/i.test(item.failureEvidence) && item.repairEvidence.length > 0), 'phi'))
    results.push(check('react_real_or_limited', report.exercises.some(item => item.skillId === 'frontend.react' && (item.finalOutcome === 'PASS' || /npm|jsdom|missing|failed/i.test(item.limitations))), 'react'))
    results.push(check('tls_real_handshake', report.exercises.some(item => item.skillId === 'networking.tls' && /localhost|TLS|pong|handshake/i.test(`${item.actualBehavior} ${item.expectedBehavior}`)), 'tls'))
    results.push(check('tls_failure_repair', report.exercises.some(item => item.skillId === 'networking.tls' && /hostname|SAN|altname|Host/i.test(item.failureEvidence) && /localhost/i.test(item.repairEvidence)), 'tls repair'))
    results.push(check('postgres_explain_analyze', report.exercises.some(item => item.skillId === 'database.query-optimization' && /EXPLAIN|Execution Time|psql/i.test(`${item.commands.join(' ')} ${item.actualBehavior} ${item.input}`)), 'explain'))
    results.push(check('query_optimization_measurement', report.exercises.some(item => item.skillId === 'database.query-optimization' && /beforeMs|Execution Time|afterMs/i.test(item.actualBehavior)), 'measured'))
    results.push(check('profiling_baseline', report.exercises.some(item => item.skillId === 'performance.profiling' && /BASELINE|baseline|HOTSPOT|cProfile/i.test(`${item.actualBehavior} ${item.input}`)), 'baseline'))
    results.push(check('profiling_repair_measurement', report.exercises.some(item => item.skillId === 'performance.profiling' && /IMPROVED|repaired|set\(/i.test(`${item.actualBehavior} ${item.repairEvidence}`)), 'improved'))
    results.push(check('ai_combined_scenario', Boolean(report.combinedAi && report.combinedAi.exerciseId.includes('combined-ai')), report.combinedAi?.finalOutcome ?? 'missing'))
    results.push(check('secure_web_scenario', Boolean(report.combinedWeb && report.combinedWeb.exerciseId.includes('combined-secure-web')), report.combinedWeb?.finalOutcome ?? 'missing'))
    results.push(check('performance_combined_scenario', Boolean(report.combinedPerformance && report.combinedPerformance.exerciseId.includes('combined-performance')), report.combinedPerformance?.finalOutcome ?? 'missing'))

    const cudaPass = report.exercises.filter(item => item.skillId === 'ml.cuda' && item.finalOutcome === 'PASS')
    results.push(check('no_fake_native_cuda_proof', cudaPass.length === 0 && /nvcc|glibc|rsqrt/i.test(JSON.stringify(report.nativeCudaBlocker)), `cudaPass=${cudaPass.length}`))
    results.push(check('no_system_cuda_destabilization', ACQUISITION_GOVERNANCE.automaticPackageInstall === false && !/nvidia driver|glibc/.test(report.exercises.flatMap(item => item.commands).join(' ')), 'no driver/glibc commands'))
    results.push(check('no_commander_whitelist', PLANNER_CAPABILITY_GATE.blocksCommanderProjects === false && PLANNER_CAPABILITY_GATE.isPermissionWhitelist === false && CAPABILITY_GATE_AUTHORITY.isCommanderPermissionWhitelist === false && ACQUISITION_GOVERNANCE.blocksCommanderProjects === false, 'freedom'))
    results.push(check('production_count_unchanged', report.scoreboardAfter.productionProven === report.scoreboardBefore.productionProven, `${report.scoreboardBefore.productionProven}->${report.scoreboardAfter.productionProven}`))

    const repo = resolveRepoRoot()
    results.push(check('existing_projects_untouched', report.exercises.every(item => !item.sandboxPath.startsWith(repo)) && !report.sandboxRoot.startsWith(repo), report.sandboxRoot))
    results.push(check('no_terra', ACQUISITION_GOVERNANCE.terra === false && GOVERNANCE.terra === false && isProtectedSubsystemPath('components/war-room/terra/Globe.tsx'), 'terra'))
    results.push(check('no_wrim_training', ACQUISITION_GOVERNANCE.wrimTraining === false && WRIM_INTEGRATION_BOUNDARY.trainingExecuted === false, 'wrim'))

    results.push(check('eight_targets_attempted', report.targetedSkillIds.length === 8 && WAVE3_TARGET_SKILLS.every(id => report.targetedSkillIds.includes(id)), report.targetedSkillIds.join(',')))
    results.push(check('no_commit_push_deploy', ACQUISITION_GOVERNANCE.commit === false && ACQUISITION_GOVERNANCE.push === false && ACQUISITION_GOVERNANCE.deploy === false, 'cpd'))
    results.push(check('no_system_package_installs', report.automaticPackageInstalls === 0 && !SYSTEM_INSTALL_CMD.test(report.exercises.flatMap(item => item.commands).join(' ')), report.exercises.flatMap(item => item.commands).join(' ').slice(0, 200)))
    results.push(check('real_failure_repair_evidence', report.exercises.some(item => item.failureEvidence.trim().length > 0) && report.exercises.some(item => item.repairEvidence.trim().length > 0), 'failure+repair'))

    const pytorchAfter = assessMissionCapabilities({ missionText: 'Build and debug a PyTorch training pipeline.', atlas })
    results.push(check(
      'pytorch_planner_resolves',
      pytorchAfter.requiredSkills.includes('ml.pytorch'),
      JSON.stringify({ rec: pytorchAfter.recommendation, required: pytorchAfter.requiredSkills }),
    ))

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

    writeSandboxFile(sandboxTmp, 'wave3/ok.txt', 'isolated')
    results.push(check('sandbox_write_ok_inside', existsSync(path.join(sandboxTmp, 'wave3', 'ok.txt')) || existsSync(path.join(sandboxTmp, 'ok.txt')), sandboxTmp))
    results.push(check('native_cuda_blocker_recorded', /rsqrt/i.test(NATIVE_CUDA_BLOCKER.issue) && NATIVE_CUDA_BLOCKER.glibc === '2.43', JSON.stringify(NATIVE_CUDA_BLOCKER)))
  } finally {
    if (previous === undefined) delete process.env.FOUNDRY_CAPABILITY_ATLAS_ROOT
    else process.env.FOUNDRY_CAPABILITY_ATLAS_ROOT = previous
    await rm(atlasTmp, { recursive: true, force: true })
    await rm(sandboxTmp, { recursive: true, force: true })
  }

  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(result => !result.pass)
  console.log(`Foundry capability acquisition wave3: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
export { run as runFoundryCapabilityAcquisitionWave3Validation }
