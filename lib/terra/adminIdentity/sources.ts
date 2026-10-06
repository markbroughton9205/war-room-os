import type { AdminSourceProvenance } from './types'

/**
 * Lawful geographic-identity sources. War Room does not scrape commercial flag packs
 * and does not assert territorial claims.
 */
export const ADMIN_IDENTITY_SOURCES: Record<string, AdminSourceProvenance> = {
  natural_earth: {
    id: 'natural_earth',
    name: 'Natural Earth',
    license: 'Public Domain (Natural Earth Terms of Use)',
    licenseUrl: 'https://www.naturalearthdata.com/about/terms-of-use/',
    homepage: 'https://www.naturalearthdata.com/',
    version: '5.1.1 / geojson export from nvkelso/natural-earth-vector',
    notes: 'Admin-0 countries (110m), admin-1 states/provinces (50m), populated places (110m). Disputed features retain source FEATURECLA / TYPE.',
  },
  osm_nominatim: {
    id: 'osm_nominatim',
    name: 'OpenStreetMap Nominatim',
    license: 'ODbL 1.0',
    licenseUrl: 'https://www.openstreetmap.org/copyright',
    homepage: 'https://nominatim.openstreetmap.org/',
    version: 'live reverse geocode',
    notes: 'Active-location hierarchy (country/state/county/city) and optional county polygon when Nominatim returns geojson. Share-alike applies to derived OSM databases.',
  },
  wikimedia_flags: {
    id: 'wikimedia_flags',
    name: 'Wikimedia Commons / flag-icons (Wikipedia SVG flags)',
    license: 'Per-file Wikimedia license; country set vendored from flag-icons MIT',
    licenseUrl: 'https://github.com/lipis/flag-icons/blob/main/LICENSE',
    homepage: 'https://commons.wikimedia.org/wiki/Category:SVG_sovereign-state_flags',
    version: 'flag-icons 7.x country SVGs + selected Wikimedia state SVGs',
    notes: 'Only catalogued territories with a verified asset receive a flag. Missing asset → boundary + name only. No invented flags.',
  },
}

export const ADMIN_IDENTITY_DATA_PATHS = {
  countries: '/terra/admin-identity/countries-110m.json',
  admin1: '/terra/admin-identity/admin1-50m.json',
  places: '/terra/admin-identity/places-110m.json',
  provenance: '/terra/admin-identity/PROVENANCE.json',
  countryFlag: (iso2: string) => `/terra/admin-identity/flags/countries/${iso2.toLowerCase()}.svg`,
  stateFlag: (iso3166_2: string) => `/terra/admin-identity/flags/states/${iso3166_2}.svg`,
} as const

export const ADMIN_IDENTITY_CREDIT =
  'Boundaries: Natural Earth (public domain). Place names: Natural Earth. Flags: Wikimedia Commons / flag-icons. War Room does not make territorial claims.'
