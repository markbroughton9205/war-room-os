/**
 * W7 Linux chrome-sandbox preparation.
 * Source-dev and future install/package path. Does not launch War Room.
 * Does not store credentials. Privileged chown/chmod is explicit.
 */
'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

function sourceHelper(repoRoot) {
  return path.join(repoRoot || path.resolve(__dirname, '..', '..'), 'desktop', 'node_modules', 'electron', 'dist', 'chrome-sandbox')
}

function packagedHelpers(appDir) {
  return [
    path.join(appDir, 'chrome-sandbox'),
    path.join(appDir, 'opt', 'War Room OS', 'chrome-sandbox'),
  ]
}

function inspectHelper(helper) {
  if (!helper || !fs.existsSync(helper)) {
    return { helper, exists: false, verdict: 'PACKAGING_FIX_REQUIRED', operatorCommand: null }
  }
  const st = fs.statSync(helper)
  const mode = (st.mode & 0o7777).toString(8)
  const suid = Boolean(st.mode & 0o4000)
  const rootOwned = st.uid === 0
  const native = process.platform === 'linux' && suid && rootOwned
  return {
    helper,
    exists: true,
    uid: st.uid,
    gid: st.gid,
    mode,
    suid,
    rootOwned,
    native,
    verdict: native ? 'SANDBOX_NATIVE_PASS' : 'ENVIRONMENT_FIX_REQUIRED',
    operatorCommand: `sudo chown root:root "${helper}" && sudo chmod 4755 "${helper}"`,
  }
}

function kernelSandboxLimits() {
  const read = file => {
    try { return fs.readFileSync(file, 'utf8').trim() } catch { return null }
  }
  return {
    unprivileged_userns_clone: read('/proc/sys/kernel/unprivileged_userns_clone'),
    apparmor_restrict_unprivileged_userns: read('/proc/sys/kernel/apparmor_restrict_unprivileged_userns'),
  }
}

function rootCause(inspect) {
  if (inspect.native) return 'native Chromium SUID sandbox helper is correctly installed'
  const kernel = kernelSandboxLimits()
  const parts = []
  if (kernel.apparmor_restrict_unprivileged_userns === '1') {
    parts.push('kernel.apparmor_restrict_unprivileged_userns=1 blocks unprivileged user namespaces, so Electron cannot use the userns sandbox')
  }
  if (!inspect.exists) parts.push('chrome-sandbox binary is missing')
  else {
    if (!inspect.rootOwned) parts.push(`chrome-sandbox uid=${inspect.uid} is not root`)
    if (!inspect.suid) parts.push(`chrome-sandbox mode=${inspect.mode} is not setuid 4755`)
  }
  if (!parts.length) return 'native Chromium SUID sandbox helper is correctly installed'
  return parts.join('; ')
}

function applyHelper(helper) {
  const before = inspectHelper(helper)
  if (before.verdict === 'SANDBOX_NATIVE_PASS') return { ok: true, applied: false, inspect: before, method: 'already' }
  if (process.platform !== 'linux') return { ok: false, applied: false, inspect: before, error: 'not linux' }
  if (!before.exists) return { ok: false, applied: false, inspect: before, error: 'helper missing' }
  const cmd = `chown root:root "${helper}" && chmod 4755 "${helper}"`
  const attempts = [
    { method: 'sudo-n', argv: ['sudo', '-n', 'sh', '-c', cmd] },
    { method: 'pkexec', argv: ['pkexec', 'sh', '-c', cmd] },
  ]
  for (const attempt of attempts) {
    const ran = spawnSync(attempt.argv[0], attempt.argv.slice(1), { encoding: 'utf8', timeout: 120_000 })
    const after = inspectHelper(helper)
    if (after.verdict === 'SANDBOX_NATIVE_PASS') {
      return { ok: true, applied: true, inspect: after, method: attempt.method, stdout: ran.stdout, stderr: ran.stderr }
    }
  }
  return {
    ok: false,
    applied: false,
    inspect: inspectHelper(helper),
    method: 'operator-sudo-required',
    error: 'interactive authentication required',
    operatorCommand: before.operatorCommand,
  }
}

function inspectSource(repoRoot) {
  const helper = sourceHelper(repoRoot)
  const inspect = inspectHelper(helper)
  return { ...inspect, kernel: kernelSandboxLimits(), rootCause: rootCause(inspect), host: os.hostname(), platform: process.platform }
}

module.exports = {
  sourceHelper,
  packagedHelpers,
  inspectHelper,
  inspectSource,
  kernelSandboxLimits,
  rootCause,
  applyHelper,
}

if (require.main === module) {
  const repo = path.resolve(__dirname, '..', '..')
  const apply = process.argv.includes('--apply')
  const helper = process.argv.includes('--helper') ? process.argv[process.argv.indexOf('--helper') + 1] : sourceHelper(repo)
  const result = apply ? applyHelper(helper) : { ok: inspectHelper(helper).verdict === 'SANDBOX_NATIVE_PASS', inspect: inspectSource(repo) }
  console.log(JSON.stringify(result, null, 2))
  process.exit(result.ok ? 0 : 2)
}
