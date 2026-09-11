/**
 * #17 size bounds for durable round / digest payloads.
 * Soft ceilings — never truncate ids/linkage required for provenance.
 */

export const ROUND_SERIALIZED_SOFT_MAX = 48_000
export const ROUND_SERIALIZED_HARD_MAX = 96_000
export const SESSION_INDEX_SOFT_MAX = 8_000
export const CONTINUATION_BLOCK_SOFT_MAX = 6_000
export const MAX_EVIDENCE_REFS_PER_ROUND = 40
export const MAX_ROSTER_SEATS = 16
export const MAX_TURN_REFS = 48

export type SizeReport = {
  bytes: number
  withinSoft: boolean
  withinHard: boolean
  softMax: number
  hardMax: number
}

export function measureSerializedSize(value: unknown, softMax: number, hardMax: number): SizeReport {
  const bytes = Buffer.byteLength(JSON.stringify(value ?? null), 'utf8')
  return {
    bytes,
    withinSoft: bytes <= softMax,
    withinHard: bytes <= hardMax,
    softMax,
    hardMax,
  }
}
