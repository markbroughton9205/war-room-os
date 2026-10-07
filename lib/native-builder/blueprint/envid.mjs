/** BUILD ENVIRONMENT identity: what the build actually runs on. NAMES of approved environment variables only (never values), no secrets, no host paths beyond tool names.
 * A change to any material input (runtime, platform/arch, a tool's version or binary signature, env mode, allowed env names, sandbox policy) changes the digest and therefore stales the
 * current lineage (history is untouched). */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { canonical, hash } from './base.mjs'

export function createEnvironmentIdentity({ tools = [], envNames = [], mode = 'isolated-fixture', extra = {} } = {}) {
  const defs = tools.map(t => { if (!/^[\w.-]{1,40}$/.test(t.id) || !path.isAbsolute(t.cmd) || !Array.isArray(t.versionArgs)) throw new Error('Invalid tool definition'); return { id: t.id, cmd: t.cmd, versionArgs: [...t.versionArgs] } })
  const names = [...envNames].sort()
  const policyDigest = hash(canonical({ tools: defs.map(t => [t.id, path.basename(t.cmd), t.versionArgs]), envNames: names, mode, extra }))
  function identity() {
    const toolRows = defs.map(t => {
      let version = 'UNKNOWN', binSig = 'UNKNOWN'
      try { const r = spawnSync(t.cmd, t.versionArgs, { timeout: 3000, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'ignore'] }); if (r.status === 0) version = String(r.stdout).trim().slice(0, 80).replace(/[^\w.+ -]/g, '_') } catch { /* UNKNOWN */ }
      try { const st = fs.statSync(t.cmd); binSig = `${st.size}:${Math.round(st.mtimeMs)}` } catch { /* UNKNOWN */ }
      return { id: t.id, version, binSig }
    })
    const body = { schema: 1, runtime: { node: process.version }, platform: { os: process.platform, arch: process.arch, type: os.type() }, tools: toolRows, envMode: mode, envNames: names, sandbox: 'node-permission-model', network: 'none', extra }
    return { identity: body, digest: hash(canonical(body)) }
  }
  return Object.freeze({ identity, policyDigest, envNames: names })
}
