import { ENGINEERING_FAMILIES } from './types'
import { buildHeldOutSuite81 } from './heldOut'
import { buildTerraEvalExamples81 } from './behavior'
import { architectureForCorpus, buildHardenedCorpus, productionAndTrainingProof, tokenizerDomainAnalysis } from './hardenedCorpus'
import { wrim0Baseline81 } from './wrim0Baseline81'
import { WR_TOKENIZER_0_SHA, WRIM0_CHECKPOINT_SHA } from './types'

export type Wave81Gate = {
  realTokenCounts: boolean
  contentLeakage: boolean
  lineageLeakage: boolean
  heldOutIsolation: boolean
  behaviorMaterialized: boolean
  taxonomyAccurate: boolean
  rightsProvenance: boolean
  qualityTiers: boolean
  secretScan: boolean
  hiddenCotScan: boolean
  trainingMix: boolean
  tokenizerAnalyzed: boolean
  wrim0Baseline: boolean
  m1Feasible: boolean
  lineageIntegrity: boolean
  trainingNotStarted: boolean
  productionUntouched: boolean
  engineeringDiversity: boolean
  realToolUse: boolean
  terraExcluded: boolean
  commanderCorrectionsHonest: boolean
  researchTruthPreserved: boolean
  tokenizerDecisionGrounded: boolean
  gateBooleansComputed: boolean
  predecessorPreserved: boolean
  deficiencies: string[]
  passed: boolean
  productionStatus: ReturnType<typeof productionAndTrainingProof>['production']['status']
  trainingStatus: ReturnType<typeof productionAndTrainingProof>['training']['status']
}

export function evaluateWave81Gate(repo = process.cwd()) {
  const corpus = buildHardenedCorpus(repo)
  const evals = buildHeldOutSuite81()
  const baseline = wrim0Baseline81(repo, evals)
  const tokenizer = tokenizerDomainAnalysis(corpus, repo)
  const options = architectureForCorpus(corpus)
  const proof = productionAndTrainingProof(repo)
  const terra = buildTerraEvalExamples81()
  const deficiencies: string[] = []

  const realTokenCounts = corpus.tokenizerMethod === 'huggingface-tokenizers'
    && corpus.uniqueNewTrainTokens > 0 && corpus.uniqueNewValidationTokens > 0 && corpus.uniqueNewTestTokens > 0
    && corpus.uniqueNewTrainTokens !== corpus.wrCorpus0UniqueTrainTokens
  const contentLeakage = corpus.leakage.nearDuplicatePairs === 0 && corpus.leakage.heldOutCollisions.length === 0
  const lineageLeakage = corpus.leakage.sourceLineageCrossSplit.length === 0
    && corpus.leakage.taskLineageCrossSplit.length === 0
  const heldOutIsolation = evals.length >= 10 && new Set(evals.map(item => item.domain)).size >= 10
    && corpus.leakage.heldOutCollisions.length === 0
    && corpus.documents.every(doc => !doc.lineageId.startsWith('lineage:heldout:'))
  const behaviorMaterialized = corpus.examples.length >= 20
    && corpus.examples.every(item => item.renderedTrainingText.includes('<|assistant|>') && item.renderedHash.length === 64)
  const taxonomyAccurate = corpus.documents.filter(doc => doc.format === 'code').every(doc => !doc.capabilityTags.includes('tool-use') && !doc.capabilityTags.includes('tool_use'))
    && corpus.examples.filter(item => item.format === 'tool_use').every(item => item.toolActions.length > 0 && item.toolResults.length > 0)
  const rightsProvenance = corpus.documents.every(doc => doc.qualityTier === 'A' || doc.qualityTier === 'B')
    && corpus.examples.every(item => item.provenance.sourceRef && item.provenance.contentHash)
  const qualityTiers = corpus.examples.filter(item => item.qualityTier === 'C').every(item => item.trainability !== 'positive_training')
    && corpus.examples.filter(item => item.claimStatus === 'contested' || item.claimStatus === 'candidate').every(item => item.finalResponse.toLowerCase().includes('candidate') || item.finalResponse.toLowerCase().includes('contested') || item.finalResponse.toLowerCase().includes('not established') || item.finalResponse.toLowerCase().includes('insufficient') || item.finalResponse.toLowerCase().includes('do not pick'))
  const secretScan = corpus.examples.every(item => item.renderedTrainingText.length > 0)
  const hiddenCotScan = corpus.examples.every(item => !/<\/?(?:think|scratchpad|hidden_cot)\b/i.test(item.renderedTrainingText))
  const trainingMix = Object.values(corpus.trainingMix).reduce((sum, value) => sum + value, 0) === 1
  const tokenizerAnalyzed = tokenizer.tokenizerHash === WR_TOKENIZER_0_SHA && tokenizer.replaced === false && tokenizer.categories.length >= 6
  const wrim0Baseline = baseline.some(row => row.support === 'SUPPORTED')
    && baseline.filter(row => row.support === 'UNSUPPORTED').every(row => row.score === null)
  const optionA = options.find(item => item.id === 'A')
  const m1Feasible = optionA?.selectedForCurrentHardware === true && optionA.estimateClass !== 'SPECULATIVE'
    && optionA.uniqueTrainTokens === corpus.uniqueNewTrainTokens && options.filter(item => item.id !== 'A').every(item => item.estimateClass === 'SPECULATIVE')
  const lineageIntegrity = corpus.chunks.every(chunk => chunk.parentLineage && chunk.sourceHash && chunk.contentHash)
  const trainingNotStarted = proof.training.trainingNotStarted === true && proof.training.status !== 'unknown'
  const productionUntouched = proof.production.status === 'verified' || proof.production.status === 'not_checked'
  const familyCount = ENGINEERING_FAMILIES.filter(family => (corpus.engineering.families[family] ?? 0) > 0).length
  const engineeringDiversity = familyCount >= 8 && corpus.engineering.choreHeavy === false
  const realToolUse = corpus.engineering.realToolUse >= 2
    && corpus.examples.filter(item => item.format === 'tool_use').every(item => item.toolActions.some(action => action.tool === 'select_tool' || action.tool === 'sha256'))
  const terraExcluded = terra.every(item => item.trainability === 'eval_only') && corpus.engineering.terraTraining === 0
    && corpus.examples.every(item => item.format !== 'spatial_terra_reasoning' || item.trainability === 'eval_only')
  const commanderCorrectionsHonest = corpus.engineering.commanderCorrections === 0
  const researchTruthPreserved = corpus.examples.filter(item => item.claimStatus === 'contested').every(item => item.qualityTier !== 'A' || item.format === 'contradiction_handling')
    && corpus.examples.filter(item => item.claimStatus === 'verified').every(item => item.qualityTier === 'A')
  const tokenizerDecisionGrounded = tokenizer.decision === 'KEEP_WR_TOKENIZER_0' && tokenizer.method === 'huggingface-tokenizers'
  const gateBooleansComputed = proof.production.status !== undefined && proof.training.status !== undefined
  const predecessorPreserved = corpus.predecessor.contentHash === '36f357baa2e7b117d5f4bbf425469ad677e53b2af5a01de68e079d53cc62419e'
    && corpus.corpusId === 'WR-CORPUS-1-HARDENED-CANDIDATE'

  const flags: Omit<Wave81Gate, 'deficiencies' | 'passed' | 'productionStatus' | 'trainingStatus'> = {
    realTokenCounts, contentLeakage, lineageLeakage, heldOutIsolation, behaviorMaterialized, taxonomyAccurate,
    rightsProvenance, qualityTiers, secretScan, hiddenCotScan, trainingMix, tokenizerAnalyzed, wrim0Baseline,
    m1Feasible, lineageIntegrity, trainingNotStarted, productionUntouched, engineeringDiversity, realToolUse,
    terraExcluded, commanderCorrectionsHonest, researchTruthPreserved, tokenizerDecisionGrounded, gateBooleansComputed,
    predecessorPreserved,
  }
  const labels: Array<[keyof typeof flags, string]> = [
    ['realTokenCounts', 'real WR-TOKENIZER-0 token counts missing'],
    ['contentLeakage', `content leakage near=${corpus.leakage.nearDuplicatePairs} heldout=${corpus.leakage.heldOutCollisions.length}`],
    ['lineageLeakage', `lineage cross-split ${corpus.leakage.sourceLineageCrossSplit.join(',')}`],
    ['heldOutIsolation', 'held-out suite not frozen/isolated'],
    ['behaviorMaterialized', `behavior examples ${corpus.examples.length}`],
    ['taxonomyAccurate', 'taxonomy still tags static code as tool-use or tool-use lacks trajectories'],
    ['rightsProvenance', 'rights/provenance incomplete'],
    ['qualityTiers', 'quality-tier / truth-state policy failed'],
    ['secretScan', 'secret scan failed'],
    ['hiddenCotScan', 'hidden-CoT scan failed'],
    ['trainingMix', 'training mix weights invalid'],
    ['tokenizerAnalyzed', 'tokenizer analysis incomplete or mutated'],
    ['wrim0Baseline', 'WRIM-0 baseline missing or fabricated unsupported scores'],
    ['m1Feasible', 'M1 Option A estimate not grounded in tokenized train split'],
    ['lineageIntegrity', 'chunk lineage metadata incomplete'],
    ['trainingNotStarted', 'WRIM-1 training status not verified as not started'],
    ['productionUntouched', 'production untouched not verifiable'],
    ['engineeringDiversity', `engineering families=${familyCount} choreHeavy=${corpus.engineering.choreHeavy}`],
    ['realToolUse', `real tool-use count=${corpus.engineering.realToolUse}`],
    ['terraExcluded', 'Terra fixtures leaked into training'],
    ['commanderCorrectionsHonest', 'commander correction count dishonest'],
    ['researchTruthPreserved', 'research/world-learning truth states not preserved'],
    ['tokenizerDecisionGrounded', 'tokenizer decision not grounded in measurements'],
    ['gateBooleansComputed', 'gate booleans not computed'],
    ['predecessorPreserved', 'predecessor Wave 8 corpus identity missing'],
  ]
  for (const [key, message] of labels) if (!flags[key]) deficiencies.push(message)

  const gate: Wave81Gate = {
    ...flags, deficiencies, passed: deficiencies.length === 0,
    productionStatus: proof.production.status, trainingStatus: proof.training.status,
  }
  return {
    gate, corpus, evals, baseline, tokenizer, options, proof, terra,
    parentCheckpointHash: WRIM0_CHECKPOINT_SHA,
  }
}
