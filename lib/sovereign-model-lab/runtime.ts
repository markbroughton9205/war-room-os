/**
 * Sovereign Model Lab orchestrator — the only module that drives SovereignModelLabState
 * transitions. Every transition is validated against SOVEREIGN_MODEL_LAB_TRANSITIONS and
 * persisted. storage.ts/provenanceLedger.ts stay leaves; this module is the one place that calls
 * into them and decides what happens next — same direction discipline used throughout this
 * repo's other self-repair/native-builder work.
 *
 * MODEL-TRAINING HARD BOUNDARY: this file contains no function that starts real *model* training.
 * The furthest any program can go is `awaiting_commander_training_approval` via
 * requestTrainingApproval() — there is no function here that could take it further, because no
 * model-training-in-progress state exists in the type union at all. tokenizer_training (Phase 2A)
 * is the only real local process this file can start, and even that only after a full
 * environment-probe -> plan -> Commander-approval -> freshness-recheck chain (see
 * startTokenizerTrainingForProgram) — never from a dry run, a dependency probe, or a config file
 * alone.
 */
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { logWarRoomRepoAudit } from '@/lib/war-room/repoAudit'
import {
  REQUIRED_TOKENIZER_SPECIAL_TOKENS,
  SOVEREIGN_MODEL_LAB_TRANSITIONS,
  type DatasetAccessStatus,
  type DatasetLicenseRecord,
  type SovereignDatasetSourceFamily,
  type SovereignDocumentRecord,
  type SovereignModelLabProgram,
  type SovereignModelLabState,
  type TokenizerAlgorithm,
  type TokenizerArtifactFile,
  type TokenizerExperiment,
  type TokenizerJobStatus,
  type TokenizerSpecialToken,
  type TrainingScaleClass,
} from './types'
import { runHardwareProbe } from './hardwareProbe'
import { evaluateSourceAdmission, type SourceAdmissionInput } from './sourcePolicy'
import { appendProvenanceEntry, getLatestProvenanceEntry } from './provenanceLedger'
import { ingestLocalFile, isExactDuplicate } from './documentIngest'
import { registerSource, type RegisterSourceInput } from './publicSourceRegistry'
import { buildDatasetManifest, approveDatasetManifest } from './datasetBuilder'
import { buildCorpusArtifact, readCorpusManifest } from './corpusBuilder'
import { probeTokenizerEnvironment } from './tokenizerEnvironment'
import {
  createTokenizerApproval,
  finalizePlanWithHash,
} from './tokenizerApproval'
import {
  TokenizerApprovalInvalidError,
  cancelTokenizerTraining,
  startTokenizerTraining,
} from './tokenizerRuntime'
import { summarizeArtifactFiles, verifyTokenizerArtifact } from './tokenizerVerifier'
import { migrateProgramState, type ProgramProjectionInputs, type ProgramStateMigrationResult } from './programProjection'
import { buildTrainingPlan } from './trainingPlanner'
import {
  corpusVersionDir,
  getDatasetManifest,
  getHardwareReport,
  getProgram,
  getTokenizerExperiment,
  getTokenizerJobStatus,
  listCorpusVersions,
  listDocuments,
  resolveSovereignModelLabStorageRoot,
  saveDatasetManifest,
  saveDocument,
  saveHardwareReport,
  saveProgram,
  saveTokenizerExperiment,
  saveTrainingExperiment,
} from './storage'

const CORPUS_ID = 'WRM-001'
/** Generous for a tiny local corpus, still bounded — never unbounded. */
const TOKENIZER_MAX_RUNTIME_MS = 10 * 60 * 1000

export class InvalidSovereignStateTransitionError extends Error {
  constructor(from: SovereignModelLabState, to: SovereignModelLabState) {
    super(`Illegal sovereign-model-lab transition: ${from} -> ${to}`)
    this.name = 'InvalidSovereignStateTransitionError'
  }
}

function transition(program: SovereignModelLabProgram, next: SovereignModelLabState, note?: string): SovereignModelLabProgram {
  const allowed = SOVEREIGN_MODEL_LAB_TRANSITIONS[program.state]
  if (!allowed.includes(next)) {
    throw new InvalidSovereignStateTransitionError(program.state, next)
  }
  const at = new Date().toISOString()
  return { ...program, state: next, history: [...program.history, { state: next, at, note }], updatedAt: at }
}

async function persist(program: SovereignModelLabProgram, auditMessage: string): Promise<SovereignModelLabProgram> {
  await saveProgram(program)
  await logWarRoomRepoAudit(`sovereign-model-lab: ${auditMessage}`, { programId: program.programId, state: program.state })
  return program
}

// ---------------------------------------------------------------------------
// [ BEGIN WAR ROOM MODEL 001 ]
// ---------------------------------------------------------------------------

export type BeginProgramResult = {
  program: SovereignModelLabProgram
  missing: string[]
}

/** Runs the hardware audit for real, creates an empty program record, and reports what's missing
 * before any dataset work can proceed. Never implies training started. */
export async function beginModelProgram(name: string): Promise<BeginProgramResult> {
  const report = await runHardwareProbe()
  const hardwareReportId = randomUUID()
  await saveHardwareReport(hardwareReportId, report)

  const now = new Date().toISOString()
  const program: SovereignModelLabProgram = {
    programId: randomUUID(),
    name,
    state: 'hardware_audit',
    history: [{ state: 'hardware_audit', at: now, note: 'Hardware audit completed.' }],
    hardwareReportId,
    registeredSourceIds: [],
    ingestedDocumentIds: [],
    datasetManifestId: null,
    tokenizerExperimentId: null,
    trainingExperimentId: null,
    createdAt: now,
    updatedAt: now,
  }
  await persist(program, 'program created, hardware audit complete')

  const missing = [
    'No data source registered yet.',
    'No documents ingested yet.',
    'No dataset candidate built yet.',
    'No corpus artifact built yet.',
    'No tokenizer environment probe run yet.',
    'No tokenizer plan created yet.',
    'No verified tokenizer artifact yet.',
    'No training plan created yet.',
  ]

  return { program, missing }
}

// ---------------------------------------------------------------------------
// Source registration
// ---------------------------------------------------------------------------

export async function registerSourceForProgram(programId: string, input: RegisterSourceInput): Promise<SovereignModelLabProgram> {
  const program = await requireProgram(programId)
  const source = await registerSource(input)
  const next: SovereignModelLabProgram = { ...program, registeredSourceIds: [...program.registeredSourceIds, source.id] }
  const inState = next.state === 'source_registered' ? next : transition(next, 'source_registered', `Source registered: ${source.label}`)
  return persist(inState, `source registered (${source.family})`)
}

// ---------------------------------------------------------------------------
// Document ingestion (local only)
// ---------------------------------------------------------------------------

export type IngestDocumentInput = {
  localPath: string
  sourceType: SovereignDatasetSourceFamily | 'local_upload'
  publisher: string
  title: string
  accessStatus: DatasetAccessStatus
  license: DatasetLicenseRecord
  authorshipDocumented: boolean
  knownIllegitimateAcquisition?: boolean
  illegitimateAcquisitionReason?: string
}

export type IngestDocumentResult = {
  program: SovereignModelLabProgram
  document: SovereignDocumentRecord | null
  error: string | null
}

export async function ingestDocumentForProgram(programId: string, input: IngestDocumentInput): Promise<IngestDocumentResult> {
  const program = await requireProgram(programId)

  const candidate = await ingestLocalFile(input.localPath)
  if (!candidate.ok || !candidate.contentHash) {
    return { program, document: null, error: candidate.error ?? 'Ingestion failed.' }
  }

  const existingDocs = await listDocuments()
  const knownHashes = new Set(existingDocs.map(d => d.contentHash))
  const duplicate = isExactDuplicate(candidate.contentHash, knownHashes)

  const admissionInput: SourceAdmissionInput = {
    accessStatus: input.accessStatus,
    license: input.license,
    knownIllegitimateAcquisition: input.knownIllegitimateAcquisition,
    illegitimateAcquisitionReason: input.illegitimateAcquisitionReason,
    authorshipDocumented: input.authorshipDocumented,
    sourceDocumented: true, // ingestLocalFile succeeding is itself documentation of the local path
  }
  const decision = evaluateSourceAdmission(admissionInput)

  const allowedForTraining = decision.decision === 'auto_admit' && !duplicate
  const exclusionReason = duplicate
    ? 'Exact duplicate of an already-ingested document (same content hash).'
    : decision.decision === 'auto_reject'
      ? decision.reasons.join(' ')
      : decision.decision === 'commander_review_required'
        ? `Awaiting Commander review: ${decision.reasons.join(' ')}`
        : null

  const documentId = randomUUID()
  const now = new Date().toISOString()
  const document: SovereignDocumentRecord = {
    id: documentId,
    localPath: candidate.localPath,
    sourceType: input.sourceType,
    publisher: input.publisher,
    title: input.title,
    retrievedAt: now,
    contentHash: candidate.contentHash,
    licenseStatus: input.license,
    accessStatus: input.accessStatus,
    language: candidate.languageGuess ?? 'unknown',
    contentType: candidate.contentType ?? 'application/octet-stream',
    byteCount: candidate.byteCount ?? 0,
    provenanceChain: [{ step: 'ingested', at: now, actor: 'system', detail: `Local file read and hashed: ${candidate.localPath}` }],
    allowedForTraining,
    exclusionReason,
    metadata: { encoding: candidate.encoding, admissionDecision: decision },
  }
  await saveDocument(document)

  await appendProvenanceEntry(documentId, {
    documentId,
    sourceIdentity: { sourceType: input.sourceType, localPath: candidate.localPath, publisher: input.publisher },
    retrievalMethod: 'local_file_read',
    rightsStatus: { accessStatus: input.accessStatus, license: input.license },
    contentHash: candidate.contentHash,
    transformHistory: [],
    dedupHistory: duplicate ? ['exact_duplicate_detected'] : [],
    datasetMembership: [],
    commanderDecisions: [],
  })

  const withDoc: SovereignModelLabProgram = { ...program, ingestedDocumentIds: [...program.ingestedDocumentIds, documentId] }
  const inState = withDoc.state === 'documents_ingested' ? withDoc : transition(withDoc, 'documents_ingested', `Document ingested: ${input.title}`)
  const persisted = await persist(inState, `document ingested (${decision.decision})`)

  return { program: persisted, document, error: null }
}

// ---------------------------------------------------------------------------
// Provenance verification
// ---------------------------------------------------------------------------

export async function verifyProvenanceForProgram(programId: string): Promise<{ program: SovereignModelLabProgram; unverifiedDocumentIds: string[] }> {
  const program = await requireProgram(programId)
  const unverifiedDocumentIds: string[] = []
  for (const docId of program.ingestedDocumentIds) {
    const latest = await getLatestProvenanceEntry(docId)
    if (!latest) unverifiedDocumentIds.push(docId)
  }
  const next = transition(program, 'provenance_verified', `${program.ingestedDocumentIds.length - unverifiedDocumentIds.length} of ${program.ingestedDocumentIds.length} documents have a provenance ledger entry.`)
  const persisted = await persist(next, 'provenance verified')
  return { program: persisted, unverifiedDocumentIds }
}

// ---------------------------------------------------------------------------
// Dataset candidate + approval
// ---------------------------------------------------------------------------

export async function buildDatasetCandidateForProgram(programId: string): Promise<SovereignModelLabProgram> {
  const program = await requireProgram(programId)
  const allDocs = await listDocuments()
  const programDocs = allDocs.filter(d => program.ingestedDocumentIds.includes(d.id))
  const manifest = buildDatasetManifest(programDocs)
  await saveDatasetManifest(manifest)

  const withManifest: SovereignModelLabProgram = { ...program, datasetManifestId: manifest.manifestId }
  const candidateState = transition(withManifest, 'dataset_candidate', `Dataset candidate built: ${manifest.documentCount} admitted document(s), ${manifest.excluded.length} excluded.`)
  const awaiting = transition(candidateState, 'awaiting_commander_dataset_approval', 'Awaiting Commander dataset approval.')
  return persist(awaiting, 'dataset candidate ready for Commander review')
}

export async function decideDatasetApproval(programId: string, approved: boolean): Promise<SovereignModelLabProgram> {
  const program = await requireProgram(programId)
  if (!approved) {
    const back = transition(program, 'dataset_candidate', 'Commander rejected the dataset candidate; returning to candidate state for revision.')
    return persist(back, 'dataset candidate rejected by Commander')
  }
  if (!program.datasetManifestId) throw new Error('No dataset manifest to approve.')
  const manifest = await getDatasetManifest(program.datasetManifestId)
  if (!manifest) throw new Error('Dataset manifest record missing from storage.')
  if (manifest.documentCount === 0) throw new Error('Cannot approve an empty dataset manifest — zero admitted documents.')
  const approvedManifest = approveDatasetManifest(manifest)
  await saveDatasetManifest(approvedManifest)
  const next = transition(program, 'dataset_approved', `Commander approved dataset manifest ${manifest.manifestId}.`)
  return persist(next, 'dataset approved by Commander')
}

// ---------------------------------------------------------------------------
// Corpus artifact (Part 5)
// ---------------------------------------------------------------------------

export async function buildCorpusForProgram(programId: string): Promise<{ program: SovereignModelLabProgram; corpusVersion: string }> {
  const program = await requireProgram(programId)
  if (!program.datasetManifestId) throw new Error('Cannot build a corpus before a dataset candidate exists.')
  const manifest = await getDatasetManifest(program.datasetManifestId)
  if (!manifest) throw new Error('Dataset manifest record missing from storage.')
  if (!manifest.commanderApproved) throw new Error('Dataset manifest is not Commander-approved yet.')

  const allDocs = await listDocuments()
  const programDocs = allDocs.filter(d => program.ingestedDocumentIds.includes(d.id))
  const result = await buildCorpusArtifact({ corpusId: CORPUS_ID, sourceDatasetManifestId: manifest.manifestId, documents: programDocs })

  await logWarRoomRepoAudit('sovereign-model-lab: corpus artifact built', { programId, corpusVersion: result.manifest.version, classification: result.manifest.classification })
  return { program, corpusVersion: result.manifest.version }
}

// ---------------------------------------------------------------------------
// Tokenizer environment truth (Part 6)
// ---------------------------------------------------------------------------

export async function checkTokenizerEnvironment(programId: string) {
  let program = await requireProgram(programId)
  if (program.state === 'dataset_approved') {
    program = transition(program, 'tokenizer_not_planned', 'Entering tokenizer stage.')
  }
  if (program.state === 'tokenizer_environment_blocked') {
    program = transition(program, 'tokenizer_environment_unverified', 'Retrying tokenizer environment probe.')
  } else if (program.state === 'tokenizer_not_planned') {
    program = transition(program, 'tokenizer_environment_unverified', 'Tokenizer environment probe executed.')
  }

  const environment = await probeTokenizerEnvironment()

  if (environment.status !== 'compatible' && program.state === 'tokenizer_environment_unverified') {
    program = transition(program, 'tokenizer_environment_blocked', `Tokenizer environment probe result: ${environment.status}.`)
  }

  const persisted = await persist(program, `tokenizer environment probed (${environment.status})`)
  return { program: persisted, environment }
}

// ---------------------------------------------------------------------------
// Tokenizer plan (Part 6/7) — a real configuration, no artifact yet
// ---------------------------------------------------------------------------

export async function createTokenizerPlan(programId: string, opts: {
  algorithm: TokenizerAlgorithm
  vocabSize: number
  minimumFrequency?: number
  seed?: number
}): Promise<SovereignModelLabProgram> {
  const program = await requireProgram(programId)
  if (program.state !== 'tokenizer_environment_unverified') {
    throw new Error('Tokenizer environment must be probed and compatible before a plan can be created.')
  }
  if (!program.datasetManifestId) throw new Error('No dataset manifest linked to this program.')

  const environment = await probeTokenizerEnvironment()
  if (environment.status !== 'compatible' || !environment.pythonExecutablePath) {
    const blocked = transition(program, 'tokenizer_environment_blocked', `Tokenizer environment became ${environment.status} at plan-creation time.`)
    await persist(blocked, 'tokenizer environment incompatible at plan-creation time')
    throw new Error(`Tokenizer environment is not compatible (${environment.status}) — cannot create a plan.`)
  }

  const versions = await listCorpusVersions(CORPUS_ID)
  if (versions.length === 0) throw new Error('No corpus artifact has been built yet — use BUILD CORPUS ARTIFACT first.')
  const corpusVersion = versions.at(-1)!
  const corpusManifest = await readCorpusManifest(CORPUS_ID, corpusVersion)
  if (!corpusManifest) throw new Error('Corpus manifest could not be read.')
  if (corpusManifest.documentCount === 0) throw new Error('Corpus has zero documents — cannot plan a tokenizer from an empty corpus.')

  const minimumFrequency = opts.minimumFrequency ?? 2
  const seed = opts.seed ?? 42

  // Honest vocab recommendation mirrored from train_wrm001_tokenizer.py's own heuristic, so the
  // Commander sees the same number before approving that the script will actually use.
  const totalChars = corpusManifest.estimatedCharacterCount
  const recommendedVocabSize = Math.min(opts.vocabSize, Math.max(64 + REQUIRED_TOKENIZER_SPECIAL_TOKENS.length, Math.floor(totalChars / 2)))
  const vocabSizeAdjustedReason = recommendedVocabSize < opts.vocabSize
    ? `Requested vocab_size=${opts.vocabSize} exceeds what this corpus (${totalChars} characters) can usefully support. Recommending ${recommendedVocabSize} instead.`
    : null

  const outputDir = path.join(resolveSovereignModelLabStorageRoot(), 'tokenizers', CORPUS_ID, corpusVersion)
  const manifestOutputPath = path.join(outputDir, 'training-manifest.json')
  const corpusJsonlPath = path.join(corpusVersionDir(CORPUS_ID, corpusVersion), 'corpus.jsonl')
  const scriptPath = path.join(resolveRepoRoot(), 'scripts', 'sovereign-model-lab', 'train_wrm001_tokenizer.py')

  const argv = [
    scriptPath,
    '--corpus', corpusJsonlPath,
    '--output-dir', outputDir,
    '--algorithm', opts.algorithm,
    '--vocab-size', String(recommendedVocabSize),
    '--minimum-frequency', String(minimumFrequency),
    '--seed', String(seed),
    '--manifest-output', manifestOutputPath,
  ]

  const planId = randomUUID()
  const plan = finalizePlanWithHash({
    planId,
    createdAt: new Date().toISOString(),
    corpusVersion,
    corpusManifestId: corpusManifest.corpusId,
    corpusClassification: corpusManifest.classification,
    corpusDocumentCount: corpusManifest.documentCount,
    corpusByteCount: corpusManifest.byteCount,
    estimatedTokens: corpusManifest.estimatedTokenCount,
    algorithm: opts.algorithm,
    requestedVocabSize: opts.vocabSize,
    recommendedVocabSize,
    vocabSizeAdjustedReason,
    minimumFrequency,
    seed,
    executablePath: environment.pythonExecutablePath,
    argv,
    outputDir,
    manifestOutputPath,
    maxRuntimeMs: TOKENIZER_MAX_RUNTIME_MS,
    cpuLimit: null,
    ramCeilingBytes: environment.availableRamBytes,
    networkPolicy: 'no_network_allowed',
    expectedArtifacts: ['tokenizer.json', 'training-manifest.json'],
  })

  const existing = program.tokenizerExperimentId ? await getTokenizerExperiment(program.tokenizerExperimentId) : null
  const experimentId = existing?.experimentId ?? randomUUID()
  const now = new Date().toISOString()
  const experiment: TokenizerExperiment = {
    experimentId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    datasetManifestId: program.datasetManifestId,
    corpusVersion,
    plan,
    approval: null,
    jobId: null,
    jobStatus: null,
    artifactDir: null,
    artifactFiles: [],
    specialTokens: [],
    verification: null,
  }
  await saveTokenizerExperiment(experiment)

  const withTokenizer: SovereignModelLabProgram = { ...program, tokenizerExperimentId: experimentId }
  const next = transition(withTokenizer, 'tokenizer_plan_ready', `Tokenizer plan created (${opts.algorithm}, vocab ${recommendedVocabSize}).`)
  return persist(next, 'tokenizer plan ready for Commander review')
}

// ---------------------------------------------------------------------------
// Commander approval (Part 8)
// ---------------------------------------------------------------------------

export async function approveTokenizerTraining(programId: string): Promise<SovereignModelLabProgram> {
  const program = await requireProgram(programId)
  if (!program.tokenizerExperimentId) throw new Error('No tokenizer plan to approve.')
  const experiment = await getTokenizerExperiment(program.tokenizerExperimentId)
  if (!experiment?.plan) throw new Error('No tokenizer plan to approve.')
  const corpusManifest = await readCorpusManifest(CORPUS_ID, experiment.plan.corpusVersion)
  if (!corpusManifest) throw new Error('Corpus manifest referenced by the plan no longer exists.')

  const awaiting = transition(program, 'awaiting_commander_tokenizer_approval', 'Tokenizer execution plan shown to Commander for approval.')
  const approval = createTokenizerApproval(experiment.plan, corpusManifest)
  await saveTokenizerExperiment({ ...experiment, approval, updatedAt: new Date().toISOString() })
  return persist(awaiting, `tokenizer training approved (approval ${approval.approvalId})`)
}

// ---------------------------------------------------------------------------
// Bounded execution (Part 9) — the only real local subprocess this file can start
// ---------------------------------------------------------------------------

export async function startTokenizerTrainingForProgram(programId: string): Promise<SovereignModelLabProgram> {
  const program = await requireProgram(programId)
  if (!program.tokenizerExperimentId) throw new Error('No tokenizer experiment linked to this program.')
  const experiment = await getTokenizerExperiment(program.tokenizerExperimentId)
  if (!experiment?.plan || !experiment.approval) throw new Error('No approved tokenizer plan to train from.')

  try {
    // The entire re-verification + approval-consumption + job-record-creation + spawn sequence
    // happens atomically under an exclusive lock inside startTokenizerTraining itself (Commander
    // fix-packet Defect 2) — this function no longer re-reads/consumes the approval itself, since
    // doing so here (outside the lock) would reintroduce the very TOCTOU race being closed.
    const { jobId } = await startTokenizerTraining({ programId, tokenizerExperimentId: experiment.experimentId })
    const next = transition(program, 'tokenizer_training', `Tokenizer training started (job ${jobId}).`)
    return persist(next, 'tokenizer training started')
  } catch (error) {
    if (error instanceof TokenizerApprovalInvalidError) {
      const back = transition(program, 'tokenizer_plan_ready', `Approval invalidated at execution time: ${error.message}`)
      return persist(back, 'tokenizer approval invalidated at execution time — reverted to plan_ready')
    }
    throw error
  }
}

export async function checkTokenizerTrainingProgress(programId: string): Promise<{ program: SovereignModelLabProgram; jobStatus: TokenizerJobStatus | null }> {
  const program = await requireProgram(programId)
  if (!program.tokenizerExperimentId) return { program, jobStatus: null }
  const experiment = await getTokenizerExperiment(program.tokenizerExperimentId)
  if (!experiment?.jobId) return { program, jobStatus: null }
  const jobStatus = await getTokenizerJobStatus(experiment.jobId)
  if (!jobStatus || program.state !== 'tokenizer_training') return { program, jobStatus }

  if (jobStatus.status === 'completed') {
    const next = transition(program, 'tokenizer_verification', 'Tokenizer training process exited successfully — ready for verification.')
    return { program: await persist(next, 'tokenizer training completed'), jobStatus }
  }
  if (jobStatus.status === 'failed' || jobStatus.status === 'timed_out') {
    const next = transition(program, 'tokenizer_failed', `Tokenizer training ${jobStatus.status} (exit code ${jobStatus.exitCode ?? 'null'}).`)
    return { program: await persist(next, 'tokenizer training failed'), jobStatus }
  }
  if (jobStatus.status === 'cancelled') {
    const next = transition(program, 'tokenizer_cancelled', 'Tokenizer training cancelled.')
    return { program: await persist(next, 'tokenizer training cancelled'), jobStatus }
  }
  return { program, jobStatus }
}

export async function cancelTokenizerTrainingForProgram(programId: string, reason?: string): Promise<SovereignModelLabProgram> {
  const program = await requireProgram(programId)
  if (!program.tokenizerExperimentId) throw new Error('No tokenizer job to cancel.')
  const experiment = await getTokenizerExperiment(program.tokenizerExperimentId)
  if (!experiment?.jobId) throw new Error('No tokenizer job to cancel.')
  await cancelTokenizerTraining(experiment.jobId)
  const next = transition(program, 'tokenizer_cancelled', reason ?? 'Cancelled by Commander.')
  return persist(next, 'tokenizer job cancelled')
}

// ---------------------------------------------------------------------------
// Verification (Part 10) — the only path to tokenizer_ready
// ---------------------------------------------------------------------------

export async function verifyTokenizerForProgram(programId: string): Promise<SovereignModelLabProgram> {
  const program = await requireProgram(programId)
  if (!program.tokenizerExperimentId) throw new Error('No tokenizer experiment to verify.')
  const experiment = await getTokenizerExperiment(program.tokenizerExperimentId)
  if (!experiment?.plan) throw new Error('No tokenizer plan to verify against.')
  const corpusManifest = await readCorpusManifest(CORPUS_ID, experiment.plan.corpusVersion)
  if (!corpusManifest) throw new Error('Corpus manifest referenced by the plan no longer exists.')

  const tokenizerJsonPath = path.join(experiment.plan.outputDir, 'tokenizer.json')
  const corpusJsonlPath = path.join(corpusVersionDir(CORPUS_ID, experiment.plan.corpusVersion), 'corpus.jsonl')

  const verification = await verifyTokenizerArtifact({
    artifactDir: experiment.plan.outputDir,
    tokenizerJsonPath,
    trainingManifestPath: experiment.plan.manifestOutputPath,
    corpusJsonlPath,
    expectedCorpusRecordChecksum: corpusManifest.recordChecksum,
    verifyScriptPythonExecutable: experiment.plan.executablePath,
  })

  let artifactFiles: TokenizerArtifactFile[] = []
  let specialTokens: TokenizerSpecialToken[] = []
  try {
    const [tokenizerBuf, manifestBuf] = await Promise.all([
      readFile(tokenizerJsonPath),
      readFile(experiment.plan.manifestOutputPath),
    ])
    artifactFiles = summarizeArtifactFiles(tokenizerBuf, manifestBuf, path.basename(experiment.plan.manifestOutputPath))
    const parsed = JSON.parse(tokenizerBuf.toString('utf8')) as { model?: { vocab?: Record<string, number> } }
    const vocab = parsed.model?.vocab ?? {}
    specialTokens = REQUIRED_TOKENIZER_SPECIAL_TOKENS.map(token => ({ token, id: vocab[token] ?? -1 }))
  } catch {
    artifactFiles = []
    specialTokens = []
  }

  const updatedExperiment: TokenizerExperiment = {
    ...experiment,
    artifactDir: experiment.plan.outputDir,
    artifactFiles,
    specialTokens,
    verification,
    updatedAt: new Date().toISOString(),
  }
  await saveTokenizerExperiment(updatedExperiment)

  const next = transition(
    program,
    verification.allMandatoryChecksPassed ? 'tokenizer_ready' : 'tokenizer_failed',
    verification.allMandatoryChecksPassed ? 'All mandatory tokenizer verification checks passed.' : 'One or more mandatory tokenizer verification checks failed.',
  )
  return persist(next, `tokenizer verification ${verification.allMandatoryChecksPassed ? 'passed' : 'failed'}`)
}

// ---------------------------------------------------------------------------
// Program truth reconciliation (Part 2 migration) — explicit Commander action ONLY. Never called
// automatically from a read/projection path.
// ---------------------------------------------------------------------------

export async function recheckProgramTruth(
  programId: string,
  relatedInputs: Omit<ProgramProjectionInputs, 'program'>,
): Promise<ProgramStateMigrationResult> {
  const program = await requireProgram(programId)
  const result = migrateProgramState({ program, ...relatedInputs })
  if (result.migrated) {
    // Deliberately bypasses transition()'s legality check — this is a corrective action fixing a
    // previously-incorrect persisted state, not a normal forward transition.
    await saveProgram(result.program)
    await logWarRoomRepoAudit(`sovereign-model-lab: program truth reconciled — ${result.reason}`, { programId, from: program.state, to: result.program.state })
  }
  return result
}

// ---------------------------------------------------------------------------
// Training planning (Phase 1 ceiling)
// ---------------------------------------------------------------------------

export async function planTrainingForProgram(programId: string, args: { scaleClass: TrainingScaleClass; purpose: string }): Promise<SovereignModelLabProgram> {
  const program = await requireProgram(programId)
  const hardware = program.hardwareReportId ? await getHardwareReport(program.hardwareReportId) : null
  const tokenizer = program.tokenizerExperimentId ? await getTokenizerExperiment(program.tokenizerExperimentId) : null

  const plan = buildTrainingPlan({
    scaleClass: args.scaleClass,
    purpose: args.purpose,
    datasetManifestId: program.datasetManifestId,
    tokenizerExperimentId: tokenizer?.experimentId ?? null,
    hardware,
  })
  await saveTrainingExperiment(plan)

  const withPlan: SovereignModelLabProgram = { ...program, trainingExperimentId: plan.experimentId }
  const next = transition(withPlan, 'training_plan_ready', `Training plan ready: ${plan.scaleClass} (~${plan.estimatedParameterCount.toLocaleString()} params). External compute required: ${plan.externalComputeRequired}.`)
  return persist(next, 'training plan ready — Phase 1 ceiling reached')
}

/** The furthest a Phase 1 program can go. No function exists in this file to transition beyond
 * this state into any form of active training. */
export async function requestTrainingApproval(programId: string): Promise<SovereignModelLabProgram> {
  const program = await requireProgram(programId)
  const next = transition(program, 'awaiting_commander_training_approval', 'Awaiting Commander training approval. Phase 1 does not implement any further state — approval here does not start training.')
  return persist(next, 'awaiting Commander training approval (Phase 1 ceiling)')
}

export async function blockProgram(programId: string, reason: string): Promise<SovereignModelLabProgram> {
  const program = await requireProgram(programId)
  const next = transition(program, 'blocked', reason)
  return persist(next, 'program blocked')
}

export async function cancelProgram(programId: string, reason?: string): Promise<SovereignModelLabProgram> {
  const program = await requireProgram(programId)
  const next = transition(program, 'cancelled', reason ?? 'Cancelled by Commander.')
  return persist(next, 'program cancelled')
}

async function requireProgram(programId: string): Promise<SovereignModelLabProgram> {
  const program = await getProgram(programId)
  if (!program) throw new Error(`No sovereign-model-lab program for id ${programId}`)
  return program
}
