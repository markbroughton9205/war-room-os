'use client'

import { memo } from 'react'

import type { RibbonMarketsSlice } from '@/lib/intelligence/ribbon/types'

import { RibbonSegmentShell } from './RibbonSegmentShell'

const CLIMATE_LABEL: Record<RibbonMarketsSlice['climate'], string> = {
  'risk-on': 'Risk-on',
  'risk-off': 'Risk-off',
  'mixed volatility': 'Mixed volatility',
  'quiet session': 'Quiet session',
  unavailable: 'Limited',
}

export const MarketsSegment = memo(function MarketsSegment({ markets }: { markets: RibbonMarketsSlice }) {
  const climate =
    markets.climate !== 'unavailable' ? CLIMATE_LABEL[markets.climate] : null

  return (
    <RibbonSegmentShell
      label="Markets"
      title={markets.label}
      className="min-w-[12rem] sm:min-w-[14rem]"
    >
      {markets.status === 'available' && markets.quotes.length ? (
        <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] font-normal text-slate-300">
          {markets.quotes.map(q => (
            <span key={q.symbol} className="whitespace-nowrap">
              <span className="text-slate-500">{q.symbol}</span>{' '}
              <span className="text-slate-100">{q.price}</span>{' '}
              <span
                className={
                  q.direction === 'up'
                    ? 'text-emerald-400'
                    : q.direction === 'down'
                      ? 'text-red-400'
                      : 'text-slate-500'
                }
              >
                {q.movement}
              </span>
            </span>
          ))}
        </div>
      ) : (
        <p className="truncate text-slate-400">{markets.label}</p>
      )}
      {climate ? (
        <p className="mt-0.5 truncate text-[10px] font-normal uppercase tracking-wider text-slate-500">
          {climate}
          {markets.watchlistNote ? ` · ${markets.watchlistNote}` : ''}
        </p>
      ) : null}
    </RibbonSegmentShell>
  )
})
