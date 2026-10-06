import type { HvsCharacterContinuityWarning, HvsDigitalHuman, HvsDigitalHumanStore } from './types'
import { dhId } from './types'

export function runCharacterQc(store: HvsDigitalHumanStore): HvsCharacterContinuityWarning[] {
  const warnings: HvsCharacterContinuityWarning[] = []
  const ids = new Map<string, number>()
  for (const human of store.characters) {
    ids.set(human.id, (ids.get(human.id) ?? 0) + 1)
    if (human.identityClass !== 'FICTIONAL' && human.consentState === 'NOT_ENROLLED') {
      warnings.push(warn('MISSING_CONSENT', human.id, `${human.displayName} has no consent state.`))
    }
    if (human.identityClass === 'AUTHORIZED_REAL_PERSON' && human.consentState === 'EXPLICIT_AUTHORITY_REQUIRED') {
      warnings.push(warn('MISSING_AUTHORITY', human.id, `${human.displayName} still needs explicit authority.`))
    }
    if (human.lodDefault === 'LOW' && (human.characterClass === 'FICTIONAL_HERO' || human.characterClass === 'COMMANDER_DIGITAL_HUMAN')) {
      warnings.push(warn('HERO_TREATED_AS_BACKGROUND', human.id, `${human.displayName} is a hero on background detail.`))
    }
    if (human.generatorBindings.some(binding => binding.providerCharacterId && binding.providerCharacterId === human.id)) {
      warnings.push(warn('PROVIDER_IDENTITY_MISMATCH', human.id, 'A provider id was stored as the canonical character id.'))
    }
  }
  for (const [id, count] of ids) {
    if (count > 1) warnings.push(warn('DUPLICATE_CHARACTER', id, 'The same character id appears more than once.'))
  }
  const names = new Map<string, HvsDigitalHuman[]>()
  for (const human of store.characters) {
    const key = human.displayName.toLowerCase()
    names.set(key, [...(names.get(key) ?? []), human])
  }
  for (const group of names.values()) {
    if (group.length > 1) warnings.push(warn('DUPLICATE_CHARACTER', group[0].id, `${group[0].displayName} was duplicated.`))
  }
  for (const population of store.populations) {
    const persistent = population.instances.filter(item => item.persistent)
    if (persistent.length) warnings.push(warn('CROWD_DUPLICATION', null, 'A non-persistent extra was marked persistent without promotion.'))
  }
  for (const intent of store.actingIntents) {
    if (!store.characters.some(item => item.id === intent.characterId)) {
      warnings.push(warn('MISSING_PERFORMANCE_TARGET', intent.characterId, 'An acting intent points at a missing character.'))
    }
  }
  store.warnings = warnings
  return warnings
}

function warn(code: HvsCharacterContinuityWarning['code'], characterId: string | null, message: string): HvsCharacterContinuityWarning {
  return { id: dhId('qc'), code, characterId, message }
}

export function continuityDrift(before: HvsDigitalHuman, after: HvsDigitalHuman): HvsCharacterContinuityWarning[] {
  const warnings: HvsCharacterContinuityWarning[] = []
  if (before.referenceSetVersion !== after.referenceSetVersion && before.identityLock.faceLocked) {
    warnings.push(warn('FACE_REFERENCE_DRIFT', before.id, 'Face reference changed while the face lock is on.'))
  }
  if (before.continuityState.wardrobeSetId && before.continuityState.wardrobeSetId !== after.continuityState.wardrobeSetId) {
    warnings.push(warn('WARDROBE_DRIFT', before.id, 'Wardrobe changed.'))
  }
  if (before.bodyProfile.bodyScale !== after.bodyProfile.bodyScale && before.identityLock.bodyLocked) {
    warnings.push(warn('BODY_SCALE_DRIFT', before.id, 'Body scale changed while the body lock is on.'))
  }
  if ((before.voiceBinding?.providerNeutralId ?? null) !== (after.voiceBinding?.providerNeutralId ?? null)) {
    warnings.push(warn('VOICE_BINDING_DRIFT', before.id, 'Voice binding changed.'))
  }
  if (before.hairProfile.style !== after.hairProfile.style && before.identityLock.hairLocked) {
    warnings.push(warn('HAIR_DRIFT', before.id, 'Hair changed without a plan.'))
  }
  return warnings
}
