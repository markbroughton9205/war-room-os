/**
 * Live HTTP smoke for Caltrans CWWP2 stills + 511NY credential gate.
 * Never logs API keys, Authorization headers, or full image URLs.
 */
import { pathToFileURL } from 'node:url'
import { caltransCctvAdapter } from '@/lib/research-engine/providers/caltrans_cctv'
import { ny511CamerasAdapter, ny511ApiKey } from '@/lib/research-engine/providers/ny511_cameras'
import { redactSecretsFromText } from '@/lib/research-engine/security/redact'
import { loadCameraKeysFromLocalEnv } from './loadLocalEnv'
import { nearbyCameraCoverageForPoint } from './godsEye/nearbyCameraCoverage'
import { cameraPreviewHref } from './godsEye/trafficCamera'
import { parseCaltransStillPath } from './caltransStillPath'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail: redactSecretsFromText(detail) }
}

function hostOnly(url: string | undefined): string {
  if (!url) return 'none'
  try {
    return new URL(url).hostname
  } catch {
    return 'unparseable'
  }
}

async function probeStill(url: string): Promise<{ status: number | null; contentType: string; bytes: number; jpeg: boolean }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12_000)
  try {
    const response = await fetch(url, { method: 'GET', redirect: 'follow', signal: controller.signal, credentials: 'omit' })
    const contentType = response.headers.get('content-type') ?? ''
    const buffer = response.ok && contentType.toLowerCase().startsWith('image/')
      ? new Uint8Array(await response.arrayBuffer())
      : new Uint8Array(0)
    return {
      status: response.status,
      contentType,
      bytes: buffer.byteLength,
      jpeg: buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
    }
  } finally {
    clearTimeout(timer)
  }
}

async function run(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const loaded = loadCameraKeysFromLocalEnv()
  results.push(check('env_loaded_without_logging_values', true, `ohgo=${loaded.present.OHGO_API_KEY ? 'set' : 'missing'} ny511=${loaded.present['511NY_API_KEY'] ? 'set' : 'missing'}`))

  const nyHealth = await ny511CamerasAdapter.healthCheck()
  const nyExpected = ny511ApiKey() ? ['ready', 'authentication_failed', 'degraded'] : ['not_configured']
  results.push(check('ny511_health_is_credential_gated', nyExpected.includes(nyHealth.state), `state=${nyHealth.state}`))
  if (!ny511ApiKey()) {
    const nyRun = await ny511CamerasAdapter.run({ text: '40.60,-74.20,40.90,-73.70', maxResults: 20 })
    results.push(check('ny511_without_key_is_not_configured', nyRun.ok === false && nyRun.error?.category === 'not_configured', nyRun.error?.category ?? 'ok'))
  }

  const nyc = nearbyCameraCoverageForPoint({ latitude: 40.7128, longitude: -74.006, nearbyCount: 0 })
  results.push(check('nyc_nearby_is_partial_official_viewer', nyc.locationState === 'PROVIDER_AUTH_REQUIRED', nyc.locationState))

  const caltransHealth = await caltransCctvAdapter.healthCheck()
  results.push(check('caltrans_health_ready', caltransHealth.state === 'ready', `state=${caltransHealth.state}`))

  const response = await caltransCctvAdapter.run({ text: '37.70,-122.55,37.85,-122.35', maxResults: 40 })
  results.push(check('caltrans_sf_ok', response.ok === true && response.documents.length > 0, `ok=${response.ok} docs=${response.documents.length}`))
  const sample = response.documents[0]
  const serialized = JSON.stringify(response)
  results.push(check('caltrans_key_not_serialized', !serialized.includes('OHGO_API_KEY') && !serialized.toLowerCase().includes('apikey '), 'no key material'))
  results.push(check('caltrans_sample_has_image_path', Boolean(sample?.identifiers.imagePath), sample?.identifiers.imagePath ? 'set' : 'missing'))
  results.push(check('caltrans_freshness_not_fabricated_live', sample?.identifiers.freshnessState !== 'LIVE', String(sample?.identifiers.freshnessState)))
  const preview = cameraPreviewHref({
    providerId: 'caltrans_cctv',
    properties: { imagePath: sample?.identifiers.imagePath, cameraId: sample?.identifiers.cameraId },
  })
  results.push(check('caltrans_preview_is_proxy_still', preview.kind === 'still' && Boolean(preview.href?.includes('provider=caltrans_cctv')), preview.kind))

  const rawUrl = sample?.identifiers.imageUrl
  if (rawUrl && parseCaltransStillPath(rawUrl)) {
    const still = await probeStill(rawUrl)
    results.push(check(
      'caltrans_still_is_jpeg',
      still.status === 200 && still.jpeg && still.contentType.toLowerCase().startsWith('image/jpeg') && still.bytes > 1000,
      `status=${still.status} type=${still.contentType} bytes=${still.bytes} jpeg=${still.jpeg} host=${hostOnly(rawUrl)}`,
    ))
  } else {
    results.push(check('caltrans_still_is_jpeg', false, 'no parseable still URL on sample'))
  }

  const sf = nearbyCameraCoverageForPoint({ latitude: 37.7749, longitude: -122.4194, nearbyCount: 0, indexLoaded: true })
  results.push(check('sf_nearby_is_covered_by_caltrans', sf.locationState === 'COVERED' && sf.coveringProviders.some(row => row.id === 'caltrans_cctv'), sf.reason))

  return results
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await run()
  const failed = results.filter(result => !result.pass)
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  console.log(`Caltrans/511NY live: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}
