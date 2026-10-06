/**
 * Authoring → FFmpeg lowering. Authoring types never import this module.
 * Compiled strings are disposable. Project truth stays structured graphs.
 */
import { existsSync } from 'node:fs'
import type { Clip, HvsProject, TrackSubject } from './types'
import { findAsset } from './types'
import {
  readKeyerParams,
  readMaskParams,
  readTransformParams,
  type HvsEffectGraph,
  type MaskParams,
} from './effect-graph'
import {
  colorPipelineToFfmpeg,
  readHslQualifier,
  readLumaQualifier,
  lumaQualifierCoverageExpr,
  hslQualifierCoverageExpr,
  type ColorPipeline,
} from './color-pipeline'
import type { AudioGraph, AudioInsert } from './audio-graph'
import { interpolateSubject } from './tracking'
import { toSeconds } from './time'

function piecewise(kfs: Array<{ t: number; v: number }>, t: string): string {
  if (!kfs.length) return '0'
  if (kfs.length === 1) return kfs[0].v.toFixed(4)
  let expr = kfs[kfs.length - 1].v.toFixed(4)
  for (let i = kfs.length - 2; i >= 0; i--) {
    const a = kfs[i]
    const b = kfs[i + 1]
    const dur = Math.max(0.001, b.t - a.t)
    const lerp = `${a.v.toFixed(4)}+(${(b.v - a.v).toFixed(4)})*(${t}-${a.t.toFixed(4)})/${dur.toFixed(4)}`
    expr = `if(lt(${t},${b.t.toFixed(4)}),${i === 0 ? `if(lt(${t},${a.t.toFixed(4)}),${a.v.toFixed(4)},${lerp})` : lerp},${expr})`
  }
  return expr
}

function subjectKeyframes(subject: TrackSubject) {
  return [...subject.keyframes]
    .sort((a, b) => toSeconds(a.time) - toSeconds(b.time))
    .map(kf => ({ t: toSeconds(kf.time), x: kf.x, y: kf.y, w: kf.width, h: kf.height }))
}

function maskCoverageExpr(mask: MaskParams): string {
  const f = Math.max(0, Math.min(0.49, mask.feather))
  if (mask.type === 'ellipse') {
    const cx = mask.centerX.toFixed(4)
    const cy = mask.centerY.toFixed(4)
    const rx = Math.max(0.004, mask.radiusX).toFixed(4)
    const ry = Math.max(0.004, mask.radiusY).toFixed(4)
    const d = `hypot((X/W-${cx})/${rx},(Y/H-${cy})/${ry})`
    if (f < 0.001) return `if(lt(${d},1),1,0)`
    const inner = (1 - f).toFixed(4)
    return `if(lt(${d},${inner}),1,if(gt(${d},1),0,(1-${d})/${f.toFixed(4)}))`
  }
  const x0 = mask.x.toFixed(4)
  const y0 = mask.y.toFixed(4)
  const x1 = (mask.x + mask.width).toFixed(4)
  const y1 = (mask.y + mask.height).toFixed(4)
  const dx = `min(X/W-${x0},${x1}-X/W)`
  const dy = `min(Y/H-${y0},${y1}-Y/H)`
  const m = `min(${dx},${dy})`
  if (f < 0.001) return `if(gt(${m},0),1,0)`
  return `if(lt(${m},0),0,if(gt(${m},${f.toFixed(4)}),1,${m}/${f.toFixed(4)}))`
}

function geqMask(mask: MaskParams): string {
  const cover = maskCoverageExpr(mask)
  const signed = mask.invert ? `(1-(${cover}))` : `(${cover})`
  return `format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*${signed}'`
}

function combinedGeq(masks: MaskParams[], op: string): string {
  const covers = masks.map(m => {
    const c = maskCoverageExpr(m)
    return m.invert ? `(1-(${c}))` : `(${c})`
  })
  let cover = covers[0] ?? '1'
  if (op === 'intersect') cover = covers.join('*')
  else if (op === 'subtract' && covers.length > 1) cover = `max(0,${covers[0]}-${covers.slice(1).join('-')})`
  else cover = `min(1,${covers.join('+')})`
  return `format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*${cover}'`
}

function resolvedMasks(graph: HvsEffectGraph, project: HvsProject, atSec: number): MaskParams[] {
  const maskNodes = graph.nodes.filter(n => n.kind === 'Mask' && n.enabled !== false)
  const trackerNode = graph.nodes.find(n => n.kind === 'TrackerRef' && n.enabled !== false)
  const maskNode = maskNodes[0]
  const subjectId = (typeof maskNode?.parameters.subjectId === 'string' ? maskNode.parameters.subjectId : null)
    ?? (typeof trackerNode?.parameters.subjectId === 'string' ? trackerNode.parameters.subjectId : null)
  const subject = subjectId ? project.timeline.subjects.find(s => s.id === subjectId) : undefined
  return maskNodes.map(node => {
    let mask = readMaskParams(node)
    if (mask.subjectId && subject) {
      const box = interpolateSubject(subject, Math.round(atSec * 1000), 1000)
      if (box) {
        mask = {
          ...mask,
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
    }
    return mask
  })
}

export function lowerEffectGraphOntoLabel(input: {
  graph: HvsEffectGraph
  project: HvsProject
  clip: Clip
  sourceLabel: string
  width: number
  height: number
  nextLabel: (prefix: string) => string
  addInput: (file: string) => number
}): { ok: true; chains: string[]; outputLabel: string; notes: string[] } | { ok: false; error: string } {
  const mediaIns = input.graph.nodes.filter(n => n.kind === 'MediaIn' && n.enabled !== false)
  const xf = input.graph.nodes.find(n => n.kind === 'Transform' && n.enabled !== false)
  const params = xf ? readTransformParams(xf) : {
    x: 0, y: 0, nx: 0, ny: 0, scaleX: 1, scaleY: 1, rotationDeg: 0, opacity: 1,
  }
  const blurNode = input.graph.nodes.find(n => n.kind === 'Blur' && n.enabled !== false)
  const maskNodes = input.graph.nodes.filter(n => n.kind === 'Mask' && n.enabled !== false)
  const trackerNode = input.graph.nodes.find(n => n.kind === 'TrackerRef' && n.enabled !== false)
  const keyerNode = input.graph.nodes.find(n => n.kind === 'Keyer' && n.enabled !== false)
  const mergeNode = input.graph.nodes.find(n => n.kind === 'Merge' && n.enabled !== false)
  const clipStart = toSeconds(input.clip.start)
  const masks = resolvedMasks(input.graph, input.project, clipStart)
  const mask = masks[0] ?? null
  const combineOp = typeof maskNodes[1]?.parameters.combine === 'string' ? String(maskNodes[1].parameters.combine) : 'add'
  const stackedMask = masks.length === 1
    ? geqMask(masks[0])
    : masks.length > 1
      ? combinedGeq(masks, combineOp)
      : ''
  const blurRadius = typeof blurNode?.parameters.radius === 'number' ? Math.max(0.5, blurNode.parameters.radius) : 8
  const invertBlur = Boolean(blurNode && mask && mask.invert)
  const src = `[${input.sourceLabel}]`
  const out = input.nextLabel('vfx')
  const chains: string[] = []
  const notes: string[] = []
  if (trackerNode) notes.push('TrackerRef consumes persisted TrackSubject. No browser state.')

  if (keyerNode) {
    const k = readKeyerParams(keyerNode)
    chains.push(`${src}format=rgba,chromakey=${k.keyColor}:${k.similarity.toFixed(3)}:${k.blend.toFixed(3)}[keyed]`)
    const hold = input.nextLabel('hold')
    chains.push(`color=c=0x0000FF:s=${input.width}x${input.height}:d=1,format=rgba[${hold}]`)
    chains.push(`[${hold}][keyed]overlay=0:0:format=auto,format=yuv420p[${out}]`)
    notes.push('CHROMA KEY chromakey filter')
    return { ok: true, chains, outputLabel: out, notes }
  }

  if (blurNode && mediaIns.length === 1 && !maskNodes.length) {
    chains.push(`${src}gblur=sigma=${blurRadius.toFixed(2)}[${out}]`)
    return { ok: true, chains, outputLabel: out, notes }
  }

  if (invertBlur) {
    const inverted = mask ? { ...mask, invert: false } : null
    const keep = inverted ? geqMask(inverted) : 'format=rgba'
    const split = input.nextLabel('vsplit')
    const toblur = input.nextLabel('toblur')
    const blurred = input.nextLabel('blurred')
    const fg = input.nextLabel('vfg')
    chains.push(`${src}format=rgba,split=2[${split}][${toblur}]`)
    chains.push(`[${toblur}]gblur=sigma=${blurRadius.toFixed(2)}[${blurred}]`)
    chains.push(`[${split}]${keep}[${fg}]`)
    chains.push(`[${blurred}][${fg}]overlay=0:0:format=auto[${out}]`)
    notes.push(trackerNode ? 'TRACKED GEOMETRIC BACKGROUND BLUR' : 'GEOMETRIC BACKGROUND BLUR')
    return { ok: true, chains, outputLabel: out, notes }
  }

  if (mediaIns.length === 1 && stackedMask) {
    chains.push(`${src}${stackedMask}[${out}]`)
    notes.push(trackerNode ? 'TRACKED GEOMETRIC MASK' : 'GEOMETRIC MASK')
    return { ok: true, chains, outputLabel: out, notes }
  }

  const fgAsset = mediaIns.find(n => n.parameters.role === 'foreground') ?? mediaIns[1]
  const fgAssetId = typeof fgAsset?.parameters.assetId === 'string' ? fgAsset.parameters.assetId : null
  if (!fgAssetId) {
    chains.push(`${src}null[${out}]`)
    return { ok: true, chains, outputLabel: out, notes: ['Merge without second MediaIn; passthrough.'] }
  }
  const fgRecord = findAsset(input.project, fgAssetId)
  const fgPath = fgRecord && existsSync(fgRecord.originalPath) ? fgRecord.originalPath : null
  if (!fgPath) return { ok: false, error: `EffectGraph Merge missing foreground asset ${fgAssetId}.` }
  const idx = input.addInput(fgPath)
  const rot = params.rotationDeg !== 0 ? `,rotate=${(params.rotationDeg * Math.PI / 180).toFixed(4)}:ow=rotw:oh=roth:c=none` : ''
  const maskFilter = stackedMask ? `,${stackedMask}` : ''
  const bg = input.nextLabel('vbg')
  const fg = input.nextLabel('vfg')
  chains.push(`${src}format=rgba[${bg}]`)
  chains.push(`[${idx}:v]scale=iw*${params.scaleX}:ih*${params.scaleY}:flags=bilinear${rot},format=rgba,colorchannelmixer=aa=${params.opacity.toFixed(3)}${maskFilter}[${fg}]`)
  const blendMode = typeof mergeNode?.parameters.blendMode === 'string' ? String(mergeNode.parameters.blendMode) : 'normal'
  const ffBlend = blendMode === 'add' || blendMode === 'addition' ? 'addition' : blendMode
  if (ffBlend !== 'normal') {
    chains.push(`[${bg}][${fg}]blend=all_mode=${ffBlend}:all_opacity=1[${out}]`)
    notes.push(`BLEND ${ffBlend}`)
    return { ok: true, chains, outputLabel: out, notes }
  }
  const subjectId = (typeof maskNodes[0]?.parameters.subjectId === 'string' ? maskNodes[0].parameters.subjectId : null)
    ?? (typeof trackerNode?.parameters.subjectId === 'string' ? trackerNode.parameters.subjectId : null)
  const subject = subjectId ? input.project.timeline.subjects.find(s => s.id === subjectId) : undefined
  if (subject && subject.keyframes.length >= 2) {
    const kfs = subjectKeyframes(subject)
    const t = `t+${clipStart.toFixed(4)}`
    const ox = piecewise(kfs.map(k => ({ t: k.t, v: k.x * input.width })), t)
    const oy = piecewise(kfs.map(k => ({ t: k.t, v: k.y * input.height })), t)
    chains.push(`[${bg}][${fg}]overlay=x='${ox}':y='${oy}':format=auto[${out}]`)
    notes.push('TRACKED GEOMETRIC MASK overlay')
  } else {
    const x = params.x || Math.round(params.nx * input.width)
    const y = params.y || Math.round(params.ny * input.height)
    chains.push(`[${bg}][${fg}]overlay=${x}:${y}:format=auto[${out}]`)
  }
  return { ok: true, chains, outputLabel: out, notes }
}

export function lowerColorPipelineOntoLabel(input: {
  pipeline: ColorPipeline
  sourceLabel: string
  nextLabel: (prefix: string) => string
}): { chains: string[]; outputLabel: string; notes: string[] } {
  const grade = colorPipelineToFfmpeg(input.pipeline).filter(Boolean)
  const lumaQ = input.pipeline.nodes.find(n => n.type === 'luma-qualifier' && n.enabled)
  const hslQ = input.pipeline.nodes.find(n => n.type === 'hsl-qualifier' && n.enabled)
  const out = input.nextLabel('cprog')
  const notes = ['ColorPipeline.nodes[] authoring order preserved. No hidden grade reorder.']
  if (!grade.length && !lumaQ && !hslQ) {
    return { chains: [`[${input.sourceLabel}]null[${out}]`], outputLabel: out, notes }
  }
  if (!lumaQ && !hslQ) {
    notes.push('Program grade without qualifier.')
    return { chains: [`[${input.sourceLabel}]${grade.join(',')}[${out}]`], outputLabel: out, notes }
  }
  const cover = hslQ
    ? hslQualifierCoverageExpr(readHslQualifier(hslQ), 'script')
    : lumaQualifierCoverageExpr(readLumaQualifier(lumaQ), 'script')
  const src = input.nextLabel('csrc')
  const grd = input.nextLabel('cgrd')
  const msk = input.nextLabel('cmsk')
  const graded = input.nextLabel('cgraded')
  const mask = input.nextLabel('cmask')
  const gradeChain = grade.join(',') || 'null'
  notes.push(hslQ ? 'HSL qualifier via maskedmerge geq.' : 'Luma qualifier via maskedmerge (filter_complex_script, unescaped X,Y).')
  return {
    chains: [
      `[${input.sourceLabel}]split=3[${src}][${grd}][${msk}]`,
      `[${grd}]${gradeChain}[${graded}]`,
      `[${msk}]format=${hslQ ? 'rgba' : 'gray'},geq=${hslQ ? `r='255*${cover}':g='255*${cover}':b='255*${cover}'` : `lum='255*${cover}'`}[${mask}]`,
      `[${src}][${graded}][${mask}]maskedmerge,format=yuv420p[${out}]`,
    ],
    outputLabel: out,
    notes,
  }
}

function eqFilters(inserts: AudioInsert[]): string[] {
  const out: string[] = []
  for (const ins of inserts) {
    if (!ins.enabled) continue
    if (ins.kind === 'eq') {
      if (ins.highpassHz && ins.highpassHz > 0) out.push(`highpass=f=${ins.highpassHz}`)
      if (ins.lowpassHz && ins.lowpassHz > 0) out.push(`lowpass=f=${ins.lowpassHz}`)
      for (const band of ins.bands) {
        out.push(`equalizer=f=${band.frequencyHz}:t=q:w=${band.q}:g=${band.gainDb}`)
      }
    }
    if (ins.kind === 'compressor') {
      const makeup = typeof ins.makeupDb === 'number' ? `:makeup=${ins.makeupDb}dB` : ''
      out.push(`acompressor=threshold=${ins.thresholdDb}dB:ratio=${ins.ratio}:attack=${ins.attackMs}:release=${ins.releaseMs}${makeup}`)
    }
    if (ins.kind === 'limiter') {
      const linear = Math.max(0.05, Math.min(1, 10 ** (ins.ceilingDb / 20)))
      out.push(`alimiter=limit=${linear.toFixed(4)}:level=0:attack=7:release=50:level_in=1:level_out=1`)
    }
    if (ins.kind === 'gate') {
      out.push(`agate=threshold=${ins.thresholdDb}dB:attack=${ins.attackMs}:release=${ins.releaseMs}`)
    }
    if (ins.kind === 'delay') {
      out.push(`aecho=0.8:0.9:${ins.delaysMs}:${ins.decays}`)
    }
    if (ins.kind === 'reverb') {
      out.push(`aecho=0.8:0.88:${ins.delaysMs}|${Math.round(ins.delaysMs * 1.7)}:${ins.decays}|${(ins.decays * 0.6).toFixed(3)}`)
    }
  }
  return out
}

function panFilter(pan: number): string {
  const p = Math.max(-1, Math.min(1, pan))
  const left = ((1 - p) / 2).toFixed(4)
  const right = ((1 + p) / 2).toFixed(4)
  return `pan=stereo|c0=${left}*c0+${left}*c1|c1=${right}*c0+${right}*c1`
}

function volumeAutomationExpr(graph: AudioGraph, channelId: string): string | null {
  const lane = graph.automation.find(a => a.target === channelId && a.param === 'volume')
  if (!lane || lane.keyframes.length < 2) return null
  const kfs = [...lane.keyframes].sort((a, b) => (a.time.ticks / a.time.timescale) - (b.time.ticks / b.time.timescale))
  let expr = String(kfs[kfs.length - 1].value)
  for (let i = kfs.length - 2; i >= 0; i--) {
    const t0 = kfs[i].time.ticks / Math.max(1, kfs[i].time.timescale)
    const t1 = kfs[i + 1].time.ticks / Math.max(1, kfs[i + 1].time.timescale)
    const v0 = kfs[i].value
    const v1 = kfs[i + 1].value
    const dur = Math.max(0.001, t1 - t0)
    const lerp = `${v0}+(${v1}-${v0})*(t-${t0})/${dur}`
    expr = `if(lt(t,${t1}),${i === 0 ? `if(lt(t,${t0}),${v0},${lerp})` : lerp},${expr})`
  }
  return `volume='${expr}':eval=frame`
}

function panAutomationGains(graph: AudioGraph, channelId: string): { left: string; right: string } | null {
  const lane = graph.automation.find(a => a.target === channelId && a.param === 'pan')
  if (!lane || lane.keyframes.length < 2) return null
  const kfs = [...lane.keyframes].sort((a, b) => (a.time.ticks / a.time.timescale) - (b.time.ticks / b.time.timescale))
  const panExpr = (side: 'L' | 'R') => {
    let expr = String(side === 'L' ? (1 - kfs[kfs.length - 1].value) / 2 : (1 + kfs[kfs.length - 1].value) / 2)
    for (let i = kfs.length - 2; i >= 0; i--) {
      const t0 = kfs[i].time.ticks / Math.max(1, kfs[i].time.timescale)
      const t1 = kfs[i + 1].time.ticks / Math.max(1, kfs[i + 1].time.timescale)
      const v0 = side === 'L' ? (1 - kfs[i].value) / 2 : (1 + kfs[i].value) / 2
      const v1 = side === 'L' ? (1 - kfs[i + 1].value) / 2 : (1 + kfs[i + 1].value) / 2
      const dur = Math.max(0.001, t1 - t0)
      const lerp = `${v0.toFixed(4)}+(${(v1 - v0).toFixed(4)})*(t-${t0})/${dur}`
      expr = `if(lt(t,${t1}),${i === 0 ? `if(lt(t,${t0}),${v0.toFixed(4)},${lerp})` : lerp},${expr})`
    }
    return expr
  }
  return { left: panExpr('L'), right: panExpr('R') }
}

export function lowerAudioGraphAfterClips(input: {
  graph: AudioGraph
  clipSignals: Array<{ trackId: string; label: string }>
  duration: number
  nextLabel: (prefix: string) => string
}): { ok: true; chains: string[]; outputLabel: string; notes: string[] } | { ok: false; error: string } {
  const notes = [
    'Signal order: clip processing → track channel → submix → master.',
    'Limiter: alimiter limit=linear level=0 (Wave-3 auto-level must stay off).',
    'Automation from persisted rational keys. Not UI state.',
  ]
  const solos = input.graph.channels.filter(ch => ch.solo)
  const chains: string[] = []
  const built: Array<{ id: string; label: string; busId: string }> = []
  for (const ch of input.graph.channels) {
    const matching = input.clipSignals.filter(s => s.trackId === ch.trackId)
    if (!matching.length) continue
    const mixedSrc = matching.length === 1
      ? matching[0].label
      : (() => {
        const mix = input.nextLabel('atrk')
        chains.push(`${matching.map(s => `[${s.label}]`).join('')}amix=inputs=${matching.length}:duration=longest:normalize=0[${mix}]`)
        return mix
      })()
    const parts: string[] = []
    const mutedBySolo = solos.length > 0 && !ch.solo
    if (ch.mute || mutedBySolo) parts.push('volume=0')
    else {
      parts.push(...eqFilters(ch.inserts))
      if (ch.volume !== 1) parts.push(`volume=${ch.volume}`)
      if (ch.pan !== 0 && !panAutomationGains(input.graph, ch.id)) parts.push(panFilter(ch.pan))
      const auto = volumeAutomationExpr(input.graph, ch.id)
      if (auto) parts.push(auto)
    }
    const chain = parts.filter(Boolean).join(',') || 'anull'
    const panAuto = !ch.mute && !mutedBySolo ? panAutomationGains(input.graph, ch.id) : null
    let chOut = input.nextLabel('ach')
    if (panAuto) {
      const pre = input.nextLabel('apre')
      const L = input.nextLabel('aL')
      const R = input.nextLabel('aR')
      const L2 = input.nextLabel('aL2')
      const R2 = input.nextLabel('aR2')
      chains.push(`[${mixedSrc}]${chain}[${pre}]`)
      chains.push(`[${pre}]channelsplit=channel_layout=stereo[${L}][${R}]`)
      chains.push(`[${L}]volume='${panAuto.left}':eval=frame[${L2}]`)
      chains.push(`[${R}]volume='${panAuto.right}':eval=frame[${R2}]`)
      chains.push(`[${L2}][${R2}]join=inputs=2:channel_layout=stereo[${chOut}]`)
    } else {
      chains.push(`[${mixedSrc}]${chain}[${chOut}]`)
    }
    built.push({ id: ch.id, label: chOut, busId: ch.outputBusId })
  }
  if (!built.length) return { ok: false, error: 'AudioGraph is active but no channel matched a timeline track with clips.' }
  chains.push(...finishBuses(input, built, notes))
  return { ok: true, chains, outputLabel: 'aout', notes }
}

function finishBuses(
  input: { graph: AudioGraph; duration: number; nextLabel: (prefix: string) => string },
  channels: Array<{ id: string; label: string; busId: string }>,
  notes: string[],
): string[] {
  const chains: string[] = []
  const byBus = new Map<string, string[]>()
  for (const ch of channels) {
    const list = byBus.get(ch.busId) ?? []
    list.push(ch.label)
    byBus.set(ch.busId, list)
  }
  const busOut = new Map<string, string>()
  const submixes = input.graph.buses.filter(b => b.kind === 'submix')
  const master = input.graph.buses.find(b => b.kind === 'master')
  for (const bus of submixes) {
    const fromChannels = byBus.get(bus.id) ?? []
    const fromBuses = bus.inputs.map(id => busOut.get(id)).filter((x): x is string => Boolean(x))
    const labels = [...fromChannels, ...fromBuses]
    if (!labels.length) continue
    let mixed = labels[0]
    if (labels.length > 1) {
      const mix = input.nextLabel('abus')
      chains.push(`${labels.map(l => `[${l}]`).join('')}amix=inputs=${labels.length}:duration=longest:normalize=0[${mix}]`)
      mixed = mix
    }
    const parts = [...eqFilters(bus.inserts)]
    if (bus.mute) parts.push('volume=0')
    else if (bus.volume !== 1) parts.push(`volume=${bus.volume}`)
    const out = input.nextLabel('asub')
    chains.push(`[${mixed}]${parts.filter(Boolean).join(',') || 'anull'}[${out}]`)
    busOut.set(bus.id, out)
    notes.push(`Submix ${bus.id} volume=${bus.volume}`)
  }
  const masterInputs: string[] = []
  if (master) {
    for (const id of master.inputs) {
      if (busOut.has(id)) masterInputs.push(busOut.get(id)!)
      else {
        const chs = channels.filter(c => c.id === id || c.busId === master.id)
        for (const ch of chs) if (!masterInputs.includes(ch.label)) masterInputs.push(ch.label)
      }
    }
    for (const ch of channels) {
      if (ch.busId === master.id && !masterInputs.includes(ch.label)) masterInputs.push(ch.label)
    }
  }
  if (!masterInputs.length) {
    masterInputs.push(...channels.map(c => c.label))
  }
  let mixed = masterInputs[0]
  if (masterInputs.length > 1) {
    const mix = input.nextLabel('amix')
    chains.push(`${masterInputs.map(l => `[${l}]`).join('')}amix=inputs=${masterInputs.length}:duration=longest:normalize=0[${mix}]`)
    mixed = mix
  }
  const post: string[] = []
  if (master && !master.mute) {
    post.push(...eqFilters(master.inserts))
    if (master.volume !== 1) post.push(`volume=${master.volume}`)
    if (master.pan !== 0) post.push(panFilter(master.pan))
  } else if (master?.mute) {
    post.push('volume=0')
  }
  post.push(`apad=whole_dur=${input.duration}`)
  chains.push(`[${mixed}]${post.filter(Boolean).join(',')}[aout]`)
  return chains
}
