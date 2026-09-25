/**
 * HVS media runtime discovery.
 * Canonical default is the bundled static toolchain under media-command/tools/.
 * Higher Vision Studios does not require a global FFmpeg install.
 *
 * Resolution order:
 * 1. HVS_FFMPEG_PATH / HVS_FFPROBE_PATH
 * 2. bundled ~/.local/share/war-room-os/data/media-command/tools/{ffmpeg,ffprobe}
 * 3. system PATH only if bundled tools are absent (intentional last-resort fallback)
 *
 * NVENC is used only after a live encode probe succeeds.
 * Encoder-list presence is not a PASS.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { mediaCommandDataHierarchy } from './paths'

export type FfmpegTools = {
  ffmpeg: string | null
  ffprobe: string | null
}

export type EncoderChoice = {
  videoCodec: 'h264_nvenc' | 'libx264'
  hwaccel: 'cuda' | 'none'
  label: 'NVENC' | 'CPU'
}

export type NvencReport = {
  status: 'PASS' | 'ABSENT' | 'PRESENT_RUNTIME_FAILED'
  h264NvencListed: boolean
  hevcNvencListed: boolean
  av1NvencListed: boolean
  encodeOk: boolean
  detail: string
}

let cached: FfmpegTools | null = null
let override: FfmpegTools | null = null
let encoderCached: EncoderChoice | null = null
let nvencCached: NvencReport | null = null

export function bundledToolPath(bin: 'ffmpeg' | 'ffprobe'): string {
  return path.join(mediaCommandDataHierarchy().tools, bin)
}

function bundled(bin: 'ffmpeg' | 'ffprobe'): string | null {
  try {
    const file = bundledToolPath(bin)
    return existsSync(file) ? file : null
  } catch {
    return null
  }
}

export function resetFfmpegCache(): void {
  cached = null
  encoderCached = null
  nvencCached = null
}

export function overrideFfmpegTools(next: FfmpegTools | null): void {
  override = next
  cached = next
  encoderCached = null
  nvencCached = null
}

export async function resolveFfmpegTools(): Promise<FfmpegTools> {
  if (override) return override
  if (cached) return cached
  const ffmpegEnv = process.env.HVS_FFMPEG_PATH
  const ffprobeEnv = process.env.HVS_FFPROBE_PATH
  const ffmpegFromEnv = ffmpegEnv && existsSync(ffmpegEnv) ? ffmpegEnv : null
  const ffprobeFromEnv = ffprobeEnv && existsSync(ffprobeEnv) ? ffprobeEnv : null
  let ffmpeg: string | null = ffmpegFromEnv ?? bundled('ffmpeg')
  let ffprobe: string | null = ffprobeFromEnv ?? bundled('ffprobe')
  if (!ffmpeg) ffmpeg = await probeOnPath('ffmpeg')
  if (!ffprobe) ffprobe = await probeOnPath('ffprobe')
  cached = { ffmpeg, ffprobe }
  return cached
}

function probeOnPath(bin: string): Promise<string | null> {
  return new Promise(resolve => {
    const child = spawn(bin, ['-version'], { stdio: ['ignore', 'pipe', 'pipe'] })
    child.on('error', () => resolve(null))
    child.on('exit', code => resolve(code === 0 ? bin : null))
  })
}

export function runProcess(
  bin: string,
  args: string[],
  timeoutMs = 120_000,
  abort?: () => boolean,
): Promise<{ ok: boolean; stdout: string; stderr: string; code: number; cancelled?: boolean }> {
  return new Promise(resolve => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let cancelled = false
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
    }, timeoutMs)
    const poll = abort
      ? setInterval(() => {
        if (!abort() || cancelled) return
        cancelled = true
        child.kill('SIGKILL')
      }, 200)
      : null
    child.stdout.on('data', (c: Buffer) => { stdout += c.toString() })
    child.stderr.on('data', (c: Buffer) => { stderr += c.toString() })
    child.on('error', err => {
      clearTimeout(timer)
      if (poll) clearInterval(poll)
      resolve({ ok: false, stdout, stderr: err.message, code: -1, cancelled })
    })
    child.on('exit', code => {
      clearTimeout(timer)
      if (poll) clearInterval(poll)
      resolve({
        ok: code === 0 && !cancelled,
        stdout,
        stderr: cancelled ? `${stderr}\nHVS_RENDER_CANCELLED` : stderr,
        code: code ?? -1,
        cancelled,
      })
    })
  })
}

export async function reportNvenc(): Promise<NvencReport> {
  if (nvencCached) return nvencCached
  const tools = await resolveFfmpegTools()
  const cpuAbsent = (detail: string, listed = { h264: false, hevc: false, av1: false }): NvencReport => ({
    status: 'ABSENT',
    h264NvencListed: listed.h264,
    hevcNvencListed: listed.hevc,
    av1NvencListed: listed.av1,
    encodeOk: false,
    detail,
  })
  if (!tools.ffmpeg) {
    nvencCached = cpuAbsent('Bundled HVS ffmpeg is not resolved.')
    return nvencCached
  }
  const encoders = await runProcess(tools.ffmpeg, ['-hide_banner', '-encoders'], 15_000)
  const listed = {
    h264: /\bh264_nvenc\b/.test(encoders.stdout),
    hevc: /\bhevc_nvenc\b/.test(encoders.stdout),
    av1: /\bav1_nvenc\b/.test(encoders.stdout),
  }
  if (!listed.h264) {
    nvencCached = cpuAbsent(
      'Bundled static ffmpeg has no h264_nvenc/hevc_nvenc/av1_nvenc. CPU libx264 is the HVS encoder.',
      listed,
    )
    return nvencCached
  }
  const probe = await runProcess(tools.ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=0.2:r=24',
    '-c:v', 'h264_nvenc', '-frames:v', '2', '-f', 'null', '-',
  ], 20_000)
  nvencCached = probe.ok
    ? {
        status: 'PASS',
        h264NvencListed: true,
        hevcNvencListed: listed.hevc,
        av1NvencListed: listed.av1,
        encodeOk: true,
        detail: 'h264_nvenc listed and a disposable encode probe succeeded.',
      }
    : {
        status: 'PRESENT_RUNTIME_FAILED',
        h264NvencListed: true,
        hevcNvencListed: listed.hevc,
        av1NvencListed: listed.av1,
        encodeOk: false,
        detail: probe.stderr.slice(-400) || 'h264_nvenc listed but the encode probe failed.',
      }
  return nvencCached
}

export async function chooseEncoder(): Promise<EncoderChoice> {
  if (encoderCached) return encoderCached
  const cpu: EncoderChoice = { videoCodec: 'libx264', hwaccel: 'none', label: 'CPU' }
  const nvenc = await reportNvenc()
  encoderCached = nvenc.status === 'PASS'
    ? { videoCodec: 'h264_nvenc', hwaccel: 'cuda', label: 'NVENC' }
    : cpu
  return encoderCached
}

export function videoEncodeArgs(choice: EncoderChoice): string[] {
  if (choice.videoCodec === 'h264_nvenc') {
    return ['-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', '19', '-pix_fmt', 'yuv420p']
  }
  return ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p']
}
