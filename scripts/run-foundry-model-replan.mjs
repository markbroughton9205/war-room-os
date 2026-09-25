import { spawnSync } from 'node:child_process'

const result = spawnSync(process.execPath, ['--test', 'scripts/foundry/model-replan/app.test.mjs'], { stdio: 'inherit' })
process.exit(result.status ?? 1)
