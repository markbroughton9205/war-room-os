import { runFrk10Fixtures } from './later-fixtures'
import { reportPhase } from './phase-report'

reportPhase('FRK-10 deterministic suite', runFrk10Fixtures())
