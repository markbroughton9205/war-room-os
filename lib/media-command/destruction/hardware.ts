import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'

export type NebulaHardwareAudit = {
  os: string
  cpu: string
  physicalCores: number | 'UNKNOWN'
  logicalCores: number | 'UNKNOWN'
  ramBytes: number | 'UNKNOWN'
  gpuVendor: string
  gpuModel: string
  gpuVram: string
  driver: string
  cuda: string
  vulkan: string
  diskFree: string
  cacheDiskPath: string
  sequentialDiskThroughput: string
}

function readOs(): string {
  try {
    const release = readFileSync('/etc/os-release', 'utf8')
    const pretty = release.match(/^PRETTY_NAME="(.*)"$/m)?.[1]
    return `${pretty ?? os.platform()} ${os.release()} ${os.arch()}`
  } catch {
    return `${os.platform()} ${os.release()} ${os.arch()}`
  }
}

function cpuModel(): string {
  const match = os.cpus()[0]?.model
  return match || 'UNKNOWN'
}

export function auditNebulaHardware(cacheDiskPath: string): NebulaHardwareAudit {
  const logical = os.cpus().length || 'UNKNOWN'
  let physical: number | 'UNKNOWN' = 'UNKNOWN'
  try {
    const out = execFileSync('lscpu', ['-p=Core,Socket'], { encoding: 'utf8', timeout: 3000 })
    const cores = new Set(out.split('\n').filter(line => line && !line.startsWith('#')))
    physical = cores.size || 'UNKNOWN'
  } catch {
    physical = 'UNKNOWN'
  }
  let gpuVendor = 'UNKNOWN'
  let gpuModel = 'UNKNOWN'
  let gpuVram = 'UNKNOWN'
  let driver = 'UNKNOWN'
  try {
    const row = execFileSync('nvidia-smi', ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader'], { encoding: 'utf8', timeout: 4000 }).trim()
    const [name, memory, driverVersion] = row.split(',').map(part => part.trim())
    gpuVendor = 'NVIDIA'
    gpuModel = name || 'UNKNOWN'
    gpuVram = memory || 'UNKNOWN'
    driver = driverVersion || 'UNKNOWN'
  } catch {
    gpuVendor = 'UNKNOWN'
    gpuModel = 'UNKNOWN'
    gpuVram = 'UNKNOWN'
    driver = 'UNKNOWN'
  }
  let cuda = 'UNKNOWN'
  try {
    const out = execFileSync('nvcc', ['--version'], { encoding: 'utf8', timeout: 4000 })
    cuda = out.split('\n').find(line => line.includes('release'))?.trim() ?? 'PRESENT'
  } catch {
    cuda = existsSync('/usr/local/cuda') ? 'CUDA_DIR_PRESENT_NVCC_UNKNOWN' : 'NOT_INSTALLED'
  }
  const vulkanLoader = existsSync('/usr/lib/x86_64-linux-gnu/libvulkan.so.1')
  const nvidiaIcd = existsSync('/usr/share/vulkan/icd.d/nvidia_icd.json')
  let vulkanInfo = 'NOT_INSTALLED'
  try {
    execFileSync('which', ['vulkaninfo'], { stdio: 'ignore', timeout: 2000 })
    vulkanInfo = 'AVAILABLE'
  } catch {
    vulkanInfo = 'NOT_INSTALLED'
  }
  const vulkan = vulkanInfo === 'AVAILABLE'
    ? 'vulkaninfo AVAILABLE'
    : `loader ${vulkanLoader ? 'PRESENT' : 'ABSENT'}; nvidia ICD ${nvidiaIcd ? 'PRESENT' : 'ABSENT'}; vulkaninfo NOT_INSTALLED; device enumeration UNKNOWN`
  let diskFree = 'UNKNOWN'
  try {
    const out = execFileSync('df', ['-h', cacheDiskPath], { encoding: 'utf8', timeout: 3000 })
    diskFree = out.trim().split('\n').at(-1) ?? 'UNKNOWN'
  } catch {
    diskFree = 'UNKNOWN'
  }
  let sequentialDiskThroughput = 'UNKNOWN'
  try {
    execFileSync('which', ['hdparm'], { stdio: 'ignore', timeout: 2000 })
    sequentialDiskThroughput = 'UNKNOWN (hdparm present, read benchmark not permitted)'
  } catch {
    sequentialDiskThroughput = 'UNKNOWN'
  }
  return {
    os: readOs(),
    cpu: cpuModel(),
    physicalCores: physical,
    logicalCores: logical,
    ramBytes: os.totalmem() || 'UNKNOWN',
    gpuVendor,
    gpuModel,
    gpuVram,
    driver,
    cuda,
    vulkan,
    diskFree,
    cacheDiskPath,
    sequentialDiskThroughput,
  }
}
