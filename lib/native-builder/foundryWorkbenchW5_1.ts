/**
 * Foundry Workbench W5.1 — adapter host + live DAP observability.
 * Closes the W5 gap: real extension-host activation, single user copy,
 * adapter-ready.json, and live js-debug observation. Does not rebuild W0–W5.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { boundDebugSnapshot, type FoundryDebugSnapshot } from './foundryWorkbenchW5'

const require = createRequire(import.meta.url)

export const FOUNDRY_ADAPTER_PUBLISHER_ID = 'foundry.foundry-adapter'
export const FOUNDRY_ADAPTER_FOLDER_ID = 'foundry.foundry-adapter-0.3.0'
export const FOUNDRY_ADAPTER_VERSION = '0.3.0'
export const OPENVSX_ENABLED = false
export const MICROSOFT_MARKETPLACE_ENABLED = false
export const WORKBENCH_DEFAULT = false
export const W4_1_STILL_DEFERRED = true

export const FOUNDRY_W5_1_COMMANDS = [
  'foundry.attachDebugContext',
  'foundry.explainDebugState',
  'foundry.fixFromDebugState',
  'foundry.explainFailedTest',
  'foundry.fixFailedTest',
  'foundry.attachTestResult',
  'foundry.openTestExplorer',
  'foundry.openTesting',
  'foundry.ask',
  'foundry.editSelection',
  'foundry.explainSelection',
  'foundry.reviewChanges',
  'foundry.governedCommit',
  'foundry.governedPush',
  'foundry.openScm',
  'foundry.newTerminal',
] as const

export const ADAPTER_READY_REQUIRED_FIELDS = [
  'extensionId',
  'version',
  'activationTimestamp',
  'workbench',
  'workspaceRoot',
  'capabilities',
] as const

export type AdapterReadyProof = {
  extensionId: string
  version: string
  activationTimestamp: string
  workbench?: {
    appName?: string
    appHost?: string
    sessionId?: string
    extensionHostPid?: number
    uiKind?: number | string
  }
  workspaceRoot?: string | null
  capabilities?: Record<string, boolean>
  commands?: string[]
  host?: string
  copy?: string
  w51?: boolean
}

export type LiveDapProof = {
  debugSessionStarted?: boolean
  debugType?: string | null
  breakpointHit?: boolean
  stoppedReason?: string | null
  activeFrame?: string | null
  boundedVariablesObserved?: boolean
  callStackObserved?: boolean
  stepOverObserved?: boolean
  stepInObserved?: boolean
  stepOutObserved?: boolean
  debugSessionEnded?: boolean
}

export function parseAdapterReady(raw: unknown): AdapterReadyProof | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  if (typeof value.extensionId !== 'string' || typeof value.version !== 'string' || typeof value.activationTimestamp !== 'string') return null
  const blob = JSON.stringify(value)
  if (/tkn=|api[_-]?key|sk_live_|github_pat_|SUPABASE_SERVICE_ROLE/i.test(blob)) return null
  return value as AdapterReadyProof
}

export function adapterReadyIsExtensionHost(ready: AdapterReadyProof | null): boolean {
  if (!ready) return false
  const pid = ready.workbench?.extensionHostPid
  const sessionId = ready.workbench?.sessionId
  return ready.extensionId === FOUNDRY_ADAPTER_PUBLISHER_ID &&
    ready.version === FOUNDRY_ADAPTER_VERSION &&
    ready.host === 'extension-host' &&
    typeof pid === 'number' && pid > 0 &&
    typeof sessionId === 'string' && sessionId.length > 4
}

export function isSyntheticFixtureSnapshot(snapshot: FoundryDebugSnapshot | null | undefined): boolean {
  return !snapshot || snapshot.sessionId === 'w5-fixture-session' || snapshot.sessionId === null
}

function snapshotFromProofFile(file: string): FoundryDebugSnapshot | null {
  if (!existsSync(file)) return null
  try {
    const proof = JSON.parse(readFileSync(file, 'utf8')) as {
      debugType?: string
      stoppedReason?: string | null
      activeFrame?: string | null
      debug?: {
        variables?: FoundryDebugSnapshot['boundedVariables']
        callStack?: FoundryDebugSnapshot['boundedCallStack']
        functionName?: string | null
      }
    }
    const frames = proof.debug?.callStack || []
    const top = frames[0]
    if (!top && !proof.activeFrame) return null
    return boundDebugSnapshot({
      sessionId: `pwa-node:${proof.debugType || 'pwa-node'}`,
      stoppedReason: proof.stoppedReason || 'breakpoint',
      activeFrame: proof.activeFrame || top?.functionName || null,
      functionName: proof.debug?.functionName || proof.activeFrame || top?.functionName || null,
      file: top?.file || null,
      line: top?.line || null,
      boundedCallStack: frames,
      boundedVariables: proof.debug?.variables || [],
      exception: null,
      breakpoint: top ? { file: top.file || '', line: top.line || 0, enabled: true } : null,
      attached: true,
    })
  } catch {
    return null
  }
}

export function liveDebugSnapshotFromState(stateDir: string): FoundryDebugSnapshot | null {
  const files = [
    path.join(stateDir, 'debug-snapshot-breakpoint.json'),
    path.join(stateDir, 'debug-snapshot.json'),
  ]
  for (const file of files) {
    if (!existsSync(file)) continue
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as FoundryDebugSnapshot
      const bounded = boundDebugSnapshot(parsed)
      if (!isSyntheticFixtureSnapshot(bounded) && bounded.attached && (bounded.boundedCallStack.length || bounded.functionName)) return bounded
    } catch {
      /* next */
    }
  }
  return snapshotFromProofFile(path.join(stateDir, 'w5-1-proof-result.json'))
    || snapshotFromProofFile(path.join(stateDir, 'w5-proof-result.json'))
}

export function liveDapFieldsPass(proof: LiveDapProof | null | undefined): boolean {
  if (!proof) return false
  return proof.debugSessionStarted === true &&
    proof.debugType === 'pwa-node' &&
    proof.breakpointHit === true &&
    Boolean(proof.stoppedReason) &&
    Boolean(proof.activeFrame) &&
    proof.boundedVariablesObserved === true &&
    proof.callStackObserved === true &&
    proof.stepOverObserved === true &&
    proof.stepInObserved === true &&
    proof.stepOutObserved === true &&
    proof.debugSessionEnded === true
}

export function adapterCatalogLooksStored(raw: unknown): boolean {
  if (!Array.isArray(raw) || !raw.length) return false
  return raw.some(item => {
    const rec = item as { identifier?: { id?: string }; version?: string; location?: { scheme?: string; path?: string }; relativeLocation?: string }
    return rec?.identifier?.id === FOUNDRY_ADAPTER_PUBLISHER_ID &&
      rec.version === FOUNDRY_ADAPTER_VERSION &&
      rec.location?.scheme === 'file' &&
      typeof rec.location.path === 'string' &&
      rec.location.path.includes(FOUNDRY_ADAPTER_FOLDER_ID) &&
      rec.relativeLocation === FOUNDRY_ADAPTER_FOLDER_ID
  })
}

export function obsoleteHasFoundry(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false
  return Object.keys(raw as Record<string, unknown>).some(key => key.includes('foundry.foundry-adapter'))
}

export function countDiskAdapterCopies(extensionsDir: string, runtimeExtensions?: string): number {
  let count = 0
  if (existsSync(extensionsDir)) {
    const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs')
    for (const name of readdirSync(extensionsDir)) {
      if (/^foundry\.foundry-adapter-\d+\.\d+\.\d+$/.test(name) && statSync(path.join(extensionsDir, name)).isDirectory()) count += 1
    }
  }
  if (runtimeExtensions && existsSync(path.join(runtimeExtensions, 'foundry-adapter'))) count += 1
  return count
}

export function attemptTypescriptSourceMapFixture(root?: string): {
  status: 'PASS' | 'LIMITED'
  reason: string
  folder: string
  compiledJs: boolean
  mapExists: boolean
  mapsToTs: boolean
} {
  const folder = root || path.join(os.tmpdir(), `w5-1-ts-${process.pid}`)
  mkdirSync(folder, { recursive: true })
  mkdirSync(path.join(folder, 'src'), { recursive: true })
  writeFileSync(path.join(folder, 'tsconfig.json'), `${JSON.stringify({
    compilerOptions: {
      target: 'ES2020',
      module: 'commonjs',
      sourceMap: true,
      outDir: 'dist',
      rootDir: 'src',
      strict: true,
    },
    include: ['src/**/*.ts'],
  }, null, 2)}\n`)
  writeFileSync(path.join(folder, 'src', 'calculate-total.ts'), `export function calculateTotal(items: Array<{ price: number; qty: number }>): number {
  let total = 0
  for (let i = 0; i < items.length - 1; i++) {
    total += items[i].price * items[i].qty
  }
  return total
}

const items = [{ price: 10, qty: 2 }, { price: 5, qty: 1 }]
calculateTotal(items)
`)
  const tsc = path.join(resolveRepoRoot(), 'node_modules', 'typescript', 'bin', 'tsc')
  if (!existsSync(tsc)) {
    return { status: 'LIMITED', reason: 'typescript compiler is not installed in this checkout', folder, compiledJs: false, mapExists: false, mapsToTs: false }
  }
  const ran = spawnSync(process.execPath, [tsc, '-p', folder], { encoding: 'utf8', timeout: 20_000 })
  const compiledJs = existsSync(path.join(folder, 'dist', 'calculate-total.js'))
  const mapFile = path.join(folder, 'dist', 'calculate-total.js.map')
  const mapExists = existsSync(mapFile)
  const mapText = mapExists ? readFileSync(mapFile, 'utf8') : ''
  const mapsToTs = /calculate-total\.ts/.test(mapText)
  if (ran.status !== 0 || !compiledJs || !mapExists || !mapsToTs) {
    return {
      status: 'LIMITED',
      reason: `tsc status=${ran.status} compiled=${compiledJs} map=${mapExists} mapsToTs=${mapsToTs} ${String(ran.stderr || ran.stdout).slice(0, 180)}`,
      folder,
      compiledJs,
      mapExists,
      mapsToTs,
    }
  }
  return { status: 'LIMITED', reason: 'source map emit proven; live TS debugger still requires js-debug to bind .ts frames', folder, compiledJs, mapExists, mapsToTs }
}

export function loadInstallAdapter() {
  const abs = [resolveRepoRoot(), 'desktop', 'workbench-host', 'install-adapter.cjs'].join(path.sep)
  const load = Function(
    'createRequireFn',
    'meta',
    'absPath',
    'return createRequireFn(meta)(absPath)',
  ) as (createRequireFn: typeof createRequire, meta: string, absPath: string) => unknown
  return load(createRequire, import.meta.url, abs) as {
    ADAPTER_ID: string
    ADAPTER_PUBLISHER_ID: string
    storedExtensionRecord: (dest: string) => Record<string, unknown>
    writeStoredExtensionCatalog: (file: string, dest: string) => void
    isStoredExtension: (item: unknown) => boolean
    countFoundryAdapterCopies: (extensionsDir: string) => number
  }
}
