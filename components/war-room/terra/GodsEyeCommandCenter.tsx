'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { TerraShell } from './TerraShell'
import { TerraActiveLocationProvider, useTerraActiveLocation } from './TerraActiveLocationContext'
import { resolveTerraLinkedStatus, type TerraLinkedStatusResult, type TerraLinkedStatusSignal } from '@/lib/terra/terraLinkedStatus'
import { IconCollapse, IconExpand, IconMinimize, IconRestore } from '@/components/war-room/council/CommandIcons'

/** Confidence label attached to every War Room INFERENCE line — derived, never observed. */
function inferenceConfidence(status: TerraLinkedStatusResult): string {
  if (status.level === 'NEUTRAL') return 'LOW — insufficient explicit evidence either way'
  return status.reasons.some(reason => reason.startsWith('OBSERVED:')) ? 'HIGH — grounded in source-reported facts' : 'MEDIUM — derived rule over observed values'
}

function TerraCouncilContextBridge({ onContextChange }: { onContextChange?: (context: string | null) => void }) {
  const { activeLocation, selectedEvent, layerCoverage } = useTerraActiveLocation()
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
        if (typeof p.isFullClosure === 'boolean') lines.push(`Full closure reported: ${p.isFullClosure}`)
      }
      // God's Eye Phase 2: same OBSERVED-only doctrine as the traffic_camera/traffic_event
      // branches above — real source fields only, no War Room-computed congestion/severity label.
      if (selectedEvent.kind === 'traffic_flow_observation') {
        const p = selectedEvent.properties
        if (typeof p.road === 'string') lines.push(`Flow site road: ${p.road}`)
        if (typeof p.direction === 'string') lines.push(`Direction: ${p.direction}`)
        if (typeof p.speedMph === 'number') lines.push(`Observed speed: ${p.speedMph} mph`)
        if (typeof p.vehicleFlowCount === 'number') lines.push(`Observed vehicle flow: ${p.vehicleFlowCount}`)
        lines.push('Free-flow baseline: not supplied by source (no congestion percentage computed)')
        lines.push('Data recency: HISTORICAL — this source\'s most recent available report lags real time; never live')
      }
      if (selectedEvent.kind === 'road_weather_observation') {
        const p = selectedEvent.properties
        if (typeof p.airTemperatureC === 'number') lines.push(`Air temperature: ${p.airTemperatureC}°C`)
        if (typeof p.roadSurfaceTemperatureC === 'number') lines.push(`Road surface temperature: ${p.roadSurfaceTemperatureC}°C`)
        if (typeof p.relativeHumidityPct === 'number') lines.push(`Relative humidity: ${p.relativeHumidityPct}%`)
        if (typeof p.visibilityKm === 'number') lines.push(`Visibility: ${p.visibilityKm} km`)
        if (typeof p.windAverageMs === 'number') lines.push(`Average wind: ${p.windAverageMs} m/s`)
        if (typeof p.precipitationIntensityMmH === 'number') lines.push(`Precipitation intensity: ${p.precipitationIntensityMmH} mm/h`)
      }
    }
    // Per-layer coverage truth: OBSERVED availability facts about each visible provider feed
    // (vocabulary: lib/terra/coverageTruth.ts). Availability only — never a condition verdict.
    const coverageEntries = Object.entries(layerCoverage ?? {})
    if (coverageEntries.length > 0) {
      lines.push('OBSERVED — Terra layer coverage:')
      for (const [layerId, state] of coverageEntries) {
        if (state) lines.push(`Layer ${layerId} coverage: ${state}`)
      }
    }
    // INFERENCE — clearly separated, War Room-computed only. The TERRA LINKED status resolution
    // (lib/terra/terraLinkedStatus.ts) is the one thing the War Room derives from the observed
    // facts above; it is labeled with conclusion, basis, and confidence, and is never blended
    // into the OBSERVED section. No other inference is computed or injected here.
    const status = resolveTerraLinkedStatus(terraLinkedSignals(selectedEvent, layerCoverage))
    lines.push('INFERENCE (War Room-derived, not provider-reported):')
    lines.push(`Conclusion: WAR ROOM TERRA LINKED = ${status.level}`)
    lines.push(`Basis: ${status.reasons.length > 0 ? status.reasons.join(' | ') : 'no qualifying evidence signal from the current selection or layer coverage'}`)
    lines.push(`Confidence: ${inferenceConfidence(status)}`)
    onContextChange?.(lines.join('\n'))
  }, [activeLocation, onContextChange, selectedEvent, layerCoverage])
  return null
}

// God's Eye Phase 2 → WAR ROOM TERRA LINKED final: evidence for the status model
// (lib/terra/terraLinkedStatus.ts) now combines (a) the currently-selected event and (b) every
// visible layer's coverage-truth state arriving via TerraActiveLocationContext.layerCoverage
// (additive optional field — graceful absent means "no per-layer evidence", today's behavior).
// Honest and additive: a NEUTRAL default (no selection, no coverage) is never upgraded to GREEN
// just because nothing is wrong — GREEN requires the model's own explicit positive-coverage
// evidence, which availability alone never manufactures.
function terraLinkedSignals(
  selectedEvent: ReturnType<typeof useTerraActiveLocation>['selectedEvent'],
  layerCoverage?: Partial<Record<string, import('@/lib/terra/coverageTruth').TerraCoverageTruthState>>,
): TerraLinkedStatusSignal[] {
  const signals: TerraLinkedStatusSignal[] = []
  if (selectedEvent) {
    const p = selectedEvent.properties
    if (selectedEvent.kind === 'traffic_event') {
      signals.push({ kind: 'traffic_event', severity: typeof p.severity === 'string' ? p.severity : null, isFullClosure: typeof p.isFullClosure === 'boolean' ? p.isFullClosure : null })
      if (typeof p.status === 'string') signals.push({ kind: 'source_status', status: p.status })
    }
    if (selectedEvent.kind === 'road_weather_observation') {
      signals.push({
        kind: 'road_weather',
        airTemperatureC: typeof p.airTemperatureC === 'number' ? p.airTemperatureC : null,
        roadSurfaceTemperatureC: typeof p.roadSurfaceTemperatureC === 'number' ? p.roadSurfaceTemperatureC : null,
        precipitationIntensityMmH: typeof p.precipitationIntensityMmH === 'number' ? p.precipitationIntensityMmH : null,
      })
    }
    if (selectedEvent.kind === 'traffic_camera' && typeof p.freshness === 'string') {
      const freshness = p.freshness as 'live_video' | 'still_image' | 'stale' | 'offline' | 'unknown'
      signals.push({ kind: 'camera_freshness', freshness })
    }
  }
  for (const state of Object.values(layerCoverage ?? {})) {
    if (state) signals.push({ kind: 'coverage', state })
  }
  return signals
}

const TERRA_LINKED_DOT_CLASS: Record<'RED' | 'AMBER' | 'GREEN' | 'NEUTRAL', string> = {
  RED: 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.9)]',
  AMBER: 'bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.9)]',
  GREEN: 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.9)]',
  NEUTRAL: 'bg-slate-400 shadow-[0_0_8px_rgba(148,163,184,0.6)]',
}

function ActiveTerraContextPill() {
  const { activeLocation, selectedEvent, layerCoverage } = useTerraActiveLocation()
  const status = useMemo(() => resolveTerraLinkedStatus(terraLinkedSignals(selectedEvent, layerCoverage)), [selectedEvent, layerCoverage])
  return (
    <div className="flex min-w-0 items-center gap-2 border-b border-white/10 bg-slate-950/90 px-3 py-1.5 text-[9px] backdrop-blur-xl">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TERRA_LINKED_DOT_CLASS[status.level]}`} title={status.reasons.join(' | ') || 'No evidence signal from the current selection'} />
      <span className="shrink-0 font-bold uppercase tracking-[0.18em] text-emerald-300">Terra linked</span>
      <span className="truncate text-slate-400" title={activeLocation?.label ?? 'No active globe selection'}>
        {selectedEvent?.title ?? activeLocation?.label ?? 'Select a place or live marker to add context'}
      </span>
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
              <div className="flex items-center gap-1"><button type="button" onClick={() => setChatMode(chatMode === 'expanded' ? 'compact' : 'expanded')} className="grid h-7 w-7 place-items-center rounded-full text-slate-300 hover:bg-white/10" aria-label={chatMode === 'expanded' ? 'Restore compact Council chat' : 'Expand Council chat'} title={chatMode === 'expanded' ? 'Restore compact view' : 'Expand chat'}>{chatMode === 'expanded' ? <IconCollapse /> : <IconExpand />}</button><button type="button" onClick={() => setChatMode(chatMode === 'minimized' ? 'compact' : 'minimized')} className="grid h-7 w-7 place-items-center rounded-full text-slate-300 hover:bg-white/10" aria-label={chatMode === 'minimized' ? 'Open Council chat' : 'Minimize Council chat'} title={chatMode === 'minimized' ? 'Open chat' : 'Minimize chat'}>{chatMode === 'minimized' ? <IconRestore /> : <IconMinimize />}</button></div>
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
