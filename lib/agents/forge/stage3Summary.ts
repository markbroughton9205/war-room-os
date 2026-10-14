/**
 * Builds the Stage 3 benchmark matrix from the qualification reports + the Forge store: per model, the labelled measurements, the success rate per role
 * (with the per-class rates), the roles earned, and the residency recommendation. Read-only.
 *   WAR_ROOM_AGENT_FOUNDRY_DIR=<store> node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/agents/forge/stage3Summary.ts <evidence dir> <out.json> <out.md>
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { MODEL_ROLES, ROLE_GATES, type ModelRole } from './roles'
import { classRates, qualification } from './rank'
import { recommendResidency } from './resourceProfile'
import { ForgeStore } from './store'
import { probeLocalNode } from './localNode'
import { assignPool } from './pool'
import { FIRST_POOL } from './registry'
import { routingTable } from './roleRouting'

const [dir, outJson, outMd] = process.argv.slice(2)
if (!dir || !outJson || !outMd) { console.error('usage: stage3Summary.ts <evidence dir> <out.json> <out.md>'); process.exit(2) }
const store = new ForgeStore(); const bench = store.benchmarks()
type Rep = Record<string, { value: unknown } | undefined> & { MODEL_ID: { value: string } }
const reports: Rep[] = []
type RerankRep = { MODEL_ID: string; PATH: string; PROVENANCE: string; embeddingOrder: { all: { mrr: number; recall1: number; recall3: number } }; rerankedOrder: { all: { mrr: number; recall1: number; recall3: number } }; candidatesWithoutYesNoInTop20Logprobs: number; preRegisteredRulePassed: boolean; QUALIFIED_ROLES: string[] }
const rerankers: RerankRep[] = []
for (const d of readdirSync(dir)) { if (d === 'superseded') continue; const f = path.join(dir, d, 'report.json'); if (existsSync(f)) { try { const j = JSON.parse(readFileSync(f, 'utf8')); if (typeof j.MODEL_ID === 'string') rerankers.push(j as RerankRep); else reports.push(j as Rep) } catch { /* skip */ } } }
const v = (r: Rep, k: string) => r[k]?.value
const BUILDER = 'AliBilge/Huihui-Devstral-Small-2-24B-Instruct-2512-abliterated:q4_k_m'
const builderRep = reports.find((r) => r.MODEL_ID.value === BUILDER)
const builderVram = (builderRep && typeof v(builderRep, 'GPU_OFFLOAD_MiB') === 'number' ? v(builderRep, 'GPU_OFFLOAD_MiB') : 12329) as number
const rows = reports.map((r) => {
  const ref = r.MODEL_ID.value
  const roles: Record<string, unknown> = {}
  for (const role of MODEL_ROLES) {
    const q = qualification(ref, role, bench); if (!q.evidence.n) continue
    roles[role] = { ok: q.evidence.ok, n: q.evidence.n, rate: Math.round(q.evidence.rate * 1000) / 1000, classes: classRates(ref, role, bench), qualified: q.qualified, problems: q.problems }
  }
  const residency = recommendResidency({ isBuilder: ref === BUILDER, vramMiB: v(r, 'GPU_OFFLOAD_MiB') as number | 'UNKNOWN', cpuOffloadMiB: v(r, 'CPU_OFFLOAD_MiB') as number | 'UNKNOWN', loadMs: v(r, 'LOAD_TIME_MS') as number | 'UNKNOWN' }, { builderVramMiB: builderVram, gpuTotalMiB: 16311, desktopIdleMiB: 2339 })
  const get = (k: string) => (v(r, k) ?? 'UNKNOWN')
  return { model: ref, params: get('PARAMETER_COUNT'), quant: get('QUANTIZATION'), diskMiB: get('DISK_SIZE_MiB'), vramIdleMiB: get('VRAM_IDLE_MiB'), vramActivePeakMiB: get('VRAM_ACTIVE_PEAK_MiB'), gpuMiB: get('GPU_OFFLOAD_MiB'), cpuMiB: get('CPU_OFFLOAD_MiB'), ramIdleMiB: get('SYSTEM_RAM_IDLE_MiB'), ramActivePeakMiB: get('SYSTEM_RAM_ACTIVE_PEAK_MiB'), minAvailRamMiB: get('MIN_AVAILABLE_RAM_MiB'), swapDeltaMiB: get('SWAP_DELTA_PEAK_MiB'), loadMs: get('LOAD_TIME_MS'), firstTokenMs: get('FIRST_TOKEN_LATENCY_MS'), tps: get('TOKENS_PER_SECOND'), residencyClass: get('RESIDENCY_CLASS'), roles, earned: Object.entries(roles).filter(([, x]) => (x as { qualified: boolean }).qualified).map(([k]) => k), residency }
})
writeFileSync(outJson, JSON.stringify(rows, null, 1))
const pct = (x: unknown) => { const o = x as { ok: number; n: number; qualified: boolean } | undefined; return o ? `${o.ok}/${o.n}${o.qualified ? ' ✔' : ''}` : '–' }
const md = [
  '| Model | Params / quant | Disk MiB | VRAM GPU / CPU MiB | Load ms | tok/s | Residency | ' + MODEL_ROLES.map((r) => r.replace(/_/g, ' ').toLowerCase()).join(' | ') + ' | Recommendation |',
  '|' + Array(8 + MODEL_ROLES.length).fill('---').join('|') + '|',
  ...rows.map((r) => `| ${r.model} | ${r.params} / ${r.quant} | ${r.diskMiB} | ${r.gpuMiB} / ${r.cpuMiB} | ${r.loadMs} | ${r.tps} | ${r.residencyClass} | ${MODEL_ROLES.map((m) => pct(r.roles[m])).join(' | ')} | ${r.residency.recommendation} (${r.residency.keepAlive}) |`),
  '', `Gates: ${MODEL_ROLES.map((r) => `${r} ≥${Math.round(ROLE_GATES[r].minRate * 100)}% over ≥${ROLE_GATES[r].minRuns} runs`).join('; ')}. ✔ = qualified (overall gate and class gates).`,
].join('\n')
const rr = ['', '### Reranker experiments (pre-registered rule: reranked MRR > embedding MRR and reranked recall@3 >= embedding recall@3)', '', '| Reranking model | Embedding MRR / r@1 / r@3 | Reranked MRR / r@1 / r@3 | Candidates with no yes/no logits | Rule | Qualified |', '|---|---|---|---|---|---|',
  ...rerankers.map((x) => `| ${x.MODEL_ID} | ${x.embeddingOrder.all.mrr.toFixed(3)} / ${x.embeddingOrder.all.recall1.toFixed(3)} / ${x.embeddingOrder.all.recall3.toFixed(3)} | ${x.rerankedOrder.all.mrr.toFixed(3)} / ${x.rerankedOrder.all.recall1.toFixed(3)} / ${x.rerankedOrder.all.recall3.toFixed(3)} | ${x.candidatesWithoutYesNoInTop20Logprobs} | ${x.preRegisteredRulePassed ? 'passed' : 'not passed'} | ${x.QUALIFIED_ROLES.join(', ') || 'none'} |`)].join('\n')
const probe = await probeLocalNode()
const models = store.models().length ? store.models() : FIRST_POOL
const route = routingTable({ nodes: [probe.record], models, benchmarks: bench, profiles: store.resourceProfiles(), now: new Date(), allowProvisional: true, designatedBuilder: assignPool(models, bench).members[0].modelRef ?? undefined })
const rt = ['', '### Foundry routing table (what each kind of work goes to, from recorded evidence)', '', '| Task intent | Role | Routed to | How |', '|---|---|---|---|', ...route.map((x) => `| ${x.intent} | ${x.role} | ${x.modelRef ?? (x.via === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'deterministic method')} | ${x.via.toLowerCase().replace(/_/g, ' ')}: ${x.reason.replace(/\|/g, '/').slice(0, 170)} |`)].join('\n')
writeFileSync(outMd, md + '\n' + rr + '\n' + rt + '\n')
writeFileSync(outJson.replace(/\.json$/, '-routing.json'), JSON.stringify(route.map((x) => ({ intent: x.intent, role: x.role, via: x.via, model: x.modelRef, reason: x.reason })), null, 1))
console.log(md + '\n' + rr + '\n' + rt)
