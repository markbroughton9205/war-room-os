'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { WarRoomUiMode } from '@/components/war-room/WarRoomUiModeContext'
import { StandingPermissionsPanel } from '@/components/war-room/permissions/StandingPermissionsPanel'
import { Phase5DeployPanels } from '@/components/war-room/phase5/DeployPanels'
import { Phase6MemoryPanels } from '@/components/war-room/memory/Phase6MemoryPanels'
import { Phase4WarRoomPanels } from '@/components/war-room/phase3/Phase4WarRoomPanels'
import { SystemResourcesPanel } from '@/components/war-room/phase3/SystemResourcesPanel'
import { WorkerHealthPanel } from '@/components/war-room/phase3/WorkerHealthPanel'
import { grantWarRoomStandingAck, resolveStandingPostExtra } from '@/lib/permissions/standingInlineGate'
import type { StandingPermissionMode } from '@/lib/permissions/standingPermissions'

export type Phase3HomeBundle = 'operations' | 'diagnostics'

type ConvRow = {
  id: string
  title: string
  state: string
  created_at: string
  updated_at: string
  last_message_at: string | null
}

type MsgRow = {
  id: string
  role: string
  content: string
  family: string | null
  created_at: string
}

type ActionRow = {
  id: string
  conversation_id: string | null
  status: string
  type: string
  approval_granted: boolean
  created_at: string
  payload?: Record<string, unknown>
}

type InternetStatus = Record<string, unknown>

type AuditRow = {
  id: string
  created_at: string
  actor: string
  category: string
  action_id: string | null
  message: string
  metadata: Record<string, unknown>
}

type SentinelFinding = {
  id: string
  severity: string
  kind: string
  message: string
  detail?: Record<string, unknown>
}

function readPersistence(res: Response) {
  return res.headers.get('x-war-room-persistence') ?? 'unknown'
}

export function Phase3WarRoomPanels({
  uiMode = 'operator',
  homeBundle,
}: {
  uiMode?: WarRoomUiMode
  /** When set (Home page tabs), render a lightweight slice and skip unrelated fetches. */
  homeBundle?: Phase3HomeBundle
}) {
  const [mounted, setMounted] = useState(false)
  const [persistence, setPersistence] = useState<string>('unknown')

  const [conversations, setConversations] = useState<ConvRow[]>([])
  const [convLoading, setConvLoading] = useState(false)
  const [convError, setConvError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [threadTitle, setThreadTitle] = useState('')
  const [messages, setMessages] = useState<MsgRow[]>([])
  const [msgDraft, setMsgDraft] = useState('')
  const [threadLoading, setThreadLoading] = useState(false)

  const [actions, setActions] = useState<ActionRow[]>([])
  const [actionType, setActionType] = useState('manual_review')
  const [actionPayload, setActionPayload] = useState('{}')
  const [actionsLoading, setActionsLoading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const [netStatus, setNetStatus] = useState<InternetStatus | null>(null)
  const [searchQ, setSearchQ] = useState('')
  const [fetchUrl, setFetchUrl] = useState('https://example.com')
  const [searchOut, setSearchOut] = useState<string>('')
  const [fetchOut, setFetchOut] = useState<string>('')
  const [netBusy, setNetBusy] = useState(false)

  const [researchLogs, setResearchLogs] = useState<Record<string, unknown>[]>([])

  const [auditLogs, setAuditLogs] = useState<AuditRow[]>([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditCategory, setAuditCategory] = useState<string>('')

  const [permSnap, setPermSnap] = useState<{ mode: StandingPermissionMode; safetyLock: boolean } | null>(null)

  const [sentinelStatus, setSentinelStatus] = useState<Record<string, unknown> | null>(null)
  const [sentinelFindings, setSentinelFindings] = useState<SentinelFinding[]>([])
  const [sentinelBusy, setSentinelBusy] = useState(false)
  const [sentinelLastScan, setSentinelLastScan] = useState<string | null>(null)

  const researchPollGuardRef = useRef({ consecutiveFailures: 0, pauseUntil: 0 })
  const auditPollGuardRef = useRef({ consecutiveFailures: 0, pauseUntil: 0 })
  const researchInFlightRef = useRef(false)
  const auditInFlightRef = useRef(false)

  const loadConversations = useCallback(async () => {
    setConvLoading(true)
    setConvError(null)
    try {
      const res = await fetch('/api/conversations', { cache: 'no-store' })
      setPersistence(readPersistence(res))
      const j = await res.json() as { conversations?: ConvRow[]; error?: string }
      if (!res.ok) throw new Error(j.error || 'Failed to load conversations')
      setConversations(Array.isArray(j.conversations) ? j.conversations : [])
    } catch (e) {
      setConvError(e instanceof Error ? e.message : 'Failed to load conversations')
      setConversations([])
    } finally {
      setConvLoading(false)
    }
  }, [])

  const loadThread = useCallback(async (id: string) => {
    setThreadLoading(true)
    try {
      const res = await fetch(`/api/conversations/${id}`, { cache: 'no-store' })
      setPersistence(readPersistence(res))
      const j = await res.json() as {
        conversation?: { title: string } | null
        messages?: MsgRow[]
        error?: string
      }
      if (!res.ok) throw new Error(j.error || 'Thread failed')
      setThreadTitle(j.conversation?.title ?? '')
      setMessages(Array.isArray(j.messages) ? j.messages : [])
    } catch {
      setThreadTitle('')
      setMessages([])
    } finally {
      setThreadLoading(false)
    }
  }, [])

  const loadActions = useCallback(async () => {
    setActionsLoading(true)
    try {
      const res = await fetch('/api/actions/queue', { cache: 'no-store' })
      setPersistence(readPersistence(res))
      const j = await res.json() as { actions?: ActionRow[] }
      setActions(Array.isArray(j.actions) ? j.actions : [])
    } catch {
      setActions([])
    } finally {
      setActionsLoading(false)
    }
  }, [])

  const loadNetStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/internet/status', { cache: 'no-store' })
      setPersistence(readPersistence(res))
      const j = await res.json() as InternetStatus
      setNetStatus(j)
    } catch {
      setNetStatus(null)
    }
  }, [])

  const loadResearchLogs = useCallback(async () => {
    const now = Date.now()
    if (now < researchPollGuardRef.current.pauseUntil) return
    if (researchInFlightRef.current) return
    researchInFlightRef.current = true
    try {
      const res = await fetch('/api/internet/logs?limit=40', { cache: 'no-store' })
      setPersistence(readPersistence(res))
      const j = await res.json() as { logs?: Record<string, unknown>[]; error?: string }
      if (!res.ok) throw new Error(j.error || 'internet logs failed')
      setResearchLogs(Array.isArray(j.logs) ? j.logs : [])
      researchPollGuardRef.current.consecutiveFailures = 0
    } catch {
      setResearchLogs([])
      researchPollGuardRef.current.consecutiveFailures += 1
      if (researchPollGuardRef.current.consecutiveFailures >= 3) {
        researchPollGuardRef.current.pauseUntil = Date.now() + 30_000
        researchPollGuardRef.current.consecutiveFailures = 0
      }
    } finally {
      researchInFlightRef.current = false
    }
  }, [])

  const loadAuditLogs = useCallback(async () => {
    const now = Date.now()
    if (now < auditPollGuardRef.current.pauseUntil) return
    if (auditInFlightRef.current) return
    auditInFlightRef.current = true
    setAuditLoading(true)
    try {
      const q = auditCategory ? `?limit=80&category=${encodeURIComponent(auditCategory)}` : '?limit=80'
      const res = await fetch(`/api/audit/logs${q}`, { cache: 'no-store' })
      setPersistence(readPersistence(res))
      const j = await res.json() as { logs?: AuditRow[]; error?: string }
      if (!res.ok) throw new Error(j.error || 'audit logs failed')
      setAuditLogs(Array.isArray(j.logs) ? j.logs : [])
      auditPollGuardRef.current.consecutiveFailures = 0
    } catch {
      setAuditLogs([])
      auditPollGuardRef.current.consecutiveFailures += 1
      if (auditPollGuardRef.current.consecutiveFailures >= 3) {
        auditPollGuardRef.current.pauseUntil = Date.now() + 30_000
        auditPollGuardRef.current.consecutiveFailures = 0
      }
    } finally {
      setAuditLoading(false)
      auditInFlightRef.current = false
    }
  }, [auditCategory])

  const loadPermissionsSnapshot = useCallback(async () => {
    try {
      const res = await fetch('/api/permissions/status', { cache: 'no-store' })
      setPersistence(readPersistence(res))
      const j = await res.json() as { mode?: string; safetyLock?: boolean }
      if (
        res.ok
        && (j.mode === 'manual' || j.mode === 'operator' || j.mode === 'commander')
      ) {
        setPermSnap({ mode: j.mode, safetyLock: Boolean(j.safetyLock) })
      }
    } catch {
      /* ignore — server gate still applies */
    }
  }, [])

  const loadSentinelStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/red-sentinel/status', { cache: 'no-store' })
      setPersistence(readPersistence(res))
      const j = await res.json() as Record<string, unknown>
      setSentinelStatus(j)
      setSentinelLastScan(typeof j.lastScanAt === 'string' ? j.lastScanAt : null)
    } catch {
      setSentinelStatus(null)
    }
  }, [])

  useEffect(() => {
    const m = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(m)
  }, [])

  useEffect(() => {
    if (!mounted) return
    const onChanged = () => void loadPermissionsSnapshot()
    window.addEventListener('war-room-permissions-changed', onChanged)
    return () => window.removeEventListener('war-room-permissions-changed', onChanged)
  }, [mounted, loadPermissionsSnapshot])

  useEffect(() => {
    if (!mounted) return
    const t = window.setTimeout(() => {
      if (homeBundle === 'operations') {
        void loadConversations()
        void loadActions()
        void loadPermissionsSnapshot()
        return
      }
      if (homeBundle === 'diagnostics') {
        void loadActions()
        void loadNetStatus()
        void loadResearchLogs()
        void loadSentinelStatus()
        void loadPermissionsSnapshot()
        return
      }
      void loadConversations()
      void loadActions()
      void loadNetStatus()
      void loadResearchLogs()
      void loadSentinelStatus()
      void loadPermissionsSnapshot()
    }, 0)
    return () => window.clearTimeout(t)
  }, [mounted, homeBundle, loadActions, loadConversations, loadNetStatus, loadPermissionsSnapshot, loadResearchLogs, loadSentinelStatus])

  useEffect(() => {
    if (!mounted) return
    if (homeBundle === 'operations') return
    const t = window.setTimeout(() => {
      void loadAuditLogs()
    }, 0)
    return () => window.clearTimeout(t)
  }, [mounted, homeBundle, auditCategory, loadAuditLogs])

  useEffect(() => {
    if (!mounted || !selectedId) return
    const t = window.setTimeout(() => {
      void loadThread(selectedId)
    }, 0)
    return () => window.clearTimeout(t)
  }, [mounted, selectedId, loadThread])

  const [elevPermissionHint, setElevPermissionHint] = useState<string | null>(null)

  const standingPostExtra = (
    snap: { mode: StandingPermissionMode; safetyLock: boolean } | null,
    actionKind: string,
  ) => resolveStandingPostExtra(snap, actionKind)

  const createConversation = async () => {
    const res = await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New War Room thread' }),
    })
    setPersistence(readPersistence(res))
    const j = await res.json() as { conversation?: ConvRow; error?: string }
    if (!res.ok) {
      setConvError(j.error || 'Create failed')
      return
    }
    if (j.conversation) {
      setConversations(prev => [j.conversation!, ...prev])
      setSelectedId(j.conversation.id)
    }
    await loadConversations()
  }

  const saveTitle = async () => {
    if (!selectedId) return
    const res = await fetch(`/api/conversations/${selectedId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: threadTitle }),
    })
    setPersistence(readPersistence(res))
    if (res.ok) void loadConversations()
  }

  const postMessage = async () => {
    if (!selectedId || !msgDraft.trim()) return
    const res = await fetch(`/api/conversations/${selectedId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user', content: msgDraft.trim() }),
    })
    setPersistence(readPersistence(res))
    if (res.ok) {
      setMsgDraft('')
      void loadThread(selectedId)
    }
  }

  const enqueueAction = async () => {
    setActionError(null)
    let payload: Record<string, unknown> = {}
    try {
      payload = JSON.parse(actionPayload || '{}') as Record<string, unknown>
    } catch {
      setActionError('Action payload must be valid JSON')
      return
    }
    const res = await fetch('/api/actions/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: actionType,
        payload,
        conversationId: selectedId,
      }),
    })
    setPersistence(readPersistence(res))
    if (res.ok) void loadActions()
  }

  const runSearch = async () => {
    if (!searchQ.trim()) return
    setNetBusy(true)
    setSearchOut('')
    try {
      const gate = standingPostExtra(permSnap, 'internet_research')
      if (!gate.proceed) {
        if (gate.needsAck && gate.ackMessage) setElevPermissionHint(gate.ackMessage)
        return
      }
      const { extra } = gate
      const res = await fetch('/api/internet/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQ, conversationId: selectedId, ...extra }),
      })
      setPersistence(readPersistence(res))
      const j = await res.json() as { result?: unknown; error?: string }
      setSearchOut(JSON.stringify(j.result ?? j, null, 2))
      void loadResearchLogs()
    } catch (e) {
      setSearchOut(e instanceof Error ? e.message : 'search failed')
    } finally {
      setNetBusy(false)
    }
  }

  const runFetch = async () => {
    if (!fetchUrl.trim()) return
    setNetBusy(true)
    setFetchOut('')
    try {
      const res = await fetch('/api/internet/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: fetchUrl, conversationId: selectedId }),
      })
      setPersistence(readPersistence(res))
      const j = await res.json() as { snippet?: string; error?: string; ok?: boolean }
      setFetchOut(JSON.stringify(j, null, 2))
      void loadResearchLogs()
    } catch (e) {
      setFetchOut(e instanceof Error ? e.message : 'fetch failed')
    } finally {
      setNetBusy(false)
    }
  }

  const approvalQueue = actions.filter(a => a.status === 'waiting_approval')

  const approveAction = async (id: string) => {
    const res = await fetch('/api/actions/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actionId: id, approval_granted: true }),
    })
    setPersistence(readPersistence(res))
    if (res.ok) {
      void loadActions()
      void loadAuditLogs()
    }
  }

  const rejectAction = async (id: string) => {
    const reason = window.prompt('Rejection reason (optional)') ?? ''
    const res = await fetch('/api/actions/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actionId: id, reason: reason.trim() || undefined }),
    })
    setPersistence(readPersistence(res))
    if (res.ok) {
      void loadActions()
      void loadAuditLogs()
    }
  }

  const runSentinelScan = async (ciOnly?: boolean) => {
    setSentinelBusy(true)
    setSentinelFindings([])
    try {
      const gate = standingPostExtra(permSnap, 'red_sentinel_scan')
      if (!gate.proceed) {
        if (gate.needsAck && gate.ackMessage) setElevPermissionHint(gate.ackMessage)
        return
      }
      const { extra } = gate
      const res = await fetch('/api/red-sentinel/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ciOnly ? { ...extra, categories: ['chat_integrity'] } : { ...extra }),
      })
      setPersistence(readPersistence(res))
      const j = await res.json() as { findings?: SentinelFinding[]; scannedAt?: string }
      setSentinelFindings(Array.isArray(j.findings) ? j.findings : [])
      if (typeof j.scannedAt === 'string') setSentinelLastScan(j.scannedAt)
      void loadAuditLogs()
      void loadSentinelStatus()
    } catch {
      setSentinelFindings([])
    } finally {
      setSentinelBusy(false)
    }
  }

  if (!mounted) {
    return (
      <div className="border-b border-yellow-900 px-6 py-2 text-xs tracking-widest" style={{ color: '#555' }}>
        Loading extension modules…
      </div>
    )
  }

  const netDiagnostics = (
    <>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold tracking-widest" style={{ color: '#34D399' }}>GLOBAL INTEL ACCESS (/api/internet/*)</span>
        <button type="button" className="rounded px-2 py-1 text-[10px] font-bold" style={{ border: '1px solid #444', color: '#ccc' }} onClick={() => void loadNetStatus()} disabled={netBusy}>STATUS</button>
      </div>
      <pre className="mb-2 max-h-32 overflow-auto text-[10px]" style={{ color: '#888' }}>{netStatus ? JSON.stringify(netStatus, null, 2) : '—'}</pre>
      <div className="space-y-2">
        <input className="w-full rounded bg-black px-2 py-1 font-mono text-[11px]" style={{ border: '1px solid #333', color: '#eee' }} value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="Search query" />
        <button type="button" className="rounded px-2 py-1 text-[10px] font-bold" style={{ background: '#059669', color: '#fff' }} disabled={netBusy} onClick={() => void runSearch()}>SEARCH</button>
        <textarea className="h-24 w-full rounded bg-black px-2 py-1 font-mono text-[10px]" style={{ border: '1px solid #333', color: '#ccc' }} readOnly value={searchOut} />
        <input className="w-full rounded bg-black px-2 py-1 font-mono text-[11px]" style={{ border: '1px solid #333', color: '#eee' }} value={fetchUrl} onChange={e => setFetchUrl(e.target.value)} />
        <button type="button" className="rounded px-2 py-1 text-[10px] font-bold" style={{ background: '#0EA5E9', color: '#000' }} disabled={netBusy} onClick={() => void runFetch()}>FETCH</button>
        <textarea className="h-20 w-full rounded bg-black px-2 py-1 font-mono text-[10px]" style={{ border: '1px solid #333', color: '#ccc' }} readOnly value={fetchOut} />
      </div>
    </>
  )

  if (homeBundle === 'operations') {
    return (
      <div className="border-b border-yellow-900 px-6 py-3 flex-shrink-0 space-y-4" style={{ background: 'rgba(212,175,55,0.04)' }}>
        {elevPermissionHint && (
          <div
            className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-700/40 px-3 py-2"
            style={{ background: 'rgba(251,191,36,0.1)' }}
          >
            <span className="max-w-[70%] text-[10px] leading-snug" style={{ color: '#FDE68A' }}>{elevPermissionHint}</span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded px-2 py-1 text-[10px] font-bold"
                style={{ background: '#FBBF24', color: '#000' }}
                onClick={() => {
                  grantWarRoomStandingAck()
                  setElevPermissionHint(null)
                }}
              >
                Approve for this tab
              </button>
              <button
                type="button"
                className="rounded px-2 py-1 text-[10px] font-bold"
                style={{ border: '1px solid #555', color: '#888' }}
                onClick={() => setElevPermissionHint(null)}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-xs font-bold tracking-widest" style={{ color: '#D4AF37' }}>THREADS · QUEUES · APPROVALS</h2>
            <p className="mt-1 text-[10px] tracking-widest" style={{ color: '#666' }}>
              Persistence: <span style={{ color: persistence === 'available' ? '#34D399' : '#FBBF24' }}>{persistence.toUpperCase()}</span>
            </p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded p-3 text-xs" style={{ border: '1px solid #333', background: 'rgba(0,0,0,0.25)' }}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold tracking-widest" style={{ color: '#D4AF37' }}>PERSISTENT THREADS</span>
              <div className="flex gap-2">
                <button type="button" className="rounded px-2 py-1 text-[10px] font-bold tracking-widest" style={{ border: '1px solid #444', color: '#ccc' }} onClick={() => void loadConversations()} disabled={convLoading}>REFRESH</button>
                <button type="button" className="rounded px-2 py-1 text-[10px] font-bold tracking-widest" style={{ background: '#D4AF37', color: '#000' }} onClick={() => void createConversation()}>NEW</button>
              </div>
            </div>
            {convError && <div className="mb-2 text-[11px]" style={{ color: '#fca5a5' }}>{convError}</div>}
            <div className="grid gap-2 md:grid-cols-2">
              <ul className="max-h-48 space-y-1 overflow-y-auto">
                {conversations.map(c => (
                  <li key={c.id}>
                    <button type="button" className="w-full rounded px-2 py-1 text-left text-[11px]" style={{ border: selectedId === c.id ? '1px solid #D4AF37' : '1px solid #222', color: '#ddd', background: selectedId === c.id ? 'rgba(212,175,55,0.08)' : 'transparent' }} onClick={() => setSelectedId(c.id)}>
                      {c.title}
                    </button>
                  </li>
                ))}
                {!conversations.length && <li style={{ color: '#666' }}>No threads yet.</li>}
              </ul>
              <div className="space-y-2">
                <div style={{ color: '#888' }}>{threadLoading ? 'Loading…' : selectedId ? `Thread ${selectedId.slice(0, 8)}…` : 'Select a thread'}</div>
                {selectedId && (
                  <>
                    <input className="w-full rounded bg-black px-2 py-1 font-mono text-[11px]" style={{ border: '1px solid #333', color: '#eee' }} value={threadTitle} onChange={e => setThreadTitle(e.target.value)} />
                    <button type="button" className="rounded px-2 py-1 text-[10px] font-bold" style={{ border: '1px solid #555', color: '#ccc' }} onClick={() => void saveTitle()}>SAVE TITLE</button>
                    <div className="max-h-40 space-y-1 overflow-y-auto text-[11px]" style={{ color: '#aaa' }}>
                      {messages.map(m => (
                        <div key={m.id} style={{ borderBottom: '1px solid #1f1f1f' }}>
                          <span style={{ color: '#D4AF37' }}>{m.role}</span> {m.content.slice(0, 400)}{m.content.length > 400 ? '…' : ''}
                        </div>
                      ))}
                    </div>
                    {uiMode !== 'operator' ? (
                      <>
                        <textarea className="w-full rounded bg-black px-2 py-1 font-mono text-[11px]" style={{ border: '1px solid #333', color: '#eee' }} rows={3} value={msgDraft} onChange={e => setMsgDraft(e.target.value)} placeholder="Message (user role)" />
                        <button type="button" className="rounded px-2 py-1 text-[10px] font-bold" style={{ background: '#444', color: '#fff' }} onClick={() => void postMessage()}>POST MESSAGE</button>
                      </>
                    ) : (
                      <p className="text-[10px]" style={{ color: '#666' }}>
                        Use the main War Room <strong style={{ color: '#D4AF37' }}>Live Chat</strong> strip to message the council; this panel is for thread inspection only.
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          </section>

          <section className="rounded p-3 text-xs" style={{ border: '1px solid #333', background: 'rgba(0,0,0,0.25)' }}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold tracking-widest" style={{ color: '#93C5FD' }}>ACTIVE ORDERS (war_room_actions)</span>
              <button type="button" className="rounded px-2 py-1 text-[10px] font-bold tracking-widest" style={{ border: '1px solid #444', color: '#ccc' }} onClick={() => void loadActions()} disabled={actionsLoading}>REFRESH</button>
            </div>
            {actionError && <div className="mb-2 text-[11px]" style={{ color: '#fca5a5' }}>{actionError}</div>}
            {uiMode === 'operator' ? (
              <details className="mb-2">
                <summary className="cursor-pointer text-[10px] font-bold tracking-widest" style={{ color: '#888' }}>Advanced Diagnostics (enqueue + payload)</summary>
                <div className="mt-2 flex flex-wrap gap-2">
                  <input className="rounded bg-black px-2 py-1 font-mono text-[11px]" style={{ border: '1px solid #333', color: '#eee' }} value={actionType} onChange={e => setActionType(e.target.value)} placeholder="type" />
                  <input className="min-w-[8rem] flex-1 rounded bg-black px-2 py-1 font-mono text-[11px]" style={{ border: '1px solid #333', color: '#eee' }} value={actionPayload} onChange={e => setActionPayload(e.target.value)} />
                  <button type="button" className="rounded px-2 py-1 text-[10px] font-bold" style={{ background: '#60A5FA', color: '#000' }} onClick={() => void enqueueAction()}>ENQUEUE</button>
                </div>
              </details>
            ) : (
              <div className="mb-2 flex flex-wrap gap-2">
                <input className="rounded bg-black px-2 py-1 font-mono text-[11px]" style={{ border: '1px solid #333', color: '#eee' }} value={actionType} onChange={e => setActionType(e.target.value)} placeholder="type" />
                <input className="min-w-[8rem] flex-1 rounded bg-black px-2 py-1 font-mono text-[11px]" style={{ border: '1px solid #333', color: '#eee' }} value={actionPayload} onChange={e => setActionPayload(e.target.value)} />
                <button type="button" className="rounded px-2 py-1 text-[10px] font-bold" style={{ background: '#60A5FA', color: '#000' }} onClick={() => void enqueueAction()}>ENQUEUE</button>
              </div>
            )}
            <div className="max-h-48 overflow-auto">
              <table className="w-full border-collapse text-[10px]">
                <thead>
                  <tr style={{ color: '#777' }}>
                    <th className="pb-1 text-left">TYPE</th>
                    <th className="pb-1 text-left">STATUS</th>
                    <th className="pb-1 text-left">APR</th>
                    <th className="pb-1 text-left">ID</th>
                  </tr>
                </thead>
                <tbody>
                  {actions.map(a => (
                    <tr key={a.id} className="border-t border-white/5" style={{ color: '#bbb' }}>
                      <td className="py-1 pr-2">{a.type}</td>
                      <td className="py-1 pr-2">{a.status}</td>
                      <td className="py-1 pr-2">{String(a.approval_granted)}</td>
                      <td className="py-1 font-mono text-[9px]">{a.id.slice(0, 8)}…</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <section className="rounded p-3 text-xs" style={{ border: '1px solid #7f1d1d', background: 'rgba(127,29,29,0.12)' }}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold tracking-widest" style={{ color: '#FCA5A5' }}>PENDING APPROVALS</span>
            <button type="button" className="rounded px-2 py-1 text-[10px] font-bold tracking-widest" style={{ border: '1px solid #444', color: '#ccc' }} onClick={() => void loadActions()} disabled={actionsLoading}>REFRESH</button>
          </div>
          <p className="mb-2 text-[10px]" style={{ color: '#888' }}>Lists <code className="text-[9px]">waiting_approval</code> only.</p>
          <ul className="max-h-56 space-y-2 overflow-y-auto">
            {approvalQueue.map(a => (
              <li key={a.id} className="rounded border border-white/10 p-2" style={{ color: '#ddd' }}>
                <div className="font-mono text-[10px]" style={{ color: '#F87171' }}>{a.type}</div>
                <div className="text-[9px] opacity-70">{a.id}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" className="rounded px-2 py-1 text-[10px] font-bold" style={{ background: '#16A34A', color: '#fff' }} onClick={() => void approveAction(a.id)}>APPROVE</button>
                  <button type="button" className="rounded px-2 py-1 text-[10px] font-bold" style={{ background: '#991B1B', color: '#fff' }} onClick={() => void rejectAction(a.id)}>REJECT</button>
                </div>
              </li>
            ))}
            {!approvalQueue.length && <li style={{ color: '#666' }}>No actions awaiting approval.</li>}
          </ul>
        </section>
      </div>
    )
  }

  if (homeBundle === 'diagnostics') {
    return (
      <div className="border-b border-yellow-900 px-6 py-3 flex-shrink-0 space-y-4" style={{ background: 'rgba(212,175,55,0.04)' }}>
        {elevPermissionHint && (
          <div
            className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-700/40 px-3 py-2"
            style={{ background: 'rgba(251,191,36,0.1)' }}
          >
            <span className="max-w-[70%] text-[10px] leading-snug" style={{ color: '#FDE68A' }}>{elevPermissionHint}</span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded px-2 py-1 text-[10px] font-bold"
                style={{ background: '#FBBF24', color: '#000' }}
                onClick={() => {
                  grantWarRoomStandingAck()
                  setElevPermissionHint(null)
                }}
              >
                Approve for this tab
              </button>
              <button
                type="button"
                className="rounded px-2 py-1 text-[10px] font-bold"
                style={{ border: '1px solid #555', color: '#888' }}
                onClick={() => setElevPermissionHint(null)}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-xs font-bold tracking-widest" style={{ color: '#D4AF37' }}>DIAGNOSTICS · INTEL · LEDGER</h2>
            <p className="mt-1 text-[10px] tracking-widest" style={{ color: '#666' }}>
              Persistence: <span style={{ color: persistence === 'available' ? '#34D399' : '#FBBF24' }}>{persistence.toUpperCase()}</span>
            </p>
          </div>
        </div>

        <section className="rounded p-3 text-xs" style={{ border: '1px solid #450a0a', background: 'rgba(69,10,10,0.2)' }}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold tracking-widest" style={{ color: '#F87171' }}>RED SENTINEL</span>
            <button type="button" className="rounded px-2 py-1 text-[10px] font-bold" style={{ border: '1px solid #444', color: '#ccc' }} onClick={() => void loadSentinelStatus()} disabled={sentinelBusy}>STATUS</button>
          </div>
          {uiMode === 'operator' ? (
            <details className="mb-2">
              <summary className="cursor-pointer text-[10px] font-bold tracking-widest" style={{ color: '#888' }}>Advanced Diagnostics (raw status JSON)</summary>
              <pre className="mt-2 max-h-24 overflow-auto text-[9px]" style={{ color: '#888' }}>{sentinelStatus ? JSON.stringify(sentinelStatus, null, 2) : '—'}</pre>
            </details>
          ) : (
            <pre className="mb-2 max-h-24 overflow-auto text-[9px]" style={{ color: '#888' }}>{sentinelStatus ? JSON.stringify(sentinelStatus, null, 2) : '—'}</pre>
          )}
          <div className="mb-2 text-[10px]" style={{ color: '#aaa' }}>
            Last scan: <span className="font-mono">{sentinelLastScan ?? '—'}</span>
          </div>
          <button type="button" className="mb-2 rounded px-2 py-1 text-[10px] font-bold tracking-widest" style={{ background: '#B91C1C', color: '#fff' }} disabled={sentinelBusy} onClick={() => void runSentinelScan()}>RUN SCAN (READ-ONLY)</button>
          <button type="button" className="mb-2 ml-2 rounded px-2 py-1 text-[10px] font-bold tracking-widest" style={{ border: '1px solid #92400E', color: '#FBBF24' }} disabled={sentinelBusy} onClick={() => void runSentinelScan(true)}>CHAT INTEGRITY</button>
          <ul className="max-h-48 space-y-1 overflow-y-auto text-[9px]" style={{ color: '#ccc' }}>
            {sentinelFindings.map(f => (
              <li key={f.id} className="border-b border-white/5 pb-1">
                <span style={{ color: f.severity === 'error' ? '#FCA5A5' : f.severity === 'warn' ? '#FDE047' : '#93C5FD' }}>{f.severity}</span>
                {' '}
                <span className="opacity-80">{f.kind}</span>
                {' — '}
                {f.message}
              </li>
            ))}
            {!sentinelFindings.length && !sentinelBusy && <li style={{ color: '#666' }}>No scan results yet.</li>}
          </ul>
        </section>

        <Phase4WarRoomPanels uiMode={uiMode} />

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded p-3 text-xs" style={{ border: '1px solid #333', background: 'rgba(0,0,0,0.25)' }}>
            {uiMode === 'operator' ? (
              <details>
                <summary className="cursor-pointer font-bold tracking-widest" style={{ color: '#34D399' }}>Global Intel Access (raw probes)</summary>
                <div className="mt-2">{netDiagnostics}</div>
              </details>
            ) : (
              netDiagnostics
            )}
          </section>

          <section className="rounded p-3 text-xs" style={{ border: '1px solid #333', background: 'rgba(0,0,0,0.25)' }}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold tracking-widest" style={{ color: '#F472B6' }}>RESEARCH LOG (internet_logs)</span>
              <button type="button" className="rounded px-2 py-1 text-[10px] font-bold" style={{ border: '1px solid #444', color: '#ccc' }} onClick={() => void loadResearchLogs()}>TAIL</button>
            </div>
            <ul className="max-h-64 space-y-1 overflow-y-auto text-[10px]" style={{ color: '#aaa' }}>
              {researchLogs.map(log => (
                <li key={String(log.id)} className="border-b border-white/5 pb-1 font-mono">
                  {String(log.created_at)} · {String(log.provider)} · {String(log.operation)} · {String(log.status_code ?? '—')}
                  {log.query ? <div style={{ color: '#666' }}>{String(log.query).slice(0, 120)}</div> : null}
                </li>
              ))}
              {!researchLogs.length && <li style={{ color: '#666' }}>No log rows (or persistence unavailable).</li>}
            </ul>
          </section>
        </div>

        <section className="rounded p-3 text-xs" style={{ border: '1px solid #333', background: 'rgba(0,0,0,0.25)' }}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold tracking-widest" style={{ color: '#E9D5FF' }}>SYSTEM LEDGER</span>
            <div className="flex flex-wrap gap-2">
              <select className="rounded bg-black px-2 py-1 text-[10px] font-mono" style={{ border: '1px solid #444', color: '#ccc' }} value={auditCategory} onChange={e => setAuditCategory(e.target.value)}>
                <option value="">all</option>
                <option value="action">action</option>
                <option value="engine">engine</option>
                <option value="internet">internet</option>
                <option value="repo">repo</option>
                <option value="sentinel">sentinel</option>
                <option value="permissions">permissions</option>
                <option value="event">event</option>
                <option value="memory">memory</option>
              </select>
              <button type="button" className="rounded px-2 py-1 text-[10px] font-bold" style={{ border: '1px solid #444', color: '#ccc' }} onClick={() => void loadAuditLogs()} disabled={auditLoading}>REFRESH</button>
            </div>
          </div>
          <div className="max-h-64 overflow-auto">
            <table className="w-full border-collapse text-[9px]">
              <thead>
                <tr style={{ color: '#777' }}>
                  <th className="pb-1 text-left">TIME</th>
                  <th className="pb-1 text-left">CAT</th>
                  <th className="pb-1 text-left">MSG</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.map(row => (
                  <tr key={row.id} className="border-t border-white/5" style={{ color: '#bbb' }}>
                    <td className="py-1 pr-1 align-top font-mono whitespace-nowrap">{row.created_at?.slice(5, 16) ?? '—'}</td>
                    <td className="py-1 pr-1 align-top">{row.category}</td>
                    <td className="py-1 align-top">{row.message.slice(0, 120)}{row.message.length > 120 ? '…' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!auditLogs.length && <div className="py-2" style={{ color: '#666' }}>No ledger rows yet. Enable Supabase persistence to record audit events.</div>}
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="border-b border-yellow-900 px-6 py-3 flex-shrink-0 space-y-4" style={{ background: 'rgba(212,175,55,0.04)' }}>
      {elevPermissionHint && (
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-700/40 px-3 py-2"
          style={{ background: 'rgba(251,191,36,0.1)' }}
        >
          <span className="max-w-[70%] text-[10px] leading-snug" style={{ color: '#FDE68A' }}>{elevPermissionHint}</span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded px-2 py-1 text-[10px] font-bold"
              style={{ background: '#FBBF24', color: '#000' }}
              onClick={() => {
                grantWarRoomStandingAck()
                setElevPermissionHint(null)
              }}
            >
              Approve for this tab
            </button>
            <button
              type="button"
              className="rounded px-2 py-1 text-[10px] font-bold"
              style={{ border: '1px solid #555', color: '#888' }}
              onClick={() => setElevPermissionHint(null)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xs font-bold tracking-widest" style={{ color: '#D4AF37' }}>EXTENSION MODULES — THREADS · QUEUES · INTEL · LEDGER · SENTINEL</h2>
          <p className="mt-1 text-[10px] tracking-widest" style={{ color: '#666' }}>
            Persistence: <span style={{ color: persistence === 'available' ? '#34D399' : '#FBBF24' }}>{persistence.toUpperCase()}</span>
            {' '}
            (lists stay empty when Supabase is unset; POST mutations return 503.)
          </p>
        </div>
      </div>

      <section className="rounded p-3 text-xs" style={{ border: '1px solid #450a0a', background: 'rgba(69,10,10,0.2)' }}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="font-bold tracking-widest" style={{ color: '#F87171' }}>RED SENTINEL</span>
          <button type="button" className="rounded px-2 py-1 text-[10px] font-bold" style={{ border: '1px solid #444', color: '#ccc' }} onClick={() => void loadSentinelStatus()} disabled={sentinelBusy}>STATUS</button>
        </div>
        {uiMode === 'operator' ? (
          <details className="mb-2">
            <summary className="cursor-pointer text-[10px] font-bold tracking-widest" style={{ color: '#888' }}>Advanced Diagnostics (raw status JSON)</summary>
            <pre className="mt-2 max-h-24 overflow-auto text-[9px]" style={{ color: '#888' }}>{sentinelStatus ? JSON.stringify(sentinelStatus, null, 2) : '—'}</pre>
          </details>
        ) : (
          <pre className="mb-2 max-h-24 overflow-auto text-[9px]" style={{ color: '#888' }}>{sentinelStatus ? JSON.stringify(sentinelStatus, null, 2) : '—'}</pre>
        )}
        <div className="mb-2 text-[10px]" style={{ color: '#aaa' }}>
          Last scan: <span className="font-mono">{sentinelLastScan ?? '—'}</span>
        </div>
        <button type="button" className="mb-2 rounded px-2 py-1 text-[10px] font-bold tracking-widest" style={{ background: '#B91C1C', color: '#fff' }} disabled={sentinelBusy} onClick={() => void runSentinelScan()}>RUN SCAN (READ-ONLY)</button>
        <button type="button" className="mb-2 ml-2 rounded px-2 py-1 text-[10px] font-bold tracking-widest" style={{ border: '1px solid #92400E', color: '#FBBF24' }} disabled={sentinelBusy} onClick={() => void runSentinelScan(true)}>CHAT INTEGRITY</button>
        <ul className="max-h-48 space-y-1 overflow-y-auto text-[9px]" style={{ color: '#ccc' }}>
          {sentinelFindings.map(f => (
            <li key={f.id} className="border-b border-white/5 pb-1">
              <span style={{ color: f.severity === 'error' ? '#FCA5A5' : f.severity === 'warn' ? '#FDE047' : '#93C5FD' }}>{f.severity}</span>
              {' '}
              <span className="opacity-80">{f.kind}</span>
              {' — '}
              {f.message}
            </li>
          ))}
          {!sentinelFindings.length && !sentinelBusy && <li style={{ color: '#666' }}>No scan results yet.</li>}
        </ul>
      </section>

      <section className="rounded border border-white/10 p-3">
        <h3 className="mb-2 text-[10px] font-bold tracking-widest" style={{ color: '#86EFAC' }}>SYSTEM HEALTH</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <SystemResourcesPanel autoRefreshEnabled={false} />
          <WorkerHealthPanel uiMode={uiMode} autoRefreshEnabled={false} />
        </div>
      </section>

      <Phase4WarRoomPanels uiMode={uiMode} />

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded p-3 text-xs" style={{ border: '1px solid #333', background: 'rgba(0,0,0,0.25)' }}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold tracking-widest" style={{ color: '#D4AF37' }}>PERSISTENT THREADS</span>
            <div className="flex gap-2">
              <button type="button" className="rounded px-2 py-1 text-[10px] font-bold tracking-widest" style={{ border: '1px solid #444', color: '#ccc' }} onClick={() => void loadConversations()} disabled={convLoading}>REFRESH</button>
              <button type="button" className="rounded px-2 py-1 text-[10px] font-bold tracking-widest" style={{ background: '#D4AF37', color: '#000' }} onClick={() => void createConversation()}>NEW</button>
            </div>
          </div>
          {convError && <div className="mb-2 text-[11px]" style={{ color: '#fca5a5' }}>{convError}</div>}
          <div className="grid gap-2 md:grid-cols-2">
            <ul className="max-h-48 space-y-1 overflow-y-auto">
              {conversations.map(c => (
                <li key={c.id}>
                  <button type="button" className="w-full rounded px-2 py-1 text-left text-[11px]" style={{ border: selectedId === c.id ? '1px solid #D4AF37' : '1px solid #222', color: '#ddd', background: selectedId === c.id ? 'rgba(212,175,55,0.08)' : 'transparent' }} onClick={() => setSelectedId(c.id)}>
                    {c.title}
                  </button>
                </li>
              ))}
              {!conversations.length && <li style={{ color: '#666' }}>No threads yet.</li>}
            </ul>
            <div className="space-y-2">
              <div style={{ color: '#888' }}>{threadLoading ? 'Loading…' : selectedId ? `Thread ${selectedId.slice(0, 8)}…` : 'Select a thread'}</div>
              {selectedId && (
                <>
                  <input className="w-full rounded bg-black px-2 py-1 font-mono text-[11px]" style={{ border: '1px solid #333', color: '#eee' }} value={threadTitle} onChange={e => setThreadTitle(e.target.value)} />
                  <button type="button" className="rounded px-2 py-1 text-[10px] font-bold" style={{ border: '1px solid #555', color: '#ccc' }} onClick={() => void saveTitle()}>SAVE TITLE</button>
                  <div className="max-h-40 space-y-1 overflow-y-auto text-[11px]" style={{ color: '#aaa' }}>
                    {messages.map(m => (
                      <div key={m.id} style={{ borderBottom: '1px solid #1f1f1f' }}>
                        <span style={{ color: '#D4AF37' }}>{m.role}</span> {m.content.slice(0, 400)}{m.content.length > 400 ? '…' : ''}
                      </div>
                    ))}
                  </div>
                  {uiMode !== 'operator' ? (
                    <>
                      <textarea className="w-full rounded bg-black px-2 py-1 font-mono text-[11px]" style={{ border: '1px solid #333', color: '#eee' }} rows={3} value={msgDraft} onChange={e => setMsgDraft(e.target.value)} placeholder="Message (user role)" />
                      <button type="button" className="rounded px-2 py-1 text-[10px] font-bold" style={{ background: '#444', color: '#fff' }} onClick={() => void postMessage()}>POST MESSAGE</button>
                    </>
                  ) : (
                    <p className="text-[10px]" style={{ color: '#666' }}>
                      Use the main War Room <strong style={{ color: '#D4AF37' }}>Live Chat</strong> strip to message the council; this panel is for thread inspection only.
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </section>

        <section className="rounded p-3 text-xs" style={{ border: '1px solid #333', background: 'rgba(0,0,0,0.25)' }}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold tracking-widest" style={{ color: '#93C5FD' }}>ACTIVE ORDERS (war_room_actions)</span>
            <button type="button" className="rounded px-2 py-1 text-[10px] font-bold tracking-widest" style={{ border: '1px solid #444', color: '#ccc' }} onClick={() => void loadActions()} disabled={actionsLoading}>REFRESH</button>
          </div>
          {actionError && <div className="mb-2 text-[11px]" style={{ color: '#fca5a5' }}>{actionError}</div>}
          {uiMode === 'operator' ? (
            <details className="mb-2">
              <summary className="cursor-pointer text-[10px] font-bold tracking-widest" style={{ color: '#888' }}>Advanced Diagnostics (enqueue + payload)</summary>
              <div className="mt-2 flex flex-wrap gap-2">
                <input className="rounded bg-black px-2 py-1 font-mono text-[11px]" style={{ border: '1px solid #333', color: '#eee' }} value={actionType} onChange={e => setActionType(e.target.value)} placeholder="type" />
                <input className="min-w-[8rem] flex-1 rounded bg-black px-2 py-1 font-mono text-[11px]" style={{ border: '1px solid #333', color: '#eee' }} value={actionPayload} onChange={e => setActionPayload(e.target.value)} />
                <button type="button" className="rounded px-2 py-1 text-[10px] font-bold" style={{ background: '#60A5FA', color: '#000' }} onClick={() => void enqueueAction()}>ENQUEUE</button>
              </div>
            </details>
          ) : (
            <div className="mb-2 flex flex-wrap gap-2">
              <input className="rounded bg-black px-2 py-1 font-mono text-[11px]" style={{ border: '1px solid #333', color: '#eee' }} value={actionType} onChange={e => setActionType(e.target.value)} placeholder="type" />
              <input className="min-w-[8rem] flex-1 rounded bg-black px-2 py-1 font-mono text-[11px]" style={{ border: '1px solid #333', color: '#eee' }} value={actionPayload} onChange={e => setActionPayload(e.target.value)} />
              <button type="button" className="rounded px-2 py-1 text-[10px] font-bold" style={{ background: '#60A5FA', color: '#000' }} onClick={() => void enqueueAction()}>ENQUEUE</button>
            </div>
          )}
          <div className="max-h-48 overflow-auto">
            <table className="w-full border-collapse text-[10px]">
              <thead>
                <tr style={{ color: '#777' }}>
                  <th className="pb-1 text-left">TYPE</th>
                  <th className="pb-1 text-left">STATUS</th>
                  <th className="pb-1 text-left">APR</th>
                  <th className="pb-1 text-left">ID</th>
                </tr>
              </thead>
              <tbody>
                {actions.map(a => (
                  <tr key={a.id} className="border-t border-white/5" style={{ color: '#bbb' }}>
                    <td className="py-1 pr-2">{a.type}</td>
                    <td className="py-1 pr-2">{a.status}</td>
                    <td className="py-1 pr-2">{String(a.approval_granted)}</td>
                    <td className="py-1 font-mono text-[9px]">{a.id.slice(0, 8)}…</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded p-3 text-xs" style={{ border: '1px solid #333', background: 'rgba(0,0,0,0.25)' }}>
          {uiMode === 'operator' ? (
            <details>
              <summary className="cursor-pointer font-bold tracking-widest" style={{ color: '#34D399' }}>Global Intel Access (raw probes)</summary>
              <div className="mt-2">{netDiagnostics}</div>
            </details>
          ) : (
            netDiagnostics
          )}
        </section>

        <section className="rounded p-3 text-xs" style={{ border: '1px solid #333', background: 'rgba(0,0,0,0.25)' }}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold tracking-widest" style={{ color: '#F472B6' }}>RESEARCH LOG (internet_logs)</span>
            <button type="button" className="rounded px-2 py-1 text-[10px] font-bold" style={{ border: '1px solid #444', color: '#ccc' }} onClick={() => void loadResearchLogs()}>TAIL</button>
          </div>
          <ul className="max-h-64 space-y-1 overflow-y-auto text-[10px]" style={{ color: '#aaa' }}>
            {researchLogs.map(log => (
              <li key={String(log.id)} className="border-b border-white/5 pb-1 font-mono">
                {String(log.created_at)} · {String(log.provider)} · {String(log.operation)} · {String(log.status_code ?? '—')}
                {log.query ? <div style={{ color: '#666' }}>{String(log.query).slice(0, 120)}</div> : null}
              </li>
            ))}
            {!researchLogs.length && <li style={{ color: '#666' }}>No log rows (or persistence unavailable).</li>}
          </ul>
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded p-3 text-xs" style={{ border: '1px solid #7f1d1d', background: 'rgba(127,29,29,0.12)' }}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold tracking-widest" style={{ color: '#FCA5A5' }}>PENDING APPROVALS</span>
            <button type="button" className="rounded px-2 py-1 text-[10px] font-bold tracking-widest" style={{ border: '1px solid #444', color: '#ccc' }} onClick={() => void loadActions()} disabled={actionsLoading}>REFRESH</button>
          </div>
          <p className="mb-2 text-[10px]" style={{ color: '#888' }}>Lists <code className="text-[9px]">waiting_approval</code> only.</p>
          <ul className="max-h-56 space-y-2 overflow-y-auto">
            {approvalQueue.map(a => (
              <li key={a.id} className="rounded border border-white/10 p-2" style={{ color: '#ddd' }}>
                <div className="font-mono text-[10px]" style={{ color: '#F87171' }}>{a.type}</div>
                <div className="text-[9px] opacity-70">{a.id}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" className="rounded px-2 py-1 text-[10px] font-bold" style={{ background: '#16A34A', color: '#fff' }} onClick={() => void approveAction(a.id)}>APPROVE</button>
                  <button type="button" className="rounded px-2 py-1 text-[10px] font-bold" style={{ background: '#991B1B', color: '#fff' }} onClick={() => void rejectAction(a.id)}>REJECT</button>
                </div>
              </li>
            ))}
            {!approvalQueue.length && <li style={{ color: '#666' }}>No actions awaiting approval.</li>}
          </ul>
        </section>

        <section className="rounded p-3 text-xs" style={{ border: '1px solid #333', background: 'rgba(0,0,0,0.25)' }}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold tracking-widest" style={{ color: '#E9D5FF' }}>SYSTEM LEDGER</span>
            <div className="flex flex-wrap gap-2">
              <select className="rounded bg-black px-2 py-1 text-[10px] font-mono" style={{ border: '1px solid #444', color: '#ccc' }} value={auditCategory} onChange={e => setAuditCategory(e.target.value)}>
                <option value="">all</option>
                <option value="action">action</option>
                <option value="engine">engine</option>
                <option value="internet">internet</option>
                <option value="repo">repo</option>
                <option value="sentinel">sentinel</option>
                <option value="permissions">permissions</option>
                <option value="event">event</option>
                <option value="memory">memory</option>
              </select>
              <button type="button" className="rounded px-2 py-1 text-[10px] font-bold" style={{ border: '1px solid #444', color: '#ccc' }} onClick={() => void loadAuditLogs()} disabled={auditLoading}>REFRESH</button>
            </div>
          </div>
          <div className="max-h-64 overflow-auto">
            <table className="w-full border-collapse text-[9px]">
              <thead>
                <tr style={{ color: '#777' }}>
                  <th className="pb-1 text-left">TIME</th>
                  <th className="pb-1 text-left">CAT</th>
                  <th className="pb-1 text-left">MSG</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.map(row => (
                  <tr key={row.id} className="border-t border-white/5" style={{ color: '#bbb' }}>
                    <td className="py-1 pr-1 align-top font-mono whitespace-nowrap">{row.created_at?.slice(5, 16) ?? '—'}</td>
                    <td className="py-1 pr-1 align-top">{row.category}</td>
                    <td className="py-1 align-top">{row.message.slice(0, 120)}{row.message.length > 120 ? '…' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!auditLogs.length && <div className="py-2" style={{ color: '#666' }}>No ledger rows yet. Enable Supabase persistence to record audit events.</div>}
          </div>
        </section>
      </div>

      <Phase6MemoryPanels />

      <StandingPermissionsPanel />

      <Phase5DeployPanels autoRefreshEnabled={false} />
    </div>
  )
}
