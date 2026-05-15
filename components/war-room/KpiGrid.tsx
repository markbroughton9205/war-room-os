import Link from 'next/link'
import { MOCK_KPIS } from '@/lib/war-room/mock-kpis'

export function KpiGrid() {
  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-8">
        <p className="text-[10px] font-semibold uppercase tracking-[0.4em] text-[#d4af37]">Dashboard</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          Operational overview
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-400">
          The Council is aligned. Memory persists. Signal integrity stable.
        </p>
        <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.35em] text-amber-500/85">
          Mock / Estimated
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {MOCK_KPIS.map((kpi) => (
          <article
            key={kpi.id}
            className="group rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-[0_0_0_1px_rgba(56,189,248,0.06),0_20px_50px_-28px_rgba(0,0,0,0.85)] backdrop-blur-md transition duration-300 hover:border-[#d4af37]/25 hover:shadow-[0_0_0_1px_rgba(212,175,55,0.12),0_24px_60px_-24px_rgba(56,189,248,0.25)]"
          >
            <p className="text-[10px] font-medium uppercase tracking-[0.25em] text-slate-500">{kpi.label}</p>
            <p className="mt-3 font-mono text-3xl font-semibold tracking-tight text-white">{kpi.value}</p>
            {kpi.sublabel && (
              <p className="mt-1 text-xs text-slate-500">{kpi.sublabel}</p>
            )}
            {kpi.trend && (
              <p className="mt-4 text-xs font-medium text-[#38bdf8] opacity-90 transition group-hover:text-[#d4af37]">
                {kpi.trend}
              </p>
            )}
          </article>
        ))}
      </div>

      <p className="mt-10 text-center text-[10px] uppercase tracking-[0.35em] text-slate-600">
        <Link
          href="/globe"
          className="text-[#d4af37]/80 underline-offset-4 transition hover:text-[#d4af37] hover:underline"
        >
          Global intelligence
        </Link>
        <span className="mx-3 text-slate-700">·</span>
        <Link href="/" className="text-slate-500 underline-offset-4 transition hover:text-slate-300 hover:underline">
          Home
        </Link>
      </p>
    </div>
  )
}
