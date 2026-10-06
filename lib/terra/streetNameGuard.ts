/**
 * Street-name honesty for Terra JUMP / GO.
 * St = Street, Dr = Drive, but Street ≠ Drive. Never silently accept a conflicting suffix.
 */

export const STREET_TYPE_ALIASES: Record<string, string> = {
  street: 'street',
  streets: 'street',
  st: 'street',
  str: 'street',
  road: 'road',
  roads: 'road',
  rd: 'road',
  avenue: 'avenue',
  ave: 'avenue',
  av: 'avenue',
  drive: 'drive',
  drives: 'drive',
  dr: 'drive',
  drv: 'drive',
  boulevard: 'boulevard',
  blvd: 'boulevard',
  boul: 'boulevard',
  avenida: 'avenue',
  avda: 'avenue',
  calle: 'calle',
  carrer: 'carrer',
  rue: 'rue',
  strasse: 'strasse',
  straße: 'strasse',
  jalan: 'jalan',
  via: 'via',
  gata: 'gata',
  katu: 'katu',
  tie: 'tie',
  lane: 'lane',
  ln: 'lane',
  court: 'court',
  ct: 'court',
  circle: 'circle',
  cir: 'circle',
  place: 'place',
  pl: 'place',
  terrace: 'terrace',
  ter: 'terrace',
  parkway: 'parkway',
  pkwy: 'parkway',
  highway: 'highway',
  hwy: 'highway',
  way: 'way',
  trail: 'trail',
  trl: 'trail',
  square: 'square',
  sq: 'square',
  pike: 'pike',
  alley: 'alley',
  aly: 'alley',
  crossing: 'crossing',
  xing: 'crossing',
  junction: 'junction',
  jct: 'junction',
}

const TYPE_PATTERN = Object.keys(STREET_TYPE_ALIASES)
  .sort((a, b) => b.length - a.length)
  .join('|')
const SUFFIX_RE = new RegExp(`\\b(${TYPE_PATTERN})\\b\\.?$`, 'i')
const PREFIX_RE = new RegExp(`^(${TYPE_PATTERN})\\b\\.?\\s+`, 'i')

export type NormalizedStreetName = {
  raw: string
  stem: string
  type: string | null
  typeAbbrev: string | null
  canonical: string
}

export const STREET_TYPE_ABBREVIATIONS: Record<string, string> = {
  street: 'ST',
  road: 'RD',
  avenue: 'AVE',
  drive: 'DR',
  boulevard: 'BLVD',
  lane: 'LN',
  court: 'CT',
  circle: 'CIR',
  place: 'PL',
  terrace: 'TER',
  parkway: 'PKWY',
  highway: 'HWY',
  way: 'WAY',
  trail: 'TRL',
  square: 'SQ',
  pike: 'PIKE',
  alley: 'ALY',
  crossing: 'XING',
  junction: 'JCT',
  calle: 'CALLE',
  carrer: 'CARRER',
  rue: 'RUE',
  strasse: 'STR',
  jalan: 'JALAN',
  via: 'VIA',
  gata: 'GATA',
  katu: 'KATU',
  tie: 'TIE',
}

export function canonicalStreetType(token: string | null | undefined): string | null {
  if (!token) return null
  return STREET_TYPE_ALIASES[token.trim().toLowerCase().replace(/\.$/, '')] ?? null
}

export function streetTypeAbbreviation(type: string | null | undefined): string | null {
  const canonical = canonicalStreetType(type) ?? (type ? STREET_TYPE_ALIASES[type.trim().toLowerCase()] ?? null : null)
  if (!canonical) {
    const upper = type?.trim().toUpperCase().replace(/\.$/, '') ?? ''
    if (Object.values(STREET_TYPE_ABBREVIATIONS).includes(upper)) return upper
    return null
  }
  return STREET_TYPE_ABBREVIATIONS[canonical] ?? canonical.toUpperCase()
}

export function expandStreetSuffix(value: string): string {
  const text = value.trim().replace(/\s+/g, ' ')
  if (!text) return text
  const match = SUFFIX_RE.exec(text)
  if (!match) return text
  const type = canonicalStreetType(match[1])
  if (!type) return text
  const stem = text.slice(0, match.index).trim()
  const titled = type.charAt(0).toUpperCase() + type.slice(1)
  return stem ? `${stem} ${titled}` : titled
}

export function normalizeStreetName(value: string | null | undefined): NormalizedStreetName | null {
  const raw = value?.trim().replace(/\s+/g, ' ')
  if (!raw) return null
  const suffix = SUFFIX_RE.exec(raw)
  const prefix = suffix ? null : PREFIX_RE.exec(raw)
  const match = suffix ?? prefix
  const type = match ? canonicalStreetType(match[1]) : null
  const stem = (suffix
    ? raw.slice(0, suffix.index)
    : prefix
      ? raw.slice(prefix[0].length)
      : raw).trim().toLowerCase().replace(/[.,]+$/g, '')
  if (!stem && !type) return null
  return {
    raw,
    stem,
    type,
    typeAbbrev: type ? streetTypeAbbreviation(type) : null,
    canonical: type ? `${stem} ${type}` : stem,
  }
}

export type StreetNameGuardResult =
  | { status: 'match' }
  | { status: 'unconstrained' }
  | { status: 'conflict'; requested: NormalizedStreetName; candidate: NormalizedStreetName }

/**
 * Street ≠ Drive, Street ≠ Road, Drive ≠ Avenue.
 * Same stem with a different canonical type is a conflict. Missing type on either side is not a silent promotion.
 */
export function streetNameGuard(requestedStreet: string | null | undefined, candidateStreet: string | null | undefined): StreetNameGuardResult {
  const requested = normalizeStreetName(requestedStreet)
  if (!requested?.type) return { status: 'unconstrained' }
  const candidate = normalizeStreetName(candidateStreet)
  if (!candidate) return { status: 'unconstrained' }
  if (requested.stem && candidate.stem && requested.stem !== candidate.stem) return { status: 'unconstrained' }
  if (!candidate.type) return { status: 'unconstrained' }
  if (requested.type === candidate.type) return { status: 'match' }
  return { status: 'conflict', requested, candidate }
}

export function candidateStreetFromLabel(label: string | null | undefined, road?: string | null): string | null {
  if (road?.trim()) return road.trim()
  if (!label) return null
  const first = label.split(',')[0]?.trim()
  return first || null
}
