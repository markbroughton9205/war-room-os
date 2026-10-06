import { commanderTurnFromText } from './multimodalEnvelope'
import { runShortPathRuntime, shouldEscalateFromShortPath } from './shortPathRuntime'
import { evaluateAuthority, capabilityDoesNotImplyAuthority } from './authorityMatrix'
import { toCommanderFacing, publicBodyHasInternalIds } from './responseLayer'

export async function runShortPathRuntimeValidation(): Promise<Array<{ caseId: string; description: string; result: 'PASS' | 'FAIL'; details: string }>> {
  const cases: Array<{ caseId: string; description: string; result: 'PASS' | 'FAIL'; details: string }> = []
  const check = (caseId: string, description: string, ok: boolean, details: unknown = '') => {
    cases.push({ caseId, description, result: ok ? 'PASS' : 'FAIL', details: typeof details === 'string' ? details : JSON.stringify(details) })
  }

  const hiEnv = commanderTurnFromText({ text: 'hi', room_id: 'room-1', session_id: 'sess-1' })
  const hi = await runShortPathRuntime({
    envelope: hiEnv,
    path: 'SHORT_PATH',
    allow_tools: false,
    tool_allowlist: [],
    model_route: { lane: 'classify_or_short', placement: 'NONE' },
  })
  check('PATH-1-runtime', 'hi seats_used=[]', hi.seats_used.length === 0 && hi.path_used === 'SHORT_PATH', hi.seats_used)
  check('PATH-7', 'casual conversation does not spawn six agents', hi.seats_used.length === 0, hi.seats_used)
  check('OE-01', 'SHORT never lists seats as debate panel', hi.seats_used.length === 0 && toCommanderFacing(hi).inspector?.seats_used.length === 0, hi.seats_used)
  check('no-ready', 'SHORT completion is not fake READY', hi.completion_state !== 'VERIFIED' || !/READY/.test(hi.body.summary), hi.completion_state)

  const send = evaluateAuthority({ tool_id: 'email.send', path: 'SHORT_PATH', capability_available: true })
  check('PATH-8', 'SHORT_PATH cannot perform high-authority email.send', send.executed === false && send.decision !== 'auto' && capabilityDoesNotImplyAuthority(send), send)

  const push = evaluateAuthority({ tool_id: 'council.git.push', path: 'SHORT_PATH', capability_available: true })
  check('AUTH-git', 'capability + git.push deny ≠ execution', push.executed === false && push.decision === 'deny', push)

  const researchText = 'Research current Nvidia Blackwell architecture with sources'
  const escalate = shouldEscalateFromShortPath(researchText)
  const forced = commanderTurnFromText({ text: researchText, session_id: 'sess-1', room_id: 'room-1' })
  const escalated = await runShortPathRuntime({
    envelope: forced,
    path: 'SHORT_PATH',
    allow_tools: false,
    tool_allowlist: [],
    model_route: { lane: 'classify_or_short', placement: 'NONE' },
  })
  check('PATH-12', 'SHORT_PATH escalation to AGENT_PATH is explicit', escalate.escalate && escalated.escalation?.observed === true && escalated.escalation.to === 'AGENT_PATH' && escalated.completion_state === 'ESCALATED', escalated.escalation)

  const facing = toCommanderFacing(hi)
  check('response-layer', 'public body has no claim/tool/evidence ids', !publicBodyHasInternalIds(facing.text), facing.text)

  return cases
}
