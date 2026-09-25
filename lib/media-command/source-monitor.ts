/**
 * Source Monitor session state. Distinct from Program Viewer / timeline playhead.
 * Session state. Not stored on .hvsproj.
 * Mark In/Out live here and do not become EditCommands until Insert/Overwrite/Append.
 */
import type { AssetRecord } from './types'
import type { EditCommand, EditCommandKind } from './edit-commands'
import { newCommandId } from './edit-commands'
import {
  addTime,
  compareTime,
  convertTime,
  mediaTime,
  type MediaTime,
  type Rational,
  subTime,
  toSeconds,
  zeroTime,
} from './time'
import { resolveFrameRate } from './playback-clock'

export type PreviewRepresentation = 'proxy' | 'original'

export type SourceMonitorState = {
  selectedAssetId: string | null
  sourcePlayhead: MediaTime
  playhead: MediaTime
  markIn: MediaTime | null
  markOut: MediaTime | null
  sourceIn: MediaTime | null
  sourceOut: MediaTime | null
  timescale: number
  sourceDuration: MediaTime
  duration: MediaTime
  sourceFrameRate: Rational
  sourceAspect: string
  sourceAudioPresence: boolean
  previewRepresentation: PreviewRepresentation
}

export type SourceRangeError = {
  ok: false
  error: string
  code: 'IN_NEGATIVE' | 'OUT_PAST_DURATION' | 'OUT_NOT_AFTER_IN' | 'NO_ASSET' | 'NO_RANGE'
}

export type SourceRangeOk = {
  ok: true
  sourceIn: MediaTime
  sourceOut: MediaTime
  duration: MediaTime
}

export type SourceRangeResult = SourceRangeOk | SourceRangeError

export function emptySourceMonitor(timescale = 24_000): SourceMonitorState {
  const playhead = zeroTime(timescale)
  return {
    selectedAssetId: null,
    sourcePlayhead: playhead,
    playhead,
    markIn: null,
    markOut: null,
    sourceIn: null,
    sourceOut: null,
    timescale,
    sourceDuration: zeroTime(timescale),
    duration: zeroTime(timescale),
    sourceFrameRate: { n: 24, d: 1 },
    sourceAspect: '16:9',
    sourceAudioPresence: false,
    previewRepresentation: 'proxy',
  }
}

export function assetAspectLabel(asset: AssetRecord): string {
  const w = asset.width
  const h = asset.height
  if (!w || !h) return 'unknown'
  const ratio = w / h
  if (Math.abs(ratio - 16 / 9) < 0.08) return '16:9'
  if (Math.abs(ratio - 9 / 16) < 0.08) return '9:16'
  if (Math.abs(ratio - 1) < 0.08) return '1:1'
  return `${w}:${h}`
}

export function selectSourceAsset(asset: AssetRecord, timescale = 24_000): SourceMonitorState {
  const duration = convertTime(asset.duration, timescale)
  const playhead = zeroTime(timescale)
  return {
    selectedAssetId: asset.id,
    sourcePlayhead: playhead,
    playhead,
    markIn: null,
    markOut: null,
    sourceIn: null,
    sourceOut: null,
    timescale,
    sourceDuration: duration,
    duration,
    sourceFrameRate: resolveFrameRate(asset.frameRate),
    sourceAspect: assetAspectLabel(asset),
    sourceAudioPresence: (asset.audioStreams?.length ?? 0) > 0 || Boolean(asset.channels && asset.channels > 0),
    previewRepresentation: asset.proxyPath ? 'proxy' : 'original',
  }
}

export function previewFileKind(state: SourceMonitorState): 'proxy' | 'original' {
  return state.previewRepresentation === 'original' ? 'original' : 'proxy'
}

export function markIn(state: SourceMonitorState, at: MediaTime = state.playhead ?? state.sourcePlayhead): SourceMonitorState {
  const time = clampSourceTime(at, state)
  return { ...state, sourceIn: time, markIn: time, sourcePlayhead: time, playhead: time }
}

export function markOut(state: SourceMonitorState, at: MediaTime = state.playhead ?? state.sourcePlayhead): SourceMonitorState {
  const time = clampSourceTime(at, state)
  return { ...state, sourceOut: time, markOut: time, sourcePlayhead: time, playhead: time }
}

export function clearIn(state: SourceMonitorState): SourceMonitorState {
  return { ...state, sourceIn: null, markIn: null }
}

export function clearOut(state: SourceMonitorState): SourceMonitorState {
  return { ...state, sourceOut: null, markOut: null }
}

export function clearRange(state: SourceMonitorState): SourceMonitorState {
  return { ...state, sourceIn: null, sourceOut: null, markIn: null, markOut: null }
}

export function seekSource(state: SourceMonitorState, at: MediaTime): SourceMonitorState {
  const time = clampSourceTime(at, state)
  return { ...state, sourcePlayhead: time, playhead: time }
}

export function seekSourceFromHit(
  state: SourceMonitorState,
  asset: AssetRecord,
  hit: { start: MediaTime; assetId: string },
): SourceMonitorState {
  const selected = state.selectedAssetId === asset.id ? state : selectSourceAsset(asset, state.timescale || asset.duration.timescale)
  return seekSource(selected, hit.start)
}

function clampSourceTime(at: MediaTime, state: SourceMonitorState): MediaTime {
  const ts = state.sourceDuration.timescale
  const t = convertTime(at, ts)
  if (t.ticks < 0) return zeroTime(ts)
  if (compareTime(t, state.sourceDuration) > 0) return convertTime(state.sourceDuration, ts)
  return t
}

export function validateAssetSourceRange(
  asset: AssetRecord,
  inn: MediaTime,
  out: MediaTime,
  timescale: number,
): SourceRangeResult {
  const duration = convertTime(asset.duration, timescale)
  const inC = convertTime(inn, timescale)
  const outC = convertTime(out, timescale)
  if (inC.ticks < 0) return { ok: false, error: 'IN must be >= 0.', code: 'IN_NEGATIVE' }
  if (compareTime(outC, duration) > 0) {
    return { ok: false, error: 'OUT must be <= source duration.', code: 'OUT_PAST_DURATION' }
  }
  if (compareTime(outC, inC) <= 0) {
    return { ok: false, error: 'OUT must be after IN.', code: 'OUT_NOT_AFTER_IN' }
  }
  return { ok: true, sourceIn: inC, sourceOut: outC, duration: subTime(outC, inC) }
}

export function validateSourceRange(state: SourceMonitorState): SourceRangeResult {
  if (!state.selectedAssetId) return { ok: false, error: 'No source asset selected.', code: 'NO_ASSET' }
  const innRaw = state.sourceIn ?? state.markIn
  const outRaw = state.sourceOut ?? state.markOut
  if (!innRaw || !outRaw) {
    return { ok: false, error: 'Mark In and Mark Out are required.', code: 'NO_RANGE' }
  }
  const inn = convertTime(innRaw, state.sourceDuration.timescale)
  const out = convertTime(outRaw, state.sourceDuration.timescale)
  if (inn.ticks < 0) return { ok: false, error: 'IN must be >= 0.', code: 'IN_NEGATIVE' }
  if (compareTime(out, state.sourceDuration) > 0) {
    return { ok: false, error: 'OUT must be <= source duration.', code: 'OUT_PAST_DURATION' }
  }
  if (compareTime(out, inn) <= 0) {
    return { ok: false, error: 'OUT must be after IN.', code: 'OUT_NOT_AFTER_IN' }
  }
  return { ok: true, sourceIn: inn, sourceOut: out, duration: subTime(out, inn) }
}

export function selectedRangeDuration(state: SourceMonitorState): MediaTime | null {
  const range = validateSourceRange(state)
  return range.ok ? range.duration : null
}

export function sourceRangeSeconds(state: SourceMonitorState): number | null {
  const duration = selectedRangeDuration(state)
  return duration ? toSeconds(duration) : null
}

function cmd(kind: EditCommandKind, extra: Record<string, unknown>): EditCommand {
  return {
    id: newCommandId(),
    kind,
    actor: 'human',
    createdAt: new Date().toISOString(),
    ...extra,
  } as EditCommand
}

export function sourceRangeEditCommand(
  state: SourceMonitorState,
  op: 'insertClip' | 'overwriteClip' | 'appendClip',
  input: { trackId: string; start?: MediaTime },
): { ok: true; command: EditCommand } | SourceRangeError {
  const range = validateSourceRange(state)
  if (!range.ok) return range
  if (!state.selectedAssetId) return { ok: false, error: 'No source asset selected.', code: 'NO_ASSET' }
  if (op === 'appendClip') {
    return {
      ok: true,
      command: cmd('appendClip', {
        trackId: input.trackId,
        assetId: state.selectedAssetId,
        sourceIn: range.sourceIn,
        sourceOut: range.sourceOut,
        duration: range.duration,
        label: 'Append from Source Monitor',
      }),
    }
  }
  const start = input.start ?? zeroTime(range.sourceIn.timescale)
  if (op === 'overwriteClip') {
    return {
      ok: true,
      command: cmd('overwriteClip', {
        trackId: input.trackId,
        assetId: state.selectedAssetId,
        start,
        duration: range.duration,
        sourceIn: range.sourceIn,
        sourceOut: range.sourceOut,
        label: 'Overwrite from Source Monitor',
      }),
    }
  }
  return {
    ok: true,
    command: cmd('insertClip', {
      trackId: input.trackId,
      assetId: state.selectedAssetId,
      start,
      sourceIn: range.sourceIn,
      sourceOut: range.sourceOut,
      duration: range.duration,
      label: 'Insert from Source Monitor',
    }),
  }
}

export function formatSourceHud(time: MediaTime, fps: Rational): string {
  const total = Math.max(0, toSeconds(time))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = Math.floor(total % 60)
  const frameSec = fps.n === 0 ? 24 : fps.n / (fps.d || 1)
  const frames = Math.floor((total - Math.floor(total)) * frameSec)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}:${pad(frames)}`
}

export function sourceMetadataLines(asset: AssetRecord, state: SourceMonitorState): string[] {
  const dur = toSeconds(asset.duration)
  const fps = state.sourceFrameRate
  const fpsLabel = fps.d === 1 ? String(fps.n) : `${fps.n}/${fps.d}`
  return [
    asset.name,
    `${dur.toFixed(3)}s`,
    asset.width && asset.height ? `${asset.width}×${asset.height}` : 'resolution unknown',
    asset.codec ?? 'codec unknown',
    `${fpsLabel} fps`,
    state.sourceAspect,
    state.sourceAudioPresence ? 'audio present' : 'no audio',
    asset.proxyPath ? 'ORIGINAL ↔ PROXY' : 'ORIGINAL (no proxy)',
  ]
}

export function fromSecondsExact(seconds: number, timescale: number): MediaTime {
  return mediaTime(seconds * timescale, timescale)
}

export function loadAssetIntoSource(state: SourceMonitorState, asset: AssetRecord | null): SourceMonitorState {
  if (!asset) return emptySourceMonitor(state.timescale || 24_000)
  return selectSourceAsset(asset, state.timescale || asset.duration.timescale || 24_000)
}

export function markSourceIn(state: SourceMonitorState): SourceMonitorState {
  return markIn(state)
}

export function markSourceOut(state: SourceMonitorState): SourceMonitorState {
  return markOut(state)
}

export function clearSourceIn(state: SourceMonitorState): SourceMonitorState {
  return clearIn(state)
}

export function clearSourceOut(state: SourceMonitorState): SourceMonitorState {
  return clearOut(state)
}

export function setSourcePlayhead(state: SourceMonitorState, at: MediaTime, asset?: AssetRecord | null): SourceMonitorState {
  const next = asset && asset.id !== state.selectedAssetId ? selectSourceAsset(asset, state.timescale) : state
  return seekSource(next, at)
}

export function sourceRangeFromMarks(state: SourceMonitorState, asset?: AssetRecord | null): SourceRangeResult {
  if (asset) {
    const inn = state.sourceIn ?? state.markIn
    const out = state.sourceOut ?? state.markOut
    if (!inn || !out) return { ok: false, error: 'Mark In and Mark Out are required.', code: 'NO_RANGE' }
    return validateAssetSourceRange(asset, inn, out, state.timescale || asset.duration.timescale)
  }
  return validateSourceRange(state)
}

export function sourceMonitorFacts(asset: AssetRecord | null) {
  if (!asset) return null
  const fps = resolveFrameRate(asset.frameRate)
  return {
    name: asset.name,
    width: asset.width,
    height: asset.height,
    codec: asset.codec,
    sourceFrameRate: fps,
    sourceAudioPresence: (asset.audioStreams?.length ?? 0) > 0 || Boolean(asset.channels && asset.channels > 0),
    previewKind: (asset.proxyPath ? 'PROXY' : 'ORIGINAL') as 'PROXY' | 'ORIGINAL',
    duration: asset.duration,
  }
}

export function sourceRangeDisplay(range: SourceRangeResult | null) {
  if (!range || !range.ok) {
    return { inn: '—', out: '—', duration: '—' }
  }
  const fmt = (t: MediaTime) => formatSourceHud(t, { n: 24, d: 1 })
  return { inn: fmt(range.sourceIn), out: fmt(range.sourceOut), duration: fmt(range.duration) }
}
