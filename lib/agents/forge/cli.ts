/** Operator CLI: node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/agents/forge/cli.ts <register-pool|profile|smoke|route|scorecard [sinceIso]|status> [model] */
import { ForgeStore } from './store'
import { FIRST_POOL } from './registry'
import { measureProfile } from './profile'
import { runSmoke } from './smoke'
import { routeFor } from './routing'
import type { TaskClass } from './types'
import { buildScorecard, renderScorecard } from './scorecard'

const [cmd, arg] = process.argv.slice(2)
const store = new ForgeStore()
if (cmd === 'register-pool') { for (const m of FIRST_POOL) store.registerModel(m); console.log(`registered ${FIRST_POOL.length} models`) }
else if (cmd === 'profile' && arg) { const p = await measureProfile(arg); store.recordProfile(p); console.log(JSON.stringify(p, null, 1)) }
else if (cmd === 'smoke' && arg) { const s = await runSmoke(arg); store.recordSmoke(s); console.log(JSON.stringify(s, null, 1)); process.exitCode = s.passed ? 0 : 1 }
else if (cmd === 'route') { for (const c of ['complete_feature', 'multi_file_implementation', 'debugging', 'review', 'light_implementation', 'structured_output'] as TaskClass[]) console.log(JSON.stringify(routeFor(c, store.models(), store.benchmarks()))) }
else if (cmd === 'scorecard') console.log(renderScorecard(buildScorecard(store.benchmarks(), { sinceIso: arg })))
else if (cmd === 'status') console.log(JSON.stringify({ models: store.models().map((m) => ({ ref: m.ref, status: m.status, eligible: m.routing.eligible })), profiles: store.profiles().length, smokes: store.smokes().map((s) => ({ ref: s.modelRef, passed: s.passed })), benchmarks: store.benchmarks().map((b) => ({ ref: b.modelRef, score: b.verifierScore, completion: b.completion })) }, null, 1))
else console.log('usage: cli.ts <register-pool|profile <model>|smoke <model>|route|status>')
