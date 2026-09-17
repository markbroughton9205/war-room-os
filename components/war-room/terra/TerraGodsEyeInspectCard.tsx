'use client'

import { useMemo } from 'react'
import type { GodsEyeInspectCardModel, GodsEyeInspectSectionId } from '@/lib/terra/godsEye/inspect'
import { inspectFeatureLabel } from '@/lib/terra/godsEye/inspect'

const SECTION_ORDER: GodsEyeInspectSectionId[] = ['IDENTITY', 'LOCATION', 'URBAN', 'MOBILITY', 'STREET', 'LIVE_INTEL', 'PROVENANCE']

export function TerraGodsEyeInspectCard({
  model,
  onClose,
  onPin,
  onOpenStreetIntelligence,
  onOpenStreetView,
  onFlyTo,
  onMakeActive,
  onSendToCouncil,
  canSendToCouncil,
  onRefresh,
  onOpenSource,
  hidePreview,
}: {
  model: GodsEyeInspectCardModel | null
  onClose: () => void
  onPin: () => void
  onOpenStreetIntelligence?: () => void
  onOpenStreetView?: () => void
  onFlyTo?: () => void
  onMakeActive?: () => void
  onSendToCouncil?: () => void
  canSendToCouncil?: boolean
  onRefresh?: () => void
  onOpenSource?: () => void
  hidePreview?: boolean
}) {
  const visibleSections = useMemo(() => {
    if (!model) return []
    return SECTION_ORDER.filter(section => (model.sections[section] ?? []).length > 0)
  }, [model])

  if (!model) return null

  return (
    <aside
      className="pointer-events-auto w-[min(22rem,86vw)] overflow-hidden rounded-xl border border-cyan-300/35 bg-black/72 shadow-[0_16px_48px_rgba(0,0,0,0.5)] backdrop-blur-xl"
      data-testid="gods-eye-inspect-card"
      data-pinned={model.pinned ? 'true' : 'false'}
    >
      <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-200">
          {inspectFeatureLabel(model.featureClass)}
        </p>
        <div className="flex items-center gap-1">
          {onFlyTo ? (
            <button type="button" onClick={onFlyTo} className="rounded border border-emerald-400/40 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-emerald-300 hover:text-emerald-200">
              {model.featureClass === 'street_camera' ? 'GO TO LOCATION' : 'fly to'}
            </button>
          ) : null}
          {onMakeActive ? (
            <button type="button" onClick={onMakeActive} className="rounded border border-cyan-300/40 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-cyan-200 hover:text-cyan-100" data-testid="terra-make-active-location">
              MAKE ACTIVE LOCATION
            </button>
          ) : null}
          {onSendToCouncil ? (
            <button type="button" onClick={onSendToCouncil} disabled={!canSendToCouncil} className="rounded border border-cyan-300/40 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-cyan-200 disabled:border-white/10 disabled:text-slate-600">
              {model.featureClass === 'street_camera' ? 'SEND TO COUNCIL' : 'send to council'}
            </button>
          ) : null}
          {onRefresh && model.featureClass === 'street_camera' ? (
            <button type="button" onClick={onRefresh} className="rounded border border-white/15 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-slate-300 hover:text-cyan-200">
              REFRESH
            </button>
          ) : null}
          {onOpenSource && model.featureClass === 'street_camera' ? (
            <button type="button" onClick={onOpenSource} className="rounded border border-white/15 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-slate-300 hover:text-cyan-200">
              SOURCE
            </button>
          ) : null}
          {onOpenStreetView ? (
            <button type="button" onClick={onOpenStreetView} className="rounded border border-cyan-300/40 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-cyan-200 hover:text-cyan-100" data-testid="inspect-street-view">
              STREET VIEW
            </button>
          ) : null}
          {onOpenStreetIntelligence ? (
            <button type="button" onClick={onOpenStreetIntelligence} className="rounded border border-white/15 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-slate-300 hover:text-cyan-200">
              street intel
            </button>
          ) : null}
          <button type="button" onClick={onPin} className={`rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-widest ${model.pinned ? 'border-cyan-300/50 text-cyan-200' : 'border-white/15 text-slate-400'}`}>
            {model.pinned ? 'pinned' : 'pin'}
          </button>
          <button type="button" onClick={onClose} className="rounded border border-white/15 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-slate-400 hover:text-slate-200">
            close
          </button>
        </div>
      </div>
      <div className="border-t border-white/10 px-2.5 py-2">
        <p className="text-[12px] font-semibold text-slate-100">{model.title}</p>
        <p className="mt-0.5 font-mono text-[10px] text-slate-400">{model.identity}</p>
        <ul className="mt-1.5 space-y-0.5 font-mono text-[10px] text-slate-400">
          {model.latitude !== null && model.longitude !== null ? (
            <li>{model.latitude.toFixed(5)}, {model.longitude.toFixed(5)}</li>
          ) : null}
          <li>source {model.source}</li>
          <li>coverage {model.coverageState}</li>
          {model.timeZone ? <li>tz {model.timeZone}</li> : null}
          {model.localTime ? <li>local {model.localTime}</li> : <li>local time UNAVAILABLE</li>}
          {model.asyncEnrichPending ? <li className="text-cyan-300/80">enriching place context…</li> : null}
          {model.enrichError ? <li className="text-amber-300/90">enrich {model.enrichError}</li> : null}
        </ul>
        {!hidePreview && model.preview?.kind === 'still' && model.preview.href ? (
          // eslint-disable-next-line @next/next/no-img-element -- agency still, fetched only on inspect; not a Next-optimizable asset.
          <img src={model.preview.href} alt={`${model.title} traffic camera still`} className="mt-2 w-full rounded border border-white/10" />
        ) : null}
        {!hidePreview && model.preview?.kind === 'html_viewer' && model.preview.href ? (
          <a href={model.preview.href} target="_blank" rel="noreferrer" className="mt-2 block rounded border border-white/15 px-2 py-1 text-center text-[10px] font-bold uppercase tracking-widest text-cyan-300">
            OPEN OFFICIAL CAMERA VIEW
          </a>
        ) : null}
        {visibleSections.map(section => (
          <div key={section} className="mt-2 border-t border-white/10 pt-1.5">
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">{section.replaceAll('_', ' ')}</p>
            <ul className="mt-0.5 space-y-0.5 font-mono text-[10px] text-slate-400">
              {(model.sections[section] ?? []).map(field => (
                <li key={`${section}-${field.label}`} data-testid={`inspect-${section.toLowerCase()}-${field.label.replaceAll(' ', '-')}`}>
                  <span className="text-slate-500">{field.label} </span>
                  {field.value}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </aside>
  )
}
