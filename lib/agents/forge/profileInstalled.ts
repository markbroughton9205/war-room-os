/**
 * Operator CLI: profile every model ALREADY installed on the local node (no downloads), one at a time, unloading each afterwards.
 * Loads real models, so run it only when no mission is running.
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/agents/forge/profileInstalled.ts [--only <ref>] [--ctx 8192]
 * Writes MODEL_RESOURCE_PROFILE records to the Foundry store (WAR_ROOM_AGENT_FOUNDRY_DIR).
 */
import { buildModelResourceProfile } from './resourceProfile'
import { probeLocalNode } from './localNode'
import { measureProfile } from './profile'
import { ForgeStore } from './store'

const args = process.argv.slice(2)
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : undefined
const ctx = args.includes('--ctx') ? Number(args[args.indexOf('--ctx') + 1]) : 8192
const store = new ForgeStore()
const probe = await probeLocalNode()
if (!probe.reachable) { console.error('local runtime unreachable'); process.exit(2) }
if (probe.record.resident.length) { console.error(`refusing: models are resident (${probe.record.resident.map((r) => r.ref).join(', ')}); unload them or wait for the mission to finish`); process.exit(3) }
store.recordNode(probe.record)
const benchmarks = store.benchmarks()
const models = store.models()
for (const m of probe.record.installedModels.filter((x) => !only || x.ref === only)) {
  console.log(`profiling ${m.ref} ...`)
  try {
    const p = await measureProfile(m.ref, ctx)
    const prof = buildModelResourceProfile({ profile: p, nodeId: probe.record.nodeId, model: models.find((x) => x.ref === m.ref), quantization: probe.quantizations[m.ref], residency: 'COLD', benchmarks })
    store.recordResourceProfile({ ...prof, digest: m.digest })
    console.log(JSON.stringify({ ref: m.ref, residency: prof.residencyClass, vramMiB: prof.vramRequiredMiB, ramMiB: prof.ramRequiredMiB, loadMs: prof.loadMs, tps: prof.latency.tokensPerSecond, ttftMs: prof.latency.firstTokenMs }))
  } catch (e) { console.error(`  FAILED: ${e instanceof Error ? e.message : e}`) }
  await fetch(`${probe.record.endpoint}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: m.ref, keep_alive: 0 }) }).catch(() => undefined)
}
store.recordNode((await probeLocalNode()).record)
console.log('done')
