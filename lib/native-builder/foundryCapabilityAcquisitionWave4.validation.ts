/**
 * Wave 4 targeted skill acquisition proofs.
 * Live Go, live QUIC/HTTP3, real browser React, CUDA review-only.
 * Capability is self-knowledge, not Commander permission.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { foundryDataHierarchy } from './foundryPaths'
import { isProtectedSubsystemPath } from './foundryMissionWriteSet'
import {
  loadCapabilityAtlas,
  buildSkillPack,
  assessMissionCapabilities,
  PLANNER_CAPABILITY_GATE,
  CAPABILITY_GATE_AUTHORITY,
  GOVERNANCE,
  WRIM_INTEGRATION_BOUNDARY,
  WAVE4_TARGET_SKILLS,
  resolveWave4Skills,
  runAcquisitionWave4,
  ACQUISITION_GOVERNANCE,
  WAVE4_GOVERNANCE,
  WAVE4_CUDA_REVIEW,
  assertSandboxIsolation,
  assertNotFakeCudaPass,
  assertNoAutomaticPackageInstall,
  writeSandboxFile,
  AcquisitionSandboxError,
} from './capability-atlas'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

const SYSTEM_INSTALL_CMD = /\b(apt-get|apt |yum |dnf |pacman |brew )\b/

async function run() {
  const previous = process.env.FOUNDRY_CAPABILITY_ATLAS_ROOT
  const atlasTmp = await mkdtemp(path.join(foundryDataHierarchy().capabilityEvaluation, 'wr-acq4-atlas-'))
  const sandboxTmp = await mkdtemp(path.join(foundryDataHierarchy().capabilityEvaluation, 'wr-acq4-sandbox-'))
  process.env.FOUNDRY_CAPABILITY_ATLAS_ROOT = atlasTmp
  const results: CaseResult[] = []
  try {
    const atlas = loadCapabilityAtlas()
    const resolved = resolveWave4Skills(atlas)
    results.push(check(
      'target_ids_resolved',
      WAVE4_TARGET_SKILLS.every(id => atlas.skills.has(id)) && resolved.length === 5,
      resolved.join(','),
    ))

    const packs = resolved.map(id => buildSkillPack(atlas, id))
    results.push(check(
      'packs_loaded',
      packs.every(pack => pack && pack.compact),
      String(packs.filter(Boolean).length),
    ))

    let isolated = false
    try {
      assertSandboxIsolation(path.join(resolveRepoRoot(), 'lib/native-builder/capability-atlas/taxonomy.ts'), sandboxTmp)
    } catch (error) {
      isolated = error instanceof AcquisitionSandboxError
    }
    results.push(check('sandbox_isolated', isolated, 'repo write refused'))

    const report = runAcquisitionWave4({
      atlas,
      sandboxRoot: sandboxTmp,
      persist: true,
      skillIds: [...WAVE4_TARGET_SKILLS],
    })

    results.push(check('go_installed', Boolean(report.go.bin) && /go version go1\./.test(report.go.version), report.go.version || 'missing'))
    results.push(check('go_test_real', report.exercises.some(item => item.skillId === 'software.languages.go' && item.exerciseId === 'go-live-compile-test-race' && /TEST_OUT[\s\S]*PASS: TestHTTP/.test(item.actualBehavior) && item.finalOutcome === 'PASS'), report.exercises.find(item => item.exerciseId === 'go-live-compile-test-race')?.actualBehavior.slice(0, 500) ?? 'missing'))
    results.push(check('go_race_real', report.exercises.some(item => item.skillId === 'software.languages.go' && /RACE_OUT[\s\S]*PASS: TestHTTP|RACE_DETECTOR_UNSUPPORTED/.test(item.actualBehavior) && item.finalOutcome === 'PASS'), report.exercises.find(item => item.exerciseId === 'go-live-compile-test-race')?.actualBehavior.match(/RACE_OUT[\s\S]*/)?.[0]?.slice(0, 400) ?? 'race'))
    results.push(check('go_defect_repair', report.exercises.some(item => item.skillId === 'software.languages.go' && /ignored context cancellation|deadlock|goroutine leak/i.test(item.failureEvidence) && /select on ctx.Done/i.test(item.repairEvidence) && item.finalOutcome === 'PASS'), report.exercises.find(item => item.skillId === 'software.languages.go')?.failureEvidence.slice(0, 240) ?? 'go repair'))
    results.push(check('live_quic_handshake', report.exercises.some(item => item.skillId === 'networking.quic' && item.exerciseId === 'live-quic-udp-loopback' && /QUIC_OK/.test(item.actualBehavior) && item.finalOutcome === 'PASS'), report.exercises.find(item => item.exerciseId === 'live-quic-udp-loopback')?.actualBehavior.slice(0, 240) ?? 'missing'))
    results.push(check('live_quic_stream', report.exercises.some(item => item.skillId === 'networking.quic' && /pong:ping|QUIC_OK/.test(item.actualBehavior)), 'stream'))
    results.push(check('quic_defect_repair', report.exercises.some(item => item.skillId === 'networking.quic' && /ALPN/i.test(item.failureEvidence) && /foundry-quic/i.test(item.repairEvidence)), 'quic repair'))
    results.push(check(
      'http3_real_or_truthful',
      report.exercises.some(item => item.skillId === 'networking.http3' && (/HTTP3_OK/.test(item.actualBehavior) || /incomplete|limitation/i.test(item.limitations))),
      report.exercises.find(item => item.skillId === 'networking.http3')?.actualBehavior.slice(0, 200) ?? 'missing',
    ))
    results.push(check('react_real_browser', report.exercises.some(item => item.skillId === 'frontend.react' && /FAILURE_VISIBLE/.test(item.actualBehavior) && /OK/.test(item.actualBehavior) && item.finalOutcome === 'PASS'), report.exercises.find(item => item.exerciseId === 'react-real-browser-desktop-mobile')?.actualBehavior.slice(0, 600) ?? 'browser'))
    results.push(check('react_desktop', report.exercises.some(item => item.skillId === 'frontend.react' && /DESKTOP/.test(item.actualBehavior)), 'desktop'))
    results.push(check('react_mobile', report.exercises.some(item => item.skillId === 'frontend.react' && /MOBILE/.test(item.actualBehavior)), 'mobile'))
    results.push(check('react_console_clean', report.exercises.some(item => item.skillId === 'frontend.react' && /CONSOLE/.test(item.actualBehavior) && !/desktop console errors/i.test(item.actualBehavior)), 'console'))
    results.push(check('react_defect_repair', report.exercises.some(item => item.skillId === 'frontend.react' && /index-key|key=\{index\}/i.test(item.failureEvidence) && /key=\{item.id\}/i.test(item.repairEvidence)), 'react repair'))
    results.push(check('cuda_review_authoritative', WAVE4_CUDA_REVIEW.sources.length >= 4 && WAVE4_CUDA_REVIEW.conclusion === 'WAIT_FOR_NEWER_TOOLKIT', WAVE4_CUDA_REVIEW.conclusion))
    results.push(check('no_cuda_system_modification', report.systemCudaChanged === false && report.nvidiaDriverChanged === false && report.glibcChanged === false && WAVE4_GOVERNANCE.nativeCudaHeaderPatch === false, 'cuda freeze'))
    results.push(check(
      'no_false_ml_cuda_promotion',
      report.finalStatus['ml.cuda'] !== 'PROVEN' && report.finalStatus['ml.cuda'] !== 'PRODUCTION_PROVEN' && !report.exercises.some(item => item.skillId === 'ml.cuda' && item.evaluationLevel === 'INTEGRATION_EVAL' && item.finalOutcome === 'PASS'),
      report.finalStatus['ml.cuda'] ?? 'missing',
    ))
    results.push(check('no_commander_whitelist', PLANNER_CAPABILITY_GATE.blocksCommanderProjects === false && PLANNER_CAPABILITY_GATE.isPermissionWhitelist === false && CAPABILITY_GATE_AUTHORITY.isCommanderPermissionWhitelist === false && WAVE4_GOVERNANCE.blocksCommanderProjects === false, 'freedom'))
    results.push(check('existing_projects_untouched', report.exercises.every(item => !item.sandboxPath.startsWith(resolveRepoRoot())) && !report.sandboxRoot.startsWith(resolveRepoRoot()), report.sandboxRoot))
    results.push(check('no_terra', WAVE4_GOVERNANCE.terra === false && GOVERNANCE.terra === false && isProtectedSubsystemPath('components/war-room/terra/Globe.tsx'), 'terra'))
    results.push(check('no_wrim_training', WAVE4_GOVERNANCE.wrimTraining === false && WRIM_INTEGRATION_BOUNDARY.trainingExecuted === false, 'wrim'))
    results.push(check('sandbox_path_wave4', report.sandboxRoot.includes('wave4'), report.sandboxRoot))
    results.push(check('production_count_unchanged', report.scoreboardAfter.productionProven === report.scoreboardBefore.productionProven, `${report.scoreboardBefore.productionProven}->${report.scoreboardAfter.productionProven}`))
    results.push(check('no_commit_push_deploy', WAVE4_GOVERNANCE.commit === false && WAVE4_GOVERNANCE.push === false && WAVE4_GOVERNANCE.deploy === false, 'cpd'))
    results.push(check('no_system_package_installs', report.automaticPackageInstalls === 0 && !SYSTEM_INSTALL_CMD.test(report.exercises.flatMap(item => item.commands).join(' ')), 'no apt'))
    results.push(check('go_may_be_proven', ['EVALUATED', 'PROVEN'].includes(report.finalStatus['software.languages.go'] ?? ''), report.finalStatus['software.languages.go'] ?? ''))
    results.push(check('quic_may_be_proven', ['EVALUATED', 'PROVEN'].includes(report.finalStatus['networking.quic'] ?? ''), report.finalStatus['networking.quic'] ?? ''))

    const goPlanner = assessMissionCapabilities({ missionText: 'Build a concurrent Go service.', atlas })
    results.push(check('go_planner_resolves', goPlanner.requiredSkills.includes('software.languages.go'), JSON.stringify({ rec: goPlanner.recommendation, required: goPlanner.requiredSkills })))

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
    results.push(check('fake_cuda_and_auto_install_guards', fakeCudaBlocked && installBlocked && ACQUISITION_GOVERNANCE.automaticPackageInstall === false, `cudaGuard=${fakeCudaBlocked}`))

    writeSandboxFile(sandboxTmp, 'wave4/ok.txt', 'isolated')
    results.push(check('sandbox_write_ok_inside', existsSync(path.join(sandboxTmp, 'wave4', 'ok.txt')) || existsSync(path.join(sandboxTmp, 'ok.txt')), sandboxTmp))
  } finally {
    if (previous === undefined) delete process.env.FOUNDRY_CAPABILITY_ATLAS_ROOT
    else process.env.FOUNDRY_CAPABILITY_ATLAS_ROOT = previous
    await rm(atlasTmp, { recursive: true, force: true })
    await rm(sandboxTmp, { recursive: true, force: true })
  }

  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(result => !result.pass)
  console.log(`Foundry capability acquisition wave4: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
export { run as runFoundryCapabilityAcquisitionWave4Validation }
