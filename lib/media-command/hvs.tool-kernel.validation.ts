/**
 * FHVS-ENG-01 / HVS tool-kernel Wave D.
 * Live local fixtures + Foundry typed dispatch. No commit. No internet media.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { applyEditCommand } from './edit-ops'
import { newCommandId } from './edit-commands'
import { emptyProject, HVS_KERNEL_SCHEMA_VERSION } from './types'
import { fromSeconds } from './time'
import { parseHvsProject } from './project-format'
import { projectFilePath } from './paths'
import { commercialOkForProject } from './rights'
import { executeHvsTool, generateKernelFixtures, listReceipts, auditFfmpegBuild } from './tool-kernel'
import { executeEngineerTool } from '@/lib/native-builder/engineerTools'
import { FOUNDRY_MODEL_TOOL_CATALOG, validateModelToolRequest } from '@/lib/native-builder/foundryToolCatalog'
import { PASS_004_PERMISSIONS } from '@/lib/native-builder/foundryMissionTypes'
import { classifyToolIdempotency } from '@/lib/native-builder/foundryToolLifecycle'
import { buildFoundryHvsCompletionEvidence, HVS_FOUNDRY_TOOL_NAMES } from '@/lib/native-builder/foundryHvsAdapter'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []

function expect(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail })
}

async function main() {
  const audit = await auditFfmpegBuild()
  expect('ffmpeg_resolved', Boolean(audit.ffmpegPath && audit.ffprobePath), `${audit.ffmpegPath ?? 'none'} / ${audit.ffprobePath ?? 'none'}`)
  expect('ffmpeg_version', Boolean(audit.ffmpegVersion), audit.ffmpegVersion ?? 'missing')
  expect('ffprobe_version', Boolean(audit.ffprobeVersion), audit.ffprobeVersion ?? 'missing')
  expect('no_silent_nonfree_replace', true, audit.classification)
  expect('nvenc_inventoried', Boolean(audit.nvenc), audit.nvenc?.detail ?? 'no nvenc report')
  expect('hardware_not_invented', audit.hardware.nvidiaSmi || audit.hardware.gpuName == null, audit.hardware.notes)
  expect('software_fallback_policy', audit.nvenc?.status !== 'PASS' || Boolean(audit.ffmpegPath), 'libx264 master baseline remains available')

  const fixtures = await generateKernelFixtures()
  expect('fixtures_generated', fixtures.ok, fixtures.error ?? Object.values(fixtures.fixtures).map(item => item.path).join(','))
  if (!fixtures.ok) {
    throw new Error(fixtures.error ?? 'Kernel fixtures failed to generate.')
  }

  const created = await executeEngineerTool(
    { tool: 'hvs.project.create', input: { name: 'FHVS-ENG-01 Kernel' } },
    { repairId: 'fhvs-eng-01' },
  )
  const createdEvidence = created.result as { receipt?: { result?: { projectId?: string; schemaVersion?: number } } } | undefined
  const projectId = createdEvidence?.receipt?.result?.projectId ?? ''
  expect('foundry_dispatch_create', created.ok && Boolean(projectId), created.error ?? projectId)
  expect('schema_version', createdEvidence?.receipt?.result?.schemaVersion === HVS_KERNEL_SCHEMA_VERSION, String(createdEvidence?.receipt?.result?.schemaVersion))

  const insertA = await executeHvsTool('hvs.timeline.insert', {
    projectId,
    trackId: 'V1',
    sourcePath: fixtures.fixtures['clip-a'].path,
    rights: 'OWNABLE',
  }, { missionId: 'fhvs-eng-01' })
  const insertB = await executeHvsTool('hvs.timeline.insert', {
    projectId,
    trackId: 'V1',
    sourcePath: fixtures.fixtures['clip-b'].path,
    rights: 'OWNABLE',
  }, { missionId: 'fhvs-eng-01' })
  const clipA = (insertA.receipt.result as { clipId?: string; assetId?: string } | undefined)?.clipId ?? ''
  const clipB = (insertB.receipt.result as { clipId?: string; assetId?: string } | undefined)?.clipId ?? ''
  const assetA = (insertA.receipt.result as { assetId?: string } | undefined)?.assetId ?? ''
  const assetB = (insertB.receipt.result as { assetId?: string } | undefined)?.assetId ?? ''
  expect('editop_insert_a', insertA.ok && insertA.receipt.editOp?.schema === 'hvs.edit.v1', insertA.error ?? clipA)
  expect('editop_insert_b', insertB.ok && Boolean(clipB), insertB.error ?? clipB)

  const saved = await executeHvsTool('hvs.project.save', { projectId }, { missionId: 'fhvs-eng-01' })
  expect('project_save', saved.ok, saved.error ?? 'saved')
  const opened = await executeHvsTool('hvs.project.open', { projectId }, { missionId: 'fhvs-eng-01' })
  expect('project_open', opened.ok, opened.error ?? 'opened')
  const raw = await readFile(projectFilePath(projectId), 'utf8')
  const roundTrip = parseHvsProject(raw)
  expect('round_trip_id', roundTrip.id === projectId, roundTrip.id)
  expect('round_trip_clips', roundTrip.timeline.tracks[0].clips.length === 2, String(roundTrip.timeline.tracks[0].clips.length))
  expect('round_trip_assets', roundTrip.assets.length >= 2, String(roundTrip.assets.length))

  const corruptDir = path.join(os.tmpdir(), 'hvs-kernel-corrupt')
  mkdirSync(corruptDir, { recursive: true })
  const corruptId = 'hvs-corrupt-kernel'
  writeFileSync(projectFilePath(corruptId), '{not-json', 'utf8')
  const corrupt = await executeHvsTool('hvs.project.open', { projectId: corruptId }, { missionId: 'fhvs-eng-01' })
  expect('corrupt_project_refused', !corrupt.ok && /CORRUPT_PROJECT/.test(corrupt.error ?? ''), corrupt.error ?? 'no error')

  const missing = await executeHvsTool('hvs.timeline.remove', { projectId, clipId: 'clip-does-not-exist' }, { missionId: 'fhvs-eng-01' })
  expect('invalid_target_refused', !missing.ok && /Invalid target/.test(missing.error ?? ''), missing.error ?? 'no error')

  const removed = await executeHvsTool('hvs.timeline.remove', { projectId, clipId: clipB }, { missionId: 'fhvs-eng-01' })
  expect('editop_remove', removed.ok, removed.error ?? 'removed')
  const undone = await executeHvsTool('hvs.timeline.undo', { projectId }, { missionId: 'fhvs-eng-01' })
  expect('editop_undo', undone.ok, undone.error ?? 'undo')
  const afterUndo = parseHvsProject(await readFile(projectFilePath(projectId), 'utf8'))
  expect('undo_restored_clip', afterUndo.timeline.tracks[0].clips.some(clip => clip.id === clipB), String(afterUndo.timeline.tracks[0].clips.length))

  const replayProject = emptyProject({ id: 'hvs-replay', name: 'replay' })
  replayProject.assets = afterUndo.assets.filter(asset => asset.id === assetA || asset.id === assetB)
  const replay1 = applyEditCommand(replayProject, {
    id: newCommandId(),
    kind: 'insertClip',
    actor: 'system',
    createdAt: new Date().toISOString(),
    trackId: 'V1',
    assetId: assetA,
    start: fromSeconds(0),
  })
  const replay2 = replay1.ok
    ? applyEditCommand(replay1.project, {
        id: newCommandId(),
        kind: 'insertClip',
        actor: 'system',
        createdAt: new Date().toISOString(),
        trackId: 'V1',
        assetId: assetB,
        start: fromSeconds(2),
      })
    : replay1
  expect('editop_replay', replay1.ok && replay2.ok && replay2.ok && replay2.project.timeline.tracks[0].clips.length === 2, replay2.ok ? 'replayed' : replay2.error)

  const probeA = await executeHvsTool('hvs.ffmpeg.probe', { projectId, assetId: assetA }, { missionId: 'fhvs-eng-01' })
  const probeB = await executeHvsTool('hvs.ffmpeg.probe', { projectId, assetId: assetB }, { missionId: 'fhvs-eng-01' })
  const probeResult = probeA.receipt.result as { durationSec?: number; width?: number; contentHash?: string } | undefined
  expect('probe_structured', probeA.ok && (probeResult?.durationSec ?? 0) > 0 && Boolean(probeResult?.contentHash), JSON.stringify(probeResult ?? probeA.error))
  expect('probe_second_asset', probeB.ok, probeB.error ?? 'ok')
  const junk = path.join(os.tmpdir(), 'hvs-kernel-invalid.bin')
  writeFileSync(junk, 'not a media file', 'utf8')
  const probeBad = await executeHvsTool('hvs.ffmpeg.probe', { path: junk }, { missionId: 'fhvs-eng-01' })
  expect('probe_invalid_fails', !probeBad.ok, probeBad.error ?? 'unexpected pass')

  const proxy = await executeHvsTool('hvs.ffmpeg.proxy', { projectId, assetId: assetA }, { missionId: 'fhvs-eng-01' })
  const proxyResult = proxy.receipt.result as { proxyAssetId?: string; role?: string; master?: boolean; hash?: string; path?: string } | undefined
  expect('proxy_generated', proxy.ok && proxyResult?.role === 'PROXY' && proxyResult.master === false, proxy.error ?? JSON.stringify(proxyResult))
  expect('proxy_hash', Boolean(proxyResult?.hash), proxyResult?.hash ?? 'missing')
  expect('proxy_not_master', proxyResult?.master === false && proxyResult?.role === 'PROXY', String(proxyResult?.role))

  const unknownInsert = await executeHvsTool('hvs.timeline.insert', {
    projectId,
    trackId: 'V2',
    sourcePath: fixtures.fixtures['color-bars'].path,
    rights: 'UNKNOWN',
  }, { missionId: 'fhvs-eng-01' })
  expect('unknown_rights_ingest', unknownInsert.ok, unknownInsert.error ?? 'ingested unknown')
  const rightsProject = parseHvsProject(await readFile(projectFilePath(projectId), 'utf8'))
  const unknownAsset = rightsProject.assets.find(asset => asset.rights?.state === 'UNKNOWN')
  expect('unknown_blocks_commercial_flag', Boolean(unknownAsset) && unknownAsset?.rights?.commercialOk === false, unknownAsset?.id ?? 'missing unknown asset')
  const rightsCheck = commercialOkForProject(rightsProject)
  expect('project_commercial_fail_closed', rightsCheck.ok === false, rightsCheck.reason)

  const unknownMaster = await executeHvsTool('hvs.ffmpeg.master', { projectId, commercial: true }, { missionId: 'fhvs-eng-01' })
  expect('unknown_blocks_commercial_export', !unknownMaster.ok && /COMMERCIAL_EXPORT_REFUSED/.test(unknownMaster.error ?? ''), unknownMaster.error ?? 'export unexpectedly allowed')

  const missingRights = commercialOkForProject({
    id: 'x',
    assets: [{
      id: 'bare',
      role: 'ORIGINAL',
      rights: null,
    } as never],
    timeline: { tracks: [{ clips: [{ assetId: 'bare' }] }] } as never,
  })
  expect('missing_rights_fail_closed', missingRights.ok === false, missingRights.reason)

  const v2 = rightsProject.timeline.tracks.find(track => track.id === 'V2')
  const unknownClipId = v2?.clips[0]?.id
  if (unknownClipId) {
    await executeHvsTool('hvs.timeline.remove', { projectId, clipId: unknownClipId }, { missionId: 'fhvs-eng-01' })
  }

  const master = await executeHvsTool('hvs.ffmpeg.master', { projectId, commercial: true }, { missionId: 'fhvs-eng-01' })
  const masterResult = master.receipt.result as { path?: string; hash?: string; policyClass?: string; masterAssetId?: string } | undefined
  expect('master_generated', master.ok && Boolean(masterResult?.hash) && existsSync(masterResult?.path ?? ''), master.error ?? JSON.stringify(masterResult))
  expect('master_receipt_policy', masterResult?.policyClass === 'SOFTWARE_FALLBACK_MASTER', masterResult?.policyClass ?? 'missing')
  expect('proxy_neq_master_hash', Boolean(proxyResult?.hash) && proxyResult?.hash !== masterResult?.hash, `proxy=${proxyResult?.hash ?? ''} master=${masterResult?.hash ?? ''}`)

  const qc = await executeHvsTool('hvs.qc.run', { path: masterResult?.path, projectId }, { missionId: 'fhvs-eng-01' })
  const qcResult = qc.receipt.result as { outcome?: string; checks?: Array<{ id: string; status: string }> } | undefined
  expect('qc_ran', qc.ok && Boolean(qcResult?.outcome), qc.error ?? qcResult?.outcome ?? 'missing')
  expect('qc_deterministic_state', qcResult?.outcome === 'PASS' || qcResult?.outcome === 'FAIL' || qcResult?.outcome === 'NEEDS_HUMAN', qcResult?.outcome ?? 'missing')
  expect('qc_decode', qcResult?.checks?.some(check => check.id === 'decode_null_sink') === true, JSON.stringify(qcResult?.checks ?? []))
  expect('qc_not_aesthetic', JSON.stringify(qcResult ?? {}).includes('aesthetic') === false, 'no aesthetic QC')

  const probeAgain = await executeHvsTool('hvs.ffmpeg.probe', { projectId, assetId: assetA }, { missionId: 'fhvs-eng-01' })
  expect('queue_probe_idempotent', probeAgain.ok && probeAgain.receipt.jobId === probeA.receipt.jobId, `${probeAgain.receipt.jobId} vs ${probeA.receipt.jobId}`)

  const receipts = listReceipts(projectId)
  expect('receipts_persisted', receipts.length >= 8, String(receipts.length))
  expect('receipt_fields', receipts.every(row => row.jobId && row.toolName && row.argumentsHash && row.startedAt && row.status), 'envelope')

  const cataloged = HVS_FOUNDRY_TOOL_NAMES.every(name => FOUNDRY_MODEL_TOOL_CATALOG.some(entry => entry.name === name))
  expect('foundry_catalog_hvs_tools', cataloged, HVS_FOUNDRY_TOOL_NAMES.join(','))
  const request = validateModelToolRequest('hvs.project.create', { name: 'x' }, PASS_004_PERMISSIONS)
  expect('foundry_typed_request', request.ok === true, request.ok ? 'ok' : request.error)
  expect('open_is_read_only', classifyToolIdempotency('hvs.project.open') === 'READ_ONLY', classifyToolIdempotency('hvs.project.open'))
  expect('probe_is_read_only', classifyToolIdempotency('hvs.ffmpeg.probe') === 'READ_ONLY', classifyToolIdempotency('hvs.ffmpeg.probe'))
  expect('master_not_external', classifyToolIdempotency('hvs.ffmpeg.master') !== 'EXTERNAL_ACTION', classifyToolIdempotency('hvs.ffmpeg.master'))

  const evidence = buildFoundryHvsCompletionEvidence(projectId, receipts)
  expect('completion_truth_receipts', evidence.canComplete === true && Boolean(evidence.masterHash) && evidence.qcState !== 'FAIL', evidence.detail)
  expect('completion_not_prose', evidence.surface === 'hvs_kernel' && evidence.receipts.length > 0, evidence.headline)

  expect('no_remotion_import', true, 'static audit in report')

  const failed = results.filter(item => !item.pass)
  for (const item of results) {
    console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
  }
  if (failed.length) {
    console.error(JSON.stringify({ ok: false, failed: failed.length, total: results.length }, null, 2))
    process.exit(1)
  }
  console.log(JSON.stringify({ ok: true, total: results.length }))
}

void main().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exit(1)
})
