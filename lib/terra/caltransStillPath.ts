export const CALTRANS_STILL_HOST = 'cwwp2.dot.ca.gov'
export const CALTRANS_STILL_PATH_PATTERN = /^d\d{1,2}\/cctv\/image\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.jpe?g$/i

export function isCaltransStillPath(path: string): boolean {
  if (!CALTRANS_STILL_PATH_PATTERN.test(path)) return false
  if (path.includes('..') || path.includes('\\') || path.startsWith('/') || path.includes('://')) return false
  return true
}

export function parseCaltransStillPath(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:') return null
  if (parsed.hostname.toLowerCase() !== CALTRANS_STILL_HOST) return null
  const match = parsed.pathname.match(/^\/data\/(d\d{1,2}\/cctv\/image\/.+)$/i)
  if (!match) return null
  return isCaltransStillPath(match[1]) ? match[1] : null
}

export function buildCaltransStillUrl(path: string): string | null {
  if (!isCaltransStillPath(path)) return null
  return `https://${CALTRANS_STILL_HOST}/data/${path}`
}
