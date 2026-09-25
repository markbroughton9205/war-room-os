/**
 * Host/runtime Electron sandbox capability.
 * Native Chromium sandbox is preferred. --no-sandbox is a host decision only when
 * this host cannot boot Electron with the native sandbox. That is not a Foundry W7
 * production policy bypass.
 */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { resolveLocalAppDataPaths } from '@/lib/sovereign-runtime/local-ownership/paths'

const nodeRequire = createRequire(import.meta.url)

type HelperInspect = {
  helper: string
  exists: boolean
  uid?: number
  mode?: string
  suid?: boolean
  rootOwned?: boolean
  native?: boolean
  verdict?: string
}

function readSysctl(file: string): string | null {
  try {
    return readFileSync(file, 'utf8').trim()
  } catch {
    return null
  }
}

function inspectHelper(helper: string): HelperInspect {
  const lib = nodeRequire('../../desktop/workbench-host/prepare-linux-chrome-sandbox.cjs') as {
    inspectHelper: (helper: string) => HelperInspect
  }
  return lib.inspectHelper(helper)
}

function hostStatePath(): string {
  return path.join(resolveLocalAppDataPaths().data, 'runtime', 'linux-electron-sandbox.json')
}

export type LinuxElectronSandboxHostState = {
  native_boot_failed: boolean
  failed_at?: string
  detail?: string
  helper?: string | null
}

export function readLinuxElectronSandboxHostState(): LinuxElectronSandboxHostState | null {
  const file = hostStatePath()
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as LinuxElectronSandboxHostState
  } catch {
    return null
  }
}

export function recordLinuxElectronSandboxBoot(input: {
  nativeOk: boolean
  detail: string
  helper?: string | null
}): LinuxElectronSandboxHostState {
  const file = hostStatePath()
  mkdirSync(path.dirname(file), { recursive: true })
  const state: LinuxElectronSandboxHostState = input.nativeOk
    ? { native_boot_failed: false, detail: input.detail, helper: input.helper ?? null }
    : { native_boot_failed: true, failed_at: new Date().toISOString(), detail: input.detail, helper: input.helper ?? null }
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`)
  return state
}

export type LinuxElectronSandboxCapability = {
  sandbox_supported: boolean
  sandbox_mode: 'native' | 'no-sandbox-host-required'
  reason: string
  helper: string | null
  helper_native: boolean
  userns_clone: string | null
  apparmor_restrict_unprivileged_userns: string | null
  native_boot_failed: boolean
}

export function inspectLinuxElectronSandboxCapability(helperPath?: string | null): LinuxElectronSandboxCapability {
  const helper = helperPath && existsSync(helperPath) ? helperPath : null
  const inspect = helper ? inspectHelper(helper) : { helper: helperPath ?? '', exists: false }
  const userns_clone = readSysctl('/proc/sys/kernel/unprivileged_userns_clone')
  const apparmor_restrict_unprivileged_userns = readSysctl('/proc/sys/kernel/apparmor_restrict_unprivileged_userns')
  const helperNative = inspect.native === true
  const usernsBlocked = apparmor_restrict_unprivileged_userns === '1'
  const usernsAllowed = userns_clone === '1' && !usernsBlocked
  const host = readLinuxElectronSandboxHostState()
  const kernel = { userns_clone, apparmor_restrict_unprivileged_userns, helper, helper_native: helperNative }

  if (host?.native_boot_failed) {
    return {
      sandbox_supported: false,
      sandbox_mode: 'no-sandbox-host-required',
      reason: `Native Chromium sandbox helper is installed but a live boot on this host failed (${host.detail ?? 'no detail'}). Host capability fallback uses --no-sandbox. Foundry W7 production policy is unchanged.`,
      native_boot_failed: true,
      ...kernel,
    }
  }
  if (helperNative) {
    return {
      sandbox_supported: true,
      sandbox_mode: 'native',
      reason: 'SUID chrome-sandbox helper is present (uid 0, mode 4755). Native Chromium sandbox is preferred even when unprivileged user namespaces are restricted.',
      native_boot_failed: false,
      ...kernel,
    }
  }
  if (usernsAllowed) {
    return {
      sandbox_supported: true,
      sandbox_mode: 'native',
      reason: 'SUID helper is not native, but unprivileged user namespaces are allowed so Electron can use the userns sandbox.',
      native_boot_failed: false,
      ...kernel,
    }
  }
  return {
    sandbox_supported: false,
    sandbox_mode: 'no-sandbox-host-required',
    reason: [
      'Electron Chromium sandbox cannot start on this host without a bypass.',
      inspect.exists ? `chrome-sandbox exists but is not a native SUID helper (uid=${inspect.uid ?? 'n/a'} mode=${inspect.mode ?? 'n/a'}).` : 'chrome-sandbox helper is missing.',
      usernsBlocked ? 'kernel.apparmor_restrict_unprivileged_userns=1 blocks the userns sandbox.' : `unprivileged_userns_clone=${userns_clone ?? 'unknown'}.`,
    ].join(' '),
    native_boot_failed: false,
    ...kernel,
  }
}

export function electronLaunchFlags(capability: LinuxElectronSandboxCapability): string[] {
  const base = ['--ozone-platform=x11', '--remote-debugging-address=127.0.0.1']
  if (capability.sandbox_mode === 'no-sandbox-host-required') {
    return ['--no-sandbox', ...base]
  }
  return base
}

export function electronShimExecLine(executablePath: string, capability: LinuxElectronSandboxCapability): string {
  return `exec "${executablePath}" ${electronLaunchFlags(capability).join(' ')} "$@"`
}

export function helperBesideExecutable(executablePath: string): string {
  return path.join(path.dirname(executablePath), 'chrome-sandbox')
}
