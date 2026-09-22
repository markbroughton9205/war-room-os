/**
 * Local NASA / NASA-derived equirectangular maps for the homepage Earth.
 * Static reference imagery — not a live GIBS mosaic.
 */

export const EARTH_ASSET_DIR = '/terra/home-earth'

export const EARTH_ASSETS = {
  day2k: `${EARTH_ASSET_DIR}/day-2k.jpg`,
  day4k: `${EARTH_ASSET_DIR}/day-4k.jpg`,
  clouds2k: `${EARTH_ASSET_DIR}/clouds-2k.jpg`,
  night2k: `${EARTH_ASSET_DIR}/night-lights.png`,
  specular2k: `${EARTH_ASSET_DIR}/specular-2k.jpg`,
  normal2k: `${EARTH_ASSET_DIR}/normal-2k.jpg`,
} as const

export const EARTH_VISUAL_LABEL = 'Earth visual · NASA Blue Marble'
export const EARTH_STATUS_LABEL = 'Terra · Connected'

export const EARTH_ASSET_RECORDS = [
  {
    file: 'day-2k.jpg',
    source: 'NASA Visible Earth Blue Marble land_shallow_topo (ID 57752)',
    license: 'public-domain',
    resolution: '2048x1024',
    path: EARTH_ASSETS.day2k,
    attribution: 'NASA GSFC / Reto Stöckli',
  },
  {
    file: 'day-4k.jpg',
    source: 'NASA Blue Marble via three-globe example earth-blue-marble.jpg',
    license: 'public-domain',
    resolution: '4096x2048',
    path: EARTH_ASSETS.day4k,
    attribution: 'NASA Blue Marble',
  },
  {
    file: 'clouds-2k.jpg',
    source: 'NASA Visible Earth Blue Marble clouds (ID 57747)',
    license: 'public-domain',
    resolution: '2048x1024',
    path: EARTH_ASSETS.clouds2k,
    attribution: 'NASA GSFC / Reto Stöckli',
  },
  {
    file: 'night-lights.png',
    source: 'NASA DMSP city lights (three.js earth_lights_2048.png)',
    license: 'public-domain',
    resolution: '2048x1024',
    path: EARTH_ASSETS.night2k,
    attribution: 'NASA / DMSP',
  },
  {
    file: 'specular-2k.jpg',
    source: 'three.js examples earth_specular_2048.jpg (NASA-derived ocean mask)',
    license: 'public-domain',
    resolution: '2048x1024',
    path: EARTH_ASSETS.specular2k,
    attribution: 'NASA-derived / three.js examples',
  },
  {
    file: 'normal-2k.jpg',
    source: 'three.js examples earth_normal_2048.jpg (subtle orbital relief)',
    license: 'public-domain',
    resolution: '2048x1024',
    path: EARTH_ASSETS.normal2k,
    attribution: 'NASA-derived / three.js examples',
  },
] as const
