import { commanderTurnFromText } from '@/lib/council/gi/multimodalEnvelope'
import { canShowListening } from '@/lib/council/gi/captureTruth'

export function runWrGa07() {
  const envelope = commanderTurnFromText({
    text: 'are you listening?',
    capture_truth: 'PERMISSION_DENIED',
    room_id: 'room-1',
    session_id: 'sess-1',
  })
  envelope.voice = { capture_truth: 'PERMISSION_DENIED' }
  return {
    envelope,
    canShowListening: canShowListening(envelope),
    pass: canShowListening(envelope) === false && envelope.capture_truth === 'PERMISSION_DENIED',
  }
}
