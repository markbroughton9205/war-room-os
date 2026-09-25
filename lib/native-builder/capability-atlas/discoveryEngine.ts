/**
 * Bounded Capability Atlas discovery: HEAD/GET official sources, register,
 * attach to skills as LEARNABLE/SOURCE_BACKED. Never PROVEN from research.
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { classifyResearchRequest } from '../foundryInternetResearch'
import { foundryResearchFetch } from '../foundryResearchTransport'
import { createRelationship, walkPrerequisites } from './graph'
import {
  BLOG_HOST_MARKERS,
  DISCOVERY_REJECT_FIXTURES,
  DISCOVERY_RELATIONSHIPS,
  DISCOVERY_WAVES,
  SKILL_VALIDATION_HINTS,
  harvestKimiOfficialUrls,
  type DiscoveryCandidate,
  type DiscoveryWaveSpec,
} from './discoveryCatalog'
import { buildSkillPack, skillPackIsCompact } from './resolver'
import { persistScoreboard, buildCapabilityScoreboard } from './scoreboard'
import { createSourceRecord, hashSourceContent } from './sources'
import {
  capabilityAtlasLayout,
  loadCapabilityAtlas,
  persistRelationships,
  persistSkill,
  persistSource,
  type CapabilityAtlas,
} from './store'
import type { CapabilityScoreboard, SourceAuthorityClass, SourceRecord, SkillRecord } from './types'

export const DISCOVERY_GOVERNANCE = {
  researchEqualsMastery: false,
  documentationEqualsExecution: false,
  autoTrustResearch: false,
  wrimTraining: false,
  terra: false,
  commit: false,
  push: false,
  deploy: false,
  cloneAndRunRepos: false,
  downloadModelWeights: false,
  paidRequired: false,
  foundryNativeProvenFromResearch: false,
} as const

export type DiscoveryFetchResult = {
  ok: boolean
  status?: number
  etag?: string | null
  lastModified?: string | null
  error?: string
  timedOut?: boolean
}

export type DiscoveryFetchImpl = (url: string) => Promise<DiscoveryFetchResult>

export type DiscoveryIngestAction = 'accepted' | 'rejected' | 'duplicate' | 'failed'

export type DiscoveryIngestResult = {
  action: DiscoveryIngestAction
  reason: string
  sourceId: string
  url: string
  authorityClass?: SourceAuthorityClass
  contentHash?: string | null
}

export type DedupeState = {
  urls: Set<string>
  hashes: Set<string>
  sourceIds: Set<string>
}

export type WaveManifest = {
  waveId: string
  scope: string
  queries: string[]
  taxonomyTargets: string[]
  sourceCap: number
  sourcesConsidered: number
  sourcesAccepted: string[]
  sourcesRejected: Array<{ sourceId: string; url: string; reason: string }>
  duplicatesRemoved: Array<{ sourceId: string; url: string; reason: string }>
  failedFetches: Array<{ sourceId: string; url: string; reason: string }>
  newSkillIds: string[]
  updatedSkillIds: string[]
  relationshipsAdded: string[]
  sourceRegistrations: string[]
  statusTransitions: Array<{ skillId: string; from: string; to: string }>
  errors: string[]
  limitations: string[]
  timestamp: string
  primaryAccepted: number
  secondaryAccepted: number
  kimiUrlsHarvested: number
}

export type DiscoveryReport = {
  waves: WaveManifest[]
  scoreboardBefore: CapabilityScoreboard
  scoreboardAfter: CapabilityScoreboard
  evaluatedUnchanged: boolean
  provenUnchanged: boolean
  productionProvenUnchanged: boolean
  packsWritten: string[]
  packBytes: { average: number; max: number }
  kimiLiveProvider: false
  kimiCorpusUsed: boolean
  kimiUrlsHarvested: string[]
  governance: typeof DISCOVERY_GOVERNANCE
  stopped: boolean
  stopReason: string | null
}

const USER_AGENT = 'WarRoom-Foundry-Atlas-Research/1.0 (source-registration; no-body-ingest; no-login)'

export function canonicalizeSourceUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ''
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return trimmed.toLowerCase()
  }
  parsed.hash = ''
  parsed.hostname = parsed.hostname.toLowerCase()
  for (const key of [...parsed.searchParams.keys()]) {
    if (/^utm_|^fbclid$|^gclid$/i.test(key)) parsed.searchParams.delete(key)
  }
  let out = parsed.toString()
  if (out.endsWith('/') && parsed.pathname !== '/') out = out.slice(0, -1)
  return out
}

export function isBlogHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return BLOG_HOST_MARKERS.some(marker => host.includes(marker))
  } catch {
    return false
  }
}

export function isPrimaryAuthority(authority: SourceAuthorityClass): boolean {
  return authority === 'PRIMARY' || authority === 'OFFICIAL' || authority === 'STANDARD' || authority === 'REFERENCE_IMPLEMENTATION'
}

export function createDedupeState(atlas?: CapabilityAtlas): DedupeState {
  const urls = new Set<string>()
  const hashes = new Set<string>()
  const sourceIds = new Set<string>()
  if (atlas) {
    for (const source of atlas.sources.values()) {
      sourceIds.add(source.sourceId)
      urls.add(canonicalizeSourceUrl(source.sourceUrl))
      if (source.contentHash) hashes.add(source.contentHash)
    }
  }
  return { urls, hashes, sourceIds }
}

function missingMetadata(candidate: DiscoveryCandidate): string | null {
  if (!candidate.sourceId.trim()) return 'missing sourceId'
  if (!candidate.url.trim()) return 'missing URL'
  if (!candidate.organization.trim()) return 'missing organization'
  if (!candidate.sourceType) return 'missing source type'
  if (!candidate.title.trim()) return 'missing title'
  return null
}

export function ingestDiscoveryCandidate(
  atlas: CapabilityAtlas,
  candidate: DiscoveryCandidate,
  fetchResult: DiscoveryFetchResult | null,
  dedupe: DedupeState,
  now = new Date().toISOString(),
): DiscoveryIngestResult {
  const url = canonicalizeSourceUrl(candidate.url)
  if (candidate.rejectReason === 'blog' || isBlogHost(candidate.url)) {
    return { action: 'rejected', reason: 'blog is not primary authority', sourceId: candidate.sourceId, url: candidate.url }
  }
  const missing = missingMetadata({ ...candidate, url: candidate.url })
  if (missing) {
    return { action: 'rejected', reason: `missing source metadata: ${missing}`, sourceId: candidate.sourceId, url: candidate.url }
  }
  const classified = classifyResearchRequest({ url: candidate.url, method: 'GET' })
  if (!classified.ok) {
    return { action: 'rejected', reason: classified.error, sourceId: candidate.sourceId, url: candidate.url }
  }
  if (dedupe.sourceIds.has(candidate.sourceId) || dedupe.urls.has(url)) {
    return { action: 'duplicate', reason: dedupe.sourceIds.has(candidate.sourceId) ? 'duplicate sourceId' : 'duplicate URL', sourceId: candidate.sourceId, url }
  }
  if (!fetchResult) {
    return { action: 'failed', reason: 'no fetch result; refusing to invent source content', sourceId: candidate.sourceId, url }
  }
  if (!fetchResult.ok) {
    const kind = fetchResult.timedOut ? 'timeout' : fetchResult.status === 404 ? '404' : fetchResult.error?.includes('robots') ? 'robots refusal' : fetchResult.error ?? `status ${fetchResult.status ?? 'unknown'}`
    return { action: 'failed', reason: kind, sourceId: candidate.sourceId, url }
  }
  const hashInput = `${url}|${fetchResult.status ?? 200}|${fetchResult.etag ?? ''}|${fetchResult.lastModified ?? ''}`
  const contentHash = hashSourceContent(hashInput)
  if (dedupe.hashes.has(contentHash)) {
    return { action: 'duplicate', reason: 'duplicate content hash', sourceId: candidate.sourceId, url, contentHash }
  }

  const knownSkills = candidate.skillIds.filter(id => atlas.skills.has(id))
  const record: SourceRecord = createSourceRecord({
    sourceId: candidate.sourceId,
    title: candidate.title,
    sourceUrl: url,
    sourceType: candidate.sourceType,
    organization: candidate.organization,
    license: candidate.license || 'unknown-check-source',
    version: candidate.version,
    lastVerified: now,
    retrievedAt: now,
    authorityClass: candidate.authorityClass,
    contentHash,
    skillIds: knownSkills,
    notes: `${candidate.notes} Headers verified; body not ingested. Research is not mastery.`,
  })
  persistSource(atlas, record, 'REGISTERED')
  dedupe.sourceIds.add(record.sourceId)
  dedupe.urls.add(url)
  dedupe.hashes.add(contentHash)
  return {
    action: 'accepted',
    reason: 'registered',
    sourceId: record.sourceId,
    url,
    authorityClass: record.authorityClass,
    contentHash,
  }
}

function maybeUpdateSkillFromSources(atlas: CapabilityAtlas, skillId: string, previousStatus: string): { updated: boolean; from: string; to: string } {
  const skill = atlas.skills.get(skillId)
  if (!skill) return { updated: false, from: previousStatus, to: previousStatus }
  const protectedStatus = new Set(['AVAILABLE', 'EVALUATION_PENDING', 'EVALUATED', 'PROVEN', 'PRODUCTION_PROVEN', 'FAILED', 'STALE', 'UNSUPPORTED'])
  if (protectedStatus.has(skill.capabilityStatus) && protectedStatus.has(previousStatus)) {
    return { updated: false, from: previousStatus, to: skill.capabilityStatus }
  }
  const hints = SKILL_VALIDATION_HINTS[skillId]
  const sources = [...atlas.sources.values()].filter(source => source.skillIds.includes(skillId))
  const officialIds = sources.filter(source => isPrimaryAuthority(source.authorityClass)).map(source => source.sourceId)
  const next: SkillRecord = {
    ...skill,
    officialSources: unique([...(skill.officialSources ?? []), ...officialIds]),
    lastSourceVerified: sources[0]?.lastVerified ?? skill.lastSourceVerified,
    validationMethods: unique([...(skill.validationMethods ?? []), ...(hints?.methods ?? [])]),
    knownFailureModes: unique([...(skill.knownFailureModes ?? []), ...(hints?.failures ?? [])]),
    securityConsiderations: unique([...(skill.securityConsiderations ?? []), ...(hints?.security ?? [])]),
    modelRouting: skill.modelRouting.filter(item => item !== 'FOUNDRY_NATIVE_PROVEN' || previousStatus === 'PROVEN' || previousStatus === 'PRODUCTION_PROVEN' || previousStatus === 'AVAILABLE' || previousStatus === 'EVALUATED'),
  }
  if (!next.modelRouting.includes('FOUNDRY_NATIVE_PROVEN') && !next.modelRouting.includes('FRONTIER_RECOMMENDED') && !next.modelRouting.includes('LOCAL_MODEL_OK')) {
    next.modelRouting = [...next.modelRouting, 'FRONTIER_RECOMMENDED']
  }
  persistSkill(atlas, next)
  const after = atlas.skills.get(skillId)
  return { updated: after?.capabilityStatus !== previousStatus, from: previousStatus, to: after?.capabilityStatus ?? previousStatus }
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))]
}

export async function defaultDiscoveryFetch(url: string): Promise<DiscoveryFetchResult> {
  try {
    const head = await foundryResearchFetch(url, {
      method: 'HEAD',
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.8' },
      redirect: 'follow',
    }, { timeoutMs: 12_000 })
    if (head.status >= 200 && head.status < 400) {
      return {
        ok: true,
        status: head.status,
        etag: head.headers.get('etag'),
        lastModified: head.headers.get('last-modified'),
      }
    }
    if (head.status === 405 || head.status === 501 || head.status === 403) {
      const get = await foundryResearchFetch(url, {
        method: 'GET',
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/json,text/plain;q=0.9,*/*;q=0.8' },
        redirect: 'follow',
      }, { timeoutMs: 12_000 })
      try {
        await get.body?.cancel()
      } catch {
        /* ignore */
      }
      if (get.status >= 200 && get.status < 400) {
        return {
          ok: true,
          status: get.status,
          etag: get.headers.get('etag'),
          lastModified: get.headers.get('last-modified'),
        }
      }
      return { ok: false, status: get.status, error: `GET ${get.status}` }
    }
    return { ok: false, status: head.status, error: `HEAD ${head.status}` }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: message, timedOut: /timeout|AbortError/i.test(message) }
  }
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  let index = 0
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (index < items.length) {
      const current = index
      index += 1
      out[current] = await fn(items[current]!)
    }
  })
  await Promise.all(workers)
  return out
}

function persistJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(value, null, 2), 'utf8')
}

function writeWaveManifest(manifest: WaveManifest): void {
  const layout = capabilityAtlasLayout()
  persistJson(path.join(layout.manifests, `${manifest.waveId}.json`), manifest)
}

export function readDiscoverySummary(): Record<string, unknown> | null {
  const file = path.join(capabilityAtlasLayout().manifests, 'discovery-summary.json')
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function applyDiscoveryRelationships(atlas: CapabilityAtlas): string[] {
  const added: string[] = []
  const existing = new Set(atlas.relationships.map(item => item.id))
  const extras = DISCOVERY_RELATIONSHIPS
    .filter(([from, , to]) => atlas.skills.has(from) && atlas.skills.has(to))
    .map(([from, kind, to, note]) => createRelationship(from, kind, to, note))
  const fresh = extras.filter(item => !existing.has(item.id))
  if (fresh.length) persistRelationships(atlas, fresh)
  for (const rel of fresh) {
    const walk = walkPrerequisites(rel.from, atlas.relationships, new Set(atlas.skills.keys()))
    if (walk.cycle) {
      atlas.relationships = atlas.relationships.filter(item => item.id !== rel.id)
      persistRelationships(atlas, [])
    } else {
      added.push(rel.id)
    }
  }
  return added
}

function writeCompactPacks(atlas: CapabilityAtlas, skillIds: string[]): { ids: string[]; bytes: number[] } {
  const layout = capabilityAtlasLayout()
  const dir = path.join(layout.manifests, 'skill-packs')
  mkdirSync(dir, { recursive: true })
  const ids: string[] = []
  const bytes: number[] = []
  for (const skillId of unique(skillIds).slice(0, 80)) {
    const pack = buildSkillPack(atlas, skillId)
    if (!pack) continue
    const raw = JSON.stringify(pack)
    const size = Buffer.byteLength(raw, 'utf8')
    if (!skillPackIsCompact(pack) || size > 8192) continue
    if (/<html[\s>]|<!doctype html/i.test(pack.briefProceduralGuidance)) continue
    persistJson(path.join(dir, `${skillId.replace(/[^\w.-]+/g, '_')}.json`), pack)
    ids.push(skillId)
    bytes.push(size)
  }
  return { ids, bytes }
}

export async function runDiscoveryWaves(options?: {
  atlas?: CapabilityAtlas
  waves?: DiscoveryWaveSpec[]
  fetchImpl?: DiscoveryFetchImpl
  persist?: boolean
  includeFixtures?: boolean
  harvestKimi?: boolean
}): Promise<DiscoveryReport> {
  const atlas = options?.atlas ?? loadCapabilityAtlas()
  const scoreboardBefore = buildCapabilityScoreboard(atlas)
  const evaluatedBefore = scoreboardBefore.evaluated
  const provenBefore = scoreboardBefore.proven
  const productionBefore = scoreboardBefore.productionProven
  const dedupe = createDedupeState(atlas)
  const waves = options?.waves ?? DISCOVERY_WAVES
  const fetchImpl = options?.fetchImpl ?? defaultDiscoveryFetch
  const kimiUrls = options?.harvestKimi === false ? [] : harvestKimiOfficialUrls(20)
  const manifests: WaveManifest[] = []
  let stopped = false
  let stopReason: string | null = null
  const allUpdated: string[] = []
  const allNew: string[] = []

  for (const wave of waves) {
    if (stopped) break
    const beforeStatuses = new Map([...atlas.skills.entries()].map(([id, skill]) => [id, skill.capabilityStatus]))
    const candidates = [
      ...wave.candidates,
      ...(options?.includeFixtures && wave === waves[0] ? DISCOVERY_REJECT_FIXTURES : []),
    ].slice(0, wave.sourceCap)
    const considered = candidates.length
    const accepted: string[] = []
    const rejected: WaveManifest['sourcesRejected'] = []
    const duplicates: WaveManifest['duplicatesRemoved'] = []
    const failed: WaveManifest['failedFetches'] = []
    const errors: string[] = []
    const fetches = await mapPool(candidates, 4, async candidate => {
      if (!candidate.url || candidate.rejectReason === 'incomplete' || isBlogHost(candidate.url)) {
        return { candidate, fetchResult: null as DiscoveryFetchResult | null }
      }
      try {
        return { candidate, fetchResult: await fetchImpl(candidate.url) }
      } catch (error) {
        return { candidate, fetchResult: { ok: false, error: error instanceof Error ? error.message : String(error) } satisfies DiscoveryFetchResult }
      }
    })
    for (const { candidate, fetchResult } of fetches) {
      const result = ingestDiscoveryCandidate(atlas, candidate, fetchResult, dedupe)
      if (result.action === 'accepted') accepted.push(result.sourceId)
      else if (result.action === 'duplicate') duplicates.push({ sourceId: result.sourceId, url: result.url, reason: result.reason })
      else if (result.action === 'failed') failed.push({ sourceId: result.sourceId, url: result.url, reason: result.reason })
      else rejected.push({ sourceId: result.sourceId, url: result.url, reason: result.reason })
    }

    const touched = unique(candidates.flatMap(item => item.skillIds)).filter(id => atlas.skills.has(id))
    const transitions: WaveManifest['statusTransitions'] = []
    const updated: string[] = []
    const created: string[] = []
    for (const skillId of touched) {
      const previous = beforeStatuses.get(skillId) ?? 'DISCOVERED'
      const change = maybeUpdateSkillFromSources(atlas, skillId, previous)
      if (change.updated) {
        transitions.push({ skillId, from: change.from, to: change.to })
        if (change.from === 'DISCOVERED') created.push(skillId)
        updated.push(skillId)
      } else if (atlas.skills.get(skillId)?.officialSources.length) {
        updated.push(skillId)
      }
    }
    allUpdated.push(...updated)
    allNew.push(...created)

    const relationshipsAdded = applyDiscoveryRelationships(atlas)
    const board = persistScoreboard(atlas)
    if (board.evaluated !== evaluatedBefore || board.proven !== provenBefore || board.productionProven !== productionBefore) {
      stopped = true
      stopReason = `STOP: evaluation/proof counts changed during research (evaluated ${evaluatedBefore}->${board.evaluated}, proven ${provenBefore}->${board.proven}, production ${productionBefore}->${board.productionProven})`
      errors.push(stopReason)
    }

    const primaryAccepted = accepted.filter(id => {
      const source = atlas.sources.get(id)
      return source ? isPrimaryAuthority(source.authorityClass) : false
    }).length
    const secondaryAccepted = accepted.length - primaryAccepted
    const manifest: WaveManifest = {
      waveId: wave.waveId,
      scope: wave.scope,
      queries: wave.queries,
      taxonomyTargets: wave.taxonomyTargets,
      sourceCap: wave.sourceCap,
      sourcesConsidered: considered,
      sourcesAccepted: accepted,
      sourcesRejected: rejected,
      duplicatesRemoved: duplicates,
      failedFetches: failed,
      newSkillIds: unique(created),
      updatedSkillIds: unique(updated),
      relationshipsAdded,
      sourceRegistrations: accepted,
      statusTransitions: transitions,
      errors,
      limitations: [
        'Research is not mastery.',
        'Bodies not ingested.',
        'Unknown taxonomy skillIds dropped at attach time.',
        DISCOVERY_GOVERNANCE.wrimTraining ? 'WRIM touched' : 'WRIM not trained.',
      ],
      timestamp: new Date().toISOString(),
      primaryAccepted,
      secondaryAccepted,
      kimiUrlsHarvested: kimiUrls.length,
    }
    if (options?.persist !== false) writeWaveManifest(manifest)
    manifests.push(manifest)
  }

  const packs = writeCompactPacks(atlas, unique([...allUpdated, ...allNew, 'ml.cuda', 'os.linux', 'os.linux.systemd', 'database.query-planning']))
  const scoreboardAfter = persistScoreboard(atlas)
  const summary = {
    mission: 'GLOBAL_SOFTWARE_KNOWLEDGE_DISCOVERY',
    wavesCompleted: manifests.map(item => item.waveId),
    scoreboardBefore,
    scoreboardAfter,
    evaluatedUnchanged: scoreboardAfter.evaluated === evaluatedBefore,
    provenUnchanged: scoreboardAfter.proven === provenBefore,
    productionProvenUnchanged: scoreboardAfter.productionProven === productionBefore,
    packsWritten: packs.ids,
    kimiLiveProvider: false,
    kimiCorpusUsed: kimiUrls.length > 0,
    governance: DISCOVERY_GOVERNANCE,
    nextPhase: 'TARGETED SKILL ACQUISITION + SANDBOX EVALUATION',
    startNextPhase: false,
    timestamp: new Date().toISOString(),
  }
  if (options?.persist !== false) {
    persistJson(path.join(capabilityAtlasLayout().manifests, 'discovery-summary.json'), summary)
  }
  const packAvg = packs.bytes.length ? Math.round(packs.bytes.reduce((a, b) => a + b, 0) / packs.bytes.length) : 0
  const packMax = packs.bytes.length ? Math.max(...packs.bytes) : 0
  return {
    waves: manifests,
    scoreboardBefore,
    scoreboardAfter,
    evaluatedUnchanged: scoreboardAfter.evaluated === evaluatedBefore,
    provenUnchanged: scoreboardAfter.proven === provenBefore,
    productionProvenUnchanged: scoreboardAfter.productionProven === productionBefore,
    packsWritten: packs.ids,
    packBytes: { average: packAvg, max: packMax },
    kimiLiveProvider: false,
    kimiCorpusUsed: kimiUrls.length > 0,
    kimiUrlsHarvested: kimiUrls,
    governance: DISCOVERY_GOVERNANCE,
    stopped,
    stopReason,
  }
}

export { hashSourceContent }

async function runCli() {
  const report = await runDiscoveryWaves({ persist: true, includeFixtures: true, harvestKimi: true })
  console.log(JSON.stringify({
    waves: report.waves.map(item => ({
      waveId: item.waveId,
      considered: item.sourcesConsidered,
      accepted: item.sourcesAccepted.length,
      rejected: item.sourcesRejected.length,
      duplicates: item.duplicatesRemoved.length,
      failed: item.failedFetches.length,
      transitions: item.statusTransitions.length,
    })),
    scoreboardBefore: report.scoreboardBefore,
    scoreboardAfter: report.scoreboardAfter,
    evaluatedUnchanged: report.evaluatedUnchanged,
    provenUnchanged: report.provenUnchanged,
    productionProvenUnchanged: report.productionProvenUnchanged,
    packsWritten: report.packsWritten.length,
    packBytes: report.packBytes,
    kimiLiveProvider: report.kimiLiveProvider,
    kimiCorpusUsed: report.kimiCorpusUsed,
    kimiUrlCount: report.kimiUrlsHarvested.length,
    stopped: report.stopped,
    stopReason: report.stopReason,
    governance: report.governance,
  }, null, 2))
  if (report.stopped || !report.evaluatedUnchanged || !report.provenUnchanged || !report.productionProvenUnchanged) {
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli()
}
