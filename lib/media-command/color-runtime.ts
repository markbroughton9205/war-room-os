/**
 * ColorPipeline FFmpeg execution + real scopes. Does not replace Phase-1 ColorGrade.
 */
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { IDENTITY_COLOR } from './types'
import {
  buildHslQualifierFilterGraph,
  buildHslQualifierMaskGraph,
  buildLumaQualifierFilterGraph,
  buildLumaQualifierMaskGraph,
  planColorPipelineLowering,
  readHslQualifier,
  readLumaQualifier,
  type ColorPipeline,
} from './color-pipeline'
import { resolveFfmpegTools, runProcess } from './ffmpeg'
import { extractFramePixels, scopesFromPixels, type ColorScopes, type ChannelStats } from './frame-scopes'
import { createHvsJob, markJobCompleted, markJobFailed, markJobRunning, saveJob, type HvsJob } from './jobs'
import { mediaCommandDataHierarchy } from './paths'
import { HVS_WAVE2_LOCAL_ENGINE_EXECUTION_AUTHORIZED } from './policy'

export function firstWave2ColorPipeline(): ColorPipeline {
  return {
    schemaVersion: 1,
    outputColorSpace: 'display-referred',
    nodes: [
      { id: 'contrast', type: 'contrast-pivot', enabled: true, params: { contrast: 0.28, pivot: 0.45 } },
      { id: 'temp', type: 'temp-tint', enabled: true, params: { temperature: -0.35, tint: 0.05 } },
      { id: 'sat', type: 'saturation', enabled: true, params: { saturation: 0.18 } },
    ],
  }
}

export function firstWave3ColorPipeline(): ColorPipeline {
  return {
    schemaVersion: 1,
    outputColorSpace: 'display-referred',
    nodes: [
      { id: 'lift', type: 'lift-gamma-gain', enabled: true, params: { lift: [0.04, 0.04, 0.08], gamma: [1, 1, 1], gain: [1, 1, 1] } },
      { id: 'offset', type: 'offset', enabled: true, params: { offset: 0 } },
      { id: 'temp', type: 'temp-tint', enabled: true, params: { temperature: -0.2, tint: 0 } },
      { id: 'contrast', type: 'contrast-pivot', enabled: true, params: { contrast: 0.18, pivot: 0.5 } },
      { id: 'sat', type: 'saturation', enabled: true, params: { saturation: -0.1 } },
      { id: 'luma', type: 'luma-curve', enabled: true, params: { curve: [{ input: 0, output: 0 }, { input: 0.5, output: 0.35 }, { input: 1, output: 1 }] } },
    ],
  }
}

export type ColorExecuteResult = {
  job: HvsJob
  beforePath: string | null
  afterPath: string | null
  before: ChannelStats | null
  after: ChannelStats | null
  beforeScopes: ColorScopes | null
  afterScopes: ColorScopes | null
  durationMs: number
  error: string | null
  cacheHit?: boolean
  cacheKey?: string
  qualifierGraph?: string | null
  maskPath?: string | null
}

export function firstWave4RgbCurvePipeline(): ColorPipeline {
  return {
    schemaVersion: 1,
    outputColorSpace: 'display-referred',
    nodes: [{
      id: 'rgb',
      type: 'rgb-curve',
      enabled: true,
      params: {
        r: [{ input: 0, output: 0 }, { input: 0.5, output: 0.2 }, { input: 1, output: 0.8 }],
        g: [{ input: 0, output: 0 }, { input: 0.5, output: 0.5 }, { input: 1, output: 1 }],
        b: [{ input: 0, output: 0 }, { input: 0.5, output: 0.5 }, { input: 1, output: 1 }],
      },
    }],
  }
}

export async function lut3dAvailable(ffmpeg: string): Promise<boolean> {
  const help = await runProcess(ffmpeg, ['-hide_banner', '-filters'], 20_000)
  return /\blut3d\b/.test(help.stdout + help.stderr)
}

export function firstWave9HslQualifierPipeline(): ColorPipeline {
  return {
    schemaVersion: 1,
    outputColorSpace: 'display-referred',
    nodes: [{
      id: 'hsl',
      type: 'hsl-qualifier',
      enabled: true,
      params: { hueLow: 350, hueHigh: 25, satLow: 0.35, satHigh: 1, lumaLow: 0.08, lumaHigh: 0.95, softness: 0.05, invert: false },
    }, {
      id: 'c',
      type: 'contrast-pivot',
      enabled: true,
      params: { contrast: 0.4, pivot: 0.45 },
    }],
  }
}

export function firstWave5QualifierPipeline(opts?: { invert?: boolean; softness?: number }): ColorPipeline {
  return {
    schemaVersion: 1,
    outputColorSpace: 'display-referred',
    nodes: [
      {
        id: 'q',
        type: 'luma-qualifier',
        enabled: true,
        params: { low: 0, high: 0.42, softness: opts?.softness ?? 0.08, invert: opts?.invert === true },
      },
      { id: 'c', type: 'contrast-pivot', enabled: true, params: { contrast: 0.85, pivot: 0.35 } },
      { id: 't', type: 'temp-tint', enabled: true, params: { temperature: -0.45, tint: 0 } },
    ],
  }
}

export function colorPipelineCacheKey(sourcePath: string, pipeline: ColorPipeline, atSec: number): string {
  return createHash('sha256').update(JSON.stringify({
    sourcePath,
    atSec,
    nodes: pipeline.nodes.map(n => ({ id: n.id, type: n.type, enabled: n.enabled, params: n.params })),
  })).digest('hex').slice(0, 20)
}

export async function executeColorPipeline(input: {
  projectId: string
  sourcePath: string
  pipeline: ColorPipeline
  atSec?: number
  skipCache?: boolean
  writeMask?: boolean
}): Promise<ColorExecuteResult> {
  const started = Date.now()
  const empty: ColorExecuteResult = {
    job: createHvsJob({ kind: 'color', projectId: input.projectId, backend: 'ffmpeg-colorpipeline', status: 'QUEUED' }),
    beforePath: null,
    afterPath: null,
    before: null,
    after: null,
    beforeScopes: null,
    afterScopes: null,
    durationMs: 0,
    error: null,
    cacheHit: false,
    cacheKey: undefined,
    qualifierGraph: null,
    maskPath: null,
  }
  let job = saveJob(empty.job)
  if (!HVS_WAVE2_LOCAL_ENGINE_EXECUTION_AUTHORIZED) {
    job = markJobFailed(job, 'Local color execution is not authorized.')
    return { ...empty, job, durationMs: Date.now() - started, error: job.error }
  }
  const plan = planColorPipelineLowering(IDENTITY_COLOR, input.pipeline)
  const qualifierNode = input.pipeline.nodes.find(n => (n.type === 'luma-qualifier' || n.type === 'hsl-qualifier') && n.enabled)
  if (!plan.executablePipeline) {
    job = markJobFailed(job, 'ColorPipeline has no executable nodes.')
    return { ...empty, job, durationMs: Date.now() - started, error: job.error }
  }
  const tools = await resolveFfmpegTools()
  if (!tools.ffmpeg || !existsSync(input.sourcePath)) {
    job = markJobFailed(job, 'ffmpeg or source missing.')
    return { ...empty, job, durationMs: Date.now() - started, error: job.error }
  }
  const atSec = input.atSec ?? 1
  const cacheKey = colorPipelineCacheKey(input.sourcePath, input.pipeline, atSec)
  const cacheDir = path.join(mediaCommandDataHierarchy().tmp, 'hvs-color-cache')
  mkdirSync(cacheDir, { recursive: true })
  const cacheFile = path.join(cacheDir, `${cacheKey}.jpg`)
  const dir = path.join(mediaCommandDataHierarchy().tmp, 'hvs-wave5-color')
  mkdirSync(dir, { recursive: true })
  const beforePath = path.join(dir, `${job.id}-before.jpg`)
  const afterPath = path.join(dir, `${job.id}-after.jpg`)
  const maskPath = path.join(dir, `${job.id}-mask.jpg`)
  job = markJobRunning(job)
  const extract = await runProcess(tools.ffmpeg, [
    '-hide_banner', '-y', '-ss', atSec.toFixed(3), '-i', input.sourcePath, '-frames:v', '1', '-q:v', '2', beforePath,
  ], 60_000)
  if (!extract.ok || !existsSync(beforePath)) {
    job = markJobFailed(job, extract.stderr.slice(-300) || 'Before-frame extract failed.')
    return { ...empty, job, durationMs: Date.now() - started, error: job.error }
  }

  let qualifierGraph: string | null = null
  let cacheHit = false
  if (!input.skipCache && existsSync(cacheFile)) {
    copyFileSync(cacheFile, afterPath)
    cacheHit = true
  } else {
    const gradeFilters = plan.pipelineFilters.join(',')
    let grade: { ok: boolean; stderr: string }
    if (qualifierNode) {
      if (qualifierNode.type === 'hsl-qualifier') {
        qualifierGraph = buildHslQualifierFilterGraph(gradeFilters, readHslQualifier(qualifierNode))
      } else {
        qualifierGraph = buildLumaQualifierFilterGraph(gradeFilters, readLumaQualifier(qualifierNode))
      }
      const script = path.join(dir, `${job.id}-qualifier.ffilt`)
      writeFileSync(script, `${qualifierGraph}\n`, 'utf8')
      grade = await runProcess(tools.ffmpeg, [
        '-hide_banner', '-y', '-i', beforePath,
        '-filter_complex_script', script,
        '-map', '[out]', '-frames:v', '1', '-q:v', '2', afterPath,
      ], 60_000)
    } else if (gradeFilters) {
      grade = await runProcess(tools.ffmpeg, [
        '-hide_banner', '-y', '-i', beforePath, '-vf', gradeFilters, '-frames:v', '1', '-q:v', '2', afterPath,
      ], 60_000)
    } else {
      job = markJobFailed(job, 'ColorPipeline has no executable grade filters.')
      return { ...empty, job, beforePath, durationMs: Date.now() - started, error: job.error }
    }
    if (!grade.ok || !existsSync(afterPath)) {
      job = markJobFailed(job, grade.stderr.slice(-400) || 'ColorPipeline render failed.')
      return { ...empty, job, beforePath, qualifierGraph, durationMs: Date.now() - started, error: job.error }
    }
    copyFileSync(afterPath, cacheFile)
  }

  let writtenMask: string | null = null
  if (input.writeMask && qualifierNode) {
    const maskGraph = qualifierNode.type === 'hsl-qualifier'
      ? buildHslQualifierMaskGraph(readHslQualifier(qualifierNode))
      : buildLumaQualifierMaskGraph(readLumaQualifier(qualifierNode))
    const maskScript = path.join(dir, `${job.id}-mask.ffilt`)
    writeFileSync(maskScript, `${maskGraph}\n`, 'utf8')
    const maskRun = await runProcess(tools.ffmpeg, [
      '-hide_banner', '-y', '-i', beforePath,
      '-filter_complex_script', maskScript,
      '-map', '[out]', '-frames:v', '1', '-q:v', '2', maskPath,
    ], 60_000)
    if (maskRun.ok && existsSync(maskPath)) writtenMask = maskPath
  }

  const beforePx = await extractFramePixels(beforePath, 0)
  const afterPx = await extractFramePixels(afterPath, 0)
  const beforeScopes = beforePx ? scopesFromPixels(beforePx) : null
  const afterScopes = afterPx ? scopesFromPixels(afterPx) : null
  job = markJobCompleted(job, {
    outputPath: afterPath,
    validState: true,
    beforePath,
    filters: plan.pipelineFilters,
    cacheHit,
    cacheKey,
    beforeStats: beforeScopes?.stats ?? null,
    afterStats: afterScopes?.stats ?? null,
  })
  job.metrics = { ...job.metrics, executionDurationMs: Date.now() - started }
  job = saveJob(job)
  return {
    job,
    beforePath,
    afterPath,
    before: beforeScopes?.stats ?? null,
    after: afterScopes?.stats ?? null,
    beforeScopes,
    afterScopes,
    durationMs: Date.now() - started,
    error: null,
    cacheHit,
    cacheKey,
    qualifierGraph,
    maskPath: writtenMask,
  }
}

export function colderPipelineOr(pipeline: ColorPipeline | null | undefined): ColorPipeline {
  if (pipeline && pipeline.nodes.length) return pipeline
  return firstWave2ColorPipeline()
}
