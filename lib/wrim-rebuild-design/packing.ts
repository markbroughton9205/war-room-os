import { BOS_ID, CONTEXT_LENGTH, EOS_ID, HISTORICAL_SHUFFLE_PACKING, PACKING_METHOD } from './identity'

/**
 * Contiguous document/unit packing. NEVER permute the 1-D token stream.
 * Historical WRIM1-RUN-000001 epoch_stream per-token shuffle is FORBIDDEN.
 */
export const PACKING_ALGORITHM = {
  id: PACKING_METHOD,
  historicalDefect: HISTORICAL_SHUFFLE_PACKING,
  sequenceLength: CONTEXT_LENGTH,
  steps: [
    '1. Select only approved/eligible training records. Exclude eval-only suites, WR-CORPUS-1 test shard, eval-infra source files, TOOL_USE windows, and WR-CORPUS-ACTIVE unless training_eligibility === ELIGIBLE.',
    '2. Tokenize each independent source unit with frozen WR-TOKENIZER-0 (read-only tokenizer.json). Do not mutate vocab, merges, or special IDs.',
    '3. Wrap every unit: [BOS=1] + token_ids + [EOS=2]. This restores WRIM-0 per-document boundaries that RUN-000001 omitted.',
    '4. Group units into families: WR-CORPUS-0 rehearsal, WR-CORPUS-1 prose, WR-CORPUS-1 code, WR-CORPUS-1 json, WR-CORPUS-1 behavior (non-tool).',
    '5. At epoch start, shuffle UNIT ORDER within each family only (seed DATA_ORDER_SEED). Never shuffle individual tokens.',
    '6. Deficit-interleave 2048-token windows across families according to mix percentages (Recovery-005/006 method). Concatenate windows into one contiguous 1-D stream.',
    '7. Slice non-overlapping contiguous 512-token windows from the stream. Target y[t] = x[t+1] with the next stream token; do not wrap a window across a random jump.',
    '8. If a slice would start immediately after a truncated unit, keep it — EOS already marked the boundary. Do not drop EOS.',
    '9. Validation uses the same wrap+contiguous slice on held-out shards. No token shuffle. No eval-only mix-in.',
  ],
  bosPolicy: {
    token: '<|bos|>',
    id: BOS_ID,
    rule: 'Prepend BOS at the start of every independent source unit.',
    evidence: 'WRIM-0 prepare_wrim0_shards.py wrapped every document with BOS/EOS. RUN-000001 likely concatenated chunks with no wrap (LIKELY_CAUSE).',
  },
  eosPolicy: {
    token: '<|eos|>',
    id: EOS_ID,
    rule: 'Append EOS at the end of every independent source unit. Packed windows may contain multiple EOS markers; that is intended.',
    evidence: 'Recovery-001+ used per-unit EOS wrapping as a reusable mechanism. Keep it.',
  },
  forbidden: [
    'np.random.permutation on the packed 1-D token array',
    'per-token shuffle / epoch_stream shuffle',
    'sampling random tokens into a context window',
    'joining units without EOS',
    'training on overlapping sliding windows that ignore document identity as the primary unit',
  ],
}

export function packingIsContiguous(): boolean {
  return PACKING_ALGORITHM.id === 'CONTIGUOUS_UNIT_PACK_DEFICIT_INTERLEAVE'
}
