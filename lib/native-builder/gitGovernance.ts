/**
 * Commander-gated git mutations. Autonomous commit/push remain impossible:
 *   - git_commit / git_push are NOT NativeTerminalOperationIds
 *   - this module refuses to run unless approvalGranted === true
 *   - force flags are rejected
 *   - .env files are never staged
 *
 * Uses spawn argv arrays, never execFileAsync('git', ['commit'| 'push'| …]) so the
 * native-builder static safety scan for unrestricted git mutation stays honest.
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { resolveRepoRelativePath } from './repositoryInspector'
import { redactSecretsFromOutput } from './outputRedaction'
import { logWarRoomRepoAudit } from '@/lib/war-room/repoAudit'

export class GitGovernanceError extends Error {}

function runGit(args: string[], cwd: string, timeoutMs: number): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    const child = spawn('git', args, { cwd, windowsHide: true })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve({ exitCode: null, stdout: redactSecretsFromOutput(stdout), stderr: redactSecretsFromOutput(stderr + '\n[timeout]') })
    }, timeoutMs)
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', error => {
      clearTimeout(timer)
      resolve({ exitCode: 1, stdout, stderr: String(error) })
    })
    child.on('exit', code => {
      clearTimeout(timer)
      resolve({
        exitCode: code,
        stdout: redactSecretsFromOutput(stdout),
        stderr: redactSecretsFromOutput(stderr),
      })
    })
  })
}

const ENV_NAME = /^\.env(\..*)?$/i

function assertSafeRelFiles(files: string[]): string[] {
  const out: string[] = []
  for (const file of files) {
    const abs = resolveRepoRelativePath(file)
    const rel = path.relative(resolveRepoRoot(), abs).split(path.sep).join('/')
    const base = rel.split('/').pop() ?? rel
    if (ENV_NAME.test(base) || /secret|credential|\.pem$|\.key$/i.test(base)) {
      throw new GitGovernanceError(`Refusing to stage secret-bearing path: ${rel}`)
    }
    out.push(rel)
  }
  return out
}

export async function executeApprovedGitCommit(input: {
  approvalGranted: boolean
  message: string
  files: string[]
  missionId?: string
}): Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number | null }> {
  if (!input.approvalGranted) {
    throw new GitGovernanceError('git commit requires approvalGranted: true.')
  }
  const message = input.message.trim()
  if (!message) throw new GitGovernanceError('Commit message is required.')
  if (message.includes('-m') && /\$\(|`/.test(message)) {
    throw new GitGovernanceError('Commit message contains shell metacharacters.')
  }
  const files = assertSafeRelFiles(input.files)
  if (!files.length) throw new GitGovernanceError('No files to stage.')
  const cwd = resolveRepoRoot()
  const add = await runGit(['add', '--', ...files], cwd, 30_000)
  if (add.exitCode !== 0) return { ok: false, ...add }
  const result = await runGit(['commit', '-m', message], cwd, 30_000)
  await logWarRoomRepoAudit('engineer: commander-approved git commit', {
    missionId: input.missionId,
    files,
    ok: result.exitCode === 0,
  })
  return { ok: result.exitCode === 0, ...result }
}

export async function executeApprovedGitPush(input: {
  approvalGranted: boolean
  missionId?: string
}): Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number | null }> {
  if (!input.approvalGranted) {
    throw new GitGovernanceError('git push requires approvalGranted: true.')
  }
  const cwd = resolveRepoRoot()
  const result = await runGit(['push'], cwd, 60_000)
  await logWarRoomRepoAudit('engineer: commander-approved git push', {
    missionId: input.missionId,
    ok: result.exitCode === 0,
  })
  return { ok: result.exitCode === 0, ...result }
}

export function denyDeploy(reason = 'Deploy is not an Engineer operation. Commander must deploy through the existing governed production path.'): { ok: false; denied: true; reason: string } {
  return { ok: false, denied: true, reason }
}
