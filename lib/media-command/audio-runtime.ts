/**
 * AudioGraph FFmpeg execution. Clip volume/pan/fade/duck remain first in the chain.
 * Signal order: clip → track channel → submix → master → render
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import type { AudioGraph, AudioInsert, AudioMeterSample } from './audio-graph'
import { measuredMeter } from './audio-graph'
import { fromSeconds } from './time'
import { resolveFfmpegTools, runProcess } from './ffmpeg'
import { probeMediaFile } from './probe'
import { createHvsJob, markJobCompleted, markJobFailed, markJobRunning, saveJob, type HvsJob } from './jobs'
import { mediaCommandDataHierarchy } from './paths'
import { HVS_WAVE2_LOCAL_ENGINE_EXECUTION_AUTHORIZED } from './policy'

export type AudioRenderRequest = {
  projectId: string
  sourcePath: string
  graph: AudioGraph
  channelId?: string
  clipVolume?: number
  clipPan?: number
}

export type AudioBandEnergy = { low: number; mid: number; high: number }

export type AudioExecuteResult = {
  job: HvsJob
  outputPath: string | null
  meters: AudioMeterSample[]
  leftRms: number
  rightRms: number
  peak: number
  rms: number
  bands: AudioBandEnergy | null
  durationMs: number
  filter: string | null
  error: string | null
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
      // alimiter `limit` is linear amplitude 0..1 (0 dBFS = 1).
      // `level` defaults to auto-level ON, which defeated Wave-3 ceiling proofs.
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

export const AUTOMATION_INTERPOLATION = 'linear' as const

export function interpolateAutomation(lane: { keyframes: Array<{ time: { ticks: number; timescale: number }; value: number }> }, tSec: number): number {
  const kfs = [...lane.keyframes].sort((a, b) => (a.time.ticks / a.time.timescale) - (b.time.ticks / b.time.timescale))
  if (!kfs.length) return 0
  if (tSec <= kfs[0].time.ticks / kfs[0].time.timescale) return kfs[0].value
  const last = kfs[kfs.length - 1]
  if (tSec >= last.time.ticks / last.time.timescale) return last.value
  for (let i = 0; i < kfs.length - 1; i++) {
    const t0 = kfs[i].time.ticks / Math.max(1, kfs[i].time.timescale)
    const t1 = kfs[i + 1].time.ticks / Math.max(1, kfs[i + 1].time.timescale)
    if (tSec <= t1) {
      const u = (tSec - t0) / Math.max(0.001, t1 - t0)
      return kfs[i].value + (kfs[i + 1].value - kfs[i].value) * u
    }
  }
  return last.value
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
      expr = `if(lt(t\\,${t1})\\,${i === 0 ? `if(lt(t\\,${t0})\\,${v0.toFixed(4)}\\,${lerp})` : lerp}\\,${expr})`
    }
    return expr
  }
  return { left: panExpr('L'), right: panExpr('R') }
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
    expr = `if(lt(t\\,${t1})\\,${i === 0 ? `if(lt(t\\,${t0})\\,${v0}\\,${lerp})` : lerp}\\,${expr})`
  }
  return `volume='${expr}':eval=frame`
}

export function audioGraphToFfmpeg(input: {
  graph: AudioGraph
  channelId?: string
  clipVolume?: number
  clipPan?: number
  includeBuses?: boolean
}): { filter: string; notes: string[]; panAutomation: { left: string; right: string } | null } {
  const notes = ['Signal order: clip → track channel → submix → master → render', `Automation interpolation: ${AUTOMATION_INTERPOLATION}`]
  const parts: string[] = []
  const clipVol = input.clipVolume ?? 1
  const clipPan = input.clipPan ?? 0
  if (clipVol !== 1) parts.push(`volume=${clipVol}`)
  if (clipPan !== 0) parts.push(panFilter(clipPan))
  const solos = input.graph.channels.filter(ch => ch.solo)
  const channel = input.graph.channels.find(ch => ch.id === input.channelId) ?? input.graph.channels[0]
  if (!channel) return { filter: parts.join(','), notes, panAutomation: null }
  const panAuto = panAutomationGains(input.graph, channel.id)
  const mutedBySolo = solos.length > 0 && !channel.solo
  if (channel.mute || mutedBySolo) {
    parts.push('volume=0')
    notes.push(channel.mute ? 'Channel muted.' : 'Channel silenced because another channel is solo.')
  } else {
    parts.push(...eqFilters(channel.inserts))
    if (channel.volume !== 1) parts.push(`volume=${channel.volume}`)
    if (!panAuto && channel.pan !== 0) parts.push(panFilter(channel.pan))
    const auto = volumeAutomationExpr(input.graph, channel.id)
    if (auto) parts.push(auto)
  }
  if (input.includeBuses !== false) {
    const outBus = input.graph.buses.find(b => b.id === channel.outputBusId)
    if (outBus && outBus.kind === 'submix' && !outBus.mute) {
      parts.push(...eqFilters(outBus.inserts))
      if (outBus.volume !== 1) parts.push(`volume=${outBus.volume}`)
      notes.push(`Submix ${outBus.id} volume=${outBus.volume}`)
    }
    const master = input.graph.buses.find(b => b.kind === 'master')
    if (master && !master.mute) {
      parts.push(...eqFilters(master.inserts))
      if (master.volume !== 1) parts.push(`volume=${master.volume}`)
      if (master.pan !== 0) parts.push(panFilter(master.pan))
    } else if (master?.mute) {
      parts.push('volume=0')
    }
  }
  return { filter: parts.filter(Boolean).join(',') || 'anull', notes, panAutomation: panAuto }
}

export function firstWave2AudioGraph(trackId = 'A1'): AudioGraph {
  return {
    schemaVersion: 1,
    channels: [{
      id: 'ch-A1',
      trackId,
      volume: 1,
      pan: 0,
      mute: false,
      solo: false,
      inserts: [{
        kind: 'eq',
        enabled: true,
        highpassHz: 180,
        lowpassHz: null,
        bands: [{ frequencyHz: 1000, gainDb: -4, q: 1.2 }],
      }],
      outputBusId: 'bus-master',
    }],
    buses: [{
      id: 'bus-master',
      kind: 'master',
      inputs: ['ch-A1'],
      volume: 1,
      pan: 0,
      mute: false,
      solo: false,
      inserts: [],
    }],
    automation: [],
  }
}

async function decodeStereo(ffmpeg: string, file: string): Promise<{ left: Float32Array; right: Float32Array } | null> {
  const dir = path.join(mediaCommandDataHierarchy().tmp, 'hvs-wave2-audio')
  mkdirSync(dir, { recursive: true })
  const raw = path.join(dir, `pcm-${process.pid}-${path.basename(file)}.s16`)
  const run = await runProcess(ffmpeg, [
    '-hide_banner', '-y', '-i', file, '-ac', '2', '-ar', '8000', '-f', 's16le', raw,
  ], 60_000)
  if (!run.ok || !existsSync(raw)) return null
  const buf = readFileSync(raw)
  try { unlinkSync(raw) } catch { /* tmp */ }
  const frames = Math.floor(buf.length / 4)
  const left = new Float32Array(frames)
  const right = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    left[i] = buf.readInt16LE(i * 4) / 32768
    right[i] = buf.readInt16LE(i * 4 + 2) / 32768
  }
  return { left, right }
}

async function bandRms(ffmpeg: string, file: string, low: number, high: number): Promise<number> {
  const dir = path.join(mediaCommandDataHierarchy().tmp, 'hvs-wave2-audio')
  mkdirSync(dir, { recursive: true })
  const raw = path.join(dir, `band-${low}-${high}-${process.pid}.s16`)
  const run = await runProcess(ffmpeg, [
    '-hide_banner', '-y', '-i', file, '-ac', '1', '-ar', '8000', '-af', `highpass=f=${low},lowpass=f=${high}`, '-f', 's16le', raw,
  ], 60_000)
  if (!run.ok || !existsSync(raw)) return 0
  const buf = readFileSync(raw)
  try { unlinkSync(raw) } catch { /* tmp */ }
  let sum = 0
  const n = Math.floor(buf.length / 2)
  for (let i = 0; i < n; i++) {
    const s = buf.readInt16LE(i * 2) / 32768
    sum += s * s
  }
  return n ? Math.sqrt(sum / n) : 0
}

export function firstWave3AudioGraph(trackA = 'A1', trackB = 'A2'): AudioGraph {
  return {
    schemaVersion: 1,
    channels: [
      {
        id: 'ch-A',
        trackId: trackA,
        volume: 1,
        pan: -0.8,
        mute: false,
        solo: false,
        inserts: [{
          kind: 'eq',
          enabled: true,
          highpassHz: 80,
          lowpassHz: null,
          bands: [{ frequencyHz: 1000, gainDb: 0, q: 1 }],
        }],
        outputBusId: 'bus-master',
      },
      {
        id: 'ch-B',
        trackId: trackB,
        volume: 1,
        pan: 0.8,
        mute: false,
        solo: false,
        inserts: [],
        outputBusId: 'bus-master',
      },
    ],
    buses: [{
      id: 'bus-master',
      kind: 'master',
      inputs: ['ch-A', 'ch-B'],
      volume: 1,
      pan: 0,
      mute: false,
      solo: false,
      inserts: [],
    }],
    automation: [],
  }
}

export function firstWave4AudioGraph(trackA = 'A1', trackB = 'A2'): AudioGraph {
  const base = firstWave3AudioGraph(trackA, trackB)
  return {
    ...base,
    channels: base.channels.map(ch => ({ ...ch, outputBusId: 'bus-dialogue' })),
    buses: [
      {
        id: 'bus-dialogue',
        kind: 'submix',
        inputs: ['ch-A', 'ch-B'],
        volume: 1,
        pan: 0,
        mute: false,
        solo: false,
        inserts: [],
      },
      {
        id: 'bus-master',
        kind: 'master',
        inputs: ['bus-dialogue'],
        volume: 1,
        pan: 0,
        mute: false,
        solo: false,
        inserts: [{ kind: 'limiter', enabled: true, ceilingDb: -6 }],
      },
    ],
  }
}

export function crestFactor(peak: number, rms: number): number {
  return rms > 1e-8 ? peak / rms : 0
}

export const LIMITER_DIAGNOSIS = {
  filter: 'alimiter',
  wave3Failure: 'limit=-6dB with default level=auto raised output; peak stayed ~0.83 instead of ~0.501.',
  semantics: 'alimiter limit is linear 0..1 (1 = 0 dBFS). level defaults to ON (auto-level).',
  repair: 'alimiter=limit=0.5012:level=0:attack=7:release=50:level_in=1:level_out=1',
  interpolation: AUTOMATION_INTERPOLATION,
}

export async function executeAudioMix(input: {
  projectId: string
  sourceA: string
  sourceB: string
  graph: AudioGraph
}): Promise<AudioExecuteResult> {
  const started = Date.now()
  let job = saveJob(createHvsJob({
    kind: 'audio',
    projectId: input.projectId,
    backend: 'ffmpeg-audiograph-mix',
    status: 'QUEUED',
    inputs: { sourceA: path.basename(input.sourceA), sourceB: path.basename(input.sourceB) },
    provenance: { createdBy: 'system', notes: 'Wave 3 two-channel AudioGraph mix.' },
  }))
  const fail = (error: string): AudioExecuteResult => ({
    job, outputPath: null, meters: [], leftRms: 0, rightRms: 0, peak: 0, rms: 0, bands: null,
    durationMs: Date.now() - started, filter: null, error,
  })
  if (!HVS_WAVE2_LOCAL_ENGINE_EXECUTION_AUTHORIZED) {
    job = markJobFailed(job, 'Local audio execution is not authorized.')
    return fail(job.error ?? 'unauthorized')
  }
  const tools = await resolveFfmpegTools()
  if (!tools.ffmpeg || !existsSync(input.sourceA) || !existsSync(input.sourceB)) {
    job = markJobFailed(job, 'ffmpeg or mix sources missing.')
    return fail(job.error ?? 'missing')
  }
  const a = audioGraphToFfmpeg({ graph: input.graph, channelId: input.graph.channels[0]?.id, includeBuses: false })
  const b = audioGraphToFfmpeg({ graph: input.graph, channelId: input.graph.channels[1]?.id, includeBuses: false })
  const submix = input.graph.buses.find(bus => bus.kind === 'submix')
  const master = input.graph.buses.find(bus => bus.kind === 'master')
  const post: string[] = []
  if (submix && !submix.mute) {
    if (submix.volume !== 1) post.push(`volume=${submix.volume}`)
    post.push(...eqFilters(submix.inserts))
  }
  if (master && !master.mute) {
    post.push(...eqFilters(master.inserts))
    if (master.volume !== 1) post.push(`volume=${master.volume}`)
  }
  const postFilter = post.length ? `,${post.join(',')}` : ''
  const dir = path.join(mediaCommandDataHierarchy().tmp, 'hvs-wave3-audio')
  mkdirSync(dir, { recursive: true })
  const outputPath = path.join(dir, `${job.id}-mix.wav`)
  job = markJobRunning(job)
  const filter = `[0:a]${a.filter}[a];[1:a]${b.filter}[b];[a][b]amix=inputs=2:duration=longest:normalize=0${postFilter}[out]`
  const run = await runProcess(tools.ffmpeg, [
    '-hide_banner', '-y', '-i', input.sourceA, '-i', input.sourceB,
    '-filter_complex', filter, '-map', '[out]', '-ar', '48000', '-ac', '2', outputPath,
  ], 120_000)
  if (!run.ok || !existsSync(outputPath)) {
    job = markJobFailed(job, run.stderr.slice(-400) || 'Two-channel mix failed.')
    return fail(job.error ?? 'ffmpeg')
  }
  const stereo = await decodeStereo(tools.ffmpeg, outputPath)
  const leftRms = stereo ? Math.sqrt(stereo.left.reduce((s, v) => s + v * v, 0) / Math.max(1, stereo.left.length)) : 0
  const rightRms = stereo ? Math.sqrt(stereo.right.reduce((s, v) => s + v * v, 0) / Math.max(1, stereo.right.length)) : 0
  const mix = stereo ? Float32Array.from({ length: stereo.left.length }, (_, i) => 0.5 * (stereo.left[i] + stereo.right[i])) : null
  const meter = measuredMeter(mix, 'mix', fromSeconds(0), fromSeconds(1))
  const bands: AudioBandEnergy = {
    low: await bandRms(tools.ffmpeg, outputPath, 20, 250),
    mid: await bandRms(tools.ffmpeg, outputPath, 250, 2000),
    high: await bandRms(tools.ffmpeg, outputPath, 2000, 8000),
  }
  job = markJobCompleted(job, {
    outputPath, validState: true, filter, leftRms, rightRms, peak: meter?.peak ?? 0, rms: meter?.rms ?? 0, bands,
  })
  job.metrics = { ...job.metrics, executionDurationMs: Date.now() - started }
  job = saveJob(job)
  return {
    job, outputPath, meters: meter ? [meter] : [], leftRms, rightRms,
    peak: meter?.peak ?? 0, rms: meter?.rms ?? 0, bands,
    durationMs: Date.now() - started, filter, error: null,
  }
}

export async function windowedRms(ffmpeg: string, file: string, startSec: number, durSec: number): Promise<number> {
  const dir = path.join(mediaCommandDataHierarchy().tmp, 'hvs-wave3-audio')
  mkdirSync(dir, { recursive: true })
  const raw = path.join(dir, `win-${process.pid}-${startSec}.s16`)
  const run = await runProcess(ffmpeg, [
    '-hide_banner', '-y', '-ss', String(startSec), '-t', String(durSec), '-i', file,
    '-ac', '1', '-ar', '8000', '-f', 's16le', raw,
  ], 30_000)
  if (!run.ok || !existsSync(raw)) return 0
  const buf = readFileSync(raw)
  try { unlinkSync(raw) } catch { /* tmp */ }
  let sum = 0
  const n = Math.floor(buf.length / 2)
  for (let i = 0; i < n; i++) {
    const s = buf.readInt16LE(i * 2) / 32768
    sum += s * s
  }
  return n ? Math.sqrt(sum / n) : 0
}

export async function executeAudioGraph(input: AudioRenderRequest): Promise<AudioExecuteResult> {
  const started = Date.now()
  let job = saveJob(createHvsJob({
    kind: 'audio',
    projectId: input.projectId,
    backend: 'ffmpeg-audiograph',
    status: 'QUEUED',
    inputs: { source: path.basename(input.sourcePath) },
    provenance: { createdBy: 'system', notes: 'Wave 2 AudioGraph render.' },
  }))
  const fail = (error: string): AudioExecuteResult => ({
    job, outputPath: null, meters: [], leftRms: 0, rightRms: 0, peak: 0, rms: 0, bands: null,
    durationMs: Date.now() - started, filter: null, error,
  })
  if (!HVS_WAVE2_LOCAL_ENGINE_EXECUTION_AUTHORIZED) {
    job = markJobFailed(job, 'Local audio execution is not authorized.')
    return fail(job.error ?? 'unauthorized')
  }
  const tools = await resolveFfmpegTools()
  if (!tools.ffmpeg || !existsSync(input.sourcePath)) {
    job = markJobFailed(job, 'ffmpeg or source missing.')
    return fail(job.error ?? 'missing')
  }
  const lowered = audioGraphToFfmpeg(input)
  job = markJobRunning(job)
  const dir = path.join(mediaCommandDataHierarchy().tmp, 'hvs-wave2-audio')
  mkdirSync(dir, { recursive: true })
  const outputPath = path.join(dir, `${job.id}.wav`)
  const run = lowered.panAutomation
    ? await runProcess(tools.ffmpeg, [
      '-hide_banner', '-y', '-i', input.sourcePath, '-vn',
      '-filter_complex', `[0:a]${lowered.filter},channelsplit=channel_layout=stereo[L][R];[L]volume='${lowered.panAutomation.left}':eval=frame[L2];[R]volume='${lowered.panAutomation.right}':eval=frame[R2];[L2][R2]join=inputs=2:channel_layout=stereo[out]`,
      '-map', '[out]', '-ar', '48000', '-ac', '2', outputPath,
    ], 120_000)
    : await runProcess(tools.ffmpeg, [
      '-hide_banner', '-y', '-i', input.sourcePath, '-vn', '-af', lowered.filter, '-ar', '48000', '-ac', '2', outputPath,
    ], 120_000)
  if (!run.ok || !existsSync(outputPath)) {
    job = markJobFailed(job, run.stderr.slice(-400) || 'AudioGraph ffmpeg failed.')
    return fail(job.error ?? 'ffmpeg')
  }
  const stereo = await decodeStereo(tools.ffmpeg, outputPath)
  const leftRms = stereo ? Math.sqrt(stereo.left.reduce((s, v) => s + v * v, 0) / Math.max(1, stereo.left.length)) : 0
  const rightRms = stereo ? Math.sqrt(stereo.right.reduce((s, v) => s + v * v, 0) / Math.max(1, stereo.right.length)) : 0
  const mix = stereo ? Float32Array.from({ length: stereo.left.length }, (_, i) => 0.5 * (stereo.left[i] + stereo.right[i])) : null
  const meter = measuredMeter(mix, input.channelId ?? 'ch-A1', fromSeconds(0), fromSeconds(1))
  const bands: AudioBandEnergy = {
    low: await bandRms(tools.ffmpeg, outputPath, 20, 250),
    mid: await bandRms(tools.ffmpeg, outputPath, 250, 2000),
    high: await bandRms(tools.ffmpeg, outputPath, 2000, 8000),
  }
  const probe = await probeMediaFile(outputPath)
  job = markJobCompleted(job, {
    outputPath,
    validState: true,
    filter: lowered.filter,
    leftRms,
    rightRms,
    peak: meter?.peak ?? 0,
    rms: meter?.rms ?? 0,
    bands,
    probe: { durationSec: probe.durationSec, channels: probe.channels, sampleRate: probe.sampleRate },
  })
  job.metrics = { ...job.metrics, executionDurationMs: Date.now() - started }
  job = saveJob(job)
  return {
    job,
    outputPath,
    meters: meter ? [meter] : [],
    leftRms,
    rightRms,
    peak: meter?.peak ?? 0,
    rms: meter?.rms ?? 0,
    bands,
    durationMs: Date.now() - started,
    filter: lowered.filter,
    error: null,
  }
}
