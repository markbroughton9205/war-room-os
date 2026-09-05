import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import { registerResearchDocumentAsSource, type ResearchDocumentLike } from './sourceRegistration'
import { extractCandidateClaims } from './claimExtraction'
import { detectContradictionFromComparison, type ResearchComparisonLike } from './contradictionDetection'
import { createWorldKnowledgeCandidate } from './worldKnowledge'
import type { ClaimRecord, LearningSession, LearningSessionItem } from './types'

export type RunLearningSessionInput = {
  objective: string
  projectId?: string | null
  conversationId?: string | null
  documents: ResearchDocumentLike[]
  /** Optional — when a comparison's agreement is 'conflicting', the first two claims derived
   * from that comparison's documents are checked for a contradiction record. */
  comparisons?: ResearchComparisonLike[]
  initiatedBy?: string
}

export type RunLearningSessionResult = {
  session: LearningSession
  claims: ClaimRecord[]
}

/**
 * The bounded Research → Learning pipeline (Phase 22). Reuses Research Engine's own output
 * (ResearchDocumentLike, ResearchComparisonLike) as input — does not call Research Engine itself,
 * does not duplicate its provider logic. Every stage is logged as an observable LearningSessionItem
 * tagged with a generator/verifier/evaluator role (Phase 24) — no hidden reasoning is stored, only
 * actions and their results.
 */
export async function runLearningSession(input: RunLearningSessionInput): Promise<RunLearningSessionResult | null> {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return null

  const projectId = input.projectId ?? null
  const items: LearningSessionItem[] = []
  const sourceIds: string[] = []
  const claims: ClaimRecord[] = []
  const gapIds: string[] = []
  let anyStepFailed = false

  const now = () => new Date().toISOString()
  const log = (item: Omit<LearningSessionItem, 'createdAt'>) => items.push({ ...item, createdAt: now() })

  for (const document of input.documents) {
    const registered = await registerResearchDocumentAsSource(document)
    if (!registered) {
      anyStepFailed = true
      log({ itemType: 'ACQUISITION', role: 'generator', detail: `Failed to register source for document ${document.id}`, refIds: [] })
      continue
    }
    sourceIds.push(registered.source.id)
    log({
      itemType: 'DISCOVERY',
      role: 'generator',
      detail: registered.isNewVersion ? `New source version observed: ${registered.source.title ?? registered.source.id}` : `Source already current: ${registered.source.title ?? registered.source.id}`,
      refIds: [registered.source.id, registered.version.id],
    })

    const extractedClaims = await extractCandidateClaims(document, registered.version, projectId)
    if (!extractedClaims.length) {
      anyStepFailed = true
      continue
    }
    for (const claim of extractedClaims) {
      claims.push(claim)
      log({ itemType: 'CLAIM_EXTRACTION', role: 'generator', detail: claim.normalized_claim_text, refIds: [claim.id] })
      const structurallyValid = claim.evidence_refs.length > 0
      log({ itemType: 'VERIFY', role: 'verifier', detail: structurallyValid ? 'Structural check passed: claim has at least one evidence reference.' : 'Structural check failed: claim has no evidence references.', refIds: [claim.id] })
      const worldKnowledge = await createWorldKnowledgeCandidate(claim, [registered.source.id], projectId)
      if (worldKnowledge) log({ itemType: 'KNOWLEDGE_UPDATE', role: 'generator', detail: `Candidate world knowledge created: ${worldKnowledge.id}`, refIds: [worldKnowledge.id, claim.id] })
    }
  }

  for (const comparison of input.comparisons ?? []) {
    if (comparison.agreement !== 'conflicting' || claims.length < 2) continue
    const contradiction = await detectContradictionFromComparison(comparison, claims[0].id, claims[1].id)
    if (!contradiction) continue
    log({ itemType: 'CONTRADICTION_CHECK', role: 'verifier', detail: `Contradiction recorded for subject "${comparison.subject}".`, refIds: [contradiction.id, claims[0].id, claims[1].id] })

    const { data: gap } = await sup.client
      .from('war_room_knowledge_gaps')
      .insert({
        question: `Unresolved conflicting information: ${comparison.subject}`,
        gap_type: 'conflicting_sources',
        project_id: projectId,
        conversation_id: input.conversationId ?? null,
        source_refs: [{ contradictionId: contradiction.id }],
      })
      .select('id')
      .single()
    if (gap) {
      gapIds.push(gap.id)
      log({ itemType: 'GAP_CREATION', role: 'generator', detail: `Knowledge gap opened for unresolved contradiction on "${comparison.subject}".`, refIds: [gap.id, contradiction.id] })
    }
  }

  const claimsWithEvidence = claims.filter(c => c.evidence_refs.length > 0).length
  const metrics = {
    documentCount: input.documents.length,
    sourceCount: sourceIds.length,
    claimCount: claims.length,
    claimsWithEvidenceRatio: claims.length ? claimsWithEvidence / claims.length : 0,
    gapCount: gapIds.length,
  }
  log({
    itemType: 'VERIFY',
    role: 'evaluator',
    detail: `Session quality: ${claimsWithEvidence}/${claims.length} claims have evidence; ${gapIds.length} gap(s) opened.`,
    refIds: [],
  })

  const status = anyStepFailed ? (claims.length > 0 ? 'partial' : 'failed') : 'completed'

  const { data: session, error } = await sup.client
    .from('war_room_learning_sessions')
    .insert({
      project_id: projectId,
      conversation_id: input.conversationId ?? null,
      objective: input.objective,
      status,
      initiated_by: input.initiatedBy ?? 'commander',
      completed_at: now(),
      source_ids: sourceIds,
      claim_ids: claims.map(c => c.id),
      gap_ids: gapIds,
      items,
      outcome_summary: `Registered ${sourceIds.length} source(s), extracted ${claims.length} candidate claim(s), opened ${gapIds.length} knowledge gap(s).`,
      metrics,
    })
    .select('*')
    .single()

  if (error || !session) return null

  const { captureWorldLearningResolution } = await import('@/lib/continuous-evidence/capture')
  const verifiedClaims = claims.filter(claim => claim.status === 'verified')
  await captureWorldLearningResolution({
    subjectRef: `learning-session:${session.id}`,
    outcome: status === 'failed' ? 'fail' : status === 'completed' && verifiedClaims.length > 0 ? 'pass' : 'inconclusive',
    observedAt: now(),
    validUntil: null,
    provenanceRefs: sourceIds.map(id => `source:${id}`),
    sourceLineageIds: [`learning-session:${session.id}`, ...sourceIds.map(id => `source:${id}`)],
    capabilityTags: ['world-learning.session'],
    curriculumTags: gapIds.length ? ['knowledge-gap'] : ['world-learning'],
    validatorTypes: ['learning-session-evaluator'],
    verifierId: 'world-learning-verifier',
    evaluatorId: 'continuous-evidence-admission-v1',
    objectiveEvaluated: true,
    objectiveSatisfied: status === 'completed' && verifiedClaims.length > 0,
    objectiveVerified: verifiedClaims.length > 0,
    claimStatus: verifiedClaims.length > 0 ? 'verified' : 'candidate',
    metadata: { sessionId: session.id, status, claimCount: claims.length, verifiedClaimCount: verifiedClaims.length },
  }).catch(() => null)

  return { session: session as LearningSession, claims }
}
