import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { inventoryCorpusSources, summarizeInventory, wrCorpus0InheritedHashes } from './sources'
import { deduplicateSources } from './dedup'
import { qualityTierForSource, trainabilityFor } from './quality'
import { estimateUtf8Tokens, sha256 } from './hash'
import { buildHeldOutEvalSuite, heldOutExclusionHashes } from './eval'
import { buildCommanderCorrectionExamples, buildEngineeringAndToolEvidence, buildResearchExamples, buildWorldLearningExamples } from './evidence'
import type { CorpusSourceInventoryRow, ExampleFormat, ObservableExample, QualityTier } from './types'

export const CORPUS_VERSION_ID = 'WR-CORPUS-1-CANDIDATE'
export const WR_CORPUS_0_TRAIN_TOKENS = 317_338
export const WR_CORPUS_0_VAL_TOKENS = 3_078
export const WRIM0_TRAINING_TOKENS_AFTER_EPOCH_REUSE = 2_048_000

export type CorpusDocumentRecord = {
  documentId: string
  path: string
  sourceId: string
  sourceClass: CorpusSourceInventoryRow['class']
  format: ExampleFormat
  capabilityTags: string[]
  provenanceRef: string
  rights: CorpusSourceInventoryRow['rights']
  contentHash: string
  uniqueSourceTokens: number
  inheritedFromWrCorpus0: boolean
  qualityTier: QualityTier
  trainability: ReturnType<typeof trainabilityFor>
  split: 'train' | 'validation' | 'test'
  lineageId: string
  dedupStatus: 'kept' | 'exact_duplicate' | 'near_duplicate' | 'eval_excluded'
}

export type CandidateCorpusManifest = {
  corpusId: typeof CORPUS_VERSION_ID
  predecessor: { corpusId: 'WR-CORPUS-0'; trainTokens: number; valTokens: number }
  createdAt: string
  immutable: true
  contentHash: string
  inventoryCounts: ReturnType<typeof summarizeInventory>
  documents: CorpusDocumentRecord[]
  uniqueNewSourceTokens: number
  uniqueInheritedSourceTokens: number
  uniqueSourceTokensTotal: number
  trainingTokensAfterEpochReuseEstimate: number
  epochsAssumed: number
  formatDistribution: Record<string, number>
  capabilityDistribution: Record<string, number>
  qualityDistribution: Record<string, number>
  splitCounts: { train: number; validation: number; test: number }
  splitTokens: { train: number; validation: number; test: number }
  dedup: { exact: number; near: number }
  examples: ObservableExample[]
  trainingStarted: false
}

function lineageId(path: string): string {
  const parts = path.split('/')
  return `lineage:${parts.slice(0, 2).join('/')}`
}

function splitFor(lineage: string, seed = 8018): 'train' | 'validation' | 'test' {
  const bucket = parseInt(sha256(`${seed}:${lineage}`).slice(0, 8), 16) % 10
  if (bucket === 0) return 'test'
  if (bucket === 1) return 'validation'
  return 'train'
}

export function buildCandidateCorpus(repo = process.cwd(), now = new Date()): CandidateCorpusManifest {
  const inventory = inventoryCorpusSources(repo)
  const inherited = wrCorpus0InheritedHashes(repo)
  const evalItems = buildHeldOutEvalSuite()
  const evalHashes = heldOutExclusionHashes(evalItems)
  const contents = new Map<string, string>()
  for (const row of inventory) {
    const full = join(repo, row.path)
    if (existsSync(full)) {
      try { contents.set(row.path, readFileSync(full, 'utf8')) } catch { /* skip unreadable */ }
    }
  }
  const eligible = inventory.filter(row => row.class === 'ELIGIBLE' && row.rights.permitsTrainingUse && !row.exclusionReasons.includes('secret_detected'))
  const dedup = deduplicateSources(eligible, contents)
  const documents: CorpusDocumentRecord[] = []
  for (const row of dedup.kept) {
    const text = contents.get(row.path) ?? ''
    if (evalHashes.has(sha256(text)) || evalHashes.has(sha256(text.slice(0, 200)))) continue
    const tier = qualityTierForSource(row)
    const trainability = trainabilityFor(tier, row.class)
    if (trainability !== 'positive_training') continue
    const lineage = lineageId(row.path)
    documents.push({
      documentId: `w8doc_${row.contentHash.slice(0, 24)}`,
      path: row.path, sourceId: row.sourceId, sourceClass: row.class, format: row.format,
      capabilityTags: row.capabilityTags, provenanceRef: row.provenanceRef, rights: row.rights,
      contentHash: row.contentHash, uniqueSourceTokens: estimateUtf8Tokens(text),
      inheritedFromWrCorpus0: inherited.has(row.contentHash), qualityTier: tier, trainability,
      split: splitFor(lineage), lineageId: lineage, dedupStatus: 'kept',
    })
  }
  const uniqueNew = documents.filter(doc => !doc.inheritedFromWrCorpus0).reduce((sum, doc) => sum + doc.uniqueSourceTokens, 0)
  const uniqueInherited = documents.filter(doc => doc.inheritedFromWrCorpus0).reduce((sum, doc) => sum + doc.uniqueSourceTokens, 0)
  const epochsAssumed = 3
  const formatDistribution: Record<string, number> = {}
  const capabilityDistribution: Record<string, number> = {}
  const qualityDistribution: Record<string, number> = {}
  const splitCounts = { train: 0, validation: 0, test: 0 }
  const splitTokens = { train: 0, validation: 0, test: 0 }
  for (const doc of documents) {
    formatDistribution[doc.format] = (formatDistribution[doc.format] ?? 0) + 1
    qualityDistribution[doc.qualityTier] = (qualityDistribution[doc.qualityTier] ?? 0) + 1
    splitCounts[doc.split] += 1
    splitTokens[doc.split] += doc.uniqueSourceTokens
    for (const tag of doc.capabilityTags) capabilityDistribution[tag] = (capabilityDistribution[tag] ?? 0) + 1
  }
  const engineering = buildEngineeringAndToolEvidence(repo)
  const examples = [
    ...engineering.examples.filter(item => item.trainability === 'positive_training' || item.trainability === 'failure_curriculum'),
    ...buildResearchExamples(),
    ...buildWorldLearningExamples(),
    ...buildCommanderCorrectionExamples(),
  ]
  const payload = {
    corpusId: CORPUS_VERSION_ID,
    documents: documents.map(doc => ({ id: doc.documentId, hash: doc.contentHash, split: doc.split, lineage: doc.lineageId, tokens: doc.uniqueSourceTokens })),
    exampleLineages: examples.map(item => ({ lineage: item.lineageIds, format: item.format, outcome: item.outcome, claimStatus: item.claimStatus ?? null, validator: item.validator })),
    inventory: summarizeInventory(inventory), uniqueNew, epochsAssumed,
  }
  return {
    corpusId: CORPUS_VERSION_ID,
    predecessor: { corpusId: 'WR-CORPUS-0', trainTokens: WR_CORPUS_0_TRAIN_TOKENS, valTokens: WR_CORPUS_0_VAL_TOKENS },
    createdAt: now.toISOString(), immutable: true, contentHash: sha256(payload),
    inventoryCounts: summarizeInventory(inventory), documents, uniqueNewSourceTokens: uniqueNew,
    uniqueInheritedSourceTokens: uniqueInherited, uniqueSourceTokensTotal: uniqueNew + uniqueInherited,
    trainingTokensAfterEpochReuseEstimate: uniqueNew * epochsAssumed,
    epochsAssumed, formatDistribution, capabilityDistribution, qualityDistribution, splitCounts, splitTokens,
    dedup: { exact: dedup.exactDuplicates.length, near: dedup.nearDuplicates.length },
    examples, trainingStarted: false,
  }
}
