import type { ShadowEligibilityReason, ShadowEligibilityStatus, ShadowFeatureMode, NormalizedShadowMissionInput } from './shadowTypes'

export type ShadowEligibilityResult = {
  readonly status: ShadowEligibilityStatus
  readonly reason: ShadowEligibilityReason
  readonly eligible: boolean
}

export function resolveShadowFeatureMode(value?: unknown): ShadowFeatureMode {
  if (value === 'disabled' || value === 'diagnostics_only' || value === 'response_metadata') return value
  const envValue = process.env.WAR_ROOM_ADAPTIVE_SHADOW_MODE
  if (envValue === 'disabled' || envValue === 'diagnostics_only' || envValue === 'response_metadata') return envValue
  return 'response_metadata'
}

export function evaluateShadowEligibility(input: {
  featureMode: ShadowFeatureMode
  missionInput: NormalizedShadowMissionInput
  validationOnly?: boolean
  internalSubcall?: boolean
}): ShadowEligibilityResult {
  if (input.featureMode === 'disabled') {
    return { status: 'skipped', reason: 'feature_disabled', eligible: false }
  }
  if (input.validationOnly) {
    return { status: 'skipped', reason: 'validation_only', eligible: false }
  }
  if (input.internalSubcall) {
    return { status: 'ineligible', reason: 'internal_system_request', eligible: false }
  }
  if (input.missionInput.directInvocation) {
    return { status: 'ineligible', reason: 'unsupported_direct_provider_path', eligible: false }
  }
  if (!input.missionInput.commanderMessage.trim()) {
    return { status: 'invalid_input', reason: 'empty_commander_message', eligible: false }
  }
  if (!input.missionInput.missionId || input.missionInput.missionVersion < 1) {
    return { status: 'invalid_input', reason: 'missing_mission_input', eligible: false }
  }
  return { status: 'eligible', reason: 'supported_council_request', eligible: true }
}
