import { runFrk11Fixtures } from './later-fixtures'
import { reportPhase } from './phase-report'

reportPhase('FRK-11 deterministic suite', runFrk11Fixtures())
