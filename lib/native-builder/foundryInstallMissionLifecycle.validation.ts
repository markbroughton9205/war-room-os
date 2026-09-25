/**
 * Install/activation mission lifecycle: legal resume before VERIFYING, terminal COMPLETE
 * only after the production completion gate, no PAUSED → VERIFYING shortcut.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { startMissionInput } from './foundryMissionController'
import {
  FOUNDRY_TERMINAL_STATES,
  LEGAL_TRANSITIONS,
  type FoundryMissionRecord,
  type FoundryMissionState,
} from './foundryMissionTypes'
import {
  closeVerifiedInstallMission,
  evidenceFromInstallVerify,
  isLegalMissionTransition,
  journalHasLegalResumeToVerify,
  legalInstallCompletionPath,
  legalInstallVerificationPath,
  pausedCanEnterVerifyingDirectly,
  transitionInstallMission,
} from './foundryInstallMissionLifecycle'
import { selectCurrentCommanderWork } from './foundryCommanderExperience'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

const INSTALL_ID = 'war-room-os-0.1.0-fixture-install-lifecycle'

function source(rel: string): string {
  return readFileSync(path.join(resolveRepoRoot(), rel), 'utf8')
}

function fixture(status: FoundryMissionState, pauseRequested = false): FoundryMissionRecord {
  const mission = startMissionInput(
    'Governed install lifecycle fixture. Do not rebuild. Do not modify Terra.',
    'Install lifecycle fixture',
  )
  mission.status = status
  mission.phase = status
  mission.kind = 'application'
  mission.visibility = 'system'
  mission.classification = 'SYSTEM_TEST'
  mission.testArtifact = true
  mission.pauseRequested = pauseRequested
  mission.journal = []
  return mission
}

function passingEvidence() {
  return evidenceFromInstallVerify({
    missionInstallId: INSTALL_ID,
    activeInstallId: INSTALL_ID,
    runningInstallId: INSTALL_ID,
    identityMatch: true,
    uiHealthOk: true,
    coreHealthOk: true,
    browserAcceptanceOk: true,
    buildOk: true,
    packageOk: true,
    installOk: true,
  })
}

function failingEvidence() {
  return evidenceFromInstallVerify({
    missionInstallId: INSTALL_ID,
    activeInstallId: INSTALL_ID,
    runningInstallId: 'other-running-install',
    identityMatch: false,
    uiHealthOk: true,
    coreHealthOk: true,
    browserAcceptanceOk: false,
    buildOk: true,
    packageOk: true,
    installOk: true,
  })
}

function recoveredWouldSelect(status: FoundryMissionState): boolean {
  return !FOUNDRY_TERMINAL_STATES.includes(status)
}

async function run() {
  const results: CaseResult[] = []
  const types = source('lib/native-builder/foundryMissionTypes.ts')
  const closer = source('lib/native-builder/foundryInstallMissionLifecycle.ts')
  const controller = source('lib/native-builder/foundryMissionController.ts')
  const cleanupInstall = source('tmp/foundry-final-product-cleanup-install.ts')
  const opsInstall = source('tmp/foundry-operational-readiness-install.ts')
  const shellInstall = source('tmp/war-room-commander-shell-install.ts')
  const terraInstall = source('tmp/terra-freeze-stability/install-production.ts')
  const terraRetry = source('tmp/terra-freeze-stability/retry-package-install.ts')

  results.push(check(
    'paused_cannot_jump_to_verifying',
    pausedCanEnterVerifyingDirectly() === false && !isLegalMissionTransition('PAUSED', 'VERIFYING'),
    JSON.stringify(LEGAL_TRANSITIONS.PAUSED),
  ))
  results.push(check(
    'state_machine_not_weakened',
    /PAUSED:\s*\[[^\]]*'QUEUED'/.test(types) && !/PAUSED:\s*\[[^\]]*VERIFYING/.test(types),
    'PAUSED legal set excludes VERIFYING',
  ))
  results.push(check(
    'no_direct_mission_json_overwrite',
    /transitionMission\(/.test(closer)
      && !/writeFile\(.*missions/.test(closer)
      && !/JSON\.stringify\(mission/.test(closer.split('applyTransition')[0] ?? closer),
    'closer uses transitionMission',
  ))
  results.push(check(
    'orchestrator_resumes_before_verifying',
    JSON.stringify(legalInstallVerificationPath('PAUSED')) === JSON.stringify(['EXECUTING', 'VERIFYING'])
      && JSON.stringify(legalInstallCompletionPath('PAUSED', true)) === JSON.stringify(['EXECUTING', 'VERIFYING', 'COMPLETE']),
    legalInstallCompletionPath('PAUSED', true).join('→'),
  ))
  results.push(check(
    'installing_verifies_without_pause',
    JSON.stringify(legalInstallCompletionPath('INSTALLING', true)) === JSON.stringify(['VERIFYING', 'COMPLETE']),
    legalInstallCompletionPath('INSTALLING', true).join('→'),
  ))

  const successFromInstalling = fixture('INSTALLING')
  const closedInstalling = await closeVerifiedInstallMission(successFromInstalling, passingEvidence(), 'memory')
  results.push(check(
    'successful_install_lifecycle_reaches_complete',
    closedInstalling.ok && closedInstalling.status === 'COMPLETE' && closedInstalling.path.join('→') === 'VERIFYING→COMPLETE',
    `${closedInstalling.status} ${closedInstalling.path.join('→')}`,
  ))
  results.push(check(
    'activation_does_not_leave_paused',
    successFromInstalling.status === 'COMPLETE' && successFromInstalling.status !== 'PAUSED',
    successFromInstalling.status,
  ))

  const paused = fixture('PAUSED', true)
  const closedPaused = await closeVerifiedInstallMission(paused, passingEvidence(), 'memory')
  results.push(check(
    'real_pause_resumes_then_verifies_then_completes',
    closedPaused.ok
      && paused.status === 'COMPLETE'
      && closedPaused.path.join('→') === 'EXECUTING→VERIFYING→COMPLETE'
      && journalHasLegalResumeToVerify(paused.journal),
    `${closedPaused.path.join('→')} journal=${paused.journal.map(item => item.text).join(' | ')}`,
  ))

  const illegalProbe = fixture('PAUSED', true)
  let illegalThrew = false
  try {
    await transitionInstallMission(illegalProbe, 'VERIFYING', 'installed', 'memory')
  } catch (error) {
    illegalThrew = /Illegal mission transition PAUSED → VERIFYING/.test(error instanceof Error ? error.message : String(error))
  }
  results.push(check(
    'paused_to_verifying_still_illegal',
    isLegalMissionTransition('PAUSED', 'VERIFYING') === false
      && isLegalMissionTransition('PAUSED', 'EXECUTING') === true
      && illegalThrew
      && illegalProbe.status === 'PAUSED',
    `${illegalProbe.status} threw=${illegalThrew}`,
  ))

  const failedFromPaused = fixture('PAUSED', true)
  const failedClose = await closeVerifiedInstallMission(failedFromPaused, failingEvidence(), 'memory')
  results.push(check(
    'failed_verification_does_not_complete',
    failedClose.ok === false && failedFromPaused.status !== 'COMPLETE' && failedClose.gateComplete === false,
    `${failedFromPaused.status} ${failedClose.detail}`,
  ))

  const failedFromVerifying = fixture('VERIFYING')
  const failedVerifyClose = await closeVerifiedInstallMission(failedFromVerifying, failingEvidence(), 'memory')
  results.push(check(
    'failed_verification_from_verifying_is_failed_not_complete',
    failedVerifyClose.ok === false && failedFromVerifying.status === 'FAILED' && failedFromVerifying.status !== 'COMPLETE',
    failedFromVerifying.status,
  ))

  const cancelledTerminal = fixture('CANCELLED')
  const cancelledClose = await closeVerifiedInstallMission(cancelledTerminal, passingEvidence(), 'memory')
  results.push(check(
    'cancelled_terminal_cannot_complete',
    cancelledClose.ok === false && cancelledTerminal.status === 'CANCELLED',
    cancelledTerminal.status,
  ))

  results.push(check(
    'terminal_install_mission_not_commander_current',
    selectCurrentCommanderWork([successFromInstalling, paused]) === null,
    successFromInstalling.status,
  ))

  results.push(check(
    'restart_preserves_terminal_state',
    recoveredWouldSelect('COMPLETE') === false && FOUNDRY_TERMINAL_STATES.includes(successFromInstalling.status),
    successFromInstalling.status,
  ))

  results.push(check(
    'identity_evidence_required_for_complete',
    legalInstallCompletionPath('PAUSED', false).length === 0
      && passingEvidence().identityMatch === true
      && failingEvidence().identityMatch === false,
    'gate false yields empty completion path',
  ))

  results.push(check(
    'controller_resumes_before_identity',
    /resumeInstallMissionForVerification\(mission, 'Exact identity'\)/.test(controller)
      && !/transitionMission\(mission, 'VERIFYING', 'Exact identity'\)/.test(controller),
    'stepIdentity uses legal resume',
  ))
  results.push(check(
    'install_scripts_use_legal_closer',
    /closeVerifiedInstallMission/.test(cleanupInstall)
      && /closeVerifiedInstallMission/.test(opsInstall)
      && /closeVerifiedInstallMission/.test(shellInstall)
      && /closeVerifiedInstallMission/.test(terraInstall)
      && /closeVerifiedInstallMission/.test(terraRetry)
      && !/transitionMission\([^,]+, 'VERIFYING', 'installed'\)/.test(cleanupInstall)
      && !/transitionMission\([^,]+, 'VERIFYING', 'installed'\)/.test(opsInstall)
      && !/transitionMission\([^,]+, 'VERIFYING', 'installed'\)/.test(shellInstall)
      && !/transitionMission\([^,]+, 'VERIFYING', 'installed'\)/.test(terraInstall)
      && !/transitionMission\([^,]+, 'VERIFYING', 'installed'\)/.test(terraRetry),
    'tmp install scripts',
  ))
  results.push(check(
    'complete_when_gate_passes_resumes_paused',
    /resumeInstallMissionForVerification\(mission, 'Gate complete; resume EXECUTING before COMPLETE'\)/.test(controller),
    'completeWhenGatePasses',
  ))
  results.push(check(
    'packaging_walks_installing_then_verifying',
    JSON.stringify(legalInstallVerificationPath('PACKAGING')) === JSON.stringify(['INSTALLING', 'VERIFYING'])
      && JSON.stringify(legalInstallCompletionPath('PACKAGING', true)) === JSON.stringify(['INSTALLING', 'VERIFYING', 'COMPLETE'])
      && isLegalMissionTransition('PACKAGING', 'COMPLETE') === false
      && isLegalMissionTransition('PACKAGING', 'INSTALLING') === true,
    legalInstallCompletionPath('PACKAGING', true).join('→'),
  ))

  const packaging = fixture('PACKAGING')
  const closedPackaging = await closeVerifiedInstallMission(packaging, passingEvidence(), 'memory')
  results.push(check(
    'packaging_leftover_reaches_complete_legally',
    closedPackaging.ok && packaging.status === 'COMPLETE' && closedPackaging.path.join('→') === 'INSTALLING→VERIFYING→COMPLETE',
    `${closedPackaging.status} ${closedPackaging.path.join('→')}`,
  ))

  const cancelled = fixture('CANCELLED')
  const closedCancelled = await closeVerifiedInstallMission(cancelled, passingEvidence(), 'memory')
  results.push(check(
    'cancelled_cannot_be_forced_complete',
    closedCancelled.ok === false
      && cancelled.status === 'CANCELLED'
      && legalInstallCompletionPath('CANCELLED', true).length === 0
      && isLegalMissionTransition('CANCELLED', 'COMPLETE') === false,
    `${cancelled.status} path=${closedCancelled.path.join('→') || 'none'}`,
  ))

  const terraPaused = fixture('INSTALLING')
  terraPaused.title = 'Terra Freeze Stability Production Install'
  terraPaused.userRequest = 'Install Terra freeze-stability repair into a new per-user War Room OS runtime.'
  terraPaused.status = 'PAUSED'
  terraPaused.phase = 'PAUSED'
  terraPaused.pauseRequested = false
  terraPaused.recovery = {
    recoveredAt: new Date().toISOString(),
    recovered: true,
    disposition: 'READY_TO_RESUME',
    interruptedToolCalls: [],
    notes: ['Operations manager startup recovery'],
  }
  terraPaused.journal = [
    { at: new Date().toISOString(), kind: 'transition', text: 'INSTALLING → RECOVERING: Operations manager startup recovery' },
    { at: new Date().toISOString(), kind: 'transition', text: 'RECOVERING → PAUSED: Recovered and ready to resume the same mission' },
  ]
  const terraClosed = await closeVerifiedInstallMission(terraPaused, passingEvidence(), 'memory')
  results.push(check(
    'terra_style_paused_resume_uses_shared_closer',
    terraClosed.ok
      && terraPaused.status === 'COMPLETE'
      && terraClosed.path.join('→') === 'EXECUTING→VERIFYING→COMPLETE'
      && journalHasLegalResumeToVerify(terraPaused.journal)
      && /closeVerifiedInstallMission/.test(terraInstall)
      && !/LEGAL_TRANSITIONS\[.PAUSED.\]/.test(terraInstall),
    terraClosed.path.join('→'),
  ))

  const terraIdentityFail = fixture('PAUSED', true)
  terraIdentityFail.title = 'Terra Freeze Stability Production Install'
  const terraIdentityClosed = await closeVerifiedInstallMission(terraIdentityFail, failingEvidence(), 'memory')
  results.push(check(
    'terra_identity_fail_does_not_complete',
    terraIdentityClosed.ok === false && terraIdentityFail.status !== 'COMPLETE' && terraIdentityClosed.gateComplete === false,
    `${terraIdentityFail.status} ${terraIdentityClosed.detail}`,
  ))

  const terraValidationFail = fixture('PAUSED', true)
  terraValidationFail.title = 'Terra Freeze Stability Production Install'
  const terraValidationClosed = await closeVerifiedInstallMission(
    terraValidationFail,
    evidenceFromInstallVerify({
      missionInstallId: INSTALL_ID,
      activeInstallId: INSTALL_ID,
      runningInstallId: INSTALL_ID,
      identityMatch: true,
      validationOk: false,
    }),
    'memory',
  )
  results.push(check(
    'terra_validation_fail_does_not_complete',
    terraValidationClosed.ok === false && terraValidationFail.status !== 'COMPLETE' && /VALIDATION_DONE/.test(terraValidationClosed.detail),
    terraValidationClosed.detail,
  ))

  const terraHealthFail = fixture('PAUSED', true)
  terraHealthFail.title = 'Terra Freeze Stability Production Install'
  const terraHealthClosed = await closeVerifiedInstallMission(
    terraHealthFail,
    evidenceFromInstallVerify({
      missionInstallId: INSTALL_ID,
      activeInstallId: INSTALL_ID,
      runningInstallId: INSTALL_ID,
      identityMatch: true,
      uiHealthOk: false,
      coreHealthOk: false,
    }),
    'memory',
  )
  results.push(check(
    'terra_runtime_health_fail_does_not_complete',
    terraHealthClosed.ok === false && terraHealthFail.status !== 'COMPLETE' && /UI_HEALTH|CORE_HEALTH/.test(terraHealthClosed.detail),
    terraHealthClosed.detail,
  ))

  const failed = results.filter(item => !item.pass)
  for (const item of results) {
    console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
  }
  console.log(`${results.filter(item => item.pass).length}/${results.length} PASS`)
  if (failed.length) process.exitCode = 1
}

const isDirect = import.meta.url === pathToFileURL(process.argv[1] ?? '').href
if (isDirect) {
  run().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
