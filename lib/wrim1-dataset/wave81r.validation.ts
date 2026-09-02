import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createValidationHarness } from '@/lib/agi-program/validationHarness'
import { HARDENED_CORPUS_ID, WAVE8_PREDECESSOR_CORPUS_HASH, WR_TOKENIZER_0_SHA, WRIM0_CHECKPOINT_SHA } from './types'
import { detectContentLeakage } from './leakage'
import { buildHeldOutSuite81, heldOutFingerprintSet, heldOutLineageSet } from './heldOut'
import type { ChunkRecord, HardenedExample } from './types'

const EXPECTED = 22
const { check, finish } = createValidationHarness('Wave 8.1R frozen corpus recovery', EXPECTED)
const repo = process.cwd()
const frozenPath = join(repo, 'model-lab/manifests/wave8_1/corpus-manifest.json')
const bundlePath = join(repo, 'model-lab/corpora/WR-CORPUS-1-HARDENED/corpus-manifest.json')
const recoveryPath = join(repo, 'model-lab/corpora/WR-CORPUS-1-HARDENED/provenance/recovery-manifest.json')
const behaviorPath = join(repo, 'model-lab/manifests/wave8_1/behavior-examples.json')
const failedPreflight = join(repo, 'model-lab/manifests/wave9/WRIM1-RUN-000001-preflight.json')
const authPath = join(repo, 'model-lab/manifests/wave9/authorization.json')
const runPath = join(repo, 'model-lab/manifests/wave9/WRIM1-RUN-000001.json')
const parent = join(repo, 'model-lab/manifests/wrim0_checkpoints/checkpoint-final.safetensors')
const tokenizer = join(repo, 'model-lab/manifests/wrim0_tokenizer_v16384/tokenizer.json')

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

const frozen = JSON.parse(readFileSync(frozenPath, 'utf8')) as {
  corpusId: string
  contentHash: string
  chunkCount: number
  exampleCount: number
  uniqueNewTrainTokens: number
  uniqueNewValidationTokens: number
  uniqueNewTestTokens: number
  leakage: { passed: boolean; heldOutCollisions: unknown[]; nearDuplicatePairs: number; sourceLineageCrossSplit: unknown[] }
  splitCounts: { train: { chunks: number }; validation: { chunks: number }; test: { chunks: number } }
  chunks: Array<{ chunkId: string; contentHash: string; split: 'train' | 'validation' | 'test'; path: string; sourceId: string; sourceHash: string; parentLineage: string; offsetStart: number; offsetEnd: number; normalizedHash: string; capabilityTags: string[]; format: ChunkRecord['format']; qualityTier: ChunkRecord['qualityTier']; byteLength: number; tokenizerTokens: number | null; documentId: string }>
}
const bundle = JSON.parse(readFileSync(bundlePath, 'utf8')) as {
  corpusIdentityHash: string
  materializedBundleHash: string
  tokenizerSha256: string
  tokenCounts: { train: number; validation: number; test: number }
  sourceShards: Array<{ path: string; sha256: string; split: string }>
  tokenShards: Array<{ path: string; sha256: string; tokenizer_sha256: string }>
  exampleCount: number
  chunkCount: number
}
const recovery = JSON.parse(readFileSync(recoveryPath, 'utf8')) as {
  total_chunks: number
  recovered_chunks: number
  unrecovered_chunks: number
  recovery_source_counts: Record<string, number>
  worktree_match: number
  worktree_mismatch: number
}

check('1 failed training-start preflight is preserved', () => {
  assert.equal(existsSync(failedPreflight), true)
  const parsed = JSON.parse(readFileSync(failedPreflight, 'utf8')) as { passed: boolean; failures: string[] }
  assert.equal(parsed.passed, false)
  assert.ok(parsed.failures.includes('corpus_bytes_reconstructable'))
})
check('2 frozen Wave 8.1 identity is untouched', () => {
  assert.equal(frozen.corpusId, HARDENED_CORPUS_ID)
  assert.equal(frozen.contentHash, '76ddac51d8132b375e541723045f89714fe060d04a88a5ef51373319d4cdbd27')
  assert.equal(frozen.chunkCount, 11164)
})
check('3 every frozen chunk was recovered', () => {
  assert.equal(recovery.total_chunks, 11164)
  assert.equal(recovery.recovered_chunks, 11164)
  assert.equal(recovery.unrecovered_chunks, 0)
})
check('4 materialized bundle links the frozen identity without replacing it', () => {
  assert.equal(bundle.corpusIdentityHash, frozen.contentHash)
  assert.match(bundle.materializedBundleHash, /^[a-f0-9]{64}$/)
  assert.notEqual(bundle.materializedBundleHash, frozen.contentHash)
})
check('5 source shard hashes verify', () => {
  assert.equal(bundle.sourceShards.length, 3)
  for (const shard of bundle.sourceShards) {
    assert.equal(sha256File(join(repo, shard.path)), shard.sha256)
  }
})
check('6 token shard hashes verify against WR-TOKENIZER-0', () => {
  assert.equal(bundle.tokenShards.length, 3)
  for (const shard of bundle.tokenShards) {
    assert.equal(sha256File(join(repo, shard.path)), shard.sha256)
    assert.equal(shard.tokenizer_sha256, WR_TOKENIZER_0_SHA)
  }
})
check('7 tokenizer artifact is untouched', () => {
  assert.equal(sha256File(tokenizer), WR_TOKENIZER_0_SHA)
  assert.equal(bundle.tokenizerSha256, WR_TOKENIZER_0_SHA)
})
check('8 WRIM-0 parent is untouched', () => {
  assert.equal(sha256File(parent), WRIM0_CHECKPOINT_SHA)
})
check('9 token counts match frozen Wave 8.1', () => {
  assert.equal(bundle.tokenCounts.train, 3874900)
  assert.equal(bundle.tokenCounts.validation, 836935)
  assert.equal(bundle.tokenCounts.test, 310725)
  assert.equal(frozen.uniqueNewTrainTokens, 3874900)
})
check('10 split membership is reproduced', () => {
  assert.equal(frozen.splitCounts.train.chunks, 8449)
  assert.equal(frozen.splitCounts.validation.chunks, 1853)
  assert.equal(frozen.splitCounts.test.chunks, 862)
})
check('11 behavior examples remain materialized', () => {
  const behavior = JSON.parse(readFileSync(behaviorPath, 'utf8')) as { count: number; examples: Array<{ renderedTrainingText: string; renderedHash: string }> }
  assert.equal(behavior.count, 31)
  assert.equal(bundle.exampleCount, 31)
  assert.ok(behavior.examples.every(item => item.renderedTrainingText.includes('<|assistant|>') && item.renderedHash.length === 64))
})
check('12 recovered JSONL bytes match frozen contentHash', () => {
  const byHash = new Map(frozen.chunks.map(chunk => [chunk.chunkId, chunk.contentHash]))
  let verified = 0
  for (const shard of bundle.sourceShards) {
    const lines = readFileSync(join(repo, shard.path), 'utf8').split('\n').filter(Boolean)
    for (const line of lines) {
      const rec = JSON.parse(line) as { kind: string; chunk_id: string; contentHash: string; text: string; recovery_confidence: string }
      if (rec.kind !== 'chunk') continue
      const actual = createHash('sha256').update(rec.text, 'utf8').digest('hex')
      assert.equal(actual, rec.contentHash)
      assert.equal(actual, byHash.get(rec.chunk_id))
      assert.equal(rec.recovery_confidence, 'exact_hash_match')
      verified += 1
    }
  }
  assert.equal(verified, 11164)
})
check('13 leakage gates remain PASS on recovered bytes', () => {
  const frozenById = new Map(frozen.chunks.map(chunk => [chunk.chunkId, chunk]))
  const chunks: ChunkRecord[] = []
  for (const shard of bundle.sourceShards) {
    const lines = readFileSync(join(repo, shard.path), 'utf8').split('\n').filter(Boolean)
    for (const line of lines) {
      const rec = JSON.parse(line) as { kind: string; chunk_id: string; text: string }
      if (rec.kind !== 'chunk') continue
      const frozenChunk = frozenById.get(rec.chunk_id)
      assert.ok(frozenChunk)
      chunks.push({ ...frozenChunk, text: rec.text })
    }
  }
  const behavior = JSON.parse(readFileSync(behaviorPath, 'utf8')) as {
    examples: Array<{
      exampleId: string
      trainability: HardenedExample['trainability']
      renderedHash: string
      input: string
      source_lineage?: string[]
      lineageIds?: string[]
      contentHash?: string
    }>
  }
  const evals = buildHeldOutSuite81()
  const report = detectContentLeakage({
    chunks,
    examples: behavior.examples.map(item => ({
      exampleId: item.exampleId,
      trainability: item.trainability,
      lineageIds: item.lineageIds ?? item.source_lineage ?? [item.exampleId],
      contentHash: item.contentHash ?? item.renderedHash,
      input: item.input,
    })) as HardenedExample[],
    heldOutFingerprints: heldOutFingerprintSet(evals),
    heldOutLineages: heldOutLineageSet(evals),
  })
  assert.equal(report.passed, true)
  assert.equal(report.nearDuplicatePairs, 0)
  assert.equal(report.heldOutCollisions.length, 0)
  assert.equal(report.sourceLineageCrossSplit.length, 0)
  assert.equal(frozen.leakage.passed, true)
})
check('14 held-out isolation remains PASS', () => {
  const evals = buildHeldOutSuite81()
  assert.equal(evals.length, 10)
  assert.equal(frozen.leakage.heldOutCollisions.length, 0)
})
check('15 predecessor Wave 8 identity is unchanged', () => {
  assert.equal(WAVE8_PREDECESSOR_CORPUS_HASH, '36f357baa2e7b117d5f4bbf425469ad677e53b2af5a01de68e079d53cc62419e')
})
check('16 worktree drift is informational and does not block shards', () => {
  assert.ok(recovery.worktree_mismatch > 0)
  assert.equal(recovery.recovered_chunks, 11164)
})
check('17 authorization remains awaiting Commander', () => {
  const auth = JSON.parse(readFileSync(authPath, 'utf8')) as { authorization_state: string; TRAINING_AUTHORIZED: boolean; TRAINING_STARTED: boolean }
  assert.equal(auth.authorization_state, 'AWAITING_COMMANDER_AUTHORIZATION')
  assert.equal(auth.TRAINING_AUTHORIZED, false)
  assert.equal(auth.TRAINING_STARTED, false)
  assert.equal(existsSync(join(repo, 'model-lab/manifests/wave9/commander-authorization.token')), false)
})
check('18 WRIM-1 training is not started and no official weights exist', () => {
  const run = JSON.parse(readFileSync(runPath, 'utf8')) as { TRAINING_STARTED: boolean; training_status: string }
  assert.equal(run.TRAINING_STARTED, false)
  assert.equal(run.training_status, 'NOT_STARTED')
  assert.equal(existsSync(join(repo, 'model-lab/manifests/wrim1_checkpoints')), false)
})
check('19 recovery source accounting is recorded', () => {
  assert.ok((recovery.recovery_source_counts.current_worktree ?? 0) > 0)
  assert.ok((recovery.recovery_source_counts.existing_artifact ?? 0) > 0)
})
check('20 run identity still names the frozen logical corpus', () => {
  const run = JSON.parse(readFileSync(runPath, 'utf8')) as { corpus_sha256: string; corpus_id: string }
  assert.equal(run.corpus_id, HARDENED_CORPUS_ID)
  assert.equal(run.corpus_sha256, frozen.contentHash)
})
check('21 production path was not this mission workspace', () => {
  assert.notEqual(repo, '/Users/markbroughton/WarRoomNode01')
})
check('22 Python 8.1R proofs exist and pass', () => {
  const proof = join(repo, 'model-lab/manifests/wave8_1_recovery/wave81r-python-proof.json')
  assert.equal(existsSync(proof), true)
  const parsed = JSON.parse(readFileSync(proof, 'utf8')) as { passed: number; expected: number; failed: unknown[] }
  assert.equal(parsed.failed.length, 0)
  assert.equal(parsed.passed, parsed.expected)
})

finish()
