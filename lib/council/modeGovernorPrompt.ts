import type { ModeGovernor } from '@/lib/council/modeGovernor'
import type { RoomStatus } from '@/lib/council/roomStatus'

function formatRoomStatusLine(r: RoomStatus): string {
  return `${r.family}: ${r.status}`
}

function modeRulesBlock(governor: ModeGovernor): string[] {
  const lines: string[] = [
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

  if (governor.mode === 'attendance') {
    lines.push(
      'Attendance: one short presence line only (e.g. "Present." / "Present and operational." / Red Team: "Monitoring.").',
      'No strategy, no multi-paragraph roll call, no emojis.',
    )
  }

  if (governor.mode === 'council') {
    lines.push(
      'When substantive, prefer: Primary finding — … / Recommended action — … / Risk — …',
    )
  }

  lines.push(
    'Never impersonate Ra\'el or another family. Answer only for your own family.',
    'Do not claim another provider responded or that queues succeeded unless shown in room status.',
  )

  return lines
}

export function buildModeGovernorPromptBlock(
  governor: ModeGovernor,
  roomStatuses: RoomStatus[],
): string {
  const statusLines = roomStatuses.length
    ? roomStatuses.map(formatRoomStatusLine).join('\n')
    : '(no provider runtime snapshot)'

  return [
    'MODE GOVERNOR (decree-first — overrides casual verbosity):',
    ...modeRulesBlock(governor),
    '',
    'Room status (orchestrator view — do not invent presence):',
    statusLines,
  ].join('\n')
}
