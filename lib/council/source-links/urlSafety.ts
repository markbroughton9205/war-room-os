import type { SourceBlockCode, UrlSafetyDecision } from './types'

const BLOCKED_PROTOCOLS = new Set([
  'javascript:',
  'data:',
  'file:',
  'vbscript:',
  'shell:',
  'about:',
  'blob:',
  'node:',
])

export function classifyCouncilSourceUrl(raw: string | null | undefined): UrlSafetyDecision {
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  if (!trimmed) return { ok: false, code: 'EMPTY_URL', reason: 'LINK BLOCKED — empty URL' }

  const protoMatch = /^([a-z][a-z0-9+.-]*:)/i.exec(trimmed)
  if (protoMatch) {
    const protocol = protoMatch[1].toLowerCase()
    if (BLOCKED_PROTOCOLS.has(protocol) || (protocol !== 'http:' && protocol !== 'https:')) {
      return { ok: false, code: 'UNSUPPORTED_PROTOCOL', reason: `LINK BLOCKED — ${protocol} is not allowed` }
    }
  } else if (!/^[\w.-]+\.[a-z]{2,}([/:?#].*)?$/i.test(trimmed) && !/^localhost(?::\d+)?(\/.*)?$/i.test(trimmed) && !/^127\.0\.0\.1(?::\d+)?(\/.*)?$/i.test(trimmed)) {
    return { ok: false, code: 'MALFORMED_URL', reason: 'LINK BLOCKED — malformed URL' }
  }

  const candidate = protoMatch ? trimmed : (/^localhost|^127\.0\.0\.1/i.test(trimmed) ? `http://${trimmed}` : `https://${trimmed}`)
  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return { ok: false, code: 'MALFORMED_URL', reason: 'LINK BLOCKED — malformed URL' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, code: 'UNSUPPORTED_PROTOCOL', reason: `LINK BLOCKED — ${parsed.protocol} is not allowed` }
  }
  if (!parsed.hostname) {
    return { ok: false, code: 'INVALID_URL', reason: 'LINK BLOCKED — invalid URL' }
  }
  return {
    ok: true,
    url: parsed.toString(),
    domain: parsed.hostname.toLowerCase(),
    protocol: parsed.protocol,
  }
}

export function displayDomain(url: string | null | undefined): string | null {
  const classified = classifyCouncilSourceUrl(url)
  return classified.ok ? classified.domain : null
}

export function applyRelevantLocation(url: string, location: { page?: number | null; anchor?: string | null; text_fragment?: string | null } | null | undefined): string {
  const classified = classifyCouncilSourceUrl(url)
  if (!classified.ok) return url
  const parsed = new URL(classified.url)
  if (location?.anchor && !parsed.hash) parsed.hash = location.anchor.startsWith('#') ? location.anchor : `#${location.anchor}`
  if (typeof location?.page === 'number' && location.page > 0 && /\.pdf(\?|#|$)/i.test(parsed.pathname)) {
    if (!parsed.hash) parsed.hash = `page=${location.page}`
  }
  if (location?.text_fragment && !parsed.hash) {
    parsed.hash = `:~:text=${encodeURIComponent(location.text_fragment.slice(0, 80))}`
  }
  return parsed.toString()
}

export function isUnsafePlainUrl(raw: string): boolean {
  return !classifyCouncilSourceUrl(raw).ok
}

export function blockCodes(): readonly SourceBlockCode[] {
  return ['INVALID_URL', 'UNSUPPORTED_PROTOCOL', 'MALFORMED_URL', 'EMPTY_URL']
}
