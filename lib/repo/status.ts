import { execFile } from 'node:child_process'
import { constants as FsConstants } from 'node:fs'
import { access } from 'node:fs/promises'
import { promisify } from 'node:util'
import { resolveRepoRoot } from './paths'
import type { ChangedFileMetadata, RepoAllowed, RepoCapabilities, RepoPolicy, RepoStatus } from './types'

const REPO_POLICY: RepoPolicy = {
  writeRequiresApproval: true,
  commitRequiresApproval: true,
  rollbackRequiresApproval: true,
}

/** Phase 1: no approval endpoint — public API never grants agent/automation write/commit/rollback. */
function phase1Allowed(): RepoAllowed {
  return { write: false, commit: false, rollback: false }
}

const execFileAsync = promisify(execFile)

async function execGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, windowsHide: true, maxBuffer: 10 * 1024 * 1024 })
  return stdout
}

async function safeGit(args: string[], cwd: string, fallback = ''): Promise<string> {
  try {
    return (await execGit(args, cwd)).trimEnd()
  } catch {
    return fallback
  }
}

/** Best-effort: git on PATH and able to run inside `cwd`. */
async function checkGitAvailable(cwd: string): Promise<boolean> {
  try {
    await execGit(['--version'], cwd)
  } catch {
    return false
  }
  try {
    const out = await safeGit(['rev-parse', '--git-dir'], cwd, '')
    return Boolean(out.trim())
  } catch {
    return false
  }
}

function parsePorcelainLine(line: string): ChangedFileMetadata | null {
  if (!line.trim()) return null
  // v1 porcelain: XY path or XY orig -> path
  const xy = line.slice(0, 2)
  const rest = line.slice(3)
  if (!rest) return null
  const indexStatus = xy[0] === ' ' ? '' : xy[0] ?? ''
  const workTreeStatus = xy[1] === ' ' ? '' : xy[1] ?? ''
  const pathPart = rest.includes(' -> ') ? rest.split(' -> ').pop()?.trim() ?? rest.trim() : rest.trim()
  return {
    path: pathPart,
    indexStatus,
    workTreeStatus,
    porcelain: xy,
  }
}

function parsePorcelain(output: string): ChangedFileMetadata[] {
  const lines = output.split('\n').filter(Boolean)
  const out: ChangedFileMetadata[] = []
  for (const line of lines) {
    const meta = parsePorcelainLine(line)
    if (meta) out.push(meta)
  }
  return out
}

async function tryAccess(p: string, mode: number): Promise<boolean> {
  try {
    await access(p, mode)
    return true
  } catch {
    return false
  }
}

export async function getRepoStatus(): Promise<RepoStatus> {
  const repoPath = resolveRepoRoot()
  const canReadRepo = await tryAccess(repoPath, FsConstants.R_OK)
  const canWriteFilesystem = canReadRepo && (await tryAccess(repoPath, FsConstants.W_OK))

  const gitAvailable = canReadRepo && (await checkGitAvailable(repoPath))
  let currentBranch = 'unknown'
  let workingTreeStatus: RepoStatus['workingTreeStatus'] = 'unknown'
  let changedFiles: ChangedFileMetadata[] = []
  let lastCommitHash: RepoStatus['lastCommitHash'] = null
  let remoteConfigured = false
  let canGitCommit = false

  if (gitAvailable) {
    currentBranch = await safeGit(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath, 'unknown')
    const porcelain = await safeGit(['status', '--porcelain=v1', '--untracked-files=all'], repoPath, '')
    changedFiles = parsePorcelain(porcelain)
    workingTreeStatus = changedFiles.length > 0 ? 'dirty' : 'clean'

    const short = await safeGit(['rev-parse', '--short', 'HEAD'], repoPath, '')
    const full = await safeGit(['rev-parse', 'HEAD'], repoPath, '')
    if (short && full) {
      lastCommitHash = { short: short.trim(), full: full.trim() }
    }

    const remotes = await safeGit(['remote', '-v'], repoPath, '')
    remoteConfigured = remotes.trim().length > 0

    const bare = (await safeGit(['rev-parse', '--is-bare-repository'], repoPath, 'false')).trim() === 'true'
    const userName = (await safeGit(['config', 'user.name'], repoPath, '')).trim()
    const userEmail = (await safeGit(['config', 'user.email'], repoPath, '')).trim()
    canGitCommit = !bare && Boolean(userName) && Boolean(userEmail)
  }

  const capabilities: RepoCapabilities = {
    canWriteFilesystem,
    canGitCommit,
    canCreateCheckpoint: canWriteFilesystem,
  }

  const allowed = phase1Allowed()

  return {
    repoPath,
    gitAvailable,
    currentBranch,
    workingTreeStatus,
    uncommittedFilesCount: changedFiles.length,
    changedFiles,
    lastCommitHash,
    remoteConfigured,
    canReadRepo,
    canWriteRepo: allowed.write,
    canCommit: allowed.commit,
    canRollback: allowed.rollback,
    capabilities,
    policy: REPO_POLICY,
    allowed,
    permissions: {
      canRead: canReadRepo,
      canProposeDiff: gitAvailable,
      canModifyFiles: 'approval_required',
      canCommit: 'approval_required',
      canDeploy: 'approval_required',
      canRollback: 'approval_required',
      canUseInternet: false,
      canExecuteShell: false,
    },
    checkedAt: new Date().toISOString(),
  }
}
