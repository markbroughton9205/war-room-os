import { classifyAstraIntent } from '@/lib/council/nebula/roundFlow'
import { classifyResearchDomain, matchedDomains } from '@/lib/research/researchDomainRouter'
import type { NebulaAgentId } from '@/lib/council/nebula/identity'
import {
  GEOGRAPHIC_REGIONS,
  REPORT_KIND_BY_AGENT,
  SWARM_SEAT_BY_AGENT,
  type AstraMissionPlan,
  type FrozenSeatReport,
  type GeographicRegion,
  type SeatAssignment,
  type SourceTerritory,
} from './types'

function createMissionId(roundRequestId: string): string {
  return `mission-${roundRequestId}`
}

const REGION_HINTS: Array<{ region: GeographicRegion; pattern: RegExp }> = [
  { region: 'NORTH_AMERICA', pattern: /\b(north america|united states|u\.s\.|canada|mexico|fmcsa)\b/i },
  { region: 'LATIN_AMERICA', pattern: /\b(latin america|south america|brazil|chile|argentina)\b/i },
  { region: 'EUROPE', pattern: /\b(europe|eu\b|european union|germany|france|netherlands)\b/i },
  { region: 'AFRICA', pattern: /\b(africa|nigeria|kenya|south africa)\b/i },
  { region: 'MIDDLE_EAST', pattern: /\b(middle east|gulf|israel|uae|saudi)\b/i },
  { region: 'EAST_ASIA', pattern: /\b(east asia|china|japan|korea|taiwan|semiconductor)\b/i },
  { region: 'SOUTH_ASIA', pattern: /\b(south asia|india|bangladesh|pakistan)\b/i },
  { region: 'OCEANIA', pattern: /\b(oceania|australia|new zealand)\b/i },
]

function detectRegions(text: string): GeographicRegion[] {
  const hits = REGION_HINTS.filter(item => item.pattern.test(text)).map(item => item.region)
  const globalAsk = /\b(global|worldwide|by region|regional|across regions|supply chains?)\b/i.test(text)
  if (globalAsk) {
    const core: GeographicRegion[] = ['NORTH_AMERICA', 'EAST_ASIA', 'EUROPE']
    return uniqueRegions([...core, ...hits]).slice(0, 5)
  }
  return uniqueRegions(hits)
}

function uniqueRegions(regions: GeographicRegion[]): GeographicRegion[] {
  return [...new Set(regions)]
}

function uniqueAgents(ids: Array<Exclude<NebulaAgentId, 'astra'>>): Array<Exclude<NebulaAgentId, 'astra'>> {
  return [...new Set(ids)]
}

function isEngineeringMission(text: string): boolean {
  return classifyAstraIntent(text) === 'ENGINEERING' || /\bengineering\b/i.test(text) || (/\bwar room\b/i.test(text) && /\b(risk|runtime|telemetry|repo)\b/i.test(text))
}

function engineeringExternalCurrent(text: string): boolean {
  return /\b(cve|advisory|outage|vendor (?:status|incident)|upstream (?:release|regression))\b/i.test(text)
}

function selectSeats(text: string): Array<Exclude<NebulaAgentId, 'astra'>> {
  const intent = classifyAstraIntent(text)
  if (isEngineeringMission(text)) {
    const seats: Array<Exclude<NebulaAgentId, 'astra'>> = ['orion', 'lumen', 'phoenix', 'aurora']
    if (engineeringExternalCurrent(text)) seats.splice(1, 0, 'pulsar')
    return uniqueAgents(seats)
  }
  if (intent === 'STATUS_CHECK' || intent === 'SOCIAL') return ['aurora']
  if (intent === 'STRATEGY') return ['nova', 'phoenix', 'solara', 'lumen', 'aurora']
  if (intent === 'HUMAN_IMPACT') return ['solara', 'nova', 'lumen', 'aurora']
  if (intent === 'VERIFICATION') return ['lumen', 'pulsar', 'phoenix', 'aurora']
  // Serious research / comprehensive / default swarm research
  return ['pulsar', 'orion', 'lumen', 'phoenix', 'nova', 'solara', 'aurora']
}

function assignmentFor(
  agentId: Exclude<NebulaAgentId, 'astra'>,
  decree: string,
  regions: GeographicRegion[],
  liveResearch: boolean,
): SeatAssignment {
  const seat = SWARM_SEAT_BY_AGENT[agentId]
  const base = {
    agentId,
    seat,
    liveResearch,
    kimiStored: liveResearch || /\b(prior|stored|kimi)\b/i.test(decree),
    regions: agentId === 'pulsar' ? regions : [],
    auroraDiscovery: false,
  }
  if (agentId === 'pulsar') {
    return {
      ...base,
      objective: `Independently gather current evidence for: ${decree}. Do not conclude from another seat. Prefer primary/regulatory sources in your PRIMARY_SOURCE scouts and industry reporting separately.`,
      sourceTerritory: 'government_regulator',
      scoutTypes: regions.length
        ? ['PRIMARY_SOURCE', 'WEB_CURRENT', 'INDUSTRY', ...regions.slice(0, 3)]
        : ['PRIMARY_SOURCE', 'WEB_CURRENT', 'INDUSTRY'],
    }
  }
  if (agentId === 'orion') {
    const local = isEngineeringMission(decree)
    return {
      ...base,
      liveResearch: local ? false : liveResearch,
      kimiStored: !local,
      objective: local
        ? `Independently evaluate War Room operational/technical truth for: ${decree}. Prefer local runtime, repo, and telemetry over public web.`
        : `Independently evaluate operational/technical consequences of: ${decree}. Do not inherit another seat's conclusion.`,
      sourceTerritory: 'operational_local',
      scoutTypes: local ? ['RUNTIME', 'REPO', 'TEST', 'PROVIDER'] : ['RUNTIME', 'DATA', 'EXTERNAL_DOCS'],
    }
  }
  if (agentId === 'lumen') {
    return {
      ...base,
      objective: `Independently determine whether the evidence actually supports the Commander's question: ${decree}. Do not see another seat's conclusion before freeze. Corporate filings are not federal regulation.`,
      sourceTerritory: 'authoritative_confirmation',
      scoutTypes: ['PRIMARY_VERIFY', 'AUTHORITY_CHECK', 'DATE_FRESHNESS'],
    }
  }
  if (agentId === 'phoenix') {
    return {
      ...base,
      objective: `Independently search for what would make the emerging answer wrong for: ${decree}. Look for alternate explanations such as corporate disclosures mistaken for regulation. Do not wait for another seat's draft.`,
      sourceTerritory: 'contradictory_alternate',
      scoutTypes: ['DISPROVE', 'ALTERNATIVE_EXPLANATION', 'SOURCE_ATTACK'],
    }
  }
  if (agentId === 'nova') {
    return {
      ...base,
      liveResearch: false,
      objective: `Independently develop multiple strategic paths for: ${decree}. Do not wait for verified constraints from other seats during discovery; mark assumptions as unverified.`,
      sourceTerritory: 'strategic_scenarios',
      scoutTypes: ['PATH_A', 'PATH_B', 'CONSTRAINTS'],
    }
  }
  if (agentId === 'solara') {
    return {
      ...base,
      liveResearch: false,
      objective: `Independently evaluate practical impact on small operators, labor, cost, and access for: ${decree}. Distinguish official evidence, research, reported experience, anecdote, and model inference.`,
      sourceTerritory: 'human_impact',
      scoutTypes: ['SMALL_BUSINESS', 'COST', 'LABOR'],
    }
  }
  return {
    ...base,
    liveResearch: false,
    kimiStored: false,
    auroraDiscovery: false,
    objective: 'Wait for frozen independent reports. Do not run discovery scouts unless the mission explicitly requires isolated Aurora research.',
    sourceTerritory: 'authoritative_confirmation',
    scoutTypes: [],
  }
}

export function decomposeAstraMission(input: {
  decree: string
  roundRequestId: string
  logicalRequestId: string
  nowIso?: string
}): AstraMissionPlan {
  const decree = input.decree.trim()
  const createdAt = input.nowIso ?? new Date().toISOString()
  const intent = classifyAstraIntent(decree)
  const domains = matchedDomains(decree)
  const domainLabel = classifyResearchDomain(decree)
  const regions = detectRegions(decree)
  const engineering = isEngineeringMission(decree)
  const liveResearchRequired = !engineering && (
    /\b(this week|today|latest|current|breaking|changed|developments?)\b/i.test(decree)
    || intent === 'RESEARCH'
    || intent === 'VERIFICATION'
    || intent === 'COMPREHENSIVE'
    || domainLabel !== 'GENERAL_CURRENT'
  )
  const selected = selectSeats(decree)
  const assignments = selected.map(agentId => assignmentFor(
    agentId,
    decree,
    regions,
    agentId === 'orion' && engineering ? false : liveResearchRequired,
  ))

  return {
    missionId: createMissionId(input.roundRequestId),
    roundRequestId: input.roundRequestId,
    logicalRequestId: input.logicalRequestId,
    commanderDecree: decree,
    createdAt,
    domains: domains.length ? domains : [domainLabel],
    freshnessRequirement: liveResearchRequired ? 'live' : engineering ? 'none' : 'any',
    geographicScope: regions.length > 2 ? 'global' : regions.length ? 'regional' : /\b(u\.s\.|united states|federal)\b/i.test(decree) ? 'national' : 'none',
    sourceClassesNeeded: liveResearchRequired
      ? ['government_public_data', 'news', 'industry', 'live_web']
      : engineering
        ? ['runtime_telemetry', 'repo']
        : ['model_judgment'],
    selectedPermanentSeats: selected,
    assignments,
    unresolvedQuestions: [
      liveResearchRequired ? 'Has an authoritative source actually confirmed a change, or only adjacent reporting?' : '',
      engineering ? 'Which operational claims are backed by live telemetry vs inference?' : '',
    ].filter(Boolean),
    likelyContradictionTargets: [
      /\bregulat/i.test(decree) ? 'Corporate SEC filings mistaken for a federal regulation change' : '',
      /\bhealthy|fine|green\b/i.test(decree) ? 'Unsupported operational health claims' : '',
    ].filter(Boolean),
    liveResearchRequired,
    kimiStoredRequired: liveResearchRequired,
    regionalScatter: regions,
    astraProvidesSubstantiveAnswer: false,
    notes: [
      'ASTRA coordinates only and does not provide the substantive answer.',
      'Assignments do not include another seat\'s conclusion.',
      regions.length ? `Regional scatter: ${regions.join(', ')}` : 'No regional scatter — geographic breadth not required.',
      engineering && !engineeringExternalCurrent(decree)
        ? 'PULSAR live-web research is not assigned for this War Room engineering question.'
        : '',
    ].filter(Boolean),
  }
}

export function freezeAstraMissionReport(plan: AstraMissionPlan): FrozenSeatReport {
  return {
    report_id: `report-astra-${plan.missionId}`,
    report_kind: REPORT_KIND_BY_AGENT.astra,
    mission_id: plan.missionId,
    roundRequestId: plan.roundRequestId,
    logicalRequestId: plan.logicalRequestId,
    seat: 'astra',
    agentId: 'astra',
    createdAt: plan.createdAt,
    frozen_at: plan.createdAt,
    phase: 'POSITION_FREEZE',
    assignment: 'Decompose the Commander decree into isolated seat assignments. Do not answer the substance.',
    conclusion: [
      `Mission ${plan.missionId}: ${plan.commanderDecree}`,
      `Seats: ${plan.selectedPermanentSeats.join(', ')}`,
      ...plan.assignments.map(item => `${item.agentId.toUpperCase()}: ${item.objective}`),
      plan.regionalScatter.length ? `Regions: ${plan.regionalScatter.join(', ')}` : 'Regions: none',
    ].join('\n'),
    evidence_ids: [],
    confidence: 1,
    uncertainties: plan.unresolvedQuestions,
    contradictions: plan.likelyContradictionTargets,
    unanswered_questions: plan.unresolvedQuestions,
    scout_summary: 'ASTRA launched no discovery scouts.',
    immutable: true,
  }
}

export function discoveryAgents(plan: AstraMissionPlan): Array<Exclude<NebulaAgentId, 'astra' | 'aurora'>> {
  return plan.selectedPermanentSeats.filter((id): id is Exclude<NebulaAgentId, 'astra' | 'aurora'> => id !== 'aurora')
}

export function assignmentForAgent(plan: AstraMissionPlan, agentId: NebulaAgentId): SeatAssignment | null {
  return plan.assignments.find(item => item.agentId === agentId) ?? null
}

export function astraDidNotAnswerSubstance(plan: AstraMissionPlan, report: FrozenSeatReport): boolean {
  return plan.astraProvidesSubstantiveAnswer === false
    && report.agentId === 'astra'
    && !/\btherefore the answer is\b/i.test(report.conclusion)
}
