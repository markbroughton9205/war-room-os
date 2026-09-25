import { readFileSync } from 'node:fs'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { runFrk07Fixtures } from './later-fixtures'
import { reportPhase } from './phase-report'

const source = readFileSync(path.join(resolveRepoRoot(), 'lib/native-builder/reasoning-kernel/wrim-worker.ts'), 'utf8')
const hits = (source.match(/from\s+['"][^'"]*wrim/gi) ?? []).length
const results = runFrk07Fixtures()
results.push({ name: 'FRK_WRIM_INTERNAL_DEPENDENCY_COUNT', pass: hits === 0, detail: String(hits) })
reportPhase('FRK-07 deterministic suite', results)
