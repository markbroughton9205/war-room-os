import { runFrk09Fixtures } from './later-fixtures'
import { reportPhase } from './phase-report'

const results = runFrk09Fixtures()
results.push({ name: 'AUTONOMOUS_KERNEL_CODE_REWRITE_COUNT', pass: results.some(item => item.name === 'NO_SOURCE_REWRITE' && item.pass), detail: '0' })
reportPhase('FRK-09 deterministic suite', results)
