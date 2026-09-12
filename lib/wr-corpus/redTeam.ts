/**
 * #23 red-team bounds for WR-CORPUS. All listed attacks denied or truthfully bounded.
 */
import { WrCorpusPolicyError } from './hashes'
import { CURRENT_PRODUCTION_WRIM, CURRENT_WR_TOKENIZER_LANE, RAEL_STATUS } from './identity'
import { denyDeleteRecoveryDump } from './delete'
import { denyAutoPromoteAll } from './promote'

export type ForbiddenWrCorpusAction =
  | 'DELETE_RECOVERY_DUMP'
  | 'COPY_WRIM_CHECKPOINTS'
  | 'TREAT_WRIM1_AS_PRODUCTION'
  | 'CALL_WRIM0_RAEL'
  | 'START_TOKENIZER_TRAINING'
  | 'RETRAIN_WR_TOKENIZER_0'
  | 'START_WRIM_TRAINING'
  | 'INHERIT_ALLOWED_FOR_TRAINING_AS_ELIGIBLE'
  | 'IMPORT_UNKNOWN_LICENSE_AS_ELIGIBLE'
  | 'PROMOTE_EVERY_CANDIDATE'
  | 'REPLACE_LIVE_MODEL_LAB_JUNCTION'
  | 'REWRITE_MAC_PROVENANCE'
  | 'MUTATE_RECOVERY_SOURCE'
  | 'START_SECOND_ARCHITECTURE'
  | 'RAW_SEARCH_BYPASS'

export function denyForbiddenWrCorpusAction(action: ForbiddenWrCorpusAction, extra?: string): never {
  const messages: Record<ForbiddenWrCorpusAction, string> = {
    DELETE_RECOVERY_DUMP: 'Cannot delete the read-only Mac recovery dump.',
    COPY_WRIM_CHECKPOINTS: 'Cannot copy WRIM checkpoints into WR-CORPUS.',
    TREAT_WRIM1_AS_PRODUCTION: `Collapsed WRIM-1 is not production. CURRENT_PRODUCTION_WRIM=${CURRENT_PRODUCTION_WRIM}.`,
    CALL_WRIM0_RAEL: `WRIM-0 is a historical research artifact. RAEL=${RAEL_STATUS}.`,
    START_TOKENIZER_TRAINING: `CURRENT_WR_TOKENIZER_LANE=${CURRENT_WR_TOKENIZER_LANE}.`,
    RETRAIN_WR_TOKENIZER_0: 'Historical WR-TOKENIZER-0 is frozen. Retrain denied.',
    START_WRIM_TRAINING: 'Current WRIM training is NOT_IMPLEMENTED / NOT_RUNNING.',
    INHERIT_ALLOWED_FOR_TRAINING_AS_ELIGIBLE:
      'Old allowedForTraining:true is not current ELIGIBLE. Mapped to HISTORICAL_DECLARED_ELIGIBLE_NOT_CURRENT.',
    IMPORT_UNKNOWN_LICENSE_AS_ELIGIBLE: 'Unknown rights require REQUIRES_REVIEW, not ELIGIBLE.',
    PROMOTE_EVERY_CANDIDATE: 'Cannot promote every durable candidate.',
    REPLACE_LIVE_MODEL_LAB_JUNCTION:
      'Live model-lab must not be replaced with the dump junction. Canonical import path only.',
    REWRITE_MAC_PROVENANCE: 'Original Mac provenance is historical metadata and cannot be rewritten.',
    MUTATE_RECOVERY_SOURCE: 'Recovery dump is read-only.',
    START_SECOND_ARCHITECTURE: 'Cannot create Corpus2 / a second WR-CORPUS architecture.',
    RAW_SEARCH_BYPASS: 'Raw Search results cannot bypass Research → World Learning → Data Corpus → review.',
  }
  if (action === 'DELETE_RECOVERY_DUMP') denyDeleteRecoveryDump()
  if (action === 'PROMOTE_EVERY_CANDIDATE') denyAutoPromoteAll(0)
  throw new WrCorpusPolicyError(action, extra ? `${messages[action]} ${extra}` : messages[action])
}

export function tryForbiddenWrCorpusAction(action: ForbiddenWrCorpusAction): {
  denied: true
  action: ForbiddenWrCorpusAction
  code: string
  reason: string
} {
  try {
    denyForbiddenWrCorpusAction(action)
  } catch (error) {
    const err = error as WrCorpusPolicyError
    return { denied: true, action, code: err.code || action, reason: err.message }
  }
}
