import { createHash } from 'node:crypto'

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(item => stableStringify(item)).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}

export function sha256Json(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}

export function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function sha256Buffer(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

export function shortId(prefix: string, value: unknown): string {
  return `${prefix}-${sha256Json(value).slice(0, 12)}`
}
