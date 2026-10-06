import type { HvsAuthorityActor, HvsIdentityAuthorityAction } from './types'

const COMMANDER_ONLY: HvsIdentityAuthorityAction[] = [
  'NEW_IDENTITY_REFERENCE',
  'VOICE_ENROLLMENT',
  'BODY_REFERENCE_ENROLLMENT',
  'FACE_REFERENCE_ENROLLMENT',
  'MAJOR_APPEARANCE_CHANGE',
  'IDENTITY_REPLACEMENT',
  'PROVIDER_IDENTITY_TRAINING',
  'VOICE_CLONING',
  'EXPORT_IDENTITY_TRAINING_PACK',
]

export function identityActionAllowed(actor: HvsAuthorityActor, action: HvsIdentityAuthorityAction): boolean {
  if (!COMMANDER_ONLY.includes(action)) return false
  return actor === 'commander'
}

export function assertIdentityAuthority(actor: HvsAuthorityActor, action: HvsIdentityAuthorityAction): void {
  if (!identityActionAllowed(actor, action)) {
    throw new Error(`Only the Commander may authorize ${action}.`)
  }
}
