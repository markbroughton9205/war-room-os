'use client'

import { memo, useEffect, useMemo, useState } from 'react'
import type { ConversationRuntimeSnapshot } from '@/lib/conversation-runtime/types'

type FamilyPresence = { status: string; label: string }

type PanelRenderEvent = {
  id: string
  label: string
  at: number
}

export type AmbientActivityFeedProps = {
  familyPresence: Record<string, FamilyPresence>
  typingFamily: string | null
  runtime: ConversationRuntimeSnapshot | null
  scoutStatus?: string
  incomeWorkerStatus?: string
}

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function presenceLine(name: string, presence: FamilyPresence): string | null {
  if (presence.status === 'typing' || presence.status === 'responding') {
    return `${name}: ${presence.label}`
  }
  if (presence.status === 'error') return `${name}: ${presence.label}`
  return null
}

export const AmbientActivityFeed = memo(function AmbientActivityFeed({
  familyPresence,
  typingFamily,
  runtime,
  scoutStatus,
  incomeWorkerStatus,
}: AmbientActivityFeedProps) {
  const [panelEvents, setPanelEvents] = useState<PanelRenderEvent[]>([])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<PanelRenderEvent>).detail
      if (!detail?.id) return
      setPanelEvents(prev => [{ ...detail, at: detail.at || Date.now() }, ...prev].slice(0, 6))
    }
    window.addEventListener('war-room-panel-render', handler)
    return () => window.removeEventListener('war-room-panel-render', handler)
  }, [])

  const lines = useMemo(() => {
    const out: { key: string; text: string; tone: 'active' | 'idle' | 'warn' }[] = []

    if (typingFamily) {
      const p = familyPresence[typingFamily]
      out.push({
        key: 'typing',
        text: p ? `${typingFamily} — ${p.label}` : `${typingFamily} — responding`,
        tone: 'active',
      })
    }

    for (const [name, presence] of Object.entries(familyPresence)) {
      const line = presenceLine(name, presence)
      if (line && name !== typingFamily) {
        out.push({ key: `presence-${name}`, text: line, tone: presence.status === 'error' ? 'warn' : 'active' })
      }
    }

    if (runtime?.latestSynthesis) {
      out.push({
        key: 'synthesis',
        text: `Synthesis: ${runtime.latestSynthesis.slice(0, 120)}${runtime.latestSynthesis.length > 120 ? '…' : ''}`,
        tone: 'active',
      })
    } else if (runtime?.councilMomentum && runtime.councilMomentum !== 'idle') {
      out.push({
        key: 'momentum',
        text: `Council momentum: ${runtime.councilMomentum}${runtime.activeTopic ? ` · ${runtime.activeTopic.slice(0, 80)}` : ''}`,
        tone: 'active',
      })
    }

    if (scoutStatus && scoutStatus !== 'idle') {
      out.push({ key: 'scout', text: `Opportunity scout: ${scoutStatus}`, tone: 'active' })
    }
    if (incomeWorkerStatus && incomeWorkerStatus !== 'idle') {
      out.push({ key: 'income-worker', text: `Income workers: ${incomeWorkerStatus}`, tone: 'active' })
    }

    for (const ev of panelEvents.slice(0, 3)) {
      out.push({
        key: `panel-${ev.id}-${ev.at}`,
        text: `${ev.label} rendered ${formatTime(ev.at)}`,
        tone: 'idle',
      })
    }

    if (out.length === 0) {
      out.push({
        key: 'idle',
        text: runtime
          ? `Operational idle · topic ${runtime.activeTopic || 'none'} · last activity ${formatTime(runtime.lastActivityAt)}`
          : 'Operational idle · awaiting runtime snapshot',
        tone: 'idle',
      })
    }

    return out.slice(0, 8)
  }, [familyPresence, typingFamily, runtime, scoutStatus, incomeWorkerStatus, panelEvents])

  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[9px] tracking-wide" aria-label="Ambient operational activity">
      {lines.map(line => (
        <li
          key={line.key}
          className={
            line.tone === 'active'
              ? 'text-emerald-300/90'
              : line.tone === 'warn'
                ? 'text-amber-300/90'
                : 'text-slate-500'
          }
        >
          {line.text}
        </li>
      ))}
    </ul>
  )
})
