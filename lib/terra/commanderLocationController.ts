/**
 * Single LocationController. Terra components must not call navigator.geolocation directly.
 * Tracking starts only after locateOnce() or followMe(). Page load never requests permission.
 */
import {
  classifyBrowserSource,
  classifyNativeSource,
  deriveUiState,
  EMPTY_LOCATION_DIAGNOSTICS,
  INITIAL_COMMANDER_LOCATION_STATE,
  LOW_ACCURACY_METERS,
  readCommanderLocationFromPosition,
  STALE_FIX_MS,
  type CommanderLocation,
  type CommanderLocationDiagnostics,
  type CommanderLocationMode,
  type CommanderLocationState,
  type DesktopNativeLocationResult,
  type WarRoomDesktopBridge,
} from './commanderLocation'
import { PHONE_LOCATION_BRIDGE } from './phoneLocationBridge'

const GEO_OPTIONS_ONCE: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 20_000,
  maximumAge: 5_000,
}

const GEO_OPTIONS_WATCH: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 25_000,
  maximumAge: 8_000,
}

function linuxHint(platform: string | null): string {
  if (!platform || !/linux/i.test(platform)) return ''
  return ' Linux Chromium/Electron uses GeoClue2 (package geoclue-2.0, D-Bus org.freedesktop.GeoClue2) via xdg-desktop-portal. Without that OS location service, the API exists but position is UNAVAILABLE. Coordinates are never invented.'
}

function desktopBridge(): WarRoomDesktopBridge | null {
  if (typeof window === 'undefined') return null
  const candidate = (window as Window & { warRoomDesktop?: WarRoomDesktopBridge }).warRoomDesktop
  return candidate ?? null
}

export function readLocationDiagnostics(
  permissionState: CommanderLocationDiagnostics['permissionState'] = null,
): CommanderLocationDiagnostics {
  if (typeof window === 'undefined') return { ...EMPTY_LOCATION_DIAGNOSTICS, permissionState }
  const bridge = desktopBridge()
  return {
    geolocationApi: Boolean(navigator.geolocation),
    secureContext: window.isSecureContext === true,
    protocol: window.location.protocol,
    hostname: window.location.hostname,
    permissionState,
    platform: navigator.platform || null,
    nativeAdapter: bridge ? 'ready' : (typeof navigator.userAgent === 'string' && /Electron/i.test(navigator.userAgent) ? 'unavailable' : 'not_desktop'),
    phoneBridge: PHONE_LOCATION_BRIDGE.status,
  }
}

function unavailableReason(diagnostics: CommanderLocationDiagnostics, message: string): string {
  const parts = [message]
  if (!diagnostics.geolocationApi) parts.push('navigator.geolocation is missing in this runtime.')
  else if (!diagnostics.secureContext) {
    parts.push(`Geolocation requires a secure context; this page is ${diagnostics.protocol}//${diagnostics.hostname}. 127.0.0.1 is secure; a non-loopback http host is not.`)
  } else if (diagnostics.hostname === 'localhost') {
    parts.push('Prefer 127.0.0.1 as the canonical loopback host.')
  }
  parts.push(linuxHint(diagnostics.platform))
  return parts.filter(Boolean).join(' ')
}

function trackingForFix(mode: CommanderLocationMode, location: CommanderLocation): CommanderLocationState['tracking'] {
  if (location.accuracyMeters != null && location.accuracyMeters > LOW_ACCURACY_METERS) return 'DEGRADED'
  if (mode === 'FOLLOW_ME') return 'FOLLOWING'
  return 'OFF'
}

export class CommanderLocationController {
  private state: CommanderLocationState = {
    ...INITIAL_COMMANDER_LOCATION_STATE,
    diagnostics: readLocationDiagnostics(),
  }
  private listeners = new Set<(state: CommanderLocationState) => void>()
  private watchId: number | null = null
  private enabled = false
  private permissionListenerAttached = false

  getState(): CommanderLocationState {
    return this.state
  }

  subscribe(listener: (state: CommanderLocationState) => void): () => void {
    this.listeners.add(listener)
    listener(this.state)
    this.observePermission()
    return () => {
      this.listeners.delete(listener)
    }
  }

  locateOnce(): void {
    this.start('LOCATE_ONCE')
  }

  followMe(): void {
    this.start('FOLLOW_ME')
  }

  stop(): void {
    this.enabled = false
    this.clearWatch()
    this.setState({
      ...INITIAL_COMMANDER_LOCATION_STATE,
      diagnostics: readLocationDiagnostics(this.state.diagnostics.permissionState),
      permission: this.state.permission === 'DENIED' ? 'DENIED' : 'PROMPT',
      uiState: this.state.permission === 'DENIED' ? 'LOCATION_DENIED' : 'GPS_OFF',
      reason: this.state.permission === 'DENIED'
        ? 'Location permission denied. Manual search remains available. No coordinate was invented.'
        : INITIAL_COMMANDER_LOCATION_STATE.reason,
    })
  }

  setFollowCamera(followCamera: boolean): void {
    if (this.state.followCamera === followCamera) return
    this.setState({ ...this.state, followCamera })
  }

  destroy(): void {
    this.enabled = false
    this.clearWatch()
    this.listeners.clear()
  }

  private start(mode: CommanderLocationMode): void {
    const diagnostics = readLocationDiagnostics(this.state.diagnostics.permissionState)
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      this.setState({
        ...this.state,
        tracking: 'ERROR',
        mode: 'OFF',
        followCamera: false,
        permission: 'UNAVAILABLE',
        diagnostics,
        reason: unavailableReason(diagnostics, 'This runtime has no geolocation API.'),
        uiState: 'LOCATION_UNAVAILABLE',
        lastErrorCode: null,
      })
      return
    }
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      this.setState({
        ...this.state,
        tracking: 'ERROR',
        mode: 'OFF',
        followCamera: false,
        permission: 'UNAVAILABLE',
        diagnostics,
        reason: unavailableReason(diagnostics, 'Geolocation is blocked outside a secure context.'),
        uiState: 'LOCATION_UNAVAILABLE',
        lastErrorCode: null,
      })
      return
    }
    this.enabled = true
    this.clearWatch()
    this.setState({
      ...this.state,
      mode,
      tracking: 'LOCATING',
      followCamera: mode === 'FOLLOW_ME',
      permission: this.state.permission === 'DENIED' ? 'PROMPT' : this.state.permission,
      diagnostics,
      reason: mode === 'FOLLOW_ME'
        ? 'Requesting device location for FOLLOW ME. Browser permission is asked only because Commander pressed FOLLOW ME.'
        : 'Requesting a one-shot device location. Browser permission is asked only because Commander pressed LOCATE ME.',
      uiState: 'REQUESTING_PERMISSION',
      lastErrorCode: null,
      nativeTried: false,
    })
    navigator.geolocation.getCurrentPosition(
      position => this.onPosition(position, mode),
      error => {
        void this.onError(error, diagnostics, mode, true)
      },
      GEO_OPTIONS_ONCE,
    )
    if (mode === 'FOLLOW_ME') {
      this.watchId = navigator.geolocation.watchPosition(
        position => this.onPosition(position, 'FOLLOW_ME'),
        error => {
          void this.onError(error, diagnostics, 'FOLLOW_ME', false)
        },
        GEO_OPTIONS_WATCH,
      )
    }
  }

  private onPosition(position: GeolocationPosition, mode: CommanderLocationMode): void {
    if (!this.enabled) return
    const source = classifyBrowserSource(position.coords.accuracy)
    const location = readCommanderLocationFromPosition(position, source)
    const tracking = trackingForFix(mode, location)
    this.setState({
      location,
      permission: 'GRANTED',
      tracking,
      mode,
      followCamera: mode === 'FOLLOW_ME' ? this.state.followCamera : false,
      diagnostics: { ...this.state.diagnostics, permissionState: 'granted' },
      reason: `${sourceDisplay(location)} ±${location.accuracyMeters != null ? Math.round(location.accuracyMeters) : '?'} m. Nominatim is not used to obtain these coordinates.`,
      uiState: deriveUiState({ tracking, permission: 'GRANTED', location, mode, reason: '' }),
      lastErrorCode: null,
      nativeTried: this.state.nativeTried,
    })
  }

  private async onError(
    error: GeolocationPositionError,
    diagnostics: CommanderLocationDiagnostics,
    mode: CommanderLocationMode,
    allowNativeFallback: boolean,
  ): Promise<void> {
    if (!this.enabled) return
    if (error.code === error.PERMISSION_DENIED) {
      this.enabled = false
      this.clearWatch()
      this.setState({
        location: null,
        permission: 'DENIED',
        tracking: 'ERROR',
        mode: 'OFF',
        followCamera: false,
        diagnostics,
        reason: 'LOCATION DENIED. Browser/device permission was refused. Manual search remains functional. No coordinate was invented.',
        uiState: 'LOCATION_DENIED',
        lastErrorCode: error.code,
        nativeTried: this.state.nativeTried,
      })
      return
    }
    if (allowNativeFallback && (error.code === error.POSITION_UNAVAILABLE || error.code === error.TIMEOUT)) {
      const native = await this.tryNativeFix()
      if (native?.ok) {
        const location: CommanderLocation = {
          lat: native.lat,
          lon: native.lon,
          accuracyMeters: native.accuracyMeters,
          altitude: native.altitude,
          altitudeAccuracy: null,
          heading: native.heading,
          speed: native.speed,
          timestamp: native.timestamp,
          source: native.source,
        }
        const tracking = trackingForFix(mode, location)
        this.setState({
          location,
          permission: 'GRANTED',
          tracking,
          mode,
          followCamera: mode === 'FOLLOW_ME',
          diagnostics: { ...diagnostics, nativeAdapter: 'ready' },
          reason: `${sourceDisplay(location)} from native adapter. Accuracy is whatever GeoClue reported — never claimed as device GPS unless the source says so.`,
          uiState: deriveUiState({ tracking, permission: 'GRANTED', location, mode, reason: '' }),
          lastErrorCode: null,
          nativeTried: true,
        })
        return
      }
      if (native && !native.ok) {
        diagnostics = { ...diagnostics, nativeAdapter: 'unavailable' }
      }
    }
    if (error.code === error.POSITION_UNAVAILABLE) {
      if (this.state.location && this.state.mode === 'FOLLOW_ME') {
        this.setState({
          ...this.state,
          tracking: Date.now() - this.state.location.timestamp > STALE_FIX_MS ? 'DEGRADED' : this.state.tracking,
          diagnostics,
          reason: `${this.state.reason} Watch update UNAVAILABLE; keeping last device fix. Coordinates are never invented.`,
          uiState: 'STALE_LOCATION',
          lastErrorCode: error.code,
          nativeTried: this.state.nativeTried || Boolean(desktopBridge()),
        })
        return
      }
      this.enabled = mode === 'FOLLOW_ME'
      this.setState({
        location: this.state.location,
        permission: this.state.permission === 'GRANTED' ? 'GRANTED' : 'UNAVAILABLE',
        tracking: this.state.location ? 'DEGRADED' : 'ERROR',
        mode: this.state.location && mode === 'FOLLOW_ME' ? 'FOLLOW_ME' : 'OFF',
        followCamera: false,
        diagnostics,
        reason: unavailableReason(diagnostics, nativeTriedMessage(this.state.nativeTried || Boolean(desktopBridge()), 'Device position unavailable.')),
        uiState: this.state.location ? 'STALE_LOCATION' : (desktopBridge() ? 'NATIVE_LOCATION_UNAVAILABLE' : 'LOCATION_UNAVAILABLE'),
        lastErrorCode: error.code,
        nativeTried: this.state.nativeTried || Boolean(desktopBridge()),
      })
      return
    }
    if (error.code === error.TIMEOUT) {
      if (this.state.location) {
        this.setState({
          ...this.state,
          diagnostics,
          reason: `${this.state.reason} Location update timed out; keeping last device fix.`,
          uiState: 'STALE_LOCATION',
          lastErrorCode: error.code,
        })
        return
      }
      this.setState({
        location: null,
        permission: this.state.permission,
        tracking: 'ERROR',
        mode: 'OFF',
        followCamera: false,
        diagnostics,
        reason: unavailableReason(diagnostics, 'Geolocation timed out waiting for a device fix.'),
        uiState: 'LOCATION_UNAVAILABLE',
        lastErrorCode: error.code,
        nativeTried: this.state.nativeTried,
      })
      return
    }
    this.setState({
      location: this.state.location,
      permission: this.state.permission,
      tracking: 'ERROR',
      mode: this.state.location && mode === 'FOLLOW_ME' ? 'FOLLOW_ME' : 'OFF',
      followCamera: this.state.followCamera,
      diagnostics,
      reason: unavailableReason(diagnostics, error.message || 'Geolocation failed.'),
      uiState: this.state.location ? 'STALE_LOCATION' : 'LOCATION_UNAVAILABLE',
      lastErrorCode: error.code,
      nativeTried: this.state.nativeTried,
    })
  }

  private async tryNativeFix(): Promise<DesktopNativeLocationResult | null> {
    const bridge = desktopBridge()
    if (!bridge) return null
    this.setState({
      ...this.state,
      nativeTried: true,
      reason: 'Browser geolocation failed. Trying optional native GeoClue adapter. Coordinates will not be invented if GeoClue is unavailable.',
    })
    try {
      const result = await bridge.invoke('terra.nativeLocation.getFix')
      return result
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) }
    }
  }

  private observePermission(): void {
    if (this.permissionListenerAttached) return
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return
    this.permissionListenerAttached = true
    void navigator.permissions.query({ name: 'geolocation' as PermissionName }).then(result => {
      const apply = () => {
        const diagnostics = { ...readLocationDiagnostics(result.state), permissionState: result.state }
        if (this.state.tracking !== 'OFF' && this.state.tracking !== 'ERROR') {
          this.setState({ ...this.state, diagnostics })
          return
        }
        if (result.state === 'denied' && this.state.tracking === 'OFF' && !this.state.location) {
          this.setState({
            ...this.state,
            diagnostics,
            permission: 'DENIED',
            uiState: 'LOCATION_DENIED',
            reason: 'Location permission is currently denied. Pressing LOCATE ME or FOLLOW ME will not invent a coordinate.',
          })
          return
        }
        this.setState({
          ...this.state,
          diagnostics,
          permission: result.state === 'granted' ? 'GRANTED' : result.state === 'denied' ? 'DENIED' : 'PROMPT',
        })
      }
      apply()
      result.addEventListener('change', apply)
    }).catch(() => {
      this.setState({ ...this.state, diagnostics: readLocationDiagnostics('unsupported') })
    })
  }

  private clearWatch(): void {
    if (this.watchId !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(this.watchId)
    }
    this.watchId = null
  }

  private setState(next: CommanderLocationState): void {
    this.state = {
      ...next,
      uiState: deriveUiState(next),
    }
    for (const listener of this.listeners) listener(this.state)
  }
}

function sourceDisplay(location: CommanderLocation): string {
  return location.source.replaceAll('_', ' ')
}

function nativeTriedMessage(tried: boolean, message: string): string {
  return tried ? `${message} Native GeoClue was also unavailable.` : message
}
