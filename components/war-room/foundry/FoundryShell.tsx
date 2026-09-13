'use client'

/**
 * THE FOUNDRY — Commander coding organization UI.
 * Thin client over Mission Runtime / native-builder. No second execution engine.
 */
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { BuilderWorkspace } from '@/components/war-room/builder/BuilderWorkspace'

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

type FoundryStatus = {
  overall: string
  localExecution: string
  projectsRoot: string
  foundryModelStatus?: {
    localCoder: string
    hostedCoder: string
    codingModel: string | null
    detail: string
  }
  councilProviderStatus?: string
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
  const [request, setRequest] = useState('')
  const [newName, setNewName] = useState('')
  const [sessionTitle, setSessionTitle] = useState('')
  const [openPath, setOpenPath] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [bottomTab, setBottomTab] = useState<'workspace' | 'hidden'>('workspace')

  const qs = (extra?: Record<string, string | null | undefined>) => {
    const params = new URLSearchParams()
    const ws = extra?.workspace === undefined ? workspaceId : extra.workspace
    const sess = extra?.session === undefined ? sessionId : extra.session
    const mission = extra?.mission === undefined ? missionId : extra.mission
    if (ws) params.set('workspace', ws)
    if (sess) params.set('session', sess)
    if (mission) params.set('mission', mission)
    const s = params.toString()
    return s ? `${basePath}?${s}` : basePath
  }

  const reload = async () => {
    const wsUrl = '/api/mission-runtime/engineering/workspaces'
    const stUrl = '/api/mission-runtime/engineering/status'
    const sessUrl = workspaceId
      ? `/api/mission-runtime/engineering/foundry/sessions?workspaceId=${encodeURIComponent(workspaceId)}`
      : '/api/mission-runtime/engineering/foundry/sessions'
    const [ws, st, sess] = await Promise.all([
      getJson<{ workspaces: WorkspaceItem[] }>(wsUrl),
      getJson<{ status: FoundryStatus }>(stUrl),
      getJson<{ sessions: SessionItem[] }>(sessUrl),
    ])
    if (ws.ok && ws.data) setWorkspaces(ws.data.workspaces)
    if (st.ok && st.data) setStatus(st.data.status)
    if (sess.ok && sess.data) setSessions(sess.data.sessions)
    if (sessionId) {
      const one = await getJson<{ session: SessionItem }>(`/api/mission-runtime/engineering/foundry/sessions/${sessionId}${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''}`)
      if (one.ok && one.data) setSession(one.data.session)
    }
  }

  useEffect(() => {
    void reload()
    const timer = window.setInterval(() => void reload(), 4000)
    return () => window.clearInterval(timer)
  }, [workspaceId, sessionId])

  const createProject = async () => {
    if (!newName.trim()) return
    setBusy('create-project')
    const result = await postJson<{ workspace: WorkspaceItem }>('/api/mission-runtime/engineering/workspaces', {
      action: 'create',
      name: newName.trim(),
      initializeGit: true,
    })
    setBusy(null)
    if (!result.ok || !result.data) return setError(result.error ?? 'Create failed')
    setNewName('')
    router.replace(qs({ workspace: result.data.workspace.id, session: null, mission: null }))
  }

  const openProject = async () => {
    if (!openPath.trim()) return
    setBusy('open-project')
    const result = await postJson<{ workspace: WorkspaceItem }>('/api/mission-runtime/engineering/workspaces', {
      action: 'open',
      path: openPath.trim(),
    })
    setBusy(null)
    if (!result.ok || !result.data) return setError(result.error ?? 'Open failed')
    setOpenPath('')
    router.replace(qs({ workspace: result.data.workspace.id, session: null, mission: null }))
  }

  const createSession = async () => {
    setBusy('session')
    const result = await postJson<{ session: SessionItem }>('/api/mission-runtime/engineering/foundry/sessions', {
      title: sessionTitle.trim() || 'Coding session',
      workspaceId,
      projectName: workspaces.find(w => w.id === workspaceId)?.label,
    })
    setBusy(null)
    if (!result.ok || !result.data) return setError(result.error ?? 'Session failed')
    setSessionTitle('')
    router.replace(qs({ session: result.data.session.id, mission: null }))
  }

  const send = async () => {
    if (!request.trim()) return setError('Describe what Foundry should build or fix.')
    setBusy('mission')
    setError(null)
    let activeSession = sessionId
    if (!activeSession) {
      const created = await postJson<{ session: SessionItem }>('/api/mission-runtime/engineering/foundry/sessions', {
        title: request.trim().slice(0, 60),
        workspaceId,
      })
      if (!created.ok || !created.data) {
        setBusy(null)
        return setError(created.error ?? 'Could not open a coding session')
      }
      activeSession = created.data.session.id
    }
    const result = await postJson<{ mission: { id: string } }>(`/api/mission-runtime/engineering/foundry/sessions/${activeSession}`, {
      text: request.trim(),
      workspaceId,
      waitForCompletion: false,
    })
    setBusy(null)
    if (!result.ok || !result.data) return setError(result.error ?? 'Mission failed to start')
    setRequest('')
    router.replace(qs({ session: activeSession, mission: result.data.mission.id }))
  }

  const stop = async () => {
    if (!missionId) return
    setBusy('stop')
    await postJson(`/api/mission-runtime/engineering/${missionId}/cancel`, { reason: 'Commander STOP MISSION', workspaceId })
    setBusy(null)
  }

  const resume = async () => {
    if (!missionId && !sessionId) return
    setBusy('resume')
    if (missionId) {
      const result = await postJson(`/api/mission-runtime/engineering/${missionId}/resume`, { workspaceId })
      if (result.ok) {
        setBusy(null)
        return
      }
    }
    if (sessionId) {
      await postJson(`/api/mission-runtime/engineering/foundry/sessions/${sessionId}`, {
        text: 'Resume the previous Foundry mission from persisted workspace state.',
        workspaceId,
        waitForCompletion: false,
      })
    }
    setBusy(null)
  }

  const selectedWorkspace = workspaces.find(w => w.id === workspaceId)
  const local = status?.foundryModelStatus

  return (
    <div className="grid min-h-[80vh] grid-cols-1 gap-3 xl:grid-cols-[240px_minmax(0,1fr)_280px]">
      <aside className="space-y-3 rounded border border-emerald-900/40 bg-neutral-950/70 p-3" data-testid="foundry-left">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-emerald-500">War Room</p>
          <h2 className="text-sm font-bold uppercase tracking-widest text-emerald-300">The Foundry</h2>
          <p className="mt-1 text-[10px] uppercase tracking-wider text-cyan-300">{status?.overall ?? '…'} · {local?.localCoder ?? 'probing local coder'}</p>
          <p className="mt-1 text-[10px] text-slate-500">{local?.codingModel ?? local?.detail}</p>
          <p className="text-[10px] text-slate-600">Council: {status?.councilProviderStatus ?? '…'}</p>
        </div>
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">Projects</p>
          {workspaces.map(w => (
            <button key={w.id} type="button" onClick={() => router.replace(qs({ workspace: w.id, session: null, mission: null }))} className={`mb-1 w-full truncate rounded border px-2 py-1 text-left text-[11px] ${workspaceId === w.id ? 'border-emerald-500 text-emerald-200' : 'border-transparent text-slate-400'}`}>
              {w.label}
            </button>
          ))}
          <input className="mt-2 w-full rounded border border-white/10 bg-black/40 p-1.5 text-[11px] text-white" placeholder="New project name" value={newName} onChange={e => setNewName(e.target.value)} />
          <button type="button" data-testid="foundry-new-project" disabled={busy !== null} className="mt-1 w-full rounded border border-emerald-500/40 py-1 text-[10px] uppercase tracking-wider text-emerald-300" onClick={() => void createProject()}>New Project</button>
          <input className="mt-2 w-full rounded border border-white/10 bg-black/40 p-1.5 text-[11px] text-white" placeholder="Open existing path" value={openPath} onChange={e => setOpenPath(e.target.value)} />
          <button type="button" data-testid="foundry-open-project" disabled={busy !== null} className="mt-1 w-full rounded border border-cyan-500/40 py-1 text-[10px] uppercase tracking-wider text-cyan-300" onClick={() => void openProject()}>Open Project</button>
        </div>
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">Sessions</p>
          {sessions.map(s => (
            <button key={s.id} type="button" onClick={() => router.replace(qs({ session: s.id, mission: s.activeMissionId ?? null }))} className={`mb-1 w-full truncate rounded border px-2 py-1 text-left text-[11px] ${sessionId === s.id ? 'border-emerald-500 text-emerald-200' : 'border-transparent text-slate-400'}`}>
              {s.title}
            </button>
          ))}
          <input className="mt-2 w-full rounded border border-white/10 bg-black/40 p-1.5 text-[11px] text-white" placeholder="New coding session" value={sessionTitle} onChange={e => setSessionTitle(e.target.value)} />
          <button type="button" data-testid="foundry-new-session" disabled={busy !== null} className="mt-1 w-full rounded border border-emerald-500/40 py-1 text-[10px] uppercase tracking-wider text-emerald-300" onClick={() => void createSession()}>New Coding Session</button>
        </div>
      </aside>

      <section className="flex min-h-0 flex-col rounded border border-emerald-900/40 bg-black/40" data-testid="foundry-chat">
        <div className="border-b border-white/10 p-3">
          <p className="text-[10px] uppercase tracking-widest text-slate-500">{selectedWorkspace?.label ?? 'No project selected'}</p>
          <p className="text-sm text-emerald-200">{session?.title ?? 'Foundry Master'}</p>
          {error ? <p className="mt-1 text-[11px] text-red-400">{error}</p> : null}
        </div>
        <div className="min-h-[220px] flex-1 space-y-2 overflow-auto p-3 text-[12px]">
          {(session?.chat ?? []).map(msg => (
            <div key={msg.id} className="rounded border border-white/5 bg-white/[0.03] p-2">
              <p className="text-[9px] uppercase tracking-widest text-emerald-500">{msg.speaker}</p>
              <p className="whitespace-pre-wrap text-slate-200">{msg.text}</p>
            </div>
          ))}
          {(session?.activity ?? []).slice(-8).map((item, i) => (
            <p key={`${item.at}-${i}`} className="text-[11px] text-slate-400"><span className="text-cyan-300">{item.role}</span> — {item.detail}</p>
          ))}
        </div>
        <div className="border-t border-white/10 p-3">
          <textarea data-testid="foundry-chat-input" className="h-20 w-full rounded border border-white/10 bg-black/50 p-2 text-[12px] text-white" placeholder='Build me a CRM.  @debugger why did tests fail?' value={request} onChange={e => setRequest(e.target.value)} />
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" data-testid="foundry-send" disabled={busy !== null} className="rounded border border-emerald-500/50 px-3 py-1 text-[10px] uppercase tracking-widest text-emerald-300" onClick={() => void send()}>Send to Foundry</button>
            <button type="button" data-testid="foundry-stop" disabled={!missionId || busy !== null} className="rounded border border-red-500/40 px-3 py-1 text-[10px] uppercase tracking-widest text-red-300" onClick={() => void stop()}>Stop</button>
            <button type="button" data-testid="foundry-resume" disabled={(!missionId && !sessionId) || busy !== null} className="rounded border border-cyan-500/40 px-3 py-1 text-[10px] uppercase tracking-widest text-cyan-300" onClick={() => void resume()}>Resume</button>
          </div>
        </div>
      </section>

      <aside className="space-y-3 rounded border border-emerald-900/40 bg-neutral-950/70 p-3 text-[11px]" data-testid="foundry-right">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Active agents</p>
        <p className="text-emerald-200">{(session?.agents ?? ['FOUNDRY_MASTER']).join(' · ') || 'FOUNDRY_MASTER'}</p>
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Current mission</p>
        <p className="font-mono text-[10px] text-slate-300">{missionId ?? session?.activeMissionId ?? 'none'}</p>
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Approvals</p>
        <p className="text-slate-400">Commit / push / deploy remain Commander-gated. Deploy is denied.</p>
        <button type="button" className="w-full rounded border border-white/10 py-1 text-[10px] uppercase tracking-widest text-slate-400" onClick={() => setBottomTab(bottomTab === 'workspace' ? 'hidden' : 'workspace')}>{bottomTab === 'workspace' ? 'Hide' : 'Show'} Terminal / Diff / Tests</button>
      </aside>

      {bottomTab === 'workspace' ? (
        <div className="xl:col-span-3" data-testid="foundry-bottom">
          <p className="mb-2 text-[10px] uppercase tracking-[0.25em] text-slate-500">Terminal · Diff · Tests · Logs · Processes</p>
          <BuilderWorkspace basePath={basePath} />
        </div>
      ) : null}
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
