/**
 * Single-purpose MetaHuman likeness cloud authority.
 * BUILD RA'EL does not grant this. Only AUTHORIZE & BUILD LIKENESS does.
 */
import { randomUUID } from 'node:crypto'
import {
  HVS_CLOUD_PAYLOAD_CATEGORY,
  HVS_METAHUMAN_LIKENESS_AUTHORITY_TYPE,
  HVS_METAHUMAN_LIKENESS_PROVIDER,
  HVS_METAHUMAN_LIKENESS_SCOPE,
  HVS_RAEL_ASSEMBLY_INTENT,
  HVS_RAEL_PRODUCTION_CHARACTER_ID,
  type HvsMetaHumanLikenessAuthority,
} from './types'
import { readLikenessAuthority, writeLikenessAuthority } from './persist'

export const LIKENESS_AUTHORITY_PURPOSE = "Create Ra'el's MetaHuman likeness via official Epic MetaHuman auto-rig / conform. This authorization is only for creating Ra'el's MetaHuman likeness."

export function createLikenessAuthority(input: {
  projectId: string
  characterId?: string
  now: string
}): HvsMetaHumanLikenessAuthority {
  const existing = readLikenessAuthority(input.projectId, input.characterId ?? HVS_RAEL_PRODUCTION_CHARACTER_ID)
  if (existing?.scope === HVS_METAHUMAN_LIKENESS_SCOPE && existing.authorityType === HVS_METAHUMAN_LIKENESS_AUTHORITY_TYPE) {
    return existing
  }
  const authority: HvsMetaHumanLikenessAuthority = {
    authorizationId: `auth-${randomUUID()}`,
    authorityType: HVS_METAHUMAN_LIKENESS_AUTHORITY_TYPE,
    projectId: input.projectId,
    characterId: input.characterId ?? HVS_RAEL_PRODUCTION_CHARACTER_ID,
    provider: HVS_METAHUMAN_LIKENESS_PROVIDER,
    scope: HVS_METAHUMAN_LIKENESS_SCOPE,
    assemblyIntent: HVS_RAEL_ASSEMBLY_INTENT,
    trainingAllowed: false,
    voiceAllowed: false,
    faceRecognitionAllowed: false,
    publicUploadAllowed: false,
    marketplaceAllowed: false,
    spendAllowed: false,
    authorizedAt: input.now,
    authorizedBy: 'commander',
    purpose: LIKENESS_AUTHORITY_PURPOSE,
    inputCategories: [HVS_CLOUD_PAYLOAD_CATEGORY, 'RELATED_CONFORM_MESHES', 'TEXTURE_SYNTHESIS_DERIVED_MAPS'],
    singlePurpose: true,
  }
  writeLikenessAuthority(authority)
  return authority
}

export function hasLikenessAuthority(projectId: string, characterId = HVS_RAEL_PRODUCTION_CHARACTER_ID): boolean {
  const authority = readLikenessAuthority(projectId, characterId)
  return Boolean(
    authority
    && authority.authorityType === HVS_METAHUMAN_LIKENESS_AUTHORITY_TYPE
    && authority.scope === HVS_METAHUMAN_LIKENESS_SCOPE
    && authority.trainingAllowed === false
    && authority.voiceAllowed === false
    && authority.faceRecognitionAllowed === false
    && authority.spendAllowed === false
    && authority.singlePurpose === true
  )
}
