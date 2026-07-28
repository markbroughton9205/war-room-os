import { spawnSync } from 'node:child_process'

if (process.env.WAR_ROOM_LIVE_PERSONA_CLUSTER_VALIDATION_LOADED !== '1') {
  const child = spawnSync(process.execPath, [
    '--loader',
    './scripts/ts-extension-loader.mjs',
    '--experimental-transform-types',
    'scripts/run-live-council-persona-cluster-validation.mjs',
  ], {
    cwd: process.cwd(),
    env: { ...process.env, WAR_ROOM_LIVE_PERSONA_CLUSTER_VALIDATION_LOADED: '1' },
    stdio: 'inherit',
  })
  process.exit(child.status ?? 1)
}

const { runLivePersonaClusterValidation } = await import('../lib/council/livePersonaCluster.validation.ts')

const results = await runLivePersonaClusterValidation()
const failed = results.filter(result => result.result === 'FAIL')
const passed = results.length - failed.length

console.log(`Live Council persona-cluster validation: ${passed}/${results.length} PASS`)

if (failed.length) {
  for (const item of failed) {
    console.error(`${item.caseId}: ${item.details.join('; ')}`)
  }
  process.exit(1)
}
