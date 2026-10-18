'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

type Scoreboard = {
  skillsRegistered: number
  sourceBacked: number
  evaluated: number
  proven: number
  productionProven: number
  stale: number
  failed: number
  unknown: number
  unsupported: number
  available: number
  discovered: number
  learnable?: number
  lastUpdated: string
}

type SkillHit = {
  skillId: string
  name: string
  capabilityStatus: string
  confidence: string
  domain: string
}

type SkillDetail = {
  skill: {
    skillId: string
    name: string
    description: string
    capabilityStatus: string
    confidence: string
    officialSources: string[]
    supportedToolBrokerTools: string[]
    productionProofMissions: string[]
    relatedSkills: string[]
    evidence: { implementationFiles: string[]; validators: string[]; proofFiles: string[]; notes: string }
  }
  sources: Array<{ sourceId: string; sourceUrl: string; authorityClass: string; stale: boolean }>
  evaluations: Array<{ evaluationId: string; level: string; outcome: string }>
  relationships: Array<{ kind: string; from: string; to: string }>
}

type AtlasPayload = {
  scoreboard: Scoreboard
  skills: SkillHit[]
  detail: SkillDetail | null
  query: string
  discoverySummary?: {
    wavesCompleted?: string[]
    scoreboardAfter?: { learnable?: number; discovered?: number; sourceBacked?: number }
  } | null
  capabilityAssessment?: {
    requiredSkills: string[]
    missingSkills: Array<{ skillId: string; why: string }>
    confidence: string
    recommendation: string
    productionProofRequired?: boolean
  } | null
}

async function loadAtlas(query: string, skillId: string | null): Promise<AtlasPayload> {
  const params = new URLSearchParams()
  if (query) params.set('q', query)
  if (skillId) params.set('skill', skillId)
  const res = await fetch(`/api/foundry/capability-atlas?${params.toString()}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`capability atlas ${res.status}`)
  return res.json() as Promise<AtlasPayload>
}

const FILTERS = ['REGISTERED', 'AVAILABLE', 'LEARNABLE', 'SOURCE_BACKED', 'EVALUATED', 'PROVEN', 'PRODUCTION_PROVEN', 'STALE', 'FAILED', 'GAPS'] as const

export function FoundryCapabilitiesPanel() {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('REGISTERED')
  const [data, setData] = useState<AtlasPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  const refresh = useCallback(async (skillId = selected) => {
    try {
      setError(null)
      setData(await loadAtlas(query, skillId))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [query, selected])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const visible = useMemo(() => {
    const skills = data?.skills ?? []
    if (filter === 'AVAILABLE') return skills.filter(item => item.capabilityStatus === 'AVAILABLE' || item.capabilityStatus === 'EVALUATION_PENDING')
    if (filter === 'LEARNABLE') return skills.filter(item => item.capabilityStatus === 'LEARNABLE')
    if (filter === 'SOURCE_BACKED') return skills.filter(item => item.capabilityStatus === 'SOURCE_BACKED' || item.capabilityStatus === 'LEARNABLE')
    if (filter === 'EVALUATED') return skills.filter(item => item.capabilityStatus === 'EVALUATED')
    if (filter === 'PROVEN') return skills.filter(item => item.capabilityStatus === 'PROVEN' || item.capabilityStatus === 'PRODUCTION_PROVEN')
    if (filter === 'PRODUCTION_PROVEN') return skills.filter(item => item.capabilityStatus === 'PRODUCTION_PROVEN')
    if (filter === 'STALE') return skills.filter(item => item.capabilityStatus === 'STALE')
    if (filter === 'FAILED') return skills.filter(item => item.capabilityStatus === 'FAILED')
    if (filter === 'GAPS') return skills.filter(item => ['DISCOVERED', 'SOURCE_BACKED', 'LEARNABLE', 'FAILED', 'UNSUPPORTED'].includes(item.capabilityStatus))
    return skills
  }, [data, filter])

  const board = data?.scoreboard

  return (
    <section className="relative z-20 mx-2 mb-2 rounded-lg border border-cyan-400/25 bg-slate-950/90 p-3" data-testid="foundry-capabilities-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-cyan-300">Capabilities</p>
          <p className="text-[10px] text-slate-500">Atlas · registered is not mastery</p>
        </div>
        {board ? (
          <p className="text-[9px] uppercase tracking-widest text-slate-400" data-testid="foundry-capabilities-scoreboard">
            {board.skillsRegistered} registered · {board.available} available · {board.learnable ?? 0} learnable · {board.sourceBacked} sourced · {board.evaluated} evaluated · {board.proven} proven · {board.productionProven} production · {board.stale} stale · {board.failed} failed
          </p>
        ) : null}
      </div>
      {data?.discoverySummary?.wavesCompleted?.length ? (
        <p className="mt-1 text-[9px] uppercase tracking-widest text-slate-500" data-testid="foundry-capabilities-discovery">
          Discovery waves {data.discoverySummary.wavesCompleted.length} · remaining gaps {data.discoverySummary.scoreboardAfter?.discovered ?? '—'} discovered
        </p>
      ) : null}
      {data?.capabilityAssessment ? (
        <div className="mt-2 rounded border border-white/10 p-2" data-testid="foundry-capabilities-mission-gate">
          <p className="text-[9px] uppercase tracking-widest text-cyan-300">Mission gate · advisory</p>
          <p className="text-[10px] text-emerald-100" data-testid="foundry-capabilities-recommendation">{data.capabilityAssessment.recommendation} · {data.capabilityAssessment.confidence}</p>
          <p className="text-[9px] uppercase tracking-widest text-slate-500">Required skills</p>
          <p className="text-[10px] text-slate-400">{data.capabilityAssessment.requiredSkills.join(', ') || 'None'}</p>
          <p className="text-[9px] uppercase tracking-widest text-slate-500">Missing skills</p>
          <p className="text-[10px] text-slate-400">{data.capabilityAssessment.missingSkills.map(item => item.skillId).join(', ') || 'None'}</p>
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-1" data-testid="foundry-capabilities-filters">
        {FILTERS.map(item => (
          <button
            key={item}
            type="button"
            className={`rounded border px-2 py-0.5 text-[9px] uppercase tracking-widest ${filter === item ? 'border-cyan-400/50 text-cyan-200' : 'border-white/10 text-slate-500'}`}
            onClick={() => setFilter(item)}
          >
            {item.replaceAll('_', ' ')}
          </button>
        ))}
      </div>
      <form
        className="mt-2 flex gap-1"
        onSubmit={event => {
          event.preventDefault()
          void refresh(null)
          setSelected(null)
        }}
      >
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Search Rust, CUDA, kernel, PostgreSQL"
          className="min-w-0 flex-1 rounded border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-emerald-50 outline-none"
          data-testid="foundry-capabilities-search"
        />
        <button type="submit" className="rounded border border-cyan-400/30 px-2 py-1 text-[9px] uppercase tracking-widest text-cyan-200">
          Search
        </button>
      </form>
      {error ? <p className="mt-2 text-[10px] text-amber-300">{error}</p> : null}
      <div className="mt-2 grid gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <ul className="max-h-56 space-y-1 overflow-auto" data-testid="foundry-capabilities-list">
          {visible.slice(0, 60).map(item => (
            <li key={item.skillId}>
              <button
                type="button"
                className={`w-full rounded border px-2 py-1 text-left ${selected === item.skillId ? 'border-cyan-400/40 bg-cyan-950/40' : 'border-white/10'}`}
                onClick={() => {
                  setSelected(item.skillId)
                  void refresh(item.skillId)
                }}
              >
                <p className="truncate text-[11px] text-emerald-100">{item.name}</p>
                <p className="truncate text-[9px] uppercase tracking-widest text-slate-500">{item.skillId} · {item.capabilityStatus}</p>
              </button>
            </li>
          ))}
        </ul>
        <div className="rounded border border-white/10 p-2" data-testid="foundry-capabilities-detail">
          {data?.detail ? (
            <>
              <p className="text-[11px] font-bold text-emerald-100">{data.detail.skill.name}</p>
              <p className="text-[9px] uppercase tracking-widest text-cyan-300">{data.detail.skill.capabilityStatus} · {data.detail.skill.confidence}</p>
              <p className="mt-1 text-[11px] text-slate-300">{data.detail.skill.description}</p>
              <p className="mt-2 text-[9px] uppercase tracking-widest text-slate-500">Sources</p>
              <ul className="text-[10px] text-slate-400">
                {data.detail.sources.map(source => (
                  <li key={source.sourceId}>{source.authorityClass} · {source.sourceUrl}</li>
                ))}
              </ul>
              <p className="mt-2 text-[9px] uppercase tracking-widest text-slate-500">Evaluations</p>
              <p className="text-[10px] text-slate-400">{data.detail.evaluations.length ? data.detail.evaluations.map(item => `${item.level}:${item.outcome}`).join(' · ') : 'None recorded'}</p>
              <p className="mt-2 text-[9px] uppercase tracking-widest text-slate-500">Proof missions</p>
              <p className="text-[10px] text-slate-400">{data.detail.skill.productionProofMissions.join(', ') || 'None'}</p>
              <p className="mt-2 text-[9px] uppercase tracking-widest text-slate-500">Related</p>
              <p className="text-[10px] text-slate-400">{data.detail.relationships.map(item => `${item.kind} ${item.to}`).join(' · ') || 'None'}</p>
            </>
          ) : (
            <p className="text-[10px] text-slate-500">Select a skill. Documentation is not mastery.</p>
          )}
        </div>
      </div>
    </section>
  )
}
