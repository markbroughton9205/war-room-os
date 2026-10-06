import type { TerraGeoFeature } from '@/lib/terra/types'
import { readFlightTruth } from './project'
import type { TerraAircraftTruth } from './types'

export type GodsEyeField = { label: string; value: string }

function field(label: string, value: string | number | null | undefined): GodsEyeField | null {
  if (value === null || value === undefined || value === '') return null
  return { label, value: String(value) }
}

export function godsEyeAircraftIdentity(feature: TerraGeoFeature | null | undefined): string | null {
  return readFlightTruth(feature)?.identity.key ?? null
}

export function godsEyeAircraftSections(truth: TerraAircraftTruth | null): Record<string, GodsEyeField[]> {
  if (!truth) return {}
  const primary = truth.primary
  const identity = [
    field('icao hex', truth.identity.icaoHex ?? 'UNKNOWN'),
    field('registration', primary?.registration ?? truth.identity.registration ?? 'UNKNOWN'),
    field('callsign', primary?.callsign ?? 'UNKNOWN'),
    field('icao type', truth.classification.icaoType ?? 'UNKNOWN'),
    field('description', primary?.description),
    field('identity basis', truth.identity.basis),
    field('terra identity', truth.identity.key),
  ].filter((item): item is GodsEyeField => item !== null)
  const classification = [
    field('classes', truth.classification.classes.join(', ') || 'UNKNOWN'),
    field('registry', truth.classification.id ?? 'none'),
    field('mission', 'NOT INFERRED'),
  ].filter((item): item is GodsEyeField => item !== null)
  const position = [
    field('lat', primary?.lat?.toFixed(5) ?? 'POSITION_UNAVAILABLE'),
    field('lon', primary?.lon?.toFixed(5) ?? 'POSITION_UNAVAILABLE'),
    field('baro altitude ft', primary?.baroAltitudeFt),
    field('geom altitude ft', primary?.geomAltitudeFt),
    field('ground speed kt', primary?.groundSpeedKt),
    field('track', primary?.trackDeg),
    field('heading', primary?.trueHeadingDeg ?? primary?.magneticHeadingDeg),
    field('vertical rate fpm', primary?.baroVerticalRateFpm ?? primary?.geomVerticalRateFpm),
  ].filter((item): item is GodsEyeField => item !== null)
  const signal = [
    field('position source', primary?.positionSource ?? 'UNKNOWN'),
    field('position age sec', primary?.positionAgeSec),
    field('freshness', truth.freshness),
  ].filter((item): item is GodsEyeField => item !== null)
  const quality = [
    field('nic', primary?.nic),
    field('nacp', primary?.nacP),
    field('nacv', primary?.nacV),
    field('sil', primary?.sil),
    field('rc', primary?.rc),
    field('why this position', truth.qualityReason),
  ].filter((item): item is GodsEyeField => item !== null)
  const transponder = [
    field('squawk', primary?.squawk ?? 'UNKNOWN'),
    field('emergency', primary?.emergency ?? 'none reported'),
  ].filter((item): item is GodsEyeField => item !== null)
  const provenance = [
    field('primary provider', primary?.provider ?? 'UNKNOWN'),
    field('alternate sources', String(truth.alternateSourceCount)),
    field('received', primary?.receivedAt ?? 'UNKNOWN'),
    ...truth.alternates.slice(0, 3).map(alternate => field(
      `alternate ${alternate.provider}`,
      `${alternate.positionSource} age ${alternate.positionAgeSec ?? 'UNKNOWN'}`,
    )),
  ].filter((item): item is GodsEyeField => item !== null)
  return {
    IDENTITY: identity,
    CLASSIFICATION: classification,
    POSITION: position,
    SIGNAL: signal,
    QUALITY: quality,
    TRANSPONDER: transponder,
    PROVENANCE: provenance,
  }
}
