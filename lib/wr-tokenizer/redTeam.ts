import fs from 'node:fs'
import { WrCorpusPolicyError } from '@/lib/wr-corpus/hashes'
import {
  CURRENT_PRODUCTION_WRIM,
  RAEL_STATUS,
} from '@/lib/wr-corpus/identity'
import {
  CURRENT_WR_TOKENIZER,
  FORBIDDEN_TOKENIZER_ARCHITECTURES,
  HISTORICAL_WR_TOKENIZER_0_SHA256,
  WR_TOKENIZER_RECOMMENDATION,
  WR_TOKENIZER_STATUS,
} from './identity'

export type ForbiddenWrTokenizerAction =
  | 'RETRAIN_TOKENIZER_NOW'
  | 'ADD_TOKEN_TO_WR_TOKENIZER_0'
  | 'CHANGE_TOKEN_IDS'
  | 'MARK_GOOD_WITHOUT_BENCHMARK'
  | 'REPLACE_BECAUSE_QWEN_LARGER'
  | 'CALL_RAEL_TOKENIZER'
  | 'START_WRIM_TRAINING'
  | 'LOAD_COLLAPSED_WRIM1_PRODUCTION'
  | 'REWRITE_HISTORICAL_SHA'
  | 'MODIFY_RECOVERY_ARTIFACT'
  | 'IGNORE_WRIM0_EMBEDDING_COMPAT'
  | 'START_SECOND_ARCHITECTURE'
  | 'TRAIN_WRIM'
  | 'CREATE_RAEL'

export function denyForbiddenWrTokenizerAction(action: ForbiddenWrTokenizerAction, extra?: string): never {
  const messages: Record<ForbiddenWrTokenizerAction, string> = {
    RETRAIN_TOKENIZER_NOW: `Tokenizer training is ${WR_TOKENIZER_STATUS}. Retrain denied.`,
    ADD_TOKEN_TO_WR_TOKENIZER_0: 'WR-TOKENIZER-0 vocab is frozen. Additions require a new WR-TOKENIZER-1 artifact.',
    CHANGE_TOKEN_IDS: 'Token IDs are immutable historical truth.',
    MARK_GOOD_WITHOUT_BENCHMARK: 'Promotion requires measured benchmark evidence.',
    REPLACE_BECAUSE_QWEN_LARGER: `Qwen vocab size is not a replacement criterion. Recommendation=${WR_TOKENIZER_RECOMMENDATION}.`,
    CALL_RAEL_TOKENIZER: `WR-TOKENIZER-0 is not Ra'el. RAEL=${RAEL_STATUS}.`,
    START_WRIM_TRAINING: `CURRENT_PRODUCTION_WRIM=${CURRENT_PRODUCTION_WRIM}. Training not running.`,
    LOAD_COLLAPSED_WRIM1_PRODUCTION: 'Collapsed WRIM-1 is not production and must not be loaded as such.',
    REWRITE_HISTORICAL_SHA: `Historical SHA remains ${HISTORICAL_WR_TOKENIZER_0_SHA256}.`,
    MODIFY_RECOVERY_ARTIFACT: 'Recovery dump is read-only.',
    IGNORE_WRIM0_EMBEDDING_COMPAT: 'WRIM-0 embeddings are bound to WR-TOKENIZER-0. Ignoring that binding is denied.',
    START_SECOND_ARCHITECTURE: `Forbidden names: ${FORBIDDEN_TOKENIZER_ARCHITECTURES.join(', ')}. Canonical identity is WR-TOKENIZER.`,
    TRAIN_WRIM: 'WRIM training is NOT_IMPLEMENTED / NOT_RUNNING.',
    CREATE_RAEL: `Ra'el is ${RAEL_STATUS}.`,
  }
  throw new WrCorpusPolicyError(action, extra ? `${messages[action]} ${extra}` : messages[action])
}

export function tryForbiddenWrTokenizerAction(action: ForbiddenWrTokenizerAction): {
  denied: true
  action: ForbiddenWrTokenizerAction
  code: string
  reason: string
} {
  try {
    denyForbiddenWrTokenizerAction(action)
  } catch (error) {
    const err = error as WrCorpusPolicyError
    return { denied: true, action, code: err.code || action, reason: err.message }
  }
}

export function assertNotVocabMutation(originalSha: string, currentSha: string): void {
  if (originalSha !== currentSha) {
    throw new WrCorpusPolicyError('VOCAB_MUTATION', 'WR-TOKENIZER-0 hash changed. Mutation denied.')
  }
}

export function assertFileUnmodified(filePath: string, beforeMtimeMs: number): void {
  const after = fs.statSync(filePath).mtimeMs
  if (after !== beforeMtimeMs) {
    throw new WrCorpusPolicyError('RECOVERY_MUTATED', `Recovery artifact mtime changed: ${filePath}`)
  }
}
