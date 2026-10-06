/**
 * Phase 5 - the side-effecting half of tool depth: reading the project's own notes, fetching primary sources through the governed research transport,
 * and running the bounded research loop. Network and command execution are injected so the loop is testable offline and the runtime keeps its own
 * governance (policy checks, events, cancellation).
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { isSecretFile, redactSecrets } from './foundryProjectContext'
import {
  TIER_NAMES,
  TOOL_LIMITS,
  extractClaims,
  implicationOf,
  officialHints,
  pageText,
  researchVerdict,
  safeQueryFor,
  sourcePlan,
  tierOf,
  weighClaims,
  type Claim,
  type ClaimAction,
  type RememberedFinding,
  type ConflictNote,
  type InstalledInfo,
  type QuestionState,
  type ResearchQuestion,
  type SourceTier,
  type SourcedClaim,
  type ToolingState,
} from './foundryToolReasoning'

export type FetchResult = { ok: boolean; status?: number; text?: string; error?: string }
export type ResearchDeps = {
  fetchText: (url: string) => Promise<FetchResult>
  localNotes: (terms: string[]) => Promise<{ file: string; text: string }[]>
  /** Last resort when no official address could be read: a search whose query is only technical identifiers. */
  search?: (query: string) => Promise<{ title: string; url: string; snippet: string }[]>
  now: () => string
}

const NOTE_EXT = /\.(md|txt|rst)$/i
const SKIP_DIRS = new Set(['.git', 'node_modules', '.war-room', '__pycache__', 'dist', 'build', '.next', '.venv', 'venv', 'coverage'])

/** Notes the project keeps about libraries (README, docs/, NOTES): read locally, never sent anywhere, and never a secret file. */
export async function readLocalNotes(root: string, terms: readonly string[]): Promise<{ file: string; text: string }[]> {
  const found: { file: string; text: string }[] = []
  const wanted = terms.filter(term => term.length >= 2)
  async function walk(dir: string, rel: string, depth: number): Promise<void> {
    if (depth > 2 || found.length >= 4) return
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (found.length >= 4) return
      const childRel = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && (depth === 0 ? /^(docs?|notes?|wiki)$/i.test(entry.name) : true)) await walk(path.join(dir, entry.name), childRel, depth + 1)
        continue
      }
      if (!entry.isFile() || !NOTE_EXT.test(entry.name) || isSecretFile(childRel)) continue
      try {
        const info = await stat(path.join(dir, entry.name))
        if (info.size > 200_000) continue
        const text = await readFile(path.join(dir, entry.name), 'utf8')
        if (wanted.some(term => text.includes(term))) found.push({ file: childRel, text: redactSecrets(text).slice(0, 80_000) })
      } catch { /* unreadable: not evidence */ }
    }
  }
  await walk(root, '', 0)
  return found
}

/** The changelog file in a GitHub contents listing, as its raw address. */
export function changelogFromListing(json: string): string | null {
  try {
    const items = JSON.parse(json) as { name?: string; type?: string; download_url?: string | null }[]
    if (!Array.isArray(items)) return null
    const rank = (name: string) => (/^(CHANGES|CHANGELOG|HISTORY|NEWS|RELEASES?)([._-].*)?$/i.test(name) ? (/\.rst$|\.md$|^[A-Z]+$/i.test(name) ? 0 : 1) : 9)
    const file = items.filter(item => item?.type === 'file' && typeof item.name === 'string' && typeof item.download_url === 'string' && rank(item.name) < 9).sort((a, b) => rank(a.name!) - rank(b.name!))[0]
    return file?.download_url ?? null
  } catch { return null }
}

function pageVersionOf(url: string): string | null {
  const hit = /whatsnew\/(\d+\.\d+)/.exec(url)
  return hit ? hit[1] : null
}

function versionFor(info: InstalledInfo): string | null {
  return info.stdlib ? info.python : info.version
}

export function newQuestionState(question: ResearchQuestion, info: InstalledInfo): QuestionState {
  return { key: question.key, text: question.text, root: question.root, symbol: question.symbol, status: 'OPEN', waves: 0, consulted: [], findings: [], conflicts: [], implication: null, installedVersion: versionFor(info), answeredAt: null }
}

/**
 * A remembered answer that is still valid (same library, same installed version, checked recently, from a primary source) becomes the answer with no web read.
 * It is weighed and worded exactly like a fresh one. Anything the weighing cannot settle comes back INCONCLUSIVE so the caller researches it properly.
 */
export function answerFromMemory(input: { question: ResearchQuestion; info: InstalledInfo; tooling: ToolingState; remembered: RememberedFinding; now: string }): ResearchOutcome {
  const { question, info, tooling, remembered } = input
  const state = tooling.questions.find(item => item.key === question.key) ?? newQuestionState(question, info)
  if (!tooling.questions.includes(state)) tooling.questions = [...tooling.questions, state].slice(-TOOL_LIMITS.questions)
  const finding = remembered.finding
  const tier = Math.min(7, Math.max(1, finding?.tier ?? 9)) as SourceTier
  if (!finding || (finding.tier as number) > 5) return { question: state, said: [], urls: [], fetched: 0, unavailable: 0, memoryHit: null, query: null }
  const claim: SourcedClaim = {
    subject: question.symbol ? `${question.root}.${question.symbol}` : question.root, action: finding.action as ClaimAction, version: finding.version, replacement: finding.replacement,
    quote: redactSecrets(remembered.claim).slice(0, TOOL_LIMITS.quoteChars), url: remembered.url, tier, label: TIER_NAMES[tier], fetchedAt: finding.checkedAt,
  }
  const installedVersion = versionFor(info)
  state.findings = [claim]
  state.consulted = [{ url: remembered.url, tier, ok: true, at: finding.checkedAt }]
  const resolution = weighClaims(dedupe(state.findings), installedVersion, question.detail)
  state.conflicts = []
  state.implication = implicationOf(question, resolution, installedVersion)
  state.status = resolution.best && resolution.outcome !== 'UNRESOLVED' ? 'ANSWERED' : 'INCONCLUSIVE'
  state.answeredAt = state.status === 'ANSWERED' ? input.now : null
  state.fromMemory = { checkedAt: finding.checkedAt, url: remembered.url }
  return { question: state, said: [], urls: [], fetched: 0, unavailable: 0, memoryHit: state.status === 'ANSWERED' ? 'REUSED' : null, query: null }
}

function relevant(claim: Claim, question: ResearchQuestion): boolean {
  return question.terms.some(term => claim.subject === term || claim.quote.includes(term))
}

export type ResearchOutcome = {
  question: QuestionState
  said: string[]
  urls: string[]
  fetched: number
  unavailable: number
  memoryHit: 'CONFIRMED' | 'CHANGED' | 'REUSED' | null
  /** What left the machine in a search, if one was needed. */
  query: string | null
}

/**
 * Bounded research on one question: notes the project keeps, then the official sources in quality order, stopping as soon as an authoritative source
 * answers it (a second is read only when sources disagree or the answer carries no version). Unavailable sources are replaced by the next official one.
 */
export async function researchQuestion(input: {
  question: ResearchQuestion
  info: InstalledInfo
  tooling: ToolingState
  deps: ResearchDeps
  /** An address an earlier verified mission found authoritative for this same question and installed version. */
  remembered?: { url: string; claim: string } | null
}): Promise<ResearchOutcome> {
  const { question, info, tooling, deps } = input
  const state = tooling.questions.find(item => item.key === question.key) ?? newQuestionState(question, info)
  if (!tooling.questions.includes(state)) tooling.questions = [...tooling.questions, state].slice(-TOOL_LIMITS.questions)
  const hints = officialHints(info)
  const installedVersion = versionFor(info)
  const said: string[] = []
  const urls: string[] = []
  let unavailable = 0
  let memoryHit: ResearchOutcome['memoryHit'] = null
  let searched: string | null = null
  const add = (claims: Claim[], url: string, label: string, tier: SourceTier) => {
    for (const claim of claims.filter(item => relevant(item, question))) {
      const subject = question.argument && claim.action === 'NOW_REQUIRED' ? `the ${question.argument} argument of ${question.root}.${question.symbol}` : claim.subject
      state.findings.push({ ...claim, subject, url, tier, label, fetchedAt: deps.now() })
    }
    state.findings = state.findings.slice(-TOOL_LIMITS.findingsPerQuestion * 3)
  }

  // Notes the project itself keeps are secondary material: read first because it costs nothing, weighed last.
  for (const note of await deps.localNotes(question.terms)) {
    const claims = extractClaims(note.text, question.terms, { groups: question.groups })
    add(claims, `project:${note.file}`, `notes in the project (${note.file})`, 7)
  }

  const fetchBudget = () => state.consulted.length < TOOL_LIMITS.fetchesPerQuestion && tooling.fetches < TOOL_LIMITS.fetchesPerMission
  let verdict = researchVerdict({ waves: state.waves, findings: state.findings, consulted: state.consulted, fetchesThisMission: tooling.fetches }, weighClaims(dedupe(state.findings), installedVersion, question.detail))
  const first = input.remembered?.url ?? null
  for (const wave of [1, 2] as const) {
    if (state.waves >= TOOL_LIMITS.waves && wave > state.waves) break
    if (wave === 2 && verdict !== 'CONTINUE_CONFLICT' && verdict !== 'CONTINUE_UNANSWERED') break
    const consultedUrls = state.consulted.map(item => item.url)
    const plan = sourcePlan(question, info, wave, consultedUrls)
    if (wave === 1 && first && !consultedUrls.includes(first)) plan.unshift({ url: first, why: 'the source an earlier verified mission relied on' })
    let anyOk = false
    for (const item of plan.slice(0, wave === 1 ? 3 : 4)) {
      if (!fetchBudget()) break
      const tier = tierOf(item.url, hints)
      const result = await deps.fetchText(item.url)
      tooling.fetches += 1
      state.consulted = [...state.consulted, { url: item.url, tier, ok: result.ok, at: deps.now() }].slice(-TOOL_LIMITS.consultedPerQuestion)
      if (!result.ok || !result.text) { unavailable += 1; if (unavailable === 1) said.push('unavailable'); continue }
      anyOk = true
      urls.push(item.url)
      const raw = result.text
      const text = /^\s*[[{]/.test(raw) ? raw : pageText(raw)
      if (/^https:\/\/api\.github\.com\/repos\//.test(item.url)) {
        // A directory listing, not a document: pick the changelog file and read that instead (one more governed fetch).
        const file = changelogFromListing(raw)
        if (file && fetchBudget()) {
          const nextTier = tierOf(file, hints)
          const next = await deps.fetchText(file)
          tooling.fetches += 1
          state.consulted = [...state.consulted, { url: file, tier: nextTier, ok: next.ok, at: deps.now() }].slice(-TOOL_LIMITS.consultedPerQuestion)
          if (next.ok && next.text) { urls.push(file); add(extractClaims(next.text, question.terms, { groups: question.groups }), file, TIER_NAMES[nextTier], nextTier) }
          else unavailable += 1
        }
      } else {
        add(extractClaims(text, question.terms, { pageVersion: pageVersionOf(item.url), groups: question.groups }), item.url, TIER_NAMES[tier], tier)
      }
      const resolution = weighClaims(dedupe(state.findings), installedVersion, question.detail)
      verdict = researchVerdict({ waves: state.waves, findings: state.findings, consulted: state.consulted, fetchesThisMission: tooling.fetches }, resolution)
      if (verdict === 'STOP_ANSWERED' && resolution.outcome !== 'SINGLE_SOURCE') break
      if (verdict === 'STOP_ANSWERED' && wave === 1 && item.url === first) break
      if (verdict === 'STOP_ANSWERED') break
    }
    state.waves = Math.max(state.waves, wave)
    void anyOk
    if (verdict === 'STOP_ANSWERED' || verdict === 'STOP_INCONCLUSIVE' || verdict === 'STOP_BUDGET') break
  }

  // No authoritative answer from the official addresses: search, with a query made only of the library, the name and the version.
  const authoritative = () => weighClaims(dedupe(state.findings), installedVersion, question.detail).best?.tier ?? 9
  if (authoritative() > 5 && deps.search && fetchBudget()) {
    const query = safeQueryFor(question, info)
    if (query) {
      searched = query
      tooling.fetches += 1
      let hits: { title: string; url: string; snippet: string }[] = []
      try { hits = (await deps.search(query)).slice(0, 5) } catch { hits = [] }
      for (const hit of hits) {
        const tier = tierOf(hit.url, hints)
        if (hit.snippet) add(extractClaims(hit.snippet, question.terms, { groups: question.groups }), hit.url, TIER_NAMES[tier], tier)
        if (tier <= 5 && fetchBudget() && !state.consulted.some(item => item.url === hit.url)) {
          const result = await deps.fetchText(hit.url)
          tooling.fetches += 1
          state.consulted = [...state.consulted, { url: hit.url, tier, ok: result.ok, at: deps.now() }].slice(-TOOL_LIMITS.consultedPerQuestion)
          if (result.ok && result.text) { urls.push(hit.url); add(extractClaims(/^\s*[[{]/.test(result.text) ? result.text : pageText(result.text), question.terms, { groups: question.groups }), hit.url, TIER_NAMES[tier], tier) }
        }
      }
    }
  }

  const resolution = weighClaims(dedupe(state.findings), installedVersion, question.detail)
  state.findings = orderFindings(dedupe(state.findings), resolution.best).slice(0, TOOL_LIMITS.findingsPerQuestion)
  state.conflicts = resolution.conflicts.slice(0, 3) as ConflictNote[]
  state.implication = implicationOf(question, resolution, installedVersion)
  state.status = resolution.best && resolution.best.tier <= 5 && resolution.outcome !== 'UNRESOLVED' ? 'ANSWERED' : 'INCONCLUSIVE'
  state.answeredAt = state.status === 'ANSWERED' ? deps.now() : null
  if (input.remembered && state.status === 'ANSWERED' && resolution.best && resolution.best.url === input.remembered.url) memoryHit = 'CONFIRMED'
  else if (input.remembered) memoryHit = 'CHANGED'
  return { question: state, said, urls, fetched: state.consulted.length, unavailable, memoryHit, query: searched }
}

function dedupe(claims: readonly SourcedClaim[]): SourcedClaim[] {
  const seen = new Set<string>()
  return claims.filter(claim => {
    const id = `${claim.url}|${claim.action}|${claim.version}|${claim.quote.slice(0, 50)}`
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

function orderFindings(claims: SourcedClaim[], best: SourcedClaim | null): SourcedClaim[] {
  return [...claims].sort((a, b) => (a === best ? -1 : b === best ? 1 : a.tier - b.tier))
}
