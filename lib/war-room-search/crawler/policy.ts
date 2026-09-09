import dns from 'node:dns/promises'
import net from 'node:net'
import type { CrawlApproval, DomainPolicy } from './types'

const METADATA_HOSTS = new Set([
  'metadata.google.internal',
  'metadata.goog',
  'metadata.google.com',
  '169.254.169.254',
  'metadata.internal',
])

const INTERNAL_HOST_SUFFIXES = ['.local', '.internal', '.lan', '.localhost']
const INTERNAL_HOSTS = new Set(['localhost', '0.0.0.0', '::1', '::', '[::1]'])

export type LookupFn = (hostname: string) => Promise<{ address: string; family: number }>

export type PolicyEnv = Record<string, string | undefined>

export type CrawlPolicyDecision = {
  allowed: boolean
  reason: string
  category:
    | 'OK'
    | 'SCHEME'
    | 'USERINFO'
    | 'SSRF_METADATA'
    | 'SSRF_PRIVATE'
    | 'SSRF_INTERNAL_HOST'
    | 'DENYLIST'
    | 'ALLOWLIST'
    | 'CRAWL_DISABLED'
    | 'UNAPPROVED'
}

function parseHostList(raw: string | undefined): string[] {
  if (!raw?.trim()) return []
  return raw.split(',').map(part => part.trim().toLowerCase().replace(/^www\./, '')).filter(Boolean)
}

export function readDomainPolicy(env: PolicyEnv = process.env): DomainPolicy {
  return {
    allowlist: parseHostList(env.WAR_ROOM_CRAWL_ALLOWLIST),
    denylist: parseHostList(env.WAR_ROOM_CRAWL_DENYLIST),
    crawlDisabled: /^(1|true|yes)$/i.test(env.WAR_ROOM_CRAWL_DISABLED ?? ''),
  }
}

export function isPrivateIpv4(host: string): boolean {
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

export function isPrivateIpv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase()
  if (h === '::1' || h === '::') return true
  if (h.startsWith('fe80:')) return true
  if (h.startsWith('fc') || h.startsWith('fd')) return true
  if (h.startsWith('::ffff:')) {
    const mapped = h.slice('::ffff:'.length)
    return isPrivateIpv4(mapped)
  }
  return false
}

export function isInternalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (INTERNAL_HOSTS.has(host)) return true
  if (INTERNAL_HOST_SUFFIXES.some(suffix => host.endsWith(suffix))) return true
  if (METADATA_HOSTS.has(host)) return true
  if (isPrivateIpv4(host) || isPrivateIpv6(host)) return true
  return false
}

export function isMetadataHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return METADATA_HOSTS.has(host) || host === '169.254.169.254'
}

function hostKey(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '').replace(/^\[|\]$/g, '')
}

export function evaluateParsedUrl(parsed: URL, approval: CrawlApproval | null, policy: DomainPolicy): CrawlPolicyDecision {
  if (!approval) {
    return { allowed: false, reason: 'Crawl requires Commander or trusted internal approval.', category: 'UNAPPROVED' }
  }
  if (policy.crawlDisabled) {
    return { allowed: false, reason: 'Crawling is disabled by WAR_ROOM_CRAWL_DISABLED.', category: 'CRAWL_DISABLED' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { allowed: false, reason: 'Only http(s) URLs are allowed.', category: 'SCHEME' }
  }
  if (parsed.username || parsed.password) {
    return { allowed: false, reason: 'URLs with credentials are not allowed.', category: 'USERINFO' }
  }

  const host = hostKey(parsed.hostname)
  if (isMetadataHost(host)) {
    return { allowed: false, reason: 'Cloud metadata hosts are blocked.', category: 'SSRF_METADATA' }
  }
  if (policy.denylist.includes(host)) {
    return { allowed: false, reason: `Host is on the crawl denylist: ${host}`, category: 'DENYLIST' }
  }
  if (policy.allowlist.length && !policy.allowlist.includes(host) && !(approval.allowInternalHosts && isInternalHostname(host))) {
    return { allowed: false, reason: `Host is not on the crawl allowlist: ${host}`, category: 'ALLOWLIST' }
  }
  if (isInternalHostname(host) && !approval.allowInternalHosts) {
    return {
      allowed: false,
      reason: 'Private/internal hosts are blocked unless a trusted internal workflow explicitly allows them.',
      category: isPrivateIpv4(host) || isPrivateIpv6(host) ? 'SSRF_PRIVATE' : 'SSRF_INTERNAL_HOST',
    }
  }
  return { allowed: true, reason: 'destination_ok', category: 'OK' }
}

export async function evaluateCrawlDestination(args: {
  url: string
  approval: CrawlApproval | null
  policy?: DomainPolicy
  lookup?: LookupFn
}): Promise<CrawlPolicyDecision> {
  let parsed: URL
  try {
    parsed = new URL(args.url.trim())
  } catch {
    return { allowed: false, reason: 'Invalid URL.', category: 'SCHEME' }
  }

  const policy = args.policy ?? readDomainPolicy()
  const staticDecision = evaluateParsedUrl(parsed, args.approval, policy)
  if (!staticDecision.allowed) return staticDecision

  const host = parsed.hostname.replace(/^\[|\]$/g, '')
  if (net.isIP(host)) return staticDecision

  try {
    const lookup = args.lookup ?? ((hostname: string) => dns.lookup(hostname))
    const resolved = await lookup(host)
    const address = resolved.address
    if (isMetadataHost(address) || address === '169.254.169.254') {
      return { allowed: false, reason: 'Resolved to a cloud metadata address.', category: 'SSRF_METADATA' }
    }
    if ((isPrivateIpv4(address) || isPrivateIpv6(address)) && !args.approval?.allowInternalHosts) {
      return { allowed: false, reason: `Resolved to a private address (${address}).`, category: 'SSRF_PRIVATE' }
    }
  } catch {
    return { allowed: false, reason: 'DNS lookup failed; refusing to crawl.', category: 'SSRF_INTERNAL_HOST' }
  }

  return staticDecision
}

export function isAcceptedContentType(contentType: string | null): 'html' | 'plain' | null {
  if (!contentType) return 'html'
  const type = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  if (type === 'text/html' || type === 'application/xhtml+xml') return 'html'
  if (type === 'text/plain') return 'plain'
  return null
}
