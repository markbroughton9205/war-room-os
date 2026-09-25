/**
 * Commander-facing Foundry projections over existing mission/project/session truth.
 * Not a second orchestration layer — maps stored state into READY / WORKING / RESULT UI.
 */
import {
  FOUNDRY_TERMINAL_STATES,
  type FoundryMissionRecord,
  type FoundryMissionState,
  type FoundryMissionStep,
} from './foundryMissionTypes'
import {
  APPLICATION_BUILDER_CRM_PORT,
  APPLICATION_BUILDER_DATA_APP_PORT,
  APPLICATION_BUILDER_DEFAULT_PORT,
  type FoundryNewProjectRecord,
} from './foundryApplicationBuilderTypes'
import { WAR_ROOM_CANONICAL_WORKSPACE_ID } from './foundryWorkspaceIdentityCore'

const TEST_CLASSES = new Set(['SYSTEM_TEST', 'ACCEPTANCE_FIXTURE', 'CONTRACT_TEST', 'RECOVERY_TEST'])

export type CommanderWorkCandidate = Pick<FoundryMissionRecord, 'status' | 'title' | 'userRequest' | 'goal'> & Partial<Pick<FoundryMissionRecord,
  'classification' | 'testArtifact' | 'visibility' | 'archived' | 'superseded' | 'kind' | 'resumeEligible' | 'pauseRequested' | 'recovery' | 'lockClaims' | 'activeToolCallId' | 'authorization' | 'updatedAt' | 'currentAction'
>>

export const FOUNDRY_ACTIVE_COMMANDER_STATES: readonly FoundryMissionState[] = [
  'QUEUED',
  'UNDERSTANDING',
  'INSPECTING',
  'PLANNING',
  'EXECUTING',
  'VALIDATING',
  'BUILDING',
  'PACKAGING',
  'INSTALLING',
  'VERIFYING',
  'REPLANNING',
  'WAITING_AUTHORIZATION',
  'WAITING_RESOURCE',
  'BLOCKED',
]

export type FoundryCompactProviderMode = 'READY' | 'LOCAL' | 'REMOTE' | 'HYBRID' | 'BLOCKED' | 'UNKNOWN'

export type FoundryCommanderProgressItem = {
  id: string
  label: string
  state: 'done' | 'active' | 'pending' | 'failed'
}

export type FoundryCommanderProgress = {
  headline: 'FOUNDRY WORKING' | 'NEEDS YOUR INPUT' | 'FOUNDRY READY'
  title: string
  currentStage: string
  items: FoundryCommanderProgressItem[]
  blockedReason: string | null
}

export type FoundryCommanderResultCard = {
  kind: 'PROJECT_READY' | 'SITE_READY' | 'COMPLETE'
  openLabel: 'Open App' | 'Open Website'
  projectName: string
  summary: string
  previewUrl: string | null
  previewLive: boolean
  tests: string | null
  persistence: string | null
  desktop: string | null
  mobile: string | null
  filesChanged: number
  projectId: string | null
}

export type FoundryCommanderProjectCard = {
  id: string
  name: string
  kind: string
  root: string
  runtimeStatus: 'RUNNING' | 'STOPPED' | 'BUILDING' | 'NEEDS_ATTENTION'
  previewUrl: string | null
  previewPort: number | null
  previewLive: boolean
  previewOwnership: 'owned' | 'external' | 'none'
  lastWorkedAt: string | null
  systemProject: boolean
  applicationProjectId: string | null
}

const HUMAN_STAGE: Record<string, string> = {
  understand: 'Understanding what you want',
  research: 'Researching requirements',
  requirements: 'Planning the build',
  stack: 'Planning the build',
  project_create: 'Creating project',
  patch_source: 'Building interface',
  self_review: 'Reviewing the build',
  test: 'Running tests',
  diagnose: 'Fixing a problem',
  launch: 'Launching preview',
  browser: 'Checking desktop',
  preview: 'Project ready',
  complete: 'Project ready',
  search: 'Understanding what you want',
  read: 'Understanding what you want',
  map: 'Planning the build',
  impact: 'Planning the build',
  baseline: 'Planning the build',
  lint: 'Running tests',
  typecheck: 'Running tests',
  build: 'Building interface',
}

export function looksLikeHistoricalPassMission(text: string): boolean {
  return /\bpass 0\d{2}\b/i.test(text)
    || /semantic stability|semantic lifecycle|click_and_wait/i.test(text)
    || /computer use proof|validator mission|proof mission|test harness/i.test(text)
}

export function isHistoricalSystemMission(mission: CommanderWorkCandidate): boolean {
  if (mission.testArtifact === true || mission.visibility === 'system' || mission.archived === true || mission.superseded === true) {
    return true
  }
  if (mission.classification && TEST_CLASSES.has(mission.classification)) return true
  return looksLikeHistoricalPassMission(`${mission.title}\n${mission.userRequest}\n${mission.goal}`)
}

export function isTerminalCommanderMission(status: string | undefined): boolean {
  return FOUNDRY_TERMINAL_STATES.includes(status as FoundryMissionState)
    || status === 'PROJECT_READY'
}

export function isInertRecoveredLeftover(mission: CommanderWorkCandidate): boolean {
  if (!mission.recovery?.recovered) return false
  if (mission.pauseRequested) return false
  if (mission.authorization?.waiting) return false
  if (mission.activeToolCallId) return false
  if ((mission.lockClaims ?? []).length > 0) return false
  return mission.status === 'PAUSED' || mission.status === 'WAITING_RESOURCE' || mission.status === 'RECOVERING'
}

export function isActiveCommanderMission(mission: CommanderWorkCandidate): boolean {
  if (isHistoricalSystemMission(mission)) return false
  if (mission.resumeEligible === false || mission.archived === true || mission.superseded === true) return false
  if (isTerminalCommanderMission(mission.status)) return false
  if (isInertRecoveredLeftover(mission)) return false
  if (mission.status === 'PAUSED') return mission.pauseRequested === true
  if (mission.status === 'RECOVERING') return false
  return FOUNDRY_ACTIVE_COMMANDER_STATES.includes(mission.status as FoundryMissionState)
}

export function selectCurrentCommanderWork<T extends CommanderWorkCandidate>(
  missions: T[],
): T | null {
  const live = missions.filter(isActiveCommanderMission)
  if (!live.length) return null
  return [...live].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))[0] ?? null
}

export function recoverStaleCurrentMissionPointer<T extends CommanderWorkCandidate>(
  mission: T | null | undefined,
): T | null {
  if (!mission) return null
  if (!isActiveCommanderMission(mission)) return null
  return mission
}

function humanizeAction(value: string | undefined): string | null {
  if (!value) return null
  const key = value.replace(/\.run$/i, '').toLowerCase().trim()
  if (HUMAN_STAGE[key]) return HUMAN_STAGE[key]
  if (/\.\w+$/.test(value)) return null
  return null
}

function humanStageForStep(step: Pick<FoundryMissionStep, 'id' | 'intent' | 'title'> | undefined): string {
  if (!step) return 'Working'
  return HUMAN_STAGE[step.id]
    ?? HUMAN_STAGE[step.intent?.toLowerCase?.() ?? '']
    ?? humanizeAction(step.title)
    ?? (/^[a-z0-9_.]+$/i.test(step.title) && step.title.includes('.') ? 'Working' : step.title)
}

function commanderBlockedReason(mission: Pick<FoundryMissionRecord, 'blocker' | 'authorization' | 'status'>): string | null {
  if (mission.status !== 'BLOCKED' && !mission.authorization?.waiting) return null
  const human = mission.blocker?.unblock || mission.blocker?.blocker || mission.authorization?.reason
  if (!human) return 'Foundry needs a decision before it can continue.'
  return human.replace(/\s+/g, ' ').trim().slice(0, 240)
}

export function commanderProgressFromMission(mission: Pick<FoundryMissionRecord, 'title' | 'status' | 'plan' | 'currentStep' | 'currentAction' | 'blocker' | 'authorization' | 'journal'>): FoundryCommanderProgress {
  const blocked = commanderBlockedReason(mission)
  const active = mission.plan.find(step => step.status === 'active')
    ?? mission.plan.find(step => step.id === mission.currentStep)
  const items: FoundryCommanderProgressItem[] = mission.plan
    .filter(step => HUMAN_STAGE[step.id] || step.status !== 'pending')
    .map(step => ({
      id: step.id,
      label: humanStageForStep(step),
      state: step.status === 'done' ? 'done' : step.status === 'failed' ? 'failed' : step.status === 'active' ? 'active' : 'pending',
    }))
  const unique: FoundryCommanderProgressItem[] = []
  for (const item of items) {
    if (unique.some(existing => existing.label === item.label && existing.state === item.state)) continue
    unique.push(item)
  }
  const currentStage = blocked
    ? blocked
    : active
      ? humanStageForStep(active)
      : humanizeAction(mission.currentAction) ?? 'Working'
  return {
    headline: blocked ? 'NEEDS YOUR INPUT' : 'FOUNDRY WORKING',
    title: mission.title,
    currentStage,
    items: unique.slice(0, 12),
    blockedReason: blocked,
  }
}

type CommanderResultMission = Pick<FoundryMissionRecord, 'status' | 'title' | 'userRequest' | 'goal' | 'classification' | 'testArtifact' | 'visibility' | 'archived' | 'superseded' | 'kind' | 'applicationBuilder' | 'testState' | 'sourceState' | 'completionGate' | 'engineeringClass' | 'missionContractId' | 'acceptanceContractId' | 'missionContractHash' | 'acceptanceContractHash' | 'contractSpecApproved' | 'reviewOutcome' | 'missionId'> & {
  contractVerdict?: { projectReadyAdmissible: boolean; verdict: string } | null
}

export function commanderResultFromMission(mission: CommanderResultMission): FoundryCommanderResultCard | null {
  if (isHistoricalSystemMission(mission)) return null
  if (!isTerminalCommanderMission(mission.status) || mission.status === 'FAILED' || mission.status === 'CANCELLED') {
    if (mission.applicationBuilder?.preview?.status !== 'PROJECT_READY') return null
  }
  if (mission.status === 'FAILED' || mission.status === 'CANCELLED') return null
  const preview = mission.applicationBuilder?.preview
  const project = mission.applicationBuilder?.project
  const kind = commanderResultKind(project?.projectType)
  const viewports = mission.applicationBuilder?.viewportResults ?? []
  const desktop = viewports.find(item => item.name === 'desktop')
  const mobile = viewports.find(item => item.name === 'mobile')
  if (mission.status !== 'COMPLETE' && preview?.status !== 'PROJECT_READY') return null
  if (mission.engineeringClass === 'STANDALONE_ENGINEER') {
    const verdictView = mission.contractVerdict
    if (verdictView) {
      if (!verdictView.projectReadyAdmissible || verdictView.verdict !== 'PASS') return null
    } else if (mission.reviewOutcome !== 'PASS' || mission.contractSpecApproved !== true) {
      return null
    }
  }
  return {
    kind,
    openLabel: commanderOpenLabel(kind),
    projectName: preview?.projectName || project?.projectName || mission.title,
    summary: preview?.whatWasBuilt || 'Foundry finished this project.',
    previewUrl: preview?.localPreview ?? null,
    previewLive: Boolean(preview?.localPreview),
    tests: preview?.testStatus || (mission.testState.ok === true ? 'passed' : mission.testState.ok === false ? 'failed' : null),
    persistence: /sqlite|persist/i.test(`${preview?.whatWasBuilt ?? ''} ${preview?.majorFeatures?.join(' ') ?? ''}`) ? 'Verified' : null,
    desktop: desktop ? (desktop.ok ? 'Verified' : 'Needs attention') : (preview?.viewportStatus ?? null),
    mobile: mobile ? (mobile.ok ? 'Verified' : 'Needs attention') : null,
    filesChanged: (mission.sourceState.changedFiles?.length ?? 0) + (mission.sourceState.newFiles?.length ?? 0),
    projectId: project?.projectId ?? null,
  }
}

export function compactProviderStatus(input: {
  localReady?: boolean
  remoteReady?: boolean
  usageLimited?: boolean
  known?: boolean
}): { mode: FoundryCompactProviderMode; blocking: boolean; detail: string } {
  if (input.known === false) return { mode: 'UNKNOWN', blocking: false, detail: 'Provider status is still loading.' }
  const local = input.localReady === true
  const remote = input.remoteReady === true && input.usageLimited !== true
  if (!local && !remote) {
    return { mode: 'BLOCKED', blocking: true, detail: 'No usable local or remote model is available.' }
  }
  if (local && remote) return { mode: 'READY', blocking: false, detail: 'HYBRID' }
  if (local && input.usageLimited) return { mode: 'LOCAL', blocking: false, detail: 'Remote limited. Using local model.' }
  if (local) return { mode: 'LOCAL', blocking: false, detail: 'Local model ready.' }
  return { mode: 'REMOTE', blocking: false, detail: 'Remote model ready.' }
}

export function commanderResultKind(projectType?: string | null): 'PROJECT_READY' | 'SITE_READY' {
  return projectType === 'static_website' ? 'SITE_READY' : 'PROJECT_READY'
}

export function commanderOpenLabel(kind: 'PROJECT_READY' | 'SITE_READY' | 'COMPLETE'): 'Open App' | 'Open Website' {
  return kind === 'SITE_READY' ? 'Open Website' : 'Open App'
}

export function commanderProjectKind(project: Pick<FoundryNewProjectRecord, 'projectType' | 'projectName'> | { projectType?: string; system?: boolean }): string {
  if ('system' in project && project.system) return 'System Project'
  const type = 'projectType' in project ? project.projectType : undefined
  if (type === 'internal_business_tool') return 'CRM'
  if (type === 'database_backed_app') return 'Application'
  if (type === 'static_website') return 'Website'
  if (type === 'full_stack_web_app' || type === 'frontend_web_app') return 'Application'
  if (type === 'backend_api') return 'API'
  return 'Project'
}

export function preferredPreviewPort(project: Pick<FoundryNewProjectRecord, 'projectType'>): number {
  if (project.projectType === 'internal_business_tool') return APPLICATION_BUILDER_CRM_PORT
  if (project.projectType === 'database_backed_app' || project.projectType === 'full_stack_web_app') return APPLICATION_BUILDER_DATA_APP_PORT
  return APPLICATION_BUILDER_DEFAULT_PORT
}

export function projectRuntimeStatus(input: {
  live: boolean
  building?: boolean
  needsAttention?: boolean
  projectStatus?: string
}): FoundryCommanderProjectCard['runtimeStatus'] {
  if (input.building || input.projectStatus === 'ENGINEERING' || input.projectStatus === 'VERIFYING' || input.projectStatus === 'REPAIRING') {
    return input.live ? 'RUNNING' : 'BUILDING'
  }
  if (input.needsAttention || input.projectStatus === 'FAILED' || input.projectStatus === 'WAITING_COMMANDER') return 'NEEDS_ATTENTION'
  if (input.live) return 'RUNNING'
  return 'STOPPED'
}

export function warRoomSystemProjectCard(root: string): FoundryCommanderProjectCard {
  return {
    id: WAR_ROOM_CANONICAL_WORKSPACE_ID,
    name: 'War Room OS',
    kind: 'System Project',
    root,
    runtimeStatus: 'STOPPED',
    previewUrl: null,
    previewPort: null,
    previewLive: false,
    previewOwnership: 'none',
    lastWorkedAt: null,
    systemProject: true,
    applicationProjectId: null,
  }
}

export function countVisiblePass011AsCurrent(missions: Array<Pick<FoundryMissionRecord, 'status' | 'title' | 'userRequest' | 'goal' | 'classification' | 'testArtifact' | 'visibility' | 'archived' | 'superseded' | 'kind' | 'currentAction' | 'updatedAt'>>): {
  pass011AsCurrent: number
  typecheckRunAsCurrent: number
} {
  const current = selectCurrentCommanderWork(missions)
  const hay = current ? `${current.title}\n${current.userRequest}\n${current.currentAction ?? ''}` : ''
  return {
    pass011AsCurrent: current && /pass 011|semantic stability/i.test(hay) ? 1 : 0,
    typecheckRunAsCurrent: current && /typecheck\.run/i.test(current.currentAction ?? '') && looksLikeHistoricalPassMission(hay) ? 1 : 0,
  }
}
