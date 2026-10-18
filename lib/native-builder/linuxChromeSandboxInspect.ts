/** Read-only, fail-closed Chromium helper inspection. No elevation or mutation. */
import { lstatSync, realpathSync } from 'node:fs'
import path from 'node:path'

export function inspectLinuxChromeSandboxHelper(helper: string, expectedAppTree?: string) {
  const absent = { helper, exists: false, native: false, verdict: 'PACKAGING_FIX_REQUIRED', operatorCommand: null as null }
  try {
    const st = lstatSync(helper)
    if (!st.isFile() || st.isSymbolicLink()) return { ...absent, verdict: 'UNSAFE_HELPER_TYPE' }
    const real = realpathSync(helper)
    if (expectedAppTree) {
      const root = realpathSync(expectedAppTree)
      const relative = path.relative(root, real)
      if (relative.startsWith('..') || path.isAbsolute(relative) || !relative) return { ...absent, verdict: 'HELPER_OUTSIDE_APPLICATION' }
    }
    const native = process.platform === 'linux' && st.uid === 0 && Boolean(st.mode & 0o4000)
    return { helper, exists: true, uid: st.uid, gid: st.gid, mode: (st.mode & 0o7777).toString(8), suid: Boolean(st.mode & 0o4000), rootOwned: st.uid === 0, native, verdict: native ? 'SANDBOX_NATIVE_PASS' : 'OPERATOR_REVIEW_REQUIRED', operatorCommand: null }
  } catch { return absent }
}
