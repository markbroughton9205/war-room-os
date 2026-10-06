/**
 * Color scopes from actual frame pixels. No decorative drawings.
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { resolveFfmpegTools, runProcess } from './ffmpeg'
import { probeMediaFile } from './probe'
import { mediaCommandDataHierarchy } from './paths'

export type FramePixels = {
  width: number
  height: number
  rgb: Buffer
}

export type ChannelStats = {
  meanR: number
  meanG: number
  meanB: number
  luma: number
}

export type HistogramScope = {
  r: number[]
  g: number[]
  b: number[]
  luma: number[]
}

export type WaveformScope = {
  columns: number
  lumaMax: number[]
  lumaMean: number[]
}

export type ParadeScope = {
  columns: number
  rMean: number[]
  gMean: number[]
  bMean: number[]
}

export type VectorscopeScope = {
  size: number
  /** Packed row-major counts, size*size. Cb on X, Cr on Y, both 0..size-1. */
  counts: number[]
  samples: number
}

export type ColorScopes = {
  stats: ChannelStats
  histogram: HistogramScope
  waveform: WaveformScope
  parade: ParadeScope
  vectorscope: VectorscopeScope
}

function lumaOf(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function statsFromPixels(frame: FramePixels): ChannelStats {
  const { rgb } = frame
  let r = 0
  let g = 0
  let b = 0
  const n = frame.width * frame.height
  for (let i = 0; i < rgb.length; i += 3) {
    r += rgb[i]
    g += rgb[i + 1]
    b += rgb[i + 2]
  }
  if (!n) return { meanR: 0, meanG: 0, meanB: 0, luma: 0 }
  const meanR = r / n
  const meanG = g / n
  const meanB = b / n
  return { meanR, meanG, meanB, luma: lumaOf(meanR, meanG, meanB) }
}

export function histogramFromPixels(frame: FramePixels): HistogramScope {
  const r = new Array<number>(256).fill(0)
  const g = new Array<number>(256).fill(0)
  const b = new Array<number>(256).fill(0)
  const luma = new Array<number>(256).fill(0)
  const { rgb } = frame
  for (let i = 0; i < rgb.length; i += 3) {
    r[rgb[i]] += 1
    g[rgb[i + 1]] += 1
    b[rgb[i + 2]] += 1
    luma[Math.max(0, Math.min(255, Math.round(lumaOf(rgb[i], rgb[i + 1], rgb[i + 2]))))] += 1
  }
  return { r, g, b, luma }
}

export function waveformFromPixels(frame: FramePixels, columns = 256): WaveformScope {
  const lumaMax = new Array<number>(columns).fill(0)
  const lumaSum = new Array<number>(columns).fill(0)
  const lumaN = new Array<number>(columns).fill(0)
  const { width, height, rgb } = frame
  for (let x = 0; x < width; x++) {
    const col = Math.min(columns - 1, Math.floor((x / width) * columns))
    for (let y = 0; y < height; y++) {
      const i = (y * width + x) * 3
      const yv = lumaOf(rgb[i], rgb[i + 1], rgb[i + 2])
      if (yv > lumaMax[col]) lumaMax[col] = yv
      lumaSum[col] += yv
      lumaN[col] += 1
    }
  }
  return {
    columns,
    lumaMax,
    lumaMean: lumaSum.map((s, i) => (lumaN[i] ? s / lumaN[i] : 0)),
  }
}

export function paradeFromPixels(frame: FramePixels, columns = 256): ParadeScope {
  const rSum = new Array<number>(columns).fill(0)
  const gSum = new Array<number>(columns).fill(0)
  const bSum = new Array<number>(columns).fill(0)
  const n = new Array<number>(columns).fill(0)
  const { width, height, rgb } = frame
  for (let x = 0; x < width; x++) {
    const col = Math.min(columns - 1, Math.floor((x / width) * columns))
    for (let y = 0; y < height; y++) {
      const i = (y * width + x) * 3
      rSum[col] += rgb[i]
      gSum[col] += rgb[i + 1]
      bSum[col] += rgb[i + 2]
      n[col] += 1
    }
  }
  return {
    columns,
    rMean: rSum.map((s, i) => (n[i] ? s / n[i] : 0)),
    gMean: gSum.map((s, i) => (n[i] ? s / n[i] : 0)),
    bMean: bSum.map((s, i) => (n[i] ? s / n[i] : 0)),
  }
}

export function vectorscopeFromPixels(frame: FramePixels, size = 64): VectorscopeScope {
  const counts = new Array<number>(size * size).fill(0)
  const { rgb } = frame
  let samples = 0
  const step = Math.max(3, Math.floor(rgb.length / (3 * 8000)) * 3)
  for (let i = 0; i < rgb.length; i += step) {
    const r = rgb[i] / 255
    const g = rgb[i + 1] / 255
    const b = rgb[i + 2] / 255
    const cb = -0.168736 * r - 0.331264 * g + 0.5 * b
    const cr = 0.5 * r - 0.418688 * g - 0.081312 * b
    const x = Math.max(0, Math.min(size - 1, Math.floor((cb + 0.5) * size)))
    const y = Math.max(0, Math.min(size - 1, Math.floor((cr + 0.5) * size)))
    counts[y * size + x] += 1
    samples += 1
  }
  return { size, counts, samples }
}

export function scopesFromPixels(frame: FramePixels): ColorScopes {
  return {
    stats: statsFromPixels(frame),
    histogram: histogramFromPixels(frame),
    waveform: waveformFromPixels(frame),
    parade: paradeFromPixels(frame),
    vectorscope: vectorscopeFromPixels(frame),
  }
}

export function regionMean(frame: FramePixels, x: number, y: number, w: number, h: number): ChannelStats {
  const x0 = Math.max(0, Math.floor(x))
  const y0 = Math.max(0, Math.floor(y))
  const x1 = Math.min(frame.width, Math.ceil(x + w))
  const y1 = Math.min(frame.height, Math.ceil(y + h))
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const i = (yy * frame.width + xx) * 3
      r += frame.rgb[i]
      g += frame.rgb[i + 1]
      b += frame.rgb[i + 2]
      n += 1
    }
  }
  if (!n) return { meanR: 0, meanG: 0, meanB: 0, luma: 0 }
  const meanR = r / n
  const meanG = g / n
  const meanB = b / n
  return { meanR, meanG, meanB, luma: lumaOf(meanR, meanG, meanB) }
}

export async function extractFramePixels(inputPath: string, atSec = 0): Promise<FramePixels | null> {
  const tools = await resolveFfmpegTools()
  if (!tools.ffmpeg || !existsSync(inputPath)) return null
  const probed = await probeMediaFile(inputPath)
  const width = probed.width
  const height = probed.height
  if (!width || !height) return null
  const dir = path.join(mediaCommandDataHierarchy().tmp, 'hvs-wave2-scopes')
  mkdirSync(dir, { recursive: true })
  const raw = path.join(dir, `frame-${process.pid}-${Date.now()}.rgb`)
  const args = ['-hide_banner', '-y']
  if (atSec > 0) args.push('-ss', atSec.toFixed(3))
  args.push('-i', inputPath, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', raw)
  const run = await runProcess(tools.ffmpeg, args, 60_000)
  if (!run.ok || !existsSync(raw)) return null
  const rgb = readFileSync(raw)
  try { unlinkSync(raw) } catch { /* tmp */ }
  const expected = width * height * 3
  if (rgb.length < expected) return null
  return { width, height, rgb: rgb.subarray(0, expected) }
}

export function writeScopeSummary(file: string, scopes: ColorScopes): void {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({
    stats: scopes.stats,
    histogramPeakR: scopes.histogram.r.indexOf(Math.max(...scopes.histogram.r)),
    histogramPeakG: scopes.histogram.g.indexOf(Math.max(...scopes.histogram.g)),
    histogramPeakB: scopes.histogram.b.indexOf(Math.max(...scopes.histogram.b)),
    waveformMean: scopes.waveform.lumaMean.reduce((a, b) => a + b, 0) / Math.max(1, scopes.waveform.lumaMean.length),
    paradeMeanR: scopes.parade.rMean.reduce((a, b) => a + b, 0) / Math.max(1, scopes.parade.rMean.length),
    vectorscopeSamples: scopes.vectorscope.samples,
  }, null, 2)}\n`, 'utf8')
}
