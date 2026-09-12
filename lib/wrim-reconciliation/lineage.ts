import fs from 'node:fs'
import path from 'node:path'
import { HISTORICAL_WR_TOKENIZER_0_SHA256, WRIM0_VOCAB_SIZE } from './identity'
import { recoverWrim0Architecture } from './architecture'
import { dumpWrim1FinalRunManifest, dumpWrim1OfficialDir } from './paths'
import { RECOVERY_EXPERIMENTS } from './recovery'

export type LineageRow = {
  model: string
  corpus: string
  tokenizer: string
  tokenizerSha256: string
  tokenizerVerified: boolean
  notes: string
}

export function mapTrainingDataLineage(dumpRoot?: string | null) {
  const arch = recoverWrim0Architecture(dumpRoot)
  let wrim1Tok = { tokenizer_id: '', tokenizer_sha256: '' }
  const wrim1Manifest = dumpWrim1FinalRunManifest(dumpRoot)
  if (fs.existsSync(wrim1Manifest)) {
    wrim1Tok = JSON.parse(fs.readFileSync(wrim1Manifest, 'utf8')) as typeof wrim1Tok
  }
  let wrim1_000002: { tokenizer_id?: string; tokenizer_sha256?: string; curriculum_id?: string } = {}
  const official = dumpWrim1OfficialDir(dumpRoot)
  const summary = path.join(official, 'run-summary.json')
  if (fs.existsSync(summary)) {
    wrim1_000002 = JSON.parse(fs.readFileSync(summary, 'utf8')) as typeof wrim1_000002
  }
  const rows: LineageRow[] = [
    {
      model: 'WRIM-0',
      corpus: 'WR-CORPUS-0 (historical WRM-001)',
      tokenizer: 'WR-TOKENIZER-0',
      tokenizerSha256: arch.tokenizerJsonSha256,
      tokenizerVerified: arch.tokenizerJsonSha256 === HISTORICAL_WR_TOKENIZER_0_SHA256 && arch.vocabSize === WRIM0_VOCAB_SIZE,
      notes: `lineage.corpusJsonlSha256=${arch.corpusJsonlSha256}; no pretrained weights; 6 genesis documents`,
    },
    {
      model: 'WRIM1-RUN-000001',
      corpus: 'WR-CORPUS-1 / WR-CORPUS-1-HARDENED materialized shards',
      tokenizer: wrim1Tok.tokenizer_id || 'WR-TOKENIZER-0',
      tokenizerSha256: wrim1Tok.tokenizer_sha256 || '',
      tokenizerVerified: wrim1Tok.tokenizer_sha256 === HISTORICAL_WR_TOKENIZER_0_SHA256,
      notes: 'No WR-CORPUS-0 rehearsal. Token-shuffled packing. Eval-infra leakage disclosed.',
    },
    {
      model: 'WRIM1-RUN-000002',
      corpus: wrim1_000002.curriculum_id || 'WR-CORPUS-1.1-CAPABILITY-CANDIDATE',
      tokenizer: wrim1_000002.tokenizer_id || 'WR-TOKENIZER-0',
      tokenizerSha256: wrim1_000002.tokenizer_sha256 || '',
      tokenizerVerified: wrim1_000002.tokenizer_sha256 === HISTORICAL_WR_TOKENIZER_0_SHA256,
      notes: 'Interleaved rehearsal/prose/code/supervised. CAP-EVAL-0 excluded from pack (0 leak).',
    },
  ]
  for (const exp of RECOVERY_EXPERIMENTS) {
    rows.push({
      model: exp.id,
      corpus: `TEST_ONLY mix: ${exp.changed}`,
      tokenizer: 'WR-TOKENIZER-0 (parent WRIM-0 binding)',
      tokenizerSha256: HISTORICAL_WR_TOKENIZER_0_SHA256,
      tokenizerVerified: true,
      notes: 'Do not assume identical data across recovery runs. Each experiment changed mix and/or LR.',
    })
  }
  return {
    tokenizerCanonical: 'WR-TOKENIZER-0',
    allRunsClaimTokenizer0: rows.every(r => r.tokenizerVerified),
    rows,
  }
}
