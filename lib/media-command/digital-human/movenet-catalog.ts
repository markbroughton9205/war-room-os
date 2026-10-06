/**
 * Provenance for the one approved body model.
 * This does not touch voice, image, or audio catalogs.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { mediaCommandDataHierarchy } from '../paths'

/**
 * Official TensorFlow Hub / LiteRT source, verified 2026-09-22:
 * https://www.tensorflow.org/hub/tutorials/movenet
 * https://tfhub.dev/google/lite-model/movenet/singlepose/lightning/tflite/float16/4
 * Canonical name: MoveNet SinglePose Lightning
 * Version: 4
 * Variant: tflite-float16
 * License: Apache 2.0
 * Format: TFLite
 * Input: uint8 RGB 192x192x3, values 0-255
 * Output: float32 [1,1,17,3] yx + score, normalized to the (letterboxed) model frame
 * Preprocess: resize_with_pad / letterbox, then restore coordinates to the source frame
 * Do not substitute Thunder or MultiPose.
 */
export const MOVENET_LIGHTNING = {
  id: 'movenet-singlepose-lightning',
  name: 'MoveNet SinglePose Lightning',
  version: '4',
  variant: 'tflite-float16',
  license: 'Apache-2.0',
  source: 'https://tfhub.dev/google/lite-model/movenet/singlepose/lightning/tflite/float16/4?lite-format=tflite',
  docs: 'https://www.tensorflow.org/hub/tutorials/movenet',
  filename: 'movenet-singlepose-lightning.tflite',
  bytes: 4758512,
  sha256: '0fac2226112d0371903ca86e3853cec24ef603a0b2f96f589b180f0ebdd135ab',
  downloadedAt: '2026-09-22T20:23:43Z',
  verifiedAt: '2026-09-22T20:50:00Z',
} as const

export function movenetModelDir(): string {
  return path.join(mediaCommandDataHierarchy().models, 'pose')
}

export function movenetModelPath(): string {
  return path.join(movenetModelDir(), MOVENET_LIGHTNING.filename)
}

export function movenetCatalogPath(): string {
  return path.join(movenetModelDir(), 'catalog.json')
}

export function verifyMoveNetFile(): { ok: boolean; reason: string; bytes: number; sha256: string } {
  const file = movenetModelPath()
  if (!existsSync(file)) return { ok: false, reason: 'MODEL_NOT_READY', bytes: 0, sha256: '' }
  const bytes = statSync(file).size
  const sha256 = createHash('sha256').update(readFileSync(file)).digest('hex')
  if (bytes !== MOVENET_LIGHTNING.bytes || sha256 !== MOVENET_LIGHTNING.sha256) {
    return { ok: false, reason: 'MOVENET_SOURCE_MISMATCH', bytes, sha256 }
  }
  return { ok: true, reason: 'READY', bytes, sha256 }
}

export function ensureMoveNetCatalog(): void {
  const verified = verifyMoveNetFile()
  if (!verified.ok) return
  mkdirSync(movenetModelDir(), { recursive: true })
  const catalog = {
    id: MOVENET_LIGHTNING.id,
    family: 'pose',
    version: MOVENET_LIGHTNING.version,
    license: MOVENET_LIGHTNING.license,
    hash: verified.sha256,
    bytes: verified.bytes,
    backend: 'libtensorflow-lite.so.2.14.1 CPU',
    path: movenetModelPath(),
    source: MOVENET_LIGHTNING.source,
    installedAt: MOVENET_LIGHTNING.downloadedAt,
    status: 'INSTALLED',
  }
  writeFileSync(movenetCatalogPath(), JSON.stringify(catalog, null, 2), 'utf8')
}
