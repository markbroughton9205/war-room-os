export type LocationMode = 'off' | 'city_only' | 'neighborhood' | 'precise_temporary'

export type CommanderLocationState = {
  mode: LocationMode
  city?: string
  neighborhood?: string
  preciseExpiresAt?: string
  historyStored: boolean
}

export const DEFAULT_COMMANDER_LOCATION: CommanderLocationState = {
  mode: 'city_only',
  city: 'Akron, OH',
  historyStored: false,
}

export function describeLocationMode(state: CommanderLocationState): string {
  if (state.mode === 'off') return 'Location off'
  if (state.mode === 'precise_temporary') return `Precise temporary${state.preciseExpiresAt ? ` until ${state.preciseExpiresAt}` : ''}`
  if (state.mode === 'neighborhood') return state.neighborhood ? `Neighborhood: ${state.neighborhood}` : 'Neighborhood mode'
  return state.city ? `City: ${state.city}` : 'City only'
}

export function canUsePreciseLocation(state: CommanderLocationState, now = new Date()): boolean {
  if (state.mode !== 'precise_temporary' || !state.preciseExpiresAt) return false
  const expires = Date.parse(state.preciseExpiresAt)
  return Number.isFinite(expires) && expires > now.getTime()
}

export function forgetLocationHistory(state: CommanderLocationState): CommanderLocationState {
  return {
    mode: state.mode === 'precise_temporary' ? 'city_only' : state.mode,
    city: state.city,
    neighborhood: state.neighborhood,
    historyStored: false,
  }
}
