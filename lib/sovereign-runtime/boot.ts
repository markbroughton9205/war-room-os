/**
 * #22 Phase 10 — Local core boot state machine + discovery.
 * No silent website fallback. No auto-kill of unknown processes.
 */
import net from 'node:net'
import {
  LOCAL_CORE_HOST,
  LOCAL_CORE_PORT,
  type CoreBootState,
} from './constants'

export type DiscoveryResult = {
  boot_state: CoreBootState
  host: string
  port: number
  pid_claim: number | null
  conflict: boolean
  reason: string
  auto_kill_unknown: false
  website_fallback: 'DENIED'
}

export function createBootTracker(): {
  state: CoreBootState
  set: (s: CoreBootState) => void
  snapshot: () => CoreBootState
} {
  let state: CoreBootState = 'CORE_UNKNOWN'
  return {
    get state() {
      return state
    },
    set(s: CoreBootState) {
      state = s
    },
    snapshot: () => state,
  }
}

/** Probe TCP listen without connecting to public hosts. */
export function probeLoopbackPort(
  port: number = LOCAL_CORE_PORT,
  host: string = LOCAL_CORE_HOST,
  timeoutMs = 400,
): Promise<{ open: boolean }> {
  return new Promise(resolve => {
    const socket = net.connect({ host, port })
    const done = (open: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve({ open })
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

export async function discoverLocalCore(input?: {
  expectedToken?: string | null
  fetchHealth?: (url: string) => Promise<{ ok: boolean; identityMatch?: boolean }>
}): Promise<DiscoveryResult> {
  const base: DiscoveryResult = {
    boot_state: 'CORE_UNKNOWN',
    host: LOCAL_CORE_HOST,
    port: LOCAL_CORE_PORT,
    pid_claim: null,
    conflict: false,
    reason: '',
    auto_kill_unknown: false,
    website_fallback: 'DENIED',
  }

  const { open } = await probeLoopbackPort()
  if (!open) {
    return { ...base, boot_state: 'CORE_FAILED', reason: 'No listener on local core port.' }
  }

  if (input?.fetchHealth) {
    try {
      const health = await input.fetchHealth(`http://${LOCAL_CORE_HOST}:${LOCAL_CORE_PORT}/api/local/health`)
      if (!health.ok) {
        return {
          ...base,
          boot_state: 'CORE_PORT_CONFLICT',
          conflict: true,
          reason: 'Port occupied by non-War-Room or unhealthy process — not auto-killed.',
        }
      }
      return {
        ...base,
        boot_state: 'CORE_READY',
        reason: 'Local core health OK.',
      }
    } catch {
      return {
        ...base,
        boot_state: 'CORE_PORT_CONFLICT',
        conflict: true,
        reason: 'Port open but health probe failed — unknown process; fail safe.',
      }
    }
  }

  return { ...base, boot_state: 'CORE_RUNNING', reason: 'Port open; health not yet verified.' }
}

export type PortBindResult =
  | { ok: true }
  | { ok: false; status: 'CORE_PORT_CONFLICT'; reason: string; auto_kill_unknown: false }

export function classifyPortConflict(err: NodeJS.ErrnoException | null | undefined): PortBindResult {
  if (!err) return { ok: true }
  if (err.code === 'EADDRINUSE') {
    return {
      ok: false,
      status: 'CORE_PORT_CONFLICT',
      reason: `Port ${LOCAL_CORE_PORT} already in use — refuse to kill unknown process.`,
      auto_kill_unknown: false,
    }
  }
  return {
    ok: false,
    status: 'CORE_PORT_CONFLICT',
    reason: err.message || 'Bind failed',
    auto_kill_unknown: false,
  }
}

export function shouldFallbackToPublicWebsite(_coreFailed: boolean): false {
  return false
}

export type ShutdownScope = {
  stop_local_core: boolean
  stop_cloudflared: false
  stop_production_server: false
  stop_ollama: false
}

export function desktopShutdownPlan(stopCoreWithDesktop: boolean): ShutdownScope {
  return {
    stop_local_core: stopCoreWithDesktop,
    stop_cloudflared: false,
    stop_production_server: false,
    stop_ollama: false,
  }
}
