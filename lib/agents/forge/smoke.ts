import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { OllamaModelClient, loopbackBaseUrl } from '@/lib/agents/ops/engineering/runtime/ollamaModel'
import type { SmokeResult } from './types'

/** Bounded smoke test through the SAME client Foundry uses: identity, response, structured output, a coding reply that actually runs. */
export async function runSmoke(ref: string, base = loopbackBaseUrl()): Promise<SmokeResult> {
  const detail: string[] = []
  const r: SmokeResult = { modelRef: ref, at: new Date().toISOString(), identity: { ok: false, detail: '' }, responds: false, structured: false, coding: false, throughFoundryClient: false, passed: false, detail }
  try {
    const show = (await (await fetch(`${base}/api/show`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: ref }) })).json()) as { details?: { family?: string; parameter_size?: string; quantization_level?: string }; model_info?: Record<string, unknown> }
    const tags = (await (await fetch(`${base}/api/tags`)).json()) as { models?: { name: string; digest: string; size: number }[] }
    const t = tags.models?.find((m) => m.name === ref)
    r.identity = { ok: !!t, detail: t ? `${ref} digest=${t.digest.slice(0, 12)} size=${t.size} family=${show.details?.family} params=${show.details?.parameter_size} quant=${show.details?.quantization_level}` : 'not present in /api/tags' }
  } catch (e) { r.identity = { ok: false, detail: String(e).slice(0, 120) } }
  detail.push(`identity: ${r.identity.detail}`)
  const client = new OllamaModelClient(ref, base)
  const a = await client.generate({ system: 'Answer briefly.', prompt: 'Reply with exactly the word: pong', maxTokens: 20, timeoutMs: 300_000 })
  r.responds = a.ok && a.text.toLowerCase().includes('pong'); detail.push(`responds: ${a.ok ? JSON.stringify(a.text.slice(0, 40)) : a.detail}`)
  const b = await client.generate({ system: 'Reply with JSON only.', prompt: 'Return {"sum": <number>, "items": [<three strings>]} where sum is 17+25.', json: true, maxTokens: 120, timeoutMs: 300_000 })
  try { const j = JSON.parse(b.ok ? b.text : '{}') as { sum?: number; items?: unknown[] }; r.structured = j.sum === 42 && Array.isArray(j.items) && j.items.length === 3 } catch { r.structured = false }
  detail.push(`structured: ${r.structured}`)
  const c = await client.generate({ system: 'You write correct JavaScript (ESM). Reply with ONE fenced code block only.', prompt: 'Write `export function slugify(s)` that lowercases, trims, replaces runs of non-alphanumerics with a single "-", and strips leading/trailing "-".', maxTokens: 400, timeoutMs: 300_000 })
  r.throughFoundryClient = a.ok && b.ok && c.ok && a.executor.provider === 'ollama' && a.executor.model === ref
  if (c.ok) {
    const m = /```[a-z]*\n([\s\S]*?)```/.exec(c.text)
    if (m) {
      const dir = mkdtempSync(path.join(tmpdir(), 'forge-smoke-'))
      try {
        writeFileSync(path.join(dir, 'a.mjs'), m[1]); writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}')
        writeFileSync(path.join(dir, 't.mjs'), `import { slugify } from './a.mjs'\nif (slugify('  Hello, World!! ') !== 'hello-world' || slugify('--A  b--') !== 'a-b') { console.error('wrong output'); process.exit(1) }\n`)
        execFileSync('node', ['t.mjs'], { cwd: dir, timeout: 15_000, stdio: 'pipe' }); r.coding = true
      } catch (e) { detail.push(`coding run failed: ${String((e as { stderr?: Buffer }).stderr ?? e).slice(0, 160)}`) } finally { rmSync(dir, { recursive: true, force: true }) }
    } else detail.push('coding: no fenced block')
  } else detail.push(`coding call failed: ${c.detail}`)
  r.passed = r.identity.ok && r.responds && r.structured && r.coding && r.throughFoundryClient
  return r
}
