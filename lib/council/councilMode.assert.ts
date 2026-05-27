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
import { PROVIDER_IDENTITY_PROFILES } from '@/lib/council/providerIdentity'
import {
  extractLastTwoFamilyReplies,
  isStableGroupFamily,
  trimStableGroupPriorForCeiling,
} from '@/lib/council/stableGroupChat'
import { STABLE_GROUP_PROMPT_TOKEN_CEILING } from '@/lib/council/providerTokenDiagnostics'

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

assert(parseCouncilFlowMode('stable_group') === 'stable_group', 'stable_group parse')
assert(parseCouncilFlowMode('STABLE_GROUP_CHAT') === 'stable_group', 'alias parse')
assert(isStableGroupChatMode('stable_group'), 'stable group detect')
assert(!isStableGroupChatMode('full_council'), 'full council not stable')
assert(STABLE_GROUP_FAMILY_ORDER[0] === 'chatgpt', 'order starts chatgpt')
assert(STABLE_GROUP_FAMILY_ORDER.length === 6, 'six core families')
assert(STABLE_GROUP_FAMILY_ORDER[4] === 'kimi', 'kimi before red team')
assert(STABLE_GROUP_FAMILY_ORDER[5] === 'red_team', 'red team last')

const thread = [
  { sender: "Ra'el", content: 'What should we ship first?' },
  { sender: 'ChatGPT', content: 'Ship the council mode selector first.' },
  { sender: 'Claude', content: 'Sequence: API branch, then UI, then verify.' },
]
const lastTwo = extractLastTwoFamilyReplies(thread)
assert(lastTwo.length === 2, 'last two family replies')
assert(lastTwo[0].family === 'ChatGPT', 'first prior chatgpt')
assert(isStableGroupFamily('grok'), 'grok in roster')
assert(isStableGroupFamily('kimi'), 'kimi in roster')

assert(resolveCouncilFlowMode('direct') === 'direct', 'client direct wins')
assert(typeof getDefaultCouncilFlowMode() === 'string', 'default mode string')

for (const [family, profile] of Object.entries(PROVIDER_IDENTITY_PROFILES)) {
  assert(profile.length > 0 && profile.length < 250, `identity profile length ${family}`)
}

const longPrior = Array.from({ length: 6 }, (_, i) => ({
  family: `Family${i}`,
  content: 'x'.repeat(900),
}))
const trimmed = trimStableGroupPriorForCeiling({
  prior: longPrior,
  commanderMessage: "Ra'el: focus today",
  activeTopic: 'focus',
  providerStatusBlock: 'Provider status: ok',
  systemPrompt: 'system',
  ceiling: STABLE_GROUP_PROMPT_TOKEN_CEILING,
})
assert(trimmed.trimmed, 'ceiling trims oldest prior')
assert(trimmed.prior.length < longPrior.length, 'prior count reduced')

console.log('[councilMode.assert] ok', {
  defaultMode: getDefaultCouncilFlowMode(),
  order: STABLE_GROUP_FAMILY_ORDER.join(' → '),
})
