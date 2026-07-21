import { spawnSync } from 'node:child_process'

if (process.env.WAR_ROOM_INCREMENTAL_TRANSPORT_VALIDATION_LOADED !== '1') {
  const child = spawnSync(process.execPath, [
    '--loader',
    './scripts/ts-extension-loader.mjs',
    '--experimental-transform-types',
    'scripts/run-incremental-council-transport-validation.mjs',
  ], {
    cwd: process.cwd(),
    env: { ...process.env, WAR_ROOM_INCREMENTAL_TRANSPORT_VALIDATION_LOADED: '1' },
    stdio: 'inherit',
  })
  process.exit(child.status ?? 1)
}

const { runIncrementalCouncilTransportValidation } = await import('../lib/council/incremental-transport/validation.ts')

const results = await runIncrementalCouncilTransportValidation()
const failed = results.filter(result => result.result === 'FAIL')
const passed = results.length - failed.length

console.log(`Incremental Council transport validation: ${passed}/${results.length} PASS`)

if (failed.length) {
  for (const item of failed) {
    console.error(`${item.caseId}: ${item.details.join('; ')}`)
  }
  process.exit(1)
}
