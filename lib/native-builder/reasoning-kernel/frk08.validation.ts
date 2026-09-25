import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runFrk08Fixtures } from './later-fixtures'
import { reportPhase } from './phase-report'

const root = mkdtempSync(path.join(tmpdir(), 'frk08-'))
try {
  reportPhase('FRK-08 deterministic suite', await runFrk08Fixtures(root))
} finally {
  rmSync(root, { recursive: true, force: true })
}
