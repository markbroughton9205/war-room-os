'use client'

/**
 * THE FOUNDRY — Commander coding workspace.
 * One prompt. Automatic orchestration. Live work stream. No agent control panel.
 */
import { Suspense, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { BuilderWorkspace } from '@/components/war-room/builder/BuilderWorkspace'
import { looksLikeNewApplication, projectNameFromPrompt, statusNarrative, toCommanderState } from '@/lib/native-builder/foundryCommanderState'
import { persistFoundryResume, readFoundryResume } from '@/lib/native-builder/foundryNavigation'
import { buildFoundryCompletionTruth } from '@/lib/native-builder/foundryCompletionTruth'
import {
  WAR_ROOM_CANONICAL_WORKSPACE_ID,
  isWarRoomSelfEditRequest,
  resolveFoundryMissionWorkspace,
} from '@/lib/native-builder/foundryWorkspaceIdentityCore'
import {
  FOUNDRY_LIVE_MISSION_STATES,
  foundryToneBorder,
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
}

type WorkspaceItem = {
  id: string
  label: string
  root: string
  projectType?: string
  workspaceType?: string
  displayTitle?: string
  displayKind?: string
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
}

type MissionLite = {
  id: string
  status: string
  title: string
  engineer?: EngineerState
  validationResults?: { operation: { id: string; targets?: string[] }; ok: boolean; exitCode: number | null; stdout: string; stderr: string }[]
  diff?: { diff: string; truncated: boolean; changedFiles: string[] }
}

type FoundryStatus = {
  overall: string
  foundryModelStatus?: { localCoder: string; codingModel: string | null; detail: string }
}

async function getJson<T>(url: string): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const res = await fetch(url, { cache: 'no-store' })
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
  const [status, setStatus] = useState<FoundryStatus | null>(null)
  const [session, setSession] = useState<SessionItem | null>(null)
  const [mission, setMission] = useState<MissionLite | null>(null)
  const [files, setFiles] = useState<string[]>([])
  const [filePreview, setFilePreview] = useState<{ path: string; content: string } | null>(null)
  const [request, setRequest] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [drawer, setDrawer] = useState<'hidden' | 'terminal' | 'diff' | 'tests' | 'logs' | 'processes'>('hidden')
  const [rightTab, setRightTab] = useState<'files' | 'changes' | 'tests' | 'preview' | 'research'>('files')
  const [inspector, setInspector] = useState(false)
  const [projectOffer, setProjectOffer] = useState<string | null>(null)
  const [workspaceConfirm, setWorkspaceConfirm] = useState<{ reason: string; path: string } | null>(null)
  const [menu, setMenu] = useState<FoundryContextMenuState>(null)
  const [commitMsg, setCommitMsg] = useState('')
  const [processes, setProcesses] = useState<{ label?: string; pid?: number }[]>([])
  const [liveOutput, setLiveOutput] = useState<string>('')
  const streamRef = useRef<EventSource | null>(null)
  const restoredRef = useRef(false)

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
      getJson<{ workspaces: WorkspaceItem[] }>('/api/mission-runtime/engineering/workspaces'),
      getJson<{ status: FoundryStatus }>('/api/mission-runtime/engineering/status'),
      getJson<{ sessions: SessionItem[] }>(sessUrl),
    ])
    if (ws.ok && ws.data) setWorkspaces(ws.data.workspaces)
    if (st.ok && st.data) setStatus(st.data.status)
    if (sess.ok && sess.data) setSessions(sess.data.sessions)
    if (sessionId) {
      const one = await getJson<{ session: SessionItem }>(withWs(`/api/mission-runtime/engineering/foundry/sessions/${sessionId}`))
      if (one.ok && one.data) setSession(one.data.session)
      else setSession(null)
    } else {
      setSession(null)
    }
    const listing = await getJson<{ files: string[] }>(withWs('/api/mission-runtime/engineering/repo/files'))
    if (listing.ok && listing.data) setFiles(listing.data.files)
  }

  useEffect(() => {
    void reload()
    const timer = window.setInterval(() => void reload(), 5000)
    return () => window.clearInterval(timer)
  }, [workspaceId, sessionId])

  useEffect(() => {
    if (!missionId) {
      setMission(null)
      return
    }
    void getJson<{ mission: MissionLite }>(withWs(`/api/mission-runtime/engineering/${missionId}`)).then(result => {
      if (result.ok && result.data) setMission(result.data.mission)
    })
    if (typeof EventSource === 'undefined') return
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
          setDrawer(d => (d === 'hidden' ? 'terminal' : d))
        }
      } catch { /* ignore */ }
    }
    source.addEventListener('progress', onEnvelope)
    source.addEventListener('final', onEnvelope)
    source.addEventListener('command_output', onOutput)
    return () => {
      source.close()
    }
  }, [missionId, workspaceId])

  useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true
    if (workspaceId || sessionId || missionId) return
    const saved = readFoundryResume()
    if (!saved?.workspace && !saved?.session && !saved?.mission) return
    router.replace(qs({
      workspace: saved?.workspace,
      session: saved?.session,
      mission: saved?.mission,
    }))
  }, [])

  useEffect(() => {
    if (!workspaceId && !sessionId && !missionId) return
    persistFoundryResume({
      basePath,
      workspace: workspaceId,
      session: sessionId,
      mission: missionId,
    })
  }, [basePath, workspaceId, sessionId, missionId])

  const selectedWorkspace = workspaces.find(w => w.id === workspaceId)
  const workspaceTitle = selectedWorkspace?.displayTitle ?? selectedWorkspace?.label ?? 'No project selected'
  const workspaceKind = selectedWorkspace?.displayKind ?? 'No workspace'
  const engineer = mission?.engineer
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
  }, [engineer?.workstream, session?.activity, sessionId])

  const tests = mission?.validationResults ?? []
  const truth = engineer?.completionTruth ?? buildFoundryCompletionTruth({
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
    setDrawer('logs')
  }

  const send = async () => {
    if (!request.trim()) return setError('Describe what Foundry should build or fix.')
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
    if (!workspaceId && !looksLikeNewApplication(request) && !projectOffer) {
      setProjectOffer(projectNameFromPrompt(request))
      return
    }
    await ensureProjectAndSend(request, workspaceId)
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
    else if (action === 'Open' && kind === 'project') router.replace(qs({ workspace: workspaces.find(w => w.displayTitle === target || w.label === target || w.id === target)?.id ?? workspaceId, session: null, mission: null }))
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
      if (!window.confirm('A Foundry mission is still running. Start a new session without cancelling it?')) return
    }
    if (!workspaceId) {
      router.replace(qs({ workspace: null, session: null, mission: null }))
      setSession(null)
      setMission(null)
      setError(null)
      return
    }
    const created = await postJson<{ session: SessionItem }>('/api/mission-runtime/engineering/foundry/sessions', {
      title: 'New Coding Session',
      workspaceId,
      projectName: workspaceTitle,
    })
    if (!created.ok || !created.data) return setError(created.error ?? 'Could not open a new session')
    setSession(created.data.session)
    setMission(null)
    setError(null)
    router.replace(qs({ workspace: workspaceId, session: created.data.session.id, mission: null }))
  }

  const localCoderReady = status?.foundryModelStatus?.localCoder === 'LOCAL_CODER_READY'
  const researchFreshness = researchFreshnessLabel(engineer?.researchProvenance?.status)
  const testsRunning = commanderState === 'TESTING'
  const testsFailed = tests.some(t => !t.ok)
  const showCompletion = Boolean(sessionId && commanderState === 'COMPLETE')
  const centerChat = sessionId ? (session?.chat ?? []) : []
  const landing = !sessionId || (centerChat.length === 0 && !missionId)
  const terraBinding = terraBuildContextBinding(terraMode)
  const visibleFiles = terraMode === 'none' ? files : files.filter(isTerraSourcePath)
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

  return (
    <div>
      <FoundryHomeNav
        workspaceTitle={workspaceTitle}
        workspaceKind={workspaceKind}
        workspacePath={selectedWorkspace?.root}
        visual={visual}
      />
    <div className="relative grid min-h-[calc(100vh-8.5rem)] grid-cols-1 gap-2 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_280px]" data-testid="foundry-normal-mode" onClick={() => setMenu(null)}>
      <MatrixBackground contained channelOverride={visual.matrixChannel} intensity={visual.intensity} />
      <FoundryTerraBackground terraContext={terraMode} />
      <aside className="foundry-glass relative z-10 flex min-h-0 flex-col space-y-2 rounded-lg border border-emerald-400/20 p-2" data-testid="foundry-left">
        <div className="rounded border border-emerald-400/15 px-2 py-1.5" data-testid="foundry-identity-rail">
          <p className="text-[9px] font-bold uppercase tracking-[0.28em] text-slate-500">WAR ROOM</p>
          <p className="mt-0.5 text-[11px] font-bold uppercase tracking-[0.22em] text-emerald-200">THE FOUNDRY</p>
          <p className={`mt-1 text-[9px] uppercase tracking-widest ${localCoderReady ? 'text-emerald-400' : 'text-slate-500'}`} data-testid="foundry-local-coder-rail">
            LOCAL CODER {localCoderReady ? 'READY' : status?.foundryModelStatus?.localCoder ? 'UNAVAILABLE' : 'UNKNOWN'}
          </p>
        </div>
        <div className="rounded border border-emerald-400/15 px-2 py-1" data-testid="foundry-workspace-truth" title={selectedWorkspace?.root ?? 'No workspace selected'}>
          <p className="truncate text-[11px] font-bold text-emerald-100">{workspaceTitle}</p>
          <p className="truncate text-[9px] uppercase tracking-widest text-slate-500">{workspaceKind}</p>
        </div>
        <div>
          <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-emerald-500/70">Projects</p>
          <div className="max-h-36 space-y-1 overflow-auto">
            {workspaces.map(w => (
              <button
                key={w.id}
                type="button"
                title={w.root}
                onClick={() => router.replace(qs({ workspace: w.id, session: null, mission: null }))}
                onContextMenu={e => onContext('project', w.displayTitle ?? w.label, e)}
                className={`w-full rounded-lg border px-2 py-1.5 text-left text-[11px] transition-colors ${workspaceId === w.id ? 'border-emerald-400/70 bg-emerald-950/40 text-emerald-100' : 'border-transparent text-slate-400 hover:border-emerald-900/50 hover:bg-black/30'}`}
              >
                <span className="block truncate">{w.displayTitle ?? w.label}</span>
                <span className="block truncate text-[8px] uppercase tracking-widest text-slate-500">{w.displayKind ?? (w.projectType === 'war_room' ? 'Canonical Source' : 'Generated Project')}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-[9px] font-bold uppercase tracking-widest text-emerald-500/70">Sessions</p>
            <button type="button" data-testid="foundry-new-session" className="rounded border border-emerald-400/40 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-emerald-200 hover:bg-emerald-950/40" onClick={() => void startNewSession()}>+ New Session</button>
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
                      aria-current={active ? 'true' : undefined}
                      onClick={() => router.replace(qs({ session: s.id, mission: s.activeMissionId ?? null }))}
                      className="mb-1 w-full rounded-xl border px-2.5 py-2 text-left transition-all"
                      style={{
                        borderColor: active ? 'rgba(52,211,153,0.7)' : 'rgba(52,211,153,0.16)',
                        background: active ? 'rgba(16,64,48,0.35)' : 'rgba(6,20,16,0.55)',
                        boxShadow: active ? '0 0 16px rgba(52,211,153,0.22), inset 0 0 12px rgba(52,211,153,0.06)' : 'none',
                      }}
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span className="truncate text-[11px] font-semibold">{shortSessionTitle(s.title)}</span>
                        <span className="shrink-0 text-[8px] text-slate-500">{relativeSessionTime(s.updatedAt)}</span>
                      </span>
                      <span className={`mt-0.5 block text-[8px] uppercase tracking-widest ${kindClass}`}>{kind}</span>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
        <button
          type="button"
          className={`w-full rounded border py-1 text-[9px] uppercase tracking-widest ${terraMode === 'none' ? 'border-white/10 text-slate-500' : 'border-emerald-400/40 text-emerald-200'}`}
          data-testid="foundry-terra-build-context"
          onClick={() => setTerraContext(terraMode === 'none' ? 'build' : 'none')}
        >
          {terraMode === 'none' ? 'Terra build context' : 'Exit Terra build context'}
        </button>
        <button type="button" className="w-full rounded border border-white/10 py-1 text-[10px] uppercase tracking-widest text-slate-500" data-testid="foundry-inspector-toggle" onClick={() => setInspector(v => !v)}>
          {inspector ? 'Hide inspector' : 'Advanced / Inspector'}
        </button>
      </aside>

      <section className={`relative z-10 flex min-h-0 flex-col rounded-lg border border-emerald-400/20 ${landing ? 'foundry-glass foundry-glass-landing' : 'foundry-glass'}`} data-testid="foundry-chat">
        <div className="border-b border-emerald-400/15 px-3 py-2">
          <p className="text-[9px] uppercase tracking-[0.28em] text-emerald-500/70">Foundry</p>
          <p className="text-sm text-emerald-100" data-testid="foundry-session-identity">{sessionLabel}</p>
          <p className={`mt-1 text-[11px] uppercase tracking-widest ${foundryToneClass(visual.tone)}`} data-testid="foundry-commander-state">{visual.label}</p>
          {narrative.error ? <p className="mt-1 text-[11px] text-red-400">{narrative.error}</p> : null}
          {error ? <p className="mt-1 text-[11px] text-red-400">{error}</p> : null}
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
        <div className="min-h-[180px] flex-1 space-y-2 overflow-auto p-3 text-[12px]">
          {!sessionId || (centerChat.length === 0 && !missionId) ? (
            <div className="flex h-full min-h-[220px] items-center justify-center text-center" data-testid="foundry-new-session-empty">
              <div className="foundry-landing mx-auto max-w-xl px-2" data-testid="foundry-landing">
                <p className="foundry-landing-mark foundry-glitch-mark">W</p>
                <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.42em] text-emerald-300">FOUNDRY READY</p>
                <p className="mt-2 text-[13px] font-semibold uppercase tracking-[0.22em] text-emerald-100">CODE TODAY.</p>
                <p className="text-[13px] font-semibold uppercase tracking-[0.22em] text-emerald-100">A SAFER TOMORROW.</p>
                <p className="mt-3 text-[11px] font-bold uppercase tracking-widest text-emerald-400/80">New Session / Ready</p>
                <p className="mt-1 text-[11px] text-slate-500">Previous work stays in session history until you select it.</p>
                <div className="mt-4 grid grid-cols-2 gap-2" data-testid="foundry-landing-actions">
                  <button type="button" className="foundry-action-card" onClick={() => void startNewSession()}>New Session</button>
                  <button type="button" className="foundry-action-card" onClick={() => router.replace(qs({ workspace: workspaceId ?? WAR_ROOM_CANONICAL_WORKSPACE_ID, session: null, mission: null }))}>Open Project</button>
                  <button type="button" className="foundry-action-card" onClick={() => setRequest('Run ')}>Run a command</button>
                  <button type="button" className="foundry-action-card" onClick={() => setRightTab('research')}>Research</button>
                </div>
              </div>
            </div>
          ) : null}
          {centerChat.map(msg => (
            <div key={msg.id} className="rounded border border-emerald-400/10 bg-black/30 p-2">
              <p className="text-[9px] uppercase tracking-widest text-emerald-500">{msg.speaker === 'COMMANDER' ? 'You' : 'Foundry'}</p>
              <p className="whitespace-pre-wrap text-slate-200">{msg.text}</p>
            </div>
          ))}
          {sessionId && (centerChat.length > 0 || Boolean(missionId)) ? (
          <div data-testid="foundry-activity" className="space-y-1">
            {workstream.map(item => {
              const mark = workstreamMarker(item)
              return (
                <p key={item.id} className={`text-[11px] ${mark.className}`}>
                  <span className="mr-1">{mark.icon}</span>{item.text}
                </p>
              )
            })}
          </div>
          ) : null}
          {showCompletion ? (
            <div className="rounded border border-emerald-400/40 bg-emerald-950/20 p-3" data-testid="foundry-completion-card">
              <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-300">{truth.canComplete ? 'COMPLETE' : 'NOT COMPLETE'}</p>
              {truth.headline !== 'NOT COMPLETE' ? <p className="text-[10px] uppercase tracking-widest text-emerald-400">{truth.headline}</p> : null}
              <p className="mt-1 text-[11px] text-slate-400">{truth.detail}</p>
              <p className="mt-1 text-slate-300">Files {truth.created.length + truth.modified.length} changed</p>
              <p className="text-slate-300">Tests {truth.tests.ran ? `${truth.tests.pass} / ${truth.tests.total} ${truth.tests.ok ? 'PASS' : 'FAIL'}` : 'none executed'}</p>
              <p className="text-slate-300">Validation {engineer?.validationOutcome ?? (truth.canComplete ? 'PASS' : 'NOT COMPLETE')}</p>
              <p className="text-slate-300">Diff +{truth.plus}  -{truth.minus}</p>
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
                {truth.surface === 'war_room_source' ? (
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
                  <button type="button" disabled={busy !== null} className="rounded border border-cyan-500/40 px-2 py-1 text-[10px] uppercase text-cyan-300" onClick={() => void push()}>Push</button>
                  <button type="button" className="rounded border border-red-500/30 px-2 py-1 text-[10px] uppercase text-red-300" onClick={() => void deploy()}>Deploy</button>
                  <button type="button" className="rounded border border-white/10 px-2 py-1 text-[10px] uppercase text-slate-500" onClick={() => setCommitMsg('')}>Not Now</button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
        <div className="border-t border-emerald-400/15 p-3" data-testid="foundry-prompt">
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
          <textarea
            data-testid="foundry-chat-input"
            className="h-20 w-full rounded-lg border border-emerald-400/25 bg-black/55 p-2 font-mono text-[12px] text-emerald-50 outline-none focus:border-emerald-300/50"
            placeholder="Build me a calculator.  @reviewer inspect this diff."
            value={request}
            onChange={e => setRequest(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" data-testid="foundry-send" disabled={busy !== null} className="rounded border border-emerald-500/50 px-3 py-1 text-[10px] uppercase tracking-widest text-emerald-300" onClick={() => void send()}>Send</button>
            <button type="button" data-testid="foundry-stop" disabled={!missionId || busy !== null} className={`rounded border px-3 py-1 text-[10px] uppercase tracking-widest ${missionId ? 'border-red-500/40 text-red-300' : 'border-white/10 text-slate-600'}`} onClick={() => void stop()}>Stop</button>
          </div>
        </div>
      </section>

      <aside className="foundry-glass relative z-10 space-y-3 rounded-lg border border-emerald-400/20 p-3 text-[11px] lg:col-span-2 xl:col-span-1" data-testid="foundry-right">
        <p className="text-[9px] font-bold uppercase tracking-widest text-emerald-500/70">Status</p>
        <div className="flex flex-wrap gap-1 text-[8px] uppercase tracking-widest">
          <span className={`rounded border px-1.5 py-0.5 ${foundryToneBorder(visual.tone)} ${foundryToneClass(visual.tone)}`}>Foundry {visual.label}</span>
          <span className={`rounded border px-1.5 py-0.5 ${localCoderReady ? 'border-emerald-400/40 text-emerald-300' : status?.foundryModelStatus?.localCoder ? 'border-red-400/40 text-red-400' : 'border-white/10 text-slate-500'}`}>Local coder {localCoderReady ? 'READY' : status?.foundryModelStatus?.localCoder ? 'UNAVAILABLE' : 'UNKNOWN'}</span>
          <span className={`rounded border px-1.5 py-0.5 ${researchFreshness === 'LIVE' || researchFreshness === 'FRESH' ? 'border-emerald-400/40 text-emerald-300' : researchFreshness === 'STALE' ? 'border-amber-400/40 text-amber-300' : 'border-white/10 text-slate-500'}`}>Internet research {researchFreshness ?? 'IDLE'}</span>
          <span className={`rounded border px-1.5 py-0.5 ${workspaceId ? 'border-emerald-400/40 text-emerald-300' : 'border-white/10 text-slate-500'}`}>Project {workspaceId ? 'GREEN' : 'IDLE'}</span>
          <span className={`rounded border px-1.5 py-0.5 ${testsFailed ? 'border-red-400/40 text-red-400' : testsRunning ? 'border-cyan-400/40 text-cyan-300' : truth.tests.ok ? 'border-emerald-400/40 text-emerald-300' : 'border-white/10 text-slate-500'}`}>Tests {testsFailed ? 'FAIL' : testsRunning ? 'RUNNING' : truth.tests.ran ? `${truth.tests.pass}/${truth.tests.total}` : 'IDLE'}</span>
        </div>
        <p className={`font-mono text-[11px] ${foundryToneClass(visual.tone)}`}>{narrative.state}</p>
        <p><span className="text-slate-500">Current:</span> {sessionId ? narrative.current : 'Ready'}</p>
        <p><span className="text-slate-500">Last:</span> {sessionId ? (engineer?.lastCompletedAction ?? narrative.completed.at(-1) ?? '—') : '—'}</p>
        <p><span className="text-slate-500">Next:</span> {sessionId ? narrative.next : 'Describe the work'}</p>
        {engineer?.researchProvenance?.sources?.length && rightTab !== 'research' ? (
          <p className="text-[9px] uppercase tracking-widest text-slate-500">Research {researchFreshness}</p>
        ) : null}
        {commanderState === 'REPAIRING' && engineer?.failureEvidence ? (
          <div className="rounded border border-amber-400/40 bg-amber-950/20 p-2 text-amber-200" data-testid="foundry-repair-evidence">
            <p className="font-bold uppercase tracking-widest">Repairing</p>
            <p>Failure: {engineer.failureEvidence.errorSummary}</p>
            <p className="text-[10px] text-slate-400">{engineer.failureEvidence.command} · {engineer.failureEvidence.file ?? engineer.failureEvidence.id}</p>
            <p>Current: {engineer.failureEvidence.repairAction}</p>
            <p>Next: Re-run tests</p>
          </div>
        ) : null}
        {commanderState === 'BLOCKED' ? (
          <div className="rounded border border-red-400/40 bg-red-950/20 p-2 text-red-300" data-testid="foundry-blocked-panel">
            <p className="font-bold uppercase tracking-widest">Blocked</p>
            <p>{engineer?.blockingReason || narrative.error || 'Mission blocked.'}</p>
            <p className="text-[10px] text-slate-400">Commander action may be required.</p>
          </div>
        ) : null}
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
            {visibleFiles.slice(0, 80).map(f => (
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
          <p className="text-slate-400">Local preview uses the Foundry app health port when a server exists — never the development server. {files.some(f => f.endsWith('server.mjs')) ? <a className="text-emerald-300 underline" href="http://127.0.0.1:18765/health" target="_blank" rel="noreferrer">Open Preview</a> : 'No preview process.'}</p>
        ) : null}
        {rightTab === 'research' ? (
          <div data-testid="foundry-research-sources">
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Research / Sources <span className="text-emerald-400">{researchFreshness ?? 'IDLE'}</span></p>
            {engineer?.researchProvenance?.sources?.length ? (
              <ul className="mt-1 space-y-1 text-[10px] text-slate-400">
                {engineer.researchProvenance.sources.slice(0, 8).map(source => (
                  <li key={source.url} title={source.url}>
                    <span className="mr-1 text-[8px] uppercase tracking-widest text-emerald-500">{source.kind ?? 'source'}</span>
                    {source.title}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-slate-600">No live research for this session.</p>
            )}
            {engineer?.researchProvenance?.query ? <p className="mt-2 font-mono text-[10px] text-slate-500">{engineer.researchProvenance.query}</p> : null}
          </div>
        ) : null}
        <button type="button" className="w-full rounded border border-white/10 py-1 text-[10px] uppercase tracking-widest text-slate-400" onClick={() => setDrawer(drawer === 'hidden' ? 'logs' : 'hidden')}>
          {drawer === 'hidden' ? 'Show' : 'Hide'} terminal
        </button>
      </aside>

      {drawer !== 'hidden' ? (
        <div className="foundry-glass relative z-10 rounded-lg border border-emerald-400/20 p-2 lg:col-span-2 xl:col-span-3" data-testid="foundry-bottom">
          <div className="mb-2 flex gap-3 text-[10px] uppercase tracking-widest text-slate-500">
            {(['terminal', 'diff', 'tests', 'logs', 'processes'] as const).map(tab => (
              <button
                key={tab}
                type="button"
                className={`${drawer === tab ? 'text-emerald-300' : ''} ${tab === 'tests' && testsRunning ? 'foundry-tab-pulse' : ''} ${tab === 'tests' && testsFailed ? 'text-red-400' : ''} ${tab === 'terminal' && Boolean(liveOutput) ? 'text-cyan-300' : ''}`}
                onClick={() => setDrawer(tab)}
              >
                {tab}
              </button>
            ))}
            <button type="button" className="ml-auto text-slate-600" onClick={() => setDrawer('hidden')}>Collapse</button>
          </div>
          {drawer === 'terminal' ? <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-[10px] text-slate-300">{liveOutput || engineer?.terminalHistory?.map(t => `$ ${t.command}\n${t.stdout}${t.stderr}`).join('\n') || '(idle)'}</pre> : null}
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
        <div className="foundry-glass relative z-10 rounded-lg border border-amber-500/20 p-2 lg:col-span-2 xl:col-span-3" data-testid="foundry-inspector">
          <p className="mb-2 text-[10px] uppercase tracking-widest text-amber-400">Advanced inspector — low-level Engineering Core controls</p>
          <BuilderWorkspace basePath={basePath} />
        </div>
      ) : null}

      <FoundryContextMenu menu={menu} onClose={() => setMenu(null)} onAction={handleContextAction} />
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
