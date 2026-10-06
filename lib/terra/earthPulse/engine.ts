import 'server-only'

import type { EarthPulseEngineState } from './types'
import { CLOUD_SOURCE, GLM_SOURCE, NIGHT_LIGHTS_ARCHIVE_SOURCE, NIGHT_LIGHTS_DAILY_SOURCE, OVATION_SOURCE, SOLAR_SOURCE, USGS_SOURCE } from './sources'
import { domainState, unavailableDomain } from './shared'
import { loadEarthPulseCloudCatalog } from './clouds'
import { loadUsgsEarthquakePulses } from './earthquakes'
import { loadGlmLightning } from './lightning'
import { loadOvationAurora } from './aurora'
import { loadNightLightsCatalog } from './nightLights'
import { globalCoverage } from './freshness'

export async function loadEarthPulseEngine(input: {
  terraTime: string
  timeMode: 'live' | 'historical'
}): Promise<EarthPulseEngineState> {
  const retrievedAt = new Date().toISOString()
  const [clouds, quakes, lightning, aurora, night] = await Promise.all([
    loadEarthPulseCloudCatalog(input),
    loadUsgsEarthquakePulses(input.terraTime),
    loadGlmLightning(input),
    loadOvationAurora(input),
    loadNightLightsCatalog(input.terraTime),
  ])

  const nightSource = night.mode === 'DAILY' ? NIGHT_LIGHTS_DAILY_SOURCE : NIGHT_LIGHTS_ARCHIVE_SOURCE

  return {
    retrievedAt,
    terraTime: input.terraTime,
    timeMode: input.timeMode,
    domains: {
      solar: domainState({
        domain: 'solar',
        source: SOLAR_SOURCE.source,
        observedAt: input.terraTime,
        updatedAt: retrievedAt,
        freshness: 'LIVE',
        coverage: SOLAR_SOURCE.coverage,
        truth: { ...SOLAR_SOURCE, freshness: 'LIVE' },
        note: 'Computed solar geometry. Not a live satellite observation of the terminator.',
        itemCount: 1,
      }),
      clouds: domainState({
        domain: 'clouds',
        source: CLOUD_SOURCE.source,
        observedAt: clouds.latestBySatellite['GOES-East']?.timestampIso
          ?? clouds.latestBySatellite['GOES-West']?.timestampIso
          ?? null,
        updatedAt: retrievedAt,
        freshness: clouds.truthState,
        coverage: CLOUD_SOURCE.coverage,
        truth: { ...CLOUD_SOURCE, freshness: clouds.truthState },
        note: clouds.error ?? 'GOES GeoColor observed frames at 10-minute steps. Regional Americas/Pacific only. Himawari and RealEarth globalir remain unlabeled until timestamped public tiles prove. Night-side GeoColor is not natural visible color.',
        itemCount: clouds.frames.length,
      }),
      lightning: domainState({
        domain: 'lightning',
        source: GLM_SOURCE.source,
        observedAt: lightning.observedAt,
        updatedAt: retrievedAt,
        freshness: lightning.truthState,
        coverage: GLM_SOURCE.coverage,
        truth: { ...GLM_SOURCE, freshness: lightning.truthState },
        note: lightning.error ?? `Aggregated GLM flash cells (${lightning.rawFlashCells}). No coverage outside GOES East/West disks.`,
        itemCount: lightning.flashes.length,
      }),
      earthquakes: domainState({
        domain: 'earthquakes',
        source: USGS_SOURCE.source,
        observedAt: quakes.observedAt,
        updatedAt: retrievedAt,
        freshness: quakes.truthState,
        coverage: USGS_SOURCE.coverage,
        truth: { ...USGS_SOURCE, freshness: quakes.truthState },
        note: quakes.error ?? `${quakes.events.filter(event => event.pulse).length} fresh pulses · ${quakes.events.length} markers`,
        itemCount: quakes.events.length,
      }),
      aurora: domainState({
        domain: 'aurora',
        source: OVATION_SOURCE.source,
        observedAt: aurora.observationTime,
        updatedAt: aurora.forecastTime ?? retrievedAt,
        freshness: aurora.truthState,
        coverage: OVATION_SOURCE.coverage,
        truth: { ...OVATION_SOURCE, freshness: aurora.truthState },
        note: aurora.error ?? (aurora.maxAurora < 8
          ? 'OVATION probability is low; oval glow is reduced or hidden.'
          : `OVATION nowcast max intensity ${aurora.maxAurora}. Not a live camera.`),
        itemCount: aurora.cells.length,
      }),
      night_lights: domainState({
        domain: 'night_lights',
        source: nightSource.source,
        observedAt: night.productDate,
        updatedAt: retrievedAt,
        freshness: night.truthState,
        coverage: globalCoverage(night.note),
        truth: { ...nightSource, freshness: night.truthState },
        note: night.note,
        itemCount: 1,
      }),
      fires: unavailableDomain('fires', 'not wired in Phase 1', 'FIRMS/thermal fire detections are not an Earth Pulse visual this phase.'),
      ocean: unavailableDomain('ocean', 'not wired in Phase 1', 'No live ocean-color/SST pulse visual this phase.'),
      human_activity: unavailableDomain('human_activity', 'not wired in Phase 1', 'Night lights are the only human-activity proxy this phase, under night_lights.'),
    },
  }
}
