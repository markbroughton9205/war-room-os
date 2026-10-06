export type RecoveryDecision = {
  continue_mission: boolean
  alternate?: string
  commander_text: string
}

export function recoverFromToolFailure(input: {
  tool_name: string
  ok: boolean
  remaining_ok: number
}): RecoveryDecision {
  if (input.ok) {
    return { continue_mission: true, commander_text: '' }
  }
  if (/broker\.fetch|wr\.broker/i.test(input.tool_name)) {
    if (input.remaining_ok > 0) {
      return {
        continue_mission: true,
        alternate: 'wr.broker.status',
        commander_text: 'I could not complete the live page fetch, so I am using the remaining evidence rather than collapsing the whole turn.',
      }
    }
    return {
      continue_mission: true,
      alternate: 'wr.broker.status',
      commander_text: 'I couldn\'t verify the current value because the browser probe failed.',
    }
  }
  if (input.remaining_ok > 0) {
    return {
      continue_mission: true,
      commander_text: 'One specialist probe failed. I am continuing with the evidence that did return.',
    }
  }
  return {
    continue_mission: true,
    commander_text: 'I could not verify that. The probe failed, and I will not invent a current value.',
  }
}

export function naturalFailureProse(internal: string): string {
  return internal
    .replace(/\bTOOL_BLOCKED\b/g, 'the probe was blocked')
    .replace(/\bCURRENT_LIVE\b/g, 'live')
    .replace(/\be-\d[\w-]*/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function publicFailureHasInternalCodes(text: string): boolean {
  return /\b(TOOL_BLOCKED|CURRENT_LIVE|e-\d)\b/.test(text)
}
