import type { CorpusSourceInventoryRow, QualityTier, Trainability } from './types'

export function qualityTierForSource(row: CorpusSourceInventoryRow): QualityTier {
  if (row.class === 'INELIGIBLE' || row.exclusionReasons.includes('secret_detected') || row.exclusionReasons.includes('hidden_cot_detected')) return 'excluded'
  if (row.class === 'REQUIRES_REVIEW' || row.class === 'TEST_ONLY' || row.class === 'EVAL_ONLY') return 'excluded'
  if (row.rights.licenseName.startsWith('Public domain')) return 'A'
  if (row.rights.permitsTrainingUse && row.rights.licenseName.startsWith('Commander-owned')) return 'A'
  if (row.format === 'source_grounded_research') return 'B'
  return 'C'
}

export function trainabilityFor(tier: QualityTier, sourceClass: CorpusSourceInventoryRow['class']): Trainability {
  if (sourceClass === 'TEST_ONLY') return 'test_only'
  if (sourceClass === 'EVAL_ONLY') return 'eval_only'
  if (tier === 'A' || tier === 'B') return 'positive_training'
  if (tier === 'C') return 'failure_curriculum'
  return 'excluded'
}
