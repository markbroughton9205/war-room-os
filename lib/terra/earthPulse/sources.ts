import { coverage, globalCoverage, noneCoverage } from './freshness'
import type { EarthPulseSourceTruth, EarthPulseTruthState } from './types'

export const EARTH_PULSE_USER_AGENT = 'WarRoomOS-Terra/1.0 (earth-pulse@warroom.internal)'

export const GOES_EAST_GEOCOLOR_LAYER_ID = 'goes-east-geocolor' as const
export const GOES_WEST_GEOCOLOR_LAYER_ID = 'goes-west-geocolor' as const
export const GOES_EAST_IDENTIFIER = 'GOES-East_ABI_GeoColor'
export const GOES_WEST_IDENTIFIER = 'GOES-West_ABI_GeoColor'
export const GOES_GEOCOLOR_TMS = 'GoogleMapsCompatible_Level7'
export const GOES_GEOCOLOR_MAX_LEVEL = 7

export const NIGHT_LIGHTS_DAILY_LAYER_ID = 'night-lights-daily-dnb' as const
export const NIGHT_LIGHTS_DAILY_IDENTIFIER = 'VIIRS_SNPP_GapFilled_BRDF_Corrected_DayNightBand_Radiance'
export const NIGHT_LIGHTS_ARCHIVE_LAYER_ID = 'night-lights' as const
export const NIGHT_LIGHTS_ARCHIVE_DATE = '2016-01-01'
export const NIGHT_LIGHTS_MAX_LEVEL = 8

export const OVATION_URL = 'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json'
export const USGS_QUAKE_FEED_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson'
export const GIBS_CAPABILITIES_URL = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml'

export const GLM_BUCKETS = {
  G19: 'noaa-goes19',
  G18: 'noaa-goes18',
} as const

export const GOES_EAST_COVERAGE = coverage({
  kind: 'regional',
  label: 'GOES-East full disk (Americas)',
  west: -135,
  south: -55,
  east: -15,
  north: 55,
  basis: 'GOES-19 ABI/GLM full-disk approximate geographic envelope at 75.2W. Not Europe/Africa/Asia.',
})

export const GOES_WEST_COVERAGE = coverage({
  kind: 'regional',
  label: 'GOES-West full disk (Pacific)',
  west: 165,
  south: -55,
  east: -100,
  north: 55,
  basis: 'GOES-18 ABI/GLM full-disk approximate geographic envelope at 137W. Dateline wrap. Not Europe/Africa.',
})

export const GOES_GLM_COMBINED_COVERAGE = coverage({
  kind: 'regional',
  label: 'GOES-East + GOES-West GLM',
  west: 165,
  south: -55,
  east: -15,
  north: 55,
  basis: 'NOAA GOES-19 and GOES-18 GLM-L2-LCFA. No GLM coverage over Europe, Africa, or most of Asia.',
})

export const GOES_GEOCOLOR_COMBINED_COVERAGE = coverage({
  kind: 'regional',
  label: 'GOES-East + GOES-West ABI GeoColor',
  west: 165,
  south: -55,
  east: -15,
  north: 55,
  basis: 'NOAA GOES-19 and GOES-18 ABI GeoColor via NASA GIBS. Regional Americas/Pacific. Not Europe/Africa/Asia.',
})

export function sourceTruth(input: {
  source: string
  license: string
  auth?: EarthPulseSourceTruth['auth']
  coverage: EarthPulseSourceTruth['coverage']
  freshness: EarthPulseTruthState
  temporalResolution: string
  visualState: string
  docsUrl: string
}): EarthPulseSourceTruth {
  return {
    source: input.source,
    license: input.license,
    auth: input.auth ?? 'none',
    coverage: input.coverage,
    freshness: input.freshness,
    temporalResolution: input.temporalResolution,
    visualState: input.visualState,
    docsUrl: input.docsUrl,
  }
}

export const SOLAR_SOURCE = sourceTruth({
  source: 'NOAA Solar Position Algorithm via Terra worldTime',
  license: 'US government work. NOAA SPA algorithms.',
  coverage: globalCoverage('Computed solar geometry at the accepted coordinate + Terra time. Not a satellite image.'),
  freshness: 'LIVE',
  temporalResolution: 'instantaneous computation',
  visualState: 'Cesium sun lighting + location day/night classification',
  docsUrl: 'https://gml.noaa.gov/grad/solcalc/calcdetails.html',
})

export const CLOUD_SOURCE = sourceTruth({
  source: 'NASA GIBS WMTS · GOES-East/West ABI GeoColor',
  license: 'NASA GIBS public WMTS; NOAA GOES ABI GeoColor. US government work. Credit NASA/NOAA.',
  coverage: GOES_GEOCOLOR_COMBINED_COVERAGE,
  freshness: 'LIVE',
  temporalResolution: 'PT10M observed frames',
  visualState: 'Successive observed GeoColor tiles. Presentation alpha; not a cloud-mask. No interpolated motion.',
  docsUrl: 'https://nasa-gibs.github.io/gibs-api-docs/',
})

export const USGS_SOURCE = sourceTruth({
  source: 'USGS real-time earthquake GeoJSON · M4.5+ past day',
  license: 'USGS public domain. Credit USGS.',
  coverage: globalCoverage('USGS worldwide seismic network. Completeness varies; M4.5+ feed is not every felt quake.'),
  freshness: 'LIVE',
  temporalResolution: 'event catalog, typically minutes',
  visualState: 'Fresh epicenter pulse, then subdued marker',
  docsUrl: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php',
})

export const GLM_SOURCE = sourceTruth({
  source: 'NOAA GOES-19/18 GLM-L2-LCFA (AWS Open Data)',
  license: 'NOAA Open Data Dissemination. US government work. Credit NOAA NESDIS.',
  coverage: GOES_GLM_COMBINED_COVERAGE,
  freshness: 'LIVE',
  temporalResolution: '20-second LCFA granules, aggregated',
  visualState: 'Short flash pulses at aggregated flash cells. Not globe-wide.',
  docsUrl: 'https://www.goes.noaa.gov/',
})

export const OVATION_SOURCE = sourceTruth({
  source: 'NOAA SWPC OVATION aurora latest JSON',
  license: 'NOAA SWPC public JSON. US government work. Credit NOAA SWPC.',
  coverage: globalCoverage('Probability grid, polar ovals. Nowcast/forecast, not a live aurora camera.'),
  freshness: 'LIVE',
  temporalResolution: 'latest OVATION nowcast (~hourly)',
  visualState: 'Subtle oval glow from official probability/intensity. Hidden when low.',
  docsUrl: 'https://www.swpc.noaa.gov/products/aurora-30-minute-forecast',
})

export const NIGHT_LIGHTS_DAILY_SOURCE = sourceTruth({
  source: 'NASA GIBS VIIRS SNPP Gap-Filled BRDF-Corrected Day/Night Band radiance',
  license: 'NASA GIBS public WMTS. US government work. Credit NASA. Daily DNB radiance, not live electricity.',
  coverage: globalCoverage('Daily nighttime radiance. Clouds and moonlight affect the product. Not VNP46A2 Black Marble granules (those need Earthdata login).'),
  freshness: 'RECENT',
  temporalResolution: 'daily',
  visualState: 'Night-side lights from the daily DNB product date',
  docsUrl: 'https://nasa-gibs.github.io/gibs-api-docs/available-visualizations/',
})

export const NIGHT_LIGHTS_ARCHIVE_SOURCE = sourceTruth({
  source: 'NASA GIBS VIIRS Night Lights 2016 annual composite',
  license: 'NASA GIBS public WMTS. US government work. Credit NASA. Annual composite, not live power status.',
  coverage: globalCoverage('2016 annual composite archival fallback.'),
  freshness: 'STALE',
  temporalResolution: 'annual composite 2016',
  visualState: 'Archival city lights on the night side',
  docsUrl: 'https://nasa-gibs.github.io/gibs-api-docs/available-visualizations/',
})

export const VNP46A2_UNAVAILABLE_NOTE =
  'VNP46A2 / VJ146A2 daily Black Marble granules are not on public GIBS WMTS and require NASA Earthdata authentication. Phase 1 uses the public GIBS daily DNB radiance layer when tiles exist, otherwise the 2016 Night Lights composite.'

export const PHASE1_UNAVAILABLE = noneCoverage('Not implemented as a live Earth Pulse visual in Phase 1. Domain exists in the state model only.')
