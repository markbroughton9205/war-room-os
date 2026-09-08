import type { NebulaAgentId } from '@/lib/council/nebula/identity'
import { googleNewsLocaleForRegion, primaryProviderIdsForRegion, regionHasPrimaryPublicEndpoint } from '@/lib/research/sourceTerritories'
import { admitScout, createScoutGovernor, type ScoutGovernor } from './governor'
import { applyResearchProfile } from './researchProfiles'
import type {
  AstraMissionPlan,
  GeographicRegion,
  ScoutGovernorLimits,
  ScoutPlan,
  ScoutType,
  SeatAssignment,
  SourceTerritory,
} from './types'

function scoutId(agentId: string, type: ScoutType, index: number, roundRequestId: string): string {
  return `scout-${agentId}-${type}-${index + 1}-${roundRequestId.slice(-8)}`
}

function territoryQuery(assignment: SeatAssignment, scoutType: ScoutType, decree: string): string {
  const base = decree.trim()
  const tag = `${assignment.agentId.toUpperCase()} ${scoutType}`
  if (scoutType === 'PRIMARY_SOURCE') {
    return `${tag}: ${base} official government regulator Federal Register FMCSA USDOT rule change`
  }
  if (scoutType === 'PRIMARY_VERIFY') {
    return `${tag}: ${base} authoritative confirmation Federal Register eCFR FMCSA`
  }
  if (scoutType === 'INDUSTRY') {
    return `${tag}: ${base} freight brokerage trade publication Transport Topics Overdrive`
  }
  if (scoutType === 'WEB_CURRENT') {
    return `${tag}: ${base} current news this week live reporting`
  }
  if (scoutType === 'ACADEMIC') return `${tag}: ${base} academic research paper`
  if (scoutType === 'HISTORICAL') return `${tag}: ${base} historical background prior rule`
  if (scoutType === 'CONTRADICTION') return `${tag}: ${base} contradictory reporting`
  if (scoutType === 'DISPROVE') return `${tag}: ${base} evidence disproving a regulation change`
  if (scoutType === 'ALTERNATIVE_EXPLANATION') {
    return `${tag}: ${base} SEC filing corporate disclosure mistaken for regulation`
  }
  if (scoutType === 'SOURCE_ATTACK') return `${tag}: ${base} source-authority attack secondary vs primary`
  if (scoutType === 'AUTHORITY_CHECK') return `${tag}: ${base} source authority primary vs secondary confirmation`
  if (scoutType === 'DATE_FRESHNESS') return `${tag}: ${base} published date this week effective date`
  if (scoutType === 'RUNTIME' || scoutType === 'REPO' || scoutType === 'TEST' || scoutType === 'PROVIDER') {
    return `${tag}: War Room local ${scoutType.toLowerCase()} evidence for: ${base}`
  }
  if (scoutType === 'PATH_A') return `${tag}: Strategic path A (act now) implications of: ${base}`
  if (scoutType === 'PATH_B') return `${tag}: Strategic path B (wait for confirmation) implications of: ${base}`
  if (scoutType === 'CONSTRAINTS') return `${tag}: Verified constraints and blockers for: ${base}`
  if (scoutType === 'SMALL_BUSINESS' || scoutType === 'COST' || scoutType === 'LABOR') {
    return `${tag}: Small broker/operator ${scoutType.toLowerCase()} impact of: ${base}`
  }
  if (isRegion(scoutType)) {
    const locale = googleNewsLocaleForRegion(scoutType)
    const primaries = primaryProviderIdsForRegion(scoutType)
    const honest = regionHasPrimaryPublicEndpoint(scoutType)
      ? `primary public sources: ${primaries.join(', ')}`
      : 'no supported regional-primary public endpoint; do not claim primary coverage'
    return `${tag}: ${base} current developments in ${regionLabel(scoutType)} [${honest}; query_language=${locale.queryLanguage}]`
  }
  return `${tag}: ${base} [${assignment.sourceTerritory}]`
}

function isRegion(type: ScoutType): type is GeographicRegion {
  return [
    'NORTH_AMERICA', 'LATIN_AMERICA', 'EUROPE', 'AFRICA',
    'MIDDLE_EAST', 'EAST_ASIA', 'SOUTH_ASIA', 'OCEANIA',
  ].includes(type)
}

function regionLabel(region: GeographicRegion): string {
  return region.replace(/_/g, ' ').toLowerCase()
}

function territoryForScout(assignment: SeatAssignment, scoutType: ScoutType): SourceTerritory {
  if (isRegion(scoutType)) return 'regional_public'
  if (scoutType === 'INDUSTRY' || scoutType === 'WEB_CURRENT') return 'trade_publications'
  if (scoutType === 'DISPROVE' || scoutType === 'ALTERNATIVE_EXPLANATION' || scoutType === 'SOURCE_ATTACK' || scoutType === 'CONTRADICTION') {
    return 'contradictory_alternate'
  }
  if (scoutType === 'PRIMARY_VERIFY' || scoutType === 'AUTHORITY_CHECK') return 'authoritative_confirmation'
  if (scoutType === 'RUNTIME' || scoutType === 'REPO' || scoutType === 'TEST' || scoutType === 'PROVIDER') return 'operational_local'
  if (scoutType === 'PATH_A' || scoutType === 'PATH_B' || scoutType === 'CONSTRAINTS') return 'strategic_scenarios'
  if (scoutType === 'SMALL_BUSINESS' || scoutType === 'COST' || scoutType === 'LABOR') return 'human_impact'
  return assignment.sourceTerritory
}

export function planSeatScouts(input: {
  plan: AstraMissionPlan
  assignment: SeatAssignment
  governor: ScoutGovernor
}): ScoutPlan[] {
  const out: ScoutPlan[] = []
  if (input.assignment.agentId === 'aurora' && !input.assignment.auroraDiscovery) return out
  input.assignment.scoutTypes.forEach((scoutType, index) => {
    const query = territoryQuery(input.assignment, scoutType, input.plan.commanderDecree)
    const scout: ScoutPlan = {
      scoutId: scoutId(input.assignment.agentId, scoutType, index, input.plan.roundRequestId),
      scoutType,
      seatId: input.assignment.seat,
      agentId: input.assignment.agentId,
      missionId: input.plan.missionId,
      roundRequestId: input.plan.roundRequestId,
      logicalRequestId: input.plan.logicalRequestId,
      query,
      assignment: input.assignment.objective,
      region: isRegion(scoutType) ? scoutType : undefined,
      sourceTerritory: territoryForScout(input.assignment, scoutType),
      spawnDepth: 1,
      languageAccess: isRegion(scoutType) && googleNewsLocaleForRegion(scoutType).queryLanguage !== 'en' ? 'native' : 'native',
      preferLocalTruth: input.assignment.agentId === 'orion',
      executeLive: input.assignment.liveResearch && input.assignment.agentId !== 'orion' && (
        index < 3
        || isRegion(scoutType)
        || scoutType === 'PRIMARY_VERIFY'
        || scoutType === 'DISPROVE'
        || scoutType === 'ALTERNATIVE_EXPLANATION'
      ),
      queryLanguage: isRegion(scoutType) ? googleNewsLocaleForRegion(scoutType).queryLanguage : 'en',
      preferredProviders: isRegion(scoutType) ? primaryProviderIdsForRegion(scoutType) : undefined,
    }
    const admitted = admitScout(input.governor, scout)
    if (admitted.ok) out.push(scout)
  })
  return out
}

export function planRoundScouts(plan: AstraMissionPlan, limits?: ScoutGovernorLimits): {
  governor: ScoutGovernor
  scouts: ScoutPlan[]
} {
  const governor = createScoutGovernor(limits ?? applyResearchProfile(undefined, plan.researchProfile))
  const scouts: ScoutPlan[] = []
  for (const assignment of plan.assignments) {
    scouts.push(...planSeatScouts({ plan, assignment, governor }))
  }
  return { governor, scouts }
}

export function scoutQueriesAreIndependent(scouts: ScoutPlan[]): boolean {
  const queries = scouts.map(item => item.query.trim().toLowerCase())
  return queries.length === 0 || new Set(queries).size === queries.length
}

export function scoutsAreEphemeral(scouts: ScoutPlan[]): boolean {
  return scouts.every(item => item.spawnDepth === 1 && !/^(aurora|nova|pulsar|phoenix|orion|lumen|solara|astra)$/i.test(item.scoutId))
}

export function pulsarDidNotShareQueryPlan(scouts: ScoutPlan[], otherAgent: NebulaAgentId): boolean {
  const pulsar = scouts.filter(item => item.agentId === 'pulsar').map(item => item.query)
  const other = scouts.filter(item => item.agentId === otherAgent).map(item => item.query)
  if (!pulsar.length || !other.length) return true
  return pulsar.every(query => !other.includes(query))
}
