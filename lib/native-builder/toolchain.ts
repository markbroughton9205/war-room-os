/**
 * Honest toolchain detection. Never claims AVAILABLE unless the binary resolves.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type ToolchainState = 'AVAILABLE' | 'NOT_INSTALLED' | 'CONFIG_REQUIRED' | 'UNSUPPORTED'

export type ToolchainProbe = {
  id: string
  state: ToolchainState
  version?: string
  detail: string
}

async function probe(cmd: string, args: string[]): Promise<{ ok: boolean; text: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      timeout: 8_000,
      windowsHide: true,
      shell: process.platform === 'win32',
    })
    return { ok: true, text: `${stdout} ${stderr}`.trim() }
  } catch (error) {
    return { ok: false, text: error instanceof Error ? error.message : String(error) }
  }
}

async function one(id: string, cmd: string, args: string[]): Promise<ToolchainProbe> {
  const result = await probe(cmd, args)
  if (!result.ok) {
    return { id, state: 'NOT_INSTALLED', detail: result.text.slice(0, 240) }
  }
  const version = result.text.split(/\r?\n/)[0]?.slice(0, 80)
  return { id, state: 'AVAILABLE', version, detail: version ?? 'ok' }
}

export async function detectToolchain(): Promise<ToolchainProbe[]> {
  return Promise.all([
    one('pnpm', 'pnpm', ['--version']),
    one('npm', 'npm', ['--version']),
    one('yarn', 'yarn', ['--version']),
    one('node', 'node', ['--version']),
    one('python', 'python', ['--version']),
    one('pip', 'pip', ['--version']),
    one('uv', 'uv', ['--version']),
    one('cargo', 'cargo', ['--version']),
    one('dotnet', 'dotnet', ['--version']),
    one('git', 'git', ['--version']),
  ])
}

export function selectPackageManager(probes: ToolchainProbe[], lockfileHint?: 'pnpm' | 'npm' | 'yarn'): 'pnpm' | 'npm' | 'yarn' | null {
  const available = new Set(probes.filter(p => p.state === 'AVAILABLE').map(p => p.id))
  if (lockfileHint && available.has(lockfileHint)) return lockfileHint
  if (available.has('pnpm')) return 'pnpm'
  if (available.has('npm')) return 'npm'
  if (available.has('yarn')) return 'yarn'
  return null
}
