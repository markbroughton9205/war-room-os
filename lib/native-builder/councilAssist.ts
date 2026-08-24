/**
 * Phase E — Council Assist. A shared Engineering Core capability (both Standalone Builder and War
 * Room Engineering call the exact same function via the same API route) that consults Council
 * families for advisory input on a mission. Reuses the same real per-vendor provider adapter
 * (lib/council/providerDirectCall.ts:invokeDirectCouncilProvider) already used by the single-agent
 * opinion (engineeringStrategy.ts) and the hosted-coder proposal path (repairPlanner.ts) — this is
 * not a second orchestration engine, it is the third sanctioned use of the same one.
 *
 * Council is strictly advisory here, same as everywhere else in Engineering Core:
 * requestCouncilAssist() never returns anything parsed as a StructuredPatch, never calls
 * planRepair()/applyProposal(), and never mutates the repository. If a Commander wants a session's
 * findings turned into a change, the Coder must independently regenerate a proposal via
 * requestHostedModelProposal() (repairPlanner.ts) — passing the session text through
 * commanderRequestText is a legitimate way to do that, but that is a distinct, later, explicit
 * call, never automatic.
 *
 * Compositions:
 *  - stable_group / full_council reuse the exact family roster already established for the live
 *    Council experience (lib/council/councilMode.ts:STABLE_GROUP_FAMILY_ORDER), not a
 *    differently-numbered Engineering-only roster. stable_group runs the roster sequentially, each
 *    family's prompt carrying the prior families' replies (the "build on each other" shape);
 *    full_council runs the same roster in parallel with no cross-family dependency. This is a
 *    bounded, honestly-scoped reproduction of that distinction for Engineering Core's own advisory
 *    use — it does not claim feature parity with the full live Council chat orchestrator
 *    (app/api/chat/execute.ts), which is chat-specific (memory persistence, runtime-integrity
 *    streaming, diagnostic mode) and out of scope for a non-chat, non-mutating advisory call.
 *  - architecture_review / security_review / research_review are Engineering-Core-specific
 *    compositions with smaller, purpose-fit rosters, run in parallel (no natural "build on each
 *    other" order for a review).
 */
import { randomUUID } from 'node:crypto'
import {
  invokeDirectCouncilProvider,
  type DirectProviderFamily,
} from '@/lib/council/providerDirectCall'
import { STABLE_GROUP_FAMILY_ORDER } from '@/lib/council/councilMode'
import type { NativeAdvisoryProviderOpinion, NativeCouncilAssistComposition, NativeCouncilAssistSession } from './types'

export const COUNCIL_ASSIST_COMPOSITIONS: readonly NativeCouncilAssistComposition[] = [
  'stable_group',
  'full_council',
  'architecture_review',
  'security_review',
  'research_review',
]

const REVIEW_ROSTERS: Record<'architecture_review' | 'security_review' | 'research_review', DirectProviderFamily[]> = {
  architecture_review: ['claude', 'chatgpt'],
  security_review: ['red_team', 'claude'],
  research_review: ['grok', 'kimi'],
}

const REVIEW_FRAMING: Record<'architecture_review' | 'security_review' | 'research_review', string> = {
  architecture_review: 'Give a systems-architecture assessment: structure, boundaries, coupling, scalability risk. Do not propose exact code.',
  security_review: 'Give a security/risk assessment: attack surface, containment, approval-gate integrity, contradictions. Do not propose exact code.',
  research_review: 'Give a research/signal assessment: prior art, known pitfalls, emerging approaches relevant to this mission. Do not propose exact code.',
}

export function rosterForComposition(composition: NativeCouncilAssistComposition): DirectProviderFamily[] {
  if (composition === 'stable_group' || composition === 'full_council') {
    return [...STABLE_GROUP_FAMILY_ORDER] as DirectProviderFamily[]
  }
  return REVIEW_ROSTERS[composition]
}

export type CouncilAssistInvokeFn = typeof invokeDirectCouncilProvider

async function callOne(
  family: DirectProviderFamily,
  prompt: string,
  invoke: CouncilAssistInvokeFn,
): Promise<NativeAdvisoryProviderOpinion> {
  const result = await invoke(family, prompt, { timeoutMs: 20_000, maxTokens: 400 })
  return {
    family,
    ok: result.ok,
    text: result.ok ? result.text : '',
    error: result.ok ? undefined : result.error,
    recordedAt: new Date().toISOString(),
  }
}

/**
 * Runs the requested composition against a mission's title/description and returns a durable,
 * advisory-only session. `invoke` is dependency-injected (defaults to the real
 * invokeDirectCouncilProvider) so tests can prove the composition/sequencing logic against a
 * controlled fixture invoke function without a live provider — the same pattern already used for
 * requestHostedModelProposal's NativeCouncilInvokeFn.
 */
export async function requestCouncilAssist(
  mission: { title: string; description: string },
  composition: NativeCouncilAssistComposition,
  invoke: CouncilAssistInvokeFn = invokeDirectCouncilProvider,
): Promise<NativeCouncilAssistSession> {
  const roster = rosterForComposition(composition)
  const basePrompt = `Engineering mission.\nTitle: ${mission.title}\nDescription: ${mission.description}`
  const framing = composition === 'architecture_review' || composition === 'security_review' || composition === 'research_review'
    ? REVIEW_FRAMING[composition]
    : 'Give a 2-4 sentence assessment relevant to your role on this council. Do not propose exact code.'

  let results: NativeAdvisoryProviderOpinion[]
  if (composition === 'stable_group') {
    results = []
    let transcript = ''
    for (const family of roster) {
      const prompt = `${basePrompt}\n${framing}${transcript ? `\n\nPrior council replies so far:\n${transcript}` : ''}`
      const opinion = await callOne(family, prompt, invoke)
      results.push(opinion)
      if (opinion.ok) transcript += `\n[${family}] ${opinion.text}`
    }
  } else {
    const prompt = `${basePrompt}\n${framing}`
    results = await Promise.all(roster.map(family => callOne(family, prompt, invoke)))
  }

  return {
    id: randomUUID(),
    composition,
    roster,
    results,
    requestedAt: new Date().toISOString(),
  }
}
