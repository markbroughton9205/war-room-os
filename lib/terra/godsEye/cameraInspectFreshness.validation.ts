/**
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/godsEye/cameraInspectFreshness.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { cameraInspectFreshness } from './cameraInspectFreshness'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function run(): CaseResult[] {
  const ohgo = cameraInspectFreshness({
    timestamp: '2026-09-16T18:00:00.000Z',
    provenance: { retrievedAt: '2026-09-16T18:00:00.000Z', fromCache: false, isHistorical: false },
    properties: { freshnessState: 'UNAVAILABLE' },
  })
  const caltrans = cameraInspectFreshness({
    timestamp: '2026-09-16T18:00:00.000Z',
    provenance: { retrievedAt: '2026-09-16T18:01:00.000Z', fromCache: false },
    properties: { freshnessState: 'UNAVAILABLE', lastUpdated: '2026-09-16T18:01:00.000Z' },
  })
  const ontario = cameraInspectFreshness({
    provenance: { retrievedAt: '2026-09-16T18:02:00.000Z' },
    properties: { freshness: 'unknown' },
  })
  const fintraffic = cameraInspectFreshness({
    provenance: { retrievedAt: '2026-09-16T18:03:00.000Z' },
    properties: { freshness: 'still_image', capturedAt: '2026-09-16T18:02:30.000Z' },
  })
  return [
    check('ohgo_catalog_live_capture_unknown', ohgo.catalogStatus === 'LIVE' && ohgo.imageFreshness === 'UNKNOWN', `${ohgo.catalogStatus}/${ohgo.imageFreshness}`),
    check('caltrans_poll_clock_is_not_capture_live', caltrans.catalogStatus === 'LIVE' && caltrans.imageFreshness === 'UNKNOWN', `${caltrans.catalogStatus}/${caltrans.imageFreshness}`),
    check('ontario_catalog_live_capture_unknown', ontario.catalogStatus === 'LIVE' && ontario.imageFreshness === 'UNKNOWN', `${ontario.catalogStatus}/${ontario.imageFreshness}`),
    check('fintraffic_capture_live_when_source_timestamp_exists', fintraffic.catalogStatus === 'LIVE' && fintraffic.imageFreshness === 'LIVE', `${fintraffic.catalogStatus}/${fintraffic.imageFreshness}`),
    check('ohgo_note_says_no_capture_time', ohgo.imageNote.toLowerCase().includes('did not report capture time'), ohgo.imageNote),
  ]
}

export function runCameraInspectFreshnessValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = run()
  const failed = results.filter(result => !result.pass)
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  console.log(`Camera inspect freshness: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}
