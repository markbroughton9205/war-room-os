import { PlanetaryRegistryStore } from '../lib/planetary-intelligence/registryStore.ts'
import { hydrateObservedDocuments } from '../lib/planetary-intelligence/documentIngest.ts'
import { qualifyObservedDocument } from '../lib/planetary-intelligence/observedCoverage.ts'
import { WAVE4_PRIORITY_CELLS, cellLabel } from '../lib/planetary-intelligence/wave4Cells.ts'
import { classifyFromLawfulMetadata } from '../lib/planetary-intelligence/observedTopic.ts'

const nowIso = new Date().toISOString()
const store = new PlanetaryRegistryStore()
const rows = store.listDocuments()
const sources = store.listSources()
const endpoints = store.listEndpoints()
const docs = hydrateObservedDocuments({ rows, sources, endpoints })

function coverageStatus(qualifying) {
  const origins = new Set(qualifying.map(doc => doc.independentOriginId).filter(Boolean))
  if (qualifying.length === 0 || origins.size === 0) return 'MISSING'
  if (origins.size < 2 || qualifying.length < 2) return 'WEAK'
  return 'COVERED'
}

for (const cell of WAVE4_PRIORITY_CELLS) {
  const evaluations = docs.map(doc => ({ doc, result: qualifyObservedDocument(doc, {
    geography: cell.geography,
    topic: cell.topic,
    language: cell.language,
    sourceType: cell.sourceType,
  }, nowIso, cell.windowHours) }))
  const qualifying = evaluations.filter(row => row.result.ok).map(row => row.doc)
  const origins = [...new Set(qualifying.map(doc => doc.independentOriginId).filter(Boolean))]
  console.log(JSON.stringify({
    cell: cellLabel(cell),
    coverage: coverageStatus(qualifying),
    qualifying: qualifying.length,
    origins: origins.length,
    originIds: origins,
    titles: qualifying.slice(0, 6).map(doc => ({ title: doc.title, origin: doc.independentOriginId, lang: doc.detectedLanguage, topic: doc.topic, cls: doc.sourceClass })),
  }, null, 2))
}

store.close()
