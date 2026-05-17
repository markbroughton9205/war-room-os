import type { AutomationModeDefinition } from './automationModeRegistry'
import type { ExecutionDomainDefinition, QueuePressureState } from './executionDomainRegistry'
import type { ExecutionRiskScore } from './executionRiskScoring'

export type AutomationThrottleState = {
  domainId: ExecutionDomainDefinition['id']
  modeId: AutomationModeDefinition['id']
  state: 'open' | 'limited' | 'cooldown' | 'paused' | 'emergency_shutdown'
  queuePressure: QueuePressureState
  maxConcurrent: number
  cooldownMinutes: number
  maxRetries: number
  degradationTriggers: string[]
  pauseReasons: string[]
}

export function deriveAutomationThrottleState(
  domain: ExecutionDomainDefinition,
  mode: AutomationModeDefinition,
  risk: ExecutionRiskScore,
): AutomationThrottleState {
  const queuePressure: QueuePressureState = risk.score >= 75 ? 'high' : risk.score >= 55 ? 'watch' : 'normal'
  const pauseReasons = [
    risk.blockers.length ? risk.blockers.join(' ') : null,
    risk.score >= 85 ? 'Emergency shutdown threshold reached.' : null,
    domain.financialLimits.executionFrequencyPerHour <= 0 ? 'Execution frequency is zero.' : null,
  ].filter((item): item is string => Boolean(item))
  const state = risk.score >= 85
    ? 'emergency_shutdown'
    : pauseReasons.length
      ? 'paused'
      : queuePressure === 'high'
        ? 'cooldown'
        : queuePressure === 'watch'
          ? 'limited'
          : 'open'

  return {
    domainId: domain.id,
    modeId: mode.id,
    state,
    queuePressure,
    maxConcurrent: state === 'open' ? domain.throttleProfile.maxConcurrent : Math.max(1, domain.throttleProfile.maxConcurrent - 1),
    cooldownMinutes: queuePressure === 'normal' ? domain.throttleProfile.cooldownMinutes : domain.throttleProfile.cooldownMinutes * 2,
    maxRetries: queuePressure === 'normal' ? domain.throttleProfile.maxRetries : 1,
    degradationTriggers: [
      'Contradiction spike',
      'Repeated failures',
      'Stale doctrine',
      'Invalid memory scope',
      'Excessive retries',
      'Escalating risk',
    ],
    pauseReasons,
  }
}
