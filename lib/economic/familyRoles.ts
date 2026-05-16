import type { EconomicFamily, EconomicTelemetryCategory } from '@/lib/economic/types'

export type EconomicFamilyRole = {
  family: EconomicFamily
  label: string
  specialization: string
  routingUse: 'guidance_only'
  telemetryCategories: readonly EconomicTelemetryCategory[]
}

export const ECONOMIC_FAMILY_ROLE_REGISTRY: readonly EconomicFamilyRole[] = [
  {
    family: 'grok',
    label: 'Grok',
    specialization: 'Realtime signals and opportunity scanning',
    routingUse: 'guidance_only',
    telemetryCategories: ['provider_latency', 'opportunity_count', 'routing_violation'],
  },
  {
    family: 'claude',
    label: 'Claude',
    specialization: 'Systems and business architecture',
    routingUse: 'guidance_only',
    telemetryCategories: ['workflow_completion_rate', 'provider_success_failure_rate'],
  },
  {
    family: 'chatgpt',
    label: 'ChatGPT',
    specialization: 'Orchestration, strategy, and synthesis',
    routingUse: 'guidance_only',
    telemetryCategories: ['proposal_generation_volume', 'operational_throughput'],
  },
  {
    family: 'gemini',
    label: 'Gemini',
    specialization: 'Summarization and cross-reference',
    routingUse: 'guidance_only',
    telemetryCategories: ['provider_latency', 'workflow_completion_rate'],
  },
  {
    family: 'red_team',
    label: 'Red Team',
    specialization: 'Contradiction, risk, and fraud analysis',
    routingUse: 'guidance_only',
    telemetryCategories: ['routing_violation', 'provider_success_failure_rate'],
  },
] as const

export const ECONOMIC_FAMILY_ROLE_BY_FAMILY: ReadonlyMap<EconomicFamily, EconomicFamilyRole> =
  new Map(ECONOMIC_FAMILY_ROLE_REGISTRY.map(role => [role.family, role]))

export function getEconomicFamilyRole(family: EconomicFamily): EconomicFamilyRole {
  const role = ECONOMIC_FAMILY_ROLE_BY_FAMILY.get(family)
  if (!role) {
    throw new Error(`Unknown economic family role: ${family}`)
  }
  return role
}
