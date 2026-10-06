/**
 * Navigation needs address, coordinates, geometry, precision, and source.
 * It does not need owner, resident, or taxpayer identity.
 */

const OWNER_FIELD_RE = /^(owner|ownernme|ownernme1|ownernme2|taxpayer|tax.?payer|resident|occupant|mail.?name|deed.?name|grantee|grantor)/i

export function isOwnerLikeField(name: string): boolean {
  return OWNER_FIELD_RE.test(name.trim())
}

export function stripOwnerLikeFields<T extends Record<string, unknown>>(attributes: T | null | undefined): Record<string, unknown> {
  const source = attributes ?? {}
  const cleaned: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (isOwnerLikeField(key)) continue
    cleaned[key] = value
  }
  return cleaned
}

export function assertNoOwnerLikePayload(value: unknown, path = 'payload'): string[] {
  const hits: string[] = []
  walk(value, path, hits)
  return hits
}

function walk(value: unknown, path: string, hits: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, hits))
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isOwnerLikeField(key)) hits.push(`${path}.${key}`)
    else walk(child, `${path}.${key}`, hits)
  }
}
