/**
 * HVS-DIRECTOR-CHARACTER-02 — MetaHuman likeness gate + Unreal preview return.
 * `pnpm run validate:hvs-character-preview-return`
 * Architecture only. Does not perform live AutoRig.
 */
import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import { HVS_MATRIX_ROWS } from './production-matrix'
import { MATRIX_EXTENSION_REQUIRED, RAEL_CHARACTER_ID } from './digital-human/types'
import { HVS_UE01_MOTION_ID, HVS_UE01_PROJECT_ID, HVS_UE01_TAKE_ID } from './unreal/package'
import { readUnrealScenePackage } from './unreal/storage'
import {
  HVS_CLOUD_PAYLOAD_CATEGORY,
  HVS_METAHUMAN_LIKENESS_AUTHORITY_TYPE,
  HVS_METAHUMAN_LIKENESS_PROVIDER,
  HVS_METAHUMAN_LIKENESS_SCOPE,
  HVS_RAEL_MHC_PATH,
  canonicalBuildOperationId,
} from './character-production/types'
import {
  characterAuthorityPath,
  characterPreviewDir,
  characterProductionPath,
  characterSubmissionPath,
  readCharacterProduction,
  readCloudSubmission,
  readLikenessAuthority,
} from './character-production/persist'
import { hvsCharacterProductionOrchestrator } from './character-production/orchestrator'
import { LIKENESS_APPROVAL_COPY } from './character-production/view'
import { preservesHuman01Locks } from './character-production/privacy'
import { HVS_LIKENESS_PYTHON } from './character-production/likeness-adapter'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
function expect(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail })
}
function source(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

const started = process.hrtime.bigint()
const projectId = HVS_UE01_PROJECT_ID
const productionFile = characterProductionPath(projectId)
const authorityFile = characterAuthorityPath(projectId)
const submissionFile = characterSubmissionPath(projectId)
const previewDir = characterPreviewDir(projectId)
const backup = `${productionFile}.c02-bak`
const authorityBackup = `${authorityFile}.c02-bak`
const submissionBackup = `${submissionFile}.c02-bak`

function stash(file: string, bak: string) {
  if (existsSync(file)) renameSync(file, bak)
  else if (existsSync(bak)) rmSync(bak)
}
function restore(file: string, bak: string) {
  if (existsSync(bak)) renameSync(bak, file)
  else if (existsSync(file)) rmSync(file)
}

stash(productionFile, backup)
stash(authorityFile, authorityBackup)
stash(submissionFile, submissionBackup)

try {
  const pkg = readUnrealScenePackage(projectId)
  const manny = pkg?.characters[0]?.binding
  const orch = source('lib/media-command/character-production/orchestrator.ts')
  const adapter = source('lib/media-command/character-production/likeness-adapter.ts')
  const py = source('lib/media-command/unreal/hvs_likeness_ops.py')
  const opsPy = source('lib/media-command/unreal/hvs_character_ops.py')
  const ui = source('components/war-room/higher-vision-studios/HvsCharacterProductionPanel.tsx')
  const route = source('app/api/media-command/character-production/route.ts')
  const view = source('lib/media-command/character-production/view.ts')
  const ops = source('lib/media-command/unreal/character-ops.ts')
  const packageJson = source('package.json')

  const first = hvsCharacterProductionOrchestrator.build(projectId, { launchUnreal: false, executeLive: false, now: '2026-09-23T20:00:00.000Z' })
  const firstOp = first.operation
  const firstNetwork = firstOp?.likenessReceipts.find(item => item.stage === 'AUTHORITY_CHECK')
  const firstSubmit = firstOp?.likenessReceipts.find(item => item.stage === 'AUTORIG_SUBMIT')

  expect('approval_required_state', first.productionState === 'LIKELINESS_APPROVAL_REQUIRED' && first.likenessState === 'LIKELINESS_APPROVAL_REQUIRED' && first.primaryCta === "CONTINUE RA'EL BUILD", `${first.productionState}/${first.primaryCta}`)
  expect('zero_network_before_authority', Boolean(!first.authority && firstNetwork?.notes.some(note => /Zero cloud/i.test(note)) && !firstSubmit && firstOp?.textureSynthesisCalled === false), JSON.stringify(firstOp?.likenessReceipts.map(item => item.stage)))
  expect('no_authority_file', !existsSync(authorityFile) && !readLikenessAuthority(projectId), authorityFile)

  const continued = hvsCharacterProductionOrchestrator.continueRaelBuild(projectId, { now: '2026-09-23T20:01:00.000Z' })
  expect('continue_opens_gate', continued.approvalGateOpen === true && continued.productionState === 'LIKELINESS_APPROVAL_REQUIRED' && !continued.authority, String(continued.approvalGateOpen))

  const kept = hvsCharacterProductionOrchestrator.keepLocal(projectId, { now: '2026-09-23T20:02:00.000Z' })
  expect('keep_local', kept.productionState === 'LIKELINESS_APPROVAL_REQUIRED' && kept.operation?.keepLocal === true && kept.approvalGateOpen === false && !kept.authority, `${kept.productionState}/${kept.operation?.keepLocal}`)

  const resumedLocal = hvsCharacterProductionOrchestrator.build(projectId, { launchUnreal: false, resume: true, executeLive: false, now: '2026-09-23T20:03:00.000Z' })
  expect('resume_after_keep_local', resumedLocal.productionState === 'LIKELINESS_APPROVAL_REQUIRED' && resumedLocal.operation?.operationId === canonicalBuildOperationId(RAEL_CHARACTER_ID), resumedLocal.productionState)

  const mock = {
    dnaPresent: true,
    dnaInternal: true,
    dnaAssetPath: null as string | null,
    rigLogic: 'RIGGED' as const,
    faceMeshPath: '/Game/HVS/Characters/Rael/Face',
    bodyMeshPath: '/Game/HVS/Characters/Rael/Body',
    identityFitted: true,
    cineAssembled: true,
    assembledBlueprintPath: '/Game/MetaHumans/Rael/BP_Rael_Commander',
    providerRequestId: 'mock-epic-1',
    textureSynthesisCalled: true,
  }
  const authorized = hvsCharacterProductionOrchestrator.authorizeLikeness(projectId, {
    launchUnreal: false,
    executeLive: false,
    persistConform: mock,
    persistPreview: true,
    identityFitted: true,
    now: '2026-09-23T20:04:00.000Z',
  })
  const auth = readLikenessAuthority(projectId)
  const authorizedAgain = hvsCharacterProductionOrchestrator.authorizeLikeness(projectId, {
    launchUnreal: false,
    executeLive: false,
    persistConform: mock,
    persistPreview: true,
    identityFitted: true,
    now: '2026-09-23T20:05:00.000Z',
  })
  const submission = readCloudSubmission(projectId)
  const persisted = readCharacterProduction(projectId)

  expect('authority_receipt', Boolean(auth
    && auth.authorityType === HVS_METAHUMAN_LIKENESS_AUTHORITY_TYPE
    && auth.provider === HVS_METAHUMAN_LIKENESS_PROVIDER
    && auth.scope === HVS_METAHUMAN_LIKENESS_SCOPE
    && auth.trainingAllowed === false
    && auth.voiceAllowed === false
    && auth.faceRecognitionAllowed === false
    && auth.spendAllowed === false
    && auth.singlePurpose === true
    && auth.characterId === RAEL_CHARACTER_ID
    && auth.projectId === projectId), JSON.stringify(auth))
  expect('bound_authority_same_operation', authorized.operation?.operationId === canonicalBuildOperationId(RAEL_CHARACTER_ID) && authorized.authority?.authorizationId === auth?.authorizationId, authorized.operation?.operationId ?? 'missing')
  expect('idempotent_cloud', authorizedAgain.authority?.authorizationId === auth?.authorizationId && submission?.status === 'COMPLETE' && authorizedAgain.operation?.cloudSubmission?.inputHash === submission?.inputHash, submission?.submissionId ?? 'missing')
  expect('dna_truthful_internal', persisted?.dna.present === true && persisted.dna.internalToCharacter === true && persisted.dna.assetPath === null && persisted.dna.rigLogic === 'RIGGED', JSON.stringify(persisted?.dna))
  expect('payload_category', persisted?.payloadCategory === HVS_CLOUD_PAYLOAD_CATEGORY && authorized.privacyDisclosure.epicCloudStep === HVS_CLOUD_PAYLOAD_CATEGORY && authorized.privacyDisclosure.originalReferences === 'LOCAL', String(persisted?.payloadCategory))
  expect('preview_metadata', Boolean(authorized.highFidelityPreview
    && authorized.highFidelityPreview.renderEngine === 'UNREAL'
    && authorized.highFidelityPreview.characterId === RAEL_CHARACTER_ID
    && existsSync(authorized.highFidelityPreview.assetPath)
    && authorized.highFidelityPreview.lensMm === 85), JSON.stringify(authorized.highFidelityPreview))
  expect('renderer_identity', Boolean(authorized.operation?.previews.find(item => item.renderer === 'THREE_JS')
    && authorized.operation?.previews.find(item => item.renderer === 'UNREAL' && item.mode === 'HIGH_FIDELITY' && item.ready)
    && !authorized.operation?.previews.some(item => item.renderer === 'THREE_JS' && item.mode === 'HIGH_FIDELITY')), authorized.operation?.previews.map(item => `${item.mode}:${item.renderer}:${item.ready}`).join(',') ?? 'missing')
  expect('character_ready_after_mock', authorized.productionState === 'CHARACTER_READY' && authorized.operation?.status === 'COMPLETE', authorized.productionState)
  expect('take3_preserved', authorized.bodyPerformance.takeId === HVS_UE01_TAKE_ID && authorized.bodyPerformance.motionId === HVS_UE01_MOTION_ID && authorized.operation?.mannyRole === 'BODY_TEST_REFERENCE', `${authorized.bodyPerformance.takeId}/${manny?.adapter ?? 'missing'}`)
  expect('cinema_bind', authorized.cinema.shots.map(item => item.lensMm).join(',') === '24,24,24,85', authorized.cinema.shots.map(item => `${item.name}:${item.lensMm}`).join(','))
  expect('one_rael', authorized.operation?.characterId === RAEL_CHARACTER_ID && authorized.operation.identityId === RAEL_CHARACTER_ID && authorized.operation.notASecondIdentity, authorized.operation?.characterId ?? 'missing')
  expect('privacy_locks', Boolean(authorized.operation && preservesHuman01Locks(authorized.operation) && authorized.privacyDisclosure.training === 'NOT AUTHORIZED' && authorized.privacyDisclosure.voice === 'NOT AUTHORIZED'), JSON.stringify(authorized.privacyDisclosure))
  expect('manny_not_deleted', manny?.adapter === 'GENERIC_UE_HUMANOID' && manny.metahumanCharacterPath == null, String(manny?.adapter))
  expect('mhc_canonical', HVS_RAEL_MHC_PATH === '/Game/HVS/Characters/Rael/MHC_Rael_Commander' && authorized.operation?.metahumanCharacterPath === HVS_RAEL_MHC_PATH, HVS_RAEL_MHC_PATH)

  if (existsSync(authorityFile)) rmSync(authorityFile)
  if (existsSync(submissionFile)) rmSync(submissionFile)
  if (existsSync(productionFile)) rmSync(productionFile)
  const falseDna = hvsCharacterProductionOrchestrator.build(projectId, { launchUnreal: false, executeLive: false, now: '2026-09-23T20:10:00.000Z' })
  const falseAuth = hvsCharacterProductionOrchestrator.authorizeLikeness(projectId, {
    launchUnreal: false,
    executeLive: false,
    persistConform: { ...mock, dnaPresent: false, rigLogic: 'UNRIGGED' },
    persistPreview: true,
    identityFitted: true,
    now: '2026-09-23T20:11:00.000Z',
  })
  expect('dna_not_fabricated', falseDna.operation?.dna.present === false && falseAuth.operation?.dna.present === false && falseAuth.productionState !== 'CHARACTER_READY', JSON.stringify(falseAuth.operation?.dna))

  expect('adapter_exists', adapter.includes('HvsMetaHumanLikenessAdapter') && orch.includes('hvsMetaHumanLikenessAdapter') && existsSync(HVS_LIKENESS_PYTHON), 'adapter')
  expect('no_autorig_scatter', !/RequestAutoRigging|request_auto_rigging/.test(orch + ops + ui + route) && /request_auto_rigging/.test(py) && !/request_auto_rigging/.test(opsPy), 'isolated')
  expect('authority_guard_python', py.includes('authority_ok') && py.includes('executeCloud') && py.includes('NO_AUTHORITY'), 'python guard')
  expect('ui_approval', ui.includes('CONTINUE RA&apos;EL BUILD') && ui.includes('hvs-authorize-likeness') && ui.includes('hvs-keep-local') && ui.includes('hvs-likeness-approval') && view.includes(LIKENESS_APPROVAL_COPY.authorize), 'approval ui')
  expect('ui_no_dark_pattern', view.includes('derived Face Mesh') && view.includes('remain local') && !/no face data leaves/i.test(ui + view), 'disclosure')
  expect('preview_unavailable_copy', ui.includes('HIGH-FIDELITY PREVIEW UNAVAILABLE') && ui.includes('Fast Preview: Three.js available'), 'renderer honesty')
  expect('face_animator_off', ui.includes('CAPTURE FACIAL PERFORMANCE') && ui.includes("onClick={() => undefined}") && py.includes('NOT_STARTED') && !/enableLiveLink|startAnimator/.test(orch + adapter + ui), 'animator off')
  expect('camera_off', ui.includes('The camera stays off until you start it') && !/getUserMedia/.test(ui), 'camera off')
  expect('tech_collapsed', ui.includes('TECHNICAL DETAILS') && !ui.includes('<details open') && ui.includes('Original references'), 'details')
  expect('matrix_187', HVS_MATRIX_ROWS.length === 187, String(HVS_MATRIX_ROWS.length))
  expect('matrix_extension_required', MATRIX_EXTENSION_REQUIRED === 'MATRIX_EXTENSION_REQUIRED', MATRIX_EXTENSION_REQUIRED)
  expect('validate_script', packageJson.includes('validate:hvs-character-preview-return'), 'script')
  expect('official_gui_bounded', adapter.includes('BOUNDED_OPERATOR_STEP') && adapter.includes('METAHUMAN_CREATOR_LANDMARK') && adapter.includes('EPIC_SIGN_IN'), 'gui gate')
  expect('preview_dir_canonical', previewDir.includes(`character-production/${projectId}/rael-commander/preview`), previewDir)
} finally {
  restore(productionFile, backup)
  restore(authorityFile, authorityBackup)
  restore(submissionFile, submissionBackup)
}

const failed = results.filter(item => !item.pass)
const runtimeMs = Number(process.hrtime.bigint() - started) / 1e6
for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
console.log(JSON.stringify({
  ok: failed.length === 0,
  failed: failed.map(item => item.name),
  total: results.length,
  runtimeMs: Number(runtimeMs.toFixed(2)),
  matrix: HVS_MATRIX_ROWS.length,
}, null, 2))
process.exit(failed.length === 0 ? 0 : 1)
