/**
 * Porcelain dirty-path parsing.
 * Does not mutate the War Room source tree.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  canonicalRepoRelativePath,
  captureGitBaseline,
  dirtyPathMatches,
  parsePorcelainV1,
  parsePorcelainV1Z,
  preexistingDirtyBlocksEdit,
} from './foundryLargeProject'

type CaseResult = { name: string; pass: boolean; detail: string }
const results: CaseResult[] = []
const check = (name: string, pass: boolean, detail: string) => {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${detail}`)
}

function pathsOf(output: string) {
  const parsed = parsePorcelainV1(output)
  return { parsed, paths: parsed.records.flatMap(record => record.paths) }
}

function git(root: string, args: string[]) {
  execFileSync('git', ['-c', 'user.email=foundry@local', '-c', 'user.name=foundry', ...args], { cwd: root, stdio: 'ignore' })
}

function write(root: string, rel: string, body: string) {
  const abs = path.join(root, rel)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, body)
}

async function main() {
  const leading = pathsOf(' M notes/keep.txt\n')
  check('leading_space', leading.paths.length === 1 && leading.paths[0] === 'notes/keep.txt' && leading.parsed.records[0]?.workTreeStatus === 'M', leading.paths.join(','))

  const staged = pathsOf('M  notes/keep.txt\n')
  check('staged', staged.paths[0] === 'notes/keep.txt' && staged.parsed.records[0]?.indexStatus === 'M' && staged.parsed.records[0]?.workTreeStatus === '', staged.paths.join(','))

  const unstaged = pathsOf(' M notes/keep.txt\n')
  check('unstaged', unstaged.paths[0] === 'notes/keep.txt' && unstaged.parsed.records[0]?.indexStatus === '' && unstaged.parsed.records[0]?.workTreeStatus === 'M', unstaged.paths.join(','))

  const both = pathsOf('MM notes/file.txt\n')
  check('both_columns', both.paths[0] === 'notes/file.txt' && both.parsed.records[0]?.indexStatus === 'M' && both.parsed.records[0]?.workTreeStatus === 'M', both.paths.join(','))

  const untracked = pathsOf('?? notes/new.txt\n')
  check('untracked', untracked.paths[0] === 'notes/new.txt' && untracked.parsed.records[0]?.untracked === true, untracked.paths.join(','))

  const spaces = pathsOf('?? "notes/keep me.txt"\n')
  check('spaces', spaces.paths[0] === 'notes/keep me.txt', spaces.paths.join(','))

  const nested = pathsOf(' M a/b/c/file.txt\n')
  check('nested', nested.paths[0] === 'a/b/c/file.txt', nested.paths.join(','))

  const dash = pathsOf('?? notes/-keep.txt\n')
  check('leading_dash', dash.paths[0] === 'notes/-keep.txt', dash.paths.join(','))

  const rename = pathsOf(' R old.txt -> new.txt\n')
  check('rename', rename.paths[0] === 'old.txt' && rename.paths[1] === 'new.txt' && !rename.paths.includes('old.txt -> new.txt'), rename.paths.join(','))

  const quotedRename = pathsOf('R  "old name.txt" -> "new name.txt"\n')
  check('rename_quoted', quotedRename.paths[0] === 'old name.txt' && quotedRename.paths[1] === 'new name.txt', quotedRename.paths.join(','))

  const malformed = parsePorcelainV1('R  old.txt -> \n')
  check('rename_fail_safe', malformed.records.length === 0 && malformed.rejected === 1, `rejected=${malformed.rejected}`)

  const blob = ' M notes/keep.txt\n?? notes/new.txt\n'
  const trimmedBug = blob.trim().split('\n')[0]?.slice(3)
  const parsedBlob = pathsOf(blob)
  check('no_prefix_trim', trimmedBug === 'otes/keep.txt' && parsedBlob.paths[0] === 'notes/keep.txt' && parsedBlob.paths[1] === 'notes/new.txt', parsedBlob.paths.join(','))

  const z = parsePorcelainV1Z(' M notes/keep.txt\0?? notes/new.txt\0R  renamed.txt\0old.txt\0?? notes/keep me.txt\0?? notes/-keep.txt\0 M a/b/c/file.txt\0')
  const zPaths = z.records.flatMap(record => record.paths)
  check('nul_records', z.rejected === 0 && zPaths.join('|') === 'notes/keep.txt|notes/new.txt|old.txt|renamed.txt|notes/keep me.txt|notes/-keep.txt|a/b/c/file.txt', zPaths.join('|'))

  check('normalize_dot', canonicalRepoRelativePath('./notes/keep.txt').rel === 'notes/keep.txt', canonicalRepoRelativePath('./notes/keep.txt').rel)
  check('normalize_parent', canonicalRepoRelativePath('notes/../notes/keep.txt').rel === 'notes/keep.txt', canonicalRepoRelativePath('notes/../notes/keep.txt').rel)
  check('reject_traversal', canonicalRepoRelativePath('../notes/keep.txt').ok === false && canonicalRepoRelativePath('notes/../../outside.txt').ok === false, 'traversal')

  const registry = ['notes/keep.txt']
  check('exact_match', dirtyPathMatches(registry, 'notes/keep.txt') && dirtyPathMatches(registry, './notes/keep.txt') && dirtyPathMatches(registry, 'notes/../notes/keep.txt'), 'match')
  check('false_positive', dirtyPathMatches(registry, 'notes/keep.txt.bak') === false && dirtyPathMatches(registry, 'notes/keep.txt2') === false, 'suffix')
  check('dirty_blocks', preexistingDirtyBlocksEdit(registry, 'notes/keep.txt', []) === true && preexistingDirtyBlocksEdit(registry, './notes/keep.txt', []) === true, 'block')
  check('clean_control', preexistingDirtyBlocksEdit(registry, 'billing/api.py', []) === false, 'clean')
  check('owned_edit_continues', preexistingDirtyBlocksEdit(registry, 'notes/keep.txt', ['notes/keep.txt']) === false, 'owned')
  check('outside_blocked', preexistingDirtyBlocksEdit(registry, '../outside.txt', []) === true, 'outside')

  const root = path.join(tmpdir(), `foundry-dirty-path-${Date.now()}`)
  rmSync(root, { recursive: true, force: true })
  write(root, 'notes/keep.txt', 'base\n')
  write(root, 'notes/staged.txt', 'base\n')
  write(root, 'a/b/c/file.txt', 'base\n')
  write(root, 'old.txt', 'base\n')
  git(root, ['init'])
  git(root, ['add', '.'])
  git(root, ['commit', '-m', 'base'])
  write(root, 'notes/keep.txt', 'base\nchanged\n')
  write(root, 'notes/staged.txt', 'staged\n')
  git(root, ['add', '--', 'notes/staged.txt'])
  write(root, 'a/b/c/file.txt', 'nested\n')
  write(root, 'notes/new.txt', 'new\n')
  write(root, 'notes/keep me.txt', 'space\n')
  write(root, 'notes/-keep.txt', 'dash\n')
  git(root, ['mv', '--', 'old.txt', 'renamed.txt'])
  const live = await captureGitBaseline(root)
  const liveDirty = live.dirty.join('|')
  const liveUntracked = live.untracked.join('|')
  check('live_dirty_key', live.dirty.includes('notes/keep.txt') && !live.dirty.includes('otes/keep.txt'), liveDirty)
  check('live_staged', live.dirty.includes('notes/staged.txt'), liveDirty)
  check('live_nested', live.dirty.includes('a/b/c/file.txt'), liveDirty)
  check('live_rename', live.dirty.includes('old.txt') && live.dirty.includes('renamed.txt') && !live.dirty.some(file => file.includes('->')), liveDirty)
  check('live_untracked', live.untracked.includes('notes/new.txt'), liveUntracked)
  check('live_spaces', live.untracked.includes('notes/keep me.txt'), liveUntracked)
  check('live_dash', live.untracked.includes('notes/-keep.txt'), liveUntracked)
  check('live_match', dirtyPathMatches(live.dirty, 'notes/keep.txt') && dirtyPathMatches(live.dirty, './notes/keep.txt') && !dirtyPathMatches(live.dirty, 'notes/keep.txt.bak'), 'live')

  const failed = results.filter(result => !result.pass)
  console.log(`GIT_DIRTY_PATH_VALIDATION ${failed.length === 0 ? 'PASS' : 'FAIL'} ${results.length - failed.length}/${results.length}`)
  if (failed.length) process.exit(1)
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : 'dirty-path validation failed')
  process.exit(1)
})
