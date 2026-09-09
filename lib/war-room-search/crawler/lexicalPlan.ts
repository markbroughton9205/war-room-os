export const LEXICAL_STOP_WORDS = new Set([
  'and',
  'or',
  'the',
  'for',
  'of',
  'in',
  'to',
])

export const LEXICAL_OPERATOR_WORDS = new Set([
  'and',
  'or',
  'not',
  'near',
])

export const LEXICAL_MAX_CONTENT_TOKENS = 8
export const LEXICAL_STRICT_SUFFICIENT = 1
export const LEXICAL_MIN_GROUP_TOKENS_FOR_SPLIT = 2

export type LexicalPlanUsed = 'NONE' | 'STRICT' | 'RELAXED'

export type LocalLexicalPlan = {
  planUsed: LexicalPlanUsed
  relaxationApplied: boolean
  strictCandidateCount: number
  relaxedCandidateCount: number
  termsUsed: string[]
  phrasesUsed: string[]
  groupsUsed: string[][]
  truncated: boolean
  stopWordsRemoved: string[]
  strictFtsMs: number
  relaxedFtsMs: number
}

export type BuiltLexicalQuery = {
  rawTokens: string[]
  termsUsed: string[]
  phrasesUsed: string[]
  groupsUsed: string[][]
  stopWordsRemoved: string[]
  truncated: boolean
  strictMatch: string | null
  relaxedMatch: string | null
  canRelax: boolean
}

export function emptyLexicalPlan(): LocalLexicalPlan {
  return {
    planUsed: 'NONE',
    relaxationApplied: false,
    strictCandidateCount: 0,
    relaxedCandidateCount: 0,
    termsUsed: [],
    phrasesUsed: [],
    groupsUsed: [],
    truncated: false,
    stopWordsRemoved: [],
    strictFtsMs: 0,
    relaxedFtsMs: 0,
  }
}

export function quoteFtsToken(token: string): string {
  const cleaned = token.replace(/"/g, '').trim()
  if (!cleaned) return ''
  if (LEXICAL_OPERATOR_WORDS.has(cleaned.toLowerCase())) return ''
  return `"${cleaned}"`
}

function isStopOrOperator(token: string): boolean {
  const lower = token.toLowerCase()
  return LEXICAL_STOP_WORDS.has(lower) || LEXICAL_OPERATOR_WORDS.has(lower)
}

function isContentToken(token: string): boolean {
  return token.length > 1 && !isStopOrOperator(token)
}

export function tokenizeLexicalQuery(query: string): string[] {
  const normalized = query.normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  if (!normalized) return []
  return normalized.split(/\s+/).filter(token => token.length > 1)
}

function andClause(tokens: string[]): string {
  return tokens.map(quoteFtsToken).filter(Boolean).join(' AND ')
}

function adjacentPhrases(tokens: string[]): string[] {
  const phrases: string[] = []
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const left = tokens[index]!
    const right = tokens[index + 1]!
    const keepPair =
      (left.length >= 3 && right.length >= 3)
      || /^\d+$/.test(right)
      || (left.length <= 4 && left === left.toUpperCase())
      || (right.length <= 4 && right === right.toUpperCase())
    if (keepPair) phrases.push(`${left} ${right}`)
  }
  return phrases
}

export function buildLegacyStrictMatch(query: string): string | null {
  const trimmed = query.trim().replace(/["']/g, ' ').replace(/\s+/g, ' ')
  if (!trimmed) return null
  const tokens = trimmed.split(' ').filter(token => token.length > 1).slice(0, LEXICAL_MAX_CONTENT_TOKENS)
  if (!tokens.length) return null
  const match = tokens.map(token => `"${token.replace(/"/g, '')}"`).filter(token => token.length > 2).join(' AND ')
  return match || null
}

export function planLexicalQuery(query: string): BuiltLexicalQuery {
  const rawTokens = tokenizeLexicalQuery(query)
  const stopWordsRemoved = [...new Set(rawTokens.map(token => token.toLowerCase()).filter(token => LEXICAL_STOP_WORDS.has(token)))]
  const contentAll = rawTokens.filter(isContentToken)
  const truncated = contentAll.length > LEXICAL_MAX_CONTENT_TOKENS
  const termsUsed = contentAll.slice(0, LEXICAL_MAX_CONTENT_TOKENS)

  const rawGroups: string[][] = []
  let current: string[] = []
  for (const token of rawTokens) {
    if (isStopOrOperator(token)) {
      if (current.length) {
        rawGroups.push(current)
        current = []
      }
      continue
    }
    current.push(token)
  }
  if (current.length) rawGroups.push(current)

  const contentGroups = rawGroups
    .map(group => group.filter(isContentToken))
    .map(group => group.slice(0, LEXICAL_MAX_CONTENT_TOKENS))
    .filter(group => group.length > 0)

  const splitOk =
    contentGroups.length >= 2
    && contentGroups.every(group => group.length >= LEXICAL_MIN_GROUP_TOKENS_FOR_SPLIT)

  const groupsUsed = splitOk ? contentGroups : (termsUsed.length ? [termsUsed] : [])
  const phrasesUsed = [...new Set(groupsUsed.flatMap(adjacentPhrases))]
  const strictMatch = termsUsed.length ? andClause(termsUsed) : null
  const relaxedMatch = splitOk
    ? groupsUsed.map(group => `( ${andClause(group)} )`).join(' OR ')
    : strictMatch
  const canRelax = Boolean(splitOk && relaxedMatch && relaxedMatch !== strictMatch)

  return {
    rawTokens,
    termsUsed,
    phrasesUsed,
    groupsUsed,
    stopWordsRemoved,
    truncated,
    strictMatch: strictMatch || null,
    relaxedMatch: relaxedMatch || null,
    canRelax,
  }
}

export function lexicalPlanFromBuilt(
  built: BuiltLexicalQuery,
  extras?: Partial<LocalLexicalPlan>,
): LocalLexicalPlan {
  return {
    ...emptyLexicalPlan(),
    termsUsed: built.termsUsed,
    phrasesUsed: built.phrasesUsed,
    groupsUsed: built.groupsUsed,
    truncated: built.truncated,
    stopWordsRemoved: built.stopWordsRemoved,
    ...extras,
  }
}
