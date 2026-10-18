'use client'

/**
 * Passive holographic Terra layer for Foundry.
 * Reuses canonical NASA GIBS true-color daily imagery. Does not mount Cesium,
 * TerraGlobe, or a second Matrix engine. Default pointer-events: none.
 */
import { useMemo, useState } from 'react'
import {
  FOUNDRY_TERRA_IDENTITY_LABELS,
  FOUNDRY_TERRA_TRUTH_PASSIVE,
  buildFoundryTerraGibsMosaicUrl,
  foundryTerraBackgroundTruth,
  foundryTerraCompletedObservationDay,
  parseFoundryTerraContext,
  type FoundryTerraContextMode,
} from '@/lib/native-builder/foundryTerraContext'

export function FoundryTerraBackground({
  terraContext = 'none',
}: {
  terraContext?: FoundryTerraContextMode | string | null
}) {
  const mode = parseFoundryTerraContext(typeof terraContext === 'string' ? terraContext : terraContext ?? 'none')
  const [imageryAvailable, setImageryAvailable] = useState(true)
  const observationDay = useMemo(() => foundryTerraCompletedObservationDay(), [])
  const mosaicUrl = useMemo(() => {
    try {
      return buildFoundryTerraGibsMosaicUrl(observationDay)
    } catch {
      return null
    }
  }, [observationDay])
  const truth = foundryTerraBackgroundTruth(mode, imageryAvailable && Boolean(mosaicUrl))
  const interactive = truth.pointerEvents === 'auto'

  return (
    <div
      className={`foundry-terra-background absolute inset-0 z-[1] overflow-hidden ${interactive ? '' : 'pointer-events-none'}`}
      data-testid="foundry-terra-background"
      data-terra-truth={truth.label}
      data-terra-live="false"
      data-terra-mode={mode}
      data-pointer-events={truth.pointerEvents}
      aria-hidden={!interactive}
    >
      {mosaicUrl ? (
        <img
          src={mosaicUrl}
          alt=""
          className="hidden"
          data-testid="foundry-terra-mosaic"
          onLoad={() => setImageryAvailable(true)}
          onError={() => setImageryAvailable(false)}
        />
      ) : null}
      <div className="foundry-terra-vignette absolute inset-0" />
      <div className="foundry-terra-stage absolute inset-0 flex items-center justify-center">
        <div className="foundry-terra-orbits" data-testid="foundry-terra-orbits" />
        <div
          className="foundry-terra-globe"
          data-testid="foundry-terra-globe"
          style={mosaicUrl && imageryAvailable ? { ['--foundry-terra-mosaic' as string]: `url("${mosaicUrl}")` } : undefined}
        />
        <p className="foundry-terra-truth" data-testid="foundry-terra-truth">
          TERRA · {truth.label}
        </p>
      </div>
      <ul className="foundry-terra-labels" data-testid="foundry-terra-labels">
        {FOUNDRY_TERRA_IDENTITY_LABELS.map(label => (
          <li key={label}>{label}</li>
        ))}
      </ul>
      <p className="sr-only">
        Passive Terra visual using {FOUNDRY_TERRA_TRUTH_PASSIVE} NASA GIBS daily imagery for {observationDay}. Never live.
      </p>
    </div>
  )
}
