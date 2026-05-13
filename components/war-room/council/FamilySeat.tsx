import type { CouncilFamily, CouncilFamilyStatus, CouncilSubAgent, SubAgentStatus } from '@/lib/mockCouncilData'

const STATUS_STYLES: Record<
  CouncilFamilyStatus,
  { badge: string; glow: string; label: string }
> = {
  idle: {
    badge: 'border-slate-500/50 bg-slate-950/80 text-slate-400',
    glow: 'shadow-[0_0_20px_rgba(148,163,184,0.12)]',
    label: 'Idle',
  },
  standby: {
    badge: 'border-[#FFD700]/35 bg-slate-950/80 text-[#FFD700]/80',
    glow: 'shadow-[0_0_22px_rgba(255,215,0,0.14)]',
    label: 'Standby',
  },
  thinking: {
    badge: 'border-sky-400/50 bg-sky-950/60 text-sky-200',
    glow: 'shadow-[0_0_22px_rgba(56,189,248,0.28)]',
    label: 'Thinking',
  },
  executing: {
    badge: 'border-[#00ff41]/55 bg-emerald-950/50 text-[#00ff41]',
    glow: 'shadow-[0_0_26px_rgba(0,255,65,0.35)]',
    label: 'Executing',
  },
  reviewing: {
    badge: 'border-[#FFD700]/50 bg-amber-950/40 text-[#FFD700]',
    glow: 'shadow-[0_0_24px_rgba(255,215,0,0.22)]',
    label: 'Reviewing',
  },
  blocked: {
    badge: 'border-red-500/55 bg-red-950/50 text-red-300',
    glow: 'shadow-[0_0_24px_rgba(239,68,68,0.28)]',
    label: 'Blocked',
  },
  complete: {
    badge: 'border-emerald-600/45 bg-emerald-950/35 text-emerald-300/90',
    glow: 'shadow-[0_0_18px_rgba(16,185,129,0.2)]',
    label: 'Complete',
  },
}

const SUB_AGENT_STYLES: Record<SubAgentStatus, { dot: string; label: string; glow: string }> = {
  idle: {
    dot: 'bg-[#00ff41]/35 border-[#00ff41]/25',
    label: 'text-slate-500',
    glow: 'shadow-[0_0_10px_rgba(0,255,65,0.08)]',
  },
  active: {
    dot: 'bg-[#00ff41] border-[#00ff41]',
    label: 'text-[#00ff41]',
    glow: 'shadow-[0_0_14px_rgba(0,255,65,0.75)]',
  },
  reviewing: {
    dot: 'bg-[#FFD700]/80 border-[#FFD700]/75',
    label: 'text-[#FFD700]/90',
    glow: 'shadow-[0_0_13px_rgba(255,215,0,0.45)]',
  },
  blocked: {
    dot: 'bg-red-400/80 border-red-300/70',
    label: 'text-red-300/90',
    glow: 'shadow-[0_0_13px_rgba(248,113,113,0.45)]',
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
    <div className="relative mt-3 rounded-lg border border-[#00ff41]/10 bg-black/25 px-2 py-2">
      <div
        className="pointer-events-none absolute inset-x-5 top-[1.35rem] h-px opacity-55"
        style={{
          background:
            'linear-gradient(90deg, transparent, rgba(0,255,65,0.38), rgba(255,215,0,0.22), rgba(0,255,65,0.38), transparent)',
        }}
      />
      <div
        className="pointer-events-none absolute inset-x-8 top-[2.15rem] h-px opacity-30"
        style={{
          background:
            'linear-gradient(90deg, transparent, rgba(0,255,65,0.22), transparent 50%, rgba(0,255,65,0.22), transparent)',
        }}
      />
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
                  style.glow,
                  agent.status === 'active' ? 'animate-pulse' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                title={`${agent.name} | ${agent.status} | ${agent.currentTask}`}
              />
              <div className="pointer-events-none absolute left-1/2 top-4 z-20 hidden w-36 -translate-x-1/2 rounded border border-[#00ff41]/20 bg-black/90 p-2 text-[9px] leading-snug shadow-[0_0_20px_rgba(0,255,65,0.16)] group-hover/node:block">
                <div className="font-semibold text-white">{agent.name}</div>
                <div className={['mt-0.5 uppercase tracking-wider', style.label].join(' ')}>
                  {agent.status}
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
        'group relative overflow-hidden rounded-xl border border-[#00ff41]/25 bg-black/55 p-3 font-mono text-[11px] text-slate-300 backdrop-blur-md transition duration-300',
        'shadow-[0_0_0_1px_rgba(0,255,65,0.08),inset_0_0_32px_rgba(255,215,0,0.04)]',
        'hover:border-[#FFD700]/35 hover:shadow-[0_0_0_1px_rgba(255,215,0,0.12),0_0_28px_rgba(0,255,65,0.15)]',
        s.glow,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background:
            'radial-gradient(ellipse 80% 70% at 20% 0%, rgba(0,255,65,0.12), transparent), radial-gradient(ellipse 70% 60% at 100% 100%, rgba(255,215,0,0.08), transparent)',
        }}
      />
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
      <p className="relative mt-2 line-clamp-2 text-[10px] leading-snug text-[#00ff41]/90">{family.currentTask}</p>
      <p className="relative mt-1 line-clamp-1 text-[9px] text-slate-500">{family.lastOutputSummary}</p>
      <SubAgentConstellation subAgents={family.subAgents} />
      <dl className="relative mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-[10px] text-slate-400">
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
