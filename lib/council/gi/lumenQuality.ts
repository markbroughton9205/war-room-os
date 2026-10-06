import { lexicalCosine, normalizeSourceUrl } from '@/lib/council/evidence-board/board'
import type { EbcClaim, EbcEvidence } from '@/lib/council/evidence-board/types'

export function canonicalizeSourceKey(url: string | null | undefined): string {
  const normalized = normalizeSourceUrl(url)
  if (!normalized) return ''
  const arxiv = normalized.match(/arxiv\.org\/(?:abs|pdf|html|pdf\/)\/([a-z\-]+\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?/i)
  if (arxiv) return `arxiv:${arxiv[1].toLowerCase()}`
  try {
    const parsed = new URL(normalized)
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^utm/i.test(key) || /^(gclid|fbclid|yclid|_ga|_gl)$/i.test(key)) {
        parsed.searchParams.delete(key)
      }
    }
    const pathname = parsed.pathname.replace(/\/+$/, '') || '/'
    const search = parsed.searchParams.toString()
    return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${pathname}${search ? `?${search}` : ''}`
  } catch {
    return normalized
  }
}

export function independentSourceCount(rows: readonly EbcEvidence[]): number {
  const keys = new Set(
    rows
      .map(row => canonicalizeSourceKey(row.final_url || row.url || row.pointer))
      .filter(Boolean),
  )
  return keys.size
}

export function isDuplicateSourceSet(rows: readonly EbcEvidence[]): boolean {
  if (rows.length < 2) return false
  return independentSourceCount(rows) <= 1
}

export function isCircularEvidence(claim: EbcClaim, rows: readonly EbcEvidence[]): boolean {
  return rows.some(row => row.summary.includes(claim.claim_id) || (row.supersedes_id != null && row.supersedes_id === claim.claim_id))
}

export function evidenceSupportsClaim(claim: EbcClaim, rows: readonly EbcEvidence[]): boolean {
  if (!rows.length) return false
  return rows.some(row => {
    const overlap = lexicalCosine(claim.text, `${row.summary} ${row.title ?? ''} ${row.pointer}`)
    return overlap >= 0.12 && row.ok
  })
}

export function wordingSimilarityOnly(claim: EbcClaim, rows: readonly EbcEvidence[]): boolean {
  if (!rows.length) return false
  const similar = rows.every(row => lexicalCosine(claim.text, row.summary) >= 0.5)
  const weak = rows.every(row => row.kind === 'model_prior' || row.kind === 'inference' || row.kind === 'secondary_external')
  return similar && weak
}
