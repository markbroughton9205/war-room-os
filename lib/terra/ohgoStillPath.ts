/**
 * OHGO stills are public JPEGs on itscameras.dot.state.oh.us, not a {id}.jpg pattern.
 * Live-verified this build: GET https://itscameras.dot.state.oh.us/images/CMH/2134.jpg
 * returns image/jpeg (JPEG magic bytes). The client never supplies a URL — only the
 * path under /images/, reconstructed server-side by the camera-image proxy.
 */
export const OHGO_STILL_HOST = 'itscameras.dot.state.oh.us'
export const OHGO_STILL_PATH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_./-]{0,180}\.jpe?g$/i

export function isOhgoStillPath(path: string): boolean {
  if (!OHGO_STILL_PATH_PATTERN.test(path)) return false
  if (path.includes('..') || path.includes('\\') || path.startsWith('/') || path.includes('://')) return false
  return true
}

export function parseOhgoStillPath(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:') return null
  if (parsed.hostname.toLowerCase() !== OHGO_STILL_HOST) return null
  const match = parsed.pathname.match(/^\/images\/(.+\.jpe?g)$/i)
  if (!match) return null
  const path = match[1]
  return isOhgoStillPath(path) ? path : null
}

export function buildOhgoStillUrl(path: string): string | null {
  if (!isOhgoStillPath(path)) return null
  return `https://${OHGO_STILL_HOST}/images/${path}`
}
