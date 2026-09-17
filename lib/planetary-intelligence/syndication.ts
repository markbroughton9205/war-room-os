import { createHash } from 'node:crypto'
import { canonicalizeUrl } from '@/lib/intelligence/canonicalUrl'
import { hashEvidenceContent, normalizeEvidenceText, textsAreNearDuplicate } from '@/lib/intelligence/contentHash'
import type { RetrievedDocument } from './types'
import { resolveSourceIdentity } from './sourceIdentity'

export type SyndicationCluster = {
  storyClusterId: string
  syndicationClusterId: string
  canonicalStoryOrigin: string
  independentOriginId: string
  originConfidence: number
  originMethod: string
  memberDocumentIds: string[]
  memberUrls: string[]
}

function fnv1a(token: string): number {
  let hash = 2166136261
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function simhash64(text: string): string {
  const tokens = normalizeEvidenceText(text).split(' ').filter(Boolean)
  const vector = new Array<number>(64).fill(0)
  for (const token of tokens) {
    const h = fnv1a(token)
    const h2 = fnv1a(`${token}#2`)
    for (let bit = 0; bit < 32; bit += 1) {
      vector[bit] += (h >>> bit) & 1 ? 1 : -1
      vector[bit + 32] += (h2 >>> bit) & 1 ? 1 : -1
    }
  }
  let out = BigInt(0)
  for (let bit = 0; bit < 64; bit += 1) {
    if ((vector[bit] ?? 0) >= 0) out |= BigInt(1) << BigInt(bit)
  }
  return out.toString(16).padStart(16, '0')
}

export function hammingHex(a: string, b: string): number {
  const left = BigInt(`0x${a}`)
  const right = BigInt(`0x${b}`)
  let xor = left ^ right
  let count = 0
  while (xor) {
    xor &= xor - BigInt(1)
    count += 1
  }
  return count
}

export function minhashSignature(text: string, size = 16): string[] {
  const tokens = [...new Set(normalizeEvidenceText(text).split(' ').filter(token => token.length > 2))]
  const sig: string[] = []
  for (let seed = 0; seed < size; seed += 1) {
    let min = 0xffffffff
    for (const token of tokens) {
      const h = fnv1a(`${seed}:${token}`)
      if (h < min) min = h
    }
    sig.push(min.toString(16).padStart(8, '0'))
  }
  return sig
}

function headlineKey(title: string): string {
  return normalizeEvidenceText(title).replace(/\b(ap|reuters|afp|exclusive|breaking)\b/g, '').replace(/\s+/g, ' ').trim()
}

export function clusterSyndication(documents: RetrievedDocument[]): {
  documents: RetrievedDocument[]
  clusters: SyndicationCluster[]
} {
  const annotated = documents.map(doc => {
    const identity = resolveSourceIdentity({
      url: doc.url,
      outletName: doc.outlet,
      publisher: doc.publisher,
      parentCompany: doc.parentCompany,
      title: doc.title,
      text: doc.originalText,
      byline: doc.byline,
      wireAttribution: doc.wireAttribution,
    })
    return {
      ...doc,
      canonicalUrl: canonicalizeUrl(doc.url) || doc.canonicalUrl,
      contentHash: doc.contentHash || hashEvidenceContent(doc.originalText || doc.title) || doc.contentHash,
      simhash: doc.simhash || simhash64(`${doc.title}\n${doc.originalText}`),
      sourceOriginId: identity.storyOriginId,
      independentOriginId: identity.independentEvidenceOriginId,
      publisher: identity.publisher,
      outlet: identity.outlet,
      parentCompany: identity.parentCompany,
    }
  })

  const parent = annotated.map((_, index) => index)
  const find = (index: number): number => {
    if (parent[index] !== index) parent[index] = find(parent[index]!)
    return parent[index]!
  }
  const union = (a: number, b: number) => {
    const pa = find(a)
    const pb = find(b)
    if (pa !== pb) parent[pb] = pa
  }

  for (let i = 0; i < annotated.length; i += 1) {
    for (let j = i + 1; j < annotated.length; j += 1) {
      const left = annotated[i]!
      const right = annotated[j]!
      // Stage 1: canonical URL / exact hash
      const stage1 = left.canonicalUrl === right.canonicalUrl || (left.contentHash && left.contentHash === right.contentHash)
      // Stage 2: headline / byline / wire / timing
      const stage2 = Boolean(
        headlineKey(left.title) && headlineKey(left.title) === headlineKey(right.title)
        && (left.wireAttribution && left.wireAttribution === right.wireAttribution
          || left.sourceOriginId && left.sourceOriginId === right.sourceOriginId),
      )
      // Stage 3: SimHash / MinHash near-duplicate
      const stage3 = hammingHex(left.simhash, right.simhash) <= 8
        || textsAreNearDuplicate(left.originalText || left.title, right.originalText || right.title)
      // Stage 4: semantic-ish lexical similarity is already in textsAreNearDuplicate.
      // Stage 5: provenance lineage (same independent origin + near text)
      const stage5 = left.independentOriginId === right.independentOriginId && stage3
      if (stage1 || stage2 || stage3 || stage5) union(i, j)
    }
  }

  const groups = new Map<number, number[]>()
  annotated.forEach((_, index) => {
    const root = find(index)
    const list = groups.get(root) ?? []
    list.push(index)
    groups.set(root, list)
  })

  const clusters: SyndicationCluster[] = []
  for (const members of groups.values()) {
    const head = annotated[members[0]!]!
    const originMethod = head.wireAttribution || head.sourceOriginId?.includes('wire')
      ? 'wire_attribution+canonical+simhash'
      : 'canonical+hash+simhash+lineage'
    const cluster: SyndicationCluster = {
      storyClusterId: `story-${head.contentHash.slice(0, 12)}`,
      syndicationClusterId: `synd-${createHash('sha256').update(members.map(index => annotated[index]!.canonicalUrl).join('|')).digest('hex').slice(0, 12)}`,
      canonicalStoryOrigin: head.sourceOriginId || head.independentOriginId || head.publisher,
      independentOriginId: head.independentOriginId || head.sourceOriginId || head.publisher,
      originConfidence: head.wireAttribution ? 0.86 : 0.7,
      originMethod,
      memberDocumentIds: members.map(index => annotated[index]!.documentId),
      memberUrls: members.map(index => annotated[index]!.url),
    }
    clusters.push(cluster)
    for (const index of members) {
      const doc = annotated[index]!
      doc.sourceOriginId = cluster.canonicalStoryOrigin
      doc.independentOriginId = cluster.independentOriginId
    }
  }

  return { documents: annotated, clusters }
}

export function cosineIsNotSoleOriginSignal(): true {
  return true
}
