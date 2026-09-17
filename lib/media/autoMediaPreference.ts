import { MEDIA_AUTO_MODES, type MediaAutoMode } from './types'

export const MEDIA_AUTO_MODE_STORAGE_KEY = 'war-room-media-auto-mode'
export const DEFAULT_MEDIA_AUTO_MODE: MediaAutoMode = 'SURFACE_ONLY'

export function parseMediaAutoMode(value: string | null | undefined): MediaAutoMode {
  if (value && (MEDIA_AUTO_MODES as readonly string[]).includes(value)) {
    const mode = value as MediaAutoMode
    // PLAY_AND_SURFACE is retained for compatibility but never auto-plays.
    return mode === 'PLAY_AND_SURFACE' ? 'SURFACE_ONLY' : mode
  }
  return DEFAULT_MEDIA_AUTO_MODE
}

export function readMediaAutoMode(): MediaAutoMode {
  if (typeof window === 'undefined') return DEFAULT_MEDIA_AUTO_MODE
  try {
    return parseMediaAutoMode(window.localStorage.getItem(MEDIA_AUTO_MODE_STORAGE_KEY))
  } catch {
    return DEFAULT_MEDIA_AUTO_MODE
  }
}

export function persistMediaAutoMode(mode: MediaAutoMode): void {
  if (typeof window === 'undefined') return
  try {
    const stored = mode === 'PLAY_AND_SURFACE' ? 'SURFACE_ONLY' : mode
    window.localStorage.setItem(MEDIA_AUTO_MODE_STORAGE_KEY, stored)
  } catch {
    // Preference is local-only; a blocked store must not break playback.
  }
}

export function mediaAutoModeLabel(mode: MediaAutoMode): string {
  if (mode === 'OFF') return 'Off'
  return 'Surface Only'
}
