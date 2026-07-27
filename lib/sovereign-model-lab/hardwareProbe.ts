/**
 * Read-only hardware probe. Every field is either a real detected value or `null` — never a
 * fabricated guess. Uses Node's `os` module directly for CPU/RAM (no subprocess needed) and the
 * same safe execFile-array-args pattern already proven in lib/repo/status.ts for everything else
 * (git, python, nvidia-smi, wsl, disk space via a fixed PowerShell command — never a
 * user-influenced string). Installs nothing.
 */
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { statfs } from 'node:fs/promises'
import { resolveRepoRoot } from '@/lib/repo/paths'
import type { HardwareCapabilityClass, HardwareCapabilityReport } from './types'

const execFileAsync = promisify(execFile)
const PROBE_TIMEOUT_MS = 8000

/** Exported for reuse by tokenizerEnvironment.ts, which needs the same bounded, array-args-only
 * execFile discipline for its own Python/library probes rather than duplicating it. */
export async function tryExec(cmd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(cmd, args, {
      windowsHide: true,
      timeout: PROBE_TIMEOUT_MS,
      shell: process.platform === 'win32',
    })
    return stdout.trim() || null
  } catch {
    return null
  }
}

async function probeGpu(): Promise<{ name: string | null; memoryBytes: number | null; cudaAvailable: boolean }> {
  const out = await tryExec('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'])
  if (!out) return { name: null, memoryBytes: null, cudaAvailable: false }
  const [name, memMiB] = out.split(',').map(s => s.trim())
  const mem = Number(memMiB)
  return {
    name: name || null,
    memoryBytes: Number.isFinite(mem) ? Math.round(mem * 1024 * 1024) : null,
    cudaAvailable: true,
  }
}

export async function probePython(): Promise<{ available: boolean; version: string | null }> {
  const out = (await tryExec('python', ['--version'])) ?? (await tryExec('python3', ['--version']))
  return { available: Boolean(out), version: out }
}

/** Which of `python`/`python3` actually resolved on this machine — tokenizerEnvironment.ts needs
 * the executable name itself (not just its version string) to probe libraries under it. */
export async function resolvePythonExecutable(): Promise<string | null> {
  for (const candidate of ['python', 'python3']) {
    const out = await tryExec(candidate, ['--version'])
    if (out) return candidate
  }
  return null
}

async function probeGitVersion(): Promise<string | null> {
  return tryExec('git', ['--version'])
}

async function probeWsl(): Promise<boolean | null> {
  if (process.platform !== 'win32') return false
  const out = await tryExec('wsl.exe', ['--status'])
  return out !== null
}

/** Fixed PowerShell command, never interpolated with any external input — safe under
 * shell:true because the argv array holds a literal script we authored, not user text. */
export async function probeFreeDiskBytes(): Promise<number | null> {
  if (process.platform !== 'win32') {
    try {
      const stats = await statfs(resolveRepoRoot())
      return stats.bavail * stats.bsize
    } catch {
      return null
    }
  }
  const drive = resolveRepoRoot().slice(0, 2) // e.g. "C:"
  const out = await tryExec('powershell', [
    '-NoProfile',
    '-Command',
    `(Get-PSDrive -Name ${drive.replace(':', '')}).Free`,
  ])
  if (!out) return null
  const value = Number(out)
  return Number.isFinite(value) ? value : null
}

function classifyCapabilities(report: Omit<HardwareCapabilityReport, 'capabilityClasses' | 'honestyNote' | 'generatedAt'>): HardwareCapabilityClass[] {
  const classes: HardwareCapabilityClass[] = ['metadata_only']

  const ramGb = report.totalRamBytes ? report.totalRamBytes / 1024 ** 3 : null
  const hasEnoughDiskForDatasets = report.freeDiskBytes === null || report.freeDiskBytes > 5 * 1024 ** 3

  if (hasEnoughDiskForDatasets) classes.push('dataset_preparation')

  if (ramGb !== null && ramGb >= 8) classes.push('tiny_model_training')
  if ((ramGb !== null && ramGb >= 32) || report.cudaAvailable) classes.push('small_model_training')
  if (report.cudaAvailable && report.gpuMemoryBytes !== null) classes.push('inference_only')
  if (report.logicalCpuCount !== null && report.logicalCpuCount >= 16 && ramGb !== null && ramGb >= 32) {
    classes.push('distributed_command_node')
  }

  return classes
}

export async function runHardwareProbe(): Promise<HardwareCapabilityReport> {
  const generatedAt = new Date().toISOString()

  const cpus = os.cpus()
  const [gpu, python, gitVersion, wslAvailable, freeDiskBytes] = await Promise.all([
    probeGpu(),
    probePython(),
    probeGitVersion(),
    probeWsl(),
    probeFreeDiskBytes(),
  ])

  const base = {
    operatingSystem: `${os.type()} ${os.release()} (${process.platform}/${process.arch})`,
    cpuModel: cpus[0]?.model ?? null,
    logicalCpuCount: cpus.length || null,
    totalRamBytes: os.totalmem() || null,
    availableRamBytes: os.freemem() || null,
    gpuName: gpu.name,
    gpuMemoryBytes: gpu.memoryBytes,
    cudaAvailable: gpu.cudaAvailable,
    // DirectML has no reliable command-line probe without loading an ML runtime we don't want to
    // assume is installed — honestly unknown rather than guessed.
    directMlAvailable: null,
    freeDiskBytes,
    pythonAvailable: python.available,
    pythonVersion: python.version,
    nodeVersion: process.version,
    gitVersion,
    wslAvailable,
  }

  const capabilityClasses = classifyCapabilities(base)

  return {
    generatedAt,
    ...base,
    capabilityClasses,
    honestyNote: 'Every field above is either a real detected value or null (unknown/not detected) — never a fabricated estimate. cudaAvailable reflects whether nvidia-smi succeeded, a proxy for NVIDIA driver presence, not proof any ML framework is installed. directMlAvailable is always null in Phase 1 (no reliable no-install probe exists).',
  }
}
