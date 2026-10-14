import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * CODE_RETRIEVAL / RERANKER scoring on this repository: find the file that answers a natural-language question. File-level ground truth, ranking by the
 * best chunk of each file. The embedding order is compared with a plain keyword (grep-style) baseline so a model only earns the role by beating "just search".
 */
export type Chunk = { file: string; text: string }
export type Query = { id: string; q: string; files: string[] }
export const CORPUS_DIRS = ['lib/agents/forge', 'lib/agents/ops/engineering', 'lib/agents/ops/engineering/runtime']

export const QUERIES: Query[] = [
  { id: 'replay_window', q: 'where is the replay window for signed messages enforced', files: ['lib/agents/forge/nodeProtocol.ts'] },
  { id: 'unload_keepalive_zero', q: 'unload a model from the GPU by setting keep_alive to zero', files: ['lib/agents/forge/governor.ts'] },
  { id: 'route_by_evidence', q: 'which model is routed for a task class based only on benchmark evidence', files: ['lib/agents/forge/routing.ts'] },
  { id: 'enrollment_tokens', q: 'enrollment tokens that are single use and expire', files: ['lib/agents/forge/enrollment.ts'] },
  { id: 'classify_residency', q: 'classify whether a model fits fully on the GPU from the runtime byte counts', files: ['lib/agents/forge/profile.ts'] },
  { id: 'append_only_store', q: 'append-only JSONL store that refuses credential-like content', files: ['lib/agents/forge/store.ts'] },
  { id: 'failover_retry', q: 'retry a job on another node after a timeout and log both attempts', files: ['lib/agents/forge/scheduler.ts'] },
  { id: 'private_network_host', q: 'check that a rack endpoint host is on a private network', files: ['lib/agents/forge/nodeRecord.ts', 'lib/agents/forge/node.ts'] },
  { id: 'heartbeat_stale', q: 'a node whose heartbeat is stale becomes unreachable', files: ['lib/agents/forge/nodeRecord.ts'] },
  { id: 'probe_local_runtime', q: 'read installed models and VRAM from the local Ollama runtime without loading anything', files: ['lib/agents/forge/localNode.ts'] },
  { id: 'compute_panel_rows', q: 'plain language rows for the compute panel in the Foundry UI', files: ['lib/agents/forge/computeViewModel.ts'] },
  { id: 'rank_for_role', q: 'ranking models for a role with a minimum number of runs gate', files: ['lib/agents/forge/rank.ts', 'lib/agents/forge/roles.ts'] },
  { id: 'legacy_role_mapping', q: 'mapping of the old pool roles onto the compute roles', files: ['lib/agents/forge/roles.ts'] },
  { id: 'simulated_faults', q: 'simulated node that injects faults such as tampered output or a forged signature', files: ['lib/agents/forge/simNode.ts'] },
  { id: 'verify_receipt', q: 'dispatch a signed job and verify the receipt output hash', files: ['lib/agents/forge/nodeClient.ts'] },
  { id: 'pool_roles', q: 'which model plays builder, reviewer and writer in the specialist pool', files: ['lib/agents/forge/pool.ts'] },
  { id: 'benchmark_scorecard', q: 'scorecard summarising benchmark results per model', files: ['lib/agents/forge/scorecard.ts'] },
  { id: 'smoke_test', q: 'smoke test that a model responds and can write structured output', files: ['lib/agents/forge/smoke.ts'] },
  { id: 'declared_pool', q: 'the declared first pool of models with their lineage and licence', files: ['lib/agents/forge/registry.ts'] },
  { id: 'shadow_decisions', q: 'scheduler decisions compared with what the harness actually ran', files: ['lib/agents/forge/computeShadow.ts'] },
  { id: 'runaway_generation', q: 'detect a generation stuck repeating the same line over and over', files: ['lib/agents/ops/engineering/runtime/ollamaModel.ts'] },
  { id: 'generated_contract_tests', q: 'generate contract tests for list filter and per-status count criteria', files: ['lib/agents/ops/engineering/testPlan.ts'] },
  { id: 'preflight_generated_code', q: 'preflight check of generated code before running it', files: ['lib/agents/ops/engineering/preflight.ts'] },
  { id: 'structural_edits', q: 'apply structural edits to a file located by anchors', files: ['lib/agents/ops/engineering/structEdit.ts'] },
]

/**
 * Paraphrased questions that avoid the identifiers in the code, so plain keyword search is at a disadvantage. Written before any embedding model was scored on them.
 * Pre-registered rule for CODE_RETRIEVAL: recall@10 >= 0.9 on QUERIES, and recall@10 on SEMANTIC_QUERIES at least equal to the keyword baseline's.
 */
export const SEMANTIC_QUERIES: Query[] = [
  { id: 's_replay', q: 'how do we make sure an old captured network message cannot be sent again', files: ['lib/agents/forge/nodeProtocol.ts'] },
  { id: 's_free_gpu', q: 'free the graphics memory held by a language model right now', files: ['lib/agents/forge/governor.ts'] },
  { id: 's_choose_by_history', q: 'choose which neural network gets a job purely from past test results', files: ['lib/agents/forge/routing.ts', 'lib/agents/forge/rank.ts'] },
  { id: 's_join_token', q: 'one-time password for letting a new machine join the cluster', files: ['lib/agents/forge/enrollment.ts'] },
  { id: 's_spill', q: 'decide if the whole model sits in graphics memory or spills into normal memory', files: ['lib/agents/forge/profile.ts'] },
  { id: 's_log_file', q: 'a log we only ever add lines to and which rejects anything that looks like a password', files: ['lib/agents/forge/store.ts'] },
  { id: 's_run_elsewhere', q: 'if a machine dies partway through, run the work somewhere else', files: ['lib/agents/forge/scheduler.ts'] },
  { id: 's_own_network', q: 'make sure a machine address belongs to our own network and not the internet', files: ['lib/agents/forge/nodeRecord.ts', 'lib/agents/forge/node.ts'] },
  { id: 's_gone_quiet', q: 'a computer that has gone quiet is treated as gone', files: ['lib/agents/forge/nodeRecord.ts'] },
  { id: 's_list_installed', q: 'list what the local AI server has installed and how much memory the graphics card has', files: ['lib/agents/forge/localNode.ts'] },
  { id: 's_operator_sentences', q: 'turn raw status data into sentences for the operator screen', files: ['lib/agents/forge/computeViewModel.ts', 'lib/agents/forge/poolViewModel.ts'] },
  { id: 's_fake_machine', q: 'fake machine that misbehaves on purpose so we can test our defences', files: ['lib/agents/forge/simNode.ts'] },
  { id: 's_same_sentence', q: 'stop a model that keeps writing the same sentence forever', files: ['lib/agents/ops/engineering/runtime/ollamaModel.ts'] },
  { id: 's_write_checks', q: 'automatically write the checks that prove a feature list works', files: ['lib/agents/ops/engineering/testPlan.ts'] },
  { id: 's_inspect_before_run', q: 'inspect code the model wrote for dangerous things before executing it', files: ['lib/agents/ops/engineering/preflight.ts'] },
  { id: 's_describe_where', q: 'change a source file by describing where in it to change rather than rewriting it', files: ['lib/agents/ops/engineering/structEdit.ts'] },
  { id: 's_helper_models', q: 'which small models help the main model and when do they leave memory', files: ['lib/agents/forge/pool.ts'] },
  { id: 's_summary_table', q: 'summary table of how every model performed', files: ['lib/agents/forge/scorecard.ts'] },
]

export function buildCorpus(root: string, dirs = CORPUS_DIRS, linesPerChunk = 45): { chunks: Chunk[]; files: string[]; digest: string } {
  const chunks: Chunk[] = []; const files: string[] = []
  for (const d of dirs) {
    let names: string[] = []
    try { names = readdirSync(path.join(root, d), { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.ts') && !/\.validation\.ts$/.test(e.name)).map((e) => e.name).sort() } catch { continue }
    for (const n of names) {
      const rel = `${d}/${n}`; files.push(rel)
      const lines = readFileSync(path.join(root, rel), 'utf8').split('\n')
      for (let i = 0; i < lines.length; i += linesPerChunk) {
        const text = lines.slice(i, i + linesPerChunk).join('\n').slice(0, 2400)
        if (text.trim().length > 40) chunks.push({ file: rel, text: `// file: ${rel}\n${text}` })
      }
    }
  }
  return { chunks, files, digest: createHash('sha256').update(chunks.map((c) => c.text).join('\u0000')).digest('hex').slice(0, 16) }
}

const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'and', 'or', 'is', 'are', 'that', 'with', 'from', 'by', 'it', 'as', 'at', 'be', 'this', 'which', 'where', 'what', 'how', 'after', 'before', 'than', 'such'])
export const tokens = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !STOP.has(t))

/** grep-style baseline: files ranked by how many distinct query terms occur in their best chunk, then by total hits. */
export function keywordRank(chunks: Chunk[], q: string): string[] {
  const terms = [...new Set(tokens(q))]
  const best = new Map<string, number>()
  for (const c of chunks) {
    const low = c.text.toLowerCase()
    let distinct = 0, hits = 0
    for (const t of terms) { const n = low.split(t).length - 1; if (n > 0) { distinct++; hits += Math.min(n, 5) } }
    const score = distinct * 100 + hits
    if (score > (best.get(c.file) ?? -1)) best.set(c.file, score)
  }
  return [...best.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([f]) => f)
}

export const cosine = (a: number[], b: number[]) => { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] } return d / (Math.sqrt(na * nb) || 1) }

export function embeddingRank(chunks: Chunk[], chunkVecs: number[][], queryVec: number[]): string[] {
  const best = new Map<string, number>()
  chunks.forEach((c, i) => { const s = cosine(queryVec, chunkVecs[i]); if (s > (best.get(c.file) ?? -2)) best.set(c.file, s) })
  return [...best.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([f]) => f)
}

export type RankMetrics = { recall1: number; recall3: number; recall10: number; mrr: number; n: number }
export function metrics(rankings: string[][], truth: string[][]): RankMetrics {
  let r1 = 0, r3 = 0, r10 = 0, mrr = 0
  rankings.forEach((rk, i) => { const pos = rk.findIndex((f) => truth[i].includes(f)); if (pos === 0) r1++; if (pos >= 0 && pos < 3) r3++; if (pos >= 0 && pos < 10) r10++; if (pos >= 0) mrr += 1 / (pos + 1) })
  const n = rankings.length || 1
  return { recall1: r1 / n, recall3: r3 / n, recall10: r10 / n, mrr: mrr / n, n: rankings.length }
}

/** Chunks are <= 2400 characters (~700 tokens); a 2K window keeps the embedding model's KV cache small so it can share the GPU with the builder. */
export const EMBED_NUM_CTX = 2048
export const QUERY_INSTRUCTION = 'Instruct: Given a question about a TypeScript code base, retrieve the source file that answers it\nQuery: '

/** Embeds through the loopback runtime's /api/embed. Batches of 16; keep_alive 0 unloads the embedding model when done unless told otherwise. */
export async function embed(base: string, model: string, inputs: string[], keepAlive: string | number = 0, fetchImpl: typeof fetch = fetch): Promise<number[][]> {
  const out: number[][] = []
  for (let i = 0; i < inputs.length; i += 16) {
    const res = await fetchImpl(`${base}/api/embed`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, input: inputs.slice(i, i + 16), keep_alive: keepAlive, truncate: true, options: { num_ctx: EMBED_NUM_CTX } }), signal: AbortSignal.timeout(120_000) })
    if (!res.ok) throw new Error(`embed HTTP ${res.status}`)
    const j = (await res.json()) as { embeddings?: number[][] }
    if (!j.embeddings || j.embeddings.length !== inputs.slice(i, i + 16).length) throw new Error('embed returned the wrong number of vectors')
    out.push(...j.embeddings)
  }
  return out
}

/** Profile an embedding model (it cannot /api/generate): one timed /api/embed call, then the runtime's own accounting from /api/ps. */
export async function measureEmbeddingProfile(base: string, model: string, ctx: number, fetchImpl: typeof fetch = fetch) {
  const t0 = Date.now()
  const res = await fetchImpl(`${base}/api/embed`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, input: ['function schedule(job, world) { return placement }'], keep_alive: '5m', options: { num_ctx: EMBED_NUM_CTX } }), signal: AbortSignal.timeout(120_000) })
  if (!res.ok) throw new Error(`embed HTTP ${res.status}`)
  const j = (await res.json()) as { load_duration?: number }
  const ms = Date.now() - t0
  const ps = (await (await fetchImpl(`${base}/api/ps`)).json()) as { models?: { name?: string; size?: number; size_vram?: number; context_length?: number }[] }
  const m = ps.models?.find((x) => x.name === model)
  const cls = m?.size && m.size_vram !== undefined ? (m.size_vram >= m.size * 0.98 ? 'FULL_GPU' : m.size_vram <= 0 ? 'CPU_ASSISTED' : 'PARTIAL_OFFLOAD') : 'UNKNOWN'
  return { loadMs: typeof j.load_duration === 'number' ? Math.round(j.load_duration / 1e6) : ('UNKNOWN' as const), firstEmbedMs: ms, size: m?.size, sizeVram: m?.size_vram, contextTokens: m?.context_length ?? ctx, residency: cls as 'FULL_GPU' | 'CPU_ASSISTED' | 'PARTIAL_OFFLOAD' | 'UNKNOWN' }
}

/**
 * RERANKER path. Ollama has no rerank endpoint (POST /api/rerank is 404), so the Qwen3-Reranker is used the way its model card defines it: a causal LM
 * that answers "yes" or "no" to a (instruction, query, document) prompt; the relevance score is P(yes) / (P(yes) + P(no)) from the next-token log-probabilities,
 * obtained through the supported /api/generate `logprobs` option with a raw prompt (no chat template applied by the server).
 * Pre-registered rule: over all queries, reranked MRR > embedding MRR AND reranked recall@3 >= embedding recall@3.
 */
export const RERANK_INSTRUCTION = 'Given a question about a TypeScript code base, judge whether the code document is the file that answers it'
const RERANK_PREFIX = '<|im_start|>system\nJudge whether the Document meets the requirements based on the Query and the Instruct provided. Note that the answer can only be "yes" or "no".<|im_end|>\n<|im_start|>user\n'
const RERANK_SUFFIX = '<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n'
export const rerankPrompt = (query: string, doc: string) => `${RERANK_PREFIX}<Instruct>: ${RERANK_INSTRUCTION}\n<Query>: ${query}\n<Document>: ${doc.slice(0, 1600)}${RERANK_SUFFIX}`

export function scoreFromLogprobs(top: { token: string; logprob: number }[]): { score: number; sawBoth: boolean; sawEither: boolean } {
  const best = (re: RegExp) => top.filter((t) => re.test(t.token.trim())).reduce<number | null>((m, t) => (m === null || t.logprob > m ? t.logprob : m), null)
  const y = best(/^yes$/i), n = best(/^no$/i)
  if (y === null && n === null) return { score: 0, sawBoth: false, sawEither: false }
  if (n === null) return { score: 1, sawBoth: false, sawEither: true }
  if (y === null) return { score: 0, sawBoth: false, sawEither: true }
  const py = Math.exp(y), pn = Math.exp(n)
  return { score: py / (py + pn), sawBoth: true, sawEither: true }
}

export async function rerankScore(base: string, model: string, query: string, doc: string, keepAlive: string | number = '5m', fetchImpl: typeof fetch = fetch) {
  const res = await fetchImpl(`${base}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, prompt: rerankPrompt(query, doc), raw: true, stream: false, logprobs: true, top_logprobs: 20, keep_alive: keepAlive, options: { num_predict: 1, temperature: 0, num_ctx: 2048 } }), signal: AbortSignal.timeout(60_000) })
  if (!res.ok) throw new Error(`rerank generate HTTP ${res.status}`)
  const j = (await res.json()) as { logprobs?: { top_logprobs?: { token: string; logprob: number }[] }[] }
  const top = j.logprobs?.[0]?.top_logprobs
  if (!top) throw new Error('runtime returned no logprobs (reranking needs /api/generate logprobs support)')
  return scoreFromLogprobs(top)
}

/** Best chunk text per file for one query's candidate files (by embedding similarity), used as the document the reranker judges. */
export function bestChunkPerFile(chunks: Chunk[], chunkVecs: number[][], queryVec: number[], files: string[]): Map<string, string> {
  const best = new Map<string, { s: number; text: string }>(); const want = new Set(files)
  chunks.forEach((c, i) => { if (!want.has(c.file)) return; const s = cosine(queryVec, chunkVecs[i]); if (s > (best.get(c.file)?.s ?? -2)) best.set(c.file, { s, text: c.text }) })
  return new Map([...best].map(([f, v]) => [f, v.text]))
}
