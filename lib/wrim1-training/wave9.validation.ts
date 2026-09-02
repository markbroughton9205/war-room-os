import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createValidationHarness } from '@/lib/agi-program/validationHarness'
import { containsHiddenCot } from '@/lib/real-evidence/engine'
import { evaluateWave9Gate } from './gate'
import { canTransitionPromotion } from './promotion'
import { HARDENED_CORPUS_SHA, WRIM0_CHECKPOINT_SHA, WR_TOKENIZER_0_SHA } from './types'

const EXPECTED = 40
const { check, finish } = createValidationHarness('Wave 9 deterministic validation', EXPECTED)
const repo = process.cwd()
const snap = evaluateWave9Gate(repo)
const w9 = join(repo, 'model-lab/manifests/wave9')

check('1 official future run manifest exists', () => {
  assert.equal(existsSync(join(w9, 'WRIM1-RUN-000001.json')), true)
  const run = JSON.parse(readFileSync(join(w9, 'WRIM1-RUN-000001.json'), 'utf8')) as { run_id: string; identity_immutable: boolean }
  assert.equal(run.run_id, 'WRIM1-RUN-000001')
  assert.equal(run.identity_immutable, true)
})
check('2 hardened corpus hash verifies', () => {
  assert.equal(snap.artifacts.corpusSha, HARDENED_CORPUS_SHA)
  assert.equal(snap.gate.hardenedCorpusHash, true)
})
check('3 tokenizer hash verifies', () => {
  assert.equal(snap.artifacts.tokenizerSha, WR_TOKENIZER_0_SHA)
  assert.equal(snap.gate.tokenizerHash, true)
})
check('4 WRIM-0 parent hash verifies', () => {
  assert.equal(snap.artifacts.parentSha, WRIM0_CHECKPOINT_SHA)
  assert.equal(snap.gate.parentHash, true)
})
check('5 complete training config exists', () => {
  const cfg = JSON.parse(readFileSync(join(w9, 'training-config.json'), 'utf8')) as Record<string, unknown>
  assert.equal(cfg.total_steps, 1893)
  assert.equal(cfg.batch_size, 8)
  assert.equal(cfg.context_length, 512)
  assert.equal(cfg.epochs, 2)
  assert.ok(cfg.optimizer)
  assert.ok(cfg.scheduler)
  assert.ok(cfg.mlx_cache_limit_bytes)
})
check('6 authorization gate exists and is fail-closed unless this run is Commander-authorized', () => {
  assert.ok(snap.auth)
  const eventPath = join(w9, 'authorization-event.json')
  if (existsSync(eventPath)) {
    const event = JSON.parse(readFileSync(eventPath, 'utf8')) as { run_id: string; token_value_recorded?: boolean }
    assert.equal(event.run_id, 'WRIM1-RUN-000001')
    assert.equal(event.token_value_recorded, false)
    assert.equal(snap.auth?.TRAINING_AUTHORIZED, true)
    assert.ok(['AUTHORIZED', 'TRAINING', 'COMPLETED', 'FAILED'].includes(snap.auth?.authorization_state ?? ''))
  } else {
    assert.equal(snap.auth?.authorization_state, 'AWAITING_COMMANDER_AUTHORIZATION')
    assert.equal(snap.auth?.TRAINING_AUTHORIZED, false)
    assert.equal(snap.auth?.TRAINING_STARTED, false)
  }
})
check('7 unauthorized official start is blocked', () => {
  assert.equal(snap.gate.unauthorizedStartBlocked, true)
})
check('8 M1 preflight works', () => assert.equal(snap.gate.m1Preflight, true))
check('9 model Safetensors save/load proved', () => {
  assert.ok(snap.python?.results.some(row => row.ok && row.name.includes('Safetensors')))
})
check('10 optimizer state save/load proved', () => {
  assert.ok(snap.python?.results.some(row => row.ok && row.name.includes('optimizer config')))
})
check('11 optimizer CONFIG preserved', () => {
  const cfg = JSON.parse(readFileSync(join(w9, 'optimizer-config.json'), 'utf8')) as { optimizer: string; betas: number[] }
  assert.equal(cfg.optimizer, 'AdamW')
  assert.deepEqual(cfg.betas, [0.9, 0.95])
})
check('12 RNG continuation proved', () => {
  assert.ok(snap.python?.results.some(row => row.ok && row.name.includes('RNG')))
})
check('13 scheduler continuation recorded', () => {
  const proof = JSON.parse(readFileSync(join(w9, 'interruption-equivalence.json'), 'utf8')) as { scheduler_lr_equal: boolean }
  assert.equal(proof.scheduler_lr_equal, true)
})
check('14 dataset cursor resumes', () => {
  const proof = JSON.parse(readFileSync(join(w9, 'interruption-equivalence.json'), 'utf8')) as { dataset_cursor_equal: boolean }
  assert.equal(proof.dataset_cursor_equal, true)
})
check('15 training state resumes', () => {
  assert.ok(snap.python?.results.some(row => row.ok && row.name.includes('training state')))
})
check('16 metrics remain append-only', () => {
  assert.ok(snap.python?.results.some(row => row.ok && row.name.includes('append-only')))
})
check('17 checkpoint bundle hashes verify', () => {
  assert.ok(snap.python?.results.some(row => row.ok && row.name.includes('bundle hashes')))
})
check('18 checkpoint writes are atomic/fail-safe', () => {
  assert.ok(snap.python?.results.some(row => row.ok && row.name.includes('incomplete temp')))
})
check('19 fresh-process reload passes', () => {
  assert.ok(snap.python?.results.some(row => row.ok && row.name.includes('fresh-process')))
})
check('20 interruption-equivalence recorded', () => {
  const path = join(w9, 'interruption-equivalence.json')
  assert.equal(existsSync(path), true)
  const proof = JSON.parse(readFileSync(path, 'utf8')) as { global_step_equal: boolean; dataset_cursor_equal: boolean }
  assert.equal(proof.global_step_equal, true)
  assert.equal(proof.dataset_cursor_equal, true)
})
check('21 corrupted checkpoint tests fail closed', () => {
  const path = join(w9, 'failure-injection.json')
  const cases = JSON.parse(readFileSync(path, 'utf8')) as Array<[string, boolean, string]>
  assert.ok(cases.filter(row => row[1]).length >= 7)
})
check('22 latest known-good recovery works', () => {
  assert.ok(snap.python?.results.some(row => row.ok && row.name.includes('known-good')))
})
check('23 validation pipeline is ready', () => {
  const cfg = JSON.parse(readFileSync(join(w9, 'training-config.json'), 'utf8')) as { validation_cadence_steps: number }
  assert.equal(cfg.validation_cadence_steps, 200)
  assert.ok(snap.postTrainEvalSequence.includes('validation_metrics'))
})
check('24 frozen held-out pipeline is ready', () => {
  assert.equal(existsSync(join(w9, 'held-out-fingerprint.json')), true)
  assert.equal(snap.comparison.length, 10)
})
check('25 WRIM-0 comparison contract exists with WRIM-1 NOT_RUN', () => {
  assert.equal(snap.gate.comparisonContract, true)
  assert.ok(snap.comparison.every(row => row.wrim1Result === 'NOT_RUN'))
  assert.ok(snap.comparison.some(row => row.unsupported && row.wrim0Result === null))
})
check('26 promotion state machine exists', () => {
  assert.equal(canTransitionPromotion('EVALUATED', 'PROMOTION_RECOMMENDED'), true)
  assert.equal(canTransitionPromotion('TRAINING_NOT_STARTED', 'PROMOTED'), false)
  assert.equal(canTransitionPromotion('EVALUATED', 'PROMOTED'), false)
  assert.notEqual(snap.promotionState, 'PROMOTED')
})
check('27 test-only dry run isolated', () => assert.equal(snap.gate.testIsolation, true))
check('28 secret scan passes', () => assert.equal(snap.gate.secretScan, true))
check('29 hidden-CoT scan passes (corrected detector)', () => {
  assert.equal(snap.gate.hiddenCotScan, true)
  assert.equal(containsHiddenCot('PASS F hidden reasoning excluded'), false)
  assert.equal(containsHiddenCot('<think>private</think>'), true)
})
check('30 python proofs used fixed expected denominator', () => {
  assert.notEqual(snap.python?.expected, snap.python?.passed === 0 ? -1 : undefined)
  assert.equal(snap.python?.expected, 22)
  assert.equal(snap.python?.total, 22)
})
check('31 official training remains gated to WRIM1-RUN-000001', () => {
  const eventPath = join(w9, 'authorization-event.json')
  if (!existsSync(eventPath)) {
    assert.equal(snap.trainingStarted, false)
    assert.equal(snap.auth?.TRAINING_STARTED, false)
  } else {
    const event = JSON.parse(readFileSync(eventPath, 'utf8')) as { run_id: string }
    assert.equal(event.run_id, 'WRIM1-RUN-000001')
  }
})
check('32 WRIM-0 artifact still present', () => assert.equal(snap.artifacts.parentOk, true))
check('33 WR-TOKENIZER-0 artifact still present', () => assert.equal(snap.artifacts.tokenizerOk, true))
check('34 hardened corpus identity unchanged', () => assert.equal(snap.artifacts.corpusOk, true))
check('35 production status is not fabricated as true without a check', () => {
  assert.ok(['verified', 'not_checked', 'unknown'].includes(snap.production.status))
  assert.notEqual(snap.production.evidence.length, 0)
})
check('36 active model remains separate', () => {
  assert.equal(snap.activeModelSeparation.promotionIsExplicit, true)
  assert.equal(snap.activeModelSeparation.creatingWrim1DoesNotAutoReplaceRael, true)
})
check('37 future command requires authorization', () => {
  const text = readFileSync(join(w9, 'FUTURE_WRIM1_TRAINING_COMMAND.txt'), 'utf8')
  assert.match(text, /require-authorization-state AUTHORIZED/)
  assert.match(text, /DO NOT EXECUTE/)
})
check('38 software and dirty-tree fingerprints exist', () => {
  assert.equal(existsSync(join(w9, 'software-fingerprint.json')), true)
  assert.equal(existsSync(join(w9, 'dirty-tree-fingerprint.json')), true)
  const dirty = JSON.parse(readFileSync(join(w9, 'dirty-tree-fingerprint.json'), 'utf8')) as { aggregate_sha256: string }
  assert.match(dirty.aggregate_sha256, /^[a-f0-9]{64}$/)
})
check('39 resource plan labels MEASURED Genesis peak separately from DERIVED runtime', () => {
  const plan = JSON.parse(readFileSync(join(w9, 'resource-plan.json'), 'utf8')) as {
    genesis_peak_memory_bytes: { class: string }
    runtime_seconds: { class: string }
    metrics_log_overhead_bytes: { class: string }
  }
  assert.equal(plan.genesis_peak_memory_bytes.class, 'MEASURED')
  assert.equal(plan.runtime_seconds.class, 'DERIVED')
  assert.equal(plan.metrics_log_overhead_bytes.class, 'SPECULATIVE')
})
check('40 Wave 9 gate is fail-closed', () => {
  assert.equal(typeof snap.gate.passed, 'boolean')
  if (!snap.gate.passed) assert.ok(snap.gate.deficiencies.length > 0)
  assert.equal(snap.gate.passed, true)
})

finish()
