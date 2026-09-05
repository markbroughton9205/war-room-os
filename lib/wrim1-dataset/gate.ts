import { buildCandidateCorpus } from './corpus'
import { buildEngineeringAndToolEvidence, buildCommanderCorrectionExamples, buildResearchExamples, buildTerraEvalExamples, buildWorldLearningExamples } from './evidence'
import { buildHeldOutEvalSuite, leakageCheck, wrim0Baseline } from './eval'
import { analyzeTokenizer } from './tokenizer'
import { wrim1ArchitectureOptions } from './architecture'
import { sha256 } from './hash'

export type Wave8Gate = {
  corpusExpanded: boolean
  corpusVersioned: boolean
  evidenceExpanded: boolean
  multipleDomains: boolean
  splitsNonzero: boolean
  heldOutSuite: boolean
  leakagePassed: boolean
  wrim0BaselineRecorded: boolean
  tokenizerAnalyzed: boolean
  architectureOptions: boolean
  m1EstimateGrounded: boolean
  noInvalidatingDefect: boolean
  productionUntouched: true
  trainingNotStarted: true
  deficiencies: string[]
  passed: boolean
}

export function evaluateWave8Gate(repo = process.cwd()) {
  const corpus = buildCandidateCorpus(repo)
  const evidence = buildEngineeringAndToolEvidence(repo)
  const evals = buildHeldOutEvalSuite()
  const baseline = wrim0Baseline(evals, repo)
  const tokenizer = analyzeTokenizer(repo)
  const options = wrim1ArchitectureOptions({ uniqueSourceTokens: corpus.uniqueNewSourceTokens, epochs: corpus.epochsAssumed })
  const trainHashes = new Set(corpus.documents.filter(doc => doc.split === 'train').map(doc => doc.contentHash))
  const leakage = leakageCheck(trainHashes, evals)
  const domains = new Set([
    ...corpus.documents.flatMap(doc => doc.capabilityTags),
    ...evidence.records.flatMap(record => record.capabilityTags),
    ...evals.map(item => item.domain),
  ])
  const deficiencies: string[] = []
  const corpusExpanded = corpus.uniqueNewSourceTokens >= 100_000 && corpus.documents.filter(doc => !doc.inheritedFromWrCorpus0).length >= 20
  const corpusVersioned = corpus.corpusId === 'WR-CORPUS-1-CANDIDATE' && /^[a-f0-9]{64}$/.test(corpus.contentHash) && corpus.predecessor.corpusId === 'WR-CORPUS-0'
  const evidenceExpanded = evidence.records.filter(record => record.evidence.outcome === 'pass').length >= 16
    && evidence.distinctLineages >= 8 && evidence.distinctValidatorTypes >= 5
  const multipleDomains = domains.size >= 6
  const splitsNonzero = corpus.splitCounts.train > 0 && corpus.splitCounts.validation > 0 && corpus.splitCounts.test > 0
    && corpus.splitTokens.train > 0 && corpus.splitTokens.validation > 0 && corpus.splitTokens.test > 0
  const heldOutSuite = evals.length >= 8 && new Set(evals.map(item => item.domain)).size >= 6
  const leakagePassed = leakage.passed
  const wrim0BaselineRecorded = baseline.some(row => row.support === 'SUPPORTED' && row.status === 'recorded_genesis_eval')
    && baseline.filter(row => row.support === 'UNSUPPORTED').every(row => row.score === null)
  const tokenizerAnalyzed = tokenizer.tokenizerHash.length === 64 && tokenizer.replaced === false && tokenizer.categories.length >= 6
  const architectureOk = options.length === 3 && options.filter(item => item.selectedForCurrentHardware).length === 1 && options.find(item => item.id === 'A')?.selectedForCurrentHardware === true
  const m1EstimateGrounded = options[0].steps > 0 && options[0].uniqueSourceTokens === corpus.uniqueNewSourceTokens
  const noInvalidatingDefect = evidence.records.every(record => record.evidence.kind !== 'code_operator_result' || record.source === 'code_operator')
    && evidence.records.filter(record => record.source === 'tool_use').every(record => record.evidence.kind === 'tool_use_result')
  if (!corpusExpanded) deficiencies.push(`new unique tokens ${corpus.uniqueNewSourceTokens} or document count too small`)
  if (!corpusVersioned) deficiencies.push('corpus not immutable/versioned')
  if (!evidenceExpanded) deficiencies.push(`engineering/tool evidence pass=${evidence.records.filter(r => r.evidence.outcome === 'pass').length} lineages=${evidence.distinctLineages} validators=${evidence.distinctValidatorTypes}`)
  if (!multipleDomains) deficiencies.push(`capability domains ${domains.size} < 6`)
  if (!splitsNonzero) deficiencies.push('missing train/validation/test coverage')
  if (!heldOutSuite) deficiencies.push('held-out suite too small')
  if (!leakagePassed) deficiencies.push(`leakage collisions: ${leakage.collisions.join(',')}`)
  if (!wrim0BaselineRecorded) deficiencies.push('WRIM-0 baseline missing or fabricated unsupported scores')
  if (!tokenizerAnalyzed) deficiencies.push('tokenizer analysis incomplete')
  if (!architectureOk) deficiencies.push('architecture options incomplete or Option C selected on M1')
  if (!m1EstimateGrounded) deficiencies.push('M1 estimate not grounded in candidate unique tokens')
  if (!noInvalidatingDefect) deficiencies.push('tool_use collapsed into code_operator or kind mismatch')
  const gate: Wave8Gate = {
    corpusExpanded, corpusVersioned, evidenceExpanded, multipleDomains, splitsNonzero, heldOutSuite,
    leakagePassed, wrim0BaselineRecorded, tokenizerAnalyzed, architectureOptions: architectureOk,
    m1EstimateGrounded, noInvalidatingDefect, productionUntouched: true, trainingNotStarted: true,
    deficiencies, passed: deficiencies.length === 0,
  }
  return {
    gate, corpus, evidence, evals, baseline, tokenizer, options, leakage,
    researchExamples: buildResearchExamples(),
    worldLearningExamples: buildWorldLearningExamples(),
    terraEvalExamples: buildTerraEvalExamples(),
    commanderCorrections: buildCommanderCorrectionExamples(),
    reproducibilityHash: sha256({ corpus: corpus.contentHash, evidence: evidence.records.map(record => record.contentHash), evals: evals.map(item => item.evalId) }),
  }
}
