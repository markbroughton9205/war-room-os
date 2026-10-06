/**
 * EffectGraph → FFmpeg execution. Does not replace RenderEngine.
 * CSS is preview only. Physical composite is canonical VFX truth this wave.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import type { AssetRecord, HvsProject, TrackSubject } from './types'
import { findAsset } from './types'
import {
  planEffectGraphLowering,
  readKeyerParams,
  readMaskParams,
  readTransformParams,
  validateEffectGraph,
  type HvsEffectGraph,
  type MaskParams,
  type TransformParams,
} from './effect-graph'
import { interpolateSubject } from './tracking'
import { resolveFfmpegTools, runProcess, videoEncodeArgs, chooseEncoder } from './ffmpeg'
import { probeMediaFile, type ProbedMedia } from './probe'
import { createHvsJob, markJobCompleted, markJobFailed, markJobRunning, saveJob, type HvsJob } from './jobs'
import { mediaCommandDataHierarchy } from './paths'
import { HVS_WAVE2_LOCAL_ENGINE_EXECUTION_AUTHORIZED } from './policy'
import { toSeconds } from './time'

export type EffectExecuteResult = {
  job: HvsJob
  outputPath: string | null
  probe: ProbedMedia | null
  filterComplex: string | null
  durationMs: number
  error: string | null
  label?: string | null
}

function assetPath(project: HvsProject, assetId: string): AssetRecord | null {
  const asset = findAsset(project, assetId)
  if (!asset) return null
  if (existsSync(asset.originalPath)) return asset
  return null
}

function maskCoverageExpr(mask: MaskParams): string {
  const f = Math.max(0, Math.min(0.49, mask.feather))
  if (mask.type === 'ellipse') {
    const cx = mask.centerX.toFixed(4)
    const cy = mask.centerY.toFixed(4)
    const rx = Math.max(0.004, mask.radiusX).toFixed(4)
    const ry = Math.max(0.004, mask.radiusY).toFixed(4)
    const d = `hypot((X/W-${cx})/${rx}\\,(Y/H-${cy})/${ry})`
    if (f < 0.001) return `if(lt(${d}\\,1)\\,1\\,0)`
    const inner = (1 - f).toFixed(4)
    return `if(lt(${d}\\,${inner})\\,1\\,if(gt(${d}\\,1)\\,0\\,(1-${d})/${f.toFixed(4)}))`
  }
  const x0 = mask.x.toFixed(4)
  const y0 = mask.y.toFixed(4)
  const x1 = (mask.x + mask.width).toFixed(4)
  const y1 = (mask.y + mask.height).toFixed(4)
  const dx = `min(X/W-${x0}\\,${x1}-X/W)`
  const dy = `min(Y/H-${y0}\\,${y1}-Y/H)`
  const m = `min(${dx}\\,${dy})`
  if (f < 0.001) return `if(gt(${m}\\,0)\\,1\\,0)`
  return `if(lt(${m}\\,0)\\,0\\,if(gt(${m}\\,${f.toFixed(4)})\\,1\\,${m}/${f.toFixed(4)}))`
}

export function maskAlphaChannelExpr(mask: MaskParams): string {
  const cover = maskCoverageExpr(mask)
  const signed = mask.invert ? `(1-(${cover}))` : `(${cover})`
  return `alpha(X\\,Y)*${signed}`
}

function subjectBoxToMask(box: { x: number; y: number; width: number; height: number }, base: MaskParams): MaskParams {
  return {
    ...base,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    centerX: box.x + box.width / 2,
    centerY: box.y + box.height / 2,
    radiusX: Math.max(0.02, box.width / 2),
    radiusY: Math.max(0.02, box.height / 2),
  }
}

function lerpExpr(t0: number, t1: number, a: number, b: number, t: string): string {
  const dur = Math.max(0.001, t1 - t0)
  return `${a.toFixed(4)}+(${(b - a).toFixed(4)})*(${t}-${t0.toFixed(4)})/${dur.toFixed(4)}`
}

function piecewiseScalar(kfs: Array<{ t: number; v: number }>, t: string): string {
  if (!kfs.length) return '0'
  if (kfs.length === 1) return kfs[0].v.toFixed(4)
  let expr = kfs[kfs.length - 1].v.toFixed(4)
  for (let i = kfs.length - 2; i >= 0; i--) {
    const a = kfs[i]
    const b = kfs[i + 1]
    const lerp = lerpExpr(a.t, b.t, a.v, b.v, t)
    expr = `if(lt(${t}\\,${b.t.toFixed(4)})\\,${i === 0 ? `if(lt(${t}\\,${a.t.toFixed(4)})\\,${a.v.toFixed(4)}\\,${lerp})` : lerp}\\,${expr})`
  }
  return expr
}

function subjectKeyframes(subject: TrackSubject): Array<{ t: number; x: number; y: number; w: number; h: number }> {
  return [...subject.keyframes]
    .sort((a, b) => toSeconds(a.time) - toSeconds(b.time))
    .map(kf => ({ t: toSeconds(kf.time), x: kf.x, y: kf.y, w: kf.width, h: kf.height }))
}

function resolveFontFile(): string | null {
  const candidates = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    '/usr/share/fonts/truetype/freefont/FreeSans.ttf',
  ]
  return candidates.find(p => existsSync(p)) ?? null
}

function geqMask(mask: MaskParams): string {
  return `format=rgba,geq=r='r(X\\,Y)':g='g(X\\,Y)':b='b(X\\,Y)':a='${maskAlphaChannelExpr(mask)}'`
}

function combinedGeqMask(masks: MaskParams[], op: string): string {
  const covers = masks.map(m => {
    const c = maskCoverageExpr(m)
    return m.invert ? `(1-(${c}))` : `(${c})`
  })
  let cover = covers[0] ?? '1'
  if (op === 'intersect') cover = covers.join('*')
  else if (op === 'subtract' && covers.length > 1) cover = `max(0\\,${covers[0]}-${covers.slice(1).join('-')})`
  else cover = `min(1\\,${covers.join('+')})`
  return `format=rgba,geq=r='r(X\\,Y)':g='g(X\\,Y)':b='b(X\\,Y)':a='alpha(X\\,Y)*${cover}'`
}

export async function executeEffectGraph(input: {
  project: HvsProject
  graph: HvsEffectGraph
  outputPath?: string
  still?: boolean
  durationSec?: number
  atSec?: number
}): Promise<EffectExecuteResult> {
  const started = Date.now()
  let job = saveJob(createHvsJob({
    kind: 'vfx',
    projectId: input.project.id,
    backend: 'ffmpeg-effectgraph',
    status: 'QUEUED',
    inputs: { graphId: input.graph.id },
    parameters: { nodeKinds: input.graph.nodes.map(n => n.kind) },
    provenance: { createdBy: 'system', notes: 'Wave 4 EffectGraph composite.' },
  }))
  const fail = (error: string, filterComplex: string | null = null): EffectExecuteResult => ({
    job, outputPath: null, probe: null, filterComplex, durationMs: Date.now() - started, error, label: null,
  })
  if (!HVS_WAVE2_LOCAL_ENGINE_EXECUTION_AUTHORIZED) {
    job = markJobFailed(job, 'Local VFX execution is not authorized.')
    return fail(job.error ?? 'unauthorized')
  }
  const check = validateEffectGraph(input.graph, { assetIds: new Set(input.project.assets.map(a => a.id)) })
  if (!check.ok) {
    job = markJobFailed(job, check.errors.join('; '))
    return fail(job.error ?? 'invalid')
  }
  const plan = planEffectGraphLowering(input.graph)
  if (!plan.executable) {
    job = markJobFailed(job, 'EffectGraph is not executable this wave.')
    return fail(job.error ?? 'not executable')
  }
  const tools = await resolveFfmpegTools()
  if (!tools.ffmpeg) {
    job = markJobFailed(job, 'Bundled ffmpeg missing.')
    return fail(job.error ?? 'ffmpeg')
  }
  const mediaIns = input.graph.nodes.filter(n => n.kind === 'MediaIn')
  const sources: AssetRecord[] = []
  for (const node of mediaIns) {
    const id = typeof node.parameters.assetId === 'string' ? node.parameters.assetId : ''
    const asset = assetPath(input.project, id)
    if (!asset) {
      job = markJobFailed(job, `MediaIn ${node.id} source missing.`)
      return fail(job.error ?? 'source')
    }
    sources.push(asset)
  }
  if (!sources[0]) {
    job = markJobFailed(job, 'No MediaIn source.')
    return fail(job.error ?? 'source')
  }
  const bg = sources[0]
  const fg = sources[1] ?? sources[0]
  const xf = input.graph.nodes.find(n => n.kind === 'Transform' && n.enabled !== false)
  const params: TransformParams = xf ? readTransformParams(xf) : {
    x: 0, y: 0, nx: 0, ny: 0, scaleX: 1, scaleY: 1, rotationDeg: 0, opacity: 1,
  }
  const bgW = bg.width ?? 512
  const bgH = bg.height ?? 910
  const x = params.x || Math.round(params.nx * bgW)
  const y = params.y || Math.round(params.ny * bgH)
  const rot = params.rotationDeg !== 0 ? `,rotate=${(params.rotationDeg * Math.PI / 180).toFixed(4)}:ow=rotw:oh=roth:c=none` : ''
  const maskNodes = input.graph.nodes.filter(n => n.kind === 'Mask' && n.enabled !== false)
  const trackerNode = input.graph.nodes.find(n => n.kind === 'TrackerRef' && n.enabled !== false)
  const blurNode = input.graph.nodes.find(n => n.kind === 'Blur' && n.enabled !== false)
  const textNode = input.graph.nodes.find(n => n.kind === 'Text' && n.enabled !== false)
  const maskNode = maskNodes[0]
  const subjectId = (typeof maskNode?.parameters.subjectId === 'string' ? maskNode.parameters.subjectId : null)
    ?? (typeof trackerNode?.parameters.subjectId === 'string' ? trackerNode.parameters.subjectId : null)
  const subject = subjectId ? input.project.timeline.subjects.find(s => s.id === subjectId) : undefined
  const atSec = input.atSec ?? 0
  const still = input.still !== false
  const resolvedMasks: MaskParams[] = maskNodes.map(node => {
    let mask = readMaskParams(node)
    if (mask.subjectId && subject) {
      const box = interpolateSubject(subject, Math.round(atSec * 1000), 1000)
      if (box) mask = subjectBoxToMask(box, mask)
    }
    return mask
  })
  const mask = resolvedMasks[0] ?? null
  const combineOp = typeof maskNodes[1]?.parameters.combine === 'string' ? String(maskNodes[1].parameters.combine) : 'add'
  const stackedMask = resolvedMasks.length === 1
    ? geqMask(resolvedMasks[0])
    : resolvedMasks.length > 1
      ? combinedGeqMask(resolvedMasks, combineOp)
      : ''
  const blurRadius = typeof blurNode?.parameters.radius === 'number' ? Math.max(0.5, blurNode.parameters.radius) : 8
  const invertBlur = Boolean(blurNode && mask && mask.invert)
  const keyerNode = input.graph.nodes.find(n => n.kind === 'Keyer' && n.enabled !== false)
  const mergeNode = input.graph.nodes.find(n => n.kind === 'Merge' && n.enabled !== false)
  const blendMode = typeof mergeNode?.parameters.blendMode === 'string' ? String(mergeNode.parameters.blendMode) : 'normal'
  let label = 'VFX composite'
  if (keyerNode) label = 'CHROMA KEY'
  else if (blendMode !== 'normal') label = `BLEND ${blendMode}`
  else if (resolvedMasks.length > 1) label = `MASK ${combineOp.toUpperCase()}`
  else if (invertBlur && subject) label = 'TRACKED GEOMETRIC BACKGROUND BLUR'
  else if (invertBlur) label = 'GEOMETRIC BACKGROUND BLUR'
  else if (subject && mask) label = 'TRACKED GEOMETRIC MASK'

  const xfKfs = Array.isArray(xf?.parameters.keyframes)
    ? (xf.parameters.keyframes as Array<{ t: number; x?: number; y?: number; scaleX?: number; scaleY?: number; rotationDeg?: number; opacity?: number }>)
    : []

  const chains: string[] = []
  if (keyerNode) {
    const k = readKeyerParams(keyerNode)
    chains.push(`color=c=0x0000FF:s=${bgW}x${bgH}:d=1,format=rgba[hold]`)
    chains.push(`[0:v]scale=${bgW}:${bgH}:flags=bilinear,setsar=1,format=rgba,chromakey=${k.keyColor}:${k.similarity.toFixed(3)}:${k.blend.toFixed(3)}[keyed]`)
    chains.push('[hold][keyed]overlay=0:0:format=auto,format=yuv420p[out]')
  } else if (blurNode && mediaIns.length === 1 && !maskNode) {
    chains.push(`[0:v]scale=${bgW}:${bgH}:flags=bilinear,setsar=1,gblur=sigma=${blurRadius.toFixed(2)}[out]`)
  } else if (invertBlur) {
    const inverted = mask ? { ...mask, invert: false } : null
    const keep = inverted ? geqMask(inverted) : 'format=rgba'
    chains.push(`[0:v]scale=${bgW}:${bgH}:flags=bilinear,setsar=1,format=rgba,split=2[src][toblur]`)
    chains.push(`[toblur]gblur=sigma=${blurRadius.toFixed(2)}[blurred]`)
    chains.push(`[src]${keep}[fg]`)
    chains.push(`[blurred][fg]overlay=0:0:format=auto[comp]`)
  } else if (mediaIns.length === 1 && stackedMask) {
    chains.push(`[0:v]scale=${bgW}:${bgH}:flags=bilinear,setsar=1,${stackedMask}[out]`)
  } else {
    const maskFilter = stackedMask ? `,${stackedMask}` : ''
    chains.push(`[0:v]scale=${bgW}:${bgH}:flags=bilinear,setsar=1,format=rgba[bg]`)
    chains.push(`[1:v]scale=iw*${params.scaleX}:ih*${params.scaleY}:flags=bilinear${rot},format=rgba,colorchannelmixer=aa=${params.opacity.toFixed(3)}${maskFilter}[fg]`)
    const ffBlend = blendMode === 'add' || blendMode === 'addition' ? 'addition' : blendMode
    if (ffBlend !== 'normal') {
      chains.push(`[bg][fg]blend=all_mode=${ffBlend}:all_opacity=1[comp]`)
    } else if (xfKfs.length >= 2 && !still) {
      const ox = piecewiseScalar(xfKfs.map(k => ({ t: k.t, v: k.x ?? params.x })), 't')
      const oy = piecewiseScalar(xfKfs.map(k => ({ t: k.t, v: k.y ?? params.y })), 't')
      chains.push(`[bg][fg]overlay=x='${ox}':y='${oy}':format=auto[comp]`)
    } else if (subject && !still && subject.keyframes.length >= 2) {
      const kfs = subjectKeyframes(subject)
      const ox = piecewiseScalar(kfs.map(k => ({ t: k.t, v: k.x * bgW })), 't')
      const oy = piecewiseScalar(kfs.map(k => ({ t: k.t, v: k.y * bgH })), 't')
      chains.push(`[bg][fg]overlay=x='${ox}':y='${oy}':format=auto[comp]`)
    } else {
      chains.push(`[bg][fg]overlay=${x}:${y}:format=auto[comp]`)
    }
  }

  let outLabel = chains.some(c => c.includes('[out]')) ? 'out' : 'comp'
  if (textNode) {
    const font = resolveFontFile()
    const text = String(textNode.parameters.text ?? 'HVS').replace(/[:\\']/g, ' ')
    const fontsize = typeof textNode.parameters.fontSize === 'number' ? textNode.parameters.fontSize : 42
    const tx = typeof textNode.parameters.x === 'number' ? textNode.parameters.x : 24
    const ty = typeof textNode.parameters.y === 'number' ? textNode.parameters.y : 48
    if (font) {
      chains.push(`[${outLabel}]drawtext=fontfile=${font}:text='${text}':fontsize=${fontsize}:x=${tx}:y=${ty}:fontcolor=white:borderw=2:bordercolor=black[out]`)
      outLabel = 'out'
    }
  } else if (outLabel === 'comp') {
    chains.push('[comp]format=yuv420p[out]')
    outLabel = 'out'
  }

  const filterComplex = chains.join(';')
  const dir = path.join(mediaCommandDataHierarchy().tmp, 'hvs-wave4-vfx')
  mkdirSync(dir, { recursive: true })
  const outputPath = input.outputPath ?? path.join(dir, still ? `${job.id}.png` : `${job.id}.mp4`)
  const cacheKey = createHash('sha256').update(JSON.stringify({
    graph: input.graph, still, atSec, durationSec: input.durationSec ?? 2, src: [bg.originalPath, fg.originalPath],
  })).digest('hex').slice(0, 20)
  const cacheDir = path.join(mediaCommandDataHierarchy().tmp, 'hvs-vfx-cache')
  mkdirSync(cacheDir, { recursive: true })
  const cacheFile = path.join(cacheDir, `${cacheKey}${still ? '.png' : '.mp4'}`)
  job = markJobRunning(job)
  if (existsSync(cacheFile)) {
    copyFileSync(cacheFile, outputPath)
    const probe = await probeMediaFile(outputPath)
    job = markJobCompleted(job, {
      outputPath, validState: true, filterComplex, label, cacheHit: true, cacheKey,
      probe: { width: probe.width, height: probe.height, mime: probe.mime, hasVideo: probe.hasVideo, durationSec: probe.durationSec },
    })
    job.metrics = { ...job.metrics, executionDurationMs: Date.now() - started, cacheHit: true }
    job = saveJob(job)
    return { job, outputPath, probe, filterComplex, durationMs: Date.now() - started, error: null, label }
  }
  const needSecond = chains.some(c => c.includes('[1:v]'))
  const seek = still && atSec > 0.001 ? ['-ss', String(atSec)] : []
  const args = ['-hide_banner', '-y', ...seek, '-i', bg.originalPath]
  if (needSecond) args.push(...seek, '-i', fg.originalPath)
  if (still) {
    args.push('-filter_complex', filterComplex, '-map', '[out]', '-frames:v', '1', outputPath)
  } else {
    const enc = await chooseEncoder()
    args.push('-t', String(input.durationSec ?? 2), '-filter_complex', filterComplex, '-map', '[out]', ...videoEncodeArgs(enc), '-an', outputPath)
  }
  const run = await runProcess(tools.ffmpeg, args, 180_000)
  if (!run.ok || !existsSync(outputPath)) {
    job = markJobFailed(job, run.stderr.slice(-400) || 'EffectGraph ffmpeg failed.')
    return { ...fail(job.error ?? 'ffmpeg', filterComplex), filterComplex }
  }
  try { copyFileSync(outputPath, cacheFile) } catch { /* disposable cache */ }
  const probe = await probeMediaFile(outputPath)
  job = markJobCompleted(job, {
    outputPath,
    validState: true,
    filterComplex,
    label,
    probe: { width: probe.width, height: probe.height, mime: probe.mime, hasVideo: probe.hasVideo, durationSec: probe.durationSec },
  })
  job.metrics = { ...job.metrics, executionDurationMs: Date.now() - started }
  job = saveJob(job)
  return { job, outputPath, probe, filterComplex, durationMs: Date.now() - started, error: null, label }
}
