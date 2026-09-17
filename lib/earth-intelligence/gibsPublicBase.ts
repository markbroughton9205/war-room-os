/**
 * Public NASA GIBS WMTS REST base URL (epsg3857, "best available" endpoint).
 * GIBS documents this as a public, unauthenticated endpoint — it takes no API
 * key. This constant is safe to ship to the browser. It exists as its own
 * module so server-only config (`gibsServerConfig.ts`) can compare the
 * NASA_GIBS_WMTS_BASE_URL env var against the reviewed public host without
 * importing the client tile-URL builder (`gibsTileUrl.ts`).
 */
export const PUBLIC_GIBS_WMTS_BASE_URL = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/'
