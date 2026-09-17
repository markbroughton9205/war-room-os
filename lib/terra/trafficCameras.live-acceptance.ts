/**
 * LIVE HTTP smoke for Terra OHGO traffic cameras. Primary path — not fixtures.
 *
 *   pnpm run validate:terra-cameras:live
 *
 * Reads OHGO_API_KEY from process.env or .env.local only.
 * Never logs key values, Authorization headers, or image URLs.
 *
 * Missing OHGO_API_KEY → explicit SKIP "key required".
 * Does not substitute mock cameras into the Terra layer.
 */
import { pathToFileURL } from 'node:url'
import { ohgoCamerasAdapter, ohgoApiKey } from '@/lib/research-engine/providers/ohgo_cameras'
import { redactSecretsFromText } from '@/lib/research-engine/security/redact'
import { loadCameraKeysFromLocalEnv } from './loadLocalEnv'

type CaseResult = { name: string; pass: boolean; detail: string; skipped?: boolean }

function check(name: string, pass: boolean, detail: string, skipped = false): CaseResult {
  return { name, pass, detail: redactSecretsFromText(detail), skipped }
}

function skipKeyRequired(name: string, envName: string): CaseResult {
  return check(name, true, `SKIP: key required (${envName}) — live client not invoked; no stub cameras substituted`, true)
}

function hostOnly(url: string | undefined): string {
  if (!url) return 'none'
  try {
    return new URL(url).hostname
  } catch {
    return 'unparseable'
  }
}

async function probeStill(url: string): Promise<{
  httpStatus: number | null
  contentType: string
  lastModified: string | null
  dateHeader: string | null
  bytes: number
}> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12_000)
  try {
    const response = await fetch(url, { method: 'GET', redirect: 'follow', signal: controller.signal, credentials: 'omit' })
    const contentType = response.headers.get('content-type') ?? ''
    const lastModified = response.headers.get('last-modified')
    const dateHeader = response.headers.get('date')
    const buffer = response.ok && contentType.toLowerCase().startsWith('image/')
      ? new Uint8Array(await response.arrayBuffer())
      : new Uint8Array(0)
    return {
      httpStatus: response.status,
      contentType,
      lastModified,
      dateHeader,
      bytes: buffer.byteLength,
    }
  } finally {
    clearTimeout(timer)
  }
}

async function run(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const loaded = loadCameraKeysFromLocalEnv()
  results.push(check(
    'env_loaded_without_logging_values',
    true,
    `dotenv_file=${loaded.loadedFromFile ? 'present' : 'absent'} ohgo_key=${loaded.present.OHGO_API_KEY ? 'set' : 'missing'}`,
  ))

  if (!ohgoApiKey()) {
    results.push(skipKeyRequired('ohgo_live_http', 'OHGO_API_KEY'))
    results.push(check('OHGO_AUTH', false, 'FAILED — OHGO_API_KEY missing'))
    return results
  }

  const response = await ohgoCamerasAdapter.run({ text: '39.00,-84.60,39.30,-84.30', maxResults: 80 })
  const ids = response.documents.map(doc => doc.providerRecordId ?? doc.id)
  const sample = response.documents[0]
  const videoLeak = response.documents.some(doc => Boolean(doc.identifiers.streamUrl))
  const fabricatedLive = response.documents.some(doc => doc.identifiers.freshnessState === 'LIVE' && !doc.identifiers.lastUpdated)
  const withCoords = response.documents.filter(doc => doc.identifiers.latitude && doc.identifiers.longitude)
  const withRoad = response.documents.filter(doc => Boolean(doc.identifiers.road))
  const freshnessStates = [...new Set(response.documents.map(doc => doc.identifiers.freshnessState ?? 'missing'))]

  results.push(check(
    'OHGO_AUTH',
    response.ok && response.error?.category !== 'authentication_failed',
    `ok=${response.ok} category=${response.error?.category ?? 'none'} http=${response.error?.httpStatus ?? 'none'}`,
  ))
  results.push(check(
    'OHGO_CAMERA_CATALOG',
    response.ok && response.documents.length > 0 && ids.every(id => typeof id === 'string' && id.startsWith('ohgo:')),
    `n=${response.documents.length} sample_id=${ids[0] ?? 'none'}`,
  ))
  results.push(check(
    'OHGO_CAMERA_COUNT',
    response.ok && response.documents.length > 0,
    String(response.documents.length),
  ))
  results.push(check(
    'OHGO_METADATA',
    withCoords.length === response.documents.length && response.documents.length > 0,
    `ids_ok=${ids.length} coords=${withCoords.length} roads_supplied=${withRoad.length} sample_location=${sample?.identifiers.locationName ?? 'none'} sample_road=${sample?.identifiers.road ?? 'not supplied'} sample_lat=${sample?.identifiers.latitude ?? 'none'} sample_lon=${sample?.identifiers.longitude ?? 'none'}`,
  ))
  results.push(check('ohgo_live_no_stream_url', !videoLeak, 'streamUrl must stay null'))
  results.push(check(
    'ohgo_live_catalog_not_fabricated_live',
    !fabricatedLive,
    `freshness_states=${freshnessStates.join(',')}`,
  ))

  const stillDoc = response.documents.find(doc => Boolean(doc.identifiers.imageUrl))
  if (!stillDoc?.identifiers.imageUrl) {
    results.push(check('OHGO_IMAGE_ENDPOINT', false, 'no LargeUrl/SmallUrl supplied on catalog documents'))
    results.push(check('OHGO_FRESHNESS', true, `catalog=${freshnessStates.join(',')} stills=not_probed`))
  } else {
    const imageHost = hostOnly(stillDoc.identifiers.imageUrl)
    try {
      const probe = await probeStill(stillDoc.identifiers.imageUrl)
      const imageOk = probe.httpStatus === 200 && probe.contentType.toLowerCase().startsWith('image/') && probe.bytes > 0
      results.push(check(
        'OHGO_IMAGE_ENDPOINT',
        imageOk,
        `host=${imageHost} http=${probe.httpStatus} content_type=${probe.contentType || 'none'} bytes=${probe.bytes}`,
      ))
      const freshnessDetail = [
        `catalog=${freshnessStates.join(',')}`,
        `still_host=${imageHost}`,
        `last_modified=${probe.lastModified ? 'present' : 'absent'}`,
        `date_header=${probe.dateHeader ? 'present' : 'absent'}`,
      ].join(' ')
      results.push(check(
        'OHGO_FRESHNESS',
        !fabricatedLive,
        freshnessDetail,
      ))
    } catch (error) {
      results.push(check(
        'OHGO_IMAGE_ENDPOINT',
        false,
        `host=${imageHost} error=${error instanceof Error ? error.message : String(error)}`,
      ))
      results.push(check('OHGO_FRESHNESS', !fabricatedLive, `catalog=${freshnessStates.join(',')} stills=probe_failed`))
    }
  }

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
