import { ForgeStore } from '@/lib/agents/forge/store'
import { assignPool, keepAliveFor } from '@/lib/agents/forge/pool'
import { FIRST_POOL } from '@/lib/agents/forge/registry'
import { OllamaModelClient, loopbackBaseUrl } from '../runtime/ollamaModel'
import { MissionError, type ModelLineup } from './runner'

/**
 * The real local line-up, resolved from Forge evidence by the Specialist Pool (builder = the evidence route for complete_feature; test reviewer and competing test
 * candidate by status/role; heavy models never implicit). Loopback Ollama only. Retrieval, research and fast-repair stay OFF (their Stage 4 verdicts are INACTIVE).
 * The builder stays resident (keep_alive 10m); helpers unload as soon as they answer, as in the gold rounds.
 */
export async function defaultLineup(opts: { forge?: ForgeStore; base?: string; /** escalation: a different, already-qualified local model builds this mission alone */ builder?: string } = {}): Promise<ModelLineup> {
  const base = loopbackBaseUrl(opts.base)
  const store = opts.forge ?? new ForgeStore()
  const models = store.models().length ? store.models() : FIRST_POOL
  const pool = assignPool(models, store.benchmarks())
  const builder = opts.builder ?? pool.members.find((m) => m.role === 'BUILDER')?.modelRef
  if (!builder) throw new MissionError('NO_BUILDER', `no builder: ${pool.notes.join('; ') || 'the Forge has no evidence route for complete_feature'}`)
  let installed: string[] = []
  try {
    const r = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5000) })
    installed = ((await r.json()) as { models?: { name: string }[] }).models?.map((m) => m.name) ?? []
  } catch { throw new MissionError('NO_BUILDER', 'the local model runtime (Ollama on loopback) is not reachable') }
  const has = (ref: string) => installed.includes(ref)
  if (!has(builder)) throw new MissionError('NO_BUILDER', `the builder ${builder} is not installed in the local model runtime`)
  // FAULT INJECTION (acceptance testing only, off by default, recorded on every mission it touches): the DEFAULT builder answers with unusable text, so the recovery path (diagnose, escalate to a
  // qualified specialist) can be exercised on the real pipeline. An explicitly requested escalation builder is never affected.
  const chaos = !opts.builder && process.env.WAR_ROOM_CHAOS_BUILDER === 'garbage'
  const real = (ref: string) => new OllamaModelClient(ref, base, opts.builder && ref === opts.builder ? '10m' : keepAliveFor(pool, ref))
  const client = (ref: string) => (chaos && ref === builder ? ({ async generate(i: Parameters<OllamaModelClient['generate']>[0]) { const r = await real(ref).generate({ ...i, maxTokens: 8 }); return r.ok ? { ...r, text: 'I am sorry, I am unable to produce code for this request.' } : r } } as unknown as OllamaModelClient) : real(ref))
  // an escalation mission is a bounded repair by one specialist: no reviewer/competing-writer helpers, so nothing else competes for the GPU
  const reviewer = opts.builder ? undefined : pool.members.find((m) => m.role === 'TEST_REVIEWER')?.modelRef
  const candidate = opts.builder ? undefined : pool.members.find((m) => m.role === 'TEST_CANDIDATE')?.modelRef
  return {
    builder: { label: builder, model: client(builder) },
    ...(reviewer && has(reviewer) ? { testReviewer: { label: reviewer, model: client(reviewer) } } : {}),
    testCandidates: candidate && has(candidate) ? [{ label: candidate, model: client(candidate) }] : [],
    simulated: false,
  }
}
