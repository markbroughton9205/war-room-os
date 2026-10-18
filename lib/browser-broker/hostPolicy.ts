import { lookup } from 'node:dns/promises'
import net from 'node:net'

/** True for hosts a Council browser must not reach unless the session explicitly allows local access: loopback, private, link-local, unspecified, local-only names. */
export function isPrivateHostLiteral(hostname: string): boolean {
  let host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (!host) return true
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan')) return true
  const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) host = mapped[1]
  const kind = net.isIP(host)
  if (kind === 4) {
    const [a, b] = host.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  }
  if (kind === 6) {
    return host === '::' || host === '::1' || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || host.startsWith('ff')
  }
  return false
}

const cache = new Map<string, { private: boolean; at: number }>()

/** DNS check for named hosts: a public-looking name that resolves to a private address is treated as private (DNS rebinding / split-horizon). */
export async function hostIsPrivate(hostname: string): Promise<boolean> {
  if (isPrivateHostLiteral(hostname)) return true
  const host = hostname.replace(/^\[|\]$/g, '')
  if (net.isIP(host)) return false
  const hit = cache.get(host)
  if (hit && Date.now() - hit.at < 30_000) return hit.private
  let priv = false
  try {
    const found = await lookup(host, { all: true })
    priv = found.some(a => isPrivateHostLiteral(a.address))
  } catch {
    priv = false
  }
  cache.set(host, { private: priv, at: Date.now() })
  return priv
}
