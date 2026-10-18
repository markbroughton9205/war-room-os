/**
 * process.list / process.inspect — read-only system process visibility for the Foundry Tool
 * Broker. Backed by `ps` (typed argv, never a shell string) rather than parsing /proc by hand for
 * portability; /proc is used only as a best-effort cwd lookup on Linux.
 *
 * Deliberately narrow: never returns environment variables (secrets can live there), and the raw
 * command line is passed through the project's existing secret redaction before it ever leaves
 * this module.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readlink } from 'node:fs/promises'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { redactSecretsFromOutput } from './outputRedaction'
import { realInstallOptRoot } from './installerTool'

const execFileAsync = promisify(execFile)

export type ProcessOwnership = 'foundry_installed_war_room' | 'war_room_source_checkout' | 'other'

export type ProcessInfo = {
  pid: number
  ppid: number
  command: string
  cpuPercent: number
  memPercent: number
  startedAgoSeconds: number
  cwd: string | null
  ownership: ProcessOwnership
}

function classifyOwnership(cwd: string | null, command: string): ProcessOwnership {
  const repoRoot = resolveRepoRoot()
  const optRoot = realInstallOptRoot()
  if (cwd?.startsWith(optRoot) || command.includes(optRoot)) return 'foundry_installed_war_room'
  if (cwd?.startsWith(repoRoot) || command.includes(repoRoot)) return 'war_room_source_checkout'
  return 'other'
}

async function resolveCwd(pid: number): Promise<string | null> {
  if (process.platform !== 'linux') return null
  try {
    return await readlink(`/proc/${pid}/cwd`)
  } catch {
    return null
  }
}

/** List processes. `filter` narrows by substring match on the (redacted) command line — keeps
 * output bounded instead of dumping the whole machine's process table by default. */
export async function processList(input: { filter?: string; limit?: number } = {}): Promise<{ ok: true; processes: ProcessInfo[] } | { ok: false; error: string }> {
  if (process.platform === 'win32') {
    return { ok: false, error: 'process.list is not yet implemented for win32 (Linux/macOS only today).' }
  }
  try {
    const { stdout } = await execFileAsync('ps', ['-eo', 'pid,ppid,pcpu,pmem,etimes,args', '--no-headers'], { maxBuffer: 4 * 1024 * 1024, timeout: 8_000 })
    const rows = stdout.split('\n').map(l => l.trim()).filter(Boolean)
    const limit = input.limit ?? 500
    const out: ProcessInfo[] = []
    for (const row of rows) {
      const match = row.match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(.*)$/)
      if (!match) continue
      const [, pidStr, ppidStr, cpuStr, memStr, etimeStr, rawCommand] = match
      const command = redactSecretsFromOutput(rawCommand)
      if (input.filter && !command.toLowerCase().includes(input.filter.toLowerCase())) continue
      const pid = Number(pidStr)
      const cwd = await resolveCwd(pid)
      out.push({
        pid,
        ppid: Number(ppidStr),
        command: command.slice(0, 500),
        cpuPercent: Number(cpuStr),
        memPercent: Number(memStr),
        startedAgoSeconds: Number(etimeStr),
        cwd,
        ownership: classifyOwnership(cwd, command),
      })
      if (out.length >= limit) break
    }
    return { ok: true, processes: out }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function processInspect(input: { pid: number }): Promise<{ ok: true; process: ProcessInfo } | { ok: false; error: string }> {
  if (!Number.isInteger(input.pid) || input.pid <= 0) return { ok: false, error: 'pid must be a positive integer.' }
  const listing = await processList({ limit: 100_000 })
  if (!listing.ok) return listing
  const hit = listing.processes.find(p => p.pid === input.pid)
  if (!hit) return { ok: false, error: `No such process: ${input.pid} (it may have exited, or process.list's --no-headers ps snapshot missed it).` }
  return { ok: true, process: hit }
}
