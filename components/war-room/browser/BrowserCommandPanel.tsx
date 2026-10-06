'use client'

import { useCallback, useEffect, useState } from 'react'

type Profile = {
  profile_id: string
  display_name: string
  state: string
  allow_council: boolean
  allow_foundry: boolean
  allowed_origins: string[]
  auth_state: string
  storage_present: boolean
  encryption?: { storage_security?: string; scheme?: string; key_backend?: string; enabled?: boolean }
}

type SessionInfo = {
  sessionId: string
  owner: string
  kind: string
  profileId?: string | null
  controlState?: string
  lastAction?: string | null
  lastActionAt?: string | null
  hostname?: string | null
  tabs: { tabId: string; url: string; title: string; active: boolean }[]
}

type Diagnostics = {
  brokerState?: string
  chromiumState?: string
  chromiumPid?: number | null
  lastFailure?: { code?: string; message?: string } | null
  lastRecovery?: { detail?: string } | null
  screenshotCapability?: boolean
  profileStore?: { profileCount?: number; keyring?: string; encryption?: string; storage_security?: string; key_state?: string }
  sessions?: SessionInfo[]
}

async function api(kind: string, extra: Record<string, unknown> = {}) {
  const res = await fetch('/api/runtime/browser-broker', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ owner: 'commander', kind, ...extra }),
  })
  const json = await res.json() as { ok?: boolean; error?: string; verdict?: string; result?: unknown; diagnostics?: Diagnostics }
  return { status: res.status, ...json }
}

export function BrowserCommandPanel() {
  const [diag, setDiag] = useState<Diagnostics | null>(null)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [name, setName] = useState('GitHub Commander')
  const [origins, setOrigins] = useState('github.com')
  const [allowCouncil, setAllowCouncil] = useState(false)
  const [allowFoundry, setAllowFoundry] = useState(true)
  const [selectedSession, setSelectedSession] = useState<string>('')
  const [preview, setPreview] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [url, setUrl] = useState('http://127.0.0.1:3848/login')

  const refresh = useCallback(async () => {
    const listed = await api('profile.list')
    const diagnostics = (listed.diagnostics ?? null) as Diagnostics | null
    setDiag(diagnostics)
    const result = listed.result as { profiles?: Profile[] } | undefined
    setProfiles(result?.profiles ?? [])
    if (!selectedSession && diagnostics?.sessions?.[0]?.sessionId) {
      setSelectedSession(diagnostics.sessions[0].sessionId)
    }
  }, [selectedSession])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => { void refresh() }, 4_000)
    return () => clearInterval(timer)
  }, [refresh])

  async function createProfile() {
    const created = await api('profile.create', {
      displayName: name,
      allowedOrigins: origins.split(/[,\s]+/).filter(Boolean),
      allowCouncil,
      allowFoundry,
      actionPolicy: 'INTERACTIVE_WITH_APPROVAL',
    })
    setMessage(created.ok ? `Created ${name}` : String(created.error))
    await refresh()
  }

  async function act(kind: string, extra: Record<string, unknown> = {}) {
    const result = await api(kind, extra)
    setMessage(result.ok ? `${kind} ok` : String(result.error || result.verdict || 'failed'))
    await refresh()
    return result
  }

  async function previewSelected() {
    if (!selectedSession) return
    const shot = await api('preview', { sessionId: selectedSession })
    const path = (shot.result as { path?: string; degraded?: boolean } | undefined)?.path
    setPreview(path ? `file:${path}` : shot.ok === false ? 'DEGRADED' : 'none')
    if ((shot.result as { degraded?: boolean } | undefined)?.degraded) setMessage('Preview DEGRADED — browser still alive')
  }

  const sessions = diag?.sessions ?? []
  const active = sessions.find(item => item.sessionId === selectedSession) ?? sessions[0]

  return (
    <div className="space-y-4 text-emerald-100" data-testid="browser-command-panel">
      <section className="rounded border border-emerald-400/30 bg-black/60 p-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-300">Diagnostics</p>
        <p className="mt-1 text-xs">Broker {diag?.brokerState ?? 'UNKNOWN'} · Chromium {diag?.chromiumState ?? 'UNKNOWN'} · PID {diag?.chromiumPid ?? '—'} · screenshot {String(diag?.screenshotCapability)} · store {diag?.profileStore?.keyring} · {diag?.profileStore?.storage_security ?? diag?.profileStore?.encryption}</p>
        {diag?.lastFailure ? <p className="text-[11px] text-amber-200">Last failure: {diag.lastFailure.code}</p> : null}
        {diag?.lastRecovery ? <p className="text-[11px] text-emerald-200">Last recovery: {diag.lastRecovery.detail}</p> : null}
      </section>

      <section className="rounded border border-emerald-400/30 bg-black/60 p-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-300">Profiles</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <input value={name} onChange={e => setName(e.target.value)} className="bg-black/80 px-2 py-1 text-xs" placeholder="Name" />
          <input value={origins} onChange={e => setOrigins(e.target.value)} className="bg-black/80 px-2 py-1 text-xs" placeholder="allowed origins" />
          <label className="text-[11px]"><input type="checkbox" checked={allowCouncil} onChange={e => setAllowCouncil(e.target.checked)} /> Council</label>
          <label className="text-[11px]"><input type="checkbox" checked={allowFoundry} onChange={e => setAllowFoundry(e.target.checked)} /> Foundry</label>
          <button type="button" data-testid="browser-profile-create" className="rounded border border-emerald-400/60 px-2 py-1 text-[11px] uppercase" onClick={() => void createProfile()}>Create Trusted Profile</button>
        </div>
        <ul className="mt-2 space-y-1 text-xs">
          {profiles.map(profile => (
            <li key={profile.profile_id} className="flex flex-wrap items-center gap-2 border-b border-emerald-900/50 py-1">
              <span>{profile.display_name}</span>
              <span className="text-emerald-400">{profile.state}</span>
              <span>{profile.auth_state}</span>
              <span className="text-emerald-500">{profile.encryption?.storage_security ?? profile.encryption?.scheme}</span>
              <button type="button" onClick={() => void act('session.create', { sessionMode: 'TRUSTED_PROFILE', profileId: profile.profile_id, allowLocalhost: true })}>Open</button>
              <button type="button" onClick={() => void act('profile.lock', { profileId: profile.profile_id })}>Lock</button>
              <button type="button" onClick={() => void act('profile.unlock', { profileId: profile.profile_id })}>Unlock</button>
              <button type="button" onClick={() => void act('profile.disable', { profileId: profile.profile_id })}>Disable</button>
              <button type="button" onClick={() => void act('profile.delete', { profileId: profile.profile_id })}>Delete</button>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded border border-emerald-400/30 bg-black/60 p-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-300">Sessions</p>
        <ul className="mt-2 space-y-1 text-xs">
          {sessions.map(session => (
            <li key={session.sessionId}>
              <button type="button" className={session.sessionId === active?.sessionId ? 'text-emerald-200' : ''} onClick={() => setSelectedSession(session.sessionId)}>
                {session.sessionId.slice(0, 18)} · {session.kind === 'persistent_authorized' ? (profiles.find(item => item.profile_id === session.profileId)?.display_name || 'TRUSTED') : 'EPHEMERAL'} · {session.owner} · {session.controlState} · {session.hostname || '—'}
              </button>
            </li>
          ))}
        </ul>
        {active ? (
          <div className="mt-2 space-y-2">
            <p>Active tab {active.tabs.find(tab => tab.active)?.tabId} · {active.tabs.find(tab => tab.active)?.url}</p>
            <p>Last action {active.lastAction} {active.lastActionAt}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" data-testid="browser-takeover" onClick={() => void act('control.takeover', { sessionId: active.sessionId })}>TAKE OVER</button>
              <button type="button" data-testid="browser-return-control" onClick={() => void act('control.return', { sessionId: active.sessionId })}>RETURN CONTROL</button>
              <button type="button" onClick={() => void act('session.close', { sessionId: active.sessionId })}>Close</button>
              <button type="button" onClick={() => void previewSelected()}>Preview</button>
            </div>
            <div className="flex flex-wrap gap-2">
              <input value={url} onChange={e => setUrl(e.target.value)} className="min-w-[16rem] bg-black/80 px-2 py-1 text-xs" />
              <button type="button" onClick={() => void act('navigate', { sessionId: active.sessionId, url })}>Navigate</button>
              <button type="button" onClick={() => void act('back', { sessionId: active.sessionId })}>Back</button>
              <button type="button" onClick={() => void act('forward', { sessionId: active.sessionId })}>Forward</button>
              <button type="button" onClick={() => void act('reload', { sessionId: active.sessionId })}>Reload</button>
              <button type="button" onClick={() => void act('scroll', { sessionId: active.sessionId })}>Scroll</button>
              <button type="button" onClick={() => void act('tab.open', { sessionId: active.sessionId })}>Open tab</button>
            </div>
            {preview ? <p className="text-[11px] text-emerald-400">Preview: {preview}</p> : null}
          </div>
        ) : <p className="mt-2 text-xs text-slate-400">No live sessions.</p>}
      </section>
      {message ? <p className="text-xs text-amber-200" data-testid="browser-panel-message">{message}</p> : null}
    </div>
  )
}
