import { pathToFileURL } from 'node:url'

type OperationGroupMessage = {
  id: string
  messageType: string
  content: string
  projectOrchestrationPacket?: { id: string } | null
  familyDeliberationTurn?: { session_id: string } | null
}

/**
 * Mirrors `councilOperationGroupKey` in app/page.tsx exactly (that file is a .tsx page and can't be
 * loaded by this repo's plain-Node validation runner, which only type-strips .ts — no JSX
 * transform). Live-verified fix, browser-confirmed against real data: see the Phase B report.
 *
 * Regression this guards: family_deliberation_turn.session_id is assigned once per CONVERSATION
 * (execute.ts: `sessionId: conversationId`), not once per round. Grouping by it alone merges every
 * deliberation-tagged message from every round ever run in a conversation into one "operation,"
 * inflating the header's "N contributions responded" count with stale contributions from earlier,
 * unrelated rounds. Combining it with the nearest-decree turn key keeps deliberation exchanges
 * scoped to their own round while still distinguishing them from ordinary single-response turns
 * within that same round.
 */
function councilOperationGroupKeyMirror(
  message: OperationGroupMessage,
  messages: readonly OperationGroupMessage[],
): string | null {
  if (message.projectOrchestrationPacket) return `project:${message.projectOrchestrationPacket.id}`
  const messageIndex = messages.findIndex(item => item.id === message.id)
  const priorMessages = messageIndex >= 0 ? messages.slice(0, messageIndex + 1) : messages
  const nearestDecree = [...priorMessages].reverse().find(item => item.messageType === 'decree')
  const turnKey = nearestDecree ? `turn:${nearestDecree.id}` : `message:${message.id}`
  if (message.familyDeliberationTurn?.session_id) return `deliberation:${message.familyDeliberationTurn.session_id}:${turnKey}`
  if (message.messageType !== 'response' && message.messageType !== 'system') return null
  return turnKey
}

function timelineInputs(
  message: OperationGroupMessage,
  messages: readonly OperationGroupMessage[],
): OperationGroupMessage[] {
  const groupKey = councilOperationGroupKeyMirror(message, messages)
  if (!groupKey) return []
  return messages
    .filter(item => councilOperationGroupKeyMirror(item, messages) === groupKey)
    .filter(item => (item.messageType === 'response' || item.messageType === 'system') && item.content.trim())
}

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function msg(overrides: Partial<OperationGroupMessage> & { id: string; messageType: string }): OperationGroupMessage {
  return { content: 'content', ...overrides }
}

export function runOperationGroupKeyValidation(): CaseResult[] {
  const results: CaseResult[] = []
  const conversationId = 'conv-shared-across-many-rounds'

  const decreeRoundA = msg({ id: 'decree-a', messageType: 'decree' })
  const chatgptRoundA = msg({
    id: 'chatgpt-a', messageType: 'response',
    familyDeliberationTurn: { session_id: conversationId },
  })
  const decreeRoundB = msg({ id: 'decree-b', messageType: 'decree' })
  const chatgptRoundB = msg({
    id: 'chatgpt-b', messageType: 'response',
    familyDeliberationTurn: { session_id: conversationId },
  })
  const claudeRoundB = msg({
    id: 'claude-b', messageType: 'response',
    familyDeliberationTurn: { session_id: conversationId },
  })
  const twoRoundHistory = [decreeRoundA, chatgptRoundA, decreeRoundB, chatgptRoundB, claudeRoundB]

  const roundAKey = councilOperationGroupKeyMirror(chatgptRoundA, twoRoundHistory)
  const roundBChatgptKey = councilOperationGroupKeyMirror(chatgptRoundB, twoRoundHistory)
  const roundBClaudeKey = councilOperationGroupKeyMirror(claudeRoundB, twoRoundHistory)

  results.push(check(
    'group_key_01_same_deliberation_session_different_rounds_get_different_keys',
    roundAKey !== roundBChatgptKey,
    `roundAKey=${roundAKey} roundBChatgptKey=${roundBChatgptKey}`,
  ))
  results.push(check(
    'group_key_02_same_round_same_deliberation_session_share_one_key',
    roundBChatgptKey === roundBClaudeKey,
    `roundBChatgptKey=${roundBChatgptKey} roundBClaudeKey=${roundBClaudeKey}`,
  ))

  const roundBInputs = timelineInputs(chatgptRoundB, twoRoundHistory)
  results.push(check(
    'group_key_03_round_b_timeline_never_includes_round_a_messages',
    roundBInputs.length === 2 && roundBInputs.every(m => m.id !== chatgptRoundA.id),
    `roundBInputCount=${roundBInputs.length} ids=${roundBInputs.map(m => m.id).join(',')}`,
  ))

  const ordinaryDecree = msg({ id: 'decree-c', messageType: 'decree' })
  const ordinaryResponse = msg({ id: 'response-c', messageType: 'response' })
  const ordinaryHistory = [ordinaryDecree, ordinaryResponse]
  results.push(check(
    'group_key_04_ordinary_non_deliberation_messages_group_by_turn',
    councilOperationGroupKeyMirror(ordinaryResponse, ordinaryHistory) === `turn:${ordinaryDecree.id}`,
    `key=${councilOperationGroupKeyMirror(ordinaryResponse, ordinaryHistory)}`,
  ))

  // No duplicate synthesis across rounds: a "final"/synthesis-bearing message from round A must
  // never appear in round B's timeline inputs, since buildCommanderOperationFromMessages emits at
  // most one synthesis_completed event per group it's given — if round A's synthesis message leaked
  // into round B's group (the pre-fix bug), round B's operation would incorrectly report
  // synthesisCompleted from stale, already-rendered round-A content instead of its own.
  const synthesisRoundA = msg({
    id: 'synthesis-a', messageType: 'response',
    familyDeliberationTurn: { session_id: conversationId },
  })
  const historyWithSynthesisA = [decreeRoundA, chatgptRoundA, synthesisRoundA, decreeRoundB, chatgptRoundB, claudeRoundB]
  const roundBInputsWithSynthesisA = timelineInputs(chatgptRoundB, historyWithSynthesisA)
  results.push(check(
    'group_key_05_no_duplicate_synthesis_leak_across_rounds',
    roundBInputsWithSynthesisA.every(m => m.id !== synthesisRoundA.id),
    `roundBInputIds=${roundBInputsWithSynthesisA.map(m => m.id).join(',')}`,
  ))

  return results
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runOperationGroupKeyValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`\nOperation group key validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
