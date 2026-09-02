import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { inventoryCorpusSources, summarizeInventory, wrCorpus0InheritedHashes } from './sources'
import { qualityTierForSource, trainabilityFor } from './quality'
import { estimateUtf8Tokens, sha256 } from './hash'
import { domainForPath, hardenedCapabilityTags } from './taxonomy'
import { chunkDocument, sourceLineageForPath } from './chunking'
import { detectContentLeakage, dropExactDuplicateChunks } from './leakage'
import { buildHeldOutSuite81, heldOutFingerprintSet, heldOutLineageSet } from './heldOut'
import { countWithWrTokenizer0, tokenizerArtifactHash } from './tokenize'
import { scanTrainingText } from './serialize'
import {
  buildCommanderCorrectionExamples81,
  buildEngineeringAndToolEvidence81,
  buildResearchExamples81,
  buildWorldLearningExamples81,
  realToolUseCount,
} from './behavior'
import { planEpochs, wrim1ArchitectureOptions81 } from './architecture81'
import { verifyProductionUntouched, verifyTrainingNotStarted } from './productionChecks'
import { analyzeTokenizer } from './tokenizer'
import { WR_CORPUS_0_TRAIN_TOKENS, WRIM0_TRAINING_TOKENS_AFTER_EPOCH_REUSE } from './corpus'
import {
  HARDENED_CORPUS_ID,
  WAVE8_PREDECESSOR_CORPUS_HASH,
  WAVE8_PREDECESSOR_CORPUS_ID,
} from './types'
import type { ChunkRecord, CorpusSourceInventoryRow, HardenedExample } from './types'

let cachedManifest: { repo: string; manifest: HardenedCorpusManifest } | null = null

function splitFor(lineage: string, seed = 8101): 'train' | 'validation' | 'test' {
  const bucket = parseInt(sha256(`${seed}:${lineage}`).slice(0, 8), 16) % 10
  if (bucket === 0) return 'test'
  if (bucket === 1) return 'validation'
  return 'train'
}

export const TRAINING_MIX_WEIGHTS = {
  language_modeling: 0.20,
  code: 0.45,
  behavior_instruction: 0.15,
  tool_use: 0.08,
  research_evidence: 0.07,
  structured_output: 0.05,
} as const

export type HardenedCorpusManifest = {
  corpusId: typeof HARDENED_CORPUS_ID
  predecessor: { corpusId: typeof WAVE8_PREDECESSOR_CORPUS_ID; contentHash: typeof WAVE8_PREDECESSOR_CORPUS_HASH }
  createdAt: string
  immutable: true
  contentHash: string
  inventoryCounts: ReturnType<typeof summarizeInventory>
  wrCorpus0UniqueTrainTokens: number
  wrim0TrainingTokensAfterEpochReuse: number
  documents: Array<{
    documentId: string
    path: string
    lineageId: string
    split: 'train' | 'validation' | 'test'
    format: string
    capabilityTags: string[]
    contentHash: string
    qualityTier: string
    inheritedFromWrCorpus0: boolean
    estimatedUtf8Tokens: number
  }>
  chunks: ChunkRecord[]
  examples: HardenedExample[]
  splitCounts: {
    train: { documents: number; chunks: number; examples: number; tokens: number }
    validation: { documents: number; chunks: number; examples: number; tokens: number }
    test: { documents: number; chunks: number; examples: number; tokens: number }
  }
  uniqueNewTrainTokens: number
  uniqueNewValidationTokens: number
  uniqueNewTestTokens: number
  totalCandidateTokens: number
  byteEstimateTrain: number
  tokenizerMethod: 'huggingface-tokenizers' | 'unavailable'
  formatDistribution: Record<string, number>
  capabilityDistribution: Record<string, number>
  domainDistribution: Record<string, number>
  qualityDistribution: Record<string, number>
  trainingMix: typeof TRAINING_MIX_WEIGHTS
  trainingMixRationale: string
  overrepresentation: { topSource: string; topDomain: string; topDirectory: string; topCapability: string; topDirectoryShare: number }
  dedup: { exact: number; normalized: number }
  leakage: ReturnType<typeof detectContentLeakage>
  engineering: { families: Record<string, number>; choreHeavy: boolean; distinctLineages: number; realToolUse: number; commanderCorrections: number; terraTraining: number }
  epochs: number
  trainingTokensAfterEpochReuse: number
}

export function buildHardenedCorpus(repo = process.cwd(), now = new Date('2026-08-30T21:00:00.000Z')): HardenedCorpusManifest {
  if (cachedManifest && cachedManifest.repo === repo) return cachedManifest.manifest
  const evals = buildHeldOutSuite81()
  const heldOutLineages = heldOutLineageSet(evals)
  const heldOutFingerprints = heldOutFingerprintSet(evals)
  const inventory = inventoryCorpusSources(repo)
  const inherited = wrCorpus0InheritedHashes(repo)
  const contents = new Map<string, string>()
  for (const row of inventory) {
    const full = join(repo, row.path)
    if (existsSync(full)) {
      try { contents.set(row.path, readFileSync(full, 'utf8')) } catch { /* skip */ }
    }
  }

  const documents: HardenedCorpusManifest['documents'] = []
  const rawChunks: ChunkRecord[] = []
  for (const row of inventory) {
    if (row.class !== 'ELIGIBLE' || !row.rights.permitsTrainingUse || row.exclusionReasons.includes('secret_detected')) continue
    const lineage = sourceLineageForPath(row.path)
    if (heldOutLineages.has(lineage)) continue
    const text = contents.get(row.path) ?? ''
    if (!text) continue
    const scan = scanTrainingText(text)
    if (scan.secret || scan.hiddenCot) continue
    const tags = hardenedCapabilityTags(row)
    const tier = qualityTierForSource(row)
    const trainability = trainabilityFor(tier, row.class)
    if (trainability !== 'positive_training') continue
    const split = splitFor(lineage)
    const documentId = `w81doc_${row.contentHash.slice(0, 24)}`
    documents.push({
      documentId, path: row.path, lineageId: lineage, split, format: row.format, capabilityTags: tags,
      contentHash: row.contentHash, qualityTier: tier, inheritedFromWrCorpus0: inherited.has(row.contentHash),
      estimatedUtf8Tokens: estimateUtf8Tokens(text),
    })
    rawChunks.push(...chunkDocument({
      documentId, source: row, text, parentLineage: lineage, split, qualityTier: tier, capabilityTags: tags, format: row.format,
    }))
  }

  const dedup = dropExactDuplicateChunks(rawChunks)
  const engineering = buildEngineeringAndToolEvidence81(repo)
  const examples: HardenedExample[] = [
    ...engineering.examples.filter(item => item.trainability === 'positive_training' || item.trainability === 'failure_curriculum'),
    ...buildResearchExamples81().filter(item => item.trainability === 'positive_training' || item.trainability === 'failure_curriculum'),
    ...buildWorldLearningExamples81(),
    ...buildCommanderCorrectionExamples81(),
  ].filter(item => {
    if (item.lineageIds.some(id => heldOutLineages.has(id))) return false
    const scan = scanTrainingText(item.renderedTrainingText)
    return !scan.secret && !scan.hiddenCot
  })

  const tokenizeItems = [
    ...dedup.kept.map(chunk => ({ id: chunk.chunkId, text: chunk.text })),
    ...examples.map(item => ({ id: item.exampleId, text: item.renderedTrainingText })),
  ]
  const counted = countWithWrTokenizer0(tokenizeItems, repo)
  for (const chunk of dedup.kept) {
    chunk.tokenizerTokens = counted.counts[chunk.chunkId]?.tokens ?? null
  }

  const leakage = detectContentLeakage({
    chunks: dedup.kept, examples, heldOutFingerprints, heldOutLineages,
  })

  const exampleSplit = (example: HardenedExample): 'train' | 'validation' | 'test' => splitFor(example.lineageIds[0] ?? example.exampleId)

  const splitCounts = {
    train: { documents: 0, chunks: 0, examples: 0, tokens: 0 },
    validation: { documents: 0, chunks: 0, examples: 0, tokens: 0 },
    test: { documents: 0, chunks: 0, examples: 0, tokens: 0 },
  }
  for (const doc of documents) splitCounts[doc.split].documents += 1
  for (const chunk of dedup.kept) {
    splitCounts[chunk.split].chunks += 1
    splitCounts[chunk.split].tokens += chunk.tokenizerTokens ?? 0
  }
  for (const example of examples) {
    const split = exampleSplit(example)
    splitCounts[split].examples += 1
    splitCounts[split].tokens += counted.counts[example.exampleId]?.tokens ?? 0
  }

  const formatDistribution: Record<string, number> = {}
  const capabilityDistribution: Record<string, number> = {}
  const domainDistribution: Record<string, number> = {}
  const qualityDistribution: Record<string, number> = {}
  const directoryCounts: Record<string, number> = {}
  for (const doc of documents) {
    formatDistribution[doc.format] = (formatDistribution[doc.format] ?? 0) + 1
    qualityDistribution[doc.qualityTier] = (qualityDistribution[doc.qualityTier] ?? 0) + 1
    const domain = domainForPath(doc.path, doc.format as CorpusSourceInventoryRow['format'])
    domainDistribution[domain] = (domainDistribution[domain] ?? 0) + 1
    const directory = doc.path.split('/').slice(0, 2).join('/')
    directoryCounts[directory] = (directoryCounts[directory] ?? 0) + 1
    for (const tag of doc.capabilityTags) capabilityDistribution[tag] = (capabilityDistribution[tag] ?? 0) + 1
  }
  for (const example of examples) {
    formatDistribution[example.format] = (formatDistribution[example.format] ?? 0) + 1
    for (const tag of example.capabilityTags) capabilityDistribution[tag] = (capabilityDistribution[tag] ?? 0) + 1
  }

  const topDirectory = Object.entries(directoryCounts).sort((a, b) => b[1] - a[1])[0] ?? ['none', 0]
  const topDomain = Object.entries(domainDistribution).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'none'
  const topCapability = Object.entries(capabilityDistribution).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'none'
  const topSource = documents.slice().sort((a, b) => b.estimatedUtf8Tokens - a.estimatedUtf8Tokens)[0]?.path ?? 'none'

  const uniqueNewTrainTokens = splitCounts.train.tokens
  const uniqueNewValidationTokens = splitCounts.validation.tokens
  const uniqueNewTestTokens = splitCounts.test.tokens
  const totalCandidateTokens = uniqueNewTrainTokens + uniqueNewValidationTokens + uniqueNewTestTokens
  const epochs = planEpochs(uniqueNewTrainTokens)
  const payload = {
    corpusId: HARDENED_CORPUS_ID,
    predecessor: WAVE8_PREDECESSOR_CORPUS_HASH,
    documents: documents.map(doc => ({ id: doc.documentId, hash: doc.contentHash, split: doc.split, lineage: doc.lineageId })),
    chunks: dedup.kept.map(chunk => ({ id: chunk.chunkId, hash: chunk.contentHash, split: chunk.split, lineage: chunk.parentLineage })),
    examples: examples.map(item => ({ id: item.exampleId, hash: item.renderedHash, format: item.format, lineage: item.lineageIds })),
    tokenizer: tokenizerArtifactHash(repo),
    mix: TRAINING_MIX_WEIGHTS,
  }

  const manifest: HardenedCorpusManifest = {
    corpusId: HARDENED_CORPUS_ID,
    predecessor: { corpusId: WAVE8_PREDECESSOR_CORPUS_ID, contentHash: WAVE8_PREDECESSOR_CORPUS_HASH },
    createdAt: now.toISOString(), immutable: true, contentHash: sha256(payload),
    inventoryCounts: summarizeInventory(inventory),
    wrCorpus0UniqueTrainTokens: WR_CORPUS_0_TRAIN_TOKENS,
    wrim0TrainingTokensAfterEpochReuse: WRIM0_TRAINING_TOKENS_AFTER_EPOCH_REUSE,
    documents, chunks: dedup.kept, examples,
    splitCounts, uniqueNewTrainTokens, uniqueNewValidationTokens, uniqueNewTestTokens, totalCandidateTokens,
    byteEstimateTrain: documents.filter(doc => doc.split === 'train').reduce((sum, doc) => sum + doc.estimatedUtf8Tokens, 0),
    tokenizerMethod: counted.method,
    formatDistribution, capabilityDistribution, domainDistribution, qualityDistribution,
    trainingMix: TRAINING_MIX_WEIGHTS,
    trainingMixRationale: 'Raw document mix is code-heavy. Mixing weights upsample scarce materialized behavior, tool-use, and research/evidence so 2000+ source files cannot drown them. Weights are planning proportions of training exposure, not invented capability claims.',
    overrepresentation: {
      topSource, topDomain, topDirectory: topDirectory[0], topCapability,
      topDirectoryShare: documents.length ? topDirectory[1] / documents.length : 0,
    },
    dedup: { exact: dedup.exact, normalized: dedup.normalized },
    leakage,
    engineering: {
      families: engineering.families, choreHeavy: engineering.choreHeavy,
      distinctLineages: engineering.distinctLineages, realToolUse: realToolUseCount(examples),
      commanderCorrections: 0, terraTraining: 0,
    },
    epochs, trainingTokensAfterEpochReuse: uniqueNewTrainTokens * epochs,
  }
  cachedManifest = { repo, manifest }
  return manifest
}

export function tokenizerDomainAnalysis(corpus: HardenedCorpusManifest, repo = process.cwd()) {
  const sample: Record<string, string> = {}
  const pick = (domain: string, predicate: (chunk: ChunkRecord) => boolean) => {
    const chunk = corpus.chunks.find(predicate)
    if (chunk) sample[domain] = chunk.text.slice(0, 800)
  }
  pick('natural_language', chunk => chunk.format === 'language_modeling')
  pick('code', chunk => chunk.format === 'code')
  pick('json', chunk => chunk.format === 'structured_json')
  const tool = corpus.examples.find(item => item.format === 'tool_use')
  if (tool) sample.tool_protocol = tool.renderedTrainingText.slice(0, 800)
  sample.urls = 'https://warroomos.com/api/search?q=terra+coverage https://docs.github.com/en/rest'
  sample.numbers = '317338 2048000 19217152 0.003 512 8 500'
  sample.coordinates = '43.6532,-79.3832 40.7128,-74.0060 validUntil=2026-08-30T19:00:00.000Z'
  sample.science = 'temporal provenance validUntil observationRef predictionRef verificationAt geospatial bounding box'
  sample.legal = 'Commander-owned private repository. No training may start without explicit Commander authorization.'
  const counted = countWithWrTokenizer0(Object.entries(sample).map(([id, text]) => ({ id, text })), repo)
  const categories = Object.entries(sample).map(([category, text]) => ({
    category, chars: text.length, tokens: counted.counts[category]?.tokens ?? 0,
    charsPerToken: counted.counts[category]?.charsPerToken ?? null,
    bytesPerToken: counted.counts[category]?.bytesPerToken ?? null,
  }))
  const pathological = categories.filter(item => item.charsPerToken !== null && item.charsPerToken < 2)
  return {
    tokenizerId: 'WR-TOKENIZER-0' as const,
    tokenizerHash: tokenizerArtifactHash(repo),
    replaced: false as const,
    method: counted.method,
    categories,
    pathologicalFragmentation: pathological.map(item => item.category),
    decision: 'KEEP_WR_TOKENIZER_0' as const,
    decisionRationale: pathological.length
      ? 'JSON/URLs/coordinates fragment more than English. That is expected for WR-TOKENIZER-0. No replacement artifact was trained. EVALUATE_WR_TOKENIZER_1 remains a future namespace if Commander authorizes a measured tokenizer experiment.'
      : 'No pathological fragmentation below 2 chars/token on sampled domains. KEEP_WR_TOKENIZER_0.',
    categoryAnalysis: analyzeTokenizer(repo),
  }
}

export function architectureForCorpus(corpus: HardenedCorpusManifest) {
  return wrim1ArchitectureOptions81({ uniqueTrainTokens: corpus.uniqueNewTrainTokens, epochs: corpus.epochs })
}

export function productionAndTrainingProof(repo = process.cwd()) {
  return { production: verifyProductionUntouched(repo), training: verifyTrainingNotStarted(repo) }
}
