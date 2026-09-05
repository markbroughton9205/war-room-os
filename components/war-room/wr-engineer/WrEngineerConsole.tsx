'use client'

/**
 * WR-Engineer console — the first-class War Room UI section for WR-Engineer.
 *
 * Modeled on app/war-room/code-operator/page.tsx's visual language (rounded border/bg-black
 * panels, emerald/cyan/amber/red semantic colors, text-[10px] uppercase tracking-widest headers)
 * rather than the disconnected legacy WarRoomShell/Sidebar chrome — see Phase 2 research: that
 * chrome's nav buttons are `disabled` and explicitly documented as "not connected on this legacy
 * route."
 *
 * Phase 3: live SSE stream (app/api/wr-engineer/sessions/[sessionId]/stream/route.ts) replaces the
 * Phase 2 4-second poll. The GET .../sessions/[sessionId] snapshot route is UNCHANGED in purpose
 * and stays the explicit-refresh / reconnect fallback per the mission brief — never removed.
 * Messages/tool events are merged by id (a Map keyed by id) whether they arrive via the initial
 * snapshot, a granular stream event, or a fallback poll, so a reconnect can never duplicate an
 * already-rendered item.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { StatusPill } from './StatusPill'

type ConnectionStatus = 'ONLINE' | 'OFFLINE'
type PairingState = 'WAITING' | 'PAIRING' | 'AUTHORIZED' | 'EXPIRED' | 'REJECTED'
type AgentState = 'READY' | 'WORKING' | 'BLOCKED' | 'VALIDATING' | 'COMPLETE' | 'FAILED'
type ProposalState = 'NONE' | 'GENERATING' | 'INVALID' | 'READY' | 'BRIDGED' | 'AWAITING_APPROVAL' | 'APPLIED' | 'VALIDATING' | 'VALID' | 'FAILED' | 'ROLLED_BACK'
type StreamStatus = 'CONNECTED' | 'RECONNECTING' | 'DISCONNECTED'

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

type PlannedChangeSummary = { file: string; reason: string; operation: string; matchText?: string; replacementText?: string; newFileContent?: string }
type ActiveProposal = {
  id: string
  diagnosis: string
  confidence: string
  relevantFiles: string[]
  plannedChanges: PlannedChangeSummary[]
  risks: string[]
  rollbackPlan: string
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
  activeProposal: ActiveProposal | null
  nativeBuilderIssueId: string | null
  nativeBuilderRepairId: string | null
  lastProposalRejection: { reasons: string[] } | null
  turnPhase?: 'THINKING' | 'INSPECTING' | 'READING' | 'SEARCHING' | 'ANALYZING' | 'PROPOSING' | 'READY' | 'BLOCKED' | 'FAILED'
  lastTurnEvidence?: {
    turnId: string
    readFiles: { relPath: string; bytesRead: number; truncated: boolean }[]
    searches: { query: string; matchCount: number }[]
    gitObservations: { tool: string; summary: string }[]
    toolCallCount: number
  } | null
  proposalGrounding?: { file: string; readThisTurn: boolean; matchTextObserved: boolean | null; nativeBuilderPolicy: 'PASS' | 'FAIL' | 'PENDING' }[] | null
}

type ChatMessage = { id: string; role: 'commander' | 'wr_engineer' | 'system'; content: string; createdAt: string }
type ToolEvent = { id: string; tool: string; detail: string; outcome: 'STARTED' | 'PASS' | 'FAIL'; occurredAt: string; turnId?: string; target?: string }

const AGENT_STATE_COLOR: Record<AgentState, 'emerald' | 'amber' | 'red' | 'cyan' | 'slate'> = {
  READY: 'emerald', WORKING: 'cyan', VALIDATING: 'cyan', BLOCKED: 'amber', COMPLETE: 'emerald', FAILED: 'red',
}
const PROPOSAL_STATE_COLOR: Record<ProposalState, 'emerald' | 'amber' | 'red' | 'cyan' | 'slate'> = {
  NONE: 'slate', GENERATING: 'cyan', INVALID: 'red', READY: 'amber', BRIDGED: 'cyan',
  AWAITING_APPROVAL: 'amber', APPLIED: 'cyan', VALIDATING: 'cyan', VALID: 'emerald', FAILED: 'red', ROLLED_BACK: 'slate',
}
const STREAM_STATUS_COLOR: Record<StreamStatus, 'emerald' | 'amber' | 'red'> = {
  CONNECTED: 'emerald', RECONNECTING: 'amber', DISCONNECTED: 'red',
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `Request failed: ${res.status}`)
  return body as T
}

function mergeById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const byId = new Map(existing.map(item => [item.id, item]))
  for (const item of incoming) byId.set(item.id, item)
  return Array.from(byId.values()).sort((a, b) => {
    const ao = 'occurredAt' in a ? (a as unknown as { occurredAt: string }).occurredAt : (a as unknown as { createdAt: string }).createdAt
    const bo = 'occurredAt' in b ? (b as unknown as { occurredAt: string }).occurredAt : (b as unknown as { createdAt: string }).createdAt
    return ao.localeCompare(bo)
  })
}

export function WrEngineerConsole() {
  const [nodes, setNodes] = useState<NodeSummary[]>([])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [repositories, setRepositories] = useState<RepositorySummary[]>([])
  const [selectedRepositoryId, setSelectedRepositoryId] = useState<string | null>(null)
  const [session, setSession] = useState<SessionRecord | null>(null)
  const [proposalState, setProposalState] = useState<ProposalState>('NONE')
  const [repairState, setRepairState] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([])
  const [chatInput, setChatInput] = useState('')
  const [pairingTokens, setPairingTokens] = useState<PairingToken[]>([])
  const [pairingCode, setPairingCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [streamStatus, setStreamStatus] = useState<StreamStatus>('DISCONNECTED')
  const [diffExpanded, setDiffExpanded] = useState(false)

  const sessionIdRef = useRef<string | null>(null)

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

  /** Explicit-refresh / reconnect fallback — unchanged in purpose from Phase 2. */
  const refreshSession = useCallback(async (sessionId: string) => {
    const data = await api<{ session: SessionRecord; messages: ChatMessage[]; toolEvents: ToolEvent[]; proposalState: ProposalState; repairState: string | null }>(`/api/wr-engineer/sessions/${sessionId}`)
    setSession(data.session)
    setMessages(prev => mergeById(prev, data.messages))
    setToolEvents(prev => mergeById(prev, data.toolEvents))
    setProposalState(data.proposalState)
    setRepairState(data.repairState)
  }, [])

  useEffect(() => {
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

  // Live SSE stream, falling back to polling the snapshot route if EventSource is unavailable or
  // the stream errors out — the snapshot route itself is never removed (mission brief).
  useEffect(() => {
    sessionIdRef.current = session?.sessionId ?? null
    if (!session) {
      return
    }
    const sessionId = session.sessionId
    let pollFallback: ReturnType<typeof setInterval> | null = null
    const startFallbackPolling = () => {
      if (pollFallback) return
      setStreamStatus('DISCONNECTED')
      pollFallback = setInterval(() => {
        if (sessionIdRef.current) void refreshSession(sessionIdRef.current)
      }, 4000)
    }

    if (typeof EventSource === 'undefined') {
      startFallbackPolling()
      return () => {
        if (pollFallback) clearInterval(pollFallback)
      }
    }

    const source = new EventSource(`/api/wr-engineer/sessions/${sessionId}/stream`)

    const onSnapshot = (ev: MessageEvent) => {
      const envelope = JSON.parse(ev.data)
      const snap = envelope.snapshot
      setSession(snap.session)
      setMessages(prev => mergeById(prev, snap.messages))
      setToolEvents(prev => mergeById(prev, snap.toolEvents))
      setProposalState(snap.proposalState)
      setRepairState(snap.repairState)
    }
    const onMessageCreated = (ev: MessageEvent) => {
      const envelope = JSON.parse(ev.data)
      setMessages(prev => mergeById(prev, [envelope.message]))
    }
    const onToolEvent = (ev: MessageEvent) => {
      const envelope = JSON.parse(ev.data)
      setToolEvents(prev => mergeById(prev, [envelope.event]))
    }
    const onOpen = () => setStreamStatus('CONNECTED')
    const onError = () => {
      if (source.readyState === EventSource.CONNECTING) {
        setStreamStatus('RECONNECTING')
        return
      }
      setStreamStatus('DISCONNECTED')
      source.close()
      startFallbackPolling()
    }

    source.addEventListener('open', onOpen)
    source.addEventListener('session.snapshot', onSnapshot)
    source.addEventListener('message.created', onMessageCreated)
    source.addEventListener('tool.started', onToolEvent)
    source.addEventListener('tool.completed', onToolEvent)
    source.addEventListener('tool.failed', onToolEvent)
    source.addEventListener('error', onError)

    return () => {
      source.removeEventListener('open', onOpen)
      source.removeEventListener('session.snapshot', onSnapshot)
      source.removeEventListener('message.created', onMessageCreated)
      source.removeEventListener('tool.started', onToolEvent)
      source.removeEventListener('tool.completed', onToolEvent)
      source.removeEventListener('tool.failed', onToolEvent)
      source.removeEventListener('error', onError)
      source.close()
      if (pollFallback) clearInterval(pollFallback)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- session identity change (new session) is the only intended re-subscribe trigger; refreshSession is stable via useCallback.
  }, [session?.sessionId])

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
      setProposalState('NONE')
      setRepairState(null)
    })

  const handleSendMessage = () =>
    runGuarded(async () => {
      if (!session || !chatInput.trim()) return
      const content = chatInput
      setChatInput('')
      await api(`/api/wr-engineer/sessions/${session.sessionId}/messages`, { method: 'POST', body: JSON.stringify({ content }) })
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
  const visibleStreamStatus: StreamStatus = session ? streamStatus : 'DISCONNECTED'

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
          <button disabled={busy} onClick={() => void handleGeneratePairingCode()} className="mt-2 rounded border border-emerald-900/60 px-2 py-1 text-[10px] uppercase tracking-widest text-emerald-300 disabled:opacity-40">+ Add Computer</button>
          <button disabled={busy} onClick={() => void handleSimulateLocalNode()} className="mt-1 rounded border border-cyan-900/60 px-2 py-1 text-[10px] uppercase tracking-widest text-cyan-300 disabled:opacity-40">Simulate Local Node (dev)</button>
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
            <button disabled={busy} onClick={() => void handleStartSession()} className="mt-2 rounded border border-emerald-900/60 px-2 py-1 text-[10px] uppercase tracking-widest text-emerald-300 disabled:opacity-40">Start Engineering Session</button>
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
            <div>
              <p className="text-[9px] uppercase tracking-widest text-slate-600">Inspect</p>
              <StatusPill label={session?.turnPhase ?? 'READY'} color={session?.turnPhase === 'FAILED' || session?.turnPhase === 'BLOCKED' ? 'red' : session?.turnPhase && session.turnPhase !== 'READY' ? 'cyan' : 'slate'} />
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-widest text-slate-600">Stream</p>
              <StatusPill label={visibleStreamStatus} color={STREAM_STATUS_COLOR[visibleStreamStatus]} />
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
          {proposalState === 'NONE' && (
            <p className="text-[11px] text-slate-500">No proposal yet. Ask WR-Engineer to fix or build something specific in chat — a concrete proposal will appear here automatically when it identifies one.</p>
          )}
          {proposalState === 'GENERATING' && <p className="text-[11px] text-cyan-300">Generating proposal…</p>}
          {proposalState === 'INVALID' && (
            <div className="text-[11px] text-red-400">
              <p className="font-bold uppercase tracking-widest">Proposal rejected</p>
              <ul className="mt-1 list-disc pl-4">
                {(session?.lastProposalRejection?.reasons ?? []).map((reason, i) => <li key={i}>{reason}</li>)}
              </ul>
            </div>
          )}
          {session?.activeProposal && proposalState !== 'INVALID' && proposalState !== 'NONE' && (
            <div className="flex flex-col gap-2 text-[11px]">
              <div className="flex items-center justify-between">
                <StatusPill label={proposalState} color={PROPOSAL_STATE_COLOR[proposalState]} />
                <span className="text-slate-500">confidence: {session.activeProposal.confidence}</span>
              </div>
              <p className="text-slate-300">{session.activeProposal.diagnosis}</p>
              <p className="text-slate-500">{session.activeProposal.relevantFiles.length} file(s): {session.activeProposal.relevantFiles.join(', ')}</p>
              {session.nativeBuilderRepairId && (
                <p className="text-slate-500">
                  Native Builder repair: <span className="font-mono">{session.nativeBuilderRepairId.slice(0, 12)}</span>
                  {repairState && <> — <StatusPill label={repairState} color="cyan" /></>}
                </p>
              )}
              <div className="flex gap-2">
                <button onClick={() => setDiffExpanded(v => !v)} className="rounded border border-cyan-900/60 px-2 py-1 text-[10px] uppercase tracking-widest text-cyan-300">
                  {diffExpanded ? 'Hide Diff' : 'View Diff'}
                </button>
                {session.nativeBuilderRepairId && (
                  <a href="/native-builder" className="rounded border border-amber-900/60 px-2 py-1 text-[10px] uppercase tracking-widest text-amber-300">
                    Prepare Apply — Open in Native Builder
                  </a>
                )}
              </div>
              {diffExpanded && (
                <div className="flex flex-col gap-2 rounded border border-white/10 bg-black/40 p-2">
                  {session.activeProposal.plannedChanges.map((change, i) => (
                    <div key={i} className="font-mono text-[10px] text-slate-300">
                      <p className="text-cyan-300">{change.operation} — {change.file}</p>
                      <p className="text-slate-500">{change.reason}</p>
                      {(() => {
                        const grounding = (session.proposalGrounding ?? []).find(g => g.file === change.file)
                        return (
                          <p className="text-[9px] uppercase tracking-widest text-slate-500">
                            READ THIS TURN: {grounding?.readThisTurn ? 'YES' : 'NO'}
                            {grounding?.matchTextObserved !== null && grounding?.matchTextObserved !== undefined ? ` · MATCHTEXT OBSERVED: ${grounding.matchTextObserved ? 'YES' : 'NO'}` : ''}
                            {grounding ? ` · NATIVE BUILDER POLICY: ${grounding.nativeBuilderPolicy}` : ''}
                          </p>
                        )
                      })()}
                      {change.matchText && <p className="text-red-400">- {change.matchText}</p>}
                      {change.replacementText && <p className="text-emerald-400">+ {change.replacementText}</p>}
                      {change.newFileContent && <pre className="whitespace-pre-wrap text-emerald-400">{change.newFileContent}</pre>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
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

        <Panel title="Evidence This Turn">
          {!session?.lastTurnEvidence && <p className="text-[11px] text-slate-500">No inspection yet this session. WR-Engineer must read a file in the current turn before it can propose a change to it.</p>}
          {session?.lastTurnEvidence && (
            <ul className="flex flex-col gap-1 text-[11px] text-slate-300">
              <li>{session.lastTurnEvidence.readFiles.length} file(s) read</li>
              <li>{session.lastTurnEvidence.searches.length} search(es)</li>
              <li>{session.lastTurnEvidence.gitObservations.length ? 'git status checked' : 'git not checked'}</li>
              <li>tool calls: {session.lastTurnEvidence.toolCallCount}</li>
              {session.proposalGrounding && (
                <li>proposal targets: {session.proposalGrounding.filter(g => g.readThisTurn).length}/{session.proposalGrounding.length} files read</li>
              )}
            </ul>
          )}
        </Panel>

        <Panel title="Activity Timeline" className="flex-1">
          {toolEvents.length === 0 && <p className="text-[11px] text-slate-500">No tool activity yet.</p>}
          <ul className="flex flex-col gap-1">
            {toolEvents.map(event => (
              <li key={event.id} className="text-[10px]">
                <span className="text-slate-600">{new Date(event.occurredAt).toLocaleTimeString()}</span>{' '}
                <span className="text-cyan-300">{event.tool}</span>{' '}
                {event.target && <span className="text-slate-500">{event.target} </span>}
                <span className="text-slate-400">{event.detail}</span>{' '}
                <StatusPill label={event.outcome} color={event.outcome === 'PASS' ? 'emerald' : event.outcome === 'STARTED' ? 'cyan' : 'red'} />
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
