/**
 * Council <-> Terra / Terra World / Higher Vision Studios.
 * Every capability maps to an interface that exists in this install. A capability is only AVAILABLE when a probe just proved it; a
 * probe that fails or times out is UNAVAILABLE/DEGRADED with the reason. Nothing here writes, spends, publishes or mutates.
 */
export type SubsystemId = 'terra' | 'terra_world' | 'hvs'
export type CapabilityStatus = 'AVAILABLE' | 'DEGRADED' | 'UNAVAILABLE'

export type SubsystemCapability = {
  id: string
  label: string
  description: string
  /** the real interface behind it (route or library) so the claim can be checked */
  interface: string
  /** read-only capabilities are the only ones Stage 2 exposes */
  access: 'READ_ONLY'
  status: CapabilityStatus
  reason: string
  /** a small, bounded fact from the probe (counts, versions); never raw payloads */
  facts: Record<string, string | number | boolean | null>
  probedAt: string
  externalDependency: boolean
}

export type SubsystemState = {
  id: SubsystemId
  label: string
  summary: string
  status: CapabilityStatus
  capabilities: SubsystemCapability[]
  /** what Council deliberately cannot do through this connection */
  notExposed: string[]
}

export const SUBSYSTEM_LABELS: Record<SubsystemId, string> = {
  terra: 'Terra',
  terra_world: 'Terra World',
  hvs: 'Higher Vision Studios',
}
