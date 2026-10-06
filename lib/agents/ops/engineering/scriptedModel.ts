import type { ModelClient, ModelResult } from './runtime/ports'

export type ScriptCtx = { kind: 'file' | 'analyst' | 'repair'; path: string | null; prompt: string; callNumber: number }
/** A LABELLED TEST DOUBLE for workflow-mechanics validators only. Its results carry isTestDouble and a 'test-double' executor, and never count as real model evidence. */
export class ScriptedModel implements ModelClient {
  readonly calls: ScriptCtx[] = []
  constructor(private readonly script: (ctx: ScriptCtx) => string | null | Promise<string | null>, private readonly tokens: number | 'UNKNOWN' = 'UNKNOWN') {}
  async generate(input: { system: string; prompt: string }): Promise<ModelResult> {
    const kind: ScriptCtx['kind'] = /debugging analyst/.test(input.system) ? 'analyst' : /^FEATURE:/m.test(input.prompt) && /FILE TO FIX:/.test(input.prompt) ? 'repair' : 'file'
    const path = /FILE TO (?:EDIT|CREATE): (\S+)/.exec(input.prompt)?.[1] ?? /FILE TO FIX: (\S+)/.exec(input.prompt)?.[1] ?? null
    const ctx: ScriptCtx = { kind, path, prompt: input.prompt, callNumber: this.calls.length + 1 }
    this.calls.push(ctx)
    const reply = await this.script(ctx)
    const executor = { provider: 'test-double', model: 'scripted' }
    if (reply === null) return { ok: false, detail: 'scripted model has no reply', executor }
    return { ok: true, text: reply, executor, promptTokens: this.tokens, outputTokens: this.tokens, latencyMs: 1, isTestDouble: true }
  }
}
export const fenced = (code: string) => '```js\n' + code + '\n```'
