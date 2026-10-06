import { ENGINE_05_VERSION } from '../types'
import type { EmpiricalPolicyCandidate, ModelRoutingDecision, PromotionReceipt } from '../evaluation/types'

export type CouncilEngine05Public = {
  schema: typeof ENGINE_05_VERSION
  ebc_canonical: true
  grants_authority: false
  trains_wrim: false
  auto_promotes: false
  benchmark_run?: string | null
  policy_candidate?: string | null
  policy_status?: string | null
  routing?: string | null
  routing_task_class?: string | null
  counterfactual?: string | null
  promotion?: string | null
  commander_status?: string
}

export function attachCouncilEngine05Public(input: {
  benchmark_run?: string | null
  candidate?: EmpiricalPolicyCandidate | null
  routing?: ModelRoutingDecision | null
  counterfactual_id?: string | null
  promotion?: PromotionReceipt | null
  commander_status?: string
}): CouncilEngine05Public {
  return {
    schema: ENGINE_05_VERSION,
    ebc_canonical: true,
    grants_authority: false,
    trains_wrim: false,
    auto_promotes: false,
    benchmark_run: input.benchmark_run ?? null,
    policy_candidate: input.candidate ? `${input.candidate.policy_id}@${input.candidate.version}` : null,
    policy_status: input.candidate?.status ?? null,
    routing: input.routing ? `${input.routing.selected_provider}:${input.routing.selected_model}` : null,
    routing_task_class: input.routing?.task_class ?? null,
    counterfactual: input.counterfactual_id ?? null,
    promotion: input.promotion ? input.promotion.recommendation : null,
    commander_status: input.commander_status,
  }
}
