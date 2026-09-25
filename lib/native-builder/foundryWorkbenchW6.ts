/**
 * Foundry Workbench W6 — governed extension lifecycle.
 * Does not rebuild editor, terminal, SCM, debugger, Test Explorer,
 * Foundry adapter, Tool Broker, or Model Router.
 * Extensions are code. Discovery != authorization != install != activation != trust.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, appendFileSync, cpSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { foundryWorkbenchStateDir } from './foundryWorkbenchW0.host'
import { FOUNDRY_ADAPTER_PUBLISHER_ID, FOUNDRY_ADAPTER_FOLDER_ID, MICROSOFT_MARKETPLACE_ENABLED as W5_1_MARKETPLACE, WORKBENCH_DEFAULT as W5_1_DEFAULT } from './foundryWorkbenchW5_1'

const require = createRequire(import.meta.url)

export const FOUNDRY_ADAPTER_PROTECTED_ID = FOUNDRY_ADAPTER_PUBLISHER_ID
export const MICROSOFT_MARKETPLACE_ENABLED = false
export const WORKBENCH_DEFAULT = false
export const OPENVSX_DEFAULT_ON = false
export const OPENVSX_SOURCE_IMPLEMENTED = true
export const W4_1_STILL_DEFERRED = true
export const W6_SCOPE = 'governed extension lifecycle only'

export type FoundryExtensionSourceType = 'BUILTIN' | 'LOCAL_VSIX' | 'OPENVSX' | 'OFFICIAL_RELEASE' | 'MANUAL_PATH'

export type FoundryExtensionStatus =
  | 'DISCOVERED'
  | 'REVIEW_PENDING'
  | 'APPROVED'
  | 'INSTALLED'
  | 'ACTIVE'
  | 'DISABLED'
  | 'UPDATE_AVAILABLE'
  | 'QUARANTINED'
  | 'REMOVED'
  | 'BLOCKED'

export type FoundryLinuxCompat = 'LINUX_COMPATIBLE' | 'LINUX_UNKNOWN' | 'LINUX_UNSUPPORTED'

export type FoundryTrustCategory =
  | 'LOW_RISK_LANGUAGE_DATA'
  | 'LANGUAGE_SERVER'
  | 'DEBUG_ADAPTER'
  | 'TEST_ADAPTER'
  | 'FORMATTER'
  | 'LINTER'
  | 'SCM_INTEGRATION'
  | 'TERMINAL_PROCESS'
  | 'NETWORKED'
  | 'NATIVE_BINARY'
  | 'UNKNOWN'

export type FoundryExtensionSource = {
  type: FoundryExtensionSourceType
  uri?: string
  catalogLabel: string
}

export type FoundryExtensionRecord = {
  extensionId: string
  publisher: string
  name: string
  version: string
  sourceType: FoundryExtensionSourceType
  sourceUri?: string
  license: string
  repository?: string
  homepage?: string
  sha256?: string
  installedPath?: string
  enabled: boolean
  trusted: boolean
  approvedBy?: string
  approvedAt?: string
  installedAt?: string
  updatedAt?: string
  capabilities: FoundryTrustCategory[]
  platform: string
  architecture: string
  linuxCompat: FoundryLinuxCompat
  status: FoundryExtensionStatus
  reason?: string
  nativeBinaries: string[]
  installScripts: string[]
  networkEndpoints: string[]
  networkBehavior: 'UNKNOWN' | 'DECLARED'
  workspaceTrust: 'UNKNOWN' | 'DECLARED'
}

export const PREFERRED_LICENSES = ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'MPL-2.0'] as const

export const INITIAL_ALLOWLIST = [
  'foundry.w6-lint-fixture',
  'foundry.w6-language-fixture',
] as const

export const W6_COUNTS_ZERO = {
  AGENT_EXTENSION_INSTALL_COUNT: 0,
  SILENT_EXTENSION_DOWNLOAD_COUNT: 0,
  AUTO_EXTENSION_UPDATE_COUNT: 0,
  UNSAFE_EXTENSION_AUTO_INSTALL_COUNT: 0,
  DUPLICATE_ACTIVE_EXTENSION_COUNT: 0,
  AGENT_FREE_SHELL_VIA_EXTENSION_COUNT: 0,
  EXTENSION_SECRET_LEAK_COUNT: 0,
} as const

type RegistryFile = {
  host: ReturnType<typeof linuxHostIdentity>
  records: FoundryExtensionRecord[]
  counts: Record<string, number>
  recommendations: Array<{ extensionId: string; text: string; at: string; approved: false }>
}

export function linuxHostIdentity() {
  return {
    os: os.platform(),
    osRelease: os.release(),
    architecture: os.arch(),
    linuxFirst: os.platform() === 'linux',
  }
}

export function openVsxCatalogLabel(): string {
  return 'Extension Source: OpenVSX'
}

function registryPath(stateDir: string) {
  return path.join(stateDir, 'extensions-registry.json')
}

function provenancePath(stateDir: string) {
  return path.join(stateDir, 'extensions-provenance.jsonl')
}

function disabledPath(stateDir: string) {
  return path.join(stateDir, 'disabled-extensions.json')
}

export function emptyCounts(): Record<string, number> {
  return { ...W6_COUNTS_ZERO, FOUNDRY_ADAPTER_ACTIVE_COPY_COUNT: 1 }
}

export function loadRegistry(stateDir: string): RegistryFile {
  mkdirSync(stateDir, { recursive: true })
  const file = registryPath(stateDir)
  if (!existsSync(file)) {
    return { host: linuxHostIdentity(), records: [], counts: emptyCounts(), recommendations: [] }
  }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as RegistryFile
    parsed.counts = { ...emptyCounts(), ...(parsed.counts || {}) }
    parsed.records = Array.isArray(parsed.records) ? parsed.records : []
    parsed.recommendations = Array.isArray(parsed.recommendations) ? parsed.recommendations : []
    parsed.host = parsed.host || linuxHostIdentity()
    return parsed
  } catch {
    return { host: linuxHostIdentity(), records: [], counts: emptyCounts(), recommendations: [] }
  }
}

export function saveRegistry(stateDir: string, registry: RegistryFile) {
  mkdirSync(stateDir, { recursive: true })
  const blob = JSON.stringify(registry, null, 2)
  if (/tkn=|sk_live_|github_pat_|SUPABASE_SERVICE_ROLE|BEGIN PRIVATE KEY/i.test(blob)) {
    throw new Error('EXTENSION_SECRET_LEAK')
  }
  writeFileSync(registryPath(stateDir), `${blob}\n`)
  const disabled = registry.records.filter(item => item.status === 'DISABLED' || item.status === 'QUARANTINED' || item.enabled === false).map(item => item.extensionId)
  writeFileSync(disabledPath(stateDir), `${JSON.stringify({ ids: disabled.filter(id => id !== FOUNDRY_ADAPTER_PROTECTED_ID), at: new Date().toISOString() }, null, 2)}\n`)
}

export function appendProvenance(stateDir: string, event: Record<string, unknown>) {
  mkdirSync(stateDir, { recursive: true })
  const line = JSON.stringify({ at: new Date().toISOString(), ...event })
  if (/tkn=|sk_live_|github_pat_|SUPABASE_SERVICE_ROLE/i.test(line)) return
  appendFileSync(provenancePath(stateDir), `${line}\n`)
}

export function sha256File(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

export function sha256Dir(dir: string): string {
  const hash = createHash('sha256')
  const walk = (current: string) => {
    const names = readdirSync(current).sort()
    for (const name of names) {
      const full = path.join(current, name)
      const st = statSync(full)
      hash.update(name)
      if (st.isDirectory()) walk(full)
      else hash.update(readFileSync(full))
    }
  }
  walk(dir)
  return hash.digest('hex')
}

export function classifyLicense(raw: unknown): { license: string; gate: 'PASS' | 'REVIEW_PENDING' | 'BLOCKED' } {
  const license = String(raw || '').trim() || 'UNKNOWN'
  if (license === 'UNKNOWN' || license === 'UNLICENSED' || /proprietary|commercial|all rights reserved/i.test(license)) {
    return { license, gate: license === 'UNKNOWN' ? 'REVIEW_PENDING' : 'BLOCKED' }
  }
  if (PREFERRED_LICENSES.some(item => license === item || license.startsWith(item))) return { license, gate: 'PASS' }
  return { license, gate: 'REVIEW_PENDING' }
}

export function linuxCompatibility(manifest: Record<string, unknown>): FoundryLinuxCompat {
  const osField = manifest.os
  const cpu = manifest.cpu
  if (Array.isArray(osField) && osField.length && !osField.includes('linux')) return 'LINUX_UNSUPPORTED'
  if (Array.isArray(cpu) && cpu.length && !(cpu.includes('x64') || cpu.includes('x86_64'))) return 'LINUX_UNSUPPORTED'
  if (os.platform() !== 'linux') return 'LINUX_UNKNOWN'
  return 'LINUX_COMPATIBLE'
}

export function capabilityProfile(manifest: Record<string, unknown>): FoundryTrustCategory[] {
  const contributes = (manifest.contributes && typeof manifest.contributes === 'object' ? manifest.contributes : {}) as Record<string, unknown>
  const cats = new Set<FoundryTrustCategory>()
  if (contributes.languages || contributes.grammars) cats.add('LOW_RISK_LANGUAGE_DATA')
  if (contributes.languageServer || /language.?server/i.test(JSON.stringify(manifest))) cats.add('LANGUAGE_SERVER')
  if (contributes.debuggers || contributes.breakpoints) cats.add('DEBUG_ADAPTER')
  if (contributes.test || contributes.testing) cats.add('TEST_ADAPTER')
  if (contributes.formatters || /format/i.test(String(manifest.displayName || ''))) cats.add('FORMATTER')
  if (contributes.linters || /lint|eslint/i.test(String(manifest.name || '') + String(manifest.displayName || ''))) cats.add('LINTER')
  if (contributes.git || /scm|git/i.test(String(manifest.name || ''))) cats.add('SCM_INTEGRATION')
  const commands = Array.isArray(contributes.commands) ? contributes.commands as Array<{ command?: string }> : []
  if (commands.some(item => /terminal|shell|exec/i.test(String(item.command || '')))) cats.add('TERMINAL_PROCESS')
  if (!cats.size) cats.add('UNKNOWN')
  return [...cats]
}

export function inspectExtensionPackage(packageDir: string): {
  manifest: Record<string, unknown>
  license: ReturnType<typeof classifyLicense>
  linuxCompat: FoundryLinuxCompat
  capabilities: FoundryTrustCategory[]
  nativeBinaries: string[]
  installScripts: string[]
  networkEndpoints: string[]
  networkBehavior: 'UNKNOWN' | 'DECLARED'
  concerns: string[]
} {
  const pkgFile = path.join(packageDir, 'package.json')
  const manifest = JSON.parse(readFileSync(pkgFile, 'utf8')) as Record<string, unknown>
  const license = classifyLicense(manifest.license)
  const linuxCompat = linuxCompatibility(manifest)
  const capabilities = capabilityProfile(manifest)
  const scripts = (manifest.scripts && typeof manifest.scripts === 'object' ? manifest.scripts : {}) as Record<string, string>
  const installScripts = ['preinstall', 'install', 'postinstall', 'prepare'].filter(name => Boolean(scripts[name]))
  const nativeBinaries: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name)
      const st = statSync(full)
      if (st.isDirectory()) {
        if (name === 'node_modules') continue
        walk(full)
      } else if (/\.(node|so|dylib|exe|dll)$/i.test(name) || name === 'bin') {
        nativeBinaries.push(path.relative(packageDir, full))
      }
    }
  }
  walk(packageDir)
  if (nativeBinaries.length) capabilities.push('NATIVE_BINARY')
  const blob = JSON.stringify(manifest)
  const networkEndpoints = [...blob.matchAll(/https?:\/\/[^\s"'\\]+/g)].map(item => item[0]).filter(url => !/open-vsx\.org|schema\.json|aka\.ms\/vscode/i.test(url)).slice(0, 12)
  if (networkEndpoints.length) {
    capabilities.push('NETWORKED')
  }
  const concerns: string[] = []
  if (license.gate !== 'PASS') concerns.push(`license:${license.license}:${license.gate}`)
  if (linuxCompat === 'LINUX_UNSUPPORTED') concerns.push('linux-unsupported')
  if (installScripts.length) concerns.push(`install-scripts:${installScripts.join(',')}`)
  if (nativeBinaries.length) concerns.push(`native-binaries:${nativeBinaries.join(',')}`)
  if (capabilities.includes('TERMINAL_PROCESS')) concerns.push('shell-command-contribution')
  if (networkEndpoints.length) concerns.push('network-bootstrap-declared')
  return {
    manifest,
    license,
    linuxCompat,
    capabilities: [...new Set(capabilities)],
    nativeBinaries,
    installScripts,
    networkEndpoints,
    networkBehavior: networkEndpoints.length ? 'DECLARED' : 'UNKNOWN',
    concerns,
  }
}

export function recordFromInspect(packageDir: string, sourceType: FoundryExtensionSourceType, sourceUri?: string): FoundryExtensionRecord {
  const inspect = inspectExtensionPackage(packageDir)
  const publisher = String(inspect.manifest.publisher || 'unknown')
  const name = String(inspect.manifest.name || path.basename(packageDir))
  const extensionId = `${publisher}.${name}`
  const version = String(inspect.manifest.version || '0.0.0')
  const status: FoundryExtensionStatus = inspect.concerns.length || inspect.license.gate !== 'PASS' ? (inspect.linuxCompat === 'LINUX_UNSUPPORTED' ? 'BLOCKED' : 'REVIEW_PENDING') : 'DISCOVERED'
  return {
    extensionId,
    publisher,
    name,
    version,
    sourceType,
    sourceUri,
    license: inspect.license.license,
    repository: typeof inspect.manifest.repository === 'string' ? inspect.manifest.repository : (inspect.manifest.repository as { url?: string } | undefined)?.url,
    homepage: typeof inspect.manifest.homepage === 'string' ? inspect.manifest.homepage : undefined,
    sha256: sha256Dir(packageDir),
    enabled: false,
    trusted: false,
    capabilities: inspect.capabilities,
    platform: 'linux',
    architecture: os.arch(),
    linuxCompat: inspect.linuxCompat,
    status,
    reason: inspect.concerns.join('; ') || undefined,
    nativeBinaries: inspect.nativeBinaries,
    installScripts: inspect.installScripts,
    networkEndpoints: inspect.networkEndpoints,
    networkBehavior: inspect.networkBehavior,
    workspaceTrust: 'UNKNOWN',
  }
}

export function recommendExtension(stateDir: string, extensionId: string, text: string) {
  const registry = loadRegistry(stateDir)
  registry.recommendations.push({ extensionId, text: String(text).slice(0, 400), at: new Date().toISOString(), approved: false })
  saveRegistry(stateDir, registry)
  return registry.recommendations[registry.recommendations.length - 1]
}

type MutateInput = {
  action: 'review' | 'approve' | 'install' | 'enable' | 'disable' | 'update' | 'remove' | 'quarantine' | 'download'
  actor: 'commander' | 'agent'
  commanderApproved?: boolean
  extensionId?: string
  packageDir?: string
  vsixPath?: string
  sourceType?: FoundryExtensionSourceType
  nextPackageDir?: string
  nextVsixPath?: string
}

export type MutateResult = {
  ok: boolean
  code?: string
  record?: FoundryExtensionRecord
  records?: FoundryExtensionRecord[]
  concerns?: string[]
}

function refuse(stateDir: string, registry: RegistryFile, code: string, extra?: Partial<MutateResult>): MutateResult {
  saveRegistry(stateDir, registry)
  return { ok: false, code, ...extra }
}

function loadHost() {
  const abs = [resolveRepoRoot(), 'desktop', 'workbench-host', 'governed-extensions.cjs'].join(path.sep)
  const load = Function(
    'createRequireFn',
    'meta',
    'absPath',
    'return createRequireFn(meta)(absPath)',
  ) as (createRequireFn: typeof createRequire, meta: string, absPath: string) => unknown
  return load(createRequire, import.meta.url, abs) as {
    installUserExtension: (stateDir: string, sourceDir: string, publisherId: string, version: string) => { dest: string; copyCount: number }
    removeUserExtension: (stateDir: string, publisherId: string, version?: string) => boolean
    countPublisherCopies: (stateDir: string, publisherId: string) => number
    countFoundryAdapterCopies: (stateDir: string) => number
    disableExtensionArgs: (stateDir: string) => string[]
    setUserExtensionCatalogEnabled: (stateDir: string, publisherId: string, enabled: boolean, version?: string, dest?: string) => boolean
  }
}

export function mutateExtension(stateDir: string, input: MutateInput): MutateResult {
  const registry = loadRegistry(stateDir)
  const commanderOk = input.actor === 'commander' && input.commanderApproved === true
  if (input.action === 'download' && !commanderOk) {
    return refuse(stateDir, registry, 'SILENT_DOWNLOAD_REFUSED')
  }
  if (['install', 'update', 'enable', 'disable', 'remove', 'quarantine'].includes(input.action) && input.actor === 'agent') {
    return refuse(stateDir, registry, input.action === 'install' ? 'AGENT_EXTENSION_INSTALL' : 'AGENT_EXTENSION_MUTATION')
  }
  if (['install', 'update', 'enable', 'disable', 'remove', 'quarantine', 'download'].includes(input.action) && !commanderOk) {
    if (input.action === 'install') {
      const pkg = input.packageDir || (input.vsixPath ? unpackVsix(stateDir, input.vsixPath) : '')
      if (pkg) {
        const inspect = inspectExtensionPackage(pkg)
        if (inspect.concerns.length) return refuse(stateDir, registry, 'UNSAFE_AUTO_INSTALL_REFUSED', { concerns: inspect.concerns, record: recordFromInspect(pkg, 'LOCAL_VSIX') })
      }
    }
    if (input.action === 'update') return refuse(stateDir, registry, 'AUTO_UPDATE_REFUSED')
    return { ok: false, code: 'COMMANDER_APPROVAL_REQUIRED' }
  }

  if (input.action === 'review') {
    const dir = input.packageDir || (input.vsixPath ? unpackVsix(stateDir, input.vsixPath) : '')
    if (!dir) return { ok: false, code: 'MISSING_PACKAGE' }
    const record = recordFromInspect(dir, input.sourceType || (input.vsixPath ? 'LOCAL_VSIX' : 'MANUAL_PATH'), input.vsixPath || dir)
    const inspect = inspectExtensionPackage(dir)
    upsert(registry, record)
    saveRegistry(stateDir, registry)
    appendProvenance(stateDir, { type: 'EXTENSION_REVIEWED', extensionId: record.extensionId, version: record.version, sha256: record.sha256, concerns: inspect.concerns })
    return { ok: true, record, concerns: inspect.concerns }
  }

  if (input.action === 'approve') {
    const current = registry.records.find(item => item.extensionId === input.extensionId && item.status !== 'REMOVED')
      || registry.records.find(item => item.extensionId === input.extensionId)
    if (!current) return { ok: false, code: 'NOT_FOUND' }
    current.status = current.status === 'BLOCKED' ? 'BLOCKED' : 'APPROVED'
    current.approvedBy = 'commander'
    current.approvedAt = new Date().toISOString()
    saveRegistry(stateDir, registry)
    appendProvenance(stateDir, { type: 'EXTENSION_APPROVED', extensionId: current.extensionId, version: current.version, sha256: current.sha256 })
    return { ok: current.status === 'APPROVED', code: current.status === 'BLOCKED' ? 'BLOCKED' : undefined, record: current }
  }

  if (input.action === 'install' || input.action === 'update') {
    const vsix = input.action === 'update' ? input.nextVsixPath : input.vsixPath
    const dir = (input.action === 'update' ? input.nextPackageDir : input.packageDir) || (vsix ? unpackVsix(stateDir, vsix) : '')
    if (!dir) return { ok: false, code: 'MISSING_PACKAGE' }
    const record = recordFromInspect(dir, input.sourceType || (vsix ? 'LOCAL_VSIX' : 'MANUAL_PATH'), vsix || dir)
    if (record.extensionId === FOUNDRY_ADAPTER_PROTECTED_ID) return { ok: false, code: 'ADAPTER_PROTECTED' }
    const inspect = inspectExtensionPackage(dir)
    if (input.action === 'install' && inspect.concerns.length && record.status !== 'APPROVED') {
      upsert(registry, { ...record, status: 'REVIEW_PENDING' })
      saveRegistry(stateDir, registry)
      return refuse(stateDir, registry, 'UNSAFE_AUTO_INSTALL_REFUSED', { record, concerns: inspect.concerns })
    }
    const existing = registry.records.filter(item => item.extensionId === record.extensionId && item.status !== 'REMOVED')
    const host = loadHost()
    if (input.action === 'update' || existing.some(item => item.version !== record.version && (item.status === 'INSTALLED' || item.status === 'ACTIVE'))) {
      for (const item of existing) host.removeUserExtension(stateDir, item.extensionId, item.version)
    }
    const installed = host.installUserExtension(stateDir, dir, record.extensionId, record.version)
    const copies = host.countPublisherCopies(stateDir, record.extensionId)
    if (copies > 1) {
      host.removeUserExtension(stateDir, record.extensionId)
      host.installUserExtension(stateDir, dir, record.extensionId, record.version)
      if (host.countPublisherCopies(stateDir, record.extensionId) > 1) {
        return refuse(stateDir, registry, 'DUPLICATE_ACTIVE', { record })
      }
    }
    const now = new Date().toISOString()
    const next: FoundryExtensionRecord = {
      ...record,
      installedPath: installed.dest,
      enabled: true,
      trusted: false,
      approvedBy: 'commander',
      approvedAt: now,
      installedAt: existing[0]?.installedAt || now,
      updatedAt: input.action === 'update' ? now : undefined,
      status: 'INSTALLED',
      sha256: vsix && existsSync(vsix) ? sha256File(vsix) : record.sha256,
    }
    registry.records = registry.records.filter(item => !(item.extensionId === next.extensionId && item.status !== 'REMOVED'))
    registry.records.push(...existing.filter(item => item.version !== next.version).map(item => ({ ...item, status: 'REMOVED' as const, enabled: false })))
    registry.records.push(next)
    registry.counts.FOUNDRY_ADAPTER_ACTIVE_COPY_COUNT = host.countFoundryAdapterCopies(stateDir)
    saveRegistry(stateDir, registry)
    appendProvenance(stateDir, { type: input.action === 'update' ? 'EXTENSION_UPDATED' : 'EXTENSION_INSTALLED', extensionId: next.extensionId, version: next.version, sha256: next.sha256, previous: existing.map(item => ({ version: item.version, sha256: item.sha256 })) })
    return { ok: true, record: next, records: registry.records }
  }

  const current = registry.records.find(item => item.extensionId === input.extensionId && item.status !== 'REMOVED')
  if (!current) return { ok: false, code: 'NOT_FOUND' }
  if (current.extensionId === FOUNDRY_ADAPTER_PROTECTED_ID) return { ok: false, code: 'ADAPTER_PROTECTED' }

  if (input.action === 'enable') {
    current.enabled = true
    current.status = 'INSTALLED'
    current.reason = undefined
    loadHost().setUserExtensionCatalogEnabled(stateDir, current.extensionId, true, current.version, current.installedPath)
    saveRegistry(stateDir, registry)
    appendProvenance(stateDir, { type: 'EXTENSION_ENABLED', extensionId: current.extensionId, version: current.version, sha256: current.sha256 })
    return { ok: true, record: current }
  }
  if (input.action === 'disable') {
    current.enabled = false
    current.status = 'DISABLED'
    loadHost().setUserExtensionCatalogEnabled(stateDir, current.extensionId, false)
    saveRegistry(stateDir, registry)
    appendProvenance(stateDir, { type: 'EXTENSION_DISABLED', extensionId: current.extensionId, version: current.version, sha256: current.sha256 })
    return { ok: true, record: current }
  }
  if (input.action === 'quarantine') {
    current.enabled = false
    current.status = 'QUARANTINED'
    current.reason = current.reason || 'policy-quarantine'
    loadHost().setUserExtensionCatalogEnabled(stateDir, current.extensionId, false)
    saveRegistry(stateDir, registry)
    appendProvenance(stateDir, { type: 'EXTENSION_QUARANTINED', extensionId: current.extensionId, version: current.version, sha256: current.sha256 })
    return { ok: true, record: current }
  }
  if (input.action === 'remove') {
    loadHost().removeUserExtension(stateDir, current.extensionId, current.version)
    current.enabled = false
    current.status = 'REMOVED'
    saveRegistry(stateDir, registry)
    appendProvenance(stateDir, { type: 'EXTENSION_REMOVED', extensionId: current.extensionId, version: current.version, sha256: current.sha256, retained: true })
    return { ok: true, record: current }
  }
  return { ok: false, code: 'UNKNOWN_ACTION' }
}

function upsert(registry: RegistryFile, record: FoundryExtensionRecord) {
  const idx = registry.records.findIndex(item => item.extensionId === record.extensionId && item.version === record.version)
  if (idx >= 0) registry.records[idx] = { ...registry.records[idx], ...record }
  else registry.records.push(record)
}

export function unpackVsix(stateDir: string, vsixPath: string): string {
  const dest = path.join(stateDir, 'vsix-unpack', `${path.basename(vsixPath, '.vsix')}-${Date.now()}`)
  mkdirSync(dest, { recursive: true })
  const ran = spawnSync('python3', ['-c', 'import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', vsixPath, dest], { encoding: 'utf8' })
  if (ran.status !== 0) throw new Error(`vsix unpack failed: ${ran.stderr || ran.stdout}`)
  const nested = path.join(dest, 'extension')
  return existsSync(path.join(nested, 'package.json')) ? nested : dest
}

export function packVsix(packageDir: string, outFile: string) {
  mkdirSync(path.dirname(outFile), { recursive: true })
  const staging = path.join(os.tmpdir(), `w6-vsix-${process.pid}-${Date.now()}`)
  mkdirSync(path.join(staging, 'extension'), { recursive: true })
  cpSync(packageDir, path.join(staging, 'extension'), { recursive: true })
  const pkg = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8')) as { name: string; publisher: string; version: string; displayName?: string; description?: string }
  writeFileSync(path.join(staging, '[Content_Types].xml'), `<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension=".json" ContentType="application/json"/><Default Extension=".js" ContentType="application/javascript"/><Default Extension=".xml" ContentType="text/xml"/><Default Extension=".vsixmanifest" ContentType="text/xml"/></Types>\n`)
  writeFileSync(path.join(staging, 'extension.vsixmanifest'), `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="${pkg.name}" Version="${pkg.version}" Publisher="${pkg.publisher}" />
    <DisplayName>${pkg.displayName || pkg.name}</DisplayName>
    <Description xml:space="preserve">${pkg.description || 'Foundry W6 fixture'}</Description>
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation>
  <Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" /></Assets>
</PackageManifest>
`)
  const ran = spawnSync('python3', ['-c', 'import zipfile,sys,os; z=zipfile.ZipFile(sys.argv[1],"w",zipfile.ZIP_DEFLATED);\nroot=sys.argv[2]\nfor dirpath, dirs, files in os.walk(root):\n  for name in files:\n    full=os.path.join(dirpath,name); rel=os.path.relpath(full, root); z.write(full, rel)\nz.close()', outFile, staging], { encoding: 'utf8' })
  rmSync(staging, { recursive: true, force: true })
  if (ran.status !== 0 || !existsSync(outFile)) throw new Error(`vsix pack failed: ${ran.stderr || ran.stdout}`)
  return { file: outFile, sha256: sha256File(outFile) }
}

export async function queryOpenVsxCatalog(query: string, commanderAuthorized: boolean): Promise<{
  ok: boolean
  governed: true
  catalogAvailable: boolean
  label: string
  blocker?: string
  results: Array<{ id: string; version?: string; license?: string }>
}> {
  const label = openVsxCatalogLabel()
  if (!commanderAuthorized) return { ok: false, governed: true, catalogAvailable: false, label, blocker: 'COMMANDER_APPROVAL_REQUIRED', results: [] }
  if (OPENVSX_DEFAULT_ON) return { ok: false, governed: true, catalogAvailable: false, label, blocker: 'OPENVSX_DEFAULT_ON_FORBIDDEN', results: [] }
  try {
    const url = `https://open-vsx.org/api/-/search?query=${encodeURIComponent(query)}&size=3`
    const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) })
    if (!res.ok) return { ok: false, governed: true, catalogAvailable: false, label, blocker: `open-vsx HTTP ${res.status}`, results: [] }
    const data = await res.json() as { extensions?: Array<{ namespace?: string; name?: string; version?: string; files?: unknown }> }
    const results = (data.extensions || []).slice(0, 3).map(item => ({
      id: `${item.namespace}.${item.name}`,
      version: item.version,
      license: 'UNKNOWN',
    }))
    return { ok: true, governed: true, catalogAvailable: true, label, results }
  } catch (error) {
    return { ok: false, governed: true, catalogAvailable: false, label, blocker: String(error instanceof Error ? error.message : error), results: [] }
  }
}

export function marketplaceEndpointsPresent(source: string): boolean {
  return /marketplace\.visualstudio\.com|vscode\.microsoft\.com\/_apis\/public\/gallery/i.test(source)
}

export function secretLeakInText(text: string): boolean {
  return /tkn=|sk_live_|github_pat_|SUPABASE_SERVICE_ROLE|BEGIN PRIVATE KEY/i.test(text)
}

export function adapterStillSingle(stateDir: string): boolean {
  try {
    return loadHost().countFoundryAdapterCopies(stateDir) <= 1
  } catch {
    const extensionsDir = path.join(stateDir, 'extensions')
    if (!existsSync(extensionsDir)) return true
    return readdirSync(extensionsDir).filter(name => /^foundry\.foundry-adapter-\d+\.\d+\.\d+$/.test(name)).length <= 1
  }
}

export function markActiveFromHostSnapshot(stateDir: string, snapshot: Array<{ id: string; isActive?: boolean; version?: string }>) {
  const registry = loadRegistry(stateDir)
  for (const record of registry.records) {
    if (record.status === 'REMOVED' || record.status === 'DISABLED' || record.status === 'QUARANTINED' || record.status === 'BLOCKED') continue
    const hit = snapshot.find(item => item.id === record.extensionId)
    if (hit?.isActive) record.status = 'ACTIVE'
    else if (hit) record.status = 'INSTALLED'
  }
  saveRegistry(stateDir, registry)
  return registry.records
}

export const W6_MARKETPLACE_STILL_OFF = MICROSOFT_MARKETPLACE_ENABLED === false && W5_1_MARKETPLACE === false
export const W6_WORKBENCH_STILL_NOT_DEFAULT = WORKBENCH_DEFAULT === false && W5_1_DEFAULT === false
export const W6_ADAPTER_FOLDER = FOUNDRY_ADAPTER_FOLDER_ID
