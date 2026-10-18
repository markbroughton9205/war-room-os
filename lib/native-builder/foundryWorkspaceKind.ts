import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

/** The War Room product tree keeps its own conventions (bounded index, scripts/foundry tests); any other workspace is an ordinary project. */
export function isWarRoomSourceTree(root: string): boolean {
  return existsSync(path.join(root, 'lib', 'native-builder')) && existsSync(path.join(root, 'app', 'api'))
}

const TEST_FILE = /(^|\/)[^/]+\.(test|spec)\.(mjs|cjs|js|ts)$/
const SKIP_DIRS = new Set(['node_modules', '.git', '.war-room', 'dist', 'build', '.next'])

/** Every test file of an ordinary project (bounded walk), workspace-relative. */
export function projectTestFiles(root: string, limit = 200): string[] {
  const found: string[] = []
  const walk = (dir: string, depth: number) => {
    if (depth > 4 || found.length >= limit) return
    let entries: import('node:fs').Dirent[]
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (found.length >= limit) break
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) walk(full, depth + 1) } else if (TEST_FILE.test(full)) found.push(path.relative(root, full).split(path.sep).join('/'))
    }
  }
  walk(root, 0)
  return found
}

/** A project that has neither an eslint nor a tsc to run: its own tests are the only regression evidence it can give. */
export function projectHasNoStaticTooling(root: string): boolean {
  return !existsSync(path.join(root, 'node_modules', '.bin', 'eslint')) && !existsSync(path.join(root, 'node_modules', '.bin', 'tsc'))
}
