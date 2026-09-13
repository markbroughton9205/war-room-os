import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

console.error(JSON.stringify({
  ok: false,
  error: 'TRAINING_AUTHORIZATION=OFF',
  reason: '12-run controlled-stability grid is SUPERSEDED. Phase 0 only. Optimizer steps forbidden.',
  CLEAR_TO_RUN: false,
  optimizer_steps: 0,
}, null, 2))

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const redirected = spawnSync(
  process.execPath,
  [
    '--loader',
    './scripts/ts-extension-loader.mjs',
    '--experimental-transform-types',
    path.join(repoRoot, 'scripts', 'run-wrim-phase0-stability.mjs'),
  ],
  { stdio: 'inherit', windowsHide: true, cwd: repoRoot },
)
process.exit(redirected.status ?? 3)
