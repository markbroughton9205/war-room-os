import type { LearnedPrefs } from './types'

export const GOVERNOR_PREFS_STORAGE_KEY = 'terra.layerGovernor.v1'
export const GOVERNOR_MASTER_STORAGE_KEY = 'terra.layerGovernor.masterAuto'
export const GOVERNOR_MODES_STORAGE_KEY = 'terra.layerGovernor.layerModes'

export function emptyLearnedPrefs(): LearnedPrefs {
  return {}
}

export function learnPresentationPref(current: LearnedPrefs, patch: LearnedPrefs): LearnedPrefs {
  return { ...current, ...patch }
}

export function resetLearnedPrefs(): LearnedPrefs {
  return emptyLearnedPrefs()
}

export function parseLearnedPrefs(raw: string | null): LearnedPrefs {
  if (!raw) return emptyLearnedPrefs()
  try {
    const parsed = JSON.parse(raw) as LearnedPrefs
    const next: LearnedPrefs = {}
    if (typeof parsed.streetCloudOpacity === 'number') next.streetCloudOpacity = clamp01(parsed.streetCloudOpacity)
    if (typeof parsed.cityRadarOpacity === 'number') next.cityRadarOpacity = clamp01(parsed.cityRadarOpacity)
    if (typeof parsed.buildingsAtStreet === 'boolean') next.buildingsAtStreet = parsed.buildingsAtStreet
    if (typeof parsed.roadEmphasis === 'boolean') next.roadEmphasis = parsed.roadEmphasis
    return next
  } catch {
    return emptyLearnedPrefs()
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}
