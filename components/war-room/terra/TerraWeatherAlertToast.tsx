'use client'

import { weatherRelativeAge, type WeatherToastCandidate } from '@/lib/terra/weather'

export function TerraWeatherAlertToast({
  toast,
  nowIso,
  onView,
  onDismiss,
  onMute,
}: {
  toast: WeatherToastCandidate
  nowIso: string
  onView: () => void
  onDismiss: () => void
  onMute: () => void
}) {
  const alert = toast.alert
  const age = weatherRelativeAge(alert.sent ?? alert.effective ?? alert.onset, nowIso)
  return (
    <aside
      className="pointer-events-auto w-[min(22rem,92vw)] rounded-xl border border-amber-300/35 bg-black/80 p-3 shadow-[0_16px_48px_rgba(0,0,0,0.55)] backdrop-blur-xl"
      data-testid="terra-weather-alert-toast"
      data-weather-alert-id={alert.id}
      data-weather-toast-kind={toast.kind}
      role="status"
    >
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-200">Weather Alert</p>
      <p className="mt-1 text-[13px] font-semibold text-slate-100">{alert.event ?? alert.headline ?? 'NWS alert'}</p>
      <p className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-amber-100">
        {alert.severity ?? 'UNKNOWN'} · {alert.areaDesc ?? 'UNKNOWN area'}
      </p>
      <p className="mt-1 text-[10px] text-slate-400">{age} · source NWS{toast.kind === 'updated' ? ' · updated' : ''}</p>
      <div className="mt-2 flex flex-wrap gap-1">
        <button type="button" onClick={onView} className="rounded border border-cyan-300/40 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-cyan-200" data-testid="terra-weather-alert-view">View</button>
        <button type="button" onClick={onDismiss} className="rounded border border-white/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-slate-300" data-testid="terra-weather-alert-dismiss">Dismiss</button>
        <button type="button" onClick={onMute} className="rounded border border-white/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-slate-500" data-testid="terra-weather-alert-mute">Mute weather alerts</button>
      </div>
    </aside>
  )
}
