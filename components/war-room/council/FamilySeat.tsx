import type { CouncilFamily, CouncilFamilyStatus, CouncilSubAgent, SubAgentStatus } from '@/lib/mockCouncilData'

// All statuses rendered on this legacy route come from `MOCK_COUNCIL_FAMILIES`
// (lib/mockCouncilData.ts) — simulated placeholder data, not live provider
// state. Every badge is therefore prefixed "Simulated" and styled neutral
// slate: no green/healthy/active/completed styling without runtime evidence.
const STATUS_STYLES: Record<
  CouncilFamilyStatus,
  { badge: string; label: string }
> = {
  idle: {
    badge: 'border-dashed border-slate-500/50 bg-slate-950/80 text-slate-400',
    label: 'Simulated idle',
  },
  standby: {
    badge: 'border-dashed border-slate-500/50 bg-slate-950/80 text-slate-400',
    label: 'Simulated standby',
  },
  thinking: {
    badge: 'border-dashed border-slate-500/50 bg-slate-950/80 text-slate-400',
    label: 'Simulated thinking',
  },
  executing: {
    badge: 'border-dashed border-slate-500/50 bg-slate-950/80 text-slate-400',
    label: 'Simulated executing',
  },
  reviewing: {
    badge: 'border-dashed border-slate-500/50 bg-slate-950/80 text-slate-400',
    label: 'Simulated reviewing',
  },
  blocked: {
    badge: 'border-dashed border-slate-500/50 bg-slate-950/80 text-slate-400',
    label: 'Simulated blocked',
  },
  complete: {
    badge: 'border-dashed border-slate-500/50 bg-slate-950/80 text-slate-400',
    label: 'Simulated complete',
  },
}

const SUB_AGENT_STYLES: Record<SubAgentStatus, { dot: string; label: string }> = {
  idle: {
    dot: 'bg-slate-600/40 border-slate-500/40',
    label: 'text-slate-500',
  },
  active: {
    dot: 'bg-slate-500/60 border-slate-400/60',
    label: 'text-slate-400',
  },
  reviewing: {
    dot: 'bg-slate-500/60 border-slate-400/60',
    label: 'text-slate-400',
  },
  blocked: {
    dot: 'bg-slate-600/40 border-slate-500/40',
    label: 'text-slate-500',
  },
}

const NODE_POSITIONS = [
  { left: '10%', top: '54%' },
  { left: '28%', top: '18%' },
  { left: '50%', top: '8%' },
  { left: '72%', top: '18%' },
  { left: '90%', top: '54%' },
]

function formatTime(iso: string) {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function SubAgentConstellation({ subAgents }: { subAgents?: CouncilSubAgent[] }) {
  if (!subAgents?.length) return null

  return (
    <div className="relative mt-3 rounded-lg border border-white/10 bg-black/25 px-2 py-2">
      <div className="relative h-12">
        {subAgents.map((agent, index) => {
          const style = SUB_AGENT_STYLES[agent.status]
          const position = NODE_POSITIONS[index] ?? NODE_POSITIONS[0]

          return (
            <div
              key={agent.name}
              className="group/node absolute -translate-x-1/2"
              style={position}
            >
              <div
                className={[
                  'h-2.5 w-2.5 rounded-full border transition duration-300',
                  style.dot,
                ]
                  .filter(Boolean)
                  .join(' ')}
                title={`${agent.name} | simulated ${agent.status} | ${agent.currentTask}`}
              />
              <div className="pointer-events-none absolute left-1/2 top-4 z-20 hidden w-36 -translate-x-1/2 rounded border border-white/20 bg-black/90 p-2 text-[9px] leading-snug shadow-lg group-hover/node:block">
                <div className="font-semibold text-white">{agent.name}</div>
                <div className={['mt-0.5 uppercase tracking-wider', style.label].join(' ')}>
                  simulated {agent.status}
                </div>
                <div className="mt-1 text-slate-500">{agent.currentTask}</div>
              </div>
            </div>
          )
        })}
      </div>
      <div className="relative grid grid-cols-5 gap-1">
        {subAgents.map(agent => {
          const style = SUB_AGENT_STYLES[agent.status]

          return (
            <div key={agent.name} className={['truncate text-center text-[8px]', style.label].join(' ')}>
              {agent.name}
            </div>
          )
        })}
      </div>
      <p className="relative mt-1 text-center text-[8px] uppercase tracking-wider text-slate-600">
        Simulated sub-agent states — not live
      </p>
    </div>
  )
}

export function FamilySeat({
  family,
  className = '',
}: {
  family: CouncilFamily
  className?: string
}) {
  const s = STATUS_STYLES[family.status]

  return (
    <article
      className={[
        'group relative overflow-hidden rounded-xl border border-white/15 bg-black/55 p-3 font-mono text-[11px] text-slate-300 backdrop-blur-md transition duration-300',
        'hover:border-white/25',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="relative flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold tracking-tight text-white">{family.familyName}</p>
          <p className="mt-0.5 truncate text-[10px] text-slate-500">{family.provider}</p>
          <p className="mt-0.5 line-clamp-1 text-[9px] text-slate-600">{family.domain}</p>
        </div>
        <span
          className={[
            'shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider',
            s.badge,
          ].join(' ')}
        >
          {s.label}
        </span>
      </div>
      <p className="relative mt-2 line-clamp-2 text-[10px] leading-snug text-slate-300">{family.currentTask}</p>
      <p className="relative mt-1 line-clamp-1 text-[9px] text-slate-500">{family.lastOutputSummary}</p>
      <SubAgentConstellation subAgents={family.subAgents} />
      <p className="relative mt-2 text-[8px] uppercase tracking-wider text-slate-600">
        Simulated metrics — not measured
      </p>
      <dl className="relative mt-1 grid grid-cols-2 gap-x-2 gap-y-1 text-[10px] text-slate-400">
        <div className="col-span-2 flex items-center justify-between gap-2 border-t border-white/5 pt-1.5">
          <dt className="text-slate-600">Conf</dt>
          <dd className="font-semibold text-[#FFD700]">{family.confidenceScore}%</dd>
        </div>
        <div className="flex justify-between gap-1">
          <dt className="text-slate-600">Risk</dt>
          <dd className="uppercase text-slate-200">{family.riskLevel}</dd>
        </div>
        <div className="flex justify-between gap-1">
          <dt className="text-slate-600">Cost</dt>
          <dd className="text-sky-200/90">{family.costUsageMeter}%</dd>
        </div>
        <div className="flex justify-between gap-1">
          <dt className="text-slate-600">Mem</dt>
          <dd>{family.memoryContributionCount}</dd>
        </div>
        <div className="flex justify-between gap-1">
          <dt className="text-slate-600">Obj</dt>
          <dd className={family.objectionFlag ? 'text-[#FFD700]' : 'text-slate-500'}>
            {family.objectionFlag ? 'Yes' : 'No'}
          </dd>
        </div>
        <div className="col-span-2 flex justify-between gap-1 border-t border-white/5 pt-1 text-[9px]">
          <dt className="text-slate-600">Active</dt>
          <dd className="truncate text-slate-300">{formatTime(family.lastActiveTime)}</dd>
        </div>
      </dl>
      <p className="relative mt-1.5 line-clamp-1 text-[9px] text-slate-500">{family.nextAction}</p>
    </article>
  )
}
