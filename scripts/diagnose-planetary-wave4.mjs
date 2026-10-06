import { PlanetaryRegistryStore } from '../lib/planetary-intelligence/registryStore.ts'
import { documentsToRetrieved } from '../lib/planetary-intelligence/documentIngest.ts'
import { qualifyObservedDocument } from '../lib/planetary-intelligence/observedCoverage.ts'
import { WAVE3_PRIORITY_CELLS, cellLabel } from '../lib/planetary-intelligence/wave3Cells.ts'
import { classifyFromLawfulMetadata } from '../lib/planetary-intelligence/observedTopic.ts'

const nowIso = new Date().toISOString()
const store = new PlanetaryRegistryStore()
const sources = store.listSources()
const endpoints = store.listEndpoints()
const docs = documentsToRetrieved(store.listDocuments())
const cells = WAVE3_PRIORITY_CELLS.filter(cell => cell.gapKey !== 'hi-econ')

function dimFail(reasons) {
  const dims = { geography: 0, topic: 0, language: 0, sourceClass: 0, freshness: 0, englishFallback: 0, other: 0 }
  for (const reason of reasons) {
    if (reason.startsWith('geography')) dims.geography += 1
    else if (reason.startsWith('topic')) dims.topic += 1
    else if (reason.startsWith('language_und') || reason.startsWith('language_mismatch')) dims.language += 1
    else if (reason.startsWith('source_class')) dims.sourceClass += 1
    else if (reason.startsWith('freshness')) dims.freshness += 1
    else if (reason.startsWith('english_fallback')) dims.englishFallback += 1
    else dims.other += 1
  }
  return dims
}

const out = []
for (const cell of cells) {
  const matchingSources = sources.filter(source =>
    source.gapPriority === cell.gapKey
    || (source.region === cell.geography && source.primaryLanguage === cell.language && (source.sourceType === cell.sourceType || source.sourceRole === 'OFFICIAL' || source.sourceRole === 'WEATHER' || source.sourceRole === 'TRADE' || source.sourceRole === 'SCIENTIFIC' || source.sourceRole === 'HEALTH' || source.sourceRole === 'PUBLIC_SAFETY'))
  )
  const cellSources = sources.filter(source =>
    source.region === cell.geography && (source.primaryLanguage === cell.language || (source.supportedLanguages || []).includes(cell.language))
  )
  const live = endpoints.filter(ep => ep.activationState === 'LIVE' && cellSources.some(s => s.sourceId === ep.sourceId))
  const nearDocs = docs.filter(doc =>
    doc.sourceCoverageGeography === cell.geography
    || doc.detectedLanguage === cell.language
    || doc.sourceClass === cell.sourceType
  )
  const evals = docs.map(doc => ({ doc, result: qualifyObservedDocument(doc, cell, nowIso, cell.windowHours) }))
  const qualifying = evals.filter(row => row.result.ok)
  const close = evals.filter(row => {
    const r = row.result.reasons
    const fails = r.length
    return fails > 0 && fails <= 2 && (
      row.doc.sourceCoverageGeography === cell.geography
      || row.doc.detectedLanguage === cell.language
      || row.doc.sourceClass === cell.sourceType
    )
  }).slice(0, 8).map(row => ({
    title: row.doc.title,
    lang: row.doc.detectedLanguage,
    geo: row.doc.sourceCoverageGeography,
    class: row.doc.sourceClass,
    topic: row.doc.topic || classifyFromLawfulMetadata({ title: row.doc.title }).topic,
    publishedAt: row.doc.publishedAt,
    origin: row.doc.independentOriginId,
    publisher: row.doc.publisher,
    reasons: row.result.reasons,
    url: row.doc.canonicalUrl,
  }))
  const nearClass = docs.filter(doc => doc.sourceClass === cell.sourceType).slice(0, 6).map(doc => ({
    title: doc.title, lang: doc.detectedLanguage, geo: doc.sourceCoverageGeography, topic: doc.topic, class: doc.sourceClass, publishedAt: doc.publishedAt, origin: doc.independentOriginId, url: doc.canonicalUrl,
  }))
  out.push({
    cell: cellLabel(cell),
    gapKey: cell.gapKey,
    matchingSourceCount: matchingSources.length,
    sources: matchingSources.slice(0, 12).map(s => ({ id: s.sourceId, name: s.canonicalName, type: s.sourceType, lang: s.primaryLanguage, region: s.region, domain: s.canonicalDomain })),
    liveEndpoints: live.map(ep => ({ id: ep.endpointId, sourceId: ep.sourceId, type: ep.endpointType, url: ep.url, items: ep.itemCount, state: ep.activationState })),
    docsTotal: docs.length,
    nearDocs: nearDocs.length,
    qualifying: qualifying.length,
    origins: [...new Set(qualifying.map(row => row.doc.independentOriginId))],
    dimFails: dimFail(evals.flatMap(row => row.result.reasons)),
    closeCalls: close,
    sameClassDocs: nearClass,
  })
}

store.close()
console.log(JSON.stringify(out, null, 2))
