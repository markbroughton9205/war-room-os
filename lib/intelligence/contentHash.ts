import { createHash } from 'node:crypto'

/**
 * Hash the evidence text War Room actually uses (title/claim/snippet), not hidden full documents.
 */

export function normalizeEvidenceText(text: string | null | undefined): string {
  if (!text) return ''
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function hashEvidenceContent(text: string | null | undefined): string | null {
  const normalized = normalizeEvidenceText(text)
  if (!normalized) return null
  return createHash('sha256').update(normalized, 'utf8').digest('hex')
}

export function evidenceTextForHash(item: {
  title?: string
  claim?: string
  content?: string
}): string {
  const content = (item.content ?? '').trim()
  const claim = (item.claim ?? '').trim()
  const title = (item.title ?? '').trim()
  if (content.length >= 40) return content
  return [title, claim, content].filter(Boolean).join('\n')
}

export function textsAreNearDuplicate(a: string, b: string): boolean {
  const left = normalizeEvidenceText(a)
  const right = normalizeEvidenceText(b)
  if (!left || !right) return false
  if (left === right) return true
  if (Math.abs(left.length - right.length) > Math.max(left.length, right.length) * 0.15) return false
  const leftTokens = new Set(left.split(' ').filter(token => token.length > 3))
  const rightTokens = new Set(right.split(' ').filter(token => token.length > 3))
  if (!leftTokens.size || !rightTokens.size) return left === right
  let inter = 0
  for (const token of leftTokens) if (rightTokens.has(token)) inter += 1
  const union = leftTokens.size + rightTokens.size - inter
  return union > 0 && inter / union >= 0.88
}
