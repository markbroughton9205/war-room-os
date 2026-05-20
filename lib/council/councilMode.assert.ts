/**
 * Stable group chat mode — documented smoke prompts (assertions).
 * Run: pnpm exec tsx lib/council/councilMode.assert.ts
 */

import {
  getDefaultCouncilFlowMode,
  isStableGroupChatMode,
  parseCouncilFlowMode,
  resolveCouncilFlowMode,
  STABLE_GROUP_FAMILY_ORDER,
} from '@/lib/council/councilMode'
import { extractLastTwoFamilyReplies, isStableGroupFamily } from '@/lib/council/stableGroupChat'

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

assert(parseCouncilFlowMode('stable_group') === 'stable_group', 'stable_group parse')
assert(parseCouncilFlowMode('STABLE_GROUP_CHAT') === 'stable_group', 'alias parse')
assert(isStableGroupChatMode('stable_group'), 'stable group detect')
assert(!isStableGroupChatMode('full_council'), 'full council not stable')
assert(STABLE_GROUP_FAMILY_ORDER[0] === 'chatgpt', 'order starts chatgpt')
assert(STABLE_GROUP_FAMILY_ORDER.length === 5, 'five core families')

const thread = [
  { sender: "Ra'el", content: 'What should we ship first?' },
  { sender: 'ChatGPT', content: 'Ship the council mode selector first.' },
  { sender: 'Claude', content: 'Sequence: API branch, then UI, then verify.' },
]
const lastTwo = extractLastTwoFamilyReplies(thread)
assert(lastTwo.length === 2, 'last two family replies')
assert(lastTwo[0].family === 'ChatGPT', 'first prior chatgpt')
assert(isStableGroupFamily('grok'), 'grok in roster')

assert(resolveCouncilFlowMode('direct') === 'direct', 'client direct wins')
assert(typeof getDefaultCouncilFlowMode() === 'string', 'default mode string')

console.log('[councilMode.assert] ok', {
  defaultMode: getDefaultCouncilFlowMode(),
  order: STABLE_GROUP_FAMILY_ORDER.join(' → '),
})
