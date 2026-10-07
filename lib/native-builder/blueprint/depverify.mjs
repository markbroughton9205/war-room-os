/** Dependency VERIFICATION in the ACTUAL build environment (isolated; never installs, never fetches). A dependency listed in a manifest, present in a lockfile, declared by a package
 * or cached somewhere is NOT usable. States: DECLARED (partial evidence) | MISSING | PROVISIONED (manifest+lockfile exact, not installed) | RESOLVABLE (exact version resolves inside the workspace
 * but not proven loadable / plan mismatch) | VERIFIED_USABLE (exact version resolves inside the workspace AND a sandboxed probe loads it AND manifest+lockfile match the plan) | UNAPPROVED | STALE
 * (derived by lineage when a previously verified digest changed). Only VERIFIED_USABLE satisfies a build requirement.
 * No package manager is ever spawned; the only process is the read-only permission-model probe. */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonical, hash } from './base.mjs'
import { classifyDependencySpec } from './depplan.mjs'

export const DEP_STATES = Object.freeze(['DECLARED', 'PROVISIONED', 'RESOLVABLE', 'VERIFIED_USABLE', 'STALE', 'MISSING', 'UNAPPROVED'])
const PROBE = fileURLToPath(new URL('./depprobe.mjs', import.meta.url))
const readJsonSafe = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }
const pins = (spec, v) => typeof spec === 'string' && [v, `^${v}`, `~${v}`].includes(spec)

export function createWorkspaceDependencyVerifier({ rootOf, approved = () => true, nodeCmd = process.execPath, probeTimeoutMs = 8000 }) {
  const stats = { spawns: 0, probes: 0 }
  const rootFor = ws => { let r = null; try { r = rootOf(ws)?.root ?? null } catch { r = null } return r && path.isAbsolute(r) ? r : null }
  function facts(root, name) {
    const pkg = readJsonSafe(path.join(root, 'package.json')), lock = readJsonSafe(path.join(root, 'package-lock.json'))
    const manifest = pkg?.dependencies?.[name] ?? pkg?.devDependencies?.[name] ?? null
    const lockEntry = lock?.packages?.[`node_modules/${name}`] ?? null
    const installed = readJsonSafe(path.join(root, 'node_modules', name, 'package.json'))
    return { manifest: typeof manifest === 'string' ? manifest : null, lockfile: typeof lockEntry?.version === 'string' ? lockEntry.version : null, lockIntegrity: typeof lockEntry?.integrity === 'string' ? lockEntry.integrity : null, resolved: typeof installed?.version === 'string' ? installed.version : null }
  }
  /** Plan-compatible evidence (depplan.buildDependencyPlan): resolved only counts when the module sits inside the workspace's own node_modules. */
  function evidence(ws, { name }) {
    const root = rootFor(ws); if (!root) return null
    const f = facts(root, name); let belongs = false
    try { const nm = fs.realpathSync(path.join(root, 'node_modules')); belongs = fs.realpathSync(path.join(root, 'node_modules', name)) === path.join(nm, name) } catch { belongs = false }
    return { manifest: f.manifest, lockfile: f.lockfile, resolved: belongs ? f.resolved : null, receiptRef: f.lockIntegrity ? `lock:${hash(f.lockIntegrity).slice(0, 16)}` : null }
  }
  const probe = (root, name, version, signal) => new Promise(resolve => {
    stats.spawns++; stats.probes++
    const child = spawn(nodeCmd, ['--permission', `--allow-fs-read=${root}`, `--allow-fs-read=${PROBE}`, PROBE, root, name, version], { cwd: root, shell: false, stdio: ['ignore', 'pipe', 'ignore'], env: { PATH: process.env.PATH ?? '', LC_ALL: 'C' } })
    let out = ''; const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* gone */ } }, probeTimeoutMs), onAbort = () => { try { child.kill('SIGKILL') } catch { /* gone */ } }
    signal?.addEventListener('abort', onAbort, { once: true }); child.stdout.on('data', d => { if (out.length < 4000) out += d })
    child.on('error', () => { clearTimeout(timer); resolve({ ok: false, code: 'PROBE_UNAVAILABLE' }) })
    child.on('close', () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); try { resolve(JSON.parse(out.trim().split('\n').pop())) } catch { resolve({ ok: false, code: 'PROBE_NO_RESULT' }) } })
  })
  /** declared: [{name, version}] = package deps ∪ recipe-required deps. Returns per-dependency state + a dependency-ENVIRONMENT digest over exactly what was verified. */
  async function verify(ws, declared, { signal } = {}) {
    const root = rootFor(ws), deps = []
    for (const d of [...declared].sort((a, b) => a.name.localeCompare(b.name))) {
      const reasons = [], spec = classifyDependencySpec({ name: d.name, version: d.version })
      const row = { name: d.name, version: d.version, state: 'MISSING', reasons, detail: null }
      if (!spec.ok) { reasons.push(spec.code); row.state = 'MISSING'; deps.push(row); continue }
      let ok = false; try { ok = approved(d.name, d.version) === true } catch { ok = false }
      if (!ok) { row.state = 'UNAPPROVED'; reasons.push('NOT_APPROVED'); deps.push(row); continue }
      if (!root) { reasons.push('WORKSPACE_ROOT_UNAVAILABLE'); deps.push(row); continue }
      const f = facts(root, d.name), manifestOk = pins(f.manifest, d.version), lockOk = f.lockfile === d.version
      if (f.resolved !== null && f.resolved !== d.version) { reasons.push('RESOLVED_VERSION_MISMATCH'); row.state = 'MISSING'; deps.push(row); continue }
      if (f.resolved === null) {
        if (f.manifest === null && f.lockfile === null) reasons.push('NO_EVIDENCE')
        else { reasons.push(manifestOk && lockOk ? 'NOT_INSTALLED' : 'PARTIAL_EVIDENCE'); if (!manifestOk) reasons.push(f.manifest === null ? 'MANIFEST_ENTRY_MISSING' : 'MANIFEST_NOT_EXACT'); if (!lockOk) reasons.push('LOCKFILE_ENTRY_MISSING_OR_DIFFERENT') }
        row.state = f.manifest === null && f.lockfile === null ? 'MISSING' : manifestOk && lockOk ? 'PROVISIONED' : 'DECLARED'; deps.push(row); continue
      }
      const p = await probe(root, d.name, d.version, signal)
      if (!p.ok) { reasons.push(p.code ?? 'PROBE_FAILED'); row.state = p.code === 'NOT_IN_WORKSPACE' ? 'PROVISIONED' : 'RESOLVABLE'; deps.push(row); continue }
      if (!manifestOk || !lockOk) { reasons.push('PLAN_MISMATCH'); if (!manifestOk) reasons.push('MANIFEST_NOT_EXACT'); if (!lockOk) reasons.push('LOCKFILE_ENTRY_MISSING_OR_DIFFERENT'); row.state = 'RESOLVABLE'; deps.push(row); continue }
      row.state = 'VERIFIED_USABLE'; row.detail = { manifest: f.manifest, lockfile: f.lockfile, lockIntegrity: f.lockIntegrity, entrySha: p.entrySha, pkgSha: p.pkgSha, bins: p.bins, exportKeys: p.exportKeys }; deps.push(row)
    }
    const digest = deps.length === 0 ? hash('NO_DEPENDENCIES') : hash(canonical(deps.map(x => [x.name, x.version, x.state, x.detail])))
    const counts = {}; for (const x of deps) counts[x.state] = (counts[x.state] ?? 0) + 1
    return { deps, digest, counts, allUsable: deps.every(x => x.state === 'VERIFIED_USABLE'), checkedAt: Date.now() }
  }
  return Object.freeze({ evidence, verify, stats: () => ({ ...stats }) })
}
