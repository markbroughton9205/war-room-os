import type { MediaPlaybackState } from './types'

/** Visible stream status. Never report LIVE AUDIO unless playbackState is playing. */
export function mediaStreamStatusLabel(state: MediaPlaybackState): 'LIVE AUDIO' | 'LOADING' | 'PAUSED' {
  if (state === 'playing') return 'LIVE AUDIO'
  if (state === 'loading') return 'LOADING'
  return 'PAUSED'
}
