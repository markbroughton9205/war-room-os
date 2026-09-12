import { encodeText } from './encode'
import { metricsForText, type BenchmarkRow } from './benchmark'

export type BaselineName = 'wr-tokenizer-0' | 'whitespace' | 'unicode-characters' | 'utf8-bytes'

export function baselineTokenCount(text: string, baseline: Exclude<BaselineName, 'wr-tokenizer-0'>): number {
  if (baseline === 'whitespace') return text.trim() ? text.trim().split(/\s+/).length : 0
  if (baseline === 'unicode-characters') return [...text].length
  return Buffer.byteLength(text, 'utf8')
}

export function compareSample(text: string, tokenizerPath: string): Record<BaselineName, number> {
  return {
    'wr-tokenizer-0': encodeText(text, tokenizerPath).ids.length,
    whitespace: baselineTokenCount(text, 'whitespace'),
    'unicode-characters': baselineTokenCount(text, 'unicode-characters'),
    'utf8-bytes': baselineTokenCount(text, 'utf8-bytes'),
  }
}

export function compareRows(rows: Array<{ id: string; domain: string; text: string }>, tokenizerPath: string) {
  return rows.map(row => {
    const wr = metricsForText(row.text, tokenizerPath)
    const counts = compareSample(row.text, tokenizerPath)
    return {
      sample: row.id,
      domain: row.domain,
      bytes: wr.bytes,
      baselines: counts,
      wrUnknownRate: wr.unknownRate,
      note: 'Qwen/SentencePiece families were not downloaded. Local Python tokenizers/sentencepiece modules are absent. Comparison uses inspectable local baselines only.',
    }
  })
}

export function qwenTokenizerAvailable(): { available: false; reason: string } {
  return {
    available: false,
    reason: 'No local Qwen tokenizer.json was inspected without downloading a model. Qwen remains THIRD_PARTY_MODEL_RUNNING_LOCALLY and is not a replacement baseline for WR-TOKENIZER-0.',
  }
}
