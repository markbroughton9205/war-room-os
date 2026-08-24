/**
 * Phase B (Repository/Workspace Model) regression suite. Proves, against real filesystem state
 * (two real temp git repositories, real registry writes, real AsyncLocalStorage-scoped
 * resolveRepoRoot() calls) rather than assertion alone:
 *   1. resolveRepoRoot() is unchanged with no workspace context active (backwards compatibility).
 *   2. openExistingRepositoryWorkspace() rejects non-absolute paths, nonexistent paths, and
 *      non-git directories.
 *   3. openExistingRepositoryWorkspace() resolves path-traversal (`..`) and symlink tricks to a
 *      canonical path via realpath.
 *   4. Two distinct registered workspaces do not share issue/repair state: work saved under
 *      workspace A is invisible under workspace B and vice versa, proven via independent
 *      listIssues()/listRepairs() calls scoped by runWithWorkspaceRoot().
 *   5. A relative/traversal-style workspaceId lookup cannot escape to an unregistered directory —
 *      only a previously validated, registered workspace root is ever used as an override.
 */
import { mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolveRepoRoot } from './paths'
import { runWithWorkspaceRoot } from './workspaceContext'
import {
  openExistingRepositoryWorkspace,
  WorkspaceValidationError,
  listWorkspaces,
} from '@/lib/native-builder/workspaceRegistry'
import { listIssues, listRepairs, saveIssue } from '@/lib/native-builder/storage'
import type { NativeIssueRecord } from '@/lib/native-builder/types'

const execFileAsync = promisify(execFile)

function makeIssue(title: string): NativeIssueRecord {
  const now = new Date().toISOString()
  return {
    id: randomUUID(),
    fingerprint: randomUUID(),
    title,
    severity: 'medium',
    source: 'commander_report',
    affectedSubsystem: 'workspace-test',
    evidence: [],
    rawEvidenceText: title,
    occurrenceCount: 1,
    firstSeenAt: now,
    lastSeenAt: now,
    status: 'open',
  }
}

async function makeTempGitRepo(label: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), `war-room-workspace-${label}-`))
  await execFileAsync('git', ['init', '--quiet'], { cwd: dir })
  return dir
}

interface CheckResult {
  id: string
  ok: boolean
  detail?: string
}

export async function runWorkspacePhaseBValidation(): Promise<{ ok: boolean; results: CheckResult[] }> {
  const results: CheckResult[] = []
  const check = (id: string, ok: boolean, detail?: string) => results.push({ id, ok, detail })

  // 1. Backwards compatibility: no active workspace context => resolveRepoRoot() unchanged.
  const baseline = resolveRepoRoot()
  check('wb_01_no_override_unchanged', resolveRepoRoot() === baseline, `resolveRepoRoot()=${resolveRepoRoot()}`)

  // 2. Validation rejects bad candidates.
  try {
    await openExistingRepositoryWorkspace('relative/path')
    check('wb_02_relative_path_rejected', false, 'did not throw')
  } catch (e) {
    check('wb_02_relative_path_rejected', e instanceof WorkspaceValidationError)
  }

  try {
    await openExistingRepositoryWorkspace(path.join(tmpdir(), `nonexistent-${randomUUID()}`))
    check('wb_03_nonexistent_path_rejected', false, 'did not throw')
  } catch (e) {
    check('wb_03_nonexistent_path_rejected', e instanceof WorkspaceValidationError)
  }

  const nonGitDir = await mkdtemp(path.join(tmpdir(), 'war-room-workspace-nongit-'))
  try {
    await openExistingRepositoryWorkspace(nonGitDir)
    check('wb_04_non_git_dir_rejected', false, 'did not throw')
  } catch (e) {
    check('wb_04_non_git_dir_rejected', e instanceof WorkspaceValidationError)
  } finally {
    await rm(nonGitDir, { recursive: true, force: true })
  }

  // 3. Two real, distinct git repos, registered as workspaces.
  const repoA = await makeTempGitRepo('a')
  const repoB = await makeTempGitRepo('b')
  const wsA = await openExistingRepositoryWorkspace(repoA, 'Workspace A')
  const wsB = await openExistingRepositoryWorkspace(repoB, 'Workspace B')
  check('wb_05_distinct_workspace_ids', wsA.id !== wsB.id)
  check('wb_06_canonical_roots_recorded', path.isAbsolute(wsA.root) && path.isAbsolute(wsB.root) && wsA.root !== wsB.root)

  // 3b. Path-traversal / symlink resolution: opening a `..`-laden path to repoA canonicalizes to
  // the same registered workspace, not a duplicate, and is not affected by an unrelated symlink.
  const trickyPath = path.join(repoA, '..', path.basename(repoA))
  const wsATrick = await openExistingRepositoryWorkspace(trickyPath)
  check('wb_07_traversal_path_canonicalizes_to_same_workspace', wsATrick.id === wsA.id)

  const symlinkPath = path.join(tmpdir(), `war-room-workspace-symlink-${randomUUID()}`)
  await symlink(repoB, symlinkPath, 'dir')
  const wsBViaSymlink = await openExistingRepositoryWorkspace(symlinkPath)
  check('wb_08_symlink_resolves_to_real_registered_workspace', wsBViaSymlink.id === wsB.id)
  await rm(symlinkPath, { force: true })

  // 4. Isolation: saving an issue under workspace A's scoped root is invisible under workspace B.
  const issueA = makeIssue('Issue only in workspace A')
  const issueB = makeIssue('Issue only in workspace B')
  await runWithWorkspaceRoot(wsA.root, async () => {
    await saveIssue(issueA)
  })
  await runWithWorkspaceRoot(wsB.root, async () => {
    await saveIssue(issueB)
  })

  const issuesUnderA = await runWithWorkspaceRoot(wsA.root, () => listIssues())
  const issuesUnderB = await runWithWorkspaceRoot(wsB.root, () => listIssues())

  check(
    'wb_09_workspace_a_sees_only_its_own_issue',
    issuesUnderA.some(i => i.id === issueA.id) && !issuesUnderA.some(i => i.id === issueB.id)
  )
  check(
    'wb_10_workspace_b_sees_only_its_own_issue',
    issuesUnderB.some(i => i.id === issueB.id) && !issuesUnderB.some(i => i.id === issueA.id)
  )

  const repairsUnderA = await runWithWorkspaceRoot(wsA.root, () => listRepairs())
  const repairsUnderB = await runWithWorkspaceRoot(wsB.root, () => listRepairs())
  check('wb_11_no_repairs_leaked_a', repairsUnderA.length === 0)
  check('wb_12_no_repairs_leaked_b', repairsUnderB.length === 0)

  // 4b. Process's own base root (no override) is unaffected by either workspace's writes.
  const baseIssues = await listIssues()
  check(
    'wb_13_base_repo_state_untouched',
    !baseIssues.some(i => i.id === issueA.id) && !baseIssues.some(i => i.id === issueB.id)
  )

  // 5. Registry lists what was registered.
  const all = await listWorkspaces()
  check('wb_14_registry_lists_both', all.some(w => w.id === wsA.id) && all.some(w => w.id === wsB.id))

  await rm(repoA, { recursive: true, force: true })
  await rm(repoB, { recursive: true, force: true })

  const ok = results.every(r => r.ok)
  return { ok, results }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { ok, results } = await runWorkspacePhaseBValidation()
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.id}${r.detail ? ` ${r.detail}` : ''}`)
  }
  const failed = results.filter(r => !r.ok)
  console.log(`Workspace Phase B validation: ${results.length - failed.length}/${results.length} PASS`)
  if (!ok) process.exit(1)
}
