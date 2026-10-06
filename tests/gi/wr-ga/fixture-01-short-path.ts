import { classifyCouncilPath } from '@/lib/council/gi/pathClassifier'
import { commanderTurnFromText } from '@/lib/council/gi/multimodalEnvelope'
import { runShortPathRuntime } from '@/lib/council/gi/shortPathRuntime'
import { toCommanderFacing } from '@/lib/council/gi/responseLayer'

export const WR_GA_01_GOLD = {
  prompt: 'Hi Council',
  path: 'SHORT_PATH',
  seats_used: [] as string[],
}

export async function runWrGa01() {
  const classified = classifyCouncilPath(WR_GA_01_GOLD.prompt)
  const output = await runShortPathRuntime({
    envelope: commanderTurnFromText({ text: WR_GA_01_GOLD.prompt, room_id: 'room-1', session_id: 'sess-1' }),
    path: 'SHORT_PATH',
    allow_tools: false,
    tool_allowlist: [],
    model_route: { lane: 'classify_or_short', placement: 'NONE' },
  })
  const facing = toCommanderFacing(output)
  return {
    classified,
    output,
    facing,
    pass:
      classified.path === 'SHORT_PATH'
      && output.seats_used.length === 0
      && facing.inspector?.seats_used.length === 0
      && !/READY/.test(facing.text)
      && output.completion_state !== 'VERIFIED',
  }
}
