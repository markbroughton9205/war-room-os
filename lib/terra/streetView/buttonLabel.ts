import type { StreetViewState } from './types'

export function streetViewButtonLabel(state: StreetViewState | 'IDLE' | 'LOADING'): { primary: string; secondary: string | null } {
  if (state === 'IDLE') return { primary: 'Street View', secondary: null }
  if (state === 'LOADING') return { primary: 'Street View', secondary: 'Looking up' }
  if (state === 'AVAILABLE') return { primary: 'Street View', secondary: null }
  if (state === 'NO_COVERAGE') return { primary: 'Street View', secondary: 'No public coverage' }
  if (state === 'AUTH_REQUIRED') return { primary: 'Street View', secondary: 'Auth required' }
  if (state === 'PROVIDER_AUTH_REQUIRED') return { primary: 'Street View', secondary: 'Provider auth required' }
  if (state === 'ERROR_UPSTREAM') return { primary: 'Street View', secondary: 'Upstream error' }
  return { primary: 'Street View', secondary: 'Unavailable' }
}
