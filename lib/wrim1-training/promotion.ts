import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PromotionState } from './types'

export const PROMOTION_STATES: PromotionState[] = [
  'TRAINING_NOT_STARTED',
  'TRAINING',
  'TRAINED',
  'EVALUATING',
  'EVALUATED',
  'PROMOTION_RECOMMENDED',
  'PROMOTION_REJECTED',
  'AWAITING_COMMANDER_PROMOTION',
  'PROMOTED',
]

export const LEGAL_PROMOTION_TRANSITIONS: Record<PromotionState, PromotionState[]> = {
  TRAINING_NOT_STARTED: ['TRAINING'],
  TRAINING: ['TRAINED', 'TRAINING_NOT_STARTED'],
  TRAINED: ['EVALUATING'],
  EVALUATING: ['EVALUATED'],
  EVALUATED: ['PROMOTION_RECOMMENDED', 'PROMOTION_REJECTED'],
  PROMOTION_RECOMMENDED: ['AWAITING_COMMANDER_PROMOTION', 'PROMOTION_REJECTED'],
  PROMOTION_REJECTED: ['EVALUATING'],
  AWAITING_COMMANDER_PROMOTION: ['PROMOTED', 'PROMOTION_REJECTED'],
  PROMOTED: [],
}

export function canTransitionPromotion(from: PromotionState, to: PromotionState): boolean {
  return LEGAL_PROMOTION_TRANSITIONS[from].includes(to)
}

export function currentPromotionState(repo = process.cwd()): PromotionState {
  const path = join(repo, 'model-lab/manifests/wave9/promotion-state.json')
  if (!existsSync(path)) return 'TRAINING_NOT_STARTED'
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { state?: PromotionState }
  return parsed.state ?? 'TRAINING_NOT_STARTED'
}

export const activeModelSeparation = {
  councilUnchanged: true,
  productionInferenceUnchanged: true,
  activeModelUnchanged: true,
  identityShellUnchanged: true,
  memoryStateUnchanged: true,
  promotionIsExplicit: true,
  creatingWrim1DoesNotAutoReplaceRael: true,
}

export const postTrainEvalSequence = [
  'checkpoint_load',
  'validation_metrics',
  'held_out_suite',
  'format_json_tests',
  'tool_protocol_tests',
  'research_evidence_tests',
  'regression_analysis',
  'comparison_against_wrim0',
  'promotion_recommendation',
] as const
