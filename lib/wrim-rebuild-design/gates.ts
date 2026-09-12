/**
 * Loss alone is insufficient. WRIM1-RUN-000001 collapsed while train loss improved.
 */
export const COLLAPSE_MONITORING = {
  everyEvalInterval: [
    'train loss',
    'validation loss',
    'mean next-token entropy',
    'max token run (greedy)',
    'unique-token ratio (greedy)',
    'period-token probability (id 20)',
    'generation diversity across DIAGNOSTIC-0 prompts',
    'special-token loops (<|tokenizer|> / repeated specials)',
    'JSON validity on structured probes',
    'retention probes vs WRIM-0 step-0 snapshot',
  ],
}

export const PERIOD_COLLAPSE_SENTINEL = {
  id: 'PERIOD_COLLAPSE_SENTINEL',
  historicalFailure: 'WRIM1-RUN-000001 greedy period-argmax from checkpoint-step-000200 while CE still fell.',
  stopIfAny: [
    'On ≥3 DIAGNOSTIC-0 greedy prompts, argmax first token is period (id 20) and stays punctuation-dominated for ≥8 tokens',
    'unique-token ratio on greedy 32-token samples falls below 50% of the WRIM-0 step-0 ratio for two consecutive evals',
    'max token run ≥ max(6, n/3) on a majority of diagnostic prompts',
    'special-token loop detected (same special id repeating ≥4 times)',
  ],
  rule: 'STOP immediately. Do not continue because train loss is decreasing. Verdict = REJECTED / COLLAPSED. Do not auto-resume.',
}

export const RETENTION_GATE = {
  baseline: 'WRIM-0 checkpoint-final at Stage 0 / step-0 of each run',
  wrim0Caps: {
    diagnosticCollapsedFloor: '2/13 class historically; treat step-0 measurement as the live floor',
    capEval0: '18/86 historically',
    retentionFamily: '6/6 historically',
  },
  stopIf: [
    'CAP-EVAL-0 retention family drops by ≥1 vs live WRIM-0 step-0 (historical 6/6→5/6 already failed promotion)',
    'DIAGNOSTIC-0 collapsed probes exceed live WRIM-0 floor + 1 for two consecutive evals (official: STOP at +2 immediately)',
    'JSON-validity probes all fail after having passed at step-0',
  ],
  stage2WarnAt: 'collapsed probes = floor+1 or retention -1',
  stage2StopAt: 'collapsed probes ≥ floor+2 or retention -2',
  stage3StopAt: 'collapsed probes ≥ floor+2 OR retention family -1 OR period sentinel',
}

export const PROMOTION_GATES = {
  parentFloor: 'WRIM-0',
  allRequired: [
    'NO collapse (period sentinel never fired; diagnostic probes ≤ floor+1 at end)',
    'NO checkpoint corruption (reload SHA matches save; finite tensors; 164 model tensors)',
    'acceptable validation improvement vs step-0 parent on contiguous val windows (val loss down or flat within 5% without collapse)',
    'retention preserved (retention family ≥ WRIM-0 live score; no -1)',
    'generation diversity preserved or improved vs WRIM-0 unique-token ratio',
    'clean held-out eval (CAP-EVAL-0 not worse; Wave 8.1 not used)',
    'structured-output / JSON probes not worse than WRIM-0',
    'no tool-loop regression (TOOL-EVAL still excluded from train; no new special-token loops)',
    'stable inference (reload equals in-memory greedy on smoke prompt)',
  ],
  rejectIfOutperformsOnOneMetricOnly: true,
  forbiddenReasons: [
    'larger than WRIM-0',
    'trained longer',
    'lower train loss while greedy collapsed',
    'TEST_ONLY recovery weights',
    'collapsed RUN-000001/000002 parents',
  ],
}
