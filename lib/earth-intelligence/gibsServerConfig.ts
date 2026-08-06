import 'server-only'
import { PUBLIC_GIBS_WMTS_BASE_URL } from '@/lib/earth-intelligence/gibsTileUrl'

/**
 * Server-only read of the NASA GIBS env var. GIBS itself is a public,
 * unauthenticated endpoint that takes no API key — there is nothing else to
 * read here. This exists only so a health-check route can confirm the
 * Vercel environment is wired up without exposing any secret value.
 */
export interface GibsServerConfigStatus {
  /** True if NASA_GIBS_WMTS_BASE_URL is set and matches the reviewed public base URL. */
  baseUrlConfigured: boolean
}

export function getGibsServerConfigStatus(): GibsServerConfigStatus {
  const configuredBaseUrl = process.env.NASA_GIBS_WMTS_BASE_URL
  return {
    baseUrlConfigured: Boolean(configuredBaseUrl && configuredBaseUrl === PUBLIC_GIBS_WMTS_BASE_URL),
  }
}
