/**
 * #22 Phase 11A — Local Next War Room UI runtime (loopback :3848).
 * Owns only the child it starts. Never touches :3000 / :3001 / cloudflared / Ollama.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import {
  LOCAL_CORE_HOST,
  LOCAL_UI_ORIGIN,
  LOCAL_UI_PORT,
  type UiBootState,
} from './constants'

export type LocalUiHandle = {
  port: typeof LOCAL_UI_PORT
  origin: typeof LOCAL_UI_ORIGIN
  boot: UiBootState
  owned_pid: number | null
  stop: () => Promise<void>
}

function probePort(port: number, host = LOCAL_CORE_HOST, ms = 400): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.connect({ host, port })
    const done = (open: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(ms)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

export async function probeLocalWarRoomUi(origin = LOCAL_UI_ORIGIN): Promise<{
  ok: boolean
  boot: UiBootState
  status: number | null
  looks_like_war_room: boolean
  detail: string
}> {
  try {
    const res = await fetch(`${origin}/`, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(4000),
    })
    // 200 OK, or 307/302 to /login — both mean Next War Room UI is serving
    const status = res.status
    const loc = res.headers.get('location') || ''
    const body = status === 200 ? await res.text().catch(() => '') : ''
    const looks =
      status === 200
        ? /War Room|Higher Vision|Council|GodsEye|Command/i.test(body) || body.includes('__NEXT')
        : (status === 307 || status === 302) && (/\/login/.test(loc) || loc.startsWith('/'))
    if (looks || status === 200) {
      return {
        ok: true,
        boot: 'UI_READY',
        status,
        looks_like_war_room: Boolean(looks || status === 200),
        detail: `HTTP ${status}`,
      }
    }
    // Port answered but not our app
    return {
      ok: false,
      boot: 'UI_PORT_CONFLICT',
      status,
      looks_like_war_room: false,
      detail: `Unexpected response ${status}`,
    }
  } catch (err) {
    return {
      ok: false,
      boot: 'UI_FAILED',
      status: null,
      looks_like_war_room: false,
      detail: err instanceof Error ? err.message : String(err),
    }
  }
}

export function resolveRepoRoot(fromFileUrlDir?: string): string {
  // lib/sovereign-runtime → repo root
  if (fromFileUrlDir) return path.resolve(fromFileUrlDir, '..', '..')
  return process.cwd()
}

export function assertLocalNextArtifacts(repoRoot: string): {
  ok: boolean
  has_next_build: boolean
  has_next_bin: boolean
  has_page: boolean
  has_cesium: boolean
  missing: string[]
} {
  const missing: string[] = []
  const has_next_build = fs.existsSync(path.join(repoRoot, '.next', 'BUILD_ID'))
  const has_next_bin =
    fs.existsSync(path.join(repoRoot, 'node_modules', 'next', 'dist', 'bin', 'next')) ||
    fs.existsSync(path.join(repoRoot, 'node_modules', '.bin', 'next')) ||
    fs.existsSync(path.join(repoRoot, 'node_modules', '.bin', 'next.CMD'))
  const has_page =
    fs.existsSync(path.join(repoRoot, 'app', 'page.tsx')) &&
    (fs.existsSync(path.join(repoRoot, '.next', 'server', 'app', 'page.js')) || has_next_build)
  const has_cesium =
    fs.existsSync(path.join(repoRoot, 'public', 'cesium')) ||
    fs.existsSync(path.join(repoRoot, 'public', 'cesium', 'Cesium.js'))
  if (!has_next_build) missing.push('.next/BUILD_ID')
  if (!has_next_bin) missing.push('node_modules/next')
  if (!has_page) missing.push('app/page.tsx or .next page')
  if (!has_cesium) missing.push('public/cesium')
  return {
    ok: has_next_build && has_next_bin && Boolean(has_page),
    has_next_build,
    has_next_bin,
    has_page: Boolean(has_page),
    has_cesium,
    missing,
  }
}

function nextBin(repoRoot: string): string {
  const win = process.platform === 'win32'
  const candidates = win
    ? [
        path.join(repoRoot, 'node_modules', 'next', 'dist', 'bin', 'next'),
        path.join(repoRoot, 'node_modules', '.bin', 'next.CMD'),
        path.join(repoRoot, 'node_modules', '.bin', 'next'),
      ]
    : [
        path.join(repoRoot, 'node_modules', 'next', 'dist', 'bin', 'next'),
        path.join(repoRoot, 'node_modules', '.bin', 'next'),
      ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  throw new Error('Next binary not found — run pnpm install / build first.')
}

/**
 * Discover existing local UI or start an owned `next start` on 127.0.0.1:3848.
 * Never binds 0.0.0.0. Never kills unknown processes on conflict.
 */
export async function ensureLocalWarRoomUi(input?: {
  repoRoot?: string
  startIfMissing?: boolean
  waitMs?: number
}): Promise<LocalUiHandle> {
  const repoRoot = input?.repoRoot ?? resolveRepoRoot()
  const startIfMissing = input?.startIfMissing !== false
  const waitMs = input?.waitMs ?? 45_000

  const existing = await probeLocalWarRoomUi()
  if (existing.ok) {
    return {
      port: LOCAL_UI_PORT,
      origin: LOCAL_UI_ORIGIN,
      boot: 'UI_READY',
      owned_pid: null,
      stop: async () => {
        /* do not kill process we did not start */
      },
    }
  }

  const open = await probePort(LOCAL_UI_PORT)
  if (open && !existing.ok) {
    const err = Object.assign(new Error(`Port ${LOCAL_UI_PORT} occupied by unknown process — not auto-killed.`), {
      boot: 'UI_PORT_CONFLICT' as const,
    })
    throw err
  }

  if (!startIfMissing) {
    throw Object.assign(new Error('Local War Room UI not running.'), { boot: 'UI_FAILED' as const })
  }

  const artifacts = assertLocalNextArtifacts(repoRoot)
  if (!artifacts.ok) {
    throw Object.assign(
      new Error(`Local Next artifacts missing: ${artifacts.missing.join(', ')}`),
      { boot: 'UI_FAILED' as const },
    )
  }

  const bin = nextBin(repoRoot)
  const args = ['start', '--hostname', LOCAL_CORE_HOST, '--port', String(LOCAL_UI_PORT)]
  const child: ChildProcess = spawn(process.execPath, [bin, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(LOCAL_UI_PORT),
      HOSTNAME: LOCAL_CORE_HOST,
      WAR_ROOM_RUNTIME_SURFACE: 'DESKTOP_LOCAL',
      // Do not inherit production public site as required origin for local UI
    },
    stdio: 'ignore',
    windowsHide: true,
  })

  const owned_pid = child.pid ?? null
  const deadline = Date.now() + waitMs
  let lastDetail = 'starting'
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw Object.assign(new Error(`next start exited early code=${child.exitCode}`), {
        boot: 'UI_FAILED' as const,
      })
    }
    const probe = await probeLocalWarRoomUi()
    lastDetail = probe.detail
    if (probe.ok) {
      return {
        port: LOCAL_UI_PORT,
        origin: LOCAL_UI_ORIGIN,
        boot: 'UI_READY',
        owned_pid,
        stop: async () => stopOwnedChild(child),
      }
    }
    await new Promise(r => setTimeout(r, 500))
  }

  await stopOwnedChild(child)
  throw Object.assign(new Error(`Local UI failed to become ready: ${lastDetail}`), {
    boot: 'UI_FAILED' as const,
  })
}

async function stopOwnedChild(child: ChildProcess): Promise<void> {
  if (child.killed || child.exitCode !== null) return
  await new Promise<void>(resolve => {
    const t = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* ignore */
      }
      resolve()
    }, 3000)
    child.once('exit', () => {
      clearTimeout(t)
      resolve()
    })
    try {
      child.kill('SIGTERM')
    } catch {
      clearTimeout(t)
      resolve()
    }
  })
}

export function desktopShutdownUiPlan(owned: boolean): {
  stop_owned_local_ui: boolean
  stop_production_3000: false
  stop_dev_3001: false
  stop_cloudflared: false
  stop_ollama: false
  stop_unknown: false
} {
  return {
    stop_owned_local_ui: owned,
    stop_production_3000: false,
    stop_dev_3001: false,
    stop_cloudflared: false,
    stop_ollama: false,
    stop_unknown: false,
  }
}
