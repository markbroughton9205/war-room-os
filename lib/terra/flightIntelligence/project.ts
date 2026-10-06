import type { ResearchProviderId } from '@/lib/research-engine/core/types'
import type { TerraGeoFeature } from '@/lib/terra/types'
import { classifyAircraftIconType } from '@/lib/terra/vehicleIcons'
import type { TerraAircraftTruth } from './types'

const FEET_TO_METERS = 0.3048
const KT_TO_MPS = 0.514444

function providerId(truth: TerraAircraftTruth): ResearchProviderId {
  const provider = truth.primary?.provider
  if (provider === 'airplanes_live' || provider === 'adsb_exchange' || provider === 'opensky') return provider
  return 'opensky'
}

export function flightTruthToFeature(truth: TerraAircraftTruth): TerraGeoFeature | null {
  const primary = truth.primary
  if (!primary || primary.lat === null || primary.lon === null) return null
  const altitudeM = primary.baroAltitudeFt !== null
    ? primary.baroAltitudeFt * FEET_TO_METERS
    : primary.geomAltitudeFt !== null
      ? primary.geomAltitudeFt * FEET_TO_METERS
      : null
  const heading = primary.trackDeg ?? primary.trueHeadingDeg ?? primary.magneticHeadingDeg
  const velocityMps = primary.groundSpeedKt !== null ? primary.groundSpeedKt * KT_TO_MPS : null
  const verticalMps = primary.baroVerticalRateFpm !== null ? primary.baroVerticalRateFpm / 196.850394 : null
  const classes = truth.classification.classes
  const aircraftIconType = classes.includes('HELICOPTER')
    ? 'HELICOPTER'
    : classes.includes('MILITARY')
      ? 'MILITARY'
      : classifyAircraftIconType({
        emitterCategory: primary.category && /^\d+$/.test(primary.category) ? Number(primary.category) : null,
      })
  const callsign = primary.callsign
  const title = truth.classification.label ?? callsign ?? truth.identity.icaoHex ?? truth.identity.key
  return {
    id: truth.identity.key,
    eventId: truth.identity.key,
    providerId: providerId(truth),
    kind: 'aircraft_state',
    longitude: primary.lon,
    latitude: primary.lat,
    altitude: altitudeM,
    timestamp: primary.sourceTimestamp ?? primary.receivedAt,
    title,
    summary: truth.qualityReason,
    properties: {
      icao24: truth.identity.icaoHex,
      callsign,
      registration: primary.registration,
      originCountry: primary.originCountry,
      headingDeg: heading,
      velocityMps,
      verticalRateMps: verticalMps,
      onGround: primary.onGround,
      emitterCategory: primary.category && /^\d+$/.test(primary.category) ? Number(primary.category) : null,
      aircraftIconType,
      flightTruth: truth,
      terraAircraftKey: truth.identity.key,
    },
    provenance: {
      provider: providerId(truth),
      sourceUrl: truth.identity.icaoHex
        ? `https://opensky-network.org/aircraft-profile?icao24=${truth.identity.icaoHex}`
        : null,
      retrievedAt: primary.receivedAt,
      fromCache: false,
      isHistorical: false,
    },
    rawReference: {
      documentId: truth.identity.key,
      providerRecordId: truth.identity.icaoHex,
      canonicalUrl: null,
    },
    coordinateOrigin: 'observed',
    geoResolution: null,
    geometryKind: 'point',
    regionRings: null,
    pathCoordinates: null,
  }
}

export function readFlightTruth(feature: TerraGeoFeature | null | undefined): TerraAircraftTruth | null {
  const value = feature?.properties.flightTruth
  if (!value || typeof value !== 'object') return null
  const truth = value as TerraAircraftTruth
  if (!truth.identity?.key) return null
  return truth
}
