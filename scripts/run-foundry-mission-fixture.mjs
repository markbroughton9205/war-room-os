import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const testFile = path.join(here, 'foundry/mission-fixture/server.test.mjs')
const result = spawnSync(process.execPath, ['--test', testFile], { stdio: 'inherit' })
process.exit(result.status ?? 1)
