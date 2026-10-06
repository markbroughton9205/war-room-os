import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { PlanetaryRegistryStore } from '../lib/planetary-intelligence/registryStore.ts'
import { documentsToRetrieved } from '../lib/planetary-intelligence/documentIngest.ts'
import { explainPriorityCells } from '../lib/planetary-intelligence/observedCoverage.ts'
import { promptGapCells } from '../lib/planetary-intelligence/gapPrompt.ts'
import { planetaryLiveStoreDir } from '../lib/planetary-intelligence/livePersistence.ts'

const nowIso = new Date().toISOString()
const store = new PlanetaryRegistryStore()
const docs = documentsToRetrieved(store.listDocuments())
const sources = store.listSources()
const endpoints = store.listEndpoints()
const explanations = explainPriorityCells({ documents: docs, sources, endpoints, nowIso })
const prompts = promptGapCells(
  explanations.map(item => ({
    cellId: item.cell,
    geography: item.cell.split(' × ')[0],
    topic: item.cell.split(' × ')[1],
    language: item.cell.split(' × ')[2],
    sourceType: item.cell.split(' × ')[3],
    time: 'today',
    evidenceQuality: 'PRIMARY_EVIDENCE',
    claims: item.qualifyingDocumentCount,
    independentOrigins: item.independentOriginCount,
    freshestEvidence: null,
    qualityDistribution: {},
    verification: 'NONE',
    status: item.status,
    qualifyingDocumentCount: item.qualifyingDocumentCount,
    languageMatchedCount: item.languageMatchedCount,
    geographyMatchedCount: item.geographyMatchedCount,
    sourceClassMatchedCount: item.sourceClassMatchedCount,
    rejectionReasons: item.rejectionReasons,
    explanation: item.explanation,
  })),
)
const live = endpoints.filter(item => item.activationState === 'LIVE')
const originIds = docs.map(doc => doc.independentOriginId).filter(Boolean)
const uniqueOrigins = new Set(originIds)
const sharedOriginDocs = originIds.length - uniqueOrigins.size
const topics = {}
for (const doc of docs) {
  const topic = doc.observedTopic || 'none'
  topics[topic] = (topics[topic] ?? 0) + 1
}
const retention = {}
for (const row of store.listDocuments()) {
  const mode = String(row.retention_mode ?? 'UNKNOWN')
  retention[mode] = (retention[mode] ?? 0) + 1
}
const payload = {
  nowIso,
  documents: docs.length,
  storyClusters: store.listStoryClusters().length,
  liveEndpoints: live.length,
  liveByType: live.reduce((acc, item) => {
    acc[item.endpointType] = (acc[item.endpointType] ?? 0) + 1
    return acc
  }, {}),
  uniqueIndependentOrigins: uniqueOrigins.size,
  documentsSharingAnOrigin: sharedOriginDocs,
  topics,
  retention,
  explanations,
  gapPrompts: prompts.length,
  improved: explanations.filter(item => item.status === 'WEAK' || item.status === 'COVERED').map(item => item.cell),
  stillMissing: explanations.filter(item => item.status === 'MISSING' || item.status === 'NOT_ASSESSED').map(item => item.cell),
}
writeFileSync(path.join(planetaryLiveStoreDir(), 'wave2-coverage-recount.json'), JSON.stringify(payload, null, 2), 'utf8')
store.close()
console.log(JSON.stringify({
  documents: payload.documents,
  storyClusters: payload.storyClusters,
  liveEndpoints: payload.liveEndpoints,
  liveByType: payload.liveByType,
  uniqueIndependentOrigins: payload.uniqueIndependentOrigins,
  documentsSharingAnOrigin: payload.documentsSharingAnOrigin,
  topics: payload.topics,
  retention: payload.retention,
  improved: payload.improved,
  stillMissing: payload.stillMissing,
  cells: payload.explanations.map(item => ({
    cell: item.cell,
    sourceLayer: item.sourceLayer,
    endpointLayer: item.endpointLayer,
    documentLayer: item.documentLayer,
    status: item.status,
    qualifyingDocumentCount: item.qualifyingDocumentCount,
    independentOriginCount: item.independentOriginCount,
    languageMatchedCount: item.languageMatchedCount,
    geographyMatchedCount: item.geographyMatchedCount,
    sourceClassMatchedCount: item.sourceClassMatchedCount,
    explanation: item.explanation,
  })),
}, null, 2))
