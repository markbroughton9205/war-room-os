'use client'

import { memo, useEffect, useState } from 'react'

import { formatHeadlineMeta } from '@/lib/intelligence/ribbon/formatters'
import type { RibbonNewsHeadline } from '@/lib/intelligence/ribbon/types'

import { RibbonSegmentShell } from './RibbonSegmentShell'

const ROTATE_MS = 8_000

export const NewsTickerSegment = memo(function NewsTickerSegment({
  headlines,
  className = '',
}: {
  headlines: RibbonNewsHeadline[]
  className?: string
}) {
  const [index, setIndex] = useState(0)
  const [visible, setVisible] = useState(true)
  const current = headlines[index % Math.max(headlines.length, 1)]

  useEffect(() => {
    if (headlines.length <= 1) return
    const timer = window.setInterval(() => {
      setVisible(false)
      window.setTimeout(() => {
        setIndex(prev => (prev + 1) % headlines.length)
        setVisible(true)
      }, 320)
    }, ROTATE_MS)
    return () => window.clearInterval(timer)
  }, [headlines.length])

  const urgent = current?.urgency === 'urgent'

  return (
    <RibbonSegmentShell
      label="Live News"
      urgent={urgent}
      className={`min-w-[14rem] flex-[1.6] sm:min-w-[18rem] ${className}`}
      title={current ? `${current.headline} — ${formatHeadlineMeta(current)}` : undefined}
    >
      <HeadlineFade visible={visible} current={current} />
      {headlines.length > 1 ? (
        <div className="mt-1 flex gap-0.5 opacity-60">
          {headlines.slice(0, 6).map((h, i) => (
            <span
              key={h.id}
              className={`h-0.5 flex-1 rounded-full ${i === index % headlines.length ? 'bg-cyan-400' : 'bg-white/15'}`}
            />
          ))}
        </div>
      ) : null}
    </RibbonSegmentShell>
  )
})

function HeadlineFade({
  visible,
  current,
}: {
  visible: boolean
  current: RibbonNewsHeadline | undefined
}) {
  return (
    <div
      className={`transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`}
      aria-live="polite"
    >
      {current ? (
        <>
          <p className="line-clamp-2 text-sm font-semibold leading-snug text-slate-100">{current.headline}</p>
          <p className="mt-0.5 truncate text-[11px] font-normal text-slate-400">
            <span
              className={
                current.urgency === 'urgent'
                  ? 'text-red-300'
                  : current.urgency === 'elevated'
                    ? 'text-amber-300'
                    : 'text-slate-500'
              }
            >
              {current.urgency === 'urgent' ? 'Urgent · ' : current.urgency === 'elevated' ? 'Elevated · ' : ''}
            </span>
            {formatHeadlineMeta(current)}
          </p>
        </>
      ) : (
        <p className="text-slate-400">Gathering live briefing…</p>
      )}
    </div>
  )
}
