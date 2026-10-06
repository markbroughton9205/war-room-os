import { parseCommanderTurn } from './multimodalEnvelope'
import { assertImageOnlyTurn } from './multimodalEnvelope.assert'
import { COMMANDER_TURN_SCHEMA } from './types'
import { classifyCouncilPath } from './pathClassifier'
import { isGiEng01ShortPathEnabled } from './featureFlag'
import { maybeHandleGiFrontDoor, giAgentPathPreservesEbc } from './frontDoor'
import { routeAgentPath, agentPathUsesExistingEbc } from './agentPath'
import { evaluateAuthority, capabilityDoesNotImplyAuthority } from './authorityMatrix'
import { createEngineeringHandoff } from './handoff'
import { runCaptureTruthValidation } from './captureTruth.validation'
import { runPathClassifierValidation } from './pathClassifier.validation'
import { runShortPathRuntimeValidation } from './shortPathRuntime.validation'
import { fullTeamRequiredForGiPath, shouldRenderFullCouncilPanel } from './renderPolicy'
import { canShowListening } from './captureTruth'
import { commanderTurnFromText } from './multimodalEnvelope'

type Case = { caseId: string; description: string; result: 'PASS' | 'FAIL'; details: string }

function check(caseId: string, description: string, ok: boolean, details: unknown = ''): Case {
  return { caseId, description, result: ok ? 'PASS' : 'FAIL', details: typeof details === 'string' ? details : JSON.stringify(details) }
}

export async function runGiEng01Validation(): Promise<Case[]> {
  const cases: Case[] = []
  cases.push(...runCaptureTruthValidation())
  cases.push(...runPathClassifierValidation())
  cases.push(...await runShortPathRuntimeValidation())

  const image = assertImageOnlyTurn({
    schema_version: COMMANDER_TURN_SCHEMA,
    turn_id: 't-img',
    room_id: 'room-1',
    session_id: 'sess-1',
    parts: [{
      kind: 'image',
      content_type: 'image/png',
      asset_ref: { asset_id: 'a1', content_hash: 'ab'.repeat(16), storage: 'LOCAL', mime: 'image/png' },
    }],
    capture_truth: 'NOT_REQUESTED',
    context: {},
    created_at: new Date().toISOString(),
  })
  cases.push(check('CT-01', 'image-only turn validates with AssetRef hash', image.ok === true, image))

  const missingHash = parseCommanderTurn({
    schema_version: COMMANDER_TURN_SCHEMA,
    turn_id: 't-bad',
    room_id: 'room-1',
    session_id: 'sess-1',
    parts: [{ kind: 'image', content_type: 'image/png', asset_ref: { asset_id: 'a1', content_hash: '', storage: 'LOCAL', mime: 'image/png' } }],
    capture_truth: 'NOT_REQUESTED',
    context: {},
    created_at: new Date().toISOString(),
  })
  cases.push(check('CT-03', 'missing content_hash refuses ingest', missingHash.ok === false && missingHash.issues.some(row => row.code === 'CT-03'), missingHash))

  const listening = parseCommanderTurn({
    schema_version: COMMANDER_TURN_SCHEMA,
    turn_id: 't-listen',
    room_id: 'room-1',
    session_id: 'sess-1',
    text: 'hello',
    capture_truth: 'LISTENING',
    context: {},
    created_at: new Date().toISOString(),
  })
  cases.push(check('PATH-9', 'capture_truth rejects fake LISTENING', listening.ok === false, listening))

  const offEnv = {}
  cases.push(check('PATH-10', 'feature flag OFF preserves current behavior (front door idle)', isGiEng01ShortPathEnabled(offEnv) === false, offEnv))
  const idle = await maybeHandleGiFrontDoor({ text: 'hi', env: offEnv })
  cases.push(check('PATH-10b', 'flag OFF does not intercept hi', idle === null, idle))

  const onEnv = { GI_ENG_01_SHORT_PATH: '1' }
  cases.push(check('PATH-11', 'feature flag ON uses PathClassifier', isGiEng01ShortPathEnabled(onEnv) === true, onEnv))
  const intercepted = await maybeHandleGiFrontDoor({ text: 'hi', env: onEnv, sessionId: 'sess-1', roomId: 'room-1' })
  cases.push(check('PATH-11b', 'flag ON classifies hi as SHORT_PATH with no seats', intercepted?.giPath === 'SHORT_PATH' && intercepted.results.length === 0 && intercepted.giEnvelope.inspector?.seats_used.length === 0, intercepted))

  const statusRoute = routeAgentPath('Status on War Room')
  cases.push(check('WR-GA-2', 'Status on War Room routes to existing EBC, not six seats by default', statusRoute.path === 'AGENT_PATH' && agentPathUsesExistingEbc(statusRoute) && statusRoute.seats_default_six === false && statusRoute.mission_class === 'SYSTEM_STATUS', statusRoute))
  cases.push(check('PATH-4-ebc', 'AGENT_PATH preserves Evidence-Board Council', giAgentPathPreservesEbc('Status on War Room'), 'ok'))
  cases.push(check('GA-08', 'UNKNOWN ≠ READY: GI never emits a READY completion token', intercepted?.giEnvelope.completion_state !== 'VERIFIED' && String(intercepted?.giEnvelope.completion_state) !== 'READY', intercepted?.giEnvelope.completion_state))

  const email = evaluateAuthority({ tool_id: 'email.send', path: 'AGENT_PATH', capability_available: true })
  cases.push(check('WR-GA-8', 'email.send without grant is ask/deny and not executed', (email.decision === 'ask' || email.decision === 'deny') && email.executed === false && capabilityDoesNotImplyAuthority(email), email))
  cases.push(check('AUTH-03', 'capability available + authority denied ≠ execution', email.capability_available && email.executed === false, email))

  const handoff = createEngineeringHandoff({ text: 'Fix this War Room bug', room_id: 'room-1', session_id: 'sess-1' })
  cases.push(check('GA-02', 'code mutate is Foundry handoff stub, executed=false', handoff.target === 'FOUNDRY' && handoff.executed === false, handoff))
  const flaggedHandoff = await maybeHandleGiFrontDoor({ text: 'Fix this War Room bug', env: onEnv, roomId: 'room-1', sessionId: 'sess-1' })
  cases.push(check('PATH-6-door', 'flag ON handoff intercepts Foundry stub', Boolean(flaggedHandoff && flaggedHandoff.giPath === 'HANDOFF' && flaggedHandoff.giHandoff && flaggedHandoff.giHandoff.executed === false), flaggedHandoff))

  const typed = parseCommanderTurn({
    schema_version: COMMANDER_TURN_SCHEMA,
    turn_id: 't-ga1',
    room_id: 'room-1',
    session_id: 'sess-1',
    text: 'Hi Council',
    parts: [{ kind: 'text', content_type: 'text/plain', text: 'Hi Council' }],
    capture_truth: 'NOT_REQUESTED',
    context: {},
    created_at: new Date().toISOString(),
  })
  cases.push(check('GA-01', 'typed envelope round-trip', typed.ok === true && typed.ok && typed.envelope.schema_version === COMMANDER_TURN_SCHEMA, typed))
  const hiClass = classifyCouncilPath('Hi Council')
  cases.push(check('WR-GA-1', 'Hi Council is SHORT_PATH with empty seats', hiClass.path === 'SHORT_PATH' && hiClass.seats_recommended.length === 0, hiClass))

  const voice = commanderTurnFromText({ text: 'hello', capture_truth: 'PERMISSION_DENIED' })
  voice.voice = { capture_truth: 'PERMISSION_DENIED' }
  cases.push(check('WR-GA-7', 'voice permission_denied is not LISTENING', canShowListening(voice) === false && voice.capture_truth !== 'CAPTURING', voice.capture_truth))

  cases.push(check('full-team', 'SHORT_PATH does not require full team', fullTeamRequiredForGiPath('SHORT_PATH') === false && shouldRenderFullCouncilPanel('SHORT_PATH') === false, 'ok'))
  cases.push(check('no-mission-short', 'SHORT_PATH envelope may omit mission_id', typed.ok && typed.envelope.mission_id === undefined, typed.ok ? typed.envelope.mission_id : 'fail'))

  const agentStatus = await maybeHandleGiFrontDoor({ text: 'Status on War Room', env: onEnv })
  cases.push(check('agent-passthrough', 'AGENT_PATH does not intercept EBC', agentStatus === null, agentStatus))

  return cases
}

const isDirect = typeof process !== 'undefined' && Array.isArray(process.argv) && process.argv[1] && /gi\.validation\.ts$/.test(process.argv[1])
if (isDirect) {
  const results = await runGiEng01Validation()
  const failed = results.filter(row => row.result !== 'PASS')
  for (const row of results) {
    console.log(`${row.result} ${row.caseId}: ${row.description}`)
    if (row.result === 'FAIL') console.log(`  ${row.details}`)
  }
  console.log(`GI-ENG-01 validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exitCode = 1
}
