import { execFileSync } from 'node:child_process'
import os from 'node:os'

export type NebulaHardware = {
  platform: string
  cpuName: string | null
  cpuCores: number | null
  cpuLogical: number | null
  ramBytes: number
  ramGiB: number
  gpuName: string | null
  gpuVramMiB: number | null
  gpuDriver: string | null
  nvidiaSmi: string | null
  cudaUmd: string | null
  cudaPath: string | null
  nvcc: string | null
  storage: Array<{ name: string; mediaType: string; busType: string; sizeBytes: number; health: string }>
  volumes: Array<{ letter: string; fs: string; sizeGB: number; freeGB: number }>
  bf16Measured: 'NOT_MEASURED'
  fp16Measured: 'NOT_MEASURED'
  notes: string[]
}

function wmicOrCim(command: string): string {
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-Command', command], {
      encoding: 'utf8',
      timeout: 15000,
      windowsHide: true,
    }).trim()
  } catch {
    return ''
  }
}

function parseJsonSafe(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export function probeNebulaHardware(): NebulaHardware {
  const cpuRaw = wmicOrCim(
    'Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors | ConvertTo-Json -Compress',
  )
  const cpu = (parseJsonSafe(cpuRaw) ?? {}) as {
    Name?: string
    NumberOfCores?: number
    NumberOfLogicalProcessors?: number
  }
  const gpuRaw = wmicOrCim(
    'Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion | ConvertTo-Json -Compress',
  )
  const gpuParsed = parseJsonSafe(gpuRaw)
  const gpu = (Array.isArray(gpuParsed) ? gpuParsed[0] : gpuParsed ?? {}) as {
    Name?: string
    DriverVersion?: string
  }
  let nvidiaSmi: string | null = null
  let gpuVramMiB: number | null = null
  let cudaUmd: string | null = null
  try {
    nvidiaSmi = execFileSync('nvidia-smi', [], { encoding: 'utf8', timeout: 10000, windowsHide: true })
    const mem = nvidiaSmi.match(/(\d+)\s*MiB\s*\/\s*(\d+)\s*MiB/)
    if (mem) gpuVramMiB = Number(mem[2])
    const umd = nvidiaSmi.match(/CUDA UMD Version:\s*([0-9.]+)/)
    if (umd) cudaUmd = umd[1]!
  } catch {
    nvidiaSmi = null
  }
  const diskRaw = wmicOrCim(
    'Get-PhysicalDisk | Select-Object FriendlyName,MediaType,BusType,Size,HealthStatus | ConvertTo-Json -Compress',
  )
  const diskParsed = parseJsonSafe(diskRaw)
  const disks = (Array.isArray(diskParsed) ? diskParsed : diskParsed ? [diskParsed] : []) as Array<{
    FriendlyName?: string
    MediaType?: string
    BusType?: string
    Size?: number
    HealthStatus?: string
  }>
  const volRaw = wmicOrCim(
    'Get-Volume | Where-Object { $_.DriveLetter } | Select-Object DriveLetter,FileSystem,@{N="Size";E={$_.Size}},@{N="Free";E={$_.SizeRemaining}} | ConvertTo-Json -Compress',
  )
  const volParsed = parseJsonSafe(volRaw)
  const vols = (Array.isArray(volParsed) ? volParsed : volParsed ? [volParsed] : []) as Array<{
    DriveLetter?: string
    FileSystem?: string
    Size?: number
    Free?: number
  }>
  let nvcc: string | null = null
  try {
    nvcc = execFileSync('where.exe', ['nvcc'], { encoding: 'utf8', timeout: 5000, windowsHide: true }).trim() || null
  } catch {
    nvcc = null
  }
  const ramBytes = os.totalmem()
  return {
    platform: `${os.platform()} ${os.arch()} ${os.release()}`,
    cpuName: cpu.Name ?? null,
    cpuCores: cpu.NumberOfCores ?? os.cpus().length,
    cpuLogical: cpu.NumberOfLogicalProcessors ?? os.cpus().length,
    ramBytes,
    ramGiB: Math.round((ramBytes / (1024 ** 3)) * 100) / 100,
    gpuName: gpu.Name ?? null,
    gpuVramMiB,
    gpuDriver: gpu.DriverVersion ?? null,
    nvidiaSmi: nvidiaSmi ? 'present' : null,
    cudaUmd,
    cudaPath: process.env.CUDA_PATH?.trim() || null,
    nvcc,
    storage: disks.map(d => ({
      name: String(d.FriendlyName ?? ''),
      mediaType: String(d.MediaType ?? ''),
      busType: String(d.BusType ?? ''),
      sizeBytes: Number(d.Size ?? 0),
      health: String(d.HealthStatus ?? ''),
    })),
    volumes: vols.map(v => ({
      letter: String(v.DriveLetter ?? ''),
      fs: String(v.FileSystem ?? ''),
      sizeGB: Math.round((Number(v.Size ?? 0) / (1024 ** 3)) * 100) / 100,
      freeGB: Math.round((Number(v.Free ?? 0) / (1024 ** 3)) * 100) / 100,
    })),
    bf16Measured: 'NOT_MEASURED',
    fp16Measured: 'NOT_MEASURED',
    notes: [
      'WMI AdapterRAM is 32-bit truncated and must not be used; nvidia-smi VRAM is authoritative when present.',
      'BF16/FP16 software support is NOT_MEASURED because PyTorch is not installed.',
      'NVMe sequential characteristics were not benchmarked this pass.',
      'CUDA toolkit/nvcc may be absent even when the NVIDIA driver reports a CUDA UMD version.',
    ],
  }
}
