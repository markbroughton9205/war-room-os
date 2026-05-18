'use client'

import { useCallback, useEffect, useState } from 'react'

type BabyAiStatus = 'live_persistent' | 'persistent_store' | 'awaiting_data' | 'static_seed' | 'not_connected'

type BabySkill = {
  key: string
  label: string
  description: string
  progress: number
}

type BabyAgent = {
  key: string
  displayName: string
  familyIdentity: string
  role: string
  memoryScope: string[]
  growthLevel: string
  skillTree: BabySkill[]
  confidenceScore: number
  usefulnessScore: number
  nextTrainingNeed: string
  latestLesson: string
  persistence: BabyAiStatus
  trainingEventCount: number | null
  memoryCount: number | null
  outcomeCount: number | null
}

type BabyCouncilObservation = {
  agentKey: string
  agentName: string
  familyIdentity: string
  observation: string
  suggestedCouncilUse: string
  approvalGate: string
  canExecute: false
}

type BabyAiSnapshot = {
  generatedAt: string
  persistenceAvailable: boolean
  overallStatus: BabyAiStatus
  lifecycle: { stages: string[]; rule: string }
  learningSources: { id: string; label: string; permanenceRule: string }[]
  tables: { table: string; records: number | null; status: BabyAiStatus; detail: string }[]
  agents: BabyAgent[]
  latestLessons: string[]
  council: {
    liveCouncilRole: 'observation_and_task_proposal'
    executionAllowed: false
    localBridgeDependency: 'optional_accelerator'
    observations: BabyCouncilObservation[]
  }
  localBridge: {
    dependency: 'optional_accelerator'
    statusCopy: string
  }
  governanceRules: string[]
  counts: {
    babyAgents: number
    persistedAgents: number | null
    trainingEvents: number | null
    approvedLessons: number | null
    outcomes: number | null
  }
}

function statusColor(status?: string) {
  if (status === 'live_persistent') return '#34D399'
  if (status === 'persistent_store') return '#2DD4BF'
  if (status === 'awaiting_data') return '#FBBF24'
  if (status === 'static_seed') return '#A78BFA'
  if (status === 'not_connected') return '#F87171'
  if (status === 'senior' || status === 'specialist' || status === 'useful') return '#34D399'
  if (status === 'learning' || status === 'observing') return '#FBBF24'
  return '#94A3B8'
}

function Badge({ status }: { status?: string }) {
  const color = statusColor(status)
  return (
    <span
      className="rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest"
      style={{ border: `1px solid ${color}66`, color, background: 'rgba(0,0,0,0.25)' }}
    >
      {status ?? 'checking'}
    </span>
  )
}

function pct(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a'
  return `${Math.round(value * 100)}%`
}

function countLabel(value: number | null | undefined) {
  return typeof value === 'number' ? String(value) : 'not connected'
}

function MiniCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-white/10 bg-black/25 p-2">
      <div className="text-[9px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-200">{value}</div>
    </div>
  )
}

function SkillBar({ skill }: { skill: BabySkill }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2 text-[9px]">
        <span className="truncate text-slate-300">{skill.label}</span>
        <span className="text-slate-500">{pct(skill.progress)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded bg-white/10">
        <div className="h-full rounded bg-[#d4af37]" style={{ width: `${Math.max(0, Math.min(100, Math.round(skill.progress * 100)))}%` }} />
      </div>
    </div>
  )
}

export function BabyAiAcademyPanel() {
  const [snapshot, setSnapshot] = useState<BabyAiSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/baby-ai/academy', { cache: 'no-store' })
      const body = await res.json() as BabyAiSnapshot & { error?: string }
      if (!res.ok) throw new Error(body.error || 'Baby AI Academy snapshot failed')
      setSnapshot(body)
    } catch (err) {
      setSnapshot(null)
      setError(err instanceof Error ? err.message : 'Baby AI Academy snapshot failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const agents = snapshot?.agents ?? []
  const observations = snapshot?.council.observations ?? []
  const latestLessons = snapshot?.latestLessons ?? []

  return (
    <section className="mx-auto mt-14 max-w-6xl border-t border-white/10 pt-10">
      <header className="mb-6">
        <p className="text-[10px] font-semibold uppercase tracking-[0.4em] text-[#d4af37]">Phase 11</p>
        <h2 className="mt-2 text-xl font-semibold tracking-tight text-white sm:text-2xl">
          Baby AI Nursery / Academy
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Family growth, training, and council observations. This is a learning and proposal surface only: no hidden execution, shell access, filesystem mutation, deployment control, or destructive action path.
        </p>
      </header>

      <div className="mb-4 rounded border border-white/10 bg-black/25 p-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Nursery Truth Layer</div>
            <div className="mt-1 text-[10px] text-slate-500">
              Snapshot: {snapshot?.generatedAt ?? (loading ? 'loading...' : 'not connected')} · persistence: {snapshot ? String(snapshot.persistenceAvailable) : 'unknown'} · source: /api/baby-ai/academy
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge status={snapshot?.overallStatus} />
            <button
              type="button"
              className="rounded px-2 py-1 text-[10px] font-bold tracking-widest"
              style={{ border: '1px solid #444', color: '#ccc' }}
              onClick={() => void load()}
              disabled={loading}
            >
              REFRESH
            </button>
          </div>
        </div>
        {error ? <div className="mt-2 text-[10px] text-red-300">{error}</div> : null}
        <div className="mt-3 grid gap-2 md:grid-cols-5">
          <MiniCard label="Babies" value={String(snapshot?.counts.babyAgents ?? 8)} />
          <MiniCard label="Persisted Agents" value={countLabel(snapshot?.counts.persistedAgents)} />
          <MiniCard label="Training Events" value={countLabel(snapshot?.counts.trainingEvents)} />
          <MiniCard label="Approved Lessons" value={countLabel(snapshot?.counts.approvedLessons)} />
          <MiniCard label="Outcomes" value={countLabel(snapshot?.counts.outcomes)} />
        </div>
        <div className="mt-3 rounded border border-sky-500/20 bg-sky-500/5 p-2 text-[10px] leading-relaxed text-sky-100">
          {snapshot?.localBridge.statusCopy ?? 'Local LM Studio/Ollama is optional acceleration only; Baby AI growth remains available through War Room persistence and approved outcomes.'}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        <section className="rounded border border-[#d4af37]/30 bg-black/25 p-3 text-xs">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-[#d4af37]">Active Family Babies</h3>
            <Badge status={snapshot?.localBridge.dependency ?? 'optional_accelerator'} />
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {agents.map(agent => (
              <article key={agent.key} className="rounded border border-white/10 bg-black/20 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h4 className="font-semibold text-white">{agent.displayName}</h4>
                    <p className="mt-0.5 text-[10px] text-slate-500">{agent.familyIdentity} · {agent.role}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge status={agent.growthLevel} />
                    <Badge status={agent.persistence} />
                  </div>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <MiniCard label="Confidence" value={pct(agent.confidenceScore)} />
                  <MiniCard label="Usefulness" value={pct(agent.usefulnessScore)} />
                </div>
                <div className="mt-3 space-y-2">
                  {agent.skillTree.slice(0, 3).map(skill => <SkillBar key={skill.key} skill={skill} />)}
                </div>
                <div className="mt-3 rounded border border-white/10 p-2 text-[10px] text-slate-400">
                  <div><span className="text-slate-500">Latest lesson:</span> {agent.latestLesson}</div>
                  <div className="mt-1"><span className="text-slate-500">Next need:</span> {agent.nextTrainingNeed}</div>
                </div>
                <div className="mt-2 text-[9px] text-slate-500">
                  Training {countLabel(agent.trainingEventCount)} · memories {countLabel(agent.memoryCount)} · outcomes {countLabel(agent.outcomeCount)}
                </div>
              </article>
            ))}
          </div>
        </section>

        <aside className="space-y-4">
          <section className="rounded border border-teal-500/30 bg-black/25 p-3 text-xs">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-teal-300">Learning Lifecycle</h3>
            <p className="mt-2 text-[10px] leading-relaxed text-slate-400">{snapshot?.lifecycle.rule ?? 'Lifecycle loading.'}</p>
            <div className="mt-3 flex flex-wrap gap-1">
              {(snapshot?.lifecycle.stages ?? ['seed', 'observing', 'learning', 'useful', 'specialist', 'senior']).map(stage => (
                <Badge key={stage} status={stage} />
              ))}
            </div>
          </section>

          <section className="rounded border border-violet-500/30 bg-black/25 p-3 text-xs">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-violet-300">Council Observation Surface</h3>
            <p className="mt-2 text-[10px] text-slate-500">
              Babies can suggest improvements and tasks for approval. Execution remains false.
            </p>
            <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto">
              {observations.slice(0, 6).map(item => (
                <li key={item.agentKey} className="rounded border border-white/10 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-200">{item.agentName}</span>
                    <Badge status={item.canExecute ? 'execution' : 'observe_only'} />
                  </div>
                  <p className="mt-1 text-[10px] text-slate-400">{item.observation}</p>
                  <p className="mt-1 text-[9px] text-slate-500">{item.approvalGate}</p>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded border border-amber-500/30 bg-black/25 p-3 text-xs">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-amber-300">Governance</h3>
            <ul className="mt-2 space-y-1 text-[10px] text-slate-400">
              {(snapshot?.governanceRules ?? []).slice(0, 5).map(rule => <li key={rule}>Rule: {rule}</li>)}
            </ul>
          </section>
        </aside>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="rounded border border-white/10 bg-black/25 p-3 text-xs">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-300">Persistent Tables</h3>
          <div className="mt-3 grid gap-2">
            {(snapshot?.tables ?? []).map(table => (
              <div key={table.table} className="flex flex-wrap items-center justify-between gap-2 rounded border border-white/10 p-2">
                <span className="text-slate-300">{table.table}</span>
                <span className="text-[10px] text-slate-500">{countLabel(table.records)} rows</span>
                <Badge status={table.status} />
              </div>
            ))}
          </div>
        </section>

        <section className="rounded border border-white/10 bg-black/25 p-3 text-xs">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-300">Latest Durable Lessons</h3>
          <ul className="mt-3 space-y-2 text-[10px] text-slate-400">
            {(latestLessons.length ? latestLessons : ['Awaiting Commander-approved or repeatedly validated Baby AI lessons.']).slice(0, 8).map(lesson => (
              <li key={lesson} className="rounded border border-white/10 p-2">{lesson}</li>
            ))}
          </ul>
        </section>
      </div>
    </section>
  )
}
