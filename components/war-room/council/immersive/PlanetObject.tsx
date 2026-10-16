'use client'

import Link from 'next/link'
import type { PlanetStatus, PlanetHealth } from '@/lib/council/immersive/planets'

const THEME: Record<PlanetStatus['id'], { a: string; b: string; ring: string }> = {
  foundry: { a: '#fbbf24', b: '#7c2d12', ring: '#fb923c' },
  hvs: { a: '#e8c872', b: '#4a1d6a', ring: '#c084fc' },
  terra: { a: '#38bdf8', b: '#064e3b', ring: '#34d399' },
}
const HEALTH_WORD: Record<PlanetHealth, string> = { ACTIVE: 'active', READY: 'ready', DEGRADED: 'degraded', UNAVAILABLE: 'unavailable' }
const HEALTH_COLOR: Record<PlanetHealth, string> = { ACTIVE: '#22d3ee', READY: '#34d399', DEGRADED: '#f59e0b', UNAVAILABLE: '#f87171' }

/** A navigable planet. The ring pulses ONLY while the source reports real activity; every other state is a static, labelled badge. */
export function PlanetObject({ status, onOpen, reducedMotion, size = 'clamp(5.5rem, 13vmin, 8rem)' }: { status: PlanetStatus | null; onOpen: () => void; reducedMotion: boolean; size?: string }) {
  const id = status?.id ?? 'foundry'
  const t = THEME[id]
  const health = status?.health ?? 'UNAVAILABLE'
  const label = status ? `${status.name}: ${status.headline}` : 'Loading status'
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group pointer-events-auto flex flex-col items-center gap-1.5 rounded-2xl p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
      aria-label={`${label}. Open ${status?.name ?? id} panel`}
      data-testid={`planet-${id}`}
      data-health={status ? health : 'LOADING'}
      data-activity={status?.activity ? 'true' : 'false'}
    >
      <span
        className="relative block rounded-full"
        style={{
          width: size, height: size,
          background: `radial-gradient(circle at 32% 28%, ${t.a}, ${t.b} 68%, #020617)`,
          boxShadow: `0 0 28px ${t.ring}33, inset -10px -12px 26px rgba(0,0,0,0.55)`,
        }}
      >
        {status?.activity ? (
          <span className={`absolute -inset-1.5 rounded-full border-2 ${reducedMotion ? '' : 'immersive-planet-ring'}`} style={{ borderColor: t.ring }} aria-hidden="true" />
        ) : null}
        <span className="absolute inset-0 grid place-items-center text-[0.65rem] font-bold uppercase tracking-[0.2em] text-white/90 drop-shadow" aria-hidden="true">{status?.name.split(' ').map(w => w[0]).join('').slice(0, 3)}</span>
      </span>
      <span className="max-w-[11rem] text-center text-[10px] font-bold uppercase tracking-[0.18em] text-slate-100">{status?.name ?? id}</span>
      <span className="flex items-center gap-1 rounded-full border border-white/10 bg-black/55 px-2 py-0.5 text-[9px] uppercase tracking-wider" style={{ color: HEALTH_COLOR[health] }}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: HEALTH_COLOR[health] }} aria-hidden="true" />
        {status ? HEALTH_WORD[health] : 'reading…'}
      </span>
    </button>
  )
}

export function PlanetPanel({ status, onClose }: { status: PlanetStatus | null; onClose: () => void }) {
  if (!status) return <p className="p-4 text-sm text-slate-400">Planet status has not been read yet.</p>
  const tone = { ok: 'text-emerald-300', active: 'text-cyan-300', warn: 'text-amber-300', bad: 'text-red-300', neutral: 'text-slate-400' } as const
  return (
    <div className="space-y-3 p-4" data-testid={`planet-panel-${status.id}`}>
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-300">{status.name}</p>
        <p className="mt-1 text-base text-white" style={{ color: HEALTH_COLOR[status.health] }}>{status.headline}</p>
      </div>
      {status.facts.length ? <ul className="list-disc space-y-1 pl-4 text-xs text-slate-300">{status.facts.map(f => <li key={f}>{f}</li>)}</ul> : null}
      {status.items.length ? (
        <ul className="space-y-1.5" aria-label={`${status.name} records`}>
          {status.items.map(i => (
            <li key={`${i.label}${i.detail}`} className="rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5">
              <p className="truncate text-xs text-slate-100">{i.label}</p>
              <p className={`text-[11px] ${tone[i.tone]}`}>{i.detail}</p>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex gap-2 pt-1">
        <Link href={status.href} className="rounded-full border border-cyan-300/40 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-cyan-100 hover:bg-cyan-300/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" data-testid={`planet-open-${status.id}`}>
          Open {status.name}
        </Link>
        <button type="button" onClick={onClose} className="rounded-full border border-white/15 px-3 py-1.5 text-[10px] uppercase tracking-widest text-slate-300 hover:bg-white/10">Close</button>
      </div>
    </div>
  )
}
