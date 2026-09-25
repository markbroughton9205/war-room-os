/**
 * TrackSubject production path: ONE selected person, ONE continuous clip.
 * Human seed → temporal boxes → confidence → lost-target.
 * Not cross-scene identity tracking.
 */
import { mkdir, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { mediaCommandDataHierarchy } from './paths'
import { resolveFfmpegTools, runProcess } from './ffmpeg'
import { addTime, fromSeconds, toSeconds } from './time'
import { findAsset, findClip, type HvsProject, type TrackSubject } from './types'

export type SeedBox = { x: number; y: number; width: number; height: number }

const LANDSCAPE_W = 192
const LANDSCAPE_H = 108
const PORTRAIT_W = 108
const PORTRAIT_H = 192
const FPS = 6

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n))
}

function sad(a: Buffer, b: Buffer, ax: number, ay: number, bx: number, by: number, w: number, h: number, stride: number): number {
  let sum = 0
  let n = 0
  for (let y = 0; y < h; y++) {
    const ar = (ay + y) * stride + ax
    const br = (by + y) * stride + bx
    for (let x = 0; x < w; x++) {
      sum += Math.abs(a[ar + x] - b[br + x])
      n++
    }
  }
  return n ? sum / n : 255
}

export async function trackPersonInClip(project: HvsProject, input: {
  clipId: string
  seedBox?: SeedBox
  fromSec?: number
}): Promise<{
  keyframes: TrackSubject['keyframes']
  status: TrackSubject['status']
  confidence: number
  warnings: string[]
}> {
  const warnings: string[] = []
  const found = findClip(project, input.clipId)
  if (!found) {
    return { keyframes: [], status: 'lost', confidence: 0, warnings: ['Clip not found.'] }
  }
  const asset = findAsset(project, found.clip.assetId)
  const seed: SeedBox = input.seedBox ?? { x: 0.38, y: 0.16, width: 0.24, height: 0.58 }
  const start = found.clip.start
  const durationSec = Math.max(0.2, toSeconds(found.clip.duration))
  const fromSec = Math.max(0, Math.min(durationSec - 0.2, input.fromSec ?? 0))
  const trackDur = Math.max(0.2, durationSec - fromSec)
  const sourceIn = toSeconds(found.clip.sourceIn) + fromSec
  const fallbackKf = [
    { time: addTime(start, fromSeconds(fromSec, start.timescale)), ...seed, confidence: 0.55 },
    { time: addTime(start, found.clip.duration), x: seed.x, y: seed.y, width: seed.width, height: seed.height, confidence: 0.4 },
  ]

  if (!asset?.originalPath || !existsSync(asset.originalPath)) {
    return { keyframes: fallbackKf, status: 'lost', confidence: 0, warnings: ['Source media missing; tracking cannot run.'] }
  }

  const tools = await resolveFfmpegTools()
  if (!tools.ffmpeg) {
    return {
      keyframes: fallbackKf.map(k => ({ ...k, confidence: 0.15 })),
      status: 'lost',
      confidence: 0.15,
      warnings: ['HVS bundled ffmpeg was not resolved. TrackSubject stored the seed box only — not a real track.'],
    }
  }

  const dirs = mediaCommandDataHierarchy()
  const tmpDir = path.join(dirs.tmp, `track-${found.clip.id}-${Date.now().toString(36)}`)
  await mkdir(tmpDir, { recursive: true })
  const rawPath = path.join(tmpDir, 'gray.raw')
  try {
    const srcW = asset.width ?? 1920
    const srcH = asset.height ?? 1080
    const portrait = srcH > srcW
    const FRAME_W = portrait ? PORTRAIT_W : LANDSCAPE_W
    const FRAME_H = portrait ? PORTRAIT_H : LANDSCAPE_H
    const extract = await runProcess(tools.ffmpeg, [
      '-y',
      '-ss', String(sourceIn),
      '-t', String(trackDur),
      '-i', asset.originalPath,
      '-an',
      '-vf', `scale=${FRAME_W}:${FRAME_H}:flags=fast_bilinear,format=gray`,
      '-r', String(FPS),
      '-f', 'rawvideo',
      '-pix_fmt', 'gray',
      rawPath,
    ], 180_000)
    if (!extract.ok || !existsSync(rawPath)) {
      warnings.push('Frame extract failed. Seed box stored; not a real track.')
      return { keyframes: fallbackKf, status: 'lost', confidence: 0.2, warnings }
    }
    const raw = await readFile(rawPath)
    const frameSize = FRAME_W * FRAME_H
    const frameCount = Math.floor(raw.length / frameSize)
    if (frameCount < 2) {
      return { keyframes: fallbackKf, status: 'lost', confidence: 0.25, warnings: ['Not enough frames to track.'] }
    }

    let x = Math.round(seed.x * FRAME_W)
    let y = Math.round(seed.y * FRAME_H)
    let w = Math.max(8, Math.round(seed.width * FRAME_W))
    let h = Math.max(12, Math.round(seed.height * FRAME_H))
    x = Math.max(0, Math.min(FRAME_W - w, x))
    y = Math.max(0, Math.min(FRAME_H - h, y))

    const keyframes: TrackSubject['keyframes'] = []
    let lostStreak = 0
    let lastWasLost = false
    let confSum = 0
    const search = 12

    for (let i = 0; i < frameCount; i++) {
      const frame = raw.subarray(i * frameSize, (i + 1) * frameSize)
      const tSec = i / FPS
      if (i === 0) {
        const kf = {
          time: fromSeconds(toSeconds(start) + fromSec + tSec, start.timescale),
          x: clamp01(x / FRAME_W),
          y: clamp01(y / FRAME_H),
          width: clamp01(w / FRAME_W),
          height: clamp01(h / FRAME_H),
          confidence: 0.82,
        }
        keyframes.push(kf)
        confSum += kf.confidence
        continue
      }
      const prev = raw.subarray((i - 1) * frameSize, i * frameSize)
      let best = Infinity
      let bx = x
      let by = y
      for (let dy = -search; dy <= search; dy += 2) {
        for (let dx = -search; dx <= search; dx += 2) {
          const nx = Math.max(0, Math.min(FRAME_W - w, x + dx))
          const ny = Math.max(0, Math.min(FRAME_H - h, y + dy))
          const score = sad(prev, frame, x, y, nx, ny, w, h, FRAME_W)
          if (score < best) {
            best = score
            bx = nx
            by = ny
          }
        }
      }
      const confidence = clamp01(1 - best / 48)
      if (confidence < 0.32) lostStreak++
      else lostStreak = 0
      x = Math.round(x * 0.35 + bx * 0.65)
      y = Math.round(y * 0.35 + by * 0.65)
      const status: TrackSubject['status'] = lostStreak >= 2 ? 'lost' : lastWasLost && lostStreak === 0 ? 'reacquired' : 'tracking'
      lastWasLost = status === 'lost'
      const kf = {
        time: fromSeconds(toSeconds(start) + fromSec + tSec, start.timescale),
        x: clamp01(x / FRAME_W),
        y: clamp01(y / FRAME_H),
        width: clamp01(w / FRAME_W),
        height: clamp01(h / FRAME_H),
        confidence,
      }
      keyframes.push(kf)
      confSum += confidence
    }

    const avg = keyframes.length ? confSum / keyframes.length : 0
    const status: TrackSubject['status'] = lastWasLost || avg < 0.3 ? 'lost' : 'tracking'
    return { keyframes, status, confidence: avg, warnings }
  } finally {
    try { await rm(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}
