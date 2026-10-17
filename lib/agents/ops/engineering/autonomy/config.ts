import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { agentFoundryDir } from '../../log'

/**
 * Commander-controlled operating authority for Foundry. Persisted once, enforced by the controller and by the mission engine itself (so a mission started from the old form
 * is bound by an Emergency Stop too). Nothing here grants an operating-system privilege: it records what the Commander AUTHORIZED; what the OS actually allows is probed separately
 * (capabilities.ts) and shown next to it.
 */
export type AutonomyConfig = {
  schema: 1
  /** master switch: while false Foundry accepts commands but does not start work, and says so */
  fullAutonomy: boolean
  /** a verified, installed build may replace the canonical launcher target (rollback recorded). Off by default. */
  deploymentAuthority: boolean
  /** build a versioned installation for changes that need one (UI / application code) */
  autoInstall: boolean
  /** interrupted missions are resumed from their checkpoint without asking */
  autoRecover: boolean
  /** missions one command may spend (first attempt + changed-strategy retries) before it is reported BLOCKED */
  maxStrategyAttempts: number
  /** automatic resumes of one mission after worker loss / restart */
  maxAutoResumes: number
  paused: boolean
  pausedAt?: string
  pausedBy?: string
  updatedAt: string
  updatedBy: string
}

export const DEFAULT_CONFIG: AutonomyConfig = { schema: 1, fullAutonomy: false, deploymentAuthority: false, autoInstall: true, autoRecover: true, maxStrategyAttempts: 3, maxAutoResumes: 3, paused: false, updatedAt: new Date(0).toISOString(), updatedBy: 'default' }

export type EmergencyStop = { active: true; at: string; by: string; reason: string; killedProcesses: number[]; abortedModelCalls: number; missions: string[] }

export const autonomyDir = (base: string = agentFoundryDir()): string => path.join(base, 'autonomy')
const configFile = (dir: string) => path.join(dir, 'config.json')
const stopFile = (dir: string) => path.join(dir, 'EMERGENCY_STOP.json')

function atomicWrite(file: string, body: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(body, null, 1), 'utf8')
  renameSync(tmp, file)
}

export function readConfig(dir: string = autonomyDir()): AutonomyConfig {
  try {
    const raw = JSON.parse(readFileSync(configFile(dir), 'utf8')) as Partial<AutonomyConfig>
    const n = (v: unknown, d: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : d)
    return {
      ...DEFAULT_CONFIG, schema: 1,
      fullAutonomy: raw.fullAutonomy === true, deploymentAuthority: raw.deploymentAuthority === true,
      autoInstall: raw.autoInstall !== false, autoRecover: raw.autoRecover !== false,
      maxStrategyAttempts: n(raw.maxStrategyAttempts, 3, 1, 5), maxAutoResumes: n(raw.maxAutoResumes, 3, 0, 10),
      paused: raw.paused === true, ...(raw.pausedAt ? { pausedAt: String(raw.pausedAt) } : {}), ...(raw.pausedBy ? { pausedBy: String(raw.pausedBy) } : {}),
      updatedAt: String(raw.updatedAt ?? DEFAULT_CONFIG.updatedAt), updatedBy: String(raw.updatedBy ?? 'unknown'),
    }
  } catch {
    // no file = defaults; a file that exists but cannot be read fails CLOSED (paused, autonomy off), like the stop file
    return existsSync(configFile(dir)) ? { ...DEFAULT_CONFIG, paused: true, pausedBy: 'system:unreadable-config' } : { ...DEFAULT_CONFIG }
  }
}

export type ConfigPatch = Partial<Pick<AutonomyConfig, 'fullAutonomy' | 'deploymentAuthority' | 'autoInstall' | 'autoRecover' | 'maxStrategyAttempts' | 'maxAutoResumes'>>
/** Settings are changed only by an explicit patch from a Commander actor; the previous value is kept in settings-history.jsonl. */
export function updateConfig(dir: string, patch: ConfigPatch, by: string): AutonomyConfig {
  const cur = readConfig(dir)
  const next: AutonomyConfig = { ...cur, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)), updatedAt: new Date().toISOString(), updatedBy: by } as AutonomyConfig
  atomicWrite(configFile(dir), next)
  appendHistory(dir, { at: next.updatedAt, by, kind: 'SETTINGS', before: cur, after: next })
  return readConfig(dir)
}
export function setPaused(dir: string, paused: boolean, by: string): AutonomyConfig {
  const cur = readConfig(dir)
  const at = new Date().toISOString()
  const next: AutonomyConfig = paused ? { ...cur, paused: true, pausedAt: at, pausedBy: by, updatedAt: at, updatedBy: by } : (({ pausedAt: _a, pausedBy: _b, ...rest }) => ({ ...rest, paused: false, updatedAt: at, updatedBy: by }))(cur)
  atomicWrite(configFile(dir), next)
  appendHistory(dir, { at, by, kind: paused ? 'PAUSE' : 'RESUME' })
  return readConfig(dir)
}
function appendHistory(dir: string, entry: unknown): void {
  try { mkdirSync(dir, { recursive: true }); writeFileSync(path.join(dir, 'settings-history.jsonl'), JSON.stringify(entry) + '\n', { flag: 'a' }) } catch { /* history is evidence, not a gate */ }
}

export function readEmergencyStop(dir: string = autonomyDir()): EmergencyStop | null {
  const f = stopFile(dir)
  if (!existsSync(f)) return null
  try { return JSON.parse(readFileSync(f, 'utf8')) as EmergencyStop } catch { return { active: true, at: 'unknown', by: 'unknown', reason: 'EMERGENCY_STOP.json is unreadable; treated as active', killedProcesses: [], abortedModelCalls: 0, missions: [] } }
}
export const isEmergencyStopped = (dir: string = autonomyDir()): boolean => existsSync(stopFile(dir))
export function writeEmergencyStop(dir: string, stop: EmergencyStop): void { atomicWrite(stopFile(dir), stop); appendHistory(dir, { at: stop.at, by: stop.by, kind: 'EMERGENCY_STOP', reason: stop.reason }) }
/** Clearing a stop is a deliberate Commander act; the record is kept as stop-<time>.json. */
export function clearEmergencyStop(dir: string, by: string): boolean {
  const f = stopFile(dir)
  if (!existsSync(f)) return false
  renameSync(f, path.join(dir, `stop-cleared-${Date.now()}.json`))
  appendHistory(dir, { at: new Date().toISOString(), by, kind: 'EMERGENCY_STOP_CLEARED' })
  return true
}
