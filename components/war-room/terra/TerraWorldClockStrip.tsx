'use client'

import { useMemo, useState } from 'react'
import type { TerraEarthIntelPanelSnapshot } from '@/lib/terra/liveIntelPanelModel'
import { TERRA_WORLD_CLOCK_CITIES, TERRA_WORLD_CLOCK_PIN_STORAGE_KEY } from '@/lib/terra/worldTime'

function loadPinned(): string[] | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(TERRA_WORLD_CLOCK_PIN_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed) || parsed.some(id => typeof id !== 'string')) return null
    return parsed
  } catch {
    return null
  }
}

const DEFAULT_PINNED = TERRA_WORLD_CLOCK_CITIES.map(city => city.id)

export function TerraWorldClockStrip({
  worldTime,
  worldClock,
}: {
  worldTime: TerraEarthIntelPanelSnapshot['worldTime']
  worldClock: TerraEarthIntelPanelSnapshot['worldClock']
}) {
  const [pinned, setPinned] = useState<string[]>(() => loadPinned() ?? DEFAULT_PINNED)
  const [adding, setAdding] = useState(false)

  const rows = useMemo(() => {
    const pinSet = new Set(pinned)
    return worldClock.filter(row => row.id === 'local' || pinSet.has(row.id))
  }, [worldClock, pinned])

  const unpinned = useMemo(() => {
    const pinSet = new Set(pinned)
    return worldClock.filter(row => row.id !== 'local' && !pinSet.has(row.id))
  }, [worldClock, pinned])

  const persist = (next: string[]) => {
    setPinned(next)
    try {
      window.localStorage.setItem(TERRA_WORLD_CLOCK_PIN_STORAGE_KEY, JSON.stringify(next))
    } catch {
      /* session-only if storage is blocked */
    }
  }

  return (
    <div data-testid="terra-world-clock-strip" className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-300">World time</span>
        <span className="font-mono text-[9px] uppercase text-cyan-300">{worldTime.coverageState}</span>
      </div>
      <p
        className="truncate text-[10px] text-cyan-100"
        title={[
          worldTime.label,
          worldTime.localDate,
          worldTime.timeZone,
          worldTime.utcOffset,
          worldTime.dstActive === true ? 'DST' : worldTime.dstActive === false ? 'standard time' : null,
          worldTime.dayNightState,
        ].filter(Boolean).join(' · ')}
      >
        {worldTime.label}
        {worldTime.localTime ? ` · ${worldTime.localTime}` : ''}
        {worldTime.utcOffset ? ` · ${worldTime.utcOffset}` : ''}
        {worldTime.dayNightState ? ` · ${worldTime.dayNightState}` : ''}
      </p>
      {!worldTime.timeZone ? (
        <p className="text-[9px] text-slate-600">No IANA zone for this Terra location yet — not invented.</p>
      ) : (
        <p className="truncate text-[9px] text-slate-500" title={worldTime.timeZone}>
          {worldTime.localDate}
          {worldTime.timeZone ? ` · ${worldTime.timeZone}` : ''}
          {worldTime.dstActive === true ? ' · DST' : worldTime.dstActive === false ? ' · standard' : ''}
        </p>
      )}
      <ul className="space-y-0.5">
        {rows.map(city => {
          const title = [
            city.nativeLabel && city.englishLabel && city.nativeLabel !== city.englishLabel
              ? `${city.nativeLabel} / ${city.englishLabel}`
              : city.label,
            city.localDate,
            city.timeZone,
            city.utcOffset,
            city.dstActive === true ? 'DST' : city.dstActive === false ? 'standard time' : null,
            city.dayNightState,
          ].filter(Boolean).join(' · ')
          const timeOnly = city.localTime?.replace(/\s[A-Z]{2,5}$/, '') ?? '—'
          return (
            <li key={city.id} className={`flex items-center justify-between gap-2 text-[10px] ${city.selected || city.id === 'local' ? 'text-cyan-200' : 'text-slate-400'}`} title={title}>
              <span className="min-w-0 truncate uppercase tracking-widest">{city.label}</span>
              <span className="flex shrink-0 items-center gap-1">
                <span className="font-mono text-slate-200">{timeOnly}</span>
                {city.dayNightState ? <span className="text-[8px] text-slate-500">{city.dayNightState}</span> : null}
                {city.id !== 'local' ? (
                  <button
                    type="button"
                    onClick={() => persist(pinned.filter(id => id !== city.id))}
                    title={`Unpin ${city.label}`}
                    className="px-0.5 text-[9px] text-slate-600 hover:text-slate-300"
                  >
                    ×
                  </button>
                ) : null}
              </span>
            </li>
          )
        })}
      </ul>
      {unpinned.length ? (
        adding ? (
          <ul className="flex flex-wrap gap-1">
            {unpinned.map(city => (
              <li key={city.id}>
                <button
                  type="button"
                  onClick={() => {
                    persist([...pinned, city.id])
                    setAdding(false)
                  }}
                  className="rounded border border-white/10 px-1 py-0.5 text-[8px] uppercase tracking-widest text-slate-400 hover:text-cyan-200"
                >
                  Pin {city.label}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-[8px] uppercase tracking-widest text-slate-600 hover:text-slate-400"
          >
            Pin city
          </button>
        )
      ) : null}
    </div>
  )
}
