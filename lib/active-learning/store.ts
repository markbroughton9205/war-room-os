import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import { canResolveGap, planStudyMission } from './engine'
import type { LearningEvidence, StudyMission, TrainingCandidateManifest } from './types'
import type { KnowledgeGap } from '@/lib/world-learning/types'

export async function createStudyMissionForGap(gap: KnowledgeGap, userId: string | null): Promise<StudyMission | null> {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return null
  const mission = planStudyMission({ gapId: gap.id, question: gap.question, gapType: gap.gap_type, projectId: gap.project_id, userId, generatorId: 'research-engine', verifierId: 'world-learning-verifier', evaluatorId: 'curriculum-evaluator' })
  const { data, error } = await sup.client.from('war_room_study_missions').insert({
    id: mission.id, project_id: mission.projectId, user_id: mission.userId, gap_id: mission.gapId,
    objective: mission.objective, questions: mission.questions, mission_kind: mission.missionKind,
    generator_id: mission.generatorId, verifier_id: mission.verifierId, evaluator_id: mission.evaluatorId,
    status: mission.status, evidence_ids: mission.evidenceIds,
  }).select('*').single()
  if (error || !data) return null
  let gapQuery = sup.client.from('war_room_knowledge_gaps').update({ status: 'researching' }).eq('id', gap.id)
  gapQuery = gap.project_id ? gapQuery.eq('project_id', gap.project_id) : gapQuery.is('project_id', null)
  await gapQuery
  return mission
}

export async function recordLearningEvidence(evidence: LearningEvidence): Promise<boolean> {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return false
  const { error } = await sup.client.from('war_room_learning_evidence').insert({
    id: evidence.id, project_id: evidence.projectId, user_id: evidence.userId, evidence_kind: evidence.kind,
    subject_ref: evidence.subjectRef, outcome: evidence.outcome, observed_at: evidence.observedAt,
    valid_until: evidence.validUntil, provenance_refs: evidence.provenanceRefs, verifier_id: evidence.verifierId,
    evaluator_id: evidence.evaluatorId, poisoned: evidence.poisoned, metadata: evidence.metadata,
  })
  return !error
}

export async function persistTrainingManifest(manifest: TrainingCandidateManifest, projectId: string | null, userId: string | null): Promise<boolean> {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return false
  const { error } = await sup.client.from('war_room_training_candidate_manifests').insert({
    id: manifest.id, project_id: projectId, user_id: userId, policy_version: manifest.policyVersion,
    model_lineage: manifest.modelLineage, eligibility_state: manifest.eligibilityState,
    authorization_state: manifest.authorizationState, training_state: manifest.trainingState,
    training_authorized: manifest.trainingAuthorized,
    commander_authorized_by: manifest.commanderAuthorizedBy,
    commander_authorized_at: manifest.commanderAuthorizedAt,
    candidate_refs: manifest.candidates, exclusions: manifest.excluded,
  })
  return !error
}

/** Research results may resolve a gap only after separately-attributed verifier and evaluator
 * evidence exists. Conflicting claims remain targeted-verification work until that gate passes. */
export async function completeStudyMission(mission: StudyMission, evidence: LearningEvidence[]): Promise<boolean> {
  const scoped = evidence.every(item => item.projectId === mission.projectId && item.userId === mission.userId)
  if (!scoped || !canResolveGap(evidence)) return false
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return false
  const evidenceIds = evidence.map(item => item.id)
  let missionQuery = sup.client.from('war_room_study_missions').update({ status: 'completed', evidence_ids: evidenceIds }).eq('id', mission.id)
  missionQuery = mission.projectId ? missionQuery.eq('project_id', mission.projectId) : missionQuery.is('project_id', null)
  missionQuery = mission.userId ? missionQuery.eq('user_id', mission.userId) : missionQuery.is('user_id', null)
  const { error: missionError } = await missionQuery
  if (missionError) return false
  let gapQuery = sup.client.from('war_room_knowledge_gaps').update({ status: 'resolved', resolution_refs: { missionId: mission.id, evidenceIds } }).eq('id', mission.gapId)
  gapQuery = mission.projectId ? gapQuery.eq('project_id', mission.projectId) : gapQuery.is('project_id', null)
  const { error: gapError } = await gapQuery
  return !gapError
}
