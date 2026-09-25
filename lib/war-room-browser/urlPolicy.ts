/**
 * War Room Browser URL policy.
 * Guest pages are isolated from Node. Privileged shell navigation is unchanged.
 */

export type BrowserUrlDecision =
  | { ok: true; url: string; kind: 'local' | 'public' | 'about' }
  | { ok: false; reason: string }

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

export function normalizeBrowserUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (/^about:/i.test(trimmed)) return trimmed
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed
  if (/^[\w.-]+\.[a-z]{2,}([/:?#].*)?$/i.test(trimmed)) return `https://${trimmed}`
  if (/^127\.0\.0\.1(?::\d+)?(\/.*)?$/i.test(trimmed) || /^localhost(?::\d+)?(\/.*)?$/i.test(trimmed)) {
    return `http://${trimmed}`
  }
  if (trimmed.startsWith('/')) return trimmed
  return `https://${trimmed}`
}

export function classifyBrowserUrl(raw: string): BrowserUrlDecision {
  const normalized = normalizeBrowserUrl(raw)
  if (!normalized) return { ok: false, reason: 'Enter a URL.' }
  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    return { ok: false, reason: 'Not a valid URL.' }
  }
  if (parsed.protocol === 'about:') return { ok: true, url: parsed.toString(), kind: 'about' }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: `${parsed.protocol} is not allowed in War Room Browser.` }
  }
  const host = parsed.hostname.toLowerCase()
  if (LOCAL_HOSTS.has(host)) return { ok: true, url: parsed.toString(), kind: 'local' }
  return { ok: true, url: parsed.toString(), kind: 'public' }
}

export function isLocalPreviewUrl(raw: string): boolean {
  const decision = classifyBrowserUrl(raw)
  return decision.ok && decision.kind === 'local'
}
