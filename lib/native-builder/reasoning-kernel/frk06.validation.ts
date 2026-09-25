import { runFrk06Fixtures } from './later-fixtures'
import { reportPhase } from './phase-report'

reportPhase('FRK-06 deterministic suite', runFrk06Fixtures())
