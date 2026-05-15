import { DEFAULT_COUNCIL_COMMAND, type CouncilCommand } from '@/lib/council/councilCommandTypes'
import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { repairOrFlagResponse } from '@/lib/council/responseIntegrity'
import { stripLockedTopicLines, textViolatesTopicLock, type TopicScopeLock } from '@/lib/council/topicScope'
import {
  isVerificationHeavyContext,
  stripCrossTalkLines,
  stripForbiddenScopeLines,
  textViolatesForbiddenScope,
  type ActiveScope,
} from '@/lib/council/intentScope'

export type ModeratedFamilyLine = {
  family: CouncilOrchestrationFamily
  content: string
  warnings: string[]
}

const PACKET_ORDER: CouncilOrchestrationFamily[] = [
  'chatgpt',
  'claude',
  'grok',
  'gemini',
  'red_team',
  'baby',
  'kimi',
  'bridge_architect',
]

const CROSS_CRITIQUE = /\b(chatgpt|claude|grok|gemini|red\s*team|baby|kimi|bridge)\b[^.!?\n]{0,120}\b(wrong|incorrect|flawed|useless|fails?|bad\s+take|nonsense)\b/i

function reduceCrossCritiqueHeuristic(text: string, family: CouncilOrchestrationFamily): { text: string; stripped: number } {
  if (family === 'red_team' || !text.trim()) return { text, stripped: 0 }
  const lines = text.split('\n')
  let stripped = 0
  const out: string[] = []
  for (const line of lines) {
    if (CROSS_CRITIQUE.test(line)) {
      stripped += 1
      continue
    }
    out.push(line)
  }
  return { text: out.join('\n').trim(), stripped }
}

function sortByPacketOrder(items: ModeratedFamilyLine[]): ModeratedFamilyLine[] {
  const rank = (f: CouncilOrchestrationFamily) => {
    const i = PACKET_ORDER.indexOf(f)
    return i < 0 ? 999 : i
  }
  return [...items].sort((a, b) => rank(a.family) - rank(b.family))
}

export type FinalModeratorInput = {
  lines: { family: CouncilOrchestrationFamily; content: string }[]
  topicLock: TopicScopeLock
  activeScope?: ActiveScope
  councilCommand?: CouncilCommand
}

/**
 * Single pass: integrity repair, topic lock strip, cross-critique reduction (non–Red Team), packet ordering.
 */
export function runFinalModerator(input: FinalModeratorInput): ModeratedFamilyLine[] {
  const { topicLock, activeScope, councilCommand } = input
  const cmd = councilCommand ?? DEFAULT_COUNCIL_COMMAND
  const moderated: ModeratedFamilyLine[] = []

  for (const row of input.lines) {
    const warnings: string[] = []
    let content = row.content

    const integ = repairOrFlagResponse(content)
    content = integ.text
    warnings.push(...integ.integrityWarnings)

    const cc = reduceCrossCritiqueHeuristic(content, row.family)
    content = cc.text
    if (cc.stripped > 0) warnings.push('moderator_stripped_cross_family_critique')

    const strippedTopic = stripLockedTopicLines(content, topicLock, row.family)
    content = strippedTopic.text
    if (strippedTopic.strippedLineCount > 0) {
      warnings.push('moderator_stripped_topic_scope_violation')
    }
    if (textViolatesTopicLock(topicLock, content) && row.family !== 'red_team') {
      warnings.push('protocol_drift_topic_scope_residual')
    }

    if (activeScope) {
      const allowScopeStrip =
        row.family !== 'red_team' || !isVerificationHeavyContext(cmd, activeScope.intent)
      if (allowScopeStrip) {
        const sc = stripForbiddenScopeLines(content, activeScope)
        content = sc.text
        if (sc.stripped > 0) warnings.push('moderator_stripped_active_scope_topic')
        if (textViolatesForbiddenScope(activeScope, content) && row.family !== 'red_team') {
          warnings.push('protocol_drift_active_scope_residual')
        }
      }
      if (!activeScope.crossTalkAllowed) {
        const cx = stripCrossTalkLines(content)
        content = cx.text
        if (cx.stripped > 0) warnings.push('moderator_stripped_cross_talk')
      }
    }

    moderated.push({ family: row.family, content: content.trim(), warnings })
  }

  return sortByPacketOrder(moderated)
}
