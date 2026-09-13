/**
 * #23 WRIM-EVAL-S3-000001 authorship + WRIM-0 baseline freeze validation.
 * Does not train. Does not start STAGE3A/STAGE3B. Does not create an optimizer.
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CURRENT_PRODUCTION_WRIM,
  CURRENT_WRIM_TRAINING,
  FORBIDDEN_ENV_ACTIONS,
  NEXT_AUTHORIZED_PASS,
  PARENT_SHA256,
  QWEN_INTELLIGENCE_CLASS,
  RAEL_STATUS,
  READY_FOR_STAGE3_TRAINING_AUTHORIZATION,
  ROADMAP_22_STATUS,
  ROADMAP_23_STATUS,
  STAGE3_AUTHORIZATION,
  STAGE3_DESIGN_STATUS,
  STAGE3_EXECUTION_READINESS,
  TOKENIZER_SHA256,
  TRAINING_AUTHORIZATION,
} from './identity'
import {
  STAGE3_EVAL_SUITE_ID,
  STAGE3_EVAL_SUITE_STATUS,
  STAGE3_EXECUTION_READINESS as DESIGN_EXECUTION_READINESS,
  STAGE3B_LR_FORMULA,
} from './stage3Design'
import { resolveWrimEnvironmentPaths } from './paths'
import { tryForbiddenEnvAction } from './redTeam'
import { wrimEnvironmentStatusPayload } from './status'

type Check = { id: string; ok: boolean; detail: string }
function check(id: string, ok: boolean, detail = ''): Check {
  return { id, ok, detail: detail || (ok ? 'ok' : 'FAIL') }
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const REQUIRED_CATEGORIES = [
  'LITERARY_PROSE',
  'FACTUAL_PROSE',
  'CODE',
  'JSON_STRUCTURED_OUTPUT',
  'INSTRUCTION_FOLLOWING',
  'LONG_FORM_CONTINUITY',
  'SPECIAL_TOKEN_STABILITY',
] as const
const REQUIRED_ITEM_FIELDS = [
  'suite_id',
  'suite_version',
  'item_id',
  'category',
  'prompt_text',
  'reference_type',
  'generation_mode',
  'max_new_tokens',
  'scoring_functions',
  'hard_integrity_checks',
  'notes',
  'authorship',
  'created_at',
  'content_hash',
] as const

function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function pythonCanonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (value === true) return 'true'
  if (value === false) return 'false'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('non-finite')
    return Number.isInteger(value) ? String(value) : JSON.stringify(value)
  }
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(pythonCanonicalJson).join(',')}]`
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj).sort()
    return `{${keys.map(k => `${JSON.stringify(k)}:${pythonCanonicalJson(obj[k])}`).join(',')}}`
  }
  throw new Error(`unsupported json type ${typeof value}`)
}

function itemContentHash(item: Record<string, unknown>): string {
  return sha256Text(pythonCanonicalJson({
    item_id: item.item_id,
    category: item.category,
    prompt_text: item.prompt_text,
    reference_type: item.reference_type,
    reference_payload: item.reference_payload ?? null,
    generation_mode: item.generation_mode,
    max_new_tokens: item.max_new_tokens,
  }))
}

export async function runStage3EvalBaselineValidation(): Promise<{ passed: number; failed: number; results: Check[] }> {
  const results: Check[] = []
  const evalDir = path.join(repoRoot, 'scripts/wrim-environment/evals')
  const suitePath = path.join(evalDir, 'WRIM-EVAL-S3-000001.json')
  const leakPath = path.join(evalDir, 'WRIM-EVAL-S3-000001.LEAKAGE.json')
  const dupPath = path.join(evalDir, 'WRIM-EVAL-S3-000001.DUPLICATION.json')
  const pointerPath = path.join(evalDir, 'WRIM-EVAL-S3-000001.BASELINE_POINTER.json')
  const designPath = path.join(repoRoot, 'scripts/wrim-environment/WRIM-EVAL-S3-000001.design.json')
  const designMdPath = path.join(repoRoot, 'scripts/wrim-environment/STAGE3_DESIGN.md')
  const evalPyPath = path.join(repoRoot, 'scripts/wrim-environment/stage3_eval_baseline.py')
  const itemsPyPath = path.join(repoRoot, 'scripts/wrim-environment/stage3_eval_items.py')
  const live = resolveWrimEnvironmentPaths()
  const baselinePath = live.stage3EvalBaselinePath
  const sidecarPath = path.join(path.dirname(baselinePath), 'wrim-eval-s3-000001-wrim0-baseline.SHA256.json')

  const suite = JSON.parse(fs.readFileSync(suitePath, 'utf8')) as {
    suite_id?: string
    suite_version?: string
    status?: string
    n_items?: number
    n_categories?: number
    items_per_category?: number
    categories?: string[]
    suite_hash?: string
    items?: Array<Record<string, unknown>>
  }
  const leak = JSON.parse(fs.readFileSync(leakPath, 'utf8')) as { ok?: boolean; n_items?: number; blocking_item_ids?: unknown[] }
  const dup = JSON.parse(fs.readFileSync(dupPath, 'utf8')) as {
    ok?: boolean
    blocking_pairs?: unknown[]
    poor_category_diversity?: unknown[]
  }
  const pointer = JSON.parse(fs.readFileSync(pointerPath, 'utf8')) as {
    ok?: boolean
    suite_id?: string
    suite_hash?: string
    baseline_sha256?: string
    optimizer_steps?: number
  }
  const design = JSON.parse(fs.readFileSync(designPath, 'utf8')) as {
    status?: string
    prompts_authored?: boolean
    wrim0_baseline_frozen?: boolean
    target_item_count?: number
  }
  const designMd = fs.readFileSync(designMdPath, 'utf8')
  const evalPy = fs.readFileSync(evalPyPath, 'utf8')
  const itemsPy = fs.existsSync(itemsPyPath) ? fs.readFileSync(itemsPyPath, 'utf8') : ''
  const items = suite.items ?? []
  const ids = items.map(it => String(it.item_id ?? ''))
  const uniqueIds = new Set(ids)
  const catCounts: Record<string, number> = {}
  for (const it of items) {
    const cat = String(it.category ?? '')
    catCounts[cat] = (catCounts[cat] ?? 0) + 1
  }
  const missingFields = items.flatMap((it, i) => {
    const miss = REQUIRED_ITEM_FIELDS.filter(f => it[f] === undefined || it[f] === null || it[f] === '')
    return miss.length ? [`${ids[i] || i}:${miss.join(',')}`] : []
  })
  const hashMismatches = items.filter(it => String(it.content_hash ?? '') !== itemContentHash(it)).map(it => String(it.item_id))
  const recomputedSuiteHash = sha256Text(pythonCanonicalJson({
    suite_id: suite.suite_id,
    suite_version: suite.suite_version,
    items,
  }))
  const baselinePresent = fs.existsSync(baselinePath)
  const baseline = baselinePresent
    ? (JSON.parse(fs.readFileSync(baselinePath, 'utf8')) as Record<string, unknown>)
    : null
  const sidecar = fs.existsSync(sidecarPath)
    ? (JSON.parse(fs.readFileSync(sidecarPath, 'utf8')) as Record<string, unknown>)
    : null
  const baselineText = baselinePresent
    ? fs.readFileSync(baselinePath, 'utf8').replace(/\r\n/g, '\n')
    : ''
  const recomputedBaselineSha = baselinePresent ? sha256Text(baselineText) : ''
  const selfKl = (baseline?.self_kl ?? {}) as { mean?: number; max?: number; pass?: boolean; tolerance?: number }
  const status = wrimEnvironmentStatusPayload()

  results.push(check('1_suite_id', suite.suite_id === 'WRIM-EVAL-S3-000001' && STAGE3_EVAL_SUITE_ID === 'WRIM-EVAL-S3-000001', String(suite.suite_id)))
  results.push(check('2_item_count', suite.n_items === 35 && items.length === 35, String(items.length)))
  results.push(check('3_category_count', suite.n_categories === 7 && suite.items_per_category === 5 && JSON.stringify(suite.categories) === JSON.stringify(REQUIRED_CATEGORIES), String(suite.n_categories)))
  results.push(check('4_five_per_category', REQUIRED_CATEGORIES.every(c => catCounts[c] === 5) && Object.keys(catCounts).length === 7, JSON.stringify(catCounts)))
  results.push(check('5_unique_ids', uniqueIds.size === 35 && ids.every(Boolean), String(uniqueIds.size)))
  results.push(check('6_item_schema', missingFields.length === 0, missingFields.slice(0, 8).join(';') || 'fields present'))
  results.push(check('7_item_hashes', items.every(it => /^[0-9a-f]{64}$/.test(String(it.content_hash ?? ''))) && hashMismatches.length === 0, hashMismatches.join(',') || 'content hashes match'))
  results.push(check('8_suite_hash', typeof suite.suite_hash === 'string' && suite.suite_hash.length === 64 && suite.suite_hash === recomputedSuiteHash, String(suite.suite_hash)))
  results.push(check('9_leakage_pass', leak.ok === true && Array.isArray(leak.blocking_item_ids) && leak.blocking_item_ids.length === 0 && leak.n_items === 35, String(leak.ok)))
  results.push(check('10_duplication_pass', dup.ok === true && Array.isArray(dup.blocking_pairs) && dup.blocking_pairs.length === 0 && Array.isArray(dup.poor_category_diversity) && dup.poor_category_diversity.length === 0, String(dup.ok)))
  results.push(check('11_parent_sha', PARENT_SHA256 === 'd1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015' && baseline?.parent_sha256 === PARENT_SHA256, PARENT_SHA256))
  results.push(check('12_tokenizer_sha', TOKENIZER_SHA256 === '47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7' && baseline?.tokenizer_sha256 === TOKENIZER_SHA256, TOKENIZER_SHA256))
  results.push(check('13_baseline_exists', baselinePresent && baseline?.ok === true && baseline?.kind === 'WRIM0_STAGE3_SUITE_BASELINE', baselinePath))
  results.push(check(
    '14_baseline_suite_hash',
    baseline?.suite_hash === suite.suite_hash
      && pointer.suite_hash === suite.suite_hash
      && pointer.suite_id === 'WRIM-EVAL-S3-000001',
    String(pointer.suite_hash),
  ))
  results.push(check(
    '15_self_kl',
    selfKl.pass === true && selfKl.mean === 0 && selfKl.max === 0 && Number(selfKl.tolerance) === 1e-5,
    JSON.stringify(selfKl),
  ))
  results.push(check(
    '16_optimizer_steps_zero',
    baseline?.optimizer_steps === 0 && pointer.optimizer_steps === 0 && sidecar?.optimizer_steps === 0,
    String(baseline?.optimizer_steps),
  ))
  results.push(check(
    '17_eval_baseline_no_adamw',
    !evalPy.includes('AdamW') && !itemsPy.includes('AdamW') && evalPy.includes('ZERO optimizer'),
    'eval freeze still zero-optimizer',
  ))
  results.push(check(
    '18_auth_off',
    (STAGE3_AUTHORIZATION === 'NO' || STAGE3_AUTHORIZATION === 'NO_PENDING_REVIEW')
      && TRAINING_AUTHORIZATION === 'OFF'
      && READY_FOR_STAGE3_TRAINING_AUTHORIZATION === false
      && CURRENT_WRIM_TRAINING === 'NOT_RUNNING'
      && baseline?.stage3_authorization === 'NO'
      && baseline?.training_authorization === 'OFF',
    STAGE3_AUTHORIZATION,
  ))
  results.push(check('19_qwen_unchanged', QWEN_INTELLIGENCE_CLASS === 'THIRD_PARTY_MODEL_RUNNING_LOCALLY' && CURRENT_PRODUCTION_WRIM === 'NOT_IMPLEMENTED', QWEN_INTELLIGENCE_CLASS))
  results.push(check('20_rael_not_implemented', RAEL_STATUS === 'NOT_IMPLEMENTED', RAEL_STATUS))
  results.push(check('21_22_closed', ROADMAP_22_STATUS === 'CLOSED', ROADMAP_22_STATUS))
  results.push(check('22_23_active', ROADMAP_23_STATUS === 'ACTIVE', ROADMAP_23_STATUS))
  results.push(check(
    '23_baseline_sha',
    typeof pointer.baseline_sha256 === 'string'
      && pointer.baseline_sha256.length === 64
      && pointer.baseline_sha256 === recomputedBaselineSha
      && sidecar?.baseline_sha256 === pointer.baseline_sha256,
    String(pointer.baseline_sha256),
  ))
  results.push(check(
    '24_val_baselines_preserved',
    baseline?.preserved_val_loss_corpus0 === 8.890125 && baseline?.preserved_val_loss_corpus1 === 7.971308,
    `${String(baseline?.preserved_val_loss_corpus0)}/${String(baseline?.preserved_val_loss_corpus1)}`,
  ))
  results.push(check(
    '25_status_truth',
    STAGE3_DESIGN_STATUS === 'ACCEPTED_FOR_PREPARATION'
      && STAGE3_EVAL_SUITE_STATUS === 'AUTHORED_FROZEN'
      && design.status === 'AUTHORED_FROZEN'
      && design.prompts_authored === true
      && design.wrim0_baseline_frozen === true
      && design.target_item_count === 35
      && STAGE3_EXECUTION_READINESS === true
      && DESIGN_EXECUTION_READINESS === true
      && (NEXT_AUTHORIZED_PASS === 'STAGE3A_COMMANDER_AUTHORIZATION_REVIEW' || NEXT_AUTHORIZED_PASS === 'STAGE3A_COMMANDER_REVIEW' || NEXT_AUTHORIZED_PASS === 'STAGE3A_REVIEW_COMPLETE' || NEXT_AUTHORIZED_PASS === 'STAGE3A_CANDIDATE_SELECTION_COMPLETE')
      && status.train_button === false,
    NEXT_AUTHORIZED_PASS,
  ))
  results.push(check(
    '26_stage3b_lr_formula',
    STAGE3B_LR_FORMULA === 'FROZEN_FOR_REVIEW'
      && designMd.includes('FROZEN_FOR_REVIEW'),
    STAGE3B_LR_FORMULA,
  ))
  results.push(check('27_no_stage3_start', tryForbiddenEnvAction('START_STAGE_3').denied && FORBIDDEN_ENV_ACTIONS.includes('START_STAGE_3'), 'denied'))
  results.push(check('28_compat_overlays', evalPy.includes('COMPATIBILITY_ONLY') && designMd.includes('COMPATIBILITY_ONLY') && (baseline?.cap_eval_0 as { primary?: boolean } | undefined)?.primary === false, 'CAP-EVAL-0 overlay'))
  results.push(check(
    '29_review_bands_unchanged',
    designMd.includes('≈ **0.105**') && designMd.includes('≈ **0.018**') && designMd.includes('8.890125') && designMd.includes('7.971308'),
    'review bands preserved',
  ))
  results.push(check(
    '30_no_repo_continuation_dump',
    !JSON.stringify(suite).includes('"new_ids"') && !fs.existsSync(path.join(repoRoot, 'scripts/wrim-environment/evals/wrim-eval-s3-000001-wrim0-baseline.json')),
    'AppData baseline not in repo',
  ))
  results.push(check('31_suite_status', suite.status === 'AUTHORED_FROZEN', String(suite.status)))
  results.push(check('32_production_wrim', CURRENT_PRODUCTION_WRIM === 'NOT_IMPLEMENTED', CURRENT_PRODUCTION_WRIM))
  results.push(check('33_baseline_item_count', Array.isArray(baseline?.items) && (baseline?.items as unknown[]).length === 35, String((baseline?.items as unknown[] | undefined)?.length)))

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => r.ok === false).length
  return { passed, failed, results }
}

async function main() {
  const out = await runStage3EvalBaselineValidation()
  console.log(JSON.stringify(out, null, 2))
  if (out.failed > 0) process.exit(1)
}

const isDirect = process.argv[1] && path.normalize(process.argv[1]) === path.normalize(fileURLToPath(import.meta.url))
if (isDirect) {
  void main()
}
