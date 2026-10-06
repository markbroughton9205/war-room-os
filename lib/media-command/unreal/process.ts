/**
 * Local Unreal process management for HVSRuntime.
 * Extends the existing HVS Unreal bridge. Does not create a second launch path.
 * The launch command is never shown in the normal Characters UI.
 *
 * Interactive operator steps MUST NOT use -ExecutePythonScript. UE 5.8
 * FEditorPythonExecuter always issues QUIT_EDITOR after the startup Python
 * returns unless KeepPythonScriptAlive is set. That is why OPEN REQUIRED STEP
 * previously closed the editor after open_mhc.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import path from 'node:path'
import { detectUnrealRuntime } from './detect'
import { HVS_UE02_UPROJECT } from './package'
import { unrealPackageDir } from './storage'

export const HVS_UNREAL_EDITOR = '/home/chosenone/Unreal/Engine/Binaries/Linux/UnrealEditor'
export const HVS_UNREAL_LAUNCH_DISPLAY = ':0'
export const HVS_UNREAL_LAUNCH_SDL = 'x11'
export const HVS_UNREAL_XDG_RUNTIME_DIR = '/run/user/1000'
export const HVS_UNREAL_XDG_SESSION_TYPE = 'x11'
export const HVS_UNREAL_STABILITY_MS = 3000
export const HVS_UNREAL_LAUNCH_GRACE_MS = 12_000
export const HVS_UNREAL_READY_TIMEOUT_MS = 120_000
export const HVS_UNREAL_PYTHON_DIR = '/home/chosenone/HVSRuntime/Content/Python'
export const HVS_UNREAL_INIT_PYTHON = path.join(HVS_UNREAL_PYTHON_DIR, 'init_unreal.py')

export type HvsUnrealProcessStatus = 'RUNNING' | 'STOPPED' | 'UNRESPONSIVE'

export type HvsUnrealLaunchOptions = {
  interactive?: boolean
  persist?: boolean
}

export type HvsUnrealProcessTrace = {
  status: HvsUnrealProcessStatus
  pid: number | null
  command: string | null
  editorPath: string
  uproject: string
  version: string | null
  startedThisCall: boolean
  duplicateRefused?: boolean
  launchPrepared: {
    display: typeof HVS_UNREAL_LAUNCH_DISPLAY
    sdlVideoDriver: typeof HVS_UNREAL_LAUNCH_SDL
    sdlVideoDriverAlt: typeof HVS_UNREAL_LAUNCH_SDL
    xdgRuntimeDir: typeof HVS_UNREAL_XDG_RUNTIME_DIR
    xdgSessionType: typeof HVS_UNREAL_XDG_SESSION_TYPE
    unsetWayland: true
    editor: string
    uproject: string
  }
}

export function isHvsUnrealEditorCommand(line: string): boolean {
  const text = String(line || '')
  if (!text) return false
  if (/cursorsandbox|sandbox-policy|cursor-agent|pgrep /.test(text)) return false
  if (!text.includes('UnrealEditor')) return false
  return text.includes('HVSRuntime') || text.includes(HVS_UE02_UPROJECT)
}

function pgrepUnreal(): { pid: number; command: string } | null {
  try {
    const raw = execFileSync('pgrep', ['-af', 'UnrealEditor'], { encoding: 'utf8', timeout: 2000 })
    const line = raw.split('\n').find(item => isHvsUnrealEditorCommand(item))
    if (!line) return null
    const pid = Number.parseInt(line.trim().split(/\s+/)[0] ?? '', 10)
    if (!Number.isFinite(pid)) return null
    return { pid, command: line.trim() }
  } catch {
    return null
  }
}

export function listHvsUnrealEditorCommands(): string[] {
  try {
    const raw = execFileSync('pgrep', ['-af', 'UnrealEditor'], { encoding: 'utf8', timeout: 2000 })
    return raw.split('\n').filter(item => isHvsUnrealEditorCommand(item))
  } catch {
    return []
  }
}

export function focusUnrealWindow(): boolean {
  try {
    const list = execFileSync('wmctrl', ['-l'], {
      encoding: 'utf8',
      timeout: 3000,
      env: { ...process.env, DISPLAY: HVS_UNREAL_LAUNCH_DISPLAY },
    })
    const line = list.split('\n').find(item => /UnrealEditor|HVSRuntime|MetaHuman|MHC_Rael_Commander/i.test(item) && !/cursorsandbox/i.test(item))
    if (!line) return false
    const id = line.trim().split(/\s+/)[0]
    if (!id) return false
    execFileSync('wmctrl', ['-i', '-a', id], {
      timeout: 3000,
      env: { ...process.env, DISPLAY: HVS_UNREAL_LAUNCH_DISPLAY },
    })
    return true
  } catch {
    return false
  }
}

export function metaHumanCharacterEditorVisible(): boolean {
  try {
    const list = execFileSync('wmctrl', ['-l'], {
      encoding: 'utf8',
      timeout: 3000,
      env: { ...process.env, DISPLAY: HVS_UNREAL_LAUNCH_DISPLAY },
    })
    return list.split('\n').some(item => /MHC_Rael_Commander|MetaHuman Character/i.test(item) && !/cursorsandbox/i.test(item))
  } catch {
    return false
  }
}

function heartbeatPath(projectId: string): string {
  return path.join(unrealPackageDir(projectId), 'unreal-heartbeat.json')
}

export function pythonBridgePath(projectId: string): string {
  return path.join(unrealPackageDir(projectId), 'character-ops', 'hvs_python_bridge.json')
}

export function readUnrealHeartbeat(projectId: string): { at: string; pid?: number } | null {
  const file = heartbeatPath(projectId)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as { at: string; pid?: number }
  } catch {
    return null
  }
}

export function writeUnrealHeartbeat(projectId: string, pid: number | null): string {
  const file = heartbeatPath(projectId)
  writeFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), pid }, null, 2)}\n`)
  return file
}

export function installHvsPythonBridge(projectId: string, likenessOpsPath: string): string {
  mkdirSync(HVS_UNREAL_PYTHON_DIR, { recursive: true })
  const initSrc = path.join(path.dirname(likenessOpsPath), 'hvs_init_unreal.py')
  if (existsSync(initSrc)) {
    copyFileSync(initSrc, HVS_UNREAL_INIT_PYTHON)
  } else {
    writeFileSync(HVS_UNREAL_INIT_PYTHON, [
      '# HVS operator-step bridge. Loaded by Unreal as Content/Python/init_unreal.py.',
      'import json, os, sys',
      'BRIDGE = "/home/chosenone/.local/share/war-room-os/data/media-command/unreal/hvs-mud545ez-8w3a/character-ops/hvs_python_bridge.json"',
      'def _start():',
      '    if not os.path.exists(BRIDGE):',
      '        return',
      '    try:',
      '        with open(BRIDGE, "r", encoding="utf-8") as handle:',
      '            data = json.load(handle)',
      '    except Exception:',
      '        return',
      '    script = data.get("likenessOps")',
      '    if not script or not os.path.exists(script):',
      '        return',
      '    folder = os.path.dirname(script)',
      '    if folder not in sys.path:',
      '        sys.path.insert(0, folder)',
      '    try:',
      '        import hvs_likeness_ops',
      '    except Exception:',
      '        return',
      '    if hasattr(hvs_likeness_ops, "start_operator_step_poller"):',
      '        hvs_likeness_ops.start_operator_step_poller()',
      '_start()',
      '',
    ].join('\n'))
  }
  const file = pythonBridgePath(projectId)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({
    likenessOps: likenessOpsPath,
    initUnreal: HVS_UNREAL_INIT_PYTHON,
    persist: true,
    executeCloud: false,
    autoRig: false,
    at: new Date().toISOString(),
  }, null, 2)}\n`)
  return file
}

export function inspectUnrealProcess(projectId: string): HvsUnrealProcessTrace {
  const detected = detectUnrealRuntime()
  const found = pgrepUnreal()
  const launchPrepared: HvsUnrealProcessTrace['launchPrepared'] = {
    display: HVS_UNREAL_LAUNCH_DISPLAY,
    sdlVideoDriver: HVS_UNREAL_LAUNCH_SDL,
    sdlVideoDriverAlt: HVS_UNREAL_LAUNCH_SDL,
    xdgRuntimeDir: HVS_UNREAL_XDG_RUNTIME_DIR,
    xdgSessionType: HVS_UNREAL_XDG_SESSION_TYPE,
    unsetWayland: true as const,
    editor: existsSync(HVS_UNREAL_EDITOR) ? HVS_UNREAL_EDITOR : (detected.editorPath ?? HVS_UNREAL_EDITOR),
    uproject: HVS_UE02_UPROJECT,
  }
  if (!found) {
    return {
      status: 'STOPPED',
      pid: null,
      command: null,
      editorPath: launchPrepared.editor,
      uproject: launchPrepared.uproject,
      version: detected.version,
      startedThisCall: false,
      launchPrepared,
    }
  }
  const beat = readUnrealHeartbeat(projectId)
  const stale = beat?.at ? Date.now() - Date.parse(beat.at) > 180_000 : false
  return {
    status: stale ? 'UNRESPONSIVE' : 'RUNNING',
    pid: found.pid,
    command: found.command,
    editorPath: launchPrepared.editor,
    uproject: launchPrepared.uproject,
    version: detected.version,
    startedThisCall: false,
    launchPrepared,
  }
}

export function unrealLaunchArgs(scriptPath?: string, options?: HvsUnrealLaunchOptions): string[] {
  const args = [HVS_UE02_UPROJECT, '-nosplash']
  if (options?.persist) return args
  if (!options?.interactive) args.push('-unattended')
  if (scriptPath) args.push(`-ExecutePythonScript=${scriptPath}`)
  return args
}

export function formatUnrealLaunchCommand(scriptPath?: string, options?: HvsUnrealLaunchOptions): string {
  const args = unrealLaunchArgs(scriptPath, options).map(arg => `'${arg}'`).join(' ')
  return `DISPLAY=${HVS_UNREAL_LAUNCH_DISPLAY} XDG_RUNTIME_DIR=${HVS_UNREAL_XDG_RUNTIME_DIR} XDG_SESSION_TYPE=${HVS_UNREAL_XDG_SESSION_TYPE} SDL_VIDEODRIVER=${HVS_UNREAL_LAUNCH_SDL} SDL_VIDEO_DRIVER=${HVS_UNREAL_LAUNCH_SDL} env -u WAYLAND_DISPLAY ${HVS_UNREAL_EDITOR} ${args}`
}

function interactiveLaunchEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  env.DISPLAY = HVS_UNREAL_LAUNCH_DISPLAY
  env.XDG_RUNTIME_DIR = process.env.XDG_RUNTIME_DIR || HVS_UNREAL_XDG_RUNTIME_DIR
  env.XDG_SESSION_TYPE = HVS_UNREAL_XDG_SESSION_TYPE
  env.SDL_VIDEODRIVER = HVS_UNREAL_LAUNCH_SDL
  env.SDL_VIDEO_DRIVER = HVS_UNREAL_LAUNCH_SDL
  delete env.WAYLAND_DISPLAY
  return env
}

export function startUnrealProcess(projectId: string, scriptPath?: string, options?: HvsUnrealLaunchOptions): HvsUnrealProcessTrace {
  const current = inspectUnrealProcess(projectId)
  if (current.status === 'RUNNING') return { ...current, duplicateRefused: true }
  if (current.status === 'UNRESPONSIVE') return { ...current, duplicateRefused: true }
  const editor = current.launchPrepared.editor
  if (!existsSync(editor) || !existsSync(HVS_UE02_UPROJECT)) return current
  const persist = options?.persist === true
  const child = spawn(editor, unrealLaunchArgs(persist ? undefined : scriptPath, options), {
    env: interactiveLaunchEnv(),
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
  writeUnrealHeartbeat(projectId, child.pid ?? null)
  return {
    ...current,
    status: 'RUNNING',
    pid: child.pid ?? null,
    command: [editor, ...unrealLaunchArgs(persist ? undefined : scriptPath, options)].join(' '),
    startedThisCall: true,
    duplicateRefused: false,
  }
}

export function ensureInteractiveUnrealEditor(projectId: string, likenessOpsPath?: string): HvsUnrealProcessTrace {
  if (likenessOpsPath) installHvsPythonBridge(projectId, likenessOpsPath)
  const current = inspectUnrealProcess(projectId)
  if (current.status === 'RUNNING' || current.status === 'UNRESPONSIVE') {
    focusUnrealWindow()
    return { ...current, duplicateRefused: true }
  }
  return startUnrealProcess(projectId, undefined, { interactive: true, persist: true })
}

export function probeUnrealStability(projectId: string, firstAliveAt: string | null, now = Date.now()): {
  alive: boolean
  stable: boolean
  elapsedMs: number
} {
  const current = inspectUnrealProcess(projectId)
  const alive = current.status === 'RUNNING'
  const elapsedMs = firstAliveAt ? Math.max(0, now - Date.parse(firstAliveAt)) : 0
  return {
    alive,
    stable: alive && Boolean(firstAliveAt) && elapsedMs >= HVS_UNREAL_STABILITY_MS,
    elapsedMs,
  }
}

export function ensureUnrealProcess(projectId: string, options?: { launch?: boolean; scriptPath?: string }): HvsUnrealProcessTrace {
  const current = inspectUnrealProcess(projectId)
  if (current.status === 'RUNNING' || current.status === 'UNRESPONSIVE') return current
  if (options?.launch) return startUnrealProcess(projectId, options.scriptPath)
  return current
}
