/**
 * buildLock.ts validation — acquire/release/busy/stale/status, plus (Step 13) a REAL two-process
 * concurrency proof: two separate OS processes race for the same repo-scoped lock, and their
 * hold intervals are asserted never to overlap.
 */
import { pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveBaseRepoRoot } from '@/lib/repo/paths'
import { acquireBuildLock, buildLockStatus, withBuildLock } from './buildLock'

const execFileAsync = promisify(execFile)

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function lockFilePath(): string {
  return path.join(resolveBaseRepoRoot(), '.war-room', 'locks', 'build-package.lock.json')
}

async function basicRoundTripTests(): Promise<CaseResult[]> {
  const before = await buildLockStatus()
  const acquired = await acquireBuildLock({ missionId: `test-${randomUUID()}`, operation: 'unit-test' })
  if (acquired.state !== 'ACQUIRED') return [check('basic_01_acquire', false, JSON.stringify(acquired))]
  const whileHeld = await buildLockStatus()
  await acquired.release()
  const after = await buildLockStatus()
  return [
    check('basic_01_acquire', true, JSON.stringify(acquired.lock)),
    check('basic_02_status_reports_locked_while_held', whileHeld.locked && whileHeld.holder?.callId === acquired.lock.callId, JSON.stringify(whileHeld)),
    check('basic_03_release_clears_lock', !after.locked, JSON.stringify(after)),
    check('basic_04_no_lock_leaked_before_test', !before.locked || before.stale, JSON.stringify(before)),
  ]
}

async function busyTests(): Promise<CaseResult[]> {
  const holder = await acquireBuildLock({ missionId: 'holder-mission', operation: 'unit-test-hold' })
  if (holder.state !== 'ACQUIRED') return [check('busy_01_setup_acquire', false, JSON.stringify(holder))]
  try {
    const contender = await acquireBuildLock({ missionId: 'contender-mission', operation: 'unit-test-contend', waitMs: 0 })
    return [check('busy_01_second_acquire_reports_busy', contender.state === 'BUSY' && contender.holder.missionId === 'holder-mission', JSON.stringify(contender))]
  } finally {
    await holder.release()
  }
}

async function timeoutTests(): Promise<CaseResult[]> {
  const holder = await acquireBuildLock({ missionId: 'holder-mission-2', operation: 'unit-test-hold-2' })
  if (holder.state !== 'ACQUIRED') return [check('timeout_01_setup_acquire', false, JSON.stringify(holder))]
  try {
    const started = Date.now()
    const contender = await acquireBuildLock({ missionId: 'contender-mission-2', operation: 'unit-test-contend-2', waitMs: 700 })
    const elapsed = Date.now() - started
    return [check('timeout_01_waits_then_times_out', contender.state === 'TIMEOUT' && elapsed >= 650, `${JSON.stringify(contender)} elapsedMs=${elapsed}`)]
  } finally {
    await holder.release()
  }
}

async function staleRecoveryTests(): Promise<CaseResult[]> {
  const deadPid = 2_147_480_000 // implausible pid, guaranteed not alive
  const staleLock = {
    missionId: 'crashed-mission',
    callId: randomUUID(),
    pid: deadPid,
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    operation: 'unit-test-crash',
    repoIdentity: resolveBaseRepoRoot(),
  }
  await mkdir(path.dirname(lockFilePath()), { recursive: true })
  await writeFile(lockFilePath(), JSON.stringify(staleLock, null, 2), 'utf8')
  const recovered = await acquireBuildLock({ missionId: 'recovering-mission', operation: 'unit-test-recover' })
  if (recovered.state !== 'ACQUIRED') return [check('stale_01_reclaims_dead_pid_lock', false, JSON.stringify(recovered))]
  await recovered.release()
  return [check('stale_01_reclaims_dead_pid_lock', recovered.lock.missionId === 'recovering-mission', JSON.stringify(recovered.lock))]
}

async function nestedSameMissionTests(): Promise<CaseResult[]> {
  const outer = await acquireBuildLock({ missionId: 'nested-same-mission', operation: 'outer-build-pipeline' })
  if (outer.state !== 'ACQUIRED') return [check('nested_01_outer_acquire', false, JSON.stringify(outer))]
  try {
    const inner = await withBuildLock({ missionId: 'nested-same-mission', operation: 'inner-build.run', waitMs: 0 }, async () => 'nested-ran')
    const stillHeld = await buildLockStatus()
    const other = await acquireBuildLock({ missionId: 'nested-other-mission', operation: 'peer-build.run', waitMs: 0 })
    return [
      check('nested_01_same_mission_reenters', inner.ok === true && inner.value === 'nested-ran' && inner.lockState === 'ACQUIRED', JSON.stringify(inner)),
      check('nested_02_outer_still_held_after_inner_release', stillHeld.locked === true && stillHeld.holder?.callId === outer.lock.callId, JSON.stringify(stillHeld)),
      check('nested_03_different_mission_same_process_busy', other.state === 'BUSY' && other.holder.missionId === 'nested-same-mission', JSON.stringify(other)),
    ]
  } finally {
    await outer.release()
  }
}

async function withBuildLockTests(): Promise<CaseResult[]> {
  const ok = await withBuildLock({ missionId: 'with-lock-mission', operation: 'unit-test-with-lock' }, async () => 'ran')
  const holder = await acquireBuildLock({ missionId: 'holder-mission-3', operation: 'unit-test-hold-3' })
  if (holder.state !== 'ACQUIRED') return [check('withlock_02_setup', false, JSON.stringify(holder))]
  const busy = await withBuildLock({ missionId: 'blocked-mission', operation: 'unit-test-blocked', waitMs: 0 }, async () => 'should not run')
  await holder.release()
  let threwAndReleased = false
  try {
    await withBuildLock({ missionId: 'throwing-mission', operation: 'unit-test-throw' }, async () => {
      throw new Error('deliberate')
    })
  } catch {
    threwAndReleased = (await buildLockStatus()).locked === false
  }
  return [
    check('withlock_01_runs_fn_and_returns_value', ok.ok === true && ok.value === 'ran', JSON.stringify(ok)),
    check('withlock_02_busy_never_runs_fn', busy.ok === false && busy.lockState === 'BUSY', JSON.stringify(busy)),
    check('withlock_03_lock_released_even_when_fn_throws', threwAndReleased, `locked after throw: ${!threwAndReleased}`),
  ]
}

/** Step 13 — real two-process concurrency proof. Both contenders wait up to 8s for the lock;
 * their [start,end] hold intervals must never overlap, proving true cross-process mutual
 * exclusion (not just single-event-loop serialization). */
async function realConcurrencyTests(): Promise<CaseResult[]> {
  const dir = await mkdtemp(path.join(tmpdir(), 'foundry-build-lock-concurrency-'))
  const evidencePath = path.join(dir, 'evidence.jsonl')
  await writeFile(evidencePath, '', 'utf8')
  const repoRoot = resolveBaseRepoRoot()
  const scriptPath = path.join(repoRoot, 'scripts', 'foundry', 'build-lock-contender.mjs')
  const spawnOne = (missionId: string) =>
    execFileAsync(process.execPath, ['--loader', './scripts/ts-extension-loader.mjs', '--experimental-transform-types', scriptPath, missionId, evidencePath, '800'], { cwd: repoRoot })
      .then(r => ({ ok: true as const, stdout: r.stdout }))
      .catch(e => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }))

  try {
    const [a, b] = await Promise.all([spawnOne('concurrency-agent-A'), spawnOne('concurrency-agent-B')])
    if (!a.ok || !b.ok) {
      return [check('concurrency_01_both_contenders_completed', false, JSON.stringify({ a, b }))]
    }
    const lines = (await readFile(evidencePath, 'utf8')).trim().split('\n').filter(Boolean)
    const intervals = lines.map(l => JSON.parse(l) as { missionId: string; start: number; end: number })
    const bothRecorded = intervals.length === 2 && new Set(intervals.map(i => i.missionId)).size === 2
    const [i1, i2] = intervals.sort((x, y) => x.start - y.start)
    const noOverlap = bothRecorded && i2.start >= i1.end
    return [
      check('concurrency_01_both_contenders_completed', true, JSON.stringify({ a: a.stdout.trim(), b: b.stdout.trim() })),
      check('concurrency_02_both_recorded_a_hold_interval', bothRecorded, JSON.stringify(intervals)),
      check('concurrency_03_hold_intervals_never_overlap', noOverlap, JSON.stringify({ i1, i2 })),
    ]
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function run(): Promise<void> {
  const results: CaseResult[] = []
  const add = (batch: CaseResult[]) => {
    results.push(...batch)
    for (const r of batch) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name} ${r.detail}`)
  }
  add(await basicRoundTripTests())
  add(await busyTests())
  add(await timeoutTests())
  add(await staleRecoveryTests())
  add(await withBuildLockTests())
  add(await nestedSameMissionTests())
  add(await realConcurrencyTests())
  const failed = results.filter(r => !r.pass)
  console.log(`buildLock validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run()
}

export { run as runBuildLockValidation }
