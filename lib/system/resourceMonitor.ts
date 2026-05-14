/**
 * Server-side host + process resource snapshot (Node.js `os` + `process`).
 * Metrics are read from the runtime — never fabricated.
 *
 * **Windows note:** `os.loadavg()` is typically `[0, 0, 0]` (not meaningful).
 * Prefer `memoryUsageRatio`, `process.memoryUsage().rss`, and application-level
 * queue depth for gating on Windows.
 *
 * **CPU %:** Deriving accurate CPU percentage without native bindings is
 * approximate. `cpuUsageSinceStart` is cumulative user/system microseconds from
 * `process.cpuUsage()` since process start; optional caller-provided previous
 * snapshot enables a **delta** over an interval for rough pressure signals only.
 *
 * **Thermal:** Without hardware sensors, `warnings.thermal` stays `unknown`.
 * Do not fake sensor data.
 */

import os from 'node:os'

export const RAM_WARNING_RATIO = 0.85
export const RAM_CRITICAL_RATIO = 0.92

/** Load average index 0 above this fraction of CPU count → CPU warning (non-Windows only when loadavg is meaningful). */
const LOAD_WARNING_FRACTION_OF_CORES = 0.85

export type MemoryWarningLevel = 'ok' | 'warning' | 'critical'
export type CpuWarningLevel = 'ok' | 'warning' | 'unknown'
export type ThermalWarningLevel = 'unknown' | 'ok'

export type CpuUsageMicros = {
  user: number
  system: number
}

export type ResourceSnapshot = {
  platform: NodeJS.Platform
  hostname: string
  freemem: number
  totalmem: number
  memoryUsageRatio: number
  loadavg: number[]
  processMemoryRss: number
  cpuUsageSinceStart?: CpuUsageMicros
  /** Present when `previousCpuUsage` was passed; rough interval deltas only. */
  cpuUsageDelta?: CpuUsageMicros
  warnings: {
    memory: MemoryWarningLevel
    cpu: CpuWarningLevel
    thermal: ThermalWarningLevel
  }
}

/** Cumulative user/system CPU time for this process (microseconds), since start. */
export function sampleCpuUsage(): CpuUsageMicros {
  const u = process.cpuUsage()
  return { user: u.user, system: u.system }
}

function isLoadavgMeaningful(load: number[]): boolean {
  if (!load.length) return false
  // Windows often reports zeros; treat all-zero as non-meaningful.
  return load.some(v => v > 1e-6)
}

function memoryLevel(ratio: number): MemoryWarningLevel {
  if (ratio >= RAM_CRITICAL_RATIO) return 'critical'
  if (ratio >= RAM_WARNING_RATIO) return 'warning'
  return 'ok'
}

function cpuLevel(load: number[], cores: number): CpuWarningLevel {
  if (!isLoadavgMeaningful(load)) return 'unknown'
  const l0 = load[0] ?? 0
  const threshold = Math.max(1, cores) * LOAD_WARNING_FRACTION_OF_CORES
  return l0 > threshold ? 'warning' : 'ok'
}

export function getResourceSnapshot(previousCpuUsage?: CpuUsageMicros): ResourceSnapshot {
  const totalmem = os.totalmem()
  const freemem = os.freemem()
  const used = Math.max(0, totalmem - freemem)
  const memoryUsageRatio = totalmem > 0 ? used / totalmem : 0
  const loadavg = os.loadavg()
  const cores = os.cpus().length
  const rss = process.memoryUsage().rss
  const current = sampleCpuUsage()

  let cpuUsageDelta: CpuUsageMicros | undefined
  if (previousCpuUsage) {
    cpuUsageDelta = {
      user: Math.max(0, current.user - previousCpuUsage.user),
      system: Math.max(0, current.system - previousCpuUsage.system),
    }
  }

  return {
    platform: process.platform,
    hostname: os.hostname(),
    freemem,
    totalmem,
    memoryUsageRatio,
    loadavg,
    processMemoryRss: rss,
    cpuUsageSinceStart: current,
    ...(cpuUsageDelta ? { cpuUsageDelta } : {}),
    warnings: {
      memory: memoryLevel(memoryUsageRatio),
      cpu: cpuLevel(loadavg, cores),
      thermal: 'unknown',
    },
  }
}
