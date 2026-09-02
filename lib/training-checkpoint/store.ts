import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import type { CheckpointCandidate, EvalManifest, PromotionRecommendation, Wave4DatasetManifest } from './types'

export async function persistDatasetManifest(manifest: Wave4DatasetManifest, projectId: string | null, userId: string | null): Promise<boolean> {
  const sup = tryWarRoomSupabase(); if (!sup.ok) return false
  const { error } = await sup.client.from('war_room_training_dataset_manifests').insert({
    id: manifest.manifestId, project_id: projectId, user_id: userId, policy_version: manifest.policyVersion,
    parent_candidate_manifest_ids: manifest.parentCandidateManifestIds, dataset_hash: manifest.datasetHash,
    records: manifest.records, exclusions: manifest.exclusions, split_counts: manifest.splitCounts,
    immutable: manifest.immutable, training_started: manifest.trainingStarted, created_at: manifest.createdAt,
  })
  return !error
}

export async function persistCheckpointCandidate(candidate: CheckpointCandidate, projectId: string | null, userId: string | null): Promise<boolean> {
  const sup = tryWarRoomSupabase(); if (!sup.ok) return false
  const { error } = await sup.client.from('war_room_checkpoint_candidates').insert({
    id: candidate.checkpointCandidateId, project_id: projectId, user_id: userId, model_id: candidate.modelId,
    parent_checkpoint_id: candidate.parentCheckpointId, parent_checkpoint_hash: candidate.parentCheckpointHash,
    dataset_manifest_id: candidate.datasetManifestId, dataset_hash: candidate.datasetHash,
    tokenizer_artifact_hash: candidate.tokenizerArtifactHash, status: candidate.status,
    rollback_checkpoint_id: candidate.rollbackCheckpointId, training_started: candidate.trainingStarted, created_at: candidate.createdAt,
  })
  return !error
}

export async function persistEvalManifest(manifest: EvalManifest, recommendation: PromotionRecommendation): Promise<boolean> {
  const sup = tryWarRoomSupabase(); if (!sup.ok) return false
  const { error } = await sup.client.from('war_room_checkpoint_eval_manifests').insert({
    id: manifest.evalManifestId, checkpoint_candidate_id: manifest.checkpointCandidateId,
    benchmark_refs: manifest.benchmarkRefs, metrics: manifest.metrics, content_hash: manifest.contentHash,
    recommendation: recommendation.recommendation, recommendation_reasons: recommendation.reasons,
    commander_authorization: recommendation.commanderAuthorization, promotion_executed: recommendation.promotionExecuted,
  })
  return !error
}
