/**
 * #22 Phase 14 — ASTRA-owned bounded multi-agent orchestration helper.
 * Uses existing create/claim/save mission contracts. Does not replace ASTRA.
 * Does not spawn constellation workers. Does not treat recommendation as approval.
 */
import {
  createAstraLiveMission,
  markAstraMissionCompleted,
  markAstraMissionFailed,
  type AstraLiveMission,
  type AstraPersistenceBackend,
} from '@/lib/astra/liveMission'
import {
  claimAstraMissionRunning,
  saveAstraLiveMission,
} from '@/lib/astra/liveMission.store'
import { isTerraIntelligenceAgentRuntimeAvailable } from '@/lib/ascension/terra-intelligence-agent/identity'
import { runBoundedTerraIntelligenceAgent } from '@/lib/ascension/terra-intelligence-agent'
import { denyRecommendationAsApproval } from './authority'
import { ASTRA_PHASE58A_STATUS } from './identity'
import { integrationFailure } from './failures'
import { runKnowledgePipeline, type IntegrationWorkflowInput, type IntegrationWorkflowResult } from './workflows'
import { runBoundedValidatorRevisionCycle } from './revision'
import { astraPhase58aDecisionPacket } from './phase58aPacket'
import type { CouncilClaimInput } from '@/lib/ascension/council-validator'

export type AstraMissionDurabilityReport = {
  MISSION_DURABILITY_CURRENT_STATE: AstraPersistenceBackend | 'unknown'
  ASTRA_PHASE58A: 'NOT_APPLIED'
  db_backed_claimed: false
  filesystem_fallback_available: true
  phase22_closeout_requires_58a: false
  packet_apply_now: false
}

export function reportAstraMissionDurability(
  backend?: AstraPersistenceBackend | null,
): AstraMissionDurabilityReport {
  return {
    MISSION_DURABILITY_CURRENT_STATE: backend ?? 'local_filesystem_fallback',
    ASTRA_PHASE58A: ASTRA_PHASE58A_STATUS,
    db_backed_claimed: false,
    filesystem_fallback_available: true,
    phase22_closeout_requires_58a: false,
    packet_apply_now: astraPhase58aDecisionPacket().apply_now,
  }
}

export type AstraBoundedOrchestrationResult = {
  mission: AstraLiveMission | null
  workflow: IntegrationWorkflowResult | null
  durability: AstraMissionDurabilityReport
  ownership_retained: boolean
  authority_not_amplified: true
  constellation_spawned: false
  external_execution: false
  astra_is_approval: false
  validator_outcome: string | null
}

export async function runAstraBoundedMultiAgentOrchestration(
  input: IntegrationWorkflowInput & { objective?: string },
): Promise<AstraBoundedOrchestrationResult> {
  const durability = reportAstraMissionDurability('local_filesystem_fallback')
  if (input.astraTreatAsCommanderApproval) {
    denyRecommendationAsApproval('astra')
    return {
      mission: null,
      workflow: null,
      durability,
      ownership_retained: true,
      authority_not_amplified: true,
      constellation_spawned: false,
      external_execution: false,
      astra_is_approval: false,
      validator_outcome: null,
    }
  }

  const created = createAstraLiveMission({
    commanderUserId: input.ownerUserId,
    objective: input.objective ?? 'Bounded infrastructure assessment using fixture Helsinki harbor evidence only.',
  })
  if (!created) {
    return {
      mission: null,
      workflow: null,
      durability,
      ownership_retained: false,
      authority_not_amplified: true,
      constellation_spawned: false,
      external_execution: false,
      astra_is_approval: false,
      validator_outcome: null,
    }
  }

  let mission = await saveAstraLiveMission(created)
  const claimed = await claimAstraMissionRunning({
    id: mission.id,
    commanderUserId: input.ownerUserId,
  })
  if (!claimed.ok) {
    mission = await saveAstraLiveMission(markAstraMissionFailed(mission, 'ASTRA claim-running failed'))
    return {
      mission,
      workflow: null,
      durability: reportAstraMissionDurability(mission.persistenceBackend),
      ownership_retained: mission.commanderUserId === input.ownerUserId,
      authority_not_amplified: true,
      constellation_spawned: false,
      external_execution: false,
      astra_is_approval: false,
      validator_outcome: null,
    }
  }
  mission = claimed.mission

  const knowledge = await runKnowledgePipeline({
    ...input,
    missionId: mission.id,
    invokedBy: 'astra',
    internetAvailable: input.internetAvailable ?? true,
    liveSearchAllowed: false,
    useFixtures: true,
  })

  let terraSummary = 'Terra Intelligence skipped or disabled.'
  if (isTerraIntelligenceAgentRuntimeAvailable()) {
    const terra = await runBoundedTerraIntelligenceAgent({
      worldStateQuestion: 'Fixture world-state for bounded ASTRA assessment. Not live GPS.',
      ownerUserId: input.ownerUserId,
      requestedBy: input.requestedBy,
      invokedBy: 'astra',
      missionId: mission.id,
      useDigitrafficFixture: true,
    })
    terraSummary = terra.summary
  }

  const claims: CouncilClaimInput[] = [
    {
      claim_text: `ASTRA orchestrated Research→World Learning→Data Corpus and Terra Intelligence. ${knowledge.summary} ${terraSummary}`,
      claim_type: 'ASTRA',
      evidence_refs: knowledge.evidence_ids.slice(0, 8),
      evidence_support: knowledge.evidence_ids.length ? 'SUPPORTED' : 'PARTIAL',
      freshness: 'CACHED',
      asserts_astra_mission_as_authorized: false,
      asserts_council_recommendation_as_approval: false,
    },
  ]
  const validation = await runBoundedValidatorRevisionCycle({
    conversationId: input.conversationId ?? '00000000-0000-4000-8000-000000000022',
    ownerUserId: input.ownerUserId,
    requestedBy: input.requestedBy,
    missionId: mission.id,
    claims,
  })

  const ownershipRetained = mission.commanderUserId === input.ownerUserId
  const outcome = [
    knowledge.summary,
    `validator=${validation.outcome}`,
    `ownership_retained=${ownershipRetained}`,
    'ASTRA recommendation is not Commander approval.',
    'No external execution.',
  ].join(' ')

  mission = await saveAstraLiveMission(
    markAstraMissionCompleted(mission, {
      outcomeSummary: outcome.slice(0, 1800),
      councilExecution: {
        durationMs: 0,
        roster: ['RESEARCH_AGENT', 'WORLD_LEARNING_AGENT', 'DATA_CORPUS_AGENT', 'TERRA_INTELLIGENCE_AGENT', 'COUNCIL_VALIDATOR'],
        stages: ['research', 'world_learning', 'data_corpus', 'terra_intelligence', 'council_synthesis', 'validator'],
        synthesisPresent: true,
        deliberationMode: 'bounded_deterministic_synthesis',
      },
    }),
  )

  return {
    mission,
    workflow: knowledge,
    durability: reportAstraMissionDurability(mission.persistenceBackend),
    ownership_retained: ownershipRetained,
    authority_not_amplified: true,
    constellation_spawned: false,
    external_execution: false,
    astra_is_approval: false,
    validator_outcome: validation.outcome,
  }
}

export function denyAstraAsCommanderApproval() {
  return {
    decision: denyRecommendationAsApproval('astra'),
    failure: integrationFailure('AUTHORITY_DENIED', 'ASTRA orchestration is not Commander approval.'),
  }
}
