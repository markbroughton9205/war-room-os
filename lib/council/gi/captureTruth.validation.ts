import { canShowListening, isForbiddenCaptureLabel, normalizeCaptureTruth } from './captureTruth'
import { commanderTurnFromText } from './multimodalEnvelope'

export function runCaptureTruthValidation(): Array<{ caseId: string; description: string; result: 'PASS' | 'FAIL'; details: string }> {
  const cases: Array<{ caseId: string; description: string; result: 'PASS' | 'FAIL'; details: string }> = []
  const check = (caseId: string, description: string, ok: boolean, details: unknown = '') => {
    cases.push({ caseId, description, result: ok ? 'PASS' : 'FAIL', details: typeof details === 'string' ? details : JSON.stringify(details) })
  }

  check('CT-forbidden', 'LISTENING is not a capture_truth value', isForbiddenCaptureLabel('LISTENING') && isForbiddenCaptureLabel('SEEING') && isForbiddenCaptureLabel('WATCHING'), 'ok')
  check('CT-normalize', 'permission_denied alias maps honestly', normalizeCaptureTruth('permission_denied') === 'PERMISSION_DENIED', normalizeCaptureTruth('permission_denied'))

  const denied = commanderTurnFromText({ text: 'hello', capture_truth: 'PERMISSION_DENIED' })
  denied.voice = { capture_truth: 'PERMISSION_DENIED' }
  check('WR-GA-7a', 'permission_denied cannot show LISTENING', canShowListening(denied) === false, canShowListening(denied))

  const capturingNoSession = { capture_truth: 'CAPTURING' as const, voice_session_id: '' }
  check('PATH-9a', 'CAPTURING without session id is not LISTENING', canShowListening(capturingNoSession) === false, capturingNoSession)

  const live = { capture_truth: 'CAPTURING' as const, voice_session_id: 'voice_1' }
  check('PATH-9b', 'LISTENING chrome only when capturing with session', canShowListening(live) === true, live)

  const idle = commanderTurnFromText({ text: 'hi', capture_truth: 'NOT_REQUESTED' })
  check('PATH-9c', 'idle mic is NOT_REQUESTED not LISTENING', idle.capture_truth === 'NOT_REQUESTED' && !canShowListening(idle), idle.capture_truth)

  return cases
}
