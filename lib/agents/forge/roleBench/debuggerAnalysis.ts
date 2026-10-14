/**
 * Why did a model miss the DEBUGGER gate? Exploratory, NOT qualification evidence (own store, never counted for a role): re-runs chosen debugger fixtures with
 * the full reply kept, under the standard prompt (control) and prompt variants, to tell apart (A) missing capability, (B) a poor prompt/format, (C) a fixture that
 * hides context, and (D) another installed model. The gate and the fixtures are not changed.
 *   node ... debuggerAnalysis.ts --model <ref> --fixtures a,b,c --repeats 3 --out <dir>
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { OllamaModelClient, loopbackBaseUrl } from '@/lib/agents/ops/engineering/runtime/ollamaModel'
import { debuggerFixtures } from './debugger'
import { extractJson } from './exec'

const a = process.argv.slice(2); const arg = (n: string, d = '') => { const i = a.indexOf(`--${n}`); return i >= 0 ? a[i + 1] : d }
const model = arg('model'), out = arg('out'), repeats = Number(arg('repeats', '3')), wanted = arg('fixtures').split(',').filter(Boolean)
if (!model || !out) { console.error('usage: --model <ref> --out <dir> [--fixtures a,b] [--repeats 3]'); process.exit(2) }
mkdirSync(out, { recursive: true })
const VARIANTS: Record<string, (s: string) => string> = {
  V0_control: (s) => s,
  V1_all_defects: (s) => s + ' The failing report shows only the FIRST assertion that failed; the test may check several things. Read the whole test and fix EVERY defect that would make ANY assertion fail, then re-check each assertion against your fixed code before answering.',
  V2_two_step: (s) => s + ' First list, inside root_cause, each assertion of the test and whether the current code satisfies it; then fix every assertion that is not satisfied.',
}
const client = new OllamaModelClient(model, loopbackBaseUrl(), '5m')
const fixtures = (await debuggerFixtures()).filter((f) => !wanted.length || wanted.includes(f.id.split('/')[1]))
const rows: { variant: string; fixture: string; repeat: number; pass: boolean; detail: string; rootCause: string; fixedCodeHead: string }[] = []
for (const [variant, tweak] of Object.entries(VARIANTS)) {
  for (const f of fixtures) for (let r = 1; r <= repeats; r++) {
    const res = await client.generate({ system: tweak(f.system), prompt: f.prompt, json: true, maxTokens: f.maxTokens, temperature: 0.1, seed: 7 + r, timeoutMs: 180_000 })
    if (!res.ok) { rows.push({ variant, fixture: f.id, repeat: r, pass: false, detail: `model call failed: ${res.detail}`, rootCause: '', fixedCodeHead: '' }); continue }
    const c = await f.check(res.text); const j = extractJson<{ root_cause?: string; fixed_code?: string }>(res.text)
    rows.push({ variant, fixture: f.id, repeat: r, pass: c.pass, detail: c.detail, rootCause: (j?.root_cause ?? '').slice(0, 300), fixedCodeHead: (j?.fixed_code ?? res.text).slice(0, 600) })
    console.log(`${variant} ${f.id.split('/')[1]} r${r}: ${c.pass ? 'ok  ' : 'FAIL'} ${c.pass ? '' : c.detail.slice(0, 110)}`)
  }
}
const summary = Object.fromEntries(Object.keys(VARIANTS).map((v) => { const x = rows.filter((r) => r.variant === v); return [v, `${x.filter((r) => r.pass).length}/${x.length}`] }))
writeFileSync(path.join(out, 'debugger-analysis.json'), JSON.stringify({ model, at: new Date().toISOString(), repeats, summary, rows }, null, 1))
await fetch(`${loopbackBaseUrl()}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, keep_alive: 0 }) }).catch(() => undefined)
console.log(JSON.stringify(summary))
