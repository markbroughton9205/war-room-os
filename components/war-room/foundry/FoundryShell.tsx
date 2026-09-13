'use client'

/**
 * THE FOUNDRY — Commander coding workspace.
 * One prompt. Automatic orchestration. Live work stream. No agent control panel.
 */
import { Suspense, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { BuilderWorkspace } from '@/components/war-room/builder/BuilderWorkspace'
import { looksLikeNewApplication, projectNameFromPrompt, statusNarrative, toCommanderState } from '@/lib/native-builder/foundryCommanderState'
import { FoundryContextMenu, type FoundryContextMenuState } from './FoundryContextMenu'
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

type WorkspaceItem = { id: string; label: string; root: string; projectType?: string }

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

async function postJson<T>(url: string, body: unknown): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) return { ok: false, error: typeof json.error === 'string' ? json.error : `HTTP ${res.status}` }
    return { ok: true, data: json as T }
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
  const [rightTab, setRightTab] = useState<'files' | 'changes' | 'tests' | 'preview'>('files')
  const [inspector, setInspector] = useState(false)
  const [projectOffer, setProjectOffer] = useState<string | null>(null)
  const [menu, setMenu] = useState<FoundryContextMenuState>(null)
  const [commitMsg, setCommitMsg] = useState('')
  const [processes, setProcesses] = useState<{ label?: string; pid?: number }[]>([])
  const [liveOutput, setLiveOutput] = useState<string>('')
  const streamRef = useRef<EventSource | null>(null)

  const qs = (extra?: Record<string, string | null | undefined>) => {
    const params = new URLSearchParams()
    const ws = extra?.workspace === undefined ? workspaceId : extra.workspace
    const sess = extra?.session === undefined ? sessionId : extra.session
    const missionQ = extra?.mission === undefined ? missionId : extra.mission
    if (ws) params.set('workspace', ws)
    if (sess) params.set('session', sess)
    if (missionQ) params.set('mission', missionQ)
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

  const selectedWorkspace = workspaces.find(w => w.id === workspaceId)
  const engineer = mission?.engineer
  const commanderState = toCommanderState(engineer, mission?.validationResults)
  const narrative = statusNarrative(engineer, mission?.validationResults)
  const workstream = useMemo(() => {
    const events = engineer?.workstream?.length
      ? engineer.workstream
      : (session?.activity ?? []).map((item, i) => ({ id: `${item.at}-${i}`, at: item.at, kind: 'status', text: item.detail, source: 'audit' as const }))
    return events.slice(-40)
  }, [engineer?.workstream, session?.activity])

  const tests = mission?.validationResults ?? []
  const testPass = tests.filter(t => t.ok).length
  const complete = commanderState === 'COMPLETE'
  const plusMinus = useMemo(() => {
    const diff = mission?.diff?.diff ?? ''
    const plus = (diff.match(/^\+[^+]/gm) ?? []).length
    const minus = (diff.match(/^-[^-]/gm) ?? []).length
    return { plus, minus }
  }, [mission?.diff?.diff])

  const ensureProjectAndSend = async (text: string, wsId: string | null) => {
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
        title: text.trim().slice(0, 60),
        workspaceId: workspace,
        projectName: workspaces.find(w => w.id === workspace)?.label,
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
    })
    setBusy(null)
    if (!result.ok || !result.data) return setError(result.error ?? 'Mission failed to start')
    setRequest('')
    setProjectOffer(null)
    router.replace(qs({ workspace, session: activeSession, mission: result.data.mission.id }))
    setDrawer('logs')
  }

  const send = async () => {
    if (!request.trim()) return setError('Describe what Foundry should build or fix.')
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
    else if (action === 'Open' && kind === 'project') router.replace(qs({ workspace: workspaces.find(w => w.label === target || w.id === target)?.id ?? workspaceId, session: null, mission: null }))
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

  useEffect(() => {
    if (drawer !== 'processes' || !missionId) return
    void getJson<{ processes: { label?: string; pid?: number }[] }>(`/api/mission-runtime/engineering/${missionId}/processes`).then(r => {
      if (r.ok && r.data) setProcesses(r.data.processes)
    })
  }, [drawer, missionId])

  return (
    <div className="relative grid min-h-[80vh] grid-cols-1 gap-3 xl:grid-cols-[220px_minmax(0,1fr)_280px]" data-testid="foundry-normal-mode" onClick={() => setMenu(null)}>
      <aside className="space-y-3 rounded border border-emerald-900/40 bg-neutral-950/70 p-3" data-testid="foundry-left">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-emerald-500">War Room</p>
          <h2 className="text-sm font-bold uppercase tracking-widest text-emerald-300">The Foundry</h2>
          <p className="mt-1 text-[10px] text-slate-500">{status?.foundryModelStatus?.codingModel ?? status?.foundryModelStatus?.detail ?? 'Local coder'}</p>
        </div>
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">Projects</p>
          {workspaces.map(w => (
            <button
              key={w.id}
              type="button"
              onClick={() => router.replace(qs({ workspace: w.id, session: null, mission: null }))}
              onContextMenu={e => onContext('project', w.label, e)}
              className={`mb-1 w-full truncate rounded border px-2 py-1 text-left text-[11px] ${workspaceId === w.id ? 'border-emerald-500 text-emerald-200' : 'border-transparent text-slate-400'}`}
            >
              {w.label}
            </button>
          ))}
        </div>
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">Sessions</p>
          {sessions.map(s => (
            <button
              key={s.id}
              type="button"
              onClick={() => router.replace(qs({ session: s.id, mission: s.activeMissionId ?? null }))}
              className={`mb-1 w-full truncate rounded border px-2 py-1 text-left text-[11px] ${sessionId === s.id ? 'border-emerald-500 text-emerald-200' : 'border-transparent text-slate-400'}`}
            >
              {s.title}
            </button>
          ))}
        </div>
        <button type="button" className="w-full rounded border border-white/10 py-1 text-[10px] uppercase tracking-widest text-slate-500" data-testid="foundry-inspector-toggle" onClick={() => setInspector(v => !v)}>
          {inspector ? 'Hide inspector' : 'Advanced / Inspector'}
        </button>
      </aside>

      <section className="flex min-h-0 flex-col rounded border border-emerald-900/40 bg-black/40" data-testid="foundry-chat">
        <div className="border-b border-white/10 p-3">
          <p className="text-[10px] uppercase tracking-widest text-slate-500">{selectedWorkspace?.label ?? 'No project selected'}</p>
          <p className="text-sm text-emerald-200">{session?.title ?? 'Foundry'}</p>
          <p className="mt-1 text-[11px] uppercase tracking-widest text-amber-300" data-testid="foundry-commander-state">{commanderState}</p>
          {narrative.error ? <p className="mt-1 text-[11px] text-red-400">{narrative.error}</p> : null}
          {error ? <p className="mt-1 text-[11px] text-red-400">{error}</p> : null}
        </div>
        <div className="min-h-[180px] flex-1 space-y-2 overflow-auto p-3 text-[12px]">
          {(session?.chat ?? []).map(msg => (
            <div key={msg.id} className="rounded border border-white/5 bg-white/[0.03] p-2">
              <p className="text-[9px] uppercase tracking-widest text-emerald-500">{msg.speaker === 'COMMANDER' ? 'You' : 'Foundry'}</p>
              <p className="whitespace-pre-wrap text-slate-200">{msg.text}</p>
            </div>
          ))}
          <div data-testid="foundry-activity" className="space-y-1">
            {workstream.map(item => (
              <p key={item.id} className="text-[11px] text-slate-400">{item.text}</p>
            ))}
          </div>
          {complete ? (
            <div className="rounded border border-emerald-500/40 bg-emerald-950/20 p-3" data-testid="foundry-completion-card">
              <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-300">Complete</p>
              <p className="mt-1 text-slate-300">Created: {engineer?.filesChanged?.length ?? files.length} files</p>
              <p className="text-slate-300">Tests: {tests.length ? `${testPass}/${tests.length} ${testPass === tests.length ? 'PASS' : 'FAIL'}` : (engineer?.validationOutcome ?? 'n/a')}</p>
              <p className="text-slate-300">Validation: {engineer?.validationOutcome ?? 'PASS'}</p>
              <p className="text-slate-300">Changed: +{plusMinus.plus} / -{plusMinus.minus}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className="rounded border border-emerald-500/40 px-2 py-1 text-[10px] uppercase text-emerald-300" onClick={() => setRightTab('preview')}>Open Preview</button>
                <button type="button" className="rounded border border-white/15 px-2 py-1 text-[10px] uppercase text-slate-300" onClick={() => setDrawer('diff')}>View Diff</button>
                <button type="button" className="rounded border border-white/15 px-2 py-1 text-[10px] uppercase text-slate-300" onClick={() => setRightTab('files')}>Open Files</button>
                <button type="button" className="rounded border border-white/15 px-2 py-1 text-[10px] uppercase text-slate-300" onClick={() => void ensureProjectAndSend('Run tests', workspaceId)}>Run Tests</button>
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
        <div className="border-t border-white/10 p-3" data-testid="foundry-prompt">
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
            className="h-20 w-full rounded border border-white/10 bg-black/50 p-2 text-[12px] text-white"
            placeholder='Build me a calculator.  Add authentication.  Fix the failing tests.'
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
            <button type="button" data-testid="foundry-stop" disabled={!missionId || busy !== null} className="rounded border border-red-500/40 px-3 py-1 text-[10px] uppercase tracking-widest text-red-300" onClick={() => void stop()}>Stop</button>
          </div>
        </div>
      </section>

      <aside className="space-y-3 rounded border border-emerald-900/40 bg-neutral-950/70 p-3 text-[11px]" data-testid="foundry-right">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Status</p>
        <p className="font-mono text-[11px] text-amber-200">{narrative.state}</p>
        <p><span className="text-slate-500">Current:</span> {narrative.current}</p>
        <p><span className="text-slate-500">Last:</span> {engineer?.lastCompletedAction ?? narrative.completed.at(-1) ?? '—'}</p>
        <p><span className="text-slate-500">Next:</span> {narrative.next}</p>
        {commanderState === 'REPAIRING' && engineer?.failureEvidence ? (
          <div className="rounded border border-red-500/30 p-2 text-red-300" data-testid="foundry-repair-evidence">
            <p>Failure: {engineer.failureEvidence.errorSummary}</p>
            <p className="text-[10px] text-slate-400">{engineer.failureEvidence.command} · {engineer.failureEvidence.file ?? engineer.failureEvidence.id}</p>
            <p>Current: {engineer.failureEvidence.repairAction}</p>
          </div>
        ) : null}
        <div className="flex gap-2 text-[9px] uppercase tracking-widest text-slate-500">
          {(['files', 'changes', 'tests', 'preview'] as const).map(tab => (
            <button key={tab} type="button" className={rightTab === tab ? 'text-emerald-300' : ''} onClick={() => setRightTab(tab)}>{tab}</button>
          ))}
        </div>
        {rightTab === 'files' ? (
          <ul className="max-h-56 space-y-0.5 overflow-auto">
            {filePreview ? <pre className="mb-2 max-h-40 overflow-auto whitespace-pre-wrap text-[10px] text-slate-300">{filePreview.path}{'\n'}{filePreview.content.slice(0, 4000)}</pre> : null}
            {files.slice(0, 80).map(f => (
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
        <button type="button" className="w-full rounded border border-white/10 py-1 text-[10px] uppercase tracking-widest text-slate-400" onClick={() => setDrawer(drawer === 'hidden' ? 'logs' : 'hidden')}>
          {drawer === 'hidden' ? 'Show' : 'Hide'} terminal
        </button>
      </aside>

      {drawer !== 'hidden' ? (
        <div className="xl:col-span-3 rounded border border-white/10 bg-black/30 p-2" data-testid="foundry-bottom">
          <div className="mb-2 flex gap-3 text-[10px] uppercase tracking-widest text-slate-500">
            {(['terminal', 'diff', 'tests', 'logs', 'processes'] as const).map(tab => (
              <button key={tab} type="button" className={drawer === tab ? 'text-emerald-300' : ''} onClick={() => setDrawer(tab)}>{tab}</button>
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
        <div className="xl:col-span-3 rounded border border-amber-500/20 p-2" data-testid="foundry-inspector">
          <p className="mb-2 text-[10px] uppercase tracking-widest text-amber-400">Advanced inspector — low-level Engineering Core controls</p>
          <BuilderWorkspace basePath={basePath} />
        </div>
      ) : null}

      <FoundryContextMenu menu={menu} onClose={() => setMenu(null)} onAction={handleContextAction} />
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
