import { cpSync, lstatSync, realpathSync, rmSync } from 'node:fs'
import path from 'node:path'

/**
 * Containment helpers for everything the engine copies or deletes. A workspace may contain symlinks (a model or a hostile template can create one);
 * a plain recursive copy would keep them, and a later delete "inside the copy" would then follow a link out of it.
 */

/** Copies a workspace tree and DROPS every symlink (file or directory), so nothing in the copy can lead outside it. `skip` names extra path segments to leave out. */
export function copyTreeNoLinks(src: string, dst: string, skip: (rel: string) => boolean = () => false): void {
  cpSync(src, dst, {
    recursive: true,
    dereference: false,
    filter: (s) => {
      const rel = path.relative(src, s)
      if (rel === '') return true
      try { if (lstatSync(s).isSymbolicLink()) return false } catch { return false }
      return !skip(rel)
    },
  })
}

/** True when `target` resolves (through any existing symlink, including dangling ones) to a location strictly inside `root`. */
export function isContained(root: string, target: string): boolean {
  const realRoot = realpathSync(root)
  const abs = path.resolve(target)
  const rel = path.relative(path.resolve(root), abs)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return false
  let cur = path.resolve(root)
  for (const seg of rel.split(path.sep)) {
    cur = path.join(cur, seg)
    let st
    try { st = lstatSync(cur) } catch { return true } // does not exist yet: nothing further can be a link
    if (st.isSymbolicLink()) {
      let real: string
      try { real = realpathSync(cur) } catch { return false } // dangling link: refuse, it could be created through
      if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return false
    }
  }
  return true
}

/** Removes `target` only when it is strictly inside `root` after symlink resolution; returns false (and removes nothing) otherwise. A link itself is removed, never what it points at. */
export function removeContained(root: string, target: string, opts: { recursive?: boolean } = {}): boolean {
  let st
  try { st = lstatSync(target) } catch { return isContained(root, target) }
  // a link is removed itself (never what it points at), so what must be contained is the directory that holds it
  if (st.isSymbolicLink()) { if (!isContained(root, path.dirname(target)) && path.resolve(path.dirname(target)) !== path.resolve(root)) return false; rmSync(target, { force: true }); return true }
  if (!isContained(root, target)) return false
  rmSync(target, { force: true, recursive: opts.recursive === true })
  return true
}
