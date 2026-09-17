'use client'

import type { MediaStation } from '@/lib/media/types'

const PLATE: Record<string, { bg: string; fg: string; accent: string }> = {
  'oh-waps': { bg: '#05070a', fg: '#f8fafc', accent: '#67e8f9' },
  'oh-wjcu': { bg: '#1a0a0e', fg: '#fda4af', accent: '#fb7185' },
  'oh-wksu': { bg: '#071018', fg: '#f8fafc', accent: '#38bdf8' },
  'oh-wclv': { bg: '#0b0a12', fg: '#f8fafc', accent: '#fbbf24' },
  'oh-jazzneo': { bg: '#0a0810', fg: '#f5d0fe', accent: '#a78bfa' },
  'oh-folk-alley': { bg: '#0a100c', fg: '#bbf7d0', accent: '#4ade80' },
  'oh-wnir': { bg: '#101010', fg: '#cbd5e1', accent: '#64748b' },
  'oh-wtam': { bg: '#140808', fg: '#fecaca', accent: '#f87171' },
  'oh-wmms': { bg: '#140c08', fg: '#fdba74', accent: '#fb923c' },
  'oh-wknr': { bg: '#101010', fg: '#94a3b8', accent: '#64748b' },
}

export function StationArt({
  station,
  size = 'md',
  live = false,
}: {
  station: MediaStation | null
  size?: 'sm' | 'md' | 'lg'
  live?: boolean
}) {
  const px = size === 'lg' ? 108 : size === 'md' ? 72 : 40
  const plate = station ? PLATE[station.id] : null

  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-xl border"
      style={{
        width: px,
        height: px,
        borderColor: plate ? `${plate.accent}66` : 'rgba(148,163,184,0.2)',
        background: plate?.bg ?? 'rgba(2,8,14,0.9)',
        color: plate?.fg ?? '#94a3b8',
        boxShadow: live ? `0 0 18px ${plate?.accent ?? '#34d399'}44` : 'none',
      }}
      aria-hidden="true"
    >
      <IdentityMark station={station} size={size} />
    </div>
  )
}

function IdentityMark({
  station,
  size,
}: {
  station: MediaStation | null
  size: 'sm' | 'md' | 'lg'
}) {
  const id = station?.id ?? ''
  const freq = station?.frequency?.replace(' FM', '').replace(' AM', '') ?? ''
  const call = station?.callSign ?? '—'
  const stacked = size !== 'sm'

  if (id === 'oh-waps') {
    return (
      <div className="relative flex h-full w-full flex-col items-center justify-center">
        <svg viewBox="0 0 64 64" className="absolute inset-0 h-full w-full text-white/35" fill="none">
          <path d="M32 6v34" stroke="currentColor" strokeWidth="2.4" />
          <path d="M22 44 32 6l10 38" stroke="currentColor" strokeWidth="2" />
          <path d="M18 44h28" stroke="currentColor" strokeWidth="2" />
          <path d="M24 30h16" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="32" cy="6" r="2.2" fill="currentColor" />
        </svg>
        <span className={`relative z-10 font-bold tracking-[0.18em] ${size === 'lg' ? 'text-[11px]' : 'text-[8px]'}`}>
          {freq}
        </span>
        <span className={`relative z-10 font-black uppercase leading-none tracking-tight ${size === 'lg' ? 'text-[18px]' : size === 'md' ? 'text-[12px]' : 'text-[8px]'}`}>
          WAPS
        </span>
      </div>
    )
  }

  if (id === 'oh-jazzneo') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center leading-none">
        <span className={`font-black tracking-tight text-fuchsia-300 ${size === 'lg' ? 'text-[15px]' : size === 'md' ? 'text-[11px]' : 'text-[7px]'}`}>
          JAZZ
        </span>
        <span className={`font-black tracking-tight text-violet-200 ${size === 'lg' ? 'text-[15px]' : size === 'md' ? 'text-[11px]' : 'text-[7px]'}`}>
          NEO
        </span>
      </div>
    )
  }

  if (id === 'oh-folk-alley') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center leading-none">
        <span className={`font-black tracking-tight ${size === 'lg' ? 'text-[13px]' : size === 'md' ? 'text-[10px]' : 'text-[6px]'}`}>
          FOLK
        </span>
        <span className={`font-black tracking-tight ${size === 'lg' ? 'text-[13px]' : size === 'md' ? 'text-[10px]' : 'text-[6px]'}`}>
          ALLEY
        </span>
      </div>
    )
  }

  if (id === 'oh-wclv') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center leading-none">
        <span className={`font-black tracking-tight ${size === 'lg' ? 'text-[20px]' : size === 'md' ? 'text-[14px]' : 'text-[8px]'}`}>
          WCLV
        </span>
      </div>
    )
  }

  if (id === 'oh-wksu') {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <span className={`font-black lowercase tracking-tight ${size === 'lg' ? 'text-[20px]' : size === 'md' ? 'text-[13px]' : 'text-[8px]'}`}>
          wksu
        </span>
      </div>
    )
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center px-1 text-center">
      {freq && stacked ? (
        <span className="text-[9px] font-bold leading-none tracking-widest opacity-80">{freq}</span>
      ) : null}
      <span
        className={`font-black uppercase leading-none tracking-tight ${
          size === 'lg' ? 'text-[15px]' : size === 'md' ? 'text-[11px]' : 'text-[8px]'
        }`}
      >
        {call}
      </span>
    </div>
  )
}

export function LiveWaveform({ active }: { active: boolean }) {
  const bars = [8, 14, 22, 11, 18, 26, 13, 20, 9, 17, 24, 12, 19, 27, 10, 16, 23, 14, 21, 8, 15, 22, 11, 18]
  return (
    <div className="flex h-7 items-end gap-px" aria-hidden="true" data-testid="media-waveform">
      {bars.map((height, index) => (
        <span
          key={index}
          className={active ? 'wr-media-eq-bar w-[3px] rounded-full bg-emerald-400/85' : 'w-[3px] rounded-full bg-slate-700'}
          style={{
            height,
            animationDelay: active ? `${index * 38}ms` : undefined,
            animationDuration: active ? `${0.7 + (index % 5) * 0.08}s` : undefined,
          }}
        />
      ))}
    </div>
  )
}

export function MiniEq({ active }: { active: boolean }) {
  const bars = [7, 13, 9, 16, 8]
  return (
    <span className="flex h-4 items-end gap-px" aria-hidden="true">
      {bars.map((height, index) => (
        <span
          key={index}
          className={active ? 'wr-media-eq-bar w-[2px] rounded-full bg-cyan-300' : 'w-[2px] rounded-full bg-slate-700'}
          style={{
            height,
            animationDelay: active ? `${index * 70}ms` : undefined,
          }}
        />
      ))}
    </span>
  )
}
