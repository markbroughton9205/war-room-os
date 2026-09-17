const MAPILLARY_HOSTS = ['graph.mapillary.com', 'www.mapillary.com', 'mapillary.com']
const PANORAMAX_HOSTS = [
  'api.panoramax.xyz',
  'panoramax.xyz',
  'api.panoramax.fr',
  'panoramax.fr',
  'panoramax.openstreetmap.fr',
]

export function isGoogleStreetViewHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === 'google.com'
    || host.endsWith('.google.com')
    || host === 'googleapis.com'
    || host.endsWith('.googleapis.com')
    || host.includes('streetview') && host.includes('google')
}

export function isAllowedStreetViewHost(hostname: string, extraHosts: readonly string[] = []): boolean {
  if (isGoogleStreetViewHost(hostname)) return false
  const host = hostname.toLowerCase()
  if (MAPILLARY_HOSTS.includes(host) || PANORAMAX_HOSTS.includes(host)) return true
  return extraHosts.some(allowed => allowed.toLowerCase() === host)
}

export function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}
