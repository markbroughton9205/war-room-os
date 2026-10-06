import { ohioLbrsProvider } from './ohioLbrs'
import { summitAddressPointProvider } from './summitAddressPoints'
import type { PrecisionProvider } from './types'

function envEnabled(name: string): boolean {
  const value = process.env[name]?.trim()
  if (!value) return true
  return !/^(0|false|off|no)$/i.test(value)
}

export function isPrecisionPluginEnabled(flag: PrecisionProvider['pluginFlag']): boolean {
  if (flag === 'summit_address_points') return envEnabled('TERRA_SUMMIT_ADDRESS_POINTS')
  if (flag === 'ohio_lbrs') return envEnabled('TERRA_OHIO_LBRS')
  return true
}

/** County plugin first, then statewide, never worldwide. Future WR-GEOCODER plugs in beside these. */
export const PRECISION_PROVIDERS: PrecisionProvider[] = [
  summitAddressPointProvider,
  ohioLbrsProvider,
]

export function eligiblePrecisionProviders(): PrecisionProvider[] {
  return PRECISION_PROVIDERS.filter(provider => isPrecisionPluginEnabled(provider.pluginFlag))
}
