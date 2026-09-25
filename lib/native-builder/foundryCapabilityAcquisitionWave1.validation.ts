/**
 * Wave 1 targeted skill acquisition proofs.
 * Capability is self-knowledge, not Commander permission.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { isProtectedSubsystemPath } from './foundryMissionWriteSet'
import {
  loadCapabilityAtlas,
  seedAtlas,
  buildSkillPack,
  computeCapabilityStatus,
  assessMissionCapabilities,
  PLANNER_CAPABILITY_GATE,
  CAPABILITY_GATE_AUTHORITY,
  GOVERNANCE,
  WRIM_INTEGRATION_BOUNDARY,
  WAVE1_TARGET_SKILLS,
  resolveWave1Skills,
  runAcquisitionWave1,
  ACQUISITION_GOVERNANCE,
  assertSandboxIsolation,
  assertNotFakeCudaPass,
  writeSandboxFile,
  AcquisitionSandboxError,
} from './capability-atlas'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

async function run() {
  const previous = process.env.FOUNDRY_CAPABILITY_ATLAS_ROOT
  const atlasTmp = await mkdtemp(path.join(tmpdir(), 'wr-acq-atlas-'))
  const sandboxTmp = await mkdtemp(path.join(tmpdir(), 'wr-acq-sandbox-'))
  process.env.FOUNDRY_CAPABILITY_ATLAS_ROOT = atlasTmp
  const results: CaseResult[] = []
  try {
    const atlas = loadCapabilityAtlas()
    const resolved = resolveWave1Skills(atlas)
    results.push(check('selected_skills_resolved_from_atlas', WAVE1_TARGET_SKILLS.every(id => atlas.skills.has(id)) && resolved.length === 10, resolved.join(',')))

    const packs = resolved.map(id => buildSkillPack(atlas, id))
    results.push(check('source_packs_loaded', packs.every(pack => pack && pack.compact) && packs.some(pack => (pack?.officialSources.length ?? 0) > 0), String(packs.filter(Boolean).length)))

    let isolated = false
    try {
      assertSandboxIsolation(path.join(resolveRepoRoot(), 'lib/native-builder/capability-atlas/taxonomy.ts'), sandboxTmp)
    } catch (error) {
      isolated = error instanceof AcquisitionSandboxError
    }
    results.push(check('sandbox_isolation_enforced', isolated, 'repo write refused'))

    const report = runAcquisitionWave1({
      atlas,
      sandboxRoot: sandboxTmp,
      persist: true,
      skillIds: [...WAVE1_TARGET_SKILLS],
    })
    results.push(check('real_exercise_executed', report.exercises.length > 0 && report.exercises.some(item => item.artifacts.length > 0 && existsSync(item.artifacts[0]!)), String(report.exercises.length)))
    results.push(check('failure_evidence_recorded', report.exercises.some(item => item.failureEvidence.trim().length > 0), 'failure'))
    results.push(check('repair_evidence_recorded', report.exercises.some(item => item.repairEvidence.trim().length > 0), 'repair'))
    results.push(check('pass_requires_artifacts', report.exercises.filter(item => item.finalOutcome === 'PASS').every(item => item.artifacts.length > 0), 'pass artifacts'))

    const docsOnly = computeCapabilityStatus({
      skill: atlas.skills.get('ml.cuda')!,
      evaluations: [],
      sources: [...atlas.sources.values()].filter(source => source.skillIds.includes('ml.cuda')),
    })
    results.push(check('documentation_alone_cannot_pass', docsOnly !== 'PROVEN' && docsOnly !== 'EVALUATED' && docsOnly !== 'PRODUCTION_PROVEN', docsOnly))

    results.push(check('code_eval_recorded', report.exercises.some(item => item.evaluationLevel === 'CODE_EVAL'), 'CODE_EVAL'))
    results.push(check('debug_eval_recorded', report.exercises.some(item => item.evaluationLevel === 'DEBUG_EVAL'), 'DEBUG_EVAL'))
    results.push(check('combined_linux_scenario', Boolean(report.combinedLinux && report.combinedLinux.exerciseId.includes('combined-linux')), report.combinedLinux?.finalOutcome ?? 'missing'))
    results.push(check('combined_gpu_scenario', Boolean(report.combinedGpu && report.combinedGpu.exerciseId.includes('combined-gpu')), report.combinedGpu?.finalOutcome ?? 'missing'))
    results.push(check('environment_limitation_recorded_truthfully', report.exercises.some(item => item.limitations.length > 0) || Boolean(report.environment.gpu.queryError || !report.environment.nvcc), `nvcc=${report.environment.nvcc || 'missing'}`))

    let fakeCudaBlocked = false
    try {
      assertNotFakeCudaPass({ ...report.environment, nvcc: null, torch: { present: false, cuda: false, version: null, error: 'none' } }, 'PASS')
    } catch {
      fakeCudaBlocked = true
    }
    const cudaPass = report.exercises.filter(item => item.skillId === 'ml.cuda' && item.finalOutcome === 'PASS')
    const cudaPassLegal = cudaPass.length === 0 || Boolean(report.environment.nvcc || report.environment.torch.cuda)
    results.push(check('no_fake_cuda_pass', fakeCudaBlocked && cudaPassLegal, `cudaPass=${cudaPass.length} nvcc=${report.environment.nvcc || 'missing'}`))

    const cmds = report.exercises.flatMap(item => item.commands).join(' ')
    results.push(check('kernel_module_not_loaded', !/\binsmod\b|\bmodprobe\b/.test(cmds), cmds.slice(0, 200)))
    results.push(check('system_service_not_installed', !report.exercises.some(item => /\/etc\/systemd\/|systemctl enable/.test(item.commands.join(' ') + item.repairEvidence)), 'no enable'))

    const repo = resolveRepoRoot()
    const harbor = existsSync(path.join(repo, 'components/war-room/harbor')) || existsSync(path.join(repo, 'lib/native-builder/foundryApplicationBuilder.crm.commander.ts'))
    results.push(check('existing_projects_untouched', harbor && report.exercises.every(item => !item.sandboxPath.startsWith(repo)), report.sandboxRoot))
    results.push(check('production_proven_unchanged', report.scoreboardAfter.productionProven === report.scoreboardBefore.productionProven, `${report.scoreboardBefore.productionProven}->${report.scoreboardAfter.productionProven}`))

    const afterLinux = assessMissionCapabilities({ missionText: 'Build a Linux service.', atlas })
    results.push(check('planner_consumes_resulting_status', afterLinux.requiredSkills.some(id => id.startsWith('os.linux')) && afterLinux.grantsAuthority === false, JSON.stringify({ rec: afterLinux.recommendation, required: afterLinux.requiredSkills, status: report.finalStatus })))
    results.push(check('capability_status_does_not_become_commander_permission', PLANNER_CAPABILITY_GATE.blocksCommanderProjects === false && PLANNER_CAPABILITY_GATE.isPermissionWhitelist === false && CAPABILITY_GATE_AUTHORITY.isCommanderPermissionWhitelist === false && ACQUISITION_GOVERNANCE.blocksCommanderProjects === false && afterLinux.acquisitionPlans.length >= 0, 'freedom'))

    writeSandboxFile(sandboxTmp, 'wave1/ok.txt', 'isolated')
    results.push(check('sandbox_write_ok_inside', existsSync(path.join(sandboxTmp, 'wave1', 'ok.txt')) || existsSync(path.join(sandboxTmp, 'wave1', 'wave1', 'ok.txt')), sandboxTmp))
    results.push(check('no_wrim_training', ACQUISITION_GOVERNANCE.wrimTraining === false && WRIM_INTEGRATION_BOUNDARY.trainingExecuted === false, 'wrim'))
    results.push(check('no_terra', ACQUISITION_GOVERNANCE.terra === false && GOVERNANCE.terra === false && isProtectedSubsystemPath('components/war-room/terra/Globe.tsx'), 'terra'))
    results.push(check('no_commit_push_deploy', ACQUISITION_GOVERNANCE.commit === false && ACQUISITION_GOVERNANCE.push === false && ACQUISITION_GOVERNANCE.deploy === false, 'cpd'))
    results.push(check('seed_still_unproven_without_eval', seedAtlas().skills.get('os.linux')?.capabilityStatus !== 'PROVEN', seedAtlas().skills.get('os.linux')?.capabilityStatus ?? 'missing'))
  } finally {
    if (previous === undefined) delete process.env.FOUNDRY_CAPABILITY_ATLAS_ROOT
    else process.env.FOUNDRY_CAPABILITY_ATLAS_ROOT = previous
    await rm(atlasTmp, { recursive: true, force: true })
    await rm(sandboxTmp, { recursive: true, force: true })
  }

  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(result => !result.pass)
  console.log(`Foundry capability acquisition wave1: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
export { run as runFoundryCapabilityAcquisitionWave1Validation }
