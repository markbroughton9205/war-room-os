'use client'

import { useState } from 'react'

type NavItem = { id: string; label: string; icon: 'grid' | 'globe' | 'shield' | 'chart' | 'gear' }

const NAV: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: 'grid' },
  { id: 'intel', label: 'Intel', icon: 'globe' },
  { id: 'ops', label: 'Operations', icon: 'shield' },
  { id: 'signals', label: 'Signals', icon: 'chart' },
  { id: 'settings', label: 'Settings', icon: 'gear' },
]

function Icon({ name }: { name: NavItem['icon'] }) {
  const stroke = 'currentColor'
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none' as const }
  switch (name) {
    case 'grid':
      return (
        <svg {...common} aria-hidden>
          <path d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z" stroke={stroke} strokeWidth="1.25" />
        </svg>
      )
    case 'globe':
      return (
        <svg {...common} aria-hidden>
          <circle cx="12" cy="12" r="9" stroke={stroke} strokeWidth="1.25" />
          <path d="M3 12h18M12 3c3 4 3 14 0 18" stroke={stroke} strokeWidth="1.25" />
        </svg>
      )
    case 'shield':
      return (
        <svg {...common} aria-hidden>
          <path d="M12 3l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V7l8-4z" stroke={stroke} strokeWidth="1.25" />
        </svg>
      )
    case 'chart':
      return (
        <svg {...common} aria-hidden>
          <path d="M4 19V5M4 19h16M8 15l3-4 3 2 4-6" stroke={stroke} strokeWidth="1.25" strokeLinecap="round" />
        </svg>
      )
    case 'gear':
      return (
        <svg {...common} aria-hidden>
          <path
            d="M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zm7.94-2.07l-1.26.73.22 1.45a1 1 0 01-1.45 1.05l-1.36-.8-1.36.8a1 1 0 01-1.45-1.05l.22-1.45-1.26-.73a1 1 0 010-1.86l1.26-.73-.22-1.45A1 1 0 0110.6 5.9l1.36.8 1.36-.8a1 1 0 011.45 1.05l-.22 1.45 1.26.73a1 1 0 010 1.86z"
            stroke={stroke}
            strokeWidth="1.1"
          />
        </svg>
      )
    default:
      return null
  }
}

const railBtn =
  'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm tracking-wide text-slate-300 transition-colors duration-200 hover:bg-white/5 hover:text-[#d4af37] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#38bdf8]/60'

const activeRail =
  'bg-[#d4af37]/10 text-[#d4af37] shadow-[inset_0_0_0_1px_rgba(212,175,55,0.35),0_0_24px_-8px_rgba(56,189,248,0.35)]'

function NavButtons({
  active,
  compact,
}: {
  active: string
  compact?: boolean
}) {
  return (
    <nav className="flex flex-col gap-1 p-3" aria-label="War room">
      {NAV.map((item) => {
        const isActive = active === item.id
        return (
          <button
            key={item.id}
            type="button"
            title={`${item.label} — section navigation is not connected on this legacy route`}
            disabled
            className={`${railBtn} ${isActive ? activeRail : ''} ${compact ? 'justify-center px-2' : ''} cursor-not-allowed opacity-50`}
          >
            <span className={isActive ? 'text-[#d4af37]' : 'text-slate-400'}>
              <Icon name={item.icon} />
            </span>
            {!compact && <span className="font-medium uppercase text-xs">{item.label}</span>}
          </button>
        )
      })}
      {!compact && (
        <p className="mt-2 rounded border border-white/10 bg-white/[0.03] px-3 py-2 text-[10px] leading-relaxed text-slate-500">
          Section navigation is not connected on this legacy route — these buttons are disabled.
        </p>
      )}
    </nav>
  )
}

export function Sidebar() {
  // Section navigation is not connected on this legacy route; buttons are
  // disabled, so there is no selection state to update.
  const active = 'overview'
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <div className="flex flex-col md:contents">
      {/* Mobile top bar */}
      <div className="flex items-center justify-between border-b border-white/10 bg-slate-950/70 px-3 py-2 backdrop-blur-xl md:hidden">
        <span className="text-[10px] font-semibold uppercase tracking-[0.35em] text-[#d4af37]">
          War Room OS
        </span>
        <button
          type="button"
          className="rounded-md border border-white/15 px-3 py-1.5 text-xs uppercase tracking-widest text-slate-200 transition hover:border-[#d4af37]/50 hover:text-[#d4af37]"
          onClick={() => setDrawerOpen(true)}
          aria-expanded={drawerOpen}
        >
          Menu
        </button>
      </div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="absolute left-0 top-0 flex h-full w-[min(280px,88vw)] flex-col border-r border-white/10 bg-slate-950/90 shadow-[8px_0_40px_-12px_rgba(56,189,248,0.4)] backdrop-blur-xl">
            <div className="border-b border-white/10 px-4 py-3 text-xs uppercase tracking-[0.3em] text-slate-400">
              Navigation
            </div>
            <NavButtons active={active} />
            <div className="mt-auto border-t border-white/10 p-4 text-[10px] text-slate-500">
              Legacy demo route — simulated placeholder data
            </div>
          </aside>
        </div>
      )}

      {/* Desktop / tablet: icon rail md, expanded lg */}
      <aside className="relative hidden h-full w-56 shrink-0 flex-col border-r border-white/10 bg-slate-950/55 shadow-[4px_0_32px_-16px_rgba(56,189,248,0.25)] backdrop-blur-xl lg:flex lg:flex-col">
        <div className="border-b border-white/10 px-4 py-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.35em] text-[#d4af37]">War Room</p>
          <p className="mt-1 text-[10px] uppercase tracking-widest text-slate-500">Command surface</p>
        </div>
        <NavButtons active={active} />
        <div className="mt-auto border-t border-white/10 p-4 text-[10px] text-slate-500">Legacy demo route</div>
      </aside>

      <aside className="relative hidden h-full w-16 shrink-0 flex-col border-r border-white/10 bg-slate-950/55 backdrop-blur-xl md:flex md:flex-col lg:hidden">
        <NavButtons active={active} compact />
      </aside>
    </div>
  )
}
