/**
 * Governed install/activation mission close path.
 *
 * After activation, operations recovery may legally park a live install at PAUSED
 * (INSTALLING → RECOVERING → PAUSED). Verification is not a legal edge from PAUSED.
 * This module resumes through the existing state machine:
 *   PAUSED → EXECUTING → VERIFYING → COMPLETE
 * or, when still INSTALLING:
 *   INSTALLING → VERIFYING → COMPLETE
 *
 * COMPLETE is only written after evaluateCompletionGate passes. Failed verification
 * never marks COMPLETE. LEGAL_TRANSITIONS is not weakened.
 */
import {
  FOUNDRY_TERMINAL_STATES,
  LEGAL_TRANSITIONS,
  type FoundryJournalEntry,
  type FoundryMissionRecord,
  type FoundryMissionState,
} from './foundryMissionTypes'
import { appendJournal, saveMission, transitionMission } from './foundryMissionStore'
import { evaluateCompletionGate, type CompletionEvidence } from './productionCompletionGate'

export type InstallLifecyclePersist = 'store' | 'memory'

export type CloseVerifiedInstallResult = {
  ok: boolean
  status: FoundryMissionState
  detail: string
  gateComplete: boolean
  path: FoundryMissionState[]
}

export function isLegalMissionTransition(from: FoundryMissionState, to: FoundryMissionState): boolean {
  return (LEGAL_TRANSITIONS[from] ?? []).includes(to)
}

export function pausedCanEnterVerifyingDirectly(): boolean {
  return isLegalMissionTransition('PAUSED', 'VERIFYING')
}

/**
 * Legal states to enter VERIFYING from a recovered or in-flight install mission.
 * PAUSED is never included: resume EXECUTING first.
 */
export function legalInstallVerificationPath(status: FoundryMissionState): FoundryMissionState[] {
  if (status === 'VERIFYING' || FOUNDRY_TERMINAL_STATES.includes(status)) return []
  const path: FoundryMissionState[] = []
  let current = status
  const seen = new Set<FoundryMissionState>()
  while (!seen.has(current)) {
    seen.add(current)
    const allowed = LEGAL_TRANSITIONS[current] ?? []
    if (allowed.includes('VERIFYING')) {
      path.push('VERIFYING')
      return path
    }
    const next = (['INSTALLING', 'PACKAGING', 'EXECUTING'] as const).find(state => allowed.includes(state))
    if (!next) return path
    path.push(next)
    current = next
  }
  return path
}

export function legalInstallCompletionPath(
  status: FoundryMissionState,
  gateComplete: boolean,
): FoundryMissionState[] {
  if (!gateComplete || status === 'COMPLETE') return []
  const path = legalInstallVerificationPath(status)
  const current = path.at(-1) ?? status
  if ((LEGAL_TRANSITIONS[current] ?? []).includes('COMPLETE')) path.push('COMPLETE')
  return path
}

export function applyVerifiedInstallEvidence(
  mission: FoundryMissionRecord,
  evidence: CompletionEvidence,
): void {
  mission.buildState = { ok: evidence.buildOk, detail: evidence.buildOk ? 'PASS' : 'FAIL' }
  mission.packageState = { ok: evidence.packageOk, detail: evidence.packageOk ? 'PASS' : 'FAIL' }
  mission.installState = {
    ok: evidence.installOk,
    installId: evidence.missionInstallId,
    detail: evidence.installOk ? 'PASS' : (mission.installState.detail ?? 'FAIL'),
  }
  mission.runtimeState = {
    activeInstallId: evidence.activeInstallId,
    runningInstallId: evidence.runningInstallId,
    identityMatch: evidence.identityMatch,
    uiHealth: evidence.uiHealthOk,
    coreHealth: evidence.coreHealthOk,
    detail: `ACTIVE=${evidence.activeInstallId} RUNNING=${evidence.runningInstallId} MATCH=${evidence.identityMatch}`,
  }
  mission.browserState = {
    ok: evidence.browserAcceptanceOk,
    detail: evidence.browserAcceptanceOk ? 'PASS' : 'FAIL',
  }
}

function journalNow(kind: FoundryJournalEntry['kind'], text: string): FoundryJournalEntry {
  return { at: new Date().toISOString(), kind, text }
}

export async function transitionInstallMission(
  mission: FoundryMissionRecord,
  next: FoundryMissionState,
  reason: string,
  persist: InstallLifecyclePersist = 'store',
): Promise<void> {
  if (persist === 'store') {
    await transitionMission(mission, next, reason)
    return
  }
  if (mission.status === next) {
    mission.phase = next
    mission.journal = [...mission.journal, journalNow('transition', `Already ${next}: ${reason}`)].slice(-400)
    return
  }
  if (!isLegalMissionTransition(mission.status, next)) {
    mission.journal = [
      ...mission.journal,
      journalNow('transition', `Illegal transition ${mission.status} → ${next} ignored (${reason}).`),
    ].slice(-400)
    throw new Error(`Illegal mission transition ${mission.status} → ${next}`)
  }
  const from = mission.status
  mission.status = next
  mission.phase = next
  mission.journal = [...mission.journal, journalNow('transition', `${from} → ${next}: ${reason}`)].slice(-400)
}

export async function resumeInstallMissionForVerification(
  mission: FoundryMissionRecord,
  reason = 'Resume after recovery to continue install verification',
  persist: InstallLifecyclePersist = 'store',
): Promise<FoundryMissionState[]> {
  const path = legalInstallVerificationPath(mission.status)
  for (const next of path) {
    const text = next === 'EXECUTING'
      ? reason
      : next === 'INSTALLING'
        ? 'Package artifacts present; enter INSTALLING before VERIFYING'
        : next === 'PACKAGING'
          ? 'Build complete; enter PACKAGING before INSTALLING'
          : 'Installed identity verification'
    await transitionInstallMission(mission, next, text, persist)
  }
  return path
}

export async function closeVerifiedInstallMission(
  mission: FoundryMissionRecord,
  evidence: CompletionEvidence,
  persist: InstallLifecyclePersist = 'store',
): Promise<CloseVerifiedInstallResult> {
  if (mission.status === 'COMPLETE') {
    return { ok: true, status: 'COMPLETE', detail: mission.completionGate.detail, gateComplete: true, path: [] }
  }
  if (FOUNDRY_TERMINAL_STATES.includes(mission.status)) {
    const detail = `Terminal mission ${mission.status} cannot enter COMPLETE`
    if (persist === 'store') {
      await appendJournal(mission, { kind: 'decision', text: detail })
      await saveMission(mission)
    } else {
      mission.journal = [...mission.journal, journalNow('decision', detail)].slice(-400)
    }
    return { ok: false, status: mission.status, detail, gateComplete: false, path: [] }
  }
  applyVerifiedInstallEvidence(mission, evidence)
  const gate = evaluateCompletionGate(evidence)
  mission.completionGate = {
    complete: gate.complete,
    missing: gate.missing,
    detail: gate.detail,
  }
  if (persist === 'store') {
    await appendJournal(mission, {
      kind: 'decision',
      text: `Install completion gate ${gate.headline}: ${gate.detail}`,
    })
    await saveMission(mission)
  } else {
    mission.journal = [
      ...mission.journal,
      journalNow('decision', `Install completion gate ${gate.headline}: ${gate.detail}`),
    ].slice(-400)
  }

  if (!gate.complete) {
    const refused = `mission.complete refused: ${gate.detail}`
    if (persist === 'store') {
      await appendJournal(mission, { kind: 'decision', text: refused })
      await saveMission(mission)
    } else {
      mission.journal = [...mission.journal, journalNow('decision', refused)].slice(-400)
    }
    const canFail = isLegalMissionTransition(mission.status, 'FAILED')
      && (mission.status === 'VERIFYING' || mission.status === 'EXECUTING' || mission.status === 'INSTALLING')
    if (canFail) {
      await transitionInstallMission(mission, 'FAILED', `Installed verification failed: ${gate.detail}`, persist)
    }
    return {
      ok: false,
      status: mission.status,
      detail: gate.detail,
      gateComplete: false,
      path: canFail ? ['FAILED'] : [],
    }
  }

  const path = legalInstallCompletionPath(mission.status, true)
  for (const next of path) {
    const text = next === 'EXECUTING'
      ? 'Resume after recovery to continue install verification'
      : next === 'PACKAGING'
        ? 'Build complete; enter PACKAGING before INSTALLING'
        : next === 'INSTALLING'
          ? 'Package artifacts present; enter INSTALLING before VERIFYING'
          : next === 'VERIFYING'
            ? 'Installed identity verified; enter VERIFYING before COMPLETE'
            : gate.detail
    await transitionInstallMission(mission, next, text, persist)
  }

  if (mission.status === 'COMPLETE' && persist === 'store') {
    const { rememberMissionOwnership } = await import('./foundryEngineeringDepth')
    const { cleanupOwnedResources } = await import('./foundryOperationsManager')
    await rememberMissionOwnership(mission)
    await cleanupOwnedResources(mission)
    await saveMission(mission)
  }

  return {
    ok: mission.status === 'COMPLETE',
    status: mission.status,
    detail: gate.detail,
    gateComplete: true,
    path,
  }
}

export function evidenceFromInstallVerify(input: {
  missionInstallId: string
  activeInstallId: string | null
  runningInstallId: string | null
  identityMatch: boolean | null
  uiHealthOk?: boolean
  coreHealthOk?: boolean
  browserAcceptanceOk?: boolean
  consoleAcceptanceOk?: boolean
  networkAcceptanceOk?: boolean
  buildOk?: boolean
  packageOk?: boolean
  installOk?: boolean
  sourceChanged?: boolean
  validationOk?: boolean
}): CompletionEvidence {
  return {
    sourceChanged: input.sourceChanged !== false,
    validationOk: input.validationOk !== false,
    buildOk: input.buildOk !== false,
    packageOk: input.packageOk !== false,
    installOk: input.installOk !== false,
    activeInstallId: input.activeInstallId,
    missionInstallId: input.missionInstallId,
    runningInstallId: input.runningInstallId,
    uiHealthOk: input.uiHealthOk !== false,
    coreHealthOk: input.coreHealthOk !== false,
    identityMatch: input.identityMatch,
    browserAcceptanceOk: input.browserAcceptanceOk !== false,
    consoleAcceptanceOk: input.consoleAcceptanceOk !== false,
    networkAcceptanceOk: input.networkAcceptanceOk !== false,
  }
}

export function journalHasLegalResumeToVerify(journal: Array<{ text: string }>): boolean {
  const texts = journal.map(entry => entry.text)
  const pausedToExecuting = texts.some(text => /PAUSED → EXECUTING/.test(text))
  const executingToVerifying = texts.some(text => /EXECUTING → VERIFYING/.test(text))
  const pausedToVerifyingApplied = texts.some(text => /^PAUSED → VERIFYING:/.test(text))
  return pausedToExecuting && executingToVerifying && !pausedToVerifyingApplied
}
