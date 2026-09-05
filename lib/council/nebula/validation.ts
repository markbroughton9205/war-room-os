import { COUNCIL_ROSTER } from '@/lib/council/familyRoster'
import { GREETING_META_BY_FAMILY } from '@/lib/council/greetingPrompt'
import { PROVIDER_IDENTITY_PROFILES } from '@/lib/council/providerIdentity'
import { LOCAL_MODEL_REGISTRY, localRegistryEntryForSlot } from '@/lib/council/live-orchestration/backends/localModelRegistry'
import { SEAT_LOCAL_ROLE_SLOT } from '@/lib/council/live-orchestration/backends/seatRoleSlot'
import { COUNCIL_ROUTING_MODES } from '@/lib/council/live-orchestration/backends/types'
import { ASCENSION_AUTONOMY_GUARD, ASCENSION_FOUNDATION, ASCENSION_PROMOTION_PIPELINE, canApplySkillGrowth, NEBULA_EVOLUTION_PROFILES } from '@/lib/council/ascension'
import { allPromotionGatesExist, decideLessonPromotion, productionBehaviorMayChange, requiresCommanderApproval } from '@/lib/council/ascension/promotion'
import { createLessonCandidate, experienceChangesProductionBehavior, isTestableLessonCandidate, pulsarPrimarySourceLessonFixture, recordExperience } from '@/lib/council/ascension/lessons'
import { constellationAgentIdentitiesAreUnique, constellationRespectsBounds, planBoundedConstellation, shouldStopConstellation, temporaryWorkersAreRoleInstancesNotIdentities, temporaryWorkersExpire, workerIsExpired } from '@/lib/council/constellation'
import { familyDisplayName } from '@/lib/council/family-deliberation/runtime'
import {
  NEBULA_AGENT_IDS,
  NEBULA_AGENTS,
  NEBULA_AGENTS_BY_ID,
  NEBULA_IDENTITY_BY_SEAT,
  displayNameForSeat,
  seatForDisplayIdentity,
  type NebulaAgentId,
} from './identity'
import { isWarRoomRuntimeStatusDecree } from './runtimeStatus'
import { auroraDegradedRoundNotice, projectRoundHealth } from './round'
import { allRoleContracts, isFinalCouncilSynthesizer, isOrchestrationOnly, NEBULA_ROLE_CONTRACTS, roleContractMatchesIdentity } from './roleContracts'
import { accidentallyFulfillsContract, everyAgentHasOutputContract, OUTPUT_CONTRACTS } from './outputContracts'
import { applyCapabilityEvaluation, capabilityGrowthRequiresEvidence, everyAgentHasCapabilityLedger, NEBULA_CAPABILITY_LEDGERS, recordCapabilityUse } from './capabilityLedger'
import { agentMayWriteMemoryScope, memoryScopesAreSeparated, NEBULA_MEMORY_SCOPES } from './memory'
import { agentConclusionIsAutomaticGlobalTruth, evaluateGlobalKnowledgePromotion, GLOBAL_KNOWLEDGE_PROMOTION_FLOW, NEBULA_KNOWLEDGE_ABSORPTION_PLAN } from './knowledgeIngestion'
import { assembleNebulaContext, buildContextModules, modelCannotOmitIdentity, NEBULA_CONTEXT_MODULE_ORDER, requiredIdentityModulesAreRuntimeControlled } from './contextAssembly'
import { astraIsNotACouncilOpinionSeat, createCouncilRoundPlan, NEBULA_ROUND_FLOW } from './roundFlow'
import { auroraMustRemainAurora, createExecutionRecord, identitySurvivesBackendChange, isIdentityFallback } from './execution'
import { allPermanentAgentsHaveDistinctOptimizationTargets, backendIndependenceFoundation, DIFFERENTIATION_FIXTURE_LABEL, fixturesAreDifferentiated, personalityPersistenceAcrossBackends, roleSwapNovaVsLumen, DIFFERENTIATION_FIXTURES } from './differentiation'
import { allPermanentAgentsShareGenesisGeneral, mappedNebulaSeatsUseGeneralSlot, NEBULA_MODEL_PROFILES, NEBULA_SHARED_BRAIN_SUMMARY, NEBULA_SHARED_LOCAL_MODEL_ID, noPermanentAgentRequiresDolphin, noPermanentAgentRequiresSeparateModel } from './modelProfile'

export type NebulaValidationResult = { name: string; pass: boolean; detail: string }

const FRONTIER_NAME_PATTERN = /\b(chatgpt|openai|claude|anthropic|grok|xai|gemini|google\s*gemini|red\s*team)\b/i

function checkAllEightRegistered(): NebulaValidationResult {
  const ids = new Set(NEBULA_AGENTS.map(agent => agent.id))
  const missing = NEBULA_AGENT_IDS.filter(id => !ids.has(id))
  return {
    name: 'all_eight_nebula_agents_registered',
    pass: missing.length === 0 && NEBULA_AGENTS.length === 8,
    detail: missing.length === 0 ? '8/8 registered' : `missing: ${missing.join(', ')}`,
  }
}

function checkDistinctRoles(): NebulaValidationResult {
  const roles = NEBULA_AGENTS.map(agent => agent.role)
  const distinct = new Set(roles)
  return {
    name: 'each_agent_has_distinct_role',
    pass: distinct.size === roles.length,
    detail: distinct.size === roles.length ? 'all roles distinct' : `duplicate roles found among: ${roles.join(' | ')}`,
  }
}

function checkNoFrontierNameInIdentityFields(): NebulaValidationResult {
  const offenders: string[] = []
  for (const agent of NEBULA_AGENTS) {
    if (FRONTIER_NAME_PATTERN.test(agent.name) || FRONTIER_NAME_PATTERN.test(agent.label) || FRONTIER_NAME_PATTERN.test(agent.role)) {
      offenders.push(agent.id)
    }
  }
  return {
    name: 'no_frontier_identity_in_name_label_role',
    pass: offenders.length === 0,
    detail: offenders.length === 0 ? 'clean' : `frontier name leaked in: ${offenders.join(', ')}`,
  }
}

function checkRosterLabelsClean(): NebulaValidationResult {
  const offenders = COUNCIL_ROSTER
    .filter(entry => NEBULA_IDENTITY_BY_SEAT[entry.id])
    .filter(entry => FRONTIER_NAME_PATTERN.test(entry.label))
    .map(entry => entry.id)
  return {
    name: 'council_roster_labels_use_nebula_identity',
    pass: offenders.length === 0,
    detail: offenders.length === 0 ? 'all mapped roster labels are frontier-name-free' : `still frontier-labeled: ${offenders.join(', ')}`,
  }
}

function checkPhoenixDoesNotRequireDolphin(): NebulaValidationResult {
  const phoenixSeat = Object.entries(NEBULA_IDENTITY_BY_SEAT).find(([, id]) => id === 'phoenix')?.[0]
  const roleSlot = phoenixSeat ? SEAT_LOCAL_ROLE_SLOT[phoenixSeat as keyof typeof SEAT_LOCAL_ROLE_SLOT] : null
  const entry = roleSlot ? localRegistryEntryForSlot(roleSlot) : null
  const usesDolphin = entry?.modelId === 'dolphin-mistral-venice:24b'
  return {
    name: 'phoenix_does_not_require_dolphin_model',
    pass: Boolean(entry) && !usesDolphin,
    detail: entry
      ? `phoenix (seat=${phoenixSeat}) resolves to enabled slot "${entry.slot}" (${entry.modelId})`
      : `phoenix (seat=${phoenixSeat}) has no enabled local entry to resolve to`,
  }
}

function checkSharedBackingDisclosedHonestly(): NebulaValidationResult {
  const offenders: string[] = []
  for (const agent of NEBULA_AGENTS) {
    const { roleSlot, sharedLocalBacking } = agent.backendPreference
    if (!roleSlot) continue
    const sharedCount = Object.values(SEAT_LOCAL_ROLE_SLOT).filter(slot => slot === roleSlot).length
    const actuallyShared = sharedCount > 1
    // An agent whose slot IS shared must say so; an agent claiming shared backing for a slot
    // nothing else uses would be a false disclosure the other direction.
    if (actuallyShared && !sharedLocalBacking) offenders.push(`${agent.id}:undeclared_share`)
  }
  return {
    name: 'shared_local_backing_disclosed_honestly',
    pass: offenders.length === 0,
    detail: offenders.length === 0 ? 'shared backing disclosures match SEAT_LOCAL_ROLE_SLOT' : offenders.join(', '),
  }
}

function checkNoRoleSlotClaimsPhantomModel(): NebulaValidationResult {
  const offenders: string[] = []
  for (const agent of NEBULA_AGENTS) {
    const { roleSlot } = agent.backendPreference
    if (!roleSlot) continue
    if (!LOCAL_MODEL_REGISTRY.some(entry => entry.slot === roleSlot)) {
      offenders.push(`${agent.id}:${roleSlot}`)
    }
  }
  return {
    name: 'backend_preference_role_slots_exist_in_registry',
    pass: offenders.length === 0,
    detail: offenders.length === 0 ? 'all referenced role slots exist' : offenders.join(', '),
  }
}

function checkIdentityModelSeparation(): NebulaValidationResult {
  // Structural check: NebulaAgentDefinition must never itself carry a concrete model id/tag —
  // that belongs exclusively to BackendMetadata (lib/council/live-orchestration/backends/types.ts),
  // resolved at call time. This guards the IDENTITY != MODEL boundary at the type level by
  // asserting the known field set never grows a model-ish key.
  const forbiddenKeys = ['modelId', 'model', 'provider']
  const offenders: string[] = []
  for (const agent of NEBULA_AGENTS) {
    for (const key of forbiddenKeys) {
      if (key in (agent as unknown as Record<string, unknown>)) offenders.push(`${agent.id}:${key}`)
    }
  }
  return {
    name: 'identity_definition_never_hardcodes_a_model',
    pass: offenders.length === 0,
    detail: offenders.length === 0 ? 'no identity carries a model/provider field' : offenders.join(', '),
  }
}

function checkDisplayNameHelpers(): NebulaValidationResult {
  const mapped: Array<[keyof typeof NEBULA_IDENTITY_BY_SEAT, string]> = [
    ['chatgpt', 'AURORA'],
    ['kimi', 'NOVA'],
    ['grok', 'PULSAR'],
    ['red_team', 'PHOENIX'],
    ['claude', 'ORION'],
    ['gemini', 'LUMEN'],
  ]
  const offenders = mapped.filter(([seat, name]) => displayNameForSeat(seat) !== name || familyDisplayName(seat) !== name)
  const reverseOk =
    seatForDisplayIdentity('AURORA') === 'chatgpt'
    && seatForDisplayIdentity('ChatGPT Family') === 'chatgpt'
    && seatForDisplayIdentity('Phoenix Council') === 'red_team'
    && seatForDisplayIdentity('Red Team') === 'red_team'
  return {
    name: 'display_helpers_resolve_nebula_and_legacy_aliases',
    pass: offenders.length === 0 && reverseOk,
    detail: offenders.length === 0 && reverseOk ? 'display + reverse map ok' : `offenders=${offenders.map(([s]) => s).join(',')}`,
  }
}

function checkGreetingAndIdentityPrompts(): NebulaValidationResult {
  const greetingOffenders = (Object.keys(NEBULA_IDENTITY_BY_SEAT) as Array<keyof typeof NEBULA_IDENTITY_BY_SEAT>)
    .filter(seat => FRONTIER_NAME_PATTERN.test(GREETING_META_BY_FAMILY[seat].label))
  const identityOffenders = (Object.keys(PROVIDER_IDENTITY_PROFILES) as Array<keyof typeof PROVIDER_IDENTITY_PROFILES>)
    .filter(seat => {
      const name = displayNameForSeat(seat)
      return !PROVIDER_IDENTITY_PROFILES[seat].startsWith(`${name}:`)
    })
  return {
    name: 'greeting_and_provider_identity_use_nebula_names',
    pass: greetingOffenders.length === 0 && identityOffenders.length === 0,
    detail: greetingOffenders.length === 0 && identityOffenders.length === 0
      ? 'prompt identity layers are Nebula-named'
      : `greeting=${greetingOffenders.join(',')} identity=${identityOffenders.join(',')}`,
  }
}

function checkFrontierProvidersPreservedAsBackends(): NebulaValidationResult {
  const providers = COUNCIL_ROSTER.filter(entry => NEBULA_IDENTITY_BY_SEAT[entry.id]).map(entry => entry.provider)
  const preserved = providers.some(p => /OpenAI/i.test(p))
    && providers.some(p => /Anthropic/i.test(p))
    && providers.some(p => /xAI/i.test(p))
    && providers.some(p => /Google/i.test(p))
    && providers.some(p => /Moonshot/i.test(p))
  return {
    name: 'frontier_providers_preserved_as_backends',
    pass: preserved,
    detail: preserved ? providers.join(' | ') : 'missing expected backend provider labels',
  }
}

function checkLocalFirstSupported(): NebulaValidationResult {
  const pass = COUNCIL_ROUTING_MODES.includes('LOCAL_FIRST')
  return { name: 'local_first_routing_mode_supported', pass, detail: COUNCIL_ROUTING_MODES.join(',') }
}

function checkAstraConstellationFoundation(): NebulaValidationResult {
  const plan = planBoundedConstellation('Research War Room runtime architecture, verify sources, and challenge weak claims.')
  const unique = constellationAgentIdentitiesAreUnique(plan)
  const bounded = constellationRespectsBounds(plan)
  const attributable = plan.agents.every(agent => agent.createdBy === 'astra' && agent.constellationId === plan.constellationId)
  const notSpawned = plan.spawned === false
  return {
    name: 'astra_bounded_constellation_foundation',
    pass: unique && bounded && attributable && notSpawned && plan.createdBy === 'astra' && plan.agents.length > 0
      && temporaryWorkersExpire(plan)
      && temporaryWorkersAreRoleInstancesNotIdentities(plan),
    detail: `${plan.constellationId} agents=${plan.agents.length} unique=${unique} bounded=${bounded} spawned=${plan.spawned} expire=${temporaryWorkersExpire(plan)}`,
  }
}

function checkAscensionFoundation(): NebulaValidationResult {
  const missing = NEBULA_AGENT_IDS.filter(id => !NEBULA_EVOLUTION_PROFILES[id] || NEBULA_EVOLUTION_PROFILES[id].agentId !== id)
  const unvalidated = canApplySkillGrowth([])
  const validated = canApplySkillGrowth([{
    evidenceId: 'ev-1',
    kind: 'mission_outcome',
    summary: 'Completed a real evaluation',
    sourceRef: 'mission:test',
    validated: true,
    recordedAt: '2026-09-05T00:00:00.000Z',
  }])
  const autonomyOff = !ASCENSION_AUTONOMY_GUARD.selfModificationEnabled
    && !ASCENSION_AUTONOMY_GUARD.weightTrainingEnabled
    && !ASCENSION_AUTONOMY_GUARD.productionEditEnabled
  return {
    name: 'ascension_independent_evolution_profiles',
    pass: missing.length === 0 && !unvalidated && validated && autonomyOff
      && ASCENSION_FOUNDATION.persistsAcrossBackendChange
      && ASCENSION_FOUNDATION.experienceSeparatedFromPromotion
      && ASCENSION_PROMOTION_PIPELINE.length >= 10,
    detail: missing.length === 0 && autonomyOff ? '8 profiles; evidence-gated growth; experience≠promotion; autonomy off' : `missing=${missing.join(',')}`,
  }
}

function checkKnowledgePlanIsDormant(): NebulaValidationResult {
  return {
    name: 'knowledge_absorption_not_mass_ingesting',
    pass: NEBULA_KNOWLEDGE_ABSORPTION_PLAN.enabled === false && NEBULA_KNOWLEDGE_ABSORPTION_PLAN.massIngest === false,
    detail: `enabled=${NEBULA_KNOWLEDGE_ABSORPTION_PLAN.enabled} massIngest=${NEBULA_KNOWLEDGE_ABSORPTION_PLAN.massIngest}`,
  }
}

function checkRuntimeStatusClassification(): NebulaValidationResult {
  const hit = isWarRoomRuntimeStatusDecree('Council, give me a short status summary of War Room.')
  const miss = !isWarRoomRuntimeStatusDecree('Tell me about the Panama relocation plan')
  return {
    name: 'war_room_runtime_status_decree_classified',
    pass: hit && miss,
    detail: hit && miss ? 'status summary of War Room classified; business memory not' : `hit=${hit} miss=${miss}`,
  }
}

function checkAuroraIsFinalSynthesizer(): NebulaValidationResult {
  const aurora = NEBULA_AGENTS_BY_ID.aurora
  const pass = aurora.backendPreference.seatId === 'chatgpt'
    && /final/i.test(aurora.role)
    && isFinalCouncilSynthesizer('aurora')
    && NEBULA_AGENT_IDS.filter(isFinalCouncilSynthesizer).length === 1
  return {
    name: 'aurora_is_final_visible_synthesizer',
    pass,
    detail: `${aurora.name} seat=${aurora.backendPreference.seatId} role=${aurora.role} exclusive=${NEBULA_AGENT_IDS.filter(isFinalCouncilSynthesizer).length === 1}`,
  }
}

function checkRoundHealthDoesNotRequireConversationFailureCards(): NebulaValidationResult {
  const health = projectRoundHealth({
    schema_version: '48c3a.family-deliberation.v1',
    session_id: 's',
    round_id: 'round-1',
    commander_turn_id: 'c',
    mission_id: 'm',
    mission_version: 1,
    commander_message_id: 'cm',
    commander_message: 'status',
    evidence_references: [],
    turns: [
      {
        turn_id: 't1',
        session_id: 's',
        round_id: 'round-1',
        commander_turn_id: 'c',
        mission_id: 'm',
        mission_version: 1,
        provider_family: 'grok',
        provider_label: 'PULSAR',
        provider_model: null,
        turn_role: 'direct_response',
        speaking_order: 1,
        input_message_ids: ['cm'],
        evidence_reference_ids: [],
        challenge_target_ids: [],
        revision_of_message_id: null,
        output_message_id: null,
        completion_status: 'failed',
        started_at: '2026-09-05T00:00:00.000Z',
        completed_at: '2026-09-05T00:00:01.000Z',
        failure_reason: 'NO_LOCAL_BACKEND',
        executive_position: '',
        full_response: '',
        claims: [],
        direct_agreements: [],
        direct_disagreements: [],
        risks_or_limitations: [],
        confidence: null,
        recommended_action: '',
        revision_status: 'not_revision',
      },
      {
        turn_id: 't2',
        session_id: 's',
        round_id: 'round-1',
        commander_turn_id: 'c',
        mission_id: 'm',
        mission_version: 1,
        provider_family: 'chatgpt',
        provider_label: 'AURORA',
        provider_model: 'openai:gpt-4o',
        turn_role: 'council_synthesis',
        speaking_order: 2,
        input_message_ids: ['cm'],
        evidence_reference_ids: [],
        challenge_target_ids: [],
        revision_of_message_id: null,
        output_message_id: 't2-message',
        completion_status: 'complete',
        started_at: '2026-09-05T00:00:00.000Z',
        completed_at: '2026-09-05T00:00:02.000Z',
        failure_reason: null,
        executive_position: 'War Room is up.',
        full_response: 'War Room is up.',
        claims: [],
        direct_agreements: [],
        direct_disagreements: [],
        risks_or_limitations: [],
        confidence: 0.7,
        recommended_action: '',
        revision_status: 'not_revision',
      },
    ],
    synthesis_turn_id: 't2',
    completion_status: 'complete',
    provider_boundaries: [],
    diagnostics: [],
  })
  return {
    name: 'failed_agents_recorded_as_round_health_not_conversation',
    pass: health.failures.length === 1
      && health.synthesisAvailable
      && health.synthesisReady
      && health.status === 'complete'
      && health.synthesizerIdentity === 'AURORA'
      && health.degraded
      && health.requested === 2
      && health.completed === 1
      && health.failed === 1
      && Boolean(auroraDegradedRoundNotice(health)),
    detail: `failures=${health.failures.length} synthesis=${health.synthesisAvailable} degraded=${health.degraded} requested=${health.requested} completed=${health.completed}`,
  }
}

function checkRoleContractsComplete(): NebulaValidationResult {
  const contracts = allRoleContracts()
  const incomplete = contracts.filter(contract =>
    !contract.optimizationTarget.trim()
    || contract.responsibilities.length === 0
    || contract.nonResponsibilities.length === 0
    || contract.defaultQuestions.length === 0
    || !contract.requiredOutputContract
    || contract.escalationRules.length === 0
    || contract.authorityLimits.length === 0
    || !roleContractMatchesIdentity(contract.agentId),
  )
  const distinctTargets = allPermanentAgentsHaveDistinctOptimizationTargets()
  return {
    name: 'role_contracts_complete_for_all_eight',
    pass: incomplete.length === 0 && contracts.length === 8 && distinctTargets,
    detail: incomplete.length === 0 && distinctTargets ? '8/8 contracts with distinct optimization targets' : `incomplete=${incomplete.map(item => item.agentId).join(',')}`,
  }
}

function checkOutputContractsComplete(): NebulaValidationResult {
  const pass = everyAgentHasOutputContract()
  return {
    name: 'output_contracts_complete_for_all_eight',
    pass,
    detail: pass ? NEBULA_AGENT_IDS.map(id => OUTPUT_CONTRACTS[id].contractId).join(', ') : 'missing output contract',
  }
}

function checkCapabilityLedgerEvidenceGated(): NebulaValidationResult {
  const seeded = everyAgentHasCapabilityLedger()
  const aurora = NEBULA_CAPABILITY_LEDGERS.aurora.capabilities[0]
  if (!aurora) {
    return { name: 'capability_ledger_evidence_gated', pass: false, detail: 'aurora ledger empty' }
  }
  const used = recordCapabilityUse(aurora)
  const unevaluatedGrowth = used.evidenceCount === aurora.evidenceCount && used.status === 'UNPROVEN' && used.proficiency === 0
  const rejected = applyCapabilityEvaluation(aurora, {
    evaluationId: 'eval-unvalidated',
    capabilityId: aurora.capabilityId,
    agentId: 'aurora',
    success: true,
    backendKey: 'qwen3',
    score: 0.9,
    sourceRef: 'fixture',
    validated: false,
    evaluatedAt: '2026-09-05T00:00:00.000Z',
  })
  const accepted = applyCapabilityEvaluation(aurora, {
    evaluationId: 'eval-validated',
    capabilityId: aurora.capabilityId,
    agentId: 'aurora',
    success: true,
    backendKey: 'qwen3',
    score: 0.91,
    sourceRef: 'fixture',
    validated: true,
    evaluatedAt: '2026-09-05T00:00:00.000Z',
  })
  return {
    name: 'capability_ledger_evidence_gated',
    pass: seeded && unevaluatedGrowth && !rejected.grown && rejected.reason === 'evaluation_not_validated' && accepted.next.evidenceCount === 1 && capabilityGrowthRequiresEvidence(),
    detail: `seeded=${seeded} use_does_not_grow=${unevaluatedGrowth} unvalidated_blocked=${!rejected.grown} validated_recorded=${accepted.next.evidenceCount === 1}`,
  }
}

function checkAscensionPromotionPipeline(): NebulaValidationResult {
  const vague = createLessonCandidate({
    lessonId: 'vague',
    agentId: 'aurora',
    type: 'heuristic',
    trigger: 'always',
    proposedMethod: 'be more thoughtful',
    sourceEpisodeIds: ['ep-1'],
    expectedBenefit: 'wisdom',
    knownRisks: [],
    evaluationIds: [],
  })
  const structured = pulsarPrimarySourceLessonFixture()
  const experience = recordExperience({
    experienceId: 'exp-1',
    agentId: 'pulsar',
    kind: 'failure',
    summary: 'secondary sources only',
    sourceRef: 'mission:fixture',
    recordedAt: '2026-09-05T00:00:00.000Z',
  })
  const promoted = decideLessonPromotion({
    candidate: { ...structured, sourceEpisodeIds: ['ep-1'] },
    provenanceComplete: true,
    targetImprovementObserved: true,
    regressionDetected: false,
    roleAdherenceMaintained: true,
    costAcceptable: true,
    latencyAcceptable: true,
    safetyClear: true,
    humanReviewPassed: true,
    commanderApproved: true,
  })
  const blocked = decideLessonPromotion({
    candidate: structured,
    provenanceComplete: false,
    targetImprovementObserved: false,
    regressionDetected: true,
    roleAdherenceMaintained: false,
    costAcceptable: false,
    latencyAcceptable: false,
    safetyClear: false,
    humanReviewPassed: false,
    commanderApproved: false,
  })
  const pass = vague.promotionStatus === 'rejected'
    && isTestableLessonCandidate(structured)
    && !experienceChangesProductionBehavior(experience)
    && promoted === 'promoted'
    && blocked === 'rejected'
    && !productionBehaviorMayChange(blocked)
    && allPromotionGatesExist()
    && requiresCommanderApproval('permanent_identity')
    && requiresCommanderApproval('role_boundary')
    && requiresCommanderApproval('memory_access_scope')
    && requiresCommanderApproval('tool_permissions')
    && requiresCommanderApproval('authority')
    && requiresCommanderApproval('core_temperament_ranges')
  return {
    name: 'ascension_promotion_pipeline_foundation',
    pass,
    detail: `vague=${vague.promotionStatus} structured=${structured.promotionStatus} promoted=${promoted} blocked=${blocked} gates=${allPromotionGatesExist()}`,
  }
}

function checkMemoryScopesSeparated(): NebulaValidationResult {
  const pass = memoryScopesAreSeparated()
    && !agentMayWriteMemoryScope('aurora', 'global')
    && !agentMayWriteMemoryScope('nova', 'commander')
    && agentMayWriteMemoryScope('astra', 'constellation')
    && !agentMayWriteMemoryScope('nova', 'constellation')
  return {
    name: 'memory_scopes_separated',
    pass,
    detail: pass ? NEBULA_MEMORY_SCOPES.join(',') : 'scope separation failed',
  }
}

function checkGlobalKnowledgePromotionGate(): NebulaValidationResult {
  const blocked = evaluateGlobalKnowledgePromotion({
    candidateId: 'k1',
    stage: 'agent_output',
    agentOutputId: 'out-1',
    missionFindingId: null,
    claimIds: [],
    provenanceComplete: false,
    verified: false,
    commanderApproved: false,
    promotedToGlobal: false,
  })
  const allowed = evaluateGlobalKnowledgePromotion({
    candidateId: 'k2',
    stage: 'optional_promotion',
    agentOutputId: 'out-1',
    missionFindingId: 'find-1',
    claimIds: ['c1'],
    provenanceComplete: true,
    verified: true,
    commanderApproved: true,
    promotedToGlobal: false,
  })
  const pass = !agentConclusionIsAutomaticGlobalTruth()
    && blocked.allowed === false
    && allowed.allowed === true
    && GLOBAL_KNOWLEDGE_PROMOTION_FLOW[0] === 'agent_output'
    && GLOBAL_KNOWLEDGE_PROMOTION_FLOW[GLOBAL_KNOWLEDGE_PROMOTION_FLOW.length - 1] === 'global_war_room_knowledge'
  return {
    name: 'global_knowledge_requires_promotion',
    pass,
    detail: `blocked=${blocked.reason} allowed=${allowed.reason}`,
  }
}

function checkContextAssemblyRuntimeControlled(): NebulaValidationResult {
  const modules = buildContextModules({ agentId: 'aurora' })
  const assembled = assembleNebulaContext({ agentId: 'lumen' })
  const pass = NEBULA_CONTEXT_MODULE_ORDER.length === 11
    && requiredIdentityModulesAreRuntimeControlled(modules)
    && modelCannotOmitIdentity(assembled, 'lumen')
    && NEBULA_ROUND_FLOW[0] === 'rael_message'
    && NEBULA_ROUND_FLOW.includes('aurora_final_synthesis')
  return {
    name: 'context_assembly_runtime_controlled',
    pass,
    detail: pass ? 'identity/policy modules runtime-controlled; model cannot omit them' : 'context assembly failed',
  }
}

function checkAstraOrchestrationBoundary(): NebulaValidationResult {
  const plan = createCouncilRoundPlan({ roundId: 'round-boundary', commanderMessage: 'Research and verify the claim, then challenge weak assumptions.' })
  const pass = isOrchestrationOnly('astra')
    && !isOrchestrationOnly('aurora')
    && astraIsNotACouncilOpinionSeat(plan)
    && plan.synthesizerAgentId === 'aurora'
    && !plan.participatingAgentIds.includes('astra')
    && NEBULA_ROLE_CONTRACTS.astra.nonResponsibilities.some(item => /final Council synthesizer/i.test(item))
  return {
    name: 'astra_is_orchestration_only',
    pass,
    detail: `participants=${plan.participatingAgentIds.join(',')} synthesizer=${plan.synthesizerAgentId}`,
  }
}

function checkConstellationStoppingAndExpiry(): NebulaValidationResult {
  const plan = planBoundedConstellation('Research War Room runtime architecture, verify sources, and challenge weak claims.')
  const stop = shouldStopConstellation({
    requiredCoverageReached: true,
    marginalInformationLow: true,
    contradictionsBounded: true,
    evidenceThresholdMet: true,
    budgetApproaching: true,
    remainingQuestionsDecisionRelevant: false,
    roundsUsed: plan.maxRounds,
    maxRounds: plan.maxRounds,
    agentsUsed: plan.bounds.maxAgentsPerConstellation,
    maxAgents: plan.bounds.maxAgentsPerConstellation,
    expiredWorkers: 1,
  })
  const keepGoing = shouldStopConstellation({
    requiredCoverageReached: false,
    marginalInformationLow: false,
    contradictionsBounded: false,
    evidenceThresholdMet: false,
    budgetApproaching: false,
    remainingQuestionsDecisionRelevant: true,
    roundsUsed: 0,
    maxRounds: plan.maxRounds,
    agentsUsed: 1,
    maxAgents: plan.bounds.maxAgentsPerConstellation,
    expiredWorkers: 0,
  })
  const expired = workerIsExpired({ expiresAt: '2020-01-01T00:00:00.000Z' }, '2026-09-05T00:00:00.000Z')
  const pass = stop.stop && keepGoing.stop === false && expired && temporaryWorkersExpire(plan)
  return {
    name: 'constellation_bounds_and_temporary_worker_expiration',
    pass,
    detail: `stop=${stop.reasons.length} keepGoing=${!keepGoing.stop} expiredProbe=${expired}`,
  }
}

function checkBackendIndependentIdentity(): NebulaValidationResult {
  const local = createExecutionRecord({
    agentId: 'aurora',
    backendType: 'LOCAL',
    provider: 'ollama',
    model: 'huihui_ai/qwen3-abliterated:14b',
    attempt: 1,
  })
  const fallback = createExecutionRecord({
    agentId: 'aurora',
    backendType: 'EXTERNAL',
    provider: 'openai',
    model: 'gpt-4o',
    fallbackFrom: 'LOCAL',
    attempt: 2,
  })
  const foundation = backendIndependenceFoundation('aurora')
  const pass = auroraMustRemainAurora(local)
    && auroraMustRemainAurora(fallback)
    && identitySurvivesBackendChange(local, fallback)
    && !isIdentityFallback(fallback.displayedIdentity, 'aurora')
    && isIdentityFallback('NOVA', 'aurora')
    && foundation.pass
    && personalityPersistenceAcrossBackends('phoenix')
  return {
    name: 'backend_independent_identity',
    pass,
    detail: `local=${local.displayedIdentity}/${local.model} fallback=${fallback.displayedIdentity}/${fallback.model}`,
  }
}

function checkRoleDifferentiationFixtures(): NebulaValidationResult {
  const swap = roleSwapNovaVsLumen(DIFFERENTIATION_FIXTURES.nova, DIFFERENTIATION_FIXTURES.lumen)
  const novaAsLumen = accidentallyFulfillsContract(DIFFERENTIATION_FIXTURES.nova, 'lumen', 0.8)
  const lumenAsNova = accidentallyFulfillsContract(DIFFERENTIATION_FIXTURES.lumen, 'nova', 0.8)
  const pass = fixturesAreDifferentiated() && swap.differentiated && !novaAsLumen && !lumenAsNova
  return {
    name: 'role_differentiation_tests',
    pass,
    detail: pass
      ? `${DIFFERENTIATION_FIXTURE_LABEL}; NOVA/LUMEN role-swap distinct`
      : `swap differentiated=${swap.differentiated} novaAsLumen=${novaAsLumen} lumenAsNova=${lumenAsNova}`,
  }
}

function checkNoAutonomousSelfModificationOrTraining(): NebulaValidationResult {
  const pass = !ASCENSION_AUTONOMY_GUARD.selfModificationEnabled
    && !ASCENSION_AUTONOMY_GUARD.weightTrainingEnabled
    && !ASCENSION_AUTONOMY_GUARD.productionEditEnabled
    && !ASCENSION_AUTONOMY_GUARD.unvalidatedPromotionEnabled
  return {
    name: 'no_autonomous_self_modification_or_training',
    pass,
    detail: pass ? 'self-modification, training, production edits, and unvalidated promotion all disabled' : 'autonomy guard failed',
  }
}

function checkSharedGenesisBrain(): NebulaValidationResult {
  const undeclared = NEBULA_AGENT_IDS.filter(id => NEBULA_AGENTS_BY_ID[id].backendPreference.sharedLocalBacking !== true)
  const wrongSlot = NEBULA_AGENT_IDS.filter(id => NEBULA_AGENTS_BY_ID[id].backendPreference.roleSlot !== 'GENERAL')
  const wrongProfile = NEBULA_AGENT_IDS.filter(id => NEBULA_MODEL_PROFILES[id].preferredModel !== NEBULA_SHARED_LOCAL_MODEL_ID)
  const pass = allPermanentAgentsShareGenesisGeneral()
    && noPermanentAgentRequiresSeparateModel()
    && noPermanentAgentRequiresDolphin()
    && mappedNebulaSeatsUseGeneralSlot()
    && undeclared.length === 0
    && wrongSlot.length === 0
    && wrongProfile.length === 0
    && NEBULA_SHARED_BRAIN_SUMMARY.sharedBacking === true
    && NEBULA_SHARED_BRAIN_SUMMARY.agentIdentities.length === 8
  return {
    name: 'all_eight_share_genesis_general_qwen3',
    pass,
    detail: pass
      ? `${NEBULA_SHARED_LOCAL_MODEL_ID} sharedBacking=true slot=GENERAL agents=${NEBULA_SHARED_BRAIN_SUMMARY.agentIdentities.join(',')}`
      : `undeclared=${undeclared.join(',')} wrongSlot=${wrongSlot.join(',')} wrongProfile=${wrongProfile.join(',')}`,
  }
}

function checkWrEngineerCoderModelUntouched(): NebulaValidationResult {
  const nebulaPrefersCoder = NEBULA_AGENT_IDS.some(id => /qwen2\.5-coder/i.test(NEBULA_MODEL_PROFILES[id].preferredModel))
  const orionRemapped = NEBULA_AGENTS_BY_ID.orion.backendPreference.roleSlot !== 'GENERAL'
  const pass = !nebulaPrefersCoder && !orionRemapped
  return {
    name: 'wr_engineer_coder_model_not_used_as_nebula_brain',
    pass,
    detail: pass
      ? 'ORION stays on shared GENERAL Qwen3; qwen2.5-coder:14b is not a Nebula preferred model'
      : `nebulaPrefersCoder=${nebulaPrefersCoder} orionRemapped=${orionRemapped}`,
  }
}

export function runNebulaValidation(): NebulaValidationResult[] {
  return [
    checkAllEightRegistered(),
    checkDistinctRoles(),
    checkNoFrontierNameInIdentityFields(),
    checkRosterLabelsClean(),
    checkPhoenixDoesNotRequireDolphin(),
    checkSharedBackingDisclosedHonestly(),
    checkNoRoleSlotClaimsPhantomModel(),
    checkIdentityModelSeparation(),
    checkDisplayNameHelpers(),
    checkGreetingAndIdentityPrompts(),
    checkFrontierProvidersPreservedAsBackends(),
    checkLocalFirstSupported(),
    checkAstraConstellationFoundation(),
    checkAscensionFoundation(),
    checkKnowledgePlanIsDormant(),
    checkRuntimeStatusClassification(),
    checkAuroraIsFinalSynthesizer(),
    checkRoundHealthDoesNotRequireConversationFailureCards(),
    checkRoleContractsComplete(),
    checkOutputContractsComplete(),
    checkCapabilityLedgerEvidenceGated(),
    checkAscensionPromotionPipeline(),
    checkMemoryScopesSeparated(),
    checkGlobalKnowledgePromotionGate(),
    checkContextAssemblyRuntimeControlled(),
    checkAstraOrchestrationBoundary(),
    checkConstellationStoppingAndExpiry(),
    checkBackendIndependentIdentity(),
    checkRoleDifferentiationFixtures(),
    checkNoAutonomousSelfModificationOrTraining(),
    checkSharedGenesisBrain(),
    checkWrEngineerCoderModelUntouched(),
  ]
}

export type { NebulaAgentId }
export { NEBULA_AGENTS_BY_ID }
