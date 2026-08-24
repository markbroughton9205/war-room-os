'use client'

/**
 * War Room Builder — Standalone Builder Phase A (thin client).
 *
 * Every authoritative operation below is a fetch against the existing Engineering Core boundary:
 * lib/mission-runtime (Mission Runtime Engineering strategy, wrapping native-builder) and
 * lib/mission-runtime/engineeringReadSurface.ts (read-only repo inspection), both exposed through
 * app/api/mission-runtime/engineering/**. This component owns ONLY presentation state — selected
 * tab, open file, search query, panel sizing-equivalent layout, form inputs. It never computes a
 * diff, never decides whether a patch is safe, never applies a file change itself. The mission id
 * (repairId) is round-tripped through the URL so a refresh reconstructs from the same authoritative
 * persistence native-builder already owns, not from browser-only state.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { RepoGitContext, RepoSearchHit } from '@/lib/mission-runtime/engineeringReadSurface'

type CoderFamily = 'chatgpt' | 'claude' | 'grok' | 'gemini' | 'kimi'

type RuntimeMissionLite = {
  id: string
  kind: string
  status: string
  title: string
  description: string
  createdAt: string
  updatedAt: string
  nativeBuilder: { issueId: string; repairId: string }
  proposalSummary: { hasProposal: boolean; sourceKind?: string; diagnosis?: string; relevantFiles?: string[] }
  providerOpinions: { family: string; ok: boolean; text: string; error?: string }[]
  councilAssistSessions: {
    id: string
    composition: string
    roster: string[]
    results: { family: string; ok: boolean; text: string; error?: string }[]
    requestedAt: string
  }[]
  validationResults: { operation: { id: string; targets?: string[] }; ok: boolean; exitCode: number | null; stdout: string; stderr: string; durationMs: number }[]
  verification?: { status: string; fingerprintRecurred: boolean; evidence: string[] }
  diff?: { diff: string; truncated: boolean; changedFiles: string[] }
  raw: {
    issue: { title: string; severity: string; source: string; evidence: string[] }
    repair: {
      state: string
      history: { state: string; at: string; note?: string }[]
      selectedProposal?: { diagnosis: string; confidence: string; proposerId: string; sourceKind: string; plannedChanges: { file: string; reason: string }[]; risks: string[]; rollbackPlan: string }
      policyResult?: { ok: boolean; violations: { rule: string; file?: string; detail: string }[] }
    }
  }
}

const ACTIVE_STATES = new Set(['applying', 'validating', 'inspecting'])

async function getJson<T>(url: string): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const res = await fetch(url)
    const data = await res.json()
    if (!res.ok) return { ok: false, error: data?.error ?? `HTTP ${res.status}` }
    return { ok: true, data }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function postJson<T>(url: string, body: unknown): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json()
    if (!res.ok) return { ok: false, error: data?.error ?? `HTTP ${res.status}` }
    return { ok: true, data }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

type TabKey = 'diff' | 'validation' | 'activity' | 'output' | 'council'

const COUNCIL_ASSIST_COMPOSITIONS = ['stable_group', 'full_council', 'architecture_review', 'security_review', 'research_review'] as const
type CouncilAssistComposition = (typeof COUNCIL_ASSIST_COMPOSITIONS)[number]

/**
 * basePath: where this thin client's own URL lives — defaults to Standalone Builder's own route.
 * Phase D (War Room Engineering Mission UI) reuses this exact component with basePath="/war-room/engineering"
 * rather than building a second Engineering Core client — see that page for the reasoning. This is
 * also how Phase C's "shared session continuity" is concretely proven: the same missionId/repairId
 * opened from either basePath reconstructs identical live state from the same authoritative
 * native-builder persistence, not from any client-local state.
 */
export function BuilderWorkspace({ basePath = '/builder' }: { basePath?: string } = {}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const missionIdFromUrl = searchParams.get('mission')

  const [repoStatus, setRepoStatus] = useState<RepoGitContext | null>(null)
  const [files, setFiles] = useState<string[]>([])
  const [fileFilter, setFileFilter] = useState('')
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)

  const [searchQuery, setSearchQuery] = useState('')
  const [searchHits, setSearchHits] = useState<RepoSearchHit[]>([])

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [subsystem, setSubsystem] = useState('')
  const [coderEnabled, setCoderEnabled] = useState(true)
  const [coderFamily, setCoderFamily] = useState<CoderFamily>('claude')

  const [mission, setMission] = useState<RuntimeMissionLite | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)
  const [tab, setTab] = useState<TabKey>('output')
  const pollRef = useRef<number | null>(null)

  // Initial repo status + file tree.
  useEffect(() => {
    void (async () => {
      const status = await getJson<RepoGitContext>('/api/mission-runtime/engineering/repo/status')
      if (status.ok && status.data) setRepoStatus(status.data)
      const listing = await getJson<{ files: string[] }>('/api/mission-runtime/engineering/repo/files?pathPrefix=lib')
      if (listing.ok && listing.data) setFiles(listing.data.files)
    })()
  }, [])

  const loadMission = useCallback(async (id: string) => {
    const result = await getJson<{ mission: RuntimeMissionLite }>(`/api/mission-runtime/engineering/${id}`)
    if (result.ok && result.data) setMission(result.data.mission)
  }, [])

  // Reconstruct from the URL's mission id — authoritative persistence, not browser-only state.
  // Deferred via setTimeout (same pattern as NativeBuilderPanel.tsx's own refresh effect) so the
  // async setState doesn't run synchronously inside the effect body.
  useEffect(() => {
    if (!missionIdFromUrl) return
    const timer = window.setTimeout(() => void loadMission(missionIdFromUrl), 0)
    return () => window.clearTimeout(timer)
  }, [missionIdFromUrl, loadMission])

  // Poll while the mission is in an active (non-terminal, non-approval-waiting) state. A ref holds
  // the current mission id so the effect's own dependency list stays small and doesn't restart the
  // interval on every poll tick (each poll replaces `mission`, which would otherwise re-trigger this).
  const missionIdRef = useRef<string | null>(null)
  useEffect(() => {
    missionIdRef.current = mission?.id ?? null
  }, [mission])

  useEffect(() => {
    if (pollRef.current) window.clearInterval(pollRef.current)
    if (mission && ACTIVE_STATES.has(mission.status)) {
      pollRef.current = window.setInterval(() => {
        if (missionIdRef.current) void loadMission(missionIdRef.current)
      }, 2000)
    }
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current)
    }
  }, [mission, loadMission])

  const openFile = useCallback(async (relPath: string) => {
    setSelectedFile(relPath)
    setFileError(null)
    setFileContent(null)
    const result = await getJson<{ content: string }>(`/api/mission-runtime/engineering/repo/read?path=${encodeURIComponent(relPath)}`)
    if (result.ok && result.data) setFileContent(result.data.content)
    else setFileError(result.error ?? 'Failed to read file.')
  }, [])

  const runSearch = useCallback(async () => {
    if (!searchQuery.trim()) return
    const result = await getJson<{ hits: RepoSearchHit[] }>(`/api/mission-runtime/engineering/repo/search?q=${encodeURIComponent(searchQuery)}`)
    if (result.ok && result.data) setSearchHits(result.data.hits)
  }, [searchQuery])

  const runAction = useCallback(
    async (label: string, fn: () => Promise<void>) => {
      setBusy(label)
      setLastError(null)
      try {
        await fn()
      } catch (error) {
        setLastError(error instanceof Error ? error.message : String(error))
      } finally {
        setBusy(null)
      }
    },
    [],
  )

  const submitCoderRequest = () => {
    if (!title.trim() || !description.trim() || !subsystem.trim()) {
      setLastError('Title, description, and a target subsystem/file are required.')
      return
    }
    void runAction('create', async () => {
      const result = await postJson<{ mission: RuntimeMissionLite }>('/api/mission-runtime/engineering', {
        title,
        description,
        subsystem,
        severity: 'medium',
        targetFiles: [subsystem],
        coderProvider: { enabled: coderEnabled, family: coderFamily },
      })
      if (!result.ok) throw new Error(result.error)
      if (result.data) {
        setMission(result.data.mission)
        router.replace(`${basePath}?mission=${result.data.mission.id}`)
        setTab('output')
      }
    })
  }

  const approve = () =>
    mission &&
    void runAction('approve', async () => {
      const result = await postJson<{ mission: RuntimeMissionLite }>(`/api/mission-runtime/engineering/${mission.id}/approve`, { approval_granted: true })
      if (!result.ok) throw new Error(result.error)
      if (result.data) setMission(result.data.mission)
    })

  const decide = (accepted: boolean) =>
    mission &&
    void runAction(accepted ? 'accept' : 'reject', async () => {
      const result = await postJson<{ mission: RuntimeMissionLite }>(`/api/mission-runtime/engineering/${mission.id}/decision`, {
        accepted,
        approval_granted: true,
      })
      if (!result.ok) throw new Error(result.error)
      if (result.data) setMission(result.data.mission)
    })

  const rollback = () =>
    mission &&
    void runAction('rollback', async () => {
      const result = await postJson<{ mission: RuntimeMissionLite }>(`/api/mission-runtime/engineering/${mission.id}/rollback`, { approval_granted: true })
      if (!result.ok) throw new Error(result.error)
      if (result.data) setMission(result.data.mission)
    })

  const councilAssist = (composition: CouncilAssistComposition) =>
    mission &&
    void runAction('council-assist', async () => {
      const result = await postJson<{ mission: RuntimeMissionLite }>(`/api/mission-runtime/engineering/${mission.id}/council-assist`, {
        composition,
      })
      if (!result.ok) throw new Error(result.error)
      if (result.data) setMission(result.data.mission)
    })

  const replan = () =>
    mission &&
    void runAction('replan', async () => {
      const result = await postJson<{ mission: RuntimeMissionLite }>(`/api/mission-runtime/engineering/${mission.id}/replan`, {
        targetFiles: mission.proposalSummary.relevantFiles,
        coderProvider: { enabled: coderEnabled, family: coderFamily },
      })
      if (!result.ok) throw new Error(result.error)
      if (result.data) setMission(result.data.mission)
    })

  const filteredFiles = fileFilter.trim()
    ? files.filter(f => f.toLowerCase().includes(fileFilter.toLowerCase()))
    : files

  return (
    <div className="grid grid-cols-1 gap-3 text-[11px] text-slate-300 lg:grid-cols-[240px_1fr_360px]">
      {/* FILES */}
      <section className="rounded border border-white/10 bg-black/25 p-2">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-emerald-300">Files</p>
        <input
          className="mb-2 w-full rounded border border-white/10 bg-black/40 p-1.5 text-white"
          placeholder="Filter files…"
          value={fileFilter}
          onChange={e => setFileFilter(e.target.value)}
        />
        <ul className="max-h-[420px] space-y-0.5 overflow-auto">
          {filteredFiles.slice(0, 400).map(f => (
            <li key={f}>
              <button
                type="button"
                className={`w-full truncate rounded px-1 py-0.5 text-left hover:bg-white/5 ${selectedFile === f ? 'bg-emerald-950/30 text-emerald-300' : ''}`}
                onClick={() => void openFile(f)}
                title={f}
              >
                {f}
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-3 border-t border-white/10 pt-2">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-cyan-300">Search</p>
          <div className="flex gap-1">
            <input
              className="w-full rounded border border-white/10 bg-black/40 p-1.5 text-white"
              placeholder="Repository search…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && void runSearch()}
            />
            <button type="button" className="rounded border border-cyan-500/40 px-2 text-cyan-300" onClick={() => void runSearch()}>
              Go
            </button>
          </div>
          <ul className="mt-1 max-h-40 space-y-0.5 overflow-auto">
            {searchHits.slice(0, 50).map((h, i) => (
              <li key={i}>
                <button type="button" className="w-full truncate text-left text-slate-400 hover:text-cyan-300" onClick={() => void openFile(h.relPath)}>
                  {h.relPath}:{h.lineNumber}
                </button>
              </li>
            ))}
          </ul>
        </div>

        {repoStatus ? (
          <div className="mt-3 border-t border-white/10 pt-2 text-slate-500">
            <div>Branch: <span className="text-white">{repoStatus.status.currentBranch}</span></div>
            <div>Working tree: <span className="text-white">{repoStatus.status.workingTreeStatus}</span></div>
            <div>{repoStatus.status.uncommittedFilesCount} uncommitted file(s)</div>
          </div>
        ) : null}
      </section>

      {/* EDITOR / VIEWER */}
      <section className="rounded border border-white/10 bg-black/25 p-2">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-emerald-300">
          {selectedFile ?? 'Editor / Viewer'}
        </p>
        {fileError ? <p className="text-red-400">{fileError}</p> : null}
        {selectedFile ? (
          <pre className="max-h-[540px] overflow-auto whitespace-pre-wrap rounded border border-white/10 bg-black/40 p-2 text-[10px] text-slate-300">
            {fileContent ?? 'Loading…'}
          </pre>
        ) : (
          <p className="text-slate-500">Select a file to view its contents. This is a read-only viewer — all file mutation happens through Commander-approved patches only.</p>
        )}
      </section>

      {/* CODER AGENT */}
      <section className="space-y-3 rounded border border-white/10 bg-black/25 p-2">
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-cyan-300">Coder Agent</p>
          <input
            className="mb-1 w-full rounded border border-white/10 bg-black/40 p-1.5 text-white"
            placeholder="Title"
            value={title}
            onChange={e => setTitle(e.target.value)}
          />
          <input
            className="mb-1 w-full rounded border border-white/10 bg-black/40 p-1.5 text-white"
            placeholder="Target file / subsystem (repo-relative path)"
            value={subsystem}
            onChange={e => setSubsystem(e.target.value)}
          />
          <textarea
            className="mb-1 w-full rounded border border-white/10 bg-black/40 p-1.5 text-white"
            placeholder="Build this feature / fix this bug…"
            rows={3}
            value={description}
            onChange={e => setDescription(e.target.value)}
          />
          <div className="mb-1 flex items-center gap-2">
            <label className="flex items-center gap-1 text-slate-400">
              <input type="checkbox" checked={coderEnabled} onChange={e => setCoderEnabled(e.target.checked)} />
              Hosted coder
            </label>
            <select
              className="rounded border border-white/10 bg-black/40 p-1 text-white"
              value={coderFamily}
              onChange={e => setCoderFamily(e.target.value as CoderFamily)}
              disabled={!coderEnabled}
            >
              <option value="claude">claude</option>
              <option value="chatgpt">chatgpt</option>
              <option value="grok">grok</option>
              <option value="gemini">gemini</option>
              <option value="kimi">kimi</option>
            </select>
          </div>
          <button
            type="button"
            disabled={busy !== null}
            className="w-full rounded border border-emerald-500/40 px-2 py-1 text-emerald-300 disabled:opacity-40"
            onClick={submitCoderRequest}
          >
            {busy === 'create' ? 'Submitting…' : 'Submit request'}
          </button>
        </div>

        {mission ? (
          <div className="border-t border-white/10 pt-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Mission</p>
            <p className="text-white">{mission.title}</p>
            <p className="text-slate-500">
              Status: <span className="font-bold text-amber-300">{mission.status}</span> · repairId: {mission.nativeBuilder.repairId.slice(0, 8)}…
            </p>

            <div className="mt-2 flex flex-wrap gap-2 border-t border-white/10 pt-2">
              <button
                type="button"
                disabled={busy !== null || mission.status !== 'awaiting_approval'}
                className="rounded border border-emerald-500/40 px-2 py-1 text-emerald-300 disabled:opacity-40"
                onClick={approve}
              >
                Approve
              </button>
              <button
                type="button"
                disabled={busy !== null || !['awaiting_commander_decision'].includes(mission.status)}
                className="rounded border border-emerald-500/40 px-2 py-1 text-emerald-300 disabled:opacity-40"
                onClick={() => decide(true)}
              >
                Accept
              </button>
              <button
                type="button"
                disabled={busy !== null || !['awaiting_commander_decision'].includes(mission.status)}
                className="rounded border border-red-500/40 px-2 py-1 text-red-300 disabled:opacity-40"
                onClick={() => decide(false)}
              >
                Reject
              </button>
              <button
                type="button"
                disabled={busy !== null || !['blocked', 'awaiting_commander_decision', 'rolled_back'].includes(mission.status)}
                className="rounded border border-cyan-500/40 px-2 py-1 text-cyan-300 disabled:opacity-40"
                onClick={replan}
              >
                Request replan
              </button>
              <button
                type="button"
                disabled={busy !== null || !['completed', 'awaiting_commander_decision', 'blocked'].includes(mission.status)}
                className="rounded border border-amber-500/40 px-2 py-1 text-amber-300 disabled:opacity-40"
                onClick={rollback}
              >
                Rollback
              </button>
            </div>
            {lastError ? <p className="mt-2 text-red-400">{lastError}</p> : null}

            <div className="mt-2 flex gap-2 border-b border-white/10 pb-1 text-[10px] uppercase tracking-widest">
              {(['output', 'diff', 'validation', 'activity', 'council'] as TabKey[]).map(t => (
                <button
                  key={t}
                  type="button"
                  className={tab === t ? 'text-emerald-300' : 'text-slate-500'}
                  onClick={() => setTab(t)}
                >
                  {t}
                </button>
              ))}
            </div>

            <div className="mt-2 max-h-[420px] overflow-auto">
              {tab === 'output' ? (
                <div>
                  {mission.raw.repair.selectedProposal ? (
                    <>
                      <p className="text-white">{mission.raw.repair.selectedProposal.diagnosis}</p>
                      <p className="text-slate-500">
                        Source: {mission.raw.repair.selectedProposal.sourceKind} ({mission.raw.repair.selectedProposal.proposerId}) · Confidence: {mission.raw.repair.selectedProposal.confidence}
                      </p>
                      <ul className="mt-1 list-disc pl-4 text-slate-400">
                        {mission.raw.repair.selectedProposal.plannedChanges.map((c, i) => (
                          <li key={i}>{c.file} — {c.reason}</li>
                        ))}
                      </ul>
                      {mission.raw.repair.policyResult ? (
                        <p className={mission.raw.repair.policyResult.ok ? 'mt-1 text-emerald-400' : 'mt-1 text-red-400'}>
                          Patch policy: {mission.raw.repair.policyResult.ok ? 'PASSED' : `FAILED (${mission.raw.repair.policyResult.violations.map(v => v.rule).join(', ')})`}
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <p className="text-slate-500">No proposal yet.</p>
                  )}
                  {mission.providerOpinions.length > 0 ? (
                    <div className="mt-2 border-t border-white/10 pt-2">
                      <p className="text-slate-500">Advisory provider opinion:</p>
                      {mission.providerOpinions.map((o, i) => (
                        <p key={i} className={o.ok ? 'text-slate-300' : 'text-amber-400'}>
                          {o.family}: {o.ok ? o.text : `unavailable — ${o.error}`}
                        </p>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {tab === 'diff' ? (
                <pre className="whitespace-pre-wrap rounded border border-white/10 bg-black/40 p-2 text-[10px] text-slate-300">
                  {mission.diff?.diff || '(no diff yet)'}
                </pre>
              ) : null}

              {tab === 'validation' ? (
                <ul className="space-y-1">
                  {mission.validationResults.length === 0 ? <li className="text-slate-500">No validations run yet.</li> : null}
                  {mission.validationResults.map((v, i) => (
                    <li key={i} className={v.ok ? 'text-emerald-400' : 'text-red-400'}>
                      {v.operation.id}: {v.ok ? 'PASS' : `FAIL (exit ${v.exitCode})`} ({v.durationMs}ms)
                      {!v.ok ? <pre className="mt-1 whitespace-pre-wrap text-[9px] text-red-300/80">{(v.stderr || v.stdout).slice(0, 1000)}</pre> : null}
                    </li>
                  ))}
                  {mission.verification ? (
                    <li className="mt-1 text-slate-300">Verification: <span className="font-bold">{mission.verification.status.toUpperCase()}</span></li>
                  ) : null}
                </ul>
              ) : null}

              {tab === 'activity' ? (
                <ul className="space-y-1">
                  {mission.raw.repair.history.map((h, i) => (
                    <li key={i} className="text-slate-400">
                      <span className="text-white">{h.state}</span> — {new Date(h.at).toLocaleTimeString()} {h.note ? `— ${h.note}` : ''}
                    </li>
                  ))}
                </ul>
              ) : null}

              {tab === 'council' ? (
                <div>
                  <p className="mb-2 text-[10px] text-slate-500">
                    Advisory only — Council never mutates this mission. A finding here can only
                    become a change via an explicit Coder request (Coder Agent above), never
                    automatically.
                  </p>
                  <div className="mb-3 flex flex-wrap gap-1">
                    {COUNCIL_ASSIST_COMPOSITIONS.map(c => (
                      <button
                        key={c}
                        type="button"
                        disabled={busy !== null}
                        className="rounded border border-purple-500/40 px-2 py-1 text-[10px] uppercase tracking-wider text-purple-300 hover:bg-purple-950/30 disabled:opacity-40"
                        onClick={() => councilAssist(c)}
                      >
                        {c.replace(/_/g, ' ')}
                      </button>
                    ))}
                  </div>
                  {mission.councilAssistSessions.length === 0 ? (
                    <p className="text-slate-500">No Council Assist sessions yet.</p>
                  ) : (
                    <ul className="space-y-3">
                      {[...mission.councilAssistSessions].reverse().map(s => (
                        <li key={s.id} className="rounded border border-white/10 bg-black/30 p-2">
                          <p className="text-[10px] uppercase tracking-wider text-purple-300">
                            {s.composition.replace(/_/g, ' ')} · {new Date(s.requestedAt).toLocaleTimeString()}
                          </p>
                          {s.results.map((r, i) => (
                            <p key={i} className={r.ok ? 'mt-1 text-slate-300' : 'mt-1 text-amber-400'}>
                              <span className="text-white">{r.family}:</span> {r.ok ? r.text : `unavailable — ${r.error}`}
                            </p>
                          ))}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  )
}
