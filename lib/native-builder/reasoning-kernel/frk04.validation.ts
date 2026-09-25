import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runFrk04Fixtures } from './later-fixtures'
import { reportPhase } from './phase-report'

const root = mkdtempSync(path.join(tmpdir(), 'frk04-'))
try {
  const results = await runFrk04Fixtures(root)
  reportPhase('FRK-04 deterministic suite', results)
} finally {
  rmSync(root, { recursive: true, force: true })
}
