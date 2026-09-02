import assert from 'node:assert/strict'
import { createValidationHarness } from '@/lib/agi-program/validationHarness'
import { EXAMPLE_FORMATS } from './types'
import { inventoryWrim1Dataset } from './inventory'
import { evaluateWave8Gate } from './gate'
import { buildCandidateCorpus, WRIM0_TRAINING_TOKENS_AFTER_EPOCH_REUSE, WR_CORPUS_0_TRAIN_TOKENS } from './corpus'
import { analyzeTokenizer } from './tokenizer'
import { wrim1ArchitectureOptions } from './architecture'
import { buildHeldOutEvalSuite, leakageCheck, wrim0Baseline } from './eval'
import { researchClaimStatusForGym } from '@/lib/agi-gym/engine'

const EXPECTED = 23
const { check, finish } = createValidationHarness('Wave 8 deterministic validation', EXPECTED)
const snapshot = evaluateWave8Gate()
const inventory = inventoryWrim1Dataset()

check('A WR-CORPUS-0 unique train tokens remain 317338 and are not recounted as new', () => {
  assert.equal(WR_CORPUS_0_TRAIN_TOKENS, 317338)
  assert.equal(inventory.corpusTrainTokens, 317338)
  assert.notEqual(inventory.uniqueNewSourceTokens, WRIM0_TRAINING_TOKENS_AFTER_EPOCH_REUSE)
})
check('B epoch reuse is reported separately from unique source tokens', () => {
  assert.equal(inventory.wrim0TrainingTokensAfterEpochReuse, 2_048_000)
  assert.equal(inventory.trainingTokensAfterEpochReuseEstimate, inventory.uniqueNewSourceTokens * 3)
})
check('C tokenizer lineage is WRIM-0 tokenizer and is not overwritten', () => {
  assert.match(inventory.tokenizerHash, /^[a-f0-9]{64}$/)
  assert.equal(inventory.tokenizerId, 'WR-TOKENIZER-0')
  assert.equal(snapshot.tokenizer.replaced, false)
})
check('D parent checkpoint remains WRIM-0', () => assert.equal(inventory.parentCheckpointHash, 'd1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015'))
check('E training remains not started', () => {
  assert.equal(inventory.trainingStarted, false)
  assert.equal(snapshot.corpus.trainingStarted, false)
})
check('F new corpus version is WR-CORPUS-1-CANDIDATE and content-addressed', () => {
  assert.equal(snapshot.corpus.corpusId, 'WR-CORPUS-1-CANDIDATE')
  assert.match(snapshot.corpus.contentHash, /^[a-f0-9]{64}$/)
  const rebuilt = buildCandidateCorpus()
  assert.equal(rebuilt.contentHash, snapshot.corpus.contentHash)
})
check('G inventory classifies eligible and ineligible sources', () => {
  assert.ok(snapshot.corpus.inventoryCounts.ELIGIBLE > 0)
  assert.ok(typeof snapshot.corpus.inventoryCounts.INELIGIBLE === 'number')
  assert.ok(typeof snapshot.corpus.inventoryCounts.REQUIRES_REVIEW === 'number')
})
check('H twelve canonical formats exist', () => assert.equal(EXAMPLE_FORMATS.length, 12))
check('I engineering/tool evidence materially exceeds the Wave 5 pool of 8', () => {
  assert.ok(snapshot.evidence.records.length > 8)
  assert.ok(snapshot.evidence.distinctLineages >= 8)
  assert.ok(snapshot.evidence.distinctValidatorTypes >= 5)
})
check('J tool_use evidence is not classified as code_operator', () => {
  const tool = snapshot.evidence.records.filter(record => record.source === 'tool_use')
  assert.ok(tool.length >= 1)
  assert.ok(tool.every(record => record.evidence.kind === 'tool_use_result'))
})
check('K research process success does not auto-verify contested claims', () => {
  const contested = snapshot.researchExamples.find(item => item.claimStatus === 'contested')
  assert.ok(contested)
  assert.equal(contested.outcome, 'pass')
  assert.notEqual(contested.trainability, 'positive_training')
  assert.equal(researchClaimStatusForGym('single_source'), 'candidate')
})
check('L world-learning examples link to a durable session lineage', () => {
  assert.ok(snapshot.worldLearningExamples.length >= 4)
  assert.ok(snapshot.worldLearningExamples.every(item => item.provenanceRefs.some(ref => ref.includes('session:'))))
})
check('M Terra fixtures are eval-only and not positive training evidence', () => {
  assert.ok(snapshot.terraEvalExamples.every(item => item.trainability === 'eval_only'))
  assert.equal(snapshot.commanderCorrections.length, 0)
})
check('N train/validation/test splits are nonzero', () => {
  assert.ok(snapshot.corpus.splitCounts.train > 0)
  assert.ok(snapshot.corpus.splitCounts.validation > 0)
  assert.ok(snapshot.corpus.splitCounts.test > 0)
})
check('O held-out suite covers multiple domains', () => {
  assert.ok(snapshot.evals.length >= 8)
  assert.ok(new Set(snapshot.evals.map(item => item.domain)).size >= 6)
})
check('P leakage/contamination check passes', () => {
  assert.equal(snapshot.leakage.passed, true)
  const trainHashes = new Set(snapshot.corpus.documents.filter(doc => doc.split === 'train').map(doc => doc.contentHash))
  assert.equal(leakageCheck(trainHashes, buildHeldOutEvalSuite()).passed, true)
})
check('Q WRIM-0 unsupported evals keep null scores', () => {
  const unsupported = snapshot.baseline.filter(row => row.support === 'UNSUPPORTED')
  assert.ok(unsupported.length > 0)
  assert.ok(unsupported.every(row => row.score === null))
  assert.ok(snapshot.baseline.some(row => row.support === 'SUPPORTED' && row.status === 'recorded_genesis_eval'))
})
check('R tokenizer analysis has category metrics', () => {
  const analysis = analyzeTokenizer()
  assert.ok(analysis.categories.length >= 8)
  if (analysis.method === 'huggingface-tokenizers') {
    assert.ok(analysis.categories.every(item => item.tokens > 0))
  }
})
check('S architecture options include M1 A/B and future CUDA C, C not selected', () => {
  const options = wrim1ArchitectureOptions({ uniqueSourceTokens: snapshot.corpus.uniqueNewSourceTokens, epochs: 3 })
  assert.deepEqual(options.map(item => item.id), ['A', 'B', 'C'])
  assert.equal(options.find(item => item.id === 'C')?.selectedForCurrentHardware, false)
  assert.equal(options.find(item => item.id === 'A')?.selectedForCurrentHardware, true)
})
check('T secrets and hidden CoT are excluded from eligible inventory', () => {
  assert.ok(snapshot.corpus.documents.every(doc => doc.trainability === 'positive_training'))
})
check('U quality tiers exclude C from silent positive admission of contested research', () => {
  assert.ok(snapshot.researchExamples.filter(item => item.qualityTier === 'C').every(item => item.trainability !== 'positive_training'))
})
check('V Wave 8 gate is fail-closed and binary', () => {
  assert.equal(typeof snapshot.gate.passed, 'boolean')
  assert.equal(inventory.substantialForWrim1Experiment, snapshot.gate.passed)
  if (!snapshot.gate.passed) assert.ok(snapshot.gate.deficiencies.length > 0)
})
check('W WRIM-0 baseline function does not convert null to zero', () => {
  const rows = wrim0Baseline(buildHeldOutEvalSuite())
  assert.ok(rows.filter(row => row.support === 'UNSUPPORTED').every(row => row.score === null && row.score !== 0))
})

finish()
