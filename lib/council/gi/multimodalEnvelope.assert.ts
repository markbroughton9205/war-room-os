import { parseCommanderTurn } from './multimodalEnvelope'
import type { EnvelopeValidationResult } from './types'

/** CT-01: image-only turn validates with AssetRef + hash. */
export function assertImageOnlyTurn(input: unknown): EnvelopeValidationResult {
  const parsed = parseCommanderTurn(input)
  if (!parsed.ok) return parsed
  const images = parsed.envelope.parts.filter(part => part.kind === 'image')
  if (!images.length) {
    return { ok: false, issues: [{ code: 'CT-01', message: 'expected image part' }] }
  }
  const missingHash = images.some(part => !part.asset_ref.content_hash)
  if (missingHash) {
    return { ok: false, issues: [{ code: 'CT-03', message: 'image AssetRef missing content_hash' }] }
  }
  return parsed
}

/** CT-03: missing content_hash refuses ingest. */
export function assertBinaryHashRequired(input: unknown): EnvelopeValidationResult {
  return parseCommanderTurn(input)
}
