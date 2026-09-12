import fs from 'node:fs'
import path from 'node:path'
import { encodeText, roundTripOk, type EncodeResult } from './encode'
import { ensureWrTokenizerDirs, resolveWrTokenizerPaths } from './paths'
import type { DomainSample } from './fixtures'

export type BenchmarkRow = {
  dataset: string
  sample: string
  domain: string
  bytes: number
  characters: number
  words: number
  tokens: number
  tokensPerWord: number | null
  tokensPerByte: number | null
  unknownCount: number
  unknownRate: number
  singleCharTokenRate: number
  roundTrip: boolean
}

export type BenchmarkSummary = {
  dataset: string
  rows: number
  bytes: number
  characters: number
  words: number
  tokens: number
  unknownCount: number
  unknownRate: number
  tokensPerWord: number | null
  tokensPerByte: number | null
  roundTripFailures: number
  fragmentationRate: number
}

function wordCount(text: string): number {
  const parts = text.trim().split(/\s+/).filter(Boolean)
  return parts.length
}

export function metricsForText(text: string, tokenizerPath: string, encoded?: EncodeResult): {
  bytes: number
  characters: number
  words: number
  tokens: number
  unknownCount: number
  unknownRate: number
  tokensPerWord: number | null
  tokensPerByte: number | null
  singleCharTokenRate: number
  roundTrip: boolean
  ids: number[]
} {
  const result = encoded ?? encodeText(text, tokenizerPath)
  const bytes = Buffer.byteLength(text, 'utf8')
  const words = wordCount(text)
  const single = result.tokens.filter(t => t.length <= 1).length
  return {
    bytes,
    characters: [...text].length,
    words,
    tokens: result.ids.length,
    unknownCount: result.unknownCount,
    unknownRate: result.ids.length ? result.unknownCount / result.ids.length : 0,
    tokensPerWord: words ? result.ids.length / words : null,
    tokensPerByte: bytes ? result.ids.length / bytes : null,
    singleCharTokenRate: result.ids.length ? single / result.ids.length : 0,
    roundTrip: roundTripOk(text, tokenizerPath),
    ids: result.ids,
  }
}

export function benchmarkSample(
  sample: DomainSample,
  tokenizerPath: string,
  dataset: string,
): BenchmarkRow {
  const m = metricsForText(sample.text, tokenizerPath)
  return {
    dataset,
    sample: sample.id,
    domain: sample.domain,
    bytes: m.bytes,
    characters: m.characters,
    words: m.words,
    tokens: m.tokens,
    tokensPerWord: m.tokensPerWord,
    tokensPerByte: m.tokensPerByte,
    unknownCount: m.unknownCount,
    unknownRate: m.unknownRate,
    singleCharTokenRate: m.singleCharTokenRate,
    roundTrip: m.roundTrip,
  }
}

export function summarizeRows(dataset: string, rows: BenchmarkRow[]): BenchmarkSummary {
  const bytes = rows.reduce((n, r) => n + r.bytes, 0)
  const characters = rows.reduce((n, r) => n + r.characters, 0)
  const words = rows.reduce((n, r) => n + r.words, 0)
  const tokens = rows.reduce((n, r) => n + r.tokens, 0)
  const unknownCount = rows.reduce((n, r) => n + r.unknownCount, 0)
  const frag = rows.reduce((n, r) => n + r.singleCharTokenRate * r.tokens, 0)
  return {
    dataset,
    rows: rows.length,
    bytes,
    characters,
    words,
    tokens,
    unknownCount,
    unknownRate: tokens ? unknownCount / tokens : 0,
    tokensPerWord: words ? tokens / words : null,
    tokensPerByte: bytes ? tokens / bytes : null,
    roundTripFailures: rows.filter(r => !r.roundTrip).length,
    fragmentationRate: tokens ? frag / tokens : 0,
  }
}

export function saveBenchmarkJson(fileName: string, payload: unknown, dataDirOverride?: string | null): string {
  const paths = resolveWrTokenizerPaths(dataDirOverride)
  ensureWrTokenizerDirs(paths)
  const dest = path.join(paths.benchmarks, fileName)
  fs.writeFileSync(dest, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return dest
}
