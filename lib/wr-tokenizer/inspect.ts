import fs from 'node:fs'
import path from 'node:path'
import { sha256File, WrCorpusPolicyError } from '@/lib/wr-corpus/hashes'
import { defaultRecoveryDumpRoot } from '@/lib/wr-corpus/recoverySource'
import {
  DUMP_TOKENIZER_MANIFEST_RELATIVE,
  DUMP_TOKENIZER_RELATIVE,
  EXPECTED_SPECIAL_TOKENS,
  HISTORICAL_ALGORITHM,
  HISTORICAL_VOCAB_PRODUCED,
  HISTORICAL_WR_TOKENIZER_0_SHA256,
  WRIM0_LINEAGE_RELATIVE,
  WRIM1_RUN_MANIFEST_RELATIVE,
} from './identity'
import { getLoadedTokenizer } from './encode'

export function dumpTokenizerPath(dumpRoot?: string | null): string {
  return path.join(defaultRecoveryDumpRoot(dumpRoot), ...DUMP_TOKENIZER_RELATIVE)
}

export function dumpTokenizerManifestPath(dumpRoot?: string | null): string {
  return path.join(defaultRecoveryDumpRoot(dumpRoot), ...DUMP_TOKENIZER_MANIFEST_RELATIVE)
}

export async function rehashDumpTokenizer(dumpRoot?: string | null): Promise<{
  path: string
  sha256: string
  bytes: number
  match: boolean
}> {
  const filePath = dumpTokenizerPath(dumpRoot)
  if (!fs.existsSync(filePath)) {
    throw new WrCorpusPolicyError('TOKENIZER_MISSING', `WR-TOKENIZER-0 missing at ${filePath}. STOP.`)
  }
  const sha256 = await sha256File(filePath)
  if (sha256 !== HISTORICAL_WR_TOKENIZER_0_SHA256) {
    throw new WrCorpusPolicyError(
      'HASH_MISMATCH',
      `WR-TOKENIZER-0 hash mismatch. expected ${HISTORICAL_WR_TOKENIZER_0_SHA256} got ${sha256}. STOP. Do not silently regenerate.`,
    )
  }
  return { path: filePath, sha256, bytes: fs.statSync(filePath).size, match: true }
}

export function inspectTokenizerJson(filePath: string) {
  const tok = getLoadedTokenizer(filePath)
  const specials = EXPECTED_SPECIAL_TOKENS.map(expected => {
    const actual = tok.addedTokens.find(t => t.id === expected.id)
    return {
      id: expected.id,
      expected: expected.token,
      actual: actual?.content ?? null,
      match: actual?.content === expected.token,
    }
  })
  return {
    version: tok.version,
    format: 'HuggingFace tokenizer.json',
    algorithm: tok.modelType === 'BPE' ? HISTORICAL_ALGORITHM : tok.modelType,
    vocabSize: tok.vocabSize,
    vocabMatchesHistorical: tok.vocabSize === HISTORICAL_VOCAB_PRODUCED,
    mergeCount: tok.merges.length,
    unkToken: tok.unkToken,
    unkId: tok.unkId,
    normalizer: tok.normalizer,
    preTokenizer: tok.preTokenizer,
    decoder: tok.decoder,
    postProcessor: tok.postProcessor,
    addPrefixSpace: tok.addPrefixSpace,
    byteFallback: tok.byteFallback,
    fuseUnk: tok.fuseUnk,
    specials,
    specialsMatch: specials.every(s => s.match),
    idsStable0to8: specials.every(s => s.match),
  }
}

export function readWrim0Lineage(dumpRoot?: string | null): {
  tokenizerJsonSha256: string
  corpusJsonlSha256: string
  vocab_size: number
  compatible: boolean
} {
  const full = path.join(defaultRecoveryDumpRoot(dumpRoot), ...WRIM0_LINEAGE_RELATIVE)
  const raw = JSON.parse(fs.readFileSync(full, 'utf8')) as {
    lineage?: { tokenizerJsonSha256?: string; corpusJsonlSha256?: string }
    architectureConfig?: { vocab_size?: number }
  }
  const tokenizerJsonSha256 = String(raw.lineage?.tokenizerJsonSha256 ?? '')
  const corpusJsonlSha256 = String(raw.lineage?.corpusJsonlSha256 ?? '')
  const vocab_size = Number(raw.architectureConfig?.vocab_size ?? 0)
  return {
    tokenizerJsonSha256,
    corpusJsonlSha256,
    vocab_size,
    compatible:
      tokenizerJsonSha256 === HISTORICAL_WR_TOKENIZER_0_SHA256 && vocab_size === HISTORICAL_VOCAB_PRODUCED,
  }
}

export function readWrim1TokenizerLineage(dumpRoot?: string | null): {
  tokenizer_id: string
  tokenizer_sha256: string
  compatible: 'compatible' | 'incompatible' | 'unknown'
} {
  const full = path.join(defaultRecoveryDumpRoot(dumpRoot), ...WRIM1_RUN_MANIFEST_RELATIVE)
  if (!fs.existsSync(full)) {
    return { tokenizer_id: '', tokenizer_sha256: '', compatible: 'unknown' }
  }
  const raw = JSON.parse(fs.readFileSync(full, 'utf8')) as {
    tokenizer_id?: string
    tokenizer_sha256?: string
  }
  const tokenizer_id = String(raw.tokenizer_id ?? '')
  const tokenizer_sha256 = String(raw.tokenizer_sha256 ?? '')
  const compatible =
    tokenizer_id === 'WR-TOKENIZER-0' && tokenizer_sha256 === HISTORICAL_WR_TOKENIZER_0_SHA256
      ? 'compatible'
      : tokenizer_sha256
        ? 'incompatible'
        : 'unknown'
  return { tokenizer_id, tokenizer_sha256, compatible }
}
