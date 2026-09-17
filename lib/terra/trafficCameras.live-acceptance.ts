/**
 * LIVE HTTP smoke for Terra traffic-camera adapters. Primary path — not fixtures.
 *
 *   pnpm run validate:terra-cameras:live
 *
 * Reads OHGO_API_KEY / 511NY_API_KEY from process.env or .env.local only.
 * Never logs key values, Authorization headers, or image URLs.
 *
 * Missing OHGO_API_KEY or 511NY_API_KEY → explicit SKIP "key required".
 * Does not substitute mock cameras into the Terra layer.
 */
import { pathToFileURL } from 'node:url'
import { ohgoCamerasAdapter, ohgoApiKey } from '@/lib/research-engine/providers/ohgo_cameras'
import { ny511CamerasAdapter, ny511ApiKey } from '@/lib/research-engine/providers/ny511_cameras'
import { caltransCwwp2CamerasAdapter } from '@/lib/research-engine/providers/caltrans_cwwp2_cameras'
import { redactSecretsFromText } from '@/lib/research-engine/security/redact'
import { loadCameraKeysFromLocalEnv } from './loadLocalEnv'

type CaseResult = { name: string; pass: boolean; detail: string; skipped?: boolean }

function check(name: string, pass: boolean, detail: string, skipped = false): CaseResult {
  return { name, pass, detail: redactSecretsFromText(detail), skipped }
}

function skipKeyRequired(name: string, envName: string): CaseResult {
  return check(name, true, `SKIP: key required (${envName}) — live client not invoked; no stub cameras substituted`, true)
}

async function run(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const loaded = loadCameraKeysFromLocalEnv()
  results.push(check(
    'env_loaded_without_logging_values',
    true,
    `dotenv_file=${loaded.loadedFromFile ? 'present' : 'absent'} ohgo_key=${loaded.present.OHGO_API_KEY ? 'set' : 'missing'} ny_key=${loaded.present['511NY_API_KEY'] ? 'set' : 'missing'}`,
  ))

  if (!ohgoApiKey()) {
    results.push(skipKeyRequired('ohgo_live_http', 'OHGO_API_KEY'))
  } else {
    const response = await ohgoCamerasAdapter.run({ text: '39.00,-84.60,39.30,-84.30', maxResults: 8 })
    const ids = response.documents.map(doc => doc.providerRecordId ?? doc.id)
    const videoLeak = response.documents.some(doc => Boolean(doc.identifiers.streamUrl))
    const fabricatedLive = response.documents.some(doc => doc.identifiers.freshnessState === 'LIVE' && !doc.identifiers.lastUpdated)
    results.push(check(
      'ohgo_live_http',
      response.ok && response.documents.length > 0 && ids.every(id => typeof id === 'string' && id.startsWith('ohgo:')),
      `ok=${response.ok} n=${response.documents.length} sample_id=${ids[0] ?? 'none'} category=${response.error?.category ?? 'none'}`,
    ))
    results.push(check('ohgo_live_no_stream_url', !videoLeak, 'streamUrl must stay null'))
    results.push(check('ohgo_live_catalog_not_fabricated_live', !fabricatedLive, 'catalog without Last-Modified must not be LIVE'))
  }

  if (!ny511ApiKey()) {
    results.push(skipKeyRequired('ny511_live_http', '511NY_API_KEY'))
  } else {
    const response = await ny511CamerasAdapter.run({ text: '40.60,-74.10,40.90,-73.80', maxResults: 8 })
    const ids = response.documents.map(doc => doc.providerRecordId ?? doc.id)
    const streamSet = response.documents.some(doc => Boolean(doc.identifiers.streamUrl))
    results.push(check(
      'ny511_live_http',
      response.ok && response.documents.length > 0 && ids.every(id => typeof id === 'string' && id.startsWith('511ny:')),
      `ok=${response.ok} n=${response.documents.length} sample_id=${ids[0] ?? 'none'} category=${response.error?.category ?? 'none'}`,
    ))
    results.push(check('ny511_live_video_is_link_out_only', !streamSet, 'VideoUrl must not become streamUrl'))
  }

  const caltrans = await caltransCwwp2CamerasAdapter.run({ text: '33.90,-118.40,34.20,-118.10', maxResults: 8 })
  const calIds = caltrans.documents.map(doc => doc.providerRecordId ?? doc.id)
  const calStream = caltrans.documents.some(doc => Boolean(doc.identifiers.streamUrl))
  results.push(check(
    'caltrans_live_http',
    caltrans.ok && caltrans.documents.length > 0 && calIds.every(id => typeof id === 'string' && id.startsWith('caltrans:')),
    `ok=${caltrans.ok} n=${caltrans.documents.length} sample_id=${calIds[0] ?? 'none'} category=${caltrans.error?.category ?? 'none'}`,
  ))
  results.push(check('caltrans_live_stream_is_link_out_only', !calStream, 'streamingVideoURL must not become streamUrl'))

  return results
}

export async function runTerraTrafficCamerasLiveAcceptance(): Promise<CaseResult[]> {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runTerraTrafficCamerasLiveAcceptance()
  let failed = 0
  for (const result of results) {
    const tag = result.skipped ? 'SKIP' : result.pass ? 'PASS' : 'FAIL'
    if (!result.pass) failed += 1
    console.log(`${tag} ${result.name} ${result.detail}`)
  }
  const skipped = results.filter(result => result.skipped).length
  console.log(`Terra traffic cameras LIVE: ${results.length - failed}/${results.length} PASS (${skipped} key-required skips)`)
  if (failed) process.exit(1)
}
