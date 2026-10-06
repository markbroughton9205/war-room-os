import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { runSourceFabricWave4 } from '../lib/planetary-intelligence/wave4Run.ts'
import { planetaryLiveStoreDir } from '../lib/planetary-intelligence/livePersistence.ts'
import { defaultWave2Fetch } from '../lib/planetary-intelligence/endpointActivate.ts'

function startingCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return 'UNKNOWN'
  }
}

const result = await runSourceFabricWave4({
  fetchImpl: defaultWave2Fetch,
  nowIso: new Date().toISOString(),
  skipSearxng: false,
  spacingMs: 250,
})

const report = {
  1: result.startingSources,
  2: Object.fromEntries(result.cells.map(item => [item.cell, {
    coverageBefore: item.coverageBefore,
    diagnosis: item.diagnosis,
  }])),
  3: Object.fromEntries(result.cells.map(item => [item.cell, item.existingEndpointsReused])),
  4: 'classifier/parser repairs in languageTruth, observedTopic, documentSourceClass, documentsToRetrieved, registryStore',
  5: result.investigated,
  6: result.added,
  7: result.newLive,
  8: Object.fromEntries(result.cells.map(item => [item.cell, item.qualifyingDocuments])),
  9: Object.fromEntries(result.cells.map(item => [item.cell, item.independentOrigins])),
  10: Object.fromEntries(result.cells.map(item => [item.cell, item.rejectedDocuments])),
  11: Object.fromEntries(result.cells.map(item => [item.cell, item.rejectionReasons])),
  12: result.cells.find(item => item.gapKey === 'ja-infra') ?? null,
  13: result.cells.find(item => item.gapKey === 'sw-health') ?? null,
  14: result.cells.find(item => item.gapKey === 'ar-safety') ?? null,
  15: result.cells.find(item => item.gapKey === 'de-energy') ?? null,
  16: result.cells.find(item => item.gapKey === 'es-science') ?? null,
  17: result.cells.find(item => item.gapKey === 'oceania-weather') ?? null,
  18: result.transientInspected,
  19: result.fullTextArchived === 0,
  20: result.cells.filter(item => item.coverageAfter === 'WEAK').map(item => item.cell),
  21: result.cells.filter(item => item.coverageAfter === 'COVERED').map(item => item.cell),
  22: result.cells.filter(item => item.coverageAfter === 'MISSING').map(item => item.cell),
  23: result.cells.filter(item => item.coverageAfter === 'BLOCKED').map(item => item.cell),
  24: 'RUN_SEPARATELY',
  25: 'see git status for planetary-intelligence wave4 files',
  26: 'NOT COMMITTED',
  27: 'WRIM untouched this pass',
  28: 'Foundry untouched this pass',
  29: 'Terra UX untouched this pass',
  30: result.auroraNoFirstPass,
  31: 'nothing pushed',
  32: 'nothing deployed',
  33: 'nothing installed',
  classification: result.classification,
  searxng: result.searxng,
  startingCommit: startingCommit(),
  cells: result.cells,
  inspectBeforeExpand: result.inspectBeforeExpand,
}

const outDir = planetaryLiveStoreDir()
mkdirSync(outDir, { recursive: true })
writeFileSync(path.join(outDir, 'wave4-report.json'), JSON.stringify(report, null, 2), 'utf8')

console.log('# WAR ROOM PLANETARY SOURCE FABRIC WAVE 4 REPORT')
for (let i = 1; i <= 33; i += 1) {
  console.log(`\n${i}.`)
  console.log(typeof report[i] === 'string' || typeof report[i] === 'number' || typeof report[i] === 'boolean' ? String(report[i]) : JSON.stringify(report[i], null, 2))
}
console.log(`\nFINAL CLASSIFICATION:\n${result.classification}`)
