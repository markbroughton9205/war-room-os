import net from 'node:net'

const DEFAULT_MAX_BYTES = 512_000
const DEFAULT_TIMEOUT_MS = 12_000

function isPrivateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return false
  const o = m.slice(1, 5).map(Number)
  if (o.some(n => n > 255)) return false
  const [a, b] = o
  if (a === 10) return true
  if (a === 127) return true
  if (a === 0) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '0.0.0.0',
  '::1',
  'metadata.google.internal',
  'metadata.goog',
])

export type SafeFetchOk = {
  ok: true
  url: string
  status: number
  contentType: string | null
  bytesRead: number
  truncated: boolean
  snippet: string
}

export type SafeFetchErr = {
  ok: false
  error: string
  status?: number
}

/**
 * SSRF-hardened GET: http(s) only, blocks obvious private hosts, size & time limits.
 */
export async function safeUrlFetch(rawUrl: string, opts?: { maxBytes?: number; timeoutMs?: number }): Promise<SafeFetchOk | SafeFetchErr> {
  const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_BYTES
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS

  let parsed: URL
  try {
    parsed = new URL(rawUrl.trim())
  } catch {
    return { ok: false, error: 'Invalid URL.' }
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: 'Only http(s) URLs are allowed.' }
  }

  const hostname = parsed.hostname.toLowerCase()
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { ok: false, error: 'Host is not allowed.' }
  }

  if (hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    return { ok: false, error: 'Host suffix is not allowed.' }
  }

  if (isPrivateIpv4(hostname)) {
    return { ok: false, error: 'Private IPv4 addresses are not allowed.' }
  }

  if (hostname.includes(':') && net.isIP(hostname) === 6) {
    return { ok: false, error: 'IPv6 literals are not allowed (use a public hostname).' }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(parsed.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': 'WarRoomSafeFetch/1.0' },
    })

    const buf = await readBodyWithCap(res.body, maxBytes)
    clearTimeout(timer)

    const text = new TextDecoder('utf-8', { fatal: false }).decode(buf)
    const snippet = text.slice(0, 8000)

    return {
      ok: true,
      url: parsed.toString(),
      status: res.status,
      contentType: res.headers.get('content-type'),
      bytesRead: buf.byteLength,
      truncated: buf.byteLength >= maxBytes,
      snippet,
    }
  } catch (e) {
    clearTimeout(timer)
    const aborted = e instanceof Error && e.name === 'AbortError'
    return { ok: false, error: aborted ? 'Request timed out.' : e instanceof Error ? e.message : 'Fetch failed.' }
  }
}

async function readBodyWithCap(body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<Uint8Array> {
  if (!body) return new Uint8Array()
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value?.length) continue
    if (total + value.byteLength > maxBytes) {
      const slice = value.subarray(0, Math.max(0, maxBytes - total))
      if (slice.byteLength) chunks.push(slice)
      total = maxBytes
      await reader.cancel()
      break
    }
    chunks.push(value)
    total += value.byteLength
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.byteLength
  }
  return out
}
