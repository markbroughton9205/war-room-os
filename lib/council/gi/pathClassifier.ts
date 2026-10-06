import { classifyIntentFromDecree } from '@/lib/council/intentClassifier'
import { isSocialCouncilCheckin } from '@/lib/council/live-orchestration/socialCheckin'
import { classifyEvidenceBoardMission } from '@/lib/council/evidence-board/classifier'
import { classifyCouncilTurn } from '@/lib/council/session-orchestration/turnIntent'
import { classifyReasoningBudget, matchPathRules, pickRuleWinner } from './pathClassifier.rules'
import { resolveFollowUpText, isFollowUpTurn } from './conversationContext'
import { classifyToolNeed } from './toolNeed'
import { resolveReasoningBudget } from './budgetPolicy'
import type { IntentClass, MissionClassHint, PathClassifierResult, ToolNeed } from './types'

export type ClassifyCouncilPathInput = {
  text: string
  prior_turns?: string[]
}

function intentFor(mission: MissionClassHint, fallback: IntentClass): IntentClass {
  if (mission === 'CHITCHAT' || mission === 'SOCIAL_CHECKIN') return 'CASUAL_CONVERSATION'
  if (mission === 'SIMPLE_QA' || mission === 'FORMAT') return 'DIRECT_ANSWER'
  if (mission === 'SYSTEM_STATUS') return 'SYSTEM_STATUS'
  if (mission === 'INCIDENT_RESPONSE') return 'INCIDENT'
  if (mission === 'DEEP_RESEARCH') return 'DEEP_RESEARCH'
  if (mission === 'CURRENT_INTEL') return 'CURRENT_INTEL'
  if (mission === 'ARCHITECTURE_REVIEW') return 'ARCHITECTURE_REVIEW'
  if (mission === 'ENGINEERING') return 'ENGINEERING_HANDOFF'
  if (mission === 'DOCUMENT_ANALYSIS') return 'DOCUMENT_ANALYSIS'
  return fallback
}

function pack(result: Omit<PathClassifierResult, 'llm_fallback_used' | 'seats_recommended' | 'ambiguities' | 'escalation_allowed' | 'intent_class' | 'tool_need' | 'budget'> & Partial<PathClassifierResult>): PathClassifierResult {
  const path = result.path
  const seats = path === 'AGENT_PATH' ? (result.seats_recommended ?? []) : []
  return {
    path,
    mission_class: result.mission_class,
    intent_class: result.intent_class ?? intentFor(result.mission_class, 'DIRECT_ANSWER'),
    confidence: result.confidence,
    rules_fired: result.rules_fired,
    tools_needed_est: result.tools_needed_est,
    tool_need: result.tool_need ?? 'NONE',
    risk_class: result.risk_class,
    handoff_target: result.handoff_target,
    seats_recommended: seats,
    ambiguous: result.ambiguous,
    ambiguities: result.ambiguities ?? [],
    escalation_allowed: result.escalation_allowed ?? path === 'SHORT_PATH',
    clarifying_question: result.clarifying_question,
    budget: result.budget ?? 'STANDARD',
    reason: result.reason,
    llm_fallback_used: false,
  }
}

/**
 * Rules-first PathClassifier with context, budget, and cheap ambiguity handling.
 * Medium confidence stays on the rule winner. Low-confidence expensive routes ask one question.
 */
export function classifyCouncilPath(input: ClassifyCouncilPathInput | string): PathClassifierResult {
  const source = typeof input === 'string' ? { text: input, prior_turns: [] as string[] } : input
  const prior = source.prior_turns ?? []
  const original = typeof source.text === 'string' ? source.text.trim() : ''
  const follow = resolveFollowUpText(original, prior)
  const raw = follow.resolved
  const rules = matchPathRules(original)
  const contextRules = raw !== original ? matchPathRules(raw) : []
  const strongOriginalShort = rules.some(hit => hit.path === 'SHORT_PATH' && hit.confidence >= 0.9)
  const originalOwnsExpensivePath = rules.some(hit => hit.path === 'AGENT_PATH' || hit.path === 'HANDOFF')
  const winner = pickRuleWinner([
    ...rules,
    ...contextRules.filter(hit => {
      if (hit.path === 'SHORT_PATH' && isFollowUpTurn(original)) return false
      if (strongOriginalShort && !originalOwnsExpensivePath && hit.path === 'AGENT_PATH') return false
      // A prior status brief mentions "War Room status". That must not turn
      // "why did you say that?" into a new SYSTEM_STATUS mission.
      if (
        hit.id === 'system_status'
        && isFollowUpTurn(original)
        && !/(?:status\s+(?:on|of|for)\s+(?:the\s+)?war\s*room|(?:war\s*room|runtime)\s+status)/i.test(original)
      ) return false
      return true
    }),
  ])
  const social = isSocialCouncilCheckin(original) && !isFollowUpTurn(original) && prior.length === 0
  const decreeIntent = classifyIntentFromDecree(original)
  const turn = classifyCouncilTurn(original)
  const ebc = classifyEvidenceBoardMission({ commanderMessage: original })
  const tool = classifyToolNeed(original)
  const budget = classifyReasoningBudget(original)
  const fired = [
    ...rules.map(rule => rule.id),
    follow.preserved_session ? 'follow_up_context' : '',
    social ? 'socialCheckin' : '',
    `decree:${decreeIntent}`,
    `turn:${turn.intent}`,
    `ebc:${ebc.mission_class}`,
    `tool:${tool.need}`,
    `budget:${budget}`,
  ].filter(Boolean)

  if (/^(?:please\s+)?research\??$/i.test(original)) {
    return pack({
      path: 'SHORT_PATH',
      mission_class: 'UNKNOWN',
      intent_class: 'DIRECT_ANSWER',
      confidence: 0.58,
      rules_fired: [...fired, 'ambiguous_research'],
      tools_needed_est: 0,
      tool_need: 'NONE',
      risk_class: 'LOW',
      seats_recommended: [],
      ambiguous: true,
      ambiguities: ['research_topic_unspecified'],
      escalation_allowed: true,
      clarifying_question: 'Research what, and do you want live primary sources or a direct take?',
      budget: 'FAST',
      reason: 'Bare "research?" is ambiguous. One clarifying question instead of a deep mission.',
    })
  }

  if (/^(?:please\s+)?look it up\??$/i.test(original)) {
    if (prior.length) {
      return pack({
        path: 'AGENT_PATH',
        mission_class: 'CURRENT_INTEL',
        intent_class: 'CURRENT_INTEL',
        confidence: 0.84,
        rules_fired: [...fired, 'look_it_up_with_referent'],
        tools_needed_est: 'many',
        tool_need: 'BROWSER_SEARCH',
        risk_class: 'MED',
        seats_recommended: [],
        ambiguous: false,
        budget: 'STANDARD',
        reason: 'Look it up with a referent uses Browser Broker on AGENT_PATH.',
      })
    }
    return pack({
      path: 'SHORT_PATH',
      mission_class: 'UNKNOWN',
      intent_class: 'DIRECT_ANSWER',
      confidence: 0.55,
      rules_fired: [...fired, 'look_it_up_no_referent'],
      tools_needed_est: 0,
      tool_need: 'NONE',
      risk_class: 'LOW',
      seats_recommended: [],
      ambiguous: true,
      ambiguities: ['look_up_target_unspecified'],
      escalation_allowed: true,
      clarifying_question: 'Look up what?',
      budget: 'FAST',
      reason: 'Look it up with no referent is a clarifying question, not a Browser launch.',
    })
  }

  if (winner?.path === 'HANDOFF') {
    return pack({
      path: 'HANDOFF',
      mission_class: winner.mission_class,
      intent_class: winner.intent_class,
      confidence: winner.confidence,
      rules_fired: fired,
      tools_needed_est: winner.tools_needed_est,
      tool_need: winner.tool_need,
      risk_class: winner.risk_class,
      handoff_target: winner.handoff_target,
      seats_recommended: [],
      ambiguous: false,
      escalation_allowed: false,
      budget,
      reason: `Deterministic handoff to ${winner.handoff_target ?? 'module'} (${winner.id}). Foundry/Broker not executed.`,
    })
  }

  if (winner?.path === 'AGENT_PATH') {
    const policy = resolveReasoningBudget(original, 'AGENT_PATH')
    return pack({
      path: 'AGENT_PATH',
      mission_class: winner.mission_class,
      intent_class: winner.intent_class,
      confidence: winner.confidence,
      rules_fired: fired,
      tools_needed_est: 'many',
      tool_need: winner.tool_need,
      risk_class: winner.risk_class,
      seats_recommended: [],
      ambiguous: false,
      escalation_allowed: false,
      budget: policy.budget,
      reason: `AGENT_PATH via existing Evidence-Board Council (${winner.mission_class}). Conditional seats; not always-six.`,
    })
  }

  if (
    winner?.path === 'SHORT_PATH'
    || social
    || (!isFollowUpTurn(original) && (decreeIntent === 'greeting' || turn.intent === 'GREETING' || turn.intent === 'SOCIAL_CHECKIN'))
    || (turn.intent === 'KNOWLEDGE_QUESTION' && turn.depth === 'FAST')
    || isFollowUpTurn(original)
  ) {
    if (isFollowUpTurn(original) && /^(do that|do it)$/i.test(original) && /fix|build|patch|commit/i.test(follow.referent ?? '')) {
      return pack({
        path: 'HANDOFF',
        mission_class: 'ENGINEERING',
        intent_class: 'ENGINEERING_HANDOFF',
        confidence: 0.84,
        rules_fired: [...fired, 'follow_up_do_that_foundry'],
        tools_needed_est: 'many',
        tool_need: 'FOUNDRY',
        risk_class: 'HIGH',
        handoff_target: 'FOUNDRY',
        seats_recommended: [],
        ambiguous: false,
        budget,
        reason: 'Follow-up "do that" refers to a mutation request. Foundry handoff stub.',
      })
    }
    return pack({
      path: 'SHORT_PATH',
      mission_class: winner?.mission_class ?? (social ? 'SOCIAL_CHECKIN' : 'SIMPLE_QA'),
      intent_class: winner?.intent_class ?? (social ? 'CASUAL_CONVERSATION' : 'DIRECT_ANSWER'),
      confidence: winner?.confidence ?? (isFollowUpTurn(original) ? 0.78 : 0.9),
      rules_fired: fired,
      tools_needed_est: winner?.tools_needed_est ?? 0,
      tool_need: winner?.tool_need ?? tool.need,
      risk_class: 'LOW',
      seats_recommended: [],
      ambiguous: false,
      escalation_allowed: true,
      budget,
      reason: isFollowUpTurn(original)
        ? 'Follow-up stays on SHORT_PATH using conversation context. Not a social check-in.'
        : 'SHORT_PATH: casual / simple answer. No six-seat Council unless escalated.',
    })
  }

  const expensiveEbc =
    ebc.mission_class === 'DEEP_RESEARCH'
    || ebc.mission_class === 'CURRENT_INTEL'
    || ebc.mission_class === 'ARCHITECTURE_REVIEW'
    || ebc.mission_class === 'INCIDENT_RESPONSE'
    || ebc.mission_class === 'SYSTEM_STATUS'

  if (expensiveEbc && ebc.confidence >= 0.7) {
    const liveCue = /\b(primary sources?|with sources|current version|right now|status on war room|look it up)\b/i.test(original)
    if (ebc.mission_class === 'DEEP_RESEARCH' && !liveCue) {
      return pack({
        path: 'SHORT_PATH',
        mission_class: 'SIMPLE_QA',
        intent_class: 'DIRECT_ANSWER',
        confidence: 0.7,
        rules_fired: [...fired, 'conceptual_not_research'],
        tools_needed_est: 0,
        tool_need: 'NONE',
        risk_class: 'LOW',
        seats_recommended: [],
        ambiguous: false,
        escalation_allowed: true,
        budget,
        reason: 'No live-research cue. Direct reasoning on SHORT_PATH instead of a default deep mission.',
      })
    }
    return pack({
      path: 'AGENT_PATH',
      mission_class: ebc.mission_class as MissionClassHint,
      intent_class: intentFor(ebc.mission_class as MissionClassHint, 'AGENT_REASONING'),
      confidence: ebc.confidence,
      rules_fired: [...fired, 'ebc_agent_signal'],
      tools_needed_est: 'many',
      tool_need: ebc.mission_class === 'DEEP_RESEARCH' || ebc.mission_class === 'CURRENT_INTEL' ? 'BROWSER_SEARCH' : 'SYSTEM_PROBE',
      risk_class: 'MED',
      seats_recommended: [],
      ambiguous: ebc.confidence < 0.8,
      ambiguities: ebc.confidence < 0.8 ? ['ebc_composed_default'] : [],
      budget,
      reason: `AGENT_PATH via existing Evidence-Board Council (${ebc.mission_class}).`,
    })
  }

  if (ebc.mission_class === 'ENGINEERING') {
    return pack({
      path: 'HANDOFF',
      mission_class: 'ENGINEERING',
      intent_class: 'ENGINEERING_HANDOFF',
      confidence: Math.max(0.7, ebc.confidence),
      rules_fired: [...fired, 'ebc_engineering_handoff'],
      tools_needed_est: 'many',
      tool_need: 'FOUNDRY',
      risk_class: 'HIGH',
      handoff_target: 'FOUNDRY',
      seats_recommended: [],
      ambiguous: false,
      budget,
      reason: 'Engineering mutate request is a Foundry handoff stub. Council does not execute git/patch.',
    })
  }

  if (expensiveEbc && ebc.confidence < 0.7) {
    const liveCue = /\b(primary sources?|with sources|current version|right now|status on war room|look it up)\b/i.test(original)
    if (!liveCue) {
      return pack({
        path: 'SHORT_PATH',
        mission_class: 'SIMPLE_QA',
        intent_class: 'DIRECT_ANSWER',
        confidence: Math.max(0.62, ebc.confidence),
        rules_fired: [...fired, 'low_confidence_direct'],
        tools_needed_est: 0,
        tool_need: 'NONE',
        risk_class: 'LOW',
        seats_recommended: [],
        ambiguous: true,
        ambiguities: ['no_strong_rule'],
        escalation_allowed: true,
        budget,
        reason: 'Low confidence and no live-research cue. Direct SHORT_PATH instead of a clarifying tax or a multi-agent mission.',
      })
    }
    return pack({
      path: 'SHORT_PATH',
      mission_class: 'UNKNOWN',
      intent_class: 'DIRECT_ANSWER',
      confidence: ebc.confidence,
      rules_fired: [...fired, 'low_confidence_clarify'],
      tools_needed_est: 0,
      tool_need: 'NONE',
      risk_class: 'LOW',
      seats_recommended: [],
      ambiguous: true,
      ambiguities: ['unclear_whether_direct_answer_or_live_research'],
      escalation_allowed: true,
      clarifying_question: 'Do you want a direct take, or should I actually check live sources / probes?',
      budget: 'FAST',
      reason: 'Low confidence. Asking one clarifying question instead of launching a multi-agent mission.',
    })
  }

  return pack({
    path: 'SHORT_PATH',
    mission_class: 'SIMPLE_QA',
    intent_class: 'DIRECT_ANSWER',
    confidence: 0.62,
    rules_fired: [...fired, 'default_direct_answer'],
    tools_needed_est: 0,
    tool_need: 'NONE',
    risk_class: 'LOW',
    seats_recommended: [],
    ambiguous: true,
    ambiguities: ['no_strong_rule'],
    escalation_allowed: true,
    budget,
    reason: 'No expensive signal. Direct short-path answer rather than always-six or default research.',
  })
}

export type { ToolNeed, IntentClass }
