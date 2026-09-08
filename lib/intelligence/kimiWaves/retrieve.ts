import { parseAllKimiWaveReports, type KimiWaveChunk, type KimiWaveParseResult } from '@/lib/intelligence/kimiWaves/parser'
import { relevanceScore } from '@/lib/intelligence/relevance'

export type KimiWaveRetrieval = {
  ok: boolean
  records: Array<KimiWaveChunk & { score: number }>
  filesDiscovered: number
  recordsParsed: number
  error?: string
  note?: string
}

let cachedParse: KimiWaveParseResult | null = null

export function loadKimiWaveIndex(force = false): KimiWaveParseResult {
  if (!force && cachedParse?.ok) return cachedParse
  cachedParse = parseAllKimiWaveReports()
  return cachedParse
}

export function retrieveKimiWaveIntelligence(query: string, limit = 8): KimiWaveRetrieval {
  const parsed = loadKimiWaveIndex()
  if (!parsed.ok) {
    return {
      ok: false,
      records: [],
      filesDiscovered: parsed.filesDiscovered,
      recordsParsed: parsed.recordsParsed,
      error: parsed.error ?? 'Kimi Wave index unavailable',
      note: 'Prior Kimi Wave retrieval unavailable this round; current answer is based only on live evidence if any was fetched.',
    }
  }
  const scored = parsed.chunks
    .map(chunk => ({
      ...chunk,
      score: relevanceScore(query, `${chunk.section}\n${chunk.text}`, [chunk.domain, chunk.sourceFile]),
    }))
    .filter(chunk => chunk.score >= 0.08)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  if (!scored.length) {
    return {
      ok: true,
      records: [],
      filesDiscovered: parsed.filesDiscovered,
      recordsParsed: parsed.recordsParsed,
      note: 'No relevant Kimi Wave records matched this mission. Prior Kimi intelligence is absent, not current.',
    }
  }

  return {
    ok: true,
    records: scored,
    filesDiscovered: parsed.filesDiscovered,
    recordsParsed: parsed.recordsParsed,
  }
}
