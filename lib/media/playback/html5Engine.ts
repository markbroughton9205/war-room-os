/**
 * Single HTML5 Audio engine. Callers must not construct another Audio element.
 * Does not fetch/HEAD for health. Does not load a URL unless the controller
 * already decided the station is playback-eligible.
 */

export type Html5EngineEvents = {
  onPlaying?: () => void
  onPaused?: () => void
  onWaiting?: () => void
  onEnded?: () => void
  onError?: (message: string) => void
}

export class Html5PlaybackEngine {
  private audio: HTMLAudioElement | null = null
  private events: Html5EngineEvents = {}
  private bound = false

  /** The one audio element for War Room Media. */
  getAudio(): HTMLAudioElement {
    if (this.audio) return this.audio
    if (typeof Audio === 'undefined') {
      throw new Error('HTML5 Audio is not available in this environment.')
    }
    const audio = new Audio()
    audio.preload = 'none'
    audio.autoplay = false
    audio.hidden = true
    audio.setAttribute('data-testid', 'war-room-media-audio')
    if (typeof document !== 'undefined' && !audio.isConnected) {
      document.documentElement.appendChild(audio)
    }
    this.audio = audio
    this.attach(audio)
    return audio
  }

  hasAudio(): boolean {
    return this.audio !== null
  }

  setEvents(events: Html5EngineEvents) {
    this.events = events
  }

  private attach(audio: HTMLAudioElement) {
    if (this.bound) return
    this.bound = true
    audio.addEventListener('playing', () => this.events.onPlaying?.())
    audio.addEventListener('pause', () => this.events.onPaused?.())
    audio.addEventListener('waiting', () => this.events.onWaiting?.())
    audio.addEventListener('ended', () => this.events.onEnded?.())
    audio.addEventListener('error', () => {
      const err = audio.error
      const message = err
        ? `HTML5 audio error code ${err.code}`
        : 'HTML5 audio failed'
      this.events.onError?.(message)
    })
  }

  applyVolume(volume: number, muted: boolean) {
    const audio = this.getAudio()
    audio.volume = Math.min(1, Math.max(0, volume))
    audio.muted = muted
  }

  async playUrl(url: string, volume: number, muted: boolean): Promise<void> {
    const audio = this.getAudio()
    this.applyVolume(volume, muted)
    if (audio.src !== url) {
      audio.src = url
    }
    await audio.play()
  }

  pause() {
    this.audio?.pause()
  }

  /**
   * Stop output without destroying the element. Keeps the single-session contract.
   */
  stop() {
    if (!this.audio) return
    this.audio.pause()
    this.audio.removeAttribute('src')
    this.audio.load()
  }
}

let engine: Html5PlaybackEngine | null = null

export function getHtml5PlaybackEngine(): Html5PlaybackEngine {
  if (!engine) engine = new Html5PlaybackEngine()
  return engine
}
