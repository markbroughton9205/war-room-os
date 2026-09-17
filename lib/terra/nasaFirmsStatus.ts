import 'server-only'

import type { TerraLiveProviderStatus } from './liveGeoIntelligence'

/**
 * NASA FIRMS (Fire Information for Resource Management System) status for Terra hazard counters.
 *
 * FIRMS MAP_KEY is required for the API. This build does not register a Research Engine adapter
 * (provider-registry count is locked) and does not add or expose a key. Unset key => AUTH_REQUIRED.
 * A present key is reported as credentialsPresent=true without fetching and without printing the value.
 *
 * A FIRMS detection is an ACTIVE FIRE / THERMAL ANOMALY observation. It is never automatically
 * labeled a wildfire.
 */
export function nasaFirmsLiveProviderStatus(): TerraLiveProviderStatus {
  const credentialsPresent = Boolean(process.env.NASA_FIRMS_MAP_KEY?.trim())
  return {
    id: 'nasa_firms',
    displayName: 'NASA FIRMS',
    layer: 'intelligence_events',
    implemented: true,
    configurationState: credentialsPresent ? 'ENABLED' : 'NEEDS_CREDENTIALS',
    freshness: credentialsPresent ? 'AUTH_REQUIRED' : 'AUTH_REQUIRED',
    reason: credentialsPresent
      ? 'NASA FIRMS MAP_KEY is present but detections are not fetched until a registered Research Engine adapter is approved. Thermal anomalies are not auto-labeled wildfires. Count is not shown as zero.'
      : 'NASA FIRMS MAP_KEY required for active-fire / thermal-anomaly API. Detections are not automatically wildfires. Protected key is never displayed.',
    objectCount: 0,
    credentialsPresent,
  }
}
