/**
 * Durable Foundry engineering memory — separate from raw mission logs.
 * Layout: {foundryRoot}/engineering-memory/{features,files,tests,relationships}/
 * Current repository truth always wins on conflict.
 */
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { foundryDataHierarchy } from './foundryPaths'
import { describeSourceWorkspaceState } from './foundryWorkspaceIdentity'

export type FoundryMemoryConfidence = 'low' | 'medium' | 'high' | 'CONFIRMED' | 'SUPPORTED' | 'STALE' | 'UNKNOWN'

function asMemoryTier(confidence: FoundryMemoryConfidence | undefined, stale?: boolean): FoundryMemoryConfidence {
  if (stale) return 'STALE'
  if (confidence === 'high' || confidence === 'CONFIRMED') return 'CONFIRMED'
  if (confidence === 'medium' || confidence === 'SUPPORTED') return 'SUPPORTED'
  return 'UNKNOWN'
}

export type FoundryMemoryProvenance = 'COMMANDER' | 'TEST_PROVENANCE'

export type FoundryEngineeringFact = {
  id: string
  topic: string
  summary: string
  fact?: string
  sourceMission: string
  sourceMissionId?: string
  files: string[]
  repoRelativePath?: string
  fileSha256?: string | null
  provenance?: FoundryMemoryProvenance
  repoHead?: string | null
  timestamp: string
  confidence: FoundryMemoryConfidence
  lastVerified: string
  stale?: boolean
  staleReason?: string
}

export type FoundryFeatureOwnership = {
  feature: string
  owners: string[]
  tests: string[]
  sourceMission: string
  sourceMissionId?: string
  repoHead?: string | null
  repoRelativePath?: string
  fileSha256?: string | null
  provenance?: FoundryMemoryProvenance
  timestamp: string
  confidence: FoundryMemoryConfidence
  lastVerified: string
  stale?: boolean
  contracts?: string[]
  uiControl?: string
  verifiedInteraction?: string
  roles?: string
}

export type FoundryEngineeringMemoryStore = {
  updatedAt: string
  facts: FoundryEngineeringFact[]
  features: FoundryFeatureOwnership[]
}

const MAX_FACTS = 80
const MAX_FEATURES = 40

function memoryRoot(): string {
  return foundryDataHierarchy().engineeringMemory
}

function storePath(): string {
  return path.join(memoryRoot(), 'index.json')
}

function legacyStorePath(): string {
  return path.join(foundryDataHierarchy().foundryRoot, 'engineering-memory.json')
}

function emptyStore(): FoundryEngineeringMemoryStore {
  return { updatedAt: new Date().toISOString(), facts: [], features: [] }
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'entry'
}

function currentRepoHead(): string | null {
  return describeSourceWorkspaceState(resolveRepoRoot()).head
}

const INSTALLED_OVERLAY = /\/\.local\/opt\/war-room-os-|\/resources\/runtime\//i

export function isCanonicalRepoFileRef(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (trimmed.startsWith('validate:')) return false
  if (/^[a-z]+:/.test(trimmed) && !trimmed.startsWith('file:')) return false
  if (INSTALLED_OVERLAY.test(trimmed)) return false
  if (path.isAbsolute(trimmed)) return trimmed.startsWith(resolveRepoRoot() + path.sep) || trimmed === resolveRepoRoot()
  return /\.(ts|tsx|js|jsx|mjs|cjs|md)$/.test(trimmed) || trimmed.includes('/')
}

export function canonicalizeMemoryPath(raw: string): string | null {
  const trimmed = raw.trim()
  if (!isCanonicalRepoFileRef(trimmed)) return null
  const root = resolveRepoRoot()
  let rel = trimmed
  if (path.isAbsolute(trimmed)) {
    if (!trimmed.startsWith(root + path.sep) && trimmed !== root) return null
    rel = path.relative(root, trimmed)
  }
  rel = rel.replace(/\\/g, '/').replace(/^\.\//, '')
  if (!rel || rel.startsWith('..')) return null
  if (INSTALLED_OVERLAY.test(rel)) return null
  return rel
}

export function classifyMemoryProvenance(files: string[]): FoundryMemoryProvenance {
  const rels = files.map(item => canonicalizeMemoryPath(item)).filter((item): item is string => Boolean(item))
  if (!rels.length) return 'TEST_PROVENANCE'
  if (rels.every(rel => /(?:^|\/)scripts\/foundry\//.test(rel) || /\.(proof|validation)\.ts$/.test(rel))) return 'TEST_PROVENANCE'
  return 'COMMANDER'
}

function fileSha(rel: string): string | null {
  try {
    return createHash('sha256').update(readFileSync(path.join(resolveRepoRoot(), rel))).digest('hex')
  } catch {
    return null
  }
}

function fileExists(rel: string): boolean {
  const canonical = canonicalizeMemoryPath(rel) ?? (isCanonicalRepoFileRef(rel) ? rel : null)
  if (!canonical) return false
  return existsSync(path.join(resolveRepoRoot(), canonical))
}

function fileContains(rel: string, needles: string[]): boolean {
  if (!fileExists(rel)) return false
  try {
    const text = readFileSync(path.join(resolveRepoRoot(), rel), 'utf8')
    return needles.some(needle => text.includes(needle))
  } catch {
    return false
  }
}

export function verifyFact(fact: FoundryEngineeringFact): FoundryEngineeringFact {
  const files = fact.files.map(item => canonicalizeMemoryPath(item)).filter((item): item is string => Boolean(item))
  const withIds: FoundryEngineeringFact = {
    ...fact,
    fact: fact.fact ?? fact.summary,
    sourceMissionId: fact.sourceMissionId ?? fact.sourceMission,
    files,
    repoRelativePath: fact.repoRelativePath ?? files[0],
    provenance: fact.provenance ?? classifyMemoryProvenance(files),
  }
  const missing = files.filter(file => !fileExists(file))
  if (missing.length) {
    return {
      ...withIds,
      stale: true,
      staleReason: `Current repo missing ${missing.join(', ')} — repository truth wins.`,
      confidence: 'STALE',
    }
  }
  const shaFile = withIds.repoRelativePath ?? files[0]
  if (withIds.fileSha256 && shaFile) {
    const current = fileSha(shaFile)
    if (current && current !== withIds.fileSha256) {
      return {
        ...withIds,
        stale: true,
        staleReason: `Stored SHA ${withIds.fileSha256.slice(0, 12)} differs from current ${current.slice(0, 12)}. Re-read source before trusting this fact.`,
        confidence: 'STALE',
      }
    }
  }
  if (withIds.topic === 'trusted-desktop-auto-entry') {
    const stillTrue = fileContains('desktop/src/main.cjs', ['desktopTrust', 'loadURL'])
      && fileContains('desktop/src/desktopTrust.cjs', ['WAR_ROOM_DESKTOP_TRUST_SECRET'])
    if (!stillTrue) {
      return {
        ...withIds,
        stale: true,
        staleReason: 'Current source no longer establishes trusted-desktop auto-entry before loadURL — repository truth wins.',
        confidence: 'STALE',
      }
    }
  }
  return { ...withIds, stale: false, staleReason: undefined, confidence: asMemoryTier(withIds.confidence, false) }
}

export function verifyFeature(feature: FoundryFeatureOwnership): FoundryFeatureOwnership {
  const owners = feature.owners.map(item => canonicalizeMemoryPath(item)).filter((item): item is string => Boolean(item))
  const tests = feature.tests
    .map(item => canonicalizeMemoryPath(item))
    .filter((item): item is string => Boolean(item))
  const withIds: FoundryFeatureOwnership = {
    ...feature,
    sourceMissionId: feature.sourceMissionId ?? feature.sourceMission,
    owners,
    tests,
    repoRelativePath: feature.repoRelativePath ?? owners[0],
    provenance: feature.provenance ?? classifyMemoryProvenance([...owners, ...tests]),
  }
  const missing = [...owners, ...tests].filter(file => !fileExists(file))
  if (!missing.length) {
    const shaFile = withIds.repoRelativePath ?? owners[0]
    if (withIds.fileSha256 && shaFile) {
      const current = fileSha(shaFile)
      if (current && current !== withIds.fileSha256) {
        return { ...withIds, stale: true, confidence: 'STALE' }
      }
    }
    return { ...withIds, stale: false, confidence: asMemoryTier(withIds.confidence, false) }
  }
  return { ...withIds, stale: true, confidence: 'STALE' }
}

function nowIso(): string {
  return new Date().toISOString()
}

const BOOTSTRAP: Array<Omit<FoundryEngineeringFact, 'id'>> = [
  {
    topic: 'trusted-desktop-auto-entry',
    summary: 'Trusted desktop auto-entry is established in Electron before loadURL.',
    fact: 'Trusted desktop auto-entry is established in Electron before loadURL.',
    sourceMission: 'PASS_007_BOOTSTRAP',
    sourceMissionId: 'PASS_007_BOOTSTRAP',
    files: [
      'desktop/src/desktopTrust.cjs',
      'desktop/src/main.cjs',
      'app/api/sovereign/local-auth/trusted-desktop/route.ts',
      'lib/sovereign-runtime/local-ownership/desktopTrust.ts',
    ],
    timestamp: nowIso(),
    confidence: 'high',
    lastVerified: nowIso(),
  },
  {
    topic: 'foundry-heading',
    summary: 'Foundry heading is owned by FoundryShell.tsx',
    sourceMission: 'PASS_007_BOOTSTRAP',
    sourceMissionId: 'PASS_007_BOOTSTRAP',
    files: ['components/war-room/foundry/FoundryShell.tsx'],
    timestamp: nowIso(),
    confidence: 'high',
    lastVerified: nowIso(),
  },
  {
    topic: 'installed-runtime-ui',
    summary: 'Installed runtime UI uses port 3848',
    sourceMission: 'PASS_007_BOOTSTRAP',
    sourceMissionId: 'PASS_007_BOOTSTRAP',
    files: ['lib/native-builder/runtimeControl.ts'],
    timestamp: nowIso(),
    confidence: 'high',
    lastVerified: nowIso(),
  },
  {
    topic: 'terra-imagery-lifecycle',
    summary: 'Terra imagery destruction must not occur mid-camera motion',
    sourceMission: 'PASS_007_BOOTSTRAP',
    sourceMissionId: 'PASS_007_BOOTSTRAP',
    files: ['lib/native-builder/foundryTerraContext.ts'],
    timestamp: nowIso(),
    confidence: 'high',
    lastVerified: nowIso(),
  },
  {
    topic: 'canonical-source',
    summary: 'Canonical War Room source is the current repository root',
    sourceMission: 'PASS_007_BOOTSTRAP',
    sourceMissionId: 'PASS_007_BOOTSTRAP',
    files: ['lib/repo/paths.ts'],
    timestamp: nowIso(),
    confidence: 'high',
    lastVerified: nowIso(),
  },
  {
    topic: 'production-activation-authority',
    summary: 'All production activate/transition paths pass through authorizeProductionActivation. commanderConfirmed is not sufficient. Stale generations are refused unless COMMANDER_EXPLICIT_ROLLBACK names the exact install.',
    sourceMission: 'PASS_009',
    sourceMissionId: 'PASS_009',
    files: ['lib/native-builder/foundryProductionOwnership.ts', 'lib/native-builder/installerTool.ts', 'lib/native-builder/runtimeControl.ts'],
    timestamp: nowIso(),
    confidence: 'high',
    lastVerified: nowIso(),
  },
  {
    topic: 'session-archive',
    summary: 'Commander sessions archive in place. Normal list hides archived sessions. History, workspace, and mission ids are preserved. Active mutating missions block archive.',
    sourceMission: 'PASS_009',
    sourceMissionId: 'PASS_009',
    files: ['lib/native-builder/foundrySessions.ts', 'app/api/mission-runtime/engineering/foundry/sessions/[id]/route.ts', 'components/war-room/foundry/FoundryShell.tsx'],
    timestamp: nowIso(),
    confidence: 'high',
    lastVerified: nowIso(),
  },
  {
    topic: 'electron-semantic-accessibility',
    summary: 'Electron force-renderer-accessibility plus real aria-label/role on Foundry controls. Computer Use locates by accessible name, role, visible text, then window scope, then coordinates.',
    sourceMission: 'PASS_009',
    sourceMissionId: 'PASS_009',
    files: ['desktop/src/main.cjs', 'scripts/foundry/computer-use-backend.py', 'lib/native-builder/foundryComputerUse.ts'],
    timestamp: nowIso(),
    confidence: 'high',
    lastVerified: nowIso(),
  },
]

const FEATURE_BOOTSTRAP: FoundryFeatureOwnership[] = [
  {
    feature: 'Foundry project list',
    owners: [
      'components/war-room/foundry/FoundryShell.tsx',
      'lib/native-builder/workspaceRegistry.ts',
      'lib/native-builder/foundryProjectVisibility.ts',
    ],
    tests: [
      'lib/native-builder/foundryProjectVisibility.validation.ts',
      'scripts/foundry-home-ui-proof.ts',
    ],
    sourceMission: 'PASS_007_BOOTSTRAP',
    sourceMissionId: 'PASS_007_BOOTSTRAP',
    timestamp: nowIso(),
    confidence: 'medium',
    lastVerified: nowIso(),
  },
]

async function readStoreFile(dest: string): Promise<FoundryEngineeringMemoryStore | null> {
  try {
    const parsed = JSON.parse(await readFile(dest, 'utf8')) as FoundryEngineeringMemoryStore
    if (!parsed || !Array.isArray(parsed.facts)) return null
    return {
      updatedAt: parsed.updatedAt,
      facts: parsed.facts.map(verifyFact),
      features: (parsed.features ?? []).map(verifyFeature),
    }
  } catch {
    return null
  }
}

export async function readEngineeringMemory(): Promise<FoundryEngineeringMemoryStore> {
  return (await readStoreFile(storePath()))
    ?? (await readStoreFile(legacyStorePath()))
    ?? emptyStore()
}

async function persistShards(store: FoundryEngineeringMemoryStore): Promise<void> {
  const root = memoryRoot()
  for (const kind of ['features', 'files', 'tests', 'relationships'] as const) {
    await mkdir(path.join(root, kind), { recursive: true }).catch(() => undefined)
  }
  for (const feature of store.features.slice(0, MAX_FEATURES)) {
    await writeFile(
      path.join(root, 'features', `${slug(feature.feature)}.json`),
      JSON.stringify({
        fact: `${feature.feature} owners`,
        sourceMissionId: feature.sourceMissionId ?? feature.sourceMission,
        files: [...feature.owners, ...feature.tests],
        repoHead: feature.repoHead ?? null,
        timestamp: feature.timestamp,
        confidence: feature.confidence,
        lastVerified: feature.lastVerified,
        owners: feature.owners,
        tests: feature.tests,
      }, null, 2),
      'utf8',
    ).catch(() => undefined)
  }
  for (const fact of store.facts.slice(0, MAX_FACTS)) {
    const payload = {
      fact: fact.fact ?? fact.summary,
      sourceMissionId: fact.sourceMissionId ?? fact.sourceMission,
      files: fact.files,
      repoHead: fact.repoHead ?? null,
      timestamp: fact.timestamp,
      confidence: fact.confidence,
      lastVerified: fact.lastVerified,
      topic: fact.topic,
      stale: Boolean(fact.stale),
    }
    const firstFile = fact.files[0]
    if (firstFile) {
      await writeFile(path.join(root, 'files', `${slug(firstFile)}.json`), JSON.stringify(payload, null, 2), 'utf8').catch(() => undefined)
    }
    if (fact.files.some(file => /\.(test|spec|validation|proof)\./.test(file))) {
      await writeFile(path.join(root, 'tests', `${slug(fact.topic)}.json`), JSON.stringify(payload, null, 2), 'utf8').catch(() => undefined)
    }
    await writeFile(path.join(root, 'relationships', `${slug(fact.topic)}.json`), JSON.stringify(payload, null, 2), 'utf8').catch(() => undefined)
  }
}

async function writeStore(store: FoundryEngineeringMemoryStore): Promise<void> {
  const dest = storePath()
  await mkdir(path.dirname(dest), { recursive: true }).catch(() => undefined)
  const next = { ...store, updatedAt: new Date().toISOString() }
  await writeFile(dest, JSON.stringify(next, null, 2), 'utf8').catch(() => undefined)
  await writeFile(legacyStorePath(), JSON.stringify(next, null, 2), 'utf8').catch(() => undefined)
  await persistShards(next)
}

export async function ensureEngineeringMemoryBootstrap(): Promise<FoundryEngineeringMemoryStore> {
  const store = await readEngineeringMemory()
  let facts = store.facts.length
    ? store.facts
    : BOOTSTRAP.map(entry => verifyFact({ ...entry, id: `bootstrap-${entry.topic}`, repoHead: currentRepoHead() }))
  if (!facts.some(fact => fact.topic === 'trusted-desktop-auto-entry')) {
    const trusted = BOOTSTRAP.find(entry => entry.topic === 'trusted-desktop-auto-entry')!
    facts = [verifyFact({ ...trusted, id: 'bootstrap-trusted-desktop-auto-entry', repoHead: currentRepoHead() }), ...facts]
  }
  const features = store.features.length
    ? store.features
    : FEATURE_BOOTSTRAP.map(feature => verifyFeature({ ...feature, repoHead: currentRepoHead() }))
  const next = { updatedAt: new Date().toISOString(), facts, features }
  if (!store.facts.length || !store.features.length || !store.facts.some(fact => fact.topic === 'trusted-desktop-auto-entry')) {
    await writeStore(next)
    return next
  }
  return { ...store, facts, features }
}

export function recallEngineeringFacts(store: FoundryEngineeringMemoryStore, query: string): FoundryEngineeringFact[] {
  const needle = query.toLowerCase()
  return store.facts
    .map(verifyFact)
    .filter(fact => !fact.stale)
    .filter(fact => `${fact.topic} ${fact.summary} ${fact.fact ?? ''} ${fact.files.join(' ')}`.toLowerCase().includes(needle)
      || needle.split(/[^a-z0-9]+/).filter(Boolean).some(token => fact.topic.includes(token) || fact.summary.toLowerCase().includes(token)))
    .slice(0, 6)
}

export function recallFeatureOwnership(store: FoundryEngineeringMemoryStore, feature: string): FoundryFeatureOwnership | null {
  const needle = feature.toLowerCase()
  const hit = store.features
    .map(verifyFeature)
    .find(item => !item.stale && item.provenance !== 'TEST_PROVENANCE' && (item.feature.toLowerCase() === needle || item.feature.toLowerCase().includes(needle) || needle.includes(item.feature.toLowerCase())))
  return hit ?? null
}

export async function rememberEngineeringFact(entry: Omit<FoundryEngineeringFact, 'id' | 'timestamp' | 'lastVerified'> & { timestamp?: string }): Promise<FoundryEngineeringFact> {
  const store = await ensureEngineeringMemoryBootstrap()
  const timestamp = entry.timestamp ?? new Date().toISOString()
  const files = (entry.files ?? []).map(item => canonicalizeMemoryPath(item)).filter((item): item is string => Boolean(item))
  const fact: FoundryEngineeringFact = verifyFact({
    ...entry,
    files,
    fact: entry.fact ?? entry.summary,
    sourceMissionId: entry.sourceMissionId ?? entry.sourceMission,
    repoHead: entry.repoHead ?? currentRepoHead(),
    repoRelativePath: entry.repoRelativePath ?? files[0],
    fileSha256: entry.fileSha256 ?? (files[0] ? fileSha(files[0]) : null),
    provenance: entry.provenance ?? classifyMemoryProvenance(files),
    id: `${entry.topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 48)}-${Date.now().toString(36)}`,
    timestamp,
    lastVerified: timestamp,
  })
  const facts = [fact, ...store.facts.filter(item => item.topic.toLowerCase() !== entry.topic.toLowerCase())].slice(0, MAX_FACTS)
  await writeStore({ ...store, facts })
  return fact
}

export async function rememberFeatureOwnership(entry: Omit<FoundryFeatureOwnership, 'timestamp' | 'lastVerified'> & { timestamp?: string }): Promise<FoundryFeatureOwnership> {
  const store = await ensureEngineeringMemoryBootstrap()
  const timestamp = entry.timestamp ?? new Date().toISOString()
  const owners = entry.owners.map(item => canonicalizeMemoryPath(item)).filter((item): item is string => Boolean(item))
  const tests = entry.tests.map(item => canonicalizeMemoryPath(item)).filter((item): item is string => Boolean(item))
  const feature = verifyFeature({
    ...entry,
    owners,
    tests,
    sourceMissionId: entry.sourceMissionId ?? entry.sourceMission,
    repoHead: entry.repoHead ?? currentRepoHead(),
    repoRelativePath: entry.repoRelativePath ?? owners[0],
    fileSha256: entry.fileSha256 ?? (owners[0] ? fileSha(owners[0]) : null),
    provenance: entry.provenance ?? classifyMemoryProvenance([...owners, ...tests]),
    timestamp,
    lastVerified: timestamp,
  })
  const features = [feature, ...store.features.filter(item => item.feature.toLowerCase() !== entry.feature.toLowerCase())].slice(0, MAX_FEATURES)
  await writeStore({ ...store, features })
  return feature
}

export function compactMemoryHits(facts: FoundryEngineeringFact[]): string {
  if (!facts.length) return 'No verified engineering memory for this query. Current repo wins.'
  return facts.map(fact => {
    const stale = fact.stale ? ' STALE' : ''
    return `${fact.topic}: ${fact.fact ?? fact.summary} [sourceMissionId=${fact.sourceMissionId ?? fact.sourceMission} conf=${fact.confidence} verified=${fact.lastVerified.slice(0, 10)}${stale}]`
  }).join('\n')
}

export function engineeringMemoryLayout(): { root: string; features: string; files: string; tests: string; relationships: string } {
  const root = memoryRoot()
  return {
    root,
    features: path.join(root, 'features'),
    files: path.join(root, 'files'),
    tests: path.join(root, 'tests'),
    relationships: path.join(root, 'relationships'),
  }
}
