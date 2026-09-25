/**
 * PASS 003 Step 13 concurrency fixture — a real, separate OS process that acquires the shared
 * build/package lock, holds it briefly (simulating build work), and appends a start/end interval
 * to a shared evidence file. Two of these are launched simultaneously by
 * buildLock.validation.ts to prove real filesystem-level mutual exclusion across processes, not
 * just within one event loop.
 */
// Invoked with `node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types
// scripts/foundry/build-lock-contender.mjs` (see buildLock.validation.ts) so the .ts import below
// resolves the same way every other Foundry validation entrypoint already does.
import { acquireBuildLock } from '../../lib/native-builder/buildLock.ts'
import { appendFile } from 'node:fs/promises'

const [, , missionId, evidencePath, holdMs] = process.argv
const acquired = await acquireBuildLock({ missionId, operation: 'concurrency-test', waitMs: 8000 })
if (acquired.state !== 'ACQUIRED') {
  console.log(JSON.stringify({ missionId, state: acquired.state }))
  process.exit(1)
}
const start = Date.now()
await new Promise(resolve => setTimeout(resolve, Number(holdMs)))
const end = Date.now()
await appendFile(evidencePath, `${JSON.stringify({ missionId, start, end })}\n`)
await acquired.release()
console.log(JSON.stringify({ missionId, state: 'ACQUIRED', start, end }))
