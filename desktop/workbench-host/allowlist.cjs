/**
 * W1 workspace allowlist. Never default to $HOME. Refuse symlink escape.
 */
'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

function projectsRoot() {
  const fromEnv = process.env.FOUNDRY_PROJECTS_ROOT?.trim()
  if (fromEnv) return path.resolve(fromEnv)
  return path.join(os.homedir(), 'FoundryProjects')
}

function isInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  return rel === '' || (rel && !rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel))
}

function realOrSelf(target) {
  try {
    return fs.realpathSync.native(target)
  } catch {
    return path.resolve(target)
  }
}

function resolveAllowedWorkspace(requested) {
  const fallback = path.join(projectsRoot(), 'w0-workbench-spike')
  const raw = path.resolve(requested || fallback)
  const home = path.resolve(os.homedir())
  if (raw === home || raw === path.parse(raw).root) {
    return { ok: false, code: 'HOME_OR_ROOT_REFUSED', error: 'Workbench must not open $HOME or filesystem root.' }
  }
  const root = realOrSelf(projectsRoot())
  fs.mkdirSync(root, { recursive: true })
  let stat = null
  try { stat = fs.lstatSync(raw) } catch { stat = null }
  const real = realOrSelf(raw)
  if (stat?.isSymbolicLink() && !isInside(root, real)) {
    return { ok: false, code: 'SYMLINK_ESCAPE', error: 'Symlink workspace escapes the FoundryProjects root.' }
  }
  if (!isInside(root, raw) || !isInside(root, real)) {
    return { ok: false, code: 'UNAUTHORIZED_WORKSPACE', error: 'Workspace is outside the FoundryProjects allowlist.' }
  }
  return { ok: true, folder: real, requested: raw, projectsRoot: root }
}

module.exports = { projectsRoot, isInside, resolveAllowedWorkspace }
