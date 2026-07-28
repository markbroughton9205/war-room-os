/**
 * Sovereign Model Lab Phase 1 regression suite.
 */
import { access, readFile, rm } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { runHardwareProbe } from './hardwareProbe'
import { evaluateSourceAdmission } from './sourcePolicy'
import { ingestLocalFile, isExactDuplicate } from './documentIngest'
import { appendProvenanceEntry, listProvenanceVersions } from './provenanceLedger'
import { buildDatasetManifest } from './datasetBuilder'
import { buildModelManifest } from './modelRegistry'
import {
  SOVEREIGN_MODEL_LAB_STATES,
  SOVEREIGN_MODEL_LAB_TRANSITIONS,
  type DatasetLicenseRecord,
  type SovereignDocumentRecord,
  type SovereignModelLabProgram,
} from './types'
import {
  beginModelProgram,
  ingestDocumentForProgram,
  InvalidSovereignStateTransitionError,
  registerSourceForProgram,
  requestTrainingApproval,
} from './runtime'
import {
  clearSovereignModelLabValidationStorageRoot,
  getProgram,
  InvalidValidationStorageRootError,
  listPrograms,
  resolveSovereignModelLabStorageRoot,
  saveProgram,
  setSovereignModelLabValidationStorageRoot,
  sovereignModelLabProductionStorageRootForTesting,
} from './storage'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const FIXTURE_REL = 'lib/sovereign-model-lab/__fixtures__/sample-commander-document.txt'

/** Deletes whatever the CURRENT storage root resolves to — production by default, or the isolated
 * validation root once set via setSovereignModelLabValidationStorageRoot(). Never independently
 * constructs '.war-room/sovereign-model-lab' — see storage.ts's single resolution point. */
async function resetLabState(): Promise<void> {
  await rm(resolveSovereignModelLabStorageRoot(), { recursive: true, force: true })
}

function licenseRecord(overrides: Partial<DatasetLicenseRecord> = {}): DatasetLicenseRecord {
  return { licenseId: null, licenseName: null, licenseUrl: null, permitsTrainingUse: null, recordedBy: 'unknown', recordedAt: new Date().toISOString(), notes: '', ...overrides }
}

// --- 1. Hardware values honest or null -----------------------------------------------------------

async function testHardwareHonesty(): Promise<CaseResult[]> {
  const report = await runHardwareProbe()
  const allFieldsRealOrNull =
    (report.operatingSystem === null || typeof report.operatingSystem === 'string') &&
    (report.cpuModel === null || typeof report.cpuModel === 'string') &&
    (report.totalRamBytes === null || typeof report.totalRamBytes === 'number') &&
    (report.gpuName === null || typeof report.gpuName === 'string') &&
    (report.cudaAvailable === null || typeof report.cudaAvailable === 'boolean') &&
    report.directMlAvailable === null // Phase 1 never claims a value here — always null, honestly
  const nodeVersionIsReal = report.nodeVersion === process.version
  return [
    check('hardware_01_fields_are_real_typed_or_null', allFieldsRealOrNull, JSON.stringify({ os: report.operatingSystem, cpu: report.cpuModel, ram: report.totalRamBytes })),
    check('hardware_02_directml_always_honestly_null_in_phase1', report.directMlAvailable === null, String(report.directMlAvailable)),
    check('hardware_03_node_version_is_the_real_process_version', nodeVersionIsReal, `${report.nodeVersion} vs ${process.version}`),
    check('hardware_04_capability_classes_is_a_real_array', Array.isArray(report.capabilityClasses) && report.capabilityClasses.includes('metadata_only'), JSON.stringify(report.capabilityClasses)),
  ]
}

// --- 2/3. Source admission policy -----------------------------------------------------------------

function testSourcePolicy(): CaseResult[] {
  const restricted = evaluateSourceAdmission({ accessStatus: 'restricted', license: licenseRecord(), authorshipDocumented: true, sourceDocumented: true })
  const paywalled = evaluateSourceAdmission({ accessStatus: 'paywalled', license: licenseRecord(), authorshipDocumented: true, sourceDocumented: true })
  const authRequired = evaluateSourceAdmission({ accessStatus: 'authentication_required', license: licenseRecord(), authorshipDocumented: true, sourceDocumented: true })
  const robotsRestricted = evaluateSourceAdmission({ accessStatus: 'robots_restricted', license: licenseRecord(), authorshipDocumented: true, sourceDocumented: true })
  const unavailable = evaluateSourceAdmission({ accessStatus: 'unavailable', license: licenseRecord(), authorshipDocumented: true, sourceDocumented: true })
  const unknownAccess = evaluateSourceAdmission({ accessStatus: 'unknown', license: licenseRecord(), authorshipDocumented: true, sourceDocumented: true })
  const unknownLicense = evaluateSourceAdmission({ accessStatus: 'public', license: licenseRecord({ permitsTrainingUse: null }), authorshipDocumented: true, sourceDocumented: true })
  const stolen = evaluateSourceAdmission({ accessStatus: 'public', license: licenseRecord({ permitsTrainingUse: true }), authorshipDocumented: true, sourceDocumented: true, knownIllegitimateAcquisition: true, illegitimateAcquisitionReason: 'Credential dump.' })
  const commanderOwned = evaluateSourceAdmission({ accessStatus: 'commander_owned', license: licenseRecord(), authorshipDocumented: true, sourceDocumented: true })
  const publicDomain = evaluateSourceAdmission({ accessStatus: 'public_domain', license: licenseRecord(), authorshipDocumented: true, sourceDocumented: true })

  return [
    check('policy_01_restricted_never_auto_admits', restricted.decision !== 'auto_admit', restricted.decision),
    check('policy_02_paywalled_never_auto_admits', paywalled.decision !== 'auto_admit', paywalled.decision),
    check('policy_03_authentication_required_never_auto_admits', authRequired.decision !== 'auto_admit', authRequired.decision),
    check('policy_04_robots_restricted_never_auto_admits', robotsRestricted.decision !== 'auto_admit', robotsRestricted.decision),
    check('policy_05_unavailable_never_auto_admits', unavailable.decision !== 'auto_admit', unavailable.decision),
    check('policy_06_unknown_access_requires_review_not_reject', unknownAccess.decision === 'commander_review_required', unknownAccess.decision),
    check('policy_07_unknown_license_requires_commander_review', unknownLicense.decision === 'commander_review_required', unknownLicense.decision),
    check('policy_08_known_illegitimate_acquisition_auto_rejected', stolen.decision === 'auto_reject', stolen.decision),
    check('policy_09_commander_owned_documented_auto_admits', commanderOwned.decision === 'auto_admit', commanderOwned.decision),
    check('policy_10_public_domain_auto_admits', publicDomain.decision === 'auto_admit', publicDomain.decision),
    check('policy_11_rejection_is_rights_based_not_topic_based', [restricted, paywalled, stolen].every(d => d.isRightsOrAccessBased), 'all isRightsOrAccessBased=true'),
  ]
}

// --- 4. Commander-owned documents can enter after hashing and provenance capture -------------------

async function testCommanderOwnedIngestFlow(): Promise<CaseResult[]> {
  const candidate = await ingestLocalFile(FIXTURE_REL)
  if (!candidate.ok || !candidate.contentHash) {
    return [check('ingest_01_commander_owned_fixture_reads_and_hashes', false, candidate.error ?? 'unknown error')]
  }

  const documentId = 'test-doc-commander-owned'
  await appendProvenanceEntry(documentId, {
    documentId,
    sourceIdentity: { sourceType: 'commander_library', localPath: candidate.localPath, publisher: 'Commander' },
    retrievalMethod: 'local_file_read',
    rightsStatus: { accessStatus: 'commander_owned', license: licenseRecord({ permitsTrainingUse: true, recordedBy: 'commander_declared' }) },
    contentHash: candidate.contentHash,
    transformHistory: [],
    dedupHistory: [],
    datasetMembership: [],
    commanderDecisions: [],
  })
  const versions = await listProvenanceVersions(documentId)

  const decision = evaluateSourceAdmission({
    accessStatus: 'commander_owned',
    license: licenseRecord({ permitsTrainingUse: true, recordedBy: 'commander_declared' }),
    authorshipDocumented: true,
    sourceDocumented: true,
  })

  return [
    check('ingest_01_commander_owned_fixture_reads_and_hashes', Boolean(candidate.contentHash) && candidate.byteCount! > 0, `hash=${candidate.contentHash?.slice(0, 12)} bytes=${candidate.byteCount}`),
    check('ingest_02_provenance_entry_captured', versions.length === 1 && versions[0].contentHash === candidate.contentHash, JSON.stringify(versions.map(v => v.version))),
    check('ingest_03_commander_owned_document_admitted', decision.decision === 'auto_admit', decision.decision),
  ]
}

// --- 5. Duplicate detection ------------------------------------------------------------------------

async function testDuplicateDetection(): Promise<CaseResult[]> {
  const candidate = await ingestLocalFile(FIXTURE_REL)
  if (!candidate.ok || !candidate.contentHash) return [check('dup_01', false, 'fixture read failed')]
  const knownHashes = new Set([candidate.contentHash])
  const isDup = isExactDuplicate(candidate.contentHash, knownHashes)
  const isNotDup = isExactDuplicate('a'.repeat(64), knownHashes)
  return [
    check('dup_01_exact_duplicate_detected', isDup, String(isDup)),
    check('dup_02_different_hash_not_flagged', !isNotDup, String(isNotDup)),
  ]
}

// --- 6. Dataset manifest reproducibility ------------------------------------------------------------

function makeDoc(overrides: Partial<SovereignDocumentRecord> & { id: string }): SovereignDocumentRecord {
  return {
    sourceType: 'commander_library',
    publisher: 'Commander',
    title: 'Test doc',
    retrievedAt: '2026-01-01T00:00:00.000Z',
    contentHash: overrides.contentHash ?? `hash-${overrides.id}`,
    licenseStatus: licenseRecord({ permitsTrainingUse: true, recordedBy: 'commander_declared' }),
    accessStatus: 'commander_owned',
    language: 'en',
    contentType: 'text/plain',
    byteCount: 400,
    provenanceChain: [],
    allowedForTraining: true,
    exclusionReason: null,
    metadata: {},
    ...overrides,
  }
}

function testDatasetReproducibility(): CaseResult[] {
  const docs = [makeDoc({ id: 'd1' }), makeDoc({ id: 'd2' }), makeDoc({ id: 'd3', accessStatus: 'restricted', allowedForTraining: false, exclusionReason: 'restricted access' })]
  const manifestA = buildDatasetManifest(docs)
  const manifestB = buildDatasetManifest([...docs].reverse())

  const excludedNeverEmptyReason = manifestA.excluded.every(e => e.reason.length > 0)

  return [
    check('manifest_01_reproducible_across_input_order', manifestA.manifestId === manifestB.manifestId && manifestA.checksum === manifestB.checksum, `${manifestA.manifestId} vs ${manifestB.manifestId}`),
    check('manifest_02_excluded_document_present_with_reason', manifestA.excluded.length === 1 && excludedNeverEmptyReason, JSON.stringify(manifestA.excluded)),
    check('manifest_03_only_admitted_documents_counted', manifestA.documentCount === 2, String(manifestA.documentCount)),
  ]
}

// --- 7. Changed documents create new versions -------------------------------------------------------

async function testProvenanceVersioning(): Promise<CaseResult[]> {
  const documentId = 'test-doc-versioning'
  const v1 = await appendProvenanceEntry(documentId, {
    documentId,
    sourceIdentity: { sourceType: 'commander_library', publisher: 'Commander' },
    retrievalMethod: 'local_file_read',
    rightsStatus: { accessStatus: 'commander_owned', license: licenseRecord() },
    contentHash: 'hash-v1',
    transformHistory: [],
    dedupHistory: [],
    datasetMembership: [],
    commanderDecisions: [],
  })
  const v2 = await appendProvenanceEntry(documentId, {
    documentId,
    sourceIdentity: { sourceType: 'commander_library', publisher: 'Commander' },
    retrievalMethod: 'local_file_read',
    rightsStatus: { accessStatus: 'commander_owned', license: licenseRecord() },
    contentHash: 'hash-v2-changed',
    transformHistory: ['content_changed'],
    dedupHistory: [],
    datasetMembership: [],
    commanderDecisions: [],
  })
  const allVersions = await listProvenanceVersions(documentId)

  return [
    check('provenance_01_second_write_creates_new_version_not_overwrite', v2.version === v1.version + 1, `${v1.version} -> ${v2.version}`),
    check('provenance_02_new_version_supersedes_prior_entry', v2.supersedesEntryId === v1.entryId, `${v2.supersedesEntryId} vs ${v1.entryId}`),
    check('provenance_03_both_versions_remain_readable', allVersions.length === 2 && allVersions[0].contentHash === 'hash-v1' && allVersions[1].contentHash === 'hash-v2-changed', JSON.stringify(allVersions.map(v => v.contentHash))),
  ]
}

// --- 8. Model ownership labels accurate ---------------------------------------------------------------

function testModelOwnershipLabels(): CaseResult[] {
  const fromScratch = buildModelManifest({ lineageKind: 'war_room_trained_from_scratch', checkpointId: 'cp-1', parentModelId: null, description: 'test' })
  const finetune = buildModelManifest({ lineageKind: 'war_room_finetune', checkpointId: 'cp-2', parentModelId: null, description: 'test' })
  const thirdPartyRef = buildModelManifest({ lineageKind: 'third_party_reference', checkpointId: null, parentModelId: null, description: 'test' })
  const externalApi = buildModelManifest({ lineageKind: 'external_api', checkpointId: null, parentModelId: null, description: 'test' })
  const continuedPretraining = buildModelManifest({ lineageKind: 'war_room_continued_pretraining', checkpointId: 'cp-3', parentModelId: 'model-x', description: 'test' })

  return [
    check('model_01_from_scratch_gets_native_ownership', fromScratch.ownershipClass === 'war_room_native', fromScratch.ownershipClass),
    check('model_02_finetune_is_not_native_ownership', finetune.ownershipClass === 'third_party', finetune.ownershipClass),
    check('model_03_third_party_reference_never_native', thirdPartyRef.ownershipClass === 'third_party', thirdPartyRef.ownershipClass),
    check('model_04_external_api_never_native', externalApi.ownershipClass === 'third_party', externalApi.ownershipClass),
    check('model_05_continued_pretraining_never_native', continuedPretraining.ownershipClass === 'third_party', continuedPretraining.ownershipClass),
  ]
}

// --- 9. No API provider is called -----------------------------------------------------------------

async function testNoApiProviderCalled(): Promise<CaseResult[]> {
  const files = [
    'hardwareProbe.ts', 'sourcePolicy.ts', 'documentIngest.ts', 'provenanceLedger.ts', 'datasetBuilder.ts',
    'trainingPlanner.ts', 'checkpointVault.ts', 'evaluationRegistry.ts', 'modelRegistry.ts', 'publicSourceRegistry.ts',
    'runtime.ts', 'storage.ts', 'corpusBuilder.ts', 'tokenizerEnvironment.ts', 'tokenizerApproval.ts',
    'tokenizerRuntime.ts', 'tokenizerVerifier.ts', 'trainingMemoryEstimator.ts', 'programProjection.ts',
  ]
  const results: CaseResult[] = []
  for (const file of files) {
    const abs = path.join(resolveRepoRoot(), 'lib', 'sovereign-model-lab', file)
    let content = ''
    try {
      content = await readFile(abs, 'utf8')
    } catch {
      results.push(check(`noapi_${file}`, false, 'file missing'))
      continue
    }
    const mentionsProviderCall = /providerDirectCall|invokeDirectCouncilProvider|api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis|api\.x\.ai|moonshot\.ai|tavily\.com|firecrawl\.dev/i.test(content)
    results.push(check(`noapi_${file}_no_provider_reference`, !mentionsProviderCall, mentionsProviderCall ? 'suspicious reference found' : 'clean'))
  }
  return results
}

// --- 10. No arbitrary shell command can execute -----------------------------------------------------

async function testNoArbitraryShell(): Promise<CaseResult[]> {
  const abs = path.join(resolveRepoRoot(), 'lib', 'sovereign-model-lab', 'hardwareProbe.ts')
  const content = await readFile(abs, 'utf8')
  const usesExecFileNotExec = content.includes('execFile') && !/[^F]exec\(/.test(content.replace(/execFile/g, ''))
  const noUserStringInterpolationIntoCommand = !/execFileAsync\(\s*[a-zA-Z]+\s*\+/.test(content) // no string concatenation building the command name
  return [
    check('shell_01_hardware_probe_uses_execFile_only', usesExecFileNotExec, `execFile present=${content.includes('execFile')}`),
    check('shell_02_no_dynamic_command_concatenation', noUserStringInterpolationIntoCommand, 'ok'),
  ]
}

// --- 11. No remote URL can be submitted to the local ingestion route ------------------------------

async function testNoRemoteUrlIngestion(): Promise<CaseResult[]> {
  const asUrl = await ingestLocalFile('https://example.com/some-dataset.txt')
  const asUrlSecure = await ingestLocalFile('http://evil.example/payload.txt')
  return [
    check('remote_01_https_url_rejected_by_ingest', !asUrl.ok, JSON.stringify(asUrl)),
    check('remote_02_http_url_rejected_by_ingest', !asUrlSecure.ok, JSON.stringify(asUrlSecure)),
  ]
}

// --- 12/14. Phase 1 cannot transition into active training / all transitions legal -----------------

function testStateMachineBoundary(): CaseResult[] {
  const trainingApprovalTargets = SOVEREIGN_MODEL_LAB_TRANSITIONS.awaiting_commander_training_approval
  // Phase 2A legitimately introduces tokenizer_training as a real, bounded, explicitly-scoped
  // local-tokenizer state — the boundary this test enforces is that no state exists (or could ever
  // be reached from training_plan_ready/awaiting_commander_training_approval) representing a
  // *model* actively training.
  const noActiveModelTrainingStateExists = !SOVEREIGN_MODEL_LAB_STATES.some(s => /training_in_progress|actively_training|training_running/.test(s))
  const tokenizerTrainingStateExistsAndIsScoped = SOVEREIGN_MODEL_LAB_STATES.includes('tokenizer_training')
    && SOVEREIGN_MODEL_LAB_TRANSITIONS.tokenizer_training.every(t => t === 'tokenizer_verification' || t === 'tokenizer_failed' || t === 'tokenizer_cancelled' || t === 'blocked')
  const allStatesHaveEntries = SOVEREIGN_MODEL_LAB_STATES.every(s => s in SOVEREIGN_MODEL_LAB_TRANSITIONS)
  const cancelledTerminal = SOVEREIGN_MODEL_LAB_TRANSITIONS.cancelled.length === 0

  return [
    check('statemachine_01_no_active_model_training_state_exists_in_type', noActiveModelTrainingStateExists, JSON.stringify(SOVEREIGN_MODEL_LAB_STATES)),
    check('statemachine_01b_tokenizer_training_exists_and_is_tightly_scoped', tokenizerTrainingStateExistsAndIsScoped, JSON.stringify(SOVEREIGN_MODEL_LAB_TRANSITIONS.tokenizer_training)),
    check('statemachine_02_training_approval_state_has_no_forward_training_transition', trainingApprovalTargets.every(t => t === 'blocked' || t === 'cancelled'), JSON.stringify(trainingApprovalTargets)),
    check('statemachine_03_all_states_have_transition_entries', allStatesHaveEntries, `${Object.keys(SOVEREIGN_MODEL_LAB_TRANSITIONS).length} of ${SOVEREIGN_MODEL_LAB_STATES.length}`),
    check('statemachine_04_cancelled_is_terminal', cancelledTerminal, JSON.stringify(SOVEREIGN_MODEL_LAB_TRANSITIONS.cancelled)),
  ]
}

async function testIllegalTransitionRejected(): Promise<CaseResult[]> {
  await resetLabState()
  const { program } = await beginModelProgram('WRM-TEST')
  try {
    await requestTrainingApproval(program.programId) // illegal: hardware_audit -> awaiting_commander_training_approval directly
    await resetLabState()
    return [check('statemachine_05_illegal_jump_rejected', false, 'did not throw')]
  } catch (error) {
    await resetLabState()
    return [check('statemachine_05_illegal_jump_rejected', error instanceof InvalidSovereignStateTransitionError, String(error))]
  }
}

// --- 13. Storage does not recursively call runtime --------------------------------------------------

async function testStorageDoesNotCallRuntime(): Promise<CaseResult[]> {
  const storagePath = path.join(resolveRepoRoot(), 'lib', 'sovereign-model-lab', 'storage.ts')
  const provenancePath = path.join(resolveRepoRoot(), 'lib', 'sovereign-model-lab', 'provenanceLedger.ts')
  const storageContent = await readFile(storagePath, 'utf8')
  const provenanceContent = await readFile(provenancePath, 'utf8')
  return [
    check('leaf_01_storage_never_imports_runtime', !storageContent.includes("from './runtime'"), 'ok'),
    check('leaf_02_provenance_ledger_never_imports_runtime', !provenanceContent.includes("from './runtime'"), 'ok'),
  ]
}

// --- 15. No secrets are logged ------------------------------------------------------------------------

async function testNoSecretsLogged(): Promise<CaseResult[]> {
  const runtimePath = path.join(resolveRepoRoot(), 'lib', 'sovereign-model-lab', 'runtime.ts')
  const content = await readFile(runtimePath, 'utf8')
  const auditCalls = content.match(/logWarRoomRepoAudit\([^)]*\)/g) ?? []
  const noRawEnvOrSecretPatterns = auditCalls.every(call => !/process\.env|apiKey|API_KEY|secret|password|token/i.test(call))
  return [
    check('secrets_01_audit_log_calls_never_reference_env_or_secret_terms', noRawEnvOrSecretPatterns, `${auditCalls.length} audit call(s) checked`),
  ]
}

// --- Validation storage-root isolation (Commander requirement: validator must never touch the ---
// --- production/default Model Lab state directory). ------------------------------------------------

type ProductionFixtureProof = { programId: string; filePath: string; contentBefore: string }

/** Plants a REAL program record directly in the production/default root, via the real saveProgram()
 * storage function, BEFORE any validation-root override is set — confirmed by construction, since
 * resolveSovereignModelLabStorageRoot() only ever returns the production root when no override is
 * active. This is the fixture whose survival proves the isolated run below never touched
 * production. */
async function plantProductionRootFixture(): Promise<ProductionFixtureProof> {
  const programId = `production-survives-fixture-${randomUUID()}`
  const now = new Date().toISOString()
  const fixtureProgram: SovereignModelLabProgram = {
    programId,
    name: 'PRODUCTION-SURVIVAL-FIXTURE',
    state: 'hardware_audit',
    history: [{ state: 'hardware_audit', at: now, note: 'Planted before validation isolation to prove production state survives an isolated run.' }],
    hardwareReportId: null,
    registeredSourceIds: [],
    ingestedDocumentIds: [],
    datasetManifestId: null,
    tokenizerExperimentId: null,
    trainingExperimentId: null,
    createdAt: now,
    updatedAt: now,
  }
  await saveProgram(fixtureProgram)
  const filePath = path.join(sovereignModelLabProductionStorageRootForTesting(), 'programs', `${programId}.json`)
  const contentBefore = await readFile(filePath, 'utf8')
  return { programId, filePath, contentBefore }
}

/** Re-reads the exact fixture file from the production root after the entire isolated run has
 * finished (including every resetLabState() call the isolated tests made) and compares it
 * byte-for-byte against what was written before isolation began. */
async function verifyProductionRootFixtureUnmodified(proof: ProductionFixtureProof): Promise<CaseResult[]> {
  let contentAfter: string | null = null
  let readError: string | null = null
  try {
    contentAfter = await readFile(proof.filePath, 'utf8')
  } catch (error) {
    readError = error instanceof Error ? error.message : String(error)
  }
  const stillExists = contentAfter !== null
  const unmodified = stillExists && contentAfter === proof.contentBefore
  const results = [
    check('isolation_10_production_fixture_still_exists_after_full_isolated_run', stillExists, readError ?? 'exists'),
    check(
      'isolation_11_production_fixture_byte_for_byte_unmodified',
      unmodified,
      unmodified ? 'unchanged' : `before=${proof.contentBefore.length} chars, after=${contentAfter?.length ?? 'missing'} chars`,
    ),
  ]
  // This is our own planted test fixture, not real Commander data — remove it now that its
  // survival has been proven, so repeated validator runs don't accumulate fixtures in production.
  await rm(proof.filePath, { force: true })
  return results
}

function testValidationRootPathTraversalRejected(): CaseResult[] {
  let threw = false
  let message = ''
  try {
    setSovereignModelLabValidationStorageRoot('../../../../etc/passwd-traversal-attempt')
  } catch (error) {
    threw = error instanceof InvalidValidationStorageRootError
    message = error instanceof Error ? error.message : String(error)
  }
  return [check('isolation_05_path_traversal_requested_root_rejected', threw, message || 'did not throw')]
}

function testValidationRootAbsoluteEscapeRejected(): CaseResult[] {
  let threw = false
  let message = ''
  const outsideAbsolutePath = process.platform === 'win32' ? 'C:\\Windows\\Temp\\model-lab-escape-attempt' : '/tmp/model-lab-escape-attempt'
  try {
    setSovereignModelLabValidationStorageRoot(outsideAbsolutePath)
  } catch (error) {
    threw = error instanceof InvalidValidationStorageRootError
    message = error instanceof Error ? error.message : String(error)
  }
  return [check('isolation_06_absolute_path_outside_validation_area_rejected', threw, message || 'did not throw')]
}

async function testIsolationCleanupVerified(): Promise<CaseResult[]> {
  const isolatedRoot = resolveSovereignModelLabStorageRoot()
  await resetLabState()
  const stillExists = await access(isolatedRoot, fsConstants.F_OK).then(() => true).catch(() => false)
  return [check('isolation_09_isolated_validation_root_removed_after_run', !stillExists, `isolatedRoot=${isolatedRoot} exists=${stillExists}`)]
}

export async function runSovereignModelLabValidation(): Promise<CaseResult[]> {
  const results: CaseResult[] = []

  // Plant the production-survival fixture BEFORE any isolation override is set.
  const productionFixtureProof = await plantProductionRootFixture()
  const productionRootBefore = sovereignModelLabProductionStorageRootForTesting()

  const isolatedRoot = setSovereignModelLabValidationStorageRoot(`run-${randomUUID()}`)
  results.push(check('isolation_01_validation_root_differs_from_production_root', isolatedRoot !== productionRootBefore, `isolated=${isolatedRoot} production=${productionRootBefore}`))
  results.push(check('isolation_02_validation_root_is_inside_permitted_validation_area', isolatedRoot.split(path.sep).includes('validation'), isolatedRoot))

  try {
    results.push(...testValidationRootPathTraversalRejected())
    results.push(...testValidationRootAbsoluteEscapeRejected())
    const rootAfterAdversarialAttempts = resolveSovereignModelLabStorageRoot()
    results.push(check('isolation_07_adversarial_attempts_never_corrupted_active_root', rootAfterAdversarialAttempts === isolatedRoot, `expected=${isolatedRoot} actual=${rootAfterAdversarialAttempts}`))

    results.push(...(await runSovereignModelLabValidationCasesAgainstCurrentRoot()))
    results.push(...(await testIsolationCleanupVerified()))
  } finally {
    clearSovereignModelLabValidationStorageRoot()
  }

  const productionRootAfterClear = resolveSovereignModelLabStorageRoot()
  results.push(check('isolation_08_production_root_resolution_unchanged_after_clearing_override', productionRootBefore === productionRootAfterClear, `before=${productionRootBefore} afterClear=${productionRootAfterClear}`))

  results.push(...(await verifyProductionRootFixtureUnmodified(productionFixtureProof)))

  return results
}

/** The original Phase 1 regression suite, unchanged in logic — only ever invoked while an isolated
 * validation root is active (see runSovereignModelLabValidation above), so every call it makes
 * through resetLabState()/storage.ts operates on the isolated root, never production. */
async function runSovereignModelLabValidationCasesAgainstCurrentRoot(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  results.push(...(await testHardwareHonesty()))
  results.push(...testSourcePolicy())
  results.push(...(await testCommanderOwnedIngestFlow()))
  results.push(...(await testDuplicateDetection()))
  results.push(...testDatasetReproducibility())
  results.push(...(await testProvenanceVersioning()))
  results.push(...testModelOwnershipLabels())
  results.push(...(await testNoApiProviderCalled()))
  results.push(...(await testNoArbitraryShell()))
  results.push(...(await testNoRemoteUrlIngestion()))
  results.push(...testStateMachineBoundary())
  results.push(...(await testIllegalTransitionRejected()))
  results.push(...(await testStorageDoesNotCallRuntime()))
  results.push(...(await testNoSecretsLogged()))

  // Real end-to-end program flow (begin -> ingest -> verify -> dataset candidate -> approve)
  await resetLabState()
  const { program: begun, missing } = await beginModelProgram('WRM-001-TEST')
  results.push(check('e2e_01_begin_creates_program_with_hardware_audit', begun.state === 'hardware_audit' && begun.hardwareReportId !== null, begun.state))
  results.push(check('e2e_02_missing_list_is_honest_before_any_work', missing.length > 0, `${missing.length} items`))

  const afterSourceRegistration = await registerSourceForProgram(begun.programId, {
    family: 'commander_library',
    label: 'Commander local library',
    acquisitionMethod: 'manual_local_upload',
    licenseOrTermsLocation: 'n/a — Commander-owned',
    updateFrequency: 'manual',
    supportedLanguages: ['en'],
    expectedContentFormat: 'text/plain',
    trainingEligibleByDefault: true,
    citationRequirements: 'Cite as Commander-provided material.',
  })
  results.push(check('e2e_02b_source_registration_transitions_state', afterSourceRegistration.state === 'source_registered', afterSourceRegistration.state))

  const ingestResult = await ingestDocumentForProgram(begun.programId, {
    localPath: FIXTURE_REL,
    sourceType: 'commander_library',
    publisher: 'Commander',
    title: 'Sample commander document',
    accessStatus: 'commander_owned',
    license: licenseRecord({ permitsTrainingUse: true, recordedBy: 'commander_declared' }),
    authorshipDocumented: true,
  })
  results.push(check('e2e_03_document_ingested_and_admitted', ingestResult.document?.allowedForTraining === true, JSON.stringify(ingestResult.document?.allowedForTraining)))
  results.push(check('e2e_04_program_transitions_to_documents_ingested', ingestResult.program.state === 'documents_ingested', ingestResult.program.state))

  const afterProgram = await getProgram(begun.programId)
  const allPrograms = await listPrograms()
  results.push(check('e2e_05_program_persisted_and_listable', Boolean(afterProgram) && allPrograms.some(p => p.programId === begun.programId), String(Boolean(afterProgram))))

  await resetLabState()

  return results
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSovereignModelLabValidation().then(async results => {
    for (const result of results) {
      console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
    }
    const failed = results.filter(result => !result.pass)
    console.log(`Sovereign Model Lab validation: ${results.length - failed.length}/${results.length} PASS`)
    // No trailing resetLabState() here: runSovereignModelLabValidation() already cleans up the
    // isolated validation root (and clears the override back to production) before returning.
    // Calling resetLabState() again at this point, after the override is cleared, would delete the
    // PRODUCTION root instead — exactly the destructive behavior this isolation mechanism exists to
    // prevent.
    if (failed.length) process.exit(1)
  })
}
