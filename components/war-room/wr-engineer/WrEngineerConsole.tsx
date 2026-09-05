'use client'

/**
 * WR-Engineer console — the first-class War Room UI section for WR-Engineer.
 *
 * Modeled on app/war-room/code-operator/page.tsx's visual language (rounded border/bg-black
 * panels, emerald/cyan/amber/red semantic colors, text-[10px] uppercase tracking-widest headers)
 * rather than the disconnected legacy WarRoomShell/Sidebar chrome (see Phase 2 research: that
 * chrome's nav buttons are `disabled` and explicitly documented as "not connected on this legacy
 * route" — this page does not build on it).
 *
 * No realtime push transport exists yet for a remote node (Phase 2 research: no websockets, no
 * Supabase Realtime channel usage anywhere in this app) — this console polls the session snapshot
 * every few seconds while a session is open, the same honest fallback
 * lib/mission-runtime/engineeringStream.ts's own client already uses when EventSource isn't
 * available. A true push-based stream (mirroring that module's SSE pattern) is a clean, bounded
 * Phase 3 addition, not required for the foundation this phase establishes.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { StatusPill } from './StatusPill'

type ConnectionStatus = 'ONLINE' | 'OFFLINE'
type PairingState = 'WAITING' | 'PAIRING' | 'AUTHORIZED' | 'EXPIRED' | 'REJECTED'
type AgentState = 'READY' | 'WORKING' | 'BLOCKED' | 'VALIDATING' | 'COMPLETE' | 'FAILED'

type NodeSummary = {
  nodeId: string
  nodeName: string
  platform: string
  connectionStatus: ConnectionStatus
  revokedAt: string | null
}

type RepositorySummary = {
  repositoryId: string
  nodeId: string
  name: string
  path: string
  currentBranch: string | null
  headSha: string | null
  enabled: boolean
}

type PairingToken = {
  tokenId: string
  state: PairingState
  candidate?: { nodeName: string; platform: string }
  expiresAt: string
}

type SessionRecord = {
  sessionId: string
  nodeId: string
  repositoryId: string
  repositoryPath: string
  branch: string | null
  headSha: string | null
  agentState: AgentState
  constraints: string[]
  mission: unknown
}

type ChatMessage = { id: string; role: 'commander' | 'wr_engineer' | 'system'; content: string; createdAt: string }
type ToolEvent = { id: string; tool: string; detail: string; outcome: 'PASS' | 'FAIL'; occurredAt: string }

const AGENT_STATE_COLOR: Record<AgentState, 'emerald' | 'amber' | 'red' | 'cyan' | 'slate'> = {
  READY: 'emerald',
  WORKING: 'cyan',
  VALIDATING: 'cyan',
  BLOCKED: 'amber',
  COMPLETE: 'emerald',
  FAILED: 'red',
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `Request failed: ${res.status}`)
  return body as T
}

export function WrEngineerConsole() {
  const [nodes, setNodes] = useState<NodeSummary[]>([])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [repositories, setRepositories] = useState<RepositorySummary[]>([])
  const [selectedRepositoryId, setSelectedRepositoryId] = useState<string | null>(null)
  const [session, setSession] = useState<SessionRecord | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([])
  const [chatInput, setChatInput] = useState('')
  const [pairingTokens, setPairingTokens] = useState<PairingToken[]>([])
  const [pairingCode, setPairingCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshNodes = useCallback(async () => {
    const data = await api<{ nodes: NodeSummary[] }>('/api/wr-engineer/nodes')
    setNodes(data.nodes)
  }, [])

  const refreshPairingTokens = useCallback(async () => {
    const data = await api<{ tokens: PairingToken[] }>('/api/wr-engineer/nodes/pairing')
    setPairingTokens(data.tokens)
  }, [])

  const refreshRepositories = useCallback(async (nodeId: string) => {
    const data = await api<{ repositories: RepositorySummary[] }>(`/api/wr-engineer/nodes/${nodeId}/repositories`)
    setRepositories(data.repositories)
  }, [])

  const refreshSession = useCallback(async (sessionId: string) => {
    const data = await api<{ session: SessionRecord; messages: ChatMessage[]; toolEvents: ToolEvent[] }>(`/api/wr-engineer/sessions/${sessionId}`)
    setSession(data.session)
    setMessages(data.messages)
    setToolEvents(data.toolEvents)
  }, [])

  useEffect(() => {
    // Deferred a tick — this repo's react-hooks/set-state-in-effect lint rule flags a setState
    // call reachable by static analysis from an effect body (see
    // components/war-room/terra/useTerraAircraftTrails.ts / AgiWaveOnePanel.tsx for the same
    // escape hatch already established elsewhere in this codebase).
    const timeout = setTimeout(() => {
      void refreshNodes()
      void refreshPairingTokens()
    }, 0)
    return () => clearTimeout(timeout)
  }, [refreshNodes, refreshPairingTokens])

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (selectedNodeId) void refreshRepositories(selectedNodeId)
      else setRepositories([])
      setSelectedRepositoryId(null)
    }, 0)
    return () => clearTimeout(timeout)
  }, [selectedNodeId, refreshRepositories])

  useEffect(() => {
    if (!session) return
    const interval = setInterval(() => {
      void refreshSession(session.sessionId)
    }, 4000)
    return () => clearInterval(interval)
  }, [session, refreshSession])

  const runGuarded = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [])

  const handleGeneratePairingCode = () =>
    runGuarded(async () => {
      const data = await api<{ code: string }>('/api/wr-engineer/nodes/pairing', { method: 'POST' })
      setPairingCode(data.code)
      await refreshPairingTokens()
    })

  const handleSimulateLocalNode = () =>
    runGuarded(async () => {
      await api('/api/wr-engineer/dev/simulate-local-node', { method: 'POST' })
      await refreshNodes()
      await refreshPairingTokens()
    })

  const handleAuthorize = (tokenId: string) =>
    runGuarded(async () => {
      await api(`/api/wr-engineer/nodes/pairing/${tokenId}/authorize`, { method: 'POST' })
      await refreshNodes()
      await refreshPairingTokens()
    })

  const handleReject = (tokenId: string) =>
    runGuarded(async () => {
      await api(`/api/wr-engineer/nodes/pairing/${tokenId}/reject`, { method: 'POST' })
      await refreshPairingTokens()
    })

  const handleStartSession = () =>
    runGuarded(async () => {
      if (!selectedNodeId || !selectedRepositoryId) return
      const data = await api<{ session: SessionRecord }>('/api/wr-engineer/sessions', {
        method: 'POST',
        body: JSON.stringify({ nodeId: selectedNodeId, repositoryId: selectedRepositoryId }),
      })
      setSession(data.session)
      setMessages([])
      setToolEvents([])
    })

  const handleSendMessage = () =>
    runGuarded(async () => {
      if (!session || !chatInput.trim()) return
      const content = chatInput
      setChatInput('')
      await api(`/api/wr-engineer/sessions/${session.sessionId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      })
      await refreshSession(session.sessionId)
    })

  const handleRunValidation = () =>
    runGuarded(async () => {
      if (!session) return
      await api(`/api/wr-engineer/sessions/${session.sessionId}/validate`, { method: 'POST' })
      await refreshSession(session.sessionId)
    })

  const selectedNode = useMemo(() => nodes.find(n => n.nodeId === selectedNodeId) ?? null, [nodes, selectedNodeId])
  const selectedRepository = useMemo(() => repositories.find(r => r.repositoryId === selectedRepositoryId) ?? null, [repositories, selectedRepositoryId])

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr_320px]">
      <aside className="flex flex-col gap-4">
        <Panel title="Machines">
          {nodes.length === 0 && <p className="text-[11px] text-slate-500">NO NODE PAIRED</p>}
          <ul className="flex flex-col gap-1">
            {nodes.map(node => (
              <li key={node.nodeId}>
                <button
                  onClick={() => setSelectedNodeId(node.nodeId)}
                  className={`w-full rounded border px-2 py-1.5 text-left text-[11px] ${selectedNodeId === node.nodeId ? 'border-emerald-700 bg-emerald-950/40' : 'border-white/10 bg-black/25'}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-slate-200">{node.nodeName}</span>
                    <StatusPill label={node.connectionStatus} color={node.connectionStatus === 'ONLINE' ? 'emerald' : 'slate'} />
                  </div>
                  <div className="text-[9px] uppercase tracking-widest text-slate-600">{node.platform}</div>
                </button>
              </li>
            ))}
          </ul>
          <button
            disabled={busy}
            onClick={() => void handleGeneratePairingCode()}
            className="mt-2 rounded border border-emerald-900/60 px-2 py-1 text-[10px] uppercase tracking-widest text-emerald-300 disabled:opacity-40"
          >
            + Add Computer
          </button>
          <button
            disabled={busy}
            onClick={() => void handleSimulateLocalNode()}
            className="mt-1 rounded border border-cyan-900/60 px-2 py-1 text-[10px] uppercase tracking-widest text-cyan-300 disabled:opacity-40"
          >
            Simulate Local Node (dev)
          </button>
          {pairingCode && (
            <p className="mt-2 rounded border border-amber-900/60 bg-black/40 p-2 text-[10px] text-amber-300">
              Pairing code (shown once): <span className="font-mono">{pairingCode}</span>
              <br />Run: <span className="font-mono">wr-engineer-node pair {pairingCode}</span>
            </p>
          )}
          {pairingTokens.filter(t => t.state === 'PAIRING').map(token => (
            <div key={token.tokenId} className="mt-2 rounded border border-amber-900/60 bg-black/40 p-2 text-[10px]">
              <div className="text-amber-300">PAIRING: {token.candidate?.nodeName ?? 'unknown'} ({token.candidate?.platform})</div>
              <div className="mt-1 flex gap-2">
                <button onClick={() => void handleAuthorize(token.tokenId)} className="text-emerald-400 uppercase tracking-widest">Authorize</button>
                <button onClick={() => void handleReject(token.tokenId)} className="text-red-400 uppercase tracking-widest">Reject</button>
              </div>
            </div>
          ))}
        </Panel>

        <Panel title="Repository">
          {!selectedNode && <p className="text-[11px] text-slate-500">Select a machine first.</p>}
          {selectedNode && repositories.length === 0 && <p className="text-[11px] text-slate-500">NO REPOSITORY SELECTED — none registered on this node.</p>}
          <ul className="flex flex-col gap-1">
            {repositories.map(repo => (
              <li key={repo.repositoryId}>
                <button
                  onClick={() => setSelectedRepositoryId(repo.repositoryId)}
                  className={`w-full rounded border px-2 py-1.5 text-left text-[11px] ${selectedRepositoryId === repo.repositoryId ? 'border-emerald-700 bg-emerald-950/40' : 'border-white/10 bg-black/25'}`}
                >
                  <div className="text-slate-200">{repo.name}</div>
                  <div className="truncate text-[9px] text-slate-600">{repo.path}</div>
                </button>
              </li>
            ))}
          </ul>
          {selectedNode && selectedRepository && !session && (
            <button
              disabled={busy}
              onClick={() => void handleStartSession()}
              className="mt-2 rounded border border-emerald-900/60 px-2 py-1 text-[10px] uppercase tracking-widest text-emerald-300 disabled:opacity-40"
            >
              Start Engineering Session
            </button>
          )}
        </Panel>
      </aside>

      <main className="flex flex-col gap-3">
        <Panel title="WR-Engineer">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-[9px] uppercase tracking-widest text-slate-600">Node</p>
              <p className="text-[11px] text-slate-200">{selectedNode ? `${selectedNode.nodeName}` : 'NO NODE PAIRED'} {selectedNode && <StatusPill label={selectedNode.connectionStatus} color={selectedNode.connectionStatus === 'ONLINE' ? 'emerald' : 'slate'} />}</p>
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-widest text-slate-600">Repository</p>
              <p className="text-[11px] text-slate-200">{session?.repositoryPath ?? 'NO REPOSITORY SELECTED'}</p>
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-widest text-slate-600">Branch</p>
              <p className="text-[11px] text-slate-200">{session?.branch ?? '—'}</p>
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-widest text-slate-600">HEAD</p>
              <p className="font-mono text-[11px] text-slate-200">{session?.headSha ? session.headSha.slice(0, 12) : '—'}</p>
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-widest text-slate-600">Agent</p>
              {session ? <StatusPill label={session.agentState} color={AGENT_STATE_COLOR[session.agentState]} /> : <StatusPill label="READY" color="slate" />}
            </div>
          </div>
        </Panel>

        <Panel title="Engineering Chat" className="flex-1">
          {!session && <p className="text-[11px] text-slate-500">Select a machine and repository, then start a session to chat with WR-Engineer.</p>}
          {session && (
            <>
              <div className="flex max-h-96 flex-col gap-2 overflow-y-auto">
                {messages.map(m => (
                  <div key={m.id} className="text-[11px]">
                    <span className={`font-bold uppercase tracking-widest ${m.role === 'commander' ? 'text-cyan-300' : 'text-emerald-300'}`}>
                      {m.role === 'commander' ? 'Ra’el' : 'WR-Engineer'}:
                    </span>{' '}
                    <span className="whitespace-pre-wrap text-slate-300">{m.content}</span>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                <input
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && void handleSendMessage()}
                  placeholder="Tell WR-Engineer what to inspect or build..."
                  className="flex-1 rounded border border-white/10 bg-black/40 px-2 py-1.5 text-[11px] text-slate-200"
                />
                <button disabled={busy} onClick={() => void handleSendMessage()} className="rounded border border-emerald-900/60 px-3 py-1.5 text-[10px] uppercase tracking-widest text-emerald-300 disabled:opacity-40">Send</button>
              </div>
            </>
          )}
        </Panel>

        <Panel title="Proposed Changes">
          <p className="text-[11px] text-slate-500">No proposal produced yet. WR-Engineer&apos;s edit-proposal interface (lib/wr-engineer/codeEditProposals.ts) and the Native Builder bridge are wired and tested, but the chat loop does not yet auto-generate proposals from conversation — a bounded Phase 3 addition. [ VIEW DIFF ] and [ PREPARE APPLY ] activate here once a proposal exists.</p>
        </Panel>

        <Panel title="Validation">
          <button disabled={busy || !session} onClick={() => void handleRunValidation()} className="rounded border border-cyan-900/60 px-2 py-1 text-[10px] uppercase tracking-widest text-cyan-300 disabled:opacity-40">Run Validation (git diff check)</button>
        </Panel>

        {error && <p className="rounded border border-red-900/60 bg-black/40 p-2 text-[11px] text-red-400">{error}</p>}
      </main>

      <aside className="flex flex-col gap-4">
        <Panel title="Mission / Context">
          <p className="text-[9px] uppercase tracking-widest text-slate-600">Constraints</p>
          <p className="text-[11px] text-slate-300">{session?.constraints.length ? session.constraints.join(', ') : 'none'}</p>
          <p className="mt-2 text-[9px] uppercase tracking-widest text-slate-600">Mission</p>
          <p className="text-[11px] text-slate-300">{session?.mission ? JSON.stringify(session.mission) : 'no active mission'}</p>
        </Panel>

        <Panel title="Activity Timeline" className="flex-1">
          {toolEvents.length === 0 && <p className="text-[11px] text-slate-500">No tool activity yet.</p>}
          <ul className="flex flex-col gap-1">
            {toolEvents.map(event => (
              <li key={event.id} className="text-[10px]">
                <span className="text-slate-600">{new Date(event.occurredAt).toLocaleTimeString()}</span>{' '}
                <span className="text-cyan-300">{event.tool}</span>{' '}
                <span className="text-slate-400">{event.detail}</span>{' '}
                <StatusPill label={event.outcome} color={event.outcome === 'PASS' ? 'emerald' : 'red'} />
              </li>
            ))}
          </ul>
        </Panel>
      </aside>
    </div>
  )
}

function Panel({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded border border-white/10 bg-black/25 p-3 ${className}`}>
      <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-emerald-300">{title}</p>
      {children}
    </section>
  )
}
