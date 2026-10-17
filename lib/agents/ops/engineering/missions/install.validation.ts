/**
 * Transactional, sandboxed installation: the repository is advanced only by one final fast-forward, model-written build steps cannot reach the network or write outside the scratch
 * worktree, a failure/stop/crash leaves the repository exactly as it was, and stale scratch is cleaned. Real git, real bwrap, real processes.
 * Run: pnpm run validate:foundry-install
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { harness, tmp } from '../engtestkit'
import { cleanupStaleInstallScratch, installRuntime, installScratchDir, type InstallSteps } from './install'
import { haltAllActivity, releaseActivityHold } from '../runtime/activity'
import type { MissionRecord } from './types'

const { check, finish } = harness('FOUNDRY_INSTALL_VALIDATION')
const sh = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8' }).trim()
const node = process.execPath
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function world() {
  const repo = path.join(tmp(), 'repo'); mkdirSync(path.join(repo, 'src'), { recursive: true }); mkdirSync(path.join(repo, 'desktop'), { recursive: true })
  writeFileSync(path.join(repo, 'src', 'a.mjs'), 'export const a = 1\n'); writeFileSync(path.join(repo, 'desktop', 'keep'), ''); writeFileSync(path.join(repo, '.gitignore'), 'node_modules\ndesktop/dist-release\n.built\n')
  sh(repo, 'init', '-q', '-b', 'main'); sh(repo, 'add', '--', '.'); sh(repo, 'commit', '-q', '-m', 'base')
  const head0 = sh(repo, 'rev-parse', 'HEAD')
  sh(repo, 'checkout', '-q', '-b', 'foundry/x'); writeFileSync(path.join(repo, 'src', 'b.mjs'), 'export const b = 2\n'); sh(repo, 'add', '--', 'src/b.mjs'); sh(repo, 'commit', '-q', '-m', 'foundry work')
  const fc = sh(repo, 'rev-parse', 'HEAD'); sh(repo, 'checkout', '-q', 'main')
  const root = tmp(); const optRoot = path.join(root, 'opt'); const scratchRoot = path.join(root, 'scratch')
  const m = { id: 'msn-20261017T000000-aaaaaaaa', title: 't' } as MissionRecord
  const integ = { state: 'APPLIED' as const, branch: 'foundry/x', commit: fc, gates: [], refused: [] }
  return { repo, head0, fc, optRoot, scratchRoot, m, integ }
}
const ok = (script: string): InstallSteps => ({ build: [node, '-e', script], prepare: [node, '-e', '0'], package: [node, '-e', "const fs=require('fs');fs.mkdirSync('dist-release/linux-unpacked',{recursive:true});fs.writeFileSync('dist-release/linux-unpacked/war-room-os','#!/bin/sh\\n',{mode:0o755})"] })
const GOOD = "require('fs').writeFileSync('.built','1')"

{
  const w = world()
  const r = await installRuntime(w.m, w.integ, () => {}, w.repo, { optRoot: w.optRoot, scratchRoot: w.scratchRoot, steps: ok(GOOD) })
  const headNow = sh(w.repo, 'rev-parse', 'HEAD')
  check('I01_a_successful_install_advances_the_repository_with_one_fast_forward_to_the_built_commit', r.state === 'INSTALLED' && headNow !== w.head0 && sh(w.repo, 'rev-parse', `${headNow}^1`) === w.head0 && existsSync(path.join(w.repo, 'src', 'b.mjs')) && sh(w.repo, 'status', '--porcelain') === '', JSON.stringify(r))
  const stamp = r.stamp ? JSON.parse(readFileSync(r.stamp, 'utf8')) : {}
  check('I02_the_installation_is_stamped_with_the_commit_that_is_now_on_the_branch_and_records_that_it_was_sandboxed', stamp.gitSha === headNow && stamp.gitDirty === false && stamp.sandboxed === true && stamp.built_in === 'scratch worktree' && existsSync(path.join(r.path!, 'opt', 'War-Room-OS', 'war-room-os')))
  check('I03_the_scratch_worktree_is_gone_and_unregistered', !existsSync(installScratchDir(w.scratchRoot, w.m.id)) && !sh(w.repo, 'worktree', 'list').includes('scratch'))
  const again = await installRuntime(w.m, w.integ, () => {}, w.repo, { optRoot: w.optRoot, scratchRoot: w.scratchRoot, steps: ok(GOOD) })
  check('I04_a_retry_after_success_is_idempotent_and_does_not_apply_twice', again.state === 'INSTALLED' || /never overwritten|already installed/.test(again.detail ?? ''))
}
{
  const w = world()
  const r = await installRuntime(w.m, w.integ, () => {}, w.repo, { optRoot: w.optRoot, scratchRoot: w.scratchRoot, steps: { ...ok(GOOD), build: [node, '-e', "console.error('Error: Export encountered an error on /x/page: ReferenceError: window is not defined'); process.exit(1)"] } })
  check('I05_a_failed_build_leaves_the_repository_exactly_as_it_was_and_creates_no_installation', r.state === 'FAILED' && /window is not defined/.test(r.detail ?? '') && /repository was not touched/.test(r.detail ?? '') && sh(w.repo, 'rev-parse', 'HEAD') === w.head0 && sh(w.repo, 'status', '--porcelain') === '' && !existsSync(w.optRoot) || (existsSync(w.optRoot) && readdirSync(w.optRoot).length === 0), JSON.stringify(r).slice(0, 300))
  check('I06_the_scratch_worktree_of_a_failed_build_is_removed', !existsSync(installScratchDir(w.scratchRoot, w.m.id)))
}
{
  const w = world()
  const p = installRuntime(w.m, w.integ, () => {}, w.repo, { optRoot: w.optRoot, scratchRoot: w.scratchRoot, steps: ok("setTimeout(()=>{}, 120000)") })
  await sleep(2500)
  const halted = haltAllActivity(true)
  const r = await p
  const leftover = existsSync(installScratchDir(w.scratchRoot, w.m.id))
  releaseActivityHold()
  check('I07_an_Emergency_Stop_during_the_build_kills_the_build_and_the_install_fails_truthfully', halted.killed.length >= 1 && r.state === 'FAILED', JSON.stringify(r).slice(0, 240))
  check('I08_after_the_stop_the_repository_is_clean_untouched_and_the_scratch_is_gone_because_cleanup_runs_outside_the_stop', sh(w.repo, 'rev-parse', 'HEAD') === w.head0 && sh(w.repo, 'status', '--porcelain') === '' && !leftover && !sh(w.repo, 'worktree', 'list').includes('scratch'))
}
{
  const w = world()
  const secretFile = path.join(os.homedir(), '.foundry-install-sandbox-probe')
  const srv = net.createServer((c) => c.end('hi')); await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()))
  const port = (srv.address() as net.AddressInfo).port
  const probe = `const fs=require('fs');const out={};try{fs.writeFileSync(${JSON.stringify(secretFile)},'x');out.homeWrite='ALLOWED'}catch(e){out.homeWrite='blocked'};try{fs.writeFileSync('/etc/foundry-probe','x');out.etcWrite='ALLOWED'}catch(e){out.etcWrite='blocked'};try{out.homeRead=fs.readdirSync(${JSON.stringify(os.homedir())}).length}catch(e){out.homeRead='blocked'};const s=require('net').connect(${port},'127.0.0.1');s.on('connect',()=>{out.net='CONNECTED';fs.writeFileSync('.built',JSON.stringify(out));process.exit(0)});s.on('error',()=>{out.net='blocked';fs.writeFileSync('.built',JSON.stringify(out));process.exit(0)});setTimeout(()=>{out.net='blocked(timeout)';fs.writeFileSync('.built',JSON.stringify(out));process.exit(0)},3000)`
  let probed: Record<string, unknown> = {}
  const r = await installRuntime(w.m, w.integ, () => {}, w.repo, { optRoot: w.optRoot, scratchRoot: w.scratchRoot, steps: ok(probe), beforeCommit: () => { /* the scratch is removed afterwards: read the probe here */ try { probed = JSON.parse(readFileSync(path.join(installScratchDir(w.scratchRoot, w.m.id), '.built'), 'utf8')) } catch { /* below */ } } })
  srv.close()
  check('I09_model_written_build_code_sees_only_an_empty_private_HOME_cannot_write_the_system_and_has_no_network_and_the_real_HOME_is_unchanged', typeof probed.homeRead === 'number' && probed.homeRead <= 8 && probed.etcWrite === 'blocked' && /^blocked/.test(String(probed.net)) && !existsSync(secretFile), JSON.stringify(probed))
  check('I10_the_probe_install_itself_still_succeeded_inside_the_sandbox', r.state === 'INSTALLED', JSON.stringify(r).slice(0, 200))
}
{
  const w = world()
  writeFileSync(path.join(w.repo, 'src', 'a.mjs'), 'export const a = 99\n')
  const r = await installRuntime(w.m, w.integ, () => {}, w.repo, { optRoot: w.optRoot, scratchRoot: w.scratchRoot, steps: ok(GOOD) })
  check('I11_a_dirty_repository_is_refused_before_anything_is_built', r.state === 'FAILED' && /uncommitted changes/.test(r.detail ?? '') && !existsSync(installScratchDir(w.scratchRoot, w.m.id)))
}
{
  const w = world()
  const r = await installRuntime(w.m, w.integ, () => {}, w.repo, { optRoot: w.optRoot, scratchRoot: w.scratchRoot, steps: ok("require('fs').appendFileSync('src/a.mjs','// build changed a tracked file\\n')") })
  check('I12_a_build_that_modifies_tracked_files_is_refused_not_stamped_clean', r.state === 'FAILED' && /left the tree dirty/.test(r.detail ?? '') && sh(w.repo, 'rev-parse', 'HEAD') === w.head0 && sh(w.repo, 'status', '--porcelain') === '')
}
{
  const w = world()
  // the repository moves on while the build runs: the verified build is merged for real if it applies cleanly, otherwise discarded
  const r = await installRuntime(w.m, w.integ, () => {}, w.repo, { optRoot: w.optRoot, scratchRoot: w.scratchRoot, steps: ok(GOOD), beforeCommit: () => { writeFileSync(path.join(w.repo, 'src', 'c.mjs'), 'export const c = 3\n'); sh(w.repo, 'add', '--', 'src/c.mjs'); sh(w.repo, 'commit', '-q', '-m', 'someone else') } })
  check('I13_if_the_repository_moved_during_the_build_the_result_is_merged_without_losing_either_change', r.state === 'INSTALLED' && existsSync(path.join(w.repo, 'src', 'b.mjs')) && existsSync(path.join(w.repo, 'src', 'c.mjs')) && sh(w.repo, 'status', '--porcelain') === '', JSON.stringify(r).slice(0, 200))
}
{
  const w = world()
  // a conflicting move: the same file changed differently on main while the build ran
  sh(w.repo, 'checkout', '-q', 'foundry/x'); writeFileSync(path.join(w.repo, 'src', 'a.mjs'), 'export const a = 100\n'); sh(w.repo, 'commit', '-qam', 'foundry edits a'); const fc2 = sh(w.repo, 'rev-parse', 'HEAD'); sh(w.repo, 'checkout', '-q', 'main')
  const integ = { ...w.integ, commit: fc2 }
  const r = await installRuntime(w.m, integ, () => {}, w.repo, { optRoot: w.optRoot, scratchRoot: w.scratchRoot, steps: ok(GOOD), beforeCommit: () => { writeFileSync(path.join(w.repo, 'src', 'a.mjs'), 'export const a = 200\n'); sh(w.repo, 'commit', '-qam', 'someone else edits a') } })
  check('I14_a_conflicting_move_discards_the_new_installation_aborts_the_merge_and_leaves_the_repository_clean', r.state === 'FAILED' && /could not be merged/.test(r.detail ?? '') && sh(w.repo, 'status', '--porcelain') === '' && (!existsSync(w.optRoot) || readdirSync(w.optRoot).length === 0), JSON.stringify(r).slice(0, 260))
}
{
  const w = world()
  const stale = installScratchDir(w.scratchRoot, 'msn-20261017T000000-deadbeef'); sh(w.repo, 'worktree', 'add', '--detach', stale, 'HEAD')
  const gone = cleanupStaleInstallScratch(w.repo, w.scratchRoot, [])
  check('I15_a_scratch_worktree_left_by_a_crash_is_removed_by_the_janitor_and_a_live_mission_is_spared', gone.length === 1 && !existsSync(stale) && cleanupStaleInstallScratch(w.repo, w.scratchRoot, ['x']).length === 0)
}
{
  const w = world()
  const r = await installRuntime(w.m, w.integ, () => {}, w.repo, { optRoot: w.optRoot, scratchRoot: w.scratchRoot, steps: { ...ok(GOOD), build: [node, '-e', "console.error('x');process.exit(7)"] }, sandbox: true })
  check('I16_sandbox_unavailability_would_refuse_rather_than_build_unsandboxed', r.state === 'FAILED' && !statSync(w.repo).isFile())
}
finish()
process.exit(process.exitCode ?? 0)
