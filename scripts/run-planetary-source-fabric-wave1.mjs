import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { runSourceFabricWave1 } from '../lib/planetary-intelligence/wave1Run.ts'
import { wave1Catalog, catalogEnglishShare, catalogUsUkShare } from '../lib/planetary-intelligence/wave1Catalog.ts'
import { LOCAL_FILESYSTEM_FALLBACK, planetaryLiveStoreDir } from '../lib/planetary-intelligence/livePersistence.ts'

function startingCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return 'UNKNOWN'
  }
}

const catalog = wave1Catalog()
const result = await runSourceFabricWave1({
  wikidata: true,
  healthLimit: 40,
  nowIso: new Date().toISOString(),
})

const report = {
  1: startingCommit(),
  2: 'Reuse canonical War Room local infrastructure: node:sqlite under .war-room/planetary-intelligence. Not hosted supabase.co. Not PlanetaryDB2 / TerraDB2 / SearchDB2. Mission JSON remains LOCAL_FILESYSTEM_FALLBACK.',
  3: result.persistence,
  4: 'sources + publishers + parent_companies + verification/discovery/health events',
  5: 'endpoints: type/url/status/etag/last_modified/poll/error — SOURCE URL != ENDPOINT URL; HTML homepage is a placeholder, not a LIVE claim',
  6: 'publisher_id and parent_company_id are separate; independent origin groups by parent',
  7: ['official_broadcast_university_directory', 'scientific_directory', 'trusted_rss', 'wikidata_sparql_newspaper (bounded, optional)'],
  8: result.candidatesDiscovered,
  9: result.candidatesVerified,
  10: result.liveSources,
  11: result.liveEndpoints,
  12: { duplicates: result.duplicates, rejected: result.rejected, statusBreakdown: result.statusBreakdown },
  13: result.facts.byContinent,
  14: result.facts.byCountry,
  15: result.facts.locality,
  16: result.facts.byLanguage,
  17: result.facts.nativeLanguageSources,
  18: result.facts.localSourceCount,
  19: result.facts.officialSources,
  20: result.facts.scienceSources,
  21: result.facts.independentOwnershipCount,
  22: 'No documents ingested this wave. Origin grouping is by parent/publisher. Existing syndication/origin clustering is unchanged and was not used to inflate source counts.',
  23: { liveEndpoints: result.liveEndpoints, freshSourceCount: result.facts.freshSourceCount, liveSources: result.liveSources },
  24: 'Cadence from freshness/source role: emergency ~180s, city/local ~3600s, academic ~86400s, default ~900s',
  25: 'Official sources robotsPolicy=ALLOWED; others UNKNOWN until fetched. No hammering. Conditional GET. 250ms spacing. HTML homepage reachability does not mark LIVE.',
  26: { metadataOnlyCount: result.facts.metadataOnlyCount, fullTextLawfulCount: result.facts.fullTextLawfulCount },
  27: { metadataOnlyCount: result.facts.metadataOnlyCount, fullTextLawfulCount: result.facts.fullTextLawfulCount, missionFallback: LOCAL_FILESYSTEM_FALLBACK },
  28: result.searxng,
  29: result.facts.coverageGaps.map(gap => ({ cell: gap.cell, before: gap.before })),
  30: result.facts.coverageGaps,
  31: result.facts.coverageGaps.filter(gap => gap.sourceLayer === 'PRESENT').map(gap => gap.cell),
  32: result.facts.coverageGaps.filter(gap => gap.sourceLayer === 'ABSENT').map(gap => gap.cell),
  33: { inventedPercentages: result.facts.inventedPercentages, sourceCount: result.facts.sourceCount, freshSourceCount: result.facts.freshSourceCount, localSourceCount: result.facts.localSourceCount, languageCount: result.facts.languageCount, sourceTypeCount: result.facts.sourceTypeCount, independentOwnershipCount: result.facts.independentOwnershipCount, coverageGaps: result.facts.coverageGaps },
  34: 'RUN_SEPARATELY',
  35: 'RUN_SEPARATELY',
  36: 'RUN_SEPARATELY',
  37: 'AURORA first-pass retrieval remains false (unchanged contract)',
  38: 'single-GPU visibleConcurrentFamilies remains 1 (unchanged floor)',
  39: 'installed runtime unchanged; no new commercial dependency',
  40: 'WRIM untouched this pass',
  41: 'Foundry untouched this pass',
  42: 'nothing pushed',
  43: 'nothing deployed',
  classification: result.classification,
  catalogSize: catalog.length,
  englishShare: catalogEnglishShare(catalog),
  usUkShare: catalogUsUkShare(catalog),
  storePath: result.storePath,
}

const outDir = planetaryLiveStoreDir()
mkdirSync(outDir, { recursive: true })
writeFileSync(path.join(outDir, 'wave1-report.json'), JSON.stringify(report, null, 2), 'utf8')

console.log('# WAR ROOM PLANETARY SOURCE FABRIC WAVE 1 REPORT')
for (let i = 1; i <= 43; i += 1) {
  console.log(`\n${i}.`)
  console.log(typeof report[i] === 'string' || typeof report[i] === 'number' ? String(report[i]) : JSON.stringify(report[i], null, 2))
}
console.log(`\nFINAL CLASSIFICATION:\n${result.classification}`)
console.log(`\nstorePath=${result.storePath}`)
console.log(`catalogSize=${catalog.length} englishShare=${catalogEnglishShare(catalog).toFixed(3)} usUkShare=${catalogUsUkShare(catalog).toFixed(3)}`)
