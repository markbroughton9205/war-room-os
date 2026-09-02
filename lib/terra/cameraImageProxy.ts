import 'server-only'

/**
 * God's Eye Phase 2 — the camera-image proxy boundary. Backs
 * app/api/terra/camera-image/route.ts, the smallest lawful server-side boundary the mission asked
 * for: a Commander-authenticated, strictly-allowlisted, binary-safe image fetch for exactly the two
 * real camera image hosts this phase confirmed live (digitraffic_road_cameras' weathercam.digitraffic.fi
 * pattern URL, ontario_511_cameras' 511on.ca/map/Cctv/{id} direct-JPEG URL).
 *
 * Deliberately NOT lib/research-engine/security/safeFetch.ts: that module decodes every response
 * body as UTF-8 text (correct for the JSON/XML every Research Engine adapter fetches, but silently
 * corrupts binary JPEG bytes — a real bug this module exists to avoid, not a stylistic choice).
 * This proxy reuses safeFetch's sibling hostAllowlist.ts (assertAllowedProviderUrl/isAllowedHost)
 * as its single source of truth for allowed hosts — never a second, independent allowlist — but
 * implements its own byte-safe, capped-size, capped-redirect fetch loop.
 *
 * Security properties (mission's explicit proxy requirements):
 *   - strict provider host allowlist (reused from hostAllowlist.ts, not duplicated)
 *   - the client supplies only an opaque `id`, validated against a strict per-provider charset —
 *     never a URL; the exact real URL pattern is always constructed server-side, so there is no
 *     arbitrary-URL-proxying / SSRF surface at all
 *   - bounded response size, short timeout, at most one redirect hop (re-validated against the
 *     same allowlist before being followed)
 *   - image content-type enforced on the response before any bytes are returned to the caller
 *   - no credentials sent, no credentials required
 */
import { assertAllowedProviderUrl, isAllowedHost } from '@/lib/research-engine/security/hostAllowlist'

export type TerraCameraImageProvider = 'digitraffic_road_cameras' | 'ontario_511_cameras' | 'hong_kong_td_cameras'

export type TerraCameraImageResult =
  | { ok: true; bytes: Uint8Array; contentType: string; sourceUrl: string; attribution: string }
  | { ok: false; status: number | null; message: string }

const TIMEOUT_MS = 8_000
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024 // 4 MB — generous for a single camera still, never a video stream
const MAX_REDIRECTS = 1

const ID_PATTERNS: Record<TerraCameraImageProvider, RegExp> = {
  // Digitraffic weathercam preset ids observed live this build (e.g. "C1503503") — conservative
  // alnum/underscore/hyphen charset, not the exact grammar, since Digitraffic publishes no formal
  // id-format spec; this only needs to reject anything that isn't a bare path segment.
  digitraffic_road_cameras: /^[A-Za-z0-9_-]{1,64}$/,
  // Ontario 511 view ids are plain integers (real "Id" field on each camera's Views[] entry).
  ontario_511_cameras: /^[0-9]{1,10}$/,
  // Hong Kong TD camera keys observed live this build (e.g. "BC101F", "AID01101", "TDS10001",
  // "TDSCPRHSK10001") — conservative uppercase-alnum charset, the documented {key}.JPG pattern.
  hong_kong_td_cameras: /^[A-Z0-9]{1,24}$/,
}

const ATTRIBUTION: Record<TerraCameraImageProvider, string> = {
  digitraffic_road_cameras: 'Source: Fintraffic / digitraffic.fi, license CC 4.0 BY',
  ontario_511_cameras: 'Source: Ontario 511 (511on.ca), Government of Ontario / Ministry of Transportation',
  hong_kong_td_cameras: 'Source: Transport Department, Government of the Hong Kong SAR (data.gov.hk)',
}

function buildSourceUrl(provider: TerraCameraImageProvider, id: string): string {
  if (provider === 'digitraffic_road_cameras') return `https://weathercam.digitraffic.fi/${id}.jpg`
  if (provider === 'hong_kong_td_cameras') return `https://tdcctv.data.one.gov.hk/${id}.JPG`
  return `https://511on.ca/map/Cctv/${id}`
}

async function readImageBodyWithCap(response: Response, maxBytes: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const reader = response.body?.getReader()
  if (!reader) {
    const buffer = new Uint8Array(await response.arrayBuffer())
    return { bytes: buffer.slice(0, maxBytes), truncated: buffer.byteLength > maxBytes }
  }
  const chunks: Uint8Array[] = []
  let received = 0
  let truncated = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    received += value.byteLength
    if (received > maxBytes) {
      truncated = true
      const allowed = maxBytes - (received - value.byteLength)
      if (allowed > 0) chunks.push(value.slice(0, allowed))
      await reader.cancel().catch(() => undefined)
      break
    }
    chunks.push(value)
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { bytes: merged, truncated }
}

export async function fetchProxiedCameraImage(provider: TerraCameraImageProvider, id: string): Promise<TerraCameraImageResult> {
  if (!ID_PATTERNS[provider].test(id)) {
    return { ok: false, status: null, message: `Invalid camera id format for provider ${provider}.` }
  }

  let currentUrl: string
  try {
    currentUrl = assertAllowedProviderUrl(provider, buildSourceUrl(provider, id)).toString()
  } catch {
    return { ok: false, status: null, message: 'Camera image URL failed the provider host allowlist check.' }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    let response: Response
    let redirects = 0
    let hopUrl = currentUrl
    for (;;) {
      response = await fetch(hopUrl, { method: 'GET', redirect: 'manual', signal: controller.signal, credentials: 'omit' })
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (!location) break
        redirects += 1
        if (redirects > MAX_REDIRECTS) return { ok: false, status: response.status, message: 'Too many redirects for camera image request.' }
        const nextUrl = new URL(location, hopUrl)
        if (nextUrl.protocol !== 'https:' || !isAllowedHost(provider, nextUrl.hostname)) {
          return { ok: false, status: null, message: 'Blocked redirect to a disallowed host for camera image request.' }
        }
        hopUrl = nextUrl.toString()
        continue
      }
      break
    }

    if (!response.ok) return { ok: false, status: response.status, message: `Camera image request failed with HTTP ${response.status}.` }

    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.toLowerCase().startsWith('image/')) {
      return { ok: false, status: response.status, message: `Camera image request returned a non-image content-type ("${contentType || 'none'}").` }
    }

    const { bytes, truncated } = await readImageBodyWithCap(response, MAX_RESPONSE_BYTES)
    if (truncated) return { ok: false, status: response.status, message: 'Camera image exceeded the maximum allowed response size.' }

    return { ok: true, bytes, contentType, sourceUrl: hopUrl, attribution: ATTRIBUTION[provider] }
  } catch (error) {
    return { ok: false, status: null, message: error instanceof Error ? error.message : String(error) }
  } finally {
    clearTimeout(timer)
  }
}
