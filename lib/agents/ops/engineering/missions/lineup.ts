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
export async function defaultLineup(opts: { forge?: ForgeStore; base?: string } = {}): Promise<ModelLineup> {
  const base = loopbackBaseUrl(opts.base)
  const store = opts.forge ?? new ForgeStore()
  const models = store.models().length ? store.models() : FIRST_POOL
  const pool = assignPool(models, store.benchmarks())
  const builder = pool.members.find((m) => m.role === 'BUILDER')?.modelRef
  if (!builder) throw new MissionError('NO_BUILDER', `no builder: ${pool.notes.join('; ') || 'the Forge has no evidence route for complete_feature'}`)
  let installed: string[] = []
  try {
    const r = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5000) })
    installed = ((await r.json()) as { models?: { name: string }[] }).models?.map((m) => m.name) ?? []
  } catch { throw new MissionError('NO_BUILDER', 'the local model runtime (Ollama on loopback) is not reachable') }
  const has = (ref: string) => installed.includes(ref)
  if (!has(builder)) throw new MissionError('NO_BUILDER', `the builder ${builder} is not installed in the local model runtime`)
  const client = (ref: string) => new OllamaModelClient(ref, base, keepAliveFor(pool, ref))
  const reviewer = pool.members.find((m) => m.role === 'TEST_REVIEWER')?.modelRef
  const candidate = pool.members.find((m) => m.role === 'TEST_CANDIDATE')?.modelRef
  return {
    builder: { label: builder, model: client(builder) },
    ...(reviewer && has(reviewer) ? { testReviewer: { label: reviewer, model: client(reviewer) } } : {}),
    testCandidates: candidate && has(candidate) ? [{ label: candidate, model: client(candidate) }] : [],
    simulated: false,
  }
}
