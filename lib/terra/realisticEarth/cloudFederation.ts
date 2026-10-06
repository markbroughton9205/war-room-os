/**
 * Global cloud provider federation. Only emit imagery for proven, timestamped products.
 * IR fill is never labeled GeoColor. GOES remains primary where it actually covers.
 */
import type { ProviderHealth } from '@/lib/terra/layerGovernor/types'
import type { TerraViewBand } from '@/lib/terra/layerGovernor/viewBands'
import { isOrbitBand } from '@/lib/terra/layerGovernor/viewBands'

export const CLOUD_PROVIDER_PRIMARY = 'nasa_gibs_goes_geocolor' as const
export const CLOUD_PROVIDER_ASIA = 'jma_himawari' as const
export const CLOUD_PROVIDER_GLOBAL_FILL = 'ssec_realearth_globalir' as const

export const CLOUD_PRODUCTS = ['GEOCOLOR', 'IR'] as const
export type CloudProduct = (typeof CLOUD_PRODUCTS)[number]

export const CLOUD_APPEARANCES = ['NATURAL_COLOR', 'INFRARED'] as const
export type CloudAppearance = (typeof CLOUD_APPEARANCES)[number]

export const CLOUD_FRAME_MODEL = 'explicit observed timestamps only · never mixed latest tiles'
export const CLOUD_CROSSFADE = 'two persistent slots per active provider · tile-ready wait · alpha crossfade'

export type CloudFederationSlot = {
  id: string
  role: 'primary' | 'asia' | 'global_fill'
  status: 'WIRED' | 'PROBED_NO_COVERAGE' | 'RESERVED_NO_COVERAGE' | 'AUTH_REQUIRED' | 'OFFLINE'
  health: ProviderHealth | 'NO_COVERAGE'
  product: CloudProduct
  appearance: CloudAppearance
  coverage: 'regional' | 'global' | 'none'
  label: string
  license: string
  temporalResolution: string
  region: string
}

export const CLOUD_FEDERATION_PROVIDERS: CloudFederationSlot[] = [
  {
    id: CLOUD_PROVIDER_PRIMARY,
    role: 'primary',
    status: 'WIRED',
    health: 'HEALTHY',
    product: 'GEOCOLOR',
    appearance: 'NATURAL_COLOR',
    coverage: 'regional',
    label: 'NASA GIBS · NOAA GOES-East/West ABI GeoColor',
    license: 'NASA GIBS public WMTS; NOAA GOES ABI GeoColor. US government work. Credit NASA/NOAA.',
    temporalResolution: 'PT10M',
    region: 'Americas / Pacific',
  },
  {
    id: CLOUD_PROVIDER_ASIA,
    role: 'asia',
    status: 'PROBED_NO_COVERAGE',
    health: 'NO_COVERAGE',
    product: 'IR',
    appearance: 'INFRARED',
    coverage: 'none',
    label: 'JMA Himawari AHI (GIBS public WMTS probe)',
    license: 'JMA Himawari via NASA GIBS when a public Web Mercator layer exists. Not wired until a timestamped tile proves 200.',
    temporalResolution: 'PT10M',
    region: 'Asia / Oceania',
  },
  {
    id: CLOUD_PROVIDER_GLOBAL_FILL,
    role: 'global_fill',
    status: 'PROBED_NO_COVERAGE',
    health: 'NO_COVERAGE',
    product: 'IR',
    appearance: 'INFRARED',
    coverage: 'none',
    label: 'SSEC RealEarth globalir',
    license: 'University of Wisconsin–Madison SSEC/CIMSS RealEarth. Public tiles only with explicit timestamps and on-screen attribution. Not NASA GeoColor. Commercial redistribution not assumed.',
    temporalResolution: 'PT10M',
    region: 'Global IR fill',
  },
]

export type CloudProviderChoice = {
  providerId: string | null
  product: CloudProduct | null
  appearance: CloudAppearance | null
  playbackSatellite: 'GOES-East' | 'GOES-West' | 'Himawari' | 'RealEarth-IR' | null
  failover: 'NONE' | 'HIMAWARI' | 'REALEARTH_IR' | 'NOT_AVAILABLE_TRUTHFULLY'
  reason: string
  naturalColorClaim: boolean
}

export function pointInGoesCloudCoverage(longitude: number, latitude: number): boolean {
  const inEast = longitude >= -135 && longitude <= -15 && latitude >= -55 && latitude <= 55
  const inWest = latitude >= -55 && latitude <= 55 && (longitude >= 165 || longitude <= -100)
  return inEast || inWest
}

export function pointInHimawariCoverage(longitude: number, latitude: number): boolean {
  if (latitude < -60 || latitude > 60) return false
  return longitude >= 80 && longitude <= 180 || longitude >= -180 && longitude <= -160
}

export function selectCloudProduct(input: {
  solar: string | null
  inGoes: boolean
}): { product: CloudProduct; appearance: CloudAppearance; reason: string } {
  if (input.solar === 'NIGHT' || input.solar === 'NAUTICAL_TWILIGHT') {
    return {
      product: input.inGoes ? 'GEOCOLOR' : 'IR',
      appearance: 'INFRARED',
      reason: input.inGoes
        ? 'GOES GeoColor night-side is a CIRA IR composite · not natural visible color'
        : 'night prefers IR where GeoColor is absent',
    }
  }
  if (input.inGoes) {
    return { product: 'GEOCOLOR', appearance: 'NATURAL_COLOR', reason: 'daytime GOES GeoColor where covered' }
  }
  return { product: 'IR', appearance: 'INFRARED', reason: 'global gap uses IR fill if available · not natural color' }
}

export function selectCloudProvider(input: {
  longitude: number | null
  latitude: number | null
  solar: string | null
  goesFrameCount: number
  himawariFrameCount: number
  fillFrameCount: number
  goesHealth: ProviderHealth
}): CloudProviderChoice {
  const inGoes = input.longitude != null && input.latitude != null
    ? pointInGoesCloudCoverage(input.longitude, input.latitude)
    : true
  const inHimawari = input.longitude != null && input.latitude != null
    ? pointInHimawariCoverage(input.longitude, input.latitude)
    : false
  const product = selectCloudProduct({ solar: input.solar, inGoes })

  if (inGoes && input.goesFrameCount > 0 && input.goesHealth !== 'OFFLINE' && input.goesHealth !== 'AUTH_REQUIRED') {
    return {
      providerId: CLOUD_PROVIDER_PRIMARY,
      product: product.product,
      appearance: product.appearance,
      playbackSatellite: 'GOES-East',
      failover: 'NONE',
      reason: product.reason,
      naturalColorClaim: product.appearance === 'NATURAL_COLOR',
    }
  }

  if (input.goesHealth === 'OFFLINE' && input.fillFrameCount > 0) {
    return {
      providerId: CLOUD_PROVIDER_GLOBAL_FILL,
      product: 'IR',
      appearance: 'INFRARED',
      playbackSatellite: 'RealEarth-IR',
      failover: 'REALEARTH_IR',
      reason: 'GOES failed · RealEarth global IR fill · not GeoColor',
      naturalColorClaim: false,
    }
  }

  if (!inGoes && inHimawari && input.himawariFrameCount > 0) {
    return {
      providerId: CLOUD_PROVIDER_ASIA,
      product: 'IR',
      appearance: 'INFRARED',
      playbackSatellite: 'Himawari',
      failover: 'HIMAWARI',
      reason: 'active location in Himawari envelope · IR product · not GeoColor',
      naturalColorClaim: false,
    }
  }

  if (!inGoes && input.fillFrameCount > 0) {
    return {
      providerId: CLOUD_PROVIDER_GLOBAL_FILL,
      product: 'IR',
      appearance: 'INFRARED',
      playbackSatellite: 'RealEarth-IR',
      failover: 'REALEARTH_IR',
      reason: 'outside GOES envelope · global IR fill · not natural visible color',
      naturalColorClaim: false,
    }
  }

  return {
    providerId: inGoes ? CLOUD_PROVIDER_PRIMARY : null,
    product: inGoes ? 'GEOCOLOR' : null,
    appearance: inGoes ? product.appearance : null,
    playbackSatellite: inGoes ? 'GOES-East' : null,
    failover: 'NOT_AVAILABLE_TRUTHFULLY',
    reason: inGoes
      ? 'GOES primary with no interchangeable fill currently proven'
      : 'outside GOES envelope · Himawari/RealEarth not proven on public timestamped tiles',
    naturalColorClaim: false,
  }
}

export function cloudCadenceMs(band: TerraViewBand, resource: string, animate: boolean): number {
  if (!animate) return 0
  if (resource === 'PRESSURE') return 4000
  if (isOrbitBand(band)) return 1500
  if (band === 'CONTINENTAL' || band === 'REGIONAL') return 1800
  return 2400
}

export function applyFederationProbe(providers: CloudFederationSlot[], input: {
  himawariOk: boolean
  fillOk: boolean
}): CloudFederationSlot[] {
  return providers.map(provider => {
    if (provider.id === CLOUD_PROVIDER_ASIA) {
      return input.himawariOk
        ? { ...provider, status: 'WIRED', health: 'HEALTHY', coverage: 'regional' }
        : { ...provider, status: 'PROBED_NO_COVERAGE', health: 'NO_COVERAGE', coverage: 'none' }
    }
    if (provider.id === CLOUD_PROVIDER_GLOBAL_FILL) {
      return input.fillOk
        ? { ...provider, status: 'WIRED', health: 'HEALTHY', coverage: 'global' }
        : { ...provider, status: 'PROBED_NO_COVERAGE', health: 'NO_COVERAGE', coverage: 'none' }
    }
    return provider
  })
}

export function globalCoverageClaim(providers: CloudFederationSlot[]): 'PARTIAL' | 'NONE' {
  const wired = providers.filter(provider => provider.status === 'WIRED')
  const hasGlobal = wired.some(provider => provider.coverage === 'global')
  const hasGoes = wired.some(provider => provider.id === CLOUD_PROVIDER_PRIMARY)
  if (hasGlobal && hasGoes) return 'PARTIAL'
  if (hasGoes) return 'PARTIAL'
  return 'NONE'
}
