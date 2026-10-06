import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { resolveFfmpegTools } from '../ffmpeg'
import { DESTRUCTION_CAMERAS, type HvsDestructionPlayback, type PlaybackCamera } from './playback'
import { rasterPlaybackFrame } from './raster'

export const PREVIS_WIDTH = 640
export const PREVIS_HEIGHT = 360

export function playbackDocument(input: {
  summary: string
  fps: number
  durationSec: number
  cacheManifestId: string
  transformHash: string
  simulationRuns: number
  camera: PlaybackCamera
  nodes: HvsDestructionPlayback['nodes']
  volumeCues: HvsDestructionPlayback['volumeCues']
  cameraCues: HvsDestructionPlayback['cameraCues']
  volumeExecution: HvsDestructionPlayback['volumeExecution']
  fractureBackend: string
  physicsBackend: string
}): HvsDestructionPlayback {
  return {
    schemaVersion: 1,
    summary: input.summary,
    fps: input.fps,
    durationSec: input.durationSec,
    frameCount: input.nodes[0]?.frames.length ?? 0,
    cacheManifestId: input.cacheManifestId,
    transformHash: input.transformHash,
    simulationRuns: input.simulationRuns,
    camera: input.camera,
    nodes: input.nodes,
    volumeCues: input.volumeCues,
    cameraCues: input.cameraCues,
    volumeExecution: input.volumeExecution,
    fractureBackend: input.fractureBackend,
    physicsBackend: input.physicsBackend,
  }
}

export function withCamera(playback: HvsDestructionPlayback, cameraId: 'front' | 'three-quarter'): HvsDestructionPlayback {
  return { ...playback, camera: DESTRUCTION_CAMERAS[cameraId] }
}

function ppm(buffer: Buffer, width: number, height: number): Buffer {
  const header = Buffer.from(`P6\n${width} ${height}\n255\n`)
  return Buffer.concat([header, buffer])
}

export function writeProofFrames(playback: HvsDestructionPlayback, dir: string): { start: string; fall: string; settled: string } {
  const frames = [0, Math.floor(playback.frameCount * 0.45), playback.frameCount - 1]
  const names = ['frame-start.ppm', 'frame-fall.ppm', 'frame-settled.ppm'] as const
  const out: Record<string, string> = {}
  frames.forEach((frame, index) => {
    const file = path.join(dir, names[index])
    writeFileSync(file, ppm(rasterPlaybackFrame(playback, frame, 320, 180), 320, 180))
    out[names[index] === 'frame-start.ppm' ? 'start' : names[index] === 'frame-fall.ppm' ? 'fall' : 'settled'] = file
  })
  return { start: out.start, fall: out.fall, settled: out.settled }
}

export async function encodeProxyMp4(playback: HvsDestructionPlayback, outFile: string): Promise<{ path: string | null; backend: 'FFMPEG_PROXY' | 'NOT_AVAILABLE'; error: string | null }> {
  const tools = await resolveFfmpegTools()
  if (!tools.ffmpeg) return { path: null, backend: 'NOT_AVAILABLE', error: 'ffmpeg not available' }
  const frames: Buffer[] = []
  for (let frame = 0; frame < playback.frameCount; frame += 1) {
    frames.push(rasterPlaybackFrame(playback, frame, PREVIS_WIDTH, PREVIS_HEIGHT))
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(tools.ffmpeg as string, [
      '-y',
      '-f', 'rawvideo',
      '-pix_fmt', 'rgb24',
      '-s', `${PREVIS_WIDTH}x${PREVIS_HEIGHT}`,
      '-r', String(playback.fps),
      '-i', 'pipe:0',
      '-an',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      outFile,
    ], { stdio: ['pipe', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) resolve()
      else reject(new Error(stderr.slice(-400) || `ffmpeg exit ${code}`))
    })
    for (const frame of frames) child.stdin.write(frame)
    child.stdin.end()
  })
  return { path: outFile, backend: 'FFMPEG_PROXY', error: null }
}

export function writeHtmlPlayer(playback: HvsDestructionPlayback, outFile: string): string {
  const payload = JSON.stringify(playback).replace(/</g, '\\u003c')
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>DESTRUCTION PREVIS</title>
  <style>
    body { margin: 0; background: #07080c; color: #f6efe2; font-family: Georgia, serif; }
    header { padding: 16px 20px 0; }
    .kicker { letter-spacing: .28em; font-size: 12px; color: #e8c872; }
    h1 { font-size: 22px; font-weight: 500; margin: 8px 0; }
    canvas { width: min(960px, 100%); background: #0e1014; display: block; margin: 12px 20px; }
    .row { display: flex; gap: 8px; align-items: center; padding: 0 20px 20px; }
    button, input { font: inherit; }
    button { background: #e8c872; color: #1a1408; border: 0; border-radius: 999px; padding: 8px 14px; cursor: pointer; }
  </style>
</head>
<body>
  <header>
    <div class="kicker">DESTRUCTION PREVIS</div>
    <h1 id="summary"></h1>
  </header>
  <canvas id="view" width="640" height="360"></canvas>
  <div class="row">
    <button id="play" type="button">PLAY</button>
    <button id="restart" type="button">RESTART</button>
    <input id="scrub" type="range" min="0" max="1" value="0" />
  </div>
  <script>
    const playback = ${payload}
    const summary = document.getElementById('summary')
    summary.textContent = playback.summary
    const canvas = document.getElementById('view')
    const ctx = canvas.getContext('2d')
    const scrub = document.getElementById('scrub')
    scrub.max = String(Math.max(0, playback.frameCount - 1))
    let frame = 0
    let timer = null
    function draw() {
      ctx.fillStyle = '#0e1014'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      const cam = playback.camera
      const forward = norm(sub(cam.lookAt, cam.position))
      const right = norm(cross(forward, {x:0,y:1,z:0}))
      const up = cross(right, forward)
      const focal = (canvas.height / 2) / Math.tan((cam.fov * Math.PI) / 360)
      const items = []
      for (const node of playback.nodes) {
        const sample = node.frames[Math.max(0, Math.min(node.frames.length - 1, frame))]
        if (!sample || sample.y < -1) continue
        const d = sub(sample, cam.position)
        const z = dot(d, forward)
        if (z < 0.15) continue
        const sx = canvas.width / 2 + (dot(d, right) / z) * focal
        const sy = canvas.height / 2 - (dot(d, up) / z) * focal
        const scale = focal / z
        items.push({ z, sx, sy, sw: node.size.x * scale, sh: node.size.y * scale, support: node.supportClass, role: node.role })
      }
      items.sort((a, b) => b.z - a.z)
      ctx.fillStyle = '#363832'
      ctx.fillRect(40, canvas.height - 28, canvas.width - 80, 10)
      for (const item of items) {
        ctx.fillStyle = item.role === 'SECONDARY_DEBRIS' ? '#70665a' : item.support === 'RIGHT_SUPPORT' ? '#c6b080' : '#a8a49c'
        ctx.fillRect(item.sx - item.sw / 2, item.sy - item.sh / 2, item.sw, item.sh)
      }
      scrub.value = String(frame)
    }
    function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z } }
    function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z }
    function cross(a, b) { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x } }
    function norm(v) { const m = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / m, y: v.y / m, z: v.z / m } }
    document.getElementById('play').onclick = () => {
      if (timer) { clearInterval(timer); timer = null; return }
      timer = setInterval(() => { frame = (frame + 1) % playback.frameCount; draw() }, 1000 / playback.fps)
    }
    document.getElementById('restart').onclick = () => { frame = 0; draw() }
    scrub.oninput = () => { frame = Number(scrub.value); draw() }
    draw()
  </script>
</body>
</html>
`
  writeFileSync(outFile, html, 'utf8')
  return outFile
}

export function measureRasterFps(playback: HvsDestructionPlayback): number {
  const started = performance.now()
  for (let frame = 0; frame < playback.frameCount; frame += 1) {
    rasterPlaybackFrame(playback, frame, 320, 180)
  }
  const elapsed = Math.max(0.001, performance.now() - started)
  return playback.frameCount / (elapsed / 1000)
}
