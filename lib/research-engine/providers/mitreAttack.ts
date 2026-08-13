import 'server-only'

import type { ResearchDocument, ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, resolveBaseUrl } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'mitre_attack' as const
const ENTERPRISE_COLLECTION = 'x-mitre-collection--1f5f1533-f617-4ca8-9ab4-6a02367fa019'
// 2000 comfortably covers Enterprise ATT&CK's largest type (attack-pattern, ~858 objects today) in
// a single request. This matters beyond raw coverage: live testing against attack-taxii.mitre.org
// found its TAXII `next` pagination cursor is unstable — a second page fetched via `next` returned
// 30-40% of the same objects already seen on page one (confirmed by STIX id) rather than a clean
// continuation, so a multi-page fetch could silently miss objects (including the exact one being
// looked up) even though the server reported `more: false` at the end. A single large-limit request
// needs no cursor and reliably returned all 858 attack-pattern objects with no gaps or dupes across
// repeated live trials. MAX_PAGES stays as a defensive fallback for the rare case a type outgrows
// PAGE_SIZE (`more: true` on page one) — subsequent pages still carry the cursor-overlap risk above.
const PAGE_SIZE = 2000
const MAX_PAGES = 2
const MAX_RESPONSE_BYTES = 6 * 1024 * 1024

type StixReference = { source_name?: string; external_id?: string; url?: string }
type StixObject = { id?: string; type?: string; name?: string; description?: string; created?: string; modified?: string; aliases?: string[]; external_references?: StixReference[] }
type TaxiiObjects = { objects?: StixObject[]; more?: boolean; next?: string }
type FetchError = { category: 'rate_limited' | 'upstream_error' | 'parse_error'; message: string; httpStatus: number | null }

function apiRoot(): string { const d = providerEnvDescriptor(PROVIDER); return (d && resolveBaseUrl('MITRE_ATTACK_TAXII_API_ROOT', d)) || 'https://attack-taxii.mitre.org/api/v21' }

// ATT&CK external IDs encode their object type in the ID prefix. An exact-ID query must look up
// the STIX type(s) that prefix actually belongs to (T=technique, G=group, S=software, M=mitigation)
// rather than whatever the phrase-based classifier below guesses from the raw query text — e.g.
// "G0007" contains no word matching /group|intrusion/, so phraseType() would default it to
// attack-pattern and the lookup would search the wrong collection type entirely.
const ID_LOOKUP_TYPES: { re: RegExp; types: string[] }[] = [
  { re: /^T\d{4}(\.\d{3})?$/i, types: ['attack-pattern'] },
  { re: /^G\d{4}$/i, types: ['intrusion-set'] },
  { re: /^S\d{4}$/i, types: ['malware', 'tool'] },
  { re: /^M\d{4}$/i, types: ['course-of-action'] },
]
function idLookupTypes(text: string): string[] | null { const hit = ID_LOOKUP_TYPES.find(({ re }) => re.test(text.trim())); return hit ? hit.types : null }
function phraseType(text: string): string { const q = text.toLowerCase(); if (/\b(group|intrusion)\b/.test(q)) return 'intrusion-set'; if (/\bmalware\b/.test(q)) return 'malware'; if (/\b(tool|software)\b/.test(q)) return 'tool'; if (/\bmitigation\b/.test(q)) return 'course-of-action'; return 'attack-pattern' }

function externalId(object: StixObject): string | null { return object.external_references?.find(r => r.source_name?.toLowerCase() === 'mitre-attack' && r.external_id)?.external_id ?? null }
function canonicalUrl(object: StixObject, externalIdValue: string | null): string | null { return object.external_references?.find(r => r.url)?.url ?? (externalIdValue ? `https://attack.mitre.org/${object.type === 'attack-pattern' ? 'techniques' : object.type === 'intrusion-set' ? 'groups' : object.type === 'malware' ? 'software' : object.type === 'tool' ? 'software' : 'mitigations'}/${externalIdValue.replace('.', '/')}/` : null) }

// Ranked local match, lowest number wins. An exact ATT&CK-ID or exact-name hit must always outrank
// a description that merely mentions the search term in passing — e.g. T1059's own STIX object
// description cites "T1055" as a related technique, so unranked substring search across
// name/description/aliases/external-id returned zero instances of the exact ID among the top
// results for a plain ID query. Reproduced live against the real TAXII service on 2026-08-13.
function matchRank(object: StixObject, needle: string): number | null {
  if (!needle) return 0
  const id = externalId(object)?.toLowerCase() ?? null
  const name = object.name?.toLowerCase() ?? null
  const aliases = (object.aliases ?? []).map(a => a.toLowerCase())
  const description = object.description?.toLowerCase() ?? null
  if (id === needle) return 0
  if (name === needle) return 1
  if (aliases.includes(needle)) return 2
  if (name?.startsWith(needle)) return 3
  if (name?.includes(needle)) return 4
  if (aliases.some(a => a.includes(needle))) return 5
  if (id?.includes(needle)) return 6
  if (description?.includes(needle)) return 7
  return null
}

function normalize(object: StixObject): ResearchDocument | null { if (!object.id || !object.type || !object.name) return null; const attackId = externalId(object); const canonical = canonicalUrl(object, attackId); return makeDocument({ id: `mitre_attack:${object.id}`, provider: PROVIDER, providerRecordId: object.id, title: object.name, summary: object.description ?? null, contentSnippet: object.description ?? null, canonicalUrl: canonical, sourceUrl: canonical, sourceName: 'MITRE ATT&CK TAXII', contentType: `stix_${object.type}`, authors: [], organization: 'MITRE ATT&CK', publishedAt: object.created ?? null, updatedAt: object.modified ?? null, geography: null, language: 'en', identifiers: { stix_id: object.id, ...(attackId ? { attack_external_id: attackId } : {}) }, subjects: [...(object.aliases ?? []), object.type], license: 'CC BY 4.0', accessStatus: 'open', warnings: ['MITRE ATT&CK is structured threat-knowledge/reference data, not live threat telemetry.'] }) }

// Follows the TAXII 2.1 `more`/`next` pagination cursor until the collection page runs out (or
// MAX_PAGES is hit), instead of reading only the first PAGE_SIZE objects of the requested type.
async function fetchTypeObjects(type: string): Promise<{ ok: true; objects: StixObject[] } | { ok: false; error: FetchError }> {
  const objects: StixObject[] = []
  let next: string | undefined
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(`${apiRoot().replace(/\/$/, '')}/collections/${ENTERPRISE_COLLECTION}/objects/`)
    url.searchParams.set('match[type]', type)
    url.searchParams.set('limit', String(PAGE_SIZE))
    if (next) url.searchParams.set('next', next)
    const result = await safeProviderFetch(PROVIDER, url.toString(), { headers: { Accept: 'application/taxii+json;version=2.1' }, timeoutMs: 15_000, maxResponseBytes: MAX_RESPONSE_BYTES, maxRetries: 0 })
    if (!result.ok) return { ok: false, error: { category: result.status === 429 ? 'rate_limited' : 'upstream_error', message: `MITRE TAXII returned HTTP ${result.status}`, httpStatus: result.status } }
    if (result.truncated) return { ok: false, error: { category: 'parse_error', message: 'MITRE TAXII response exceeded the accepted size.', httpStatus: result.status } }
    const payload = safeJsonParse<TaxiiObjects>(result.text)
    if (!payload?.objects) return { ok: false, error: { category: 'parse_error', message: 'MITRE TAXII response did not contain a TAXII objects array.', httpStatus: result.status } }
    objects.push(...payload.objects)
    if (!payload.more || !payload.next) break
    next = payload.next
  }
  return { ok: true, objects }
}

async function run(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim()
  const needle = text.toLowerCase()
  const idTypes = idLookupTypes(text)
  const types = idTypes ?? [phraseType(text)]
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, 50))
  const cacheKey = `mitre_attack:${types.join('+')}:${needle}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ...cached, fromCache: true }
  try {
    return await withProviderGate(PROVIDER, async () => {
      let lastError: FetchError | null = null
      const ranked: { object: StixObject; rank: number }[] = []
      for (const type of types) {
        const fetched = await fetchTypeObjects(type)
        if (!fetched.ok) { lastError = fetched.error; continue }
        for (const object of fetched.objects) {
          const rank = matchRank(object, needle)
          if (rank !== null) ranked.push({ object, rank })
        }
        // An exact ATT&CK-ID match already found (rank 0) can't be improved on by checking the
        // remaining candidate types (e.g. "tool" after "malware" for an ambiguous S-prefixed ID).
        if (ranked.some(r => r.rank === 0)) break
      }
      if (ranked.length === 0 && lastError) return errorResponse(PROVIDER, { provider: PROVIDER, ...lastError }, Date.now() - started)
      ranked.sort((a, b) => a.rank - b.rank)
      const documents = ranked.map(r => normalize(r.object)).filter((doc): doc is ResearchDocument => doc !== null).slice(0, limit)
      const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
      cacheSet(cacheKey, response, CACHE_TTL.scholarlyMetadata)
      return response
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, Date.now() - started)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> { const started = Date.now(); try { const result = await safeProviderFetch(PROVIDER, `${apiRoot().replace(/\/$/, '')}/collections/`, { headers: { Accept: 'application/taxii+json;version=2.1' }, timeoutMs: 10_000, maxResponseBytes: 256 * 1024, maxRetries: 0 }); return { provider: PROVIDER, state: result.ok ? 'ready' : result.status === 429 ? 'rate_limited' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'TAXII 2.1 collections reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started } } catch (error) { return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started } } }
export const mitreAttackAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
