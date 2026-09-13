/**
 * #23 WRIM1-RUN-000003 Stage 3 design validation.
 * Does not train. Does not start Stage 3.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CURRENT_PRODUCTION_WRIM,
  CURRENT_WRIM_TRAINING,
  FORBIDDEN_ENV_ACTIONS,
  NEXT_AUTHORIZED_PASS,
  PARENT_SHA256,
  RAEL_STATUS,
  READY_FOR_STAGE3_TRAINING_AUTHORIZATION,
  ROADMAP_22_STATUS,
  ROADMAP_23_STATUS,
  STAGE3_AUTHORIZATION,
  STAGE3_DESIGN_STATUS,
  STAGE3_EXECUTION_READINESS,
  STAGE3B_EXECUTION_READINESS,
  STAGE3_RUN_ID,
  TOKENIZER_SHA256,
  TRAINING_AUTHORIZATION,
} from './identity'
import {
  STAGE3_ARCHITECTURE_CLASS,
  STAGE3_BLIND_1500_REJECTED,
  STAGE3_DESIGN_DECISION,
  STAGE3_EVAL_SUITE_STATUS,
  STAGE3_LOGIT_ENSEMBLE,
  STAGE3_PEAK_LR,
  STAGE3_REHEARSAL_POLICY,
  STAGE3_RUN_ID as DESIGN_RUN_ID,
  STAGE3_TOOL_USE_SHARE,
  STAGE3A_STEPS,
  STAGE3B_LR_FORMULA,
  STAGE3A_EXECUTION_READINESS as DESIGN_STAGE3A_READY,
  STAGE3B_EXECUTION_READINESS as DESIGN_STAGE3B_READY,
} from './stage3Design'
import { tryForbiddenEnvAction } from './redTeam'

type Check = { id: string; ok: boolean; detail: string }
function check(id: string, ok: boolean, detail = ''): Check {
  return { id, ok, detail: detail || (ok ? 'ok' : 'FAIL') }
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

export async function runStage3DesignValidation(): Promise<{ passed: number; failed: number; results: Check[] }> {
  const results: Check[] = []
  const designMd = fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/STAGE3_DESIGN.md'), 'utf8')
  const suite = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/WRIM-EVAL-S3-000001.design.json'), 'utf8'),
  ) as { status?: string; target_item_count?: number; prompts_authored?: boolean; wrim0_baseline_frozen?: boolean }
  const hasTrainer = fs.existsSync(path.join(repoRoot, 'scripts/wrim-environment/stage3_train.py'))
    || fs.existsSync(path.join(repoRoot, 'scripts/run-wrim-stage3.mjs'))

  results.push(check('1_run_id', STAGE3_RUN_ID === 'WRIM1-RUN-000003' && DESIGN_RUN_ID === STAGE3_RUN_ID, STAGE3_RUN_ID))
  results.push(check('2_decision', STAGE3_DESIGN_STATUS === 'ACCEPTED_FOR_PREPARATION' && STAGE3_DESIGN_DECISION === STAGE3_DESIGN_STATUS, STAGE3_DESIGN_STATUS))
  results.push(check('3_auth_no', (STAGE3_AUTHORIZATION === 'NO' || STAGE3_AUTHORIZATION === 'NO_PENDING_REVIEW') && READY_FOR_STAGE3_TRAINING_AUTHORIZATION === false, STAGE3_AUTHORIZATION))
  results.push(check('4_execution_review_ready', STAGE3_EXECUTION_READINESS === true && DESIGN_STAGE3A_READY === true && STAGE3B_EXECUTION_READINESS === false && DESIGN_STAGE3B_READY === false, String(DESIGN_STAGE3A_READY)))
  results.push(check('5_training_off', TRAINING_AUTHORIZATION === 'OFF' && CURRENT_WRIM_TRAINING === 'NOT_RUNNING', TRAINING_AUTHORIZATION))
  const trainPy = hasTrainer ? fs.readFileSync(path.join(repoRoot, 'scripts/wrim-environment/stage3_train.py'), 'utf8') : ''
  results.push(check('6_trainer_gated', hasTrainer === true && trainPy.includes('TRAINING_DENIED') && trainPy.includes('authorization_gate') && (STAGE3_AUTHORIZATION === 'NO' || STAGE3_AUTHORIZATION === 'NO_PENDING_REVIEW'), 'trainer implemented, gated'))
  results.push(check('7_parent', PARENT_SHA256.startsWith('d1affa599ff967313b') && designMd.includes(PARENT_SHA256), 'WRIM-0'))
  results.push(check('8_tokenizer', TOKENIZER_SHA256.startsWith('47ed32ce61974e2c3b') && designMd.includes(TOKENIZER_SHA256), 'WR-TOKENIZER-0'))
  results.push(check('9_lr', STAGE3_PEAK_LR === 2e-5 && designMd.includes('peak 2e-5') && designMd.includes('2e-5'), '2e-5'))
  results.push(check('10_rehearsal', STAGE3_REHEARSAL_POLICY === 'NATURAL_BASELINE' && designMd.includes('NATURAL_BASELINE'), STAGE3_REHEARSAL_POLICY))
  results.push(check('11_balanced_not_proven', designMd.includes('**not** proven superior'), 'BALANCED not proven'))
  results.push(check('12_staged', STAGE3A_STEPS === 50 && designMd.includes('STAGE3A') && designMd.includes('STAGE3B') && STAGE3_BLIND_1500_REJECTED === true, 'staged not blind 1500'))
  results.push(check('13_1500_rejected', designMd.includes('**not** supported by Phase 2'), '1500 rejected'))
  results.push(check('14_suite_authored', suite.status === 'AUTHORED_FROZEN' && STAGE3_EVAL_SUITE_STATUS === 'AUTHORED_FROZEN' && suite.prompts_authored === true, String(suite.status)))
  results.push(check('15_suite_size', suite.target_item_count === 35 && suite.wrim0_baseline_frozen === true, String(suite.target_item_count)))
  results.push(check('16_binary_compat', designMd.includes('COMPATIBILITY_ONLY'), 'historical binary compatibility'))
  results.push(check('17_no_logit', STAGE3_LOGIT_ENSEMBLE === false && designMd.includes('No logit ensembling'), 'no logit ensemble'))
  results.push(check('18_tool_use', STAGE3_TOOL_USE_SHARE === 0 && designMd.includes('TOOL_USE 0%'), '0%'))
  results.push(check('19_dense', STAGE3_ARCHITECTURE_CLASS === 'dense' && !designMd.toLowerCase().includes('sparse expert implemented'), 'dense'))
  results.push(check('20_no_stage3_start', tryForbiddenEnvAction('START_STAGE_3').denied && FORBIDDEN_ENV_ACTIONS.includes('START_STAGE_3'), 'denied'))
  results.push(check('21_qwen', CURRENT_PRODUCTION_WRIM === 'NOT_IMPLEMENTED', CURRENT_PRODUCTION_WRIM))
  results.push(check('22_rael', RAEL_STATUS === 'NOT_IMPLEMENTED', RAEL_STATUS))
  results.push(check('23_22_closed', ROADMAP_22_STATUS === 'CLOSED', ROADMAP_22_STATUS))
  results.push(check('24_23_active', ROADMAP_23_STATUS === 'ACTIVE', ROADMAP_23_STATUS))
  results.push(check('25_next_pass', NEXT_AUTHORIZED_PASS === 'STAGE3A_COMMANDER_AUTHORIZATION_REVIEW' || NEXT_AUTHORIZED_PASS === 'STAGE3A_COMMANDER_REVIEW' || NEXT_AUTHORIZED_PASS === 'STAGE3A_REVIEW_COMPLETE', NEXT_AUTHORIZED_PASS))
  results.push(check('26_no_delete', designMd.includes('Delete nothing now'), 'retention plan only'))
  results.push(check('27_stage3b_lr_formula', STAGE3B_LR_FORMULA === 'FROZEN_FOR_REVIEW' && designMd.includes('STAGE3B_LR_FORMULA') && designMd.includes('FROZEN_FOR_REVIEW'), STAGE3B_LR_FORMULA))
  results.push(check('28_training_still_off', TRAINING_AUTHORIZATION === 'OFF' && designMd.includes('remains **OFF**') && designMd.includes('STAGE3_AUTHORIZATION = NO'), TRAINING_AUTHORIZATION))

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => r.ok === false).length
  return { passed, failed, results }
}

async function main() {
  const out = await runStage3DesignValidation()
  console.log(JSON.stringify(out, null, 2))
  if (out.failed > 0) process.exit(1)
}

const isDirect = process.argv[1] && path.normalize(process.argv[1]) === path.normalize(fileURLToPath(import.meta.url))
if (isDirect) {
  void main()
}
