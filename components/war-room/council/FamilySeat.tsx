import type { CouncilFamily, CouncilFamilyStatus } from '@/lib/mockCouncilData'

const STATUS_STYLES: Record<
  CouncilFamilyStatus,
  { badge: string; glow: string; label: string }
> = {
  idle: {
    badge: 'border-slate-500/50 bg-slate-950/80 text-slate-400',
    glow: 'shadow-[0_0_20px_rgba(148,163,184,0.12)]',
    label: 'Idle',
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
