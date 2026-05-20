const HTML_MARKERS = [/<!doctype/i, /<html/i, /<head/i, /<body/i, /cloudflare/i, /error code/i]
const TIMEOUT_MARKERS = [/522/, /timed?\s*out/i, /timeout/i, /connection refused/i, /econnreset/i, /network error/i]

export function responseLooksLikeHtml(text: string): boolean {
  const trimmed = text.trimStart()
  if (trimmed.startsWith('<')) return true
  return HTML_MARKERS.some(pattern => pattern.test(text))
}

export function isConnectionTimeoutError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : ''
  if (!message) return false
  return TIMEOUT_MARKERS.some(pattern => pattern.test(message)) || responseLooksLikeHtml(message)
}

export const CONNECTION_FALLBACK_MESSAGE =
  'Database connection timed out. War Room is using fallback mode.'

export function sanitizeConnectionError(error: unknown, fallback = CONNECTION_FALLBACK_MESSAGE): string {
  if (error instanceof Error && error.message) {
    if (responseLooksLikeHtml(error.message) || isConnectionTimeoutError(error.message)) {
      return fallback
    }
    if (!containsSensitiveInfrastructureDetail(error.message)) return error.message
    return fallback
  }
  if (typeof error === 'string') {
    if (responseLooksLikeHtml(error) || isConnectionTimeoutError(error)) return fallback
    if (!containsSensitiveInfrastructureDetail(error)) return error
    return fallback
  }
  return fallback
}

export async function readSanitizedFetchError(res: Response, fallback = CONNECTION_FALLBACK_MESSAGE): Promise<string> {
  const contentType = res.headers.get('content-type') ?? ''
  const raw = await res.text()
  if (contentType.includes('text/html') || responseLooksLikeHtml(raw)) return fallback
  if (res.status === 522 || res.status === 524) return fallback
  try {
    const parsed = JSON.parse(raw) as { error?: string; message?: string }
    const msg = parsed.error ?? parsed.message
    if (msg) return sanitizeConnectionError(msg, fallback)
  } catch {
    /* not json */
  }
  if (isConnectionTimeoutError(raw)) return fallback
  if (raw.trim()) return sanitizeConnectionError(raw.slice(0, 240), fallback)
  return fallback
}

function containsSensitiveInfrastructureDetail(message: string): boolean {
  return /PGRST|SQLSTATE|postgres|postgrest|JWT expired/i.test(message)
}

export async function fetchJsonSafe<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(input, init)
    const contentType = res.headers.get('content-type') ?? ''
    const raw = await res.text()
    if (!res.ok) {
      return { ok: false, error: await readSanitizedFetchErrorFromBody(res.status, contentType, raw) }
    }
    if (contentType.includes('text/html') || responseLooksLikeHtml(raw)) {
      return { ok: false, error: CONNECTION_FALLBACK_MESSAGE }
    }
    try {
      return { ok: true, data: JSON.parse(raw) as T }
    } catch {
      return { ok: false, error: CONNECTION_FALLBACK_MESSAGE }
    }
  } catch (error) {
    return { ok: false, error: sanitizeConnectionError(error) }
  }
}

async function readSanitizedFetchErrorFromBody(
  status: number,
  contentType: string,
  raw: string,
  fallback = CONNECTION_FALLBACK_MESSAGE,
): Promise<string> {
  if (status === 522 || status === 524 || contentType.includes('text/html') || responseLooksLikeHtml(raw)) {
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as { error?: string; message?: string }
    const msg = parsed.error ?? parsed.message
    if (msg) return sanitizeConnectionError(msg, fallback)
  } catch {
    /* ignore */
  }
  return sanitizeConnectionError(raw.slice(0, 240), fallback)
}
