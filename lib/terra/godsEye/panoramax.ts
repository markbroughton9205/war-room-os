/**
 * Panoramax — open/self-host street imagery option inside Street Intelligence.
 * Does not replace Cesium. Does not claim global Street View parity.
 *
 * Official: https://gitlab.com/panoramax · https://panoramax.fr
 * Server license: AGPL-3.0. Contributor photos keep their own licenses (often CC BY-SA).
 * Do not auto-hit a public instance. Configure NEXT_PUBLIC_PANORAMAX_INSTANCE_URL to probe.
 */
import type { GodsEyeLayerTruthState } from './coverageStates'
import type { GodsEyeEvaluationState } from './coverageStates'

export const PANORAMAX_STATUS: GodsEyeEvaluationState = 'EVALUATION_ACTIVE'
export const PANORAMAX_LICENSE = 'AGPL-3.0 (server/viewer) · contributor imagery licenses apply'
export const PANORAMAX_SOURCE_URL = 'https://gitlab.com/panoramax'
export const PANORAMAX_DOCS_URL = 'https://docs.panoramax.fr/'
export const PANORAMAX_INSTANCE_ENV = 'NEXT_PUBLIC_PANORAMAX_INSTANCE_URL'
export const PANORAMAX_GLOBAL_PARITY = false
export const PANORAMAX_REPLACES_CESIUM = false

export type PanoramaxProviderState = {
  id: 'PANORAMAX'
  status: typeof PANORAMAX_STATUS
  coverageState: GodsEyeLayerTruthState
  coverageScope: 'LOCAL' | 'REGIONAL'
  instanceUrl: string | null
  requiresInstance: true
  globalStreetViewParity: false
  replacesCesium: false
  license: typeof PANORAMAX_LICENSE
  honesty: string
}

export function panoramaxInstanceConfigured(instanceUrl: string | null | undefined): boolean {
  return Boolean(instanceUrl && instanceUrl.trim())
}

export function panoramaxProviderState(instanceUrl: string | null | undefined): PanoramaxProviderState {
  const configured = panoramaxInstanceConfigured(instanceUrl)
  return {
    id: 'PANORAMAX',
    status: PANORAMAX_STATUS,
    coverageState: configured ? 'PARTIAL' : 'NO_COVERAGE',
    coverageScope: 'LOCAL',
    instanceUrl: configured ? instanceUrl!.trim() : null,
    requiresInstance: true,
    globalStreetViewParity: false,
    replacesCesium: false,
    license: PANORAMAX_LICENSE,
    honesty: configured
      ? 'Panoramax instance is configured. Coverage is LOCAL/REGIONAL for that instance — never global Street View parity. Cesium stays the globe.'
      : 'Panoramax architecture is EVALUATION_ACTIVE. Set NEXT_PUBLIC_PANORAMAX_INSTANCE_URL for a self-host or regional instance. Unconfigured imagery is NO_COVERAGE, not a fake panorama.',
  }
}
