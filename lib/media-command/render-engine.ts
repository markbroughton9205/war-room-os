/**
 * RenderEngine is separate from PreviewEngine.
 * Preview = interactive HTML5 timeline playback (proxy OK).
 * Render = durable FFmpeg jobs from original media. Success requires a real probed file.
 */
import path from 'node:path'
import { copyFileSync, existsSync, writeFileSync, unlinkSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { mediaCommandDataHierarchy } from './paths'
import type { HvsProject, OverlaySpec, RenderJob, RenderLaneProvenance, TrackSubject, VirtualCamera } from './types'
import { findAsset, timelineDuration } from './types'
import { saveProject, loadProject } from './store'
import { chooseEncoder, resolveFfmpegTools, runProcess, videoEncodeArgs } from './ffmpeg'
import { probeMediaFile } from './probe'
import { toSeconds, type Rational } from './time'
import type { Clip } from './types'
import { getThemeSpec } from './themes'
import { followFramingCrop, interpolateSubject, sourcePixelRatio } from './tracking'
import { writeAssFile, escapeAssPath } from './ass'
import { ffmpegPanFilter } from './pan'
import { dissolveWindowFor } from './transitions'
import { clipLooksToFfmpeg, themeLooksToFfmpeg } from './look-lowering'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parseFontList } from './fonts'
import { cacheDir, writeCacheMeta } from './cache'
import {
  effectGraphBindsToAsset,
  isAudioGraphActive,
  isColorPipelineActive,
  isPassthroughEffectGraph,
} from './unified-render-plan'
import { compileUnifiedRenderPlan } from './unified-render-plan.server'
import { lowerAudioGraphAfterClips, lowerColorPipelineOntoLabel, lowerEffectGraphOntoLabel } from './render-lowering'

const execFileAsync = promisify(execFile)

/** Canonical timeline fps as an FFmpeg rate string. Never hardcode 24 in xfade. */
export function ffmpegFpsExpr(rate?: Rational | null): string {
  const n = rate && rate.n > 0 ? Math.round(rate.n) : 24
  const d = rate && rate.d > 0 ? Math.round(rate.d) : 1
  return d === 1 ? String(n) : `${n}/${d}`
}

/**
 * Force CFR immediately before xfade.
 * setpts/trim leave r_frame_rate=1/0; settb after fps can restore 1/0.
 * fps must be last.
 */
export function xfadePrepareChain(rate?: Rational | null): string {
  return `format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS,fps=${ffmpegFpsExpr(rate)}`
}

function renderCancelFlag(projectId: string, jobId: string): string {
  return path.join(mediaCommandDataHierarchy().tmp, `render-cancel-${projectId}-${jobId}.flag`)
}

export function requestRenderCancel(project: HvsProject, jobId: string): HvsProject {
  const job = project.renderJobs.find(j => j.id === jobId)
  if (!job) return project
  job.cancelRequested = true
  job.updatedAt = new Date().toISOString()
  writeFileSync(renderCancelFlag(project.id, jobId), '1', 'utf8')
  if (job.status === 'queued' || job.status === 'blocked') {
    job.status = 'cancelled'
    job.completedAt = new Date().toISOString()
    job.error = 'Cancelled before encode. Project, originals, and prior renders kept.'
  }
  return project
}

function cachePathFor(key: string): string {
  return path.join(cacheDir('render'), `${key}.mp4`)
}

function emptyProvenance(plan: {
  effectGraphIds: string[]
  colorPipelineNodeIds: string[]
  audioGraphChannelIds: string[]
  audioGraphBusIds: string[]
  structuralHash: string
  cacheKey: string
  compileMs: number
  vfxActive: boolean
  colorActive: boolean
  audioActive: boolean
}, cacheHit: boolean): RenderLaneProvenance {
  return {
    backend: 'ffmpeg-unified',
    effectGraphIds: plan.effectGraphIds,
    colorPipelineNodeIds: plan.colorPipelineNodeIds,
    audioGraphChannelIds: plan.audioGraphChannelIds,
    audioGraphBusIds: plan.audioGraphBusIds,
    structuralHash: plan.structuralHash,
    cacheKey: plan.cacheKey,
    cacheHit,
    planCompileMs: plan.compileMs,
    vfxActive: plan.vfxActive,
    colorActive: plan.colorActive,
    audioActive: plan.audioActive,
  }
}

async function listSystemFonts(): Promise<string[]> {
  try {
    const result = await execFileAsync('fc-list', [':', 'family'], { timeout: 4000 })
    return parseFontList(result.stdout || '')
  } catch {
    return []
  }
}

function cropAtTime(project: HvsProject, aspect: RenderJob['target']['aspect'], seconds: number) {
  const cam = project.timeline.virtualCameras.find(c => c.outputAspect === aspect)
  if (!cam) return null
  const subject = project.timeline.subjects.find(s => s.id === cam.subjectId) ?? project.timeline.subjects[0] ?? null
  if (subject) {
    const box = interpolateSubject(subject, Math.round(seconds * project.timeline.timescale), project.timeline.timescale)
    if (box) {
      const clip = project.timeline.tracks.flatMap(t => t.clips).find(c => c.id === subject.clipId)
      const asset = clip ? findAsset(project, clip.assetId) : findAsset(project, subject.assetId)
      return followFramingCrop(box, cam.mode, aspect, sourcePixelRatio(asset?.width, asset?.height))
    }
  }
  if (!cam.keyframes.length) return null
  const ticks = Math.round(seconds * cam.keyframes[0].time.timescale)
  let prev = cam.keyframes[0]
  for (const kf of cam.keyframes) {
    if (kf.time.ticks >= ticks) {
      const span = kf.time.ticks - prev.time.ticks || 1
      const u = Math.max(0, Math.min(1, (ticks - prev.time.ticks) / span))
      return {
        left: prev.crop.left + (kf.crop.left - prev.crop.left) * u,
        top: prev.crop.top + (kf.crop.top - prev.crop.top) * u,
        right: prev.crop.right + (kf.crop.right - prev.crop.right) * u,
        bottom: prev.crop.bottom + (kf.crop.bottom - prev.crop.bottom) * u,
      }
    }
    prev = kf
  }
  return cam.keyframes[cam.keyframes.length - 1].crop
}

function sourcePath(project: HvsProject, assetId: string): string | null {
  const asset = findAsset(project, assetId)
  if (!asset) return null
  if (existsSync(asset.originalPath)) return asset.originalPath
  if (asset.proxyPath && existsSync(asset.proxyPath)) return asset.proxyPath
  return null
}

async function rasterizeOverlay(ffmpeg: string, overlay: OverlaySpec, project: HvsProject, dest: string): Promise<string | null> {
  if (overlay.kind === 'title' && !overlay.assetId) return null
  if (!overlay.assetId) return null
  const { derivedRasterFor, ensureRenderSafeGraphic, isRenderSafeRaster } = await import('./graphics')
  const source = findAsset(project, overlay.assetId)
  if (!source) return null
  const derived = derivedRasterFor(project, source.id)
  const asset = derived ?? source
  if (isRenderSafeRaster(asset.originalPath)) return asset.originalPath
  if (isRenderSafeRaster(asset.thumbPath)) return asset.thumbPath as string
  const normalized = await ensureRenderSafeGraphic(project, source)
  if (isRenderSafeRaster(normalized.raster.originalPath)) return normalized.raster.originalPath
  const src = asset.thumbPath && existsSync(asset.thumbPath) && !asset.thumbPath.endsWith('.svg')
    ? asset.thumbPath
    : asset.originalPath
  if (!existsSync(src)) return null
  if (/\.(png|jpe?g|webp)$/i.test(src)) return src
  const conv = await runProcess(ffmpeg, ['-y', '-i', src, dest], 30_000)
  return conv.ok && existsSync(dest) ? dest : null
}

export async function processRenderQueue(projectId: string): Promise<HvsProject | null> {
  const project = await loadProject(projectId)
  if (!project) return null
  const tools = await resolveFfmpegTools()
  const dirs = mediaCommandDataHierarchy()
  await mkdir(dirs.renders, { recursive: true })
  await mkdir(dirs.originals, { recursive: true })
  let current = project
  for (const job of current.renderJobs) {
    if (job.status !== 'queued') continue
    if (job.cancelRequested) {
      job.status = 'cancelled'
      job.updatedAt = new Date().toISOString()
      job.completedAt = job.updatedAt
      job.error = 'Cancelled before encode. Project, originals, and prior renders kept.'
      current = await saveProject(current)
      continue
    }
    const compiled = compileUnifiedRenderPlan(current, job)
    job.status = 'running'
    job.updatedAt = new Date().toISOString()
    job.startedAt = job.updatedAt
    job.outputAssetId = null
    job.encoder = null
    job.probe = null
    job.laneProvenance = compiled.plan ? emptyProvenance(compiled.plan, false) : null
    current = await saveProject(current)
    if (!compiled.ok || !compiled.plan) {
      job.status = 'failed'
      job.error = compiled.error ?? 'Unified render plan failed.'
      job.blockedReason = null
      job.completedAt = new Date().toISOString()
      job.updatedAt = job.completedAt
      current = await saveProject(current)
      continue
    }
    if (!tools.ffmpeg || !tools.ffprobe) {
      job.status = 'blocked'
      job.blockedReason = 'HVS bundled ffmpeg/ffprobe was not resolved (media-command/tools). Optional override: HVS_FFMPEG_PATH / HVS_FFPROBE_PATH. Do not treat this as a successful render.'
      job.error = job.blockedReason
      job.updatedAt = new Date().toISOString()
      job.completedAt = job.updatedAt
      current = await saveProject(current)
      continue
    }
    const cachedFile = cachePathFor(compiled.plan.cacheKey)
    let outputPath = path.join(dirs.renders, `${current.id}-${job.id}-${job.target.aspect.replace(':', 'x')}.mp4`)
    let encoder: 'h264_nvenc' | 'libx264' = 'libx264'
    let cacheHit = false
    if (existsSync(cachedFile)) {
      try {
        copyFileSync(cachedFile, outputPath)
        cacheHit = existsSync(outputPath)
      } catch {
        cacheHit = false
      }
    }
    if (!cacheHit) {
      const rendered = await renderTimeline(current, job, tools.ffmpeg, compiled.plan.cacheKey)
      job.updatedAt = new Date().toISOString()
      encoder = rendered.encoder
      if (rendered.cancelled || job.cancelRequested || existsSync(renderCancelFlag(current.id, job.id))) {
        job.status = 'cancelled'
        job.error = 'Cancelled during encode. Project, originals, and prior renders kept.'
        job.outputPath = job.outputPath
        job.completedAt = new Date().toISOString()
        job.laneProvenance = emptyProvenance(compiled.plan, false)
        current = await saveProject(current)
        try { unlinkSync(renderCancelFlag(current.id, job.id)) } catch { /* flag */ }
        continue
      }
      if (!rendered.ok) {
        job.status = rendered.blocked ? 'blocked' : 'failed'
        job.error = rendered.error
        job.blockedReason = rendered.blocked ? rendered.error : null
        job.outputPath = null
        job.completedAt = new Date().toISOString()
        job.laneProvenance = emptyProvenance(compiled.plan, false)
        current = await saveProject(current)
        continue
      }
      outputPath = rendered.outputPath
      try {
        copyFileSync(outputPath, cachedFile)
        writeCacheMeta({
          key: compiled.plan.cacheKey,
          category: 'render',
          createdAt: new Date().toISOString(),
          size: 0,
          sourceFingerprint: compiled.plan.structuralHash,
          backend: 'ffmpeg-unified',
          hit: false,
          miss: true,
          path: cachedFile,
        })
      } catch {
        /* cache is acceleration, never required */
      }
    } else {
      encoder = (await chooseEncoder()).videoCodec
    }
    const probed = await probeMediaFile(outputPath)
    const dimOk = probed.width === job.target.width && probed.height === job.target.height
    const durOk = probed.durationSec > 0.05 && probed.hasVideo
    const audioExpected = current.timeline.tracks.some(t => t.kind === 'audio' && t.clips.length > 0)
      || current.assets.some(a => a.kind === 'video' && a.audioStreams.length > 0)
    const audioOk = !audioExpected || probed.hasAudio
    if (!existsSync(outputPath) || !dimOk || !durOk || !audioOk) {
      job.status = 'failed'
      job.error = `ffprobe rejected output (video=${probed.hasVideo} audio=${probed.hasAudio} ${probed.width}x${probed.height} ${probed.durationSec}s).`
      job.outputPath = null
      job.completedAt = new Date().toISOString()
      job.probe = {
        width: probed.width,
        height: probed.height,
        durationSec: probed.durationSec,
        hasVideo: probed.hasVideo,
        hasAudio: probed.hasAudio,
      }
      job.laneProvenance = emptyProvenance(compiled.plan, cacheHit)
      current = await saveProject(current)
      continue
    }
    const assetId = `asset-render-${job.id}`
    const originalPath = path.join(dirs.originals, `${assetId}.mp4`)
    const copy = await runProcess(tools.ffmpeg, ['-y', '-i', outputPath, '-c', 'copy', originalPath], 60_000)
    const stored = copy.ok && existsSync(originalPath) ? originalPath : outputPath
    current.assets.push({
      id: assetId,
      kind: 'video',
      name: `${current.name} — ${job.target.aspect} render`,
      originalPath: stored,
      proxyPath: null,
      thumbPath: null,
      waveformPath: null,
      checksumSha256: `render:${job.id}`,
      mimeType: 'video/mp4',
      duration: { ticks: Math.round(probed.durationSec * current.timeline.timescale), timescale: current.timeline.timescale },
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
      generated: true,
      provenance: {
        provider: 'hvs-render-engine',
        model: encoder,
        prompt: null,
        parameters: {
          aspect: job.target.aspect,
          themeId: current.timeline.themeId,
          versionId: job.versionId,
          effectGraphIds: compiled.plan.effectGraphIds,
          colorPipelineNodeIds: compiled.plan.colorPipelineNodeIds,
          audioGraphChannelIds: compiled.plan.audioGraphChannelIds,
          cacheHit,
        },
        seed: null,
        referenceAssetIds: [],
        sourceAssetIds: current.timeline.tracks.flatMap(t => t.clips.map(c => c.assetId)),
        createdAt: new Date().toISOString(),
        commercialUse: 'unknown',
        parentAssetId: null,
        projectId: current.id,
      },
      createdAt: new Date().toISOString(),
      outputOfRenderJobId: job.id,
    })
    job.status = 'completed'
    job.outputPath = stored
    job.outputAssetId = assetId
    job.encoder = encoder
    job.error = null
    job.blockedReason = null
    job.completedAt = new Date().toISOString()
    job.laneProvenance = emptyProvenance(compiled.plan, cacheHit)
    job.probe = {
      width: probed.width,
      height: probed.height,
      durationSec: probed.durationSec,
      hasVideo: probed.hasVideo,
      hasAudio: probed.hasAudio,
    }
    current = await saveProject(current)
    try { unlinkSync(renderCancelFlag(current.id, job.id)) } catch { /* flag */ }
  }
  return current
}

async function renderTimeline(project: HvsProject, job: RenderJob, ffmpeg: string, cacheKey?: string): Promise<{
  ok: boolean
  blocked?: boolean
  cancelled?: boolean
  error: string
  outputPath: string
  encoder: 'h264_nvenc' | 'libx264'
}> {
  const encoder = await chooseEncoder()
  const dirs = mediaCommandDataHierarchy()
  const outputPath = path.join(dirs.renders, `${project.id}-${job.id}-${job.target.aspect.replace(':', 'x')}.mp4`)
  const videoClips = project.timeline.tracks
    .filter(t => (t.kind === 'video' || t.kind === 'graphics') && !t.muted)
    .sort((a, b) => a.index - b.index)
    .flatMap(t => [...t.clips].filter(c => c.enabled).sort((a, b) => a.start.ticks - b.start.ticks))
  if (!videoClips.length) {
    return { ok: false, error: 'No video clip on the timeline to render.', outputPath, encoder: encoder.videoCodec }
  }

  const inputs: string[] = []
  const inputIndex = new Map<string, number>()
  function addInput(file: string): number {
    const existing = inputIndex.get(file)
    if (existing != null) return existing
    const idx = inputs.length
    inputIndex.set(file, idx)
    inputs.push(file)
    return idx
  }

  for (const clip of videoClips) {
    const src = sourcePath(project, clip.assetId)
    if (!src) return { ok: false, error: `Missing original media for ${clip.name}.`, outputPath, encoder: encoder.videoCodec }
    addInput(src)
  }

  const W = job.target.width
  const H = job.target.height
  const duration = Math.max(0.2, toSeconds(timelineDuration(project.timeline)))
  const theme = getThemeSpec(project.timeline.themeId)
  const crop0 = cropAtTime(project, job.target.aspect, 0)
  const crop1 = cropAtTime(project, job.target.aspect, duration)

  const filters: string[] = []
  const timelineFps = project.timeline.frameRate
  filters.push(`color=c=0x080604:s=${W}x${H}:d=${duration}:r=${ffmpegFpsExpr(timelineFps)}[base]`)
  let last = 'base'
  let seq = 0
  const nextLabel = (prefix: string) => `${prefix}${seq++}`

  function clipLookAndGeometry(clip: Clip) {
    const asset = findAsset(project, clip.assetId)
    const srcW = asset?.width ?? 1920
    const srcH = asset?.height ?? 1080
    const look: string[] = []
    const clipLooks = clipLooksToFfmpeg(clip.color, clip.filters)
    if (clipLooks.length) look.push(...clipLooks)
    else if (theme) look.push(...themeLooksToFfmpeg(theme))
    let geometry: string
    if (crop0 && job.target.aspect === '9:16') {
      const w0 = Math.max(2, Math.round((1 - crop0.left - crop0.right) * srcW / 2) * 2)
      const h0 = Math.max(2, Math.round((1 - crop0.top - crop0.bottom) * srcH / 2) * 2)
      const x0 = Math.round(crop0.left * srcW)
      const y0 = Math.round(crop0.top * srcH)
      const x1 = crop1 ? Math.round(crop1.left * srcW) : x0
      const y1 = crop1 ? Math.round(crop1.top * srcH) : y0
      const dx = x1 - x0
      const dy = y1 - y0
      geometry = `crop=${w0}:${h0}:${x0}+${dx}*t/${Math.max(0.01, duration)}:${y0}+${dy}*t/${Math.max(0.01, duration)},scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`
    } else {
      geometry = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x080604`
    }
    return { asset, geometry, look }
  }

  const tracksToDraw = project.timeline.tracks
    .filter(t => (t.kind === 'video' || t.kind === 'graphics') && !t.muted)
    .sort((a, b) => a.index - b.index)

  for (const track of tracksToDraw) {
    const clips = [...track.clips].filter(c => c.enabled).sort((a, b) => a.start.ticks - b.start.ticks)
    if (!clips.length) continue
    const prepared: { clip: Clip; label: string; start: number; dur: number }[] = []
    for (const clip of clips) {
      const src = sourcePath(project, clip.assetId)!
      const idx = addInput(src)
      const { asset, geometry, look } = clipLookAndGeometry(clip)
      const start = toSeconds(clip.start)
      const timelineDur = Math.max(1 / 24000, toSeconds(clip.duration))
      const graph = project.effectGraphs.find(g => !isPassthroughEffectGraph(g) && effectGraphBindsToAsset(g, clip.assetId))
      if (graph) {
        const lookLabel = nextLabel('vlook')
        filters.push(`[${idx}:v]${clipVideoFilter(clip, asset, { geometry, look, fps: timelineFps, through: 'look' })}[${lookLabel}]`)
        const lowered = lowerEffectGraphOntoLabel({
          graph,
          project,
          clip,
          sourceLabel: lookLabel,
          width: W,
          height: H,
          nextLabel,
          addInput,
        })
        if (!lowered.ok) {
          return { ok: false, error: lowered.error, outputPath, encoder: encoder.videoCodec }
        }
        filters.push(...lowered.chains)
        const present = nextLabel('v')
        filters.push(`[${lowered.outputLabel}]${clipVideoPresentation(clip, { fps: timelineFps })}[${present}]`)
        prepared.push({ clip, label: present, start, dur: timelineDur })
      } else {
        const label = nextLabel('v')
        filters.push(`[${idx}:v]${clipVideoFilter(clip, asset, { geometry, look, fps: timelineFps })}[${label}]`)
        prepared.push({ clip, label, start, dur: timelineDur })
      }
    }
    let acc: string | null = null
    for (let i = 0; i < prepared.length; i++) {
      const row = prepared[i]
      const incomingTr = track.transitions.find(t => t.incomingClipId === row.clip.id)
      const win = incomingTr ? dissolveWindowFor(track, incomingTr) : null
      const dissolveFromPrev = Boolean(
        win
        && i > 0
        && win.outgoing.id === prepared[i - 1].clip.id
        && win.durationSec > 0,
      )
      if (!acc) {
        if (row.start > 0.001) {
          const pad = nextLabel('tp')
          filters.push(`[${row.label}]tpad=start_duration=${row.start.toFixed(4)}:stop_duration=0[${pad}]`)
          acc = pad
        } else {
          acc = row.label
        }
      } else if (dissolveFromPrev && win) {
        const accf = nextLabel('accf')
        const inf = nextLabel('inf')
        const xf = nextLabel('xf')
        filters.push(`[${acc}]${xfadePrepareChain(timelineFps)}[${accf}]`)
        filters.push(`[${row.label}]${xfadePrepareChain(timelineFps)}[${inf}]`)
        filters.push(`[${accf}][${inf}]xfade=transition=fade:duration=${win.durationSec.toFixed(4)}:offset=${win.startSec.toFixed(4)}[${xf}]`)
        acc = xf
      } else {
        const abs = nextLabel('ab')
        const ov = nextLabel('ov')
        const delay = row.start > 0.001 ? `,setpts=PTS+${row.start.toFixed(4)}/TB` : ''
        filters.push(`[${row.label}]format=yuv420p${delay}[${abs}]`)
        filters.push(`[${acc}][${abs}]overlay=0:0:eof_action=pass:format=auto:enable='between(t,${row.start.toFixed(4)},${(row.start + row.dur).toFixed(4)})'[${ov}]`)
        acc = ov
      }
    }
    const trackOut = nextLabel('tr')
    filters.push(`[${last}][${acc}]overlay=0:0:eof_action=pass:format=auto[${trackOut}]`)
    last = trackOut
  }

  if (isColorPipelineActive(project.colorPipeline)) {
    const lowered = lowerColorPipelineOntoLabel({
      pipeline: project.colorPipeline,
      sourceLabel: last,
      nextLabel,
    })
    filters.push(...lowered.chains)
    last = lowered.outputLabel
  }

  const overlayPngs: Array<{ overlay: OverlaySpec; file: string; idx: number }> = []
  for (const overlay of project.timeline.overlays) {
    const png = path.join(dirs.tmp, `ov-${overlay.id}.png`)
    const file = await rasterizeOverlay(ffmpeg, overlay, project, png)
    if (!file) continue
    const idx = addInput(file)
    overlayPngs.push({ overlay, file, idx })
  }

  overlayPngs.forEach((item, i) => {
    const o = item.overlay
    const start = toSeconds(o.start)
    const end = start + toSeconds(o.duration)
    const ow = Math.max(16, Math.round(W * o.scale))
    const x = Math.round(o.x * W - ow / 2)
    const y = Math.round(o.y * H - ow / 6)
    const label = `ov${i}`
    const next = `sov${i}`
    filters.push(`[${item.idx}:v]format=rgba,scale=${ow}:-1,colorchannelmixer=aa=${o.opacity}[${label}]`)
    filters.push(`[${last}][${label}]overlay=${x}:${y}:enable='between(t,${start},${end})'[${next}]`)
    last = next
  })

  const fonts = await listSystemFonts()
  const assPath = path.join(dirs.tmp, `${job.id}-captions.ass`)
  const assInfo = await writeAssFile(assPath, project, fonts)
  if (assInfo.eventCount > 0) {
    filters.push(`[${last}]ass='${escapeAssPath(assPath)}'[vout]`)
    last = 'vout'
  } else if (last !== 'vout') {
    filters.push(`[${last}]format=yuv420p[vout]`)
    last = 'vout'
  }

  const audioClips = project.timeline.tracks
    .filter(t => (t.kind === 'audio' || t.kind === 'video') && !t.muted)
    .flatMap(t => t.clips.filter(c => c.enabled).map(c => ({ clip: c, kind: t.kind })))
  const audioLabels: string[] = []
  const audioSignals: Array<{ trackId: string; label: string }> = []
  audioClips.forEach((row, i) => {
    const src = sourcePath(project, row.clip.assetId)
    const asset = findAsset(project, row.clip.assetId)
    if (!src || !asset) return
    if (row.clip.freeze) return
    if (row.kind === 'video' && !asset.audioStreams.length && !asset.sampleRate) return
    const idx = addInput(src)
    const audio = clipAudioFilter(row.clip, idx, `[a${i}]`, {
      dissolve: (() => {
        const track = project.timeline.tracks.find(t => t.clips.some(c => c.id === row.clip.id))
        if (!track) return undefined
        for (const tr of track.transitions) {
          const win = dissolveWindowFor(track, tr)
          if (!win || tr.params.audioCrossfade === false) continue
          if (row.clip.id === win.outgoing.id) return { role: 'out' as const, localStart: win.startSec - toSeconds(row.clip.start), duration: win.durationSec }
          if (row.clip.id === win.incoming.id) return { role: 'in' as const, localStart: 0, duration: win.durationSec }
        }
        return undefined
      })(),
    })
    if (!audio) return
    filters.push(audio)
    audioLabels.push(`[a${i}]`)
    audioSignals.push({ trackId: project.timeline.tracks.find(t => t.clips.some(c => c.id === row.clip.id))?.id ?? '', label: `a${i}` })
  })
  if (audioLabels.length === 0) {
    filters.push('anullsrc=r=48000:cl=stereo,atrim=0:' + duration + '[aout]')
  } else if (isAudioGraphActive(project.audioGraph)) {
    const lowered = lowerAudioGraphAfterClips({
      graph: project.audioGraph,
      clipSignals: audioSignals.filter(s => s.trackId),
      duration,
      nextLabel,
    })
    if (!lowered.ok) {
      return { ok: false, error: lowered.error, outputPath, encoder: encoder.videoCodec }
    }
    filters.push(...lowered.chains)
  } else if (audioLabels.length === 1) {
    filters.push(`${audioLabels[0]}apad=whole_dur=${duration}[aout]`)
  } else {
    filters.push(`${audioLabels.join('')}amix=inputs=${audioLabels.length}:duration=longest:normalize=0,apad=whole_dur=${duration}[aout]`)
  }

  const args: string[] = ['-y']
  for (const file of inputs) args.push('-i', file)
  const scriptPath = path.join(dirs.tmp, `${job.id}-${cacheKey ?? 'plan'}.ffilt`)
  writeFileSync(scriptPath, `${filters.join(';\n')}\n`, 'utf8')
  args.push(
    '-filter_complex_script', scriptPath,
    '-map', '[vout]',
    '-map', '[aout]',
    ...videoEncodeArgs(encoder),
    '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '192k',
    '-t', String(duration),
    '-movflags', '+faststart',
    outputPath,
  )
  const result = await runProcess(ffmpeg, args, 900_000, () => existsSync(renderCancelFlag(project.id, job.id)))
  if (result.cancelled) {
    return { ok: false, cancelled: true, error: 'Cancelled during encode.', outputPath, encoder: encoder.videoCodec }
  }
  if (!result.ok || !existsSync(outputPath)) {
    const graph = filters.join(';\n')
    return {
      ok: false,
      error: `${result.stderr.slice(-1200) || 'FFmpeg render failed.'}\nHVS_FILTER_GRAPH:\n${graph}`,
      outputPath,
      encoder: encoder.videoCodec,
    }
  }
  return { ok: true, error: '', outputPath, encoder: encoder.videoCodec }
}

export function listRenderJobs(project: HvsProject): RenderJob[] {
  return project.renderJobs
}

export function clipSpeedFactor(clip: Clip): number {
  if (!clip.speed || clip.speed.d === 0 || clip.speed.n === 0) return 1
  return clip.speed.n / clip.speed.d
}

export function atempoFilters(speed: number): string[] {
  if (!Number.isFinite(speed) || speed <= 0 || Math.abs(speed - 1) < 0.001) return []
  const parts: string[] = []
  let remaining = speed
  while (remaining > 2.0001) {
    parts.push('atempo=2.0')
    remaining /= 2
  }
  while (remaining < 0.4999) {
    parts.push('atempo=0.5')
    remaining *= 2
  }
  parts.push(`atempo=${Number(remaining.toFixed(4))}`)
  return parts
}

export function clipVideoPresentation(clip: Clip, opts: {
  dissolve?: { role: 'out' | 'in'; localStart: number; duration: number }
  timelineStart?: number
  fps?: Rational | null
}): string {
  const parts: string[] = []
  if (opts.dissolve && opts.dissolve.duration > 0) {
    parts.push('format=rgba')
    if (opts.dissolve.role === 'out') {
      parts.push(`fade=t=out:st=${Math.max(0, opts.dissolve.localStart).toFixed(4)}:d=${opts.dissolve.duration.toFixed(4)}:alpha=1`)
    } else {
      parts.push(`fade=t=in:st=${Math.max(0, opts.dissolve.localStart).toFixed(4)}:d=${opts.dissolve.duration.toFixed(4)}:alpha=1`)
    }
    if (clip.opacity < 1) parts.push(`colorchannelmixer=aa=${Math.max(0, Math.min(1, clip.opacity))}`)
  } else if (clip.opacity < 1) parts.push(`format=rgba,colorchannelmixer=aa=${Math.max(0, Math.min(1, clip.opacity))}`)
  else parts.push('format=yuv420p')
  if (opts.fps) parts.push(`fps=${ffmpegFpsExpr(opts.fps)}`)
  if ((opts.timelineStart ?? 0) > 0) parts.push(`setpts=PTS+${opts.timelineStart}/TB`)
  return parts.filter(Boolean).join(',')
}

export function clipVideoFilter(clip: Clip, asset: { kind?: string } | null, opts: {
  geometry: string
  look: string[]
  dissolve?: { role: 'out' | 'in'; localStart: number; duration: number }
  timelineStart?: number
  fps?: Rational | null
  through?: 'complete' | 'look'
}): string {
  const srcIn = toSeconds(clip.sourceIn)
  const sourceSpan = Math.max(1 / 24000, toSeconds(clip.sourceOut) - toSeconds(clip.sourceIn))
  const timelineDur = Math.max(1 / 24000, toSeconds(clip.duration))
  const speed = clipSpeedFactor(clip)
  const freeze = clip.freeze || asset?.kind === 'image'
  const parts: string[] = []
  if (freeze) {
    parts.push(`trim=start=${srcIn}:duration=0.04`)
    parts.push('setpts=PTS-STARTPTS')
    if (opts.fps && opts.fps.n > 0 && opts.fps.d > 0) {
      const frames = Math.max(1, Math.ceil(timelineDur * opts.fps.n / opts.fps.d) + 2)
      parts.push(`loop=loop=${frames}:size=1:start=0`)
      parts.push(`fps=${ffmpegFpsExpr(opts.fps)}`)
      parts.push(`trim=duration=${timelineDur}`)
      parts.push('setpts=PTS-STARTPTS')
    } else {
      parts.push('loop=loop=-1:size=1:start=0')
      parts.push(`trim=duration=${timelineDur}`)
      parts.push('setpts=PTS-STARTPTS')
    }
  } else {
    parts.push(`trim=start=${srcIn}:duration=${sourceSpan}`)
    parts.push('setpts=PTS-STARTPTS')
    if (clip.reversed) {
      parts.push('reverse')
      parts.push('setpts=PTS-STARTPTS')
    }
    if (Math.abs(speed - 1) > 0.001) parts.push(`setpts=${(1 / speed).toFixed(6)}*PTS`)
  }
  parts.push(opts.geometry)
  if (clip.crop && (clip.crop.left || clip.crop.top || clip.crop.right || clip.crop.bottom)) {
    parts.push(`crop=iw*(1-${clip.crop.left}-${clip.crop.right}):ih*(1-${clip.crop.top}-${clip.crop.bottom}):iw*${clip.crop.left}:ih*${clip.crop.top}`)
  }
  if (clip.transform && (clip.transform.scaleX !== 1 || clip.transform.rotation)) {
    const sx = clip.transform.scaleX || 1
    parts.push(`scale=iw*${sx}:ih*${clip.transform.scaleY || sx}`)
    if (clip.transform.rotation) parts.push(`rotate=${clip.transform.rotation}*PI/180:fillcolor=0x080604`)
  }
  parts.push(...opts.look)
  if (opts.through === 'look') return parts.filter(Boolean).join(',')
  parts.push(clipVideoPresentation(clip, opts))
  return parts.filter(Boolean).join(',')
}

export function clipAudioFilter(clip: Clip, inputIdx: number, label: string, extra?: {
  dissolve?: { role: 'out' | 'in'; localStart: number; duration: number }
}): string | null {
  if (clip.freeze) return null
  const srcIn = toSeconds(clip.sourceIn)
  const sourceSpan = Math.max(1 / 24000, toSeconds(clip.sourceOut) - toSeconds(clip.sourceIn))
  const timelineDur = Math.max(1 / 24000, toSeconds(clip.duration))
  const speed = clipSpeedFactor(clip)
  const delayMs = Math.round(toSeconds(clip.start) * 1000)
  const fadeIn = Math.max(0, toSeconds(clip.fadeIn))
  const fadeOut = Math.max(0, toSeconds(clip.fadeOut))
  const vol = Math.max(0, clip.volume)
  const parts = [
    `[${inputIdx}:a]atrim=start=${srcIn}:duration=${sourceSpan}`,
    'asetpts=PTS-STARTPTS',
  ]
  if (clip.reversed) {
    parts.push('areverse')
    parts.push('asetpts=PTS-STARTPTS')
  }
  parts.push(...atempoFilters(speed))
  parts.push(`volume=${vol}`)
  if (Math.abs(clip.pan) > 0.001) parts.push(ffmpegPanFilter(clip.pan))
  if (fadeIn > 0) parts.push(`afade=t=in:st=0:d=${fadeIn}`)
  if (fadeOut > 0) parts.push(`afade=t=out:st=${Math.max(0, timelineDur - fadeOut)}:d=${fadeOut}`)
  if (extra?.dissolve && extra.dissolve.duration > 0) {
    if (extra.dissolve.role === 'out') {
      parts.push(`afade=t=out:st=${Math.max(0, extra.dissolve.localStart).toFixed(4)}:d=${extra.dissolve.duration.toFixed(4)}`)
    } else {
      parts.push(`afade=t=in:st=${Math.max(0, extra.dissolve.localStart).toFixed(4)}:d=${extra.dissolve.duration.toFixed(4)}`)
    }
  }
  if (delayMs > 0) parts.push(`adelay=${delayMs}|${delayMs}`)
  parts.push(`aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo${label}`)
  return parts.join(',')
}

export const HVS_AUDIO_SPEED_POLICY = 'Render uses FFmpeg atempo (0.5–2 chained) so audio stays aligned with speed. Reverse uses areverse. Freeze clips omit audio. Preview uses HTML5 playbackRate for forward speed (pitch shifts) and mutes reverse/freeze because negative playbackRate is not a reliable V1 clock.'

export type { VirtualCamera, TrackSubject }
