import { createHash } from 'node:crypto'
import type { ContextPhase, ContextPhaseInput, ContextPhaseResult, ContextStep, ResearchBrief, RetrievedItem } from '@/lib/agents/ops/engineering/contextPhase'
import { RETRIEVED_CHARS_PER_ITEM, RETRIEVED_PER_STEP } from '@/lib/agents/ops/engineering/contextPhase'
import { MIN_RESEARCH_MATERIAL_CHARS, researchTrigger, type Researcher } from './researchBrief'
import { QUERY_INSTRUCTION, cosine } from './roleBench/retrieval'

/**
 * Hybrid context retrieval for the builder. EXACT facts come first (a symbol the contract names, a route, an environment variable, a file name that is
 * mentioned: found by plain search / definition match); embeddings then add semantic matches the exact pass cannot see. The embedding model only RETRIEVES:
 * it ranks text, it never decides what to build, what to edit, or whether anything is accepted. Everything it returns is logged with the reason.
 * One batched pass for the whole mission (all files and all queries in the same embedding call), so the embedding model loads once and unloads before the builder.
 */
export type Embedder = (inputs: string[]) => Promise<number[][]>
export type RetrieverOptions = {
  embed: Embedder | null
  research?: Researcher | null
  /** embeddings of chunk texts are cached by content hash across missions (distractor files are identical from run to run) */
  cache?: Map<string, number[]>
  now?: () => number
  /** a semantic hit must be within this fraction of the best similarity for the step AND above an absolute floor */
  relativeFloor?: number
  absoluteFloor?: number
  maxPerStep?: number
}

const CODE_FILE = /\.(m?js|cjs|ts|tsx|jsx|json|html?|md)$/i
const SKIP_PATH = /(^|\/)(node_modules|data|\.git|dist|build|coverage)\//
const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 20)

export function chunkFiles(files: Record<string, string>, lines = 45): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = []
  for (const [p, t] of Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (!CODE_FILE.test(p) || SKIP_PATH.test(p) || p === 'package-lock.json' || t.length > 200_000) continue
    const ls = t.split('\n')
    for (let i = 0; i < ls.length; i += lines) { const text = ls.slice(i, i + lines).join('\n').slice(0, 2400); if (text.trim().length > 30) out.push({ file: p, text: `// file: ${p}\n${text}` }) }
  }
  return out
}

/** Facts the contract states literally: routes, environment variables, quoted/backticked names, camelCase names, file names. */
export function exactTerms(request: string, acceptance: string[], step?: Pick<ContextStep, 'path' | 'note'>): string[] {
  const text = `${request}\n${acceptance.join('\n')}\n${step?.note ?? ''}`
  const terms = new Set<string>()
  for (const m of text.matchAll(/\/(?:api\/)?[a-z][a-z0-9_-]*(?:\/(?::[a-z]+|[a-z0-9_-]+))*/gi)) if (m[0].length >= 5) terms.add(m[0].replace(/\/:[a-z]+/gi, ''))
  for (const m of text.matchAll(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g)) terms.add(m[0])
  for (const m of text.matchAll(/[`"']([A-Za-z_][\w./-]{3,60})[`"']/g)) terms.add(m[1])
  for (const m of text.matchAll(/\b[a-z]+(?:[A-Z][a-z0-9]+)+\b/g)) if (m[0].length >= 6) terms.add(m[0])
  for (const m of text.matchAll(/\b[\w-]+\.(?:m?js|json|html?|ts)\b/g)) terms.add(m[0])
  return [...terms].filter((t) => t.length >= 4).slice(0, 24)
}

const defines = (text: string, name: string) => new RegExp(`(?:export\\s+)?(?:async\\s+)?(?:function\\s*\\*?\\s*|const\\s+|let\\s+|class\\s+)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text)
const windowAround = (text: string, needle: string, radius = 14) => {
  const ls = text.split('\n'); const i = ls.findIndex((l) => l.includes(needle)); if (i < 0) return text.slice(0, RETRIEVED_CHARS_PER_ITEM)
  return ls.slice(Math.max(0, i - radius), i + radius + 1).join('\n').slice(0, RETRIEVED_CHARS_PER_ITEM)
}
export function exactItems(files: Record<string, string>, terms: string[], selfPath: string): RetrievedItem[] {
  const items: RetrievedItem[] = []
  for (const [p, t] of Object.entries(files)) {
    if (p === selfPath || !CODE_FILE.test(p) || SKIP_PATH.test(p) || /^test\//.test(p) || /(^|\/)package(-lock)?\.json$/.test(p)) continue
    const defs = terms.filter((x) => /^[A-Za-z_]\w+$/.test(x) && defines(t, x))
    const hits = terms.filter((x) => t.includes(x))
    if (defs.length) items.push({ path: p, method: 'DEFINITION', why: `defines ${defs.slice(0, 3).join(', ')}`, score: 2000 + defs.length * 10 + hits.length, text: t.length <= RETRIEVED_CHARS_PER_ITEM ? t : windowAround(t, defs[0]) })
    else if (hits.length) items.push({ path: p, method: 'EXACT', why: `contains ${hits.slice(0, 3).join(', ')}`, score: 1000 + hits.length * 10, text: t.length <= RETRIEVED_CHARS_PER_ITEM ? t : windowAround(t, hits[0]) })
  }
  return items.sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : 1))
}

/**
 * Repository search intents derived from the contract by fixed rules (no model involved): each says what CAPABILITY the implementation will need, so reusable
 * code that is phrased generically (a JSON file helper, an id generator, a validator, an HTTP response helper, the repository's conventions) is found even when
 * its vocabulary has nothing in common with the feature's domain words.
 */
export type SearchIntent = { id: string; query: string; layers: string[] | 'all' }
export function capabilityIntents(request: string, acceptance: string[]): SearchIntent[] {
  const t = `${request}\n${acceptance.join('\n')}`
  const out: SearchIntent[] = []
  if (/persist|surviv|restart|disk|data file|stored|storage|written to/i.test(t)) out.push({ id: 'storage', query: 'read and write a JSON file on disk atomically; data file location; save records so they survive a restart', layers: ['storage', 'domain', 'api'] })
  if (/\bids?\b|identifier|unique|numbered/i.test(t)) out.push({ id: 'identifiers', query: 'generate the next numeric id for a new record; ids are never reused', layers: ['storage', 'domain'] })
  if (/reject|required|empty|invalid|must be|one of|allowed|default|400/i.test(t)) out.push({ id: 'validation', query: 'validate user input: require non-empty text, value must be one of the allowed values, throw an error', layers: ['domain', 'api'] })
  if (/\b(GET|POST|PUT|PATCH|DELETE)\b|\b[1-5]\d\d\b|endpoint|\bAPI\b/.test(t)) out.push({ id: 'http', query: 'send a JSON http response with a status code; parse a JSON request body; error response shape', layers: ['api'] })
  if (/\btests?\b|covers/i.test(t)) out.push({ id: 'tests', query: 'unit test conventions: node:test, assert, one behaviour per test', layers: ['tests'] })
  out.push({ id: 'conventions', query: 'repository conventions and guidelines for services: error responses, ids, data files, validation, tests', layers: 'all' })
  return out
}

export function stepQuery(request: string, acceptance: string[], step: ContextStep): string {
  const stepWords = new Set(`${step.path} ${step.layer} ${step.title}`.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3))
  const rel = acceptance.filter((a) => [...stepWords].some((w) => a.toLowerCase().includes(w))).slice(0, 3)
  const crits = (rel.length ? rel : acceptance.slice(0, 2)).join(' ')
  return `${step.layer} ${step.path}: ${step.note}. ${request.slice(0, 240)} ${crits}`.replace(/\s+/g, ' ').slice(0, 640)
}

export class HybridContextPhase implements ContextPhase {
  constructor(private readonly opts: RetrieverOptions) {}
  async prepare(input: ContextPhaseInput): Promise<ContextPhaseResult> {
    const o = this.opts; const now = o.now ?? Date.now; const t0 = now()
    const per = o.maxPerStep ?? RETRIEVED_PER_STEP
    const chunks = chunkFiles(input.files)
    const report: Record<string, unknown> = { corpusFiles: new Set(chunks.map((c) => c.file)).size, chunks: chunks.length, steps: [] as unknown[], embedding: 'not used' }
    // 1. exact / definition pass per step
    const exactBy: Record<string, RetrievedItem[]> = {}; const termsBy: Record<string, string[]> = {}
    for (const s of input.steps) { termsBy[s.path] = exactTerms(input.request, input.acceptance, s); exactBy[s.path] = exactItems(input.files, termsBy[s.path], s.path).filter((i) => !(s.known ?? []).includes(i.path)) }
    // 2. one batched embedding call: uncached chunks + one query per step
    let chunkVecs: number[][] | null = null, queryVecs: number[][] | null = null
    let embedMs = 0, cacheHits = 0
    const intents = capabilityIntents(input.request, input.acceptance)
    const queries = [...input.steps.map((s) => QUERY_INSTRUCTION + stepQuery(input.request, input.acceptance, s)), ...intents.map((i) => QUERY_INSTRUCTION + i.query)]
    report.intents = intents.map((i) => i.id)
    if (o.embed && chunks.length && input.steps.length) {
      const te = now()
      try {
        const cache = o.cache ?? new Map<string, number[]>()
        const keys = chunks.map((c) => sha(c.text)); const missing = [...new Set(keys.filter((k) => !cache.has(k)))]
        const byKey = new Map(chunks.map((c, i) => [keys[i], c.text]))
        cacheHits = chunks.length - keys.filter((k) => missing.includes(k)).length
        const vecs = await o.embed([...missing.map((k) => byKey.get(k) as string), ...queries])
        missing.forEach((k, i) => cache.set(k, vecs[i])); queryVecs = vecs.slice(missing.length)
        chunkVecs = keys.map((k) => cache.get(k) as number[])
        report.embedding = `batched: ${missing.length} new chunk(s), ${cacheHits} cached, ${queries.length} query(ies)`
      } catch (e) { report.embedding = `FAILED: ${e instanceof Error ? e.message : e}; exact search only`; chunkVecs = null; queryVecs = null }
      embedMs = now() - te
    }
    // 3. merge per step
    const packages: Record<string, RetrievedItem[]> = {}
    input.steps.forEach((s, qi) => {
      const items: RetrievedItem[] = [...exactBy[s.path].slice(0, Math.ceil(per / 3))] // exact facts first, but at most a third of the slots (2 of 5): the rest is for semantic matches
      if (chunkVecs && queryVecs) {
        // this step's own query plus the capability intents that apply to its layer; every applicable intent contributes its best file first (round-robin), then the rest by similarity
        const qs = [...intents.map((it, k) => ({ it, vec: queryVecs![input.steps.length + k] })).filter((x) => x.it.layers === 'all' || x.it.layers.includes(s.layer)).map((x) => ({ vec: x.vec, by: `the "${x.it.id}" need` })), { vec: queryVecs[qi], by: `the ${s.layer} step` }]
        const eligible = chunks.map((c, i) => ({ c, i })).filter(({ c }) => !(c.file === s.path || (s.known ?? []).includes(c.file) || (/^test\//.test(c.file) && s.layer !== 'tests') || /(^|\/)package(-lock)?\.json$/.test(c.file)))
        const perQuery = qs.map((q) => { const best = new Map<string, { s: number; text: string }>(); for (const { c, i } of eligible) { const sc = cosine(q.vec, chunkVecs![i]); if (sc > (best.get(c.file)?.s ?? -2)) best.set(c.file, { s: sc, text: c.text.replace(/^\/\/ file: .*\n/, '') }) } return { by: q.by, ranked: [...best.entries()].sort((a, b) => b[1].s - a[1].s || (a[0] < b[0] ? -1 : 1)) } })
        const take = (file: string, v: { s: number; text: string }, by: string) => {
          const top = perQuery.find((q) => q.by === by)?.ranked[0]?.[1].s ?? v.s
          if (items.length >= per || items.some((x) => x.path === file) || v.s < (o.absoluteFloor ?? 0.3) || v.s < top * (o.relativeFloor ?? 0.85)) return
          const whole = input.files[file]
          items.push({ path: file, method: 'EMBEDDING', why: `semantic match ${v.s.toFixed(2)} to ${by}`, score: v.s, text: whole && whole.length <= RETRIEVED_CHARS_PER_ITEM ? whole : v.text.slice(0, RETRIEVED_CHARS_PER_ITEM) })
        }
        for (const q of perQuery) { const first = q.ranked.find(([f]) => !items.some((x) => x.path === f)); if (first) take(first[0], first[1], q.by) }
        const rest = perQuery.flatMap((q) => q.ranked.map(([f, v]) => ({ f, v, by: q.by }))).sort((a, b) => b.v.s - a.v.s)
        for (const r of rest) take(r.f, r.v, r.by)
      }
      packages[s.path] = items.slice(0, per)
      ;(report.steps as unknown[]).push({ step: s.id, path: s.path, layer: s.layer, exactTerms: termsBy[s.path].slice(0, 8), items: packages[s.path].map((i) => ({ path: i.path, method: i.method, why: i.why, score: Math.round(i.score * 100) / 100, chars: Math.min(i.text.length, RETRIEVED_CHARS_PER_ITEM) })) })
    })
    // 4. optional bounded research, only when Foundry's deterministic trigger fires
    let brief: ResearchBrief | null = null
    const trig = researchTrigger(input.request, input.acceptance, input.files)
    // retrieval is the better relevance signal than word overlap: long documentation that search surfaced for any step is worth briefing
    for (const p of new Set(Object.values(packages).flat().map((i) => i.path))) {
      const t = input.files[p]
      if (/\.md$/i.test(p) && t && t.length >= MIN_RESEARCH_MATERIAL_CHARS && !trig.sources.includes(p)) { trig.sources.push(p); trig.reasons.push(`retrieval surfaced long documentation ${p} (${t.length} chars)`); trig.fire = true; trig.topic = trig.topic || `documentation: ${p}` }
    }
    report.researchTrigger = trig
    if (trig.fire && o.research) {
      const material = [...trig.sources.map((p) => ({ path: p, text: input.files[p] })), ...[...new Set(Object.values(packages).flat().map((i) => i.path))].slice(0, 3).map((p) => ({ path: p, text: input.files[p] ?? '' }))].filter((m) => m.text)
      brief = await o.research({ request: input.request, acceptance: input.acceptance, trigger: trig, material })
      report.research = { id: brief.id, model: brief.model, ms: brief.ms, relevant: brief.relevance.relevant, reason: brief.relevance.reason, sources: brief.sources, chars: brief.text.length }
    }
    report.embedMs = embedMs; report.cacheHits = cacheHits; report.phaseMs = now() - t0
    report.itemsTotal = Object.values(packages).reduce((a, p) => a + p.length, 0)
    return { packages, brief, report }
  }
}
