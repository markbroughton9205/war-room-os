import type { LocalTaskCategory } from '@/lib/local-agent/types'
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
  localTaskCategory: LocalTaskCategory
  unavailableMessage: string
}

export const ENGINEERING_CAPABILITY_ROUTES: EngineeringCapabilityRoute[] = [
  {
    capability: 'synthesis',
    primary: 'ChatGPT Baby',
    fallback: 'Cursor task packet',
    localTaskCategory: 'synthesis',
    unavailableMessage: 'Missing functional local synthesis model; use Cursor packet fallback.',
  },
  {
    capability: 'architecture',
    primary: 'Claude',
    fallback: 'Claude Baby or Cursor task packet',
    localTaskCategory: 'architecture',
    unavailableMessage: 'Claude/local architecture route unavailable; prepare Cursor packet and optional Claude review prompt.',
  },
  {
    capability: 'code_repair',
    primary: 'Cursor',
    fallback: 'Local Code Agent Bridge if explicitly configured',
    localTaskCategory: 'coding-review',
    unavailableMessage: 'No autonomous code executor is enabled. Cursor manual task packet is the safe fallback.',
  },
  {
    capability: 'risk_review',
    primary: 'Red Team',
    fallback: 'Red Team Baby',
    localTaskCategory: 'risk-analysis',
    unavailableMessage: 'Red Team local model unavailable; route risk checklist into Cursor packet.',
  },
  {
    capability: 'task_decomposition',
    primary: 'Kimi Baby',
    fallback: 'Cursor task packet checklist',
    localTaskCategory: 'planning',
    unavailableMessage: 'Kimi local model unavailable; include task decomposition in Cursor packet.',
  },
  {
    capability: 'diff_explanation',
    primary: 'Bridge Architect Baby',
    fallback: 'Cursor validation return format',
    localTaskCategory: 'diff-review',
    unavailableMessage: 'Bridge Architect local model unavailable; ask Cursor executor for diff explanation.',
  },
  {
    capability: 'rollback_planning',
    primary: 'Bridge Architect Baby',
    fallback: 'Repair ledger rollback recommendation',
    localTaskCategory: 'qa-review',
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
