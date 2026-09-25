/**
 * General bounded unique-hunk edit. The model names the file, unique region, and
 * replacement. Tool Broker locates, verifies, and mutates. No fixture-specific targets.
 */
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import type { NativeRepairProposal } from './types'
import { applyProposal } from './patchApplier'
import { assertCanonicalRepoPath, readRepoFile, resolveRepoRelativePath } from './repositoryInspector'
import { evaluateWriteSafety } from './foundryEngineeringContract'
import { loadMission } from './foundryMissionStore'
import { logWarRoomRepoAudit } from '@/lib/war-room/repoAudit'
import { resolveRepoRoot } from '@/lib/repo/paths'
import type { FoundryMissionRecord } from './foundryMissionTypes'
import { buildCodeIndex, lookupSymbol } from './foundryCodeIntelligence'
import { ensureEngineeringState } from './foundryEngineeringDepth'
import {
  capFocusedWindow,
  editAnchorView,
  findGoalRelevantUniqueSpans,
  invalidateAnchorsForPath,
  MAX_FOCUSED_READ_CHARS,
  MAX_FOCUSED_READ_LINES,
  markLintRetryUsed,
  registerWindowAnchors,
  resolveEditAnchor,
} from './foundryEditAnchors'
import { formatAnchorCandidates, scoreAnchorText, compareAnchorScores, collectGoalTerms } from './foundryAnchorRanking'
import {
  extractProtectedBindings,
  formatProtectedBindingRefusal,
  missingProtectedBindings,
  presentProtectedBindings,
  siblingDetailBindings,
  availableObjectFields,
  hasSelectedBinding,
} from './foundryProtectedBindings'

export const BOUNDED_EDIT_TOOL = 'file.replace_unique' as const

export const MAX_REPLACED_LINES = 40
export const MAX_REPLACEMENT_LINES = 60
export const MAX_TOTAL_CHANGED_LINES = 80
export const MAX_READ_WINDOW_LINES = 40

export const SOURCE_MUTATION_TOOLS = [
  'file.write',
  'file.patch',
  'file.replace_unique',
  'file.move',
  'file.delete',
] as const

export function isSourceMutationTool(tool: string): boolean {
  return (SOURCE_MUTATION_TOOLS as readonly string[]).includes(tool)
}

export type BoundedEditRefusal =
  | 'MATCH_NOT_FOUND'
  | 'MATCH_NOT_UNIQUE'
  | 'STALE_FILE_HASH'
  | 'STALE_EDIT_ANCHOR'
  | 'INVALID_REPLACEMENT'
  | 'BASELINE_REQUIRED'
  | 'OWNER_EVIDENCE_REQUIRED'
  | 'EDIT_SCOPE_TOO_LARGE'
  | 'TERRA_LOCKED'
  | 'REFUSED_PROTECTED_SUBSYSTEM'
  | 'REFUSED_OUTSIDE_WRITE_SET'
  | 'GENERATED_OR_VENDOR'
  | 'LOCKED_FILE'
  | 'OUTSIDE_WORKSPACE'

export type BoundedEditInput = {
  path: string
  expectedSha256: string
  matchText: string
  replacementText: string
  reason: string
  before?: string
  after?: string
  baselineCaptured?: boolean
  ownerEvidence?: unknown
  anchorId?: string
}

export type BoundedEditApplied = {
  STATUS: 'APPLIED'
  FILE: string
  OLD_SHA256: string
  NEW_SHA256: string
  MATCH_COUNT: 1
  CHANGED_LINE_RANGE: { start: number; end: number }
  LINES_REMOVED: number
  LINES_ADDED: number
  OWNER_EVIDENCE_ACCEPTED: string
  BASELINE_ID: string
  AUDIT_ID: string
  ANCHOR_ID?: string
  PROTECTED_BINDINGS_PRESERVED?: 'YES'
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function lineCount(text: string): number {
  if (!text) return 0
  return text.split('\n').length
}

export function isEngineeringReviewDetailRequest(request: string): boolean {
  return /explain what Foundry checked|Engineering Review detail|engineeringReviewDetail|hardcoded PASS|Checked detail/i.test(request)
}

export function describeReplacementShape(matchText: string): {
  TARGET_NODE_KIND: string
  PRESERVE_EXPRESSIONS: string[]
  PARENT_ELEMENT: string | null
} {
  const bindings = extractProtectedBindings(matchText)
  const jsx = /<[A-Za-z]|className=|\{selected\.|\{props\./.test(matchText)
  const parent = matchText.match(/<([A-Za-z][\w.]*)\b/)?.[1] ?? null
  let kind = 'SOURCE_SPAN'
  if (jsx && parent) kind = 'JSX_ELEMENT'
  else if (/^import\s/.test(matchText.trim())) kind = 'IMPORT'
  else if (/\breturn\s*\(/.test(matchText) || /\?/.test(matchText) && /:/.test(matchText)) kind = jsx ? 'JSX_CONDITIONAL' : 'CONDITIONAL'
  else if (/\b[A-Za-z_][\w]*\s*\(/.test(matchText) && !jsx) kind = 'CALL_EXPRESSION'
  else if (/:\s*['"`]|=\s*\{/.test(matchText) && !jsx) kind = 'OBJECT_FIELD'
  else if (jsx) kind = 'JSX_TEXT'
  return {
    TARGET_NODE_KIND: kind,
    PRESERVE_EXPRESSIONS: bindings,
    PARENT_ELEMENT: parent,
  }
}

export function formatEditContract(input: {
  goal: string
  anchorId: string
  matchText: string
  requiredBindings: string[]
}): string {
  const shape = describeReplacementShape(input.matchText)
  const required = [...new Set([...input.requiredBindings, ...shape.PRESERVE_EXPRESSIONS])]
  const mustNot = [
    'copy instruction placeholders into replacementText',
    'reconstruct surrounding component structure from memory',
  ]
  if (required.some(item => /Detail$/i.test(item)) || /engineeringReviewDetail|statusDetail/.test(input.matchText)) {
    mustNot.unshift('remove sibling detail binding')
  }
  if (
    /PASS: Foundry checked|hardcoded PASS/i.test(input.matchText)
    || required.some(item => !/Detail$/i.test(item) && /Review$/i.test(item.split('.').pop() ?? ''))
  ) {
    mustNot.unshift('hardcode PASS copy in place of the status expression')
    mustNot.unshift('keep redundant explanatory PASS prose that duplicates the detail field')
  }
  return [
    'EDIT_CONTRACT:',
    `EDIT_GOAL: ${input.goal.slice(0, 180)}`,
    `ANCHOR: ${input.anchorId}`,
    'REQUIRED_BINDINGS:',
    ...(required.length ? required.map(item => `- ${item}`) : ['- (none derived from this span)']),
    'MUST_PRESERVE:',
    '- existing status / control semantics',
    '- existing enclosing JSX structure',
    `TARGET_NODE_KIND = ${shape.TARGET_NODE_KIND}`,
    shape.PARENT_ELEMENT ? `PARENT_ELEMENT = ${shape.PARENT_ELEMENT}` : '',
    shape.PRESERVE_EXPRESSIONS.length ? `PRESERVE_EXPRESSIONS =\n${shape.PRESERVE_EXPRESSIONS.map(item => `  ${item}`).join('\n')}` : '',
    'MUST_NOT:',
    ...mustNot.map(item => `- ${item}`),
    'Write only replacementText. Do not invent matchText. Do not emit this contract as code.',
  ].filter(Boolean).join('\n')
}

export function requiredReplacementBindings(_request: string, matchText = ''): string[] {
  return extractProtectedBindings(matchText)
}

export function formatInvalidReplacementEvidence(input: {
  missingBindings?: string[]
  presentBindings?: string[]
  reason: string
  anchorId?: string
  requiredBindings?: string[]
}): string {
  return formatProtectedBindingRefusal({
    missing: input.missingBindings ?? input.requiredBindings ?? [],
    present: input.presentBindings ?? [],
    reason: input.reason,
    anchorId: input.anchorId,
  })
}

function replacementBreaksJsx(matchText: string, replacementText: string): string | null {
  const matchLooksLikeJsx = /<[A-Za-z]|className=|<\/[A-Za-z]/.test(matchText)
  const rawComment = /^\s*\/\//.test(replacementText) && !/\{\s*\/\*/.test(replacementText)
  if (matchLooksLikeJsx && rawComment) {
    return 'MALFORMED_JSX'
  }
  for (const id of [...matchText.matchAll(/data-testid=["']([^"']+)["']/g)].map(match => match[1])) {
    if (id && !replacementText.includes(id)) {
      return `TESTID_MISSING:${id}`
    }
  }
  const opens = (replacementText.match(/</g) ?? []).length
  const closes = (replacementText.match(/>/g) ?? []).length
  if (matchLooksLikeJsx && opens !== closes) return 'MALFORMED_JSX'
  return null
}

export function validateReplacementText(input: {
  request: string
  matchText: string
  replacementText: string
  anchorId?: string
  fileContent?: string
}): string | null {
  if (!input.replacementText.trim()) {
    return formatProtectedBindingRefusal({
      missing: extractProtectedBindings(input.matchText),
      present: [],
      reason: 'EMPTY_REPLACEMENT',
      anchorId: input.anchorId,
      required: extractProtectedBindings(input.matchText),
    })
  }
  const extra = input.fileContent && isEngineeringReviewDetailRequest(input.request)
    ? siblingDetailBindings(input.fileContent, input.matchText)
    : []
  const fromMatch = missingProtectedBindings(input.matchText, input.replacementText, input.request)
  const missingExtra = extra.filter(item => !hasSelectedBinding(input.replacementText, item))
  const missing = [...new Set([...fromMatch, ...missingExtra])]
  const present = presentProtectedBindings(input.matchText, input.replacementText)
  const required = [...new Set([...extractProtectedBindings(input.matchText), ...extra])]
  const fail = (reason: string, missingBindings: string[] = missing) => formatProtectedBindingRefusal({
    missing: missingBindings,
    present,
    reason,
    anchorId: input.anchorId,
    required,
  })
  if (missing.length) return fail('MISSING_PROTECTED_BINDINGS', missing)
  const jsxBreak = replacementBreaksJsx(input.matchText, input.replacementText)
  if (jsxBreak === 'MALFORMED_JSX') return fail('MALFORMED_JSX', [])
  if (jsxBreak?.startsWith('TESTID_MISSING:')) {
    const id = jsxBreak.slice('TESTID_MISSING:'.length)
    return fail('TESTID_MISSING', [`data-testid="${id}"`])
  }
  if (/TODO|FIXME|YOUR_CODE_HERE|<\s*\.\.\.|placeholder/i.test(input.replacementText)) {
    return fail('PLACEHOLDER_TEXT', [])
  }
  if (/Do not reconstruct|Use the supplied anchorId|REQUIRED_BINDING|replacementText must|PROTECTED_BINDINGS/i.test(input.replacementText)) {
    return fail('INSTRUCTION_TEXT_IN_CODE', [])
  }
  if (/Tell Foundry the result you want|FoundryHomeNav|operations dashboard/i.test(input.replacementText)) {
    return fail('HOMEPAGE_LEAKAGE', [])
  }
  if (/\bChecked:\s*(<\/|$)/i.test(input.replacementText)) {
    return fail('EMPTY_CHECKED_DETAIL', [])
  }
  return null
}

export function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  return haystack.split(needle).length - 1
}

export function occurrenceLineNumbers(haystack: string, needle: string, limit = 8): number[] {
  if (!needle) return []
  const lines: number[] = []
  let from = 0
  while (lines.length < limit) {
    const at = haystack.indexOf(needle, from)
    if (at < 0) break
    lines.push(haystack.slice(0, at).split('\n').length)
    from = at + needle.length
  }
  return lines
}

function normalizeRel(rel: string): string {
  return rel.replace(/\\/g, '/').replace(/^\.\//, '').trim()
}

export function classifyBoundedEditFailure(error: string | undefined): BoundedEditRefusal | null {
  const text = error ?? ''
  const codes: BoundedEditRefusal[] = [
    'MATCH_NOT_FOUND',
    'MATCH_NOT_UNIQUE',
    'STALE_FILE_HASH',
    'STALE_EDIT_ANCHOR',
    'BASELINE_REQUIRED',
    'OWNER_EVIDENCE_REQUIRED',
    'EDIT_SCOPE_TOO_LARGE',
    'TERRA_LOCKED',
    'GENERATED_OR_VENDOR',
    'LOCKED_FILE',
    'OUTSIDE_WORKSPACE',
    'INVALID_REPLACEMENT',
  ]
  return codes.find(code => text.includes(code)) ?? null
}

export function inferUniqueQueryMatch(content: string, query: string): string | undefined {
  const phrases = queryPhrases(query)
  for (const phrase of phrases) {
    if (countOccurrences(content, phrase) === 1) return phrase
    const matches = caseInsensitiveMatches(content, phrase)
    if (matches.length === 1) return matches[0].text
  }
  return undefined
}

export function inferQueryReadBounds(content: string, query: string): {
  aroundMatch?: string
  startLine?: number
  endLine?: number
  candidates?: Array<{ line: number; text: string }>
  ambiguous?: boolean
} | undefined {
  const total = content.split('\n').length
  const phrases = [...new Set([...queryPhrases(query), ...collectGoalTerms(query)])]
  const uniqueHits: Array<{ text: string; line: number; phrase: string }> = []
  const multiHits: Array<{ line: number; text: string }> = []
  for (const phrase of phrases) {
    if (countOccurrences(content, phrase) === 1) {
      uniqueHits.push({ text: phrase, line: occurrenceLineNumbers(content, phrase)[0] ?? 1, phrase })
      continue
    }
    const matches = caseInsensitiveMatches(content, phrase)
    if (matches.length === 1) uniqueHits.push({ text: matches[0].text, line: matches[0].line, phrase })
    if (matches.length > 1) multiHits.push(...matches.map(item => ({ line: item.line, text: item.text })))
  }
  const goalSpans = findGoalRelevantUniqueSpans(content, query)
  if (goalSpans.length) {
    const rankedSpans = goalSpans
      .map(text => ({
        text,
        line: occurrenceLineNumbers(content, text)[0] ?? 1,
        score: scoreAnchorText(text, query),
      }))
      .sort((a, b) => compareAnchorScores({ ...a.score, startLine: a.line }, { ...b.score, startLine: b.line }))
    const best = rankedSpans[0]
    if (best && best.score.relevance !== 'LOW') {
      return { aroundMatch: best.text }
    }
  }
  if (uniqueHits.length) {
    const ranked = uniqueHits
      .map(hit => ({ ...hit, score: scoreAnchorText(hit.text, query) }))
      .sort((a, b) => compareAnchorScores({ ...a.score, startLine: a.line }, { ...b.score, startLine: b.line }))
    return { aroundMatch: ranked[0]?.text }
  }
  if (multiHits.length) {
    const lines = multiHits.map(item => item.line)
    const start = Math.min(...lines)
    const end = Math.max(...lines)
    if (end - start + 1 <= MAX_READ_WINDOW_LINES) {
      return {
        startLine: Math.max(1, start - 8),
        endLine: Math.min(total, end + 8),
        candidates: multiHits,
      }
    }
    return { candidates: multiHits, ambiguous: true }
  }
  return undefined
}

export function uniqueCopyLines(full: string, windowContent: string, limit = 6): string[] {
  const out: string[] = []
  for (const line of windowContent.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length < 16 || trimmed.length > 180) continue
    const candidate = countOccurrences(full, trimmed) === 1 ? trimmed : countOccurrences(full, line) === 1 ? line : null
    if (candidate && !out.includes(candidate)) out.push(candidate)
    if (out.length >= limit) break
  }
  return out
}

function queryPhrases(query: string): string[] {
  const titled = query.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}/g) ?? []
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

export function boundedEditRecoveryHint(code: BoundedEditRefusal | null): string | null {
  if (code === 'INVALID_REPLACEMENT') {
    return 'ERROR=INVALID_REPLACEMENT NEXT_ACTION=file.replace_unique Keep the same ANCHOR_ID. Correct replacementText only. Do not reconstruct matchText. Do not reread unless STALE_EDIT_ANCHOR.'
  }
  if (code === 'MATCH_NOT_FOUND' || code === 'STALE_FILE_HASH' || code === 'MATCH_NOT_UNIQUE' || code === 'STALE_EDIT_ANCHOR') {
    return 'EDIT_MATCH_RECOVERY: reread with file.read, obtain a fresh anchorId, then one file.replace_unique using that anchorId plus replacementText. Do not reconstruct matchText. Do not loop identical file.read calls.'
  }
  return null
}

export function compactFileReadWindow(content: string, options: {
  startLine?: number
  endLine?: number
  aroundMatch?: string
  contextLines?: number
  focused?: boolean
}): {
  content: string
  range: { startLine: number; endLine: number; totalLines: number }
  matchCount?: number
  matchLines?: number[]
  error?: string
} {
  const lines = content.split('\n')
  const totalLines = lines.length
  const aroundMatch = options.aroundMatch
  const maxLines = options.focused ? MAX_FOCUSED_READ_LINES : MAX_READ_WINDOW_LINES
  if (aroundMatch) {
    const matchCount = countOccurrences(content, aroundMatch)
    const matchLines = occurrenceLineNumbers(content, aroundMatch)
    if (matchCount === 0) {
      return {
        content: '',
        range: { startLine: 1, endLine: 0, totalLines },
        matchCount,
        matchLines,
        error: 'MATCH_NOT_FOUND',
      }
    }
    if (matchCount > 1) {
      const uniqueLines = [...new Set(matchLines)]
      if (uniqueLines.length !== 1) {
        return {
          content: '',
          range: { startLine: matchLines[0] ?? 1, endLine: matchLines.at(-1) ?? matchLines[0] ?? 1, totalLines },
          matchCount,
          matchLines,
          error: 'MATCH_NOT_UNIQUE',
        }
      }
    }
    const hitLine = matchLines[0] ?? 1
    const defaultPad = options.focused ? 8 : 12
    const pad = Math.min(maxLines, Math.max(4, options.contextLines ?? defaultPad))
    const startLine = Math.max(1, hitLine - pad)
    const matchLineCount = aroundMatch.split('\n').length
    let endLine = Math.min(totalLines, hitLine + matchLineCount - 1 + pad)
    if (endLine - startLine + 1 > maxLines) endLine = Math.min(totalLines, startLine + maxLines - 1)
    const raw = lines.slice(startLine - 1, endLine).join('\n')
    const capped = options.focused ? capFocusedWindow(raw, { startLine, endLine }) : { content: raw, range: { startLine, endLine } }
    return {
      content: capped.content,
      range: { startLine: capped.range.startLine, endLine: capped.range.endLine, totalLines },
      matchCount,
      matchLines,
    }
  }
  const startLine = Math.max(1, Math.floor(options.startLine ?? 1))
  const endLine = Math.min(totalLines, Math.max(startLine, Math.floor(options.endLine ?? totalLines)))
  const windowTooWide = endLine - startLine + 1 > maxLines && (options.startLine != null || options.endLine != null || options.focused)
  const cappedEnd = windowTooWide ? startLine + maxLines - 1 : (options.focused ? Math.min(endLine, startLine + maxLines - 1) : endLine)
  const raw = lines.slice(startLine - 1, cappedEnd).join('\n')
  const capped = options.focused ? capFocusedWindow(raw, { startLine, endLine: cappedEnd }) : { content: raw, range: { startLine, endLine: cappedEnd } }
  return {
    content: capped.content,
    range: { startLine: capped.range.startLine, endLine: capped.range.endLine, totalLines },
  }
}

export async function compactFileRead(
  input: Record<string, unknown>,
  mission?: FoundryMissionRecord | null,
): Promise<{
  ok: boolean
  result?: Record<string, unknown>
  error?: string
}> {
  const rel = normalizeRel(String(input.path ?? input.file ?? ''))
  if (!rel) return { ok: false, error: 'file.read requires path.' }
  const abs = resolveRepoRelativePath(rel)
  await assertCanonicalRepoPath(abs, true)
  const file = await readRepoFile(rel)
  if (!file.ok) return { ok: false, error: file.error }
  let aroundMatch = typeof input.aroundMatch === 'string'
    ? input.aroundMatch
    : typeof input.around_match === 'string' ? input.around_match : undefined
  const symbol = typeof input.symbol === 'string' ? input.symbol : undefined
  let startLine = typeof input.startLine === 'number' ? input.startLine
    : typeof input.start_line === 'number' ? input.start_line : undefined
  let endLine = typeof input.endLine === 'number' ? input.endLine
    : typeof input.end_line === 'number' ? input.end_line : undefined
  const query = typeof input.query === 'string' ? input.query : undefined
  const focused = input.focused === true || input.focused === 'true'
  const large = file.content.split('\n').length > MAX_READ_WINDOW_LINES
  let queryCandidates: Array<{ line: number; text: string }> | undefined
  const goal = query ?? mission?.userRequest ?? mission?.goal ?? ''
  const explicitRange = Boolean(aroundMatch) || Boolean(symbol) || (startLine != null && endLine != null)
  if (!explicitRange && goal) {
    const inferred = inferQueryReadBounds(file.content, goal)
    if (inferred?.ambiguous) {
      queryCandidates = inferred.candidates
    } else {
      if (inferred?.aroundMatch) {
        aroundMatch = inferred.aroundMatch
        if (startLine === 1 && endLine == null) {
          startLine = undefined
        }
      }
      if (inferred?.startLine != null && aroundMatch == null) startLine = inferred.startLine
      if (inferred?.endLine != null && aroundMatch == null) endLine = inferred.endLine
      queryCandidates = inferred?.candidates
    }
  }
  if (symbol && startLine == null && !aroundMatch) {
    const index = await buildCodeIndex()
    const found = lookupSymbol(index, symbol).definitions.find(item => item.path === rel) ?? lookupSymbol(index, symbol).definitions[0]
    if (found?.path === rel) {
      startLine = Math.max(1, found.line - 8)
      endLine = found.line + 16
    } else if (countOccurrences(file.content, `function ${symbol}`) === 1) {
      aroundMatch = `function ${symbol}`
    } else if (countOccurrences(file.content, symbol) === 1) {
      aroundMatch = symbol
    } else {
      const hit = occurrenceLineNumbers(file.content, symbol)[0]
      if (hit) {
        startLine = Math.max(1, hit - 8)
        endLine = Math.min(file.content.split('\n').length, hit + 16)
      }
    }
  }
  const inferredOrRanged = Boolean(aroundMatch || startLine != null || endLine != null || symbol)
  if (!inferredOrRanged && large && !queryCandidates?.length) {
    startLine = 1
    endLine = Math.min(file.content.split('\n').length, focused ? MAX_FOCUSED_READ_LINES : 24)
  }
  const window = compactFileReadWindow(file.content, {
    startLine,
    endLine,
    aroundMatch,
    contextLines: typeof input.contextLines === 'number' ? input.contextLines : (focused ? 8 : 12),
    focused,
  })
  const ranged = Boolean(aroundMatch || startLine != null || endLine != null || symbol || large)
  let windowContent = ranged || window.error ? window.content : file.content
  if (!window.error && ranged && !windowContent && aroundMatch) {
    const hit = occurrenceLineNumbers(file.content, aroundMatch)[0]
    if (hit) {
      const lines = file.content.split('\n')
      const from = Math.max(0, hit - 7)
      const to = Math.min(lines.length, hit + 6)
      windowContent = lines.slice(from, to).join('\n')
      window.range.startLine = from + 1
      window.range.endLine = to
    }
  }
  const goalSpans = goal ? findGoalRelevantUniqueSpans(file.content, goal) : []
  const copies = uniqueCopyLines(file.content, [...goalSpans, windowContent].join('\n'))
  const fileSha = sha256(file.content)
  const uniqueWindow = Boolean(windowContent) && countOccurrences(file.content, windowContent) === 1 && !window.error
  const uniqueHint = window.error === 'MATCH_NOT_UNIQUE' ? false : uniqueWindow || copies.length > 0 || goalSpans.length > 0
  const seed = window.error === 'MATCH_NOT_UNIQUE' ? (aroundMatch ?? windowContent) : windowContent
  const registered = mission && seed
    ? registerWindowAnchors(mission, {
      path: rel,
      sha256: fileSha,
      windowContent: seed,
      range: window.range,
      fullContent: file.content,
      uniqueHint: window.error === 'MATCH_NOT_UNIQUE' ? false : uniqueHint,
      preferredText: aroundMatch,
      extraUniqueTexts: window.error ? [] : [...copies, ...goalSpans],
      focusLines: (window.matchLines?.length ? window.matchLines : queryCandidates?.map(item => item.line)) ?? [],
      goal,
    })
    : []
  const uniqueAnchors = registered.filter(item => item.unique)
  const high = uniqueAnchors.filter(item => item.relevance === 'HIGH')
  const primary = (high[0] ?? uniqueAnchors[0] ?? registered[0]) ?? null
  if (primary?.relevance === 'HIGH' && windowContent && scoreAnchorText(windowContent, goal || 'bounded edit').relevance === 'LOW') {
    windowContent = primary.anchorText
    window.range.startLine = primary.startLine
    window.range.endLine = primary.endLine
  }
  const views = registered.map(item => editAnchorView(item))
  const view = primary ? editAnchorView(primary) : null
  const candidateBlock = formatAnchorCandidates(uniqueAnchors.map(item => ({
    anchorId: item.anchorId,
    startLine: item.startLine,
    endLine: item.endLine,
    score: scoreAnchorText(item.anchorText, goal || 'bounded edit'),
  })))
  const windowBlock = windowContent
    ? [
      'WINDOW:',
      `LINES: ${window.range.startLine}-${window.range.endLine}`,
      'SOURCE:',
      windowContent.slice(0, MAX_FOCUSED_READ_CHARS),
    ].join('\n')
    : ''
  const compact = [
    'PATH:',
    file.relPath,
    'FILE_SHA256:',
    fileSha,
    'SHA256:',
    fileSha,
    mission ? `MISSION_ID:\n${mission.missionId}` : '',
    windowBlock,
    candidateBlock,
    view
      ? [
        'EDITABLE_REGION:',
        `anchorId=${view.anchorId}`,
        `LINES: ${view.ANCHOR_START_LINE}-${view.ANCHOR_END_LINE}`,
        'EDIT_ANCHOR:',
        `anchorId=${view.anchorId}`,
        `ANCHOR_UNIQUE=${view.ANCHOR_UNIQUE}`,
        `ANCHOR_START_LINE=${view.ANCHOR_START_LINE}`,
        `ANCHOR_END_LINE=${view.ANCHOR_END_LINE}`,
        'ANCHOR_TEXT:',
        view.ANCHOR_TEXT.slice(0, MAX_FOCUSED_READ_CHARS),
        `PROTECTED_BINDINGS=${JSON.stringify(view.PROTECTED_BINDINGS)}`,
        `AVAILABLE_OBJECT_FIELDS=${JSON.stringify(availableObjectFields(file.content, windowContent))}`,
        `REQUIRED_BINDINGS=${JSON.stringify([...new Set([
          ...(view.PROTECTED_BINDINGS ?? []),
          ...(mission && isEngineeringReviewDetailRequest(mission.userRequest)
            ? siblingDetailBindings(file.content, view.ANCHOR_TEXT || windowContent)
            : []),
        ])])}`,
        formatEditContract({
          goal: mission?.goal ?? mission?.userRequest ?? 'bounded edit',
          anchorId: view.anchorId,
          matchText: view.ANCHOR_TEXT || windowContent,
          requiredBindings: [...new Set([
            ...(view.PROTECTED_BINDINGS ?? []),
            ...(mission && isEngineeringReviewDetailRequest(mission.userRequest)
              ? siblingDetailBindings(file.content, view.ANCHOR_TEXT || windowContent)
              : []),
          ])],
        }),
        'Preserve all PROTECTED_BINDINGS unless the requested change explicitly requires modifying one.',
        'If REQUIRED_BINDINGS or AVAILABLE_OBJECT_FIELDS lists a neighboring detail field already on the same object, replacementText must contain that exact identifier. Append `{object.field}` rather than inventing copy. Do not drop required status bindings.',
        'Use the listed anchorId with file.replace_unique. Do not reconstruct matchText. Prefer a MINIMAL PRESERVING EDIT: reuse existing structure, preserve expressions, append neighboring detail.',
      ].join('\n')
      : '',
    views.length > 1
      ? [
        'EDITABLE_REGIONS:',
        ...views.map(item => `- ${item.anchorId} lines ${item.ANCHOR_START_LINE}-${item.ANCHOR_END_LINE} relevance=${item.ANCHOR_RELEVANCE ?? 'LOW'} bindings=${JSON.stringify(item.PROTECTED_BINDINGS)}`),
        'Select one anchorId. Do not guess.',
      ].join('\n')
      : '',
    window.matchCount != null ? `MATCH_COUNT=${window.matchCount}` : '',
    window.error ? `READ_ERROR=${window.error}` : '',
    queryCandidates?.length && (queryCandidates.length > 1)
      ? `CANDIDATES:\n${queryCandidates.slice(0, 6).map(item => `- line ${item.line}`).join('\n')}\nSelect one region. Do not guess.`
      : '',
  ].filter(Boolean).join('\n')
  const ambiguousQuery = Boolean(queryCandidates?.length && !inferredOrRanged && !windowContent)
  return {
    ok: !window.error && !ambiguousQuery,
    error: window.error ?? (ambiguousQuery ? 'AMBIGUOUS_QUERY: multiple regions match; select one.' : undefined),
    result: {
      compact,
      ok: !window.error && !ambiguousQuery,
      relPath: file.relPath,
      sha256: fileSha,
      FILE_SHA256: fileSha,
      sizeBytes: file.sizeBytes,
      uniqueCopyLines: copies,
      range: window.range,
      matchCount: window.matchCount,
      matchLines: window.matchLines,
      content: windowContent,
      symbol: symbol ?? undefined,
      anchors: views,
      candidates: queryCandidates,
      PROTECTED_BINDINGS: view?.PROTECTED_BINDINGS ?? [],
      MISSION_ID: mission?.missionId,
      ...(view ?? {}),
      EDIT_ANCHOR: view ?? undefined,
    },
  }
}

function parseInput(raw: Record<string, unknown>): BoundedEditInput {
  return {
    path: normalizeRel(String(raw.path ?? raw.file ?? '')),
    expectedSha256: String(raw.expectedSha256 ?? raw.expected_file_sha256 ?? raw.expectedHash ?? '').trim().toLowerCase(),
    matchText: String(raw.matchText ?? raw.match_text ?? ''),
    replacementText: String(raw.replacementText ?? raw.replacement_text ?? ''),
    reason: String(raw.reason ?? 'file.replace_unique'),
    before: typeof raw.before === 'string' ? raw.before : typeof raw.contextBefore === 'string' ? raw.contextBefore : undefined,
    after: typeof raw.after === 'string' ? raw.after : typeof raw.contextAfter === 'string' ? raw.contextAfter : undefined,
    baselineCaptured: raw.baselineCaptured === true || raw.baseline_captured === true
      ? true
      : raw.baselineCaptured === false || raw.baseline_captured === false
        ? false
        : undefined,
    ownerEvidence: raw.ownerEvidence ?? raw.owner_evidence,
    anchorId: typeof raw.anchorId === 'string' ? raw.anchorId.trim()
      : typeof raw.anchor_id === 'string' ? raw.anchor_id.trim() : undefined,
  }
}

export async function executeReplaceUnique(
  raw: Record<string, unknown>,
  ctx: { repairId: string; mission?: FoundryMissionRecord | null },
): Promise<{ ok: boolean; result?: BoundedEditApplied; error?: string }> {
  const input = parseInput(raw)
  if (!input.path) return { ok: false, error: 'OWNER_EVIDENCE_REQUIRED: missing FILE_PATH.' }

  const mission = ctx.mission ?? await loadMission(ctx.repairId)
  if (!mission) return { ok: false, error: 'BASELINE_REQUIRED' }
  if (!mission.baseline?.recordedAt && !mission.sourceState.baselineFiles.length) {
    return { ok: false, error: 'BASELINE_REQUIRED' }
  }
  if (input.baselineCaptured === false) {
    return { ok: false, error: 'BASELINE_REQUIRED' }
  }
  const safety = evaluateWriteSafety(mission, input.path)
  if (!safety.allowed) {
    if (safety.codes.includes('BASELINE_MISSING')) return { ok: false, error: `BASELINE_REQUIRED: ${safety.reason}` }
    if (safety.codes.includes('TERRA_LOCKED') || safety.codes.includes('REFUSED_PROTECTED_SUBSYSTEM')) {
      return { ok: false, error: `TERRA_LOCKED REFUSED_PROTECTED_SUBSYSTEM: ${safety.reason}` }
    }
    if (safety.codes.includes('REFUSED_OUTSIDE_WRITE_SET')) {
      return { ok: false, error: `REFUSED_OUTSIDE_WRITE_SET: ${safety.reason}` }
    }
    if (safety.codes.includes('GENERATED_OR_VENDOR')) return { ok: false, error: `GENERATED_OR_VENDOR: ${safety.reason}` }
    if (safety.codes.includes('LOCKED_FILE')) return { ok: false, error: `LOCKED_FILE: ${safety.reason}` }
    if (safety.codes.includes('OUTSIDE_WORKSPACE')) return { ok: false, error: `OUTSIDE_WORKSPACE: ${safety.reason}` }
    return { ok: false, error: `OWNER_EVIDENCE_REQUIRED: ${safety.reason}` }
  }

  const abs = resolveRepoRelativePath(input.path)
  await assertCanonicalRepoPath(abs, true)
  const current = await readRepoFile(input.path)
  if (!current.ok) return { ok: false, error: `MATCH_NOT_FOUND: ${current.error}` }
  const actualSha = sha256(current.content)
  const usingAnchor = Boolean(input.anchorId) || !input.matchText
  let resolvedAnchorId: string | undefined
  if (usingAnchor) {
    const resolved = resolveEditAnchor(mission, {
      anchorId: input.anchorId,
      path: input.path,
      expectedSha256: input.expectedSha256 || undefined,
      actualSha256: actualSha,
    })
    if (!resolved.ok) return { ok: false, error: resolved.error }
    if (input.matchText && input.matchText !== resolved.anchor.anchorText) {
      return { ok: false, error: 'ANCHOR_MATCHTEXT_MISMATCH: supplied matchText disagrees with the broker-issued anchor. Use only the returned anchorId.' }
    }
    const spanCount = countOccurrences(current.content, resolved.anchor.anchorText)
    if (spanCount === 0) {
      return { ok: false, error: `STALE_EDIT_ANCHOR expected=${resolved.anchor.sha256} actual=${actualSha}` }
    }
    if (spanCount !== 1) {
      return { ok: false, error: `MATCH_NOT_UNIQUE matchCount=${spanCount}` }
    }
    input.matchText = resolved.anchor.anchorText
    input.expectedSha256 = input.expectedSha256 || resolved.anchor.sha256
    resolvedAnchorId = resolved.anchor.anchorId
    const highAnchors = (mission.engineering?.editAnchors ?? []).filter(item =>
      item.path === normalizeRel(input.path)
      && item.missionId === mission.missionId
      && item.sha256 === actualSha
      && item.unique
      && item.relevance === 'HIGH'
      && item.anchorId !== resolved.anchor.anchorId,
    )
    if ((resolved.anchor.relevance === 'LOW' || resolved.anchor.relevance === undefined) && highAnchors.length) {
      return {
        ok: false,
        error: `ANCHOR_LOW_RELEVANCE: unique HIGH-relevance anchors exist (${highAnchors.map(item => item.anchorId).join(', ')}). Do not mutate a LOW header/type region. Select a HIGH anchorId from ANCHOR_CANDIDATES.`,
      }
    }
  }
  if (!input.expectedSha256) {
    return { ok: false, error: `STALE_FILE_HASH expected=missing actual=${actualSha}` }
  }
  if (input.expectedSha256 !== actualSha) {
    return {
      ok: false,
      error: usingAnchor
        ? `STALE_EDIT_ANCHOR expected=${input.expectedSha256} actual=${actualSha}`
        : `STALE_FILE_HASH expected=${input.expectedSha256} actual=${actualSha}`,
    }
  }

  if (!input.matchText) {
    return { ok: false, error: 'MATCH_NOT_FOUND: matchText is empty. Use a valid anchorId from file.read.' }
  }
  const jsxBreak = validateReplacementText({
    request: mission.userRequest,
    matchText: input.matchText,
    replacementText: input.replacementText,
    anchorId: resolvedAnchorId ?? input.anchorId,
    fileContent: current.content,
  })
  if (jsxBreak) return { ok: false, error: jsxBreak }
  const search = `${input.before ?? ''}${input.matchText}${input.after ?? ''}`
  if (/^<[^>]+>$/.test(input.matchText.trim()) || /copy matchText exactly/i.test(input.matchText)) {
    return { ok: false, error: `MATCH_NOT_FOUND matchText must be existing source text, not an instruction. matchText=${JSON.stringify(input.matchText.slice(0, 120))}` }
  }
  const replacement = `${input.before ?? ''}${input.replacementText}${input.after ?? ''}`
  const matchCount = countOccurrences(current.content, search)
  if (matchCount === 0) return { ok: false, error: `MATCH_NOT_FOUND matchText=${JSON.stringify(input.matchText.slice(0, 120))}` }
  if (matchCount > 1) {
    const lines = occurrenceLineNumbers(current.content, search)
    return { ok: false, error: `MATCH_NOT_UNIQUE matchCount=${matchCount} lines=${lines.join(',')}` }
  }

  const replacedLines = lineCount(input.matchText)
  const replacementLines = lineCount(input.replacementText)
  const totalChanged = replacedLines + replacementLines
  if (replacedLines > MAX_REPLACED_LINES || replacementLines > MAX_REPLACEMENT_LINES || totalChanged > MAX_TOTAL_CHANGED_LINES) {
    return {
      ok: false,
      error: `EDIT_SCOPE_TOO_LARGE replaced=${replacedLines} replacement=${replacementLines} total=${totalChanged} limits=${MAX_REPLACED_LINES}/${MAX_REPLACEMENT_LINES}/${MAX_TOTAL_CHANGED_LINES}`,
    }
  }

  const startLine = occurrenceLineNumbers(current.content, search)[0] ?? 1
  const proposal: NativeRepairProposal = {
    issueId: ctx.repairId,
    sourceKind: 'deterministic',
    proposerId: 'engineer-tool:file.replace_unique',
    diagnosis: input.reason.slice(0, 240),
    confidence: 'high',
    relevantFiles: [input.path],
    plannedChanges: [{
      file: input.path,
      reason: input.reason,
      operation: 'replace_range',
      patch: {
        operation: 'replace_range',
        file: input.path,
        expectedOriginalHash: actualSha,
        matchText: search,
        replacementText: replacement,
      },
    }],
    validations: [],
    risks: [],
    rollbackPlan: 'Snapshot rollback.',
    generatedAt: new Date().toISOString(),
  }
  const applied = await applyProposal(ctx.repairId, proposal)
  if (!applied.ok) {
    const detail = applied.outcomes.map(item => item.detail).join('; ')
    return { ok: false, error: detail || 'file.replace_unique refused by patch applier.' }
  }
  const next = await readRepoFile(input.path)
  const newSha = next.ok ? sha256(next.content) : ''
  const auditId = randomUUID()
  const result: BoundedEditApplied = {
    STATUS: 'APPLIED',
    FILE: input.path,
    OLD_SHA256: actualSha,
    NEW_SHA256: newSha,
    MATCH_COUNT: 1,
    CHANGED_LINE_RANGE: { start: startLine, end: startLine + Math.max(1, replacementLines) - 1 },
    LINES_REMOVED: replacedLines,
    LINES_ADDED: replacementLines,
    OWNER_EVIDENCE_ACCEPTED: safety.reason,
    BASELINE_ID: mission.baseline?.recordedAt ?? 'mission-baseline',
    AUDIT_ID: auditId,
    ANCHOR_ID: resolvedAnchorId,
    PROTECTED_BINDINGS_PRESERVED: 'YES',
  }
  await logWarRoomRepoAudit('foundry-bounded-edit', {
    mission: ctx.repairId,
    provider: 'tool-broker',
    tool: BOUNDED_EDIT_TOOL,
    file: input.path,
    oldSha: actualSha,
    newSha,
    reason: input.reason.slice(0, 240),
    ownerEvidence: safety.reason,
    timestamp: new Date().toISOString(),
    auditId,
    anchorId: resolvedAnchorId ?? null,
    workspace: path.relative(resolveRepoRoot(), abs),
  })
  invalidateAnchorsForPath(mission, input.path)
  const engineering = ensureEngineeringState(mission)
  engineering.lastAppliedMutation = {
    path: input.path,
    oldSha: actualSha,
    newSha,
    start: startLine,
    removed: replacedLines,
    added: replacementLines,
    matchText: input.matchText,
    replacementText: input.replacementText,
  }
  engineering.sourceReadCursor = undefined
  if (engineering.lintRegionRecovery?.path === input.path && engineering.lintRegionRecovery.focusedReadDone) {
    markLintRetryUsed(mission, input.path, true)
  }
  return { ok: true, result }
}
