import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import {
  canAutoContinue,
  recordConversationTurn,
  touchConversationRuntime,
} from '@/lib/conversation-runtime/sessionStore'
import type { CouncilConversationRuntime } from '@/lib/conversation-runtime/types'
import { MAX_CONTINUATION_STEPS_PER_REQUEST } from '@/lib/conversation-runtime/config'
import { rankedFamiliesForDecree } from '@/lib/provider-specialization/routing'

export type ContinuationPlanStep = {
  family: CouncilOrchestrationFamily
  turnType: 'follow_up' | 'provider_challenge' | 'synthesis_update'
  promptHint: string
}

export type ContinuationPlan = {
  ok: boolean
  steps: ContinuationPlanStep[]
  reason?: string
  conversationalOnly: true
  humanAuthorityNote: string
}

/**
 * Plans bounded council continuation without external side effects.
 * LLM invocation remains on /api/chat (one family per request); this route only orchestrates state.
 */
export function planCouncilContinuation(
  runtime: CouncilConversationRuntime,
  opts?: { activeTopic?: string; maxSteps?: number },
): ContinuationPlan {
  const humanAuthorityNote =
    "Ra'el retains final authority; continuation is conversational synthesis only — no autonomous external actions."

  if (!canAutoContinue(runtime)) {
    return {
      ok: false,
      steps: [],
      reason: runtime.idleExpired
        ? 'Session idle timeout exceeded (24h).'
        : 'Burst or cooldown limit reached; await Ra\'el.',
      conversationalOnly: true,
      humanAuthorityNote,
    }
  }

  const topic = (opts?.activeTopic ?? runtime.activeTopic).trim() || 'Continue prior council thread'
  const families = rankedFamiliesForDecree(topic, MAX_CONTINUATION_STEPS_PER_REQUEST)
  const maxSteps = Math.min(opts?.maxSteps ?? MAX_CONTINUATION_STEPS_PER_REQUEST, MAX_CONTINUATION_STEPS_PER_REQUEST)

  const steps: ContinuationPlanStep[] = families.slice(0, maxSteps).map((family, index) => ({
    family,
    turnType: index === maxSteps - 1 ? 'synthesis_update' : 'follow_up',
    promptHint: `Continue council dialogue on: ${topic.slice(0, 200)}. No new decree. Respond once; challenge only if material.`,
  }))

  return { ok: steps.length > 0, steps, conversationalOnly: true, humanAuthorityNote }
}

export function applyContinuationPlanToRuntime(
  runtime: CouncilConversationRuntime,
  plan: ContinuationPlan,
): CouncilConversationRuntime {
  if (!plan.ok) return runtime
  let next = touchConversationRuntime({
    ...runtime,
    lastContinuationAt: Date.now(),
  })
  for (const step of plan.steps) {
    next = recordConversationTurn(next, {
      type: step.turnType,
      family: step.family,
      preview: step.promptHint,
      countsAsBurst: true,
    })
  }
  return next
}
