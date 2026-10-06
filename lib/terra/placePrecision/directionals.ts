const DIRECTIONAL_ALIASES: Record<string, string> = {
  n: 'N',
  north: 'N',
  s: 'S',
  south: 'S',
  e: 'E',
  east: 'E',
  w: 'W',
  west: 'W',
  ne: 'NE',
  northeast: 'NE',
  nw: 'NW',
  northwest: 'NW',
  se: 'SE',
  southeast: 'SE',
  sw: 'SW',
  southwest: 'SW',
}

const DIRECTIONAL_TOKEN = Object.keys(DIRECTIONAL_ALIASES).sort((a, b) => b.length - a.length).join('|')
const LEADING_RE = new RegExp(`^(${DIRECTIONAL_TOKEN})\\b\\.?\\s+`, 'i')
const TRAILING_RE = new RegExp(`\\s+(${DIRECTIONAL_TOKEN})\\.?$`, 'i')

export function canonicalDirectional(token: string | null | undefined): string | null {
  if (!token) return null
  return DIRECTIONAL_ALIASES[token.trim().toLowerCase().replace(/\.$/, '')] ?? null
}

export function splitStreetDirectionals(stem: string): {
  preDirectional: string | null
  streetName: string
  postDirectional: string | null
} {
  let working = stem.trim().replace(/\s+/g, ' ')
  let preDirectional: string | null = null
  let postDirectional: string | null = null
  const leading = LEADING_RE.exec(working)
  if (leading) {
    preDirectional = canonicalDirectional(leading[1])
    working = working.slice(leading[0].length).trim()
  }
  const trailing = TRAILING_RE.exec(working)
  if (trailing) {
    postDirectional = canonicalDirectional(trailing[1])
    working = working.slice(0, trailing.index).trim()
  }
  return { preDirectional, streetName: working, postDirectional }
}

export function directionalConflict(
  requested: string | null | undefined,
  candidate: string | null | undefined,
): boolean {
  const left = canonicalDirectional(requested)
  const right = canonicalDirectional(candidate)
  if (!left || !right) return false
  return left !== right
}
