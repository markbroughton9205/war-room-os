/** Host-owned DEPENDENCY PLAN (isolated). A package may only DECLARE a dependency need (name + exact version); it can never install, never change a manifest/lockfile, and
 * imported research cannot authorize anything. Provisioning is a HOST fact proven by evidence, never inferred from import text.
 *
 * Live reference (read only): there is NO dependency-plan subsystem. validationRunner.ts exposes op `package_install` = `<pm> install` (no exact versions, runs lifecycle scripts, mutates
 * the lockfile) and `package_script`; foundryApplicationMission.ts only has prose ("record reason, exact version, source and lockfile change"); installer.install_production
 * is an artifact installer, not a dependency installer. This module defines the missing contract; nothing here installs anything. */
import { canonical, hash } from './base.mjs'

export const DEP_ECOSYSTEMS = Object.freeze(['npm'])
const NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/
const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/ // semver core + optional prerelease; no build metadata (not resolvable identity), no leading v, no range operators
/** Classify a dependency spec (host policy). Returns {ok} or {ok:false, code}. Ranges, tags, URLs, git/file/workspace/alias specs are all refused. */
export function classifyDependencySpec({ name, version, ecosystem = 'npm' } = {}) {
  if (!DEP_ECOSYSTEMS.includes(ecosystem)) return { ok: false, code: 'ECOSYSTEM_UNSUPPORTED' }
  if (typeof name !== 'string' || !NAME.test(name) || name.length > 214) return { ok: false, code: 'NAME_INVALID' }
  if (typeof version !== 'string') return { ok: false, code: 'VERSION_INVALID' }
  if (/^(?:https?|git|git\+\w+|ssh|file|link|workspace|npm|github|gitlab|bitbucket):/i.test(version) || /[\/\\]/.test(version) || version.includes('@')) return { ok: false, code: 'VERSION_SOURCE_SPECIFIER' }
  if (/^[~^<>=*]|\s|\|\||\bx\b|\.x$|^latest$|^next$|^[a-z]+$/i.test(version)) return { ok: false, code: /^[a-z]+$/i.test(version) ? 'VERSION_TAG' : 'VERSION_RANGE' }
  if (!EXACT.test(version)) return { ok: false, code: 'VERSION_NOT_EXACT' }
  return { ok: true }
}
/** Does a MANIFEST spec (as found in package.json) pin exactly this version? Only exact or caret/tilde of exactly this version count; anything else needs a governed manifest change. */
const manifestPins = (spec, version) => typeof spec === 'string' && [version, `^${version}`, `~${version}`].includes(spec)

/** `evidence(workspaceId, {name, version})` -> {manifest: spec|null, lockfile: version|null, resolved: version|null, receiptRef: string|null} from the HOST (live: package manager resolution + lockfile).
 * alreadyProvisioned needs resolved === exact AND lockfile === exact AND the manifest pins it. Missing evidence => not provisioned (DEPENDENCY_PLAN_REQUIRED). */
export function buildDependencyPlan({ declared, workspaceId, evidence, approvedPlanDigest = null }) {
  const entries = []
  for (const d of declared) {
    const cls = classifyDependencySpec({ name: d.name, version: d.version })
    let ev = null; try { ev = evidence ? evidence(workspaceId, { name: d.name, version: d.version }) : null } catch { ev = null }
    const e = ev && typeof ev === 'object' ? ev : {}
    const resolved = typeof e.resolved === 'string' ? e.resolved : null, lockfile = typeof e.lockfile === 'string' ? e.lockfile : null, manifest = typeof e.manifest === 'string' ? e.manifest : null
    const requiresManifestChange = !manifestPins(manifest, d.version), requiresLockfileChange = lockfile !== d.version
    const alreadyProvisioned = cls.ok && resolved === d.version && !requiresLockfileChange && !requiresManifestChange
    entries.push({ dependencyId: `dep-${hash(canonical({ ecosystem: 'npm', name: d.name, version: d.version })).slice(0, 24)}`, ecosystem: 'npm', name: d.name, exactVersion: d.version, reason: 'DECLARED_BY_PACKAGE_UNVERIFIED', requestedByPackage: true,
      alreadyProvisioned, requiresManifestChange, requiresLockfileChange, specProblemCode: cls.ok ? null : cls.code, approvalState: alreadyProvisioned ? 'NOT_REQUIRED' : 'REQUIRED',
      provenance: { source: ev ? 'host-evidence' : 'none', receiptRef: typeof e.receiptRef === 'string' ? e.receiptRef.slice(0, 120) : null } })
  }
  entries.sort((a, b) => a.name.localeCompare(b.name))
  const digest = hash(canonical(entries))
  const blocked = entries.filter(e => !e.alreadyProvisioned)
  const approved = approvedPlanDigest !== null && approvedPlanDigest === digest
  const status = entries.length === 0 ? 'NONE' : blocked.length === 0 ? 'PROVISIONED' : approved ? 'APPROVED_NOT_PROVISIONED' : 'BLOCKED'
  return Object.freeze({ status, digest, entries: Object.freeze(entries.map(e => Object.freeze(e))), blockedCount: blocked.length, manifestChange: entries.some(e => e.requiresManifestChange), lockfileChange: entries.some(e => e.requiresLockfileChange),
    // An approved plan is a Commander decision about the NEED; nothing installs it and execution still requires every dependency to be provisioned.
    executable: status === 'PROVISIONED' || status === 'NONE' })
}
