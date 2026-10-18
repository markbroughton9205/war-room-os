/**
 * Media ingest: original remains immutable.
 * original → checksum → probe → metadata → thumbnail → waveform → proxy → AssetRecord
 */
import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { mediaCommandDataHierarchy } from './paths'
import { durationAsMediaTime, probeMediaFile } from './probe'
import type { AssetKind, AssetProvenance, AssetRecord, HvsProject } from './types'
import { saveProject } from './store'
import { resolveFfmpegTools, runProcess } from './ffmpeg'

export const PROXY_PROFILE = {
  id: 'hvs-proxy-v1',
  maxWidth: 1280,
  videoCodec: 'libx264',
  audioCodec: 'aac',
  fps: 24,
} as const

function extOf(name: string): string {
  const ext = path.extname(name).toLowerCase()
  return ext || '.bin'
}

function kindFromMime(mime: string, name: string): AssetKind {
  if (mime.startsWith('video/') || /\.(mp4|mov|mkv|webm|m4v)$/i.test(name)) return 'video'
  if (mime.startsWith('audio/') || /\.(wav|mp3|aac|m4a|flac)$/i.test(name)) return 'audio'
  if (/logo/i.test(name)) return 'logo'
  if (mime.startsWith('image/') || /\.(png|jpe?g|webp|gif|svg)$/i.test(name)) return 'image'
  return 'graphic'
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(filePath), hash)
  return hash.digest('hex')
}

export async function ingestFile(input: {
  project: HvsProject
  sourcePath: string
  originalName: string
  mimeType?: string
  generated?: boolean
  provenance?: Partial<AssetProvenance>
  rights?: AssetRecord['rights']
  role?: AssetRecord['role']
}): Promise<{ project: HvsProject; asset: AssetRecord; warnings: string[] }> {
  const dirs = mediaCommandDataHierarchy()
  const warnings: string[] = []
  const assetId = `asset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const ext = extOf(input.originalName)
  await mkdir(dirs.originals, { recursive: true })
  const originalPath = path.join(dirs.originals, `${assetId}${ext}`)
  await copyFile(input.sourcePath, originalPath)
  if (!existsSync(originalPath)) {
    throw new Error('Ingest failed: original was not stored.')
  }
  const checksumSha256 = await sha256File(originalPath)
  const probed = await probeMediaFile(originalPath)
  const tools = await resolveFfmpegTools()
  const kind = kindFromMime(input.mimeType ?? probed.mime, input.originalName)

  let thumbPath: string | null = null
  let waveformPath: string | null = null
  let proxyPath: string | null = null

  if (tools.ffmpeg && kind === 'video') {
    await mkdir(dirs.thumbs, { recursive: true })
    thumbPath = path.join(dirs.thumbs, `${assetId}.jpg`)
    const seek = probed.durationSec > 2 ? String(Math.min(probed.durationSec * 0.12, 4)) : '0'
    const thumb = await runProcess(tools.ffmpeg, [
      '-y', '-ss', seek, '-i', originalPath, '-frames:v', '1', '-q:v', '3', thumbPath,
    ], 60_000)
    if (!thumb.ok || !existsSync(thumbPath)) {
      warnings.push('Thumbnail generation failed; preview still uses proxy/original.')
      thumbPath = null
    }

    await mkdir(dirs.proxies, { recursive: true })
    proxyPath = path.join(dirs.proxies, `${assetId}.mp4`)
    const proxyArgs = [
      '-y', '-i', originalPath,
      '-vf', `scale=${PROXY_PROFILE.maxWidth}:-2:flags=fast_bilinear,fps=${PROXY_PROFILE.fps}`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      ...(probed.hasAudio ? ['-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '128k'] : ['-an']),
      '-movflags', '+faststart',
      proxyPath,
    ]
    const proxy = await runProcess(tools.ffmpeg, proxyArgs, 600_000)
    if (!proxy.ok || !existsSync(proxyPath)) {
      warnings.push('Proxy generation failed. Original remains immutable; preview may use the original.')
      proxyPath = null
    }
  } else if (kind === 'image' || kind === 'logo' || kind === 'graphic') {
    if (tools.ffmpeg && ext === '.svg') {
      const png = path.join(dirs.thumbs, `${assetId}.png`)
      await mkdir(dirs.thumbs, { recursive: true })
      const conv = await runProcess(tools.ffmpeg, ['-y', '-i', originalPath, png], 30_000)
      thumbPath = conv.ok && existsSync(png) ? png : originalPath
    } else {
      thumbPath = originalPath
    }
  }

  if (tools.ffmpeg && (kind === 'audio' || kind === 'video') && probed.hasAudio) {
    await mkdir(dirs.waveforms, { recursive: true })
    await mkdir(dirs.tmp, { recursive: true })
    waveformPath = path.join(dirs.waveforms, `${assetId}.json`)
    const wavTmp = path.join(dirs.tmp, `${assetId}.peak.raw`)
    const peak = await runProcess(tools.ffmpeg, [
      '-y', '-i', originalPath, '-ac', '1', '-ar', '8000', '-f', 's8', wavTmp,
    ], 120_000)
    if (peak.ok && existsSync(wavTmp)) {
      const raw = await readFile(wavTmp)
      const samples: number[] = []
      const buckets = 400
      const step = Math.max(1, Math.floor(raw.length / buckets))
      for (let i = 0; i < raw.length; i += step) {
        samples.push(Math.abs(raw.readInt8(i)) / 128)
      }
      await writeFile(waveformPath, JSON.stringify({ samples, sampleRate: 8000, profile: 'hvs-edit-waveform-v1' }), 'utf8')
    } else {
      waveformPath = null
      warnings.push('Waveform extraction skipped.')
    }
  }

  if (!tools.ffmpeg) {
    warnings.push('HVS bundled ffmpeg was not resolved. Original stored immutably; proxy/thumb/waveform wait for the media-command toolchain.')
  }

  const asset: AssetRecord = {
    id: assetId,
    kind,
    name: input.originalName,
    originalPath,
    proxyPath,
    thumbPath,
    waveformPath,
    checksumSha256,
    mimeType: input.mimeType || probed.mime,
    duration: durationAsMediaTime(probed.durationSec),
    width: probed.width,
    height: probed.height,
    frameRate: probed.frameRateN && probed.frameRateD ? { n: probed.frameRateN, d: probed.frameRateD } : null,
    variableFrameRate: probed.variableFrameRate,
    sampleRate: probed.sampleRate,
    channels: probed.channels,
    codec: probed.codec,
    container: probed.container,
    pixelFormat: probed.pixelFormat,
    rotation: probed.rotation,
    audioStreams: probed.audioStreams,
    immutableOriginal: true,
    generated: Boolean(input.generated),
    provenance: input.generated || input.provenance
      ? {
          provider: input.provenance?.provider ?? null,
          model: input.provenance?.model ?? null,
          prompt: input.provenance?.prompt ?? null,
          promptHash: input.provenance?.promptHash ?? null,
          parameters: input.provenance?.parameters ?? {},
          seed: input.provenance?.seed ?? null,
          referenceAssetIds: input.provenance?.referenceAssetIds ?? [],
          sourceAssetIds: input.provenance?.sourceAssetIds ?? input.provenance?.parentAssetIds ?? [],
          createdAt: input.provenance?.createdAt ?? new Date().toISOString(),
          commercialUse: input.provenance?.commercialUse ?? 'unknown',
          parentAssetId: input.provenance?.parentAssetId ?? input.provenance?.parentAssetIds?.[0] ?? null,
          parentAssetIds: input.provenance?.parentAssetIds ?? [],
          providerJobId: input.provenance?.providerJobId ?? null,
          origin: input.provenance?.origin ?? (input.generated ? 'generated' : 'derived'),
          license: input.provenance?.license ?? null,
          externalTransfer: input.provenance?.externalTransfer ?? null,
          projectId: input.project.id,
        }
      : null,
    createdAt: new Date().toISOString(),
    outputOfRenderJobId: null,
    role: input.role ?? 'ORIGINAL',
    derivedFromAssetId: null,
    rights: input.rights ?? {
      state: 'UNKNOWN',
      commercialOk: false,
      source: null,
      notes: 'Required rights metadata absent at ingest.',
    },
  }

  const projectWithAsset: HvsProject = {
    ...input.project,
    assets: [...input.project.assets, asset],
    updatedAt: new Date().toISOString(),
  }
  let project = projectWithAsset
  if (/\.svg$/i.test(ext) || kind === 'logo' || kind === 'graphic' || kind === 'image') {
    const { ensureRenderSafeGraphic } = await import('./graphics')
    const normalized = await ensureRenderSafeGraphic(project, asset)
    project = normalized.project
    warnings.push(...normalized.warnings)
  }
  await saveProject(project)
  return { project, asset: project.assets.find(a => a.id === asset.id) ?? asset, warnings }
}
