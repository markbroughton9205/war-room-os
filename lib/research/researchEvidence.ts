import { completeGeminiCouncilMessage } from '@/lib/ai/providers/geminiCouncil'
import { insertWarRoomAuditLog } from '@/lib/war-room/auditLog'
import type { WarRoomSupabase } from '@/lib/war-room/persistence'
import type { LiveResearchEvidencePacket, LiveResearchSourceRecord } from '@/lib/runtime/liveResearchEvidencePacket'
import type { LiveResearchRouterResult } from '@/lib/research/researchRouter'
import { hydrateLiveIntelligencePacket } from '@/lib/intelligence/sources/livePacketHydrator'
import type { RawIntelligenceSourceRecord } from '@/lib/intelligence/sourceNormalizer'

function parseLineList(text: string, prefix: string): string[] {
  const line = text.split('\n').find(l => l.trim().toUpperCase().startsWith(prefix.toUpperCase()))
  if (!line) return []
  const idx = line.indexOf(':')
  const v = (idx === -1 ? line : line.slice(idx + 1)).trim()
  if (!v || v.toUpperCase() === 'NONE') return []
  return v.split(/\s*\|\|\s*/).map(s => s.trim()).filter(Boolean).slice(0, 8)
}

async function synthesizeWithGemini(args: {
  decreeText: string
  router: LiveResearchRouterResult
}): Promise<{ ok: boolean; text: string; error?: string }> {
  const { decreeText, router } = args
  const tLines = router.tavily.results
    .slice(0, 5)
    .map(r => `TITLE: ${r.title}\nURL: ${r.url}\nSNIPPET: ${r.snippet}`)
    .join('\n---\n')
  const dLines = router.direct
    .filter(d => d.ok && d.contentSnippet)
    .map(d => `URL: ${d.url}\nTEXT: ${d.contentSnippet.slice(0, 1200)}`)
    .join('\n---\n')
  const grokBlock = router.grok.ok ? `GROK_FRAMING:\n${router.grok.text.slice(0, 1800)}` : 'GROK_FRAMING: (unavailable)'

  const bundle = [
    'TAVILY_RESULTS:',
    tLines || '(none)',
    '',
    'DIRECT_FETCH:',
    dLines || '(none)',
    '',
    grokBlock,
  ].join('\n')

  const system = `You are Gemini Family in War Room **secondary verification / synthesis** for live research.
Rules:
- Use ONLY facts supported by the pasted bundle (TAVILY_RESULTS, DIRECT_FETCH, GROK_FRAMING). GROK_FRAMING is not web search output — treat it as hypothesis-level only.
- Never invent URLs, publishers, dates, or quotes.
- End your reply with exactly these three lines:
CONTRADICTIONS: item1 || item2 || NONE
UNRESOLVED: item1 || item2 || NONE
CONFIDENCE: a number 0.0–1.0 for how well the evidence supports a crisp answer.`

  const user = `Decree / question:\n${decreeText.slice(0, 2000)}\n\nEvidence bundle:\n${bundle.slice(0, 12_000)}`

  const res = await completeGeminiCouncilMessage({
    userPrompt: user,
    systemPrompt: system,
    maxOutputTokens: 700,
    timeoutMs: 18_000,
  })
  if (!res.ok) {
    return { ok: false, text: '', error: res.degraded ? res.note : res.error }
  }
  return { ok: true, text: res.text.trim() }
}

function fallbackFindings(router: LiveResearchRouterResult): string {
  const bits: string[] = []
  if (router.tavily.ok && router.tavily.results[0]) {
    const r = router.tavily.results[0]!
    bits.push(`Primary search hit: ${r.title} — ${r.snippet.slice(0, 420)}`)
  }
  if (router.grok.ok && router.grok.text) {
    bits.push(`Grok framing (non-web): ${router.grok.text.slice(0, 520)}`)
  }
  for (const d of router.direct) {
    if (d.ok) bits.push(`Direct page excerpt (${d.url}): ${d.contentSnippet.slice(0, 420)}`)
  }
  return bits.join('\n\n')
}

function rawIntelligenceFromRouter(router: LiveResearchRouterResult): RawIntelligenceSourceRecord[] {
  const records: RawIntelligenceSourceRecord[] = [
    {
      source_id: 'tavily',
      ok: router.tavily.ok && router.tavily.results.length > 0,
      queried_at: router.generatedAt,
      findings: router.tavily.results.map(result => ({
        title: result.title,
        url: result.url,
        content: result.snippet,
        observed_at: router.generatedAt,
      })),
      error: router.tavily.error,
      failure_behavior: 'degrade',
    },
    {
      source_id: 'x_twitter_discussions',
      ok: router.grok.ok && Boolean(router.grok.text.trim()),
      queried_at: router.generatedAt,
      findings: router.grok.text.trim()
        ? [{
            title: 'Grok realtime / social signal framing',
            content: router.grok.text,
            observed_at: router.generatedAt,
          }]
        : [],
      error: router.grok.error,
      failure_behavior: 'skip',
    },
  ]

  if (router.direct.length) {
    records.push({
      source_id: 'direct_fetch',
      ok: router.direct.some(item => item.ok),
      queried_at: router.generatedAt,
      findings: router.direct
        .filter(item => item.ok)
        .map(item => ({
          title: `Direct fetch: ${item.url}`,
          url: item.url,
          content: item.contentSnippet,
          observed_at: router.generatedAt,
        })),
      error: router.direct.filter(item => !item.ok && item.error).map(item => `${item.url}: ${item.error}`).join(' | ') || undefined,
      failure_behavior: 'degrade',
    })
  }

  return records
}

/**
 * Build a structured evidence packet from router output + optional Gemini synthesis.
 */
export async function buildLiveResearchEvidencePacket(args: {
  decreeText: string
  router: LiveResearchRouterResult
  intentConfidence: number
}): Promise<LiveResearchEvidencePacket> {
  const { decreeText, router, intentConfidence } = args
  const sources: LiveResearchSourceRecord[] = []

  sources.push({
    kind: 'tavily',
    ok: router.tavily.ok,
    queriedAt: router.generatedAt,
    urls: router.tavily.results.map(r => r.url).slice(0, 8),
    error: router.tavily.ok ? undefined : router.tavily.error,
  })

  sources.push({
    kind: 'grok_xai',
    ok: router.grok.ok,
    queriedAt: router.generatedAt,
    error: router.grok.error,
    note: 'framing_only_not_web_search',
  })

  for (const d of router.direct) {
    sources.push({
      kind: 'direct_fetch',
      ok: d.ok,
      queriedAt: router.generatedAt,
      urls: [d.url],
      error: d.error,
    })
  }

  let geminiText = ''
  let geminiOk = false
  const allowGemini =
    Boolean(process.env.GEMINI_API_KEY?.trim())
    && (router.tavily.ok && router.tavily.results.length > 0 || router.direct.some(d => d.ok))
  if (allowGemini) {
    const syn = await synthesizeWithGemini({ decreeText, router })
    geminiOk = syn.ok && Boolean(syn.text)
    geminiText = syn.text
    sources.push({
      kind: 'gemini',
      ok: geminiOk,
      queriedAt: new Date().toISOString(),
      error: syn.error,
    })
  }

  const findings =
    geminiOk
      ? geminiText
      : fallbackFindings(router).trim()
        || 'No provider-returned evidence was available. Do not invent URLs, citations, or current headlines.'
  const contradictions = geminiOk ? parseLineList(geminiText, 'CONTRADICTIONS') : []
  const unresolvedQuestions = geminiOk ? parseLineList(geminiText, 'UNRESOLVED') : []

  const confMatch = /CONFIDENCE:\s*([0-9]+(?:\.[0-9]+)?)/i.exec(geminiText)
  const geminiConf = confMatch ? Number(confMatch[1]) : NaN
  const legScore =
    (router.tavily.ok ? 0.28 : 0)
    + (router.grok.ok ? 0.12 : 0)
    + (router.direct.some(d => d.ok) ? 0.22 : 0)
    + (geminiOk ? 0.28 : 0)
  const confidence = Math.min(
    1,
    intentConfidence * 0.45 + legScore + (Number.isFinite(geminiConf) ? geminiConf * 0.2 : 0),
  )

  const usedLiveResearch =
    (router.tavily.ok && router.tavily.results.length > 0)
    || router.direct.some(d => d.ok)
    || router.grok.ok
    || geminiOk

  const freshness: LiveResearchEvidencePacket['freshness'] =
    router.tavily.ok || router.direct.some(d => d.ok) ? 'recent' : router.grok.ok ? 'unknown' : 'stale'

  const intelligencePacket = hydrateLiveIntelligencePacket({
    decree: decreeText,
    timestamp: router.generatedAt,
    rawSources: rawIntelligenceFromRouter(router),
    unsupportedClaims: unresolvedQuestions.filter(c => c.toUpperCase() !== 'NONE'),
    retrieval: router.retrieval,
  })

  return {
    usedLiveResearch,
    generatedAt: router.generatedAt,
    sources,
    findings,
    confidence,
    freshness,
    contradictions: contradictions.filter(c => c.toUpperCase() !== 'NONE'),
    unresolvedQuestions: unresolvedQuestions.filter(c => c.toUpperCase() !== 'NONE'),
    intelligencePacket,
    ...(!usedLiveResearch ? { researchErrorSummary: 'Live research legs returned no usable evidence.' } : {}),
  }
}

export async function logLiveResearchEvidenceMetadata(
  client: WarRoomSupabase | null,
  args: {
    conversationId?: string | null
    triggered: boolean
    intentConfidence: number
    packet: LiveResearchEvidencePacket
    routerMs?: number
  },
): Promise<void> {
  const { conversationId, triggered, intentConfidence, packet, routerMs } = args
  const success: Record<string, boolean> = {}
  for (const s of packet.sources) {
    success[s.kind] = Boolean(s.ok)
  }
  await insertWarRoomAuditLog(client, {
    actor: 'system',
    category: 'internet',
    message: 'Live research evidence (metadata only)',
    metadata: {
      triggered,
      intentConfidence,
      confidence: packet.confidence,
      freshness: packet.freshness,
      usedLiveResearch: packet.usedLiveResearch,
      sourceTypes: packet.sources.map(s => s.kind),
      success,
      timestamp: packet.generatedAt,
      conversationId: conversationId ?? null,
      routerMs: routerMs ?? null,
      contradictionsCount: packet.contradictions.length,
      unresolvedCount: packet.unresolvedQuestions.length,
      intelligencePacketId: packet.intelligencePacket?.id ?? null,
      intelligenceConfidence: packet.intelligencePacket?.confidence_summary.overall ?? null,
      intelligenceWeakSignalCount: packet.intelligencePacket?.weak_signals.length ?? 0,
      intelligenceContradictionCount: packet.intelligencePacket?.contradictions.length ?? 0,
      retrievalRequired: packet.intelligencePacket?.retrieval?.required ?? false,
      retrievalSuccess: packet.intelligencePacket?.retrieval?.retrieval_success ?? null,
      retrievalGaps: packet.intelligencePacket?.retrieval?.retrieval_gaps.length ?? 0,
    },
  })
}
