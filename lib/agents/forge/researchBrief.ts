import { BRIEF_CAP, type ResearchBrief } from '@/lib/agents/ops/engineering/contextPhase'
import type { ModelClient } from '@/lib/agents/ops/engineering/runtime/ports'
import { createHash } from 'node:crypto'

/**
 * RESEARCH_GENERALIST support. Foundry decides WHETHER research is needed (deterministic trigger), the research model writes a bounded brief from material
 * Foundry hands it (never from memory alone), and Foundry decides whether the brief is relevant and supported before the builder sees it. The researcher
 * never edits source, never owns implementation, never decides acceptance, and its brief is advisory.
 */
const TECH_TERMS = ['websocket', 'sqlite', 'postgres', 'redis', 'jwt', 'oauth', 'csv', 'xml', 'cron', 'graphql', 'pdf', 'zip', 'stream', 'multipart', 'rate limit', 'pagination', 'encryption', 'markdown', 'ical', 'smtp'] as const
const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'should', 'when', 'then', 'each', 'only', 'have', 'been', 'must', 'are', 'not', 'its', 'can', 'will', 'use', 'uses'])
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9_]+/).filter((w) => w.length > 3 && !STOP.has(w))

export type ResearchTrigger = { fire: boolean; reasons: string[]; topic: string; sources: string[] }
/** Documentation shorter than this is given to the builder as-is (retrieval supplies the file): a brief of a short document only loses facts, and costs two model swaps. */
export const MIN_RESEARCH_MATERIAL_CHARS = 3000

/** Deterministic: research is needed only for (a) a technology the contract names that nothing in the workspace uses, or (b) local documentation that overlaps the contract. */
export function researchTrigger(request: string, acceptance: string[], files: Record<string, string>): ResearchTrigger {
  const contract = `${request}\n${acceptance.join('\n')}`.toLowerCase()
  const reasons: string[] = []; const sources: string[] = []; const skipped: string[] = []
  const cw = new Set(words(contract))
  for (const [p, t] of Object.entries(files)) {
    if (!/\.md$/i.test(p) || t.length < 400) continue
    const overlap = [...new Set(words(t))].filter((w) => cw.has(w))
    if (overlap.length < 4) continue
    if (t.length < MIN_RESEARCH_MATERIAL_CHARS) { skipped.push(`${p} (${t.length} chars) is short enough to be given to the builder directly`); continue }
    sources.push(p); reasons.push(`local documentation ${p} (${t.length} chars) overlaps the contract (${overlap.slice(0, 5).join(', ')}) and is too long to hand over whole`)
  }
  // a technology the workspace never uses is only worth a brief when there is material to brief FROM; without material the researcher would be answering from memory, which Foundry does not accept
  const code = Object.entries(files).filter(([p]) => !/\.md$/i.test(p)).map(([, t]) => t.toLowerCase()).join('\n')
  const unfamiliar = TECH_TERMS.filter((t) => contract.includes(t) && !code.includes(t))
  if (unfamiliar.length && sources.length) reasons.push(`the contract names ${unfamiliar.join(', ')} and nothing in the workspace uses it`)
  return { fire: sources.length > 0, reasons: reasons.concat(skipped.map((x) => 'not researched: ' + x)), topic: sources[0] ? `documentation: ${sources[0]}` : (unfamiliar[0] ?? ''), sources }
}

export const RESEARCH_SYSTEM = 'You prepare a SHORT research brief for a software engineer who is about to implement a feature. Use ONLY the MATERIAL provided; never rely on memory for project facts. Output at most 8 bullet points, each a concrete fact or constraint taken from the material, each ending with its source in square brackets, e.g. [docs/config.md]. If the material does not answer something the task needs, write one bullet "NOT IN MATERIAL: <what is missing>". No code, no implementation decisions, no opinions, at most 160 words.'
export const researchPrompt = (request: string, acceptance: string[], material: { path: string; text: string }[]) =>
  `TASK THE ENGINEER MUST IMPLEMENT: ${request}\nACCEPTANCE CRITERIA:\n${acceptance.map((a) => `- ${a}`).join('\n')}\n\nMATERIAL:\n${material.map((m) => `--- ${m.path} ---\n${m.text.slice(0, 2600)}`).join('\n\n')}\n\nWrite the brief.`

/** Foundry's check on a brief before the builder sees it: on topic, cites only supplied sources, and its specific claims (numbers, quoted/backticked tokens) occur in the material. */
export function assessBrief(brief: Pick<ResearchBrief, 'text' | 'sources'>, request: string, acceptance: string[], material: { path: string; text: string }[]): { relevant: boolean; reason: string; unsupported: string[] } {
  const text = brief.text.trim()
  if (text.length < 40) return { relevant: false, reason: 'EMPTY_OR_TOO_SHORT', unsupported: [] }
  const contractWords = new Set(words(`${request} ${acceptance.join(' ')}`))
  const overlap = [...new Set(words(text))].filter((w) => contractWords.has(w))
  const corpus = material.map((m) => m.text).join('\n').toLowerCase() + '\n' + `${request}\n${acceptance.join('\n')}`.toLowerCase()
  const cited = [...text.matchAll(/\[([^\]\n]{2,120})\]/g)].map((m) => m[1].trim())
  // only path-looking citations are checked against the supplied files ([acceptance criteria] is not a file reference); code literals are not factual claims
  const strangeSource = cited.filter((c) => /[./]/.test(c) && !/^not in material/i.test(c) && !material.some((m) => c.includes(m.path)))
  const LITERALS = new Set(['null', 'undefined', 'true', 'false', 'nan', '0', '1', '[]', '{}', 'object', 'string', 'number', 'boolean'])
  const claims = [...new Set([...text.matchAll(/`([^`\n]{2,60})`/g)].map((m) => m[1]).concat([...text.matchAll(/\b\d+(?:\.\d+)?\b/g)].map((m) => m[0])))].filter((c) => !LITERALS.has(c.toLowerCase()))
  const unsupported = claims.filter((c) => !corpus.includes(c.toLowerCase()))
  if (strangeSource.length) return { relevant: false, reason: `CITES_SOURCE_NOT_SUPPLIED: ${strangeSource[0].slice(0, 60)}`, unsupported }
  if (claims.length && unsupported.length / claims.length > 0.25) return { relevant: false, reason: `UNSUPPORTED_CLAIMS: ${unsupported.slice(0, 3).join(', ')}`, unsupported }
  if (overlap.length < 2) return { relevant: false, reason: 'OFF_TOPIC: shares fewer than 2 terms with the contract', unsupported }
  return { relevant: true, reason: `on topic (${overlap.slice(0, 4).join(', ')}), ${cited.length} cited, ${claims.length - unsupported.length}/${claims.length} specific claims found in the material`, unsupported }
}

export type Researcher = (a: { request: string; acceptance: string[]; trigger: ResearchTrigger; material: { path: string; text: string }[] }) => Promise<ResearchBrief>
/** A researcher backed by a model client (already wrapped by the Residency Governor when running on a node). */
export function makeResearcher(client: ModelClient, modelLabel: string): Researcher {
  return async ({ request, acceptance, trigger, material }) => {
    const t0 = Date.now()
    const r = await client.generate({ system: RESEARCH_SYSTEM, prompt: researchPrompt(request, acceptance, material), maxTokens: 400, timeoutMs: 120_000, temperature: 0.1, seed: 11 })
    const id = 'rb-' + createHash('sha256').update(`${modelLabel}|${request}|${material.map((m) => m.path).join(',')}`).digest('hex').slice(0, 10)
    if (!r.ok) return { id, topic: trigger.topic, text: '', model: modelLabel, sources: material.map((m) => m.path), relevance: { relevant: false, reason: `RESEARCH_MODEL_FAILED: ${r.detail}` }, ms: Date.now() - t0 }
    // model-written file citations are not trusted: invented ones are counted (a quality signal), every path-like citation is stripped, and Foundry attaches the real sources itself
    const cites = [...r.text.matchAll(/\[([^\]\n]{2,120})\]/g)].map((m) => m[1]).filter((c) => /[./]/.test(c) && !/^not in material/i.test(c))
    const invented = cites.filter((c) => !material.some((m) => c.includes(m.path))).length
    const stripped = r.text.replace(/\s*\[([^\]\n]*[./][^\]\n]*)\]/g, (all, c: string) => (/^not in material/i.test(c) ? all : '')).trim()
    const text = `${stripped.slice(0, BRIEF_CAP - 120)}\nSource: ${material.map((m) => m.path).join(', ')} (attached by Foundry)`.slice(0, BRIEF_CAP)
    const a = assessBrief({ text, sources: material.map((m) => m.path) }, request, acceptance, material)
    return { id, topic: trigger.topic, text, model: `${r.executor.provider}:${r.executor.model}`, sources: material.map((m) => m.path), relevance: { relevant: a.relevant, reason: a.reason }, ms: Date.now() - t0, inventedCitations: invented }
  }
}
