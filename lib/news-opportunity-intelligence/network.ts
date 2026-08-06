import type { NetworkFetchResult } from './types'

const DEFAULT_TIMEOUT_MS = 10_000
const MAX_RESPONSE_BYTES = 512_000
const MAX_REDIRECTS = 2
const ALLOWED_CONTENT_TYPES = ['application/json', 'text/plain', 'application/xml', 'text/xml']
const PRIVATE_HOSTS = new Set(['localhost', '0.0.0.0', '127.0.0.1', '::1'])

export type SafeFetchOptions = {
  allowedHosts: readonly string[]
  timeoutMs?: number
  maxBytes?: number
  accept?: string
  fetchImpl?: typeof fetch
}

export function sanitizeNetworkError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/api[_-]?key=([^&\s]+)/gi, 'api_key=[REDACTED]')
    .replace(/token=([^&\s]+)/gi, 'token=[REDACTED]')
    .slice(0, 240)
}

export function assertSafeUrl(rawUrl: string, allowedHosts: readonly string[]): URL {
  const url = new URL(rawUrl)
  if (url.protocol !== 'https:') throw new Error('unsafe_protocol')
  if (isPrivateOrMetadataHost(url.hostname)) throw new Error('private_network_blocked')
  if (!allowedHosts.includes(url.hostname)) throw new Error('host_not_allowed')
  return url
}

export function isPrivateOrMetadataHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (PRIVATE_HOSTS.has(host)) return true
  if (host === '169.254.169.254') return true
  if (/^127\./.test(host)) return true
  if (/^10\./.test(host)) return true
  if (/^192\.168\./.test(host)) return true
  const match172 = host.match(/^172\.(\d+)\./)
  if (match172) {
    const second = Number(match172[1])
    if (second >= 16 && second <= 31) return true
  }
  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return true
  return false
}

export function neutralizeRemoteText(input: string, limit = 600): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\b(ignore|override|disregard)\s+(previous|system|developer)\s+(instructions|policy)\b/gi, '[neutralized remote instruction]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit)
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error('response_too_large')
    }
    chunks.push(value)
  }
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(merged)
}

export async function safeFetchText(rawUrl: string, options: SafeFetchOptions): Promise<NetworkFetchResult> {
  try {
    let url = assertSafeUrl(rawUrl, options.allowedHosts)
    const fetchImpl = options.fetchImpl ?? fetch
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const maxBytes = options.maxBytes ?? MAX_RESPONSE_BYTES
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
      const response = await fetchImpl(url, {
        redirect: 'manual',
        headers: {
          Accept: options.accept ?? 'application/json, text/plain, application/xml, text/xml',
          'User-Agent': 'WarRoomNewsOpportunityIntelligence/49E1',
        },
        signal: AbortSignal.timeout(timeoutMs),
      })
      const location = response.headers.get('location')
      if (response.status >= 300 && response.status < 400 && location) {
        const next = new URL(location, url)
        url = assertSafeUrl(next.toString(), options.allowedHosts)
        continue
      }
      const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? ''
      if (!contentType) throw new Error('missing_content_type')
      if (!ALLOWED_CONTENT_TYPES.includes(contentType)) throw new Error('unsupported_content_type')
      const body = await readBoundedBody(response, maxBytes)
      return { ok: response.ok, status: response.status, contentType, url: url.toString(), redirected: redirect > 0, body, error: response.ok ? null : `http_${response.status}` }
    }
    throw new Error('too_many_redirects')
  } catch (error) {
    return { ok: false, status: 0, contentType: '', url: rawUrl, redirected: false, body: '', error: sanitizeNetworkError(error) }
  }
}
