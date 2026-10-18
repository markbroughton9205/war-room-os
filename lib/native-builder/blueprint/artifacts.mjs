/** Host-owned ARTIFACT MANIFEST (isolated). The broker hashes artifacts itself; a stage's own claims are never trusted, and a file merely existing proves nothing.
 *
 * Live reference (read only): packageTool.ts packageRun picks the MOST RECENTLY MODIFIED AppImage/deb under desktop/dist-release (mtime selection), checks size >= 1 MB and
 * `.next/build-meta.json` gitSha === HEAD (dirty trees allowed), then hashes the files. Nothing binds an artifact to the exact source package, base identity or check/build recipe,
 * and a stale artifact left by an earlier build is indistinguishable. This module supplies those bindings. */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { canonical, hash, refuse } from './base.mjs'

export const ARTIFACT_KINDS = Object.freeze(['bundle', 'package', 'manifest', 'report'])
const NAME = /^[\w.-]{1,80}$/
const MAX_BYTES = 64 * 1024 * 1024
export const safeRelPath = rel => typeof rel === 'string' && rel.length > 0 && rel.length <= 300 && !rel.startsWith('/') && !/^[A-Za-z]:/.test(rel) && !rel.split(/[\\/]/).some(s => s === '..' || s === '' || s === '.') && !rel.includes('\0')

/** Regular, non-symlink file physically inside `root`; returns {sha256, bytes} or {error}. */
export function hashArtifactFile(root, rel) {
  if (!safeRelPath(rel)) return { error: 'ARTIFACT_ESCAPE' }
  let realRoot; try { realRoot = fs.realpathSync(root) } catch { return { error: 'ARTIFACT_MISSING' } }
  const abs = path.join(realRoot, rel); let st
  try { st = fs.lstatSync(abs) } catch { return { error: 'ARTIFACT_MISSING' } }
  if (st.isSymbolicLink() || !st.isFile()) return { error: 'ARTIFACT_NOT_REGULAR' }
  let real; try { real = fs.realpathSync(abs) } catch { return { error: 'ARTIFACT_MISSING' } }
  if (real !== abs && !real.startsWith(realRoot + path.sep)) return { error: 'ARTIFACT_ESCAPE' } // a parent-dir symlink would make real !== abs
  if (real !== abs) return { error: 'ARTIFACT_ESCAPE' }
  if (st.size > MAX_BYTES) return { error: 'ARTIFACT_SIZE_MISMATCH' }
  const h = createHash('sha256'); h.update(fs.readFileSync(abs)); return { sha256: h.digest('hex'), bytes: st.size, mtimeMs: st.mtimeMs }
}
/** Bounded digest of a set of source files (paths relative to root): the exact applied source, not the whole tree. */
export function filesDigest(root, relPaths) {
  const rows = [...new Set(relPaths)].sort().map(rel => { const r = hashArtifactFile(root, rel); return [rel, r.error ?? r.sha256] })
  return hash(canonical(rows))
}
/** Bounded recursive digest of declared input roots (e.g. ['src']). Refuses symlinks/oversize trees by embedding the error (so any change or anomaly changes the digest). */
export function treeDigest(root, rels, { maxFiles = 400 } = {}) {
  const rows = []
  const walk = rel => {
    let abs = path.join(root, rel), st; try { st = fs.lstatSync(abs) } catch { rows.push([rel, 'MISSING']); return }
    if (st.isSymbolicLink()) { rows.push([rel, 'SYMLINK']); return }
    if (st.isDirectory()) { for (const n of fs.readdirSync(abs).sort()) { if (rows.length > maxFiles) { rows.push([rel, 'TOO_MANY']); return } walk(path.posix.join(rel, n)) } return }
    const r = hashArtifactFile(root, rel); rows.push([rel, r.error ?? r.sha256])
  }
  for (const rel of [...rels].sort()) walk(rel)
  return hash(canonical(rows))
}

/** Inventory of an output directory: every file/dir entry with its type. Used before AND after a run: anything not declared by the recipe is a problem. */
export function scanOutputDir(dir, allowedRel) {
  const allowed = new Set(allowedRel), found = [], problems = []
  const walk = rel => {
    let abs = path.join(dir, rel), names; try { names = fs.readdirSync(abs) } catch { return }
    for (const n of names.sort()) {
      const r = rel ? path.posix.join(rel, n) : n, st = fs.lstatSync(path.join(dir, r))
      if (st.isSymbolicLink()) { problems.push({ code: 'ARTIFACT_NOT_REGULAR', path: r }); continue }
      if (st.isDirectory()) { walk(r); continue }
      found.push(r)
      if (!allowed.has(r)) problems.push({ code: 'UNEXPECTED_OUTPUT', path: r })
      if (st.mode & 0o111) problems.push({ code: 'UNEXPECTED_EXECUTABLE', path: r })
      if (!st.isFile()) problems.push({ code: 'ARTIFACT_NOT_REGULAR', path: r })
    }
  }
  walk('')
  return { found, problems }
}

/** Build a manifest by hashing the files NOW. `refs` = [{logicalName, relPath, kind}] naming files under `root` (the run's own output dir). `binds` are the facts the artifacts must stay
 * tied to (package, base, check binding, source, build input digest, run id, dependency/recipe/environment digests). Entry timestamps are OBSERVATIONS; per-entry verification status lives in the receipt. */
export function buildManifest({ root, refs, stage, binds, notBeforeMs = 0, now = Date.now }) {
  if (!Array.isArray(refs) || refs.length === 0 || refs.length > 50) refuse('ARTIFACT_MISMATCH', 'artifact', 'A stage must produce between 1 and 50 declared artifacts')
  const seenN = new Set(), seenP = new Set(), entries = []
  for (const r of refs) {
    if (!r || typeof r !== 'object' || !NAME.test(r.logicalName ?? '') || !ARTIFACT_KINDS.includes(r.kind) || !safeRelPath(r.relPath) || seenN.has(r.logicalName) || seenP.has(r.relPath)) refuse('ARTIFACT_MISMATCH', 'artifact', 'Invalid or duplicate artifact reference')
    seenN.add(r.logicalName); seenP.add(r.relPath)
    const h = hashArtifactFile(root, r.relPath); if (h.error) refuse('ARTIFACT_MISMATCH', 'artifact', `Artifact ${r.logicalName} is not usable (${h.error})`, { path: r.relPath })
    if (h.mtimeMs + 2000 < notBeforeMs) refuse('ARTIFACT_MISMATCH', 'artifact', `Artifact ${r.logicalName} predates the run that supposedly produced it (ARTIFACT_PROVENANCE_UNKNOWN)`, { path: r.relPath })
    entries.push({ logicalName: r.logicalName, path: r.relPath, sha256: h.sha256, bytes: h.bytes, kind: r.kind, producedByStage: stage, runId: binds.runId, sourceDigest: binds.sourceDigest, dependencyDigest: binds.dependencyDigest ?? null, buildDigest: binds.buildDigest,
      recipeDigest: binds.recipeDigest ?? null, envDigest: binds.envDigest ?? null, createdAt: Math.round(h.mtimeMs), observedAt: now() })
  }
  entries.sort((a, b) => a.logicalName.localeCompare(b.logicalName))
  const body = { version: 2, stage, entries, binds: { ...binds } }
  return Object.freeze({ ...body, manifestDigest: hash(canonical(body)) })
}
const BIND_KEYS = ['packageDigest', 'baseIdentityDigest', 'checkBinding', 'sourceDigest', 'buildDigest', 'upstreamManifestDigest', 'inputDigest', 'runId', 'dependencyDigest', 'recipeDigest', 'envDigest']
/** Recompute everything: file hashes/sizes AND the bound facts. `expected` is what the host believes NOW; any difference is a problem (stale source, other base, other recipe, swapped file, other run). */
export function verifyManifest(manifest, root, expected) {
  const problems = []
  if (!manifest || manifest.version !== 2 || !Array.isArray(manifest.entries)) return { ok: false, problems: [{ code: 'MANIFEST_TAMPERED' }] }
  const { manifestDigest, ...body } = manifest
  if (hash(canonical(body)) !== manifestDigest) problems.push({ code: 'MANIFEST_TAMPERED' })
  for (const k of BIND_KEYS) if (k in (expected ?? {}) && (manifest.binds?.[k] ?? null) !== (expected[k] ?? null)) problems.push({ code: 'BIND_MISMATCH', field: k })
  for (const e of manifest.entries) {
    if (e.sourceDigest !== manifest.binds?.sourceDigest || e.buildDigest !== manifest.binds?.buildDigest || e.runId !== manifest.binds?.runId) problems.push({ code: 'BIND_MISMATCH', field: 'entry', logicalName: e.logicalName })
    const h = hashArtifactFile(root, e.path)
    if (h.error) problems.push({ code: h.error, logicalName: e.logicalName }); else { if (h.sha256 !== e.sha256) problems.push({ code: 'ARTIFACT_HASH_MISMATCH', logicalName: e.logicalName }); if (h.bytes !== e.bytes) problems.push({ code: 'ARTIFACT_SIZE_MISMATCH', logicalName: e.logicalName }) }
  }
  return { ok: problems.length === 0, problems }
}

/** First symlink (or unreadable entry) found under the declared input roots, or null. Node's permission model does not stop a symlink inside an allowed read dir from reading outside it, so recipes must never run over one. */
export function findInputSymlink(root, rels, { maxFiles = 2000 } = {}) {
  let seen = 0
  const walk = rel => {
    let st; try { st = fs.lstatSync(path.join(root, rel)) } catch { return null }
    if (st.isSymbolicLink()) return rel
    if (!st.isDirectory()) return null
    for (const n of fs.readdirSync(path.join(root, rel)).sort()) { if (++seen > maxFiles) return `${rel}/(too many entries)`; const hit = walk(path.posix.join(rel, n)); if (hit) return hit }
    return null
  }
  for (const rel of [...rels].sort()) { const hit = walk(rel); if (hit) return hit }
  return null
}
