import { detectEngineeringIntentFromDecree, type EngineeringIntentDetection } from './engineeringTaskPacket'

export type EngineeringCapability =
  | 'synthesis'
  | 'architecture'
  | 'code_repair'
  | 'risk_review'
  | 'task_decomposition'
  | 'diff_explanation'
  | 'rollback_planning'

export type EngineeringCapabilityRoute = {
  capability: EngineeringCapability
  primary: string
  fallback: string
  unavailableMessage: string
}

export const ENGINEERING_CAPABILITY_ROUTES: EngineeringCapabilityRoute[] = [
  {
    capability: 'synthesis',
    primary: 'ChatGPT Baby',
    fallback: 'Cursor task packet',
    unavailableMessage: 'Use cloud provider synthesis or Cursor packet fallback.',
  },
  {
    capability: 'architecture',
    primary: 'Claude',
    fallback: 'Claude Baby or Cursor task packet',
    unavailableMessage: 'Prepare Cursor packet and optional Claude review prompt.',
  },
  {
    capability: 'code_repair',
    primary: 'Cursor',
    fallback: 'Claude architecture review plus Red Team risk review',
    unavailableMessage: 'No autonomous code executor is enabled. Cursor manual task packet is the safe fallback.',
  },
  {
    capability: 'risk_review',
    primary: 'Red Team',
    fallback: 'Red Team Baby',
    unavailableMessage: 'Route risk checklist into Cursor packet.',
  },
  {
    capability: 'task_decomposition',
    primary: 'Cloud council family',
    fallback: 'Cursor task packet checklist',
    unavailableMessage: 'Include task decomposition in Cursor packet.',
  },
  {
    capability: 'diff_explanation',
    primary: 'Cursor validation return format',
    fallback: 'Cursor validation return format',
    unavailableMessage: 'Ask Cursor executor for diff explanation.',
  },
  {
    capability: 'rollback_planning',
    primary: 'Repair ledger rollback recommendation',
    fallback: 'Repair ledger rollback recommendation',
    unavailableMessage: 'Rollback planning route unavailable; use packet rollback recommendation.',
  },
]

export type EngineeringRoutingDecision = {
  engineeringIntent: EngineeringIntentDetection
  primaryCapability: EngineeringCapability
  assignedExecutor: 'cursor'
  assignedExecutorLabel: 'Cursor'
  status: 'prepared'
  approvalRequired: true
  routes: EngineeringCapabilityRoute[]
  missingProviderFallbacks: string[]
}

function primaryCapabilityForIntent(intent: EngineeringIntentDetection): EngineeringCapability {
  if (intent.intentKind === 'code_audit') return 'risk_review'
  if (intent.intentKind === 'validation') return 'diff_explanation'
  if (intent.intentKind === 'build_feature' || intent.intentKind === 'wire_integration') return 'task_decomposition'
  return 'code_repair'
}

export function routeEngineeringCapabilityFromDecree(decree: string): EngineeringRoutingDecision | null {
  const engineeringIntent = detectEngineeringIntentFromDecree(decree)
  if (!engineeringIntent.isEngineeringIntent) return null
  const primaryCapability = primaryCapabilityForIntent(engineeringIntent)

  return {
    engineeringIntent,
    primaryCapability,
    assignedExecutor: 'cursor',
    assignedExecutorLabel: 'Cursor',
    status: 'prepared',
    approvalRequired: true,
    routes: ENGINEERING_CAPABILITY_ROUTES,
    missingProviderFallbacks: ENGINEERING_CAPABILITY_ROUTES.map(route => route.unavailableMessage),
  }
}
