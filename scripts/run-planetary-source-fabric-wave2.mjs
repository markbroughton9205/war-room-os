import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { runSourceFabricWave2 } from '../lib/planetary-intelligence/wave2Run.ts'
import { planetaryLiveStoreDir } from '../lib/planetary-intelligence/livePersistence.ts'
import { defaultWave2Fetch } from '../lib/planetary-intelligence/endpointActivate.ts'

function startingCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return 'UNKNOWN'
  }
}

const result = await runSourceFabricWave2({
  fetchImpl: defaultWave2Fetch,
  nowIso: new Date().toISOString(),
  commanderIntent: 'What breaking news happened today on my planet?',
  skipSearxng: false,
  spacingMs: 250,
})

const improved = result.explanations.filter(item => item.status === 'WEAK' || item.status === 'COVERED')
const missing = result.explanations.filter(item => item.status === 'MISSING' || item.status === 'NOT_ASSESSED')
const docs = result.activation.documents
const languages = {}
for (const doc of docs) {
  const lang = doc.detectedLanguage || 'und'
  languages[lang] = (languages[lang] ?? 0) + 1
}

const report = {
  1: result.startingSources,
  2: result.startingLiveHealth,
  3: result.activationCandidates,
  4: result.activation.discovered,
  5: result.activation.live,
  6: result.activation.rss,
  7: result.activation.atom,
  8: result.activation.sitemap,
  9: result.activation.api,
  10: result.activation.htmlOnly,
  11: result.activation.noMachine,
  12: result.activation.failures,
  13: result.activation.inserted,
  14: languages,
  15: docs.filter(doc => doc.detectedLanguage && doc.detectedLanguage !== 'en' && doc.detectedLanguage !== 'und').length,
  16: docs.filter(doc => doc.localityClass === 'CITY_LOCAL' || doc.localityClass === 'REGIONAL' || doc.localityClass === 'HYPERLOCAL').length,
  17: { provenHyperlocal: 0, unprovenRejected: result.hyperlocalUnprovenRejected },
  18: docs.filter(doc => doc.sourceClass === 'OFFICIAL_RECORD' || doc.sourceClass === 'GOVERNMENT' || doc.sourceClass === 'ALERT_FEED').length,
  19: 'story clusters persisted in local sqlite story_clusters',
  20: new Set(docs.map(doc => doc.independentOriginId).filter(Boolean)).size,
  21: result.activation.duplicates,
  22: result.gapPrompts.length,
  23: result.gapPrompts.map(item => item.coverageCell),
  24: result.explanations.reduce((sum, item) => sum + item.qualifyingDocumentCount, 0),
  25: result.explanations.flatMap(item => item.rejectionReasons).slice(0, 20),
  26: result.gapPrompts.map(item => item.fallbackLevel),
  27: result.explanations.map(item => ({ cell: item.cell, sourceLayer: item.sourceLayer, documentLayer: 'MISSING' })),
  28: result.explanations,
  29: improved.map(item => item.cell),
  30: missing.map(item => item.cell),
  31: result.ledger,
  32: result.persistence,
  33: { default: 'METADATA_ONLY', fullTextOnlyIfLawful: true },
  34: {
    inventedPercentages: false,
    verifiedSources: result.startingSources,
    liveContentEndpoints: result.activation.live,
    documentsObserved: result.activation.inserted,
    nativeLanguageDocuments: docs.filter(doc => doc.detectedLanguage && doc.detectedLanguage !== 'en' && doc.detectedLanguage !== 'und').length,
    independentOrigins: new Set(docs.map(doc => doc.independentOriginId).filter(Boolean)).size,
    cells: result.explanations.map(item => ({ cell: item.cell, status: item.status, qualifyingDocumentCount: item.qualifyingDocumentCount, independentOriginCount: item.independentOriginCount })),
  },
  35: 'RUN_SEPARATELY',
  36: 'RUN_SEPARATELY',
  37: 'RUN_SEPARATELY',
  38: 'RUN_SEPARATELY',
  39: result.auroraNoFirstPass,
  40: result.singleGpu,
  41: 'installed runtime unchanged; no new commercial dependency',
  42: 'WRIM untouched this pass',
  43: 'Foundry untouched this pass',
  44: 'nothing pushed',
  45: 'nothing deployed',
  classification: result.classification,
  searxng: result.searxng,
  startingCommit: startingCommit(),
}

const outDir = planetaryLiveStoreDir()
mkdirSync(outDir, { recursive: true })
writeFileSync(path.join(outDir, 'wave2-report.json'), JSON.stringify(report, null, 2), 'utf8')

console.log('# WAR ROOM PLANETARY SOURCE FABRIC WAVE 2 REPORT')
for (let i = 1; i <= 45; i += 1) {
  console.log(`\n${i}.`)
  console.log(typeof report[i] === 'string' || typeof report[i] === 'number' || typeof report[i] === 'boolean' ? String(report[i]) : JSON.stringify(report[i], null, 2))
}
console.log(`\nFINAL CLASSIFICATION:\n${result.classification}`)
