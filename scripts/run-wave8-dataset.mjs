import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { evaluateWave8Gate } from '../lib/wrim1-dataset/gate.ts'
import { inventoryWrim1Dataset } from '../lib/wrim1-dataset/inventory.ts'

const repo = process.cwd()
const outputDir = join(repo, 'model-lab', 'manifests', 'wave8')
await mkdir(outputDir, { recursive: true })
const snap = evaluateWave8Gate(repo)
const inventory = inventoryWrim1Dataset(repo)
const corpusSummary = {
  corpusId: snap.corpus.corpusId, contentHash: snap.corpus.contentHash, createdAt: snap.corpus.createdAt,
  predecessor: snap.corpus.predecessor, immutable: true, trainingStarted: false,
  inventoryCounts: snap.corpus.inventoryCounts, uniqueNewSourceTokens: snap.corpus.uniqueNewSourceTokens,
  uniqueInheritedSourceTokens: snap.corpus.uniqueInheritedSourceTokens, uniqueSourceTokensTotal: snap.corpus.uniqueSourceTokensTotal,
  trainingTokensAfterEpochReuseEstimate: snap.corpus.trainingTokensAfterEpochReuseEstimate, epochsAssumed: snap.corpus.epochsAssumed,
  formatDistribution: snap.corpus.formatDistribution, capabilityDistribution: snap.corpus.capabilityDistribution,
  qualityDistribution: snap.corpus.qualityDistribution, splitCounts: snap.corpus.splitCounts, splitTokens: snap.corpus.splitTokens,
  dedup: snap.corpus.dedup, documentCount: snap.corpus.documents.length,
  documents: snap.corpus.documents.map(doc => ({
    documentId: doc.documentId, path: doc.path, format: doc.format, split: doc.split,
    uniqueSourceTokens: doc.uniqueSourceTokens, inheritedFromWrCorpus0: doc.inheritedFromWrCorpus0,
    contentHash: doc.contentHash, qualityTier: doc.qualityTier, lineageId: doc.lineageId,
  })),
}
await writeFile(join(outputDir, 'corpus-manifest.json'), `${JSON.stringify(corpusSummary, null, 2)}\n`)
await writeFile(join(outputDir, 'held-out-eval-suite.json'), `${JSON.stringify({ items: snap.evals, leakage: snap.leakage }, null, 2)}\n`)
await writeFile(join(outputDir, 'wrim0-baseline.json'), `${JSON.stringify({ parentCheckpointHash: inventory.parentCheckpointHash, results: snap.baseline, fabricatedScores: false, trainingStarted: false }, null, 2)}\n`)
await writeFile(join(outputDir, 'tokenizer-analysis.json'), `${JSON.stringify(snap.tokenizer, null, 2)}\n`)
await writeFile(join(outputDir, 'architecture-options.json'), `${JSON.stringify(snap.options, null, 2)}\n`)
await writeFile(join(outputDir, 'evidence-summary.json'), `${JSON.stringify({
  count: snap.evidence.records.length,
  pass: snap.evidence.records.filter(record => record.evidence.outcome === 'pass').length,
  fail: snap.evidence.records.filter(record => record.evidence.outcome === 'fail').length,
  distinctLineages: snap.evidence.distinctLineages,
  distinctValidatorTypes: snap.evidence.distinctValidatorTypes,
  sources: {
    code_operator: snap.evidence.records.filter(record => record.source === 'code_operator').length,
    tool_use: snap.evidence.records.filter(record => record.source === 'tool_use').length,
  },
  capabilityTags: [...new Set(snap.evidence.records.flatMap(record => record.capabilityTags))].sort(),
  researchExamples: snap.researchExamples.map(item => ({ id: item.exampleId, claimStatus: item.claimStatus, trainability: item.trainability })),
  worldLearningExamples: snap.worldLearningExamples.map(item => ({ id: item.exampleId, capabilityTags: item.capabilityTags })),
  commanderCorrections: snap.commanderCorrections.length,
  terraEvalOnly: snap.terraEvalExamples.length,
}, null, 2)}\n`)
await writeFile(join(outputDir, 'wave8-gate.json'), `${JSON.stringify({
  gate: snap.gate, inventory, reproducibilityHash: snap.reproducibilityHash, trainingStarted: false, wave9Started: false,
}, null, 2)}\n`)
console.log(JSON.stringify({
  passed: snap.gate.passed, corpusId: snap.corpus.corpusId, contentHash: snap.corpus.contentHash,
  uniqueNewSourceTokens: snap.corpus.uniqueNewSourceTokens, documents: snap.corpus.documents.length,
  evidencePass: snap.evidence.records.filter(record => record.evidence.outcome === 'pass').length,
  trainingStarted: false, wave9Started: false,
}, null, 2))
