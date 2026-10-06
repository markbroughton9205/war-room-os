import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { runSourceFabricWave3 } from '../lib/planetary-intelligence/wave3Run.ts'
import { planetaryLiveStoreDir } from '../lib/planetary-intelligence/livePersistence.ts'
import { defaultWave2Fetch } from '../lib/planetary-intelligence/endpointActivate.ts'

function startingCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return 'UNKNOWN'
  }
}

const result = await runSourceFabricWave3({
  fetchImpl: defaultWave2Fetch,
  nowIso: new Date().toISOString(),
  skipSearxng: false,
  spacingMs: 250,
})

const report = {
  1: result.startingSources,
  2: result.startingLive,
  3: result.investigated,
  4: result.added,
  5: result.endpointsDiscovered,
  6: result.newLive,
  7: result.documents,
  8: Object.fromEntries(result.cells.map(item => [item.cell, item.qualifyingDocuments])),
  9: Object.fromEntries(result.cells.map(item => [item.cell, item.rejectedDocuments])),
  10: Object.fromEntries(result.cells.map(item => [item.cell, item.rejectionReasons])),
  11: Object.fromEntries(result.cells.map(item => [item.cell, item.sourceClassMatched])),
  12: Object.fromEntries(result.cells.map(item => [item.cell, item.languageMatched])),
  13: Object.fromEntries(result.cells.map(item => [item.cell, item.geographyMatched])),
  14: Object.fromEntries(result.cells.map(item => [item.cell, item.topicMatched])),
  15: result.independentOrigins,
  16: result.sharedOriginDocuments,
  17: result.transientInspected,
  18: result.fullTextArchived === 0,
  19: result.cells.map(item => ({
    cell: item.cell,
    source: { before: item.sourceBefore, after: item.sourceAfter },
    endpoint: { before: item.endpointBefore, after: item.endpointAfter },
    document: item.documentAfter,
    coverage: { before: item.coverageBefore, after: item.coverageAfter },
  })),
  20: result.cells.filter(item => item.coverageAfter === 'WEAK').map(item => item.cell),
  21: result.cells.filter(item => item.coverageAfter === 'COVERED').map(item => item.cell),
  22: result.cells.filter(item => item.coverageAfter === 'MISSING').map(item => item.cell),
  23: result.cells.filter(item => item.coverageAfter === 'BLOCKED').map(item => item.cell),
  24: 'RUN_SEPARATELY',
  25: 'see git status for planetary-intelligence wave3 files',
  26: 'NOT COMMITTED',
  27: 'WRIM untouched this pass',
  28: 'Foundry untouched this pass',
  29: result.auroraNoFirstPass,
  30: 'nothing pushed',
  31: 'nothing deployed',
  32: 'nothing installed',
  classification: result.classification,
  searxng: result.searxng,
  startingCommit: startingCommit(),
  cells: result.cells,
}

const outDir = planetaryLiveStoreDir()
mkdirSync(outDir, { recursive: true })
writeFileSync(path.join(outDir, 'wave3-report.json'), JSON.stringify(report, null, 2), 'utf8')

console.log('# WAR ROOM PLANETARY SOURCE FABRIC WAVE 3 REPORT')
for (let i = 1; i <= 32; i += 1) {
  console.log(`\n${i}.`)
  console.log(typeof report[i] === 'string' || typeof report[i] === 'number' || typeof report[i] === 'boolean' ? String(report[i]) : JSON.stringify(report[i], null, 2))
}
console.log(`\nFINAL CLASSIFICATION:\n${result.classification}`)
