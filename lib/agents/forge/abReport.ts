/**
 * Mission A/B report: BASELINE vs each integrated configuration, per fixture and overall, with the pre-registered specialist verdict.
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/agents/forge/abReport.ts <evidence root> <out.md> [--record]
 * Mission directories are named <CONFIG>-<fixture>-<n>. --record writes SpecialistUse records to the Forge store (WAR_ROOM_AGENT_FOUNDRY_DIR).
 */
import { writeFileSync } from 'node:fs'
import { judgeSpecialist, loadMissions, specialistUses, type MissionRow } from './abAnalysis'
import { ForgeStore } from './store'

const [root, out] = process.argv.slice(2)
if (!root || !out) { console.error('usage: abReport.ts <evidence root> <out.md> [--record]'); process.exit(2) }
const rows = loadMissions(root)
const configs = [...new Set(rows.map((r) => r.config))]
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const md: string[] = ['## Missions', '', '| Run | Class | Verifier | Wall s | Builder calls | Repairs | Tokens | Prompts | Context chars | Retrieved provided | Irrelevant provided | Wrong-file edits | Evictions | Embed ms | Research ms | Fast repair | Peak GPU MiB | Peak RAM MiB | Swap MiB |', '|' + Array(19).fill('---').join('|') + '|']
for (const r of rows) md.push(`| ${r.run} | ${r.completionClass} | ${r.verifier.replace('# tests ', '').replace(' | # pass ', '/').replace(' | # fail ', ' fail ')} | ${r.wallS} | ${r.builderCalls} | ${r.repairs} | ${r.tokens ?? '?'} | ${r.promptCalls} | ${r.contextChars} | ${r.retrievedProvided.length} (${r.relevantProvidedHelpers.length} helpers) | ${r.irrelevantProvided.length} | ${r.wrongFileEdits.length} | ${r.evictions} | ${r.embedMs} | ${r.researchMs} | ${r.fastRepair} | ${r.peakGpuMiB ?? '?'} | ${r.peakRamMiB ?? '?'} | ${r.swapUsedMiB ?? '?'} |`)
const base = rows.filter((r) => r.config === 'BASELINE')
md.push('', '## Verdicts (pre-registered rule in abAnalysis.ts)', '')
const verdicts: Record<string, unknown> = {}
for (const c of configs.filter((x) => x !== 'BASELINE')) {
  const spec = rows.filter((r) => r.config === c)
  const v = judgeSpecialist(base, spec)
  verdicts[c] = v
  md.push(`### ${c} vs BASELINE: **${v.verdict}**`, `- missions: ${v.n.specialist} vs ${v.n.baseline}; success ${v.success.specialist} vs ${v.success.baseline}`, `- mean wall time ${v.time.specialistMeanS}s vs ${v.time.baselineMeanS}s (${v.time.diffS >= 0 ? '+' : ''}${v.time.diffS}s, ${v.time.pct}%, t=${v.time.t})`, `- builder calls ${v.calls.specialistMean} vs ${v.calls.baselineMean}; repairs ${v.repairs.specialistMean} vs ${v.repairs.baselineMean}`, `- mean context chars ${Math.round(mean(spec.map((r) => r.contextChars)))} vs ${Math.round(mean(base.map((r) => r.contextChars)))}; mean irrelevant files provided ${mean(spec.map((r) => r.irrelevantProvided.length)).toFixed(1)} vs ${mean(base.map((r) => r.irrelevantProvided.length)).toFixed(1)}; wrong-file edits ${spec.reduce((a, r) => a + r.wrongFileEdits.length, 0)} vs ${base.reduce((a, r) => a + r.wrongFileEdits.length, 0)}`, `- reasons: ${v.reasons.join('; ')}`, '')
  for (const fx of [...new Set(rows.map((r) => r.fixture))]) {
    const b = base.filter((r) => r.fixture === fx), s = spec.filter((r) => r.fixture === fx)
    if (b.length && s.length) md.push(`  - ${fx}: ${mean(s.map((r) => r.wallS)).toFixed(0)}s vs ${mean(b.map((r) => r.wallS)).toFixed(0)}s over ${s.length} vs ${b.length} mission(s); success ${s.filter((r) => r.ok).length}/${s.length} vs ${b.filter((r) => r.ok).length}/${b.length}`)
  }
  md.push('')
}
const flag = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d }
const role = flag('role', 'CODE_RETRIEVAL') as import('./roles').ModelRole, model = flag('model', 'qwen3-embedding:0.6b'), why = flag('why', 'hybrid retrieval before the builder')
if (process.argv.includes('--record')) {
  const store = new ForgeStore(); let n = 0
  for (const r of rows.filter((x) => x.config !== 'BASELINE')) for (const u of specialistUses(r, base.filter((b) => b.fixture === r.fixture), role, model, `${why} (${r.config})`)) { store.recordSpecialistUse(u); n++ }
  md.push(`Recorded ${n} SpecialistUse record(s) in the Forge store.`)
}
writeFileSync(out, md.join('\n') + '\n'); writeFileSync(out.replace(/\.md$/, '.json'), JSON.stringify({ rows, verdicts }, null, 1))
console.log(md.join('\n'))
