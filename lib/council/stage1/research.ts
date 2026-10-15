/**
 * Research integrity: honest source accounting and claim classification.
 *   VERIFIED     supported by >=1 accepted source that actually contains the claim
 *   INFERENCE    derived from identified accepted sources, not stated by any of them
 *   UNVERIFIED   no accepted evidence yet
 *   CONFLICTING  accepted sources disagree
 *   UNAVAILABLE  evidence could not be obtained at all
 */
export type SourceInput = {
  url: string | null
  title: string
  /** Text actually retrieved. Empty/absent means the fetch produced nothing usable. */
  excerpt: string
  httpStatus?: number | null
  provider?: string
  retrievedAt?: string | null
  /** Region/country label when known; used only for diversity reporting. */
  region?: string | null
}

export type SourceVerdict = {
  url: string | null
  title: string
  accepted: boolean
  reason: string
  region: string | null
}

export type ClaimInput = {
  id: string
  text: string
  /** Indices (into the sources array) that the proposer says support/contradict the claim. */
  supports: number[]
  contradicts: number[]
  /** True when the claim is a deduction rather than a statement found in a source. */
  derived?: boolean
}

export type ClaimLabel = 'VERIFIED' | 'INFERENCE' | 'UNVERIFIED' | 'CONFLICTING' | 'UNAVAILABLE'

export type ResearchAccounting = {
  topic: string
  requested: number
  verdicts: SourceVerdict[]
  acceptedCount: number
  rejectedCount: number
  claims: Array<{ id: string; text: string; label: ClaimLabel; supportingSources: string[]; contradictingSources: string[] }>
  conflicts: Array<{ claimId: string; for: string[]; against: string[] }>
  regions: string[]
  status: 'COMPLETED' | 'PARTIAL' | 'FAILED'
  statusReason: string
  unresolved: string[]
}

const OFF_TOPIC_MIN_OVERLAP = 0.15

function tokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3 && !STOP.has(w)),
  )
}
const STOP = new Set(['that', 'this', 'with', 'from', 'what', 'have', 'been', 'about', 'which', 'their', 'there', 'would', 'could', 'should', 'does', 'your', 'war', 'room'])

export function judgeSource(topic: string, s: SourceInput): SourceVerdict {
  const base = { url: s.url, title: s.title, region: s.region ?? null }
  if (!s.url) return { ...base, accepted: false, reason: 'no URL; cannot be cited or re-checked' }
  if (!/^https?:\/\//i.test(s.url)) return { ...base, accepted: false, reason: 'not an http(s) URL' }
  if (s.httpStatus != null && (s.httpStatus < 200 || s.httpStatus >= 300)) {
    return { ...base, accepted: false, reason: `fetch failed (HTTP ${s.httpStatus})` }
  }
  if (!s.excerpt || s.excerpt.trim().length < 40) {
    return { ...base, accepted: false, reason: 'no usable content retrieved' }
  }
  const want = tokens(topic)
  if (want.size) {
    const have = tokens(`${s.title} ${s.excerpt}`)
    let hit = 0
    for (const w of want) if (have.has(w)) hit++
    if (hit / want.size < OFF_TOPIC_MIN_OVERLAP) {
      return { ...base, accepted: false, reason: 'off-topic: content does not match the question' }
    }
  }
  return { ...base, accepted: true, reason: 'retrieved content relevant to the question' }
}

export function accountResearch(input: {
  topic: string
  requested?: number
  sources: SourceInput[]
  claims: ClaimInput[]
  retrievalError?: string | null
}): ResearchAccounting {
  const verdicts = input.sources.map(s => judgeSource(input.topic, s))
  const acceptedIdx = new Set(verdicts.map((v, i) => (v.accepted ? i : -1)).filter(i => i >= 0))
  const label = (i: number) => verdicts[i].url ?? verdicts[i].title
  const claims = input.claims.map(c => {
    const sup = c.supports.filter(i => acceptedIdx.has(i))
    const con = c.contradicts.filter(i => acceptedIdx.has(i))
    let l: ClaimLabel
    if (acceptedIdx.size === 0) l = input.retrievalError || input.sources.length === 0 ? 'UNAVAILABLE' : 'UNVERIFIED'
    else if (sup.length && con.length) l = 'CONFLICTING'
    else if (sup.length) l = c.derived ? 'INFERENCE' : 'VERIFIED'
    else if (con.length) l = 'CONFLICTING' // only contrary evidence: the claim as stated is not supported
    else l = 'UNVERIFIED'
    return { id: c.id, text: c.text, label: l, supportingSources: sup.map(label), contradictingSources: con.map(label) }
  })
  const conflicts = claims
    .filter(c => c.label === 'CONFLICTING' && c.supportingSources.length && c.contradictingSources.length)
    .map(c => ({ claimId: c.id, for: c.supportingSources, against: c.contradictingSources }))
  const acceptedCount = acceptedIdx.size
  const rejectedCount = verdicts.length - acceptedCount
  const regions = Array.from(new Set(verdicts.filter(v => v.accepted && v.region).map(v => v.region as string)))
  const unresolved = [
    ...claims.filter(c => c.label === 'UNVERIFIED' || c.label === 'UNAVAILABLE').map(c => `${c.id}: ${c.label}`),
    ...conflicts.map(c => `${c.claimId}: sources disagree and the disagreement is not resolved`),
  ]
  let status: ResearchAccounting['status']
  let statusReason: string
  if (acceptedCount === 0) {
    status = 'FAILED'
    statusReason = input.retrievalError ? `no accepted sources; retrieval error: ${input.retrievalError}` : `no accepted sources (${rejectedCount} rejected)`
  } else if (claims.length && claims.every(c => c.label === 'VERIFIED' || c.label === 'INFERENCE')) {
    status = 'COMPLETED'
    statusReason = `${acceptedCount} accepted source(s) support every claim`
  } else {
    status = 'PARTIAL'
    statusReason = `${acceptedCount} accepted source(s); ${unresolved.length} claim(s) unresolved`
  }
  return {
    topic: input.topic,
    requested: input.requested ?? input.sources.length,
    verdicts, acceptedCount, rejectedCount, claims, conflicts, regions, status, statusReason, unresolved,
  }
}

export function renderAccountingMarkdown(a: ResearchAccounting): string {
  const lines: string[] = []
  lines.push(`Research status: ${a.status} — ${a.statusReason}`)
  lines.push(`Sources: ${a.acceptedCount} accepted, ${a.rejectedCount} rejected (of ${a.verdicts.length} considered).`)
  if (a.regions.length) lines.push(`Regions represented by accepted sources: ${a.regions.join(', ')}.`)
  for (const c of a.claims) lines.push(`- [${c.label}] ${c.text}`)
  for (const c of a.conflicts) lines.push(`- CONFLICT on ${c.claimId}: for ${c.for.join('; ')} / against ${c.against.join('; ')}`)
  const rej = a.verdicts.filter(v => !v.accepted)
  if (rej.length) lines.push('Rejected: ' + rej.map(v => `${v.url ?? v.title} (${v.reason})`).join('; '))
  return lines.join('\n')
}
