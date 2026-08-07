import 'server-only'

/**
 * Validates a caller-supplied "target URL" that is sent only as a bounded
 * lookup parameter to an official archive/index service (Wayback CDX,
 * Common Crawl Index) — this server never dereferences the target URL
 * itself. Rejects anything that could be used to probe internal network
 * state via the archive service, or that is not a plausible public web URL.
 *
 * Relies on the WHATWG URL parser (`new URL()`) to canonicalize decimal/hex/
 * octal IPv4 host forms and IDNA-encode internationalized hostnames before
 * any range check runs, so obfuscated numeric-IP forms cannot bypass the
 * checks below.
 */

const MAX_TARGET_URL_LENGTH = 2048

export type TargetUrlValidationResult = { ok: true; url: string } | { ok: false; reason: string }

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
}

function ipv4Octets(hostname: string): [number, number, number, number] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname)
  if (!match) return null
  const octets = match.slice(1, 5).map(Number)
  if (octets.some(n => n > 255)) return null
  return octets as [number, number, number, number]
}

function isDisallowedIpv4(hostname: string): boolean {
  const octets = ipv4Octets(hostname)
  if (!octets) return false
  const [a, b] = octets
  if (a === 127) return true // loopback 127.0.0.0/8
  if (a === 10) return true // RFC1918
  if (a === 172 && b >= 16 && b <= 31) return true // RFC1918
  if (a === 192 && b === 168) return true // RFC1918
  if (a === 169 && b === 254) return true // link-local incl. cloud metadata (169.254.169.254)
  if (a === 0) return true // "this network"
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT shared address space
  if (a === 192 && b === 0) return true // documentation/reserved (192.0.0.0/24, 192.0.2.0/24 covered by prefix)
  if (a === 198 && (b === 18 || b === 19)) return true // benchmark testing 198.18.0.0/15
  if (a === 198 && b === 51) return true // TEST-NET-2 198.51.100.0/24
  if (a === 203 && b === 0) return true // TEST-NET-3 203.0.113.0/24
  if (a >= 224) return true // multicast (224.0.0.0/4) + reserved (240.0.0.0/4) + broadcast
  return false
}

/**
 * Fully expands an IPv6 address (already stripped of brackets/zone-id, lower-cased)
 * into its 8 constituent 16-bit groups. Handles `::` compression and an embedded
 * trailing IPv4 dotted-decimal literal (e.g. `::ffff:127.0.0.1`). Parsing at the
 * group level — rather than matching against a fixed textual pattern — means the
 * check also catches the compressed hexadecimal forms the WHATWG URL parser
 * normalizes addresses into (e.g. `::ffff:127.0.0.1` becomes `::ffff:7f00:1`),
 * not just the pre-normalization dotted-decimal spelling.
 */
function expandIpv6Groups(hostname: string): number[] | null {
  const zoneIdx = hostname.indexOf('%')
  const host = zoneIdx === -1 ? hostname : hostname.slice(0, zoneIdx)

  const doubleColonParts = host.split('::')
  if (doubleColonParts.length > 2) return null

  const expandPart = (part: string): number[] | null => {
    if (part === '') return []
    const segments = part.split(':')
    const groups: number[] = []
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]
      if (segment.includes('.')) {
        if (i !== segments.length - 1) return null
        const octets = ipv4Octets(segment)
        if (!octets) return null
        groups.push((octets[0] << 8) | octets[1])
        groups.push((octets[2] << 8) | octets[3])
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(segment)) return null
        groups.push(parseInt(segment, 16))
      }
    }
    return groups
  }

  if (doubleColonParts.length === 2) {
    const head = expandPart(doubleColonParts[0])
    const tail = expandPart(doubleColonParts[1])
    if (head === null || tail === null) return null
    const fillCount = 8 - head.length - tail.length
    if (fillCount < 0) return null
    return [...head, ...Array(fillCount).fill(0), ...tail]
  }

  const groups = expandPart(host)
  if (groups === null || groups.length !== 8) return null
  return groups
}

/** Returns the embedded IPv4 octets if `groups` encode an IPv4-mapped IPv6 address (::ffff:a.b.c.d), else null. */
function ipv4MappedOctets(groups: number[]): [number, number, number, number] | null {
  if (groups[0] === 0 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0 && groups[4] === 0 && groups[5] === 0xffff) {
    return [(groups[6] >> 8) & 0xff, groups[6] & 0xff, (groups[7] >> 8) & 0xff, groups[7] & 0xff]
  }
  return null
}

function isDisallowedIpv6(rawHostname: string): boolean {
  const hostname = stripIpv6Brackets(rawHostname).toLowerCase()
  if (hostname === '::1') return true // loopback
  if (hostname === '::' || hostname === '::0') return true // unspecified
  if (/^fe[89ab][0-9a-f]:/.test(hostname)) return true // link-local fe80::/10
  if (/^f[cd][0-9a-f]{2}:/.test(hostname)) return true // unique local fc00::/7 (IPv6 private-range equivalent)
  if (/^ff[0-9a-f]{2}:/.test(hostname)) return true // multicast ff00::/8

  const groups = expandIpv6Groups(hostname)
  if (groups) {
    // Any IPv4-mapped IPv6 literal is rejected outright, regardless of whether the
    // embedded IPv4 address itself would be considered public or private — this
    // policy choice avoids relying on IPv4-in-IPv6 range logic that a future
    // normalization quirk could bypass again.
    if (ipv4MappedOctets(groups)) return true
  }

  return false
}

export function validateBoundedTargetUrl(rawInput: string): TargetUrlValidationResult {
  const trimmed = rawInput.trim()
  if (!trimmed) return { ok: false, reason: 'Target URL is required.' }
  if (trimmed.length > MAX_TARGET_URL_LENGTH) return { ok: false, reason: `Target URL exceeds the maximum allowed length of ${MAX_TARGET_URL_LENGTH} characters.` }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return { ok: false, reason: 'Target URL could not be parsed.' }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: `Target URL scheme "${parsed.protocol}" is not allowed; only http/https are accepted.` }
  }
  // The WHATWG URL parser normalizes an explicit default port (http:80, https:443)
  // to an empty `port` string, so any non-empty value here is an explicit,
  // nonstandard port that must be rejected before the target reaches a provider.
  if (parsed.port !== '') {
    return { ok: false, reason: 'Target URL must not specify a nonstandard port.' }
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'Target URL must not contain embedded credentials.' }
  }

  const hostname = parsed.hostname.toLowerCase()
  const bareHostname = hostname.replace(/\.$/, '')
  if (bareHostname === 'localhost' || bareHostname.endsWith('.localhost')) {
    return { ok: false, reason: 'Target URL host resolves to localhost, which is not allowed.' }
  }
  if (isDisallowedIpv4(bareHostname)) {
    return { ok: false, reason: 'Target URL host is a private, loopback, link-local, or reserved IPv4 address, which is not allowed.' }
  }
  if (bareHostname.startsWith('[') || bareHostname.includes(':')) {
    if (isDisallowedIpv6(bareHostname)) {
      return { ok: false, reason: 'Target URL host is a private, loopback, link-local, or mapped IPv6 address, which is not allowed.' }
    }
  }

  return { ok: true, url: parsed.toString() }
}
