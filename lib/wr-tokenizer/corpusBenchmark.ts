import { WrCorpusStore } from '@/lib/wr-corpus/store'
import { benchmarkSample, metricsForText, summarizeRows, type BenchmarkRow, type BenchmarkSummary } from './benchmark'
import { encodeText } from './encode'
import type { DomainSample } from './fixtures'

export function benchmarkCorpusVersion(
  corpusVersion: string,
  tokenizerPath: string,
  dataDirOverride?: string | null,
): { summary: BenchmarkSummary; rows: BenchmarkRow[]; recordCount: number } {
  const store = new WrCorpusStore(dataDirOverride)
  try {
    const records = store.listRecordTexts(corpusVersion)
    const rows: BenchmarkRow[] = []
    for (const rec of records) {
      const encoded = encodeText(rec.text, tokenizerPath)
      const m = metricsForText(rec.text, tokenizerPath, encoded)
      rows.push({
        dataset: corpusVersion,
        sample: rec.record_id,
        domain: rec.source_type || corpusVersion,
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
      })
    }
    return { summary: summarizeRows(corpusVersion, rows), rows, recordCount: records.length }
  } finally {
    store.close()
  }
}

export function benchmarkSamples(dataset: string, samples: DomainSample[], tokenizerPath: string) {
  const rows = samples.map(sample => benchmarkSample(sample, tokenizerPath, dataset))
  return { summary: summarizeRows(dataset, rows), rows }
}
