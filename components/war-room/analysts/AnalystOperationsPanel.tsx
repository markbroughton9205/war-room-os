import { ANALYST_REGISTRY, type AnalystLane } from '@/lib/analysts/analystRegistry'
import type { AnalystOperationsPacket } from '@/lib/analysts/analystOutcomeEvaluator'

type AnalystOperationsPanelProps = {
  packet?: AnalystOperationsPacket | null
  compact?: boolean
}

const DEFAULT_SNAPSHOTS = [
  'Outcome learning tracks project results, provider effectiveness, repair frequency, approvals, retrieval success, latency, recurring problems, and market/news pattern changes.',
  'Analyst lanes are advisory only; they support Commander decisions and project orchestration without autonomous external action.',
  'Scores are readiness indicators until verified data, source freshness, and runtime evidence are attached.',
]

const DEFAULT_HEAT = [
  { label: 'Decision readiness', state: 'watch', detail: 'Awaiting an explicit analysis packet.' },
  { label: 'Operational pressure', state: 'watch', detail: 'Monitor approvals, repairs, retrieval, and latency.' },
  { label: 'Risk volatility', state: 'watch', detail: 'Unknowns remain until analyst lanes receive data.' },
] as const

function heatColor(state: 'cool' | 'watch' | 'hot') {
  if (state === 'hot') return '#F97316'
  if (state === 'watch') return '#FBBF24'
  return '#34D399'
}

function laneLabel(lane: AnalystLane): string {
  return ANALYST_REGISTRY[lane].label
}

export function AnalystOperationsPanel({ packet, compact = false }: AnalystOperationsPanelProps) {
  const lanes = packet?.lanes.map(lane => lane.lane) ?? (Object.keys(ANALYST_REGISTRY) as AnalystLane[])
  const trendSnapshots = packet?.report.trendSnapshots ?? DEFAULT_SNAPSHOTS
  const heatIndicators = packet?.report.heatIndicators ?? DEFAULT_HEAT
  const scoring = packet?.report.scoringSummaries ?? [
    'Confidence: waiting for analyst request',
    'Opportunity: waiting for analyst request',
    'Operational Impact: waiting for analyst request',
    'Volatility/Risk: waiting for analyst request',
    'Source Reliability: waiting for analyst request',
  ]
  const forecasts = packet?.report.forecastCards ?? [
    {
      title: 'Analyst standby',
      scenario: 'Send an explicit analyze, forecast, compare, score, evaluate, track trends, or bottleneck request.',
      confidence: 0.5,
      risk: 'No live data interpreted yet.',
    },
  ]
  const bottlenecks = packet?.report.bottlenecks ?? [
    'Approval timing, retrieval freshness, provider reliability, and repair loops are watched as bottleneck categories.',
  ]

  return (
    <section
      className="rounded border p-3 text-xs"
      style={{ borderColor: 'rgba(56,189,248,0.22)', background: 'rgba(8,47,73,0.16)' }}
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.3em]" style={{ color: '#38BDF8' }}>
            Analyst Operations
          </div>
          <h2 className="mt-1 text-sm font-bold" style={{ color: '#E0F2FE' }}>
            {packet ? packet.report.title : 'Outcome intelligence standby'}
          </h2>
          <p className="mt-1 max-w-3xl text-[10px] leading-relaxed" style={{ color: '#94A3B8' }}>
            Data analyst families interpret outcomes, trends, scores, forecasts, and bottlenecks for Commander review. They do
            not execute external actions.
          </p>
        </div>
        <span
          className="rounded px-2 py-1 text-[10px] font-bold uppercase tracking-widest"
          style={{ border: '1px solid rgba(251,191,36,0.35)', color: '#FDE68A' }}
        >
          Approval-gated
        </span>
      </div>

      <div className="grid gap-2 md:grid-cols-4">
        {lanes.map(lane => (
          <div key={lane} className="rounded px-2 py-2" style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.22)' }}>
            <div className="font-bold" style={{ color: '#BAE6FD' }}>{laneLabel(lane)}</div>
            <div className="mt-1 text-[10px]" style={{ color: '#64748B' }}>{ANALYST_REGISTRY[lane].role}</div>
          </div>
        ))}
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(52,211,153,0.16)', background: 'rgba(0,0,0,0.2)' }}>
          <div className="mb-1 font-bold tracking-widest" style={{ color: '#86EFAC' }}>TREND SNAPSHOTS</div>
          <ul className="space-y-1" style={{ color: '#CBD5E1' }}>
            {trendSnapshots.slice(0, compact ? 3 : 5).map(item => <li key={item}>- {item}</li>)}
          </ul>
        </div>

        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(251,191,36,0.16)', background: 'rgba(0,0,0,0.2)' }}>
          <div className="mb-1 font-bold tracking-widest" style={{ color: '#FDE68A' }}>SCORING SUMMARY</div>
          <ul className="space-y-1" style={{ color: '#CBD5E1' }}>
            {scoring.slice(0, compact ? 4 : 5).map(item => <li key={item}>- {item}</li>)}
          </ul>
        </div>

        <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(248,113,113,0.16)', background: 'rgba(0,0,0,0.2)' }}>
          <div className="mb-1 font-bold tracking-widest" style={{ color: '#FCA5A5' }}>HEAT INDICATORS</div>
          <div className="space-y-1">
            {heatIndicators.map(item => (
              <div key={item.label} className="rounded px-2 py-1" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
                <span className="font-bold" style={{ color: heatColor(item.state) }}>{item.label}: {item.state}</span>
                <div className="text-[10px]" style={{ color: '#94A3B8' }}>{item.detail}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {!compact ? (
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(96,165,250,0.16)', background: 'rgba(0,0,0,0.2)' }}>
            <div className="mb-1 font-bold tracking-widest" style={{ color: '#93C5FD' }}>FORECAST CARDS</div>
            <div className="space-y-2">
              {forecasts.map(card => (
                <div key={card.title}>
                  <div className="font-bold" style={{ color: '#DBEAFE' }}>{card.title} · {Math.round(card.confidence * 100)}%</div>
                  <div style={{ color: '#CBD5E1' }}>{card.scenario}</div>
                  <div className="text-[10px]" style={{ color: '#FCA5A5' }}>Risk: {card.risk}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded px-3 py-2" style={{ border: '1px solid rgba(244,114,182,0.16)', background: 'rgba(0,0,0,0.2)' }}>
            <div className="mb-1 font-bold tracking-widest" style={{ color: '#F9A8D4' }}>BOTTLENECK DETECTION</div>
            <ul className="space-y-1" style={{ color: '#CBD5E1' }}>
              {bottlenecks.map(item => <li key={item}>- {item}</li>)}
            </ul>
          </div>
        </div>
      ) : null}
    </section>
  )
}
