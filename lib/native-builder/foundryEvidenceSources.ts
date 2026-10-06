/**
 * Evidence source tracking. A conclusion is only as current as the files it was derived from, so each piece of job evidence records a
 * digest of its own source closure (the suite entry file and everything it imports from the project), not of the whole repository.
 * Bounded: project source roots only, never node_modules, artifacts, backups, or migration trees.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const SOURCE_ROOTS = ['lib', 'app', 'components', 'hooks', 'scripts']
const EXTENSIONS = ['.ts', '.tsx', '.mjs', '.js', '.json']

function resolveImport(root: string, from: string, spec: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = path.join(root, spec.slice(2))
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(path.join(root, from)), spec)
  else return null
  const candidates = [base, ...EXTENSIONS.map(ext => `${base}${ext}`), ...EXTENSIONS.map(ext => path.join(base, `index${ext}`))]
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) {
        const rel = path.relative(root, candidate)
        return SOURCE_ROOTS.includes(rel.split(path.sep)[0]) && !rel.startsWith('..') ? rel.split(path.sep).join('/') : null
      }
    } catch { /* try next */ }
  }
  return null
}

/** package.json script -> the project .ts entry it runs (e.g. a *.validation.ts), if it names one. */
export function suiteEntryFile(root: string, suite: string): string | null {
  try {
    const scripts = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).scripts as Record<string, string> | undefined
    const command = scripts?.[suite] ?? ''
    // The loader/runner under scripts/ is tooling; the suite's own entry is the project .ts file it runs.
    const entries = [...command.matchAll(/((?:lib|app|components)\/[\w./-]+\.(?:ts|tsx))/g)].map(item => item[1])
    return entries[entries.length - 1] ?? [...command.matchAll(/(scripts\/[\w./-]+\.(?:ts|mjs))/g)].map(item => item[1]).filter(item => !/ts-extension-loader/.test(item)).pop() ?? null
  } catch {
    return null
  }
}

/** Transitive project-local import closure of an entry file. */
export function sourceClosure(root: string, entry: string, limit = 250): string[] {
  const seen = new Set<string>()
  const queue = [entry]
  while (queue.length && seen.size < limit) {
    const file = queue.shift()!
    if (seen.has(file)) continue
    let text: string
    try { text = readFileSync(path.join(root, file), 'utf8') } catch { continue }
    seen.add(file)
    for (const match of text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+|require\s*\(\s*)['"]([^'"]+)['"]/g)) {
      const next = resolveImport(root, file, match[1])
      if (next && !seen.has(next)) queue.push(next)
    }
  }
  return [...seen].sort()
}

export function digestFiles(root: string, files: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const file of files) {
    try { out[file] = createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex').slice(0, 16) } catch { out[file] = 'MISSING' }
  }
  return out
}

/** Coarse source set for whole-project jobs (build/typecheck/lint): one fingerprint per source root, from (path,size,mtime). */
export function coarseTreeDigests(root: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const dir of SOURCE_ROOTS) {
    const hash = createHash('sha256')
    const walk = (current: string, depth: number) => {
      if (depth > 8) return
      let entries: string[]
      try { entries = readdirSync(path.join(root, current)).sort() } catch { return }
      for (const name of entries) {
        if (name === 'node_modules' || name.startsWith('.') || name === '__fixtures__') continue
        const rel = `${current}/${name}`
        let stat
        try { stat = statSync(path.join(root, rel)) } catch { continue }
        if (stat.isDirectory()) walk(rel, depth + 1)
        else if (EXTENSIONS.some(ext => name.endsWith(ext))) hash.update(`${rel}:${stat.size}:${Math.floor(stat.mtimeMs)}\n`)
      }
    }
    if (existsSync(path.join(root, dir))) walk(dir, 0)
    out[`tree:${dir}`] = hash.digest('hex').slice(0, 16)
  }
  return out
}

/** Current digest for a recorded key: a file path, or a coarse `tree:<dir>` key. */
export function currentDigest(root: string, key: string, trees: () => Record<string, string>): string {
  if (key.startsWith('tree:')) return trees()[key] ?? 'MISSING'
  return digestFiles(root, [key])[key]
}
