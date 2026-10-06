/**
 * Representative worldwide locations for Terra coverage tests.
 * These are ACCEPTANCE FIXTURES, not routing tables and not city-specific architecture.
 * Provider eligibility is always computed from registry envelopes.
 */

export type TerraWorldwideFixture = {
  id: string
  name: string
  latitude: number
  longitude: number
  /** Camera-category registry ids expected to cover this point. Empty = no wired camera envelope. */
  expectCameraIds: readonly string[]
  /** Camera-category registry ids that must NOT cover this point. */
  rejectCameraIds: readonly string[]
}

export const TERRA_WORLDWIDE_FIXTURES: readonly TerraWorldwideFixture[] = [
  {
    id: 'akron_ohio',
    name: 'Akron, Ohio',
    latitude: 41.0814,
    longitude: -81.519,
    expectCameraIds: ['ohgo'],
    rejectCameraIds: ['caltrans_cctv', '511ny', 'ontario_511_cameras', 'quebec_511_cameras', 'digitraffic_road_cameras', 'hong_kong_td_cameras'],
  },
  {
    id: 'cincinnati_ohio',
    name: 'Cincinnati, Ohio',
    latitude: 39.1031,
    longitude: -84.512,
    expectCameraIds: ['ohgo'],
    rejectCameraIds: ['caltrans_cctv', '511ny', 'digitraffic_road_cameras'],
  },
  {
    id: 'california',
    name: 'Los Angeles, California',
    latitude: 34.0522,
    longitude: -118.2437,
    expectCameraIds: ['caltrans_cctv'],
    rejectCameraIds: ['ohgo', '511ny', 'ontario_511_cameras'],
  },
  {
    id: 'new_york',
    name: 'New York',
    latitude: 40.7128,
    longitude: -74.006,
    expectCameraIds: ['511ny'],
    rejectCameraIds: ['ohgo', 'caltrans_cctv', 'digitraffic_road_cameras'],
  },
  {
    id: 'ontario',
    name: 'Toronto, Ontario',
    latitude: 43.6532,
    longitude: -79.3832,
    expectCameraIds: ['ontario_511_cameras'],
    rejectCameraIds: ['ohgo', 'quebec_511_cameras', '511ny'],
  },
  {
    id: 'quebec',
    name: 'Montréal, Québec',
    latitude: 45.5017,
    longitude: -73.5673,
    expectCameraIds: ['quebec_511_cameras'],
    rejectCameraIds: ['ohgo', 'ontario_511_cameras', 'caltrans_cctv'],
  },
  {
    id: 'spain',
    name: 'Madrid, Spain',
    latitude: 40.4168,
    longitude: -3.7038,
    expectCameraIds: [],
    rejectCameraIds: ['ohgo', 'caltrans_cctv', '511ny', 'digitraffic_road_cameras'],
  },
  {
    id: 'catalonia',
    name: 'Barcelona, Catalonia',
    latitude: 41.3874,
    longitude: 2.1686,
    expectCameraIds: [],
    rejectCameraIds: ['ohgo', 'caltrans_cctv', 'hong_kong_td_cameras'],
  },
  {
    id: 'finland',
    name: 'Helsinki, Finland',
    latitude: 60.1699,
    longitude: 24.9384,
    expectCameraIds: ['digitraffic_road_cameras'],
    rejectCameraIds: ['ohgo', 'caltrans_cctv', 'hong_kong_td_cameras'],
  },
  {
    id: 'singapore',
    name: 'Singapore',
    latitude: 1.3521,
    longitude: 103.8198,
    expectCameraIds: [],
    rejectCameraIds: ['ohgo', 'caltrans_cctv', '511ny', 'digitraffic_road_cameras', 'hong_kong_td_cameras'],
  },
  {
    id: 'hong_kong',
    name: 'Hong Kong',
    latitude: 22.3193,
    longitude: 114.1694,
    expectCameraIds: ['hong_kong_td_cameras'],
    rejectCameraIds: ['ohgo', 'caltrans_cctv', 'digitraffic_road_cameras'],
  },
]

export const TERRA_GLOBAL_COVERAGE_CATEGORIES = ['weather', 'poi'] as const
