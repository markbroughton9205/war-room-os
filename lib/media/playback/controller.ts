import { MEDIA_ALERT_DUCK_POLICY_NOTE, decideAlertDuck } from '@/lib/media/alerts/duckPolicy'
import { persistMediaAutoMode, readMediaAutoMode } from '@/lib/media/autoMediaPreference'
import { getHtml5PlaybackEngine } from '@/lib/media/playback/html5Engine'
import { buildProvenance, isPlaybackEligible, isNeverPinStreamUrl, playbackBlockReason } from '@/lib/media/provenance'
import { getFederatedStations } from '@/lib/media/federation'
import { getMediaStationById } from '@/lib/media/stationRegistry'
import type {
  MediaAutoMode,
  MediaNormalizedState,
  MediaOrigin,
  MediaStation,
  MediaSurfaceReason,
  MediaTabId,
  MediaWindowPosition,
} from '@/lib/media/types'

const DEFAULT_VOLUME = 0.8
const LAST_STATION_STORAGE_KEY = 'war-room-media-last-station-id'
const VOLUME_STORAGE_KEY = 'war-room-media-volume'

function readStorage(key: string, store: 'session' | 'local'): string | null {
  if (typeof window === 'undefined') return null
  try {
    const bucket = store === 'session' ? window.sessionStorage : window.localStorage
    return bucket.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string | null) {
  if (typeof window === 'undefined') return
  for (const store of ['sessionStorage', 'localStorage'] as const) {
    try {
      if (!value) window[store].removeItem(key)
      else window[store].setItem(key, value)
    } catch {
      // Identity/volume restore is optional.
    }
  }
}

function readLastStationId(): string | null {
  return readStorage(LAST_STATION_STORAGE_KEY, 'session')?.trim()
    || readStorage(LAST_STATION_STORAGE_KEY, 'local')?.trim()
    || null
}

function persistLastStationId(id: string | null) {
  writeStorage(LAST_STATION_STORAGE_KEY, id)
}

function readPersistedVolume(): number | null {
  const raw = readStorage(VOLUME_STORAGE_KEY, 'local') ?? readStorage(VOLUME_STORAGE_KEY, 'session')
  if (!raw) return null
  const next = Number(raw)
  if (!Number.isFinite(next)) return null
  return Math.min(1, Math.max(0, next))
}

function persistVolume(volume: number) {
  writeStorage(VOLUME_STORAGE_KEY, String(volume))
}

function defaultState(): MediaNormalizedState {
  return {
    station: null,
    playbackState: 'idle',
    volume: DEFAULT_VOLUME,
    muted: false,
    health: 'UNAVAILABLE',
    source: null,
    alertDuckState: {
      enabled: false,
      ducking: false,
      previousVolume: null,
      policyNote: MEDIA_ALERT_DUCK_POLICY_NOTE,
    },
    errorMessage: null,
    presentation: 'closed',
    pinned: false,
    activeTab: 'radio',
    sourceInfoOpen: false,
    windowPosition: null,
    headerLauncherMounted: false,
    windowFocusNonce: 0,
    autoMediaMode: 'SURFACE_ONLY',
    surfaceReason: null,
    origin: 'manual',
  }
}

type Listener = () => void

const SERVER_SNAPSHOT: MediaNormalizedState = defaultState()

export class MediaPlaybackController {
  private state: MediaNormalizedState = defaultState()
  private readonly listeners = new Set<Listener>()
  private readonly engine = typeof Audio === 'undefined' ? null : getHtml5PlaybackEngine()
  private readonly stations = getFederatedStations()
  private pendingAudiblePlay = false
  private surfaceMounted = false
  private shellLauncherMounts = 0
  private terraWorkspaceSurfaceMounts = 0
  private terraWorkspaceSurfaceActive = false
  /** True only after an explicit Commander Play gesture in this JS session. */
  private commanderPlaybackAuthorized = false

  constructor() {
    this.engine?.setEvents({
      onPlaying: () => this.patch({ playbackState: 'playing', errorMessage: null }),
      onPaused: () => {
        if (this.state.playbackState === 'loading') return
        if (this.state.playbackState === 'idle') return
        this.patch({ playbackState: 'paused' })
      },
      onWaiting: () => {
        if (this.state.playbackState === 'playing') this.patch({ playbackState: 'loading' })
      },
      onEnded: () => this.patch({ playbackState: 'idle' }),
      onError: message => this.patch({ playbackState: 'error', errorMessage: message }),
    })
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getState = (): MediaNormalizedState => this.state

  getServerSnapshot = (): MediaNormalizedState => SERVER_SNAPSHOT

  getStations(): MediaStation[] {
    return this.stations.map(entry => ({ ...entry }))
  }

  private emit() {
    for (const listener of this.listeners) listener()
  }

  private patch(partial: Partial<MediaNormalizedState>) {
    this.state = { ...this.state, ...partial }
    this.emit()
  }

  private isFloatingSurfaceVisible(): boolean {
    return this.state.presentation === 'window' || this.state.presentation === 'compact'
  }

  private isSurfaceVisible(): boolean {
    return this.terraWorkspaceSurfaceActive || this.isFloatingSurfaceVisible()
  }

  private canEmitAudio(): boolean {
    return this.surfaceMounted && this.isSurfaceVisible()
  }

  private ensureVisibleSurface() {
    if (this.terraWorkspaceSurfaceActive) return
    if (this.isFloatingSurfaceVisible()) return
    this.patch({ presentation: 'compact' })
  }

  private applyStation(
    station: MediaStation | null,
    meta?: { origin?: MediaOrigin; surfaceReason?: MediaSurfaceReason | null },
  ) {
    this.patch({
      station,
      source: buildProvenance(station),
      health: station?.verificationState ?? 'UNAVAILABLE',
      errorMessage: station && !isPlaybackEligible(station) ? playbackBlockReason(station) : null,
      origin: meta?.origin ?? this.state.origin,
      surfaceReason: meta?.surfaceReason === undefined ? this.state.surfaceReason : meta.surfaceReason,
    })
    persistLastStationId(station?.id ?? null)
  }

  private effectiveAutoMediaMode(): Exclude<MediaAutoMode, 'PLAY_AND_SURFACE'> {
    return this.state.autoMediaMode === 'OFF' ? 'OFF' : 'SURFACE_ONLY'
  }

  setHeaderLauncherMounted(mounted: boolean) {
    this.shellLauncherMounts = Math.max(0, this.shellLauncherMounts + (mounted ? 1 : -1))
    const next = this.shellLauncherMounts > 0
    if (this.state.headerLauncherMounted === next) return
    this.patch({ headerLauncherMounted: next })
  }

  setTerraWorkspaceSurfaceActive(active: boolean) {
    this.terraWorkspaceSurfaceMounts = Math.max(0, this.terraWorkspaceSurfaceMounts + (active ? 1 : -1))
    this.terraWorkspaceSurfaceActive = this.terraWorkspaceSurfaceMounts > 0
  }

  isTerraWorkspaceSurfaceActive(): boolean {
    return this.terraWorkspaceSurfaceActive
  }

  /** Hide MediaWindow/compact without stopping authorized audio. */
  dismissFloatingPresentation() {
    if (this.state.presentation === 'closed') return
    this.patch({ presentation: 'closed', sourceInfoOpen: false })
  }

  hydrateAutoMediaMode() {
    const mode = readMediaAutoMode()
    if (this.state.autoMediaMode === mode) return
    this.patch({ autoMediaMode: mode })
  }

  /**
   * Restore last station identity as PAUSED on a fresh controller.
   * Never restores audible playback. Does not interrupt an already-authorized session.
   */
  hydrateSession() {
    this.hydrateAutoMediaMode()
    const volume = readPersistedVolume()
    if (volume != null && volume !== this.state.volume) this.patch({ volume })
    if (this.commanderPlaybackAuthorized && (this.state.playbackState === 'playing' || this.state.playbackState === 'loading')) {
      return
    }
    if (this.state.station) return
    this.commanderPlaybackAuthorized = false
    this.pendingAudiblePlay = false
    const id = readLastStationId()
    const station = id ? getMediaStationById(id) : null
    if (!station) return
    this.applyStation(station, { origin: 'manual', surfaceReason: 'RESTORED_SESSION' })
    this.patch({ playbackState: 'paused' })
  }

  /**
   * Rail / window open: keep current station, else restore last, else registry default.
   * Never starts audible playback by itself. Never opens MediaWindow/compact on Terra.
   */
  ensureStationSelected() {
    if (this.state.station) return
    this.hydrateSession()
    if (this.state.station) return
    const fallback = this.stations[0]
    if (!fallback) return
    this.applyStation(fallback, { origin: 'manual', surfaceReason: null })
    this.patch({ playbackState: 'paused' })
  }

  /**
   * Explicit Commander WAR ROOM MEDIA click: select a station if needed, then
   * start/resume audio. Does not restart an already-playing stream.
   */
  activateFromCommanderRail() {
    this.ensureStationSelected()
    if (this.state.playbackState === 'playing' || this.state.playbackState === 'loading') return
    this.playFromCommanderGesture()
  }

  setAutoMediaMode(mode: MediaAutoMode) {
    const next = mode === 'PLAY_AND_SURFACE' ? 'SURFACE_ONLY' : mode
    persistMediaAutoMode(next)
    this.patch({ autoMediaMode: next })
  }

  cycleAutoMediaMode() {
    const next = this.effectiveAutoMediaMode() === 'OFF' ? 'SURFACE_ONLY' : 'OFF'
    this.setAutoMediaMode(next)
  }

  openWindow() {
    if (this.terraWorkspaceSurfaceActive) return
    this.patch({ presentation: 'window' })
    this.ensureStationSelected()
  }

  launch() {
    if (this.terraWorkspaceSurfaceActive) return
    if (this.state.presentation === 'closed') {
      this.openWindow()
      return
    }
    if (this.state.presentation === 'compact') {
      this.restore()
      return
    }
    this.focusWindow()
  }

  focusWindow() {
    if (this.state.presentation !== 'window') {
      this.openWindow()
      return
    }
    this.patch({ windowFocusNonce: this.state.windowFocusNonce + 1 })
  }

  minimize() {
    if (this.terraWorkspaceSurfaceActive) return
    if (this.state.presentation === 'closed') return
    this.patch({ presentation: 'compact' })
  }

  restore() {
    if (this.terraWorkspaceSurfaceActive) return
    this.patch({ presentation: 'window' })
  }

  close() {
    this.pendingAudiblePlay = false
    this.commanderPlaybackAuthorized = false
    this.stopAudio()
    this.patch({ presentation: 'closed', sourceInfoOpen: false })
  }

  togglePinned() {
    this.patch({ pinned: !this.state.pinned })
  }

  setActiveTab(tab: MediaTabId) {
    if (tab !== 'radio') return
    this.patch({ activeTab: 'radio' })
  }

  toggleSourceInfo() {
    this.patch({ sourceInfoOpen: !this.state.sourceInfoOpen })
  }

  openSourceInfo() {
    this.patch({ sourceInfoOpen: true })
  }

  setWindowPosition(position: MediaWindowPosition) {
    this.patch({ windowPosition: position })
  }

  setDuckEnabled(enabled: boolean) {
    this.patch({
      alertDuckState: {
        ...this.state.alertDuckState,
        enabled,
        ducking: false,
        previousVolume: null,
      },
    })
  }

  selectStation(id: string, origin: MediaOrigin = 'manual') {
    this.selectStationInternal(id, origin, false)
  }

  /**
   * Auto Media may surface a station/card. It must never start audible playback.
   * PLAY_AND_SURFACE is coerced to SURFACE_ONLY.
   */
  autoSelectStation(id: string, reason: MediaSurfaceReason = 'LOCAL_MEDIA') {
    if (this.effectiveAutoMediaMode() === 'OFF') return
    if (this.state.playbackState === 'playing' || this.state.playbackState === 'loading') return
    const station = getMediaStationById(id)
    if (!station) {
      this.patch({ errorMessage: `Unknown station: ${id}` })
      return
    }
    this.stopAudio()
    this.applyStation(station, { origin: 'auto', surfaceReason: reason })
    this.patch({ playbackState: 'paused' })
    this.ensureVisibleSurface()
  }

  notifySurfaceMounted() {
    this.surfaceMounted = true
    if (!this.pendingAudiblePlay || !this.commanderPlaybackAuthorized) return
    if (!this.canEmitAudio()) return
    this.pendingAudiblePlay = false
    void this.play()
  }

  notifySurfaceUnmounted() {
    this.surfaceMounted = false
  }

  /**
   * Alerts may duck volume only while Commander audio is already playing.
   * An alert must never start a station.
   */
  applyAlertDuck(severity: string | null | undefined, alertId?: string) {
    const playing = this.state.playbackState === 'playing'
    const decision = decideAlertDuck({
      severity,
      duckingEnabled: this.state.alertDuckState.enabled,
      alreadyDuckedForAlertId: Boolean(alertId && this.state.alertDuckState.ducking),
      audioAlreadyPlaying: playing,
    })
    if (decision.action !== 'duck' || !playing) return
    const previous = this.state.alertDuckState.previousVolume ?? this.state.volume
    this.engine?.applyVolume(Math.min(this.state.volume, 0.2), this.state.muted)
    this.patch({
      alertDuckState: {
        ...this.state.alertDuckState,
        ducking: true,
        previousVolume: previous,
      },
    })
  }

  private requestAudiblePlay() {
    if (!this.commanderPlaybackAuthorized) {
      this.pendingAudiblePlay = false
      return
    }
    if (this.canEmitAudio()) {
      this.pendingAudiblePlay = false
      void this.play()
      return
    }
    this.pendingAudiblePlay = true
    this.ensureVisibleSurface()
  }

  /** Authoritative PAUSED → PLAYING gate. Play button only. */
  playFromCommanderGesture() {
    this.commanderPlaybackAuthorized = true
    this.requestAudiblePlay()
  }

  async play() {
    if (!this.commanderPlaybackAuthorized) {
      this.pendingAudiblePlay = false
      return
    }
    if (!this.canEmitAudio()) {
      this.pendingAudiblePlay = true
      this.ensureVisibleSurface()
      return
    }
    const station = this.state.station
    const blocked = playbackBlockReason(station)
    if (!station || blocked || !isPlaybackEligible(station) || !station.streamUrl) {
      this.patch({
        playbackState: 'error',
        errorMessage: blocked ?? 'Playback is unavailable.',
      })
      return
    }
    if (isNeverPinStreamUrl(station.streamUrl)) {
      this.patch({ playbackState: 'error', errorMessage: playbackBlockReason(station) })
      return
    }
    if (!this.engine) {
      this.patch({ playbackState: 'error', errorMessage: 'HTML5 Audio is not available.' })
      return
    }
    if (
      (this.state.playbackState === 'playing' || this.state.playbackState === 'loading')
      && this.engine.isCurrentUrlPlaying(station.streamUrl)
    ) {
      return
    }
    this.patch({ playbackState: 'loading', errorMessage: null })
    try {
      await this.engine.playUrl(station.streamUrl, this.state.volume, this.state.muted)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'HTML5 audio play failed'
      this.patch({ playbackState: 'error', errorMessage: message })
    }
  }

  pause() {
    this.pendingAudiblePlay = false
    this.engine?.pause()
    if (this.state.playbackState === 'playing' || this.state.playbackState === 'loading') {
      this.patch({ playbackState: 'paused' })
    }
  }

  togglePlay() {
    if (this.state.playbackState === 'playing' || this.state.playbackState === 'loading') {
      this.pause()
      return
    }
    this.playFromCommanderGesture()
  }

  setVolume(volume: number) {
    const next = Math.min(1, Math.max(0, volume))
    this.engine?.applyVolume(next, this.state.muted)
    this.patch({ volume: next })
    persistVolume(next)
  }

  setMuted(muted: boolean) {
    this.engine?.applyVolume(this.state.volume, muted)
    this.patch({ muted })
  }

  toggleMuted() {
    this.setMuted(!this.state.muted)
  }

  previousStation() {
    this.cycleStation(-1)
  }

  nextStation() {
    this.cycleStation(1)
  }

  private selectStationInternal(id: string, origin: MediaOrigin, continueIfPlaying: boolean) {
    const station = getMediaStationById(id)
    if (!station) {
      this.patch({ errorMessage: `Unknown station: ${id}` })
      return
    }
    const reason: MediaSurfaceReason = origin === 'auto' ? (this.state.surfaceReason ?? 'LOCAL_MEDIA') : 'COMMANDER_SELECTED'
    const keepPlaying =
      continueIfPlaying
      && this.commanderPlaybackAuthorized
      && (this.state.playbackState === 'playing' || this.state.playbackState === 'loading')
    if (this.state.station?.id === station.id) {
      this.patch({ origin, surfaceReason: reason })
      return
    }
    this.stopAudio()
    this.applyStation(station, { origin, surfaceReason: reason })
    if (keepPlaying && isPlaybackEligible(station)) {
      this.requestAudiblePlay()
      return
    }
    this.patch({ playbackState: 'paused' })
  }

  private cycleStation(delta: number) {
    if (this.stations.length === 0) return
    const currentId = this.state.station?.id
    const index = Math.max(0, this.stations.findIndex(entry => entry.id === currentId))
    const next = this.stations[(index + delta + this.stations.length) % this.stations.length]
    if (next) this.selectStationInternal(next.id, 'manual', true)
  }

  private stopAudio() {
    this.pendingAudiblePlay = false
    this.engine?.stop()
    if (this.state.playbackState !== 'idle') this.patch({ playbackState: 'idle' })
  }
}

let browserController: MediaPlaybackController | null = null

export function getMediaPlaybackController(): MediaPlaybackController {
  if (typeof window === 'undefined') return new MediaPlaybackController()
  if (!browserController) browserController = new MediaPlaybackController()
  return browserController
}
