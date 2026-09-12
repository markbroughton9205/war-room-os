import fs from 'node:fs'
import {
  CURRENT_PRODUCTION_WRIM,
  CURRENT_MODEL_TRAINING_STATUS,
  RAEL_STATUS,
  ROADMAP_22_STATUS,
  ROADMAP_23_STATUS,
  WR_CORPUS_STATUS,
} from '@/lib/wr-corpus/identity'
import {
  CURRENT_WR_TOKENIZER,
  CURRENT_WR_TOKENIZER_LANE,
  HISTORICAL_VOCAB_PRODUCED,
  HISTORICAL_WR_TOKENIZER_0_SHA256,
  HISTORICAL_WR_TOKENIZER_0_STATUS,
  WR_TOKENIZER_RECOMMENDATION,
  WR_TOKENIZER_RECONCILIATION,
  WR_TOKENIZER_STATUS,
  wrTokenizerTruthNotes,
} from './identity'
import { resolveWrTokenizerPaths } from './paths'
import { inspectTokenizerJson } from './inspect'

export function wrTokenizerStatusPayload(dataDirOverride?: string | null) {
  const paths = resolveWrTokenizerPaths(dataDirOverride)
  const present = fs.existsSync(paths.tokenizerJson)
  let inspected: ReturnType<typeof inspectTokenizerJson> | null = null
  let importManifest: Record<string, unknown> | null = null
  let decision: Record<string, unknown> | null = null
  if (present) inspected = inspectTokenizerJson(paths.tokenizerJson)
  if (fs.existsSync(paths.importManifest)) {
    importManifest = JSON.parse(fs.readFileSync(paths.importManifest, 'utf8')) as Record<string, unknown>
  }
  if (fs.existsSync(paths.decisionPath)) {
    decision = JSON.parse(fs.readFileSync(paths.decisionPath, 'utf8')) as Record<string, unknown>
  }
  return {
    ok: true,
    architecture: 'WR_TOKENIZER',
    historical_id: 'WR-TOKENIZER-0',
    historical_status: HISTORICAL_WR_TOKENIZER_0_STATUS,
    historical_artifact_present: present,
    hash_expected: HISTORICAL_WR_TOKENIZER_0_SHA256,
    hash_verified: importManifest?.verificationStatus === 'HASH_VERIFIED',
    vocab_size: inspected?.vocabSize ?? HISTORICAL_VOCAB_PRODUCED,
    compatibility: {
      wrim0: 'bound',
      wrim1: 'compatible',
      current_production_wrim: CURRENT_PRODUCTION_WRIM,
    },
    recommendation: WR_TOKENIZER_RECOMMENDATION,
    recommendation_file: decision,
    reconciliation: WR_TOKENIZER_RECONCILIATION,
    current_tokenizer: CURRENT_WR_TOKENIZER,
    current_lane: CURRENT_WR_TOKENIZER_LANE,
    training: WR_TOKENIZER_STATUS,
    train_button: false,
    wr_corpus: WR_CORPUS_STATUS,
    roadmap_22: ROADMAP_22_STATUS,
    roadmap_23: ROADMAP_23_STATUS,
    rael: RAEL_STATUS,
    model_training: CURRENT_MODEL_TRAINING_STATUS,
    canonical_path: present ? paths.tokenizerJson : null,
    notes: wrTokenizerTruthNotes(),
    import: importManifest,
  }
}
