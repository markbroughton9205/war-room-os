import type { ModelClient, ModelResult } from './ports'

/** Loopback-only Ollama client. Never contacts a non-loopback host; reports ACTUAL executor and real token counts (UNKNOWN when absent). */
export function loopbackBaseUrl(raw: string | undefined = process.env.WAR_ROOM_OLLAMA_URL): string {
  const base = (raw && raw.trim()) || 'http://127.0.0.1:11434'
  const u = new URL(base)
  if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(u.hostname) || u.username || u.password) throw new Error(`refusing non-loopback model endpoint: ${u.hostname}`)
  return u.origin
}

/**
 * A generation that has fallen into a loop (the same statement written again and again until the token cap) is detected while it streams and stopped at once, instead of
 * running to the cap and the call timeout. True when the output has at least 40 lines and its last 25 lines all have the same shape (quoted text and numbers masked).
 */
export function isRunaway(text: string): boolean {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length < 40) return false
  const shape = (l: string) => l.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, 'S').replace(/\d+/g, 'N')
  const tail = lines.slice(-25).map(shape)
  return tail.every((x) => x === tail[0]) && tail[0].length > 8
}

export class OllamaModelClient implements ModelClient {
  /** `keepAlive`: how long Ollama keeps the model loaded after a call. Helper models (test reviewer, competing writers) use '0' so they free the GPU for the builder instead of competing with it for memory. */
  constructor(readonly model: string, private readonly baseUrl: string = loopbackBaseUrl(), private readonly keepAlive: string = '10m') { loopbackBaseUrl(baseUrl) }
  async generate(input: { system: string; prompt: string; maxTokens?: number; timeoutMs?: number; signal?: AbortSignal; json?: boolean; temperature?: number; seed?: number }): Promise<ModelResult> {
    const executor = { provider: 'ollama', model: this.model }
    const t0 = Date.now()
    const ctrl = new AbortController()
    let looped = false
    const timer = setTimeout(() => ctrl.abort(), input.timeoutMs ?? 240_000)
    input.signal?.addEventListener('abort', () => ctrl.abort(), { once: true })
    try {
      const res = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctrl.signal,
        body: JSON.stringify({ model: this.model, system: input.system, prompt: input.prompt, stream: true, think: false, keep_alive: this.keepAlive, ...(input.json ? { format: 'json' } : {}), options: { temperature: input.temperature ?? 0.1, num_predict: input.maxTokens ?? 3000, num_ctx: 8192, ...(input.seed !== undefined ? { seed: input.seed } : {}) } }),
      })
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status}`, executor }
      // streamed so a loop can be stopped while it happens and the connection never waits for response headers until the whole reply exists
      let text = '', buf = '', evalCount: unknown, promptEval: unknown, sawDone = false, lastCheck = 0
      const dec = new TextDecoder()
      const take = (raw: string): ModelResult | null => {
        const line = raw.trim()
        if (!line) return null
        let j: { response?: unknown; done?: unknown; eval_count?: unknown; prompt_eval_count?: unknown; error?: unknown }
        try { j = JSON.parse(line) } catch { return { ok: false, detail: 'malformed response', executor } }
        if (typeof j.error === 'string') return { ok: false, detail: `model error: ${j.error.slice(0, 120)}`, executor }
        if (typeof j.response === 'string') text += j.response
        if (j.done === true) sawDone = true
        if (j.eval_count !== undefined) evalCount = j.eval_count // counts come with the last chunk; a non-streaming server sends them with the only one
        if (j.prompt_eval_count !== undefined) promptEval = j.prompt_eval_count
        return null
      }
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buf += dec.decode(chunk, { stream: true })
        let nl: number
        while ((nl = buf.indexOf('\n')) >= 0) { const bad = take(buf.slice(0, nl)); buf = buf.slice(nl + 1); if (bad) return bad }
        if (text.length - lastCheck > 400) { lastCheck = text.length; if (isRunaway(text)) { looped = true; ctrl.abort(); return { ok: false, detail: 'degenerate repetition (runaway generation)', executor } } }
      }
      { const bad = take(buf); if (bad) return bad }
      if (!sawDone && !text) return { ok: false, detail: 'malformed response', executor }
      return { ok: true, text, executor, promptTokens: typeof promptEval === 'number' ? promptEval : 'UNKNOWN', outputTokens: typeof evalCount === 'number' ? evalCount : 'UNKNOWN', latencyMs: Date.now() - t0 }
    } catch (err) {
      if (looped) return { ok: false, detail: 'degenerate repetition (runaway generation)', executor }
      return { ok: false, detail: err instanceof Error ? (err.name === 'AbortError' ? 'timeout or cancelled' : err.message.slice(0, 160)) : 'failed', executor }
    } finally { clearTimeout(timer) }
  }
}
