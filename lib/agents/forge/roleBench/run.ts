import type { ModelClient } from '@/lib/agents/ops/engineering/runtime/ports'
import type { Fixture } from './types'

export type RunOutcome = { fixtureId: string; repeat: number; pass: boolean; detail: string; klass?: string; ms: number; outputTokens: number | 'UNKNOWN'; modelOk: boolean; failure?: string }

/** Runs every fixture `repeats` times against one client, sequentially. A model-call failure is a failed run with the runtime's reason, never a skipped one. */
export async function runFixtures(client: ModelClient, fixtures: Fixture[], opts: { repeats?: number; timeoutMs?: number; signal?: AbortSignal; onRun?: (o: RunOutcome) => void } = {}): Promise<RunOutcome[]> {
  const out: RunOutcome[] = []
  for (let r = 1; r <= (opts.repeats ?? 1); r++) {
    for (const f of fixtures) {
      if (opts.signal?.aborted) return out
      const t0 = Date.now()
      const res = await client.generate({ system: f.system, prompt: f.prompt, maxTokens: f.maxTokens, timeoutMs: opts.timeoutMs ?? 180_000, signal: opts.signal, json: f.json, temperature: 0.1, seed: 7 + r })
      let o: RunOutcome
      if (!res.ok) o = { fixtureId: f.id, repeat: r, pass: false, detail: `model call failed: ${res.detail}`, ms: Date.now() - t0, outputTokens: 'UNKNOWN', modelOk: false, failure: res.detail }
      else {
        let c: Awaited<ReturnType<Fixture['check']>>
        try { c = await f.check(res.text) } catch (e) { c = { pass: false, detail: `checker error: ${e instanceof Error ? e.message : e}` } }
        o = { fixtureId: f.id, repeat: r, pass: c.pass, detail: c.detail, klass: c.klass, ms: Date.now() - t0, outputTokens: res.outputTokens, modelOk: true, ...(c.pass ? {} : { failure: c.detail }) }
      }
      opts.onRun?.(o); out.push(o)
    }
  }
  return out
}
