/**
 * Edge-safe loopback host helpers (no Node built-ins).
 * Usable from Next middleware / Edge Runtime.
 */
export function isLoopbackRequestHost(host: string | null | undefined): boolean {
  if (!host) return false
  const h = host.split(':')[0]!.toLowerCase()
  return h === '127.0.0.1' || h === 'localhost' || h === '::1'
}
