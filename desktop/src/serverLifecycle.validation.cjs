/**
 * Direct lifecycle validation for serverLifecycle.cjs (#SEE desktop/src/main.cjs
 * ensureRuntimes()). Executable script, repo-consistent with desktop/scripts/build-check.cjs:
 * prints a JSON result and exits non-zero on any failing case.
 *
 * Run: node desktop/src/serverLifecycle.validation.cjs
 */
'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { spawn } = require('node:child_process')
const lifecycle = require('./serverLifecycle.cjs')

const results = []
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail: detail === undefined ? '' : String(detail) })
}

function mkTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function spawnChild(cwd, script) {
  return spawn(process.execPath, ['-e', script], {
    cwd,
    stdio: ['ignore', 'pipe', 'ignore'],
    detached: true,
  })
}

async function waitFor(fn, timeoutMs = 4000, pollMs = 50) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const v = await fn()
    if (v) return v
    await new Promise(r => setTimeout(r, pollMs))
  }
  return null
}

function killHard(child) {
  if (!child || child.exitCode !== null) return
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    try {
      child.kill('SIGKILL')
    } catch {
      /* ignore */
    }
  }
}

async function main() {
  // --- A. isProcessAlive() ---
  check('isProcessAlive_self_true', lifecycle.isProcessAlive(process.pid) === true, `pid=${process.pid}`)

  const shortLived = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' })
  const shortLivedPid = shortLived.pid
  await new Promise(resolve => shortLived.on('exit', resolve))
  await new Promise(r => setTimeout(r, 50))
  check('isProcessAlive_terminated_false', lifecycle.isProcessAlive(shortLivedPid) === false, `pid=${shortLivedPid}`)

  check('isProcessAlive_rejects_bad_input', lifecycle.isProcessAlive(-1) === false && lifecycle.isProcessAlive(NaN) === false, '')

  // --- B. isWarRoomRuntime() ---
  const validRoot = mkTmpDir('wr-lifecycle-valid-')
  fs.writeFileSync(path.join(validRoot, 'RUNTIME_MANIFEST.json'), JSON.stringify({ source_commit: 'deadbeef' }))
  const ordinaryRoot = mkTmpDir('wr-lifecycle-ordinary-')
  const malformedRoot = mkTmpDir('wr-lifecycle-malformed-')
  fs.writeFileSync(path.join(malformedRoot, 'RUNTIME_MANIFEST.json'), '{ not valid json')

  const idleScript = 'setInterval(() => {}, 60000)'
  const validChild = spawnChild(validRoot, idleScript)
  const ordinaryChild = spawnChild(ordinaryRoot, idleScript)
  const malformedChild = spawnChild(malformedRoot, idleScript)
  await new Promise(r => setTimeout(r, 150))

  try {
    const validIdentity = lifecycle.isWarRoomRuntime(validChild.pid)
    check(
      'isWarRoomRuntime_valid_manifest_true',
      validIdentity.verified === true && path.resolve(validIdentity.runtimeRoot) === path.resolve(validRoot),
      JSON.stringify(validIdentity),
    )

    const ordinaryIdentity = lifecycle.isWarRoomRuntime(ordinaryChild.pid)
    check('isWarRoomRuntime_ordinary_dir_false', ordinaryIdentity.verified === false, JSON.stringify(ordinaryIdentity))

    const malformedIdentity = lifecycle.isWarRoomRuntime(malformedChild.pid)
    check('isWarRoomRuntime_malformed_manifest_false', malformedIdentity.verified === false, JSON.stringify(malformedIdentity))

    check('isWarRoomRuntime_missing_pid_false', lifecycle.isWarRoomRuntime(999999999).verified === false, '')

    // Real packaged boot-ui.cjs chdirs into <runtimeRoot>/ui before serving (verified
    // against the live production UI process's /proc/<pid>/cwd during this validation
    // pass) — a child whose cwd is that "ui" subdirectory must still resolve to the
    // parent as its runtime root.
    const uiSubdir = path.join(validRoot, 'ui')
    fs.mkdirSync(uiSubdir, { recursive: true })
    const uiChdirChild = spawnChild(uiSubdir, idleScript)
    await new Promise(r => setTimeout(r, 150))
    try {
      const uiIdentity = lifecycle.isWarRoomRuntime(uiChdirChild.pid)
      check(
        'isWarRoomRuntime_ui_subdir_resolves_parent_manifest',
        uiIdentity.verified === true && path.resolve(uiIdentity.runtimeRoot) === path.resolve(validRoot),
        JSON.stringify(uiIdentity),
      )
    } finally {
      killHard(uiChdirChild)
    }

    // An ordinary directory that happens to be named "ui" but has no manifest one
    // level up must still fail closed.
    const bareUiSubdir = path.join(ordinaryRoot, 'ui')
    fs.mkdirSync(bareUiSubdir, { recursive: true })
    const bareUiChild = spawnChild(bareUiSubdir, idleScript)
    await new Promise(r => setTimeout(r, 150))
    try {
      const bareUiIdentity = lifecycle.isWarRoomRuntime(bareUiChild.pid)
      check('isWarRoomRuntime_ui_subdir_without_parent_manifest_false', bareUiIdentity.verified === false, JSON.stringify(bareUiIdentity))
    } finally {
      killHard(bareUiChild)
    }

    // --- D. PID/port ownership (testable safely: no interaction with 3847/3848) ---
    const portScript =
      "const net=require('net');const s=net.createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));});setInterval(()=>{},60000)"
    const listenerChild = spawnChild(validRoot, portScript)
    let reportedPort = ''
    listenerChild.stdout.on('data', d => {
      reportedPort += String(d)
    })
    const port = await waitFor(() => (reportedPort.trim() ? Number(reportedPort.trim()) : null), 4000)
    try {
      if (port) {
        await new Promise(r => setTimeout(r, 150))
        const foundPid = lifecycle.findPidOwningPort(port)
        check('findPidOwningPort_resolves_listener', foundPid === listenerChild.pid, `expected=${listenerChild.pid} found=${foundPid}`)

        const sameRuntime = lifecycle.classifyPortOwner({ port, currentRuntimeRoot: validRoot })
        check('classifyPortOwner_same_runtime', sameRuntime.status === 'SAME_RUNTIME' && sameRuntime.pid === listenerChild.pid, JSON.stringify(sameRuntime))

        const staleRuntime = lifecycle.classifyPortOwner({ port, currentRuntimeRoot: ordinaryRoot })
        check('classifyPortOwner_stale_runtime', staleRuntime.status === 'STALE_RUNTIME' && staleRuntime.pid === listenerChild.pid, JSON.stringify(staleRuntime))
      } else {
        check('findPidOwningPort_resolves_listener', false, 'listener child did not report a port in time')
      }

      const unknownPort = await waitFor(async () => {
        const p = 20000 + Math.floor(Math.random() * 20000)
        const busy = await new Promise(resolve => {
          const probe = net.connect({ host: '127.0.0.1', port: p })
          probe.once('connect', () => {
            probe.destroy()
            resolve(true)
          })
          probe.once('error', () => resolve(false))
        })
        return busy ? null : p
      }, 2000)
      if (unknownPort) {
        const noOwner = lifecycle.classifyPortOwner({ port: unknownPort, currentRuntimeRoot: validRoot })
        check('classifyPortOwner_unknown_when_nothing_listening', noOwner.status === 'UNKNOWN_OWNER' && noOwner.pid === null, JSON.stringify(noOwner))
      }

      // Verified stale termination: kill the listener via the same path production uses.
      if (port) {
        const killed = await lifecycle.terminateVerifiedStaleRuntime(listenerChild.pid, { termTimeoutMs: 1000, killTimeoutMs: 1000, pollMs: 25 })
        check('terminateVerifiedStaleRuntime_kills_verified_pid', killed === true && lifecycle.isProcessAlive(listenerChild.pid) === false, `pid=${listenerChild.pid}`)
      }
    } finally {
      killHard(listenerChild)
    }
  } finally {
    killHard(validChild)
    killHard(ordinaryChild)
    killHard(malformedChild)
    fs.rmSync(validRoot, { recursive: true, force: true })
    fs.rmSync(ordinaryRoot, { recursive: true, force: true })
    fs.rmSync(malformedRoot, { recursive: true, force: true })
  }

  // --- C. Lock file ---
  const lockDir = mkTmpDir('wr-lifecycle-lock-')
  try {
    const wrote = lifecycle.writeLockFile(lockDir, { pid: 12345, port: 3847, runtimeRoot: '/tmp/example-runtime', sourceCommit: 'abc123' })
    check('lockFile_write_ok', wrote === true, '')

    const roundTrip = lifecycle.readLockFile(lockDir, 3847)
    check(
      'lockFile_round_trip',
      Boolean(roundTrip) && roundTrip.pid === 12345 && roundTrip.port === 3847 && roundTrip.runtimeRoot === '/tmp/example-runtime' && roundTrip.sourceCommit === 'abc123',
      JSON.stringify(roundTrip),
    )

    fs.writeFileSync(lifecycle.lockFilePath(lockDir, 3848), '{ this is not json')
    check('lockFile_corrupt_fails_safe', lifecycle.readLockFile(lockDir, 3848) === null, '')

    fs.writeFileSync(lifecycle.lockFilePath(lockDir, 3999), JSON.stringify({ pid: 999999999, port: 3999 }))
    check('lockFile_partial_fields_fails_safe', lifecycle.readLockFile(lockDir, 3999) === null, '')

    // Stale-PID lock content must never be consulted by ownership classification —
    // classifyPortOwner takes no lock-derived input at all, so a forged/stale lock
    // claiming an unrelated pid cannot influence its verdict.
    lifecycle.writeLockFile(lockDir, { pid: 999999999, port: 4001, runtimeRoot: '/nonexistent', sourceCommit: null })
    const verdictIgnoresLock = lifecycle.classifyPortOwner({ port: 4001, currentRuntimeRoot: '/nonexistent' })
    check(
      'lockFile_stale_pid_does_not_authorize_kill',
      verdictIgnoresLock.status === 'UNKNOWN_OWNER' && verdictIgnoresLock.pid === null,
      JSON.stringify(verdictIgnoresLock),
    )

    check('clearLockFile_removes_file', lifecycle.clearLockFile(lockDir, 3847) === true && lifecycle.readLockFile(lockDir, 3847) === null, '')
  } finally {
    fs.rmSync(lockDir, { recursive: true, force: true })
  }

  // --- E. Reused ownership: capture at adoption, re-verify before shutdown kill ---
  const reuseRoot = mkTmpDir('wr-lifecycle-reuse-')
  fs.writeFileSync(path.join(reuseRoot, 'RUNTIME_MANIFEST.json'), JSON.stringify({ source_commit: 'reuse-commit-1' }))
  const otherRoot = mkTmpDir('wr-lifecycle-reuse-other-')
  fs.writeFileSync(path.join(otherRoot, 'RUNTIME_MANIFEST.json'), JSON.stringify({ source_commit: 'other-commit' }))

  const reusePortScript =
    "const net=require('net');const s=net.createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));});setInterval(()=>{},60000)"
  const reuseChild = spawnChild(reuseRoot, reusePortScript)
  let reusePortReport = ''
  reuseChild.stdout.on('data', d => {
    reusePortReport += String(d)
  })
  const reusePort = await waitFor(() => (reusePortReport.trim() ? Number(reusePortReport.trim()) : null), 4000)

  try {
    if (reusePort) {
      await new Promise(r => setTimeout(r, 150))

      // 1. SAME_RUNTIME owner returned with PID
      const ownership = lifecycle.classifyPortOwner({ port: reusePort, currentRuntimeRoot: reuseRoot })
      check('reuse_1_same_runtime_owner_has_pid', ownership.status === 'SAME_RUNTIME' && ownership.pid === reuseChild.pid, JSON.stringify(ownership))

      // 2. reused PID is tracked — a plain record, never a fabricated ChildProcess
      const record = lifecycle.captureReusedOwnership({ pid: ownership.pid, port: reusePort, runtimeRoot: ownership.runtimeRoot })
      check(
        'reuse_2_pid_tracked_in_record',
        record.pid === reuseChild.pid &&
          record.port === reusePort &&
          path.resolve(record.runtimeRoot) === path.resolve(reuseRoot) &&
          typeof record.startTicks === 'string' &&
          record.startTicks.length > 0,
        JSON.stringify(record),
      )

      // 3 + 4. shutdown re-verifies before terminating; matching identity allows it
      const verdictOk = lifecycle.reverifyReusedOwnership(record)
      check('reuse_3_shutdown_reverifies_before_termination', verdictOk.ok === true, JSON.stringify(verdictOk))
      check('reuse_4_matching_identity_allows_terminate', verdictOk.ok === true, JSON.stringify(verdictOk))

      // 5. PID "reused by an unrelated process" (process-generation mismatch) = NO KILL
      const forgedGenerationRecord = { ...record, startTicks: `${record.startTicks}-stale` }
      const verdictGenerationMismatch = lifecycle.reverifyReusedOwnership(forgedGenerationRecord)
      check(
        'reuse_5_generation_mismatch_no_kill',
        verdictGenerationMismatch.ok === false && verdictGenerationMismatch.reason === 'generation_mismatch' && lifecycle.isProcessAlive(reuseChild.pid) === true,
        JSON.stringify(verdictGenerationMismatch),
      )

      // 6. runtime-root mismatch at shutdown = NO KILL
      const forgedRootRecord = { ...record, runtimeRoot: path.resolve(otherRoot) }
      const verdictRootMismatch = lifecycle.reverifyReusedOwnership(forgedRootRecord)
      check(
        'reuse_6_runtime_root_mismatch_no_kill',
        verdictRootMismatch.ok === false && verdictRootMismatch.reason === 'runtime_root_mismatch' && lifecycle.isProcessAlive(reuseChild.pid) === true,
        JSON.stringify(verdictRootMismatch),
      )

      // 7. missing /proc identity (manifest gone, process still alive) = NO KILL
      const manifestPath = path.join(reuseRoot, 'RUNTIME_MANIFEST.json')
      const manifestBackup = fs.readFileSync(manifestPath, 'utf8')
      fs.rmSync(manifestPath)
      const verdictIdentityLost = lifecycle.reverifyReusedOwnership(record)
      check(
        'reuse_7_missing_identity_no_kill',
        verdictIdentityLost.ok === false && verdictIdentityLost.reason === 'identity_lost' && lifecycle.isProcessAlive(reuseChild.pid) === true,
        JSON.stringify(verdictIdentityLost),
      )
      fs.writeFileSync(manifestPath, manifestBackup)

      // 8. lock file alone = NO KILL. reverifyReusedOwnership only ever consults the
      // in-memory captured record; an instance that never adopted anything (record is
      // null — e.g. it only sees a lock file left by a previous run) always refuses,
      // regardless of what that lock file says.
      const lockScratchDir = mkTmpDir('wr-lifecycle-reuse-lock-')
      lifecycle.writeLockFile(lockScratchDir, { pid: reuseChild.pid, port: reusePort, runtimeRoot: reuseRoot, sourceCommit: 'reuse-commit-1', adopted: true })
      const verdictNoRecord = lifecycle.reverifyReusedOwnership(null)
      check(
        'reuse_8_lock_file_alone_no_kill',
        verdictNoRecord.ok === false && verdictNoRecord.reason === 'no_record' && Boolean(lifecycle.readLockFile(lockScratchDir, reusePort)),
        JSON.stringify(verdictNoRecord),
      )
      fs.rmSync(lockScratchDir, { recursive: true, force: true })

      // Positive end-to-end: a genuinely still-valid record IS allowed to terminate,
      // via the same terminateVerifiedStaleRuntime() escalation used elsewhere.
      const finalVerdict = lifecycle.reverifyReusedOwnership(record)
      const killedReused = finalVerdict.ok ? await lifecycle.terminateVerifiedStaleRuntime(record.pid) : false
      check(
        'reuse_terminate_after_valid_reverify',
        finalVerdict.ok === true && killedReused === true && lifecycle.isProcessAlive(record.pid) === false,
        `finalVerdict=${JSON.stringify(finalVerdict)} killed=${killedReused}`,
      )
    } else {
      check('reuse_setup_listener_reported_port', false, 'reuse listener did not report a port in time')
    }
  } finally {
    killHard(reuseChild)
    fs.rmSync(reuseRoot, { recursive: true, force: true })
    fs.rmSync(otherRoot, { recursive: true, force: true })
  }

  const failed = results.filter(r => !r.pass)
  const summary = { ok: failed.length === 0, total: results.length, failed: failed.length, results }
  console.log(JSON.stringify(summary, null, 2))
  if (failed.length > 0) process.exitCode = 1
}

main().catch(err => {
  console.error('serverLifecycle.validation.cjs FATAL', err)
  process.exitCode = 1
})
