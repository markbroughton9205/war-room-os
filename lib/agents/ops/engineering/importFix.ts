import path from 'node:path'

/**
 * Deterministic repair of module specifiers that point at nothing. A model writing a test or a component often knows WHICH module to import but not the exact relative path
 * or extension (`../../lib/x.js` for `lib/x.mjs`, `@/lib/x` for `lib/x.mjs`). When a specifier resolves to no workspace file and exactly one file matches its trailing path
 * (ignoring the extension), the specifier is rewritten to that file. Anything ambiguous or unmatched is left alone for the normal repair loop. Pure: no I/O.
 */
const EXTS = ['.mjs', '.js', '.cjs', '.ts', '.tsx', '.jsx', '.json']
const stripExt = (p: string) => p.replace(/\.(m?js|cjs|tsx?|jsx|json)$/, '')
export type ImportFix = { from: string; to: string }

const SPEC = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(['"])((?:\.{1,2}\/|@\/)[^'"\n]+)\2/g

export function fixImports(file: string, content: string, files: string[]): { content: string; fixes: ImportFix[] } | null {
  const set = new Set(files)
  const exists = (p: string) => set.has(p) || EXTS.some((e) => set.has(p + e)) || EXTS.some((e) => set.has(`${p}/index${e}`))
  const fixes: ImportFix[] = []
  const dir = path.posix.dirname(file)
  const out = content.replace(SPEC, (all, pre: string, q: string, spec: string) => {
    const alias = spec.startsWith('@/')
    const resolved = alias ? spec.slice(2) : path.posix.normalize(path.posix.join(dir, spec))
    if (!resolved.startsWith('..') && exists(resolved)) {
      // resolves already; the only repair is an alias or relative specifier that omits an extension the bundler/node will not infer for .mjs
      return all
    }
    const tail = stripExt(spec.replace(/^(\.{1,2}\/)+/, '').replace(/^@\//, ''))
    const cands = files.filter((f) => { const s = stripExt(f); return s === tail || s.endsWith('/' + tail) })
    if (cands.length !== 1) return all
    const target = cands[0]
    let next: string
    if (alias) next = '@/' + target
    else { const rel = path.posix.relative(dir, target); next = rel.startsWith('.') ? rel : './' + rel }
    if (next === spec) return all
    fixes.push({ from: spec, to: next })
    return `${pre}${q}${next}${q}`
  })
  return fixes.length ? { content: out, fixes } : null
}

/** Alias/relative specifiers that resolve only by guessing an extension (valid for tsc's bundler resolution of .ts, not for .mjs): `@/lib/x` -> `@/lib/x.mjs` when only x.mjs exists. */
export function addMissingMjsExtension(content: string, files: string[]): { content: string; fixes: ImportFix[] } | null {
  const set = new Set(files)
  const fixes: ImportFix[] = []
  const out = content.replace(SPEC, (all, pre: string, q: string, spec: string) => {
    if (!spec.startsWith('@/') || /\.(m?js|cjs|tsx?|jsx|json)$/.test(spec)) return all
    const base = spec.slice(2)
    if (EXTS.some((e) => e !== '.mjs' && set.has(base + e)) || set.has(`${base}/index.ts`)) return all
    if (!set.has(base + '.mjs')) return all
    fixes.push({ from: spec, to: spec + '.mjs' })
    return `${pre}${q}${spec}.mjs${q}`
  })
  return fixes.length ? { content: out, fixes } : null
}
