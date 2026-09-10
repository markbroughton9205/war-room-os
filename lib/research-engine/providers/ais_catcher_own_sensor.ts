import 'server-only'

/**
 * AIS-catcher / local SDR own-sensor adapter.
 * Reads the in-memory ingest buffer populated by POST /api/terra/own-sensor/ais.
 * Absence of a receiver is NEEDS_LOCAL_SENSOR, never a provider outage.
 */
import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'
import { makeMaritimeVesselDocument, observationInBbox, parseMaritimeBbox } from '@/lib/research-engine/providers/maritimeAisShared'
import { listOwnSensorAisObservations, ownSensorHasFreshFeed } from '@/lib/terra/maritimeOwnSensorStore'

const PROVIDER = 'ais_catcher_own_sensor' as const
const MAX_RESULTS = 150

async function run(query: ResearchQuery) {
  const started = Date.now()
  const bbox = parseMaritimeBbox(query.text)
  if (!bbox) {
    return notConfiguredResponse(PROVIDER, 'Query must be a bounding box "lamin,lomin,lamax,lomax".')
  }
  const observations = listOwnSensorAisObservations()
  if (observations.length === 0) {
    return notConfiguredResponse(PROVIDER, 'No local AIS-catcher/SDR receiver is feeding War Room.')
  }
  const documents = observations.flatMap(observation => {
    if (!observationInBbox(observation.latitude, observation.longitude, bbox)) return []
    return [makeMaritimeVesselDocument(PROVIDER, {
      mmsi: observation.mmsi,
      latitude: observation.latitude,
      longitude: observation.longitude,
      speedKnots: observation.speedKnots,
      courseDeg: observation.courseDeg,
      headingDeg: observation.headingDeg,
      navStatCode: observation.navStatCode,
      observedAtIso: observation.observedAtIso,
      canonicalUrl: 'warroom://terra/own-sensor/ais',
      sourceName: 'AIS-catcher / local SDR receiver (own sensor)',
      organization: 'War Room own sensor',
      license: 'own-sensor',
    })]
  }).slice(0, MAX_RESULTS)
  return okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  if (!ownSensorHasFreshFeed()) {
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'No local AIS receiver observations', durationMs: 0 }
  }
  return { provider: PROVIDER, state: 'ready', checkedAt: nowIso(), detail: 'Own-sensor ingest has recent observations', durationMs: 0 }
}

export const aisCatcherOwnSensorAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
