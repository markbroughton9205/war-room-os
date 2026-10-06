/**
 * Tool Governor — evaluate planned tool actions BEFORE execution.
 * Reuses GI evaluateAuthority + dangerous-action registry. Does not weaken approval.
 * SENTINEL blocking=true forces DENY unless Commander override is explicitly recorded.
 * Models cannot self-approve.
 */

import { evaluateAuthority, lookupAuthorityRow } from '@/lib/council/gi/authorityMatrix'
import { isCanonicalDangerousKind } from '@/lib/permissions/dangerousActionRegistry'
import { isDangerousAction } from '@/lib/permissions/policy'
import type { AtlasPlanStep, GovernorDecision, MissionAuthority, MissionContractV1, SentinelReview } from './types'
import { lookupCapability } from './capabilityRegistry'
import { blockingRisksForStep } from './sentinel'

const CAP_TO_TOOL: Record<string, string> = {
  'system.health': 'wr.core.health',
  'wr.ui.health': 'wr.ui.health',
  'wr.ports.list': 'wr.ports.list',
  'wr.council.backend': 'wr.council.backend',
  'wr.git.branch': 'wr.git.branch',
  'browser.status': 'wr.broker.status',
  'browser.fetch': 'broker.fetch',
  'browser.screenshot': 'broker.screenshot',
  'research.web': 'broker.fetch',
  'git.commit': 'git.commit',
  'git.push': 'git.push',
  'deploy.run': 'deploy.run',
  'finance.spend': 'finance.spend',
  'finance.trade': 'finance.trade',
  'finance.wager': 'finance.wager',
  'finance.settlement_submit': 'finance.settlement_submit',
}

const ALWAYS_DENY = new Set([
  'git.commit',
  'git.push',
  'deploy.run',
  'finance.spend',
  'finance.trade',
  'finance.wager',
  'finance.settlement_submit',
])

function authorityPermits(authority: MissionAuthority, capabilityId: string): boolean {
  if (capabilityId === 'git.commit') return authority.commit
  if (capabilityId === 'git.push') return authority.push
  if (capabilityId === 'deploy.run') return authority.production_deploy
  if (capabilityId === 'finance.spend') return authority.spend
  if (capabilityId === 'finance.trade') return authority.trade
  if (capabilityId === 'finance.wager') return authority.wager
  if (capabilityId === 'finance.settlement_submit') return authority.settlement_submit
  return true
}

export function governStep(input: {
  contract: MissionContractV1
  step: AtlasPlanStep
  capabilityId: string
  sentinel?: SentinelReview | null
  commanderOverride?: boolean
  path?: 'SHORT_PATH' | 'AGENT_PATH' | 'HANDOFF'
}): GovernorDecision {
  const cap = lookupCapability(input.capabilityId)
  const toolId = CAP_TO_TOOL[input.capabilityId] ?? input.capabilityId
  const blocking = input.sentinel ? blockingRisksForStep(input.sentinel, input.step.step_id) : []
  const dangerous = isDangerousAction(toolId) || isCanonicalDangerousKind(toolId) || Boolean(cap?.approval_required || cap?.financial || cap?.production_mutation)
  const override = input.commanderOverride === true && input.contract.authority.commander_override === true

  if (blocking.length && !override) {
    return {
      step_id: input.step.step_id,
      capability_id: input.capabilityId,
      verdict: 'DENY',
      reason: `SENTINEL blocking risk ${blocking[0].risk_id}. Models cannot self-approve.`,
      authority_class: 'REFUSE',
      sentinel_blocking: true,
      commander_override: false,
    }
  }

  if (input.step.status === 'BLOCKED_BY_AUTHORITY' && !override) {
    return {
      step_id: input.step.step_id,
      capability_id: input.capabilityId,
      verdict: dangerous ? 'REQUIRE_COMMANDER_APPROVAL' : 'DENY',
      reason: input.step.blocked_reason ?? 'Blocked by mission authority.',
      authority_class: 'REQUIRE_AUTH',
      sentinel_blocking: false,
      commander_override: false,
    }
  }

  if (!authorityPermits(input.contract.authority, input.capabilityId) || ALWAYS_DENY.has(input.capabilityId) || ALWAYS_DENY.has(toolId)) {
    return {
      step_id: input.step.step_id,
      capability_id: input.capabilityId,
      verdict: override ? 'REQUIRE_COMMANDER_APPROVAL' : 'DENY',
      reason: override
        ? 'Commander override recorded; still requires explicit approval issuance. Not executed here.'
        : 'Mission authority forbids this action. Existing dangerous-action policy preserved.',
      authority_class: override ? 'REQUIRE_AUTH' : 'REFUSE',
      sentinel_blocking: false,
      commander_override: override,
    }
  }

  if (!lookupAuthorityRow(toolId) && cap && cap.read_or_write === 'read' && !dangerous && cap.council_executable) {
    return {
      step_id: input.step.step_id,
      capability_id: input.capabilityId,
      verdict: 'ALLOW',
      reason: 'Indexed read-only capability within existing authority. GI matrix has no row; capability registry is not a parallel authority grant.',
      authority_class: 'OWNABLE',
      sentinel_blocking: false,
      commander_override: false,
    }
  }

  const gi = evaluateAuthority({
    tool_id: toolId,
    path: input.path ?? 'AGENT_PATH',
    capability_available: cap ? cap.health === 'INDEXED' : false,
  })

  if (gi.decision === 'deny' || gi.authority_class === 'REFUSE' || gi.authority_class === 'HOLD') {
    return {
      step_id: input.step.step_id,
      capability_id: input.capabilityId,
      verdict: 'DENY',
      reason: gi.reason,
      authority_class: gi.authority_class,
      sentinel_blocking: false,
      commander_override: false,
    }
  }

  if (gi.decision === 'ask' || gi.authority_class === 'REQUIRE_AUTH' || dangerous) {
    return {
      step_id: input.step.step_id,
      capability_id: input.capabilityId,
      verdict: 'REQUIRE_COMMANDER_APPROVAL',
      reason: gi.reason,
      authority_class: 'REQUIRE_AUTH',
      sentinel_blocking: false,
      commander_override: false,
    }
  }

  if (cap && !cap.council_executable) {
    return {
      step_id: input.step.step_id,
      capability_id: input.capabilityId,
      verdict: 'DENY',
      reason: 'Capability exists but is not Council-executable on this path.',
      authority_class: 'HOLD',
      sentinel_blocking: false,
      commander_override: false,
    }
  }

  return {
    step_id: input.step.step_id,
    capability_id: input.capabilityId,
    verdict: cap?.read_or_write === 'read' ? 'ALLOW' : 'ALLOW_WITH_RECEIPT',
    reason: 'Read-only or receipted action within existing authority.',
    authority_class: 'OWNABLE',
    sentinel_blocking: false,
    commander_override: false,
  }
}

export function governPlan(input: {
  contract: MissionContractV1
  steps: readonly AtlasPlanStep[]
  sentinel?: SentinelReview | null
  commanderOverride?: boolean
}): GovernorDecision[] {
  return input.steps.flatMap(planStep => {
    const caps = planStep.required_capabilities.length ? planStep.required_capabilities : ['_noop']
    return caps.filter(id => id !== '_noop').map(capabilityId => governStep({
      contract: input.contract,
      step: planStep,
      capabilityId,
      sentinel: input.sentinel,
      commanderOverride: input.commanderOverride,
    }))
  })
}
