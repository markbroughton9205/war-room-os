import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { evaluateWave81Gate } from '../lib/wrim1-dataset/gate81.ts'
import { buildTerraEvalExamples81 } from '../lib/wrim1-dataset/behavior.ts'
import { HARDENED_CORPUS_ID } from '../lib/wrim1-dataset/types.ts'

const repo = process.cwd()
const outputDir = join(repo, 'model-lab', 'manifests', 'wave8_1')
const frozenPath = join(outputDir, 'corpus-manifest.json')
if (existsSync(frozenPath)) {
  const frozen = JSON.parse(await readFile(frozenPath, 'utf8')) as { corpusId?: string; contentHash?: string }
  if (frozen.corpusId === HARDENED_CORPUS_ID && frozen.contentHash === '76ddac51d8132b375e541723045f89714fe060d04a88a5ef51373319d4cdbd27') {
    console.error('refusing to overwrite frozen Wave 8.1 corpus-manifest.json (WR-CORPUS-1-HARDENED-CANDIDATE)')
    process.exit(1)
  }
}
await mkdir(outputDir, { recursive: true })
const snap = evaluateWave81Gate(repo)

const corpusSummary = {
  corpusId: snap.corpus.corpusId,
  contentHash: snap.corpus.contentHash,
  createdAt: snap.corpus.createdAt,
  predecessor: snap.corpus.predecessor,
  immutable: true,
  inventoryCounts: snap.corpus.inventoryCounts,
  wrCorpus0UniqueTrainTokens: snap.corpus.wrCorpus0UniqueTrainTokens,
  wrim0TrainingTokensAfterEpochReuse: snap.corpus.wrim0TrainingTokensAfterEpochReuse,
  uniqueNewTrainTokens: snap.corpus.uniqueNewTrainTokens,
  uniqueNewValidationTokens: snap.corpus.uniqueNewValidationTokens,
  uniqueNewTestTokens: snap.corpus.uniqueNewTestTokens,
  totalCandidateTokens: snap.corpus.totalCandidateTokens,
  byteEstimateTrain: snap.corpus.byteEstimateTrain,
  tokenizerMethod: snap.corpus.tokenizerMethod,
  epochs: snap.corpus.epochs,
  trainingTokensAfterEpochReuse: snap.corpus.trainingTokensAfterEpochReuse,
  formatDistribution: snap.corpus.formatDistribution,
  capabilityDistribution: snap.corpus.capabilityDistribution,
  domainDistribution: snap.corpus.domainDistribution,
  qualityDistribution: snap.corpus.qualityDistribution,
  splitCounts: snap.corpus.splitCounts,
  trainingMix: snap.corpus.trainingMix,
  trainingMixRationale: snap.corpus.trainingMixRationale,
  overrepresentation: snap.corpus.overrepresentation,
  dedup: snap.corpus.dedup,
  leakage: {
    passed: snap.corpus.leakage.passed,
    exactChunkDuplicates: snap.corpus.leakage.exactChunkDuplicates,
    normalizedDuplicates: snap.corpus.leakage.normalizedDuplicates,
    nearDuplicatePairs: snap.corpus.leakage.nearDuplicatePairs,
    sourceLineageCrossSplit: snap.corpus.leakage.sourceLineageCrossSplit,
    heldOutCollisions: snap.corpus.leakage.heldOutCollisions,
  },
  engineering: snap.corpus.engineering,
  documentCount: snap.corpus.documents.length,
  chunkCount: snap.corpus.chunks.length,
  exampleCount: snap.corpus.examples.length,
  documents: snap.corpus.documents,
  chunks: snap.corpus.chunks.map(chunk => ({
    chunkId: chunk.chunkId, documentId: chunk.documentId, sourceId: chunk.sourceId, sourceHash: chunk.sourceHash,
    parentLineage: chunk.parentLineage, path: chunk.path, offsetStart: chunk.offsetStart, offsetEnd: chunk.offsetEnd,
    contentHash: chunk.contentHash, normalizedHash: chunk.normalizedHash, capabilityTags: chunk.capabilityTags,
    format: chunk.format, qualityTier: chunk.qualityTier, split: chunk.split, byteLength: chunk.byteLength,
    tokenizerTokens: chunk.tokenizerTokens,
  })),
}

await writeFile(join(outputDir, 'corpus-manifest.json'), `${JSON.stringify(corpusSummary, null, 2)}\n`)
await writeFile(join(outputDir, 'behavior-examples.json'), `${JSON.stringify({
  count: snap.corpus.examples.length,
  examples: snap.corpus.examples.map(item => ({
    exampleId: item.exampleId, format: item.format, qualityTier: item.qualityTier, trainability: item.trainability,
    capabilityTags: item.capabilityTags, input: item.input, contextRefs: item.contextRefs, evidenceRefs: item.evidenceRefs,
    toolActions: item.toolActions, toolResults: item.toolResults, response: item.finalResponse,
    validator: item.validatorSpec, outcome: item.outcome, claimStatus: item.claimStatus ?? null,
    capability_tags: item.capabilityTags, source_lineage: item.lineageIds, provenance: item.provenance,
    renderedTrainingText: item.renderedTrainingText, renderedHash: item.renderedHash, engineeringFamily: item.engineeringFamily ?? null,
  })),
}, null, 2)}\n`)
await writeFile(join(outputDir, 'held-out-eval-suite.json'), `${JSON.stringify({ items: snap.evals }, null, 2)}\n`)
await writeFile(join(outputDir, 'wrim0-baseline.json'), `${JSON.stringify({
  parentCheckpointHash: snap.parentCheckpointHash, results: snap.baseline, fabricatedScores: false,
}, null, 2)}\n`)
await writeFile(join(outputDir, 'tokenizer-analysis.json'), `${JSON.stringify(snap.tokenizer, null, 2)}\n`)
await writeFile(join(outputDir, 'architecture-options.json'), `${JSON.stringify(snap.options, null, 2)}\n`)
await writeFile(join(outputDir, 'training-mix.json'), `${JSON.stringify({
  weights: snap.corpus.trainingMix, rationale: snap.corpus.trainingMixRationale, overrepresentation: snap.corpus.overrepresentation,
}, null, 2)}\n`)
await writeFile(join(outputDir, 'wave81-gate.json'), `${JSON.stringify({
  gate: snap.gate, proof: snap.proof, terraEvalOnly: buildTerraEvalExamples81().length, trainingStarted: false, wave9Started: false,
}, null, 2)}\n`)

console.log(JSON.stringify({
  passed: snap.gate.passed,
  deficiencies: snap.gate.deficiencies,
  corpusId: snap.corpus.corpusId,
  contentHash: snap.corpus.contentHash,
  uniqueNewTrainTokens: snap.corpus.uniqueNewTrainTokens,
  uniqueNewValidationTokens: snap.corpus.uniqueNewValidationTokens,
  uniqueNewTestTokens: snap.corpus.uniqueNewTestTokens,
  totalCandidateTokens: snap.corpus.totalCandidateTokens,
  documents: snap.corpus.documents.length,
  chunks: snap.corpus.chunks.length,
  examples: snap.corpus.examples.length,
  realToolUse: snap.corpus.engineering.realToolUse,
  families: snap.corpus.engineering.families,
  leakagePassed: snap.corpus.leakage.passed,
  trainingStarted: false,
  wave9Started: false,
}, null, 2))
