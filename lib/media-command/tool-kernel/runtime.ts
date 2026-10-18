/**
 * HVS tool-kernel runtime. .hvsproj remains HVS source of truth.
 * Foundry calls through foundryHvsAdapter; this module does not live in Foundry.
 */
import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { newCommandId, type EditCommand } from '../edit-commands'
import { PROXY_PROFILE, ingestFile } from '../ingest'
import { mediaCommandDataHierarchy, projectFilePath, projectLogPath } from '../paths'
import { probeMediaFile } from '../probe'
import { commercialOkForProject, normalizeRights } from '../rights'
import { parseHvsProject } from '../project-format'
import { commitCommands, createProject, loadProject, saveProject } from '../store'
import { fromSeconds } from '../time'
import type { AssetRecord, AssetRights, HvsProject } from '../types'
import { findAsset, findClip, HVS_KERNEL_SCHEMA_VERSION } from '../types'
import { resolveFfmpegTools, runProcess } from '../ffmpeg'
import { runDeterministicQc } from './qc'
import {
  findIdempotentReceipt,
  finishReceipt,
  hashToolArgs,
  listReceipts,
  startReceipt,
} from './receipts'
import {
  HVS_MASTER_BASELINE_V1,
  HVS_PROXY_BASELINE_V1,
  isHvsToolName,
  type HvsEditOpV1,
  type HvsProbeResult,
  type HvsToolContext,
  type HvsToolName,
  type HvsToolReceipt,
  type HvsToolResult,
} from './types'

const FORBIDDEN = /publish|deploy|push|upload|spend|youtube|tiktok|sora|runway|kling|luma|veo/i

async function sha256File(filePath: string): Promise<string | null> {
  if (!existsSync(filePath)) return null
  const hash = createHash('sha256')
  await pipeline(createReadStream(filePath), hash)
  return hash.digest('hex')
}

function projectStateRef(project: HvsProject): string {
  return createHash('sha256')
    .update(JSON.stringify({
      id: project.id,
      updatedAt: project.updatedAt,
      currentVersionId: project.currentVersionId,
      assets: project.assets.map(asset => ({ id: asset.id, hash: asset.checksumSha256, role: asset.role ?? 'ORIGINAL' })),
      clips: project.timeline.tracks.flatMap(track => track.clips.map(clip => ({ id: clip.id, assetId: clip.assetId, start: clip.start }))),
    }))
    .digest('hex')
}

function str(input: Record<string, unknown>, key: string): string {
  const value = input[key]
  return typeof value === 'string' ? value.trim() : ''
}

function num(input: Record<string, unknown>, key: string): number | null {
  const value = input[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function fail(receipt: HvsToolReceipt, error: string, extra?: Partial<HvsToolReceipt>): HvsToolResult {
  const next = finishReceipt(receipt, {
    status: extra?.authorityClass === 'REFUSED' || receipt.authorityClass === 'REFUSED' ? 'REFUSED' : 'FAILED',
    errors: [error, ...(extra?.errors ?? [])],
    ...extra,
  })
  return { ok: false, tool: next.toolName, receipt: next, error }
}

function ok(receipt: HvsToolReceipt, extra: Partial<HvsToolReceipt> & { result?: unknown }): HvsToolResult {
  const next = finishReceipt(receipt, { status: 'COMPLETED', ...extra })
  return { ok: true, tool: next.toolName, receipt: next }
}

async function requireProject(projectId: string): Promise<{ project: HvsProject } | { error: string; code: 'NOT_FOUND' | 'CORRUPT_PROJECT' }> {
  if (!projectId) return { error: 'projectId is required.', code: 'NOT_FOUND' }
  const file = projectFilePath(projectId)
  if (!existsSync(file)) return { error: `HVS project "${projectId}" was not found.`, code: 'NOT_FOUND' }
  try {
    return { project: parseHvsProject(await readFile(file, 'utf8')) }
  } catch (err) {
    return {
      error: `CORRUPT_PROJECT: ${err instanceof Error ? err.message : 'unreadable .hvsproj'}`,
      code: 'CORRUPT_PROJECT',
    }
  }
}

function parseRights(input: Record<string, unknown>): AssetRights {
  const raw = input.rights
  if (typeof raw === 'string') return normalizeRights({ state: raw as AssetRights['state'], commercialOk: raw === 'OWNABLE' })
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const rec = raw as Record<string, unknown>
    return normalizeRights({
      state: (typeof rec.state === 'string' ? rec.state : 'UNKNOWN') as AssetRights['state'],
      commercialOk: rec.commercialOk === true,
      source: typeof rec.source === 'string' ? rec.source : null,
      notes: typeof rec.notes === 'string' ? rec.notes : null,
    })
  }
  return normalizeRights(null)
}

async function ingestFromPath(project: HvsProject, sourcePath: string, originalName: string, rights: AssetRights): Promise<{ project: HvsProject; asset: AssetRecord }> {
  const ingested = await ingestFile({
    project,
    sourcePath,
    originalName,
    generated: true,
    rights,
    role: 'ORIGINAL',
    provenance: {
      provider: 'hvs-kernel',
      model: null,
      prompt: null,
      parameters: { fixture: true },
      seed: null,
      referenceAssetIds: [],
      sourceAssetIds: [],
      createdAt: new Date().toISOString(),
      commercialUse: rights.commercialOk ? 'allowed' : 'unknown',
      parentAssetId: null,
      origin: 'generated',
      license: rights.state,
      projectId: project.id,
    },
  })
  return { project: ingested.project, asset: ingested.asset }
}

function wrapEditOp(input: {
  command: EditCommand
  projectId: string
  actorId: string
  missionId: string | null
  type: HvsEditOpV1['operationType']
  target: HvsEditOpV1['target']
  args: Record<string, unknown>
  mode: 'preview' | 'commit'
  previousStateRef: string | null
  resultingStateRef: string | null
}): HvsEditOpV1 {
  return {
    schema: 'hvs.edit.v1',
    operationId: input.command.id,
    projectId: input.projectId,
    actorId: input.actorId,
    missionId: input.missionId,
    operationType: input.type,
    target: input.target,
    args: input.args,
    timestamp: input.command.createdAt,
    mode: input.mode,
    previousStateRef: input.previousStateRef,
    resultingStateRef: input.resultingStateRef,
  }
}

async function typedProbe(filePath: string): Promise<HvsProbeResult> {
  const probedAt = new Date().toISOString()
  const probed = await probeMediaFile(filePath)
  const contentHash = await sha256File(filePath)
  const frameRate = probed.frameRateN && probed.frameRateD ? `${probed.frameRateN}/${probed.frameRateD}` : null
  return {
    path: filePath,
    durationSec: probed.durationSec,
    videoStreams: probed.hasVideo
      ? [{
          codec: probed.codec,
          width: probed.width,
          height: probed.height,
          frameRate,
          pixelFormat: probed.pixelFormat,
          rotation: probed.rotation,
        }]
      : [],
    audioStreams: probed.audioStreams.map(stream => ({
      codec: stream.codec,
      sampleRate: stream.sampleRate,
      channels: stream.channels,
    })),
    codec: probed.codec,
    width: probed.width,
    height: probed.height,
    frameRate,
    sampleRate: probed.sampleRate,
    channelCount: probed.channels,
    pixelFormat: probed.pixelFormat,
    rotation: probed.rotation,
    contentHash,
    sourceHash: contentHash,
    probedAt,
  }
}

export async function executeHvsTool(
  tool: string,
  input: Record<string, unknown>,
  ctx: HvsToolContext = {},
): Promise<HvsToolResult> {
  const missionId = ctx.missionId ?? null
  const actorId = ctx.actorId ?? missionId ?? 'hvs-kernel'
  const projectIdHint = str(input, 'projectId') || null
  const receipt = startReceipt({ toolName: tool, missionId, projectId: projectIdHint, args: input })

  if (FORBIDDEN.test(tool) || FORBIDDEN.test(JSON.stringify(input))) {
    receipt.authorityClass = 'REFUSED'
    return fail(receipt, 'HVS kernel refuses publish/deploy/push/upload/spend and paid generation.', { authorityClass: 'REFUSED' })
  }
  if (!isHvsToolName(tool)) {
    receipt.authorityClass = 'REFUSED'
    return fail(receipt, `Unknown or unauthorized HVS tool "${tool}".`, { authorityClass: 'REFUSED' })
  }

  if (tool === 'hvs.project.open' || tool === 'hvs.ffmpeg.probe') {
    const replay = projectIdHint ? findIdempotentReceipt(projectIdHint, hashToolArgs(tool, input), tool) : null
    if (replay) return { ok: true, tool, receipt: replay }
  }

  switch (tool as HvsToolName) {
    case 'hvs.project.create': {
      const name = str(input, 'name') || 'HVS Kernel Project'
      const project = await createProject({ name })
      project.kernelSchemaVersion = HVS_KERNEL_SCHEMA_VERSION
      project.notes = [project.notes, `editLogUri=${projectLogPath(project.id)}`].filter(Boolean).join('\n')
      const saved = await saveProject(project)
      receipt.projectId = saved.id
      return ok(receipt, {
        result: {
          projectId: saved.id,
          schemaVersion: saved.kernelSchemaVersion ?? HVS_KERNEL_SCHEMA_VERSION,
          formatVersion: saved.formatVersion,
          createdAt: saved.createdAt,
          sequences: saved.sequences,
          editLogUri: projectLogPath(saved.id),
        },
        hashes: { ...receipt.hashes, project: projectStateRef(saved) },
      })
    }
    case 'hvs.project.open': {
      const loaded = await requireProject(str(input, 'projectId'))
      if ('error' in loaded) return fail(receipt, loaded.error)
      receipt.projectId = loaded.project.id
      return ok(receipt, {
        result: {
          projectId: loaded.project.id,
          name: loaded.project.name,
          schemaVersion: loaded.project.kernelSchemaVersion ?? 0,
          formatVersion: loaded.project.formatVersion,
          updatedAt: loaded.project.updatedAt,
          assetCount: loaded.project.assets.length,
          clipCount: loaded.project.timeline.tracks.reduce((n, track) => n + track.clips.length, 0),
          sequences: loaded.project.sequences,
          stateRef: projectStateRef(loaded.project),
        },
        hashes: { ...receipt.hashes, project: projectStateRef(loaded.project) },
      })
    }
    case 'hvs.project.save': {
      const loaded = await requireProject(str(input, 'projectId'))
      if ('error' in loaded) return fail(receipt, loaded.error)
      const saved = await saveProject(loaded.project)
      receipt.projectId = saved.id
      return ok(receipt, {
        result: { projectId: saved.id, updatedAt: saved.updatedAt, stateRef: projectStateRef(saved) },
        hashes: { ...receipt.hashes, project: projectStateRef(saved) },
      })
    }
    case 'hvs.timeline.insert': {
      const loaded = await requireProject(str(input, 'projectId'))
      if ('error' in loaded) return fail(receipt, loaded.error)
      let project = loaded.project
      const trackId = str(input, 'trackId') || 'V1'
      const mode = str(input, 'mode') === 'preview' ? 'preview' : 'commit'
      let assetId = str(input, 'assetId')
      if (!assetId) {
        const sourcePath = str(input, 'sourcePath')
        if (!sourcePath) return fail(receipt, 'hvs.timeline.insert requires assetId or sourcePath.')
        if (!existsSync(sourcePath)) return fail(receipt, `sourcePath not found: ${sourcePath}`)
        const ingested = await ingestFromPath(project, sourcePath, path.basename(sourcePath), parseRights(input))
        project = ingested.project
        assetId = ingested.asset.id
      }
      const asset = findAsset(project, assetId)
      if (!asset) return fail(receipt, `Invalid target: asset "${assetId}" is not in this project.`)
      const track = project.timeline.tracks.find(item => item.id === trackId)
      if (!track) return fail(receipt, `Invalid target: track "${trackId}" is not in this project.`)
      const startSec = num(input, 'startSec') ?? toSecondsSafe(track)
      const previousStateRef = projectStateRef(project)
      const command: EditCommand = {
        id: newCommandId(),
        kind: 'insertClip',
        actor: 'system',
        createdAt: new Date().toISOString(),
        trackId,
        assetId,
        start: fromSeconds(startSec),
      }
      const committed = await commitCommands(project, [command], { preview: mode === 'preview' })
      if (committed.errors.length) return fail(receipt, committed.errors.join(' '))
      const clip = committed.project.timeline.tracks.find(item => item.id === trackId)?.clips.slice(-1)[0]
      const editOp = wrapEditOp({
        command,
        projectId: committed.project.id,
        actorId,
        missionId,
        type: 'insert',
        target: { trackId, assetId, clipId: clip?.id },
        args: input,
        mode,
        previousStateRef,
        resultingStateRef: projectStateRef(committed.project),
      })
      receipt.projectId = committed.project.id
      return ok(receipt, {
        editOp,
        result: { projectId: committed.project.id, clipId: clip?.id ?? null, assetId, trackId, editOp },
        hashes: { ...receipt.hashes, project: projectStateRef(committed.project) },
      })
    }
    case 'hvs.timeline.remove': {
      const loaded = await requireProject(str(input, 'projectId'))
      if ('error' in loaded) return fail(receipt, loaded.error)
      const clipId = str(input, 'clipId')
      if (!clipId) return fail(receipt, 'clipId is required.')
      const found = findClip(loaded.project, clipId)
      if (!found) return fail(receipt, `Invalid target: clip "${clipId}" is not on the timeline.`)
      const mode = str(input, 'mode') === 'preview' ? 'preview' : 'commit'
      const previousStateRef = projectStateRef(loaded.project)
      const command: EditCommand = {
        id: newCommandId(),
        kind: 'rippleDelete',
        actor: 'system',
        createdAt: new Date().toISOString(),
        clipId,
      }
      const committed = await commitCommands(loaded.project, [command], { preview: mode === 'preview' })
      if (committed.errors.length) return fail(receipt, committed.errors.join(' '))
      const editOp = wrapEditOp({
        command,
        projectId: committed.project.id,
        actorId,
        missionId,
        type: 'remove',
        target: { clipId, trackId: found.track.id, assetId: found.clip.assetId },
        args: input,
        mode,
        previousStateRef,
        resultingStateRef: projectStateRef(committed.project),
      })
      receipt.projectId = committed.project.id
      return ok(receipt, {
        editOp,
        result: { projectId: committed.project.id, removedClipId: clipId, editOp },
        hashes: { ...receipt.hashes, project: projectStateRef(committed.project) },
      })
    }
    case 'hvs.timeline.undo': {
      const loaded = await requireProject(str(input, 'projectId'))
      if ('error' in loaded) return fail(receipt, loaded.error)
      const previousStateRef = projectStateRef(loaded.project)
      const command: EditCommand = {
        id: newCommandId(),
        kind: 'undo',
        actor: 'system',
        createdAt: new Date().toISOString(),
      }
      const committed = await commitCommands(loaded.project, [command])
      if (committed.errors.length) return fail(receipt, committed.errors.join(' '))
      const editOp = wrapEditOp({
        command,
        projectId: committed.project.id,
        actorId,
        missionId,
        type: 'undo',
        target: {},
        args: input,
        mode: 'commit',
        previousStateRef,
        resultingStateRef: projectStateRef(committed.project),
      })
      receipt.projectId = committed.project.id
      return ok(receipt, {
        editOp,
        result: { projectId: committed.project.id, editOp },
        hashes: { ...receipt.hashes, project: projectStateRef(committed.project) },
      })
    }
    case 'hvs.ffmpeg.probe': {
      const filePath = await resolveProbePath(input)
      if (!filePath.ok) return fail(receipt, filePath.error)
      if (!existsSync(filePath.path)) return fail(receipt, `Invalid file: ${filePath.path}`)
      const probed = await typedProbe(filePath.path)
      if (!probed.videoStreams.length && !probed.audioStreams.length) {
        return fail(receipt, 'ffprobe returned no video or audio streams.', { result: probed })
      }
      if (probed.contentHash) receipt.hashes.content = probed.contentHash
      receipt.projectId = str(input, 'projectId') || receipt.projectId
      return ok(receipt, { result: probed, hashes: { ...receipt.hashes, content: probed.contentHash ?? '' } })
    }
    case 'hvs.ffmpeg.proxy':
      return makeProxy(receipt, input)
    case 'hvs.ffmpeg.master':
      return makeMaster(receipt, input)
    case 'hvs.qc.run': {
      const target = await resolveProbePath(input)
      if (!target.ok) return fail(receipt, target.error)
      const report = await runDeterministicQc(target.path)
      receipt.projectId = str(input, 'projectId') || receipt.projectId
      if (report.hash) receipt.hashes.output = report.hash
      return ok(receipt, {
        qcState: report.outcome,
        result: report,
        hashes: { ...receipt.hashes, output: report.hash ?? '' },
      })
    }
    default:
      return fail(receipt, `Tool "${tool}" is not implemented in this kernel slice.`)
  }
}

function toSecondsSafe(track: { clips: Array<{ start: { ticks: number; timescale: number }; duration: { ticks: number; timescale: number } }> }): number {
  let max = 0
  for (const clip of track.clips) {
    const end = (clip.start.ticks + clip.duration.ticks) / (clip.start.timescale || 1)
    if (end > max) max = end
  }
  return max
}

async function resolveProbePath(input: Record<string, unknown>): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const direct = str(input, 'path')
  if (direct) return { ok: true, path: direct }
  const projectId = str(input, 'projectId')
  const assetId = str(input, 'assetId')
  if (!projectId || !assetId) return { ok: false, error: 'path or projectId+assetId is required.' }
  const loaded = await loadProject(projectId)
  if (!loaded) return { ok: false, error: `HVS project "${projectId}" was not found.` }
  const asset = findAsset(loaded, assetId)
  if (!asset) return { ok: false, error: `Invalid target: asset "${assetId}" is not in this project.` }
  return { ok: true, path: asset.originalPath }
}

async function makeProxy(receipt: HvsToolReceipt, input: Record<string, unknown>): Promise<HvsToolResult> {
  const loaded = await requireProject(str(input, 'projectId'))
  if ('error' in loaded) return fail(receipt, loaded.error)
  const assetId = str(input, 'assetId')
  const source = findAsset(loaded.project, assetId)
  if (!source) return fail(receipt, `Invalid target: asset "${assetId}" is not in this project.`)
  if (source.role === 'PROXY') return fail(receipt, 'Refusing to proxy a PROXY asset.')
  if (source.role === 'MASTER') return fail(receipt, 'Refusing to derive a preview proxy from a MASTER as if it were source.')
  const tools = await resolveFfmpegTools()
  if (!tools.ffmpeg) return fail(receipt, 'HVS ffmpeg was not resolved.')
  const dirs = mediaCommandDataHierarchy()
  await mkdir(dirs.proxies, { recursive: true })
  const dest = path.join(dirs.proxies, `kernel-${source.id}.mp4`)
  const args = [
    '-y', '-i', source.originalPath,
    '-vf', `scale=${HVS_PROXY_BASELINE_V1.maxWidth}:-2:flags=fast_bilinear,fps=${HVS_PROXY_BASELINE_V1.fps}`,
    '-c:v', 'libx264', '-preset', HVS_PROXY_BASELINE_V1.preset, '-crf', String(HVS_PROXY_BASELINE_V1.crf),
    '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '128k',
    '-movflags', '+faststart',
    dest,
  ]
  const encoded = await runProcess(tools.ffmpeg, args, 600_000)
  if (!encoded.ok || !existsSync(dest)) return fail(receipt, encoded.stderr.slice(-600) || 'Proxy encode failed.')
  const hash = await sha256File(dest)
  const proxyAsset: AssetRecord = {
    ...source,
    id: `proxy-${source.id}`,
    name: `${source.name} (proxy)`,
    originalPath: dest,
    proxyPath: null,
    thumbPath: source.thumbPath,
    waveformPath: null,
    checksumSha256: hash ?? source.checksumSha256,
    role: 'PROXY',
    derivedFromAssetId: source.id,
    rights: normalizeRights(source.rights),
    immutableOriginal: true,
    generated: true,
    createdAt: new Date().toISOString(),
    provenance: {
      provider: 'hvs-kernel',
      model: null,
      prompt: null,
      parameters: { profile: PROXY_PROFILE.id, policyClass: HVS_PROXY_BASELINE_V1.policyClass, sourceAssetId: source.id },
      seed: null,
      referenceAssetIds: [],
      sourceAssetIds: [source.id],
      createdAt: new Date().toISOString(),
      commercialUse: 'restricted',
      parentAssetId: source.id,
      origin: 'derived',
      license: 'PROXY',
      projectId: loaded.project.id,
    },
  }
  const next: HvsProject = {
    ...loaded.project,
    assets: [...loaded.project.assets.filter(asset => asset.id !== proxyAsset.id), proxyAsset],
  }
  const saved = await saveProject(next)
  receipt.projectId = saved.id
  return ok(receipt, {
    result: {
      projectId: saved.id,
      sourceAssetId: source.id,
      proxyAssetId: proxyAsset.id,
      role: 'PROXY',
      master: false,
      path: dest,
      hash,
      policyClass: HVS_PROXY_BASELINE_V1.policyClass,
    },
    outputAssetRefs: [{ id: proxyAsset.id, role: 'PROXY', path: dest, hash }],
    hashes: { ...receipt.hashes, proxy: hash ?? '', source: source.checksumSha256 },
  })
}

async function makeMaster(receipt: HvsToolReceipt, input: Record<string, unknown>): Promise<HvsToolResult> {
  const loaded = await requireProject(str(input, 'projectId'))
  if ('error' in loaded) return fail(receipt, loaded.error)
  const commercial = input.commercial !== false
  if (commercial) {
    const rights = commercialOkForProject(loaded.project)
    if (!rights.ok) {
      receipt.authorityClass = 'REFUSED'
      return fail(receipt, `COMMERCIAL_EXPORT_REFUSED: ${rights.reason}`, {
        authorityClass: 'REFUSED',
        result: rights,
      })
    }
  }
  const v1 = loaded.project.timeline.tracks.find(track => track.id === 'V1')
  const clips = v1?.clips ?? []
  if (!clips.length) return fail(receipt, 'Timeline V1 has no clips to encode.')
  const sources: AssetRecord[] = []
  for (const clip of clips) {
    const asset = findAsset(loaded.project, clip.assetId)
    if (!asset) return fail(receipt, `Clip ${clip.id} references missing asset ${clip.assetId}.`)
    if (asset.role === 'PROXY') return fail(receipt, `Refusing MASTER encode from PROXY asset ${asset.id}.`)
    if (!existsSync(asset.originalPath)) return fail(receipt, `Original missing for ${asset.id}.`)
    sources.push(asset)
  }
  const tools = await resolveFfmpegTools()
  if (!tools.ffmpeg) return fail(receipt, 'HVS ffmpeg was not resolved.')
  const dirs = mediaCommandDataHierarchy()
  await mkdir(dirs.renders, { recursive: true })
  const dest = path.join(dirs.renders, `${loaded.project.id}-kernel-master.mp4`)
  const listFile = path.join(dirs.tmp, `${loaded.project.id}-concat.txt`)
  const list = sources.map(asset => `file '${asset.originalPath.replace(/'/g, "'\\''")}'`).join('\n')
  await writeFile(listFile, `${list}\n`, 'utf8')
  const args = [
    '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
    '-c:v', HVS_MASTER_BASELINE_V1.videoCodec,
    '-preset', HVS_MASTER_BASELINE_V1.videoPreset,
    '-crf', String(HVS_MASTER_BASELINE_V1.crf),
    '-pix_fmt', HVS_MASTER_BASELINE_V1.pixelFormat,
    '-c:a', HVS_MASTER_BASELINE_V1.audioCodec,
    '-ar', String(HVS_MASTER_BASELINE_V1.audioRate),
    '-b:a', HVS_MASTER_BASELINE_V1.audioBitrate,
    '-movflags', '+faststart',
    dest,
  ]
  const encoded = await runProcess(tools.ffmpeg, args, 600_000)
  if (!encoded.ok || !existsSync(dest)) return fail(receipt, encoded.stderr.slice(-800) || 'Master encode failed.')
  const hash = await sha256File(dest)
  const masterAsset: AssetRecord = {
    ...sources[0],
    id: `master-${loaded.project.id}`,
    name: `${loaded.project.name} master`,
    originalPath: dest,
    proxyPath: null,
    checksumSha256: hash ?? '',
    role: 'MASTER',
    derivedFromAssetId: sources[0].id,
    createdAt: new Date().toISOString(),
    generated: true,
    provenance: {
      provider: 'hvs-kernel',
      model: null,
      prompt: null,
      parameters: {
        baseline: HVS_MASTER_BASELINE_V1.id,
        policyClass: HVS_MASTER_BASELINE_V1.policyClass,
        sourceProjectId: loaded.project.id,
        sourceVersionId: loaded.project.currentVersionId,
      },
      seed: null,
      referenceAssetIds: [],
      sourceAssetIds: sources.map(asset => asset.id),
      createdAt: new Date().toISOString(),
      commercialUse: commercial ? 'allowed' : 'restricted',
      parentAssetId: sources[0].id,
      origin: 'render',
      license: HVS_MASTER_BASELINE_V1.id,
      projectId: loaded.project.id,
    },
  }
  const saved = await saveProject({
    ...loaded.project,
    assets: [...loaded.project.assets.filter(asset => asset.id !== masterAsset.id), masterAsset],
  })
  receipt.projectId = saved.id
  return ok(receipt, {
    result: {
      projectId: saved.id,
      versionId: saved.currentVersionId,
      policyClass: HVS_MASTER_BASELINE_V1.policyClass,
      baseline: HVS_MASTER_BASELINE_V1.id,
      path: dest,
      codec: HVS_MASTER_BASELINE_V1.videoCodec,
      container: HVS_MASTER_BASELINE_V1.container,
      hash,
      exitStatus: 0,
      commercial,
      masterAssetId: masterAsset.id,
    },
    outputAssetRefs: [{ id: masterAsset.id, role: 'MASTER', path: dest, hash }],
    hashes: { ...receipt.hashes, master: hash ?? '' },
  })
}

export { listReceipts }
