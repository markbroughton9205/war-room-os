/**
 * Secret exclusion for HVS jobs, projects, analysis, and API payloads.
 * Adapters resolve credentials at runtime. Nothing secret is stored.
 */

const SECRET_KEY = /(?:api[_-]?key|token|secret|bearer|authorization|password|credential|private[_-]?key|xi-api-key|embedding|faceDescriptor|templateBytes|rawVector)$/i
const SECRET_VALUE = /^(?:sk-|rk-|xai-)[A-Za-z0-9]|Bearer\s+[A-Za-z0-9._\-]+|AIza/

export function isSecretKey(key: string): boolean {
  return SECRET_KEY.test(key)
}

export function containsSecretValue(value: unknown): boolean {
  if (typeof value !== 'string') return false
  return SECRET_VALUE.test(value)
}

export function stripSecrets<T>(value: T): T {
  return stripInner(value, 0) as T
}

function stripInner(value: unknown, depth: number): unknown {
  if (depth > 12 || value == null) return value
  if (Array.isArray(value)) return value.map(item => stripInner(item, depth + 1))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (isSecretKey(key) || containsSecretValue(inner)) {
        out[key] = '[redacted]'
        continue
      }
      out[key] = stripInner(inner, depth + 1)
    }
    return out
  }
  if (typeof value === 'string' && containsSecretValue(value)) return '[redacted]'
  return value
}

export function assertNoSecrets(value: unknown, label: string): void {
  walk(value, label)
}

function walk(value: unknown, path: string): void {
  if (value == null) return
  if (Array.isArray(value)) {
    value.forEach((item, i) => walk(item, `${path}[${i}]`))
    return
  }
  if (typeof value === 'object') {
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (isSecretKey(key)) {
        if (inner !== '[redacted]') throw new Error(`Secret key forbidden at ${path}.${key}`)
        continue
      }
      if (containsSecretValue(inner)) throw new Error(`Secret value forbidden at ${path}.${key}`)
      walk(inner, `${path}.${key}`)
    }
  }
}

export function envConfigured(name: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[name]
  return typeof raw === 'string' && raw.trim().length > 0
}
