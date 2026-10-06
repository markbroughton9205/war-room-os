/**
 * ENGINE-05 live bind. Routing before context dispatch. No AURORA clutter unless asked.
 * Does not grant authority. Does not auto-promote.
 */
import { attachCouncilEngine05Public, type CouncilEngine05Public } from '../integration/executive05'
import { inferTaskClass, routeModelProvider } from '../routing-eval/engine'
import { fingerprintPolicy } from '../promotion/engine'
import type { ModelRoutingDecision, PrivacyClass } from '../evaluation/types'

export function parseEngine05Command(text: string):
  | 'why_model'
  | 'would_tool'
  | 'is_policy_better'
  | 'promote'
  | 'rollback'
  | null {
  const t = text.trim()
  if (/\bwhy did you use this model\b/i.test(t) || /\bwhy (?:this|that) model\b/i.test(t)) return 'why_model'
  if (/\bwould another tool have been better\b/i.test(t)) return 'would_tool'
  if (/\bis this new policy actually better\b/i.test(t)) return 'is_policy_better'
  if (/\bpromote this policy\b/i.test(t)) return 'promote'
  if (/\brollback (?:this |the )?policy\b/i.test(t)) return 'rollback'
  return null
}

export function bindEngine05ToLive(input: {
  mission_id: string
  commanderMessage: string
  role?: string
  privacy?: PrivacyClass
  localAvailable?: boolean
  cloudAvailable?: boolean
  lastRouting?: ModelRoutingDecision | null
}): {
  engines05: CouncilEngine05Public
  routing: ModelRoutingDecision
  execute_live: true
} {
  const cmd = parseEngine05Command(input.commanderMessage)
  const task_class = inferTaskClass(input.commanderMessage)
  const routing = routeModelProvider({
    mission_id: input.mission_id,
    task_class,
    role: input.role ?? 'ORION',
    privacy: input.privacy ?? (/\blocal(?:-only)?\b|private/i.test(input.commanderMessage) ? 'LOCAL' : 'INTERNAL'),
    localAvailable: input.localAvailable ?? true,
    cloudAvailable: input.cloudAvailable ?? true,
    persist: false,
  })
  let commander_status: string | undefined
  if (cmd === 'why_model') {
    commander_status = `Routing receipt: ${routing.selected_provider}:${routing.selected_model} task_class=${routing.task_class} reasons=${routing.reason_codes.join(',')} blocked=${routing.blocked}`
  } else if (cmd === 'would_tool') {
    commander_status = 'Counterfactual tool evaluation is an evaluation artifact, not an EBC fact. Open Inspector Engine 05 when a replay exists.'
  } else if (cmd === 'is_policy_better') {
    commander_status = 'Policy comparison requires a versioned benchmark vs the production baseline. No automatic promotion.'
  } else if (cmd === 'promote') {
    commander_status = `Promotion requires explicit Commander approval fingerprint. Example bind: policy_id|version|params. Current routing fingerprint helper=${fingerprintPolicy('pending', '0', {
      prefer_independent_primary: true,
      max_parallel: 3,
      context_token_budget: 512,
      retry_transient: true,
      memory_first: true,
      privacy: 'CLOUD_OK',
      routing_task_specific: true,
    })}. Not auto-promoted.`
  } else if (cmd === 'rollback') {
    commander_status = 'Rollback retains evaluation history. Production policy is unchanged until Commander-approved promotion exists.'
  }
  return {
    engines05: attachCouncilEngine05Public({
      routing,
      commander_status,
    }),
    routing,
    execute_live: true,
  }
}
