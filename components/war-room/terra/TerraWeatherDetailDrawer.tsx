'use client'

import { NWS_ATTRIBUTION, type RadarCatalog, type RadarCoverageState, type RadarFrame, type WeatherAlert } from '@/lib/terra/weather'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex justify-between gap-3">
      <span className="shrink-0 uppercase tracking-widest text-slate-500">{label}</span>
      <span className="text-right text-slate-200">{value}</span>
    </li>
  )
}

function display(value: string | null | undefined): string {
  return value?.trim() ? value : 'UNKNOWN'
}

export function TerraWeatherDetailDrawer({
  alert,
  canSendToCouncil,
  onClose,
  onSendToCouncil,
  radar,
}: {
  alert: WeatherAlert
  canSendToCouncil?: boolean
  onClose: () => void
  onSendToCouncil: () => void
  radar?: {
    catalog: RadarCatalog
    state: RadarCoverageState
    frame: RadarFrame | null
    frameAge: string
    enabled: boolean
    onToggle: () => void
  }
}) {
  return (
    <aside
      className="pointer-events-auto w-[min(26rem,88vw)] max-h-[min(42rem,70vh)] overflow-hidden rounded-xl border border-amber-300/35 bg-black/80 shadow-[0_16px_48px_rgba(0,0,0,0.55)] backdrop-blur-xl"
      data-testid="terra-weather-detail-drawer"
      data-weather-alert-id={alert.id}
      data-weather-lifecycle={alert.lifecycle}
      data-weather-geometry={alert.geometryBasis}
    >
      <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-200">Weather</p>
        <div className="flex gap-1">
          <button
            type="button"
            disabled={!canSendToCouncil}
            onClick={onSendToCouncil}
            className="rounded border border-cyan-300/40 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-cyan-200 disabled:opacity-30"
            data-testid="terra-weather-send-to-council"
          >
            Send to Council
          </button>
          <button type="button" onClick={onClose} className="rounded border border-white/15 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-slate-400" data-testid="terra-weather-drawer-close">Close</button>
        </div>
      </div>
      <div className="max-h-[min(38rem,64vh)] overflow-y-auto border-t border-white/10 px-2.5 py-2">
        <p className="text-[13px] font-semibold text-slate-100">{alert.event ?? 'NWS alert'}</p>
        <p className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-amber-100">{alert.lifecycle} · {display(alert.severity)}</p>
        <p className="mt-2 text-[11px] leading-snug text-slate-300">{display(alert.headline)}</p>
        {alert.description ? <p className="mt-2 whitespace-pre-wrap text-[11px] leading-snug text-slate-400">{alert.description}</p> : null}
        {alert.instruction ? (
          <p className="mt-2 text-[11px] leading-snug text-amber-100/90">
            <span className="font-bold uppercase tracking-widest">Instruction. </span>
            {alert.instruction}
          </p>
        ) : null}
        <ul className="mt-3 space-y-0.5 font-mono text-[10px] text-slate-400">
          <Row label="severity" value={display(alert.severity)} />
          <Row label="urgency" value={display(alert.urgency)} />
          <Row label="certainty" value={display(alert.certainty)} />
          <Row label="status" value={display(alert.status)} />
          <Row label="area" value={display(alert.areaDesc)} />
          <Row label="effective" value={display(alert.effective)} />
          <Row label="onset" value={display(alert.onset)} />
          <Row label="ends" value={display(alert.ends)} />
          <Row label="expires" value={display(alert.expires)} />
          <Row label="sent" value={display(alert.sent)} />
          <Row label="updated" value={display(alert.updated)} />
          <Row label="retrieved" value={display(alert.retrievedAt)} />
          <Row label="geometry" value={alert.geometryBasis} />
          <Row label="source" value={display(alert.sourceUrl)} />
          <Row label="provider" value="NWS" />
          <Row label="provenance" value={NWS_ATTRIBUTION} />
        </ul>
        {radar ? (
          <div className="mt-3 border-t border-white/10 pt-2" data-testid="terra-weather-drawer-radar">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-100">Radar</p>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-slate-300">
              {radar.state} · MEASURED · not alert confirmation
            </p>
            <ul className="mt-1 space-y-0.5 font-mono text-[10px] text-slate-400">
              <Row label="provider" value={radar.catalog.providerName} />
              <Row label="product" value={radar.catalog.product} />
              <Row label="frame" value={radar.frame?.timestampIso ?? 'NONE'} />
              <Row label="age" value={radar.frameAge} />
            </ul>
            <button
              type="button"
              onClick={radar.onToggle}
              className="mt-2 rounded border border-cyan-300/30 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-cyan-100"
              data-testid="terra-weather-drawer-radar-toggle"
            >
              Radar {radar.enabled ? 'on' : 'off'}
            </button>
          </div>
        ) : null}
      </div>
    </aside>
  )
}
