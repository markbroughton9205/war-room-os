import { FAMILY_CAPABILITY_PROFILES } from '@/lib/council/adaptive-assembly/registry'
import { ALL_PROVIDER_FAMILIES, type DirectProviderFamily } from '@/lib/council/providerDirectCall'
import type { ModelTarget } from './types'

const DIRECT_DISPATCHABLE = new Set<string>(ALL_PROVIDER_FAMILIES)

function isDirectProviderFamily(value: string): value is DirectProviderFamily {
  return DIRECT_DISPATCHABLE.has(value)
}

/** Every existing Council FamilyCapabilityProfile, projected into a ModelTarget. All are
 * ACTIVE_MODEL today — Wave 1 introduces the ACTIVE/CANDIDATE distinction as a contract, it does
 * not promote anything to CANDIDATE_MODEL status (see WRIM_CANDIDATE_PLACEHOLDER below, which is
 * descriptive only and never dispatched). */
export function listModelTargets(): ModelTarget[] {
  return FAMILY_CAPABILITY_PROFILES.map(profile => ({
    providerFamily: profile.familyId,
    displayName: profile.displayName,
    tier: 'ACTIVE_MODEL',
    profileVersion: profile.profileVersion,
    availability: profile.availability,
    dispatchable: isDirectProviderFamily(profile.familyId),
  }))
}

export function getModelTarget(familyId: string): ModelTarget | null {
  return listModelTargets().find(t => t.providerFamily === familyId) ?? null
}

/**
 * Descriptive-only placeholder demonstrating the CANDIDATE_MODEL tier the brief asks for (Phase
 * 12/29). This is NOT wired to scripts/sovereign-model-lab in any way — no import, no live
 * routing — and never appears in listModelTargets()/getModelTarget(). It exists purely so the
 * ACTIVE_MODEL/CANDIDATE_MODEL distinction is a real, checkable shape rather than a comment.
 */
export const WRIM_CANDIDATE_PLACEHOLDER: ModelTarget = {
  providerFamily: 'wrim0',
  displayName: 'WRIM-0 (sovereign-model-lab, experimental — not connected)',
  tier: 'CANDIDATE_MODEL',
  profileVersion: 'unversioned',
  availability: 'unavailable',
  dispatchable: false,
}
