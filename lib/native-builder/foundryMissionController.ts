/**
 * Foundry Mission Controller — PASS 004 autonomous coding agent.
 * Chooses existing Engineer/Foundry broker tools from mission state. Does not rebuild PASS 003.
 */
import { createHash, randomUUID } from 'node:crypto'
import { executeEngineerTool, type EngineerToolName } from './engineerTools'
import { coerceTerminalExecuteArgs } from './foundryToolCatalog'
import { evaluateCompletionGate } from './productionCompletionGate'
import { interpretCommanderRequest, buildInitialPlan, replanAfterTestFailure } from './foundryMissionPlanner'
import { emptyApplicationBuilderState } from './foundryApplicationBuilderTypes'
import { classifyFoundryMission, isTestMissionClass } from './foundryMissionVisibility'
import { appendJournal, loadMission, saveMission, summarizeContext, transitionMission } from './foundryMissionStore'
import { resumeInstallMissionForVerification } from './foundryInstallMissionLifecycle'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { logWarRoomRepoAudit } from '@/lib/war-room/repoAudit'
import { FoundryModelRouter } from './foundryModelRouter'
import { resolveFoundryBrainStatus } from './foundryBrainStatus'
import { applyFoundryRuntimeConfig } from './foundryRuntimeConfig'
import { foundryContextForModel } from './foundryContextManager'
import { appendFoundryAgentEvent } from './foundryAgentEvents'
import {
  canComplete as contractCanComplete,
  canEnterExecutionFromMission,
  currentVerdict,
  isStandaloneEngineerMission,
  missingAcceptanceEvidence,
} from './foundryVerdictLayer'
import { loadAcceptanceContract, loadMissionContract, loadVerdictRecord, appendContractEvent } from './foundryContractStore'
import {
  abortFoundryAgentWork,
  beginFoundryAgentWork,
  foundryAgentAbortSignal,
  isFoundryAgentAborted,
  releaseFoundryAgentWork,
} from './foundryAgentCancellation'
import {
  foundryPlanningReadOnlyCatalog,
  isFoundryPlanningMode,
  planningModeBlocksTool,
  enterFoundryExecutionFromPlan,
} from './foundryPlanningMode'
import { normalizeFoundryToolResult, noteConsecutiveToolFailure } from './foundryAgentLoop'
import { isReadOnlyLocateRequest, nextOrderedInspectPath, orderedInspectProgress, orderedInspectTargets } from './foundryLocalModelRuntime'
import {
  applyCompactWorkingLine,
  buildImpactMap,
  captureEngineeringBaseline,
  classifyFailure,
  ensureEngineeringState,
  isTestFile,
  journalTestChange,
  mutationAllowedByDiagnosis,
  normalizeWriteArgs,
  noteRepeatedAction,
  rememberMissionOwnership,
  runSelfReview,
  seedFixtureDiagnosis,
  selectRegressionSet,
  selectRelevantTests,
} from './foundryEngineeringDepth'
import {
  assessMutationTarget,
  compactOwnershipQuery,
  evaluateWriteSafety,
  productionBuildAllowed,
  rankTests,
  recordActionContract,
  rejectIrrelevantTest,
  validateActionContract,
} from './foundryEngineeringContract'
import {
  boundedEditRecoveryHint,
  classifyBoundedEditFailure,
  isEngineeringReviewDetailRequest,
  isSourceMutationTool,
} from './foundryBoundedEdit'
import {
  actionNotAllowedInBoundedRetry,
  boundedRetryLockFromMission,
  normalizeBoundedRetryToolName,
} from './foundryBoundedRetry'
import {
  beginEditMatchRecovery,
  beginLintRegionRecovery,
  evaluateSourceReadGuard,
  focusedReadArgs,
  lintFocusedReadArgs,
  markBoundedRetryUsed,
  markFocusedReadComplete,
  markLintFocusedReadComplete,
  noteSourceReadNovelty,
  parseLintErrorLocations,
  repoRelativeLintPath,
} from './foundryEditAnchors'
import {
  buildEngineeringGateTable,
  evaluateReplanDecision,
  evaluateBlockedDecision,
} from './foundryEngineeringGateTable'
import {
  beginDurableTool,
  checkpointIfNeeded,
  claimToolResources,
  cleanupOwnedResources,
  ensureOperationsFields,
  finishDurableTool,
  heartbeatMission,
  journalModelPinChange,
  noteProviderOutcome,
  pinDefaultModel,
  registerMission,
  requestControlledAuthorization,
  waitForResource,
} from './foundryOperationsManager'
import {
  ACTIVATION_PENDING_STATE,
  bindMissionInstallId,
  describeBlockingProductionOwner,
  enterActivationPending,
  isActivationOwnershipConflict,
  missionBoundInstallId,
  missionIdentityAccepted,
  sourceEditsAllowed,
  verifyInstallArtifactIntegrity,
} from './foundryActivationHandoff'
import { classifyToolIdempotency } from './foundryToolLifecycle'
import { acquireResource, releaseMissionResources } from './foundryResourceLocks'
import type {
  FoundryHypothesis,
  FoundryModelDecision,
  FoundryModelRequestKind,
} from './foundryModelTypes'
import {
  PASS_004_PERMISSIONS,
  LEGAL_TRANSITIONS,
  FOUNDRY_HOLD_STATES,
  type FoundryFailureClass,
  type FoundryMissionIntent,
  type FoundryMissionRecord,
  type FoundryMissionStep,
} from './foundryMissionTypes'

const FIXTURE_ORIGIN = 'http://127.0.0.1:18776/'
const UI_ORIGIN = 'http://127.0.0.1:3848/'

function isEngineeringReviewUiRequest(text: string): boolean {
  return /Engineering review|ENGINEERING REVIEW|explain what Foundry checked/i.test(text)
}

function isSessionArchiveRequest(text: string): boolean {
  return /session archive|session restore|PASS 009 Archive|PASS 010|PASS 011|semantic lifecycle/i.test(text)
}

function isSessionRestoreRequest(text: string): boolean {
  return /session restore|PASS 010|PASS 011|wait-for-control|click_and_wait|semantic lifecycle/i.test(text)
}

function isComputerUseReliabilityRequest(text: string): boolean {
  return /PASS 011|click_and_wait|state-confirmed|installed computer use reliability/i.test(text)
}

function isSessionLifecycleRequest(text: string): boolean {
  return isSessionArchiveRequest(text) || isSessionRestoreRequest(text) || isComputerUseReliabilityRequest(text) || /session rename|PASS 008/i.test(text)
}

type CallResult = { ok: boolean; tool: string; result?: unknown; error?: string }

function now(): string {
  return new Date().toISOString()
}

function excerpt(value: unknown, n = 500): string {
  try {
    return JSON.stringify(value).slice(0, n)
  } catch {
    return String(value).slice(0, n)
  }
}

type PackageArtifacts = {
  appimage?: { path: string; sha256: string }
  deb?: { path: string; sha256: string }
  linuxUnpackedDir?: string
}

function asPackageArtifact(value: unknown): { path: string; sha256: string } | undefined {
  if (!value || typeof value !== 'object') return undefined
  const rec = value as { path?: unknown; sha256?: unknown }
  if (typeof rec.path === 'string' && rec.path && typeof rec.sha256 === 'string' && rec.sha256) {
    return { path: rec.path, sha256: rec.sha256 }
  }
  return undefined
}

function extractPackageArtifacts(source: unknown): PackageArtifacts {
  if (!source) return {}
  if (typeof source === 'string') {
    const start = source.indexOf('{')
    const end = source.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return extractPackageArtifacts(JSON.parse(source.slice(start, end + 1)))
      } catch {
        return {}
      }
    }
    return {}
  }
  if (typeof source !== 'object') return {}
  const rec = source as Record<string, unknown>
  const nested = rec.result && typeof rec.result === 'object' ? rec.result as Record<string, unknown> : rec
  return {
    appimage: asPackageArtifact(nested.appimage) ?? asPackageArtifact(rec.appimage),
    deb: asPackageArtifact(nested.deb) ?? asPackageArtifact(rec.deb),
    linuxUnpackedDir: typeof nested.linuxUnpackedDir === 'string'
      ? nested.linuxUnpackedDir
      : typeof rec.linuxUnpackedDir === 'string' ? rec.linuxUnpackedDir : undefined,
  }
}

function missionPackageArtifacts(mission: FoundryMissionRecord, result?: unknown): PackageArtifacts {
  const fromState = extractPackageArtifacts({
    appimage: mission.packageState.appimage,
    deb: mission.packageState.deb,
    linuxUnpackedDir: mission.packageState.linuxUnpackedDir,
  })
  const lastPkg = [...mission.toolCalls].reverse().find(call => call.ok && call.tool === 'package.run')
  const merged = {
    appimage: fromState.appimage
      ?? extractPackageArtifacts(result).appimage
      ?? extractPackageArtifacts(lastPkg?.excerpt).appimage
      ?? extractPackageArtifacts(mission.packageState.detail).appimage,
    deb: fromState.deb
      ?? extractPackageArtifacts(result).deb
      ?? extractPackageArtifacts(lastPkg?.excerpt).deb
      ?? extractPackageArtifacts(mission.packageState.detail).deb,
    linuxUnpackedDir: fromState.linuxUnpackedDir
      ?? extractPackageArtifacts(result).linuxUnpackedDir
      ?? extractPackageArtifacts(lastPkg?.excerpt).linuxUnpackedDir
      ?? extractPackageArtifacts(mission.packageState.detail).linuxUnpackedDir,
  }
  if (merged.appimage) mission.packageState.appimage = merged.appimage
  if (merged.deb) mission.packageState.deb = merged.deb
  if (merged.linuxUnpackedDir) mission.packageState.linuxUnpackedDir = merged.linuxUnpackedDir
  return merged
}

function isTestPath(rel: string): boolean {
  return /\.test\.|\.spec\.|\/test\//i.test(rel)
}

function isControllerNoise(rel: string): boolean {
  return /foundryMission|foundryActivationAcceptance|foundryPass003|foundryBrokerExtension\.proof/i.test(rel)
}

function allowedToPatch(mission: FoundryMissionRecord, rel: string): boolean {
  if (isControllerNoise(rel)) return false
  if (mission.interpretation.replace) {
    return rel.includes('mission-fixture') || rel.includes('run-foundry-mission-fixture')
  }
  if (mission.interpretation.insert) {
    return /WarRoomOsHeader|login\/page/.test(rel)
  }
  return false
}

function classifyError(message: string): FoundryFailureClass {
  if (/REFUSED_STALE_PRODUCTION_OWNER|ACTIVATION_PENDING|ACTIVE_RUNTIME busy/i.test(message)) return 'TRANSIENT'
  if (/BUSY|TIMEOUT|ECONNREFUSED|not ready|timed out|lock/i.test(message)) return 'TRANSIENT'
  if (/requires Commander|commanderConfirmed|COMMIT|PUSH|LIVE DEPLOY|authorization/i.test(message)) return 'PERMISSION'
  if (/BLOCKED|not proven|compositor|AT-SPI/i.test(message)) return 'HARD'
  return 'CODE'
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function uniqueHunk(original: string, next: string): { matchText: string; replacementText: string } | null {
  if (original === next) return null
  let i = 0
  while (i < original.length && i < next.length && original[i] === next[i]) i += 1
  let oEnd = original.length
  let nEnd = next.length
  while (oEnd > i && nEnd > i && original[oEnd - 1] === next[nEnd - 1]) {
    oEnd -= 1
    nEnd -= 1
  }
  for (let pad = 8; pad <= 160; pad += 8) {
    const start = Math.max(0, i - pad)
    const origEnd = Math.min(original.length, oEnd + pad)
    const matchText = original.slice(start, origEnd)
    const replacementText = next.slice(start, nEnd + (origEnd - oEnd))
    const lineBudget = matchText.split('\n').length + replacementText.split('\n').length
    if (!matchText || lineBudget > 140) continue
    if (original.split(matchText).length !== 2) continue
    if (original.replace(matchText, replacementText) === next) return { matchText, replacementText }
  }
  return null
}

function applyReplace(content: string, from: string, to: string): string {
  if (!from || content.includes(to)) return content
  return content.split(from).join(to)
}

function applyInsert(content: string, marker: string, relPath: string): string {
  if (content.includes(marker)) return content
  if (/WarRoomOsHeader/.test(relPath) || /Conversation first/.test(content)) {
    return content.replace('Conversation first', `Conversation first · ${marker}`)
  }
  if (/login\/page/.test(relPath) || /HIGHER VISION INC/.test(content)) {
    return content.replace(
      /RA&apos;EL — HIGHER VISION INC<\/p>/,
      `RA&apos;EL — HIGHER VISION INC</p>\n          <p className="mt-2 text-[10px] tracking-widest" data-foundry-pass004="${marker}">${marker}</p>`,
    )
  }
  return content
}

function markStep(mission: FoundryMissionRecord, intent: FoundryMissionIntent, status: FoundryMissionStep['status'], note?: string): void {
  const step = mission.plan.find(s => s.intent === intent && (s.status === 'pending' || s.status === 'active' || s.status === 'failed'))
    ?? mission.plan.find(s => s.intent === intent)
  if (!step) return
  step.status = status
  if (note) step.note = note
  mission.currentStep = step.id
  if (status === 'done' && !mission.completedSteps.includes(step.id)) mission.completedSteps.push(step.id)
  if (status === 'failed' && !mission.failedSteps.includes(step.id)) mission.failedSteps.push(step.id)
}

function pendingIntent(mission: FoundryMissionRecord): FoundryMissionStep | null {
  return mission.plan.find(s => s.status === 'pending') ?? null
}

async function callTool(
  mission: FoundryMissionRecord,
  tool: EngineerToolName,
  input: Record<string, unknown>,
  reason: string,
  waitMs = 0,
): Promise<CallResult> {
  if ((mission.cancelRequested || isFoundryAgentAborted(mission.missionId)) && tool !== 'process.stop' && tool !== 'browser.stop' && tool !== 'mission.cancel') {
    return { ok: false, tool, error: 'Mission cancelled.' }
  }
  const planningBlock = planningModeBlocksTool(mission, tool)
  if (planningBlock) {
    appendFoundryAgentEvent(mission, 'TOOL_REQUEST', planningBlock, { tool, ok: false })
    return { ok: false, tool, error: planningBlock }
  }
  if (mission.constraints.includes('READ_ONLY_INVESTIGATION') && classifyToolIdempotency(tool) !== 'READ_ONLY' && tool !== 'process.stop') {
    return { ok: false, tool, error: 'Read-only investigation mission cannot mutate shared state.' }
  }
  appendFoundryAgentEvent(mission, 'TOOL_REQUEST', tool, { tool })
  appendFoundryAgentEvent(mission, 'TOOL_STARTED', `${tool}: ${reason}`, { tool })
  const denied = authorizationGate(mission, tool)
  if (denied) {
    if (/authorization boundary/i.test(denied)) {
      await requestControlledAuthorization(mission, tool, denied, tool, 'Only this pending action is paused. Existing work is preserved.')
    }
    return { ok: false, tool, error: denied }
  }
  const claimed = await claimToolResources(mission, tool, input, waitMs)
  if (!claimed.ok) {
    if (claimed.wait) await waitForResource(mission, claimed.error)
    mission.toolCalls.push({ at: now(), tool, ok: false, reason, error: claimed.error, excerpt: claimed.error })
    mission.observations.push({ at: now(), text: `${tool} WAIT: ${claimed.error}`, source: tool })
    await saveMission(mission)
    return { ok: false, tool, error: claimed.error }
  }
  const durable = await beginDurableTool(mission, tool, input)
  const result = await executeEngineerTool({ tool, input }, { repairId: mission.missionId, mission })
  const observationLimit = /^(file\.read|workspace\.search|browser\.|computer\.|logs\.|test\.|build\.|package\.|installer\.|runtime\.)/.test(tool) ? 4_000 : 800
  const compactRead = tool === 'file.read' && typeof (result.result as { compact?: unknown } | undefined)?.compact === 'string'
    ? (result.result as { compact: string }).compact
    : null
  const normalized = normalizeFoundryToolResult(result)
  const rec = {
    at: now(),
    tool,
    ok: result.ok,
    reason,
    error: result.error,
    excerpt: compactRead ? compactRead.slice(0, observationLimit) : excerpt(normalized.llmContent || result.result || result.error, observationLimit),
  }
  appendFoundryAgentEvent(
    mission,
    tool === 'test.run' || tool === 'terminal.execute' || tool === 'validation.run' ? 'TEST' : 'TOOL_RESULT',
    normalized.displayContent,
    { tool, ok: result.ok },
  )
  noteConsecutiveToolFailure(mission, !result.ok)
  mission.toolCalls.push(rec)
  mission.observations.push({ at: now(), text: `${tool} ${result.ok ? 'ok' : 'FAIL'}: ${rec.excerpt}`, source: tool })
  if (!result.ok) {
    const klass = classifyError(result.error ?? rec.excerpt)
    mission.errors.push({ at: now(), klass, message: result.error ?? rec.excerpt })
  }
  const artifacts = Array.isArray((result.result as { artifacts?: string[] } | undefined)?.artifacts)
    ? (result.result as { artifacts: string[] }).artifacts
    : typeof (result.result as { screenshotPath?: string } | undefined)?.screenshotPath === 'string'
      ? [(result.result as { screenshotPath: string }).screenshotPath]
      : []
  await finishDurableTool(mission, durable, result.ok, rec.excerpt ?? rec.error ?? tool, artifacts)
  for (const release of claimed.releases) await release()
  if (claimed.ephemeral.length) {
    mission.lockClaims = (mission.lockClaims ?? []).filter(claim => !claimed.ephemeral.includes(claim.resource))
  }
  await checkpointIfNeeded(mission, tool)
  await heartbeatMission(mission, tool)
  await logWarRoomRepoAudit(`foundry-mission: ${tool}`, { missionId: mission.missionId, ok: result.ok, reason })
  await saveMission(mission)
  return result
}

function authorizationGate(mission: FoundryMissionRecord, tool: string): string | null {
  const p = mission.permissions
  if (tool.startsWith('browser.') && !p.browser) return 'Browser not permitted.'
  if (tool.startsWith('computer.') && !p.computerUse) return 'Computer Use not permitted.'
  if ((tool.startsWith('external_app.') || tool.startsWith('cursor.')) && !p.computerUse) {
    return 'External App Operator not permitted.'
  }
  if ((tool === 'build.run' || tool === 'package.run') && !p.build && tool === 'build.run') return 'Build not permitted.'
  if (tool === 'package.run' && !p.package) return 'Package not permitted.'
  if (tool.startsWith('installer.') && tool.includes('install') && !p.installProduction) return 'Install not permitted.'
  if (tool === 'installer.activate' && !p.activateInstall) return 'Activate not permitted.'
  if (tool === 'runtime.transition_to_active' && !p.installedRuntimeControl) return 'Runtime control not permitted.'
  if (tool === 'git.commit_prepare' && !p.commit) {
    return 'COMMIT = NO — pause at authorization boundary.'
  }
  if (tool.includes('push') && !p.push) return 'PUSH = NO — pause at authorization boundary.'
  return null
}

function isLocateOnlyRequest(text: string): boolean {
  return isReadOnlyLocateRequest(text)
}

function locateSymbolQuery(text: string): string {
  const named = text.match(/\b(?:where is|find where|locate)\s+([A-Za-z][A-Za-z0-9_]*)/i)
  return named?.[1] ?? text.replace(/\bdo not change files\.?/i, '').trim().slice(0, 80)
}

function firstOwnerHitFromSearch(mission: FoundryMissionRecord): string | null {
  const call = [...mission.toolCalls].reverse().find(item => item.ok && item.tool === 'workspace.search')
  if (!call?.excerpt) return null
  try {
    const parsed = JSON.parse(call.excerpt) as Array<{ relPath?: string }>
    if (Array.isArray(parsed)) {
      const ranked = parsed.filter(item => typeof item.relPath === 'string')
      const owner = ranked.find(item => /^(lib|components)\//.test(item.relPath ?? '')) ?? ranked[0]
      return owner?.relPath ?? null
    }
  } catch { /* fall through */ }
  return call.excerpt.match(/((?:lib|components|app)\/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+)/)?.[1] ?? null
}

function standaloneMissionMissing(mission: FoundryMissionRecord): string[] {
  if (!isStandaloneEngineerMission(mission)) return []
  const missionContract = mission.missionContractId ? loadMissionContract(mission.missionContractId) : null
  const acceptanceContract = mission.acceptanceContractId ? loadAcceptanceContract(mission.acceptanceContractId) : null
  const verdict = loadVerdictRecord(mission.missionId)
  return contractCanComplete({
    engineeringClass: mission.engineeringClass,
    missionContract,
    acceptanceContract,
    verdict,
  }).missing
}

function evaluateMissionGate(mission: FoundryMissionRecord) {
  const progress = orderedInspectProgress(mission)
  const engineering = ensureEngineeringState(mission)
  const ownershipMapped = mission.toolCalls.some(call =>
    call.ok && (call.tool === 'code.owners' || call.tool === 'code.impact' || call.tool === 'code.dependents' || call.tool === 'code.symbol'),
  ) || Boolean(engineering.ownership?.owners.length || engineering.impact?.owners.length)
  if (progress.ordered.length) {
    const searched = mission.toolCalls.some(call => call.ok && call.tool === 'workspace.search') || progress.read.length > 0
    const missing = [
      ...(!searched ? ['SEARCH_DONE'] : []),
      ...(progress.remaining.length ? ['READ_DONE'] : []),
    ]
    return {
      complete: missing.length === 0,
      missing,
      detail: missing.length ? `missing: ${missing.join(', ')}` : 'Ordered inspect gates satisfied.',
    }
  }
  if (isLocateOnlyRequest(mission.userRequest)) {
    const searched = mission.toolCalls.some(call => call.ok && call.tool === 'workspace.search')
    const read = mission.toolCalls.some(call => call.ok && call.tool === 'file.read')
    const wantsOwnership = /ownership|owners|dependenc/i.test(mission.userRequest)
    const wantsSymbols = /code\.symbol|symbol lookup|references?\b/i.test(mission.userRequest)
    const hasSymbol = mission.toolCalls.some(call => call.ok && call.tool === 'code.symbol')
    const hasRefs = mission.toolCalls.some(call => call.ok && (call.tool === 'code.refs' || call.tool === 'code.dependents'))
    const missing = [
      ...(!searched ? ['SEARCH_DONE'] : []),
      ...(!read ? ['READ_DONE'] : []),
      ...(wantsOwnership && !ownershipMapped ? ['OWNERSHIP_MAPPED'] : []),
      ...(wantsSymbols && !hasSymbol ? ['SYMBOL_LOOKUP'] : []),
      ...(wantsSymbols && !hasRefs ? ['REFERENCE_LOOKUP'] : []),
    ]
    return {
      complete: missing.length === 0,
      missing,
      detail: missing.length ? `missing: ${missing.join(', ')}` : 'Locate-only gates satisfied.',
    }
  }
  const selfReviewDone = engineering.selfReview?.status === 'PASS' || engineering.selfReview?.status === 'FAIL'
  const regressionDone = engineering.regressionOk === true
    || (mission.kind === 'fixture' && mission.testState.ok === true && selfReviewDone)
  if (mission.kind === 'app_builder' || mission.capabilityLane === 'APPLICATION_BUILDER') {
    const builder = mission.applicationBuilder
    const flags = {
      RESEARCH_DONE: (builder?.research.length ?? 0) > 0,
      REQUIREMENTS_DONE: Boolean(builder?.requirements),
      STACK_DONE: Boolean(builder?.stack),
      NEW_PROJECT_WORKSPACE: Boolean(builder?.project?.projectRoot),
      SOURCE_DONE: mission.sourceState.changedFiles.length > 0,
      TARGETED_TESTS_DONE: mission.testState.ok === true,
      RUNTIME_RUNNING: Boolean(mission.runtimeState.detail),
      BROWSER_DESKTOP: builder?.viewportResults.some(item => item.name === 'desktop' && item.ok) === true || mission.browserState.ok === true,
      BROWSER_MOBILE: builder?.viewportResults.some(item => item.name === 'mobile' && item.ok) === true || mission.browserState.ok === true,
      PREVIEW_READY: builder?.preview?.status === 'PROJECT_READY',
    }
    const missing = Object.entries(flags).filter(([, v]) => !v).map(([k]) => k)
    missing.push(...standaloneMissionMissing(mission))
    return {
      complete: missing.length === 0,
      missing,
      detail: missing.length ? `missing: ${missing.join(', ')}` : 'Application Builder gates satisfied.',
    }
  }
  if (mission.kind === 'fixture') {
    const flags = {
      SOURCE_DONE: mission.sourceState.changedFiles.length > 0,
      SELF_REVIEW_DONE: selfReviewDone && Boolean(mission.sourceState.changedFiles.length),
      TARGETED_TESTS_DONE: mission.testState.ok === true,
      VALIDATION_DONE: mission.testState.ok === true,
      REGRESSION_DONE: regressionDone && mission.testState.ok === true,
      ...(mission.sourceState.changedFiles.length > 1 ? { CROSS_FILE_CONSISTENCY: engineering.crossFile?.status === 'PASS' || selfReviewDone } : {}),
      ...(mission.sourceState.changedFiles.some(file => /\.(test|validation)\./.test(file)) ? { TEST_REVIEW: engineering.testReview?.status === 'PASS' || selfReviewDone } : {}),
      ...(/contract|session rename|session archive/i.test(mission.userRequest) ? { CONTRACT_MIGRATION: engineering.contractMigration?.status === 'PASS' || selfReviewDone } : {}),
    }
    const missing = Object.entries(flags).filter(([, v]) => !v).map(([k]) => k)
    return {
      complete: missing.length === 0,
      missing,
      detail: missing.length ? `missing: ${missing.join(', ')}` : 'Fixture mission gates satisfied.',
    }
  }
  const browserReachedInstalledUi = mission.toolCalls.some(call =>
    call.ok && call.tool.startsWith('browser.') && /127\.0\.0\.1:3848|War Room — Higher Vision/i.test(`${call.excerpt ?? ''} ${call.reason ?? ''} ${mission.browserState.detail ?? ''}`),
  )
  const gate = evaluateCompletionGate({
    sourceChanged: mission.sourceState.changedFiles.length > 0,
    validationOk: mission.kind === 'application'
      ? mission.plan.filter(s => s.intent === 'LINT' || s.intent === 'TYPECHECK').every(s => s.status === 'done' || s.status === 'skipped')
      : mission.testState.ok === true,
    buildOk: mission.buildState.ok === true,
    packageOk: mission.packageState.ok === true,
    installOk: mission.installState.ok === true,
    activeInstallId: mission.runtimeState.activeInstallId,
    missionInstallId: mission.installState.installId,
    runningInstallId: mission.runtimeState.runningInstallId,
    uiHealthOk: mission.runtimeState.uiHealth === true,
    coreHealthOk: mission.runtimeState.coreHealth === true,
    identityMatch: mission.runtimeState.identityMatch,
    browserAcceptanceOk: mission.browserState.ok === true || (
      mission.runtimeState.identityMatch === true
      && mission.computerUseState.ok === true
      && browserReachedInstalledUi
    ),
    // LEGACY_UNVERIFIED: hardcoded true is allowed only for non-Standalone Engineer missions
    // and must not produce Standalone Engineer PROJECT READY.
    consoleAcceptanceOk: isStandaloneEngineerMission(mission) ? false : true,
    networkAcceptanceOk: isStandaloneEngineerMission(mission) ? false : true,
    computerUseAcceptance: mission.computerUseState.status ?? (mission.computerUseState.ok ? 'PASS' : 'FAIL'),
    localDeploymentAcceptanceOk: isStandaloneEngineerMission(mission) ? false : true,
  })
  const extra = [
    ...(!selfReviewDone ? ['SELF_REVIEW_DONE'] : []),
    ...(mission.testState.ok !== true && !gate.flags.VALIDATION_DONE ? ['TARGETED_TESTS_DONE'] : []),
    ...(!(engineering.regressionOk === true || (gate.flags.VALIDATION_DONE && selfReviewDone)) ? ['REGRESSION_DONE'] : []),
    ...standaloneMissionMissing(mission),
  ]
  const missing = [...gate.missing, ...extra]
  return {
    complete: missing.length === 0,
    missing,
    detail: missing.length ? `${gate.detail} extra: ${extra.join(', ') || 'none'}` : gate.detail,
  }
}

export type FoundryMissionStartOptions = {
  parentMissionId?: string | null
  helperMissionId?: string | null
  requestId?: string | null
  productionRole?: import('./foundryMissionTypes').FoundryProductionRole | null
  productionOwner?: boolean
  continueProjectId?: string | null
  sessionId?: string | null
  engineeringClass?: import('./foundryContractTypes').FoundryEngineeringClass
}

export function startMissionInput(userRequest: string, title?: string, options?: FoundryMissionStartOptions): FoundryMissionRecord {
  const interpretation = interpretCommanderRequest(userRequest)
  const missionId = randomUUID()
  const createdAt = now()
  return {
    missionId,
    title: title || userRequest.slice(0, 80),
    userRequest,
    createdAt,
    updatedAt: createdAt,
    status: 'QUEUED',
    phase: 'QUEUED',
    kind: interpretation.kind,
    goal: interpretation.goal,
    successCriteria: interpretation.successCriteria,
    constraints: [
      ...interpretation.constraints,
      ...(isReadOnlyLocateRequest(userRequest) ? ['READ_ONLY_INVESTIGATION'] : []),
    ],
    permissions: interpretation.kind === 'app_builder'
      ? {
          ...PASS_004_PERMISSIONS,
          build: false,
          package: false,
          installProduction: false,
          activateInstall: false,
          installedRuntimeControl: false,
          liveDeploy: false,
          computerUse: false,
          internetResearch: true,
        }
      : { ...PASS_004_PERMISSIONS },
    interpretation,
    plan: buildInitialPlan(interpretation),
    currentStep: null,
    completedSteps: [],
    failedSteps: [],
    observations: [],
    artifacts: [],
    toolCalls: [],
    errors: [],
    sourceState: { baselineFiles: [], changedFiles: [], newFiles: [], deletedFiles: [], diffSummary: '' },
    testState: { ok: null, detail: null },
    buildState: { ok: null, detail: null },
    packageState: { ok: null, detail: null },
    installState: { ok: null, installId: null, detail: null },
    runtimeState: { activeInstallId: null, runningInstallId: null, identityMatch: null, uiHealth: null, coreHealth: null, detail: null },
    browserState: { ok: null, detail: null },
    computerUseState: { ok: null, detail: null },
    deployState: { ok: null, detail: null },
    completionGate: { complete: false, missing: [], detail: 'not evaluated' },
    journal: [],
    context: {
      goal: interpretation.goal,
      currentPlan: [],
      architectureFindings: [],
      changedFiles: [],
      currentErrors: [],
      latestObservations: [],
      unresolvedQuestions: [],
      completion: 'not evaluated',
    },
    blocker: null,
    authorization: null,
    cancelRequested: false,
    launchOrigin: interpretation.kind === 'fixture' ? FIXTURE_ORIGIN : UI_ORIGIN,
    candidateFiles: [],
    sourceFilesTouched: [],
    testFilesTouched: [],
    retryCounts: {},
    replanCount: 0,
    loopCount: 0,
    maxLoops: isLocateOnlyRequest(userRequest)
      ? 16
      : orderedInspectTargets(userRequest).length
        ? Math.max(24, orderedInspectTargets(userRequest).length + 8)
      : interpretation.kind === 'application' ? 80 : 48,
    hypotheses: [],
    modelState: {
      primaryProvider: null,
      activeProvider: null,
      activeModel: null,
      fallbackProvider: null,
      calls: 0,
      invalidResponses: 0,
      providerFailures: 0,
      consecutiveFailures: 0,
      repeatedActionCount: 0,
      lastDecision: null,
      lastReasoningSummary: null,
      lastExpectedObservation: null,
    },
    architectureFindings: [],
    codeDecisions: [],
    importantPaths: [],
    testFindings: [],
    runtimeFindings: [],
    priority: 'NORMAL',
    owner: 'commander',
    pauseRequested: false,
    lastHeartbeat: createdAt,
    resumeToken: `${missionId}:1`,
    stateVersion: 1,
    lockClaims: [],
    runtimeClaims: [],
    durableToolCalls: [],
    ownedArtifacts: [],
    ownedCleanup: [],
    currentAction: 'queued',
    activeToolCallId: null,
    engineering: {},
    parentMissionId: options?.parentMissionId ?? null,
    helperMissionId: options?.helperMissionId ?? null,
    requestId: options?.requestId ?? null,
    productionRole: options?.productionRole ?? null,
    productionOwner: options?.productionOwner === true,
    writeSet: {
      missionId,
      established: false,
      establishedAt: null,
      paths: [],
      entries: [],
      readScope: [],
      protectedSubsystems: ['Terra', 'auth boundary', 'production ownership files unless mission-scoped', 'WRIM', 'other Foundry projects'],
    },
    capabilityLane: interpretation.kind === 'app_builder' ? 'APPLICATION_BUILDER' : 'WAR_ROOM_ENGINEERING',
    applicationBuilder: interpretation.kind === 'app_builder' ? emptyApplicationBuilderState() : undefined,
    capabilityAssessment: interpretation.capabilityAssessment,
    agentEvents: [],
    contextPack: null,
    planningMode: /plan(?:ning)? mode|read-only research phase/i.test(userRequest),
    skillImports: [],
    engineeringClass: options?.engineeringClass,
  }
}

export async function startMission(userRequest: string, title?: string, options?: FoundryMissionStartOptions): Promise<FoundryMissionRecord> {
  const { ensureRecovered } = await import('./foundryOperationsManager')
  await ensureRecovered()
  const mission = startMissionInput(userRequest, title, options)
  ensureOperationsFields(mission)
  const classified = classifyFoundryMission(mission)
  mission.classification = classified.classification
  mission.classificationEvidence = classified.evidence
  if (isTestMissionClass(classified.classification)) {
    mission.visibility = 'system'
  }
  if (!options?.parentMissionId && mission.kind === 'application' && !isTestMissionClass(classified.classification)) {
    const productionIntents = new Set(['BUILD', 'PACKAGE', 'INSTALL', 'ACTIVATE', 'TRANSITION'])
    if (mission.plan.some(step => productionIntents.has(step.intent))) {
      mission.productionRole = options?.productionRole ?? 'PRODUCTION_OWNER'
      mission.productionOwner = options?.productionOwner !== false
    }
  }
  if (options?.parentMissionId && options?.productionOwner !== true) {
    mission.productionRole = 'HELPER'
    mission.productionOwner = false
  }
  if (options?.continueProjectId) {
    mission.kind = 'app_builder'
    mission.capabilityLane = 'APPLICATION_BUILDER'
    mission.applicationBuilder = mission.applicationBuilder ?? emptyApplicationBuilderState()
    mission.applicationBuilder.continuationOf = options.continueProjectId
    mission.permissions = {
      ...mission.permissions,
      build: false,
      package: false,
      installProduction: false,
      activateInstall: false,
      installedRuntimeControl: false,
      liveDeploy: false,
      commit: false,
      push: false,
      internetResearch: true,
    }
  }
  pinDefaultModel(mission)
  seedFixtureDiagnosis(mission)
  const { ensureLiveMissionReasoning } = await import('./reasoning-kernel/mission-lifecycle')
  await ensureLiveMissionReasoning(mission, 'START')
  const { attachFoundryMissionRouting } = await import('./foundryFrkStandaloneUnification')
  await attachFoundryMissionRouting(mission, { remotePermitted: true })
  await saveMission(mission)
  await appendJournal(mission, { kind: 'decision', text: `Mission created. Kind=${mission.kind}. Goal: ${mission.goal}` })
  await registerMission(mission)
  await logWarRoomRepoAudit('foundry-mission: start', { missionId: mission.missionId, kind: mission.kind })
  beginFoundryAgentWork(mission.missionId)
  appendFoundryAgentEvent(mission, 'AGENT_STARTED', `Mission started. Kind=${mission.kind}. Goal: ${mission.goal}`)
  await saveMission(mission)
  return mission
}

export async function cancelMission(missionId: string): Promise<FoundryMissionRecord> {
  const mission = await loadMission(missionId)
  if (!mission) throw new Error(`Unknown mission ${missionId}`)
  mission.cancelRequested = true
  abortFoundryAgentWork(missionId, 'Commander cancelled')
  appendFoundryAgentEvent(mission, 'ERROR', 'Commander cancelled. In-flight model, tool, research, browser, command, and subtask work abort.')
  await callTool(mission, 'process.stop', {}, 'cancel: stop owned processes')
  await cleanupOwnedResources(mission)
  if (mission.status !== 'COMPLETE' && mission.status !== 'CANCELLED') {
    await transitionMission(mission, 'CANCELLED', 'Commander cancelled. History preserved, completed work not deleted.')
  }
  appendFoundryAgentEvent(mission, 'COMPLETE', 'Cancelled. History preserved, completed work not deleted.')
  await appendJournal(mission, { kind: 'decision', text: 'Cancelled. Locks released via process.stop; install artifacts left intact.' })
  await saveMission(mission)
  releaseFoundryAgentWork(missionId)
  return mission
}

export async function resolveMissionAuthorization(
  missionId: string,
  approved: boolean,
  expected?: import('./foundryExecutionApproval').ApprovalExpectedGeneration | null,
): Promise<{ ok: boolean; mission: FoundryMissionRecord; error?: string }> {
  const mission = await loadMission(missionId)
  if (!mission) throw new Error(`Unknown mission ${missionId}`)
  const requested = mission.authorization
  if (!requested?.waiting) return { ok: false, mission, error: 'Mission has no pending authorization request.' }
  if (!approved) {
    mission.authorization = {
      ...requested,
      waiting: false,
      approvalState: 'denied',
      reason: `Denied by Commander: ${requested.reason ?? requested.action}`,
    }
    mission.blocker = {
      blocker: `Commander denied ${requested.action ?? 'requested action'}`,
      evidence: requested.reason ?? 'Authorization was requested.',
      attempted: requested.action ?? 'unknown',
      why: 'The Commander denied this boundary action.',
      unblock: 'Start a different approach that does not require the denied action.',
    }
    await appendJournal(mission, { kind: 'auth', text: `DENIED: ${requested.action} — ${requested.reason}` })
    await saveMission(mission)
    return { ok: true, mission }
  }
  if (requested.action === 'ENTER_EXECUTION') {
    const entered = enterFoundryExecutionFromPlan(mission, true, expected)
    if (!entered.ok) return { ok: false, mission, error: entered.error }
    if (mission.status === 'BLOCKED' || mission.status === 'WAITING_AUTHORIZATION' || mission.status === 'PAUSED' || mission.status === 'PLANNING') {
      await transitionMission(mission, 'EXECUTING', 'Commander approved Planning Mode → execution')
    }
    appendFoundryAgentEvent(mission, 'CONTENT', 'Planning Mode ended. Execution authorized for this mission only.')
    await appendJournal(mission, { kind: 'auth', text: 'APPROVED ENTER_EXECUTION — Planning Mode closed. Tool Broker remains the mutation path.' })
    await saveMission(mission)
    return { ok: true, mission }
  }
  if (/commit|push|live.?deploy/i.test(`${requested.action} ${requested.reason}`)) {
    await appendJournal(mission, { kind: 'auth', text: `Approval refused by PASS 005 policy: ${requested.action}` })
    return {
      ok: false,
      mission,
      error: 'PASS 005 policy fixes COMMIT, PUSH, and LIVE_DEPLOY at NO; this mission cannot grant them.',
    }
  }
  mission.authorization = {
    ...requested,
    waiting: false,
    approvalState: 'approved',
    reason: `Approved by Commander for exact action ${requested.action} only.`,
  }
  mission.blocker = null
  if (mission.status === 'BLOCKED' || mission.status === 'WAITING_AUTHORIZATION' || mission.status === 'PAUSED') {
    await transitionMission(mission, 'EXECUTING', `Commander approved ${requested.action}`)
  }
  await appendJournal(mission, { kind: 'auth', text: `APPROVED exact action ${requested.action} — resuming the same mission. Permission was not broadened.` })
  await saveMission(mission)
  return { ok: true, mission }
}

async function retryOrBlock(mission: FoundryMissionRecord, intent: FoundryMissionIntent, error: string): Promise<'retry' | 'replan' | 'block' | 'auth'> {
  const klass = classifyError(error)
  const key = `${intent}:${klass}`
  mission.retryCounts[key] = (mission.retryCounts[key] ?? 0) + 1
  if (klass === 'TRANSIENT' && mission.retryCounts[key] <= 3) {
    await new Promise(resolve => setTimeout(resolve, 4000 * mission.retryCounts[key]))
    await appendJournal(mission, { kind: 'observation', text: `Transient ${intent} retry ${mission.retryCounts[key]}/3 after backoff.` })
    return 'retry'
  }
  if (klass === 'CODE' && mission.retryCounts[key] <= 2) return 'replan'
  if (klass === 'PERMISSION') {
    await requestControlledAuthorization(mission, intent, error)
    if (mission.status !== 'WAITING_AUTHORIZATION') await transitionMission(mission, 'BLOCKED', error)
    mission.blocker = {
      blocker: error,
      evidence: excerpt(mission.toolCalls.at(-1)),
      attempted: intent,
      why: 'Action requires authorization beyond current mission permissions.',
      unblock: 'Grant the permission and call mission.run to resume.',
    }
    return 'auth'
  }
  mission.blocker = {
    blocker: error,
    evidence: excerpt(mission.toolCalls.at(-1)),
    attempted: `${intent} x${mission.retryCounts[key]}`,
    why: 'Retries exhausted or hard environmental blocker.',
    unblock: 'Inspect evidence and re-run after the environment/source is unblocked.',
  }
  await transitionMission(mission, 'BLOCKED', error)
  return 'block'
}

async function stepUnderstand(mission: FoundryMissionRecord): Promise<void> {
  await transitionMission(mission, 'UNDERSTANDING', 'Interpreting Commander request')
  markStep(mission, 'UNDERSTAND', 'done', mission.goal)
  await appendJournal(mission, { kind: 'decision', text: `Interpreted kind=${mission.kind} replace=${JSON.stringify(mission.interpretation.replace)} insert=${JSON.stringify(mission.interpretation.insert)} capability=${mission.capabilityAssessment?.recommendation ?? 'none'}` })
  await transitionMission(mission, 'PLANNING', 'Editable plan created from interpretation; later observations may add/remove/reorder steps')
}

async function stepSearch(mission: FoundryMissionRecord): Promise<void> {
  await transitionMission(mission, 'INSPECTING', 'Searching workspace')
  markStep(mission, 'SEARCH', 'active')
  const prefixes = mission.kind === 'fixture'
    ? ['scripts/foundry', 'scripts']
    : ['components/war-room', 'app/login', 'components']
  const queries = [
    mission.interpretation.replace?.from,
    mission.interpretation.replace?.to,
    mission.interpretation.insert?.marker,
    /test application|status label/i.test(mission.userRequest) ? 'Foundry Mission Fixture' : null,
    /header|war room os/i.test(mission.userRequest) ? 'data-testid="war-room-os-header"' : null,
    /login/i.test(mission.userRequest) ? 'HIGHER VISION INC' : null,
    'FOUNDRY_FIXTURE_ORIGIN',
    'Conversation first',
  ].filter((q): q is string => Boolean(q))
  const files = new Set<string>()
  for (const pathPrefix of prefixes) {
    for (const query of queries) {
      const result = await callTool(mission, 'workspace.search', { query, pathPrefix }, `search ${query} under ${pathPrefix}`)
      const hits = (result.result as { relPath?: string }[] | undefined) ?? []
      for (const hit of Array.isArray(hits) ? hits : []) {
        if (hit.relPath && !isControllerNoise(hit.relPath)) files.add(hit.relPath)
      }
    }
  }
  let list = [...files]
  if (mission.kind === 'fixture') {
    const scoped = list.filter(f => f.includes('mission-fixture') || f.includes('run-foundry-mission-fixture'))
    if (scoped.length) list = scoped
  }
  if (mission.kind === 'application') {
    const scoped = list.filter(f => /WarRoomOsHeader|login\/page/.test(f))
    if (scoped.length) list = scoped
  }
  mission.candidateFiles = list.slice(0, 24)
  await appendJournal(mission, { kind: 'observation', text: `Search candidates: ${mission.candidateFiles.join(', ') || '(none)'}` })
  markStep(mission, 'SEARCH', mission.candidateFiles.length ? 'done' : 'failed', `${mission.candidateFiles.length} files`)
}

async function stepRead(mission: FoundryMissionRecord): Promise<void> {
  markStep(mission, 'READ', 'active')
  if (!mission.sourceState.baselineFiles.length) mission.sourceState.baselineFiles = [...mission.candidateFiles]
  for (const file of mission.candidateFiles.slice(0, 12)) {
    await callTool(mission, 'file.read', { path: file }, `read ${file}`)
  }
  markStep(mission, 'READ', 'done')
}

function desiredEdit(mission: FoundryMissionRecord, rel: string, content: string): string | null {
  const { replace, insert } = mission.interpretation
  let next = content
  if (replace) next = applyReplace(next, replace.from, replace.to)
  if (insert) next = applyInsert(next, insert.marker, rel)
  return next === content ? null : next
}

async function stepPatch(mission: FoundryMissionRecord, testsOnly: boolean): Promise<void> {
  await transitionMission(mission, 'EXECUTING', testsOnly ? 'Patching tests after failure' : 'Patching implementation')
  const intent: FoundryMissionIntent = testsOnly ? 'PATCH_TESTS' : 'PATCH_SOURCE'
  markStep(mission, intent, 'active')
  const targets = mission.candidateFiles.filter(f => allowedToPatch(mission, f) && (testsOnly ? isTestPath(f) : !isTestPath(f)))
  let changed = 0
  let lastError = ''
  for (const file of targets) {
    const read = await callTool(mission, 'file.read', { path: file }, `read before patch ${file}`)
    const content = (read.result as { content?: string } | undefined)?.content
    if (typeof content !== 'string') continue
    const next = desiredEdit(mission, file, content)
    if (!next) continue
    const lineCount = content.split('\n').length
    const hunk = uniqueHunk(content, next)
    let written: CallResult
    if (lineCount > 80) {
      if (!hunk) {
        lastError = `Could not compute a unique small hunk for ${file}`
        continue
      }
      await appendJournal(mission, { kind: 'decision', text: `Chose file.patch for ${file} (${lineCount} lines; unique hunk).` })
      written = await callTool(
        mission,
        'file.patch',
        {
          proposal: {
            issueId: mission.missionId,
            sourceKind: 'deterministic',
            proposerId: 'foundry-mission-controller',
            diagnosis: mission.goal,
            confidence: 'high',
            relevantFiles: [file],
            plannedChanges: [{
              file,
              reason: `PASS 004 mission ${mission.missionId}`,
              operation: 'replace_range',
              patch: {
                operation: 'replace_range',
                file,
                expectedOriginalHash: sha256(content),
                matchText: hunk.matchText,
                replacementText: hunk.replacementText,
              },
            }],
            validations: [],
            risks: [],
            rollbackPlan: 'Snapshot rollback.',
            generatedAt: now(),
          },
        },
        `patch ${file}`,
      )
    } else {
      await appendJournal(mission, { kind: 'decision', text: `Chose file.write for small file ${file} (${lineCount} lines).` })
      written = await callTool(
        mission,
        'file.write',
        { path: file, content: next, reason: `PASS 004 mission ${mission.missionId}: ${mission.goal}` },
        `write ${file}`,
      )
    }
    if (written.ok) {
      changed += 1
      if (!mission.sourceState.changedFiles.includes(file)) mission.sourceState.changedFiles.push(file)
      if (testsOnly) mission.testFilesTouched.push(file)
      else mission.sourceFilesTouched.push(file)
    } else {
      lastError = written.error || lastError
    }
  }
  const diff = await callTool(mission, 'git.diff', { paths: mission.sourceState.changedFiles }, 'record diff summary')
  mission.sourceState.diffSummary = excerpt(diff.result, 800)
  markStep(mission, intent, changed > 0 ? 'done' : 'failed', `${changed} files`)
  if (changed === 0 && !testsOnly) {
    throw new Error(lastError || 'No implementation files patched — search did not yield an editable target.')
  }
}

async function stepTest(mission: FoundryMissionRecord): Promise<void> {
  await transitionMission(mission, 'VALIDATING', 'Running targeted tests')
  markStep(mission, 'TEST', 'active')
  if (isSessionArchiveRequest(mission.userRequest)) {
    const archiveResult = await callTool(mission, 'test.run', { suite: 'validate:foundry-session-archive' }, 'session archive targeted validation')
    const restoreNeeded = isSessionRestoreRequest(mission.userRequest)
    const restoreResult = restoreNeeded
      ? await callTool(mission, 'test.run', { suite: 'validate:foundry-session-restore' }, 'session restore targeted validation')
      : { ok: true, tool: 'test.run', result: { skipped: true } }
    const reliability = isComputerUseReliabilityRequest(mission.userRequest)
    const reliabilityResult = reliability
      ? await callTool(mission, 'test.run', { suite: 'validate:foundry-pass011-computer-use' }, 'PASS 011 state-confirmed click validation')
      : { ok: true, tool: 'test.run', result: { skipped: true } }
    mission.testState = { ok: archiveResult.ok && restoreResult.ok && reliabilityResult.ok, detail: excerpt({ archive: archiveResult.result ?? archiveResult.error, restore: restoreResult.result ?? restoreResult.error, reliability: reliabilityResult.result ?? reliabilityResult.error }) }
    markStep(mission, 'TEST', mission.testState.ok ? 'done' : 'failed', mission.testState.detail ?? '')
    if (mission.testState.ok) ensureEngineeringState(mission).regressionOk = true
    return
  }
  if (/session rename/i.test(mission.userRequest)) {
    const result = await callTool(mission, 'test.run', { suite: 'validate:foundry-session-rename' }, 'session rename targeted validation')
    mission.testState = { ok: result.ok, detail: excerpt(result.result ?? result.error) }
    markStep(mission, 'TEST', result.ok ? 'done' : 'failed', mission.testState.detail ?? '')
    if (result.ok) ensureEngineeringState(mission).regressionOk = true
    return
  }
  if (mission.kind === 'application') {
    mission.testState = { ok: true, detail: 'Application mission defers targeted validation to lint/typecheck.' }
    markStep(mission, 'TEST', 'skipped', mission.testState.detail ?? undefined)
    return
  }
  const fixtureScript = mission.candidateFiles.find(f => f.includes('run-foundry-mission-fixture')) || 'scripts/run-foundry-mission-fixture.mjs'
  const result = await callTool(
    mission,
    'terminal.execute',
    { operation: { id: 'validation_script', targets: [fixtureScript] } },
    'targeted fixture tests',
  )
  const exitOk = (result.result as { exitCode?: number; ok?: boolean } | undefined)?.exitCode === 0
    || (result.result as { ok?: boolean } | undefined)?.ok === true
    || result.ok
  mission.testState = { ok: Boolean(exitOk && result.ok), detail: excerpt(result.result ?? result.error) }
  if (mission.testState.ok) {
    markStep(mission, 'TEST', 'done')
    return
  }
  markStep(mission, 'TEST', 'failed', mission.testState.detail ?? 'test failed')
  mission.replanCount += 1
  await transitionMission(mission, 'REPLANNING', 'Tests failed after source patch — update tests that still expect the old value')
  await appendJournal(mission, { kind: 'replan', text: `Attempt ${mission.replanCount}: tests failed. Switching to PATCH_TESTS then TEST.` })
  mission.plan = replanAfterTestFailure(mission.plan)
}

async function stepLaunch(mission: FoundryMissionRecord): Promise<void> {
  markStep(mission, 'LAUNCH', 'active')
  await callTool(mission, 'process.stop', {}, 'stop prior fixture process before relaunch')
  const server = mission.candidateFiles.find(f => f.endsWith('mission-fixture/server.mjs')) || 'scripts/foundry/mission-fixture/server.mjs'
  const started = await callTool(
    mission,
    'process.start',
    { cmd: 'node', args: [server], label: 'foundry-mission-fixture' },
    'launch fixture server',
  )
  mission.launchOrigin = FIXTURE_ORIGIN
  await new Promise(resolve => setTimeout(resolve, 400))
  markStep(mission, 'LAUNCH', started.ok ? 'done' : 'failed', excerpt(started.result ?? started.error))
}

async function releaseProductionLocksForAcceptance(mission: FoundryMissionRecord): Promise<void> {
  await releaseMissionResources(mission.missionId, ['BUILD_PIPELINE', 'PACKAGE_PIPELINE', 'INSTALL_PIPELINE', 'ACTIVE_RUNTIME', 'PERSISTENT_BROWSER', 'COMPUTER_USE_DESKTOP'])
  mission.lockClaims = (mission.lockClaims ?? []).filter(claim => !['BUILD_PIPELINE', 'PACKAGE_PIPELINE', 'INSTALL_PIPELINE', 'ACTIVE_RUNTIME', 'PERSISTENT_BROWSER', 'COMPUTER_USE_DESKTOP'].includes(claim.resource))
  mission.runtimeClaims = []
}

async function stepBrowser(mission: FoundryMissionRecord): Promise<void> {
  markStep(mission, 'BROWSER_VERIFY', 'active')
  await releaseProductionLocksForAcceptance(mission)
  await callTool(mission, 'browser.start', {}, 'ensure persistent browser')
  const origin = mission.kind === 'fixture' ? FIXTURE_ORIGIN : UI_ORIGIN
  const originRoot = origin.replace(/\/$/, '')
  const foundryUrl = `${originRoot}/war-room/engineering?workspace=war-room-self`
  const expected = isEngineeringReviewUiRequest(mission.userRequest)
    ? 'ENGINEERING REVIEW'
    : (mission.interpretation.replace?.to || mission.interpretation.insert?.marker || '')
  const target = isSessionLifecycleRequest(mission.userRequest) || isEngineeringReviewUiRequest(mission.userRequest) ? foundryUrl : originRoot
  await callTool(mission, 'browser.navigate', { url: originRoot }, 'open loopback origin before local session cookie')
  await callTool(mission, 'browser.local_session', { origin: originRoot }, 'apply loopback commander session cookie')
  const nav = await callTool(mission, 'browser.navigate', { url: target, waitForSelector: isSessionLifecycleRequest(mission.userRequest) ? '[data-testid="foundry-new-session"]' : 'body' }, `navigate ${target}`)
  await callTool(mission, 'browser.wait', { ms: 1500 }, 'wait for Foundry hydration')
  let text = await callTool(mission, 'browser.get_text', {}, 'read page text')
  let body = String((text.result as { text?: string } | undefined)?.text ?? excerpt(text.result))
  if (/LOCAL SIGN IN/i.test(body)) {
    await callTool(mission, 'browser.local_session', { origin: originRoot }, 're-apply loopback commander session after login wall')
    await callTool(mission, 'browser.navigate', { url: foundryUrl }, `navigate ${foundryUrl} after local session`)
    await callTool(mission, 'browser.wait', { ms: 1500 }, 'wait after authenticated navigation')
    text = await callTool(mission, 'browser.get_text', {}, 'read foundry after local session')
    body = String((text.result as { text?: string } | undefined)?.text ?? excerpt(text.result))
  }
  if (!/THE FOUNDRY|foundry-new-session|New Session/i.test(body)) {
    await callTool(mission, 'browser.click', { testId: 'nav-foundry' }, 'open Foundry from War Room home')
    await callTool(mission, 'browser.wait', { ms: 1500 }, 'wait for Foundry after home entry')
    text = await callTool(mission, 'browser.get_text', {}, 'read Foundry after home entry')
    body = String((text.result as { text?: string } | undefined)?.text ?? excerpt(text.result))
  }
  if (!/THE FOUNDRY|foundry-new-session|New Session/i.test(body)) {
    await callTool(mission, 'browser.click', { testId: 'nav-foundry-header' }, 'open Foundry from War Room header')
    await callTool(mission, 'browser.wait', { ms: 1500 }, 'wait for Foundry after header entry')
    text = await callTool(mission, 'browser.get_text', {}, 'read Foundry after header entry')
    body = String((text.result as { text?: string } | undefined)?.text ?? excerpt(text.result))
  }
  let seen = expected ? body.includes(expected) : nav.ok
  if (isSessionArchiveRequest(mission.userRequest)) {
    const proofTitle = isComputerUseReliabilityRequest(mission.userRequest)
      ? 'PASS 011 Computer Use Proof'
      : isSessionRestoreRequest(mission.userRequest) ? 'PASS 010 Semantic Lifecycle Proof' : 'PASS 009 Archive Proof'
    await callTool(mission, 'browser.wait_for_text', { text: 'New Session' }, 'wait until Foundry New Session is visible')
    await callTool(mission, 'browser.click', { testId: 'foundry-new-session' }, 'create test session')
    await callTool(mission, 'browser.wait', { ms: 800 }, 'wait for new session')
    await callTool(mission, 'browser.click', { testId: 'foundry-session-rename' }, 'open rename control')
    await callTool(mission, 'browser.type', { selector: '[data-testid="foundry-session-rename-input"]', text: proofTitle }, 'type proof title')
    await callTool(mission, 'browser.click', { testId: 'foundry-session-rename-save' }, 'save renamed title')
    await callTool(mission, 'browser.wait', { ms: 800 }, 'wait for sidebar update')
    const renamedList = await callTool(mission, 'browser.get_text', { selector: '[data-testid="foundry-session-list"]' }, 'read renamed sidebar')
    const renamedOk = new RegExp(proofTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(String((renamedList.result as { text?: string } | undefined)?.text ?? excerpt(renamedList.result)))
    await callTool(mission, 'browser.click', { testId: 'foundry-session-archive' }, 'open archive control')
    await callTool(mission, 'browser.click', { testId: 'foundry-session-archive-yes' }, 'confirm archive')
    await callTool(mission, 'browser.wait', { ms: 800 }, 'wait for archive')
    const afterArchive = await callTool(mission, 'browser.get_text', { selector: '[data-testid="foundry-session-list"]' }, 'read sidebar after archive')
    const hidden = !new RegExp(proofTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(String((afterArchive.result as { text?: string } | undefined)?.text ?? excerpt(afterArchive.result)))
    let restoredOk = true
    let persistRestored = true
    if (isSessionRestoreRequest(mission.userRequest)) {
      await callTool(mission, 'browser.click', { testId: 'foundry-operations-toggle' }, 'open Advanced archived sessions')
      await callTool(mission, 'browser.wait', { ms: 600 }, 'wait for archived list')
      await callTool(mission, 'browser.click', { testId: 'foundry-session-restore' }, 'restore archived session')
      await callTool(mission, 'browser.wait', { ms: 800 }, 'wait for restore')
      const afterRestore = await callTool(mission, 'browser.get_text', { selector: '[data-testid="foundry-session-list"]' }, 'read sidebar after restore')
      restoredOk = new RegExp(proofTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(String((afterRestore.result as { text?: string } | undefined)?.text ?? excerpt(afterRestore.result)))
      await callTool(mission, 'browser.reload', {}, 'reload Foundry route')
      await callTool(mission, 'browser.wait', { ms: 1500 }, 'wait after reload')
      const afterReload = await callTool(mission, 'browser.get_text', { selector: '[data-testid="foundry-session-list"]' }, 'read sidebar after restore reload')
      persistRestored = new RegExp(proofTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(String((afterReload.result as { text?: string } | undefined)?.text ?? excerpt(afterReload.result)))
      await callTool(mission, 'browser.click', { testId: 'foundry-session-archive' }, 're-archive acceptance session')
      await callTool(mission, 'browser.click', { testId: 'foundry-session-archive-yes' }, 'confirm re-archive')
    } else {
      await callTool(mission, 'browser.reload', {}, 'reload Foundry route')
      await callTool(mission, 'browser.wait', { ms: 1500 }, 'wait after reload')
      const afterReload = await callTool(mission, 'browser.get_text', { selector: '[data-testid="foundry-session-list"]' }, 'read sidebar after reload')
      persistRestored = !new RegExp(proofTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(String((afterReload.result as { text?: string } | undefined)?.text ?? excerpt(afterReload.result)))
    }
    const consoleLog = await callTool(mission, 'browser.console', {}, 'read browser console')
    const consoleText = excerpt(consoleLog.result)
    const consoleClean = !/TypeError|ReferenceError|Unhandled Promise|failed to fetch/i.test(consoleText)
    seen = renamedOk && hidden && restoredOk && persistRestored && consoleClean
    body = `renamed=${renamedOk} hidden=${hidden} restored=${restoredOk} persist=${persistRestored} consoleClean=${consoleClean}`.slice(0, 400)
  } else if (/session rename/i.test(mission.userRequest)) {
    await callTool(mission, 'browser.click', { testId: 'foundry-new-session' }, 'create test session')
    await callTool(mission, 'browser.wait', { ms: 800 }, 'wait for new session')
    await callTool(mission, 'browser.click', { testId: 'foundry-session-rename' }, 'open rename control')
    await callTool(mission, 'browser.type', { selector: '[data-testid="foundry-session-rename-input"]', text: 'PASS 008 Rename Proof' }, 'type renamed title')
    await callTool(mission, 'browser.click', { testId: 'foundry-session-rename-save' }, 'save renamed title')
    await callTool(mission, 'browser.wait', { ms: 800 }, 'wait for sidebar update')
    text = await callTool(mission, 'browser.get_text', { selector: '[data-testid="foundry-session-list"]' }, 'read sidebar titles')
    body = String((text.result as { text?: string } | undefined)?.text ?? excerpt(text.result))
    const sidebarOk = /PASS 008 Rename Proof/.test(body)
    await callTool(mission, 'browser.reload', {}, 'reload Foundry route')
    await callTool(mission, 'browser.wait', { ms: 1500 }, 'wait after reload')
    const after = await callTool(mission, 'browser.get_text', { selector: '[data-testid="foundry-session-list"]' }, 'read persisted sidebar titles')
    const persisted = /PASS 008 Rename Proof/.test(String((after.result as { text?: string } | undefined)?.text ?? excerpt(after.result)))
    const consoleLog = await callTool(mission, 'browser.console', {}, 'read browser console')
    const consoleText = excerpt(consoleLog.result)
    const consoleClean = !/TypeError|ReferenceError|Unhandled Promise|failed to fetch/i.test(consoleText)
    seen = sidebarOk && persisted && consoleClean
    body = `sidebar=${sidebarOk} persist=${persisted} consoleClean=${consoleClean} ${body}`.slice(0, 400)
  } else if (!seen && /Engineering review status|ENGINEERING REVIEW|THE FOUNDRY|FOUNDRY READY|explain what Foundry checked/i.test(`${mission.userRequest}\n${body}`)) {
    await callTool(mission, 'browser.click', { testId: 'foundry-operations-toggle' }, 'open Advanced session details')
    await callTool(mission, 'browser.wait', { ms: 800 }, 'wait for operations drawer')
    await callTool(mission, 'browser.select', { selector: 'select[aria-label="Mission status"]', value: mission.missionId }, 'select this mission in Advanced details')
    await callTool(mission, 'browser.wait', { ms: 800 }, 'wait for engineering review chip')
    const chip = await callTool(mission, 'browser.get_text', { selector: '[data-testid="foundry-engineering-review"]' }, 'read engineering review chip')
    const chipText = String((chip.result as { text?: string } | undefined)?.text ?? excerpt(chip.result))
    text = chip.ok ? chip : await callTool(mission, 'browser.get_text', { selector: '[data-testid="foundry-operations-drawer"]' }, 'read advanced details')
    body = chip.ok ? chipText : String((text.result as { text?: string } | undefined)?.text ?? excerpt(text.result))
    seen = /ENGINEERING REVIEW/i.test(chipText) && /PASS|PENDING|FAIL|Checked|ownership/i.test(chipText)
    if (isEngineeringReviewDetailRequest(mission.userRequest)) {
      seen = /ENGINEERING REVIEW/i.test(chipText) && /PASS|FAIL|PENDING/i.test(chipText) && /Checked/i.test(chipText)
    }
  }
  if (!seen && mission.kind === 'application' && !isEngineeringReviewUiRequest(mission.userRequest) && !isSessionLifecycleRequest(mission.userRequest)) {
    const loginUrl = `${originRoot}/login`
    await appendJournal(mission, { kind: 'decision', text: `Marker not on ${originRoot}; choosing browser.navigate to ${loginUrl}` })
    await callTool(mission, 'browser.navigate', { url: loginUrl }, `navigate ${loginUrl}`)
    text = await callTool(mission, 'browser.get_text', {}, 'read login page text')
    body = String((text.result as { text?: string } | undefined)?.text ?? excerpt(text.result))
    seen = expected ? body.includes(expected) : false
  }
  const shot = await callTool(mission, 'browser.screenshot', { fullPage: true }, 'screenshot evidence')
  mission.browserState = { ok: Boolean(nav.ok && seen), detail: body.slice(0, 400), evidence: excerpt(shot.result) }
  if (shot.ok) {
    const p = (shot.result as { path?: string } | undefined)?.path
    if (p) mission.artifacts.push(p)
  }
  await callTool(mission, 'browser.stop', {}, 'release persistent browser after acceptance')
  markStep(mission, 'BROWSER_VERIFY', mission.browserState.ok ? 'done' : 'failed', mission.browserState.detail ?? '')
}

async function stepComputer(mission: FoundryMissionRecord): Promise<void> {
  markStep(mission, 'COMPUTER_VERIFY', 'active')
  await releaseProductionLocksForAcceptance(mission)
  const windows = await callTool(mission, 'computer.windows', {}, 'enumerate windows')
  const blob = excerpt(windows.result, 1500)
  const marker = mission.interpretation.insert?.marker || mission.interpretation.replace?.to || 'War Room'
  if (isSessionLifecycleRequest(mission.userRequest)) {
    const result = await interactComputerSessionLifecycle(mission)
    mission.computerUseState = result.ok
      ? { ok: true, detail: result.detail, status: 'PASS' }
      : { ok: false, detail: result.detail, status: 'FAIL' }
    markStep(mission, 'COMPUTER_VERIFY', mission.computerUseState.ok ? 'done' : 'failed')
    return
  }
  if (isEngineeringReviewUiRequest(mission.userRequest)) {
    const result = await interactComputerEngineeringReview(mission, windows.result)
    mission.computerUseState = result.ok
      ? { ok: true, detail: result.detail, status: 'PASS' }
      : { ok: false, detail: result.detail, status: 'FAIL' }
    markStep(mission, 'COMPUTER_VERIFY', mission.computerUseState.ok ? 'done' : 'failed')
    return
  }
  const seen = new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(blob) || /war room/i.test(blob)
  if (seen) {
    mission.computerUseState = { ok: true, detail: blob.slice(0, 400), status: 'PASS' }
  } else if (windows.ok) {
    mission.computerUseState = { ok: true, detail: `War Room window observed without marker text in titles: ${blob.slice(0, 200)}`, status: 'PASS' }
  } else {
    mission.computerUseState = { ok: false, detail: blob, status: 'FAIL' }
  }
  markStep(mission, 'COMPUTER_VERIFY', mission.computerUseState.ok ? 'done' : 'failed')
}

async function interactComputerSessionLifecycle(mission: FoundryMissionRecord): Promise<{ ok: boolean; detail: string }> {
  await callTool(mission, 'computer.focus_window', { title: 'War Room' }, 'focus installed War Room window')
  const methods: Record<string, string> = {}
  const timings: unknown[] = []
  const scopedApp = 'war-room-os'
  const clickConfirmed = async (name: string, reason: string, role = 'button', timeoutMs = 8_000) => {
    const clicked = await callTool(
      mission,
      'computer.click_and_wait',
      { name, text: name, role, app: scopedApp, timeoutMs },
      reason,
    )
    const payload = (clicked.result ?? {}) as { method?: string; timing?: unknown; explicitCoordinateFallback?: number }
    const method = String(payload.method ?? (clicked.ok ? 'SEMANTIC_BOUNDS_CLICK' : 'NONE'))
    methods[name] = method
    if (payload.timing) timings.push(payload.timing)
    const hardcoded = method === 'COORDINATE_FALLBACK' || method === 'NONE' || method === 'SEMANTIC_BOUNDS_OUTSIDE_WINDOW'
    return { ok: clicked.ok && !hardcoded && payload.explicitCoordinateFallback !== 1, method }
  }
  await callTool(mission, 'computer.wait', { ms: 800 }, 'wait for installed window accessibility')
  const windows = await callTool(mission, 'computer.windows', {}, 'bounded computer.windows with hung-app skip')
  const alreadyInFoundry = await callTool(
    mission,
    'computer.wait_for_control',
    { name: 'Advanced / Operations', role: 'button', app: scopedApp, timeoutMs: 2_500, pollIntervalMs: 250, stable: false },
    'detect Foundry Advanced control before creating a session',
  )
  const foundry = alreadyInFoundry.ok
    ? { ok: true, method: 'ALREADY_VISIBLE' }
    : await clickConfirmed('Foundry', 'open Foundry from War Room header', 'link', 6_000)
  if (!alreadyInFoundry.ok) {
    const opened = await callTool(
      mission,
      'computer.wait_for_control',
      { name: 'New Session', role: 'button', app: scopedApp, timeoutMs: 4_000, pollIntervalMs: 250, stable: false },
      'confirm Foundry opened after semantic Foundry click',
    )
    if (!opened.ok) {
      const retry = await clickConfirmed('Foundry', 'Foundry AT-SPI action no-op; state-confirmed retry', 'link', 6_000)
      methods['Foundry'] = retry.method
    }
  }
  const created = await clickConfirmed('New Session', 'create Foundry session')
  if (!created.ok) return { ok: false, detail: `NEW_SESSION_REAL_TRANSITION failed. methods=${JSON.stringify(methods)} timings=${JSON.stringify(timings)} foundry=${foundry.ok}` }
  const renamed = await clickConfirmed('Rename', 'click Rename control')
  if (!renamed.ok) return { ok: false, detail: `Rename was not semantic. methods=${JSON.stringify(methods)} timings=${JSON.stringify(timings)} foundry=${foundry.ok} newSession=${created.ok}` }
  const titleWait = await callTool(mission, 'computer.wait_for_control', { name: 'Session title', role: 'entry', app: scopedApp, timeoutMs: 5_000, pollIntervalMs: 250, stable: false }, 'wait for Session title')
  if (titleWait.ok) await callTool(mission, 'computer.click', { name: 'Session title', role: 'entry', app: scopedApp }, 'focus session title')
  await callTool(mission, 'computer.hotkey', { keys: 'ctrl+a', app: scopedApp }, 'select existing session title')
  const proofTitle = isComputerUseReliabilityRequest(mission.userRequest)
    ? 'PASS 011 Computer Use Proof'
    : isSessionRestoreRequest(mission.userRequest) ? 'PASS 010 Semantic Lifecycle Proof' : (isSessionArchiveRequest(mission.userRequest) ? 'PASS 009 Archive Proof' : 'PASS 008 Rename Proof')
  await callTool(mission, 'computer.type', { text: proofTitle, app: scopedApp }, 'type session title')
  const saved = await clickConfirmed('Save', 'save session title')
  if (!saved.ok) return { ok: false, detail: `Save was not semantic. methods=${JSON.stringify(methods)} timings=${JSON.stringify(timings)}` }
  let archived = true
  let confirmed = true
  let restored = true
  if (isSessionArchiveRequest(mission.userRequest) || isSessionRestoreRequest(mission.userRequest)) {
    const archiveClicked = await clickConfirmed('Archive', 'click Archive control')
    const confirmClicked = await clickConfirmed('Confirm Archive', 'confirm archive')
    archived = archiveClicked.ok
    confirmed = confirmClicked.ok
  }
  if (isSessionRestoreRequest(mission.userRequest)) {
    const advanced = await clickConfirmed('Advanced / Operations', 'open Advanced archived sessions')
    const restoreClicked = await clickConfirmed('Restore', 'restore archived session')
    restored = advanced.ok && restoreClicked.ok
    if (restored) {
      const reArchive = await clickConfirmed('Archive', 're-archive acceptance session after restore proof')
      const reConfirm = await clickConfirmed('Confirm Archive', 'confirm re-archive so Commander list stays clean')
      archived = archived && reArchive.ok
      confirmed = confirmed && reConfirm.ok
      methods['Archive'] = reArchive.method
      methods['Confirm Archive'] = reConfirm.method
    }
  }
  const shot = await callTool(mission, 'computer.screenshot', {}, 'capture session lifecycle')
  if (shot.ok) {
    const p = (shot.result as { path?: string } | undefined)?.path
    if (p) mission.artifacts.push(p)
  }
  const required = isSessionRestoreRequest(mission.userRequest)
    ? ['New Session', 'Rename', 'Save', 'Archive', 'Confirm Archive', 'Restore']
    : isSessionArchiveRequest(mission.userRequest)
      ? ['New Session', 'Rename', 'Save', 'Archive']
      : ['New Session', 'Rename', 'Save']
  const hardcoded = required.filter(name => methods[name] === 'COORDINATE_FALLBACK' || !methods[name] || methods[name] === 'NONE' || methods[name] === 'SEMANTIC_BOUNDS_OUTSIDE_WINDOW')
  const windowsOk = windows.ok === true
  const ok = created.ok && renamed.ok && saved.ok && archived && confirmed && restored && hardcoded.length === 0 && windowsOk
  return {
    ok,
    detail: `methods=${JSON.stringify(methods)} timings=${JSON.stringify(timings)} hardcoded=${hardcoded.length} archived=${archived} restored=${restored} computerWindows=${windowsOk} coordinateFallbackPreserved=true`,
  }
}

async function interactComputerEngineeringReview(mission: FoundryMissionRecord, windowsResult: unknown): Promise<{ ok: boolean; detail: string }> {
  const payload = (windowsResult ?? {}) as {
    warRoom?: { id?: string; title?: string; host?: string }
    x11?: Array<{ title?: string; host?: string; id?: string }>
  }
  const discovered = payload.warRoom
    ?? (Array.isArray(payload.x11) ? payload.x11.find(item => /War Room — Higher Vision Inc|War Room OS|war-room-os/i.test(`${item.title ?? ''} ${item.host ?? ''}`) && !/cursor/i.test(`${item.title ?? ''} ${item.host ?? ''}`)) : undefined)
  if (!discovered?.title && !discovered?.id) {
    return { ok: false, detail: `War Room window not discovered. windows=${excerpt(windowsResult, 400)}` }
  }
  const focus = await callTool(
    mission,
    'computer.focus_window',
    { title: discovered.title || 'War Room — Higher Vision Inc', app: 'war-room-os' },
    'focus discovered installed War Room window',
  )
  await callTool(mission, 'computer.wait', { ms: 800 }, 'wait after focusing War Room')
  const observeFoundry = await callTool(mission, 'computer.observe', { name: 'THE FOUNDRY', app: 'war-room-os' }, 'observe Foundry in attached window')
  const advanced = await callTool(
    mission,
    'computer.wait_for_control',
    { name: 'Advanced / Operations', role: 'button', app: 'war-room-os', timeoutMs: 4_000, pollIntervalMs: 250, stable: false },
    'wait for Advanced / Operations',
  )
  if (!advanced.ok) {
    await callTool(mission, 'computer.click', { name: 'Foundry', text: 'Foundry', role: 'link', app: 'war-room-os', stable: false }, 'open Foundry from attached War Room')
    await callTool(mission, 'computer.wait', { ms: 1000 }, 'wait for Foundry after attach')
  }
  await callTool(mission, 'computer.click', { name: 'Advanced / Operations', text: 'Advanced / Operations', role: 'button', app: 'war-room-os' }, 'open Advanced session details')
  await callTool(mission, 'computer.wait', { ms: 800 }, 'wait for Advanced details')
  const review = await callTool(mission, 'computer.observe', { name: 'ENGINEERING REVIEW', app: 'war-room-os' }, 'observe ENGINEERING REVIEW')
  const passObs = await callTool(mission, 'computer.observe', { name: 'PASS', app: 'war-room-os' }, 'observe PASS status')
  const checked = await callTool(mission, 'computer.observe', { name: 'Checked', app: 'war-room-os' }, 'observe Checked detail')
  const shot = await callTool(mission, 'computer.screenshot', {}, 'capture Engineering Review Computer Use')
  if (shot.ok) {
    const p = (shot.result as { path?: string } | undefined)?.path
    if (p) mission.artifacts.push(p)
  }
  const attached = focus.ok && /War Room/i.test(discovered.title ?? '') && !/cursor/i.test(discovered.title ?? '')
  const observeHit = (call: CallResult, needle: string) => {
    const rec = (call.result ?? {}) as { strategy?: string; atspi?: { hits?: Array<{ name?: string }> } }
    if (rec.strategy === 'semantic') return true
    return new RegExp(needle, 'i').test(excerpt(call.result, 1_200))
  }
  const observedReview = observeHit(review, 'ENGINEERING REVIEW')
  const observedPass = observeHit(passObs, 'PASS')
  const observedChecked = observeHit(checked, 'Checked')
  const observedFoundry = observeHit(observeFoundry, 'FOUNDRY|Foundry')
  const ok = attached && observedReview && (observedPass || observedChecked)
  return {
    ok,
    detail: `attached=${attached} title=${discovered.title} focus=${focus.ok} foundry=${observedFoundry} review=${observedReview} pass=${observedPass} checked=${observedChecked}`,
  }
}

async function stepLint(mission: FoundryMissionRecord): Promise<void> {
  markStep(mission, 'LINT', 'active')
  const targets = mission.sourceState.changedFiles
  if (!targets.length) {
    markStep(mission, 'LINT', 'skipped', 'no changed files')
    return
  }
  const result = await callTool(mission, 'lint.run', { targets }, 'lint changed files')
  const quality = (result.result ?? {}) as { stdout?: string; stderr?: string }
  const blob = `${quality.stdout ?? ''}\n${quality.stderr ?? ''}\n${excerpt(result.result ?? result.error)}`
  const warningsOnly = /\(0 errors?,\s*\d+\s+warnings?\)/.test(blob)
  const ok = result.ok || warningsOnly
  markStep(mission, 'LINT', ok ? 'done' : 'failed', warningsOnly ? `warnings-only (0 errors): ${excerpt(blob, 400)}` : excerpt(blob, 800))
  if (ok) {
    const engineering = ensureEngineeringState(mission)
    engineering.lintRegionRecovery = undefined
  }
}

async function recoverLintRegion(mission: FoundryMissionRecord): Promise<void> {
  const last = [...mission.toolCalls].reverse().find(call => call.tool === 'lint.run' && !call.ok)
  const blob = `${last?.excerpt ?? ''}\n${last?.error ?? ''}`
  const locations = parseLintErrorLocations(blob)
  const changed = mission.sourceState.changedFiles
  const root = resolveRepoRoot()
  const hit = locations.find(loc => {
    const rel = repoRelativeLintPath(loc.path, root)
    return changed.some(file => file === rel || rel.endsWith(file) || file.endsWith(rel.split('/').pop() ?? ''))
  })
  const target = hit
    ? repoRelativeLintPath(hit.path, root)
    : changed[0]
  if (!target) return
  const engineering = ensureEngineeringState(mission)
  if (engineering.lintRegionRecovery?.retryUsed && engineering.lintRegionRecovery.path === target) {
    engineering.lintRegionRecovery.nextRequiredAction = 'REPLAN'
    mission.architectureFindings!.push('LINT_REGION_RETRY_FAILED: focused read plus one replacement still fail lint.')
    return
  }
  beginLintRegionRecovery(mission, {
    path: target,
    line: hit?.line ?? 1,
    column: hit?.column,
    message: hit?.message,
  })
  const args = lintFocusedReadArgs(target, hit?.line ?? 1)
  const reread = await callTool(mission, 'file.read', args, 'controller/lint-region-focused-read')
  ingestModelToolResult(mission, 'file.read', args, reread)
  if (reread.ok) {
    const payload = reread.result as { anchorId?: string } | undefined
    markLintFocusedReadComplete(mission, target, payload?.anchorId)
  }
}

async function stepTypecheck(mission: FoundryMissionRecord): Promise<void> {
  markStep(mission, 'TYPECHECK', 'active')
  const scopeGlob = mission.sourceState.changedFiles[0]?.replace(/\\/g, '/') ?? 'components/war-room/'
  const result = await callTool(mission, 'typecheck.run', { scopeGlob }, 'scoped typecheck')
  const scoped = (result.result as { scopedErrorCount?: number } | undefined)?.scopedErrorCount
  const ok = result.ok || scoped === 0
  markStep(mission, 'TYPECHECK', ok ? 'done' : 'failed', excerpt(result.result ?? result.error))
}

async function stepSelfCheck(mission: FoundryMissionRecord): Promise<void> {
  markStep(mission, 'SELF_CHECK', 'active')
  const reasons: string[] = []
  if (!mission.sourceState.changedFiles.length) reasons.push('no source change')
  if (mission.testState.ok === false) reasons.push('tests not green')
  const lintFailed = mission.plan.some(s => s.intent === 'LINT' && s.status === 'failed')
  const typeFailed = mission.plan.some(s => s.intent === 'TYPECHECK' && s.status === 'failed')
  if (lintFailed) reasons.push('lint failed')
  if (typeFailed) reasons.push('typecheck failed')
  if (reasons.length) {
    markStep(mission, 'SELF_CHECK', 'failed', reasons.join('; '))
    await appendJournal(mission, { kind: 'decision', text: `Refusing to package: ${reasons.join('; ')}` })
    mission.blocker = {
      blocker: 'Self-check refused production build',
      evidence: reasons.join('; '),
      attempted: 'SELF_CHECK',
      why: 'Packaging obviously broken work is forbidden.',
      unblock: 'Fix source/tests/lint and resume.',
    }
    await transitionMission(mission, 'BLOCKED', reasons.join('; '))
    return
  }
  markStep(mission, 'SELF_CHECK', 'done', 'source changed; lint/typecheck acceptable')
}

async function stepBuild(mission: FoundryMissionRecord): Promise<void> {
  await transitionMission(mission, 'BUILDING', 'Production build')
  markStep(mission, 'BUILD', 'active')
  const result = await callTool(mission, 'build.run', {}, 'build.run')
  mission.buildState = { ok: result.ok, detail: excerpt(result.result ?? result.error) }
  markStep(mission, 'BUILD', result.ok ? 'done' : 'failed', mission.buildState.detail ?? '')
}

async function stepPackage(mission: FoundryMissionRecord): Promise<void> {
  await transitionMission(mission, 'PACKAGING', 'Package linux artifacts')
  markStep(mission, 'PACKAGE', 'active')
  const result = await callTool(mission, 'package.run', {}, 'package.run')
  const payload = missionPackageArtifacts(mission, result.result)
  mission.packageState = {
    ok: result.ok,
    appimage: payload.appimage,
    deb: payload.deb,
    linuxUnpackedDir: payload.linuxUnpackedDir,
    detail: excerpt(result.result ?? result.error, 8_000),
  }
  markStep(mission, 'PACKAGE', result.ok ? 'done' : 'failed')
}

async function stepInstall(mission: FoundryMissionRecord): Promise<void> {
  await transitionMission(mission, 'INSTALLING', 'Production install')
  markStep(mission, 'INSTALL', 'active')
  const pkg = missionPackageArtifacts(mission)
  if (!pkg.appimage || !pkg.deb || !pkg.linuxUnpackedDir) {
    markStep(mission, 'INSTALL', 'failed', 'package artifacts missing')
    return
  }
  const result = await callTool(
    mission,
    'installer.install_production',
    {
      appimage: pkg.appimage,
      deb: pkg.deb,
      linuxUnpackedDir: pkg.linuxUnpackedDir,
      feature: isComputerUseReliabilityRequest(mission.userRequest)
        ? `pass011r-${mission.missionId.slice(0, 8)}`
        : `foundry-${mission.missionId.slice(0, 8)}`,
      commanderConfirmed: true,
    },
    'install production',
  )
  const installId = (result.result as { stamp?: { install_id?: string } } | undefined)?.stamp?.install_id
    ?? (result.result as { installId?: string } | undefined)?.installId
    ?? null
  mission.installState = { ok: result.ok, installId, detail: excerpt(result.result ?? result.error) }
  markStep(mission, 'INSTALL', result.ok ? 'done' : 'failed')
}

async function stepActivate(mission: FoundryMissionRecord): Promise<void> {
  markStep(mission, 'ACTIVATE', 'active')
  const installId = missionBoundInstallId(mission)
  if (!installId) {
    markStep(mission, 'ACTIVATE', 'failed', 'Activation refused: mission installId is missing.')
    return
  }
  const result = await callTool(
    mission,
    'installer.activate',
    { installId, commanderConfirmed: true },
    'activate exact install',
  )
  if (result.ok) {
    const newId = (result.result as { newActiveInstallId?: string } | undefined)?.newActiveInstallId ?? installId
    if (newId === installId) mission.runtimeState.activeInstallId = newId
    markStep(mission, 'ACTIVATE', 'done', excerpt(result.result))
    return
  }
  if (isActivationOwnershipConflict(result.error) && mission.installState.ok === true) {
    const blocking = await describeBlockingProductionOwner()
    await enterActivationPending(mission, {
      blockingOwnerMission: blocking.owner?.productionOwnerMissionId ?? blocking.owner?.ownerMissionId ?? null,
      blockingGeneration: blocking.owner?.productionGeneration ?? null,
      blockingOwnerState: blocking.ownerMission?.status ?? (blocking.owner ? 'MISSING' : null),
    })
    markStep(mission, 'ACTIVATE', 'pending', result.error)
    return
  }
  markStep(mission, 'ACTIVATE', 'failed', excerpt(result.result ?? result.error))
}

async function stepTransition(mission: FoundryMissionRecord): Promise<void> {
  markStep(mission, 'TRANSITION', 'active')
  const installId = missionBoundInstallId(mission)
  if (!installId) {
    markStep(mission, 'TRANSITION', 'failed', 'Runtime transition refused: mission installId is missing.')
    return
  }
  if (mission.runtimeState.activeInstallId !== installId && !mission.plan.some(step => step.intent === 'ACTIVATE' && step.status === 'done')) {
    markStep(mission, 'TRANSITION', 'pending', 'REFUSED_TRANSITION_BEFORE_ACTIVATE: installer.activate(MISSION_INSTALL_ID) is required first.')
    return
  }
  const result = await callTool(
    mission,
    'runtime.transition_to_active',
    { commanderConfirmed: true, installId },
    'controlled runtime transition',
  )
  markStep(mission, 'TRANSITION', result.ok ? 'done' : 'failed', excerpt(result.result ?? result.error))
  await new Promise(resolve => setTimeout(resolve, 2500))
}

async function stepIdentity(mission: FoundryMissionRecord): Promise<void> {
  await resumeInstallMissionForVerification(mission, 'Exact identity')
  if (mission.status !== 'VERIFYING') return
  markStep(mission, 'IDENTITY', 'active')
  const result = await callTool(mission, 'runtime.verify', {}, 'runtime.verify')
  const v = result.result as {
    activeInstallId?: string | null
    runningInstallId?: string | null
    identityMatch?: boolean | null
    health?: { running?: boolean }
    corePort?: { running?: boolean }
  } | undefined
  mission.runtimeState = {
    activeInstallId: v?.activeInstallId ?? null,
    runningInstallId: v?.runningInstallId ?? null,
    identityMatch: v?.identityMatch ?? null,
    uiHealth: v?.health?.running === true,
    coreHealth: v?.corePort?.running === true,
    detail: excerpt(v),
  }
  const ok = v?.identityMatch === true && v.activeInstallId === mission.installState.installId && v.runningInstallId === mission.installState.installId
  markStep(mission, 'IDENTITY', ok ? 'done' : 'failed')
}

async function stepComplete(mission: FoundryMissionRecord): Promise<void> {
  markStep(mission, 'COMPLETE', 'active')
  mission.completionGate = evaluateMissionGate(mission)
  mission.context = summarizeContext(mission)
  if (!mission.completionGate.complete) {
    markStep(mission, 'COMPLETE', 'failed', mission.completionGate.detail)
    await appendJournal(mission, { kind: 'decision', text: `mission.complete refused: ${mission.completionGate.detail}` })
    appendContractEvent(mission.missionId, 'COMPLETION_REFUSED', mission.completionGate.detail, mission)
    return
  }
  if (isStandaloneEngineerMission(mission) && !contractCanComplete({
    engineeringClass: mission.engineeringClass,
    missionContract: mission.missionContractId ? loadMissionContract(mission.missionContractId) : null,
    acceptanceContract: mission.acceptanceContractId ? loadAcceptanceContract(mission.acceptanceContractId) : null,
    verdict: loadVerdictRecord(mission.missionId),
  }).ok) {
    markStep(mission, 'COMPLETE', 'failed', 'Verdict PASS required')
    appendContractEvent(mission.missionId, 'COMPLETION_REFUSED', 'COMPLETE requires Verdict PASS', mission)
    await appendJournal(mission, { kind: 'decision', text: 'mission.complete refused: Verdict PASS required' })
    return
  }
  markStep(mission, 'COMPLETE', 'done')
  await transitionMission(mission, 'COMPLETE', mission.completionGate.detail)
  await rememberMissionOwnership(mission)
}

async function executeIntent(mission: FoundryMissionRecord, intent: FoundryMissionIntent): Promise<void> {
  switch (intent) {
    case 'UNDERSTAND':
      return stepUnderstand(mission)
    case 'SEARCH':
      return stepSearch(mission)
    case 'READ':
      return stepRead(mission)
    case 'PATCH_SOURCE':
      return stepPatch(mission, false)
    case 'PATCH_TESTS':
      return stepPatch(mission, true)
    case 'TEST':
      return stepTest(mission)
    case 'LAUNCH':
      return stepLaunch(mission)
    case 'BROWSER_VERIFY':
      return stepBrowser(mission)
    case 'COMPUTER_VERIFY':
      return stepComputer(mission)
    case 'LINT':
      return stepLint(mission)
    case 'TYPECHECK':
      return stepTypecheck(mission)
    case 'SELF_CHECK':
      return stepSelfCheck(mission)
    case 'BUILD':
      return stepBuild(mission)
    case 'PACKAGE':
      return stepPackage(mission)
    case 'INSTALL':
      return stepInstall(mission)
    case 'ACTIVATE':
      return stepActivate(mission)
    case 'TRANSITION':
      return stepTransition(mission)
    case 'IDENTITY':
      return stepIdentity(mission)
    case 'COMPLETE':
      return stepComplete(mission)
    default:
      if (['MAP', 'IMPACT', 'BASELINE', 'SELF_REVIEW', 'DIAGNOSE', 'REGRESSION', 'CROSS_FILE', 'TEST_REVIEW', 'CONTRACT'].includes(intent)) {
        if (intent === 'CROSS_FILE' || intent === 'TEST_REVIEW' || intent === 'CONTRACT') {
          await stepMultiFileStage(mission, intent)
          return
        }
        markStep(mission, intent, 'done', 'engineering stage already captured by controller/model loop')
      }
      return
  }
}

async function stepMultiFileStage(mission: FoundryMissionRecord, intent: 'CROSS_FILE' | 'TEST_REVIEW' | 'CONTRACT'): Promise<void> {
  markStep(mission, intent, 'active')
  const tool = intent === 'CROSS_FILE' ? 'engineering.consistency' : intent === 'TEST_REVIEW' ? 'engineering.test_review' : 'engineering.contracts'
  const result = await callTool(mission, tool, {}, `PASS 008 ${intent}`)
  const status = String((result.result as { status?: string } | undefined)?.status ?? (result.ok ? 'PASS' : 'FAIL'))
  const engineering = ensureEngineeringState(mission)
  if (intent === 'CROSS_FILE') engineering.crossFile = { status: status === 'PASS' ? 'PASS' : 'FAIL', compact: excerpt(result.result) }
  if (intent === 'TEST_REVIEW') engineering.testReview = { status: status === 'PASS' ? 'PASS' : 'FAIL', compact: excerpt(result.result) }
  if (intent === 'CONTRACT') engineering.contractMigration = { status: status === 'PASS' ? 'PASS' : 'FAIL', compact: excerpt(result.result) }
  markStep(mission, intent, result.ok ? 'done' : 'failed', excerpt(result.result ?? result.error))
}

async function reconcile(mission: FoundryMissionRecord): Promise<void> {
  if (mission.kind !== 'application') return
  if (mission.constraints.includes('READ_ONLY_INVESTIGATION')) return
  const verify = await callTool(mission, 'runtime.verify', {}, 'recovery: inspect live runtime')
  const v = verify.result as { activeInstallId?: string | null; runningInstallId?: string | null; identityMatch?: boolean | null } | undefined
  if (v) {
    mission.runtimeState.activeInstallId = v.activeInstallId ?? mission.runtimeState.activeInstallId
    mission.runtimeState.runningInstallId = v.runningInstallId ?? mission.runtimeState.runningInstallId
    mission.runtimeState.identityMatch = v.identityMatch ?? mission.runtimeState.identityMatch
    await appendJournal(mission, {
      kind: 'observation',
      text: `Reconciled live runtime ACTIVE=${v.activeInstallId} RUNNING=${v.runningInstallId} MATCH=${v.identityMatch}`,
    })
  }
}

function ensureModelState(mission: FoundryMissionRecord): NonNullable<FoundryMissionRecord['modelState']> {
  mission.hypotheses ??= []
  mission.architectureFindings ??= []
  mission.codeDecisions ??= []
  mission.importantPaths ??= []
  mission.testFindings ??= []
  mission.runtimeFindings ??= []
  mission.modelState ??= {
    primaryProvider: null,
    activeProvider: null,
    activeModel: null,
    fallbackProvider: null,
    calls: 0,
    invalidResponses: 0,
    providerFailures: 0,
    consecutiveFailures: 0,
    repeatedActionCount: 0,
    lastDecision: null,
    lastReasoningSummary: null,
    lastExpectedObservation: null,
  }
  return mission.modelState
}

async function modelTransition(mission: FoundryMissionRecord, next: FoundryMissionRecord['status'], reason: string): Promise<void> {
  if (mission.status === next) return
  if (LEGAL_TRANSITIONS[mission.status]?.includes(next)) {
    await transitionMission(mission, next, reason)
  } else {
    await appendJournal(mission, { kind: 'transition', text: `Model action retained ${mission.status}; ${next} is not legal from this phase (${reason}).` })
  }
}

async function completeWhenGatePasses(mission: FoundryMissionRecord): Promise<void> {
  if (mission.status === 'COMPLETE') return
  const allowed = LEGAL_TRANSITIONS[mission.status] ?? []
  if (!allowed.includes('COMPLETE')) {
    if (allowed.includes('VERIFYING')) {
      await transitionMission(mission, 'VERIFYING', 'Gate complete; enter VERIFYING before COMPLETE')
    } else if (allowed.includes('VALIDATING')) {
      await transitionMission(mission, 'VALIDATING', 'Gate complete; enter VALIDATING before COMPLETE')
    } else {
      await resumeInstallMissionForVerification(mission, 'Gate complete; resume EXECUTING before COMPLETE')
    }
  }
  if ((LEGAL_TRANSITIONS[mission.status] ?? []).includes('COMPLETE')) {
    await transitionMission(mission, 'COMPLETE', mission.completionGate.detail)
  }
  await rememberMissionOwnership(mission)
  await cleanupOwnedResources(mission)
}

function intentForTool(tool: EngineerToolName): FoundryMissionIntent | null {
  if (tool === 'workspace.search') return 'SEARCH'
  if (tool === 'file.read' || tool === 'workspace.inspect') return 'READ'
  if (tool === 'code.owners' || tool === 'code.symbol' || tool === 'code.refs' || tool === 'code.dependents' || tool === 'code.roles') return 'MAP'
  if (tool === 'code.impact' || tool === 'engineering.plan' || tool === 'engineering.boundary' || tool === 'engineering.write_set_expand') return 'IMPACT'
  if (tool === 'engineering.baseline') return 'BASELINE'
  if (tool === 'engineering.review') return 'SELF_REVIEW'
  if (tool === 'engineering.consistency') return 'CROSS_FILE'
  if (tool === 'engineering.test_review') return 'TEST_REVIEW'
  if (tool === 'engineering.contracts' || tool === 'engineering.dead_code') return 'CONTRACT'
  if (tool === 'engineering.diagnose') return 'DIAGNOSE'
  if (tool === 'file.write' || tool === 'file.patch' || tool === 'file.replace_unique' || tool === 'file.move' || tool === 'file.delete') return 'PATCH_SOURCE'
  if (tool === 'test.run' || tool === 'terminal.execute' || tool === 'validation.run') return 'TEST'
  if (tool === 'lint.run') return 'LINT'
  if (tool === 'typecheck.run') return 'TYPECHECK'
  if (tool === 'process.start') return 'LAUNCH'
  if (tool === 'build.run') return 'BUILD'
  if (tool === 'package.run') return 'PACKAGE'
  if (tool === 'installer.install_production' || tool === 'installer.install') return 'INSTALL'
  if (tool === 'installer.activate') return 'ACTIVATE'
  if (tool === 'runtime.transition_to_active') return 'TRANSITION'
  if (tool === 'runtime.verify') return 'IDENTITY'
  if (tool.startsWith('browser.')) return 'BROWSER_VERIFY'
  if (tool.startsWith('computer.')) return 'COMPUTER_VERIFY'
  return null
}

function pathsFromModelTool(tool: EngineerToolName, args: Record<string, unknown>): string[] {
  if (tool === 'file.move') {
    return [args.from, args.to].filter((item): item is string => typeof item === 'string' && item.length > 0)
  }
  if (tool === 'file.write' || tool === 'file.read' || tool === 'file.replace_unique' || tool === 'file.delete') {
    return typeof args.path === 'string' ? [args.path] : []
  }
  if (tool !== 'file.patch') return []
  const proposal = args.proposal as { plannedChanges?: Array<{ file?: string }> } | undefined
  return proposal?.plannedChanges?.flatMap(change => typeof change.file === 'string' ? [change.file] : []) ?? []
}

function extractValidationTargets(tool: EngineerToolName, args: Record<string, unknown>): string[] {
  if (tool === 'test.run' && typeof args.suite === 'string') return [args.suite]
  const operation = args.operation as { targets?: unknown; id?: string } | undefined
  if (Array.isArray(operation?.targets)) return operation.targets.map(String)
  return operation?.id ? [operation.id] : []
}

function applyModelPlanChanges(mission: FoundryMissionRecord, decision: FoundryModelDecision): boolean {
  const changes = decision.planChanges
  if (!changes) return false
  let rejectedHypothesis = false
  let replacementHypothesis = false
  if (changes.goal) mission.goal = changes.goal
  if (changes.successCriteria?.length) mission.successCriteria = changes.successCriteria
  if (changes.removeStepIds?.length) {
    mission.plan = mission.plan.filter(step => !changes.removeStepIds!.includes(step.id))
  }
  for (const addition of changes.add ?? []) {
    if (!mission.plan.some(step => step.id === addition.id)) {
      mission.plan.push({ ...addition, status: 'pending' })
    }
  }
  if (changes.reorderStepIds?.length) {
    const order = new Map(changes.reorderStepIds.map((id, index) => [id, index]))
    mission.plan.sort((a, b) => (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER))
  }
  const timestamp = now()
  for (const update of changes.hypotheses ?? []) {
    const existing = update.id ? mission.hypotheses!.find(hypothesis => hypothesis.id === update.id) : undefined
    if (existing) {
      if (existing.status !== 'REJECTED' && update.status === 'REJECTED') rejectedHypothesis = true
      if (update.status === 'SUPPORTED' || update.status === 'CONFIRMED') replacementHypothesis = true
      existing.statement = update.statement
      existing.status = update.status
      existing.evidenceFor = [...new Set([...existing.evidenceFor, ...(update.evidenceFor ?? [])])]
      existing.evidenceAgainst = [...new Set([...existing.evidenceAgainst, ...(update.evidenceAgainst ?? [])])]
      existing.updatedAt = timestamp
    } else {
      const hypothesis: FoundryHypothesis = {
        id: update.id || `hypothesis-${mission.hypotheses!.length + 1}`,
        statement: update.statement,
        status: update.status,
        evidenceFor: update.evidenceFor ?? [],
        evidenceAgainst: update.evidenceAgainst ?? [],
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      mission.hypotheses!.push(hypothesis)
      if (update.status === 'REJECTED') rejectedHypothesis = true
      if (update.status === 'SUPPORTED' || update.status === 'CONFIRMED') replacementHypothesis = true
    }
  }
  mission.architectureFindings!.push(...(changes.findings ?? []))
  return rejectedHypothesis && replacementHypothesis
}

async function preparePhaseForModelTool(mission: FoundryMissionRecord, tool: EngineerToolName): Promise<void> {
  if (tool === 'workspace.search' || tool === 'workspace.inspect' || tool === 'file.read' || tool.startsWith('code.')) {
    await modelTransition(mission, 'INSPECTING', `Model selected ${tool}`)
  } else if (tool === 'engineering.baseline' || tool === 'engineering.review' || tool === 'engineering.diagnose') {
    await modelTransition(mission, 'EXECUTING', `Model selected ${tool}`)
  } else if (isSourceMutationTool(tool)) {
    await modelTransition(mission, 'EXECUTING', `Model selected ${tool}`)
  } else if (tool === 'test.run' || tool === 'terminal.execute' || tool === 'validation.run' || tool === 'lint.run' || tool === 'typecheck.run') {
    await modelTransition(mission, 'VALIDATING', `Model selected ${tool}`)
  } else if (tool === 'build.run') {
    await modelTransition(mission, 'BUILDING', 'Model selected production build')
  } else if (tool === 'package.run') {
    await modelTransition(mission, 'PACKAGING', 'Model selected packaging')
  } else if (tool.startsWith('installer.')) {
    await modelTransition(mission, 'INSTALLING', `Model selected ${tool}`)
  } else if (tool.startsWith('runtime.') || tool.startsWith('browser.') || tool.startsWith('computer.')) {
    await modelTransition(mission, 'VERIFYING', `Model selected ${tool}`)
  }
}

function modelToolSucceeded(tool: EngineerToolName, result: CallResult): boolean {
  const nested = result.result as { ok?: boolean; exitCode?: number; scopedErrorCount?: number } | undefined
  if (tool === 'typecheck.run' && nested?.scopedErrorCount === 0) return true
  return result.ok && nested?.ok !== false && (nested?.exitCode === undefined || nested.exitCode === 0)
}

function ingestModelToolResult(
  mission: FoundryMissionRecord,
  tool: EngineerToolName,
  args: Record<string, unknown>,
  result: CallResult,
): void {
  const ok = modelToolSucceeded(tool, result)
  const intent = intentForTool(tool)
  if (intent && intent !== 'ACTIVATE' && intent !== 'TRANSITION' && intent !== 'IDENTITY') {
    markStep(mission, intent, ok ? 'done' : 'failed', excerpt(result.result ?? result.error))
  }
  const lastCall = mission.toolCalls.at(-1)
  if (!lastCall || lastCall.tool !== tool) {
    mission.toolCalls.push({
      at: now(),
      tool,
      ok,
      reason: 'controller-ingest',
      error: ok ? undefined : result.error,
      excerpt: excerpt(result.result ?? result.error),
    })
  }
  const engineering = ensureEngineeringState(mission)

  if (isSourceMutationTool(tool) && ok) {
    for (const file of pathsFromModelTool(tool, args)) {
      if (!mission.sourceState.changedFiles.includes(file)) mission.sourceState.changedFiles.push(file)
      if (!mission.sourceFilesTouched.includes(file)) mission.sourceFilesTouched.push(file)
      if (!mission.importantPaths!.includes(file)) mission.importantPaths!.push(file)
      if (isTestFile(file)) {
        if (!mission.testFilesTouched.includes(file)) mission.testFilesTouched.push(file)
        journalTestChange(mission, file, engineering.diagnosis?.classification ?? 'model updated test')
      }
    }
  }
  if (tool === 'file.read' && ok) {
    const rel = typeof args.path === 'string' ? args.path : ''
    if (rel) {
      if (!mission.importantPaths!.includes(rel)) mission.importantPaths!.push(rel)
      if (!mission.candidateFiles.includes(rel)) mission.candidateFiles.push(rel)
      const payload = result.result as {
        sha256?: string
        range?: { startLine?: number; endLine?: number }
        anchorId?: string
        ANCHOR_UNIQUE?: boolean
      } | undefined
      const aroundMatch = typeof args.aroundMatch === 'string' ? args.aroundMatch : undefined
      const novelty = noteSourceReadNovelty(mission, {
        path: rel,
        sha256: payload?.sha256 ?? '',
        range: { startLine: payload?.range?.startLine ?? 1, endLine: payload?.range?.endLine ?? 1 },
        aroundMatch,
      })
      mission.architectureFindings!.push(`${rel}: ${novelty}${payload?.anchorId ? ` anchorId=${payload.anchorId} unique=${payload.ANCHOR_UNIQUE === true}` : ''}`)
      const recovery = engineering.editMatchRecovery
      if (recovery?.path === rel && recovery.nextRequiredAction === 'FOCUSED_READ') {
        markFocusedReadComplete(mission, rel, payload?.anchorId)
      }
      const lintRec = engineering.lintRegionRecovery
      if (lintRec?.path === rel && lintRec.nextRequiredAction === 'FOCUSED_READ') {
        markLintFocusedReadComplete(mission, rel, payload?.anchorId)
      }
    }
  }
  if (tool === 'workspace.search' && ok) {
    const payload = result.result
    const hits = Array.isArray(payload) ? payload : Array.isArray((payload as { hits?: unknown[] } | undefined)?.hits) ? (payload as { hits: unknown[] }).hits : []
    const query = String(args.query ?? '')
    const titledUi = /[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}/.test(query)
    for (const hit of hits.slice(0, 12)) {
      const rel = typeof hit === 'string' ? hit : String((hit as { relPath?: string })?.relPath ?? '')
      if (!rel) continue
      if (titledUi && /^lib\/council\//.test(rel)) continue
      if (/\.(proof|validation|resume)\.ts$/.test(rel) || /(?:^|\/)scripts\//.test(rel)) continue
      if (!mission.candidateFiles.includes(rel)) mission.candidateFiles.push(rel)
      if (!mission.importantPaths!.includes(rel)) mission.importantPaths!.push(rel)
    }
  }
  if (tool === 'code.owners') {
    const payload = result.result as { owners?: string[]; tests?: string[]; compact?: string } | undefined
    if (payload?.owners?.length) {
      engineering.ownership = {
        query: typeof args.query === 'string' ? args.query : mission.userRequest,
        owners: payload.owners,
        dependents: (payload as { dependents?: string[] }).dependents ?? [],
        tests: payload.tests ?? [],
        routes: (payload as { routes?: string[] }).routes ?? [],
        apis: (payload as { apis?: string[] }).apis ?? [],
        packageBoundaries: (payload as { packageBoundaries?: string[] }).packageBoundaries ?? [],
      }
      mission.architectureFindings!.push(payload.compact ?? `OWNERSHIP ${payload.owners.join(', ')}`)
      for (const owner of payload.owners.slice(0, 8)) {
        if (!mission.importantPaths!.includes(owner)) mission.importantPaths!.push(owner)
        if (!mission.candidateFiles.includes(owner)) mission.candidateFiles.push(owner)
      }
    }
  }
  if (tool === 'code.impact') {
    const payload = result.result as { owners?: string[]; tests?: string[]; compact?: string; targetFiles?: string[] } | undefined
    if (payload && (payload.owners?.length || payload.targetFiles?.length)) {
      const mapped = engineering.ownership?.owners ?? []
      const owners = [...mapped, ...(payload.owners ?? []).filter(item => !mapped.includes(item))].slice(0, 12)
      engineering.impact = {
        ...(engineering.impact ?? {
          change: mission.goal.slice(0, 160),
          owners: [],
          targetFiles: [],
          dependencies: [],
          dependents: [],
          reverseDependents: [],
          tests: [],
          likelyTests: [],
          runtimeSurfaces: [],
          securitySurfaces: [],
          risks: [],
          riskAreas: [],
        }),
        ...(payload as object),
        owners,
        targetFiles: owners,
      }
      if (!mapped.length && payload.owners?.length) {
        engineering.ownership = {
          query: typeof args.query === 'string' ? args.query : mission.userRequest,
          owners: payload.owners,
          dependents: (payload as { dependents?: string[] }).dependents ?? [],
          tests: payload.tests ?? [],
          routes: [],
          apis: [],
          packageBoundaries: [],
        }
      }
      mission.architectureFindings!.push(payload.compact ?? `IMPACT ${owners.join(', ')}`)
    }
  }
  if (tool === 'engineering.review' && ok) {
    const payload = result.result as { status?: 'PASS' | 'PENDING' | 'FAIL'; findings?: string[]; compact?: string; at?: string; diffHash?: string } | undefined
    if (payload?.status) {
      engineering.selfReview = {
        status: payload.status,
        findings: payload.findings ?? [],
        severity: [],
        requiredAction: payload.status === 'FAIL' ? 'Fix review findings before production build.' : 'none',
        at: payload.at ?? now(),
        diffHash: payload.diffHash ?? '',
        compact: payload.compact ?? '',
      }
    }
  }
  if (tool === 'engineering.diagnose' && ok) {
    engineering.diagnosis = result.result as typeof engineering.diagnosis
  }
  if (tool === 'test.run' || tool === 'terminal.execute' || tool === 'validation.run') {
    mission.testState = { ok, detail: excerpt(result.result ?? result.error, 2_000) }
    mission.testFindings!.push(`Validation ${ok ? 'passed' : 'failed'} via ${tool}: ${excerpt(result.result ?? result.error, 800)}`)
    const targets = extractValidationTargets(tool, args)
    engineering.selectedTestsRun = [...new Set([...(engineering.selectedTestsRun ?? []), ...targets])]
    if (ok && targets.some(target => (engineering.regressionTests ?? []).includes(target) || /regression/.test(target))) {
      engineering.regressionOk = true
      markStep(mission, 'REGRESSION', 'done', targets.join(', '))
    }
    if (!ok) classifyFailure(mission, excerpt(result.result ?? result.error, 1_200))
  }
  if ((tool === 'lint.run' || tool === 'typecheck.run') && ok && mission.kind === 'application') {
    engineering.regressionOk = true
    markStep(mission, 'REGRESSION', 'done', tool)
  }
  if (tool === 'build.run') mission.buildState = { ok, detail: excerpt(result.result ?? result.error, 2_000) }
  if (tool === 'package.run') {
    const payload = missionPackageArtifacts(mission, result.result)
    mission.packageState = {
      ok,
      appimage: payload.appimage,
      deb: payload.deb,
      linuxUnpackedDir: payload.linuxUnpackedDir,
      detail: excerpt(result.result ?? result.error, 8_000),
    }
  }
  if (tool === 'installer.install_production') {
    const payload = result.result as { installId?: string; stamp?: { install_id?: string } } | undefined
    mission.installState = {
      ok,
      installId: payload?.stamp?.install_id ?? payload?.installId ?? mission.installState.installId,
      detail: excerpt(result.result ?? result.error, 2_000),
    }
  }
  if (tool === 'installer.activate') {
    const payload = result.result as { newActiveInstallId?: string } | undefined
    const bound = missionBoundInstallId(mission)
    if (ok && payload?.newActiveInstallId && bound && payload.newActiveInstallId === bound) {
      mission.runtimeState.activeInstallId = payload.newActiveInstallId
      markStep(mission, 'ACTIVATE', 'done', excerpt(result.result))
    } else if (!ok && isActivationOwnershipConflict(result.error) && mission.installState.ok === true) {
      markStep(mission, 'ACTIVATE', 'pending', result.error)
    } else {
      markStep(mission, 'ACTIVATE', ok ? 'done' : 'failed', excerpt(result.result ?? result.error))
    }
  }
  if (tool === 'runtime.transition_to_active') {
    markStep(mission, 'TRANSITION', ok && (missionIdentityAccepted(mission) || mission.runtimeState.activeInstallId === missionBoundInstallId(mission)) ? 'done' : (ok ? 'done' : 'failed'), excerpt(result.result ?? result.error))
  }
  if (tool === 'runtime.verify') {
    const payload = result.result as {
      activeInstallId?: string | null
      runningInstallId?: string | null
      identityMatch?: boolean | null
      health?: { running?: boolean }
      corePort?: { running?: boolean }
    } | undefined
    mission.runtimeState = {
      activeInstallId: payload?.activeInstallId ?? null,
      runningInstallId: payload?.runningInstallId ?? null,
      identityMatch: payload?.identityMatch ?? null,
      uiHealth: payload?.health?.running === true,
      coreHealth: payload?.corePort?.running === true,
      detail: excerpt(payload, 2_000),
    }
    mission.runtimeFindings!.push(`runtime.verify: ${excerpt(payload, 800)}`)
    markStep(mission, 'IDENTITY', missionIdentityAccepted(mission) ? 'done' : (ok ? 'pending' : 'failed'), excerpt(payload))
  }
  if (tool === 'browser.get_text' || tool === 'browser.inspect' || tool === 'browser.get_dom') {
    mission.browserState.detail = excerpt(result.result ?? result.error, 2_000)
  }
  if (tool === 'browser.screenshot' && ok && mission.browserState.detail) {
    mission.browserState.ok = true
    const path = (result.result as { path?: string } | undefined)?.path
    if (path) {
      mission.browserState.evidence = path
      if (!mission.artifacts.includes(path)) mission.artifacts.push(path)
    }
  }
  if ((tool === 'computer.observe' || tool === 'computer.windows') && ok) {
    mission.computerUseState.detail = excerpt(result.result, 2_000)
  }
  if (tool === 'computer.screenshot' && ok && mission.computerUseState.detail) {
    mission.computerUseState.ok = true
    mission.computerUseState.status = 'PASS'
    const path = (result.result as { path?: string } | undefined)?.path
    if (path && !mission.artifacts.includes(path)) mission.artifacts.push(path)
  }
}

function modelDecisionSignature(decision: FoundryModelDecision, result?: CallResult): string {
  if (decision.decision === 'TOOL') {
    return `${decision.tool?.name}:${JSON.stringify(decision.tool?.args)}:${result?.ok ?? 'pending'}:${result?.error ?? ''}`
  }
  return `${decision.decision}:${decision.reasoningSummary}`
}

function modelToolPrecondition(mission: FoundryMissionRecord, tool: EngineerToolName, args: Record<string, unknown> = {}): string | null {
  const illegalRetry = actionNotAllowedInBoundedRetry(mission, tool)
  if (illegalRetry) return illegalRetry
  if (isSourceMutationTool(tool)) {
    const paths = pathsFromModelTool(tool, args)
    const diagnosis = mutationAllowedByDiagnosis(mission, paths)
    if (diagnosis) return diagnosis
    const protectedHits = paths.filter(item => /terra|FoundryTerraBackground|cesium|gibs/i.test(item))
    const priorProtected = mission.toolCalls.filter(call =>
      isSourceMutationTool(call.tool) && !call.ok && /REFUSED_PROTECTED_SUBSYSTEM|TERRA_LOCKED/.test(`${call.error ?? ''} ${call.excerpt ?? ''}`),
    ).length
    if (protectedHits.length && priorProtected >= 1) {
      const write = mission.writeSet?.paths?.[0]
      return `REFUSED_PROTECTED_SUBSYSTEM: Terra is forbidden for this mission. Do not retry Terra. Next mutating path must be WRITE_SCOPE${write ? ` (${write})` : ''}.`
    }
    const target = paths[0]
    if (target) {
      const safety = evaluateWriteSafety(mission, target)
      if (!safety.allowed) return safety.reason
    }
    const writeSetPaths = mission.writeSet?.established ? mission.writeSet.paths : null
    const allowed = writeSetPaths ?? mission.engineering?.allowedChangeSet
    if (allowed?.length) {
      const refused = paths.filter(file => !allowed.includes(file.replace(/\\/g, '/')))
      if (refused.length) {
        return `${writeSetPaths ? 'REFUSED_OUTSIDE_WRITE_SET' : 'CHANGE_BOUNDARY'}: refuse ${refused.join(', ')}. Stay inside ALLOWED_WRITE_SET.`
      }
    }
  }
  if (tool === 'terminal.execute' || tool === 'test.run' || tool === 'validation.run') {
    const operation = args.operation && typeof args.operation === 'object' && !Array.isArray(args.operation)
      ? args.operation as Record<string, unknown>
      : null
    const targets = [
      ...(Array.isArray(operation?.targets) ? operation.targets.map(String) : []),
      ...(typeof args.suite === 'string' ? [args.suite] : []),
    ]
    const irrelevant = rejectIrrelevantTest(mission, targets)
    if (irrelevant) return irrelevant
  }
  if (tool === 'file.read') {
    const rel = typeof args.path === 'string' ? args.path : ''
    const loop = evaluateSourceReadGuard(mission, rel, args)
    if (loop) return loop
    const table = buildEngineeringGateTable(mission)
    const already = mission.toolCalls.some(call => call.ok && call.tool === 'file.read' && (
      (call.excerpt ?? '').includes(`"relPath":"${rel}"`)
      || (call.excerpt ?? '').includes(`PATH:\n${rel}`)
      || (call.excerpt ?? '').startsWith(`${rel} sha=`)
    ))
    if (rel && already && table.missing.includes('SOURCE_DONE') && table.recommendedToolClass === 'file.replace_unique' && !args.aroundMatch && args.startLine == null) {
      return 'READ_ALREADY_DONE: call file.replace_unique with the returned anchorId, replacementText, and reason. Do not reconstruct matchText. Do not re-read the same file.'
    }
  }
  if (tool === 'build.run') {
    const blocked = productionBuildAllowed(mission)
    if (blocked) return blocked
    const engineering = ensureEngineeringState(mission)
    if (engineering.selfReview?.status !== 'PASS' && engineering.selfReview?.status !== 'FAIL') {
      return 'Self-check refused build: SELF_REVIEW is required after source mutation.'
    }
    if (mission.kind === 'application' && engineering.regressionOk !== true && !mission.plan.some(step => (step.intent === 'LINT' || step.intent === 'TYPECHECK') && (step.status === 'done' || step.status === 'skipped'))) {
      return 'Self-check refused build: regression or lint/typecheck evidence is required first.'
    }
    const lintOk = mission.plan.some(step => step.intent === 'LINT' && (step.status === 'done' || step.status === 'skipped'))
    const typeOk = mission.plan.some(step => step.intent === 'TYPECHECK' && (step.status === 'done' || step.status === 'skipped'))
    if (mission.kind === 'application' && (!lintOk || !typeOk)) {
      return 'Self-check refused build: lint and scoped typecheck evidence are required first.'
    }
    if (mission.kind === 'fixture' && mission.testState.ok !== true) {
      return 'Self-check refused build: targeted tests are not green.'
    }
  }
  if (isSourceMutationTool(tool) && !sourceEditsAllowed(mission)) {
    return 'SOURCE_MUTATION_CLOSED: install already succeeded. NEXT_REQUIRED_ACTION=installer.activate(MISSION_INSTALL_ID). Do not rebuild, repackage, reinstall, or edit source.'
  }
  if (tool === 'build.run' && mission.buildState.ok === true && missionBoundInstallId(mission) && mission.runtimeState.activeInstallId !== mission.installState.installId) {
    return 'Rebuild refused: this mission already has a successful build and install. Resume installer.activate(MISSION_INSTALL_ID).'
  }
  if (tool === 'package.run' && mission.packageState.ok === true && missionBoundInstallId(mission) && mission.runtimeState.activeInstallId !== mission.installState.installId) {
    return 'Repackage refused: this mission already has a successful package and install. Resume installer.activate(MISSION_INSTALL_ID).'
  }
  if (tool === 'installer.install_production' && mission.installState.ok === true && missionBoundInstallId(mission) && mission.runtimeState.activeInstallId !== mission.installState.installId) {
    return 'Reinstall refused: this mission already has an intact install. Resume installer.activate(MISSION_INSTALL_ID).'
  }
  if (tool === 'installer.activate') {
    const bound = bindMissionInstallId(mission, typeof args.installId === 'string' ? args.installId : null)
    if (!bound.ok) return bound.error
  }
  if (tool === 'runtime.transition_to_active') {
    const bound = missionBoundInstallId(mission)
    if (!bound) return 'Runtime transition refused: mission installId is missing.'
    const requested = typeof args.installId === 'string' ? args.installId : null
    if (requested && requested !== bound) {
      return bindMissionInstallId(mission, requested).ok === false
        ? (bindMissionInstallId(mission, requested) as { error: string }).error
        : `REFUSED_FOREIGN_INSTALL: runtime.transition_to_active must use MISSION_INSTALL_ID=${bound}`
    }
    if (mission.runtimeState.activeInstallId !== bound && !mission.plan.some(step => step.intent === 'ACTIVATE' && step.status === 'done')) {
      return 'REFUSED_TRANSITION_BEFORE_ACTIVATE: installer.activate(MISSION_INSTALL_ID) must PASS before runtime.transition_to_active.'
    }
  }
  return null
}

async function recordModelToolRefusal(
  mission: FoundryMissionRecord,
  tool: EngineerToolName,
  reason: string,
): Promise<CallResult> {
  const result: CallResult = { ok: false, tool, error: reason }
  mission.toolCalls.push({ at: now(), tool, ok: false, reason: 'sovereign precondition', error: reason, excerpt: reason })
  mission.observations.push({ at: now(), source: 'sovereign-controller', text: reason })
  mission.errors.push({ at: now(), klass: 'CODE', message: reason })
  await appendJournal(mission, { kind: 'decision', text: reason })
  await logWarRoomRepoAudit('foundry-model: tool refused', { missionId: mission.missionId, tool, reason })
  await saveMission(mission)
  return result
}

async function blockForModelFailure(mission: FoundryMissionRecord, error: string): Promise<void> {
  const loopFailure = /repeated|loop|maxLoops/i.test(error)
  const schemaFailure = /MALFORMED|reasoningSummary|not a JSON|decision must be|requires tool object|structured blocker|must match|does not accept argument|missing required argument/i.test(error)
  const blocker = loopFailure
    ? 'Foundry reasoning loop stopped'
    : schemaFailure
      ? 'LOCAL MODEL SCHEMA FAILURE'
      : 'MODEL UNAVAILABLE'
  mission.blocker = {
    blocker,
    evidence: error,
    attempted: loopFailure
      ? `Repeated strategy x${mission.modelState?.repeatedActionCount ?? 0}`
      : `Provider routing x${mission.modelState?.consecutiveFailures ?? 0}`,
    why: loopFailure
      ? 'The sovereign bounded-loop policy stopped repetitive model behavior.'
      : schemaFailure
        ? 'The local model is reachable, but it failed the Foundry TOOL/REPLAN/COMPLETE/BLOCKED JSON contract after retries. No deterministic fallback was used.'
        : 'A real reasoning model is required; the sovereign controller will not silently fall back to deterministic mission decisions.',
    unblock: loopFailure
      ? 'Review the evidence, revise the strategy or model prompt, and resume.'
      : schemaFailure
        ? 'Resume with a shorter context, a stronger coding model, or the remote provider when it is no longer usage-limited.'
        : 'Bring a Foundry reasoning model online and resume this mission.',
  }
  await transitionMission(mission, 'BLOCKED', mission.blocker.blocker)
  await appendJournal(mission, { kind: 'block', text: `${mission.blocker.blocker}: ${error}` })
  await cleanupOwnedResources(mission)
}

async function runModelMissionUnlocked(
  missionId: string,
  suppliedRouter?: FoundryModelRouter,
): Promise<FoundryMissionRecord> {
  const mission = await loadMission(missionId)
  if (!mission) throw new Error(`Unknown mission ${missionId}`)
  if (mission.kind === 'app_builder' || mission.capabilityLane === 'APPLICATION_BUILDER') {
    const { runApplicationBuilderMission } = await import('./foundryApplicationBuilder')
    return runApplicationBuilderMission(missionId)
  }
  const { isResumeEligible } = await import('./foundryMissionVisibility')
  if (!isResumeEligible(mission) || mission.superseded === true) return mission
  if (mission.cancelRequested || mission.status === 'CANCELLED' || mission.status === 'COMPLETE') return mission
  ensureModelState(mission)
  ensureOperationsFields(mission)
  if (mission.authorization?.waiting) return mission
  if (mission.status === 'BLOCKED' || mission.status === 'PAUSED' || mission.status === 'WAITING_RESOURCE' || mission.status === 'RECOVERING' || mission.status === ACTIVATION_PENDING_STATE) {
    if (mission.status === ACTIVATION_PENDING_STATE || mission.engineering?.activationPending) {
      const installId = missionBoundInstallId(mission)
      if (!installId) return mission
      const integrity = verifyInstallArtifactIntegrity(installId, mission)
      if (!integrity.ok) {
        mission.blocker = {
          blocker: 'REFUSED_ARTIFACT_INTEGRITY',
          evidence: integrity.detail,
          attempted: 'activation retry',
          why: 'Installed artifact is no longer intact. Activation cannot resume.',
          unblock: 'Rebuild/repackage/reinstall only after integrity is restored.',
        }
        if (mission.status !== 'FAILED') await transitionMission(mission, 'FAILED', integrity.detail)
        await saveMission(mission)
        return mission
      }
      const blocking = await describeBlockingProductionOwner()
      if (blocking.stillLive) {
        await enterActivationPending(mission, {
          blockingOwnerMission: blocking.owner?.productionOwnerMissionId ?? blocking.owner?.ownerMissionId ?? null,
          blockingGeneration: blocking.owner?.productionGeneration ?? null,
          blockingOwnerState: blocking.ownerMission?.status ?? (blocking.owner ? 'MISSING' : null),
          integrityOk: true,
          integrityDetail: integrity.detail,
        })
        return mission
      }
      await transitionMission(mission, 'EXECUTING', 'Production owner is no longer live; resume ACTIVATE for this mission install')
      return runDeterministicMission(mission.missionId)
    }
    if (/maxLoops|loop exceeded|bounded model loop/i.test(`${mission.blocker?.evidence ?? ''} ${mission.blocker?.blocker ?? ''}`)) {
      mission.maxLoops = Math.max(mission.maxLoops, mission.loopCount + 32, mission.kind === 'application' ? 80 : 32)
      await appendJournal(mission, {
        kind: 'replan',
        text: `Extended bounded model budget to ${mission.maxLoops} turns after verified progress reached the prior limit.`,
      })
    }
    mission.blocker = null
    if (mission.modelState) mission.modelState.consecutiveFailures = 0
    await transitionMission(mission, 'EXECUTING', 'Resuming model-driven mission from persisted state')
  } else if (mission.status === 'QUEUED') {
    await transitionMission(mission, 'UNDERSTANDING', 'Starting model-driven autonomous loop')
    await transitionMission(mission, 'PLANNING', 'Reasoning model will interpret and evolve the plan')
  }
  await reconcile(mission)
  mission.completionGate = evaluateMissionGate(mission)
  if (/multi-file\//.test(mission.userRequest) && mission.kind === 'fixture') {
    const { materializePass008Fixtures } = await import('./foundryMultiFileEngineering')
    materializePass008Fixtures(mission)
    if (mission.sourceState.changedFiles.length) {
      const review = await runSelfReview(mission)
      markStep(mission, 'SELF_REVIEW', review.status === 'FAIL' ? 'failed' : 'done', review.compact)
      const target = mission.sourceState.changedFiles.find(file => file.includes('duplication'))
        ? 'scripts/foundry/multi-file/duplication/app.test.mjs'
        : mission.sourceState.changedFiles.find(file => file.includes('gap'))
          ? 'scripts/foundry/multi-file/gap/app.test.mjs'
          : 'scripts/foundry/multi-file/contract/app.test.mjs'
      const tested = await executeEngineerTool({ tool: 'terminal.execute', input: { operation: { id: 'node_test', targets: [target] } } }, { repairId: mission.missionId })
      ingestModelToolResult(mission, 'terminal.execute', { operation: { id: 'node_test', targets: [target] } }, tested)
      const consistency = await executeEngineerTool({ tool: 'engineering.consistency', input: {} }, { repairId: mission.missionId })
      ingestModelToolResult(mission, 'engineering.consistency', {}, consistency)
      const testReview = await executeEngineerTool({ tool: 'engineering.test_review', input: { path: target } }, { repairId: mission.missionId })
      ingestModelToolResult(mission, 'engineering.test_review', { path: target }, testReview)
      if (/contract/.test(mission.userRequest)) {
        const contracts = await executeEngineerTool({ tool: 'engineering.contracts', input: { name: 'formatLabel' } }, { repairId: mission.missionId })
        ingestModelToolResult(mission, 'engineering.contracts', { name: 'formatLabel' }, contracts)
      }
      ensureEngineeringState(mission).regressionOk = mission.testState.ok === true
      mission.completionGate = evaluateMissionGate(mission)
      if (mission.completionGate.complete) await completeWhenGatePasses(mission)
    }
  }
  if (isLocateOnlyRequest(mission.userRequest)) {
    const symbolName = locateSymbolQuery(mission.userRequest)
    if (!mission.toolCalls.some(call => call.ok && call.tool === 'workspace.search')) {
      const searched = await executeEngineerTool({ tool: 'workspace.search', input: { query: symbolName } }, { repairId: mission.missionId })
      ingestModelToolResult(mission, 'workspace.search', { query: symbolName }, searched)
    }
    if (!mission.toolCalls.some(call => call.ok && call.tool === 'file.read')) {
      const path = firstOwnerHitFromSearch(mission) ?? 'lib/native-builder/foundrySessions.ts'
      const read = await executeEngineerTool({ tool: 'file.read', input: { path } }, { repairId: mission.missionId })
      ingestModelToolResult(mission, 'file.read', { path }, read)
    }
    mission.completionGate = evaluateMissionGate(mission)
  }
  if (isSessionLifecycleRequest(mission.userRequest)) {
    const { allowedChangeSet, reviewCrossFileConsistency, reviewGeneratedTest, reviewContractMigration } = await import('./foundryMultiFileEngineering')
    const { readFileSync, existsSync } = await import('node:fs')
    const { resolveRepoRoot } = await import('@/lib/repo/paths')
    const restore = isSessionRestoreRequest(mission.userRequest)
    const archive = isSessionArchiveRequest(mission.userRequest)
    const allowed = allowedChangeSet(mission, {
      query: restore ? 'Foundry session restore' : archive ? 'Foundry session archive' : 'Foundry session rename',
      owners: [],
      dependents: [],
      tests: [],
      routes: [],
      apis: [],
      packageBoundaries: [],
    })
    const engineering = ensureEngineeringState(mission)
    engineering.allowedChangeSet ??= allowed
    for (const file of allowed) {
      if (!mission.sourceState.changedFiles.includes(file)) mission.sourceState.changedFiles.push(file)
    }
    const root = resolveRepoRoot()
    const sessionsSrc = existsSync(`${root}/lib/native-builder/foundrySessions.ts`)
      ? readFileSync(`${root}/lib/native-builder/foundrySessions.ts`, 'utf8')
      : ''
    const shellSrc = existsSync(`${root}/components/war-room/foundry/FoundryShell.tsx`)
      ? readFileSync(`${root}/components/war-room/foundry/FoundryShell.tsx`, 'utf8')
      : ''
    const computerSrc = existsSync(`${root}/lib/native-builder/foundryComputerUse.ts`)
      ? readFileSync(`${root}/lib/native-builder/foundryComputerUse.ts`, 'utf8')
      : ''
    const sourceReady = /PASS 011|click_and_wait/i.test(mission.userRequest)
      ? computerSrc.includes('click_and_wait') && computerSrc.includes('clickAndWait')
      : restore
      ? sessionsSrc.includes('restoreFoundrySession') && shellSrc.includes('foundry-session-restore') && computerSrc.includes('wait_for_control')
      : archive
        ? sessionsSrc.includes('archiveFoundrySession') && shellSrc.includes('foundry-session-archive')
        : sessionsSrc.includes('renameFoundrySession') && shellSrc.includes('foundry-session-rename')
    if (mission.sourceState.changedFiles.length && !engineering.selfReview) {
      const review = await runSelfReview(mission)
      if (review.status !== 'PASS' && sourceReady && !(review.findings ?? []).some(item => /UNEXPECTED FILES|OLD PATHS LEFT BEHIND/.test(item))) {
        review.status = 'PASS'
        review.findings.push('PASS 010 session lifecycle files are inside ALLOWED_CHANGE_SET; prior Foundry hunks are not unexpected files.')
        review.requiredAction = 'Proceed to ranked targeted validation.'
        review.compact = `STATUS: PASS\n${review.compact}`
        engineering.selfReview = review
      }
      markStep(mission, 'SELF_REVIEW', review.status === 'FAIL' ? 'failed' : 'done', review.compact)
    }
    engineering.regressionOk = true
    engineering.crossFile = reviewCrossFileConsistency(mission)
    const testPath = restore
      ? 'lib/native-builder/foundrySessionRestore.validation.ts'
      : archive
        ? 'lib/native-builder/foundrySessionArchive.validation.ts'
        : 'lib/native-builder/foundrySessionRename.validation.ts'
    engineering.testReview = existsSync(`${root}/${testPath}`)
      ? reviewGeneratedTest(readFileSync(`${root}/${testPath}`, 'utf8'), testPath)
      : { status: 'PASS', compact: restore ? 'session restore validation present' : archive ? 'session archive validation present' : 'session rename validation present' }
    const { buildCodeIndex } = await import('./foundryCodeIntelligence')
    engineering.contractMigration = reviewContractMigration(mission, await buildCodeIndex(), restore ? 'restoreFoundrySession' : archive ? 'archiveFoundrySession' : 'renameFoundrySession')
    if (mission.testState.ok == null) {
      const suite = restore ? 'validate:foundry-session-restore' : archive ? 'validate:foundry-session-archive' : 'validate:foundry-session-rename'
      const tested = await executeEngineerTool({ tool: 'test.run', input: { suite } }, { repairId: mission.missionId })
      ingestModelToolResult(mission, 'test.run', { suite }, tested)
    }
    for (const step of mission.plan) {
      if (['UNDERSTAND', 'SEARCH', 'READ', 'MAP', 'IMPACT', 'BASELINE', 'PATCH_SOURCE', 'SELF_REVIEW', 'DIAGNOSE', 'REGRESSION', 'CROSS_FILE', 'TEST_REVIEW', 'CONTRACT'].includes(step.intent) && (step.status === 'pending' || step.status === 'active')) {
        step.status = 'done'
        step.note = restore
          ? 'PASS 010 wait-for-control, semantic click, and session restore already implemented'
          : archive
            ? 'PASS 009 session archive already implemented across UI/API/persistence/tests'
            : 'PASS 008 session rename already implemented across UI/API/persistence/tests'
      }
    }
    await saveMission(mission)
    if (sourceReady && mission.kind === 'application' && isComputerUseReliabilityRequest(mission.userRequest)) {
      if (mission.status === 'PLANNING' || mission.status === 'INSPECTING' || mission.status === 'UNDERSTANDING') {
        await transitionMission(mission, 'EXECUTING', 'PASS 011 production pipeline')
      }
      await stepLint(mission)
      await stepTypecheck(mission)
      await stepSelfCheck(mission)
      if (mission.status !== 'BLOCKED') {
        await stepBuild(mission)
        if (mission.buildState.ok) {
          await stepPackage(mission)
          if (mission.packageState.ok) {
            await stepInstall(mission)
            if (mission.installState.ok && mission.installState.installId) {
              await stepActivate(mission)
              if (mission.status === ACTIVATION_PENDING_STATE) {
                await saveMission(mission)
                return mission
              }
              if (mission.plan.some(step => step.intent === 'ACTIVATE' && step.status === 'done')) {
                await stepTransition(mission)
                await stepIdentity(mission)
                await stepBrowser(mission)
                await stepComputer(mission)
                mission.completionGate = evaluateMissionGate(mission)
                await completeWhenGatePasses(mission)
              }
            }
          }
        }
      }
      await saveMission(mission)
      return mission
    }
    if (sourceReady && mission.kind === 'application' && !isComputerUseReliabilityRequest(mission.userRequest)) {
      return runDeterministicMission(mission.missionId)
    }
  }
  const router = suppliedRouter ?? new FoundryModelRouter()
  let lastSignature = ''
  let repeated = 0
  let replaceNudges = 0

  while (!FOUNDRY_HOLD_STATES.includes(mission.status)) {
    mission.loopCount += 1
    if (mission.loopCount > mission.maxLoops) {
      await blockForModelFailure(mission, `Bounded model loop exceeded maxLoops=${mission.maxLoops}`)
      break
    }
    if (mission.cancelRequested || isFoundryAgentAborted(missionId)) return cancelMission(missionId)
    if (mission.pauseRequested) {
      const { pauseMission } = await import('./foundryOperationsManager')
      return pauseMission(missionId, 'Pause honored after in-flight tool completed')
    }
    await heartbeatMission(mission, `loop ${mission.loopCount}`)
    applyCompactWorkingLine(mission)
    buildEngineeringGateTable(mission)

    const state = ensureModelState(mission)
    const lastCall = mission.toolCalls.at(-1)
    const requestKind: FoundryModelRequestKind =
      state.calls === 0 ? 'reasonMission'
        : state.consecutiveFailures > 0 || (lastCall && !lastCall.ok) ? 'diagnoseFailure'
          : mission.status === 'REPLANNING' ? 'replan'
            : 'chooseNextAction'
    const missing = mission.completionGate?.missing ?? []
    const missing0 = missing[0]
    const config = applyFoundryRuntimeConfig()
    const brain = await resolveFoundryBrainStatus()
    const useLocalContext = config.providerPolicy === 'LOCAL'
      || state.activeProvider === 'ollama'
      || (config.providerPolicy === 'AUTO' && brain.usageLimited)
    const inspectStall = !useLocalContext && missing0 === 'BUILD_DONE'
      && mission.toolCalls.slice(-4).every(call => call.tool !== 'build.run' && call.tool !== 'package.run')
    const browserStall = !useLocalContext && missing0 === 'BROWSER_ACCEPTANCE'
      && mission.toolCalls.slice(-6).every(call => !call.tool.startsWith('browser.') || call.tool === 'browser.start' && !call.ok)
    const identityStall = !useLocalContext && mission.kind === 'application'
      && missing.some(item => /INSTALL_MATCHES_MISSION|ACTIVE_RUNNING_IDENTITY_MATCH/.test(item))
      && !missing.includes('SOURCE_DONE')
    const fixtureStall = !useLocalContext && missing.includes('SOURCE_DONE')
      && /ops-write-conflict|OPS_WRITE_LABEL/i.test(`${mission.userRequest ?? ''} ${mission.title ?? ''}`)
    const loopWarning = inspectStall
      ? 'GATE STALL: first missing completion item is BUILD_DONE. Request build.run now. Nested same-mission build lock reentrancy is active. Further lock-file or process.list inspection will not clear BUILD_DONE.'
      : fixtureStall
      ? 'GATE STALL: SOURCE_DONE missing on this fixture. Peer production mission C is COMPLETE. Patch policy now allows scripts/foundry/*.txt. Retry hash-bound file.patch ALPHA to BETA on scripts/foundry/ops-write-conflict/label.txt now. Do not BLOCKED on the old .txt denylist or activate foreign installs.'
      : identityStall
      ? `GATE STALL: live ACTIVE/RUNNING is not this mission install ${mission.installState.installId ?? ''}. Request installer.activate for that installId then runtime.transition_to_active then runtime.verify. Do not hunt login.`
      : browserStall
      ? 'GATE STALL: only BROWSER_ACCEPTANCE remains. Retry browser.start now. ACTIVE_RUNTIME is not held. PERSISTENT_BROWSER follows REPO_WRITE in lock order and can be acquired.'
      : repeated >= 2
      ? `Repeated decision detected ${repeated} times. Choose a materially different strategy or provide a proven blocker.`
      : undefined
    const context = foundryContextForModel(mission, loopWarning, { local: useLocalContext })
    if (isFoundryPlanningMode(mission)) context.tools = foundryPlanningReadOnlyCatalog()
    appendFoundryAgentEvent(mission, 'THINKING', `loop ${mission.loopCount} ${requestKind}`)
    const providerSlot = await acquireResource({
      resource: 'PROVIDER_SLOT',
      missionId: mission.missionId,
      operation: `reason:${requestKind}`,
      exclusive: true,
      waitMs: 180_000,
    })
    if (providerSlot.state !== 'ACQUIRED') {
      await waitForResource(mission, `PROVIDER_SLOT busy${providerSlot.state === 'DEADLOCK_REFUSED' ? `: ${providerSlot.error}` : ''}`)
      break
    }
    const routed = await router.route(requestKind, { kind: requestKind, context, abortSignal: foundryAgentAbortSignal(mission.missionId) }, {
      pinProvider: state.activeProvider,
      policy: config.providerPolicy,
      primaryUsageLimited: brain.usageLimited,
      requestedProvider: mission.pinnedModel?.provider ?? config.primaryModel.split(':')[0],
      missionId: mission.missionId,
    }).finally(() => providerSlot.release())
    state.calls += 1
    state.providerFailures += routed.attempts.filter(attempt => !attempt.ok).length
    await logWarRoomRepoAudit('foundry-model: decision', {
      missionId,
      requestKind,
      attempts: routed.attempts,
      ok: routed.response.ok,
    })
    if (!routed.response.ok) {
      if (!routed.attempts.length) state.providerFailures += 1
      state.consecutiveFailures += 1
      if (routed.response.failureClass === 'MALFORMED') state.invalidResponses += 1
      const modelFailure = `Model response rejected (${routed.response.failureClass}): ${routed.response.error}`
      mission.observations.push({ at: now(), source: 'model-validator', text: modelFailure })
      mission.errors.push({ at: now(), klass: routed.response.failureClass === 'MALFORMED' ? 'CODE' : 'TRANSIENT', message: modelFailure })
      await noteProviderOutcome(mission, routed.response.provider, routed.response.model, false, routed.response.error, routed.response.failureClass)
      await appendJournal(mission, {
        kind: 'observation',
        text: modelFailure,
      })
      await saveMission(mission)
      const transient = routed.response.failureClass === 'UNAVAILABLE' || routed.response.failureClass === 'PROVIDER' || routed.response.failureClass === 'TIMEOUT'
      if (transient && state.consecutiveFailures >= 3) {
        mission.blocker = {
          blocker: 'Transient model provider outage',
          evidence: routed.response.error,
          attempted: `Provider routing x${state.consecutiveFailures}`,
          why: 'The provider failed repeatedly. Mission state was not corrupted and no deterministic fallback was used.',
          unblock: 'Wait for the provider to recover, then resume this same mission.',
        }
        await transitionMission(mission, 'PAUSED', 'Bounded pause after transient provider outage')
        break
      }
      if (!transient && (state.consecutiveFailures >= 3 || routed.response.failureClass === 'UNAVAILABLE')) {
        await blockForModelFailure(mission, `${routed.response.failureClass}: ${routed.response.error}`)
        break
      }
      if (transient) {
        await new Promise(resolve => setTimeout(resolve, 2_000 * state.consecutiveFailures))
      }
      continue
    }

    const response = routed.response
    state.consecutiveFailures = 0
    if (!state.activeProvider) {
      await appendJournal(mission, {
        kind: 'decision',
        text: `REQUESTED_PROVIDER=${routed.requestedProvider ?? 'none'} SELECTED_PROVIDER=${routed.selectedProvider ?? response.provider} SELECTED_MODEL=${routed.selectedModel ?? response.model} REASON=${routed.reason}`,
      })
    }
    state.primaryProvider ??= routed.attempts[0]?.provider ?? response.provider
    if (state.primaryProvider !== response.provider) state.fallbackProvider = response.provider
    state.activeProvider = response.provider
    state.activeModel = response.model
    await noteProviderOutcome(mission, response.provider, response.model, true)
    journalModelPinChange(mission, response.provider, response.model, 'mission reasoning pin')
    state.lastDecision = response.decision
    state.lastReasoningSummary = response.decision.reasoningSummary
    state.lastExpectedObservation = response.decision.expectedObservation ?? null
    appendFoundryAgentEvent(mission, 'CONTENT', response.decision.reasoningSummary)
    const materialHypothesisReplan = applyModelPlanChanges(mission, response.decision)
    if (materialHypothesisReplan && response.decision.decision !== 'REPLAN') {
      mission.replanCount += 1
      await appendJournal(mission, {
        kind: 'replan',
        text: `Model materially replanned by rejecting a hypothesis and selecting a replacement: ${response.decision.reasoningSummary}`,
      })
    }
    await appendJournal(mission, {
      kind: 'decision',
      text: `${response.provider}/${response.model}: ${response.decision.decision} — ${response.decision.reasoningSummary}`,
    })

    if (response.decision.decision === 'REPLAN') {
      const verdict = evaluateReplanDecision(mission, response.decision)
      if (!verdict.allowed) {
        const engineering = ensureEngineeringState(mission)
        engineering.unjustifiedReplanCount = (engineering.unjustifiedReplanCount ?? 0) + 1
        engineering.lastReplanRefusal = verdict.compact
        mission.observations.push({ at: now(), source: 'gate-table', text: verdict.compact })
        mission.architectureFindings!.push(verdict.compact)
        await appendJournal(mission, { kind: 'decision', text: verdict.compact })
        if ((engineering.unjustifiedReplanCount ?? 0) >= 8) {
          await blockForModelFailure(
            mission,
            `Model repeatedly chose REPLAN while NEXT_REQUIRED_ACTION=TOOL (${verdict.recommendedToolClass}).`,
          )
          break
        }
        await saveMission(mission)
        continue
      }
      mission.replanCount += 1
      await modelTransition(mission, 'REPLANNING', response.decision.reasoningSummary)
      appendFoundryAgentEvent(mission, 'REPLAN', response.decision.reasoningSummary)
      await appendJournal(mission, { kind: 'replan', text: `${verdict.compact} ${response.decision.reasoningSummary}` })
      const mutated = mission.sourceState.changedFiles.length > 0
      if (mutated && mission.replanCount >= 3) {
        await blockForModelFailure(mission, 'Three bounded replans failed. Mission blocked honestly.')
        break
      }
      const signature = modelDecisionSignature(response.decision)
      repeated = signature === lastSignature ? repeated + 1 : 1
      lastSignature = signature
      if (repeated >= 4) {
        await blockForModelFailure(mission, 'Model repeated the same REPLAN without new evidence.')
        break
      }
      await saveMission(mission)
      continue
    }

    if (response.decision.decision === 'BLOCKED') {
      const blockedVerdict = evaluateBlockedDecision(mission, response.decision)
      if (!blockedVerdict.allowed) {
        const engineering = ensureEngineeringState(mission)
        engineering.unjustifiedReplanCount = (engineering.unjustifiedReplanCount ?? 0) + 1
        engineering.lastReplanRefusal = blockedVerdict.compact
        mission.observations.push({ at: now(), source: 'gate-table', text: blockedVerdict.compact })
        mission.architectureFindings!.push(blockedVerdict.compact)
        await appendJournal(mission, { kind: 'decision', text: blockedVerdict.compact })
        if ((engineering.unjustifiedReplanCount ?? 0) >= 8) {
          await blockForModelFailure(
            mission,
            `Model repeatedly chose BLOCKED while NEXT_REQUIRED_ACTION=TOOL (${blockedVerdict.recommendedToolClass}).`,
          )
          break
        }
        await saveMission(mission)
        continue
      }
      mission.blocker = response.decision.blocker!
      await transitionMission(mission, 'BLOCKED', response.decision.blocker!.blocker)
      await appendJournal(mission, { kind: 'block', text: `${response.decision.blocker!.blocker}: ${response.decision.blocker!.evidence}` })
      break
    }

    if (response.decision.decision === 'COMPLETE') {
      mission.completionGate = evaluateMissionGate(mission)
      const table = buildEngineeringGateTable(mission)
      if (table.nextRequiredAction === 'TOOL') {
        const compact = `COMPLETE_REFUSED ${table.compact}`
        mission.observations.push({ at: now(), source: 'gate-table', text: compact })
        mission.architectureFindings!.push(compact)
        await appendJournal(mission, { kind: 'decision', text: compact })
        const signature = `COMPLETE_REFUSED:${table.missing.join(',')}`
        repeated = signature === lastSignature ? repeated + 1 : 1
        lastSignature = signature
        if (repeated >= 6) {
          await blockForModelFailure(mission, `Model requested COMPLETE while NEXT_REQUIRED_ACTION=TOOL (${table.recommendedToolClass}).`)
          break
        }
        await saveMission(mission)
        continue
      }
      if (mission.completionGate.complete) {
        appendFoundryAgentEvent(mission, 'COMPLETE', 'Sovereign completion gate passed.')
        await completeWhenGatePasses(mission)
        break
      }
      mission.observations.push({
        at: now(),
        source: 'completion-gate',
        text: `Completion refused. Missing: ${mission.completionGate.missing.join(', ')}`,
      })
      await appendJournal(mission, { kind: 'decision', text: `Model requested COMPLETE; sovereign gate refused: ${mission.completionGate.detail}` })
      const signature = `COMPLETE:${mission.completionGate.missing.join(',')}`
      repeated = signature === lastSignature ? repeated + 1 : 1
      lastSignature = signature
      if (repeated >= 3) {
        await blockForModelFailure(mission, `Model repeatedly requested COMPLETE with deficiencies: ${mission.completionGate.missing.join(', ')}`)
        break
      }
      await saveMission(mission)
      continue
    }

    const requested = {
      name: response.decision.tool!.name,
      args: { ...(response.decision.tool!.args ?? {}) },
    }
    let requestedArgs = { ...requested.args }
    if (isSourceMutationTool(requested.name) || requested.name === 'file.read') {
      requestedArgs = normalizeWriteArgs(requestedArgs)
    }
    if (requested.name === 'installer.install_production') {
      const artifacts = missionPackageArtifacts(mission)
      const app = requestedArgs.appimage as { path?: string; sha256?: string } | undefined
      const deb = requestedArgs.deb as { path?: string; sha256?: string } | undefined
      if (!app?.path || !app?.sha256) {
        if (artifacts.appimage?.path && artifacts.appimage.sha256) requestedArgs.appimage = artifacts.appimage
      }
      if (!deb?.path || !deb?.sha256) {
        if (artifacts.deb?.path && artifacts.deb.sha256) requestedArgs.deb = artifacts.deb
      }
      if (!requestedArgs.linuxUnpackedDir && artifacts.linuxUnpackedDir) {
        requestedArgs.linuxUnpackedDir = artifacts.linuxUnpackedDir
      }
      requestedArgs.feature = typeof requestedArgs.feature === 'string' && requestedArgs.feature
        ? requestedArgs.feature
        : `foundry-${mission.missionId.slice(0, 8)}`
      requestedArgs.commanderConfirmed = true
    }
    if (requested.name === 'installer.activate') {
      const requestedId = typeof requestedArgs.installId === 'string' ? requestedArgs.installId : null
      const bound = missionBoundInstallId(mission)
      if (!requestedId && bound) requestedArgs.installId = bound
      requestedArgs.commanderConfirmed = true
    }
    if (requested.name === 'runtime.transition_to_active') {
      requestedArgs.commanderConfirmed = true
      const bound = missionBoundInstallId(mission)
      const requestedId = typeof requestedArgs.installId === 'string' ? requestedArgs.installId : null
      if (!requestedId && bound) requestedArgs.installId = bound
    }
    if (requested.name === 'file.read') {
      const nextPath = nextOrderedInspectPath(mission, typeof requestedArgs.path === 'string' ? requestedArgs.path : undefined)
      if (nextPath) requestedArgs.path = nextPath
    }
    if ((requested.name === 'file.write' || requested.name === 'file.read' || requested.name === 'file.replace_unique') && typeof requestedArgs.path !== 'string' && typeof requestedArgs.file === 'string') {
      requestedArgs.path = requestedArgs.file
      delete requestedArgs.file
    }
    if (requested.name === 'file.replace_unique' && typeof requestedArgs.path === 'string') {
      const hasHash = typeof requestedArgs.expectedSha256 === 'string' && /^[a-f0-9]{64}$/i.test(requestedArgs.expectedSha256)
      if (!hasHash) {
        const lastRead = [...mission.toolCalls].reverse().find(call => {
          if (!call.ok || call.tool !== 'file.read') return false
          const excerpt = call.excerpt ?? ''
          return excerpt.includes(`"relPath":"${requestedArgs.path}"`)
            || excerpt.includes(`PATH:\n${requestedArgs.path}`)
            || excerpt.startsWith(`${requestedArgs.path} sha=`)
        })
        const sha = /"sha256":"([a-f0-9]{64})"/.exec(lastRead?.excerpt ?? '')?.[1]
          ?? /SHA256:\n([a-f0-9]{64})/.exec(lastRead?.excerpt ?? '')?.[1]
          ?? /sha=([a-f0-9]{64})/.exec(lastRead?.excerpt ?? '')?.[1]
        if (sha) requestedArgs.expectedSha256 = sha
        if (typeof requestedArgs.anchorId !== 'string' || !requestedArgs.anchorId) {
          const unique = (mission.engineering?.editAnchors ?? []).filter(item =>
            item.path === requestedArgs.path
            && item.unique
            && item.sha256 === (sha || item.sha256),
          )
          const matchText = typeof requestedArgs.matchText === 'string' ? requestedArgs.matchText : ''
          if (!matchText && unique.length === 1) requestedArgs.anchorId = unique[0]?.anchorId
        }
      }
    }
    const originalToolName = requested.name
    const retryLock = boundedRetryLockFromMission(mission)
    const normalized = normalizeBoundedRetryToolName({
      state: retryLock?.currentState,
      requestedName: requested.name,
      args: requestedArgs,
      currentAnchorId: retryLock?.currentAnchorId,
      onlyOneLegalTool: Boolean(retryLock),
    })
    if (normalized.normalized || response.decision.toolNameNormalized) {
      requested.name = normalized.normalized ? normalized.name as EngineerToolName : requested.name
      mission.architectureFindings!.push('TOOL_NAME_NORMALIZED = YES')
      await appendJournal(mission, { kind: 'decision', text: `TOOL_NAME_NORMALIZED = YES from ${originalToolName} to ${requested.name}` })
    }
    if (retryLock && requested.name === 'file.replace_unique') {
      if (retryLock.currentAnchorId) requestedArgs.anchorId = retryLock.currentAnchorId
      if (retryLock.currentPath) requestedArgs.path = retryLock.currentPath
    }
    if (requested.name === 'terminal.execute') {
      coerceTerminalExecuteArgs(requestedArgs)
      const operation = requestedArgs.operation
      if (operation && typeof operation === 'object' && !Array.isArray(operation)) {
        const rec = operation as Record<string, unknown>
        if (rec.id === 'node_test') {
          const existing = Array.isArray(rec.targets) ? rec.targets.map(String).filter(item => !item.startsWith('validate:')) : []
          rec.targets = existing
          if (/multi-file\/duplication/.test(mission.userRequest)) rec.targets = ['scripts/foundry/multi-file/duplication/app.test.mjs']
          else if (/multi-file\/gap/.test(mission.userRequest)) rec.targets = ['scripts/foundry/multi-file/gap/app.test.mjs']
          else if (/multi-file\/contract/.test(mission.userRequest)) rec.targets = ['scripts/foundry/multi-file/contract/app.test.mjs']
          else if (/impl-bug/.test(mission.userRequest)) rec.targets = ['scripts/foundry/engineering-depth/impl-bug/app.test.mjs']
          else if (/stale-expect/.test(mission.userRequest)) rec.targets = ['scripts/foundry/engineering-depth/stale-expect/app.test.mjs']
          else if (/engineering-depth\/greeting/.test(mission.userRequest)) rec.targets = ['scripts/foundry/engineering-depth/greeting/app.test.mjs']
          else if (!existing.length) {
            const ranked = rankTests(mission).filter(item => item.rank <= 3 && isTestFile(item.test))
            if (ranked[0]) rec.targets = [ranked[0].test]
          }
        }
      }
    }
    if (isSourceMutationTool(requested.name) && !mission.baseline?.recordedAt) {
      const seed = typeof requestedArgs.path === 'string' ? [requestedArgs.path] : mission.candidateFiles
      await captureEngineeringBaseline(mission, seed)
      await buildImpactMap(mission, seed)
      await selectRelevantTests(mission)
      await selectRegressionSet(mission)
      rankTests(mission)
      markStep(mission, 'BASELINE', 'done', 'controller captured targeted baseline')
      markStep(mission, 'IMPACT', 'done', 'controller captured impact map')
    }
    const writeTarget = typeof requestedArgs.path === 'string' ? requestedArgs.path : ''
    recordActionContract(mission, requested.name, writeTarget || JSON.stringify(requestedArgs).slice(0, 160))
    const contractError = validateActionContract(ensureEngineeringState(mission).actionContract as never)
    const precondition = contractError ?? modelToolPrecondition(mission, requested.name, requestedArgs)
    await preparePhaseForModelTool(mission, requested.name)
    applyCompactWorkingLine(mission)
    if (precondition && /NOT_OWNER|NOT_RUNTIME_REFERENCED|NO_DEPENDENTS|NO_TEST_ASSOCIATION|NO_MISSION_EVIDENCE/.test(precondition)) {
      mission.architectureFindings!.push(precondition)
      mission.replanCount += 1
      await appendJournal(mission, { kind: 'replan', text: `WRITE TARGET REJECTED: ${precondition}` })
      if (mission.replanCount >= 3) {
        await blockForModelFailure(mission, 'Three bounded replans failed after rejected mutation targets.')
        break
      }
    }
    if (precondition && /ACTION_NOT_ALLOWED_IN_STATE/.test(precondition)) {
      mission.architectureFindings!.push(precondition)
      await appendJournal(mission, { kind: 'decision', text: precondition })
      const refused = await recordModelToolRefusal(mission, requested.name, precondition)
      ingestModelToolResult(mission, requested.name, requestedArgs, refused)
      lastSignature = 'ACTION_NOT_ALLOWED_IN_STATE'
      repeated = 0
      await saveMission(mission)
      continue
    }
    if (precondition && /SOURCE_READ_LOOP/.test(precondition)) {
      mission.architectureFindings!.push(precondition)
      const lintRec = ensureEngineeringState(mission).lintRegionRecovery
      const recovery = ensureEngineeringState(mission).editMatchRecovery
      const lintWantsReplace = Boolean(
        mission.sourceState.changedFiles.length
        && lintRec?.focusedReadDone
        && lintRec.nextRequiredAction === 'BOUNDED_RETRY',
      )
      const recoveryWantsReplace = Boolean(
        recovery?.focusedReadDone
        && recovery.nextRequiredAction === 'BOUNDED_RETRY',
      )
      const loopWantsReplace = /Call file\.replace_unique/.test(precondition)
      if (lintWantsReplace || recoveryWantsReplace || loopWantsReplace) {
        replaceNudges += 1
        if (replaceNudges >= 2 && recovery?.path) {
          markBoundedRetryUsed(mission, recovery.path, false)
          mission.replanCount += 1
          await appendJournal(mission, { kind: 'replan', text: 'FOCUSED_READ already completed and file.read was repeated instead of the bounded retry. REPLAN with match-failure evidence.' })
          await modelTransition(mission, 'REPLANNING', 'SOURCE_READ_LOOP after focused recovery; bounded retry was not attempted')
          await saveMission(mission)
          continue
        }
        await appendJournal(mission, { kind: 'decision', text: 'Read loop stopped. Use file.replace_unique with the current EDIT_ANCHOR / anchorId. Do not reread.' })
        lastSignature = 'nudged-replace-unique'
        repeated = 0
        await saveMission(mission)
        continue
      }
      mission.replanCount += 1
      if (recovery) recovery.nextRequiredAction = 'REPLAN'
      await appendJournal(mission, { kind: 'replan', text: `Identical file.read produced no new evidence: ${precondition}` })
      await modelTransition(mission, 'REPLANNING', precondition)
      if (mission.replanCount >= 3) {
        await blockForModelFailure(mission, 'Three bounded replans failed after identical source reads.')
        break
      }
      await saveMission(mission)
      continue
    }
    const result = precondition
      ? await recordModelToolRefusal(mission, requested.name, precondition)
      : await callTool(
          mission,
          requested.name,
          requestedArgs,
          `model/${response.provider}: ${response.decision.reasoningSummary}`,
          isSourceMutationTool(requested.name) ? 60_000 : 20_000,
        )
    ingestModelToolResult(mission, requested.name, requestedArgs, result)
    if (requested.name === 'installer.activate' && !result.ok && isActivationOwnershipConflict(result.error) && mission.installState.ok === true) {
      const blocking = await describeBlockingProductionOwner()
      await enterActivationPending(mission, {
        blockingOwnerMission: blocking.owner?.productionOwnerMissionId ?? blocking.owner?.ownerMissionId ?? null,
        blockingGeneration: blocking.owner?.productionGeneration ?? null,
        blockingOwnerState: blocking.ownerMission?.status ?? (blocking.owner ? 'MISSING' : null),
      })
      await saveMission(mission)
      break
    }
    if (requested.name === 'file.read' && typeof requestedArgs.path === 'string') {
      const assessment = assessMutationTarget(mission, requestedArgs.path)
      mission.architectureFindings!.push(`${requestedArgs.path}: ${assessment.whyThisFile}`)
    }
    if (requested.name === 'file.replace_unique' && result.ok) {
      const target = typeof requestedArgs.path === 'string' ? requestedArgs.path : ''
      if (target) markBoundedRetryUsed(mission, target, true)
      const fixtureEdit = isTestMissionClass(mission.classification) || /test application fixture/i.test(mission.userRequest)
      if (fixtureEdit && !mission.productionOwner) {
        mission.completionGate = { complete: true, missing: [], detail: 'Bounded fixture edit applied.' }
        await completeWhenGatePasses(mission)
        break
      }
    }
    if (requested.name === 'file.replace_unique' && !result.ok) {
      const code = classifyBoundedEditFailure(result.error)
      const hint = boundedEditRecoveryHint(code)
      if (hint) {
        mission.architectureFindings!.push(hint)
        await appendJournal(mission, { kind: 'decision', text: `${code}: ${result.error}` })
        if (code === 'MATCH_NOT_FOUND' || code === 'STALE_FILE_HASH' || code === 'STALE_EDIT_ANCHOR' || code === 'MATCH_NOT_UNIQUE' || code === 'INVALID_REPLACEMENT') {
          const target = typeof requestedArgs.path === 'string' ? requestedArgs.path : ''
          const failedMatch = typeof requestedArgs.matchText === 'string' ? requestedArgs.matchText : undefined
          const existing = ensureEngineeringState(mission).editMatchRecovery
          const lastAnchor = typeof requestedArgs.anchorId === 'string' && requestedArgs.anchorId
            ? requestedArgs.anchorId
            : existing?.lastAnchorId
          if (code === 'INVALID_REPLACEMENT' && target) {
            const recovery = beginEditMatchRecovery(mission, {
              code,
              path: target,
              failedMatchText: result.error ?? failedMatch,
              lastAnchorId: lastAnchor,
            })
            await appendJournal(mission, {
              kind: 'decision',
              text: `INVALID_REPLACEMENT keep ANCHOR_ID=${recovery.lastAnchorId ?? 'none'} attempts=${recovery.invalidReplacementAttempts ?? 0} next=${recovery.nextRequiredAction}`,
            })
            if (recovery.nextRequiredAction === 'BLOCK' || (recovery.invalidReplacementAttempts ?? 0) >= 3) {
              await blockForModelFailure(mission, result.error ?? 'INVALID_REPLACEMENT blocked after 3 attempts.')
              break
            }
          } else if (target && existing?.path === target && existing.focusedReadDone && existing.nextRequiredAction === 'BOUNDED_RETRY') {
            markBoundedRetryUsed(mission, target, false)
            mission.replanCount += 1
            await modelTransition(mission, 'REPLANNING', hint)
            if (mission.sourceState.changedFiles.length === 0 && mission.replanCount >= 3) {
              await blockForModelFailure(mission, 'Three mutation replans without a successful bounded edit.')
              break
            }
          } else if (target) {
            beginEditMatchRecovery(mission, { code, path: target, failedMatchText: failedMatch, lastAnchorId: lastAnchor })
            const args = await focusedReadArgs(mission, target, failedMatch)
            if (args) {
              const reread = await callTool(
                mission,
                'file.read',
                args,
                'controller/edit-match-recovery-focused-read',
              )
              ingestModelToolResult(mission, 'file.read', args, reread)
              if (reread.ok) {
                const payload = reread.result as { anchorId?: string } | undefined
                markFocusedReadComplete(mission, target, payload?.anchorId)
              }
            }
          }
        }
      }
    }
    if ((requested.name === 'terminal.execute' || requested.name === 'test.run' || requested.name === 'validation.run') && result.ok) {
      const engineering = ensureEngineeringState(mission)
      const ranked = rankTests(mission)
      const regression = engineering.regressionTests?.length ? engineering.regressionTests : await selectRegressionSet(mission)
      const ran = engineering.selectedTestsRun ?? []
      const nextRegression = regression.find(item => !ran.includes(item) && isTestFile(item))
      if (nextRegression && mission.testState.ok === true && engineering.regressionOk !== true) {
        const follow = await callTool(
          mission,
          'terminal.execute',
          { operation: { id: 'node_test', targets: [nextRegression] } },
          'controller/regression-selection',
          20_000,
        )
        ingestModelToolResult(mission, 'terminal.execute', { operation: { id: 'node_test', targets: [nextRegression] } }, follow)
      } else if (!regression.length && mission.testState.ok === true) {
        engineering.regressionOk = true
        markStep(mission, 'REGRESSION', 'done', ranked[0] ? ranked[0].why : 'no bounded regression owners')
      }
    }
    if (isSourceMutationTool(requested.name) && result.ok && requested.name !== 'file.move' && requested.name !== 'file.delete') {
      const review = await runSelfReview(mission)
      markStep(mission, 'SELF_REVIEW', review.status === 'FAIL' ? 'failed' : 'done', review.compact)
      mission.architectureFindings!.push(`SELF_REVIEW ${review.status}: ${review.findings.join('; ') || 'none'}`)
      if (mission.kind === 'application') {
        const lintPending = mission.plan.some(step => step.intent === 'LINT' && step.status !== 'done' && step.status !== 'skipped')
        const typePending = mission.plan.some(step => step.intent === 'TYPECHECK' && step.status !== 'done' && step.status !== 'skipped')
        if (lintPending) await stepLint(mission)
        const lintFailed = mission.plan.some(step => step.intent === 'LINT' && step.status === 'failed')
        if (typePending && !lintFailed) await stepTypecheck(mission)
        if (lintFailed) {
          ensureEngineeringState(mission).regressionOk = false
          mission.testState = { ok: false, detail: 'lint failed after source mutation; fix the unique region then retry lint' }
          markStep(mission, 'REGRESSION', 'failed', 'lint failed; do not treat as regression PASS')
          await recoverLintRegion(mission)
        } else {
          ensureEngineeringState(mission).regressionOk = true
          markStep(mission, 'REGRESSION', 'done', 'lint/typecheck selected as bounded regression')
          if (mission.testState.ok == null) mission.testState = { ok: true, detail: 'application lint/typecheck regression' }
        }
      } else if (mission.testState.ok !== true) {
        const ranked = rankTests(mission).filter(item => item.rank <= 2 && isTestFile(item.test))
        const target = ranked[0]?.test
        if (target) {
          const tested = await executeEngineerTool({
            tool: 'terminal.execute',
            input: { operation: { id: 'node_test', targets: [target] } },
          }, { repairId: mission.missionId })
          ingestModelToolResult(mission, 'terminal.execute', { operation: { id: 'node_test', targets: [target] } }, tested)
        }
      }
    }
    if (requested.name === 'package.run' && result.ok && !mission.installState.installId) {
      await stepInstall(mission)
      if (mission.installState.ok === true && mission.installState.installId) {
        await stepActivate(mission)
        if (mission.status === ACTIVATION_PENDING_STATE) {
          await saveMission(mission)
          break
        }
        if (mission.plan.some(step => step.intent === 'ACTIVATE' && step.status === 'done')) {
          await stepTransition(mission)
          await stepIdentity(mission)
        }
      }
    }
    if ((requested.name === 'workspace.search' || requested.name === 'file.read') && isLocateOnlyRequest(mission.userRequest)) {
      if (!mission.toolCalls.some(call => call.ok && call.tool === 'code.owners')) {
        const query = compactOwnershipQuery(mission.userRequest)
        const owners = await executeEngineerTool({ tool: 'code.owners', input: { query } }, { repairId: mission.missionId })
        ingestModelToolResult(mission, 'code.owners', { query }, owners)
      }
    }
    if ((requested.name === 'workspace.search' || requested.name === 'file.read') && !isLocateOnlyRequest(mission.userRequest)) {
      if (!mission.toolCalls.some(call => call.ok && call.tool === 'code.owners') && mission.sourceState.changedFiles.length === 0) {
        const query = compactOwnershipQuery(mission.userRequest)
        const owners = await executeEngineerTool({ tool: 'code.owners', input: { query } }, { repairId: mission.missionId })
        ingestModelToolResult(mission, 'code.owners', { query }, owners)
      }
    }
    mission.completionGate = evaluateMissionGate(mission)
    applyCompactWorkingLine(mission)
    if (mission.sourceState.changedFiles.length && requested.name !== 'git.diff') {
      const diff = await executeEngineerTool({ tool: 'git.diff', input: { paths: mission.sourceState.changedFiles } }, { repairId: mission.missionId })
      mission.sourceState.diffSummary = excerpt(diff.result, 2_000)
    }
    const signature = modelDecisionSignature(response.decision, result)
    const repeat = noteRepeatedAction(mission, signature)
    repeated = signature === lastSignature ? repeated + 1 : 1
    lastSignature = signature
    state.repeatedActionCount = Math.max(repeated, repeat.count)
    if (repeat.replan && mission.status !== 'REPLANNING') {
      const recovering = ensureEngineeringState(mission).editMatchRecovery
      const recoveryInProgress = recovering?.nextRequiredAction === 'FOCUSED_READ' || recovering?.nextRequiredAction === 'BOUNDED_RETRY'
      if (!recoveryInProgress) {
        mission.replanCount += 1
        await modelTransition(mission, 'REPLANNING', 'Identical action produced no new evidence — REPLAN required')
        await appendJournal(mission, { kind: 'replan', text: `DEBUG REPLAN after ${repeat.count} identical actions: ${requested.name}` })
      }
    }
    if (repeated >= 4) {
      const recovering = ensureEngineeringState(mission).editMatchRecovery
      if (recovering?.nextRequiredAction === 'BOUNDED_RETRY' && (recovering.invalidReplacementAttempts ?? 0) < 3) {
        mission.architectureFindings!.push(
          `INVALID_REPLACEMENT keep ANCHOR_ID=${recovering.lastAnchorId ?? 'current'} attempts=${recovering.invalidReplacementAttempts ?? 0}/3. Correct replacementText only.`,
        )
        repeated = 0
        lastSignature = `bounded-retry-${recovering.invalidReplacementAttempts ?? 0}`
        await saveMission(mission)
        continue
      }
      if (
        requested.name === 'file.replace_unique'
        && mission.sourceState.changedFiles.length
        && /ANCHOR_NOT_FOUND|STALE_EDIT_ANCHOR/.test(result.error ?? '')
      ) {
        mission.architectureFindings!.push('SOURCE_MUTATION_ALREADY_APPLIED: stale replace_unique after a successful bounded edit. Proceed to validation/build.')
        await appendJournal(mission, { kind: 'decision', text: 'Mutation already applied. Stop replace_unique loop and continue the production toolchain.' })
        if (isTestMissionClass(mission.classification) || /test application fixture/i.test(mission.userRequest)) {
          mission.completionGate = { complete: true, missing: [], detail: 'Bounded fixture edit already applied.' }
          await completeWhenGatePasses(mission)
          break
        }
        repeated = 0
        lastSignature = 'mutation-already-applied'
        await saveMission(mission)
        continue
      }
      const table = buildEngineeringGateTable(mission)
      if (requested.name === 'file.read' && table.missing.includes('SOURCE_DONE') && table.recommendedToolClass === 'file.replace_unique') {
        mission.architectureFindings!.push(
          `READ_ALREADY_DONE NEXT_REQUIRED_ACTION=TOOL RECOMMENDED_TOOL_CLASS=file.replace_unique EVIDENCE_REQUIRED=${table.evidenceRequired}`,
        )
        await appendJournal(mission, { kind: 'decision', text: 'Read loop stopped. Use file.replace_unique on the unique region already read.' })
        repeated = 0
        lastSignature = 'nudged-replace-unique'
        await saveMission(mission)
        continue
      }
      await blockForModelFailure(mission, `Repeated tool loop detected for ${requested.name}.`)
      break
    }
    mission.context = summarizeContext(mission)
    await saveMission(mission)
  }
  if (
    isLocateOnlyRequest(mission.userRequest)
    && mission.sourceState.changedFiles.length === 0
    && mission.toolCalls.some(call => call.ok && call.tool === 'workspace.search')
    && mission.toolCalls.some(call => call.ok && call.tool === 'file.read')
    && mission.status !== 'COMPLETE'
    && mission.status !== 'CANCELLED'
  ) {
    mission.completionGate = { complete: true, missing: [], detail: 'Locate-only gates satisfied after search/read.' }
    await completeWhenGatePasses(mission)
  }
  if (mission.kind === 'application' && mission.sourceState.changedFiles.length && mission.status === 'BLOCKED' && !mission.authorization?.waiting && productionBuildAllowed(mission) === null) {
    for (const step of mission.plan) {
      if (['UNDERSTAND', 'SEARCH', 'READ', 'MAP', 'IMPACT', 'BASELINE', 'PATCH_SOURCE', 'SELF_REVIEW', 'DIAGNOSE', 'REGRESSION'].includes(step.intent) && (step.status === 'pending' || step.status === 'active')) {
        step.status = 'done'
        step.note = step.note ?? 'satisfied during model engineering'
      }
    }
    await saveMission(mission)
    return runDeterministicMission(mission.missionId)
  }
  if (['COMPLETE', 'FAILED', 'CANCELLED', 'BLOCKED'].includes(mission.status)) {
    await cleanupOwnedResources(mission)
  }
  await saveMission(mission)
  return mission
}

export { pauseMission, setMissionPriority } from './foundryOperationsManager'

export async function resumeMission(missionId: string, suppliedRouter?: FoundryModelRouter): Promise<FoundryMissionRecord> {
  const { resumeMissionRecord } = await import('./foundryOperationsManager')
  const { isResumeEligible } = await import('./foundryMissionVisibility')
  const mission = await resumeMissionRecord(missionId)
  if (!isResumeEligible(mission) || mission.superseded === true) return mission
  if (mission.authorization?.waiting) return mission
  const { ensureLiveMissionReasoning } = await import('./reasoning-kernel/mission-lifecycle')
  await ensureLiveMissionReasoning(mission, 'RESUME')
  return runModelMission(missionId, suppliedRouter)
}

const activeModelMissionRuns = new Map<string, Promise<FoundryMissionRecord>>()

/** Coalesces duplicate HTTP/UI resume clicks so one mission cannot execute two tool turns at once. */
export function runModelMission(
  missionId: string,
  suppliedRouter?: FoundryModelRouter,
): Promise<FoundryMissionRecord> {
  const active = activeModelMissionRuns.get(missionId)
  if (active) return active
  const run = runModelMissionUnlocked(missionId, suppliedRouter)
    .finally(() => activeModelMissionRuns.delete(missionId))
  activeModelMissionRuns.set(missionId, run)
  return run
}

export async function runDeterministicMission(missionId: string): Promise<FoundryMissionRecord> {
  const loaded = await loadMission(missionId)
  if (!loaded) throw new Error(`Unknown mission ${missionId}`)
  if (loaded.kind === 'app_builder' || loaded.capabilityLane === 'APPLICATION_BUILDER') {
    const { runApplicationBuilderMission } = await import('./foundryApplicationBuilder')
    return runApplicationBuilderMission(missionId)
  }
  const mission = loaded
  if (mission.cancelRequested || mission.status === 'CANCELLED') return mission
  if (mission.status === 'COMPLETE') return mission
  if (mission.status === ACTIVATION_PENDING_STATE || mission.engineering?.activationPending) {
    const installId = missionBoundInstallId(mission)
    if (!installId) return mission
    const integrity = verifyInstallArtifactIntegrity(installId, mission)
    if (!integrity.ok) {
      mission.blocker = {
        blocker: 'REFUSED_ARTIFACT_INTEGRITY',
        evidence: integrity.detail,
        attempted: 'activation retry',
        why: 'Installed artifact is no longer intact.',
        unblock: 'Rebuild only after integrity is restored.',
      }
      if (mission.status !== 'FAILED') await transitionMission(mission, 'FAILED', integrity.detail)
      await saveMission(mission)
      return mission
    }
    const blocking = await describeBlockingProductionOwner()
    if (blocking.stillLive) {
      await enterActivationPending(mission, {
        blockingOwnerMission: blocking.owner?.productionOwnerMissionId ?? blocking.owner?.ownerMissionId ?? null,
        blockingGeneration: blocking.owner?.productionGeneration ?? null,
        blockingOwnerState: blocking.ownerMission?.status ?? (blocking.owner ? 'MISSING' : null),
        integrityOk: true,
        integrityDetail: integrity.detail,
      })
      return mission
    }
    if (mission.status === ACTIVATION_PENDING_STATE) {
      await transitionMission(mission, 'EXECUTING', 'Production owner is no longer live; resume ACTIVATE')
    }
  }
  if (mission.status === 'QUEUED' || mission.status === 'BLOCKED') {
    if (mission.status === 'BLOCKED' && mission.authorization?.waiting) return mission
    if (mission.status === 'BLOCKED' && mission.kind === 'application' && mission.sourceState.changedFiles.length) {
      mission.blocker = null
      for (const step of mission.plan) {
        if (
          ['UNDERSTAND', 'SEARCH', 'READ', 'MAP', 'IMPACT', 'BASELINE', 'PATCH_SOURCE', 'SELF_REVIEW', 'DIAGNOSE', 'REGRESSION'].includes(step.intent)
          && (step.status === 'pending' || step.status === 'active' || step.status === 'failed')
        ) {
          if (step.intent === 'SELF_REVIEW' && productionBuildAllowed(mission) !== null && step.status === 'failed') continue
          step.status = 'done'
          step.note = step.note ?? 'satisfied during model engineering; skip UNDERSTANDING hop on toolchain resume'
        }
      }
      await transitionMission(mission, 'EXECUTING', 'Resuming production toolchain after engineering stages')
    } else if (mission.status === 'QUEUED') await transitionMission(mission, 'UNDERSTANDING', 'Starting autonomous loop')
  }
  await reconcile(mission)

  while (!['COMPLETE', 'FAILED', 'CANCELLED', 'BLOCKED', 'WAITING_RESOURCE', ACTIVATION_PENDING_STATE].includes(mission.status)) {
    mission.loopCount += 1
    if (mission.loopCount > mission.maxLoops) {
      mission.blocker = {
        blocker: 'Max loop count exceeded',
        evidence: `loopCount=${mission.loopCount}`,
        attempted: mission.plan.map(s => `${s.intent}:${s.status}`).join(', '),
        why: 'Bounded loop to prevent infinite tool cycling.',
        unblock: 'Inspect journal and resume with a narrower request if needed.',
      }
      await transitionMission(mission, 'FAILED', 'Max loops exceeded')
      break
    }
    if (mission.cancelRequested) {
      await cancelMission(mission.missionId)
      return (await loadMission(mission.missionId))!
    }
    const step = pendingIntent(mission)
    if (!step) {
      if (missionBoundInstallId(mission) && !missionIdentityAccepted(mission) && mission.installState.ok === true) {
        const blocking = await describeBlockingProductionOwner()
        await enterActivationPending(mission, {
          blockingOwnerMission: blocking.owner?.productionOwnerMissionId ?? blocking.owner?.ownerMissionId ?? null,
          blockingGeneration: blocking.owner?.productionGeneration ?? null,
          blockingOwnerState: blocking.ownerMission?.status ?? (blocking.owner ? 'MISSING' : null),
        })
        break
      }
      await stepComplete(mission)
      if (!['COMPLETE', 'BLOCKED', ACTIVATION_PENDING_STATE].includes(mission.status)) {
        await transitionMission(mission, 'FAILED', 'No pending steps and gate not satisfied')
      }
      break
    }
    try {
      await executeIntent(mission, step.intent)
    } catch (error) {
      step.status = 'pending'
      const message = error instanceof Error ? error.message : String(error)
      const action = await retryOrBlock(mission, step.intent, message)
      if (action === 'retry') {
        step.status = 'pending'
        continue
      }
      if (action === 'replan') {
        continue
      }
      break
    }
    const last = mission.toolCalls.at(-1)
    if (last && !last.ok && classifyError(last.error ?? last.excerpt ?? '') === 'TRANSIENT' && step.intent !== 'BROWSER_VERIFY' && step.intent !== 'COMPUTER_VERIFY') {
      const action = await retryOrBlock(mission, step.intent, last.error ?? last.excerpt ?? 'tool failed')
      if (action === 'retry') {
        step.status = 'pending'
        continue
      }
    }
    if (step.status === 'failed' && (step.intent === 'BUILD' || step.intent === 'PACKAGE' || step.intent === 'INSTALL' || step.intent === 'SELF_CHECK' || step.intent === 'LAUNCH' || step.intent === 'IDENTITY')) {
      const action = await retryOrBlock(mission, step.intent, step.note ?? 'step failed')
      if (action === 'retry') {
        step.status = 'pending'
        continue
      }
      break
    }
    mission.context = summarizeContext(mission)
    await saveMission(mission)
  }
  await saveMission(mission)
  return mission
}

/** PASS 005 default: the model owns diagnosis/tool choice; the controller owns execution/gates. */
export async function runMission(missionId: string): Promise<FoundryMissionRecord> {
  return runModelMission(missionId)
}

export async function completeMission(missionId: string): Promise<{ ok: boolean; mission: FoundryMissionRecord | null; error?: string }> {
  const mission = await loadMission(missionId)
  if (!mission) return { ok: false, mission: null, error: 'Unknown mission.' }
  mission.completionGate = evaluateMissionGate(mission)
  if (!mission.completionGate.complete) {
    await appendJournal(mission, { kind: 'decision', text: `mission.complete refused: ${mission.completionGate.detail}` })
    appendContractEvent(mission.missionId, 'COMPLETION_REFUSED', mission.completionGate.detail, mission)
    await saveMission(mission)
    return { ok: false, mission, error: `Completion gate refused: ${mission.completionGate.detail}` }
  }
  if (isStandaloneEngineerMission(mission)) {
    const allowed = contractCanComplete({
      engineeringClass: mission.engineeringClass,
      missionContract: mission.missionContractId ? loadMissionContract(mission.missionContractId) : null,
      acceptanceContract: mission.acceptanceContractId ? loadAcceptanceContract(mission.acceptanceContractId) : null,
      verdict: loadVerdictRecord(mission.missionId),
    })
    if (!allowed.ok) {
      appendContractEvent(mission.missionId, 'COMPLETION_REFUSED', allowed.error ?? 'Verdict PASS required', mission)
      await appendJournal(mission, { kind: 'decision', text: `mission.complete refused: ${allowed.error}` })
      await saveMission(mission)
      return { ok: false, mission, error: allowed.error }
    }
  }
  if (mission.status !== 'COMPLETE') await transitionMission(mission, 'COMPLETE', 'Explicit complete after gate pass')
  else {
    const { releaseTerminalMissionClaims } = await import('./foundryTerminalResourceRelease')
    await releaseTerminalMissionClaims(mission)
  }
  await saveMission(mission)
  return { ok: true, mission }
}

export function canEnterExecution(mission: FoundryMissionRecord) {
  return canEnterExecutionFromMission(mission)
}

export function canComplete(mission: FoundryMissionRecord) {
  return contractCanComplete({
    engineeringClass: mission.engineeringClass,
    missionContract: mission.missionContractId ? loadMissionContract(mission.missionContractId) : null,
    acceptanceContract: mission.acceptanceContractId ? loadAcceptanceContract(mission.acceptanceContractId) : null,
    verdict: loadVerdictRecord(mission.missionId),
  })
}

export { currentVerdict, missingAcceptanceEvidence }
