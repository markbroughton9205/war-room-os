/**
 * Disposable Higher Vision test media.
 * Moving subject plates plus a tone — not a fake thumbnail.
 */
import { mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { mediaCommandDataHierarchy } from './paths'
import { resolveFfmpegTools, runProcess } from './ffmpeg'

export async function generateStarrdomTestClip(outputPath?: string): Promise<{ path: string; ok: boolean; error: string | null }> {
  const tools = await resolveFfmpegTools()
  if (!tools.ffmpeg) return { path: '', ok: false, error: 'HVS bundled ffmpeg was not resolved.' }
  const dirs = mediaCommandDataHierarchy()
  await mkdir(dirs.fixtures, { recursive: true })
  const dest = outputPath ?? path.join(dirs.fixtures, 'hvs-demo-plate.mp4')
  const result = await runProcess(tools.ffmpeg, [
    '-y',
    '-f', 'lavfi', '-i', 'color=c=0x1A120A:s=1920x1080:d=4:r=24',
    '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000:duration=4',
    '-filter_complex', "[0:v]drawbox=x='360+t*220':y=160:w=260:h=620:color=white@0.95:t=fill,format=yuv420p[v]",
    '-map', '[v]', '-map', '1:a',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '128k',
    '-movflags', '+faststart',
    dest,
  ], 120_000)
  if (!result.ok || !existsSync(dest)) {
    return { path: dest, ok: false, error: result.stderr.slice(-600) || 'Failed to generate test clip.' }
  }
  return { path: dest, ok: true, error: null }
}

export async function generateHvsPersonPlate(outputPath?: string): Promise<{ path: string; ok: boolean; error: string | null; kind: 'person-shaped-fixture' }> {
  const tools = await resolveFfmpegTools()
  if (!tools.ffmpeg) return { path: '', ok: false, error: 'HVS bundled ffmpeg was not resolved.', kind: 'person-shaped-fixture' }
  const dirs = mediaCommandDataHierarchy()
  await mkdir(dirs.fixtures, { recursive: true })
  const dest = outputPath ?? path.join(dirs.fixtures, 'hvs-demo-person.mp4')
  const result = await runProcess(tools.ffmpeg, [
    '-y',
    '-f', 'lavfi', '-i', 'color=c=0x243044:s=1920x1080:d=4:r=24',
    '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000:duration=4',
    '-filter_complex',
    "[0:v]drawbox=x='640+t*210':y=210:w=150:h=40:color=0x1A0E08@1:t=fill,"
      + "drawbox=x='650+t*210':y=248:w=130:h=140:color=0xE8C4A0@1:t=fill,"
      + "drawbox=x='680+t*210':y=290:w=18:h=18:color=0x1A120A@1:t=fill,"
      + "drawbox=x='732+t*210':y=290:w=18:h=18:color=0x1A120A@1:t=fill,"
      + "drawbox=x='620+t*210':y=388:w=190:h=300:color=0x3A2418@1:t=fill,"
      + "drawbox=x='640+t*210':y=688:w=60:h=220:color=0x1E1510@1:t=fill,"
      + "drawbox=x='730+t*210':y=688:w=60:h=220:color=0x1E1510@1:t=fill,"
      + 'format=yuv420p[v]',
    '-map', '[v]', '-map', '1:a',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '128k',
    '-movflags', '+faststart',
    dest,
  ], 120_000)
  if (!result.ok || !existsSync(dest)) {
    return { path: dest, ok: false, error: result.stderr.slice(-600) || 'Failed to generate person fixture.', kind: 'person-shaped-fixture' }
  }
  return { path: dest, ok: true, error: null, kind: 'person-shaped-fixture' }
}

export async function generateLostTargetPlate(outputPath?: string): Promise<{ path: string; ok: boolean; error: string | null; kind: 'lost-target-fixture' }> {
  const tools = await resolveFfmpegTools()
  if (!tools.ffmpeg) return { path: '', ok: false, error: 'HVS bundled ffmpeg was not resolved.', kind: 'lost-target-fixture' }
  const dirs = mediaCommandDataHierarchy()
  await mkdir(dirs.fixtures, { recursive: true })
  const dest = outputPath ?? path.join(dirs.fixtures, 'hvs-lost-target.mp4')
  const result = await runProcess(tools.ffmpeg, [
    '-y',
    '-f', 'lavfi', '-i', 'color=c=0x243044:s=1920x1080:d=5:r=24',
    '-f', 'lavfi', '-i', 'color=c=0xC41E3A:s=1920x1080:d=5:r=24',
    '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000:duration=5',
    '-filter_complex',
    "[0:v]drawbox=x='360+t*180':y=210:w=150:h=40:color=0x1A0E08@1:t=fill,"
      + "drawbox=x='370+t*180':y=248:w=130:h=140:color=0xE8C4A0@1:t=fill,"
      + "drawbox=x='340+t*180':y=388:w=190:h=300:color=0x3A2418@1:t=fill[person];"
      + "[person][1:v]overlay=eof_action=repeat:enable='between(t\\,2\\,3.5)'[v]",
    '-map', '[v]', '-map', '2:a',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '128k',
    '-movflags', '+faststart',
    dest,
  ], 120_000)
  if (!result.ok || !existsSync(dest)) {
    return { path: dest, ok: false, error: result.stderr.slice(-600) || 'Failed to generate lost-target fixture.', kind: 'lost-target-fixture' }
  }
  return { path: dest, ok: true, error: null, kind: 'lost-target-fixture' }
}

export async function generateStarrdomTone(outputPath?: string): Promise<{ path: string; ok: boolean; error: string | null }> {
  const tools = await resolveFfmpegTools()
  if (!tools.ffmpeg) return { path: '', ok: false, error: 'HVS bundled ffmpeg was not resolved.' }
  const dirs = mediaCommandDataHierarchy()
  const dest = outputPath ?? path.join(dirs.fixtures, 'hvs-demo-music.wav')
  const result = await runProcess(tools.ffmpeg, [
    '-y', '-f', 'lavfi', '-i', 'sine=frequency=110:sample_rate=48000:duration=4',
    dest,
  ], 30_000)
  return { path: dest, ok: true, error: null }
}

export async function generateColorStill(opts: { color: string; outputPath?: string }): Promise<{ path: string; ok: boolean; error: string | null }> {
  const tools = await resolveFfmpegTools()
  if (!tools.ffmpeg) return { path: '', ok: false, error: 'HVS bundled ffmpeg was not resolved.' }
  const dirs = mediaCommandDataHierarchy()
  await mkdir(dirs.fixtures, { recursive: true })
  const dest = opts.outputPath ?? path.join(dirs.fixtures, `hvs-still-${opts.color.replace('#', '')}.png`)
  const result = await runProcess(tools.ffmpeg, [
    '-y',
    '-f', 'lavfi', '-i', `color=c=${opts.color}:s=1280x720:d=1:r=24`,
    '-frames:v', '1',
    dest,
  ], 30_000)
  if (!result.ok || !existsSync(dest)) {
    return { path: dest, ok: false, error: result.stderr.slice(-500) || 'Failed to generate still.' }
  }
  return { path: dest, ok: true, error: null }
}

export async function generateMotionPlate(opts: {
  seconds?: number
  color?: string
  speed?: number
  outputPath?: string
}): Promise<{ path: string; ok: boolean; error: string | null }> {
  const tools = await resolveFfmpegTools()
  if (!tools.ffmpeg) return { path: '', ok: false, error: 'HVS bundled ffmpeg was not resolved.' }
  const dirs = mediaCommandDataHierarchy()
  await mkdir(dirs.fixtures, { recursive: true })
  const seconds = opts.seconds ?? 12
  const color = opts.color ?? '0x1A120A'
  const speed = opts.speed ?? 180
  const dest = opts.outputPath ?? path.join(dirs.fixtures, `hvs-motion-${color.replace('#', '')}-${seconds}s.mp4`)
  const result = await runProcess(tools.ffmpeg, [
    '-y',
    '-f', 'lavfi', '-i', `color=c=${color}:s=1920x1080:d=${seconds}:r=24`,
    '-f', 'lavfi', '-i', `sine=frequency=220:sample_rate=48000:duration=${seconds}`,
    '-filter_complex', `[0:v]drawbox=x='200+t*${speed}':y=180:w=240:h=560:color=white@0.95:t=fill,format=yuv420p[v]`,
    '-map', '[v]', '-map', '1:a',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '128k',
    '-movflags', '+faststart',
    dest,
  ], 120_000)
  if (!result.ok || !existsSync(dest)) {
    return { path: dest, ok: false, error: result.stderr.slice(-600) || 'Failed to generate motion plate.' }
  }
  return { path: dest, ok: true, error: null }
}

export async function generateColorPlate(opts: { color: string; seconds?: number; outputPath?: string; frameRate?: { n: number; d: number } }): Promise<{ path: string; ok: boolean; error: string | null }> {
  const tools = await resolveFfmpegTools()
  if (!tools.ffmpeg) return { path: '', ok: false, error: 'HVS bundled ffmpeg was not resolved.' }
  const dirs = mediaCommandDataHierarchy()
  await mkdir(dirs.fixtures, { recursive: true })
  const dest = opts.outputPath ?? path.join(dirs.fixtures, `hvs-plate-${opts.color.replace('#', '')}.mp4`)
  const seconds = opts.seconds ?? 3
  const fps = opts.frameRate && opts.frameRate.n > 0 && opts.frameRate.d > 0
    ? (opts.frameRate.d === 1 ? String(opts.frameRate.n) : `${opts.frameRate.n}/${opts.frameRate.d}`)
    : '24'
  const result = await runProcess(tools.ffmpeg, [
    '-y',
    '-f', 'lavfi', '-i', `color=c=${opts.color}:s=1280x720:d=${seconds}:r=${fps}`,
    '-f', 'lavfi', '-i', `sine=frequency=330:sample_rate=48000:duration=${seconds}`,
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '18',
    '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '128k',
    '-movflags', '+faststart',
    dest,
  ], 60_000)
  if (!result.ok || !existsSync(dest)) {
    return { path: dest, ok: false, error: result.stderr.slice(-500) || 'Failed to generate color plate.' }
  }
  return { path: dest, ok: true, error: null }
}

export const HVS_SPOKEN_FIXTURE_PHRASE = 'Higher Vision Studios makes a thirty second promo.'

export async function generateSpokenClip(opts?: {
  seconds?: number
  phrase?: string
  outputPath?: string
}): Promise<{ path: string; ok: boolean; error: string | null; phrase: string }> {
  const tools = await resolveFfmpegTools()
  const phrase = opts?.phrase ?? HVS_SPOKEN_FIXTURE_PHRASE
  if (!tools.ffmpeg) return { path: '', ok: false, error: 'HVS bundled ffmpeg was not resolved.', phrase }
  const dirs = mediaCommandDataHierarchy()
  await mkdir(dirs.fixtures, { recursive: true })
  const wav = path.join(dirs.tmp, `spoken-${Date.now().toString(36)}.wav`)
  const dest = opts?.outputPath ?? path.join(dirs.fixtures, 'hvs-spoken-s4.mp4')
  const py = `import ctypes, sys, wave, array
phrase = sys.argv[1]
out = sys.argv[2]
lib = ctypes.CDLL('libespeak-ng.so.1')
AUDIO_OUTPUT_RETRIEVAL = 1
samples = array.array('h')
CALLBACK = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.POINTER(ctypes.c_short), ctypes.c_int, ctypes.c_void_p)
def cb(wavptr, num, event):
    if wavptr and num > 0:
        samples.extend(wavptr[i] for i in range(num))
    return 0
cb_fn = CALLBACK(cb)
rate = lib.espeak_Initialize(AUDIO_OUTPUT_RETRIEVAL, 0, None, 0)
if rate <= 0:
    rate = 22050
lib.espeak_SetSynthCallback(cb_fn)
try:
    lib.espeak_SetVoiceByName(b'en')
except Exception:
    pass
text = phrase.encode('utf-8')
lib.espeak_Synth(text, len(text)+1, 0, 1, 0, 0, None, None)
lib.espeak_Synchronize()
if not len(samples):
    raise SystemExit('no samples')
with wave.open(out, 'w') as fh:
    fh.setnchannels(1)
    fh.setsampwidth(2)
    fh.setframerate(int(rate))
    fh.writeframes(samples.tobytes())
`
  const { writeFileSync } = await import('node:fs')
  const script = path.join(dirs.tmp, 'espeak-wav.py')
  writeFileSync(script, py, 'utf8')
  const { spawnSync } = await import('node:child_process')
  const spoken = spawnSync('python3', [script, phrase, wav], { encoding: 'utf8', timeout: 20_000 })
  if (spoken.status !== 0 || !existsSync(wav)) {
    return generateJfkSpokenClip({ outputPath: dest, phraseFallback: phrase })
  }
  const seconds = opts?.seconds ?? 8
  const result = await runProcess(tools.ffmpeg, [
    '-y',
    '-f', 'lavfi', '-i', `color=c=0x1A120A:s=1920x1080:d=${seconds}:r=24`,
    '-i', wav,
    '-filter_complex', "[0:v]drawbox=x='420+t*90':y=220:w=220:h=420:color=white@0.92:t=fill,format=yuv420p[v]",
    '-map', '[v]', '-map', '1:a',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'aac', '-ar', '16000', '-ac', '1', '-b:a', '96k',
    '-shortest',
    '-movflags', '+faststart',
    dest,
  ], 60_000)
  if (!result.ok || !existsSync(dest)) {
    return { path: dest, ok: false, error: result.stderr.slice(-500) || 'Failed to mux spoken fixture.', phrase }
  }
  return { path: dest, ok: true, error: null, phrase }
}

export function jfkSamplePath(): string {
  return path.join(mediaCommandDataHierarchy().tools, 'whisper.cpp-src', 'samples', 'jfk.wav')
}

export async function generateJfkSpokenClip(opts?: {
  outputPath?: string
  phraseFallback?: string
}): Promise<{ path: string; ok: boolean; error: string | null; phrase: string }> {
  const tools = await resolveFfmpegTools()
  const phrase = 'And so my fellow Americans ask not what your country can do for you'
  if (!tools.ffmpeg) return { path: '', ok: false, error: 'HVS bundled ffmpeg was not resolved.', phrase }
  const dirs = mediaCommandDataHierarchy()
  await mkdir(dirs.fixtures, { recursive: true })
  const wav = jfkSamplePath()
  const dest = opts?.outputPath ?? path.join(dirs.fixtures, 'hvs-spoken-jfk.mp4')
  if (!existsSync(wav)) {
    return { path: dest, ok: false, error: `Official whisper.cpp JFK sample missing at ${wav}`, phrase }
  }
  const result = await runProcess(tools.ffmpeg, [
    '-y',
    '-f', 'lavfi', '-i', 'color=c=0x1A120A:s=1920x1080:d=12:r=24',
    '-i', wav,
    '-filter_complex', "[0:v]drawbox=x='420+t*90':y=220:w=220:h=420:color=white@0.92:t=fill,format=yuv420p[v]",
    '-map', '[v]', '-map', '1:a',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'aac', '-ar', '16000', '-ac', '1', '-b:a', '96k',
    '-shortest',
    '-movflags', '+faststart',
    dest,
  ], 60_000)
  if (!result.ok || !existsSync(dest)) {
    return { path: dest, ok: false, error: result.stderr.slice(-500) || 'Failed to mux JFK spoken fixture.', phrase }
  }
  return { path: dest, ok: true, error: null, phrase }
}

