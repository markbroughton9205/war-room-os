import { classifyCouncilPath } from './pathClassifier'

export function runPathClassifierValidation(): Array<{ caseId: string; description: string; result: 'PASS' | 'FAIL'; details: string }> {
  const cases: Array<{ caseId: string; description: string; result: 'PASS' | 'FAIL'; details: string }> = []
  const check = (caseId: string, description: string, ok: boolean, details: unknown = '') => {
    cases.push({ caseId, description, result: ok ? 'PASS' : 'FAIL', details: typeof details === 'string' ? details : JSON.stringify(details) })
  }

  const hi = classifyCouncilPath('hi')
  check('PATH-1', '"hi" → SHORT_PATH seats_recommended=[]', hi.path === 'SHORT_PATH' && hi.seats_recommended.length === 0, hi)

  const photo = classifyCouncilPath('explain photosynthesis')
  check('PATH-2', '"explain photosynthesis" → SHORT_PATH', photo.path === 'SHORT_PATH', photo)

  const rewrite = classifyCouncilPath('rewrite this paragraph')
  check('PATH-3', '"rewrite this paragraph" → SHORT_PATH', rewrite.path === 'SHORT_PATH', rewrite)

  const status = classifyCouncilPath('Status on War Room')
  check('PATH-4', '"Status on War Room" → AGENT_PATH SYSTEM_STATUS', status.path === 'AGENT_PATH' && status.mission_class === 'SYSTEM_STATUS', status)

  const research = classifyCouncilPath('Research Playwright persistent profiles using current primary sources')
  check('PATH-5', 'Playwright primary-source research → AGENT_PATH', research.path === 'AGENT_PATH' && research.mission_class === 'DEEP_RESEARCH', research)

  const bug = classifyCouncilPath('Fix this War Room bug')
  check('PATH-6', '"Fix this War Room bug" → HANDOFF Foundry', bug.path === 'HANDOFF' && bug.handoff_target === 'FOUNDRY', bug)

  const ebc = classifyCouncilPath('What is EBC?')
  check('PATH-01-plan', '"What is EBC?" → SHORT_PATH', ebc.path === 'SHORT_PATH', ebc)

  const multiply = classifyCouncilPath('what is 45 × 72?')
  check('PATH-arith', 'arithmetic → SHORT_PATH', multiply.path === 'SHORT_PATH', multiply)

  check('no-llm', 'classifier is rules-first; llm_fallback_used=false', [hi, photo, status, research, bug].every(row => row.llm_fallback_used === false), 'ok')

  return cases
}
