import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { displayNameForSeat } from '@/lib/council/nebula/identity'
import {
  classifyCloudProviderState,
  classifyCouncilOperationalState,
  cloudFamilyId,
  cloudStatusLine,
  councilOperationalLabel,
  councilRoutingDisplay,
  EXTERNAL_COUNCIL_PROVIDER_TOTAL,
  modelDiversityLabel,
  type CouncilOperationalState,
  type CouncilRoutingPreference,
  type ExternalProviderState,
  type LocalContinuityState,
  type NetworkEgressState,
  type ResearchProviderState,
} from '@/lib/council/live-orchestration/councilContinuity'
import type { CouncilRoutingMode } from '@/lib/council/live-orchestration/backends/types'

export const COUNCIL_ROSTER_MEMBERSHIP_STATES = [
  'CONFIGURED',
  'ACTIVE',
  'UNAVAILABLE',
  'FAILED_DURING_ROUND',
  'SKIPPED_BY_POLICY',
] as const

export type CouncilRosterMembershipState = (typeof COUNCIL_ROSTER_MEMBERSHIP_STATES)[number]

export const COUNCIL_ROSTER_UNAVAILABLE_REASONS = [
  'UNAVAILABLE_BILLING',
  'UNAVAILABLE_AUTH',
  'UNAVAILABLE_NOT_CONFIGURED',
  'UNAVAILABLE_OTHER',
] as const

export type CouncilRosterUnavailableReason = (typeof COUNCIL_ROSTER_UNAVAILABLE_REASONS)[number]

export type CouncilFamilyRosterEntry = {
  family: CouncilOrchestrationFamily
  configured: boolean
  membership: CouncilRosterMembershipState
  unavailableReason: CouncilRosterUnavailableReason | null
  floorEligible: boolean
  /** Cloud-provider UI status only. Local continuity never paints this READY for a missing vendor. */
  uiStatus: 'READY' | 'UNAVAILABLE'
  uiDetail: string
  /** Cloud credential presence for this seat's historical provider. Independent of local backing. */
  externalConfigured: boolean
  /** Honest cloud-provider state. Null for NOVA (local-only identity). */
  cloudState: ExternalProviderState | null
  localContinuity: LocalContinuityState
  /** Honest backing label: LOCAL vs the named cloud provider. Never claims OpenAI when OpenAI is absent. */
  backing: 'LOCAL' | 'EXTERNAL' | 'NONE'
}

export type CouncilRosterSnapshot = {
  families: Partial<Record<CouncilOrchestrationFamily, CouncilFamilyRosterEntry>>
  activeFloorFamilies: CouncilOrchestrationFamily[]
  intendedPrimaryCount: number
  activePrimaryCount: number
  /** True when Council cannot reason, or a configured backend failed while remainder is usable. */
  degradedByRoster: boolean
  degradedLabel: string
  operationalState: CouncilOperationalState
  operationalLabel: string
  councilOperational: boolean
  councilMode: CouncilOperationalState
  unavailableReason: 'NO_REASONING_BACKEND' | null
  routingPreference: CouncilRoutingPreference
  routingModeResolved: CouncilRoutingMode
  routingDisplay: 'LOCAL' | 'HYBRID' | 'EXTERNAL' | 'UNAVAILABLE'
  externalConfigured: number
  externalAvailable: number
  externalProviderCount: { configured: number; available: number; total: number }
  localAvailable: boolean
  localModel: string | null
  localCouncil: { ready: boolean; novaReady: boolean; label: string }
  modelDiversity: string
  terraConnection: 'CONNECTED' | 'DISCONNECTED' | 'UNKNOWN'
  networkEgress: NetworkEgressState
  researchProviders: ResearchProviderState
  redTeam: 'ACTIVE' | 'SKIPPED_BY_POLICY' | 'UNAVAILABLE'
}

export type RosterPolicyOverride = Partial<Record<CouncilOrchestrationFamily, string>>

export type RosterContinuityInput = {
  localReady?: boolean
  localModel?: string | null
  routingPreference?: CouncilRoutingPreference
  routingModeResolved?: CouncilRoutingMode
  terraConnection?: CouncilRosterSnapshot['terraConnection']
  networkEgress?: NetworkEgressState
  researchProviders?: ResearchProviderState
}

const PRIMARY_FAMILIES: CouncilOrchestrationFamily[] = ['chatgpt', 'claude', 'grok', 'gemini']

const EMPTY_CONTINUITY: Required<RosterContinuityInput> = {
  localReady: false,
  localModel: null,
  routingPreference: 'AUTO',
  routingModeResolved: 'LOCAL_FIRST',
  terraConnection: 'UNKNOWN',
  networkEgress: 'UNKNOWN',
  researchProviders: 'CONFIG_NEEDED',
}

export function parseRosterOverride(raw: string | undefined | null): string | null {
  if (!raw) return null
  const v = raw.trim().toUpperCase().replace(/\s+/g, '_')
  return v || null
}

export function familyUiLabel(family: CouncilOrchestrationFamily): string {
  if (family === 'baby') return 'Baby'
  if (family === 'bridge_architect') return 'Bridge Architect'
  return displayNameForSeat(family, family)
}

function cloudIdForFamily(family: CouncilOrchestrationFamily): 'chatgpt' | 'claude' | 'grok' | 'gemini' | null {
  return cloudFamilyId(family) ?? (family === 'red_team' ? 'claude' : null)
}

function unavailableReasonFromCloud(state: ExternalProviderState | null, configured: boolean): CouncilRosterUnavailableReason | null {
  if (state === 'BILLING_BLOCKED') return 'UNAVAILABLE_BILLING'
  if (state === 'AUTH_FAILED') return 'UNAVAILABLE_AUTH'
  if (!configured || state === 'NOT_CONFIGURED') return 'UNAVAILABLE_NOT_CONFIGURED'
  if (state === 'AVAILABLE') return null
  return 'UNAVAILABLE_OTHER'
}

function entryFromPolicy(input: {
  family: CouncilOrchestrationFamily
  configured: boolean
  override: string | null
  localReady?: boolean
}): CouncilFamilyRosterEntry {
  const { family, configured, override, localReady } = input
  const cloudId = cloudIdForFamily(family)
  const cloudState = cloudId ? classifyCloudProviderState({ configured, override }) : null
  const cloudAvailable = cloudState === 'AVAILABLE'
  const localContinuity: LocalContinuityState = localReady ? 'AVAILABLE' : 'UNAVAILABLE'
  const floorEligible = cloudAvailable || Boolean(localReady)
  const backing: CouncilFamilyRosterEntry['backing'] = cloudAvailable ? 'EXTERNAL' : localReady ? 'LOCAL' : 'NONE'
  const uiStatus: CouncilFamilyRosterEntry['uiStatus'] = cloudAvailable ? 'READY' : 'UNAVAILABLE'
  const uiDetail = cloudId && cloudState
    ? cloudStatusLine(cloudId, cloudState)
    : localReady
      ? 'Local · READY'
      : 'Local · UNAVAILABLE'
  const membership: CouncilRosterMembershipState = cloudAvailable
    ? 'ACTIVE'
    : override === 'SKIPPED_BY_POLICY'
      ? 'SKIPPED_BY_POLICY'
      : localReady
        ? 'ACTIVE'
        : 'UNAVAILABLE'

  return {
    family,
    configured,
    membership,
    unavailableReason: unavailableReasonFromCloud(cloudState, configured),
    floorEligible,
    uiStatus,
    uiDetail,
    externalConfigured: configured,
    cloudState,
    localContinuity,
    backing,
  }
}

function attachContinuity(
  snapshot: Omit<
    CouncilRosterSnapshot,
    | 'operationalState'
    | 'operationalLabel'
    | 'councilOperational'
    | 'councilMode'
    | 'unavailableReason'
    | 'routingPreference'
    | 'routingModeResolved'
    | 'routingDisplay'
    | 'externalConfigured'
    | 'externalAvailable'
    | 'externalProviderCount'
    | 'localAvailable'
    | 'localModel'
    | 'localCouncil'
    | 'modelDiversity'
    | 'terraConnection'
    | 'networkEgress'
    | 'researchProviders'
    | 'degradedByRoster'
    | 'degradedLabel'
  > & {
    degradedByRoster?: boolean
    degradedLabel?: string
  },
  continuity: RosterContinuityInput,
): CouncilRosterSnapshot {
  const localReady = Boolean(continuity.localReady)
  const routingPreference = continuity.routingPreference ?? EMPTY_CONTINUITY.routingPreference
  const routingModeResolved = continuity.routingModeResolved ?? EMPTY_CONTINUITY.routingModeResolved
  const primary = PRIMARY_FAMILIES.map(family => snapshot.families[family])
  const externalConfiguredCount = primary.filter(entry => entry?.externalConfigured).length
  const externalAvailableCount = primary.filter(entry => entry?.cloudState === 'AVAILABLE').length
  const configuredProviderFailed = primary.some(
    entry =>
      Boolean(entry?.externalConfigured)
      && entry?.cloudState != null
      && entry.cloudState !== 'AVAILABLE'
      && entry.cloudState !== 'NOT_CONFIGURED'
      && entry.cloudState !== 'DISABLED',
  )
  const operationalState = classifyCouncilOperationalState({
    externalConfiguredCount,
    externalAvailableCount,
    localReady,
    configuredProviderFailed,
  })
  const operationalLabel = councilOperationalLabel(operationalState)
  const novaReady = snapshot.families.nova?.uiStatus === 'READY' || localReady
  const unavailable = operationalState === 'UNAVAILABLE'
  const degradedPartial = operationalState === 'DEGRADED_PARTIAL'
  return {
    ...snapshot,
    operationalState,
    operationalLabel,
    councilOperational: !unavailable,
    councilMode: operationalState,
    unavailableReason: unavailable ? 'NO_REASONING_BACKEND' : null,
    routingPreference,
    routingModeResolved,
    routingDisplay: councilRoutingDisplay(routingModeResolved, operationalState),
    externalConfigured: externalConfiguredCount,
    externalAvailable: externalAvailableCount,
    externalProviderCount: {
      configured: externalConfiguredCount,
      available: externalAvailableCount,
      total: EXTERNAL_COUNCIL_PROVIDER_TOTAL,
    },
    localAvailable: localReady,
    localModel: continuity.localModel ?? null,
    localCouncil: {
      ready: localReady,
      novaReady,
      label: novaReady ? 'NOVA · READY' : localReady ? 'LOCAL · READY' : 'UNAVAILABLE',
    },
    modelDiversity: modelDiversityLabel({ externalAvailableCount, localReady }),
    terraConnection: continuity.terraConnection ?? 'UNKNOWN',
    networkEgress: continuity.networkEgress ?? 'UNKNOWN',
    researchProviders: continuity.researchProviders ?? 'CONFIG_NEEDED',
    degradedByRoster: unavailable || degradedPartial,
    degradedLabel: operationalLabel,
  }
}

export function buildCouncilRosterSnapshot(input: {
  configured: Partial<Record<CouncilOrchestrationFamily, boolean>>
  overrides?: RosterPolicyOverride
  continuity?: RosterContinuityInput
}): CouncilRosterSnapshot {
  const localReady = Boolean(input.continuity?.localReady)
  const families: Partial<Record<CouncilOrchestrationFamily, CouncilFamilyRosterEntry>> = {}
  const claudeOverride = parseRosterOverride(input.overrides?.claude)
  const grokOverride = parseRosterOverride(input.overrides?.grok)
  const chatgptOverride = parseRosterOverride(input.overrides?.chatgpt)
  const geminiOverride = parseRosterOverride(input.overrides?.gemini)
  const redOverride = parseRosterOverride(input.overrides?.red_team)

  families.chatgpt = entryFromPolicy({ family: 'chatgpt', configured: Boolean(input.configured.chatgpt), override: chatgptOverride, localReady })
  families.claude = entryFromPolicy({ family: 'claude', configured: Boolean(input.configured.claude), override: claudeOverride, localReady })
  families.grok = entryFromPolicy({ family: 'grok', configured: Boolean(input.configured.grok), override: grokOverride, localReady })
  families.gemini = entryFromPolicy({ family: 'gemini', configured: Boolean(input.configured.gemini), override: geminiOverride, localReady })

  const claudeActive = families.claude?.floorEligible === true
  let redTeam: CouncilRosterSnapshot['redTeam'] = 'UNAVAILABLE'
  if (!input.configured.red_team && !input.configured.claude && !localReady) {
    families.red_team = entryFromPolicy({ family: 'red_team', configured: false, override: null, localReady })
    redTeam = 'UNAVAILABLE'
  } else if (redOverride === 'ACTIVE' && claudeActive) {
    families.red_team = entryFromPolicy({ family: 'red_team', configured: true, override: 'ACTIVE', localReady })
    redTeam = 'ACTIVE'
  } else if (!claudeActive && !localReady) {
    families.red_team = {
      family: 'red_team',
      configured: Boolean(input.configured.red_team ?? input.configured.claude),
      membership: 'SKIPPED_BY_POLICY',
      unavailableReason: families.claude?.unavailableReason ?? 'UNAVAILABLE_OTHER',
      floorEligible: false,
      uiStatus: 'UNAVAILABLE',
      uiDetail: cloudStatusLine('claude', families.claude?.cloudState ?? 'UNKNOWN'),
      externalConfigured: Boolean(input.configured.red_team ?? input.configured.claude),
      cloudState: families.claude?.cloudState ?? 'UNKNOWN',
      localContinuity: 'UNAVAILABLE',
      backing: 'NONE',
    }
    redTeam = 'SKIPPED_BY_POLICY'
  } else {
    families.red_team = entryFromPolicy({
      family: 'red_team',
      configured: Boolean(input.configured.red_team || input.configured.claude),
      override: redOverride,
      localReady,
    })
    redTeam = families.red_team.floorEligible ? 'ACTIVE' : 'UNAVAILABLE'
  }

  families.nova = {
    family: 'nova',
    configured: true,
    membership: localReady ? 'ACTIVE' : 'UNAVAILABLE',
    unavailableReason: localReady ? null : 'UNAVAILABLE_OTHER',
    floorEligible: localReady,
    uiStatus: localReady ? 'READY' : 'UNAVAILABLE',
    uiDetail: localReady ? 'Local · READY' : 'Local · UNAVAILABLE',
    externalConfigured: false,
    cloudState: null,
    localContinuity: localReady ? 'AVAILABLE' : 'UNAVAILABLE',
    backing: localReady ? 'LOCAL' : 'NONE',
  }

  const activeFloorFamilies = PRIMARY_FAMILIES.filter(family => families[family]?.floorEligible)
  const intendedPrimaryCount = PRIMARY_FAMILIES.length
  const activePrimaryCount = activeFloorFamilies.length

  return attachContinuity(
    {
      families,
      activeFloorFamilies,
      intendedPrimaryCount,
      activePrimaryCount,
      redTeam,
    },
    input.continuity ?? EMPTY_CONTINUITY,
  )
}

export function rosterToFloorFlags(snapshot: CouncilRosterSnapshot): {
  configured: Partial<Record<CouncilOrchestrationFamily, boolean>>
  eligible: Partial<Record<CouncilOrchestrationFamily, boolean>>
} {
  const configured: Partial<Record<CouncilOrchestrationFamily, boolean>> = {}
  const eligible: Partial<Record<CouncilOrchestrationFamily, boolean>> = {}
  for (const family of ['chatgpt', 'claude', 'grok', 'gemini', 'red_team', 'nova', 'baby'] as CouncilOrchestrationFamily[]) {
    configured[family] = Boolean(snapshot.families[family]?.configured)
    eligible[family] = Boolean(snapshot.families[family]?.floorEligible)
  }
  return { configured, eligible }
}

const DISPLAY_OVERRIDE_FAMILIES: CouncilOrchestrationFamily[] = [...PRIMARY_FAMILIES, 'red_team']

/**
 * Display overlay for local routing. Cloud vendor lines stay honest (NOT CONFIGURED / AUTH FAILED).
 * Local continuity is a separate field. Execution floor eligibility may become true without
 * painting AURORA as OpenAI READY.
 */
export function withNebulaLocalDisplayOverride(
  snapshot: CouncilRosterSnapshot,
  locallyEnabled: Partial<Record<CouncilOrchestrationFamily, boolean>>,
  continuity?: RosterContinuityInput,
): CouncilRosterSnapshot {
  const families = { ...snapshot.families }
  const localReady = Boolean(continuity?.localReady ?? Object.values(locallyEnabled).some(Boolean))
  for (const family of DISPLAY_OVERRIDE_FAMILIES) {
    const row = families[family]
    if (!row || !locallyEnabled[family] || !localReady) continue
    if (row.cloudState === 'AVAILABLE') continue
    families[family] = {
      ...row,
      floorEligible: true,
      membership: row.membership === 'SKIPPED_BY_POLICY' ? 'SKIPPED_BY_POLICY' : 'ACTIVE',
      localContinuity: 'AVAILABLE',
      backing: 'LOCAL',
    }
  }
  if (families.nova) {
    families.nova = {
      ...families.nova,
      floorEligible: localReady,
      uiStatus: localReady ? 'READY' : 'UNAVAILABLE',
      uiDetail: localReady ? 'Local · READY' : 'Local · UNAVAILABLE',
      backing: localReady ? 'LOCAL' : 'NONE',
      localContinuity: localReady ? 'AVAILABLE' : 'UNAVAILABLE',
      membership: localReady ? 'ACTIVE' : 'UNAVAILABLE',
    }
  }
  const activeFloorFamilies = PRIMARY_FAMILIES.filter(family => families[family]?.floorEligible)
  const activePrimaryCount = activeFloorFamilies.length
  const redTeam: CouncilRosterSnapshot['redTeam'] = families.red_team?.floorEligible ? 'ACTIVE' : snapshot.redTeam
  return attachContinuity(
    {
      ...snapshot,
      families,
      activeFloorFamilies,
      activePrimaryCount,
      redTeam,
    },
    {
      localReady,
      localModel: continuity?.localModel ?? snapshot.localModel,
      routingPreference: continuity?.routingPreference ?? snapshot.routingPreference,
      routingModeResolved: continuity?.routingModeResolved ?? snapshot.routingModeResolved,
      terraConnection: continuity?.terraConnection ?? snapshot.terraConnection,
      networkEgress: continuity?.networkEgress ?? snapshot.networkEgress,
      researchProviders: continuity?.researchProviders ?? snapshot.researchProviders,
    },
  )
}

export function compactFamilyRosterLine(snapshot: CouncilRosterSnapshot): string {
  const cloud = `External ${snapshot.externalProviderCount.configured}/${snapshot.externalProviderCount.total} configured`
  const local = `Local ${snapshot.localCouncil.label}`
  const routing = `Routing ${snapshot.routingDisplay}`
  const diversity = `Diversity ${snapshot.modelDiversity}`
  const terra = `Terra ${snapshot.terraConnection}`
  const internet = `Internet ${snapshot.networkEgress}`
  return `${snapshot.operationalLabel} · ${cloud} · ${local} · ${routing} · ${diversity} · ${terra} · ${internet}`
}

export type RosterMemberPresentation = {
  tone: 'ready' | 'needs_key' | 'quota' | 'error' | 'unavailable' | 'degraded' | 'offline'
  label: string
  localLine: string | null
}

export function rosterMemberPresentation(entry: CouncilFamilyRosterEntry): RosterMemberPresentation {
  if (entry.family === 'nova') {
    return {
      tone: entry.uiStatus === 'READY' ? 'ready' : 'unavailable',
      label: entry.uiDetail,
      localLine: null,
    }
  }
  const localLine = entry.localContinuity === 'AVAILABLE' ? 'Local continuity · AVAILABLE' : 'Local continuity · UNAVAILABLE'
  if (entry.cloudState === 'AVAILABLE') {
    return { tone: 'ready', label: entry.uiDetail, localLine }
  }
  if (entry.cloudState === 'NOT_CONFIGURED') {
    return { tone: 'needs_key', label: entry.uiDetail, localLine }
  }
  if (entry.cloudState === 'BILLING_BLOCKED') {
    return { tone: 'quota', label: entry.uiDetail, localLine }
  }
  if (entry.cloudState === 'AUTH_FAILED' || entry.cloudState === 'NETWORK_ERROR' || entry.cloudState === 'PROVIDER_ERROR') {
    return { tone: 'error', label: entry.uiDetail, localLine }
  }
  if (entry.cloudState === 'DISABLED') {
    return { tone: 'offline', label: entry.uiDetail, localLine }
  }
  return { tone: 'unavailable', label: entry.uiDetail, localLine }
}
