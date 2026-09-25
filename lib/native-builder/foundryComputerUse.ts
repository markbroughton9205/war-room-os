/**
 * Foundry Computer Use — real desktop automation for the current Linux/Wayland+X11 machine.
 *
 * Primary locate path: AT-SPI accessibility.
 * Window management: wmctrl (X11) + AT-SPI.
 * Pointer/keyboard: xdotool against the exact window id of the throwaway test app
 * (never kill-by-name, never click a hardcoded screen coordinate as the primary strategy).
 *
 * Unrelated applications are not focused, closed, or typed into. The throwaway test app is
 * launched with GDK_BACKEND=x11 and WM_CLASS FoundryComputerUseTest so we can identify it.
 */
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { logWarRoomRepoAudit } from '@/lib/war-room/repoAudit'
import { foundryDataHierarchy } from './foundryPaths'
import {
  SESSION_LIFECYCLE_CONTRACTS,
  actionSuccessIsNotStateSuccess,
  classifyActivation,
  expectedStateLabel,
  normalizeAccessiblePointToScreen,
  preferCompactHits,
  semanticClickPoint,
  type AccessibleNormalizeContext,
  type ControlTiming,
  type DisplayTopology,
  type NormalizedAccessible,
  type Rect,
  type SemanticExpected,
} from './foundryComputerUseGeometry'
import { clickAccessibleInInstalledUi, domHasAccessibleName, selectAllAccessibleInInstalledUi, typeAccessibleInInstalledUi } from './foundryComputerUseCdp'

const execFileAsync = promisify(execFile)

export const COMPUTER_TOOL_NAMES = [
  'computer.status',
  'computer.screens',
  'computer.windows',
  'computer.focus_window',
  'computer.observe',
  'computer.screenshot',
  'computer.click',
  'computer.double_click',
  'computer.right_click',
  'computer.move_pointer',
  'computer.drag',
  'computer.type',
  'computer.key',
  'computer.hotkey',
  'computer.scroll',
  'computer.wait',
  'computer.wait_for_change',
  'computer.wait_for_control',
  'computer.click_and_wait',
  'computer.open_app',
  'computer.close_app',
  'computer.find_visual',
  'computer.find_text',
  'computer.find_control',
  'computer.clipboard_read',
  'computer.clipboard_write',
  'computer.file_dialog',
] as const

export type ComputerToolName = (typeof COMPUTER_TOOL_NAMES)[number]
export function isComputerToolName(value: string): value is ComputerToolName {
  return (COMPUTER_TOOL_NAMES as readonly string[]).includes(value)
}

export type BrokerResult = { ok: boolean; tool: ComputerToolName; result?: unknown; error?: string }

const TEST_APP_TITLE = 'Foundry Computer Use Test'
const TEST_APP_CLASS = 'FoundryComputerUseTest'
const MARKER = 'FOUNDRY_CU_MARKER_ALPHA'

type OwnedApp = { pid: number; title: string }
const ownedApps = new Map<string, OwnedApp>()

export const REQUIRED_LIFECYCLE_CONTROLS = new Set([
  'New Session',
  'Rename',
  'Save',
  'Archive',
  'Confirm Archive',
  'Advanced / Operations',
  'Restore',
])

type AccessibleHit = { name?: string; role?: string; x?: number; y?: number; width?: number; height?: number }
type WarRoomCache = {
  window: ParsedWindow
  appName: string
  cachedAt: number
  topology: DisplayTopology[]
  atspiFrame: Rect | null
}
let warRoomSessionCache: WarRoomCache | null = null

export function correlateWarRoomWindow(windows: ParsedWindow[]): ParsedWindow | null {
  return discoverWarRoomWindow(windows) as ParsedWindow | null
}

export function pointInsideWindow(cx: number, cy: number, window: ParsedWindow, pad = 8): boolean {
  const x = window.clientX ?? window.x
  const y = window.clientY ?? window.y
  const width = window.clientWidth ?? window.width
  const height = window.clientHeight ?? window.height
  if (typeof x !== 'number' || typeof y !== 'number' || typeof width !== 'number' || typeof height !== 'number') {
    return false
  }
  return cx >= x - pad
    && cy >= y - pad
    && cx <= x + width + pad
    && cy <= y + height + pad
}

export function mapHitIntoWarRoomWindow(
  hit: AccessibleHit & { x: number; y: number },
  window: ParsedWindow,
  context?: AccessibleNormalizeContext | null,
): {
  hit: AccessibleHit & { x: number; y: number }
  scale: number
  originTranslated: boolean
  raw: { x: number; y: number; width?: number; height?: number }
  translated: { x: number; y: number; width?: number; height?: number }
  center: { x: number; y: number }
  insideWindow: boolean
  normalized?: NormalizedAccessible
} {
  const raw = { x: hit.x, y: hit.y, width: hit.width, height: hit.height }
  const asRect: Rect = { x: hit.x, y: hit.y, width: hit.width ?? 10, height: hit.height ?? 10 }
  const normalized = context
    ? normalizeAccessiblePointToScreen(asRect, context)
    : null
  if (normalized) {
    return {
      hit: { ...hit, x: normalized.rect.x, y: normalized.rect.y, width: normalized.rect.width, height: normalized.rect.height },
      scale: 1,
      originTranslated: normalized.space !== 'physical',
      raw,
      translated: normalized.rect,
      center: normalized.point,
      insideWindow: normalized.insideAppFrame === true && (normalized.insideDisplay === true || !context.displays.length),
      normalized,
    }
  }
  const originTranslated = typeof window.x === 'number' && typeof window.y === 'number'
    ? { ...hit, x: hit.x + window.x, y: hit.y + window.y }
    : hit
  const identityInside = pointInsideWindow(hit.x + (hit.width ?? 10) / 2, hit.y + (hit.height ?? 10) / 2, window)
  const chosen = identityInside ? hit : originTranslated
  const center = {
    x: Math.round(chosen.x + (chosen.width ?? 10) / 2),
    y: Math.round(chosen.y + (chosen.height ?? 10) / 2),
  }
  return {
    hit: chosen,
    scale: 1,
    originTranslated: !identityInside,
    raw,
    translated: { x: chosen.x, y: chosen.y, width: chosen.width, height: chosen.height },
    center,
    insideWindow: pointInsideWindow(center.x, center.y, window),
  }
}

function containmentFrame(window: ParsedWindow): Rect {
  const click = {
    x: window.x ?? window.clientX ?? 0,
    y: window.y ?? window.clientY ?? 0,
    width: window.width ?? window.clientWidth ?? 0,
    height: window.height ?? window.clientHeight ?? 0,
  }
  const client = {
    x: window.clientX ?? window.x ?? 0,
    y: window.clientY ?? window.y ?? 0,
    width: window.clientWidth ?? window.width ?? 0,
    height: window.clientHeight ?? window.height ?? 0,
  }
  const x = Math.min(click.x, client.x)
  const y = Math.min(click.y, client.y)
  const right = Math.max(click.x + click.width, client.x + client.width)
  const bottom = Math.max(click.y + click.height, client.y + client.height)
  return { x, y, width: right - x, height: bottom - y }
}

function hidpiEvidence(
  mapping: ReturnType<typeof mapHitIntoWarRoomWindow> | undefined,
  window?: ParsedWindow | null,
) {
  if (!mapping || !window) return null
  return {
    rawAtspiBounds: mapping.raw,
    wmctrlWarRoomBounds: { x: window.x, y: window.y, width: window.width, height: window.height },
    clientWarRoomBounds: containmentFrame(window),
    chosenScale: mapping.scale,
    originTranslated: mapping.originTranslated,
    space: mapping.normalized?.space ?? (mapping.originTranslated ? 'origin-translated' : 'physical'),
    displayId: mapping.normalized?.displayId ?? null,
    translatedBounds: mapping.translated,
    finalCenter: mapping.center,
    centerInsideWarRoomFrame: mapping.normalized?.insideAppFrame ?? mapping.insideWindow === true,
    insideWarRoomFrame: mapping.normalized?.insideAppFrame ?? mapping.insideWindow === true,
    insideDisplay: mapping.normalized?.insideDisplay ?? null,
    pointerSafe: mapping.insideWindow === true,
    refused: mapping.normalized?.refused ?? null,
  }
}

function parseXrandr(raw: string): Array<{ connector: string; primary: boolean; physical: Rect }> {
  const out: Array<{ connector: string; primary: boolean; physical: Rect }> = []
  for (const line of raw.split('\n')) {
    const match = line.match(/^(\S+)\s+connected(?:\s+primary)?\s+(\d+)x(\d+)\+(\-?\d+)\+(\-?\d+)/)
    if (!match) continue
    out.push({
      connector: match[1],
      primary: /\sprimary\s/.test(line),
      physical: { x: Number(match[4]), y: Number(match[5]), width: Number(match[2]), height: Number(match[3]) },
    })
  }
  return out
}

function pairDisplayTopology(
  gdkScreens: Array<{ x?: number; y?: number; width?: number; height?: number; scale?: number; index?: number }>,
  xrandr: Array<{ connector: string; primary: boolean; physical: Rect }>,
): DisplayTopology[] {
  const logical = [...gdkScreens].sort((a, b) => (a.x ?? 0) - (b.x ?? 0) || (a.y ?? 0) - (b.y ?? 0))
  const physical = [...xrandr].sort((a, b) => a.physical.x - b.physical.x || a.physical.y - b.physical.y)
  const count = Math.max(logical.length, physical.length)
  const displays: DisplayTopology[] = []
  for (let i = 0; i < count; i += 1) {
    const gdk = logical[i]
    const xr = physical[i]
    const logRect: Rect = {
      x: gdk?.x ?? xr?.physical.x ?? 0,
      y: gdk?.y ?? xr?.physical.y ?? 0,
      width: gdk?.width ?? xr?.physical.width ?? 0,
      height: gdk?.height ?? xr?.physical.height ?? 0,
    }
    const phys = xr?.physical ?? {
      x: logRect.x * (gdk?.scale ?? 1),
      y: logRect.y * (gdk?.scale ?? 1),
      width: logRect.width * (gdk?.scale ?? 1),
      height: logRect.height * (gdk?.scale ?? 1),
    }
    const scale = (gdk?.scale && gdk.scale > 0)
      ? gdk.scale
      : (logRect.width > 0 ? phys.width / logRect.width : 1)
    displays.push({
      id: xr?.connector ?? `display-${i}`,
      connector: xr?.connector,
      logical: logRect,
      physical: phys,
      scale,
      primary: xr?.primary ?? i === 0,
      rotation: 0,
    })
  }
  return displays
}

async function collectDisplayTopology(): Promise<DisplayTopology[]> {
  const gdk = await pythonJson('screens')
  let xrandrRaw = ''
  try {
    const listed = await execFileAsync('xrandr', ['--current'], { timeout: 4_000 })
    xrandrRaw = listed.stdout
  } catch {
    xrandrRaw = ''
  }
  const screens = Array.isArray(gdk.screens) ? gdk.screens as Array<{ x?: number; y?: number; width?: number; height?: number; scale?: number; index?: number }> : []
  return pairDisplayTopology(screens, parseXrandr(xrandrRaw))
}

async function readAtspiFrame(): Promise<Rect | null> {
  const raw = await pythonJson('app_window', { app: 'war-room' })
  const screen = raw.screen as { x?: number; y?: number; width?: number; height?: number } | undefined
  if (!screen || typeof screen.x !== 'number' || typeof screen.y !== 'number') return null
  return { x: screen.x, y: screen.y, width: Number(screen.width ?? 0), height: Number(screen.height ?? 0) }
}

async function xdotoolGeometry(id: string): Promise<Rect | null> {
  const listed = await xdotool(['getwindowgeometry', '--shell', id])
  if (!listed.ok) return null
  const x = /X=(\-?\d+)/.exec(listed.stdout)
  const y = /Y=(\-?\d+)/.exec(listed.stdout)
  const w = /WIDTH=(\d+)/.exec(listed.stdout)
  const h = /HEIGHT=(\d+)/.exec(listed.stdout)
  if (!x || !y || !w || !h) return null
  return { x: Number(x[1]), y: Number(y[1]), width: Number(w[1]), height: Number(h[1]) }
}

function normalizeContextFor(window: ParsedWindow, topology: DisplayTopology[], atspiFrame: Rect | null): AccessibleNormalizeContext {
  return {
    displays: topology,
    appFrameX11: containmentFrame(window),
    appFrameAtspi: atspiFrame,
  }
}

async function xwininfoFrame(id: string): Promise<{ x: number; y: number; width: number; height: number } | null> {
  try {
    const { stdout } = await execFileAsync('xwininfo', ['-id', id], { timeout: 4_000 })
    const x = /Absolute upper-left X:\s+(-?\d+)/.exec(stdout)
    const y = /Absolute upper-left Y:\s+(-?\d+)/.exec(stdout)
    const w = /Width:\s+(\d+)/.exec(stdout)
    const h = /Height:\s+(\d+)/.exec(stdout)
    if (!x || !y || !w || !h) return null
    return { x: Number(x[1]), y: Number(y[1]), width: Number(w[1]), height: Number(h[1]) }
  } catch {
    return null
  }
}

async function resolveWarRoomWindow(): Promise<ParsedWindow | null> {
  const listed = await wmctrl(['-lG'])
  const windows = listed.ok ? parseWmctrlList(listed.stdout) : []
  const discovered = correlateWarRoomWindow(windows)
  if (!discovered) {
    warRoomSessionCache = null
    return null
  }
  const client = discovered.id ? await xwininfoFrame(discovered.id) : null
  const clickOrigin = discovered.id ? await xdotoolGeometry(discovered.id) : null
  const current: ParsedWindow = {
    ...discovered,
    x: clickOrigin?.x ?? discovered.x,
    y: clickOrigin?.y ?? discovered.y,
    width: clickOrigin?.width ?? discovered.width,
    height: clickOrigin?.height ?? discovered.height,
    clientX: client?.x ?? discovered.x,
    clientY: client?.y ?? discovered.y,
    clientWidth: client?.width ?? discovered.width,
    clientHeight: client?.height ?? discovered.height,
  }
  const sameWindow = warRoomSessionCache
    && warRoomSessionCache.window.id === current.id
    && Math.abs((warRoomSessionCache.window.clientX ?? 0) - (current.clientX ?? 0)) < 24
    && Math.abs((warRoomSessionCache.window.clientY ?? 0) - (current.clientY ?? 0)) < 24
  if (sameWindow && warRoomSessionCache) {
    warRoomSessionCache.window = current
    return current
  }
  const topology = await collectDisplayTopology()
  const atspiFrame = await readAtspiFrame()
  warRoomSessionCache = { window: current, appName: 'war-room-os', cachedAt: Date.now(), topology, atspiFrame }
  return current
}

function backendScript(): string {
  const candidates = [
    path.join(resolveRepoRoot(), 'scripts', 'foundry', 'computer-use-backend.py'),
    path.join(process.cwd(), 'scripts', 'foundry', 'computer-use-backend.py'),
    path.join(process.cwd(), '..', 'scripts', 'foundry', 'computer-use-backend.py'),
  ]
  return candidates.find(item => existsSync(item)) ?? candidates[0]
}
function testAppScript(): string {
  return path.join(resolveRepoRoot(), 'scripts', 'foundry', 'computer-use-test-app.py')
}

async function pythonJson(command: string, payload: Record<string, unknown> = {}, timeoutMs = 6_000): Promise<Record<string, unknown>> {
  try {
    const { stdout, stderr } = await execFileAsync('python3', [backendScript(), command, JSON.stringify(payload)], {
      timeout: timeoutMs,
      env: { ...process.env, GDK_BACKEND: 'x11' },
    })
    try {
      return JSON.parse(stdout) as Record<string, unknown>
    } catch {
      return { ok: false, error: stderr || stdout || 'backend produced non-JSON' }
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function hitHasCoords(hit: AccessibleHit | undefined): hit is AccessibleHit & { x: number; y: number } {
  return Boolean(
    hit
    && typeof hit.x === 'number'
    && typeof hit.y === 'number'
    && Number.isFinite(hit.x)
    && Number.isFinite(hit.y)
    && Math.abs(hit.x) < 100_000
    && Math.abs(hit.y) < 100_000
    && (hit.width ?? 1) > 0
    && (hit.height ?? 1) > 0,
  )
}

function filterHitsToWindow(hits: AccessibleHit[], window?: ParsedWindow | null, context?: AccessibleNormalizeContext | null): AccessibleHit[] {
  if (!window) return hits
  const mapped = hits.map(hit => {
    if (!hitHasCoords(hit)) return null
    const mapping = mapHitIntoWarRoomWindow(hit, window, context)
    return { hit, inside: mapping.insideWindow }
  }).filter(Boolean) as Array<{ hit: AccessibleHit; inside: boolean }>
  const inside = mapped.filter(item => item.inside).map(item => item.hit)
  return inside.length ? inside : mapped.map(item => item.hit)
}

async function locateAccessibleControl(input: Record<string, unknown>): Promise<{
  hit?: AccessibleHit & { x: number; y: number }
  strategy: 'semantic' | 'none'
  mapping?: ReturnType<typeof mapHitIntoWarRoomWindow>
  raw: Record<string, unknown>
}> {
  const name = String(input.name ?? input.text ?? '')
  const role = input.role ? String(input.role) : ''
  const app = input.app ? String(input.app) : ''
  const war = await resolveWarRoomWindow()
  const scopedApp = app || warRoomSessionCache?.appName || 'war-room-os'
  const context = war && warRoomSessionCache
    ? normalizeContextFor(war, warRoomSessionCache.topology, warRoomSessionCache.atspiFrame)
    : null
  const control = await pythonJson('find_control', { name, role, app: scopedApp })
  let hits = ((control.hits as AccessibleHit[] | undefined) ?? []).filter(hitHasCoords)
  if (!hits.length && !role) {
    const retry = await pythonJson('find_control', { name, app: scopedApp })
    hits = ((retry.hits as AccessibleHit[] | undefined) ?? []).filter(hitHasCoords)
  }
  const ranked = filterHitsToWindow(hits, war, context).filter(hitHasCoords)
  const needle = name.trim().toLowerCase()
  const roleNeedle = role.trim().toLowerCase().replace(/^push\s+/, '')
  const roleMatched = roleNeedle
    ? ranked.filter(hit => {
      const hitRole = String(hit.role ?? '').toLowerCase()
      return hitRole.includes(roleNeedle) || roleNeedle.includes(hitRole.replace(/^push\s+/, ''))
    })
    : ranked
  const named = (roleMatched.length ? roleMatched : ranked).filter(hit => (hit.name ?? '').trim().toLowerCase() === needle)
  const compact = preferCompactHits((named.length ? named : roleMatched.length ? roleMatched : ranked).filter(hitHasCoords) as Array<AccessibleHit & Rect>)
  const preferred = compact.find(hitHasCoords)
  if (preferred && war) {
    const mapping = mapHitIntoWarRoomWindow(preferred, war, context)
    return {
      hit: mapping.hit,
      strategy: 'semantic',
      mapping,
      raw: {
        ...control,
        hits,
        blocker: mapping.insideWindow ? undefined : 'AT_SPI_POINT_OUTSIDE_APP_FRAME',
        geometryOk: mapping.insideWindow === true,
      },
    }
  }
  if (preferred) return { hit: preferred, strategy: 'semantic', raw: { ...control, hits } }
  return { strategy: 'none', raw: { ...control, hits } }
}

async function xdotool(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('xdotool', args, { timeout: 8_000 })
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() }
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string }
    return { ok: false, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? err.message ?? error) }
  }
}

async function wmctrl(args: string[]): Promise<{ ok: boolean; stdout: string }> {
  try {
    const { stdout } = await execFileAsync('wmctrl', args, { timeout: 8_000 })
    return { ok: true, stdout: stdout.trim() }
  } catch (error) {
    return { ok: false, stdout: error instanceof Error ? error.message : String(error) }
  }
}

export type ParsedWindow = {
  id: string
  desktop: string
  host: string
  title: string
  x?: number
  y?: number
  width?: number
  height?: number
  clientX?: number
  clientY?: number
  clientWidth?: number
  clientHeight?: number
}

export function isCursorOrBrowserWindow(title: string, host = ''): boolean {
  const blob = `${title} ${host}`
  if (/War Room/i.test(title)) return false
  return /cursor|visual studio code|chromium|google-chrome|firefox|chatgpt|gnome-terminal|xfce4-terminal/i.test(blob)
}

export function scoreWarRoomWindow(window: { title?: string; host?: string }): number {
  const title = window.title ?? ''
  const host = window.host ?? ''
  if (isCursorOrBrowserWindow(title, host)) return 0
  let score = 0
  if (/War Room — Higher Vision Inc|War Room - Higher Vision Inc/i.test(title)) score += 100
  if (/War Room OS/i.test(title)) score += 70
  if (/\bWar Room\b/i.test(title)) score += 50
  if (/war-room-os/i.test(`${title} ${host}`)) score += 40
  if (/electron/i.test(host) && /war room/i.test(title)) score += 20
  return score
}

export function discoverWarRoomWindow(windows: Array<{ title?: string; host?: string; id?: string }>): (typeof windows)[number] | null {
  const ranked = windows
    .map(item => ({ item, score: scoreWarRoomWindow(item) }))
    .filter(entry => entry.score > 0)
  ranked.sort((a, b) => b.score - a.score)
  return ranked[0]?.item ?? null
}

function parseWmctrlList(raw: string): ParsedWindow[] {
  const windows: ParsedWindow[] = []
  for (const line of raw.split('\n').map(item => item.trim()).filter(Boolean)) {
    const geo = line.match(/^(0x[0-9a-f]+)\s+(-?\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/i)
    if (geo) {
      windows.push({
        id: geo[1],
        desktop: geo[2],
        x: Number(geo[3]),
        y: Number(geo[4]),
        width: Number(geo[5]),
        height: Number(geo[6]),
        host: geo[7],
        title: geo[8],
      })
      continue
    }
    const match = line.match(/^(0x[0-9a-f]+)\s+(-?\d+)\s+(\S+)\s+(.*)$/i)
    if (match) {
      windows.push({ id: match[1], desktop: match[2], host: match[3], title: match[4] })
    }
  }
  return windows
}

async function findTestWindow(): Promise<ParsedWindow | null> {
  const listed = await wmctrl(['-l'])
  if (!listed.ok) return null
  return parseWmctrlList(listed.stdout).find(w => w.title.includes(TEST_APP_TITLE)) ?? null
}

async function requireInteractionWindow(input: Record<string, unknown> = {}): Promise<{ ok: true; window: ParsedWindow } | { ok: false; error: string }> {
  const app = String(input.app ?? input.title ?? '')
  if (/War Room|war-room-os|War Room OS/i.test(app) || !app) {
    const war = await resolveWarRoomWindow()
    if (war) return { ok: true, window: war }
  }
  const listed = await wmctrl(['-lG'])
  const windows = listed.ok ? parseWmctrlList(listed.stdout) : []
  const test = windows.find(w => w.title.includes(TEST_APP_TITLE))
  if (test) return { ok: true, window: test }
  const war = await resolveWarRoomWindow()
  if (war) return { ok: true, window: war }
  return { ok: false, error: 'No Foundry Computer Use test window or War Room window is open.' }
}

async function focusExact(id: string): Promise<{ ok: boolean; detail: string }> {
  const wm = await wmctrl(['-ia', id])
  const xd = await xdotool(['windowactivate', '--sync', id])
  return { ok: wm.ok || xd.ok, detail: `wmctrl=${wm.ok} xdotool=${xd.ok}` }
}

export type SemanticClickMethod = 'AT_SPI_ACTION' | 'SEMANTIC_BOUNDS_CLICK' | 'SEMANTIC_DOM_CLICK' | 'COORDINATE_FALLBACK'

function hitSignature(hit: AccessibleHit, windowTitle?: string): string {
  return [
    String(windowTitle ?? 'war-room').trim().toLowerCase(),
    String(hit.name ?? '').trim().toLowerCase(),
    String(hit.role ?? '').trim().toLowerCase(),
    String(Math.round((hit.x ?? 0) / 8)),
    String(Math.round((hit.y ?? 0) / 8)),
  ].join('|')
}

async function waitForAccessibleControl(input: Record<string, unknown>): Promise<{
  ok: boolean
  hit?: AccessibleHit & { x: number; y: number }
  stable: boolean
  polls: number
  timedOut: boolean
  timeoutMs: number
  pollIntervalMs: number
  durationMs: number
  discoveryMethod: string
  mapping?: ReturnType<typeof mapHitIntoWarRoomWindow>
  hidpi?: ReturnType<typeof hidpiEvidence>
  raw?: Record<string, unknown>
  error?: string
}> {
  const timeoutMs = Math.min(Math.max(Number(input.timeoutMs ?? 12_000), 200), 20_000)
  const pollIntervalMs = Math.min(Math.max(Number(input.pollIntervalMs ?? 250), 80), 2_000)
  const needStable = input.stable === false ? 1 : 2
  const started = Date.now()
  const deadline = started + timeoutMs
  let polls = 0
  let previous: string | null = null
  let lastRaw: Record<string, unknown> | undefined
  let lastMapping: ReturnType<typeof mapHitIntoWarRoomWindow> | undefined
  while (Date.now() < deadline) {
    polls += 1
    const located = await locateAccessibleControl(input)
    lastRaw = located.raw
    lastMapping = located.mapping
    if (located.hit) {
      const signature = hitSignature(located.hit, 'War Room — Higher Vision Inc')
      if (needStable <= 1 || (previous && previous === signature)) {
        return {
          ok: true,
          hit: located.hit,
          stable: needStable <= 1 || previous === signature,
          polls,
          timedOut: false,
          timeoutMs,
          pollIntervalMs,
          durationMs: Date.now() - started,
          discoveryMethod: String(located.raw.strategy ?? located.raw.discoveryMethod ?? 'war-room-app-cache'),
          mapping: located.mapping,
          hidpi: hidpiEvidence(located.mapping, warRoomSessionCache?.window),
          raw: located.raw,
        }
      }
      previous = signature
    } else {
      previous = null
    }
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    await new Promise(resolve => setTimeout(resolve, Math.min(pollIntervalMs, remaining)))
  }
  return {
    ok: false,
    stable: false,
    polls,
    timedOut: true,
    timeoutMs,
    pollIntervalMs,
    durationMs: Date.now() - started,
    discoveryMethod: String(lastRaw?.strategy ?? lastRaw?.discoveryMethod ?? 'none'),
    mapping: lastMapping,
    hidpi: hidpiEvidence(lastMapping, warRoomSessionCache?.window),
    raw: lastRaw,
    error: lastRaw && (lastRaw as { hidpi?: { insideWarRoomFrame?: boolean } }).hidpi?.insideWarRoomFrame === false
      ? 'SEMANTIC_BOUNDS_OUTSIDE_WINDOW'
      : `wait_for_control timed out after ${timeoutMs}ms (${polls} polls) for ${String(input.name ?? input.text ?? '')}/${String(input.role ?? '')}`,
  }
}

async function invalidateControlNodes(): Promise<void> {
  await pythonJson('invalidate_control_nodes').catch(() => ({ ok: false }))
}

function parseExpected(input: Record<string, unknown>, fallbackName?: string): SemanticExpected {
  const raw = (input.expected && typeof input.expected === 'object') ? input.expected as SemanticExpected : {}
  if (raw.anyOf?.length || raw.name || raw.text || raw.absentName) return raw
  const named = SESSION_LIFECYCLE_CONTRACTS[fallbackName ?? '']
  if (named) return named
  return {
    name: typeof input.expectedName === 'string' ? input.expectedName : undefined,
    role: typeof input.expectedRole === 'string' ? input.expectedRole : undefined,
    text: typeof input.expectedText === 'string' ? input.expectedText : undefined,
    absentName: typeof input.absentName === 'string' ? input.absentName : undefined,
  }
}

async function expectedObserved(expected: SemanticExpected, app: string): Promise<boolean> {
  if (expected.absentName) {
    const located = await locateAccessibleControl({ name: expected.absentName, role: expected.role, app })
    return !located.hit
  }
  const candidates = expected.anyOf?.length
    ? expected.anyOf
    : [{ name: expected.name || expected.text || '', role: expected.role }]
  for (const candidate of candidates) {
    if (!candidate.name) continue
    const located = await locateAccessibleControl({ name: candidate.name, role: candidate.role, app })
    if (located.hit) return true
    if (await domHasAccessibleName(candidate.name)) return true
  }
  return false
}

async function waitForExpected(expected: SemanticExpected, app: string, timeoutMs: number): Promise<{ ok: boolean; polls: number }> {
  const deadline = Date.now() + Math.min(Math.max(timeoutMs, 200), 12_000)
  let polls = 0
  while (Date.now() < deadline) {
    polls += 1
    await invalidateControlNodes()
    if (await expectedObserved(expected, app)) return { ok: true, polls }
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    await new Promise(resolve => setTimeout(resolve, Math.min(250, remaining)))
  }
  return { ok: false, polls }
}

async function boundsClick(hit: AccessibleHit & { x: number; y: number }, window: ParsedWindow, button: '1' | '3', double = false): Promise<{
  ok: boolean
  method: SemanticClickMethod | 'SEMANTIC_BOUNDS_OUTSIDE_WINDOW'
  cx?: number
  cy?: number
  error?: string
}> {
  const context = warRoomSessionCache
    ? normalizeContextFor(window, warRoomSessionCache.topology, warRoomSessionCache.atspiFrame)
    : null
  const mapped = mapHitIntoWarRoomWindow(hit, window, context)
  if (!mapped.insideWindow) {
    return { ok: false, method: 'SEMANTIC_BOUNDS_OUTSIDE_WINDOW', error: mapped.normalized?.refused ?? 'AT_SPI_POINT_OUTSIDE_APP_FRAME' }
  }
  const frame = containmentFrame(window)
  const point = mapped.normalized
    ? { x: mapped.center.x, y: mapped.center.y }
    : semanticClickPoint({
      x: mapped.hit.x,
      y: mapped.hit.y,
      width: mapped.hit.width ?? 10,
      height: mapped.hit.height ?? 10,
    }, frame)
  if ('error' in point) return { ok: false, method: 'SEMANTIC_BOUNDS_OUTSIDE_WINDOW', error: point.error }
  const originX = window.x ?? frame.x
  const originY = window.y ?? frame.y
  const relX = Math.max(2, point.x - originX)
  const relY = Math.max(2, point.y - originY)
  await xdotool(['mousemove', '--window', window.id, String(relX), String(relY)])
  const clicked = await xdotool(double ? ['click', '--repeat', '2', button] : ['click', button])
  return { ok: clicked.ok, method: 'SEMANTIC_BOUNDS_CLICK', cx: point.x, cy: point.y, error: clicked.ok ? undefined : clicked.stderr }
}

async function clickAndWait(input: Record<string, unknown>, missionId?: string): Promise<{
  ok: boolean
  result: Record<string, unknown>
  error?: string
}> {
  const required = await requireInteractionWindow(input)
  if (!required.ok) return { ok: false, result: {}, error: required.error }
  await focusExact(required.window.id)
  const name = String(input.name ?? input.text ?? '')
  const role = input.role ? String(input.role) : ''
  const within = typeof input.within === 'string' ? input.within.trim() : ''
  const app = String(input.app || warRoomSessionCache?.appName || 'war-room-os')
  const expected = parseExpected(input, name)
  const timeoutMs = Math.min(Math.max(Number(input.timeoutMs ?? 8_000), 400), 15_000)
  const started = Date.now()
  await invalidateControlNodes()
  const waited = await waitForAccessibleControl({ name, role, app, timeoutMs, pollIntervalMs: 250, stable: false })
  const timing: ControlTiming = {
    control: name,
    discoveryMs: Date.now() - started,
    pollCount: waited.polls,
    atspiFound: Boolean(waited.hit),
    activationMethod: 'NONE',
    expectedState: expectedStateLabel(expected),
    expectedStateObserved: false,
    retryUsed: false,
  }
  if (within) {
    const scoped = await clickAccessibleInInstalledUi({
      name,
      role,
      within,
      missionId,
      tool: 'computer.click_and_wait',
      expectedNextState: expectedStateLabel(expected),
    })
    const afterScoped = scoped.ok ? await waitForExpected(expected, app, Math.min(timeoutMs, 4_000)) : { ok: false, polls: 0 }
    if (scoped.ok) {
      timing.activationMethod = 'SEMANTIC_DOM_CLICK'
      timing.expectedStateObserved = afterScoped.ok
      return {
        ok: true,
        result: {
          method: 'SEMANTIC_DOM_CLICK' satisfies SemanticClickMethod,
          timing,
          atspiNoop: false,
          within,
          activationChannel: 'ELECTRON_CDP',
          expectedStateObserved: afterScoped.ok,
          explicitCoordinateFallback: 0,
        },
      }
    }
  }
  if (!waited.hit) {
    return {
      ok: false,
      result: { method: 'NONE', timing, atspiNoop: false, warRoomCache: warRoomSessionCache?.appName ?? null, hidpi: hidpiEvidence(waited.mapping, required.window) },
      error: waited.error ?? `semantic target ${name} not found`,
    }
  }
  const action = await pythonJson('activate_control', { name, role, app }).catch(() => ({ ok: false }))
  const afterAction = await waitForExpected(expected, app, Math.min(timeoutMs, 3_500))
  const actionNoop = actionSuccessIsNotStateSuccess(action.ok === true, afterAction.ok)
  if (afterAction.ok) {
    timing.activationMethod = 'AT_SPI_ACTION'
    timing.expectedStateObserved = true
    timing.pollCount += afterAction.polls
    await logWarRoomRepoAudit('engineer: computer.click_and_wait', { name, method: 'AT_SPI_ACTION', ok: true })
    return {
      ok: true,
      result: {
        method: 'AT_SPI_ACTION' satisfies SemanticClickMethod,
        timing,
        atspiNoop: false,
        actionOk: action.ok === true,
        controlNodesInvalidated: true,
        warRoomCache: warRoomSessionCache?.appName ?? null,
        explicitCoordinateFallback: 0,
        hidpi: hidpiEvidence(waited.mapping, required.window),
        located: waited.hit,
        expectedStateObserved: true,
      },
    }
  }
  const expectedLabel = expectedStateLabel(expected)
  const dom = await clickAccessibleInInstalledUi({
    name,
    role,
    within: within || undefined,
    missionId,
    tool: 'computer.click_and_wait',
    expectedNextState: expectedLabel,
  })
  const afterDom = dom.ok ? await waitForExpected(expected, app, Math.min(timeoutMs, 4_000)) : { ok: false, polls: 0 }
  if (afterDom.ok) {
    timing.activationMethod = 'SEMANTIC_DOM_CLICK'
    timing.expectedStateObserved = true
    timing.retryUsed = true
    timing.pollCount += afterAction.polls + afterDom.polls
    await logWarRoomRepoAudit('engineer: computer.click_and_wait', { name, method: 'SEMANTIC_DOM_CLICK', ok: true, atspiNoop: actionNoop })
    return {
      ok: true,
      result: {
        method: 'SEMANTIC_DOM_CLICK' satisfies SemanticClickMethod,
        timing,
        atspiNoop: actionNoop,
        actionOk: action.ok === true,
        retryUsed: true,
        activationChannel: 'ELECTRON_CDP',
        controlNodesInvalidated: true,
        warRoomCache: warRoomSessionCache?.appName ?? null,
        explicitCoordinateFallback: 0,
        hidpi: hidpiEvidence(waited.mapping, required.window),
        located: waited.hit,
        expectedStateObserved: true,
        dom,
      },
    }
  }
  const rawHits = (((waited.raw?.hits as AccessibleHit[] | undefined) ?? []).filter(hitHasCoords)).map(hit => ({
    ...hit,
    width: hit.width ?? 10,
    height: hit.height ?? 10,
  }))
  const fallbackHit = waited.hit
    ? [{ ...waited.hit, width: waited.hit.width ?? 10, height: waited.hit.height ?? 10 }]
    : []
  const ordered = preferCompactHits(rawHits.length ? rawHits : fallbackHit)
  timing.retryUsed = true
  let bounds: Awaited<ReturnType<typeof boundsClick>> | undefined
  let afterBounds = { ok: false, polls: 0 }
  for (const hit of ordered.slice(0, 4)) {
    bounds = await boundsClick(hit, required.window, '1', false)
    if (!bounds.ok) continue
    afterBounds = await waitForExpected(expected, app, Math.min(timeoutMs, 4_000))
    if (afterBounds.ok) break
  }
  if (!bounds?.ok) {
    timing.activationMethod = bounds?.method === 'SEMANTIC_BOUNDS_OUTSIDE_WINDOW' ? 'SEMANTIC_BOUNDS_OUTSIDE_WINDOW' : 'NONE'
    return {
      ok: false,
      result: { method: timing.activationMethod, timing, atspiNoop: actionNoop, bounds, warRoomCache: warRoomSessionCache?.appName ?? null },
      error: bounds?.error ?? 'SEMANTIC_BOUNDS_CLICK failed',
    }
  }
  timing.activationMethod = classifyActivation({
    actionOk: action.ok === true,
    expectedObservedAfterAction: false,
    boundsRetryUsed: true,
    expectedObservedAfterBounds: afterBounds.ok,
    boundsOutsideWindow: false,
    domRetryUsed: true,
    expectedObservedAfterDom: afterDom.ok,
  })
  timing.expectedStateObserved = afterBounds.ok
  timing.pollCount += afterAction.polls + afterBounds.polls
  await logWarRoomRepoAudit('engineer: computer.click_and_wait', { name, method: timing.activationMethod, ok: afterBounds.ok, atspiNoop: actionNoop, hitsTried: ordered.length })
  return {
    ok: afterBounds.ok,
    result: {
      method: timing.activationMethod,
      timing,
      atspiNoop: actionNoop,
      actionOk: action.ok === true,
      retryUsed: true,
      hitsTried: Math.min(ordered.length, 4),
      controlNodesInvalidated: true,
      warRoomCache: warRoomSessionCache?.appName ?? null,
      explicitCoordinateFallback: 0,
      located: waited.hit,
      bounds,
      hidpi: hidpiEvidence(waited.mapping, required.window),
      expectedStateObserved: afterBounds.ok,
    },
    error: afterBounds.ok ? undefined : `expected state ${timing.expectedState} not observed after AT-SPI action and semantic bounds retry`,
  }
}

export async function executeComputerTool(
  tool: ComputerToolName,
  input: Record<string, unknown>,
  ctx: { repairId: string },
): Promise<BrokerResult> {
  try {
    switch (tool) {
      case 'computer.status': {
        const screens = await pythonJson('screens')
        const win = await findTestWindow()
        return {
          ok: true,
          tool,
          result: {
            sessionType: process.env.XDG_SESSION_TYPE ?? null,
            wayland: process.env.WAYLAND_DISPLAY ?? null,
            x11: process.env.DISPLAY ?? null,
            backends: { atspi: true, xdotool: true, wmctrl: true, gtk: true },
            testWindowOpen: Boolean(win),
            screens,
          },
        }
      }
      case 'computer.screens': {
        const gdk = await pythonJson('screens')
        const topology = await collectDisplayTopology()
        const war = await resolveWarRoomWindow()
        return {
          ok: true,
          tool,
          result: {
            ...gdk,
            topology,
            warRoomWindow: war,
            warRoomDisplay: war
              ? topology.find(display => {
                const cx = (war.clientX ?? war.x ?? 0) + (war.clientWidth ?? war.width ?? 0) / 2
                const cy = (war.clientY ?? war.y ?? 0) + (war.clientHeight ?? war.height ?? 0) / 2
                return cx >= display.physical.x
                  && cy >= display.physical.y
                  && cx < display.physical.x + display.physical.width
                  && cy < display.physical.y + display.physical.height
              }) ?? null
              : null,
            atspiFrame: warRoomSessionCache?.atspiFrame ?? null,
          },
        }
      }
      case 'computer.windows': {
        const wm = await wmctrl(['-lG'])
        let atspi: Record<string, unknown> = { skipped: true }
        try {
          atspi = await pythonJson('windows', {}, 1_200)
        } catch (error) {
          atspi = { error: error instanceof Error ? error.message : String(error) }
        }
        const x11 = wm.ok ? parseWmctrlList(wm.stdout) : []
        const warRoom = discoverWarRoomWindow(Array.isArray(x11) ? x11 : [])
        const skipped = Array.isArray(atspi.skippedApps) ? atspi.skippedApps : []
        return {
          ok: Boolean(warRoom) || (wm.ok && Array.isArray(x11)),
          tool,
          result: {
            x11: wm.ok ? x11 : { error: wm.stdout },
            atspi,
            warRoom,
            skippedApps: skipped,
            hungAppSkip: skipped.length > 0 || atspi.strategy === 'bounded-skip-hung' || Boolean(atspi.error),
            display: {
              sessionType: process.env.XDG_SESSION_TYPE ?? null,
              wayland: process.env.WAYLAND_DISPLAY ?? null,
              x11Display: process.env.DISPLAY ?? null,
            },
          },
          error: warRoom || wm.ok ? undefined : wm.stdout,
        }
      }
      case 'computer.focus_window': {
        const title = String(input.title ?? TEST_APP_TITLE)
        // External Cursor/app focus is external_app.focus — do not broaden this tool.
        if (title !== TEST_APP_TITLE && !title.includes('Foundry Computer Use') && !/War Room|war-room-os/i.test(title)) {
          return { ok: false, tool, error: 'computer.focus_window is restricted to the throwaway test app or the War Room window.' }
        }
        const listed = await wmctrl(['-lG'])
        const windows = listed.ok ? parseWmctrlList(listed.stdout) : []
        const match = /War Room|war-room-os/i.test(title)
          ? discoverWarRoomWindow(windows)
          : windows.find(w => w.title.includes(title)) ?? null
        if (!match?.id) return { ok: false, tool, error: `No window titled like "${title}".` }
        const focused = await focusExact(String(match.id))
        await logWarRoomRepoAudit('engineer: computer.focus_window', { title, id: match.id, ok: focused.ok })
        return { ok: focused.ok, tool, result: { window: match, ...focused }, error: focused.ok ? undefined : focused.detail }
      }
      case 'computer.observe': {
        const name = String(input.text ?? input.name ?? MARKER)
        const located = await locateAccessibleControl({ name, role: input.role, app: input.app ?? '' })
        const windows = await wmctrl(['-lG'])
        return { ok: true, tool, result: { atspi: located.raw, strategy: located.strategy, x11Windows: windows.ok ? parseWmctrlList(windows.stdout) : windows.stdout } }
      }
      case 'computer.screenshot': {
        const dirs = foundryDataHierarchy()
        await mkdir(dirs.computerUse, { recursive: true })
        const dest = path.join(dirs.computerUse, `${Date.now()}-${randomUUID().slice(0, 8)}.png`)
        const shot = await pythonJson('screenshot', { path: dest, xid: input.xid ?? null })
        await logWarRoomRepoAudit('engineer: computer.screenshot', { path: dest, ok: shot.ok === true })
        return { ok: shot.ok === true, tool, result: shot, error: shot.ok === true ? undefined : String(shot.blocker ?? shot.error ?? 'screenshot failed') }
      }
      case 'computer.click':
      case 'computer.double_click':
      case 'computer.right_click': {
        const controlName = String(input.name ?? input.text ?? '')
        const expectedPresent = Boolean(input.expected) || Boolean(input.expectedName) || Boolean(SESSION_LIFECYCLE_CONTRACTS[controlName])
        if (tool === 'computer.click' && expectedPresent && controlName) {
          const confirmed = await clickAndWait(input, ctx.repairId)
          return { ok: confirmed.ok, tool, result: confirmed.result, error: confirmed.error }
        }
        const required = await requireInteractionWindow(input)
        if (!required.ok) return { ok: false, tool, error: required.error }
        await focusExact(required.window.id)
        const name = controlName
        const role = input.role ? String(input.role) : ''
        const app = String(input.app || 'war-room-os')
        const semanticRequested = Boolean(name)
        if (semanticRequested) {
          const waited = await waitForAccessibleControl({
            name,
            role,
            app,
            timeoutMs: input.timeoutMs ?? 15_000,
            pollIntervalMs: 250,
            stable: false,
          })
          const located = waited.ok && waited.hit
            ? { hit: waited.hit, strategy: 'semantic' as const, raw: waited.raw ?? {} }
            : await locateAccessibleControl({ name, role, app })
          if (located.hit) {
            await pythonJson('activate_control', { name, role, app }).catch(() => ({ ok: false }))
            const expected = parseExpected(input, name)
            const expectedLabel = expectedStateLabel(expected)
            const viaCdp = await clickAccessibleInInstalledUi({
              name,
              role,
              within: typeof input.within === 'string' ? input.within : undefined,
              missionId: ctx.repairId,
              tool,
              expectedNextState: expectedLabel,
            })
            const afterCdp = viaCdp.ok ? await waitForExpected(expected, app, 4_000) : { ok: false, polls: 0 }
            if (viaCdp.ok && afterCdp.ok) {
              await invalidateControlNodes()
              await logWarRoomRepoAudit('engineer: computer.click', { tool, method: 'SEMANTIC_DOM_CLICK', ok: true, missionId: ctx.repairId, expected: expectedLabel })
              return {
                ok: true,
                tool,
                result: { method: 'SEMANTIC_DOM_CLICK' satisfies SemanticClickMethod, strategy: 'semantic', located: located.hit, activationChannel: 'ELECTRON_CDP', expectedStateObserved: true, explicitCoordinateFallback: 0 },
              }
            }
            const bounds = await boundsClick(located.hit, required.window, tool === 'computer.right_click' ? '3' : '1', tool === 'computer.double_click')
            await invalidateControlNodes()
            await logWarRoomRepoAudit('engineer: computer.click', { tool, method: bounds.method, cx: bounds.cx, cy: bounds.cy, ok: bounds.ok })
            return {
              ok: bounds.ok,
              tool,
              result: { method: bounds.method, strategy: 'semantic', located: located.hit, bounds },
              error: bounds.ok ? undefined : bounds.error,
            }
          }
          if (REQUIRED_LIFECYCLE_CONTROLS.has(name)) {
            return {
              ok: false,
              tool,
              error: waited.error ?? 'Could not AT-SPI-locate required lifecycle control without hardcoded x/y.',
              result: { HARDCODED_XY_REQUIRED_CONTROLS: 0 },
            }
          }
        }
        const x = typeof input.x === 'number' ? input.x : undefined
        const y = typeof input.y === 'number' ? input.y : undefined
        if (x === undefined || y === undefined) {
          return { ok: false, tool, error: `Could not AT-SPI-locate click target. ${JSON.stringify({ name, role, app: input.app })}` }
        }
        if (REQUIRED_LIFECYCLE_CONTROLS.has(name)) {
          return { ok: false, tool, error: `EXPLICIT_COORDINATE_FALLBACK refused for required control ${name}` }
        }
        const btn = tool === 'computer.right_click' ? '3' : '1'
        await xdotool(['mousemove', String(x), String(y)])
        const clicked = await xdotool(['click', btn])
        await logWarRoomRepoAudit('engineer: computer.click', { tool, method: 'COORDINATE_FALLBACK', x, y, ok: clicked.ok })
        return {
          ok: clicked.ok,
          tool,
          result: { method: 'COORDINATE_FALLBACK' satisfies SemanticClickMethod, strategy: 'COORDINATE_FALLBACK', clicked },
          error: clicked.ok ? undefined : clicked.stderr,
        }
      }
      case 'computer.move_pointer': {
        const x = Number(input.x)
        const y = Number(input.y)
        const moved = await xdotool(['mousemove', '--sync', String(x), String(y)])
        return { ok: moved.ok, tool, result: moved, error: moved.ok ? undefined : moved.stderr }
      }
      case 'computer.drag': {
        const required = await requireInteractionWindow(input)
        if (!required.ok) return { ok: false, tool, error: required.error }
        const x1 = Number(input.x1)
        const y1 = Number(input.y1)
        const x2 = Number(input.x2)
        const y2 = Number(input.y2)
        const dragged = await xdotool(['mousemove', '--sync', String(x1), String(y1), 'mousedown', '1', 'mousemove', '--sync', String(x2), String(y2), 'mouseup', '1'])
        return { ok: dragged.ok, tool, result: dragged, error: dragged.ok ? undefined : dragged.stderr }
      }
      case 'computer.type': {
        const required = await requireInteractionWindow(input)
        if (!required.ok) return { ok: false, tool, error: required.error }
        await focusExact(required.window.id)
        const text = String(input.text ?? '')
        const named = String(input.name ?? 'Session title')
        const viaCdp = await typeAccessibleInInstalledUi({ name: named, text })
        if (viaCdp.ok) {
          await logWarRoomRepoAudit('engineer: computer.type', { chars: text.length, ok: true, channel: 'ELECTRON_CDP' })
          return { ok: true, tool, result: { chars: text.length, method: 'SEMANTIC_DOM_CLICK', activationChannel: 'ELECTRON_CDP' } }
        }
        const typed = await xdotool(['type', '--delay', '12', text])
        await logWarRoomRepoAudit('engineer: computer.type', { chars: text.length, ok: typed.ok })
        return { ok: typed.ok, tool, result: { chars: text.length }, error: typed.ok ? undefined : typed.stderr }
      }
      case 'computer.key': {
        const required = await requireInteractionWindow(input)
        if (!required.ok) return { ok: false, tool, error: required.error }
        await focusExact(required.window.id)
        const key = String(input.key ?? '')
        const pressed = await xdotool(['key', key])
        return { ok: pressed.ok, tool, result: { key }, error: pressed.ok ? undefined : pressed.stderr }
      }
      case 'computer.hotkey': {
        const required = await requireInteractionWindow(input)
        if (!required.ok) return { ok: false, tool, error: required.error }
        await focusExact(required.window.id)
        const keys = Array.isArray(input.keys) ? input.keys.map(String).join('+') : String(input.keys ?? input.hotkey ?? '')
        if (/ctrl\+a/i.test(keys)) {
          const selected = await selectAllAccessibleInInstalledUi('Session title')
          if (selected.ok) {
            await logWarRoomRepoAudit('engineer: computer.hotkey', { keys, ok: true, channel: 'ELECTRON_CDP' })
            return { ok: true, tool, result: { keys, method: 'SEMANTIC_DOM_CLICK', activationChannel: 'ELECTRON_CDP' } }
          }
        }
        const pressed = await xdotool(['key', keys])
        await logWarRoomRepoAudit('engineer: computer.hotkey', { keys, ok: pressed.ok })
        return { ok: pressed.ok, tool, result: { keys }, error: pressed.ok ? undefined : pressed.stderr }
      }
      case 'computer.scroll': {
        const required = await requireInteractionWindow(input)
        if (!required.ok) return { ok: false, tool, error: required.error }
        await focusExact(required.window.id)
        const dy = typeof input.dy === 'number' ? input.dy : 3
        const key = dy > 0 ? 'Down' : 'Up'
        const pressed = await xdotool(['key', '--repeat', String(Math.min(Math.abs(dy), 20)), key])
        return { ok: pressed.ok, tool, result: { dy }, error: pressed.ok ? undefined : pressed.stderr }
      }
      case 'computer.wait': {
        const ms = Math.min(Number(input.ms ?? 400), 10_000)
        await new Promise(resolve => setTimeout(resolve, Number.isFinite(ms) ? ms : 400))
        return { ok: true, tool, result: { waitedMs: ms } }
      }
      case 'computer.wait_for_change': {
        const before = await pythonJson('find_text', { text: String(input.text ?? MARKER) })
        const deadline = Date.now() + Math.min(Number(input.timeoutMs ?? 4_000), 15_000)
        while (Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 250))
          const now = await pythonJson('find_text', { text: String(input.text ?? MARKER) })
          if (JSON.stringify(now.hits) !== JSON.stringify(before.hits)) {
            return { ok: true, tool, result: { changed: true, before, after: now } }
          }
        }
        return { ok: false, tool, error: 'No AT-SPI change observed before timeout.', result: { changed: false, before } }
      }
      case 'computer.wait_for_control': {
        const waited = await waitForAccessibleControl({
          name: String(input.name ?? input.text ?? ''),
          role: input.role ? String(input.role) : '',
          app: String(input.app || 'war-room-os'),
          timeoutMs: input.timeoutMs,
          pollIntervalMs: input.pollIntervalMs,
          stable: input.stable,
        })
        await logWarRoomRepoAudit('engineer: computer.wait_for_control', {
          name: input.name,
          role: input.role,
          ok: waited.ok,
          polls: waited.polls,
          stable: waited.stable,
        })
        return {
          ok: waited.ok,
          tool,
          result: waited,
          error: waited.ok ? undefined : waited.error,
        }
      }
      case 'computer.click_and_wait': {
        const confirmed = await clickAndWait(input, ctx.repairId)
        return { ok: confirmed.ok, tool, result: confirmed.result, error: confirmed.error }
      }
      case 'computer.open_app': {
        const app = String(input.app ?? 'foundry-cu-test')
        if (app !== 'foundry-cu-test' && app !== 'test') {
          return { ok: false, tool, error: 'computer.open_app is restricted to the throwaway Foundry test app (foundry-cu-test).' }
        }
        const existing = await findTestWindow()
        if (existing) return { ok: true, tool, result: { alreadyOpen: true, window: existing } }
        const child = spawn('python3', [testAppScript()], {
          env: { ...process.env, GDK_BACKEND: 'x11' },
          detached: true,
          stdio: 'ignore',
        })
        child.unref()
        if (!child.pid) return { ok: false, tool, error: 'Failed to spawn the throwaway test app.' }
        ownedApps.set('foundry-cu-test', { pid: child.pid, title: TEST_APP_TITLE })
        const appeared = await waitFor(async () => findTestWindow(), 8_000)
        await logWarRoomRepoAudit('engineer: computer.open_app', { pid: child.pid, appeared: Boolean(appeared) })
        return { ok: Boolean(appeared), tool, result: { pid: child.pid, window: appeared, class: TEST_APP_CLASS }, error: appeared ? undefined : 'Test app spawned but its window did not appear.' }
      }
      case 'computer.close_app': {
        const owned = ownedApps.get('foundry-cu-test')
        const win = await findTestWindow()
        if (win) await wmctrl(['-ic', win.id])
        if (owned) {
          try {
            process.kill(owned.pid, 'SIGTERM')
          } catch {
            /* already gone */
          }
          ownedApps.delete('foundry-cu-test')
        }
        await logWarRoomRepoAudit('engineer: computer.close_app', { pid: owned?.pid ?? null })
        return { ok: true, tool, result: { closed: true } }
      }
      case 'computer.find_text': {
        const located = await locateAccessibleControl({ name: String(input.text ?? MARKER), app: input.app ? String(input.app) : '' })
        return { ok: located.raw.ok === true, tool, result: located.raw, error: located.raw.ok === true ? undefined : String(located.raw.error ?? 'find_text failed') }
      }
      case 'computer.find_control': {
        const located = await locateAccessibleControl({
          name: String(input.name ?? input.text ?? MARKER),
          role: input.role ? String(input.role) : 'button',
          app: input.app ? String(input.app) : '',
        })
        return {
          ok: located.strategy === 'semantic',
          tool,
          result: { ...located.raw, strategy: located.strategy, hit: located.hit ?? null },
          error: located.strategy === 'semantic' ? undefined : 'No accessible control matched name/role.',
        }
      }
      case 'computer.find_visual': {
        const located = await pythonJson('find_text', { text: String(input.text ?? MARKER) })
        if (located.ok === true && Array.isArray(located.hits) && located.hits.length) {
          return { ok: true, tool, result: { strategy: 'atspi-text-proxy', ...located } }
        }
        return {
          ok: false,
          tool,
          error: 'VISUAL matching (pixel/template) is not installed (no ImageMagick/tesseract). AT-SPI text locate returned no hits.',
          result: {
            status: 'BLOCKED',
            blocker: 'FIND_VISUAL_NO_TEMPLATE_MATCHER',
            evidence: located,
            attempts: ['AT-SPI find_text as visual proxy'],
            whyCurrentEnvironmentPreventsIt: 'No template-matching / OCR binary is present. AT-SPI is the primary locator and found nothing for the requested text.',
            exactNextAction: 'Pass a known on-screen string via computer.find_text, or install tesseract if OCR visual locate is required.',
          },
        }
      }
      case 'computer.clipboard_read': {
        const result = await pythonJson('clipboard_read')
        return { ok: result.ok === true, tool, result, error: result.ok === true ? undefined : String(result.error ?? 'clipboard_read failed') }
      }
      case 'computer.clipboard_write': {
        const text = String(input.text ?? '')
        const result = await pythonJson('clipboard_write', { text })
        await logWarRoomRepoAudit('engineer: computer.clipboard_write', { chars: text.length, ok: result.ok === true })
        return { ok: result.ok === true, tool, result, error: result.ok === true ? undefined : String(result.error ?? 'clipboard_write failed') }
      }
      case 'computer.file_dialog': {
        const required = await requireInteractionWindow(input)
        if (!required.ok) return { ok: false, tool, error: required.error }
        await focusExact(required.window.id)
        const located = await pythonJson('find_text', { text: 'Foundry CU file', app: 'computer-use-test-app.py' })
        const hits = (located.hits as { name?: string }[] | undefined) ?? []
        if (!hits.length) {
          return {
            ok: false,
            tool,
            result: {
              status: 'BLOCKED',
              blocker: 'FILE_DIALOG_NOT_EXPOSED',
              evidence: located,
              attempts: ['AT-SPI locate Gtk.FileChooserButton labeled Foundry CU file'],
              whyCurrentEnvironmentPreventsIt: 'The Gtk file-chooser control did not expose a usable AT-SPI name in this session, so Foundry refused to click blindly into an unknown dialog (which could touch unrelated files).',
              exactNextAction: 'Re-run with GTK_DEBUG=interactive or expose a named AT-SPI action on the chooser.',
            },
            error: 'File-dialog automation not proven on this compositor.',
          }
        }
        const clicked = await executeComputerTool('computer.click', { text: 'Foundry CU file' }, ctx)
        if (!clicked.ok) return { ok: false, tool, result: { status: 'BLOCKED', blocker: 'FILE_DIALOG_CLICK_FAILED', evidence: clicked }, error: clicked.error }
        await new Promise(resolve => setTimeout(resolve, 400))
        const escape = await xdotool(['key', 'Escape'])
        await logWarRoomRepoAudit('engineer: computer.file_dialog', { opened: true, dismissed: escape.ok })
        return { ok: true, tool, result: { opened: true, dismissed: escape.ok, located: hits[0] } }
      }
      default: {
        const exhaustive: never = tool
        return { ok: false, tool: exhaustive, error: 'Unknown computer tool.' }
      }
    }
  } catch (error) {
    return { ok: false, tool, error: error instanceof Error ? error.message : String(error) }
  }
}

async function waitFor<T>(fn: () => Promise<T | null | undefined>, timeoutMs: number): Promise<T | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await fn()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  return null
}
