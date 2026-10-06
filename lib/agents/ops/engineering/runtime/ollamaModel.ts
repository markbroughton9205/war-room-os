import type { ModelClient, ModelResult } from './ports'

/** Loopback-only Ollama client. Never contacts a non-loopback host; reports ACTUAL executor and real token counts (UNKNOWN when absent). */
export function loopbackBaseUrl(raw: string | undefined = process.env.WAR_ROOM_OLLAMA_URL): string {
  const base = (raw && raw.trim()) || 'http://127.0.0.1:11434'
  const u = new URL(base)
  if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(u.hostname) || u.username || u.password) throw new Error(`refusing non-loopback model endpoint: ${u.hostname}`)
  return u.origin
}

export class OllamaModelClient implements ModelClient {
  constructor(readonly model: string, private readonly baseUrl: string = loopbackBaseUrl()) { loopbackBaseUrl(baseUrl) }
  async generate(input: { system: string; prompt: string; maxTokens?: number; timeoutMs?: number; signal?: AbortSignal; json?: boolean; temperature?: number; seed?: number }): Promise<ModelResult> {
    const executor = { provider: 'ollama', model: this.model }
    const t0 = Date.now()
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), input.timeoutMs ?? 240_000)
    input.signal?.addEventListener('abort', () => ctrl.abort(), { once: true })
    try {
      const res = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctrl.signal,
        body: JSON.stringify({ model: this.model, system: input.system, prompt: input.prompt, stream: false, think: false, keep_alive: '10m', ...(input.json ? { format: 'json' } : {}), options: { temperature: input.temperature ?? 0.1, num_predict: input.maxTokens ?? 3000, num_ctx: 8192, ...(input.seed !== undefined ? { seed: input.seed } : {}) } }),
      })
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status}`, executor }
      const j = (await res.json()) as { response?: unknown; eval_count?: unknown; prompt_eval_count?: unknown }
      if (typeof j.response !== 'string') return { ok: false, detail: 'malformed response', executor }
      return { ok: true, text: j.response, executor, promptTokens: typeof j.prompt_eval_count === 'number' ? j.prompt_eval_count : 'UNKNOWN', outputTokens: typeof j.eval_count === 'number' ? j.eval_count : 'UNKNOWN', latencyMs: Date.now() - t0 }
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? (err.name === 'AbortError' ? 'timeout or cancelled' : err.message.slice(0, 160)) : 'failed', executor }
    } finally { clearTimeout(timer) }
  }
}
