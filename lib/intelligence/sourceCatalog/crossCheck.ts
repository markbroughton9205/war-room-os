import {
  EARTH_KNOWLEDGE_COMPLETION_REGISTRY,
  type EarthKnowledgeImplementationState,
  type EarthKnowledgeSourceRecord,
} from '@/lib/earth-knowledge/completionRegistry.generated'
import type { KimiWaveChunk } from '@/lib/intelligence/kimiWaves/parser'

export type CatalogSourceMatch = {
  catalogName: string
  catalogUrl?: string
  kimiWave: number
  kimiFile: string
  origin_type: 'KIMI_WAVE'
  implementationState: EarthKnowledgeImplementationState | 'UNMATCHED_CATALOG_ENTRY'
  providerId: string | null
  adapterPath: string | null
  usableNow: boolean
}

export type CatalogCrossCheckResult = {
  candidates: CatalogSourceMatch[]
  usable: CatalogSourceMatch[]
  blockedOrStubOrMissing: CatalogSourceMatch[]
  unmatched: CatalogSourceMatch[]
}

const USABLE: EarthKnowledgeImplementationState[] = ['LIVE_IMPLEMENTED', 'IMPLEMENTED_NOT_LIVE_VERIFIED']
const BLOCKED: EarthKnowledgeImplementationState[] = [
  'IMPLEMENTED_CREDENTIAL_BLOCKED',
  'IMPLEMENTED_ACCESS_DEGRADED',
  'STUB_ONLY',
  'MISSING',
  'SEARCH_INTERFACE_ONLY',
  'BULK_ONLY',
  'COMMERCIAL_GATED',
  'DISCONTINUED',
  'EXTERNAL_BLOCKER',
]

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function lookupRegistry(name: string): EarthKnowledgeSourceRecord | undefined {
  const needle = normalize(name)
  if (needle.length < 3) return undefined
  const exact = EARTH_KNOWLEDGE_COMPLETION_REGISTRY.find(row => {
    if (normalize(row.name) === needle) return true
    if (row.providerId && normalize(row.providerId) === needle) return true
    return false
  })
  if (exact) return exact
  return EARTH_KNOWLEDGE_COMPLETION_REGISTRY.find(row => {
    const rowName = normalize(row.name)
    return rowName.includes(needle) || needle.includes(rowName)
  })
}

export function extractCatalogCandidates(chunks: KimiWaveChunk[]): CatalogSourceMatch[] {
  const out: CatalogSourceMatch[] = []
  const seen = new Set<string>()
  for (const chunk of chunks) {
    const name = chunk.section.replace(/^\d+[.)]\s*/, '').split('|')[0]!.trim()
    if (name.length < 3 || name.length > 120) continue
    if (/^(domain|group|gaps?|wave|earth kb|status notes|already registered|field (key|schema)|tiers?:|cross-referenced)/i.test(name)) continue
    const key = `${chunk.sourceFile}:${normalize(name)}`
    if (seen.has(key)) continue
    seen.add(key)
    const row = lookupRegistry(name)
    const implementationState = row?.implementationState ?? 'UNMATCHED_CATALOG_ENTRY'
    out.push({
      catalogName: name,
      ...(chunk.urls[0] ? { catalogUrl: chunk.urls[0] } : {}),
      kimiWave: chunk.wave,
      kimiFile: chunk.sourceFile,
      origin_type: 'KIMI_WAVE',
      implementationState,
      providerId: row?.providerId ?? null,
      adapterPath: row?.adapterPath ?? null,
      usableNow: row ? USABLE.includes(row.implementationState) : false,
    })
  }
  return out
}

export function crossCheckKimiSourcesAgainstRegistry(chunks: KimiWaveChunk[]): CatalogCrossCheckResult {
  const candidates = extractCatalogCandidates(chunks)
  return {
    candidates,
    usable: candidates.filter(item => item.usableNow),
    blockedOrStubOrMissing: candidates.filter(item =>
      item.implementationState !== 'UNMATCHED_CATALOG_ENTRY'
      && BLOCKED.includes(item.implementationState as EarthKnowledgeImplementationState),
    ),
    unmatched: candidates.filter(item => item.implementationState === 'UNMATCHED_CATALOG_ENTRY'),
  }
}

export function isUsableImplementedProvider(state: CatalogSourceMatch['implementationState']): boolean {
  return state === 'LIVE_IMPLEMENTED' || state === 'IMPLEMENTED_NOT_LIVE_VERIFIED'
}
