'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { TerraShell } from './TerraShell'
import { TerraActiveLocationProvider, useTerraActiveLocation } from './TerraActiveLocationContext'
import { CouncilRuntimeStatus } from '@/components/war-room/council/CouncilRuntimeStatus'
import { CouncilGodsEyeStatus } from '@/components/war-room/council/CouncilGodsEyeStatus'
import type { TerraIntelligenceEventKind } from '@/lib/terra/types'

/** Short, human labels for the "War Room Terra Linked" pill -- covers every selectable Terra
 * object kind (location search, vessel, aircraft, traffic camera/event, and the rest of the
 * catalog) so the Commander always knows what kind of thing is currently selected, not just its
 * name. Falls back to the raw kind string for any future kind added to the catalog. */
const TERRA_SELECTION_KIND_LABEL: Partial<Record<TerraIntelligenceEventKind, string>> = {
  vessel_position: 'VESSEL',
  aircraft_state: 'AIRCRAFT',
  traffic_camera: 'CAMERA',
  traffic_event: 'ROAD EVENT',
  earthquake: 'EARTHQUAKE',
  tropical_cyclone: 'STORM',
  wildfire_incident: 'WILDFIRE',
  volcano_event: 'VOLCANO',
  flood_event: 'FLOOD',
  severe_weather_alert: 'WEATHER ALERT',
  tsunami_alert: 'TSUNAMI ALERT',
}

function TerraCouncilContextBridge({ onContextChange }: { onContextChange?: (context: string | null) => void }) {
  const { activeLocation, selectedEvent } = useTerraActiveLocation()
  useEffect(() => {
    if (!activeLocation) return onContextChange?.(null)
    const lines = [
      `Active Terra location: ${activeLocation.label}`,
      `Coordinates: ${activeLocation.latitude.toFixed(5)}, ${activeLocation.longitude.toFixed(5)}`,
      `Location provenance: ${activeLocation.sourceLabel}`,
      `Location availability: ${activeLocation.status}`,
    ]
    if (selectedEvent) {
      lines.push(`OBSERVED:`)
      lines.push(`Selected Terra event: ${selectedEvent.title}`)
      lines.push(`Event provider id: ${selectedEvent.providerId}`)
      lines.push(`Event observed at: ${selectedEvent.timestamp ?? 'not reported'}`)
      // God's Eye Traffic & Camera Intelligence phase: only real, provider-supplied facts — never
      // a War Room-generated inference — reach Council here. Any analysis (e.g. "congestion is
      // consistent with the reported collision") is Council's own job to produce and label as
      // INFERENCE in its response, per mission doctrine; this bridge never pre-computes or injects
      // one.
      if (selectedEvent.kind === 'traffic_camera') {
        const p = selectedEvent.properties
        if (typeof p.road === 'string') lines.push(`Camera road: ${p.road}`)
        if (typeof p.direction === 'string') lines.push(`Camera direction: ${p.direction}`)
        lines.push(`Camera feed type: still image`)
        if (typeof p.freshness === 'string') lines.push(`Camera freshness: ${p.freshness}`)
      }
      if (selectedEvent.kind === 'traffic_event') {
        const p = selectedEvent.properties
        if (typeof p.eventType === 'string') lines.push(`Event type: ${p.eventType}`)
        if (typeof p.severity === 'string') lines.push(`Event severity (source-reported): ${p.severity}`)
        if (typeof p.status === 'string') lines.push(`Event status: ${p.status}`)
        if (typeof p.road === 'string') lines.push(`Event road: ${p.road}`)
      }
    }
    onContextChange?.(lines.join('\n'))
  }, [activeLocation, onContextChange, selectedEvent])
  return null
}

function ActiveTerraContextPill() {
  const { activeLocation, selectedEvent } = useTerraActiveLocation()
  const kindLabel = selectedEvent ? TERRA_SELECTION_KIND_LABEL[selectedEvent.kind] : null
  const contextText = selectedEvent?.title ?? activeLocation?.label ?? 'Select a place or live marker to add context'
  return (
    <div className="flex min-w-0 items-center gap-2 border-b border-white/10 bg-slate-950/90 px-3 py-1.5 text-[9px] backdrop-blur-xl">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.9)]" />
      <span className="shrink-0 font-bold uppercase tracking-[0.18em] text-emerald-300">War Room Terra Linked</span>
      <CouncilGodsEyeStatus />
      {kindLabel ? (
        <span className="shrink-0 rounded border border-cyan-400/30 px-1 text-[8px] font-bold tracking-widest text-cyan-300">
          {kindLabel}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate text-slate-400" title={activeLocation?.label ?? 'No active globe selection'}>
        {contextText}
      </span>
      <CouncilRuntimeStatus />
    </div>
  )
}

export function GodsEyeCommandCenter({ council, councilComposer, intelOverlay, onTerraContextChange }: { council: ReactNode; councilComposer?: ReactNode; intelOverlay?: ReactNode; onTerraContextChange?: (context: string | null) => void }) {
  const [chatMode, setChatMode] = useState<'minimized' | 'compact' | 'expanded'>('compact')
  const [intelOpen, setIntelOpen] = useState(false)
  return (
    <TerraActiveLocationProvider>
      <TerraCouncilContextBridge onContextChange={onTerraContextChange} />
      <section className="relative h-full min-h-0 overflow-hidden bg-black" data-testid="gods-eye-command-center">
        <TerraShell presentation="command-center" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_44%,transparent_46%,rgba(0,0,0,0.38)_100%)]" aria-hidden="true" />
        {intelOverlay ? <div className="absolute right-3 top-16 z-30 flex max-w-[calc(100%-1.5rem)] flex-col items-end gap-2">
          <button type="button" onClick={() => setIntelOpen(value => !value)} className="rounded-full border border-cyan-300/30 bg-slate-950/85 px-3 py-2 text-[9px] font-bold uppercase tracking-[0.2em] text-cyan-200 shadow-xl backdrop-blur-xl" aria-expanded={intelOpen}>◉ Live globe intel {intelOpen ? '−' : '+'}</button>
          {intelOpen ? <div className="w-[min(54rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-cyan-300/20 bg-black/80 shadow-2xl backdrop-blur-xl">{intelOverlay}</div> : null}
        </div> : null}
        <div className={`pointer-events-none absolute z-40 transition-all duration-200 ${chatMode === 'expanded' ? 'inset-2 sm:inset-4' : 'bottom-3 right-3 w-[min(25rem,calc(100%-1.5rem))]'}`}>
          <div className={`pointer-events-auto flex min-h-0 flex-col overflow-hidden rounded-2xl border border-emerald-300/25 bg-[rgba(3,10,16,0.94)] shadow-[0_24px_80px_rgba(0,0,0,0.72)] backdrop-blur-2xl ${chatMode === 'minimized' ? 'h-12' : chatMode === 'expanded' ? 'h-full' : 'h-[min(34rem,62dvh)]'}`} data-testid="floating-council-chat">
            <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-white/10 px-3">
              <div className="flex min-w-0 items-center gap-2"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-emerald-300/35 bg-emerald-400/10 text-xs text-emerald-200">⌁</span><div className="min-w-0"><p className="truncate text-[11px] font-bold tracking-wide text-white">Council</p><p className="flex items-center gap-1 text-[8px] uppercase tracking-[0.16em] text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> connected to Terra</p></div></div>
              <div className="flex items-center gap-1"><button type="button" onClick={() => setChatMode(chatMode === 'expanded' ? 'compact' : 'expanded')} className="grid h-7 w-7 place-items-center rounded-full text-slate-300 hover:bg-white/10" aria-label={chatMode === 'expanded' ? 'Restore compact Council chat' : 'Expand Council chat'}>{chatMode === 'expanded' ? '↘' : '↗'}</button><button type="button" onClick={() => setChatMode(chatMode === 'minimized' ? 'compact' : 'minimized')} className="grid h-7 w-7 place-items-center rounded-full text-slate-300 hover:bg-white/10" aria-label={chatMode === 'minimized' ? 'Open Council chat' : 'Minimize Council chat'}>{chatMode === 'minimized' ? '↑' : '−'}</button></div>
            </div>
            {chatMode !== 'minimized' ? <><ActiveTerraContextPill /><div className="min-h-0 flex-1">{council}</div>{councilComposer ? <div className="shrink-0 border-t border-white/10">{councilComposer}</div> : null}</> : null}
          </div>
        </div>
        <Link href="/terra" className="absolute bottom-3 left-3 z-30 rounded-full border border-cyan-400/35 bg-black/75 px-3 py-2 text-[9px] font-bold uppercase tracking-widest text-cyan-300 backdrop-blur-sm">
          Open full Terra workspace ↗
        </Link>
      </section>
    </TerraActiveLocationProvider>
  )
}
