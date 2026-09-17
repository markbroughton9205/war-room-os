'use client'

import { GODS_EYE_ACTIVATION_STATE, GODS_EYE_COVERAGE_MATRIX, GODS_EYE_LAYER_GROUPS } from '@/lib/terra/godsEyeCoverageMatrix'
import { GODS_EYE_ZOOM_LADDER } from '@/lib/terra/godsEye/zoomLadder'
import { GODS_EYE_OWNERSHIP_MATRIX } from '@/lib/terra/godsEye/ownership'
import { GODS_EYE_DETAIL_COVERAGE } from '@/lib/terra/godsEye/detailCoverage'
import { trafficCameraProviderHealth, globalTrafficCameraCoverage, type TrafficCameraRuntimeEvidence } from '@/lib/terra/godsEye/cameraHealth'
import { GODS_EYE_SUCCESS_PATH, GODS_EYE_RESEARCH_INCORPORATED } from '@/lib/terra/godsEye/researchIncorporation'
import { TerraInspectDetails } from './TerraInspectDetails'

const SCOPE_COLOR: Record<string, string> = {
  GLOBAL: 'text-emerald-400',
  REGIONAL: 'text-cyan-300',
  LOCAL: 'text-sky-300',
  PARTIAL: 'text-amber-300',
  NO_COVERAGE: 'text-slate-500',
  AUTH_REQUIRED: 'text-amber-400',
}

const MODE_COLOR: Record<string, string> = {
  LIVE: 'text-emerald-400',
  STATIC: 'text-slate-200',
  CACHED: 'text-cyan-300',
  STALE: 'text-amber-300',
  PARTIAL: 'text-amber-300',
  AUTH_REQUIRED: 'text-amber-400',
  PROVIDER_AUTH_REQUIRED: 'text-amber-400',
  NO_COVERAGE: 'text-slate-500',
  NONE_WITHIN_RADIUS: 'text-amber-300',
  UNAVAILABLE: 'text-slate-500',
  LIVE_EMPTY: 'text-slate-400',
  CATALOG_LIVE: 'text-cyan-300',
  UNKNOWN: 'text-slate-400',
  UNPROBED: 'text-slate-500',
  NONE: 'text-slate-500',
}

const OWNERSHIP_COLOR: Record<string, string> = {
  OWNED: 'text-emerald-300',
  SELF_HOSTABLE: 'text-cyan-300',
  STREAM_ONLY: 'text-slate-400',
  RESEARCH_ONLY: 'text-amber-300',
  LICENSE_RESTRICTED: 'text-amber-400',
  AUTH_REQUIRED: 'text-amber-400',
  PAID: 'text-rose-300',
  NONCOMMERCIAL: 'text-amber-300',
}

export function TerraGodsEyeCoverageMatrix({ zoomRung, cameraRuntime }: { zoomRung?: string; cameraRuntime?: readonly TrafficCameraRuntimeEvidence[] }) {
  const cameras = trafficCameraProviderHealth(cameraRuntime)
  return (
    <TerraInspectDetails
      title="God's Eye coverage"
      badge={<span className="font-mono uppercase text-amber-300/90">{GODS_EYE_ACTIVATION_STATE.replaceAll('_', ' ')}</span>}
    >
      <p className="mb-2 text-[10px] leading-snug text-slate-500">
        Not fully active. This matrix is what is actually live, static, partial, or unavailable — never a claim that every class is globally live.
      </p>
      <p className="mb-2 text-[9px] leading-snug text-cyan-300/80" data-testid="gods-eye-research-incorporated">
        {GODS_EYE_RESEARCH_INCORPORATED.replaceAll('_', ' ')}
      </p>
      <div data-testid="gods-eye-zoom-ladder" className="mb-2 rounded border border-white/10 bg-black/30 px-2 py-1.5">
        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Zoom ladder</p>
        <p className="mt-0.5 font-mono text-[9px] uppercase tracking-wide text-slate-300">
          {GODS_EYE_ZOOM_LADDER.map(rung => (
            <span key={rung} className={rung === zoomRung ? 'text-cyan-200' : 'text-slate-500'}>
              {rung === GODS_EYE_ZOOM_LADDER[0] ? '' : ' → '}{rung}
            </span>
          ))}
        </p>
        {zoomRung ? <p className="mt-0.5 font-mono text-[9px] uppercase text-cyan-300">now {zoomRung}</p> : null}
      </div>
      <div className="mb-2 rounded border border-white/10 bg-black/30 px-2 py-1.5" data-testid="gods-eye-detail-coverage">
        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Detail coverage</p>
        <ul className="mt-1 space-y-0.5 font-mono text-[9px]">
          {GODS_EYE_DETAIL_COVERAGE.map(row => (
            <li key={row.id} className="flex justify-between gap-2">
              <span className="text-slate-300">{row.id.replaceAll('_', ' ')}</span>
              <span className={MODE_COLOR[row.state] ?? 'text-slate-500'}>{row.state}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="mb-2 rounded border border-white/10 bg-black/30 px-2 py-1.5" data-testid="gods-eye-ownership-matrix">
        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Ownership / license</p>
        <ul className="mt-1 space-y-0.5 font-mono text-[9px]">
          {GODS_EYE_OWNERSHIP_MATRIX.map(row => (
            <li key={row.id} className="flex justify-between gap-2">
              <span className="truncate text-slate-300">{row.label}</span>
              <span className={OWNERSHIP_COLOR[row.ownership] ?? 'text-slate-400'}>{row.ownership}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="mb-2 rounded border border-white/10 bg-black/30 px-2 py-1.5" data-testid="gods-eye-camera-health">
        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Traffic cameras</p>
        <p className="mt-0.5 font-mono text-[9px] uppercase text-slate-400">global {globalTrafficCameraCoverage()} · config / catalog / capture</p>
        <ul className="mt-1 space-y-1 font-mono text-[9px]">
          {cameras.map(row => (
            <li key={row.id} className="border-t border-white/5 pt-1 first:border-t-0 first:pt-0" data-testid={`gods-eye-camera-health-${row.id}`}>
              <div className="flex justify-between gap-2">
                <span className="truncate text-slate-300">{row.agency}</span>
                <span className={MODE_COLOR[row.catalogStatus] ?? 'text-slate-500'}>CATALOG {row.catalogStatus}</span>
              </div>
              <p className="mt-0.5 uppercase tracking-wide text-slate-500">
                cfg {row.configured ? 'YES' : 'NO'}
                {' · capture '}
                <span className={MODE_COLOR[row.captureFreshness] ?? 'text-slate-500'}>{row.captureFreshness}</span>
              </p>
            </li>
          ))}
        </ul>
      </div>
      <p className="mb-2 text-[9px] leading-snug text-slate-500">{GODS_EYE_SUCCESS_PATH.join(' → ')}</p>
      {GODS_EYE_LAYER_GROUPS.map(group => (
        <div key={group} className="mt-2 first:mt-0">
          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">{group}</p>
          <ul className="mt-0.5 space-y-1">
            {GODS_EYE_COVERAGE_MATRIX.filter(row => row.group === group).map(row => (
              <li key={row.id} className="border-t border-white/5 pt-1 first:border-t-0 first:pt-0">
                <div className="flex items-baseline justify-between gap-2 text-[10px]">
                  <span className="text-slate-200">{row.label}</span>
                  <span className={`shrink-0 font-mono uppercase ${SCOPE_COLOR[row.coverageScope] ?? 'text-slate-400'}`}>
                    {row.coverageDetail}
                  </span>
                </div>
                <div className="mt-0.5 flex justify-between gap-2 font-mono text-[9px] uppercase tracking-wide">
                  <span className={MODE_COLOR[row.dataMode] ?? 'text-slate-500'}>{row.dataMode}</span>
                  <span className="text-slate-500">phase {row.livePhase.replaceAll('_', ' ')}</span>
                </div>
                <p className="mt-0.5 text-[9px] leading-snug text-slate-500">{row.honesty}</p>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </TerraInspectDetails>
  )
}
