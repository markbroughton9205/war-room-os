import { architectFixtures } from './architect'
import { debuggerFixtures } from './debugger'
import { fastRepairFixtures } from './fastRepair'
import { researchFixtures } from './research'
import { securityFixtures } from './security'
import type { ModelRole } from '../roles'
import type { Fixture } from './types'

/** Generative role suites. CODE_RETRIEVAL and RERANKER are scored by retrieval.ts (they are not chat-completion tasks). */
export async function suiteFor(role: ModelRole): Promise<Fixture[]> {
  switch (role) {
    case 'FAST_REPAIR_WORKER': return fastRepairFixtures()
    case 'DEBUGGER_TEST_SPECIALIST': return debuggerFixtures()
    case 'ARCHITECT_REVIEWER': return architectFixtures()
    case 'RESEARCH_GENERALIST': return researchFixtures()
    case 'SECURITY_REVIEWER': return securityFixtures()
    default: return []
  }
}
export type { Fixture, CheckResult } from './types'
