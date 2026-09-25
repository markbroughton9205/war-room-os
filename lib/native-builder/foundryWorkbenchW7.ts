/**
 * Foundry Workbench W7 — Linux production readiness + default qualification.
 * Does not rebuild editor/terminal/SCM/debugger/Test Explorer/adapter/Tool Broker.
 * DEFAULT-READY != PRODUCTION-ACTIVATED.
 * Does not package, install, activate, commit, push, or deploy.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { isFoundryWorkbenchW0Enabled } from './foundryWorkbenchW0'
import { MICROSOFT_MARKETPLACE_ENABLED as W6_MARKETPLACE, OPENVSX_DEFAULT_ON as W6_OPENVSX, WORKBENCH_DEFAULT as W6_DEFAULT } from './foundryWorkbenchW6'

const require = createRequire(import.meta.url)

export const WORKBENCH_DEFAULT_READY_POLICY = 'WORKBENCH_DEFAULT_READY may become PASS while WORKBENCH_DEFAULT_ENABLED remains NO'
export const WORKBENCH_DEFAULT_ENABLED = false
export const OPENVSX_DEFAULT_ON = false
export const MICROSOFT_MARKETPLACE_ENABLED = false
export const W4_1_STILL_DEFERRED = true
export const W7_SCOPE = 'linux production readiness and default qualification only'
export const W7_PRODUCTIONIZATION_EXECUTED = false

export type LinuxSandboxVerdict = 'SANDBOX_NATIVE_PASS' | 'ENVIRONMENT_FIX_REQUIRED' | 'PACKAGING_FIX_REQUIRED'

export function linuxHostIdentity() {
  return {
    os: os.platform(),
    osRelease: os.release(),
    architecture: os.arch(),
    hostname: os.hostname(),
    linuxFirst: os.platform() === 'linux',
  }
}

function sandboxLib() {
  return require(path.join(resolveRepoRoot(), 'desktop/workbench-host/prepare-linux-chrome-sandbox.cjs')) as {
    inspectSource: (repoRoot: string) => {
      helper: string
      exists: boolean
      uid?: number
      mode?: string
      suid?: boolean
      rootOwned?: boolean
      native?: boolean
      verdict: LinuxSandboxVerdict
      operatorCommand?: string | null
      kernel: { unprivileged_userns_clone: string | null; apparmor_restrict_unprivileged_userns: string | null }
      rootCause: string
    }
    applyHelper: (helper: string) => { ok: boolean; applied: boolean; inspect: { verdict: LinuxSandboxVerdict; helper: string; mode?: string; uid?: number }; method?: string; operatorCommand?: string; error?: string }
    sourceHelper: (repoRoot: string) => string
  }
}

export function inspectLinuxChromeSandbox() {
  return sandboxLib().inspectSource(resolveRepoRoot())
}

export function applyLinuxChromeSandbox() {
  const lib = sandboxLib()
  return lib.applyHelper(lib.sourceHelper(resolveRepoRoot()))
}

export function workbenchDefaultReady(input: { sandboxPass: boolean; regressionsPass: boolean; livePass: boolean }): boolean {
  return input.sandboxPass && input.regressionsPass && input.livePass
}

export function workbenchDefaultEnabled(): boolean {
  return WORKBENCH_DEFAULT_ENABLED === true && isFoundryWorkbenchW0Enabled()
}

export const W7_COUNTS_ZERO = {
  PRODUCTION_NO_SANDBOX_FLAG_COUNT: 0,
  PRODUCTION_DISABLE_SANDBOX_ENV_COUNT: 0,
  W7_ORPHAN_PROCESS_COUNT: 0,
  W7_DUPLICATE_WORKBENCH_HOST_COUNT: 0,
  W7_DIRTY_BUFFER_CLOBBER_COUNT: 0,
  W7_SECRET_LEAK_COUNT: 0,
  AUTO_COMMIT_COUNT: 0,
  AUTO_PUSH_COUNT: 0,
  AGENT_AUTONOMOUS_COMMIT_COUNT: 0,
  AGENT_AUTONOMOUS_PUSH_COUNT: 0,
  AGENT_EXTENSION_INSTALL_COUNT: 0,
  SILENT_EXTENSION_DOWNLOAD_COUNT: 0,
  AUTO_EXTENSION_UPDATE_COUNT: 0,
  AGENT_FREE_SHELL_VIA_EXTENSION_COUNT: 0,
} as const

const PRODUCTION_NO_SANDBOX_PATHS = [
  'desktop/src/main.cjs',
  'lib/native-builder/installerTool.ts',
  'lib/native-builder/runtimeControl.ts',
]

const PRODUCTION_DISABLE_SANDBOX_PATHS = [
  'desktop/src/main.cjs',
  'lib/native-builder/installerTool.ts',
  'lib/native-builder/runtimeControl.ts',
]

export function productionNoSandboxFlagCount(): number {
  let count = 0
  for (const rel of PRODUCTION_NO_SANDBOX_PATHS) {
    const text = readFileSync(path.join(resolveRepoRoot(), rel), 'utf8')
    count += (text.match(/appendSwitch\(\s*['"]no-sandbox['"]\s*\)/g) || []).length
    count += (text.match(/['"`]--no-sandbox['"`]/g) || []).length
    count += (text.match(/\s--no-sandbox(?:\s|$)/g) || []).length
  }
  return count
}

export function productionDisableSandboxEnvCount(): number {
  let count = 0
  for (const rel of PRODUCTION_DISABLE_SANDBOX_PATHS) {
    const text = readFileSync(path.join(resolveRepoRoot(), rel), 'utf8')
    count += (text.match(/ELECTRON_DISABLE_SANDBOX\s*=/g) || []).length
  }
  return count
}

export const W7_SOURCE_SCOPE = [
  'desktop/src/main.cjs',
  'desktop/src/foundryWorkbench.cjs',
  'desktop/workbench-host/',
  'desktop/workbench-host/extensions/foundry-adapter/',
  'desktop/workbench-host/prepare-linux-chrome-sandbox.cjs',
  'desktop/scripts/after-pack-linux-sandbox.cjs',
  'lib/native-builder/foundryWorkbenchW0.ts',
  'lib/native-builder/foundryWorkbenchW0.host.ts',
  'lib/native-builder/foundryWorkbenchW1.validation.ts',
  'lib/native-builder/foundryWorkbenchW1.proof.ts',
  'lib/native-builder/installerTool.ts',
  'lib/native-builder/runtimeControl.ts',
  'desktop/package.json',
  'lib/native-builder/foundryWorkbenchW2.ts',
  'lib/native-builder/foundryWorkbenchW3.ts',
  'lib/native-builder/foundryWorkbenchW4.ts',
  'lib/native-builder/foundryWorkbenchW5.ts',
  'lib/native-builder/foundryWorkbenchW5_1.ts',
  'lib/native-builder/foundryWorkbenchW6.ts',
  'lib/native-builder/foundryWorkbenchW6.fixtures.ts',
  'lib/native-builder/foundryWorkbenchW7.ts',
  'lib/native-builder/foundryWorkbenchW7.validation.ts',
  'lib/native-builder/foundryWorkbenchW7.proof.ts',
  'lib/native-builder/foundryWorkbenchEvents.ts',
  'lib/native-builder/foundryAgentEvents.ts',
  'components/war-room/foundry/FoundryWorkbenchPane.tsx',
  'components/war-room/foundry/FoundryWorkbenchAiPanel.tsx',
  'components/war-room/foundry/FoundryWorkbenchExtensionsPanel.tsx',
  'components/war-room/foundry/FoundryShell.tsx',
  'app/api/foundry/workbench/',
] as const

export function sourceScopeExists(): { rel: string; exists: boolean }[] {
  const root = resolveRepoRoot()
  return W7_SOURCE_SCOPE.map(rel => ({ rel, exists: existsSync(path.join(root, rel)) }))
}

export function futureProductionizationPlan() {
  return {
    executed: false,
    steps: [
      'Commander authorizes a dedicated production package mission with a source-scope manifest (W7_SOURCE_SCOPE), not the entire dirty tree',
      'pnpm --dir desktop run dist:linux (or equivalent package.run) from a reviewed W0–W7 source snapshot',
      'Run desktop/workbench-host/prepare-linux-chrome-sandbox.cjs --apply against packaged chrome-sandbox (sudo chown root:root && chmod 4755)',
      'installer.install_production copies linux-unpacked, then prepareLinuxChromeSandbox on install chrome-sandbox',
      'installer.activate writes a launcher shim WITHOUT --no-sandbox and WITHOUT ELECTRON_DISABLE_SANDBOX',
      'Set WORKBENCH_DEFAULT_ENABLED only after a separate Commander authorization; FOUNDRY_WORKBENCH_W0 stays off until then',
      'Runtime verification: native sandbox desktop start, owned Workbench 127.0.0.1:3849, adapter copy=1',
      'Rollback: restore previous launcher shim; do not chmod unrelated system binaries',
    ],
  }
}

export const W7_MODE_SEPARATION = {
  WORKBENCH: 'primary manual engineering surface once default-enabled',
  AGENT: 'remains available; Workbench default does not convert every task to manual',
  STANDALONE_ENGINEER: 'remains available',
} as const

export function marketplaceStillOff(): boolean {
  return MICROSOFT_MARKETPLACE_ENABLED === false && W6_MARKETPLACE === false
}

export function openVsxStillDefaultOff(): boolean {
  return OPENVSX_DEFAULT_ON === false && W6_OPENVSX === false
}

export function workbenchDefaultStillDisabled(): boolean {
  return WORKBENCH_DEFAULT_ENABLED === false && W6_DEFAULT === false
}

export function walkRssKb(pid: number): number {
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf8')
    const match = status.match(/^VmRSS:\s+(\d+)\s+kB/m)
    return match ? Number(match[1]) : 0
  } catch {
    return 0
  }
}

export function descendantPids(pid: number): number[] {
  const kids: number[] = []
  try {
    for (const name of readdirSync('/proc')) {
      if (!/^\d+$/.test(name)) continue
      const child = Number(name)
      try {
        const stat = readFileSync(`/proc/${child}/stat`, 'utf8')
        const ppid = Number(stat.split(')')[1]?.trim().split(/\s+/)[1])
        if (ppid === pid) kids.push(child)
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return [...kids, ...kids.flatMap(child => descendantPids(child))]
}

export const W6_STILL_DEFAULT = W6_DEFAULT
export const W7_CARRY_TYPESCRIPT_SOURCE_MAP = 'LIMITED'
