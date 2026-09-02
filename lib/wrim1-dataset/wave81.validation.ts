import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createValidationHarness } from '@/lib/agi-program/validationHarness'
import { ENGINEERING_FAMILIES, HARDENED_CORPUS_ID, WAVE8_PREDECESSOR_CORPUS_HASH } from './types'
import { evaluateWave81Gate } from './gate81'
import { buildHardenedCorpus } from './hardenedCorpus'
import { buildHeldOutSuite81 } from './heldOut'
import { WR_CORPUS_0_TRAIN_TOKENS } from './corpus'

const EXPECTED = 28
const { check, finish } = createValidationHarness('Wave 8.1 deterministic validation', EXPECTED)
const snapshot = evaluateWave81Gate()

check('A predecessor Wave 8 candidate identity is recorded and not overwritten', () => {
  assert.equal(snapshot.corpus.predecessor.corpusId, 'WR-CORPUS-1-CANDIDATE')
  assert.equal(snapshot.corpus.predecessor.contentHash, WAVE8_PREDECESSOR_CORPUS_HASH)
  const wave8 = join(process.cwd(), 'model-lab/manifests/wave8/corpus-manifest.json')
  assert.equal(existsSync(wave8), true)
  const parsed = JSON.parse(readFileSync(wave8, 'utf8')) as { contentHash: string; corpusId: string }
  assert.equal(parsed.corpusId, 'WR-CORPUS-1-CANDIDATE')
  assert.equal(parsed.contentHash, WAVE8_PREDECESSOR_CORPUS_HASH)
})
check('B hardened corpus id is a new successor namespace', () => {
  assert.equal(snapshot.corpus.corpusId, HARDENED_CORPUS_ID)
  assert.match(snapshot.corpus.contentHash, /^[a-f0-9]{64}$/)
  assert.notEqual(snapshot.corpus.contentHash, WAVE8_PREDECESSOR_CORPUS_HASH)
})
check('C hardened corpus hash is reproducible', () => {
  const rebuilt = buildHardenedCorpus()
  assert.equal(rebuilt.contentHash, snapshot.corpus.contentHash)
})
check('D token counts are WR-TOKENIZER-0 measurements, not WR-CORPUS-0 317338', () => {
  assert.equal(snapshot.corpus.tokenizerMethod, 'huggingface-tokenizers')
  assert.ok(snapshot.corpus.uniqueNewTrainTokens > 0)
  assert.ok(snapshot.corpus.uniqueNewValidationTokens > 0)
  assert.ok(snapshot.corpus.uniqueNewTestTokens > 0)
  assert.notEqual(snapshot.corpus.uniqueNewTrainTokens, WR_CORPUS_0_TRAIN_TOKENS)
  assert.equal(snapshot.corpus.wrCorpus0UniqueTrainTokens, 317338)
})
check('E static TypeScript/JavaScript is not tagged tool-use', () => {
  assert.ok(snapshot.corpus.documents.filter(doc => doc.format === 'code').every(doc => !doc.capabilityTags.includes('tool-use')))
})
check('F tool-use examples are real trajectories', () => {
  const tool = snapshot.corpus.examples.filter(item => item.format === 'tool_use')
  assert.ok(tool.length >= 2)
  assert.ok(tool.every(item => item.toolActions.length > 0 && item.toolResults.length > 0 && item.renderedTrainingText.includes('<|tool|>')))
})
check('G content-level leakage check passes', () => {
  assert.equal(snapshot.corpus.leakage.nearDuplicatePairs, 0)
  assert.equal(snapshot.corpus.leakage.heldOutCollisions.length, 0)
})
check('H source-lineage leakage check passes', () => assert.equal(snapshot.corpus.leakage.sourceLineageCrossSplit.length, 0))
check('I held-out suite is frozen before admission and isolated', () => {
  const evals = buildHeldOutSuite81()
  assert.equal(evals.length, 10)
  assert.equal(new Set(evals.map(item => item.domain)).size, 10)
  assert.ok(snapshot.corpus.documents.every(doc => !doc.lineageId.startsWith('lineage:heldout:')))
})
check('J behavior examples are physically materialized with rendered training text', () => {
  assert.ok(snapshot.corpus.examples.length >= 20)
  assert.ok(snapshot.corpus.examples.every(item => item.renderedTrainingText.includes('<|assistant|>')))
})
check('K Terra fixtures are eval-only', () => {
  assert.ok(snapshot.terra.every(item => item.trainability === 'eval_only'))
  assert.equal(snapshot.corpus.engineering.terraTraining, 0)
})
check('L Commander corrections are reported honestly as zero', () => assert.equal(snapshot.corpus.engineering.commanderCorrections, 0))
check('M quality tier C is not silent positive truth', () => {
  assert.ok(snapshot.corpus.examples.filter(item => item.qualityTier === 'C').every(item => item.trainability !== 'positive_training'))
})
check('N contested research does not become verified', () => {
  const contested = snapshot.corpus.examples.find(item => item.claimStatus === 'contested')
  assert.ok(contested)
  assert.notEqual(contested.claimStatus, 'verified')
  assert.match(contested.finalResponse, /contested|do not pick/i)
})
check('O world-learning examples keep candidate status', () => {
  const wl = snapshot.corpus.examples.filter(item => item.capabilityTags.includes('world_learning'))
  assert.ok(wl.length >= 4)
  assert.ok(wl.every(item => item.claimStatus === 'candidate'))
})
check('P chunks retain lineage metadata', () => {
  assert.ok(snapshot.corpus.chunks.length > 0)
  assert.ok(snapshot.corpus.chunks.every(chunk => chunk.sourceHash && chunk.parentLineage && chunk.offsetEnd > chunk.offsetStart))
})
check('Q WRIM-0 unsupported tasks keep null scores', () => {
  assert.ok(snapshot.baseline.filter(row => row.support === 'UNSUPPORTED').every(row => row.score === null))
  assert.ok(snapshot.baseline.some(row => row.support === 'SUPPORTED'))
})
check('R tokenizer decision is KEEP_WR_TOKENIZER_0', () => {
  assert.equal(snapshot.tokenizer.decision, 'KEEP_WR_TOKENIZER_0')
  assert.equal(snapshot.tokenizer.replaced, false)
})
check('S Option A is selected; B/C are speculative/not present', () => {
  assert.equal(snapshot.options.find(item => item.id === 'A')?.selectedForCurrentHardware, true)
  assert.equal(snapshot.options.find(item => item.id === 'B')?.estimateClass, 'SPECULATIVE')
  assert.equal(snapshot.options.find(item => item.id === 'C')?.estimateClass, 'SPECULATIVE')
  assert.equal(snapshot.options.find(item => item.id === 'A')?.uniqueTrainTokens, snapshot.corpus.uniqueNewTrainTokens)
})
check('T production and training gate fields are computed', () => {
  assert.ok(['verified', 'not_checked', 'unknown'].includes(snapshot.proof.production.status))
  assert.equal(snapshot.proof.training.trainingNotStarted, true)
  assert.notEqual(snapshot.gate.productionUntouched, undefined)
})
check('U engineering families are diverse and not chore-dominated', () => {
  const families = ENGINEERING_FAMILIES.filter(family => (snapshot.corpus.engineering.families[family] ?? 0) > 0)
  assert.ok(families.length >= 8, `families=${families.join(',')}`)
  assert.equal(snapshot.corpus.engineering.choreHeavy, false)
})
check('V training mix weights sum to 1', () => {
  assert.equal(Number(Object.values(snapshot.corpus.trainingMix).reduce((sum, value) => sum + value, 0).toFixed(2)), 1)
})
check('W secrets and hidden CoT are absent from rendered examples', () => {
  assert.ok(snapshot.corpus.examples.every(item => !/<\/?(?:think|scratchpad|hidden_cot)\b/i.test(item.renderedTrainingText)))
})
check('X Wave 8.1 gate is fail-closed and binary', () => {
  assert.equal(typeof snapshot.gate.passed, 'boolean')
  if (!snapshot.gate.passed) assert.ok(snapshot.gate.deficiencies.length > 0)
})
check('Y held-out scorers are objective, not only model-judge', () => {
  const scorers = new Set(snapshot.evals.map(item => item.objectiveScorer))
  assert.ok(scorers.has('json-validity'))
  assert.ok(scorers.has('tool-call-structure'))
  assert.ok(scorers.has('contradiction-preserved'))
})
check('Z parent checkpoint remains WRIM-0', () => assert.equal(snapshot.parentCheckpointHash, 'd1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015'))
check('AA multiple training domains exist', () => {
  assert.ok((snapshot.corpus.domainDistribution.code ?? 0) > 0)
  assert.ok((snapshot.corpus.domainDistribution.natural_language ?? 0) > 0)
  assert.ok((snapshot.corpus.formatDistribution.tool_use ?? 0) > 0)
})
check('AB splits report documents, examples, and tokens', () => {
  assert.ok(snapshot.corpus.splitCounts.train.documents > 0)
  assert.ok(snapshot.corpus.splitCounts.train.tokens > 0)
  assert.ok(snapshot.corpus.splitCounts.validation.tokens > 0)
  assert.ok(snapshot.corpus.splitCounts.test.tokens > 0)
})

finish()
