/**
 * Qwen RAG over WR-CORPUS. Retrieval + third-party local model. NOT training. NOT WRIM. NOT Ra'el.
 */
import { runLocalModelInference } from '@/lib/sovereign-runtime/local-model'
import { GENESIS_GENERAL_MODEL_ID } from '@/lib/sovereign-runtime/local-model/types'
import { QWEN_INTELLIGENCE_CLASS } from './identity'
import { queryWrCorpus } from './query'
import { WrCorpusPolicyError } from './hashes'

export type WrCorpusRagResult = {
  query: string
  intelligence_class: typeof QWEN_INTELLIGENCE_CLASS
  weight_mutation: false
  training: false
  sources: Array<{ record_id: string; corpus_version: string; title: string | null; snippet: string }>
  answer: string | null
  model: string | null
  model_ok: boolean
  error: string | null
}

export async function ragFromWrCorpus(input: {
  query: string
  ownerUserId: string
  dataDirOverride?: string | null
  skipModel?: boolean
}): Promise<WrCorpusRagResult> {
  const { lexical, semantic } = queryWrCorpus({
    query: input.query,
    ownerUserId: input.ownerUserId,
    dataDirOverride: input.dataDirOverride,
    limit: 6,
  })
  const merged = [...lexical, ...semantic].filter(
    (hit, idx, arr) => arr.findIndex(h => h.record_id === hit.record_id) === idx,
  )
  const sources = merged.slice(0, 6).map(hit => ({
    record_id: hit.record_id,
    corpus_version: hit.corpus_version,
    title: hit.title,
    snippet: hit.text.slice(0, 500),
  }))
  const evidence = sources
    .map((s, i) => `[${i + 1}] (${s.corpus_version}) ${s.title ?? s.record_id}\n${s.snippet}`)
    .join('\n\n')
  const prompt = `Answer using only the WR-CORPUS evidence. Cite source numbers. If evidence is insufficient, say so.\n\nQuestion: ${input.query}\n\nEvidence:\n${evidence}`

  if (input.skipModel) {
    return {
      query: input.query,
      intelligence_class: QWEN_INTELLIGENCE_CLASS,
      weight_mutation: false,
      training: false,
      sources,
      answer: sources.length ? `Evidence-only (model skipped). See sources ${sources.map((_, i) => i + 1).join(', ')}.` : null,
      model: null,
      model_ok: false,
      error: null,
    }
  }

  const infer = await runLocalModelInference({
    prompt,
    system:
      'You are Qwen running locally as THIRD_PARTY_MODEL_RUNNING_LOCALLY. You are not WRIM, not Ra\'el, and this is RAG not training.',
    model: GENESIS_GENERAL_MODEL_ID,
    ownerUserId: input.ownerUserId,
    resourceOwnerUserId: input.ownerUserId,
    claimIsWrim: false,
    claimIsRael: false,
  })
  return {
    query: input.query,
    intelligence_class: QWEN_INTELLIGENCE_CLASS,
    weight_mutation: false,
    training: false,
    sources,
    answer: infer.content,
    model: infer.actual_model,
    model_ok: infer.ok,
    error: infer.ok ? null : infer.error,
  }
}

export function denyWeightMutation(): never {
  throw new WrCorpusPolicyError('WEIGHT_MUTATION_DENIED', 'WR-CORPUS RAG cannot mutate model weights.')
}
