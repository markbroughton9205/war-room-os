/**
 * Active-layer permanent delete + tombstones.
 * Never modifies the read-only Mac recovery dump.
 */
import { WrCorpusPolicyError } from './hashes'
import { WrCorpusStore } from './store'

export type DeletePolicy = 'DELETE_AND_ALLOW_RELEARN' | 'DELETE_AND_BLOCK_RELEARN'

export function deleteActiveWrCorpusRecord(input: {
  recordId: string
  ownerUserId: string
  policy: DeletePolicy
  dataDirOverride?: string | null
}): {
  deleted: true
  layer: 'ACTIVE_CORPUS_DELETE'
  historical_recovery_source_preserved: true
  policy: DeletePolicy
} {
  if (input.policy !== 'DELETE_AND_ALLOW_RELEARN' && input.policy !== 'DELETE_AND_BLOCK_RELEARN') {
    throw new WrCorpusPolicyError('INVALID_POLICY', 'Unknown tombstone policy.')
  }
  const store = new WrCorpusStore(input.dataDirOverride)
  try {
    store.tombstone({
      recordId: input.recordId,
      ownerUserId: input.ownerUserId,
      policy: input.policy,
    })
    return {
      deleted: true,
      layer: 'ACTIVE_CORPUS_DELETE',
      historical_recovery_source_preserved: true,
      policy: input.policy,
    }
  } finally {
    store.close()
  }
}

export function denyDeleteRecoveryDump(): never {
  throw new WrCorpusPolicyError(
    'RECOVERY_DUMP_DELETE_DENIED',
    'Cannot delete the read-only Mac recovery dump. ACTIVE_CORPUS_DELETE ≠ HISTORICAL_RECOVERY_SOURCE_PRESERVED.',
  )
}
