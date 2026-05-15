import type { ModeGovernor } from '@/lib/council/modeGovernor'
import type { RoomStatus } from '@/lib/council/roomStatus'
import { familyDisplayName } from '@/lib/council/directInvocation'
import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'

function formatRoomStatusLine(r: RoomStatus): string {
  return `${r.family}: ${r.status}`
}

function modeRulesBlock(governor: ModeGovernor): string[] {
  const lines: string[] = [
    'Providers should think deeply, but only within the boundaries of the current decree.',
    'Informative and strategic insight is welcome when it serves the decree. No autonomous topic changes.',
    `War Room mode: ${governor.mode}`,
    `Max sentences: ${governor.maxSentences}`,
    `Continuation allowed: ${governor.continuationAllowed ? 'yes' : 'no'}`,
    `Provider awareness: ${governor.providerAwareness ? 'yes' : 'no'}`,
    `Cross-family reference: ${governor.allowCrossFamilyReference ? 'allowed' : 'forbidden'}`,
    `Speculation: ${governor.allowSpeculation ? 'allowed with evidence only' : 'forbidden'}`,
    `Long-form: ${governor.allowLongForm ? 'authorized by decree' : 'forbidden'}`,
  ]

  if (governor.mode === 'recovery') {
    lines.push(
      'Recovery mode: one factual sentence. No adversary or infrastructure theories without evidence.',
      'Do not mention load balancing, competitor exploitation, or targeted disruption.',
    )
  }

  if (governor.mode === 'greeting') {
    lines.push(
      'Greeting: short and warm (~2 sentences). Natural helpful tone is fine.',
      'Do not steer mission, ask for today\'s objective, or drift into Panama/business unless the decree asks.',
    )
  }

  if (governor.mode === 'attendance') {
    lines.push(
      'Attendance: one sentence — presence plus an optional short clause (e.g. "Present and operational." / Red Team: "Monitoring.").',
      'No multi-paragraph roll call, diagnostics, or infrastructure narratives. No emojis.',
    )
  }

  if (governor.mode === 'council') {
    lines.push(
      'Council: informative structured analysis within decree scope is encouraged.',
      'When substantive, prefer: Primary finding — … / Recommended action — … / Risk — …',
      'Explain reasoning when useful; stay on the decree topic only.',
    )
  }

  if (governor.mode === 'direct_invocation') {
    lines.push(
      'Direct invocation: Ra\'el addressed YOU by provider name. Respond only as your family.',
      'Do not route to council analysis, roll call, or multi-family synthesis.',
      'Do not discuss other providers unless Ra\'el explicitly asked.',
      'If there is no substantive tail after your name, reply briefly: "Present. Awaiting directive."',
      'If there is a tail after your name, answer that tail only — stay in character.',
    )
  }

  if (governor.mode === 'deep_analysis') {
    lines.push(
      'Deep analysis: long-form allowed only because the decree authorized it. Stay on decree topic.',
    )
  }

  lines.push(
    'Never impersonate Ra\'el or another family. Answer only for your own family.',
    'Do not claim another provider responded or that queues succeeded unless shown in room status.',
    'Only cite provider/orchestrator facts from ROOM STATUS. No invented infrastructure root causes. Truthful uncertainty is preferred.',
  )

  return lines
}

export function buildDirectInvocationPromptTail(
  family: CouncilOrchestrationFamily,
  remainder: string,
): string {
  const label = familyDisplayName(family)
  const tail = remainder.trim()
  if (!tail) {
    return `DIRECT INVOCATION: User invoked ${label} only. Reply: "Present. Awaiting directive." (one short sentence; no council routing).`
  }
  return [
    `DIRECT INVOCATION: User invoked ${label} directly.`,
    `Answer only this tail (do not reinterpret as council analysis): ${tail}`,
  ].join('\n')
}

export function buildModeGovernorPromptBlock(
  governor: ModeGovernor,
  roomStatuses: RoomStatus[],
  directInvocationTail?: string,
): string {
  const statusLines = roomStatuses.length
    ? roomStatuses.map(formatRoomStatusLine).join('\n')
    : '(no provider runtime snapshot)'

  const blocks = [
    'MODE GOVERNOR (decree-first — overrides casual verbosity):',
    ...modeRulesBlock(governor),
    '',
    'Room status (orchestrator view — do not invent presence):',
    statusLines,
  ]
  if (directInvocationTail?.trim()) {
    blocks.push('', directInvocationTail.trim())
  }
  return blocks.join('\n')
}
