/**
 * HUMAN-01 privacy locks for high-fidelity production.
 * Face references remain local-only. No cloud, training, embeddings, or identity recognition.
 */
import { readFaceReferenceSet } from '../digital-human/face-reference'
import type { HvsCharacterBuildOperation, HvsPrivacyDisclosure } from './types'

const FORBIDDEN_HOST = /openai\.com|anthropic|https:\/\/api\.|rekognition|insightface|face-api\.js|cloudinary|voice.?clon/i

export function privacyLocks(projectId: string): HvsCharacterBuildOperation['privacy'] {
  readFaceReferenceSet(projectId)
  return {
    localOnly: true,
    cloud: false,
    training: false,
    embeddings: false,
    identityRecognition: false,
    faceBytesEmbedded: false,
  }
}

export function assertLocalOnlyPayload(value: unknown): void {
  const raw = JSON.stringify(value)
  if (/"cloud"\s*:\s*true|"embeddings"\s*:\s*true|"training"\s*:\s*true|"identityRecognition"\s*:\s*true/.test(raw)) {
    throw new Error('PRIVACY_LOCK: character production refused a cloud or identity payload.')
  }
  if (FORBIDDEN_HOST.test(raw)) {
    throw new Error('PRIVACY_LOCK: character production refused a cloud or identity payload.')
  }
  if (/data:image\/|landmarkFrames|bodyFrames/.test(raw) && raw.length > 400_000) {
    throw new Error('PRIVACY_LOCK: face or motion bytes must not be embedded in production receipts.')
  }
}

export function preservesHuman01Locks(operation: HvsCharacterBuildOperation): boolean {
  return operation.privacy.localOnly
    && operation.privacy.cloud === false
    && operation.privacy.training === false
    && operation.privacy.embeddings === false
    && operation.privacy.identityRecognition === false
    && operation.privacy.faceBytesEmbedded === false
    && operation.authorizedBy === 'commander'
}

export function privacyDisclosureFor(operation: HvsCharacterBuildOperation | null): HvsPrivacyDisclosure {
  return {
    originalReferences: 'LOCAL',
    epicCloudStep: operation?.authority ? 'DERIVED_FACE_MESH_VERTICES' : 'NOT_AUTHORIZED',
    purpose: 'MetaHuman likeness creation',
    training: 'NOT AUTHORIZED',
    faceRecognition: 'NOT AUTHORIZED',
    voice: 'NOT AUTHORIZED',
  }
}
