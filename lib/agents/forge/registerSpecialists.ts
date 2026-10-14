/**
 * Operator CLI: register the specialist candidates that are installed on the local node and (re)apply evidence-based promotion.
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/agents/forge/registerSpecialists.ts
 * Append-only: a later record for the same ref supersedes the earlier one. Reads /api/tags only; nothing is downloaded or loaded.
 */
import { probeLocalNode } from './localNode'
import { FIRST_POOL } from './registry'
import { SPECIALIST_CANDIDATES, promoteFromEvidence } from './specialists'
import { ForgeStore } from './store'

const store = new ForgeStore()
const probe = await probeLocalNode()
if (!probe.reachable) { console.error('local runtime unreachable'); process.exit(2) }
const have = new Set(store.models().map((m) => m.ref))
for (const m of FIRST_POOL) if (!have.has(m.ref)) { store.registerModel(m); console.log(`registered declared pool model ${m.ref}`) }
const bench = store.benchmarks()
for (const c of SPECIALIST_CANDIDATES) {
  const inst = probe.record.installedModels.find((m) => m.ref === c.ref)
  if (!inst) { console.log(`skip ${c.ref}: not installed`); continue }
  const p = promoteFromEvidence(c, bench, inst.digest, inst.sizeBytes)
  store.registerModel(p.entry)
  console.log(`${c.ref}: ${p.entry.status}${p.earned.length ? ' roles ' + p.earned.join(', ') : ''} | ${Object.entries(p.evidence).map(([r, e]) => `${r} ${e}`).join(' | ') || 'no benchmark evidence'}`)
}
