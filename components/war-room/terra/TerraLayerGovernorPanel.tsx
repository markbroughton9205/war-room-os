'use client'

import {
  GOVERNED_LAYER_LABELS,
  governorAcceptanceReport,
  type GovernedLayerId,
  type LayerDecision,
  type LayerGovernorPlan,
} from '@/lib/terra/layerGovernor'
import { VEHICLE_LAYER_FILTERS, type VehicleLayerFilter } from '@/lib/terra/vehicleIcons'

const COMPACT_ROWS: GovernedLayerId[] = [
  'clouds',
  'radar',
  'night_lights',
  'roads',
  'buildings',
  'nearby_cameras',
  'earthquakes',
  'lightning',
  'aurora',
  'weather_hazards',
]

const LIVE_MOVEMENT_ROWS: GovernedLayerId[] = ['aircraft', 'vessels']

function tone(decision: LayerDecision): string {
  if (decision.effective === 'ACTIVE') return 'text-cyan-300'
  if (decision.effective === 'DIMMED' || decision.effective === 'PAUSED') return 'text-amber-200'
  return 'text-slate-500'
}

function rowStatus(decision: LayerDecision): string {
  const opacityPct = Math.round(decision.opacity * 100)
  const showOpacity = decision.effective === 'ACTIVE' || decision.effective === 'DIMMED' || decision.effective === 'PAUSED'
  const parts = [decision.mode, decision.intensityLabel || decision.effective]
  if (showOpacity && opacityPct > 0) parts.push(`${opacityPct}%`)
  return parts.join(' · ')
}

export function TerraLayerGovernorPanel({
  plan,
  masterAuto,
  onMasterAuto,
  onCycleLayer,
  onResetLearned,
  vehicleFilters = [],
  onToggleVehicleFilter,
}: {
  plan: LayerGovernorPlan
  masterAuto: boolean
  onMasterAuto: (value: boolean) => void
  onCycleLayer: (id: GovernedLayerId) => void
  onResetLearned: () => void
  vehicleFilters?: VehicleLayerFilter[]
  onToggleVehicleFilter?: (id: VehicleLayerFilter) => void
}) {
  const report = governorAcceptanceReport(plan)
  return (
    <div
      className="mb-2 space-y-1.5"
      data-testid="terra-layer-governor"
      data-master-auto={masterAuto ? 'on' : 'off'}
      data-context={plan.inferred.context}
      data-confidence={plan.inferred.confidence}
      data-resource={plan.resource}
      data-view-band={plan.viewBand}
      data-earth-dominant={plan.earthDominant ? 'yes' : 'no'}
      data-primary-layer={report.PRIMARY_LAYER}
      data-secondary-layers={report.SECONDARY_LAYERS}
      data-suppressed-layers={report.SUPPRESSED_LAYERS}
      data-reason={report.REASON}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Smart View</span>
        <button
          type="button"
          data-testid="terra-layer-governor-master"
          onClick={() => onMasterAuto(!masterAuto)}
          className={`rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-widest ${masterAuto ? 'border-cyan-400/40 text-cyan-300' : 'border-white/15 text-slate-400'}`}
        >
          {masterAuto ? 'AUTO' : 'MANUAL'}
        </button>
      </div>
      <p className="font-mono text-[9px] uppercase tracking-widest text-cyan-300/80" data-testid="terra-layer-governor-view">
        Current view: {plan.viewBand}
      </p>
      <p className="font-mono text-[9px] uppercase tracking-widest text-slate-500" data-testid="terra-layer-governor-context">
        {plan.inferred.context} · {plan.inferred.confidence} · {plan.resource}
      </p>
      <ul className="space-y-0.5" data-testid="terra-layer-governor-evidence">
        {plan.inferred.evidence.map(item => (
          <li key={item} className="truncate font-mono text-[8px] uppercase tracking-widest text-slate-600">
            {item}
          </li>
        ))}
      </ul>
      <ul className="space-y-0.5">
        {COMPACT_ROWS.map(id => {
          const row = plan.layers[id]
          return (
            <li key={id}>
              <button
                type="button"
                data-testid={`terra-governor-${id}`}
                data-effective={row.effective}
                data-priority={row.priority}
                data-mode={row.mode}
                data-intensity={row.intensityLabel}
                title={row.reason}
                onClick={() => onCycleLayer(id)}
                className="flex w-full items-center justify-between gap-2 text-left text-[10px] text-slate-400 hover:text-slate-200"
              >
                <span>{GOVERNED_LAYER_LABELS[id]}</span>
                <span className={`font-mono uppercase tracking-widest ${tone(row)}`}>
                  {rowStatus(row)}
                </span>
              </button>
              <p className="truncate pl-0.5 font-mono text-[8px] uppercase tracking-widest text-slate-600" title={row.reason}>
                {row.reason}
              </p>
            </li>
          )
        })}
      </ul>
      <p className="pt-1 text-[9px] font-bold uppercase tracking-widest text-slate-500">Live movement</p>
      <ul className="space-y-0.5">
        {LIVE_MOVEMENT_ROWS.map(id => {
          const row = plan.layers[id]
          return (
            <li key={id}>
              <button
                type="button"
                data-testid={`terra-governor-${id}`}
                data-effective={row.effective}
                data-priority={row.priority}
                data-mode={row.mode}
                data-intensity={row.intensityLabel}
                data-detail={row.detailLevel}
                title={row.reason}
                onClick={() => onCycleLayer(id)}
                className="flex w-full items-center justify-between gap-2 text-left text-[10px] text-slate-400 hover:text-slate-200"
              >
                <span>{GOVERNED_LAYER_LABELS[id]}</span>
                <span className={`font-mono uppercase tracking-widest ${tone(row)}`}>
                  {rowStatus(row)}
                </span>
              </button>
              <p className="truncate pl-0.5 font-mono text-[8px] uppercase tracking-widest text-slate-600" title={row.reason}>
                {row.reason}
              </p>
            </li>
          )
        })}
      </ul>
      {onToggleVehicleFilter && (
        <div className="flex flex-wrap gap-1 pt-0.5" data-testid="terra-vehicle-filters">
          {VEHICLE_LAYER_FILTERS.map(id => {
            const active = vehicleFilters.includes(id)
            return (
              <button
                key={id}
                type="button"
                data-testid={`terra-vehicle-filter-${id.toLowerCase()}`}
                data-active={active ? 'yes' : 'no'}
                onClick={() => onToggleVehicleFilter(id)}
                className={`rounded border px-1 py-0.5 text-[8px] uppercase tracking-widest ${
                  active ? 'border-cyan-400/50 text-cyan-200' : 'border-white/10 text-slate-500'
                }`}
              >
                {id}
              </button>
            )
          })}
        </div>
      )}
      <button
        type="button"
        data-testid="terra-governor-reset-learned"
        onClick={onResetLearned}
        className="text-[8px] uppercase tracking-widest text-slate-600 hover:text-slate-400"
      >
        Reset learned preferences
      </button>
    </div>
  )
}
