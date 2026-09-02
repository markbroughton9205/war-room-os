import { normalizeForDedup, sha256 } from './hash'

export function ngramOf(text: string): string {
  const tokens = normalizeForDedup(text).split(' ').filter(Boolean)
  const grams: string[] = []
  for (let index = 0; index < tokens.length - 2; index += 1) grams.push(tokens.slice(index, index + 3).join(' '))
  if (grams.length < 8) return `short:${sha256(normalizeForDedup(text))}`
  return sha256(grams.slice(0, 64).join('|')).slice(0, 24)
}
