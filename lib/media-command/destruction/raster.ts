import type { HvsDestructionPlayback, PlaybackCamera, PlaybackNode } from './playback'

export type Rgb = { r: number; g: number; b: number }

const BACKGROUND: Rgb = { r: 14, g: 16, b: 20 }
const GROUND: Rgb = { r: 54, g: 56, b: 50 }
const CHUNK: Rgb = { r: 168, g: 164, b: 156 }
const RIGHT: Rgb = { r: 198, g: 176, b: 128 }
const DEBRIS: Rgb = { r: 112, g: 102, b: 90 }

function sub(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}
function dot(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return a.x * b.x + a.y * b.y + a.z * b.z
}
function cross(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }
}
function normalize(v: { x: number; y: number; z: number }) {
  const m = Math.hypot(v.x, v.y, v.z) || 1
  return { x: v.x / m, y: v.y / m, z: v.z / m }
}

function fill(buffer: Buffer, width: number, height: number, x0: number, y0: number, rw: number, rh: number, color: Rgb) {
  const left = Math.max(0, Math.floor(x0))
  const top = Math.max(0, Math.floor(y0))
  const right = Math.min(width, Math.ceil(x0 + rw))
  const bottom = Math.min(height, Math.ceil(y0 + rh))
  for (let y = top; y < bottom; y += 1) {
    const row = y * width * 3
    for (let x = left; x < right; x += 1) {
      const i = row + x * 3
      buffer[i] = color.r
      buffer[i + 1] = color.g
      buffer[i + 2] = color.b
    }
  }
}

export function rasterPlaybackFrame(playback: HvsDestructionPlayback, frame: number, width: number, height: number, camera: PlaybackCamera = playback.camera): Buffer {
  const buffer = Buffer.alloc(width * height * 3)
  for (let i = 0; i < buffer.length; i += 3) {
    buffer[i] = BACKGROUND.r
    buffer[i + 1] = BACKGROUND.g
    buffer[i + 2] = BACKGROUND.b
  }
  const forward = normalize(sub(camera.lookAt, camera.position))
  const right = normalize(cross(forward, { x: 0, y: 1, z: 0 }))
  const up = cross(right, forward)
  const focal = (height / 2) / Math.tan((camera.fov * Math.PI) / 360)
  const drawables: Array<{ depth: number; sx: number; sy: number; sw: number; sh: number; color: Rgb }> = []
  const ground: PlaybackNode = {
    id: 'ground',
    role: 'PRIMARY_CHUNKS',
    supportClass: 'NONE',
    size: { x: 14, y: 0.06, z: 8 },
    frames: [{ x: 0, y: 0.03, z: 0, tilt: 0 }],
  }
  for (const node of [ground, ...playback.nodes]) {
    const sample = node.id === 'ground' ? node.frames[0] : node.frames[Math.max(0, Math.min(node.frames.length - 1, frame))]
    if (!sample || sample.y < -1) continue
    const d = sub(sample, camera.position)
    const camZ = dot(d, forward)
    if (camZ < 0.15) continue
    const sx = width / 2 + (dot(d, right) / camZ) * focal
    const sy = height / 2 - (dot(d, up) / camZ) * focal
    const scale = focal / camZ
    const color = node.id === 'ground'
      ? GROUND
      : node.role === 'SECONDARY_DEBRIS'
        ? DEBRIS
        : node.supportClass === 'RIGHT_SUPPORT'
          ? RIGHT
          : CHUNK
    drawables.push({
      depth: camZ,
      sx: sx - (node.size.x * scale) / 2,
      sy: sy - (node.size.y * scale) / 2,
      sw: Math.max(1, node.size.x * scale),
      sh: Math.max(1, node.size.y * scale),
      color,
    })
  }
  drawables.sort((a, b) => b.depth - a.depth)
  for (const item of drawables) fill(buffer, width, height, item.sx, item.sy, item.sw, item.sh, item.color)
  return buffer
}

export function countBright(buffer: Buffer, width: number, height: number, region: 'left-upper' | 'left-lower' | 'right-upper' | 'far-left-upper' | 'far-right-upper'): number {
  const x0 = region.startsWith('far-left') ? Math.floor(width * 0.2)
    : region.startsWith('far-right') ? Math.floor(width * 0.62)
    : region.startsWith('left') ? 0
    : Math.floor(width / 2)
  const x1 = region.startsWith('far-left') ? Math.floor(width * 0.4)
    : region.startsWith('far-right') ? Math.floor(width * 0.82)
    : region.startsWith('left') ? Math.floor(width / 2)
    : width
  const y0 = region.endsWith('upper') ? 0 : Math.floor(height * 0.55)
  const y1 = region.endsWith('upper') ? Math.floor(height * 0.42) : height
  let count = 0
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * width + x) * 3
      if (buffer[i] > 100) count += 1
    }
  }
  return count
}
