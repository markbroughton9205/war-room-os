/**
 * Inspect the resolved HVS FFmpeg build. Do not replace it in this slice.
 * License posture is classified from actual -buildconf flags, not assumed.
 */
import { spawn } from 'node:child_process'
import { resolveFfmpegTools, reportNvenc, runProcess, type NvencReport } from '../ffmpeg'

export type HvsFfmpegLicenseClass =
  | 'LGPL_COMPATIBLE'
  | 'GPL_ENABLED'
  | 'NONFREE_ENABLED'
  | 'UNKNOWN'

export type HvsFfmpegAudit = {
  ffmpegPath: string | null
  ffprobePath: string | null
  ffmpegVersion: string | null
  ffprobeVersion: string | null
  buildconf: string | null
  enableGpl: boolean
  enableVersion3: boolean
  enableNonfree: boolean
  enableLibx264: boolean
  enableLibx265: boolean
  enableNvenc: boolean
  enableCuda: boolean
  enableLibnpp: boolean
  licenseClass: HvsFfmpegLicenseClass
  redistributableProductPath: boolean
  classification: string
  nvenc: NvencReport | null
  hardware: HvsHardwareAudit
}

export type HvsHardwareAudit = {
  nvidiaSmi: boolean
  gpuName: string | null
  vramMiB: number | null
  nvencSessions: number | null
  notes: string
}

function firstLine(text: string): string | null {
  const line = text.split(/\r?\n/).map(item => item.trim()).find(Boolean)
  return line || null
}

function hasFlag(buildconf: string, flag: string): boolean {
  return new RegExp(`(?:^|\\s)${flag}(?:\\s|$)`).test(buildconf)
}

async function capture(bin: string, args: string[]): Promise<string> {
  const result = await runProcess(bin, args, 15_000)
  return `${result.stdout}\n${result.stderr}`.trim()
}

function runText(bin: string, args: string[], timeoutMs = 8_000): Promise<{ ok: boolean; text: string }> {
  return new Promise(resolve => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let text = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => { text += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { text += chunk.toString() })
    child.on('error', () => {
      clearTimeout(timer)
      resolve({ ok: false, text: '' })
    })
    child.on('exit', code => {
      clearTimeout(timer)
      resolve({ ok: code === 0, text })
    })
  })
}

export async function auditHardware(): Promise<HvsHardwareAudit> {
  const probe = await runText('nvidia-smi', [
    '--query-gpu=name,memory.total',
    '--format=csv,noheader,nounits',
  ])
  if (!probe.ok || !probe.text.trim()) {
    return {
      nvidiaSmi: false,
      gpuName: null,
      vramMiB: null,
      nvencSessions: null,
      notes: 'nvidia-smi unavailable. Kernel master uses software libx264. NVENC is not assumed.',
    }
  }
  const row = probe.text.trim().split(/\r?\n/)[0] ?? ''
  const [name, mem] = row.split(',').map(part => part.trim())
  const vramMiB = Number(mem)
  return {
    nvidiaSmi: true,
    gpuName: name || null,
    vramMiB: Number.isFinite(vramMiB) ? vramMiB : null,
    nvencSessions: null,
    notes: 'GPU name/VRAM inventoried from nvidia-smi. NVENC session limits were not assumed; encode uses the live ffmpeg probe.',
  }
}

export async function auditFfmpegBuild(): Promise<HvsFfmpegAudit> {
  const tools = await resolveFfmpegTools()
  const ffmpegVersion = tools.ffmpeg ? firstLine(await capture(tools.ffmpeg, ['-version'])) : null
  const ffprobeVersion = tools.ffprobe ? firstLine(await capture(tools.ffprobe, ['-version'])) : null
  const buildconf = tools.ffmpeg ? await capture(tools.ffmpeg, ['-buildconf']) : null
  const conf = buildconf ?? ''
  const enableGpl = hasFlag(conf, '--enable-gpl')
  const enableVersion3 = hasFlag(conf, '--enable-version3')
  const enableNonfree = hasFlag(conf, '--enable-nonfree')
  const enableLibx264 = hasFlag(conf, '--enable-libx264')
  const enableLibx265 = hasFlag(conf, '--enable-libx265')
  const enableNvenc = hasFlag(conf, '--enable-nvenc') || hasFlag(conf, '--enable-libnpp') || /nvenc/i.test(conf)
  const enableCuda = hasFlag(conf, '--enable-cuda') || hasFlag(conf, '--enable-cuda-nvcc') || hasFlag(conf, '--enable-cuda-llvm')
  const enableLibnpp = hasFlag(conf, '--enable-libnpp')
  let licenseClass: HvsFfmpegLicenseClass = 'UNKNOWN'
  if (enableNonfree) licenseClass = 'NONFREE_ENABLED'
  else if (enableGpl || enableVersion3) licenseClass = 'GPL_ENABLED'
  else if (tools.ffmpeg) licenseClass = 'LGPL_COMPATIBLE'
  const redistributableProductPath = licenseClass === 'LGPL_COMPATIBLE' && !enableNonfree
  const classification = enableNonfree
    ? 'Installed FFmpeg enables --enable-nonfree. Unsuitable as a redistributable product binary. Not replaced in this slice.'
    : licenseClass === 'GPL_ENABLED'
      ? 'Installed FFmpeg is GPL-enabled (libx264/x265 typical). Usable locally; redistributable product path is GPL, not LGPL.'
      : licenseClass === 'LGPL_COMPATIBLE'
        ? 'Installed FFmpeg buildconf does not show --enable-gpl or --enable-nonfree. LGPL-compatible posture.'
        : 'FFmpeg was not resolved or buildconf could not be classified.'
  const nvenc = tools.ffmpeg ? await reportNvenc() : null
  const hardware = await auditHardware()
  return {
    ffmpegPath: tools.ffmpeg,
    ffprobePath: tools.ffprobe,
    ffmpegVersion,
    ffprobeVersion,
    buildconf,
    enableGpl,
    enableVersion3,
    enableNonfree,
    enableLibx264,
    enableLibx265,
    enableNvenc,
    enableCuda,
    enableLibnpp,
    licenseClass,
    redistributableProductPath,
    classification,
    nvenc,
    hardware,
  }
}
