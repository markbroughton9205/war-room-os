/**
 * Phase 5 — Live internet research evidence attached to council prompts.
 * URLs must only originate from user-provided links (validated) or provider APIs — never invented.
 */

export type LiveResearchSourceKind = 'tavily' | 'grok_xai' | 'gemini' | 'direct_fetch'

export type LiveResearchSourceRecord = {
  kind: LiveResearchSourceKind
  ok: boolean
  /** ISO timestamp when this leg finished */
  queriedAt: string
  /** Real URLs only (API results or validated user URLs). */
  urls?: string[]
  error?: string
  /** Short neutral note (e.g. byte cap), not full page bodies. */
  note?: string
}

export type LiveResearchEvidencePacket = {
  usedLiveResearch: boolean
  generatedAt: string
  sources: LiveResearchSourceRecord[]
  /** Short evidence-oriented summary; may be empty when all legs failed. */
  findings: string
  confidence: number
  freshness: 'unknown' | 'recent' | 'stale'
  contradictions: string[]
  unresolvedQuestions: string[]
  /** When providers errored but the pipeline stayed isolated. */
  researchErrorSummary?: string
}

export type LiveResearchClientUi = {
  mode: 'inactive' | 'active' | 'sources_queried' | 'verified' | 'partial' | 'unavailable'
  sourcesCount: number
  /** Single-line label for compact UI. */
  label: string
}

export function emptyLiveResearchEvidencePacket(generatedAt: string, summary?: string): LiveResearchEvidencePacket {
  return {
    usedLiveResearch: false,
    generatedAt,
    sources: [],
    findings: '',
    confidence: 0,
    freshness: 'unknown',
    contradictions: [],
    unresolvedQuestions: [],
    ...(summary ? { researchErrorSummary: summary } : {}),
  }
}

export function buildLiveResearchGroundingBlock(packet: LiveResearchEvidencePacket): string {
  const lines: string[] = ['### Live research evidence (server-fetched; read-only)']
  lines.push(`- usedLiveResearch: ${packet.usedLiveResearch} · generatedAt: ${packet.generatedAt}`)
  lines.push(`- confidence: ${packet.confidence.toFixed(2)} · freshness: ${packet.freshness}`)
  if (packet.sources.length) {
    for (const s of packet.sources) {
      const urlPart = s.urls?.length ? ` urls=${s.urls.slice(0, 4).join(' | ')}` : ''
      lines.push(`- source[${s.kind}]: ok=${s.ok}${urlPart}${s.error ? ` error=${s.error}` : ''}`)
    }
  } else {
    lines.push('- sources: none')
  }
  if (packet.findings.trim()) {
    lines.push(`- findings (may be incomplete; not legal/medical advice):\n${packet.findings.trim().slice(0, 3500)}`)
  } else {
    lines.push('- findings: none')
  }
  if (packet.contradictions.length) {
    lines.push(`- contradictions: ${packet.contradictions.join(' || ')}`)
  }
  if (packet.unresolvedQuestions.length) {
    lines.push(`- unresolvedQuestions: ${packet.unresolvedQuestions.join(' || ')}`)
  }
  if (packet.researchErrorSummary) {
    lines.push(`- pipelineNote: ${packet.researchErrorSummary}`)
  }
  lines.push(
    '- Epistemic discipline: Label claims as **verified current** only when directly supported by the sources above. Mark **inference** vs **speculation** vs **historical / general knowledge**. Never invent URLs, citations, or article titles. If live research failed or is partial, say so explicitly; do not fill gaps with fabricated “current events”.',
  )
  return lines.join('\n')
}

export function computeLiveResearchClientUi(
  packet: LiveResearchEvidencePacket | undefined,
  researchAttempted: boolean,
): LiveResearchClientUi {
  if (!researchAttempted) {
    return { mode: 'inactive', sourcesCount: 0, label: 'Live research idle' }
  }
  const sourcesCount = packet?.sources.filter(s => s.ok).length ?? 0
  const queried = packet?.sources.length ?? 0

  if (!packet || packet.sources.every(s => !s.ok)) {
    return {
      mode: 'unavailable',
      sourcesCount: 0,
      label: 'Research unavailable',
    }
  }
  if (packet.usedLiveResearch && packet.confidence >= 0.72 && sourcesCount >= 2 && !packet.researchErrorSummary) {
    return {
      mode: 'verified',
      sourcesCount: queried,
      label: 'Current info verified (multi-source)',
    }
  }
  if (packet.usedLiveResearch && sourcesCount >= 1) {
    if (sourcesCount < queried) {
      return {
        mode: 'partial',
        sourcesCount: queried,
        label: 'Research partially available',
      }
    }
    return {
      mode: 'sources_queried',
      sourcesCount: queried,
      label: 'Sources queried',
    }
  }
  if (packet.usedLiveResearch) {
    return { mode: 'active', sourcesCount: queried, label: 'Live research active' }
  }
  return { mode: 'partial', sourcesCount: queried, label: 'Research partially available' }
}

export type LiveResearchClientSummary = {
  usedLiveResearch: boolean
  confidence: number
  freshness: LiveResearchEvidencePacket['freshness']
  sourceKinds: LiveResearchSourceKind[]
  sourcesQueried: number
  sourcesSucceeded: number
}

export function toLiveResearchClientSummary(packet: LiveResearchEvidencePacket | undefined): LiveResearchClientSummary | undefined {
  if (!packet) return undefined
  return {
    usedLiveResearch: packet.usedLiveResearch,
    confidence: packet.confidence,
    freshness: packet.freshness,
    sourceKinds: packet.sources.map(s => s.kind),
    sourcesQueried: packet.sources.length,
    sourcesSucceeded: packet.sources.filter(s => s.ok).length,
  }
}
