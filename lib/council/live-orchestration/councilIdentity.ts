import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { displayNameForSeat, nebulaAgentForSeat } from '@/lib/council/nebula/identity'
import {
  CLOUD_PROVIDER_LABEL,
  cloudFamilyId,
  cloudStatusLine,
  type ExternalProviderState,
} from '@/lib/council/live-orchestration/councilContinuity'
import { NEBULA_SHARED_LOCAL_MODEL_ID } from '@/lib/council/nebula/modelProfile'

/**
 * Council identity is permanent. Model/provider backends are replaceable resources.
 * IDENTITY != PROVIDER. Missing commercial API keys must never erase AURORA/ORION/PULSAR/LUMEN.
 */

export const CANONICAL_COUNCIL_SEATS = ['chatgpt', 'claude', 'grok', 'gemini'] as const
export type CanonicalCouncilSeat = (typeof CANONICAL_COUNCIL_SEATS)[number]

export const CANONICAL_COUNCIL_IDENTITIES = ['AURORA', 'ORION', 'PULSAR', 'LUMEN'] as const
export type CanonicalCouncilIdentity = (typeof CANONICAL_COUNCIL_IDENTITIES)[number]

export type MemberIdentityStatus = 'READY' | 'PRESENT_BACKEND_UNAVAILABLE'
export type BackingRuntimeStatus = 'LOCAL' | 'EXTERNAL' | 'HYBRID' | 'BACKEND_UNAVAILABLE'
export type BackingRuntimeKind = 'LOCAL_MODEL' | 'EXTERNAL_MODEL' | 'HYBRID' | 'NONE'

export type CouncilMemberIdentityProjection = {
  identityName: string
  identityRole: string
  memberIdentityStatus: MemberIdentityStatus
  backingRuntimeStatus: BackingRuntimeStatus
  backingKind: BackingRuntimeKind
  backingModel: string | null
  backingProvider: string | null
  optionalExternalDetail: string | null
  optionalExternalLine: string | null
  uiStatus: 'READY' | 'UNAVAILABLE'
  uiDetail: string
  backingLine: string
}

export function canonicalIdentityForSeat(family: CouncilOrchestrationFamily): string {
  return nebulaAgentForSeat(family)?.name ?? displayNameForSeat(family, family)
}

export function canonicalRoleForSeat(family: CouncilOrchestrationFamily): string {
  return nebulaAgentForSeat(family)?.role ?? ''
}

export function optionalExternalProviderLabel(family: CouncilOrchestrationFamily): string | null {
  const cloudId = cloudFamilyId(family) ?? (family === 'red_team' ? 'claude' : null)
  return cloudId ? CLOUD_PROVIDER_LABEL[cloudId] : null
}

export function projectCouncilMemberIdentity(input: {
  family: CouncilOrchestrationFamily
  cloudState: ExternalProviderState | null
  localReady: boolean
  localModel?: string | null
}): CouncilMemberIdentityProjection {
  const identityName = canonicalIdentityForSeat(input.family)
  const identityRole = canonicalRoleForSeat(input.family)
  const cloudAvailable = input.cloudState === 'AVAILABLE'
  const hasBacking = cloudAvailable || input.localReady
  const memberIdentityStatus: MemberIdentityStatus = hasBacking ? 'READY' : 'PRESENT_BACKEND_UNAVAILABLE'
  const backingRuntimeStatus: BackingRuntimeStatus = cloudAvailable && input.localReady
    ? 'HYBRID'
    : cloudAvailable
      ? 'EXTERNAL'
      : input.localReady
        ? 'LOCAL'
        : 'BACKEND_UNAVAILABLE'
  const backingKind: BackingRuntimeKind = backingRuntimeStatus === 'HYBRID'
    ? 'HYBRID'
    : backingRuntimeStatus === 'EXTERNAL'
      ? 'EXTERNAL_MODEL'
      : backingRuntimeStatus === 'LOCAL'
        ? 'LOCAL_MODEL'
        : 'NONE'
  const backingProvider = backingRuntimeStatus === 'LOCAL' || backingRuntimeStatus === 'HYBRID'
    ? 'ollama'
    : cloudAvailable
      ? optionalExternalProviderLabel(input.family)
      : null
  const backingModel = input.localReady
    ? (input.localModel ?? NEBULA_SHARED_LOCAL_MODEL_ID)
    : cloudAvailable
      ? (input.localModel ?? 'external')
      : null
  const cloudId = cloudFamilyId(input.family) ?? (input.family === 'red_team' ? 'claude' : null)
  const optionalExternalDetail = cloudId && input.cloudState
    ? cloudStatusLine(cloudId, input.cloudState)
    : null
  const optionalExternalLine = optionalExternalDetail
    ? `Optional external: ${optionalExternalDetail}`
    : null
  const backingLine = backingRuntimeStatus === 'LOCAL' || backingRuntimeStatus === 'HYBRID'
    ? 'Brain: Local Shared General'
    : backingRuntimeStatus === 'EXTERNAL'
      ? 'Brain: External'
      : 'Brain: none'
  return {
    identityName,
    identityRole,
    memberIdentityStatus,
    backingRuntimeStatus,
    backingKind,
    backingModel,
    backingProvider,
    optionalExternalDetail,
    optionalExternalLine,
    uiStatus: hasBacking ? 'READY' : 'UNAVAILABLE',
    uiDetail: hasBacking ? 'READY' : 'BACKEND UNAVAILABLE',
    backingLine,
  }
}

export function identitiesUnchangedAcrossBacking(modelA: string, modelB: string): boolean {
  const a = CANONICAL_COUNCIL_SEATS.map(seat => canonicalIdentityForSeat(seat)).join(',')
  const b = CANONICAL_COUNCIL_SEATS.map(seat => canonicalIdentityForSeat(seat)).join(',')
  return a === b && a === CANONICAL_COUNCIL_IDENTITIES.join(',') && modelA !== modelB
}
