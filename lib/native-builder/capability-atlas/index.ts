export * from './types'
export { loadTaxonomy, taxonomyById, findTaxonomyNodes, taxonomyLeaves } from './taxonomy'
export { computeCapabilityStatus, assertCanAssignStatus, applyDerivedStatus, CapabilityStatusError } from './status'
export { createSourceRecord, markSourceStale, sortSourcesByPriority, appendSourceHistory, hashSourceContent } from './sources'
export { createRelationship, walkPrerequisites, relatedSkills, SkillGraphError } from './graph'
export { createEvaluation, recordEvaluationOutcome, recordSkillEvaluation } from './evaluations'
export {
  capabilityAtlasLayout,
  loadCapabilityAtlas,
  seedAtlas,
  registerSkill,
  registerRelationship,
  persistSkill,
  persistSource,
  persistEvaluation,
  persistRelationships,
  getSkill,
  SkillRegistryError,
  type CapabilityAtlas,
} from './store'
export { resolveMissionSkills, detectSkillGaps, buildSkillPack, skillPackIsCompact, toGap } from './resolver'
export { planSkillAcquisition, SKILL_ACQUISITION_STEPS } from './acquisition'
export {
  WAVE1_TARGET_SKILLS,
  resolveWave1Skills,
  runAcquisitionWave1,
  type ExerciseEvidence,
} from './acquisitionWave1'
export {
  WAVE2_TARGET_SKILLS,
  resolveWave2Skills,
  runAcquisitionWave2,
} from './acquisitionWave2'
export {
  WAVE3_TARGET_SKILLS,
  resolveWave3Skills,
  runAcquisitionWave3,
  NATIVE_CUDA_BLOCKER,
} from './acquisitionWave3'
export {
  WAVE4_TARGET_SKILLS,
  resolveWave4Skills,
  runAcquisitionWave4,
  WAVE4_GOVERNANCE,
  WAVE4_CUDA_REVIEW,
} from './acquisitionWave4'
export {
  runToolchainPrep,
  probeToolchainReadiness,
  TOOLCHAIN_GOVERNANCE,
  NEBULA_REPLAY_SKILLS,
} from './toolchainPrep'
export {
  ACQUISITION_GOVERNANCE,
  AcquisitionSandboxError,
  assertSandboxIsolation,
  assertNotFakeCudaPass,
  assertNoAutomaticPackageInstall,
  wave1SandboxRoot,
  wave2SandboxRoot,
  nebulaSandboxRoot,
  wave3SandboxRoot,
  wave4SandboxRoot,
  writeSandboxFile,
  probeAcquisitionEnvironment,
  which,
} from './acquisitionSandbox'
export {
  assessMissionCapabilities,
  persistableCapabilityAssessment,
  loadMissionSkillPacks,
  inferSkillHints,
  buildResolverMission,
  isProductionProofMission,
  PLANNER_CAPABILITY_GATE,
  type PlannerCapabilityInput,
} from './plannerGate'
export { buildCapabilityScoreboard, persistScoreboard } from './scoreboard'
export {
  selfKnowledgeBundle,
  answerCodingSkills,
  answerProvenSkills,
  answerLocalSkills,
  answerNeverTested,
  answerStaleSkills,
  answerLearnNext,
  answerMissionSkills,
  answerRegisteredSkills,
  answerSourceBackedSkills,
  answerEvaluatedSkills,
  answerProductionProvenSkills,
  answerFailedSkills,
} from './selfKnowledge'
export { ENGINEERING_MEMORY_BOUNDARY, skillPackOmitsRepoFacts, recallRepoTruthForSkill, assertMemoryNotCopiedIntoAtlas } from './memoryBoundary'
export { WRIM_INTEGRATION_BOUNDARY, WATCHTOWER_INTEGRATION_BOUNDARY, LEGION_INTEGRATION_BOUNDARY, wrimTrainingForbidden, type WatchtowerStaleHint, type LegionSkillRequest } from './integration'
export { routingForSkill } from './routing'
export { catalogExistingResearchArtifacts, NEXT_RESEARCH_MISSION } from './researchCatalog'
export { DISCOVERY_WAVES, COMPLETED_DISCOVERY_MISSION, harvestKimiOfficialUrls } from './discoveryCatalog'
export {
  runDiscoveryWaves,
  ingestDiscoveryCandidate,
  createDedupeState,
  canonicalizeSourceUrl,
  isBlogHost,
  DISCOVERY_GOVERNANCE,
  readDiscoverySummary,
} from './discoveryEngine'
export { CAPABILITY_ATLAS_TOOL_NAMES, isCapabilityAtlasToolName, executeCapabilityAtlasTool } from './tools'
export {
  bootstrapAvailableSkillEvaluations,
  listAvailableSkills,
  creditPolicyForSkill,
  classifyValidatorOutput,
  SAFE_VALIDATORS,
  EVALUATION_BOOTSTRAP_GOVERNANCE,
} from './evaluationBootstrap'

import { markSourceStale } from './sources'
import { persistSource, persistRelationships, type CapabilityAtlas } from './store'
import { createRelationship } from './graph'
import type { RelationshipKind } from './types'
import { wrimTrainingForbidden, type WatchtowerStaleHint } from './integration'

export function applyWatchtowerStaleHint(atlas: CapabilityAtlas, hint: WatchtowerStaleHint): void {
  const source = atlas.sources.get(hint.sourceId)
  if (!source) throw new Error(`Unknown source: ${hint.sourceId}`)
  persistSource(atlas, markSourceStale(source, hint.reason, hint.detectedAt), 'MARKED_STALE')
}

export function addSkillRelationship(atlas: CapabilityAtlas, from: string, kind: RelationshipKind, to: string, note = '') {
  persistRelationships(atlas, [createRelationship(from, kind, to, note)])
}

export const GOVERNANCE = {
  commit: false,
  push: false,
  liveDeploy: false,
  terra: false,
  wrimTraining: wrimTrainingForbidden().wrimTraining,
  purchase: false,
  secrets: false,
  directModelFilesystemMutation: false,
} as const
