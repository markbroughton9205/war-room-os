import { spawnSync } from 'node:child_process'

const result = spawnSync(process.execPath, [
  '--loader',
  './scripts/ts-extension-loader.mjs',
  '--experimental-transform-types',
  'lib/council/attendanceRelease.validation.ts',
], {
  cwd: process.cwd(),
  stdio: 'inherit',
  shell: false,
})

if (result.error) {
  console.error(result.error)
  process.exit(1)
}

process.exit(result.status ?? 1)
