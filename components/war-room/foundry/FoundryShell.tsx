'use client'

/**
 * THE FOUNDRY — Commander coding workspace.
 * One prompt. Automatic orchestration. Live work stream.
 * Agents/Tasks command center shows real execution only.
 */
import { Suspense, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { BuilderWorkspace } from '@/components/war-room/builder/BuilderWorkspace'
import { looksLikeNewApplication, projectNameFromPrompt, statusNarrative, toCommanderState } from '@/lib/native-builder/foundryCommanderState'
import { isApplicationBuilderRequest } from '@/lib/native-builder/foundryRequirementsEngine'
import { persistFoundryResume, readFoundryResume } from '@/lib/native-builder/foundryNavigation'
import { buildFoundryCompletionTruth } from '@/lib/native-builder/foundryCompletionTruth'
import { buildEngineeringCompletionTruth } from '@/lib/native-builder/foundryCompletionHistory'
import { buildQuietThread, type QuietBlockedDetail, type QuietCampaign, type QuietEvent } from '@/lib/native-builder/foundryQuietPresentation'
import {
  buildContextView,
  buildModelRegistryView,
  contextFilesUrl,
  insertContextReference,
  parseComposerMode,
  resolveContextFiles,
  type FilesListedFor,
  type FoundryComposerMode,
} from '@/lib/native-builder/foundryComposerModel'
import type { NativeValidationResult } from '@/lib/native-builder/types'
import {
  commanderProgressFromMission,
  commanderResultFromMission,
  compactProviderStatus,
  isActiveCommanderMission,
  isHistoricalSystemMission,
  recoverStaleCurrentMissionPointer,
  type CommanderWorkCandidate,
} from '@/lib/native-builder/foundryCommanderExperience'
import {
  WAR_ROOM_CANONICAL_WORKSPACE_ID,
  isWarRoomSelfEditRequest,
  resolveFoundryMissionWorkspace,
} from '@/lib/native-builder/foundryWorkspaceIdentityCore'
import {
  FOUNDRY_LIVE_MISSION_STATES,
  foundryToneClass,
  foundryVisualForState,
  groupFoundrySessionsByDay,
  relativeSessionTime,
  researchFreshnessLabel,
  sessionHistoryKind,
  shortSessionTitle,
  workstreamMarker,
} from '@/lib/native-builder/foundryVisualState'
import { MatrixBackground } from '@/components/war-room/MatrixBackground'
import {
  FOUNDRY_TERRA_QUERY_KEY,
  isTerraBuildRequest,
  isTerraSourcePath,
  parseFoundryTerraContext,
  terraBuildContextBinding,
} from '@/lib/native-builder/foundryTerraContext'
import { FoundryContextMenu, type FoundryContextMenuState } from './FoundryContextMenu'
import { FoundryHomeNav } from './FoundryHomeNav'
import { FoundryTerraBackground } from './FoundryTerraBackground'
import { FoundryMissionControllerPanel } from './FoundryMissionControllerPanel'
import { FoundryOperationsPanel } from './FoundryOperationsPanel'
import { FoundryCapabilitiesPanel } from './FoundryCapabilitiesPanel'
import { FoundryBrowser } from './FoundryBrowser'
import { FoundryTerminal } from './FoundryTerminal'
import { FoundryWorkbenchPane } from './FoundryWorkbenchPane'
import { FoundryWorkbenchAiPanel } from './FoundryWorkbenchAiPanel'
import { FoundryWorkbenchExtensionsPanel } from './FoundryWorkbenchExtensionsPanel'
import { FoundryAgentCommandCenter } from './FoundryAgentCommandCenter'
import { FoundryContractVerdictPanel } from './FoundryContractVerdictPanel'
import { FoundryQuietThread } from './FoundryQuietThread'
import { FoundryLiveProgressPanel } from './FoundryLiveProgressPanel'
import { buildLiveProgressFromItems } from '@/lib/native-builder/foundryLiveProgress'
import { FoundryComposer } from './FoundryComposer'
import { resolveSessionListMissionId } from '@/lib/native-builder/foundrySessionResume'
import type { FoundryEngineeringEvent, FoundryEngineeringRuntimeState } from '@/lib/native-builder/foundryEngineeringEvents'
import { commanderStatusHeadline, commanderVisibleSessions, looksLikeInternalSourcePath } from '@/lib/native-builder/foundryCommanderShell'
import type { FoundryCommandCenterSnapshot } from '@/lib/native-builder/foundryAgentTypes'
import type { FoundryContextKind } from '@/lib/native-builder/foundryUxContract'

const DEFAULT_BASE_PATH = '/war-room/engineering'

type SessionItem = {
  id: string
  title: string
  workspaceId?: string
  projectName?: string
  updatedAt: string
  missionIds: string[]
  activeMissionId?: string
  agents: string[]
  chat: { id: string; at: string; speaker: string; text: string }[]
  activity: { at: string; role: string; detail: string }[]
  archived?: boolean
  archivedAt?: string
  archivedBy?: string
}

type WorkspaceItem = {
  id: string
  label: string
  root: string
  projectType?: string
  workspaceType?: string
  displayTitle?: string
  displayKind?: string
  classification?: string
  previewUrl?: string | null
  previewPort?: number | null
  runtimeStatus?: 'RUNNING' | 'STOPPED' | 'BUILDING' | 'NEEDS_ATTENTION'
  lastWorkedAt?: string
  applicationProjectId?: string
  projectKindLabel?: string
  previewLive?: boolean
}

type EngineerState = {
  currentStep?: string
  commanderState?: string
  currentAction?: string
  lastCompletedAction?: string
  nextAction?: string
  plan?: string[]
  filesChanged?: string[]
  validationOutcome?: string
  blockingReason?: string
  failureEvidence?: {
    id: string
    command?: string
    errorSummary: string
    file?: string
    repairAction?: string
  } | null
  workstream?: { id: string; at: string; kind: string; text: string; source: string; path?: string; ok?: boolean }[]
  progressEvents?: { at: string; step: string; detail: string }[]
  terminalHistory?: { at: string; command: string; ok: boolean; stdout: string; stderr: string }[]
  completionTruth?: {
    surface: 'war_room_source' | 'generated_project'
    created: string[]
    modified: string[]
    plus: number
    minus: number
    tests: { ran: boolean; command: string; pass: number; fail: number; total: number; ok: boolean; reason: string }
    canComplete: boolean
    installedRuntimeUpdated: false
    headline: string
    detail: string
    installedSha?: string | null
    sourceHead?: string | null
    sourceDirty?: boolean
  }
  researchProvenance?: { status: string; query: string; sources: { title: string; url: string; kind?: string }[] }
  engineeringRuntime?: FoundryEngineeringRuntimeState
}

type MissionLite = {
  id: string
  status: string
  title: string
  engineer?: EngineerState
  validationResults?: NativeValidationResult[]
  diff?: { diff: string; truncated: boolean; changedFiles: string[] }
}

type FoundryBrainStatus = {
  ready: boolean
  provider: string
  modelId: string
  configuredModel: string
  executablePresent: boolean
  lastError: string | null
  usageLimited: boolean
  detail: string
}

type FoundryStatus = {
  overall: string
  foundryModelStatus?: {
    localCoder: string
    codingModel: string | null
    detail: string
    brain?: FoundryBrainStatus
    localModel?: {
      state: string
      label: string
      model: string | null
      endpoint?: string
      detail: string
    }
    localMissionReliability?: 'VALIDATED' | 'UNPROVEN'
  }
}

type FoundryMissionView = {
  missionId: string
  title: string
  userRequest: string
  status: string
  phase: string
  currentStep: string | null
  currentAction: string | null
  plan: Array<{ id: string; title: string; status: 'pending' | 'active' | 'done' | 'failed' | 'skipped'; intent?: string; note?: string }>
  journal: Array<{ at: string; kind: string; text: string }>
  blocker: { blocker: string; evidence: string; attempted: string; why: string; unblock: string } | null
  authorization: { waiting: boolean; action: string | null; reason: string | null } | null
  classification?: string | null
  testArtifact?: boolean
  visibility?: string
  archived?: boolean
  superseded?: boolean
  kind?: string
  updatedAt?: string
  goal?: string
  resumeEligible?: boolean
  pauseRequested?: boolean
  activeToolCallId?: string | null
  lockClaims?: string[]
  recovery?: { recovered?: boolean; disposition?: string } | null
  applicationPreview?: {
    status: string
    projectName: string
    localPreview: string
    whatWasBuilt?: string
    testStatus?: string
    viewportStatus?: string
    majorFeatures?: string[]
  } | null
  applicationProject?: {
    projectId: string
    projectName: string
    projectRoot: string
    projectType?: string
    status: string
  } | null
  testState?: { ok: boolean | null; detail: string | null }
  sourceState?: { changedFiles?: string[]; newFiles?: string[] }
  completionGate?: { complete: boolean }
  modelState?: { activeProvider: string | null; activeModel: string | null }
  durableToolCalls?: Array<{ tool: string; status: string; resultSummary?: string }>
  capabilityLane?: string
  engineeringClass?: string | null
  missionContractId?: string | null
  acceptanceContractId?: string | null
  missionContractHash?: string | null
  acceptanceContractHash?: string | null
  contractSpecApproved?: boolean
  reviewOutcome?: string | null
  contractVerdict?: import('@/lib/native-builder/foundryContractVerdictView.types').FoundryContractVerdictView | null
}

function toProgressMission(view: FoundryMissionView) {
  return {
    title: view.title,
    status: view.status,
    plan: (view.plan ?? []).map(step => ({
      id: step.id,
      intent: (step.intent ?? 'UNDERSTAND') as 'UNDERSTAND',
      title: step.title,
      status: step.status,
    })),
    currentStep: view.currentStep,
    currentAction: view.currentAction,
    blocker: view.blocker,
    authorization: view.authorization,
    journal: view.journal ?? [],
  }
}

function toResultMission(view: FoundryMissionView) {
  return {
    status: view.status,
    title: view.title,
    userRequest: view.userRequest,
    goal: view.goal ?? view.userRequest,
    classification: view.classification ?? undefined,
    testArtifact: view.testArtifact,
    visibility: view.visibility,
    archived: view.archived,
    superseded: view.superseded,
    kind: (view.kind as 'application') ?? 'application',
    missionId: view.missionId,
    engineeringClass: view.engineeringClass ?? undefined,
    missionContractId: view.missionContractId ?? null,
    acceptanceContractId: view.acceptanceContractId ?? null,
    missionContractHash: view.missionContractHash ?? null,
    acceptanceContractHash: view.acceptanceContractHash ?? null,
    contractSpecApproved: view.contractSpecApproved === true,
    reviewOutcome: view.reviewOutcome ?? null,
    contractVerdict: view.contractVerdict ?? null,
    applicationBuilder: view.applicationPreview || view.applicationProject
      ? {
          preview: view.applicationPreview
            ? {
                status: view.applicationPreview.status as 'PROJECT_READY',
                projectName: view.applicationPreview.projectName,
                localPreview: view.applicationPreview.localPreview,
                whatWasBuilt: view.applicationPreview.whatWasBuilt ?? '',
                majorFeatures: view.applicationPreview.majorFeatures ?? [],
                testStatus: view.applicationPreview.testStatus ?? '',
                knownLimitations: [],
                researchUsed: [],
                deploymentReadiness: '',
                viewportStatus: view.applicationPreview.viewportStatus,
              }
            : null,
          project: view.applicationProject
            ? {
                projectId: view.applicationProject.projectId,
                projectName: view.applicationProject.projectName,
                projectRoot: view.applicationProject.projectRoot,
                missionId: view.missionId,
                projectType: view.applicationProject.projectType === 'internal_business_tool'
                  || view.applicationProject.projectType === 'static_website'
                  || view.applicationProject.projectType === 'database_backed_app'
                  || view.applicationProject.projectType === 'full_stack_web_app'
                  || view.applicationProject.projectType === 'frontend_web_app'
                  || view.applicationProject.projectType === 'backend_api'
                  || view.applicationProject.projectType === 'desktop_later'
                  || view.applicationProject.projectType === 'mobile_later'
                  ? view.applicationProject.projectType
                  : /crm/i.test(view.applicationProject.projectName)
                    ? 'internal_business_tool' as const
                    : 'database_backed_app' as const,
                createdAt: view.updatedAt ?? '',
                stack: null,
                requirements: null,
                researchSources: [],
                acceptanceCriteria: [],
                status: 'PROJECT_READY' as const,
              }
            : null,
          viewportResults: [],
        }
      : undefined,
    testState: view.testState ?? { ok: null, detail: null },
    sourceState: {
      baselineFiles: [],
      changedFiles: view.sourceState?.changedFiles ?? [],
      newFiles: view.sourceState?.newFiles ?? [],
      deletedFiles: [],
      diffSummary: '',
    },
    completionGate: view.completionGate ?? { complete: false, missing: [], detail: '' },
  }
}

function formatProviderLabel(provider?: string | null): string {
  if (provider === 'cursor-agent') return 'CURSOR AGENT'
  if (!provider) return 'PROVIDER'
  return provider.replace(/-/g, ' ').toUpperCase()
}

function formatModelLabel(modelId?: string | null): string {
  if (!modelId) return 'MODEL'
  return modelId.replace(/-/g, ' ').toUpperCase()
}

async function getJson<T>(url: string): Promise<{ ok: boolean; data?: T; error?: string; status?: number; code?: string }> {
  try {
    const res = await fetch(url, { cache: 'no-store' })
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) return { ok: false, status: res.status, code: typeof json.code === 'string' ? json.code : undefined, error: typeof json.error === 'string' ? json.error : `HTTP ${res.status}` }
    return { ok: true, status: res.status, data: json as T }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function patchJson<T>(url: string, body: unknown): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const res = await fetch(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) return { ok: false, error: typeof json.error === 'string' ? json.error : `HTTP ${res.status}` }
    return { ok: true, data: json as T }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function postJson<T>(url: string, body: unknown): Promise<{ ok: boolean; data?: T; error?: string; status?: number; json?: Record<string, unknown> }> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) return { ok: false, error: typeof json.error === 'string' ? json.error : `HTTP ${res.status}`, status: res.status, json }
    return { ok: true, data: json as T, status: res.status, json }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function FoundryShellInner({ basePath = DEFAULT_BASE_PATH }: { basePath?: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const workspaceId = searchParams.get('workspace')
  const sessionId = searchParams.get('session')
  const missionId = searchParams.get('mission')
  const terraMode = parseFoundryTerraContext(searchParams.get(FOUNDRY_TERRA_QUERY_KEY))
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([])
  const [workspacesLoaded, setWorkspacesLoaded] = useState(false)
  const [systemProjectsOpen, setSystemProjectsOpen] = useState(false)
  const [status, setStatus] = useState<FoundryStatus | null>(null)
  const [session, setSession] = useState<SessionItem | null>(null)
  const [mission, setMission] = useState<MissionLite | null>(null)
  const [files, setFiles] = useState<string[]>([])
  // Which workspace the current `files` listing belongs to (and whether the listing succeeded); null until one has arrived.
  const [filesFor, setFilesFor] = useState<FilesListedFor>(null)
  const [filePreview, setFilePreview] = useState<{ path: string; content: string } | null>(null)
  const [request, setRequest] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [drawer, setDrawer] = useState<'hidden' | 'terminal' | 'diff' | 'tests' | 'logs' | 'processes'>('hidden')
  const [rightTab, setRightTab] = useState<'idle' | 'files' | 'changes' | 'tests' | 'preview' | 'research'>('idle')
  const [inspector, setInspector] = useState(false)
  const [opsOpen, setOpsOpen] = useState(false)
  const [capabilitiesOpen, setCapabilitiesOpen] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [agentsOpen, setAgentsOpen] = useState(false)
  const [workbenchW0, setWorkbenchW0] = useState(false)
  const [commandCenter, setCommandCenter] = useState<FoundryCommandCenterSnapshot | null>(null)
  const [browserUrl, setBrowserUrl] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [archiveConfirm, setArchiveConfirm] = useState(false)
  const [archivedSessions, setArchivedSessions] = useState<SessionItem[]>([])
  const [renameTitle, setRenameTitle] = useState('')
  const [opsQueue, setOpsQueue] = useState<FoundryMissionView | null>(null)
  const [currentWork, setCurrentWork] = useState<FoundryMissionView | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [projectOffer, setProjectOffer] = useState<string | null>(null)
  const [workspaceConfirm, setWorkspaceConfirm] = useState<{ reason: string; path: string } | null>(null)
  const [menu, setMenu] = useState<FoundryContextMenuState>(null)
  const [landingResearch, setLandingResearch] = useState<{ status: 'LIVE' | 'UNAVAILABLE'; sources: { url: string; title: string }[]; query: string } | null>(null)
  const [commitMsg, setCommitMsg] = useState('')
  const [processes, setProcesses] = useState<{ label?: string; pid?: number }[]>([])
  const [liveOutput, setLiveOutput] = useState<string>('')
  // Mission history loads through explicit states. Only a mission that is genuinely absent or unrecoverable (after retries) is reported as such.
  const [missionLoad, setMissionLoad] = useState<'idle' | 'loading' | 'ready' | 'absent' | 'corrupt'>('idle')
  // Conversation (session) load: never shown as missing while it is still loading or after a transient failure.
  const [sessionLoad, setSessionLoad] = useState<'loading' | 'ready' | 'absent'>('loading')
  const [continueNote, setContinueNote] = useState<string | null>(null)
  const [composerMode, setComposerMode] = useState<FoundryComposerMode>('agent')
  const [providerFamilies, setProviderFamilies] = useState<{ family: string; configured: boolean }[]>([])
  const [modelMenuSignal, setModelMenuSignal] = useState(0)
  const streamRef = useRef<EventSource | null>(null)
  const sessionMissRef = useRef(0)
  const resumeStarted = useRef<string | null>(null)
  const restoredRef = useRef(false)
  const promptRef = useRef<HTMLTextAreaElement | null>(null)
  const threadScrollRef = useRef<HTMLDivElement | null>(null)
  const [commitOpen, setCommitOpen] = useState(false)

  const qs = (extra?: Record<string, string | null | undefined>) => {
    const params = new URLSearchParams()
    const ws = extra?.workspace === undefined ? workspaceId : extra.workspace
    const sess = extra?.session === undefined ? sessionId : extra.session
    const missionQ = extra?.mission === undefined ? missionId : extra.mission
    const terraQ = extra?.terra === undefined ? (terraMode === 'none' ? null : terraMode) : extra.terra
    if (ws) params.set('workspace', ws)
    if (sess) params.set('session', sess)
    if (missionQ) params.set('mission', missionQ)
    if (terraQ) params.set(FOUNDRY_TERRA_QUERY_KEY, terraQ)
    const s = params.toString()
    return s ? `${basePath}?${s}` : basePath
  }

  const withWs = (url: string, ws = workspaceId) => {
    if (!ws) return url
    return `${url}${url.includes('?') ? '&' : '?'}workspaceId=${encodeURIComponent(ws)}`
  }

  const reload = async () => {
    const sessUrl = workspaceId
      ? `/api/mission-runtime/engineering/foundry/sessions?workspaceId=${encodeURIComponent(workspaceId)}`
      : '/api/mission-runtime/engineering/foundry/sessions'
    const [ws, st, sess] = await Promise.all([
      getJson<{ workspaces: WorkspaceItem[] }>(`/api/mission-runtime/engineering/workspaces?view=${systemProjectsOpen ? 'system' : 'commander'}`),
      getJson<{ status: FoundryStatus }>('/api/mission-runtime/engineering/status'),
      getJson<{ sessions: SessionItem[] }>(sessUrl),
    ])
    if (ws.ok && ws.data) {
      setWorkspaces(ws.data.workspaces)
      setWorkspacesLoaded(true)
    }
    if (st.ok && st.data) setStatus(st.data.status)
    if (sess.ok && sess.data) {
      setSessions(commanderVisibleSessions(sess.data.sessions, sessionId))
    }
    if (opsOpen) {
      const archivedUrl = workspaceId
        ? `/api/mission-runtime/engineering/foundry/sessions?workspaceId=${encodeURIComponent(workspaceId)}&view=archived`
        : '/api/mission-runtime/engineering/foundry/sessions?view=archived'
      const archived = await getJson<{ sessions: SessionItem[] }>(archivedUrl)
      if (archived.ok && archived.data) setArchivedSessions(archived.data.sessions)
    } else {
      setArchivedSessions([])
    }
    if (sessionId) {
      const one = await getJson<{ session: SessionItem }>(withWs(`/api/mission-runtime/engineering/foundry/sessions/${sessionId}`))
      if (one.ok && one.data?.session.archived) {
        setSession(one.data.session)
        setSessionLoad('ready')
        if (!opsOpen) router.replace(qs({ session: null, mission: null }))
      } else if (one.ok && one.data) {
        setSession(one.data.session)
        setSessionLoad('ready')
      } else if (one.status === 404) {
        // Two consecutive 404s: the conversation is genuinely absent. A transient failure keeps what is already shown.
        if (sessionMissRef.current >= 1) { setSession(null); setSessionLoad('absent') }
        sessionMissRef.current += 1
      }
      if (one.ok) sessionMissRef.current = 0
    } else {
      setSession(null)
    }
    if (inspector) {
      // The Files panel keeps its live refresh while the inspector is open; the composer's Context menu does not depend on this.
      const listing = await getJson<{ files: string[] }>(withWs('/api/mission-runtime/engineering/repo/files'))
      if (listing.ok && listing.data) {
        setFiles(listing.data.files)
        setFilesFor({ workspaceId: workspaceId ?? '', ok: true })
      }
    }
    const ops = await getJson<{ currentWork: FoundryMissionView | null; queue?: unknown }>('/api/foundry/operations?view=commander')
    if (ops.ok && ops.data) {
      setCurrentWork(recoverStaleCurrentMissionPointer(ops.data.currentWork as never) as FoundryMissionView | null)
      setOpsQueue(ops.data.currentWork ?? null)
    }
    const cc = await getJson<FoundryCommandCenterSnapshot>('/api/foundry/command-center')
    if (cc.ok && cc.data) setCommandCenter(cc.data)
    if (missionId) {
      const foundry = await getJson<{ mission: FoundryMissionView }>(`/api/foundry/missions/${missionId}`)
      if (foundry.ok && foundry.data?.mission) {
        const next = foundry.data.mission
        const candidate = {
          status: next.status,
          title: next.title,
          userRequest: next.userRequest,
          goal: next.goal ?? next.userRequest,
          classification: next.classification ?? undefined,
          testArtifact: next.testArtifact,
          visibility: next.visibility as 'commander' | 'system' | undefined,
          archived: next.archived,
          superseded: next.superseded,
          kind: (next.kind as 'application') ?? 'application',
        }
        if (isActiveCommanderMission(candidate as CommanderWorkCandidate)) {
          setCurrentWork(next)
        } else if (next.status === 'COMPLETE' && !isHistoricalSystemMission(candidate as CommanderWorkCandidate)) {
          setCurrentWork(next)
        } else {
          setCurrentWork(recoverStaleCurrentMissionPointer(ops.data?.currentWork as never) as FoundryMissionView | null)
        }
      }
    }
  }

  useEffect(() => {
    queueMicrotask(() => void reload())
    const timer = window.setInterval(() => void reload(), 2000)
    return () => window.clearInterval(timer)
  }, [workspaceId, sessionId, missionId, systemProjectsOpen, opsOpen, inspector, detailsOpen])

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('foundry.composerMode')
      if (stored) queueMicrotask(() => setComposerMode(parseComposerMode(stored)))
    } catch { /* storage unavailable */ }
    void getJson<{ providers?: { family: string; configured: boolean }[] }>('/api/mission-runtime/engineering/providers').then(result => {
      if (result.ok && result.data?.providers) setProviderFamilies(result.data.providers)
    })
  }, [])

  const changeComposerMode = (next: FoundryComposerMode) => {
    setComposerMode(next)
    try { window.localStorage.setItem('foundry.composerMode', next) } catch { /* storage unavailable */ }
  }

  useEffect(() => {
    void getJson<{ enabled?: boolean }>('/api/foundry/workbench').then(result => {
      setWorkbenchW0(Boolean(result.ok && result.data?.enabled))
    })
  }, [])

  useEffect(() => {
    if (!missionId) {
      // A session without a mission (Ask, or a session that has not started work) has no mission history to lose.
      queueMicrotask(() => {
        setMission(null)
        setMissionLoad('idle')
      })
      return
    }
    let cancelled = false
    queueMicrotask(() => setMissionLoad(current => (current === 'ready' ? 'ready' : 'loading')))
    void (async () => {
      const delays = [0, 600, 1500, 3000]
      let last: Awaited<ReturnType<typeof getJson<{ mission: MissionLite }>>> | null = null
      for (const delay of delays) {
        if (delay) await new Promise(resolve => setTimeout(resolve, delay))
        if (cancelled) return
        last = await getJson<{ mission: MissionLite }>(withWs(`/api/mission-runtime/engineering/${missionId}`))
        if (last.ok && last.data) {
          setMission(last.data.mission)
          setMissionLoad('ready')
          return
        }
        // Standalone / application-builder missions live in the mission-controller store, not the engineering repair store.
        // A mission that exists there is not "missing history".
        const controller = await getJson<{ mission: unknown }>(`/api/foundry/missions/${missionId}`)
        if (controller.ok && controller.data?.mission) {
          setMission(null)
          setMissionLoad('ready')
          return
        }
      }
      if (cancelled) return
      setMission(null)
      setMissionLoad(last?.code === 'MISSION_RECORD_CORRUPT' ? 'corrupt' : 'absent')
    })()
    if (typeof EventSource === 'undefined') return () => { cancelled = true }
    streamRef.current?.close()
    const source = new EventSource(withWs(`/api/mission-runtime/engineering/${missionId}/stream`))
    streamRef.current = source
    const onEnvelope = (evt: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(evt.data) as { mission?: MissionLite }
        if (parsed.mission) setMission(parsed.mission)
      } catch { /* ignore */ }
    }
    const onOutput = (evt: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(evt.data) as { entries?: { text: string }[] }
        if (parsed.entries?.length) {
          setLiveOutput(prev => `${prev}${parsed.entries!.map(e => e.text).join('')}`.slice(-12000))
        }
      } catch { /* ignore */ }
    }
    source.addEventListener('progress', onEnvelope)
    source.addEventListener('final', onEnvelope)
    source.addEventListener('command_output', onOutput)
    return () => {
      cancelled = true
      source.close()
    }
  }, [missionId, workspaceId, sessionId])

  useEffect(() => {
    sessionMissRef.current = 0
    queueMicrotask(() => setSessionLoad('loading'))
  }, [sessionId])

  useEffect(() => {
    const campaign = mission?.engineer?.engineeringRuntime?.campaign
    if (!missionId || !workspaceId || !campaign?.phase) return
    if (campaign.phase === 'COMPLETE' || campaign.verification === 'PROJECT_READY') return
    // Sealed missions are never resumed from the page: a stale request must not wake an executor for a finished or stopped mission.
    if (['blocked', 'completed', 'resolved', 'cancelled', 'rolled_back', 'failed'].includes(String(mission?.status))) return
    if (resumeStarted.current === missionId) return
    resumeStarted.current = missionId
    void postJson(`/api/mission-runtime/engineering/${missionId}/run`, { workspaceId })
  }, [mission, missionId, workspaceId])

  useEffect(() => {
    if (!workspacesLoaded) return
    if (restoredRef.current) {
      if (workspaceId && workspaceId !== WAR_ROOM_CANONICAL_WORKSPACE_ID && !workspaces.some(item => item.id === workspaceId) && !systemProjectsOpen) {
        router.replace(qs({ workspace: null, session: sessionId, mission: missionId }))
      }
      return
    }
    restoredRef.current = true
    if (workspaceId || sessionId || missionId) {
      if (workspaceId && workspaceId !== WAR_ROOM_CANONICAL_WORKSPACE_ID && !workspaces.some(item => item.id === workspaceId)) {
        router.replace(qs({ workspace: null, session: null, mission: null }))
      }
      return
    }
    const saved = readFoundryResume()
    if (!saved?.workspace) return
    const allowed = saved.workspace === WAR_ROOM_CANONICAL_WORKSPACE_ID || workspaces.some(item => item.id === saved.workspace)
    if (!allowed) return
    router.replace(qs({
      workspace: saved.workspace,
      session: null,
      mission: null,
    }))
  }, [workspacesLoaded, workspaces, workspaceId, sessionId, missionId, systemProjectsOpen])

  useEffect(() => {
    if (!workspaceId && !sessionId && !missionId) return
    persistFoundryResume({
      basePath,
      workspace: workspaceId,
      session: session?.archived ? null : sessionId,
      mission: session?.archived || !recoverStaleCurrentMissionPointer(currentWork as never) ? null : missionId,
    })
  }, [basePath, workspaceId, sessionId, missionId, session?.archived, currentWork])

  const selectedWorkspace = workspaces.find(w => w.id === workspaceId)
  const workspaceTitle = selectedWorkspace?.displayTitle ?? selectedWorkspace?.label ?? 'No project selected'
  const workspaceKind = selectedWorkspace?.displayKind ?? 'No workspace'
  const engineer = mission?.engineer
  // Only a mission that is genuinely absent or unrecoverable after retries is reported. Ask/Standalone conversations without a
  // mission, and anything still loading, never show a missing-history message.
  const missionHistoryProblem: 'absent' | 'corrupt' | null = missionId && (missionLoad === 'absent' || missionLoad === 'corrupt') ? missionLoad : null
  const commanderState = sessionId ? toCommanderState(engineer, mission?.validationResults) : 'IDLE'
  const visual = foundryVisualForState(commanderState)
  const narrative = statusNarrative(engineer, mission?.validationResults)
  const sessionGroups = useMemo(() => groupFoundrySessionsByDay(sessions), [sessions])
  const sessionLabel = sessionId ? shortSessionTitle(session?.title) : 'New Coding Session'
  const workstream = useMemo(() => {
    if (!sessionId) return []
    const events = engineer?.workstream?.length
      ? engineer.workstream
      : (session?.activity ?? []).map((item, i) => ({ id: `${item.at}-${i}`, at: item.at, kind: 'status', text: item.detail, source: 'audit' as const }))
    return events.slice(-40)
  }, [engineer, session, sessionId])

  const tests = mission?.validationResults ?? []
  const historicalTruth = engineer?.completionTruth ? null : buildEngineeringCompletionTruth({ missionStatus: mission?.status, runtime: engineer?.engineeringRuntime })
  const truth = engineer?.completionTruth ?? historicalTruth ?? buildFoundryCompletionTruth({
    surface: 'generated_project',
    filesChanged: engineer?.filesChanged,
    diff: mission?.diff?.diff,
    validationResults: mission?.validationResults,
  })

  const ensureProjectAndSend = async (text: string, wsId: string | null, confirmedWorkspaceId?: string) => {
    setBusy('mission')
    setError(null)
    let workspace = wsId
    if (!workspace) {
      const created = await postJson<{ workspace: WorkspaceItem }>('/api/mission-runtime/engineering/workspaces', {
        action: 'create',
        name: projectNameFromPrompt(text),
        initializeGit: true,
      })
      if (!created.ok || !created.data) {
        setBusy(null)
        return setError(created.error ?? 'Could not create project')
      }
      workspace = created.data.workspace.id
    }
    let activeSession = sessionId
    if (!activeSession) {
      const created = await postJson<{ session: SessionItem }>('/api/mission-runtime/engineering/foundry/sessions', {
        title: shortSessionTitle(text),
        workspaceId: workspace,
        projectName: workspaces.find(w => w.id === workspace)?.displayTitle ?? workspaces.find(w => w.id === workspace)?.label,
      })
      if (!created.ok || !created.data) {
        setBusy(null)
        return setError(created.error ?? 'Could not open a coding session')
      }
      activeSession = created.data.session.id
    }
    const result = await postJson<{ mission: { id: string } }>(`/api/mission-runtime/engineering/foundry/sessions/${activeSession}`, {
      text: text.trim(),
      workspaceId: workspace,
      waitForCompletion: false,
      confirmedWorkspaceId,
    })
    setBusy(null)
    if (result.status === 409 && result.json?.needsConfirmation) {
      const target = result.json.target as { path?: string } | undefined
      setWorkspaceConfirm({ reason: typeof result.json.reason === 'string' ? result.json.reason : 'Confirm target workspace', path: target?.path ?? '' })
      return
    }
    if (!result.ok || !result.data) return setError(result.error ?? 'Mission failed to start')
    setRequest('')
    setProjectOffer(null)
    setWorkspaceConfirm(null)
    router.replace(qs({ workspace, session: activeSession, mission: result.data.mission.id }))
  }

  const startCommanderFoundryMission = async (text: string, continueProjectId?: string | null) => {
    setBusy('mission')
    setError(null)
    let activeSession = sessionId
    if (!activeSession) {
      const created = await postJson<{ session: SessionItem }>('/api/mission-runtime/engineering/foundry/sessions', {
        title: shortSessionTitle(text),
        workspaceId: continueProjectId ?? workspaceId ?? undefined,
        projectName: workspaces.find(w => w.id === (continueProjectId ?? workspaceId))?.displayTitle
          ?? workspaces.find(w => w.id === (continueProjectId ?? workspaceId))?.label,
      })
      if (!created.ok || !created.data) {
        setBusy(null)
        return setError(created.error ?? 'Could not open a coding session')
      }
      activeSession = created.data.session.id
    }
    const createdMission = await postJson<{ mission: FoundryMissionView }>('/api/foundry/missions', {
      request: text.trim(),
      title: shortSessionTitle(text),
      continueProjectId: continueProjectId ?? undefined,
      sessionId: activeSession,
    })
    if (!createdMission.ok || !createdMission.data) {
      setBusy(null)
      return setError(createdMission.error ?? 'Mission failed to start')
    }
    const missionView = createdMission.data.mission
    setCurrentWork(missionView)
    setRequest('')
    setProjectOffer(null)
    setWorkspaceConfirm(null)
    router.replace(qs({
      workspace: continueProjectId ?? workspaceId,
      session: activeSession,
      mission: missionView.missionId,
    }))
    setBusy(null)
    void postJson(`/api/foundry/missions/${missionView.missionId}/run`, {})
  }

  const askFoundry = async (text: string) => {
    const wsId = workspaceId ?? session?.workspaceId ?? null
    if (!wsId) return setError('Open a project first, then ask Foundry about it.')
    setBusy('ask')
    setError(null)
    let activeSession = sessionId
    if (!activeSession) {
      const created = await postJson<{ session: SessionItem }>('/api/mission-runtime/engineering/foundry/sessions', {
        title: shortSessionTitle(text),
        workspaceId: wsId,
        projectName: workspaces.find(w => w.id === wsId)?.displayTitle ?? workspaces.find(w => w.id === wsId)?.label,
      })
      if (!created.ok || !created.data) {
        setBusy(null)
        return setError(created.error ?? 'Could not open a coding session')
      }
      activeSession = created.data.session.id
      router.replace(qs({ workspace: wsId, session: activeSession, mission: null }))
    }
    setRequest('')
    const answered = await postJson<{ answer: string }>(`/api/mission-runtime/engineering/foundry/sessions/${activeSession}/ask`, { text: text.trim(), workspaceId: wsId })
    setBusy(null)
    if (!answered.ok) setError(answered.error ?? 'Foundry could not answer')
    void reload()
  }

  const send = async () => {
    if (!request.trim()) return setError('Describe what Foundry should build or fix.')
    if (composerMode === 'ask') {
      // Ask is read-only and tool-less: it answers from project files with the local model.
      await askFoundry(request)
      return
    }
    const collision = workspaces.some(w => w.workspaceType === 'GENERATED_PROJECT' && /(?:^|\/|\\)war-room-os$/i.test(w.root.replace(/\\/g, '/')))
    const resolved = resolveFoundryMissionWorkspace({
      request,
      requestedWorkspaceId: workspaceId,
      generatedCollisionExists: collision,
    })
    if (resolved.kind === 'canonical' || isWarRoomSelfEditRequest(request) || isTerraBuildRequest(request) || terraMode !== 'none') {
      await ensureProjectAndSend(request, WAR_ROOM_CANONICAL_WORKSPACE_ID)
      return
    }
    if (resolved.kind === 'confirm') {
      const canonical = workspaces.find(w => w.id === WAR_ROOM_CANONICAL_WORKSPACE_ID)
      setWorkspaceConfirm({ reason: resolved.reason, path: canonical?.root ?? '' })
      return
    }
    if (composerMode === 'standalone') {
      // Standalone forces the mission controller's outcome-driven path (the one application-builder requests already use).
      await startCommanderFoundryMission(request, selectedWorkspace?.applicationProjectId ?? workspaceId)
      return
    }
    if (isApplicationBuilderRequest(request) || looksLikeNewApplication(request)) {
      await startCommanderFoundryMission(request, selectedWorkspace?.applicationProjectId ?? workspaceId)
      return
    }
    const boundWorkspace = workspaceId ?? session?.workspaceId ?? null
    if (!boundWorkspace && !projectOffer) {
      setProjectOffer(projectNameFromPrompt(request))
      return
    }
    await ensureProjectAndSend(request, boundWorkspace)
  }

  /** "Keep trying": continues the SAME paused mission and campaign (nothing Foundry learned is erased), as a recorded Commander decision. */
  const keepTrying = async () => {
    if (!missionId) return
    setContinueNote(null)
    const result = await postJson<{ granted?: boolean; message?: string }>(`/api/mission-runtime/engineering/${missionId}/continue`, { workspaceId })
    if (!result.ok) {
      setContinueNote('I could not continue this mission right now. Please try again in a moment.')
      return
    }
    if (result.data?.granted === false) setContinueNote(result.data.message ?? 'This mission cannot be continued.')
    void reload()
  }
  const stop = async () => {
    if (!missionId) return
    setBusy('stop')
    await postJson(`/api/mission-runtime/engineering/${missionId}/cancel`, { reason: 'Commander STOP MISSION', workspaceId })
    setBusy(null)
  }

  const openFile = async (path: string) => {
    const result = await getJson<{ content: string; relPath?: string }>(withWs(`/api/mission-runtime/engineering/repo/read?path=${encodeURIComponent(path)}`))
    if (result.ok && result.data) {
      setFilePreview({ path, content: result.data.content })
      setRightTab('files')
    }
  }

  const askAbout = (prefix: string, target: string) => {
    setRequest(`${prefix} ${target}`.trim())
  }

  const onContext = (kind: FoundryContextKind, target: string, event: MouseEvent) => {
    event.preventDefault()
    setMenu({ kind, x: event.clientX, y: event.clientY, target })
  }

  const handleContextAction = (action: string, target: string, kind: FoundryContextKind) => {
    if (action === 'Open' && kind === 'file') void openFile(target)
    else if ((action === 'Open' || action === 'Open in War Room') && kind === 'project') {
      const project = workspaces.find(w => w.displayTitle === target || w.label === target || w.id === target)
      if (project) void openProjectPreview(project)
    }
    else if (action === 'Open externally' && kind === 'project') {
      const project = workspaces.find(w => w.displayTitle === target || w.label === target || w.id === target)
      if (project?.previewUrl) {
        const bridge = (window as Window & { warRoomDesktop?: { invoke(channel: string, ...args: unknown[]): Promise<unknown> } }).warRoomDesktop
        if (bridge) void bridge.invoke('sovereign.openExternalSafe', project.previewUrl)
      }
    }
    else if (action === 'View Diff' || action === 'Open Terminal' || action === 'Open Terminal Here') setDrawer(action.includes('Diff') ? 'diff' : 'terminal')
    else if (action === 'Ask Foundry About This' || action === 'Explain' || action === 'Explain Change') askAbout(action === 'Explain' || action === 'Explain Change' ? 'Explain' : 'Look at', target)
    else if (action === 'Fix' || action === 'Refactor') {
      setRequest(`${action} ${target}`)
      void ensureProjectAndSend(`${action} ${target}`, workspaceId)
    }
    else if (action === 'Run' || action === 'Test' || action === 'Build' || action === 'Debug' || action === 'Test Change') {
      void ensureProjectAndSend(`${action} ${target}`, workspaceId)
    }
    else if (action === 'Rollback') {
      if (missionId) void postJson(`/api/mission-runtime/engineering/${missionId}/rollback`, { workspaceId })
    }
    else if (action === 'Delete') {
      if (window.confirm(`Delete ${target}? This is a destructive workspace action.`)) {
        void ensureProjectAndSend(`Delete ${target}`, workspaceId)
      }
    }
    else if (action === 'Rename' || action === 'Duplicate' || action === 'Archive' || action === 'Project Settings') {
      askAbout(action, target)
    }
    else if (action === 'Accept Change' || action === 'Revert Change') {
      void ensureProjectAndSend(`${action}: ${target}`, workspaceId)
    }
  }

  const commit = async () => {
    if (!missionId) return
    setBusy('commit')
    const result = await postJson(`/api/mission-runtime/engineering/${missionId}/git/commit`, {
      workspaceId,
      message: commitMsg.trim() || mission?.title || 'Foundry mission',
      files: mission?.diff?.changedFiles ?? engineer?.filesChanged ?? [],
      approvalGranted: true,
    })
    setBusy(null)
    if (!result.ok) setError(result.error ?? 'Commit requires Commander approval.')
  }

  const push = async () => {
    if (!missionId) return
    setBusy('push')
    const result = await postJson(`/api/mission-runtime/engineering/${missionId}/git/push`, { workspaceId, approvalGranted: true })
    setBusy(null)
    if (!result.ok) setError(result.error ?? 'Push requires Commander approval.')
  }

  const deploy = async () => {
    if (!missionId) return
    const result = await postJson(`/api/mission-runtime/engineering/${missionId}/deploy`, { workspaceId })
    setError(result.error ?? 'Deploy is denied.')
  }

  const installUpdate = async () => {
    if (!missionId) return
    const result = await postJson(`/api/mission-runtime/engineering/${missionId}/install`, { workspaceId, approvalGranted: true })
    setError(result.error ?? 'Install update requires Commander-gated overlay. Foundry will not replace the installed runtime.')
  }

  const startNewSession = async () => {
    if (missionId && FOUNDRY_LIVE_MISSION_STATES.has(commanderState)) {
      setError('A Foundry mission is still running. New session opened without cancelling it.')
    }
    const created = await postJson<{ session: SessionItem }>('/api/mission-runtime/engineering/foundry/sessions', {
      title: 'New Session',
      workspaceId: workspaceId ?? undefined,
      projectName: selectedWorkspace?.displayTitle ?? selectedWorkspace?.label,
    })
    if (!created.ok || !created.data) return setError(created.error ?? 'Could not open a new session')
    const opened = created.data.session
    setSession(opened)
    setSessions(current => commanderVisibleSessions(
      [opened, ...current.filter(item => item.id !== opened.id)],
      opened.id,
    ))
    setMission(null)
    setCurrentWork(null)
    setError(null)
    router.replace(qs({ workspace: workspaceId, session: created.data.session.id, mission: null }))
  }

  const saveSessionRename = async () => {
    if (!sessionId) return
    setBusy('rename')
    setError(null)
    const result = await patchJson<{ session: SessionItem }>(withWs(`/api/mission-runtime/engineering/foundry/sessions/${sessionId}`), {
      title: renameTitle,
      workspaceId,
    })
    setBusy(null)
    if (!result.ok || !result.data) {
      setError(result.error ?? 'Could not rename session')
      return
    }
    setSession(result.data.session)
    setSessions(current => current.map(item => item.id === result.data!.session.id ? { ...item, title: result.data!.session.title } : item))
    setRenaming(false)
  }

  const archiveCurrentSession = async () => {
    if (!sessionId) return
    setBusy('archive')
    setError(null)
    const result = await patchJson<{ session: SessionItem }>(withWs(`/api/mission-runtime/engineering/foundry/sessions/${sessionId}`), {
      archived: true,
      workspaceId,
    })
    setBusy(null)
    if (!result.ok || !result.data) {
      setError(result.error ?? 'Could not archive session')
      setArchiveConfirm(false)
      return
    }
    const archived = result.data.session
    setArchiveConfirm(false)
    setSession(null)
    setSessions(current => current.filter(item => item.id !== sessionId))
    setArchivedSessions(current => current.some(item => item.id === archived.id) ? current : [archived, ...current])
    router.replace(qs({ session: null, mission: null }))
  }

  const restoreSessionById = async (id: string) => {
    setBusy('restore')
    setError(null)
    const result = await patchJson<{ session: SessionItem }>(withWs(`/api/mission-runtime/engineering/foundry/sessions/${id}`), {
      archived: false,
      workspaceId,
    })
    setBusy(null)
    if (!result.ok || !result.data) {
      setError(result.error ?? 'Could not restore session')
      return
    }
    const restored = result.data.session
    setArchivedSessions(current => current.filter(item => item.id !== restored.id))
    setSessions(current => current.some(item => item.id === restored.id) ? current.map(item => item.id === restored.id ? restored : item) : [restored, ...current])
    setSession(restored)
    setArchiveConfirm(false)
    setRenaming(false)
    router.replace(qs({ session: restored.id, mission: null }))
  }

  const startNewProject = async () => {
    setRequest('')
    setProjectOffer(null)
    setError(null)
    setCurrentWork(null)
    setBusy('project')
    const projectName = `project-${Date.now().toString(36)}`
    const created = await postJson<{ workspace: WorkspaceItem }>('/api/mission-runtime/engineering/workspaces', {
      action: 'create-application',
      name: projectName,
      label: projectName,
    })
    if (!created.ok || !created.data?.workspace) {
      setBusy(null)
      return setError(created.error ?? 'Could not create a project')
    }
    const workspace = created.data.workspace
    const sessionCreated = await postJson<{ session: SessionItem }>('/api/mission-runtime/engineering/foundry/sessions', {
      title: 'New Session',
      workspaceId: workspace.id,
      projectName: workspace.displayTitle ?? workspace.label,
    })
    setBusy(null)
    if (!sessionCreated.ok || !sessionCreated.data) {
      return setError(sessionCreated.error ?? 'Project created but session failed')
    }
    setWorkspaces(current => current.some(item => item.id === workspace.id) ? current : [workspace, ...current])
    setSession(sessionCreated.data.session)
    setSessions(current => [sessionCreated.data!.session, ...current.filter(item => item.id !== sessionCreated.data!.session.id)])
    router.replace(qs({ workspace: workspace.id, session: sessionCreated.data.session.id, mission: null }))
    queueMicrotask(() => promptRef.current?.focus())
  }

  const runLandingResearch = async () => {
    setRightTab('research')
    const text = request.trim()
    if (!text) {
      setError('Type what Foundry should research, then press Research.')
      return
    }
    setBusy('research')
    setError(null)
    const result = await postJson<{ documents?: Array<{ url?: string; title?: string }>; status?: string; message?: string }>('/api/research/search', {
      text,
      maxResults: 8,
    })
    setBusy(null)
    if (!result.ok) {
      setLandingResearch({ status: 'UNAVAILABLE', sources: [], query: text })
      setError(result.error ?? 'Research is unavailable. No canned sources were shown.')
      return
    }
    const sources = (result.data?.documents ?? [])
      .map(item => ({ url: item.url ?? '', title: item.title ?? item.url ?? 'source' }))
      .filter(item => item.url)
    setLandingResearch({ status: sources.length ? 'LIVE' : 'UNAVAILABLE', sources, query: text })
  }

  const continueProject = async (project: WorkspaceItem) => {
    const name = project.displayTitle ?? project.label
    const text = `Continue building ${name}. Reuse the existing project.`
    setRequest(text)
    await startCommanderFoundryMission(text, project.applicationProjectId ?? project.id)
  }

  const openProjectPreview = async (project: WorkspaceItem) => {
    const projectId = project.applicationProjectId ?? (project.id !== WAR_ROOM_CANONICAL_WORKSPACE_ID ? project.id : null)
    if (!projectId) {
      router.replace(qs({ workspace: project.id, session: null, mission: null }))
      return
    }
    if (project.previewUrl) {
      try {
        const probe = await fetch(project.previewUrl, { method: 'GET', cache: 'no-store' })
        if (probe.ok) {
          setBrowserUrl(project.previewUrl)
          return
        }
      } catch {
        /* start owned preview below */
      }
    }
    if (project.previewLive && project.previewUrl) {
      setBrowserUrl(project.previewUrl)
      return
    }
    setBusy('preview')
    const started = await postJson<{ preview: { url?: string } }>('/api/mission-runtime/engineering/workspaces', {
      action: 'preview',
      projectId,
    })
    setBusy(null)
    if (!started.ok || !started.data?.preview?.url) {
      setError(started.error ?? 'Preview is not running. Start preview, then open it.')
      return
    }
    setBrowserUrl(started.data.preview.url)
    void reload()
  }

  const brain = status?.foundryModelStatus?.brain
  const localModel = status?.foundryModelStatus?.localModel
  const localReady = localModel?.state === 'READY'
  const localLabel = localModel?.label ?? (localModel?.state ? `LOCAL MODEL ${localModel.state}` : 'LOCAL MODEL UNAVAILABLE')
  const remoteUsable = Boolean(brain?.ready && !brain?.usageLimited)
  const providerReady = localReady || remoteUsable
  const modelHealthy = remoteUsable
  const providerLabel = formatProviderLabel(brain?.provider)
  const modelLabel = formatModelLabel(brain?.modelId)
  const providerTone = !brain
    ? { className: 'border-white/10 text-slate-500', text: 'UNKNOWN' }
    : brain.usageLimited
      ? { className: 'border-amber-400/40 text-amber-300', text: 'LIMITED' }
      : providerReady
        ? { className: 'border-emerald-400/40 text-emerald-300', text: 'ONLINE' }
        : { className: 'border-red-400/40 text-red-400', text: 'UNAVAILABLE' }
  const localTone = localReady
    ? 'border-emerald-400/40 text-emerald-300'
    : localModel?.state === 'STARTING'
      ? 'border-amber-400/40 text-amber-300'
      : localModel?.state === 'ERROR'
        ? 'border-red-400/40 text-red-400'
        : 'border-white/10 text-slate-500'
  const providerCompact = compactProviderStatus({
    localReady,
    remoteReady: remoteUsable,
    usageLimited: brain?.usageLimited,
    known: Boolean(status),
  })
  const liveWork: FoundryMissionView | null = currentWork && recoverStaleCurrentMissionPointer({
    ...currentWork,
    goal: currentWork.goal ?? currentWork.userRequest,
    lockClaims: (currentWork.lockClaims ?? []).map(resource => ({ resource })),
  } as unknown as CommanderWorkCandidate)
    ? currentWork
    : null
  const progress = liveWork ? commanderProgressFromMission(toProgressMission(liveWork) as never) : null
  const resultCardRaw = currentWork && !liveWork ? commanderResultFromMission(toResultMission(currentWork) as never) : null
  const seBlockedReady = currentWork?.contractVerdict && !currentWork.contractVerdict.legacy && !(currentWork.contractVerdict.projectReadyAdmissible && currentWork.contractVerdict.verdict === 'PASS')
  const resultCard = seBlockedReady ? null : resultCardRaw
  const researchFreshness = researchFreshnessLabel(engineer?.researchProvenance?.status)
  const testsRunning = commanderState === 'TESTING'
  const testsFailed = tests.some(t => !t.ok)
  const showCompletion = !seBlockedReady && (Boolean(resultCard) || Boolean(sessionId && commanderState === 'COMPLETE'))
  const centerChat = sessionId ? (session?.chat ?? []) : []
  const landing = !liveWork && (!sessionId || (centerChat.length === 0 && !missionId))
  const workVisual = liveWork
    ? foundryVisualForState(progress?.headline === 'NEEDS YOUR INPUT' ? 'BLOCKED' : 'BUILDING')
    : visual
  const terraBinding = terraBuildContextBinding(terraMode)
  // A listing only counts for the workspace it was fetched for, so switching workspaces never shows the previous project's files.
  const contextFiles = resolveContextFiles({ workspaceId, listedFor: filesFor, files })
  const visibleFiles = terraMode === 'none' ? contextFiles.files : contextFiles.files.filter(isTerraSourcePath)
  const setTerraContext = (mode: 'none' | 'build' | 'preview') => {
    router.replace(qs({
      workspace: mode === 'none' ? workspaceId : WAR_ROOM_CANONICAL_WORKSPACE_ID,
      terra: mode === 'none' ? null : mode,
    }))
  }

  useEffect(() => {
    if (drawer !== 'processes' || !missionId) return
    void getJson<{ processes: { label?: string; pid?: number }[] }>(`/api/mission-runtime/engineering/${missionId}/processes`).then(r => {
      if (r.ok && r.data) setProcesses(r.data.processes)
    })
  }, [drawer, missionId])

  const engineeringEvents = (engineer?.engineeringRuntime?.events ?? []) as FoundryEngineeringEvent[]
  const blockedSummary = String((engineer?.engineeringRuntime?.blockedDetail as { summary?: string } | null | undefined)?.summary ?? '')
  const canKeepTrying = Boolean(missionId && workspaceId && ['BLOCKED_STAGNATION', 'BLOCKED_REPAIR_LIMIT', 'BLOCKED_CAPABILITY'].includes(blockedSummary.toUpperCase()))
  const lastCommanderRequest = [...(session?.chat ?? [])].reverse().find(item => item.speaker === 'COMMANDER')?.text ?? ''
  const quietThread = buildQuietThread({
    events: engineeringEvents as unknown as QuietEvent[],
    missionStatus: mission?.status,
    blocked: (engineer?.engineeringRuntime?.blockedDetail ?? null) as QuietBlockedDetail | null,
    campaign: (engineer?.engineeringRuntime?.campaign ?? null) as unknown as QuietCampaign,
    completionTruth: historicalTruth,
    provider: { blocking: providerCompact.blocking, detail: providerCompact.detail },
    authorization: liveWork?.authorization ?? null,
  })
  const modelRegistry = buildModelRegistryView({
    known: Boolean(status),
    local: localModel ?? null,
    brain: brain ?? null,
    providers: providerFamilies,
  })
  const changedFilesForContext = engineer?.engineeringRuntime?.completion?.changedFiles ?? mission?.diff?.changedFiles ?? []
  const showInspector = detailsOpen || opsOpen || inspector
  const toggleInspector = () => {
    if (!showInspector && rightTab === 'idle') setRightTab('files')
    setDetailsOpen(!showInspector)
  }
  const resolveAuthorization = async (approved: boolean) => {
    const id = liveWork?.missionId
    if (!id) return
    // Entering execution from planning needs the contract hashes; that flow lives in the mission details panel.
    if (approved && liveWork?.authorization?.action === 'ENTER_EXECUTION') {
      setOpsOpen(true)
      setDetailsOpen(true)
      return
    }
    setBusy('authorization')
    const result = await postJson(`/api/foundry/missions/${id}/authorization`, { approved })
    setBusy(null)
    if (!result.ok) setError(result.error ?? 'Authorization failed')
    void reload()
  }
  const contextView = buildContextView({ files: visibleFiles, changedFiles: changedFilesForContext, filesState: contextFiles.state })
  // Composer context: load the selected project's files by workspace, independent of Advanced / Details / inspector visibility.
  // Refetches when the mission's changed-file set changes so newly created files appear without polling.
  const changedFilesKey = changedFilesForContext.join('|')
  useEffect(() => {
    const url = contextFilesUrl(workspaceId)
    if (!workspaceId || !url) return
    let cancelled = false
    void getJson<{ files: string[] }>(url).then(listing => {
      if (cancelled) return
      if (listing.ok && listing.data) {
        setFiles(listing.data.files)
        setFilesFor({ workspaceId, ok: true })
      } else {
        setFilesFor({ workspaceId, ok: false })
      }
    })
    return () => { cancelled = true }
  }, [workspaceId, changedFilesKey])
  useEffect(() => {
    const el = threadScrollRef.current
    if (!el) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) el.scrollTop = el.scrollHeight
  }, [engineeringEvents.length, quietThread.activity.length, quietThread.completion, quietThread.intervention, session?.chat.length])
  const focusEngineeringFile = async (filePath: string) => {
    await openFile(filePath)
    if (!workbenchW0 || !selectedWorkspace) return
    await fetch('/api/foundry/workbench/editor', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'attach',
        envelope: {
          projectId: selectedWorkspace.applicationProjectId ?? selectedWorkspace.id,
          workspaceId: selectedWorkspace.id,
          workspaceRoot: selectedWorkspace.root,
          activeFile: filePath,
          activeLanguageId: filePath.endsWith('.py') ? 'python' : 'plaintext',
          cursor: { line: 1, column: 1 },
          selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1, text: '', truncated: false, originalChars: 0 },
          openTabs: [{ path: filePath }],
          visibleDiagnostics: [],
        },
      }),
    })
  }

  return (
    <div data-testid="foundry-shell" data-terminal-collapsed={drawer === 'terminal' ? 'false' : 'true'}>
      <FoundryHomeNav
        visual={providerCompact.blocking ? foundryVisualForState('BLOCKED') : workVisual}
        providerMode={providerCompact.mode === 'READY' ? undefined : providerCompact.mode}
      />
      {providerCompact.blocking ? (
        <div className="foundry-blocked-panel mb-2 flex flex-wrap items-baseline gap-x-3 px-3 py-1" data-testid="foundry-model-blocked">
          <p className="text-[12px] font-medium text-red-300">No usable model</p>
          <p className="text-[11px] text-red-200/80">{providerCompact.detail}</p>
        </div>
      ) : null}
      {opsOpen ? (
        <div className="mb-2 space-y-2" data-testid="foundry-operations-drawer">
          <div className="flex items-center justify-between rounded-lg border border-emerald-400/20 bg-black/30 px-3 py-1.5">
            <p className="text-[9px] font-bold uppercase tracking-[0.28em] text-emerald-400">Operations</p>
            <button
              type="button"
              className="rounded border border-white/15 px-2 py-0.5 text-[9px] uppercase tracking-widest text-slate-400"
              onClick={() => setOpsOpen(false)}
            >
              Close
            </button>
          </div>
          <FoundryOperationsPanel />
          <FoundryMissionControllerPanel />
        </div>
      ) : null}
      {capabilitiesOpen ? (
        <div className="mb-2 space-y-2" data-testid="foundry-capabilities-drawer">
          <div className="flex items-center justify-between rounded-lg border border-emerald-400/20 bg-black/30 px-3 py-1.5">
            <p className="text-[9px] font-bold uppercase tracking-[0.28em] text-emerald-400">Capabilities</p>
            <button
              type="button"
              className="rounded border border-white/15 px-2 py-0.5 text-[9px] uppercase tracking-widest text-slate-400"
              onClick={() => setCapabilitiesOpen(false)}
            >
              Close
            </button>
          </div>
          <FoundryCapabilitiesPanel />
        </div>
      ) : null}
    <div className={`relative grid min-h-[calc(100vh-4.5rem)] grid-cols-1 gap-2 lg:grid-cols-[208px_minmax(0,1fr)] lg:grid-rows-[calc(100vh-4.5rem)_auto] ${showInspector ? 'xl:grid-cols-[208px_minmax(0,1fr)_320px]' : ''}`} data-testid="foundry-normal-mode" data-inspector={showInspector ? 'open' : 'closed'} onClick={() => setMenu(null)}>
      <MatrixBackground contained channelOverride={workVisual.matrixChannel} intensity={workVisual.intensity} />
      <FoundryTerraBackground terraContext={terraMode} />
      <aside className="foundry-glass foundry-q-rail relative z-10 flex max-h-[34vh] min-h-0 flex-col space-y-3 overflow-y-auto rounded-lg p-2.5 lg:max-h-none" data-testid="foundry-left">
        <div className="px-1 py-0.5" data-testid="foundry-identity-rail">
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-emerald-200">THE FOUNDRY</p>
          <p className={`mt-1 text-[9px] uppercase tracking-widest ${providerReady ? 'text-emerald-400' : providerCompact.blocking ? 'text-red-400' : 'text-slate-500'}`} data-testid="foundry-provider-rail">
            {providerCompact.blocking ? 'FOUNDRY BLOCKED' : providerReady ? 'FOUNDRY READY' : 'FOUNDRY OFFLINE'}
          </p>
          {commandCenter?.runningTaskCount ? (
            <button
              type="button"
              data-testid="foundry-background-status"
              className="mt-1 block w-full text-left text-[9px] uppercase tracking-widest text-cyan-300"
              onClick={() => setAgentsOpen(true)}
            >
              {commandCenter.backgroundLabel}
            </button>
          ) : null}
        </div>
        <div className="px-1" data-testid="foundry-workspace-truth" title={selectedWorkspace?.root ?? 'No workspace selected'}>
          <p className="truncate text-[11px] font-bold text-emerald-100">{workspaceTitle}</p>
          <p className="truncate text-[9px] uppercase tracking-widest text-slate-500">{selectedWorkspace?.projectKindLabel ?? (selectedWorkspace?.id === WAR_ROOM_CANONICAL_WORKSPACE_ID ? 'System Project' : workspaceKind)}</p>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <p className="text-[9px] font-bold uppercase tracking-widest text-emerald-500/70">Projects</p>
            <button type="button" data-testid="foundry-new-project" className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-emerald-300 hover:bg-white/[0.06]" onClick={() => void startNewProject()}>+ New Project</button>
          </div>
          <div className="max-h-52 space-y-1 overflow-auto" data-testid="foundry-project-list">
            {workspaces.length === 0 ? (
              <p className="px-1 py-2 text-center text-[10px] text-slate-600">{systemProjectsOpen ? 'No system/test projects' : 'No projects yet'}</p>
            ) : workspaces.map(w => (
              <div
                key={w.id}
                className={`rounded-md px-2 py-1 ${workspaceId === w.id ? 'bg-white/[0.06] text-emerald-100' : 'text-slate-400 hover:bg-white/[0.03]'}`}
              >
                <button
                  type="button"
                  title={w.root}
                  onClick={() => router.replace(qs({ workspace: w.id, session: null, mission: null }))}
                  onContextMenu={e => onContext('project', w.displayTitle ?? w.label, e)}
                  className="w-full text-left text-[11px]"
                >
                  <span className="block truncate font-semibold">{w.displayTitle ?? w.label}</span>
                  <span className="block truncate text-[8px] uppercase tracking-widest text-slate-500">
                    {w.projectKindLabel ?? w.displayKind ?? (w.projectType === 'war_room' ? 'System Project' : 'Generated Project')}
                    {w.runtimeStatus ? ` · ${w.runtimeStatus}` : ''}
                    {w.previewPort ? ` · ${w.previewPort}` : ''}
                  </span>
                  {w.lastWorkedAt ? <span className="block text-[8px] text-slate-600">Last worked on {relativeSessionTime(w.lastWorkedAt)}</span> : null}
                </button>
                {workspaceId === w.id ? (
                <span className="mt-0.5 flex gap-2">
                  <button type="button" className="text-[9px] uppercase tracking-widest text-emerald-300/80 hover:text-emerald-200" onClick={() => void openProjectPreview(w)}>Open</button>
                  {w.applicationProjectId || (w.id !== WAR_ROOM_CANONICAL_WORKSPACE_ID && w.projectType !== 'war_room') ? (
                    <button type="button" className="text-[9px] uppercase tracking-widest text-slate-400 hover:text-slate-200" onClick={() => void continueProject(w)}>Continue</button>
                  ) : null}
                </span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-[9px] font-bold uppercase tracking-widest text-emerald-500/70">Sessions</p>
            <button type="button" data-testid="foundry-new-session" aria-label="New Session" className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-emerald-300 hover:bg-white/[0.06]" onClick={() => void startNewSession()}>+ New Session</button>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-auto" data-testid="foundry-session-list">
            {sessionGroups.length === 0 ? (
              <p className="px-1 py-4 text-center text-[10px] text-slate-600">No sessions yet</p>
            ) : sessionGroups.map(group => (
              <div key={group.label}>
                <p className="mb-1 px-1 text-[8px] font-bold uppercase tracking-widest text-slate-600">{group.label}</p>
                {group.items.map(s => {
                  const active = sessionId === s.id
                  const kind = sessionHistoryKind({
                    selected: active,
                    commanderState: active ? commanderState : undefined,
                    hasChat: (sessions.find(item => item.id === s.id)?.chat.length ?? 0) > 0 || (s.title !== 'New Coding Session'),
                  })
                  const kindClass = kind === 'FAILED' ? 'text-red-400' : kind === 'RUNNING' || kind === 'ACTIVE' ? 'text-amber-300' : kind === 'COMPLETE' ? 'text-emerald-400' : 'text-slate-600'
                  return (
                    <button
                      key={s.id}
                      type="button"
                      data-testid="foundry-session-row"
                      role="button"
                      aria-label={s.title}
                      aria-pressed={active}
                      title={s.title}
                      aria-current={active ? 'true' : undefined}
                      onClick={() => router.replace(qs({ session: s.id, mission: resolveSessionListMissionId(s) }))}
                      className={`mb-0.5 w-full rounded-md px-2 py-1.5 text-left transition-colors ${active ? 'bg-white/[0.07] text-emerald-100' : 'text-slate-400 hover:bg-white/[0.035]'}`}
                    >
                      <span aria-hidden="true">
                        <span className="flex items-start justify-between gap-2">
                          <span className="truncate text-[11px] font-semibold">{shortSessionTitle(s.title)}</span>
                          <span className="shrink-0 text-[8px] text-slate-500">{relativeSessionTime(s.updatedAt)}</span>
                        </span>
                        <span className={`mt-0.5 block text-[8px] uppercase tracking-widest ${kindClass}`}>{kind}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
        {opsOpen ? (
          <div className="max-h-40 space-y-1 overflow-auto rounded border border-white/10 p-1" data-testid="foundry-archived-sessions" aria-label="Archived Sessions">
            <p className="px-1 text-[8px] font-bold uppercase tracking-widest text-slate-600">Archived Sessions</p>
            {archivedSessions.length === 0 ? (
              <p className="px-1 text-[10px] text-slate-600">None</p>
            ) : archivedSessions.map(item => (
              <div key={item.id} className="rounded border border-white/5 px-1 py-1" data-testid="foundry-archived-session-row">
                <button
                  type="button"
                  className="w-full truncate text-left text-[10px] text-slate-300 hover:bg-black/30"
                  title="Archived. History retained. Restore does not resume missions."
                  onClick={() => router.replace(qs({ session: item.id, mission: null }))}
                >
                  <span className="block truncate font-semibold">{shortSessionTitle(item.title)}</span>
                  <span className="block text-[8px] uppercase tracking-widest text-slate-600">
                    {item.projectName || item.workspaceId || 'workspace'} · {item.archivedAt ? relativeSessionTime(item.archivedAt) : 'archived'} · {item.missionIds.length} missions
                  </span>
                </button>
                <button
                  type="button"
                  className="mt-0.5 rounded border border-emerald-400/30 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-emerald-200"
                  data-testid="foundry-session-restore"
                  aria-label="Restore"
                  disabled={busy !== null}
                  onClick={() => void restoreSessionById(item.id)}
                >
                  Restore
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {opsOpen ? (
        <button
          type="button"
          className={`w-full rounded border py-1 text-[9px] uppercase tracking-widest ${terraMode === 'none' ? 'border-white/10 text-slate-500' : 'border-emerald-400/40 text-emerald-200'}`}
          data-testid="foundry-terra-build-context"
          onClick={() => setTerraContext(terraMode === 'none' ? 'build' : 'none')}
        >
          {terraMode === 'none' ? 'Terra build context' : 'Exit Terra build context'}
        </button>
        ) : null}
        <button
          type="button"
          className={`w-full rounded py-1 text-[9px] uppercase tracking-widest ${advancedOpen ? 'bg-white/[0.06] text-emerald-200' : 'text-slate-500 hover:bg-white/[0.04]'}`}
          data-testid="foundry-advanced-toggle"
          aria-label="Advanced"
          onClick={() => setAdvancedOpen(v => !v)}
        >
          {advancedOpen ? 'Hide advanced' : 'Advanced'}
        </button>
        <button
          type="button"
          className={`w-full rounded py-1 text-[9px] uppercase tracking-widest ${agentsOpen ? 'bg-white/[0.06] text-emerald-200' : 'text-slate-500 hover:bg-white/[0.04]'}`}
          data-testid="foundry-agents-toggle"
          aria-label="Agents / Tasks"
          onClick={() => setAgentsOpen(v => !v)}
        >
          {agentsOpen ? 'Hide agents / tasks' : 'Agents / Tasks'}
        </button>
        {advancedOpen ? (
        <>
        <button
          type="button"
          className={`w-full rounded py-1 text-[9px] uppercase tracking-widest ${opsOpen ? 'bg-white/[0.06] text-emerald-200' : 'text-slate-500 hover:bg-white/[0.04]'}`}
          data-testid="foundry-operations-toggle"
          aria-label="Advanced / Operations"
          onClick={() => setOpsOpen(v => !v)}
        >
          {opsOpen ? 'Hide advanced / operations' : 'Advanced / Operations'}
        </button>
        <button
          type="button"
          className={`w-full rounded py-1 text-[9px] uppercase tracking-widest ${capabilitiesOpen ? 'bg-white/[0.06] text-emerald-200' : 'text-slate-500 hover:bg-white/[0.04]'}`}
          data-testid="foundry-capabilities-toggle"
          aria-label="Advanced / Capabilities"
          onClick={() => setCapabilitiesOpen(v => !v)}
        >
          {capabilitiesOpen ? 'Hide advanced / capabilities' : 'Advanced / Capabilities'}
        </button>
        <button
          type="button"
          className={`w-full rounded py-1 text-[9px] uppercase tracking-widest ${systemProjectsOpen ? 'bg-white/[0.06] text-emerald-200' : 'text-slate-500 hover:bg-white/[0.04]'}`}
          data-testid="foundry-system-projects-toggle"
          onClick={() => setSystemProjectsOpen(v => !v)}
        >
          {systemProjectsOpen ? 'Hide system/test projects' : 'Advanced / System Test Projects'}
        </button>
        <button type="button" className="w-full rounded py-1 text-[10px] uppercase tracking-widest text-slate-500 hover:bg-white/[0.04]" data-testid="foundry-inspector-toggle" onClick={() => setInspector(v => !v)}>
          {inspector ? 'Hide inspector' : 'Advanced / Inspector'}
        </button>
        </>
        ) : null}
      </aside>

      <section className={`relative z-10 flex min-h-0 flex-col rounded-lg ${landing ? 'foundry-glass foundry-glass-landing' : 'foundry-glass'}`} data-testid="foundry-chat">
        <div className="px-4 pb-1 pt-3">
          <p className="text-[9px] uppercase tracking-[0.28em] text-emerald-500/70">Foundry</p>
          {renaming && sessionId ? (
            <div className="mt-1 flex items-center gap-1" data-testid="foundry-session-rename-form">
              <input
                value={renameTitle}
                onChange={event => setRenameTitle(event.target.value)}
                className="min-w-0 flex-1 rounded border border-emerald-400/30 bg-black/40 px-2 py-0.5 text-sm text-emerald-50 outline-none"
                data-testid="foundry-session-rename-input"
                aria-label="Session title"
                autoFocus
                maxLength={80}
              />
              <button
                type="button"
                className="rounded border border-emerald-400/40 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-emerald-200"
                data-testid="foundry-session-rename-save"
                aria-label="Save"
                disabled={busy !== null}
                onClick={() => void saveSessionRename()}
              >
                Save
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-emerald-100" data-testid="foundry-session-identity" role="status" aria-live="polite" aria-label={sessionId ? 'Selected session' : undefined}>{sessionLabel}</p>
              {sessionId ? (
                session?.archived ? (
                  <span className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      className="rounded border border-emerald-400/40 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-emerald-200"
                      data-testid="foundry-session-restore-header"
                      aria-label="Restore"
                      disabled={busy !== null}
                      onClick={() => void restoreSessionById(sessionId)}
                    >
                      Restore
                    </button>
                  </span>
                ) : archiveConfirm ? (
                  <span className="flex shrink-0 items-center gap-1" data-testid="foundry-session-archive-confirm">
                    <button
                      type="button"
                      className="rounded border border-amber-400/50 px-2 py-0.5 text-[9px] uppercase tracking-widest text-amber-200"
                      data-testid="foundry-session-archive-yes"
                      aria-label="Confirm Archive"
                      disabled={busy !== null || Boolean(missionId && FOUNDRY_LIVE_MISSION_STATES.has(commanderState))}
                      onClick={() => void archiveCurrentSession()}
                    >
                      Confirm Archive
                    </button>
                    <button
                      type="button"
                      className="rounded border border-white/15 px-2 py-0.5 text-[9px] uppercase tracking-widest text-slate-400"
                      aria-label="Cancel"
                      onClick={() => setArchiveConfirm(false)}
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <span className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      className="rounded px-2 py-0.5 text-[9px] uppercase tracking-widest text-slate-500 hover:bg-white/[0.06] hover:text-slate-200"
                      data-testid="foundry-session-rename"
                      aria-label="Rename"
                      onClick={() => {
                        setRenameTitle(session?.title ?? sessionLabel)
                        setRenaming(true)
                        setArchiveConfirm(false)
                      }}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="rounded px-2 py-0.5 text-[9px] uppercase tracking-widest text-slate-500 hover:bg-white/[0.06] hover:text-slate-200"
                      data-testid="foundry-session-archive"
                      aria-label="Archive"
                      disabled={busy !== null || Boolean(missionId && FOUNDRY_LIVE_MISSION_STATES.has(commanderState))}
                      title={missionId && FOUNDRY_LIVE_MISSION_STATES.has(commanderState) ? 'Finish or cancel the active mission before archiving this session.' : 'Hide this session from the normal list. History is kept.'}
                      onClick={() => setArchiveConfirm(true)}
                    >
                      Archive
                    </button>
                  </span>
                )
              ) : null}
            </div>
          )}
          <div className="mt-1 flex items-center justify-between gap-2">
            <p className={`text-[11px] uppercase tracking-widest ${foundryToneClass(workVisual.tone)}`} data-testid="foundry-commander-state">{workVisual.label}</p>
            <button type="button" data-testid="foundry-inspector-open" aria-pressed={showInspector} className="rounded px-2 py-0.5 text-[10px] uppercase tracking-widest text-slate-500 hover:bg-white/[0.06] hover:text-slate-200" onClick={toggleInspector}>{showInspector ? 'Hide details' : 'Details'}</button>
          </div>
          {narrative.error ? <p className="mt-1 text-[11px] text-red-400">{narrative.error}</p> : null}
          {error ? <p className="mt-1 text-[11px] text-red-400">{error}</p> : null}
          {missionHistoryProblem ? (
            <p className="mt-2 rounded border border-amber-400/40 px-2 py-1 text-[11px] text-amber-200" data-testid="foundry-mission-history-unavailable" data-history-problem={missionHistoryProblem}>
              {missionHistoryProblem === 'corrupt'
                ? "This mission's record could not be read, and Foundry could not recover it. The conversation itself is intact."
                : "This mission's record is not on this computer any more. The conversation itself is intact."}
            </p>
          ) : null}
          {terraMode !== 'none' ? (
            <div className="mt-2 rounded border border-emerald-400/25 bg-black/30 p-2" data-testid="foundry-terra-build-banner">
              <p className="text-[9px] font-bold uppercase tracking-widest text-emerald-300">Terra build context</p>
              <p className="mt-1 text-[10px] text-slate-400">Canonical Terra source. Inspect, edit, preview, test, and diff Terra UI under Foundry governance. Not autonomous. Not a new Terra runtime.</p>
              <p className="mt-1 font-mono text-[9px] uppercase tracking-widest text-slate-500">Workspace {terraBinding.workspaceId} · imagery never LIVE</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className="rounded border border-cyan-400/40 px-2 py-0.5 text-[9px] uppercase tracking-widest text-cyan-200" data-testid="foundry-terra-preview" onClick={() => setTerraContext('preview')}>
                  Interactive preview
                </button>
                <button type="button" className="rounded border border-white/15 px-2 py-0.5 text-[9px] uppercase tracking-widest text-slate-400" onClick={() => setTerraContext('none')}>
                  Exit
                </button>
              </div>
            </div>
          ) : null}
        </div>
        {liveWork && !opsOpen ? (
          <div className="px-4 pb-1" data-testid="foundry-working-strip">
            <div className="flex items-baseline justify-between gap-3">
              <p className="min-w-0 truncate text-[13px] text-slate-200">
                <span className="mr-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-300/90" data-testid="foundry-working-headline">{progress?.headline ?? 'FOUNDRY WORKING'}</span>
                {liveWork.title}
                {progress?.currentStage ? <span className="ml-2 text-slate-500" data-testid="foundry-working-detail">{progress.currentStage}</span> : null}
              </p>
              <button
                type="button"
                className="shrink-0 text-[10.5px] text-slate-500 hover:text-slate-300"
                data-testid="foundry-open-mission-details"
                onClick={() => { setDetailsOpen(true); setOpsOpen(true) }}
              >
                Details
              </button>
            </div>
            {progress?.items.length ? (
              <div className="mt-1.5" data-testid="foundry-live-progress">
                <FoundryLiveProgressPanel progress={buildLiveProgressFromItems({ items: progress.items, missionStatus: liveWork.status, blocked: Boolean(progress.blockedReason) })} />
              </div>
            ) : null}
          </div>
        ) : null}
        {workbenchW0 ? <FoundryWorkbenchPane /> : null}
        <div ref={threadScrollRef} className="foundry-q-thread min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 text-[14px]" data-testid="foundry-thread">
          {agentsOpen ? (
            <FoundryAgentCommandCenter
              snapshot={commandCenter}
              advanced={advancedOpen || inspector}
              onRefresh={() => void reload()}
              onOpenPreview={url => {
                setBrowserUrl(url)
                setRightTab('preview')
              }}
            />
          ) : null}
          {landing ? (
            <div className="flex h-full min-h-[160px] items-center justify-center text-center" data-testid="foundry-new-session-empty">
              <div className="foundry-landing mx-auto max-w-xl px-2" data-testid="foundry-landing">
                <p className="text-[11px] font-bold uppercase tracking-[0.42em] text-emerald-300">FOUNDRY READY</p>
                <p className="mt-2 text-[13px] font-semibold uppercase tracking-[0.22em] text-emerald-100">Tell Foundry the result you want...</p>
                <p className="mt-3 text-[11px] font-bold uppercase tracking-widest text-emerald-400/80">New Session / Ready</p>
                <p className="mt-1 text-[11px] text-slate-500">Previous work stays in session history until you select it.</p>
                <div className="mt-4 grid grid-cols-2 gap-2" data-testid="foundry-landing-actions">
                  <button type="button" className="foundry-action-card" aria-label="New Session" onClick={() => void startNewSession()}>New Session</button>
                  <button type="button" className="foundry-action-card" onClick={() => document.querySelector('[data-testid="foundry-project-list"]')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}>Open Project</button>
                  <button type="button" className="foundry-action-card" onClick={() => { setDrawer('terminal'); promptRef.current?.focus() }}>Run a command</button>
                  <button type="button" className="foundry-action-card" onClick={() => void runLandingResearch()}>Research</button>
                  <button type="button" className="foundry-action-card" data-testid="foundry-landing-agents" onClick={() => setAgentsOpen(true)}>Agents / Tasks</button>
                </div>
              </div>
            </div>
          ) : null}
          {sessionId && !session && sessionLoad === 'loading' ? (
            <p className="text-[14px] text-slate-400" data-testid="foundry-conversation-loading">Loading conversation…</p>
          ) : null}
          {sessionId && !session && sessionLoad === 'absent' ? (
            <p className="text-[14px] text-slate-400" data-testid="foundry-conversation-absent">This conversation is not on this computer any more.</p>
          ) : null}
          {centerChat.map(msg => (
            <div key={msg.id} className="foundry-q-msg">
              <p className="text-[10px] uppercase tracking-[0.2em] text-emerald-400/55">{msg.speaker === 'COMMANDER' ? 'You' : 'Foundry'}</p>
              <p className="mt-0.5 whitespace-pre-wrap text-[15px] leading-[1.55] text-slate-100">{msg.text}</p>
            </div>
          ))}
          {busy === 'ask' ? (
            <p className="flex items-center gap-2 pl-0.5 text-[14px] text-emerald-100" data-testid="foundry-ask-working"><span className="foundry-q-pulse inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />Reading the project…</p>
          ) : null}
          {missionId && missionLoad === 'loading' && !engineeringEvents.length ? <FoundryLiveProgressPanel progress={null} loading /> : null}
          {sessionId && (centerChat.length > 0 || Boolean(missionId)) && !(missionLoad === 'loading' && !engineeringEvents.length) ? (
          engineeringEvents.length || quietThread.intervention ? (
            <FoundryQuietThread
              thread={quietThread}
              onOpenFile={path => { void focusEngineeringFile(path) }}
              onOpenRaw={() => setDrawer('terminal')}
              onStop={() => { void stop() }}
              onRetry={canKeepTrying ? () => { void keepTrying() } : lastCommanderRequest ? () => { void ensureProjectAndSend(lastCommanderRequest, workspaceId) } : undefined}
              onReviewProblem={() => { setDetailsOpen(true) }}
              onOpenModels={() => setModelMenuSignal(value => value + 1)}
              onApprove={liveWork?.authorization?.waiting ? () => { void resolveAuthorization(true) } : undefined}
              onCancelApproval={liveWork?.authorization?.waiting ? () => { void resolveAuthorization(false) } : undefined}
              onDetails={() => { setDetailsOpen(true); setOpsOpen(true) }}
              onViewChanges={() => setDrawer('diff')}
              onOpenPreview={() => { setRightTab('preview'); setDetailsOpen(true) }}
              onOpenFiles={() => { setRightTab('files'); setDetailsOpen(true) }}
              onRunTests={() => void ensureProjectAndSend('Run tests', workspaceId)}
              note={continueNote}
              commit={(
                <div className="mt-3" data-testid="foundry-approval-card">
                  <button type="button" aria-expanded={commitOpen} className="text-[12px] text-slate-500 hover:text-slate-300" onClick={() => setCommitOpen(value => !value)}>
                    {commitOpen ? '▾' : '▸'} Commit…
                  </button>
                  {commitOpen ? (
                    <div className="mt-2 space-y-2">
                      <p className="text-[12px] text-slate-400">Commit these changes?</p>
                      <input className="w-full rounded-md bg-white/[0.04] p-2 text-[12px] text-white outline-none ring-1 ring-white/10 focus:ring-emerald-400/30" placeholder="Commit message" value={commitMsg} onChange={e => setCommitMsg(e.target.value)} />
                      <div className="flex flex-wrap gap-1.5 text-[12px]">
                        <button type="button" className="rounded-md bg-white/[0.05] px-2.5 py-1 text-slate-200 hover:bg-white/[0.09]" onClick={() => setDrawer('diff')}>Review diff</button>
                        <button type="button" disabled={busy !== null} className="rounded-md bg-emerald-400/15 px-2.5 py-1 text-emerald-200 hover:bg-emerald-400/25" onClick={() => void commit()}>Commit</button>
                        {opsOpen ? (
                          <>
                            <button type="button" disabled={busy !== null} className="rounded-md bg-white/[0.05] px-2.5 py-1 text-cyan-200 hover:bg-white/[0.09]" onClick={() => void push()}>Push</button>
                            <button type="button" className="rounded-md bg-white/[0.05] px-2.5 py-1 text-red-300 hover:bg-white/[0.09]" onClick={() => void deploy()}>Deploy</button>
                          </>
                        ) : null}
                        <button type="button" className="px-2 py-1 text-slate-500 hover:text-slate-300" onClick={() => { setCommitMsg(''); setCommitOpen(false) }}>Not now</button>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            />
          ) : (
          <div data-testid="foundry-activity" className="space-y-0.5 pl-3">
            {workstream.map(item => {
              const mark = workstreamMarker(item)
              return (
                <p key={item.id} className={`text-[13px] ${mark.className}`}>
                  <span className="mr-1.5">{mark.icon}</span>{item.text}
                </p>
              )
            })}
          </div>
          )
          ) : null}
          {currentWork?.contractVerdict && !currentWork.contractVerdict.legacy ? (
            <FoundryContractVerdictPanel view={currentWork.contractVerdict} advanced={advancedOpen || inspector} />
          ) : null}
          {showCompletion && resultCard ? (
            <div className="rounded border border-emerald-400/40 bg-emerald-950/20 p-3" data-testid="foundry-completion-card">
              <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-300" data-testid="foundry-project-ready-label">{resultCard.kind === 'SITE_READY' ? 'SITE READY' : 'PROJECT READY'}</p>
              <p className="mt-1 text-sm font-semibold text-emerald-100">{workspaces.find(w => w.applicationProjectId === resultCard.projectId || w.id === resultCard.projectId)?.displayTitle || resultCard.projectName}</p>
              <p className="mt-1 text-[11px] text-slate-400">{resultCard.summary}</p>
              {resultCard.previewUrl ? <p className="mt-1 font-mono text-[11px] text-cyan-300">{resultCard.previewUrl}</p> : null}
              {resultCard.tests ? <p className="text-slate-300">Tests: {resultCard.tests}</p> : null}
              {resultCard.persistence ? <p className="text-slate-300">Persistence: {resultCard.persistence}</p> : null}
              {resultCard.desktop ? <p className="text-slate-300">Desktop: {resultCard.desktop}</p> : null}
              {resultCard.mobile ? <p className="text-slate-300">Mobile: {resultCard.mobile}</p> : null}
              <p className="text-slate-300">Files: {resultCard.filesChanged} changed</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {resultCard.previewUrl ? (
                  <button type="button" className="rounded border border-emerald-500/40 px-2 py-1 text-[10px] uppercase text-emerald-300" onClick={() => {
                    const project = workspaces.find(w => w.applicationProjectId === resultCard.projectId || w.id === resultCard.projectId)
                    if (project) void openProjectPreview(project)
                    else setBrowserUrl(resultCard.previewUrl!)
                  }}>{resultCard.openLabel}</button>
                ) : null}
                {resultCard.projectId ? (
                  <button type="button" className="rounded border border-white/15 px-2 py-1 text-[10px] uppercase text-slate-300" onClick={() => {
                    const project = workspaces.find(w => w.applicationProjectId === resultCard.projectId || w.id === resultCard.projectId)
                    if (project) void continueProject(project)
                  }}>Continue Building</button>
                ) : null}
                <button type="button" className="rounded border border-white/15 px-2 py-1 text-[10px] uppercase text-slate-300" onClick={() => { setDetailsOpen(true); setOpsOpen(true) }}>View Details</button>
              </div>
            </div>
          ) : showCompletion && !quietThread.completion ? (
            <div className="rounded border border-emerald-400/40 bg-emerald-950/20 p-3" data-testid="foundry-completion-card">
              <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-300">{truth.canComplete ? 'COMPLETE' : 'NOT COMPLETE'}</p>
              {engineer?.engineeringRuntime?.completion ? (
                <div data-testid="foundry-engineering-completion" className="mt-1 text-[11px] text-slate-300">
                  <p>Files: {engineer.engineeringRuntime.completion.changedFiles.join(', ') || 'none'}</p>
                  <p>Tests: {engineer.engineeringRuntime.completion.tests.map(item => `${item.command} ${item.ok ? 'PASS' : 'FAIL'}`).join('; ') || 'none'}</p>
                  <p>Commit: {engineer.engineeringRuntime.completion.commitOccurred ? 'yes' : 'no'}. Push: {engineer.engineeringRuntime.completion.pushOccurred ? 'yes' : 'no'}. Deploy: {engineer.engineeringRuntime.completion.deployOccurred ? 'yes' : 'no'}.</p>
                </div>
              ) : null}
              {truth.headline !== 'NOT COMPLETE' ? <p className="text-[10px] uppercase tracking-widest text-emerald-400">{truth.headline}</p> : null}
              <p className="mt-1 text-[11px] text-slate-400">{truth.detail}</p>
              <p className="mt-1 text-slate-300">Files {truth.created.length + truth.modified.length} changed</p>
              <p className="text-slate-300">Tests {truth.tests.ran ? (historicalTruth?.history && !historicalTruth.history.testsCounted ? `${truth.tests.ok ? 'PASS' : 'FAIL'} (count not recorded)` : `${truth.tests.pass} / ${truth.tests.total} ${truth.tests.ok ? 'PASS' : 'FAIL'}`) : 'none executed'}</p>
              <p className="text-slate-300">Validation {historicalTruth?.history?.validation ?? engineer?.validationOutcome ?? (truth.canComplete ? 'PASS' : 'NOT COMPLETE')}</p>
              <p className="text-slate-300">Diff {historicalTruth?.history && !historicalTruth.history.diffKnown ? 'not recorded' : `+${truth.plus}  -${truth.minus}`}</p>
              {historicalTruth?.history ? (
                <p className="text-[11px] text-slate-300" data-testid="foundry-completion-history-evidence">Review {historicalTruth.history.review} · Verifier {historicalTruth.history.verifier}</p>
              ) : null}
              {historicalTruth?.history?.rolledBack ? (
                <p className="text-[11px] font-semibold text-amber-200" data-testid="foundry-completion-rolled-back">ROLLED BACK — files were reverted after this mission completed. The completion record above is unchanged.</p>
              ) : null}
              {truth.surface === 'war_room_source' ? (
                <>
                  <p className="mt-1 text-[11px] text-amber-200">SOURCE CHANGES COMPLETE</p>
                  <p className="text-[11px] text-amber-200">Installed application still running previous packaged build.</p>
                  <p className="text-[11px] text-amber-200">Installed War Room is still running packaged build: {truth.installedSha ?? 'unknown'}</p>
                  <p className="text-[11px] text-amber-200">Source workspace now contains: {truth.sourceHead ?? 'unknown'}{truth.sourceDirty ? ' (dirty)' : ''}</p>
                </>
              ) : (
                <p className="mt-1 text-[11px] text-amber-200">This is a generated project workspace, not the installed War Room UI.</p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className="rounded border border-white/15 px-2 py-1 text-[10px] uppercase text-slate-300" onClick={() => setDrawer('diff')}>View Diff</button>
                <button type="button" className="rounded border border-white/15 px-2 py-1 text-[10px] uppercase text-slate-300" onClick={() => void ensureProjectAndSend('Run tests', workspaceId)}>Run Tests</button>
                {truth.surface === 'war_room_source' && opsOpen ? (
                  <>
                    <button type="button" className="rounded border border-amber-500/40 px-2 py-1 text-[10px] uppercase text-amber-200" onClick={() => void installUpdate()}>Build Package</button>
                    <button type="button" className="rounded border border-amber-500/40 px-2 py-1 text-[10px] uppercase text-amber-200" onClick={() => void installUpdate()}>Install Update — Commander Approval Required</button>
                  </>
                ) : null}
                <button type="button" className="rounded border border-emerald-500/40 px-2 py-1 text-[10px] uppercase text-emerald-300" onClick={() => setRightTab('preview')}>Open Preview</button>
                <button type="button" className="rounded border border-white/15 px-2 py-1 text-[10px] uppercase text-slate-300" onClick={() => setRightTab('files')}>Open Files</button>
              </div>
              <div className="mt-3 rounded border border-amber-500/30 p-2" data-testid="foundry-approval-card">
                <p className="text-[11px] text-amber-200">Commit these changes?</p>
                <input className="mt-1 w-full rounded border border-white/10 bg-black/40 p-1.5 text-[11px] text-white" placeholder="Commit message" value={commitMsg} onChange={e => setCommitMsg(e.target.value)} />
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" className="rounded border border-white/15 px-2 py-1 text-[10px] uppercase text-slate-300" onClick={() => setDrawer('diff')}>Review Diff</button>
                  <button type="button" disabled={busy !== null} className="rounded border border-emerald-500/40 px-2 py-1 text-[10px] uppercase text-emerald-300" onClick={() => void commit()}>Commit</button>
                  {opsOpen ? (
                    <>
                      <button type="button" disabled={busy !== null} className="rounded border border-cyan-500/40 px-2 py-1 text-[10px] uppercase text-cyan-300" onClick={() => void push()}>Push</button>
                      <button type="button" className="rounded border border-red-500/30 px-2 py-1 text-[10px] uppercase text-red-300" onClick={() => void deploy()}>Deploy</button>
                    </>
                  ) : null}
                  <button type="button" className="rounded border border-white/10 px-2 py-1 text-[10px] uppercase text-slate-500" onClick={() => setCommitMsg('')}>Not Now</button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
        <div className="px-4 pb-3 pt-1" data-testid="foundry-prompt">
          {workspaceConfirm ? (
            <div className="mb-2 rounded border border-amber-500/40 p-2 text-[11px] text-amber-100" data-testid="foundry-workspace-confirm">
              <p className="font-bold uppercase tracking-widest">Target: War Room Canonical Source</p>
              <p className="mt-1 font-mono text-[10px] text-slate-300">{workspaceConfirm.path || 'C:\\Users\\markb\\Documents\\Codex\\war-room-os'}</p>
              <p className="mt-1 text-slate-400">{workspaceConfirm.reason}</p>
              <div className="mt-1 flex gap-2">
                <button type="button" className="rounded border border-emerald-500/40 px-2 py-0.5 text-[10px] uppercase" onClick={() => void ensureProjectAndSend(request, WAR_ROOM_CANONICAL_WORKSPACE_ID, WAR_ROOM_CANONICAL_WORKSPACE_ID)}>Use Canonical Source</button>
                <button type="button" className="rounded border border-white/15 px-2 py-0.5 text-[10px] uppercase" onClick={() => workspaceId ? void ensureProjectAndSend(request, workspaceId, workspaceId) : setWorkspaceConfirm(null)}>Keep selected project</button>
                <button type="button" className="rounded border border-white/15 px-2 py-0.5 text-[10px] uppercase" onClick={() => setWorkspaceConfirm(null)}>Cancel</button>
              </div>
            </div>
          ) : null}
          {projectOffer ? (
            <div className="mb-2 rounded border border-cyan-500/30 p-2 text-[11px] text-cyan-200">
              Create project <span className="font-mono">{projectOffer}</span> and start?
              <div className="mt-1 flex gap-2">
                <button type="button" className="rounded border border-emerald-500/40 px-2 py-0.5 text-[10px] uppercase" onClick={() => void ensureProjectAndSend(request, null)}>Create and start</button>
                <button type="button" className="rounded border border-white/15 px-2 py-0.5 text-[10px] uppercase" onClick={() => setProjectOffer(null)}>Cancel</button>
              </div>
            </div>
          ) : null}
          {workbenchW0 ? (
            <p className="mb-2 text-[10px] uppercase tracking-widest text-slate-500">
              Workbench is the primary manual engineering surface. Agent and Standalone Engineer remain available.
            </p>
          ) : null}
          <FoundryWorkbenchAiPanel enabled={workbenchW0} onFocusPrompt={() => promptRef.current?.focus()} />
          <FoundryWorkbenchExtensionsPanel enabled={workbenchW0} />
          <FoundryComposer
            request={request}
            onRequestChange={setRequest}
            promptRef={promptRef}
            onSend={() => void send()}
            onStop={() => void stop()}
            busy={busy}
            hasMission={Boolean(missionId)}
            missionRunning={quietThread.progress.working && engineeringEvents.length > 0}
            mode={composerMode}
            onModeChange={changeComposerMode}
            registry={modelRegistry}
            context={contextView}
            onInsertContext={reference => { setRequest(current => insertContextReference(current, reference)); promptRef.current?.focus() }}
            localReady={localReady}
            webReady={researchFreshness === 'LIVE' || researchFreshness === 'FRESH' || !sessionId}
            terminalOpen={drawer === 'terminal'}
            onToggleTerminal={() => setDrawer(drawer === 'terminal' ? 'hidden' : 'terminal')}
            modelMenuSignal={modelMenuSignal}
          />
        </div>
      </section>

      {showInspector ? (
      <aside className="foundry-glass foundry-q-inspector fixed bottom-2 right-2 top-[4.5rem] z-40 w-[340px] max-w-[calc(100vw-1rem)] min-h-0 space-y-3 overflow-y-auto rounded-lg p-3 text-[11px] xl:static xl:z-10 xl:w-auto xl:max-w-none" data-testid="foundry-right">
        <p className="text-[9px] font-bold uppercase tracking-widest text-emerald-500/70">Status</p>
        <p className={`text-[12px] font-bold uppercase tracking-widest ${foundryToneClass(workVisual.tone)}`} data-testid="foundry-commander-status">
          {commanderStatusHeadline({
            liveWork: Boolean(liveWork),
            needsInput: progress?.headline === 'NEEDS YOUR INPUT',
            testing: commanderState === 'TESTING',
            verifying: currentWork?.status === 'VALIDATING' || currentWork?.status === 'VERIFYING',
            building: Boolean(liveWork),
            projectReady: Boolean(resultCard) && !(currentWork?.contractVerdict && !currentWork.contractVerdict.legacy && currentWork.contractVerdict.verdict !== 'PASS'),
          })}
        </p>
        <div className="flex flex-wrap gap-1 text-[8px] uppercase tracking-widest" data-testid="foundry-status-chips">
          <span className={`rounded px-1.5 py-0.5 ${workspaceId ? 'bg-emerald-400/10 text-emerald-300' : 'bg-white/[0.04] text-slate-500'}`}>PROJECT {workspaceId ? workspaceTitle : 'NONE'}</span>
          <span className={`rounded px-1.5 py-0.5 ${localReady ? 'bg-emerald-400/10 text-emerald-300' : 'bg-white/[0.04] text-slate-500'}`}>{providerCompact.mode}</span>
          <span className={`rounded px-1.5 py-0.5 ${researchFreshness === 'LIVE' || researchFreshness === 'FRESH' || !sessionId ? 'bg-emerald-400/10 text-emerald-300' : 'bg-white/[0.04] text-slate-500'}`}>INTERNET READY</span>
          <span className={`rounded px-1.5 py-0.5 ${testsFailed ? 'bg-red-400/10 text-red-300' : testsRunning ? 'bg-cyan-400/10 text-cyan-300' : 'bg-white/[0.04] text-slate-500'}`}>TESTS {testsFailed ? 'FAIL' : testsRunning ? 'RUNNING' : truth.tests.ran ? `${truth.tests.pass}/${truth.tests.total}` : 'IDLE'}</span>
        </div>
        <button type="button" className="w-full rounded py-1 text-[9px] uppercase tracking-widest text-slate-500 hover:bg-white/[0.04]" data-testid="foundry-open-details-toggle" onClick={() => setDetailsOpen(v => !v)}>
          {detailsOpen ? 'Hide details' : 'Open details'}
        </button>
        {detailsOpen || opsOpen ? (
          <div data-testid="foundry-open-details" className="space-y-1 rounded-md bg-white/[0.03] p-2">
            <p className="text-[8px] font-bold uppercase tracking-widest text-slate-500">Open Details</p>
            <p className="font-mono text-[10px] text-slate-400">mission {liveWork?.missionId ?? currentWork?.missionId ?? missionId ?? 'none'}</p>
            <p className="font-mono text-[10px] text-slate-400">project {currentWork?.applicationProject?.projectId ?? selectedWorkspace?.applicationProjectId ?? workspaceId ?? 'none'}</p>
            <p className="truncate text-[8px] uppercase tracking-widest text-slate-500" data-testid="foundry-model-rail">{providerLabel} · {modelLabel}</p>
            {brain?.usageLimited && localReady ? (
              <p className="truncate text-[8px] uppercase tracking-widest text-amber-300" data-testid="foundry-local-fallback-rail">
                Remote limited. Using local model: {localModel?.model}
              </p>
            ) : null}
            <p className="text-[10px] text-slate-500">lane {currentWork?.capabilityLane ?? '—'}</p>
            <p className="text-[10px] text-slate-500">tools {(currentWork?.durableToolCalls ?? []).map(call => call.tool).join(', ') || 'none'}</p>
            <span className={`rounded px-1.5 py-0.5 ${modelHealthy ? 'bg-emerald-400/10 text-emerald-300' : providerTone.className}`} data-testid="foundry-remote-model-status">
              REMOTE MODEL {brain?.usageLimited ? 'LIMITED' : modelHealthy ? 'READY' : providerTone.text}
            </span>
            <span className={`rounded px-1.5 py-0.5 ${localTone}`} data-testid="foundry-local-model-status">
              {localLabel}
            </span>
            {status?.foundryModelStatus?.localMissionReliability === 'VALIDATED' ? (
              <span className="rounded border border-emerald-400/40 px-1.5 py-0.5 text-emerald-300" data-testid="foundry-local-reliability">
                MISSION RELIABILITY: VALIDATED
              </span>
            ) : null}
          </div>
        ) : (
          <div className="hidden">
            <span data-testid="foundry-remote-model-status">REMOTE MODEL {brain?.usageLimited ? 'LIMITED' : modelHealthy ? 'READY' : providerTone.text}</span>
            <span data-testid="foundry-local-model-status">{localLabel}</span>
          </div>
        )}
        {detailsOpen || opsOpen ? (
          <>
            <p className={`font-mono text-[11px] ${foundryToneClass(liveWork ? (progress?.headline === 'NEEDS YOUR INPUT' ? foundryVisualForState('BLOCKED').tone : foundryVisualForState('BUILDING').tone) : visual.tone)}`}>{liveWork ? (progress?.headline === 'NEEDS YOUR INPUT' ? 'BLOCKED' : 'WORKING') : narrative.state}</p>
            <p><span className="text-slate-500">Current:</span> {liveWork ? (progress?.currentStage ?? liveWork.title) : sessionId ? narrative.current : 'Ready'}</p>
            <p><span className="text-slate-500">Last:</span> {sessionId ? (engineer?.lastCompletedAction ?? narrative.completed.at(-1) ?? '—') : '—'}</p>
            <p><span className="text-slate-500">Next:</span> {sessionId ? narrative.next : 'Describe the work'}</p>
          </>
        ) : null}
        {engineer?.researchProvenance?.sources?.length && rightTab !== 'research' ? (
          <p className="text-[9px] uppercase tracking-widest text-slate-500">Research {researchFreshness}</p>
        ) : null}
        {commanderState === 'REPAIRING' && engineer?.failureEvidence ? (
          <div className="rounded-md bg-amber-400/[0.07] p-2 text-amber-200" data-testid="foundry-repair-evidence">
            <p className="font-bold uppercase tracking-widest">Repairing</p>
            <p>Failure: {engineer.failureEvidence.errorSummary}</p>
            <p className="text-[10px] text-slate-400">{engineer.failureEvidence.command} · {engineer.failureEvidence.file ?? engineer.failureEvidence.id}</p>
            <p>Current: {engineer.failureEvidence.repairAction}</p>
            <p>Next: Re-run tests</p>
          </div>
        ) : null}
        {commanderState === 'BLOCKED' ? (
          <div className="rounded-md bg-red-400/[0.07] p-2 text-red-300" data-testid="foundry-blocked-panel">
            <p className="font-bold uppercase tracking-widest">Blocked</p>
            <p>{engineer?.engineeringRuntime?.blockedDetail?.summary || engineer?.blockingReason || narrative.error || 'Mission blocked.'}</p>
            {engineer?.engineeringRuntime?.blockedDetail ? (
              <div className="mt-1 space-y-1 text-[10px] text-slate-300">
                <p>Failure: {engineer.engineeringRuntime.blockedDetail.failure}</p>
                <p>Boundary: {engineer.engineeringRuntime.blockedDetail.boundary}</p>
                <p>Need: {engineer.engineeringRuntime.blockedDetail.unblockAction}</p>
              </div>
            ) : <p className="text-[10px] text-slate-400">Commander action may be required.</p>}
          </div>
        ) : null}
        {detailsOpen || opsOpen || inspector ? (
        <>
        <div className="flex flex-wrap gap-2 text-[9px] uppercase tracking-widest text-slate-500">
          {(['files', 'changes', 'tests', 'preview', 'research'] as const).map(tab => (
            <button
              key={tab}
              type="button"
              className={`${rightTab === tab ? 'text-emerald-300' : ''} ${tab === 'tests' && testsRunning ? 'foundry-tab-pulse' : ''} ${tab === 'tests' && testsFailed ? 'text-red-400' : ''} ${tab === 'research' && researchFreshness === 'LIVE' ? 'text-cyan-300' : ''}`}
              onClick={() => setRightTab(tab)}
            >
              {tab === 'research' ? 'Research / Sources' : tab}
            </button>
          ))}
        </div>
        {rightTab === 'files' ? (
          <ul className="max-h-56 space-y-0.5 overflow-auto" data-testid="foundry-file-tree">
            {filePreview ? <pre className="mb-2 max-h-40 overflow-auto whitespace-pre-wrap text-[10px] text-slate-300">{filePreview.path}{'\n'}{filePreview.content.slice(0, 4000)}</pre> : null}
            {terraMode !== 'none' ? <li className="text-[9px] uppercase tracking-widest text-emerald-500/70">Terra source files</li> : null}
            {visibleFiles.length === 0 ? <li className="text-slate-500">{terraMode === 'none' ? 'No files yet.' : 'No Terra source files in this listing yet.'}</li> : null}
            {visibleFiles.filter(f => inspector || !looksLikeInternalSourcePath(f)).slice(0, 80).map(f => (
              <li key={f}>
                <button type="button" className="w-full truncate text-left text-slate-400 hover:text-emerald-300" onClick={() => void openFile(f)} onContextMenu={e => onContext('file', f, e)}>{f}</button>
              </li>
            ))}
          </ul>
        ) : null}
        {rightTab === 'changes' ? (
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap text-[10px] text-slate-300" onContextMenu={e => onContext('diff', mission?.diff?.changedFiles?.[0] ?? 'working tree', e)}>
            {mission?.diff?.diff || '(no diff yet)'}
          </pre>
        ) : null}
        {rightTab === 'tests' ? (
          <ul>
            {tests.length === 0 ? <li className="text-slate-500">No tests run yet.</li> : null}
            {tests.map((t, i) => (
              <li key={i} className={t.ok ? 'text-emerald-400' : 'text-red-400'}>{t.operation.id}: {t.ok ? 'PASS' : 'FAIL'}</li>
            ))}
          </ul>
        ) : null}
        {rightTab === 'preview' ? (
          <p className="text-slate-400">
            {selectedWorkspace?.previewUrl
              ? <>Local preview {selectedWorkspace.runtimeStatus === 'RUNNING' ? 'is running' : 'can be started'} at {selectedWorkspace.previewUrl}.</>
              : 'Local preview uses the project process registry when a server exists — never the development server.'}
            {selectedWorkspace?.previewUrl ? (
              <button type="button" className="ml-2 text-emerald-300 underline" onClick={() => {
                if (selectedWorkspace) void openProjectPreview(selectedWorkspace)
              }}>
                {selectedWorkspace.previewLive ? 'Open Preview' : 'Start Preview'}
              </button>
            ) : ' No preview process.'}
          </p>
        ) : null}
        {rightTab === 'research' ? (
          <div data-testid="foundry-research-sources">
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Research / Sources <span className="text-emerald-400">{landingResearch?.status ?? researchFreshness ?? 'IDLE'}</span></p>
            {engineer?.researchProvenance?.sources?.length || landingResearch?.sources.length ? (
              <ul className="mt-1 space-y-1 text-[10px] text-slate-400">
                {(engineer?.researchProvenance?.sources?.length ? engineer.researchProvenance.sources : landingResearch?.sources ?? []).slice(0, 8).map(source => (
                  <li key={source.url} title={source.url}>
                    <span className="mr-1 text-[8px] uppercase tracking-widest text-emerald-500">{typeof source === 'object' && source && 'kind' in source && typeof source.kind === 'string' ? source.kind : landingResearch?.status === 'LIVE' ? 'live' : 'source'}</span>
                    {source.title}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-slate-600">{landingResearch?.status === 'UNAVAILABLE' ? 'Research provider unavailable.' : 'No live research for this session.'}</p>
            )}
            {engineer?.researchProvenance?.query || landingResearch?.query ? <p className="mt-2 font-mono text-[10px] text-slate-500">{engineer?.researchProvenance?.query ?? landingResearch?.query}</p> : null}
          </div>
        ) : null}
        </>
        ) : null}
        <button type="button" className="w-full rounded border border-white/10 py-1 text-[10px] uppercase tracking-widest text-slate-400" data-testid="foundry-show-terminal" onClick={() => {
          if (workbenchW0) {
            void fetch('/api/foundry/workbench/editor', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ kind: 'openTerminal' }),
            })
            return
          }
          setDrawer(drawer === 'hidden' ? 'terminal' : 'hidden')
        }}>
          {workbenchW0 ? 'Open Workbench terminal' : drawer === 'hidden' ? 'Show' : 'Hide'} terminal
        </button>
        {workbenchW0 ? (
          <button type="button" className="mt-1 w-full rounded py-1 text-[9px] uppercase tracking-widest text-slate-500 hover:bg-white/[0.04]" data-testid="foundry-terminal-fallback" onClick={() => setDrawer(drawer === 'terminal' ? 'hidden' : 'terminal')}>
            Fallback Foundry terminal
          </button>
        ) : null}
      </aside>
      ) : null}

      {drawer !== 'hidden' ? (
        <div className="foundry-glass relative z-10 rounded-lg p-2 lg:col-span-full" data-testid="foundry-bottom">
          <div className="mb-2 flex gap-3 text-[10px] uppercase tracking-widest text-slate-500">
            {(opsOpen || inspector || detailsOpen ? (['terminal', 'diff', 'tests', 'logs', 'processes'] as const) : (['terminal'] as const)).map(tab => (
              <button
                key={tab}
                type="button"
                className={`${drawer === tab ? 'text-emerald-300' : ''} ${tab === 'tests' && testsRunning ? 'foundry-tab-pulse' : ''} ${tab === 'tests' && testsFailed ? 'text-red-400' : ''} ${tab === 'terminal' && Boolean(liveOutput) ? 'text-cyan-300' : ''}`}
                onClick={() => setDrawer(tab)}
              >
                {tab}
              </button>
            ))}
            <button type="button" className="ml-auto text-slate-600" onClick={() => setDrawer('hidden')}>Close</button>
          </div>
          {drawer === 'terminal' ? (
            <>
            {liveOutput ? <pre data-testid="foundry-raw-command-output" className="mb-2 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-emerald-100">{liveOutput}</pre> : null}
            <FoundryTerminal
              cwd={selectedWorkspace?.root ?? undefined}
              projectRoot={selectedWorkspace?.root ?? undefined}
              projectId={selectedWorkspace?.applicationProjectId ?? selectedWorkspace?.id ?? workspaceId}
              onClose={() => setDrawer('hidden')}
            />
            </>
          ) : null}
          {drawer === 'diff' ? <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-[10px] text-slate-300">{mission?.diff?.diff || '(no diff)'}</pre> : null}
          {drawer === 'tests' ? <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-[10px] text-slate-300">{tests.map(t => `${t.operation.id} ${t.ok ? 'PASS' : 'FAIL'}\n${t.stderr || t.stdout}`).join('\n') || '(no tests)'}</pre> : null}
          {drawer === 'logs' ? (
            <ul className="max-h-48 overflow-auto text-[11px] text-slate-400">
              {(engineer?.progressEvents ?? []).slice(-30).map((e, i) => <li key={i}>{e.step} — {e.detail}</li>)}
            </ul>
          ) : null}
          {drawer === 'processes' ? <pre className="text-[10px] text-slate-300">{processes.length ? JSON.stringify(processes, null, 2) : '(no owned processes)'}</pre> : null}
        </div>
      ) : null}

      {inspector ? (
        <div className="foundry-glass relative z-10 rounded-lg p-2 lg:col-span-full" data-testid="foundry-inspector">
          <p className="mb-2 text-[10px] uppercase tracking-widest text-amber-400">Advanced inspector — low-level Engineering Core controls</p>
          <BuilderWorkspace basePath={basePath} />
        </div>
      ) : null}

      <FoundryContextMenu menu={menu} onClose={() => setMenu(null)} onAction={handleContextAction} />
      {browserUrl ? (
        <FoundryBrowser
          initialUrl={browserUrl}
          title={selectedWorkspace?.displayTitle ?? selectedWorkspace?.label ?? 'Preview'}
          onClose={() => setBrowserUrl(null)}
        />
      ) : null}
    </div>
    </div>
  )
}

export function FoundryShell(props: { basePath?: string }) {
  return (
    <Suspense fallback={<p className="p-4 text-[11px] uppercase tracking-widest text-slate-500">Loading Foundry…</p>}>
      <FoundryShellInner {...props} />
    </Suspense>
  )
}

export { FoundryShell as EngineeringMissionConsole }
