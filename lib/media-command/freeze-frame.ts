/**
 * Derived freeze-frame stills. Original media stays immutable.
 */
import path from 'node:path'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { mediaCommandDataHierarchy } from './paths'
import { resolveFfmpegTools, runProcess } from './ffmpeg'
import { toSeconds, type MediaTime } from './time'
import type { AssetRecord, HvsProject } from './types'
import { findAsset, findClip } from './types'

export async function extractFreezeStill(
  project: HvsProject,
  input: { clipId?: string; assetId?: string; at: MediaTime },
): Promise<{ assetId: string; warnings: string[]; still: AssetRecord | null }> {
  const warnings: string[] = []
  const parentId = input.assetId ?? (input.clipId ? findClip(project, input.clipId)?.clip.assetId : null)
  if (!parentId) {
    warnings.push('Freeze still: no source asset.')
    return { assetId: '', warnings, still: null }
  }
  const parent = findAsset(project, parentId)
  if (!parent) {
    warnings.push('Freeze still: source asset missing.')
    return { assetId: '', warnings, still: null }
  }
  const tools = await resolveFfmpegTools()
  if (!tools.ffmpeg) {
    warnings.push('Bundled ffmpeg missing; freeze clip will hold the source timestamp without a derived still.')
    return { assetId: '', warnings, still: null }
  }
  const dirs = mediaCommandDataHierarchy()
  await mkdir(dirs.originals, { recursive: true })
  const stillId = `asset-freeze-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const originalPath = path.join(dirs.originals, `${stillId}.jpg`)
  const seek = Math.max(0, toSeconds(input.at))
  const extracted = await runProcess(tools.ffmpeg, [
    '-y', '-ss', String(seek), '-i', parent.originalPath, '-frames:v', '1', '-q:v', '2', originalPath,
  ], 30_000)
  if (!extracted.ok || !existsSync(originalPath)) {
    warnings.push(extracted.stderr.slice(-400) || 'Freeze still extract failed.')
    return { assetId: '', warnings, still: null }
  }
  const still: AssetRecord = {
    id: stillId,
    kind: 'image',
    name: `${parent.name} — freeze ${seek.toFixed(3)}s`,
    originalPath,
    proxyPath: null,
    thumbPath: originalPath,
    waveformPath: null,
    checksumSha256: `freeze:${parent.id}:${input.at.ticks}`,
    mimeType: 'image/jpeg',
    duration: { ticks: 0, timescale: project.timeline.timescale },
    width: parent.width,
    height: parent.height,
    frameRate: { n: 1, d: 1 },
    variableFrameRate: false,
    sampleRate: null,
    channels: null,
    codec: 'mjpeg',
    container: 'image2',
    pixelFormat: parent.pixelFormat,
    rotation: parent.rotation,
    audioStreams: [],
    immutableOriginal: true,
    generated: true,
    provenance: {
      provider: 'hvs-freeze-frame',
      model: 'ffmpeg-frame',
      prompt: null,
      parameters: { sourceTicks: input.at.ticks, sourceTimescale: input.at.timescale, seekSec: seek },
      seed: null,
      referenceAssetIds: [],
      sourceAssetIds: [parent.id],
      createdAt: new Date().toISOString(),
      commercialUse: 'unknown',
      parentAssetId: parent.id,
      projectId: project.id,
    },
    createdAt: new Date().toISOString(),
  }
  project.assets.push(still)
  return { assetId: still.id, warnings, still }
}
