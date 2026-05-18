'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

type BriefingCategory =
  | 'freight'
  | 'AI automation'
  | 'SMB systems'
  | 'SaaS'
  | 'operations'
  | 'consulting'
  | 'arbitrage'
  | 'infrastructure'
  | 'media/content'
  | 'tooling'

type BriefingItem = {
  title: string
  summary: string
  evidence: string[]
  confidence: number
  source: string
}

type OpportunityRadarItem = {
  id: string
  title: string
  categoryTags: BriefingCategory[]
  opportunityScore: number
  confidenceScore: number
  urgencyScore: number
  sourceAttribution: string
  approvalStatus: 'pending_review' | 'approved' | 'rejected' | 'completed' | 'unavailable'
  riskLevel: string
  recommendedReview: string
}

type CouncilRecommendation = {
  id: string
  agentKey: string
  agentName: string
  kind: string
  title: string
  rationale: string
  priority: 'low' | 'medium' | 'high'
  approvalRequired: true
  canExecute: false
  sourceAttribution: string
}

type LearningSignal = {
  agentKey: string
  agentName: string
  confidenceTrend: 'up' | 'flat' | 'down'
  usefulnessTrend: 'up' | 'flat' | 'down'
  specializationGrowth: number
  approvedLessons: number
  rejectedLessons: number
  validatedOutcomes: number
  growthExplanation: string
}

type StrategicAlert = {
  id: string
  kind: string
  severity: 'info' | 'watch' | 'important' | 'critical'
  title: string
  summary: string
  sourceAttribution: string
  approvalRequired: true
  canExecute: false
}

type FamilyContribution = {
  agentKey: string
  agentName: string
  lane: string
  contribution: string
  confidence: number
  sourceAttribution: string
  canExecute: false
}

type DailyBriefing = {
  generatedAt: string
  briefingDate: string
  persistenceAvailable: boolean
  liveExternalData: { available: false; note: string }
  executiveSummary: string
  sections: {
    aiIndustryDevelopments: BriefingItem[]
    economicSignals: BriefingItem[]
    freightLogisticsRelevance: BriefingItem[]
    smbOpportunities: BriefingItem[]
    riskWarnings: BriefingItem[]
    projectContinuity: BriefingItem[]
    infrastructureConcerns: BriefingItem[]
    businessOperationsInsights: BriefingItem[]
    familyImpactObservations: BriefingItem[]
  }
  memory: {
    available: boolean
    retrievalNote: string
    activeProjects: BriefingItem[]
    unfinishedTasks: BriefingItem[]
    recurringObjectives: BriefingItem[]
    previousRecommendations: BriefingItem[]
    rejectedPlans: BriefingItem[]
    approvedOutcomes: BriefingItem[]
    infrastructureChanges: BriefingItem[]
    recurringOpportunityCategories: BriefingCategory[]
  }
  opportunityRadar: OpportunityRadarItem[]
  recommendations: CouncilRecommendation[]
  learning: LearningSignal[]
  strategicAlerts: StrategicAlert[]
  familyContributions: FamilyContribution[]
  councilRules: string[]
  truthLabels: string[]
}

const SECTION_LABELS: Record<keyof DailyBriefing['sections'], string> = {
  aiIndustryDevelopments: 'AI Industry',
  economicSignals: 'Economic Signals',
  freightLogisticsRelevance: 'Freight / Logistics',
  smbOpportunities: 'SMB Opportunities',
  riskWarnings: 'Risk Warnings',
  projectContinuity: 'Project Continuity',
  infrastructureConcerns: 'Infrastructure',
  businessOperationsInsights: 'Business Operations',
  familyImpactObservations: 'Family Impact',
}

function colorFor(value: string) {
  if (value === 'critical' || value === 'high' || value === 'down' || value === 'rejected') return '#F87171'
  if (value === 'important' || value === 'watch' || value === 'medium' || value === 'pending_review') return '#FBBF24'
  if (value === 'up' || value === 'approved' || value === 'completed') return '#34D399'
  if (value === 'unavailable') return '#A78BFA'
  return '#94A3B8'
}

function Badge({ label }: { label: string }) {
  const color = colorFor(label)
  return (
    <span
      className="rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest"
      style={{ border: `1px solid ${color}66`, color, background: 'rgba(0,0,0,0.25)' }}
    >
      {label}
    </span>
  )
}

function pct(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a'
  return `${Math.round(value * 100)}%`
}

function SectionList({ title, items }: { title: string; items: BriefingItem[] }) {
  return (
    <section className="rounded border border-white/10 bg-black/20 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-300">{title}</h4>
        <span className="text-[9px] text-slate-500">{items.length} signal(s)</span>
      </div>
      <ul className="space-y-2">
        {(items.length ? items : [{ title: 'No sourced signal', summary: 'No stored signal is available for this lane.', evidence: [], confidence: 0, source: 'unavailable' }]).slice(0, 3).map(item => (
          <li key={`${title}-${item.title}`} className="rounded border border-white/10 p-2 text-[10px]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-slate-200">{item.title}</span>
              <span className="text-slate-500">{pct(item.confidence)}</span>
            </div>
            <p className="mt-1 leading-relaxed text-slate-400">{item.summary}</p>
            <p className="mt-1 text-[9px] text-slate-600">Source: {item.source}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-[9px] text-slate-500">
        <span>{label}</span>
        <span>{value}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded bg-white/10">
        <div className="h-full rounded bg-[#d4af37]" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  )
}

export function DailyBriefingPanel() {
  const [briefing, setBriefing] = useState<DailyBriefing | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/baby-ai/briefing', { cache: 'no-store' })
      const body = await res.json() as DailyBriefing & { error?: string }
      if (!res.ok) throw new Error(body.error || 'Baby AI briefing failed')
      setBriefing(body)
    } catch (err) {
      setBriefing(null)
      setError(err instanceof Error ? err.message : 'Baby AI briefing failed')
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

  const sectionEntries = useMemo(() => {
    if (!briefing) return []
    return (Object.keys(briefing.sections) as Array<keyof DailyBriefing['sections']>).map(key => ({
      key,
      label: SECTION_LABELS[key],
      items: briefing.sections[key],
    }))
  }, [briefing])

  return (
    <section className="mb-4 rounded border border-[#d4af37]/30 bg-black/25 p-3 text-xs">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.35em] text-[#d4af37]">Phase 12</p>
          <h3 className="mt-1 text-lg font-semibold text-white">Daily Strategic Briefing</h3>
          <p className="mt-1 max-w-3xl text-[10px] leading-relaxed text-slate-500">
            Read-only operational intelligence from War Room memory, learning, and economic stores. Baby AI proposes and flags only; execution remains false and approval-gated.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge label={briefing?.persistenceAvailable ? 'memory_available' : 'fallback'} />
          <button
            type="button"
            className="rounded px-2 py-1 text-[10px] font-bold tracking-widest"
            style={{ border: '1px solid #444', color: '#ccc' }}
            onClick={() => void load()}
            disabled={loading}
          >
            REFRESH BRIEFING
          </button>
        </div>
      </div>

      {error ? <div className="mb-3 rounded border border-red-500/30 p-2 text-[10px] text-red-300">{error}</div> : null}

      <div className="rounded border border-white/10 bg-black/20 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Latest Briefing</div>
          <div className="text-[10px] text-slate-500">
            {briefing?.generatedAt ?? (loading ? 'loading...' : 'not connected')} · source: /api/baby-ai/briefing
          </div>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-300">
          {briefing?.executiveSummary ?? 'Briefing has not loaded yet.'}
        </p>
        <p className="mt-2 rounded border border-violet-500/20 bg-violet-500/5 p-2 text-[10px] leading-relaxed text-violet-100">
          {briefing?.liveExternalData.note ?? 'Live external data availability is checking.'}
        </p>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.8fr)]">
        <div className="grid gap-3 md:grid-cols-2">
          {sectionEntries.slice(0, 6).map(section => (
            <SectionList key={section.key} title={section.label} items={section.items} />
          ))}
        </div>

        <aside className="space-y-3">
          <section className="rounded border border-amber-500/30 bg-black/20 p-3">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-amber-300">Strategic Alerts</h4>
            <ul className="mt-2 space-y-2">
              {(briefing?.strategicAlerts ?? []).slice(0, 5).map(alert => (
                <li key={alert.id} className="rounded border border-white/10 p-2 text-[10px]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-slate-200">{alert.title}</span>
                    <Badge label={alert.severity} />
                  </div>
                  <p className="mt-1 text-slate-400">{alert.summary}</p>
                  <p className="mt-1 text-[9px] text-slate-600">Source: {alert.sourceAttribution}</p>
                </li>
              ))}
              {briefing && briefing.strategicAlerts.length === 0 ? <li className="rounded border border-white/10 p-2 text-[10px] text-slate-500">No current strategic alerts.</li> : null}
            </ul>
          </section>

          <section className="rounded border border-teal-500/30 bg-black/20 p-3">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-teal-300">Opportunity Pipeline</h4>
            <ul className="mt-2 space-y-2">
              {(briefing?.opportunityRadar ?? []).slice(0, 5).map(opportunity => (
                <li key={opportunity.id} className="rounded border border-white/10 p-2 text-[10px]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-slate-200">{opportunity.title}</span>
                    <Badge label={opportunity.approvalStatus} />
                  </div>
                  <div className="mt-2 space-y-1">
                    <ScoreBar label="Opportunity" value={opportunity.opportunityScore} />
                    <ScoreBar label="Confidence" value={opportunity.confidenceScore} />
                    <ScoreBar label="Urgency" value={opportunity.urgencyScore} />
                  </div>
                  <p className="mt-2 text-slate-400">{opportunity.recommendedReview}</p>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <section className="rounded border border-sky-500/30 bg-black/20 p-3">
          <h4 className="text-[10px] font-bold uppercase tracking-widest text-sky-300">Active Recommendations</h4>
          <ul className="mt-2 max-h-72 space-y-2 overflow-y-auto">
            {(briefing?.recommendations ?? []).slice(0, 8).map(recommendation => (
              <li key={recommendation.id} className="rounded border border-white/10 p-2 text-[10px]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-slate-200">{recommendation.title}</span>
                  <Badge label={recommendation.priority} />
                </div>
                <p className="mt-1 text-slate-500">{recommendation.agentName} · {recommendation.kind}</p>
                <p className="mt-1 text-slate-400">{recommendation.rationale}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded border border-fuchsia-500/30 bg-black/20 p-3">
          <h4 className="text-[10px] font-bold uppercase tracking-widest text-fuchsia-300">Learning Growth</h4>
          <ul className="mt-2 max-h-72 space-y-2 overflow-y-auto">
            {(briefing?.learning ?? []).map(signal => (
              <li key={signal.agentKey} className="rounded border border-white/10 p-2 text-[10px]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-slate-200">{signal.agentName}</span>
                  <span className="flex gap-1">
                    <Badge label={signal.confidenceTrend} />
                    <Badge label={signal.usefulnessTrend} />
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-1 text-center text-[9px] text-slate-500">
                  <div className="rounded border border-white/10 p-1">Approved {signal.approvedLessons}</div>
                  <div className="rounded border border-white/10 p-1">Rejected {signal.rejectedLessons}</div>
                  <div className="rounded border border-white/10 p-1">Validated {signal.validatedOutcomes}</div>
                </div>
                <div className="mt-2">
                  <ScoreBar label="Specialization" value={Math.round(signal.specializationGrowth * 100)} />
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded border border-violet-500/30 bg-black/20 p-3">
          <h4 className="text-[10px] font-bold uppercase tracking-widest text-violet-300">Council Contributions</h4>
          <ul className="mt-2 max-h-72 space-y-2 overflow-y-auto">
            {(briefing?.familyContributions ?? []).map(contribution => (
              <li key={contribution.agentKey} className="rounded border border-white/10 p-2 text-[10px]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-slate-200">{contribution.agentName}</span>
                  <span className="text-slate-500">{pct(contribution.confidence)}</span>
                </div>
                <p className="mt-1 text-slate-500">{contribution.lane}</p>
                <p className="mt-1 text-slate-400">{contribution.contribution}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="mt-3 rounded border border-white/10 bg-black/20 p-2 text-[10px] text-slate-500">
        Memory retrieval: {briefing?.memory.retrievalNote ?? 'loading'} · Categories: {(briefing?.memory.recurringOpportunityCategories ?? []).join(', ') || 'none'}
      </div>
    </section>
  )
}

