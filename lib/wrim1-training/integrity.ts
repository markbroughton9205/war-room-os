import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HARDENED_CORPUS_SHA, WRIM0_CHECKPOINT_SHA, WR_TOKENIZER_0_SHA } from './types'

export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export function verifyImmutableArtifacts(repo = process.cwd()) {
  const tokenizer = join(repo, 'model-lab/manifests/wrim0_tokenizer_v16384/tokenizer.json')
  const parent = join(repo, 'model-lab/manifests/wrim0_checkpoints/checkpoint-final.safetensors')
  const corpus = join(repo, 'model-lab/manifests/wave8_1/corpus-manifest.json')
  const corpus0 = join(repo, 'model-lab/manifests/wrim0_corpus_shards/shard-manifest.json')
  const parsed = JSON.parse(readFileSync(corpus, 'utf8')) as { contentHash: string; corpusId: string }
  return {
    tokenizerOk: existsSync(tokenizer) && sha256File(tokenizer) === WR_TOKENIZER_0_SHA,
    tokenizerSha: existsSync(tokenizer) ? sha256File(tokenizer) : null,
    parentOk: existsSync(parent) && sha256File(parent) === WRIM0_CHECKPOINT_SHA,
    parentSha: existsSync(parent) ? sha256File(parent) : null,
    corpusOk: parsed.contentHash === HARDENED_CORPUS_SHA && parsed.corpusId === 'WR-CORPUS-1-HARDENED-CANDIDATE',
    corpusSha: parsed.contentHash,
    corpus0Exists: existsSync(corpus0),
    expected: { tokenizer: WR_TOKENIZER_0_SHA, parent: WRIM0_CHECKPOINT_SHA, corpus: HARDENED_CORPUS_SHA },
  }
}
