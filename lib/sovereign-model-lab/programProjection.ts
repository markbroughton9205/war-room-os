/**
 * Canonical WRM-001 read model (Part 3). buildProgramProjection is the ONE function every route
 * and every UI section reads through — no route or component may recompute program/dataset/
 * corpus/tokenizer/training status independently.
 *
 * Commander addendum: this module never mutates or persists anything. reportedState is exactly
 * what's on disk; effectiveState is the honest, cross-checked view computed fresh on every call;
 * migrationRequired just flags a disagreement between the two. Actually correcting a persisted
 * record (migrateProgramState, below) only ever runs when an explicit Commander action calls it —
 * never automatically inside a projection/read path.
 */
import type {
  DatasetManifest,
  CorpusManifest,
  HardwareCapabilityReport,
  ModelManifest,
  ProgramIntegrityContradiction,
  ProgramProjection,
  SovereignDocumentRecord,
  SovereignModelLabProgram,
  SovereignModelLabState,
  TokenizerExperiment,
  TrainingCheckpoint,
  TrainingExperiment,
} from './types'

export type ProgramProjectionInputs = {
  program: SovereignModelLabProgram
  documents: SovereignDocumentRecord[]
  datasetManifest: DatasetManifest | null
  corpusManifest: CorpusManifest | null
  tokenizerExperiment: TokenizerExperiment | null
  trainingExperiment: TrainingExperiment | null
  checkpoints: TrainingCheckpoint[]
  models: ModelManifest[]
  hardware: HardwareCapabilityReport | null
}

function hasVerifiedTokenizerArtifact(tokenizerExperiment: TokenizerExperiment | null): boolean {
  return Boolean(
    tokenizerExperiment?.verification?.allMandatoryChecksPassed
    && tokenizerExperiment.artifactFiles.length > 0,
  )
}

/** The honest state a program's reported `tokenizer_ready` collapses to when it isn't actually
 * backed by a verified artifact — never invented ad hoc, always one of these two, matching Part
 * 2's migration target exactly. */
function honestTokenizerFallbackState(tokenizerExperiment: TokenizerExperiment | null): SovereignModelLabState {
  return tokenizerExperiment?.plan ? 'tokenizer_plan_ready' : 'tokenizer_not_planned'
}

/** Pure — computes what the state truthfully is, cross-checked against linked records. Never
 * writes anything back to storage. */
export function computeEffectiveState(inputs: ProgramProjectionInputs): SovereignModelLabState {
  const { program, tokenizerExperiment } = inputs
  if (program.state === 'tokenizer_ready' && !hasVerifiedTokenizerArtifact(tokenizerExperiment)) {
    return honestTokenizerFallbackState(tokenizerExperiment)
  }
  return program.state
}

export function detectProgramIntegrityContradictions(inputs: ProgramProjectionInputs): ProgramIntegrityContradiction[] {
  const { program, datasetManifest, tokenizerExperiment, checkpoints, models, hardware } = inputs
  const contradictions: ProgramIntegrityContradiction[] = []

  const datasetApprovedStates: SovereignModelLabState[] = [
    'dataset_approved',
    'tokenizer_not_planned',
    'tokenizer_environment_unverified',
    'tokenizer_environment_blocked',
    'tokenizer_plan_ready',
    'awaiting_commander_tokenizer_approval',
    'tokenizer_training',
    'tokenizer_verification',
    'tokenizer_ready',
    'tokenizer_failed',
    'tokenizer_cancelled',
    'training_plan_ready',
    'awaiting_commander_training_approval',
  ]
  if (datasetApprovedStates.includes(program.state)) {
    if (!datasetManifest) {
      contradictions.push({
        kind: 'dataset_approved_without_manifest',
        detail: `Program state is ${program.state} (implies dataset approval) but no dataset manifest is linked.`,
      })
    } else {
      if (!datasetManifest.commanderApproved) {
        contradictions.push({
          kind: 'dataset_approved_without_manifest',
          detail: `Program state is ${program.state} but the linked dataset manifest ${datasetManifest.manifestId} was never marked Commander-approved.`,
        })
      }
      if (datasetManifest.documentCount === 0) {
        contradictions.push({
          kind: 'dataset_approved_zero_admitted',
          detail: `Dataset manifest ${datasetManifest.manifestId} has zero admitted documents.`,
        })
      }
    }
  }

  if (program.state === 'tokenizer_ready' && !hasVerifiedTokenizerArtifact(tokenizerExperiment)) {
    contradictions.push({
      kind: 'tokenizer_ready_without_verified_artifact',
      detail: 'Program state is tokenizer_ready but no linked tokenizer experiment has a verified artifact (allMandatoryChecksPassed with at least one artifact file).',
    })
  }

  for (const checkpoint of checkpoints) {
    if (checkpoint.verificationStatus !== 'hash_verified') {
      contradictions.push({
        kind: 'checkpoint_created_without_files',
        detail: `Checkpoint ${checkpoint.checkpointId} is recorded but its verificationStatus is "${checkpoint.verificationStatus}", not hash_verified.`,
      })
    }
  }

  const verifiedCheckpointIds = new Set(checkpoints.filter(cp => cp.verificationStatus === 'hash_verified').map(cp => cp.checkpointId))
  for (const model of models) {
    if (model.lineageKind === 'war_room_trained_from_scratch' && (!model.checkpointId || !verifiedCheckpointIds.has(model.checkpointId))) {
      contradictions.push({
        kind: 'model_registered_without_verified_checkpoint',
        detail: `Model ${model.modelId} claims lineage war_room_trained_from_scratch without a linked, hash-verified checkpoint.`,
      })
    }
  }

  if ((program.state === 'training_plan_ready' || program.state === 'awaiting_commander_training_approval') && hardware?.pythonAvailable === false) {
    contradictions.push({
      kind: 'training_ready_without_compatible_framework',
      detail: `Program state is ${program.state} but the last hardware report recorded pythonAvailable=false — no compatible local training framework is available.`,
    })
  }

  return contradictions
}

const COMMANDER_ACTIONS_BY_STATE: Record<SovereignModelLabState, string[]> = {
  hardware_audit: ['Register a data source'],
  source_registered: ['Ingest a document'],
  documents_ingested: ['Ingest another document', 'Verify provenance'],
  provenance_verified: ['Build dataset candidate'],
  dataset_candidate: ['Build dataset candidate', 'Submit for Commander dataset approval'],
  awaiting_commander_dataset_approval: ['Approve dataset', 'Reject dataset'],
  dataset_approved: ['Build corpus artifact'],
  tokenizer_not_planned: ['Inspect tokenizer environment'],
  tokenizer_environment_unverified: ['Inspect tokenizer environment'],
  tokenizer_environment_blocked: ['Recheck tokenizer environment (install blocked dependency manually)'],
  tokenizer_plan_ready: ['Request Commander tokenizer approval'],
  awaiting_commander_tokenizer_approval: ['Approve tokenizer training', 'Reject / revise plan'],
  tokenizer_training: ['Cancel tokenizer job'],
  tokenizer_verification: ['Verify tokenizer'],
  tokenizer_ready: ['Create training plan'],
  tokenizer_failed: ['Recheck program truth', 'Create a new tokenizer plan'],
  tokenizer_cancelled: ['Create a new tokenizer plan'],
  training_plan_ready: ['Request Commander training approval'],
  awaiting_commander_training_approval: [],
  blocked: ['Recheck program truth'],
  cancelled: [],
}

export function buildProgramProjection(inputs: ProgramProjectionInputs): ProgramProjection {
  const { program, documents, datasetManifest, corpusManifest, tokenizerExperiment, trainingExperiment, checkpoints, models } = inputs
  const effectiveState = computeEffectiveState(inputs)
  const admitted = documents.filter(d => d.allowedForTraining)
  const excluded = documents.filter(d => !d.allowedForTraining)

  const datasetState: ProgramProjection['datasetState'] = !datasetManifest
    ? 'none'
    : datasetManifest.commanderApproved
      ? 'approved'
      : program.state === 'awaiting_commander_dataset_approval'
        ? 'awaiting_approval'
        : 'candidate'

  const trainingPlanState: ProgramProjection['trainingPlanState'] = !trainingExperiment
    ? 'none'
    : program.state === 'awaiting_commander_training_approval'
      ? 'awaiting_approval'
      : 'ready'

  const missingRequirements: string[] = []
  if (!datasetManifest) missingRequirements.push('No dataset candidate built yet.')
  if (!corpusManifest) missingRequirements.push('No corpus artifact built yet.')
  if (!tokenizerExperiment?.plan) missingRequirements.push('No tokenizer execution plan created yet.')
  if (!tokenizerExperiment?.verification?.allMandatoryChecksPassed) missingRequirements.push('No verified tokenizer artifact yet.')
  if (!trainingExperiment) missingRequirements.push('No training plan created yet.')

  const blockingRequirements: string[] = []
  if (program.state === 'tokenizer_environment_blocked') blockingRequirements.push('Tokenizer environment is missing a required dependency (tokenizers/sentencepiece) and cannot proceed without manual installation.')
  if (program.state === 'tokenizer_failed') blockingRequirements.push('The last tokenizer training run failed — see jobStatus for detail.')
  if (program.state === 'blocked') blockingRequirements.push('Program is blocked — see history for the reason.')

  const integrityContradictions = detectProgramIntegrityContradictions(inputs)

  return {
    programId: program.programId,
    reportedState: program.state,
    effectiveState,
    migrationRequired: effectiveState !== program.state,
    sourceCount: program.registeredSourceIds.length,
    linkedSourceCount: program.registeredSourceIds.length,
    documentCount: documents.length,
    admittedDocumentCount: admitted.length,
    excludedDocumentCount: excluded.length,
    datasetState,
    datasetDocumentCount: datasetManifest?.documentCount ?? 0,
    corpusState: corpusManifest ? 'built' : 'none',
    corpusClassification: corpusManifest?.classification ?? null,
    tokenizerState: effectiveState,
    tokenizerArtifactCount: tokenizerExperiment?.artifactFiles.length ?? 0,
    trainingPlanState,
    checkpointCount: checkpoints.length,
    modelCount: models.length,
    missingRequirements,
    blockingRequirements,
    availableCommanderActions: COMMANDER_ACTIONS_BY_STATE[program.state] ?? [],
    integrityContradictions,
  }
}

export type ProgramStateMigrationResult = {
  migrated: boolean
  program: SovereignModelLabProgram
  reason?: string
}

/**
 * The ONLY function in this module allowed to describe a persisted state correction — and even
 * this function does not persist anything itself; it returns the corrected program object plus a
 * history entry for the caller (runtime.ts, from an explicit RECHECK PROGRAM TRUTH action only) to
 * save. Never called automatically from a projection/read path.
 */
export function migrateProgramState(inputs: ProgramProjectionInputs): ProgramStateMigrationResult {
  const { program } = inputs
  const effectiveState = computeEffectiveState(inputs)
  if (effectiveState === program.state) {
    return { migrated: false, program }
  }
  const at = new Date().toISOString()
  const reason = `Truth reconciliation: reported state "${program.state}" was not backed by a verified tokenizer artifact. Corrected to "${effectiveState}".`
  return {
    migrated: true,
    reason,
    program: {
      ...program,
      state: effectiveState,
      history: [...program.history, { state: effectiveState, at, note: reason }],
      updatedAt: at,
    },
  }
}
