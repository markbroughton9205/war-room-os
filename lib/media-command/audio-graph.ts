/**
 * HVS AudioGraph — track/bus semantics on the SAME project timeline.
 * Clip-level volume / pan / fade / duck remain authoritative for clip processing.
 *
 * Signal order:
 *   clip processing (volume, pan, fade, duck)
 *   → track channel (mute/solo/volume/pan + inserts)
 *   → submix bus
 *   → master
 *   → render
 */
import type { MediaTime } from './time'
import { zeroTime } from './time'
import type { HvsProject } from './types'

export const AUDIO_GRAPH_SCHEMA = 1 as const

export type AudioInsertEq = {
  kind: 'eq'
  enabled: boolean
  highpassHz: number | null
  lowpassHz: number | null
  bands: Array<{ frequencyHz: number; gainDb: number; q: number }>
}

export type AudioInsertCompressor = {
  kind: 'compressor'
  enabled: boolean
  thresholdDb: number
  ratio: number
  attackMs: number
  releaseMs: number
  makeupDb?: number
}

export type AudioInsertLimiter = {
  kind: 'limiter'
  enabled: boolean
  ceilingDb: number
}

export type AudioInsertGate = {
  kind: 'gate'
  enabled: boolean
  thresholdDb: number
  attackMs: number
  releaseMs: number
}

export type AudioInsertDelay = {
  kind: 'delay'
  enabled: boolean
  delaysMs: number
  decays: number
}

export type AudioInsertReverb = {
  kind: 'reverb'
  enabled: boolean
  delaysMs: number
  decays: number
}

export type AudioInsert = AudioInsertEq | AudioInsertCompressor | AudioInsertLimiter | AudioInsertGate | AudioInsertDelay | AudioInsertReverb

export type AudioChannel = {
  id: string
  trackId: string
  volume: number
  pan: number
  mute: boolean
  solo: boolean
  inserts: AudioInsert[]
  outputBusId: string
}

export type AudioBus = {
  id: string
  kind: 'submix' | 'master'
  inputs: string[]
  volume: number
  pan: number
  mute: boolean
  solo: boolean
  inserts: AudioInsert[]
}

export type AudioAutomation = {
  target: string
  param: 'volume' | 'pan'
  keyframes: Array<{ time: MediaTime; value: number }>
}

export type AudioGraph = {
  schemaVersion: typeof AUDIO_GRAPH_SCHEMA
  channels: AudioChannel[]
  buses: AudioBus[]
  automation: AudioAutomation[]
  loudnessTargetLufs?: number | null
}

export type AudioMeterSample = {
  channelId: string
  peak: number
  rms: number
  windowStart: MediaTime
  windowEnd: MediaTime
}

export const AUDIO_SIGNAL_ORDER = 'clip → track channel → submix → master → render'

export function emptyAudioGraph(project?: Pick<HvsProject, 'timeline'> | null): AudioGraph {
  const master: AudioBus = {
    id: 'bus-master',
    kind: 'master',
    inputs: [],
    volume: 1,
    pan: 0,
    mute: false,
    solo: false,
    inserts: [],
  }
  const channels: AudioChannel[] = []
  if (project) {
    for (const track of project.timeline.tracks) {
      if (track.kind !== 'audio' && track.kind !== 'video') continue
      const id = `ch-${track.id}`
      channels.push({
        id,
        trackId: track.id,
        volume: 1,
        pan: 0,
        mute: track.muted,
        solo: track.solo,
        inserts: [],
        outputBusId: 'bus-master',
      })
      master.inputs.push(id)
    }
  }
  return { schemaVersion: AUDIO_GRAPH_SCHEMA, channels, buses: [master], automation: [] }
}

export type AudioGraphValidation = { ok: boolean; errors: string[] }

export function validateAudioGraph(graph: AudioGraph, trackIds?: Set<string>): AudioGraphValidation {
  const errors: string[] = []
  try {
    if (!graph || graph.schemaVersion !== AUDIO_GRAPH_SCHEMA) errors.push('Unknown audio graph schema.')
    const busIds = new Set((graph.buses ?? []).map(b => b.id))
    const masters = (graph.buses ?? []).filter(b => b.kind === 'master')
    if (masters.length !== 1) errors.push('AudioGraph requires exactly one master bus.')
    const channelIds = new Set<string>()
    for (const ch of graph.channels ?? []) {
      if (channelIds.has(ch.id)) errors.push(`Duplicate channel ${ch.id}.`)
      channelIds.add(ch.id)
      if (trackIds && !trackIds.has(ch.trackId)) errors.push(`Channel ${ch.id} references missing track ${ch.trackId}.`)
      if (!busIds.has(ch.outputBusId)) errors.push(`Channel ${ch.id} output bus ${ch.outputBusId} missing.`)
      if (!Number.isFinite(ch.volume) || ch.volume < 0 || ch.volume > 4) errors.push(`Channel ${ch.id} volume out of range.`)
      if (!Number.isFinite(ch.pan) || ch.pan < -1 || ch.pan > 1) errors.push(`Channel ${ch.id} pan out of range.`)
      for (const ins of ch.inserts ?? []) errors.push(...validateAudioInsert(ins, ch.id))
    }
    const nodeIds = new Set<string>([...channelIds, ...busIds])
    const adj = new Map<string, string[]>()
    for (const id of nodeIds) adj.set(id, [])
    for (const ch of graph.channels ?? []) {
      if (busIds.has(ch.outputBusId)) adj.get(ch.id)?.push(ch.outputBusId)
    }
    for (const bus of graph.buses ?? []) {
      for (const inputId of bus.inputs ?? []) {
        if (!nodeIds.has(inputId)) errors.push(`Bus ${bus.id} input ${inputId} missing.`)
        if (inputId === bus.id) errors.push(`Bus ${bus.id} cycle: feeds itself.`)
        adj.get(inputId)?.push(bus.id)
      }
      for (const ins of bus.inserts ?? []) errors.push(...validateAudioInsert(ins, bus.id))
      if (!Number.isFinite(bus.volume) || bus.volume < 0 || bus.volume > 4) errors.push(`Bus ${bus.id} volume out of range.`)
    }
    if (hasAudioCycle(adj)) errors.push('AudioGraph bus routing cycle rejected.')
    for (const lane of graph.automation ?? []) {
      if (lane.param !== 'volume' && lane.param !== 'pan') errors.push(`Unknown automation param ${String(lane.param)}.`)
      for (const kf of lane.keyframes) {
        if (!kf.time || !Number.isFinite(kf.value) || Number.isNaN(kf.value)) errors.push('Automation keyframe missing rational time or finite value.')
        if (lane.param === 'volume' && Number.isFinite(kf.value) && (kf.value < 0 || kf.value > 4)) errors.push('Automation volume keyframe out of range.')
        if (lane.param === 'pan' && Number.isFinite(kf.value) && (kf.value < -1 || kf.value > 1)) errors.push('Automation pan keyframe out of range.')
      }
      const times = lane.keyframes.map(kf => kf.time.ticks / Math.max(1, kf.time.timescale))
      for (let i = 1; i < times.length; i++) {
        if (times[i] < times[i - 1]) errors.push('Automation keyframes must be in time order.')
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Audio graph validation failed.')
  }
  return { ok: errors.length === 0, errors }
}

function validateAudioInsert(ins: AudioInsert, ownerId: string): string[] {
  if (ins.kind === 'eq') {
    if (ins.highpassHz != null && (!Number.isFinite(ins.highpassHz) || ins.highpassHz < 0 || ins.highpassHz > 20000)) {
      return [`${ownerId} EQ highpass invalid.`]
    }
    if (ins.lowpassHz != null && (!Number.isFinite(ins.lowpassHz) || ins.lowpassHz < 0 || ins.lowpassHz > 20000)) {
      return [`${ownerId} EQ lowpass invalid.`]
    }
    for (const band of ins.bands ?? []) {
      if (!Number.isFinite(band.frequencyHz) || !Number.isFinite(band.gainDb) || !Number.isFinite(band.q) || band.q <= 0) {
        return [`${ownerId} EQ band invalid.`]
      }
    }
  }
  if (ins.kind === 'compressor') {
    if (!Number.isFinite(ins.thresholdDb) || !Number.isFinite(ins.ratio) || ins.ratio < 1 || !Number.isFinite(ins.attackMs) || !Number.isFinite(ins.releaseMs)) {
      return [`${ownerId} compressor parameters invalid.`]
    }
  }
  if (ins.kind === 'limiter') {
    if (!Number.isFinite(ins.ceilingDb) || ins.ceilingDb > 0 || ins.ceilingDb < -24) {
      return [`${ownerId} limiter ceiling invalid.`]
    }
  }
  if (ins.kind === 'gate') {
    if (!Number.isFinite(ins.thresholdDb) || !Number.isFinite(ins.attackMs) || !Number.isFinite(ins.releaseMs)) {
      return [`${ownerId} gate parameters invalid.`]
    }
  }
  if (ins.kind === 'delay' || ins.kind === 'reverb') {
    if (!Number.isFinite(ins.delaysMs) || ins.delaysMs < 0 || ins.delaysMs > 2000 || !Number.isFinite(ins.decays) || ins.decays < 0 || ins.decays > 1) {
      return [`${ownerId} ${ins.kind} parameters invalid.`]
    }
  }
  return []
}

function hasAudioCycle(adj: Map<string, string[]>): boolean {
  const visiting = new Set<string>()
  const seen = new Set<string>()
  const dfs = (id: string): boolean => {
    if (visiting.has(id)) return true
    if (seen.has(id)) return false
    visiting.add(id)
    for (const next of adj.get(id) ?? []) {
      if (dfs(next)) return true
    }
    visiting.delete(id)
    seen.add(id)
    return false
  }
  return [...adj.keys()].some(id => dfs(id))
}

export function measuredMeter(_samples: Float32Array | null, channelId: string, windowStart: MediaTime, windowEnd: MediaTime): AudioMeterSample | null {
  if (!_samples || _samples.length === 0) return null
  let peak = 0
  let sumSq = 0
  for (let i = 0; i < _samples.length; i++) {
    const a = Math.abs(_samples[i])
    if (a > peak) peak = a
    sumSq += _samples[i] * _samples[i]
  }
  return { channelId, peak, rms: Math.sqrt(sumSq / _samples.length), windowStart, windowEnd }
}

export function identityAudioGraphOr(graph: AudioGraph | null | undefined, project?: Pick<HvsProject, 'timeline'> | null): AudioGraph {
  if (!graph || !Array.isArray(graph.channels) || !Array.isArray(graph.buses)) return emptyAudioGraph(project)
  return {
    schemaVersion: AUDIO_GRAPH_SCHEMA,
    channels: graph.channels,
    buses: graph.buses,
    automation: Array.isArray(graph.automation) ? graph.automation : [],
  }
}

export function zeroMeterWindow(timescale = 24000): { windowStart: MediaTime; windowEnd: MediaTime } {
  return { windowStart: zeroTime(timescale), windowEnd: zeroTime(timescale) }
}
