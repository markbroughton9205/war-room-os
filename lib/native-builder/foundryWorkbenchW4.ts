/**
 * Foundry Workbench W4 — governed SCM.
 * Extends W3. Reuses gitGovernance authority rules (approval, no force, no secrets).
 * Does not commit/push the canonical War Room repo. Does not rebuild Tool Broker.
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { FOUNDRY_AUTHORITY_SNAPSHOT } from './foundryContractTypes'
import { appendFoundryWorkbenchEvent } from './foundryWorkbenchEvents'
import { buildFoundryEditorContextEnvelope, editorContextChips, type FoundryEditorContextEnvelope, type FoundryGitDiffHunk } from './foundryEditorContext'
import { executeEngineerTool } from './engineerTools'
import { FoundryModelRouter } from './foundryModelRouter'

const require = createRequire(import.meta.url)

export const FOUNDRY_W4_COMMANDS = [
  'foundry.reviewChanges',
  'foundry.governedCommit',
  'foundry.governedPush',
  'foundry.openScm',
] as const

export const W4_HUNK_PROPOSAL_STATUS = 'DEFERRED_W4_1' as const

export const STOCK_GIT_MUTATION_COMMANDS = [
  'git.commit',
  'git.commitAll',
  'git.commitStaged',
  'git.commitEmpty',
  'git.commitAmend',
  'git.push',
  'git.pushTo',
  'git.sync',
  'git.syncRebase',
  'git.publish',
  'git.forcePush',
  'git.pull',
  'git.rebase',
  'git.merge',
  'git.checkout',
  'git.clean',
  'git.deleteBranch',
] as const

export const AUTO_COMMIT_AFTER_AI_EDIT = false
export const AUTO_PUSH_AFTER_COMMIT = false
export const SYNC_DISABLED_UNTIL_GOVERNED = true
export const FETCH_POLICY = 'COMMANDER_READ_NETWORK_ALLOWED' as const
export const PULL_POLICY = 'UNAVAILABLE_W4' as const
export const MERGE_POLICY = 'VISUALIZATION_ONLY_EXECUTION_DISABLED' as const
export const REBASE_POLICY = 'DISABLED' as const
export const CHECKOUT_POLICY = 'DISABLED_W4' as const
export const WORKTREE_POLICY = 'FOUNDRY_AGENT_WORKSPACES_OWNED' as const

const ENV_NAME = /^\.env(\..*)?$/i

export type FoundryScmSnapshot = {
  branch: string | null
  changedFiles: string[]
  stagedFiles: string[]
  unstagedFiles: string[]
  boundedDiffHunks: FoundryGitDiffHunk[]
  ahead: number
  remote: string | null
  upstream: string | null
  dirtyBuffers: string[]
}

export type FoundryW4Response = {
  ok: boolean
  kind: string
  readOnly: boolean
  text?: string
  code?: string
  error?: string
  confirmation?: Record<string, unknown>
  snapshot?: FoundryScmSnapshot
  envelope?: FoundryEditorContextEnvelope | null
  chips?: ReturnType<typeof editorContextChips>
}

function allowlist(): { resolveAllowedWorkspace: (requested: string) => { ok: boolean; folder?: string; code?: string; error?: string } } {
  return require('../../desktop/workbench-host/allowlist.cjs')
}

function runGit(args: string[], cwd: string, timeoutMs = 20_000): { exitCode: number | null; stdout: string; stderr: string } {
  const ran = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: timeoutMs, windowsHide: true })
  return {
    exitCode: ran.status,
    stdout: String(ran.stdout || ''),
    stderr: String(ran.stderr || ''),
  }
}

export function assertWorkbenchGitCwd(cwd: string): string {
  const resolved = path.resolve(cwd)
  const canonical = path.resolve(resolveRepoRoot())
  if (resolved === canonical || resolved.startsWith(canonical + path.sep)) {
    throw Object.assign(new Error('CANONICAL_REPO_REFUSED'), { code: 'CANONICAL_REPO_REFUSED' })
  }
  const allowed = allowlist().resolveAllowedWorkspace(resolved)
  if (!allowed.ok || !allowed.folder) {
    throw Object.assign(new Error(allowed.error || 'UNAUTHORIZED_WORKSPACE'), { code: allowed.code || 'UNAUTHORIZED_WORKSPACE' })
  }
  return allowed.folder
}

function parsePorcelain(cwd: string): { staged: string[]; unstaged: string[]; untracked: string[] } {
  const status = runGit(['status', '--porcelain', '-uall'], cwd)
  const staged: string[] = []
  const unstaged: string[] = []
  const untracked: string[] = []
  for (const line of status.stdout.split('\n')) {
    if (line.length < 4) continue
    const x = line[0]
    const y = line[1]
    const file = line.slice(3).replace(/^"(.*)"$/, '$1').split(' -> ').pop() || ''
    if (x === '?' && y === '?') untracked.push(file)
    else {
      if (x !== ' ' && x !== '?') staged.push(file)
      if (y !== ' ' && y !== '?') unstaged.push(file)
    }
  }
  return { staged, unstaged, untracked }
}

function boundedHunks(cwd: string): FoundryGitDiffHunk[] {
  const diff = runGit(['diff', '--unified=3', 'HEAD'], cwd)
  const hunks: FoundryGitDiffHunk[] = []
  let file = ''
  let header = ''
  let body: string[] = []
  const flush = () => {
    if (!file || !body.length) return
    const text = body.join('\n').slice(0, 2000)
    hunks.push({ file, header, text, truncated: body.join('\n').length > 2000 })
  }
  for (const line of diff.stdout.split('\n')) {
    if (line.startsWith('diff --git ')) {
      flush()
      file = line.replace(/^diff --git a\/.* b\//, '').trim()
      header = line
      body = [line]
      continue
    }
    if (file) body.push(line)
  }
  flush()
  return hunks.slice(0, 8)
}

export function collectScmSnapshot(workspaceRoot: string, dirtyBuffers: string[] = []): FoundryScmSnapshot {
  const cwd = assertWorkbenchGitCwd(workspaceRoot)
  const porcelain = parsePorcelain(cwd)
  const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd).stdout.trim() || null
  const remote = runGit(['remote'], cwd).stdout.split('\n').map(item => item.trim()).filter(Boolean)[0] || null
  const upstream = runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], cwd).stdout.trim() || null
  const aheadRaw = runGit(['rev-list', '--count', '@{u}..HEAD'], cwd)
  const ahead = aheadRaw.exitCode === 0 ? Number(aheadRaw.stdout.trim() || 0) : 0
  const changed = [...new Set([...porcelain.staged, ...porcelain.unstaged, ...porcelain.untracked])]
  return {
    branch,
    changedFiles: changed.slice(0, 40),
    stagedFiles: porcelain.staged.slice(0, 40),
    unstagedFiles: [...porcelain.unstaged, ...porcelain.untracked].slice(0, 40),
    boundedDiffHunks: boundedHunks(cwd),
    ahead: Number.isFinite(ahead) ? ahead : 0,
    remote,
    upstream,
    dirtyBuffers: dirtyBuffers.slice(0, 12),
  }
}

function audit(action: string, extra: Record<string, unknown>) {
  const dir = path.join(os.homedir(), '.local', 'share', 'war-room-os', 'data', 'foundry', 'workbench')
  mkdirSync(dir, { recursive: true })
  const row = {
    at: new Date().toISOString(),
    who: extra.who || 'commander',
    action,
    repo: extra.repo || null,
    branch: extra.branch || null,
    operation: extra.operation || action,
    approval: extra.approval ?? false,
    result: extra.result || null,
  }
  try {
    appendFileSync(path.join(dir, 'scm-audit.jsonl'), `${JSON.stringify(row)}\n`)
  } catch { /* best-effort */ }
}

function refuseSecretPath(files: string[]) {
  for (const file of files) {
    const base = file.split('/').pop() || file
    if (ENV_NAME.test(base) || /secret|credential|\.pem$|\.key$/i.test(base)) {
      throw Object.assign(new Error(`Refusing secret-bearing path: ${file}`), { code: 'SECRET_PATH' })
    }
  }
}

export function ensureFoundryWorkbenchW4Fixture(root?: string): string {
  const folder = root || path.join(os.homedir(), 'FoundryProjects', 'w4-scm-fixture')
  mkdirSync(folder, { recursive: true })
  const gitDir = path.join(folder, '.git')
  const ignore = ['.bare-remote.git/', 'nested/', '.war-room/', ''].join('\n')
  writeFileSync(path.join(folder, '.gitignore'), ignore)
  if (!existsSync(gitDir)) {
    runGit(['init'], folder)
    runGit(['config', 'user.email', 'w4-fixture@foundry.local'], folder)
    runGit(['config', 'user.name', 'Foundry W4 Fixture'], folder)
    writeFileSync(path.join(folder, 'tracked.ts'), 'export const seed = 1\n')
    runGit(['add', '--', '.gitignore', 'tracked.ts'], folder)
    runGit(['commit', '-m', 'w4 seed'], folder)
  }
  const nested = path.join(folder, 'nested')
  if (!existsSync(path.join(nested, '.git'))) {
    mkdirSync(nested, { recursive: true })
    writeFileSync(path.join(nested, 'inner.txt'), 'nested\n')
    runGit(['init'], nested)
    runGit(['config', 'user.email', 'w4-nested@foundry.local'], nested)
    runGit(['config', 'user.name', 'Foundry W4 Nested'], nested)
    runGit(['add', '--', 'inner.txt'], nested)
    runGit(['commit', '-m', 'nested seed'], nested)
  }
  const remote = path.join(path.dirname(folder), `${path.basename(folder)}.bare.git`)
  if (!existsSync(remote)) {
    mkdirSync(remote, { recursive: true })
    runGit(['init', '--bare'], remote)
  }
  const remotes = runGit(['remote'], folder).stdout
  if (!/\borigin\b/.test(remotes)) {
    runGit(['remote', 'add', 'origin', remote], folder)
  } else {
    runGit(['remote', 'set-url', 'origin', remote], folder)
  }
  return folder
}

export function envelopeWithScm(workspaceRoot: string, extras?: Partial<FoundryEditorContextEnvelope>): FoundryEditorContextEnvelope {
  const snapshot = collectScmSnapshot(workspaceRoot)
  const rel = 'tracked.ts'
  const abs = path.join(workspaceRoot, rel)
  const content = existsSync(abs) ? readFileSync(abs, 'utf8') : 'export const seed = 1\n'
  return buildFoundryEditorContextEnvelope({
    workspaceRoot,
    projectId: 'w4-workbench',
    workspaceId: 'w4-workbench',
    activeFile: rel,
    activeLanguageId: 'typescript',
    selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: content.length, text: content },
    nearbyLines: content,
    fileContent: content,
    gitDiffHunks: snapshot.boundedDiffHunks,
    git: snapshot,
    providerClass: extras?.sensitive?.providerClass ?? 'local',
    ...extras,
  })
}

export function stockGitMutationWiredInAdapter(adapterSource: string): number {
  const hits = adapterSource.match(/executeCommand\(\s*['"]git\.(commit|push|sync|publish|forcePush|pull|rebase|merge|checkout|clean)/g)
  return hits ? hits.length : 0
}

export function w4AuthorityStillZero(): boolean {
  return FOUNDRY_AUTHORITY_SNAPSHOT.autoCommit === 0 && FOUNDRY_AUTHORITY_SNAPSHOT.autoPush === 0
}

export async function runFoundryW4Command(input: {
  kind: string
  workspaceRoot?: string
  envelope?: FoundryEditorContextEnvelope | null
  instruction?: string
  commanderApproved?: boolean
  files?: string[]
  message?: string
  remote?: string
  dirtyBuffers?: string[]
  stockCommand?: string
}): Promise<FoundryW4Response> {
  const kind = input.kind
  const workspaceRoot = input.workspaceRoot || input.envelope?.workspaceRoot || path.join(os.homedir(), 'FoundryProjects', 'w4-scm-fixture')

  if (kind === 'agentCommit' || kind === 'agentPush' || kind === 'agentStage') {
    const code = kind === 'agentPush' ? 'AGENT_AUTONOMOUS_PUSH' : kind === 'agentStage' ? 'AGENT_STAGING_REFUSED' : 'AGENT_AUTONOMOUS_COMMIT'
    appendFoundryWorkbenchEvent(kind === 'agentPush' ? 'SCM_PUSH_REFUSED' : 'SCM_COMMIT_REFUSED', 'Agent Git mutation refused', { metadata: { kind, code } })
    audit(kind, { who: 'agent', repo: workspaceRoot, approval: false, result: 'refused' })
    return { ok: false, kind, readOnly: true, code, error: 'Agents cannot commit, push, or stage without Commander-governed Tool Broker policy. W4 refuses.' }
  }

  if (kind === 'scmBypass' || STOCK_GIT_MUTATION_COMMANDS.includes(input.stockCommand as typeof STOCK_GIT_MUTATION_COMMANDS[number])) {
    const cmd = input.stockCommand || kind
    appendFoundryWorkbenchEvent('SCM_COMMIT_REFUSED', `Stock Git command intercepted: ${cmd}`, { metadata: { command: cmd } })
    return { ok: false, kind: 'scmBypass', readOnly: true, code: 'STOCK_GIT_INTERCEPTED', error: `Builtin ${cmd} is unbound and routed through Foundry governance.` }
  }

  let cwd: string
  try {
    cwd = assertWorkbenchGitCwd(workspaceRoot)
  } catch (error) {
    return { ok: false, kind, readOnly: true, code: (error as { code?: string }).code || 'UNAUTHORIZED_WORKSPACE', error: error instanceof Error ? error.message : String(error) }
  }

  if (kind === 'scmStatus' || kind === 'openScm') {
    const snapshot = collectScmSnapshot(cwd, input.dirtyBuffers)
    const envelope = envelopeWithScm(cwd)
    return { ok: true, kind, readOnly: true, text: `branch ${snapshot.branch} changed ${snapshot.changedFiles.length} staged ${snapshot.stagedFiles.length}`, snapshot, envelope, chips: editorContextChips(envelope) }
  }

  if (kind === 'scmDiff' || kind === 'reviewChanges') {
    const snapshot = collectScmSnapshot(cwd, input.dirtyBuffers)
    const envelope = envelopeWithScm(cwd)
    const instruction = input.instruction || 'Explain these changes. Review this diff. Do not commit or push.'
    let text = `Read-only review of ${snapshot.changedFiles.length} changed file(s) on ${snapshot.branch}.`
    if (snapshot.boundedDiffHunks[0]) text += ` First hunk: ${snapshot.boundedDiffHunks[0].file}`
    try {
      if (String(process.env.FOUNDRY_WORKBENCH_W2_DETERMINISTIC || '') !== '1') {
        const router = new FoundryModelRouter()
        const routed = await router.route({
          intent: 'review',
          instruction: `${instruction}\n\n${snapshot.boundedDiffHunks.map(item => item.text).join('\n').slice(0, 1500)}`,
          context: { envelope },
        } as never)
        if (routed && typeof routed === 'object' && 'text' in routed && routed.text) text = String(routed.text)
      }
    } catch { /* deterministic fallback */ }
    const prepare = await executeEngineerTool({ tool: 'git.commit_prepare', input: {} }, { repairId: 'w4-review' }).catch(() => null)
    if (prepare && !prepare.ok) {
      /* commit_prepare may fail without a mission; still a read-only review */
    }
    return { ok: true, kind, readOnly: true, text, snapshot, envelope, chips: editorContextChips(envelope), confirmation: { commit_prepare: prepare && prepare.ok ? 'available' : 'not-a-commit' } }
  }

  if (kind === 'scmStage' || kind === 'scmUnstage') {
    const files = (input.files && input.files.length ? input.files : parsePorcelain(cwd).unstaged.concat(parsePorcelain(cwd).untracked)).slice(0, 20)
    refuseSecretPath(files)
    if (input.dirtyBuffers?.length) {
      return { ok: false, kind, readOnly: true, code: 'GIT_DIRTY_BUFFER', error: 'Unsaved Commander buffers are not disk truth and will not be staged.' }
    }
    const args = kind === 'scmStage' ? ['add', '--', ...files] : ['restore', '--staged', '--', ...files]
    const ran = runGit(args, cwd)
    appendFoundryWorkbenchEvent(kind === 'scmStage' ? 'SCM_STAGE' : 'SCM_UNSTAGE', `${kind} ${files.join(',')}`, { metadata: { ok: ran.exitCode === 0 } })
    audit(kind, { who: 'commander', repo: cwd, approval: true, result: ran.exitCode === 0 ? 'ok' : 'failed' })
    return { ok: ran.exitCode === 0, kind, readOnly: false, text: ran.stdout || ran.stderr, snapshot: collectScmSnapshot(cwd) }
  }

  if (kind === 'governedCommit') {
    const snapshot = collectScmSnapshot(cwd, input.dirtyBuffers)
    const message = String(input.message || input.instruction || '').trim()
    const confirmation = {
      repo: cwd,
      branch: snapshot.branch,
      stagedFiles: snapshot.stagedFiles,
      commitMessage: message || '(required)',
    }
    appendFoundryWorkbenchEvent('SCM_COMMIT_REQUESTED', 'Commander commit requested', { metadata: { branch: snapshot.branch || '' } })
    if (input.dirtyBuffers?.length) {
      appendFoundryWorkbenchEvent('SCM_COMMIT_REFUSED', 'Dirty buffer', { metadata: { code: 'GIT_DIRTY_BUFFER' } })
      return { ok: false, kind, readOnly: true, code: 'GIT_DIRTY_BUFFER', error: 'Unsaved editor buffers will not be committed. Save first.', confirmation, snapshot }
    }
    if (!input.commanderApproved) {
      appendFoundryWorkbenchEvent('SCM_COMMIT_REFUSED', 'Commit requires Commander approval', { metadata: { code: 'COMMIT_APPROVAL_REQUIRED' } })
      audit('commit', { who: 'commander', repo: cwd, branch: snapshot.branch, approval: false, result: 'refused' })
      return { ok: false, kind, readOnly: true, code: 'COMMIT_APPROVAL_REQUIRED', error: 'Commit requires explicit Commander confirmation.', confirmation, snapshot }
    }
    if (!message) return { ok: false, kind, readOnly: true, code: 'COMMIT_MESSAGE_REQUIRED', error: 'Commit message is required.', confirmation, snapshot }
    if (!snapshot.stagedFiles.length) return { ok: false, kind, readOnly: true, code: 'NOTHING_STAGED', error: 'Nothing staged.', confirmation, snapshot }
    refuseSecretPath(snapshot.stagedFiles)
    appendFoundryWorkbenchEvent('SCM_COMMIT_APPROVED', 'Commander approved commit', { metadata: { files: snapshot.stagedFiles.length } })
    const ran = runGit(['commit', '-m', message], cwd)
    appendFoundryWorkbenchEvent(ran.exitCode === 0 ? 'SCM_COMMIT_COMPLETED' : 'SCM_COMMIT_REFUSED', ran.stdout || ran.stderr, { metadata: { ok: ran.exitCode === 0 } })
    audit('commit', { who: 'commander', repo: cwd, branch: snapshot.branch, approval: true, result: ran.exitCode === 0 ? 'ok' : 'failed' })
    return { ok: ran.exitCode === 0, kind, readOnly: false, text: ran.stdout || ran.stderr, confirmation, snapshot: collectScmSnapshot(cwd), code: ran.exitCode === 0 ? undefined : 'COMMIT_FAILED' }
  }

  if (kind === 'governedPush') {
    const snapshot = collectScmSnapshot(cwd, input.dirtyBuffers)
    const remote = input.remote || snapshot.remote || 'origin'
    const confirmation = {
      repo: cwd,
      branch: snapshot.branch,
      remote,
      upstream: snapshot.upstream,
      commitCount: snapshot.ahead,
    }
    appendFoundryWorkbenchEvent('SCM_PUSH_REQUESTED', 'Commander push requested', { metadata: { remote } })
    if (!input.commanderApproved) {
      appendFoundryWorkbenchEvent('SCM_PUSH_REFUSED', 'Push requires Commander approval', { metadata: { code: 'PUSH_APPROVAL_REQUIRED' } })
      audit('push', { who: 'commander', repo: cwd, branch: snapshot.branch, approval: false, result: 'refused' })
      return { ok: false, kind, readOnly: true, code: 'PUSH_APPROVAL_REQUIRED', error: 'Push requires explicit Commander confirmation.', confirmation, snapshot }
    }
    if (/\s/.test(remote) || remote.startsWith('-')) {
      return { ok: false, kind, readOnly: true, code: 'INVALID_REMOTE', error: 'Invalid remote.', confirmation, snapshot }
    }
    appendFoundryWorkbenchEvent('SCM_PUSH_APPROVED', 'Commander approved push', { metadata: { remote } })
    const ran = runGit(['push', '-u', remote, 'HEAD'], cwd, 30_000)
    appendFoundryWorkbenchEvent(ran.exitCode === 0 ? 'SCM_PUSH_COMPLETED' : 'SCM_PUSH_REFUSED', ran.stdout || ran.stderr, { metadata: { ok: ran.exitCode === 0 } })
    audit('push', { who: 'commander', repo: cwd, branch: snapshot.branch, approval: true, result: ran.exitCode === 0 ? 'ok' : 'failed' })
    return { ok: ran.exitCode === 0, kind, readOnly: false, text: ran.stdout || ran.stderr, confirmation, snapshot: collectScmSnapshot(cwd), code: ran.exitCode === 0 ? undefined : 'PUSH_FAILED' }
  }

  if (kind === 'scmFetch') {
    const snapshot = collectScmSnapshot(cwd, input.dirtyBuffers)
    const remote = input.remote || snapshot.remote || 'origin'
    if (/\s/.test(remote) || remote.startsWith('-')) {
      return { ok: false, kind, readOnly: true, code: 'INVALID_REMOTE', error: 'Invalid remote.', snapshot }
    }
    const ran = runGit(['fetch', '--', remote], cwd, 30_000)
    audit('fetch', { who: 'commander', repo: cwd, branch: snapshot.branch, approval: true, result: ran.exitCode === 0 ? 'ok' : 'failed' })
    return { ok: ran.exitCode === 0, kind, readOnly: true, text: ran.stdout || ran.stderr, snapshot: collectScmSnapshot(cwd) }
  }

  if (kind === 'scmPull' || kind === 'scmMerge' || kind === 'scmRebase' || kind === 'scmCheckout' || kind === 'scmSync' || kind === 'scmPublish' || kind === 'scmForce') {
    const code = kind === 'scmSync' ? 'SYNC_DISABLED_UNTIL_GOVERNED' : kind === 'scmPull' ? 'PULL_UNAVAILABLE_W4' : 'GIT_MUTATION_DISABLED'
    return { ok: false, kind, readOnly: true, code, error: `${kind} is disabled in W4.` }
  }

  return { ok: false, kind, readOnly: true, code: 'UNKNOWN_W4_KIND', error: `Unknown W4 kind ${kind}` }
}
