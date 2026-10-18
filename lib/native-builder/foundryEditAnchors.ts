/**
 * Short-lived unique-region edit anchors and MATCH_NOT_FOUND recovery.
 * Broker may return exact current source as a mutation anchor. It must not
 * invent production filenames, replacement text, or fixture-specific hunks.
 */
import { createHash, randomUUID } from 'node:crypto'
import type { FoundryMissionRecord } from './foundryMissionTypes'
import { ensureEngineeringState } from './foundryEngineeringDepth'
import { extractProtectedBindings } from './foundryProtectedBindings'
import { readRepoFile } from './repositoryInspector'
import type { AnchorOrigin } from './foundryAnchorRanking'
import { collectGoalTerms, compareAnchorScores, isLocalizedFixGoal, scoreAnchorText } from './foundryAnchorRanking'

export const MAX_FOCUSED_READ_LINES = 30
export const MAX_FOCUSED_READ_CHARS = 1_500
export const MAX_CONSECUTIVE_SOURCE_READS = 2

export type EditMatchFailureCode = 'MATCH_NOT_FOUND' | 'MATCH_NOT_UNIQUE' | 'STALE_FILE_HASH' | 'STALE_EDIT_ANCHOR' | 'INVALID_REPLACEMENT'

export type FoundryEditAnchor = {
  anchorId: string
  missionId: string
  path: string
  sha256: string
  anchorText: string
  startLine: number
  endLine: number
  startOffset: number
  endOffset: number
  unique: boolean
  createdAt: string
  readEventAt: string
  protectedBindings: string[]
  relevance?: 'HIGH' | 'MEDIUM' | 'LOW'
  relevanceScore?: number
  relevanceReason?: string
  matchedGoalTerms?: string[]
  origin?: AnchorOrigin
}

export type FoundryEditMatchRecovery = {
  status: 'EDIT_MATCH_RECOVERY'
  code: EditMatchFailureCode
  path: string
  nextRequiredAction: 'FOCUSED_READ' | 'BOUNDED_RETRY' | 'REPLAN' | 'BLOCK'
  focusedReadDone: boolean
  retryUsed: boolean
  consecutiveSourceReads: number
  lastReadFingerprint?: string
  lastNovelty?: 'NEW_EVIDENCE' | 'NO_NEW_EVIDENCE'
  lastAnchorId?: string
  failedMatchPreview?: string
  invalidReplacementAttempts?: number
}

export type FoundryLintRegionRecovery = {
  path: string
  line: number
  column?: number
  message?: string
  focusedReadDone: boolean
  retryUsed: boolean
  nextRequiredAction: 'FOCUSED_READ' | 'BOUNDED_RETRY' | 'REPLAN'
}

export type LintErrorLocation = {
  path: string
  line: number
  column: number
  message: string
}

export type EditAnchorView = {
  anchorId: string
  FILE_SHA256: string
  ANCHOR_TEXT: string
  ANCHOR_TEXT_PREVIEW: string
  ANCHOR_FINGERPRINT: string
  ANCHOR_START_LINE: number
  ANCHOR_END_LINE: number
  ANCHOR_UNIQUE: boolean
  PROTECTED_BINDINGS: string[]
  MISSION_ID: string
  ANCHOR_RELEVANCE?: 'HIGH' | 'MEDIUM' | 'LOW'
}

export function anchorFingerprint(text: string): string {
  return sha256(text).slice(0, 16)
}

export function anchorTextPreview(text: string, limit = 240): string {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  if (trimmed.length <= limit) return trimmed
  return `${trimmed.slice(0, limit)}…`
}

const BOILERPLATE = /^(['"]use client['"];?|import\s|export\s+\{\s*\}|from\s+['"])/

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  return haystack.split(needle).length - 1
}

function lineOf(haystack: string, needle: string): number {
  const at = haystack.indexOf(needle)
  if (at < 0) return 1
  return haystack.slice(0, at).split('\n').length
}

function queryPhrases(query: string): string[] {
  const titled = query.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}/g) ?? []
  const caps = query.match(/[A-Z]{2,}(?:\s+[A-Z]{2,}){0,3}/g) ?? []
  const unique = query.match(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g) ?? []
  const raw = query.trim().length >= 8 && query.trim().length <= 80 ? [query.trim()] : []
  return [...new Set([...unique, ...titled, ...caps, ...raw].map(item => item.trim()).filter(item => item.length >= 8))]
    .sort((a, b) => b.length - a.length)
}

function caseInsensitiveMatches(content: string, phrase: string): Array<{ text: string; line: number }> {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return [...content.matchAll(new RegExp(escaped, 'gi'))].flatMap(match => {
    if (!match[0] || match.index == null) return []
    return [{ text: match[0], line: content.slice(0, match.index).split('\n').length }]
  })
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function elementSpanAround(fullContent: string, focusLine: number): string | null {
  const lines = fullContent.split('\n')
  const idx = focusLine - 1
  if (idx < 0 || idx >= lines.length) return null
  const open = /<(div|section|article)[\s>]/
  const close = /<\/(div|section|article)>/
  let start = idx
  while (start > 0 && !open.test(lines[start])) {
    start -= 1
    if (idx - start > 12) return null
  }
  if (!open.test(lines[start]) || /grid-cols|sm:grid-cols|lg:grid-cols/.test(lines[start])) {
    if (/<p[\s>]/.test(lines[idx])) {
      if (/<\/p>/.test(lines[idx])) return lines[idx]
      let end = idx
      while (end < lines.length && !/<\/p>/.test(lines[end])) end += 1
      return lines.slice(idx, Math.min(lines.length, end + 1)).join('\n')
    }
    return null
  }
  let depth = 0
  for (let end = start; end < lines.length; end += 1) {
    depth += (lines[end].match(open) ?? []).length
    depth -= (lines[end].match(close) ?? []).length
    if (end > start && depth <= 0) return lines.slice(start, end + 1).join('\n')
    if (end - start > 20) return null
  }
  return null
}

function anchorsOf(mission: FoundryMissionRecord): FoundryEditAnchor[] {
  const engineering = ensureEngineeringState(mission)
  engineering.editAnchors ??= []
  return engineering.editAnchors
}

export function editAnchorView(anchor: FoundryEditAnchor): EditAnchorView {
  return {
    anchorId: anchor.anchorId,
    FILE_SHA256: anchor.sha256,
    ANCHOR_TEXT: anchor.anchorText,
    ANCHOR_TEXT_PREVIEW: anchorTextPreview(anchor.anchorText),
    ANCHOR_FINGERPRINT: anchorFingerprint(anchor.anchorText),
    ANCHOR_START_LINE: anchor.startLine,
    ANCHOR_END_LINE: anchor.endLine,
    ANCHOR_UNIQUE: anchor.unique,
    PROTECTED_BINDINGS: anchor.protectedBindings ?? extractProtectedBindings(anchor.anchorText),
    MISSION_ID: anchor.missionId,
    ANCHOR_RELEVANCE: anchor.relevance,
  }
}

function uniqueInnerJsxLine(fullContent: string, text: string): string | undefined {
  if (!/\n/.test(text) || !/<(div|section|article|p|span|button|label)[\s>]/.test(text)) return undefined
  const open = /<(div|section|article)[\s>]/
  const close = /<\/(div|section|article)>/
  return text.split('\n').filter(item => {
    const trimmed = item.trim()
    return trimmed.length >= 20
      && !open.test(item)
      && !close.test(item)
      && countOccurrences(fullContent, item) === 1
  }).sort((a, b) => b.length - a.length)[0]
}

function uniqueWindowChunks(fullContent: string, window: string): string[] {
  const out: string[] = []
  const push = (text: string | undefined) => {
    if (!text) return
    if (countOccurrences(fullContent, text) !== 1) return
    if (!out.includes(text)) out.push(text)
  }
  push(uniqueInnerJsxLine(fullContent, window))
  const lines = window.split('\n').filter(line => line.trim().length >= 8 && !BOILERPLATE.test(line.trim()))
  for (const line of lines) {
    if (line.length <= 400) push(line)
  }
  for (let span = 2; span <= Math.min(8, lines.length); span += 1) {
    for (let i = 0; i + span <= lines.length; i += 1) {
      const chunk = lines.slice(i, i + span).join('\n')
      if (chunk.length <= MAX_FOCUSED_READ_CHARS) push(chunk)
    }
  }
  if (window && countOccurrences(fullContent, window) === 1) push(window)
  return out
}

/** The provenance of a candidate: an exact origin line, or the same line with different indentation (a window line is untrimmed, an origin line is trimmed). */
export function originOf(origins: Map<string, AnchorOrigin> | undefined, text: string): AnchorOrigin | undefined {
  return origins?.get(text) ?? origins?.get(text.trim())
}

function pickBestUnique(candidates: string[], fullContent: string, goal?: string, origins?: Map<string, AnchorOrigin>): string | undefined {
  const unique = [...new Set(candidates.filter(text => text && countOccurrences(fullContent, text) === 1))]
  if (!unique.length) return undefined
  if (!goal) return unique[0]
  const ranked = unique
    .map(text => ({ text, startLine: lineOf(fullContent, text), score: scoreAnchorText(text, goal, originOf(origins, text)) }))
    .sort((a, b) => compareAnchorScores({ ...a.score, startLine: a.startLine }, { ...b.score, startLine: b.startLine }))
  const top = ranked[0]
  if (!top || top.score.relevance === 'LOW') return undefined
  const band = ranked.filter(item =>
    item.score.relevance === top.score.relevance
    || item.score.score >= top.score.score - 20,
  )
  const withBindings = band.filter(item => item.score.bindings.length > 0)
  const pool = withBindings.length ? withBindings : band
  return [...pool].sort((a, b) => a.text.length - b.text.length || b.score.score - a.score.score)[0]?.text
}

export function pickUniqueAnchorText(fullContent: string, windowContent: string, preferred?: string, focusLines?: number[], goal?: string, origins?: Map<string, AnchorOrigin>): { text: string; unique: boolean } {
  const known = origins ?? (goal ? anchorOrigins(fullContent, goal) : undefined)
  // A statement of the named function that was asked for by name is that anchor: the global ranking below must not swap it for a different statement of the same function.
  if (known && preferred && countOccurrences(fullContent, preferred) === 1 && originOf(known, preferred)) {
    return { text: known.has(preferred) ? preferred : preferred.trim(), unique: true }
  }
  const candidates: string[] = []
  if (preferred && countOccurrences(fullContent, preferred) === 1) {
    const preferredLines = preferred.split('\n').length
    if (preferredLines >= 2 && preferredLines <= 16 && preferred.length <= MAX_FOCUSED_READ_CHARS) {
      candidates.push(preferred)
    }
    const inner = uniqueInnerJsxLine(fullContent, preferred)
    if (inner) candidates.push(inner)
    if (!candidates.length) candidates.push(preferred)
  }
  if (preferred && countOccurrences(fullContent, preferred) > 1) {
    const inner = uniqueInnerJsxLine(fullContent, windowContent)
    if (inner && inner.includes(preferred)) candidates.push(inner)
  }
  const window = windowContent.length > MAX_FOCUSED_READ_CHARS
    ? windowContent.slice(0, MAX_FOCUSED_READ_CHARS)
    : windowContent
  if (focusLines?.length) {
    for (const line of focusLines) {
      const element = elementSpanAround(fullContent, line)
      if (element && countOccurrences(fullContent, element) === 1 && element.split('\n').length >= 2) {
        candidates.push(element)
        const open = /<(div|section|article)[\s>]/
        const close = /<\/(div|section|article)>/
        for (const item of element.split('\n')) {
          const trimmed = item.trim()
          if (trimmed.length >= 20 && !open.test(item) && !close.test(item) && countOccurrences(fullContent, item) === 1) {
            candidates.push(item)
          }
        }
      }
    }
  }
  candidates.push(...uniqueWindowChunks(fullContent, window))
  if (goal) candidates.push(...findGoalRelevantUniqueSpans(fullContent, goal))
  if (known) candidates.push(...known.keys())
  const best = pickBestUnique(candidates, fullContent, goal, known)
  if (best) return { text: best, unique: true }
  const inner = uniqueInnerJsxLine(fullContent, window)
  if (inner) return { text: inner, unique: true }
  if (preferred && countOccurrences(fullContent, preferred) === 1) {
    return { text: preferred, unique: true }
  }
  if (window && countOccurrences(fullContent, window) === 1) {
    return { text: window, unique: true }
  }
  return { text: window, unique: Boolean(window) && countOccurrences(fullContent, window) === 1 }
}

const FUNCTION_DECLARATION = /^\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:function\*?\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>))/
/** A line that only opens or closes a block (`}`, `} else {`, `try {`): never a statement worth anchoring. */
const STRUCTURAL_LINE = /^(?:[})\]]+[;,]?|(?:\}\s*)?(?:else|try|finally|do)?\s*\{)$/
const COMMENT_LINE = /^(?:\/\/|\/\*|\*)/

/** Braces that open or close a block on one line. Braces inside a string literal or a comment do not count; the state does not carry across lines. */
function blockBraces(line: string): { opens: number; closes: number } {
  let opens = 0
  let closes = 0
  let quote = ''
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (quote) {
      if (ch === '\\') i += 1
      else if (ch === quote) quote = ''
    } else if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
    } else if (ch === '/' && line[i + 1] === '/') {
      break
    } else if (ch === '/' && line[i + 1] === '*') {
      const end = line.indexOf('*/', i + 2)
      if (end < 0) break
      i = end + 1
    } else if (ch === '{') {
      opens += 1
    } else if (ch === '}') {
      closes += 1
    }
  }
  return { opens, closes }
}

export type NamedBodyLine = {
  text: string
  functionName: string
  /** Statement lines in the whole body (blank, comment and block-only lines excluded), not just the unique ones. */
  statements: number
  /** The closing brace was found inside the scan window. */
  closed: boolean
}

/**
 * Unique statement lines inside a function the goal names by its declared name (whole word). A short body line such as `return a - b` carries no goal term and is too short for
 * the term-match rule below, yet it is exactly what a fix to that function changes: offer each unique body line as its own bounded anchor.
 * Only a braced body is scanned: an expression-bodied arrow function has no body lines, and the lines after it belong to other declarations.
 */
export function namedFunctionBodyAnchors(fullContent: string, goal: string, limit = 6): NamedBodyLine[] {
  const lines = fullContent.split('\n')
  const out: NamedBodyLine[] = []
  for (let i = 0; i < lines.length && out.length < limit; i += 1) {
    const declared = lines[i].match(FUNCTION_DECLARATION)
    const name = declared?.[1] ?? declared?.[2]
    if (!name || name.length < 3 || !new RegExp(`(^|[^\\w$])${name.replace(/\$/g, '\\$')}([^\\w$]|$)`).test(goal)) continue
    const found: string[] = []
    let statements = 0
    let depth = 0
    let opened = false
    let closed = false
    for (let j = i; j < lines.length && j < i + 40; j += 1) {
      const inside = opened && depth > 0
      const braces = blockBraces(lines[j])
      if (braces.opens) opened = true
      depth += braces.opens - braces.closes
      const text = lines[j].trim()
      if (j > i && inside && text && !COMMENT_LINE.test(text) && !STRUCTURAL_LINE.test(text)) {
        statements += 1
        if (text.length >= 4 && countOccurrences(fullContent, text) === 1 && !found.includes(text)) found.push(text)
      }
      if (opened && depth <= 0) {
        closed = true
        break
      }
      if (!opened && (j >= i + 6 || (j === i && /=>\s*[^\s{]/.test(lines[j])))) break
    }
    for (const text of found) {
      if (out.length >= limit) break
      if (!out.some(item => item.text === text)) out.push({ text, functionName: name, statements, closed })
    }
  }
  return out
}

export function namedFunctionBodyLines(fullContent: string, goal: string, limit = 6): string[] {
  return namedFunctionBodyAnchors(fullContent, goal, limit).map(item => item.text)
}

/** A function this short has every statement offered as its own anchor (the extras limit), so its lines are not a biased sample. Larger functions (components, controllers) keep the ordinary ranking. */
export const MAX_ORIGIN_BODY_STATEMENTS = 6

/**
 * Provenance for anchor candidates: the unique statement lines of a small function that a localized-fix goal names. Empty for any other goal, so features, renames and signature changes rank as before.
 * `intent` is further text that may name the function (the mission request, when the model's own query is short).
 */
export function anchorOrigins(fullContent: string, goal: string, intent = ''): Map<string, AnchorOrigin> {
  const origins = new Map<string, AnchorOrigin>()
  const naming = [goal, intent].filter(Boolean).join('\n')
  if (!isLocalizedFixGoal(naming)) return origins
  for (const line of namedFunctionBodyAnchors(fullContent, naming, MAX_ORIGIN_BODY_STATEMENTS * 2)) {
    if (line.closed && line.statements <= MAX_ORIGIN_BODY_STATEMENTS) {
      origins.set(line.text, { kind: 'NAMED_FUNCTION_BODY', functionName: line.functionName })
    }
  }
  return origins
}

export function findGoalRelevantUniqueSpans(fullContent: string, goal: string, limit = 6): string[] {
  if (!goal.trim()) return []
  const bodyLines = namedFunctionBodyLines(fullContent, goal, limit)
  const terms = collectGoalTerms(goal)
  if (!terms.length) return bodyLines
  const lines = fullContent.split('\n')
  const scored: Array<{ text: string; startLine: number; score: ReturnType<typeof scoreAnchorText> }> = []
  const seen = new Set<string>()
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    if (line.trim().length < 16) continue
    if (!terms.some(term => line.toLowerCase().includes(term.toLowerCase()))) continue
    const span = elementSpanAround(fullContent, i + 1) ?? line
    if (countOccurrences(fullContent, span) !== 1) continue
    if (seen.has(span)) continue
    seen.add(span)
    scored.push({ text: span, startLine: i + 1, score: scoreAnchorText(span, goal) })
  }
  const ranked = scored
    .sort((a, b) => compareAnchorScores({ ...a.score, startLine: a.startLine }, { ...b.score, startLine: b.startLine }))
    .map(item => item.text)
  return [...new Set([...bodyLines, ...ranked])].slice(0, limit)
}

export function registerEditAnchor(mission: FoundryMissionRecord, input: {
  path: string
  sha256: string
  windowContent: string
  range: { startLine: number; endLine: number }
  fullContent: string
  uniqueHint?: boolean
  preferredText?: string
  focusLines?: number[]
  goal?: string
  intent?: string
}): FoundryEditAnchor | null {
  const rel = input.path.replace(/\\/g, '/').replace(/^\.\//, '').trim()
  const seed = input.windowContent || input.preferredText || ''
  if (!rel || !seed) return null
  const goal = input.goal ?? mission.userRequest ?? mission.goal
  const origins = anchorOrigins(input.fullContent, goal, input.intent)
  const picked = pickUniqueAnchorText(input.fullContent, seed, input.preferredText, input.focusLines, goal, origins)
  const unique = input.uniqueHint === false ? false : picked.unique
  const startLine = unique ? lineOf(input.fullContent, picked.text) : input.range.startLine
  const endLine = startLine + Math.max(1, picked.text.split('\n').length) - 1
  const startOffset = Math.max(0, input.fullContent.indexOf(picked.text))
  const endOffset = startOffset >= 0 ? startOffset + picked.text.length : 0
  const protectedBindings = extractProtectedBindings(picked.text)
  const origin = unique ? originOf(origins, picked.text) : undefined
  const scored = scoreAnchorText(picked.text, goal, origin)
  const anchor: FoundryEditAnchor = {
    anchorId: `anc_${randomUUID().slice(0, 12)}`,
    missionId: mission.missionId,
    path: rel,
    sha256: input.sha256,
    anchorText: picked.text,
    startLine,
    endLine,
    startOffset,
    endOffset,
    unique,
    createdAt: new Date().toISOString(),
    readEventAt: new Date().toISOString(),
    protectedBindings,
    relevance: scored.relevance,
    relevanceScore: scored.score,
    relevanceReason: scored.reason,
    matchedGoalTerms: scored.matchedGoalTerms,
    ...(origin ? { origin } : {}),
  }
  const list = anchorsOf(mission)
  const existing = list.find(item =>
    item.path === rel
    && item.sha256 === input.sha256
    && item.anchorText === picked.text
    && item.missionId === mission.missionId,
  )
  if (existing) {
    existing.readEventAt = new Date().toISOString()
    existing.unique = unique
    existing.startLine = startLine
    existing.endLine = endLine
    existing.startOffset = startOffset
    existing.endOffset = endOffset
    existing.protectedBindings = protectedBindings
    existing.relevance = scored.relevance
    existing.relevanceScore = scored.score
    existing.relevanceReason = scored.reason
    existing.matchedGoalTerms = scored.matchedGoalTerms
    existing.origin = origin
    return existing
  }
  const next = [...list, anchor]
  ensureEngineeringState(mission).editAnchors = next.slice(-8)
  const recovery = ensureEngineeringState(mission).editMatchRecovery
  if (recovery && recovery.path === rel && unique) recovery.lastAnchorId = anchor.anchorId
  return anchor
}

export function registerWindowAnchors(mission: FoundryMissionRecord, input: {
  path: string
  sha256: string
  windowContent: string
  range: { startLine: number; endLine: number }
  fullContent: string
  uniqueHint?: boolean
  preferredText?: string
  extraUniqueTexts?: string[]
  focusLines?: number[]
  goal?: string
  intent?: string
}): FoundryEditAnchor[] {
  const primary = registerEditAnchor(mission, input)
  const out: FoundryEditAnchor[] = primary ? [primary] : []
  if (input.uniqueHint === false) return out
  for (const extra of (input.extraUniqueTexts ?? []).slice(0, 6)) {
    if (!extra || extra === primary?.anchorText) continue
    if (countOccurrences(input.fullContent, extra) !== 1) continue
    const added = registerEditAnchor(mission, {
      ...input,
      windowContent: extra,
      preferredText: extra,
      uniqueHint: true,
    })
    if (added && !out.some(item => item.anchorId === added.anchorId)) out.push(added)
  }
  for (const line of (input.focusLines ?? []).slice(0, 3)) {
    const element = elementSpanAround(input.fullContent, line)
    if (!element || element === primary?.anchorText) continue
    if (countOccurrences(input.fullContent, element) !== 1) continue
    const added = registerEditAnchor(mission, {
      ...input,
      windowContent: element,
      preferredText: element,
      uniqueHint: true,
    })
    if (added && !out.some(item => item.anchorId === added.anchorId)) out.push(added)
  }
  // A statement of the named function that was asked for by name leads the anchors that score no higher than it; the other statements of that function tie with it and must not outrank the request.
  const requested = primary?.origin && input.preferredText && (primary.anchorText === input.preferredText || primary.anchorText === input.preferredText.trim()) ? primary.anchorId : undefined
  const rank = (item: FoundryEditAnchor) => ({
    score: (item.relevanceScore ?? 0) + (item.anchorId === requested ? 0.5 : 0),
    relevance: item.relevance ?? 'LOW',
    matchedGoalTerms: item.matchedGoalTerms ?? [],
    bindings: item.protectedBindings,
    reason: item.relevanceReason ?? '',
    symbol: null,
    goalMatch: '',
    startLine: item.startLine,
  })
  return out.sort((a, b) => compareAnchorScores(rank(a), rank(b)))
}

export function latestAnchor(mission: FoundryMissionRecord, path: string, sha256Hex?: string): FoundryEditAnchor | null {
  const rel = path.replace(/\\/g, '/').replace(/^\.\//, '').trim()
  const list = anchorsOf(mission)
  return [...list].reverse().find(item =>
    item.path === rel
    && item.missionId === mission.missionId
    && (!sha256Hex || item.sha256 === sha256Hex),
  ) ?? null
}

export function invalidateAnchorsForPath(mission: FoundryMissionRecord, path: string): void {
  const rel = path.replace(/\\/g, '/').replace(/^\.\//, '').trim()
  const engineering = ensureEngineeringState(mission)
  engineering.editAnchors = (engineering.editAnchors ?? []).filter(item => item.path !== rel)
  if (engineering.editMatchRecovery?.path === rel) {
    engineering.editMatchRecovery.lastAnchorId = undefined
  }
}

export function resolveEditAnchor(mission: FoundryMissionRecord | null | undefined, input: {
  anchorId?: string
  path: string
  expectedSha256?: string
  actualSha256: string
}): { ok: true; anchor: FoundryEditAnchor } | { ok: false; error: string } {
  if (!mission) return { ok: false, error: 'ANCHOR_INVALID_MISSION: no mission bound to this edit.' }
  const rel = input.path.replace(/\\/g, '/').replace(/^\.\//, '').trim()
  const list = anchorsOf(mission)
  const current = list.filter(item =>
    item.path === rel
    && item.missionId === mission.missionId
    && item.sha256 === input.actualSha256
    && item.unique,
  )
  const byId = input.anchorId
    ? list.find(item => item.anchorId === input.anchorId)
    : current.length === 1
      ? current[0]
      : undefined
  if (!input.anchorId && current.length > 1) {
    return { ok: false, error: 'ANCHOR_AMBIGUOUS: select one anchorId from the last file.read. Do not guess.' }
  }
  if (!byId) return { ok: false, error: 'ANCHOR_NOT_FOUND: file.read a focused region to acquire a current EDIT_ANCHOR.' }
  if (byId.missionId !== mission.missionId) {
    return { ok: false, error: 'ANCHOR_INVALID_MISSION: anchors are not durable across missions.' }
  }
  if (byId.path !== rel) {
    return { ok: false, error: `ANCHOR_INVALID_PATH expected=${byId.path} actual=${rel}` }
  }
  if (byId.sha256 !== input.actualSha256) {
    return { ok: false, error: `STALE_EDIT_ANCHOR expected=${byId.sha256} actual=${input.actualSha256}` }
  }
  if (input.expectedSha256 && input.expectedSha256 !== input.actualSha256) {
    return { ok: false, error: `STALE_EDIT_ANCHOR expected=${input.expectedSha256} actual=${input.actualSha256}` }
  }
  if (!byId.unique) {
    return { ok: false, error: 'MATCH_NOT_UNIQUE: ANCHOR_UNIQUE=false' }
  }
  return { ok: true, anchor: byId }
}

export function beginEditMatchRecovery(mission: FoundryMissionRecord, input: {
  code: EditMatchFailureCode
  path: string
  failedMatchText?: string
  lastAnchorId?: string
}): FoundryEditMatchRecovery {
  const engineering = ensureEngineeringState(mission)
  const existing = engineering.editMatchRecovery
  const same = existing?.path === input.path.replace(/\\/g, '/').replace(/^\.\//, '').trim()
  const lastAnchorId = input.lastAnchorId ?? (same ? existing?.lastAnchorId : undefined)
  let nextRequiredAction: FoundryEditMatchRecovery['nextRequiredAction'] = same && existing?.focusedReadDone
    ? (existing.retryUsed ? 'REPLAN' : 'BOUNDED_RETRY')
    : 'FOCUSED_READ'
  let invalidReplacementAttempts = same ? (existing?.invalidReplacementAttempts ?? 0) : 0
  let focusedReadDone = Boolean(same && existing?.focusedReadDone)
  if (input.code === 'STALE_EDIT_ANCHOR' || input.code === 'STALE_FILE_HASH') {
    focusedReadDone = false
    nextRequiredAction = 'FOCUSED_READ'
  } else if (input.code === 'INVALID_REPLACEMENT') {
    invalidReplacementAttempts += 1
    if (lastAnchorId) {
      focusedReadDone = true
      nextRequiredAction = invalidReplacementAttempts >= 3 ? 'BLOCK' : 'BOUNDED_RETRY'
    }
  }
  const recovery: FoundryEditMatchRecovery = {
    status: 'EDIT_MATCH_RECOVERY',
    code: input.code,
    path: input.path.replace(/\\/g, '/').replace(/^\.\//, '').trim(),
    nextRequiredAction,
    focusedReadDone,
    retryUsed: Boolean(same && existing?.retryUsed),
    consecutiveSourceReads: same ? (existing?.consecutiveSourceReads ?? 0) : 0,
    lastReadFingerprint: same ? existing?.lastReadFingerprint : undefined,
    lastNovelty: same ? existing?.lastNovelty : undefined,
    lastAnchorId,
    failedMatchPreview: (input.failedMatchText ?? '').slice(0, 120),
    invalidReplacementAttempts,
  }
  engineering.editMatchRecovery = recovery
  return recovery
}

export function markFocusedReadComplete(mission: FoundryMissionRecord, path: string, anchorId?: string): void {
  const recovery = ensureEngineeringState(mission).editMatchRecovery
  if (!recovery || recovery.path !== path) return
  recovery.focusedReadDone = true
  recovery.nextRequiredAction = recovery.retryUsed ? 'REPLAN' : 'BOUNDED_RETRY'
  if (anchorId) recovery.lastAnchorId = anchorId
}

export function markBoundedRetryUsed(mission: FoundryMissionRecord, path: string, succeeded: boolean): void {
  const recovery = ensureEngineeringState(mission).editMatchRecovery
  if (!recovery || recovery.path !== path) return
  if (succeeded) {
    ensureEngineeringState(mission).editMatchRecovery = undefined
    return
  }
  if (recovery.focusedReadDone) {
    recovery.retryUsed = true
    recovery.nextRequiredAction = 'REPLAN'
  }
}

export function sourceReadFingerprint(path: string, sha256Hex: string, range: { startLine?: number; endLine?: number }, aroundMatch?: string): string {
  return `${path}|${sha256Hex}|${range.startLine ?? 0}|${range.endLine ?? 0}|${(aroundMatch ?? '').slice(0, 80)}`
}

export function rangesOverlap(a: { startLine: number; endLine: number }, b: { startLine: number; endLine: number }): boolean {
  return a.startLine <= b.endLine && b.startLine <= a.endLine
}

export function noteSourceReadNovelty(mission: FoundryMissionRecord, input: {
  path: string
  sha256: string
  range: { startLine: number; endLine: number }
  aroundMatch?: string
  ownerRelation?: string
}): 'NEW_EVIDENCE' | 'NO_NEW_EVIDENCE' {
  const engineering = ensureEngineeringState(mission)
  const fingerprint = sourceReadFingerprint(input.path, input.sha256, input.range, input.aroundMatch)
  const recovery = engineering.editMatchRecovery?.path === input.path ? engineering.editMatchRecovery : undefined
  const cursor = recovery ?? engineering.sourceReadCursor
  const last = cursor?.lastReadFingerprint
  let novelty: 'NEW_EVIDENCE' | 'NO_NEW_EVIDENCE' = 'NEW_EVIDENCE'
  if (last) {
    const parts = last.split('|')
    const lastSha = parts[1]
    const lastStart = Number(parts[2] || 0)
    const lastEnd = Number(parts[3] || 0)
    const sameSha = lastSha === input.sha256
    const overlap = rangesOverlap(
      { startLine: lastStart, endLine: lastEnd },
      { startLine: input.range.startLine, endLine: input.range.endLine },
    )
    const sameMatch = (parts[4] ?? '') === (input.aroundMatch ?? '').slice(0, 80)
    if (sameSha && (sameMatch || overlap) && !input.ownerRelation) novelty = 'NO_NEW_EVIDENCE'
  }
  const consecutive = novelty === 'NO_NEW_EVIDENCE' ? (cursor?.consecutiveSourceReads ?? 0) + 1 : 1
  if (recovery) {
    recovery.consecutiveSourceReads = consecutive
    recovery.lastReadFingerprint = fingerprint
    recovery.lastNovelty = novelty
  } else {
    engineering.sourceReadCursor = {
      path: input.path,
      consecutiveSourceReads: consecutive,
      lastReadFingerprint: fingerprint,
      lastNovelty: novelty,
    }
  }
  return novelty
}

export function consecutiveSourceReads(mission: FoundryMissionRecord, path: string): number {
  const engineering = ensureEngineeringState(mission)
  if (engineering.editMatchRecovery?.path === path) return engineering.editMatchRecovery.consecutiveSourceReads
  if (engineering.sourceReadCursor?.path === path) return engineering.sourceReadCursor.consecutiveSourceReads
  return 0
}

export function evaluateSourceReadGuard(mission: FoundryMissionRecord, path: string, args: Record<string, unknown>): string | null {
  const rel = String(path ?? '').replace(/\\/g, '/').replace(/^\.\//, '').trim()
  if (!rel) return null
  const engineering = ensureEngineeringState(mission)
  const lintRec = engineering.lintRegionRecovery
  if (lintRec?.path === rel && lintRec.focusedReadDone && lintRec.nextRequiredAction === 'BOUNDED_RETRY') {
    return 'SOURCE_READ_LOOP: FOCUSED_READ already completed. Call file.replace_unique with anchorId from the lint-region WINDOW.'
  }
  const recovery = engineering.editMatchRecovery
  if (recovery?.path === rel && recovery.focusedReadDone && recovery.nextRequiredAction === 'BOUNDED_RETRY') {
    return 'SOURCE_READ_LOOP: FOCUSED_READ already completed. Call file.replace_unique with anchorId or ANCHOR_TEXT from the last file.read.'
  }
  if (recovery?.path === rel && recovery.retryUsed) {
    return 'SOURCE_READ_LOOP: bounded retry already failed. REPLAN with the match-failure evidence.'
  }
  const aroundMatch = typeof args.aroundMatch === 'string' ? args.aroundMatch : typeof args.around_match === 'string' ? args.around_match : ''
  const startLine = typeof args.startLine === 'number' ? args.startLine : typeof args.start_line === 'number' ? args.start_line : 0
  const endLine = typeof args.endLine === 'number' ? args.endLine : typeof args.end_line === 'number' ? args.end_line : 0
  const cursor = recovery?.path === rel ? recovery : ensureEngineeringState(mission).sourceReadCursor
  if (!cursor || (recovery ? recovery.path !== rel : cursor.path !== rel)) return null
  const last = (recovery?.lastReadFingerprint ?? (cursor as { lastReadFingerprint?: string }).lastReadFingerprint) ?? ''
  const lastAround = last.split('|')[4] ?? ''
  const lastStart = Number(last.split('|')[2] || 0)
  const lastEnd = Number(last.split('|')[3] || 0)
  const sameRegion = (aroundMatch && aroundMatch.slice(0, 80) === lastAround)
    || (startLine > 0 && lastStart > 0 && rangesOverlap({ startLine, endLine: endLine || startLine }, { startLine: lastStart, endLine: lastEnd }))
  const consecutive = consecutiveSourceReads(mission, rel)
  if (consecutive >= MAX_CONSECUTIVE_SOURCE_READS && sameRegion) {
    return 'SOURCE_READ_LOOP: more than 2 overlapping source reads without new evidence. Call file.replace_unique or REPLAN.'
  }
  if (consecutive > MAX_CONSECUTIVE_SOURCE_READS) {
    return 'SOURCE_READ_LOOP: more than 2 source reads without mutation. Call file.replace_unique or REPLAN.'
  }
  return null
}

export function selectFocusedReadSelector(input: {
  fileContent: string
  query: string
  lastReadContent?: string
  failedMatchText?: string
}): { aroundMatch?: string; symbol?: string } | null {
  const failed = input.failedMatchText ?? ''
  const usable = (text: string | undefined) => Boolean(text && text !== failed && countOccurrences(input.fileContent, text) === 1 && !BOILERPLATE.test(text.trim()))
  for (const phrase of queryPhrases(input.query)) {
    if (usable(phrase)) return { aroundMatch: phrase }
    const hits = caseInsensitiveMatches(input.fileContent, phrase)
    if (hits.length === 1 && usable(hits[0].text)) return { aroundMatch: hits[0].text }
  }
  const quoted = [...(input.lastReadContent ?? '').matchAll(/['"`]([^'"`]{8,80})['"`]/g)].map(match => match[1])
  for (const lit of quoted) {
    if (usable(lit)) return { aroundMatch: lit }
  }
  const lines = (input.lastReadContent ?? '').split('\n').map(line => line.trimEnd()).filter(line => line.trim().length >= 8)
  for (const line of lines) {
    if (usable(line) && !BOILERPLATE.test(line.trim())) return { aroundMatch: line }
  }
  const symbols = [...(input.lastReadContent ?? '').matchAll(/\b([A-Z][A-Za-z0-9]{3,})\b/g)].map(match => match[1])
  for (const symbol of symbols) {
    if (input.fileContent.includes(`function ${symbol}`) || input.fileContent.includes(`function ${symbol}(`) || input.fileContent.includes(`export function ${symbol}`)) {
      return { symbol }
    }
  }
  return null
}

export function parseLintErrorLocations(blob: string): LintErrorLocation[] {
  const out: LintErrorLocation[] = []
  let currentPath = ''
  for (const raw of blob.split('\n')) {
    const line = raw.replace(/\r$/, '')
    const unix = /^(.*?):(\d+):(\d+):\s+error\b\s*(.*)$/.exec(line)
    if (unix) {
      out.push({
        path: unix[1].trim(),
        line: Number(unix[2]),
        column: Number(unix[3]),
        message: unix[4].trim().slice(0, 160),
      })
      continue
    }
    if (/^(?:\/|[A-Za-z]:[\\/]).+\.\w+$/.test(line.trim()) || /^(?:components|lib|app|scripts|desktop)\/\S+\.\w+$/.test(line.trim())) {
      currentPath = line.trim()
      continue
    }
    const stylish = /^\s+(\d+):(\d+)\s+error\b\s+(.*)$/.exec(line)
    if (stylish && currentPath) {
      out.push({
        path: currentPath,
        line: Number(stylish[1]),
        column: Number(stylish[2]),
        message: stylish[3].trim().slice(0, 160),
      })
    }
  }
  return out
}

export function repoRelativeLintPath(raw: string, repoRoot: string): string {
  const normalized = raw.replace(/\\/g, '/')
  const root = repoRoot.replace(/\\/g, '/').replace(/\/$/, '')
  if (normalized.startsWith(`${root}/`)) return normalized.slice(root.length + 1)
  const nested = /((?:components|lib|app|scripts|desktop)\/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+)/.exec(normalized)
  return nested?.[1] ?? normalized.replace(/^\.\//, '')
}

export function lintFocusedReadArgs(path: string, line: number): Record<string, unknown> {
  const startLine = Math.max(1, line - 10)
  const endLine = line + 15
  return { path, startLine, endLine, focused: true, contextLines: 10 }
}

export function beginLintRegionRecovery(mission: FoundryMissionRecord, input: {
  path: string
  line: number
  column?: number
  message?: string
}): FoundryLintRegionRecovery {
  const rel = input.path.replace(/\\/g, '/').replace(/^\.\//, '').trim()
  const existing = ensureEngineeringState(mission).lintRegionRecovery
  const same = existing?.path === rel
  const recovery: FoundryLintRegionRecovery = {
    path: rel,
    line: input.line,
    column: input.column,
    message: input.message,
    focusedReadDone: Boolean(same && existing?.focusedReadDone),
    retryUsed: Boolean(same && existing?.retryUsed),
    nextRequiredAction: same && existing?.retryUsed
      ? 'REPLAN'
      : same && existing?.focusedReadDone
        ? 'BOUNDED_RETRY'
        : 'FOCUSED_READ',
  }
  ensureEngineeringState(mission).lintRegionRecovery = recovery
  ensureEngineeringState(mission).sourceReadCursor = undefined
  return recovery
}

export function markLintFocusedReadComplete(mission: FoundryMissionRecord, path: string, anchorId?: string): void {
  const recovery = ensureEngineeringState(mission).lintRegionRecovery
  if (!recovery || recovery.path !== path) return
  recovery.focusedReadDone = true
  recovery.nextRequiredAction = recovery.retryUsed ? 'REPLAN' : 'BOUNDED_RETRY'
  if (anchorId) {
    const match = ensureEngineeringState(mission).editMatchRecovery
    if (match?.path === path) match.lastAnchorId = anchorId
  }
}

export function markLintRetryUsed(mission: FoundryMissionRecord, path: string, succeeded: boolean): void {
  const recovery = ensureEngineeringState(mission).lintRegionRecovery
  if (!recovery || recovery.path !== path) return
  recovery.retryUsed = true
  if (succeeded) return
  recovery.nextRequiredAction = 'REPLAN'
}

export async function focusedReadArgs(mission: FoundryMissionRecord, path: string, failedMatchText?: string): Promise<Record<string, unknown> | null> {
  const rel = path.replace(/\\/g, '/').replace(/^\.\//, '').trim()
  const file = await readRepoFile(rel)
  if (!file.ok) return { path: rel, startLine: 1, endLine: 24, focused: true, contextLines: 8 }
  const lastRead = [...mission.toolCalls].reverse().find(call => call.ok && call.tool === 'file.read' && (call.excerpt ?? '').includes(`"relPath":"${rel}"`))
  let lastContent = ''
  try {
    lastContent = String((JSON.parse(lastRead?.excerpt ?? '{}') as { content?: string }).content ?? '')
  } catch {
    lastContent = ''
  }
  const selector = selectFocusedReadSelector({
    fileContent: file.content,
    query: mission.userRequest,
    lastReadContent: lastContent,
    failedMatchText,
  })
  if (selector?.aroundMatch) {
    return { path: rel, aroundMatch: selector.aroundMatch, focused: true, contextLines: 8, query: mission.userRequest }
  }
  if (selector?.symbol) {
    return { path: rel, symbol: selector.symbol, focused: true, contextLines: 8, query: mission.userRequest }
  }
  return { path: rel, query: mission.userRequest, focused: true, contextLines: 8 }
}

export function capFocusedWindow(content: string, range: { startLine: number; endLine: number }): { content: string; range: { startLine: number; endLine: number } } {
  if (!content) return { content: '', range }
  const lines = content.split('\n')
  const maxLines = Math.min(Math.max(1, lines.length), MAX_FOCUSED_READ_LINES)
  const kept = lines.slice(0, maxLines)
  let sliced = kept.join('\n')
  if (sliced.length > MAX_FOCUSED_READ_CHARS) {
    const acc: string[] = []
    for (const line of kept) {
      const next = acc.length ? `${acc.join('\n')}\n${line}` : line
      if (acc.length && next.length > MAX_FOCUSED_READ_CHARS) break
      acc.push(line)
    }
    sliced = acc.join('\n') || kept[0]?.slice(0, MAX_FOCUSED_READ_CHARS) || content.slice(0, MAX_FOCUSED_READ_CHARS)
  }
  if (!sliced && content) sliced = content.split('\n')[0] ?? content
  const used = Math.max(1, sliced.split('\n').length)
  return { content: sliced, range: { startLine: range.startLine, endLine: range.startLine + used - 1 } }
}

export function fileShaOf(content: string): string {
  return sha256(content)
}
