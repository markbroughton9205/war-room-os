import ts from 'typescript'
import { execFile } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * Generic persistence contract. For any feature whose acceptance criteria claim persistence:
 *   persisted entity (module-level collection) -> write path (fs write) -> read path (fs read) -> storage location (env var / default path)
 * Static analysis finds the contract violations BEFORE a file is written; a dynamic round-trip probe (create -> read -> fresh process -> read) proves it on the real module.
 * Nothing here knows an entity or field name: it works from the code's own structure and the acceptance text.
 */
export const wantsPersistence = (acceptance: string[]) => acceptance.some((a) => /persist|survive|restart|durable|\bon disk\b|\bto disk\b/i.test(a))
export const storageEnvVars = (acceptance: string[]): string[] => [...new Set(acceptance.flatMap((a) => [...a.matchAll(/\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_(?:FILE|PATH|DIR|DB|STORE))\b/g)].map((m) => m[1])))]

const WRITE = /^(writeFileSync|writeFile|appendFileSync|appendFile|renameSync|rename|createWriteStream|writeSync)$/
const MUTATE = /^(push|unshift|splice|pop|shift|set|delete|add|clear|sort|reverse|fill|assign)$/

export type StorageFacts = {
  file: string
  collections: string[]
  writers: string[]
  mutators: { fn: string; collection: string; persists: boolean }[]
  readsFs: boolean
  envReads: string[]
}
const isSource = (p: string) => /\.m?js$/.test(p) && !/^(test|node_modules|public)\//.test(p)

export function storageFacts(file: string, text: string): StorageFacts {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true)
  const collections = new Set<string>()
  for (const st of sf.statements) if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrayLiteralExpression(d.initializer) || ts.isObjectLiteralExpression(d.initializer) || ts.isNewExpression(d.initializer) || ts.isCallExpression(d.initializer) || ts.isAwaitExpression(d.initializer))) collections.add(d.name.text)
  type Fn = { name: string; body: ts.Node }
  const fns: Fn[] = []
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name && st.body) fns.push({ name: st.name.text, body: st.body })
    else if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) fns.push({ name: d.name.text, body: d.initializer.body })
  }
  const calleeName = (e: ts.Expression): string | null => (ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : null)
  const rootId = (e: ts.Node): string | null => { let n: ts.Node = e; while (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n) || ts.isCallExpression(n) || ts.isNonNullExpression(n) || ts.isParenthesizedExpression(n)) n = ts.isCallExpression(n) ? n.expression : (n as ts.PropertyAccessExpression).expression; return ts.isIdentifier(n) ? n.text : null }
  const direct = new Map<string, { writes: boolean; calls: Set<string>; muts: Set<string> }>()
  for (const f of fns) {
    const info = { writes: false, calls: new Set<string>(), muts: new Set<string>() }
    const alias = new Map<string, string>()
    const walk = (n: ts.Node) => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) { const r = rootId(n.initializer); if (r && collections.has(r)) alias.set(n.name.text, r); else if (r && alias.has(r)) alias.set(n.name.text, alias.get(r)!) }
      if (ts.isCallExpression(n)) {
        const nm = calleeName(n.expression)
        if (nm) { if (WRITE.test(nm)) info.writes = true; info.calls.add(nm) }
        if (ts.isPropertyAccessExpression(n.expression) && MUTATE.test(n.expression.name.text)) { const r = rootId(n.expression.expression); const c = r ? (collections.has(r) ? r : alias.get(r)) : undefined; if (c) info.muts.add(c) }
      }
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) { const r = rootId(n.left); const c = r ? (collections.has(r) && (ts.isIdentifier(n.left) ? false : true) ? r : alias.get(r)) : undefined; if (c && !ts.isIdentifier(n.left)) info.muts.add(c); if (ts.isIdentifier(n.left) && collections.has(n.left.text)) info.muts.add(n.left.text) }
      ts.forEachChild(n, walk)
    }
    walk(f.body)
    direct.set(f.name, info)
  }
  const reaches = (name: string, seen = new Set<string>()): boolean => { if (seen.has(name)) return false; seen.add(name); const d = direct.get(name); if (!d) return false; if (d.writes) return true; return [...d.calls].some((c) => direct.has(c) && reaches(c, seen)) }
  const readsFsIn = (body: ts.Node) => /\b(readFileSync|readFile|existsSync)\b/.test(body.getText(sf))
  const writers = fns.filter((f) => direct.get(f.name)!.writes).map((f) => f.name)
  const loader = (f: Fn) => /^(load|read|init|reload|hydrate|restore|reset|bootstrap|seed)/i.test(f.name) || readsFsIn(f.body)
  const mutators = fns.filter((f) => !loader(f)).flatMap((f) => [...direct.get(f.name)!.muts].map((c) => ({ fn: f.name, collection: c, persists: reaches(f.name) })))
  return { file, collections: [...collections], writers, mutators, readsFs: /\b(readFileSync|readFile|existsSync|createReadStream)\b/.test(text), envReads: [...text.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]) }
}

/** Contract violations in the proposed file set (only meaningful when the acceptance criteria claim persistence). */
export function persistenceProblems(files: Record<string, string>, acceptance: string[]): string[] {
  if (!wantsPersistence(acceptance)) return []
  const facts = Object.entries(files).filter(([p]) => isSource(p)).map(([p, t]) => storageFacts(p, t))
  const stores = facts.filter((f) => f.writers.length || f.readsFs)
  const problems: string[] = []
  for (const s of stores) {
    const byColl = new Map<string, typeof s.mutators>()
    for (const m of s.mutators) byColl.set(m.collection, [...(byColl.get(m.collection) ?? []), m])
    for (const [coll, ms] of byColl) if (ms.some((m) => m.persists)) for (const m of ms.filter((x) => !x.persists)) problems.push(`write path: ${s.file} ${m.fn}() changes the persisted collection ${coll} but never reaches a file write, while ${ms.filter((x) => x.persists).map((x) => x.fn).slice(0, 3).join(', ')} does: a change made by ${m.fn}() is lost on restart. Call the same save routine after the change.`)
  }
  const all = facts.flatMap((f) => f.envReads)
  const writes = facts.some((f) => f.writers.length)
  if (writes) for (const v of storageEnvVars(acceptance)) if (!all.includes(v)) problems.push(`storage location: the acceptance criteria name ${v} as the data file location but no file reads process.env.${v}`)
  if (writes && !facts.some((f) => f.readsFs)) problems.push('read path: the code writes data to disk but no file ever reads it back, so nothing survives a restart')
  return problems
}

export type PersistenceProbe = { verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE'; detail: string; module?: string }
const CREATE = /^(create|add|push|save|append|insert|record|store|post|register|log)/i
const GETTER = /^(all|list|get[A-Z]\w*|read\w*|find\w*|load\w*|count\w*|summary|summarize)/i
const SCRIPT = `
import { pathToFileURL } from 'node:url'
const [file, phase, argsJson] = process.argv.slice(1)
const skip = new Set(JSON.parse(process.env.PROBE_SKIP || '[]'))
const mod = await import(pathToFileURL(file).href)
const out = { created: null, snap: {} }
const shapes = argsJson ? [JSON.parse(argsJson)] : [['probe'], [{ name: 'probe', title: 'probe', text: 'probe', severity: 'info', author: 'probe' }], ['probe', 'probe'], [{ text: 'probe' }], [{ title: 'probe' }], [{ name: 'probe' }]]
const isFn = (k) => typeof mod[k] === 'function' && !skip.has(k)
if (phase === '1') {
  for (const k of Object.keys(mod).filter((k) => isFn(k) && ${CREATE}.test(k))) {
    for (const a of shapes) { try { await mod[k](...a); out.created = { fn: k, args: a }; break } catch {} }
    if (out.created) break
  }
}
for (const k of Object.keys(mod).filter((k) => isFn(k) && mod[k].length === 0 && ${GETTER}.test(k))) { try { out.snap[k] = JSON.stringify(await mod[k]()) } catch (e) { out.snap[k] = 'THROWS ' + String(e.message).slice(0, 60) } }
console.log('PROBE ' + JSON.stringify(out))
`
const runNode = (cwd: string, args: string[], env: Record<string, string>) => new Promise<string>((resolve) => execFile('node', ['--input-type=module', '-e', SCRIPT, ...args], { cwd, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp', ...env } as unknown as NodeJS.ProcessEnv, timeout: 15_000 }, (_e, stdout) => resolve(String(stdout))))
const parse = (s: string) => { const m = /PROBE (\{.*\})/.exec(s); try { return m ? JSON.parse(m[1]) as { created: { fn: string; args: unknown[] } | null; snap: Record<string, string> } : null } catch { return null } }
/** Round trip on the real storage module: create, read, then a FRESH process re-imports it and must read the same data back. Works on a private copy; never touches the workspace. */
export async function persistenceProbe(root: string, acceptance: string[], files: string[], legacyNames: string[] = []): Promise<PersistenceProbe> {
  if (!wantsPersistence(acceptance)) return { verdict: 'INCONCLUSIVE', detail: 'the acceptance criteria do not claim persistence' }
  const candidates = files.filter((p) => isSource(p) && existsSync(path.join(root, p)) && storageFacts(p, readFileSync(path.join(root, p), 'utf8')).writers.length)
  if (!candidates.length) return { verdict: 'INCONCLUSIVE', detail: 'no module writes data to disk yet' }
  for (const rel of candidates) {
    const dir = mkdtempSync(path.join(tmpdir(), 'persist-probe-'))
    try {
      cpSync(root, dir, { recursive: true, filter: (s) => !/node_modules/.test(s) })
      const env: Record<string, string> = { ...Object.fromEntries(storageEnvVars(acceptance).map((v) => [v, path.join(dir, `${v}.json`)])), PROBE_SKIP: JSON.stringify(legacyNames) }
      const target = path.join(dir, rel)
      const p1 = parse(await runNode(dir, [target, '1'], env))
      if (!p1) continue
      if (!p1.created) continue
      const p2 = parse(await runNode(dir, [target, '2'], env))
      if (!p2) return { verdict: 'FAIL', detail: `${rel}: a fresh process could not import the module after ${p1.created.fn}() ran`, module: rel }
      const differ = Object.keys(p1.snap).filter((k) => p1.snap[k] !== p2.snap[k])
      if (differ.length) return { verdict: 'FAIL', detail: `${rel}: after ${p1.created.fn}(${JSON.stringify(p1.created.args).slice(0, 60)}) ${differ.slice(0, 3).map((k) => `${k}() returned ${p1.snap[k].slice(0, 80)} before the restart and ${p2.snap[k].slice(0, 80)} after`).join('; ')}`, module: rel }
      return { verdict: 'PASS', detail: `${rel}: ${p1.created.fn}() then a fresh process read back identical data from ${Object.keys(p1.snap).join(', ') || 'no getter'}`, module: rel }
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }
  return { verdict: 'INCONCLUSIVE', detail: 'no NEW function accepted a recognisable create call (functions that existed before the change are not probed: their persistence is not part of the contract)' }
}
