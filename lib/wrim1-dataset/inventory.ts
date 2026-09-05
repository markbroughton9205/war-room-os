import { evaluateWave8Gate } from './gate'
import { WRIM0_TRAINING_TOKENS_AFTER_EPOCH_REUSE, WR_CORPUS_0_TRAIN_TOKENS, WR_CORPUS_0_VAL_TOKENS } from './corpus'

export type Wrim1DatasetInventory = {
  corpusDocuments: number
  corpusTrainTokens: number
  corpusValTokens: number
  uniqueNewSourceTokens: number
  uniqueInheritedSourceTokens: number
  trainingTokensAfterEpochReuseEstimate: number
  wrim0TrainingTokensAfterEpochReuse: number
  engineeringEvidenceCount: number
  engineeringPassCount: number
  distinctLineages: number
  distinctValidatorTypes: number
  provenanceClasses: string[]
  tokenizerId: string
  tokenizerHash: string
  parentCheckpointHash: string
  corpusVersion: string
  corpusContentHash: string
  substantialForWrim1Experiment: boolean
  deficiencies: string[]
  trainingStarted: false
}

export function inventoryWrim1Dataset(repo = process.cwd()): Wrim1DatasetInventory {
  const snapshot = evaluateWave8Gate(repo)
  const passEvidence = snapshot.evidence.records.filter(record => record.evidence.outcome === 'pass')
  return {
    corpusDocuments: snapshot.corpus.documents.length,
    corpusTrainTokens: WR_CORPUS_0_TRAIN_TOKENS,
    corpusValTokens: WR_CORPUS_0_VAL_TOKENS,
    uniqueNewSourceTokens: snapshot.corpus.uniqueNewSourceTokens,
    uniqueInheritedSourceTokens: snapshot.corpus.uniqueInheritedSourceTokens,
    trainingTokensAfterEpochReuseEstimate: snapshot.corpus.trainingTokensAfterEpochReuseEstimate,
    wrim0TrainingTokensAfterEpochReuse: WRIM0_TRAINING_TOKENS_AFTER_EPOCH_REUSE,
    engineeringEvidenceCount: snapshot.evidence.records.length,
    engineeringPassCount: passEvidence.length,
    distinctLineages: snapshot.evidence.distinctLineages,
    distinctValidatorTypes: snapshot.evidence.distinctValidatorTypes,
    provenanceClasses: ['wr-corpus-0-inherited', 'commander-owned-source', 'commander-owned-docs', 'code_operator_evidence', 'tool_use_evidence', 'world_learning_session', 'research_process'],
    tokenizerId: snapshot.tokenizer.tokenizerId,
    tokenizerHash: snapshot.tokenizer.tokenizerHash,
    parentCheckpointHash: 'd1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015',
    corpusVersion: snapshot.corpus.corpusId,
    corpusContentHash: snapshot.corpus.contentHash,
    substantialForWrim1Experiment: snapshot.gate.passed,
    deficiencies: snapshot.gate.deficiencies,
    trainingStarted: false,
  }
}

export function inventoryContentHash(inventory: Wrim1DatasetInventory) {
  return inventory.corpusContentHash
}
