import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { mediaCommandDataHierarchy } from '../paths'
import { resolveFfmpegTools, runProcess } from '../ffmpeg'

export type KernelFixtureKind = 'color-bars' | 'clip-a' | 'clip-b' | 'tone'

export type KernelFixture = {
  kind: KernelFixtureKind
  path: string
  name: string
  provenance: {
    origin: 'generated'
    lawful: true
    source: 'hvs-kernel-synthetic'
    description: string
    commercialUse: 'allowed'
  }
}

async function encode(dest: string, args: string[]): Promise<{ ok: boolean; error: string | null; path: string }> {
  const tools = await resolveFfmpegTools()
  if (!tools.ffmpeg) return { ok: false, error: 'HVS ffmpeg was not resolved.', path: dest }
  await mkdir(path.dirname(dest), { recursive: true })
  const result = await runProcess(tools.ffmpeg, ['-y', ...args, dest], 120_000)
  if (!result.ok || !existsSync(dest)) {
    return { ok: false, error: result.stderr.slice(-800) || 'Fixture encode failed.', path: dest }
  }
  return { ok: true, error: null, path: dest }
}

export async function generateKernelFixtures(): Promise<{
  ok: boolean
  error: string | null
  fixtures: Record<KernelFixtureKind, KernelFixture>
}> {
  const dir = path.join(mediaCommandDataHierarchy().fixtures, 'hvs-tool-kernel')
  await mkdir(dir, { recursive: true })
  const barsPath = path.join(dir, 'color-bars.mp4')
  const clipAPath = path.join(dir, 'clip-a.mp4')
  const clipBPath = path.join(dir, 'clip-b.mp4')
  const tonePath = path.join(dir, 'tone.wav')

  const bars = await encode(barsPath, [
    '-f', 'lavfi', '-i', 'smptebars=size=640x360:rate=24:duration=2',
    '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '128k',
    '-shortest', '-movflags', '+faststart',
  ])
  const clipA = await encode(clipAPath, [
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=2',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2',
    '-filter_complex', "[0:v]drawbox=x='40+t*180':y=80:w=90:h=90:color=white@0.95:t=fill,format=yuv420p[v]",
    '-map', '[v]', '-map', '1:a',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '128k',
    '-movflags', '+faststart',
  ])
  const clipB = await encode(clipBPath, [
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=2',
    '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=2',
    '-filter_complex', "[0:v]drawbox=x='40+t*180':y=160:w=90:h=90:color=red@0.95:t=fill,format=yuv420p[v]",
    '-map', '[v]', '-map', '1:a',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '128k',
    '-movflags', '+faststart',
  ])
  const tone = await encode(tonePath, [
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1',
    '-c:a', 'pcm_s16le',
  ])

  const failed = [bars, clipA, clipB, tone].find(item => !item.ok)
  const fixtures: Record<KernelFixtureKind, KernelFixture> = {
    'color-bars': {
      kind: 'color-bars',
      path: barsPath,
      name: 'color-bars.mp4',
      provenance: {
        origin: 'generated',
        lawful: true,
        source: 'hvs-kernel-synthetic',
        description: 'FFmpeg smptebars + 1 kHz tone. No third-party media.',
        commercialUse: 'allowed',
      },
    },
    'clip-a': {
      kind: 'clip-a',
      path: clipAPath,
      name: 'clip-a.mp4',
      provenance: {
        origin: 'generated',
        lawful: true,
        source: 'hvs-kernel-synthetic',
        description: 'Synthetic testsrc2 plate with moving box + 440 Hz tone.',
        commercialUse: 'allowed',
      },
    },
    'clip-b': {
      kind: 'clip-b',
      path: clipBPath,
      name: 'clip-b.mp4',
      provenance: {
        origin: 'generated',
        lawful: true,
        source: 'hvs-kernel-synthetic',
        description: 'Synthetic testsrc2 plate with moving box + 880 Hz tone.',
        commercialUse: 'allowed',
      },
    },
    tone: {
      kind: 'tone',
      path: tonePath,
      name: 'tone.wav',
      provenance: {
        origin: 'generated',
        lawful: true,
        source: 'hvs-kernel-synthetic',
        description: '1 second PCM sine. No third-party media.',
        commercialUse: 'allowed',
      },
    },
  }
  return { ok: !failed, error: failed?.error ?? null, fixtures }
}
