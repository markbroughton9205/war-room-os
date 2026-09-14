import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { displayNameForSeat } from '@/lib/council/nebula/identity'
import {
  councilEntityHeadline,
} from '@/lib/council/nebula/entityPresence'
import { NEBULA_SHARED_LOCAL_MODEL_ID } from '@/lib/council/nebula/modelProfile'
import {
  projectCouncilMemberIdentity,
  type BackingRuntimeKind,
  type BackingRuntimeStatus,
  type MemberIdentityStatus,
} from '@/lib/council/live-orchestration/councilIdentity'
import {
  classifyCloudProviderState,
  classifyCouncilOperationalState,
  cloudFamilyId,
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
  /** Entity-facing status. READY when any usable backing exists. Independent of cloud keys. */
  uiStatus: 'READY' | 'UNAVAILABLE'
  /** Entity status label: READY or BACKEND UNAVAILABLE. Never a vendor name. */
  uiDetail: string
  identityName: string
  identityRole: string
  memberIdentityStatus: MemberIdentityStatus
  backingRuntimeStatus: BackingRuntimeStatus
  backingKind: BackingRuntimeKind
  backingModel: string | null
  backingProvider: string | null
  backingLine: string
  /** Cloud credential presence for this seat's optional historical provider. Independent of entity health. */
  externalConfigured: boolean
  /** Honest cloud-provider state. Null for NOVA (local-only identity). */
  cloudState: ExternalProviderState | null
  optionalExternalDetail: string | null
  optionalExternalLine: string | null
  localContinuity: LocalContinuityState
  /** Honest backing label: LOCAL vs EXTERNAL vs none. Never claims OpenAI when OpenAI is absent. */
  backing: 'LOCAL' | 'EXTERNAL' | 'HYBRID' | 'NONE'
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
  reasoningDiversity: string
  entityHeadline: string
  entityReadyCount: number
  entityPresentCount: number
  /** GPU/runtime execution truth. Distinct from entity identity readiness. */
  backendExecutionState:
    | 'COUNCIL_READY'
    | 'COUNCIL_BACKEND_LOADING'
    | 'COUNCIL_WAITING_FOR_GPU'
    | 'COUNCIL_DEGRADED'
    | 'COUNCIL_BACKEND_UNAVAILABLE'
    | 'COUNCIL_EXECUTING'
    | 'COUNCIL_SYNTHESIZING'
  backendExecutionLabel: string
  gpuOwner: 'FOUNDRY_CODER' | 'COUNCIL_BACKEND' | 'WRIM_FUTURE' | 'OTHER_LOCAL_MODELS' | 'NONE'
  backingIntelligence: { label: string; ready: boolean; model: string | null }
  knowledgeAccess: 'AVAILABLE'
  internetAccess: NetworkEgressState
  terraAccess: 'CONNECTED' | 'DISCONNECTED' | 'UNKNOWN'
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
  localModel?: string | null
}): CouncilFamilyRosterEntry {
  const { family, configured, override, localReady, localModel } = input
  const cloudId = cloudIdForFamily(family)
  const cloudState = cloudId ? classifyCloudProviderState({ configured, override }) : null
  const cloudAvailable = cloudState === 'AVAILABLE'
  const localContinuity: LocalContinuityState = localReady ? 'AVAILABLE' : 'UNAVAILABLE'
  const floorEligible = cloudAvailable || Boolean(localReady)
  const identity = projectCouncilMemberIdentity({
    family,
    cloudState,
    localReady: Boolean(localReady),
    localModel,
  })
  const backing: CouncilFamilyRosterEntry['backing'] =
    identity.backingRuntimeStatus === 'HYBRID'
      ? 'HYBRID'
      : identity.backingRuntimeStatus === 'EXTERNAL'
        ? 'EXTERNAL'
        : identity.backingRuntimeStatus === 'LOCAL'
          ? 'LOCAL'
          : 'NONE'
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
    uiStatus: identity.uiStatus,
    uiDetail: identity.uiDetail,
    identityName: identity.identityName,
    identityRole: identity.identityRole,
    memberIdentityStatus: identity.memberIdentityStatus,
    backingRuntimeStatus: identity.backingRuntimeStatus,
    backingKind: identity.backingKind,
    backingModel: identity.backingModel,
    backingProvider: identity.backingProvider,
    backingLine: identity.backingLine,
    externalConfigured: configured,
    cloudState,
    optionalExternalDetail: identity.optionalExternalDetail,
    optionalExternalLine: identity.optionalExternalLine,
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
    | 'reasoningDiversity'
    | 'entityHeadline'
    | 'entityReadyCount'
    | 'entityPresentCount'
    | 'backendExecutionState'
    | 'backendExecutionLabel'
    | 'gpuOwner'
    | 'backingIntelligence'
    | 'knowledgeAccess'
    | 'internetAccess'
    | 'terraAccess'
    | 'terraConnection'
    | 'networkEgress'
    | 'researchProviders'
    | 'degradedByRoster'
    | 'degradedLabel'
  > & {
    degradedByRoster?: boolean
    degradedLabel?: string
    backendExecutionState?: CouncilRosterSnapshot['backendExecutionState']
    backendExecutionLabel?: string
    gpuOwner?: CouncilRosterSnapshot['gpuOwner']
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
  const entityPresentCount = PRIMARY_FAMILIES.length
  const entityReadyCount = primary.filter(entry => entry?.memberIdentityStatus === 'READY').length
  const diversity = modelDiversityLabel({ externalAvailableCount, localReady })
  const backendAvailable = localReady || externalAvailableCount > 0
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
      label: novaReady ? 'NOVA READY' : localReady ? 'LOCAL READY' : 'UNAVAILABLE',
    },
    modelDiversity: diversity,
    reasoningDiversity: localReady || externalAvailableCount > 0 ? 'ROLE_DIVERSE' : 'NONE',
    entityHeadline: councilEntityHeadline(backendAvailable),
    entityReadyCount,
    entityPresentCount,
    backendExecutionState: snapshot.backendExecutionState
      ?? (backendAvailable ? 'COUNCIL_READY' : 'COUNCIL_BACKEND_UNAVAILABLE'),
    backendExecutionLabel: snapshot.backendExecutionLabel
      ?? (backendAvailable ? 'READY' : 'UNAVAILABLE'),
    gpuOwner: snapshot.gpuOwner ?? (localReady ? 'COUNCIL_BACKEND' : 'NONE'),
    backingIntelligence: {
      label: localReady ? 'War Room Local' : externalAvailableCount > 0 ? 'External' : 'None',
      ready: backendAvailable,
      model: localReady ? (continuity.localModel ?? NEBULA_SHARED_LOCAL_MODEL_ID) : null,
    },
    knowledgeAccess: 'AVAILABLE',
    internetAccess: continuity.networkEgress ?? 'UNKNOWN',
    terraAccess: continuity.terraConnection ?? 'UNKNOWN',
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

  const localModel = input.continuity?.localModel ?? null
  families.chatgpt = entryFromPolicy({ family: 'chatgpt', configured: Boolean(input.configured.chatgpt), override: chatgptOverride, localReady, localModel })
  families.claude = entryFromPolicy({ family: 'claude', configured: Boolean(input.configured.claude), override: claudeOverride, localReady, localModel })
  families.grok = entryFromPolicy({ family: 'grok', configured: Boolean(input.configured.grok), override: grokOverride, localReady, localModel })
  families.gemini = entryFromPolicy({ family: 'gemini', configured: Boolean(input.configured.gemini), override: geminiOverride, localReady, localModel })

  const claudeActive = families.claude?.floorEligible === true
  let redTeam: CouncilRosterSnapshot['redTeam'] = 'UNAVAILABLE'
  if (!input.configured.red_team && !input.configured.claude && !localReady) {
    families.red_team = entryFromPolicy({ family: 'red_team', configured: false, override: null, localReady, localModel })
    redTeam = 'UNAVAILABLE'
  } else if (redOverride === 'ACTIVE' && claudeActive) {
    families.red_team = entryFromPolicy({ family: 'red_team', configured: true, override: 'ACTIVE', localReady, localModel })
    redTeam = 'ACTIVE'
  } else if (!claudeActive && !localReady) {
    families.red_team = {
      family: 'red_team',
      configured: Boolean(input.configured.red_team ?? input.configured.claude),
      membership: 'SKIPPED_BY_POLICY',
      unavailableReason: families.claude?.unavailableReason ?? 'UNAVAILABLE_OTHER',
      floorEligible: false,
      ...projectCouncilMemberIdentity({
        family: 'red_team',
        cloudState: families.claude?.cloudState ?? 'UNKNOWN',
        localReady: false,
        localModel,
      }),
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
      localModel,
    })
    redTeam = families.red_team.floorEligible ? 'ACTIVE' : 'UNAVAILABLE'
  }

  families.nova = {
    family: 'nova',
    configured: true,
    membership: localReady ? 'ACTIVE' : 'UNAVAILABLE',
    unavailableReason: localReady ? null : 'UNAVAILABLE_OTHER',
    floorEligible: localReady,
    ...projectCouncilMemberIdentity({
      family: 'nova',
      cloudState: null,
      localReady,
      localModel,
    }),
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
 * Display overlay for local routing. Entity stays named and READY when local backing exists.
 * Optional cloud vendor lines stay honest (NOT CONFIGURED / AUTH FAILED) and never replace identity.
 */
export function withNebulaLocalDisplayOverride(
  snapshot: CouncilRosterSnapshot,
  locallyEnabled: Partial<Record<CouncilOrchestrationFamily, boolean>>,
  continuity?: RosterContinuityInput,
): CouncilRosterSnapshot {
  const families = { ...snapshot.families }
  const localReady = Boolean(continuity?.localReady ?? Object.values(locallyEnabled).some(Boolean))
  const localModel = continuity?.localModel ?? snapshot.localModel
  for (const family of DISPLAY_OVERRIDE_FAMILIES) {
    const row = families[family]
    if (!row || !locallyEnabled[family] || !localReady) continue
    if (row.cloudState === 'AVAILABLE') continue
    const identity = projectCouncilMemberIdentity({
      family,
      cloudState: row.cloudState,
      localReady: true,
      localModel,
    })
    families[family] = {
      ...row,
      ...identity,
      floorEligible: true,
      membership: row.membership === 'SKIPPED_BY_POLICY' ? 'SKIPPED_BY_POLICY' : 'ACTIVE',
      localContinuity: 'AVAILABLE',
      backing: identity.backingRuntimeStatus === 'HYBRID' ? 'HYBRID' : 'LOCAL',
    }
  }
  if (families.nova) {
    const identity = projectCouncilMemberIdentity({
      family: 'nova',
      cloudState: null,
      localReady,
      localModel,
    })
    families.nova = {
      ...families.nova,
      ...identity,
      floorEligible: localReady,
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
      localModel,
      routingPreference: continuity?.routingPreference ?? snapshot.routingPreference,
      routingModeResolved: continuity?.routingModeResolved ?? snapshot.routingModeResolved,
      terraConnection: continuity?.terraConnection ?? snapshot.terraConnection,
      networkEgress: continuity?.networkEgress ?? snapshot.networkEgress,
      researchProviders: continuity?.researchProviders ?? snapshot.researchProviders,
    },
  )
}

export function compactFamilyRosterLine(snapshot: CouncilRosterSnapshot): string {
  const members = snapshot.operationalState === 'UNAVAILABLE'
    ? `COUNCIL ENTITIES: ${snapshot.entityPresentCount} PRESENT`
    : `COUNCIL ENTITIES: ${snapshot.entityReadyCount}/${snapshot.entityPresentCount} READY`
  const backend = `BACKEND: ${snapshot.backendExecutionLabel}`
  const backing = !snapshot.localAvailable && snapshot.externalAvailable <= 0
    ? 'Backing BACKEND_UNAVAILABLE'
    : snapshot.localAvailable && snapshot.externalAvailable <= 0
      ? 'Backing Local sovereign runtime'
      : snapshot.localAvailable
        ? 'Backing Hybrid'
        : 'Backing External'
  const diversity = `Diversity ${snapshot.reasoningDiversity}`
  const external = `External ${snapshot.externalProviderCount.configured}/${snapshot.externalProviderCount.total} configured`
  const terra = `Terra ${snapshot.terraAccess}`
  const internet = snapshot.internetAccess === 'UNAVAILABLE'
    ? 'LIVE INTERNET UNAVAILABLE'
    : `Internet ${snapshot.internetAccess}`
  return `${snapshot.entityHeadline} · ${members} · ${backend} · ${backing} · ${diversity} · ${external} · ${terra} · ${internet}`
}

export type CommanderStatusTone = 'nominal' | 'active' | 'degraded' | 'offline'

export type CommanderStatusPill = {
  id: 'council' | 'terra' | 'intelligence' | 'systems'
  kicker: string
  label: string
  tone: CommanderStatusTone
}

/** Compact Commander-facing status. Technical roster strings stay in Inspector. */
export function commanderStatusCluster(
  snapshot: CouncilRosterSnapshot | null | undefined,
  extras?: { researchActive?: boolean; systemsOk?: boolean },
): CommanderStatusPill[] {
  const councilDegraded = snapshot?.operationalState === 'DEGRADED_PARTIAL' || Boolean(snapshot?.degradedByRoster)
  const councilOffline = !snapshot || snapshot.operationalState === 'UNAVAILABLE'
  const councilOnline = Boolean(snapshot?.councilOperational) && !councilOffline && !councilDegraded
  const terraLinked = snapshot?.terraAccess === 'CONNECTED'
  const terraOffline = snapshot?.terraAccess === 'DISCONNECTED'
  const researchActive = Boolean(extras?.researchActive)
  const internetDown = snapshot?.internetAccess === 'UNAVAILABLE'
  const systemsOk = extras?.systemsOk ?? (!councilOffline && !internetDown && !councilDegraded)

  return [
    {
      id: 'council',
      kicker: 'Council',
      label: councilOffline ? 'OFFLINE' : councilDegraded ? 'DEGRADED' : 'ONLINE',
      tone: councilOffline ? 'offline' : councilDegraded ? 'degraded' : councilOnline ? 'nominal' : 'degraded',
    },
    {
      id: 'terra',
      kicker: 'Terra',
      label: terraOffline ? 'OFFLINE' : terraLinked ? 'LINKED' : 'STANDBY',
      tone: terraOffline ? 'offline' : terraLinked ? 'nominal' : 'active',
    },
    {
      id: 'intelligence',
      kicker: 'Intelligence',
      label: internetDown ? 'OFFLINE' : researchActive ? 'ACTIVE' : 'READY',
      tone: internetDown ? 'offline' : researchActive ? 'active' : 'nominal',
    },
    {
      id: 'systems',
      kicker: 'Systems',
      label: systemsOk ? 'NOMINAL' : councilOffline ? 'OFFLINE' : 'WATCH',
      tone: systemsOk ? 'nominal' : councilOffline ? 'offline' : 'degraded',
    },
  ]
}

export type CommanderPresencePhase = 'idle' | 'understanding' | 'researching' | 'verifying' | 'synthesizing'

export function resolveCommanderPresencePhase(input: {
  loading?: boolean
  councilState?: string | null
  nebulaStatus?: string | null
  researchMode?: string | null
  researchPhase?: string | null
}): CommanderPresencePhase {
  const research = input.researchMode ?? ''
  const nebula = (input.nebulaStatus ?? '').toUpperCase()
  if (research === 'completing' || input.researchPhase === 'model_running' || (research === 'verified' && input.loading)) {
    return nebula === 'SYNTHESIZING' || input.councilState === 'active' ? 'synthesizing' : 'verifying'
  }
  if (research === 'active' || research === 'sources_queried' || input.councilState === 'researching') return 'researching'
  if (nebula === 'SYNTHESIZING') return 'synthesizing'
  if (nebula === 'PLANNING' || nebula === 'EXECUTING') return 'understanding'
  if (input.loading) return 'understanding'
  return 'idle'
}

export type RosterMemberPresentation = {
  tone: 'ready' | 'needs_key' | 'quota' | 'error' | 'unavailable' | 'degraded' | 'offline'
  label: string
  localLine: string | null
  optionalExternalLine: string | null
}

export function rosterMemberPresentation(entry: CouncilFamilyRosterEntry): RosterMemberPresentation {
  const optionalExternalLine = entry.optionalExternalLine
  const localLine = entry.backingLine
  if (entry.memberIdentityStatus === 'READY') {
    return {
      tone: 'ready',
      label: 'READY',
      localLine,
      optionalExternalLine,
    }
  }
  return {
    tone: 'unavailable',
    label: 'BACKEND UNAVAILABLE',
    localLine,
    optionalExternalLine,
  }
}
