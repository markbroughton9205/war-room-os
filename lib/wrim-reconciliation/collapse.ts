export type CauseClass = 'CONFIRMED_CAUSE' | 'LIKELY_CAUSE' | 'POSSIBLE_CAUSE' | 'RULED_OUT' | 'UNKNOWN'

export type CauseNode = {
  id: string
  class: CauseClass
  statement: string
  evidence: string[]
}

export const WRIM1_RUN_000001_CAUSES: CauseNode[] = [
  {
    id: 'token_shuffle_packing',
    class: 'CONFIRMED_CAUSE',
    statement: 'epoch_stream per-token permutation destroyed locality; next-token CE trained on unrelated neighbors; greedy became punctuation/code unigram mode by step 200.',
    evidence: [
      'docs/WRIM1_RUN_000001_COLLAPSE_DIAGNOSIS_REPORT.md §35, §47 #1',
      'dump wrim1_checkpoints: LAST_HEALTHY=WRIM-0 only; FIRST_COLLAPSED=checkpoint-step-000200 8/8',
      'Same generate path: WRIM-0 greedy not period-argmax; WRIM-1 @200 is',
    ],
  },
  {
    id: 'no_bos_eos_between_chunks',
    class: 'LIKELY_CAUSE',
    statement: 'WR-CORPUS-1 chunks concatenated with no BOS/EOS wrap vs WRIM-0 per-document wrap.',
    evidence: ['collapse diagnosis §13-14, §40-42, #2 STRONGLY_SUPPORTED'],
  },
  {
    id: 'code_token_majority',
    class: 'LIKELY_CAUSE',
    statement: '77.56% code tokens after packing bug made shuffled unigram mode punctuation/syntax.',
    evidence: ['collapse diagnosis §28-32, #3 STRONGLY_SUPPORTED'],
  },
  {
    id: 'continued_pretrain_lr_3e-3',
    class: 'POSSIBLE_CAUSE',
    statement: 'Peak LR 0.003 from a finished WRIM-0 parent is aggressive; same peak used for from-scratch Genesis.',
    evidence: ['collapse diagnosis §21-22, #4 POSSIBLE', 'dump training-state.json current_learning_rate end=3e-4'],
  },
  {
    id: 'no_wr_corpus_0_rehearsal',
    class: 'POSSIBLE_CAUSE',
    statement: 'WRIM-1 shards are WR-CORPUS-1-HARDENED only; WRIM-0 prose prior not rehearsed.',
    evidence: ['collapse diagnosis §36, #5 POSSIBLE'],
  },
  {
    id: 'eval_infra_prompt_leakage',
    class: 'CONFIRMED_CAUSE',
    statement: 'Eval-infra prompt strings present in train shards. Confirmed for eval integrity, not the period-argmax mechanism.',
    evidence: ['collapse diagnosis #6', 'held-out-contamination-recheck.json', 'WRIM1_RUN_000001_EVALUATION_REPORT.md §9'],
  },
  {
    id: 'eval_decoder_bug',
    class: 'RULED_OUT',
    statement: 'Same-runner WRIM-0 is not period-greedy; WRIM-1 is at every official checkpoint.',
    evidence: ['collapse diagnosis §5, RULED_OUT list'],
  },
  {
    id: 'nan_inf_logits',
    class: 'RULED_OUT',
    statement: 'Logits finite; entropy stayed high (~6.5). Mode shift, not dirac collapse.',
    evidence: ['collapse diagnosis §10'],
  },
  {
    id: 'weight_untie_or_parent_not_loaded',
    class: 'RULED_OUT',
    statement: 'Tied logits by construction; parent SHA verified; 164 tensors loaded.',
    evidence: ['collapse diagnosis §15-18, §37'],
  },
  {
    id: 'tokenizer_period_id',
    class: 'RULED_OUT',
    statement: 'WR-TOKENIZER-0 round-trip OK; period id 20; PAD≠EOS.',
    evidence: ['collapse diagnosis §12-14'],
  },
  {
    id: 'grad_norms',
    class: 'UNKNOWN',
    statement: 'Official metrics did not log gradient norms. Exploding-loss guard never fired.',
    evidence: ['collapse diagnosis §23'],
  },
]

export const WRIM1_RUN_000002_CAUSES: CauseNode[] = [
  {
    id: 'not_token_shuffle',
    class: 'RULED_OUT',
    statement: '000002 packing was contiguous deficit-interleave; causal y[t]==x[t+1] passed. Not the 000001 mechanism.',
    evidence: ['docs/WRIM1_RUN_000002_OFFICIAL_TRAINING_REPORT.md §21-24'],
  },
  {
    id: 'capability_curriculum_tool_use',
    class: 'LIKELY_CAUSE',
    statement: 'Official capability mix with TOOL_USE produced 4/13 collapse at step 100 vs WRIM-0 2/13. Recovery-010 (tool windows replaced with rehearsal) completed 250/250 at 3/13.',
    evidence: [
      'WRIM1_RUN_000002 report §33, §51 FAIL vs WRIM-0',
      'docs/WRIM1_1_RECOVERY_010_TOOL_USE_ISOLATION_REPORT.md PASS',
      'Recovery-011 compact tool V2 FAIL at 120/250',
    ],
  },
  {
    id: 'stretched_cosine_502',
    class: 'LIKELY_CAUSE',
    statement: '000002 used 3e-5 with cosine horizon 502. Recovery-008 same mix with 150-step cosine still stopped at 120. Horizon change is not sufficient; mix remains implicated.',
    evidence: ['WRIM1_1_RECOVERY_DESIGN.md What 008 showed', '000002 LR schedule warmup 25 horizon 502'],
  },
  {
    id: 'retention_regression',
    class: 'CONFIRMED_CAUSE',
    statement: 'Held-out CAP-EVAL-0: RETENTION 6/6 → 5/6; no meaningful P0 gain. Promotion bar not met.',
    evidence: ['000002 report §44-46', 'docs/WRIM1_1_PROMOTION_RECOMMENDATION.md'],
  },
  {
    id: 'nan_crash',
    class: 'RULED_OUT',
    statement: 'No Python/MLX crash. Grad L2 0.734 at step 100. Finite throughout.',
    evidence: ['000002 report §31, §50'],
  },
]

export function collapseRootCauseTree() {
  return {
    run_000001: WRIM1_RUN_000001_CAUSES,
    run_000002: WRIM1_RUN_000002_CAUSES,
    note: '000001 and 000002 do not share a confirmed packing cause. 000002 packing was already contiguous.',
  }
}
