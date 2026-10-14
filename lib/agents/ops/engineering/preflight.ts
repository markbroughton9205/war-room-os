/**
 * FOUNDRY FIRST-PASS CORRECTNESS LAW (part 3): implementation preflight.
 *
 * Runs on the IMPLEMENTATION, before any test is generated and before the independent verifier is spent. Everything is derived from the implementation contract and
 * the recipes; nothing is taken from the hidden verifier or from expected outputs of a particular fixture. A check whose preconditions are not met is SKIPPED (recorded),
 * never guessed, so a preflight failure is always a fact about the code.
 *
 * STATIC  : syntax, imports resolve to real files and real exports, undefined identifiers, recipe static checks (route precedence, reachable statuses, storage path,
 *           parent directory, un-awaited writes, filter values, response-shape keys, UI ids / API calls), legacy exports kept.
 * RUNTIME : on a private copy of the workspace the server is started, and the contract is exercised: it boots on PORT; every contract route is reachable with its
 *           required status; defaults and 400/404 rules; exact response shapes; flag actions; filters; data survives a restart; ids advance and are never reused;
 *           the default storage path (and its folder) is created; the existing (compat) endpoints answer.
 */
import { spawn } from 'node:child_process'
import { copyTreeNoLinks, removeContained } from './runtime/safeFs'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import ts from 'typescript'
import { type ImplementationContract, type ContractRoute, safeRelativePath } from './implContract'
import { matchRecipes, runRecipeChecks, type Recipe, type RecipeFinding } from './recipes'
import { undefinedNames, legacyStateDrift } from './staticGates'

export type PreflightFinding = { stage: 'STATIC' | 'RUNTIME'; check: string; criterion: number | null; recipe: string | null; file: string | null; symbol: string | null; fact: string; expected: string; /** a latent risk that is only a defect when a runtime check confirms it */ advisory?: boolean; /** for status findings: the route, the status the contract requires and the status the code gave (the repair loop reads these as a structured check) */ route?: string; expect?: number; got?: number }
export type PreflightReport = { findings: PreflightFinding[]; advisories: PreflightFinding[]; checked: string[]; skipped: string[]; passed: boolean; runtimeMs: number }

const IGNORE = /(^|\/)(node_modules|\.git|data|test)(\/|$)/
export function readTree(root: string, limit = 120): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const abs = path.join(dir, e), rel = path.relative(root, abs).split(path.sep).join('/')
      if (IGNORE.test(rel)) continue
      const st = statSync(abs)
      if (st.isDirectory()) walk(abs)
      else if (/\.(m?js|html?|json)$/.test(e) && st.size < 400_000 && Object.keys(out).length < limit) out[rel] = readFileSync(abs, 'utf8')
    }
  }
  walk(root)
  return out
}
const ADVISORY = new Set(['JSON_FILE_STORE.unawaited-fs'])
const toFinding = (f: RecipeFinding): PreflightFinding => ({ stage: 'STATIC', check: `${f.recipe}.${f.check}`, criterion: f.criterion, recipe: f.recipe, file: f.file, symbol: f.symbol, fact: f.fact, expected: f.expected, ...(ADVISORY.has(`${f.recipe}.${f.check}`) ? { advisory: true } : {}) })

const exportsOf = (rel: string, text: string): { names: Set<string>; star: boolean; def: boolean } => {
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.ES2022, true)
  const names = new Set<string>(); let star = false, def = false
  for (const st of sf.statements) {
    const mods = ts.canHaveModifiers(st) ? ts.getModifiers(st) : undefined
    const exp = !!mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword), isDef = !!mods?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)
    if (exp && isDef) def = true
    else if (exp && (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name) names.add(st.name.text)
    else if (exp && ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) names.add(d.name.text)
    if (ts.isExportDeclaration(st)) { if (!st.exportClause) star = true; else if (ts.isNamedExports(st.exportClause)) for (const e of st.exportClause.elements) names.add(e.name.text) }
    if (ts.isExportAssignment(st)) def = true
  }
  return { names, star, def }
}
/** Relative imports must resolve to a file in the workspace and the imported names must be exported by it. */
export function importProblems(files: Record<string, string>): PreflightFinding[] {
  const out: PreflightFinding[] = []
  for (const [rel, text] of Object.entries(files)) {
    if (!/\.m?js$/.test(rel) || /^public\//.test(rel)) continue
    const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.ES2022, true)
    for (const st of sf.statements) {
      if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || !/^\.\.?\//.test(st.moduleSpecifier.text)) continue
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), st.moduleSpecifier.text))
      if (!(target in files)) { out.push({ stage: 'STATIC', check: 'STARTUP.import-resolves', criterion: null, recipe: 'STARTUP', file: rel, symbol: null, fact: `${rel} imports ${st.moduleSpecifier.text}, which does not exist in the workspace`, expected: 'import only files that exist' }); continue }
      const ex = exportsOf(target, files[target])
      if (ex.star || !st.importClause) continue
      const nb = st.importClause.namedBindings
      if (nb && ts.isNamedImports(nb)) for (const e of nb.elements) { const n = (e.propertyName ?? e.name).text; if (!ex.names.has(n)) out.push({ stage: 'STATIC', check: 'STARTUP.import-export', criterion: null, recipe: 'STARTUP', file: rel, symbol: n, fact: `${rel} imports { ${n} } from ${st.moduleSpecifier.text}, but ${target} does not export ${n} (it exports: ${[...ex.names].slice(0, 10).join(', ') || 'nothing'})`, expected: `import only names that ${target} exports` }) }
      if (st.importClause.name && !ex.def) out.push({ stage: 'STATIC', check: 'STARTUP.import-default', criterion: null, recipe: 'STARTUP', file: rel, symbol: st.importClause.name.text, fact: `${rel} imports a default export from ${st.moduleSpecifier.text}, but ${target} has none`, expected: 'use a named import' })
    }
  }
  return out
}

export function staticPreflight(files: Record<string, string>, c: ImplementationContract, recipes: Recipe[], baseline: Record<string, string> = {}): { findings: PreflightFinding[]; checked: string[] } {
  const findings: PreflightFinding[] = []
  const checked = ['syntax', 'imports resolve', 'imported names exist', 'undefined identifiers', ...recipes.flatMap((r) => r.staticChecks.map((k) => `${r.id}.${k.id}`))]
  findings.push(...importProblems(files))
  for (const [rel, text] of Object.entries(files)) if (/\.m?js$/.test(rel) && !/^public\//.test(rel)) {
    const had = new Set(undefinedNames(rel, baseline[rel] ?? ''))
    for (const n of undefinedNames(rel, text)) if (!had.has(n)) findings.push({ stage: 'STATIC', check: 'STARTUP.undefined-identifier', criterion: null, recipe: 'STARTUP', file: rel, symbol: n, fact: `${rel} uses ${n} but never declares or imports it (fails at run time with "${n} is not defined")`, expected: `declare or import ${n}` })
  }
  findings.push(...runRecipeChecks(files, c, recipes).map(toFinding))
  for (const [rel, text] of Object.entries(files)) if (baseline[rel] !== undefined && /\.m?js$/.test(rel) && !/^public\//.test(rel)) for (const d of legacyStateDrift(rel, baseline[rel], text)) findings.push({ stage: 'STATIC', check: 'LEGACY_COMPAT.state-drift', criterion: c.compat.criteria[0] ?? null, recipe: 'LEGACY_COMPAT', file: rel, symbol: d.fn, fact: `${rel}: existing export ${d.fn}() used ${d.was} and now uses the NEW state ${d.now}`, expected: `${d.fn}() keeps using ${d.was}; add new functions for the new state` })
  return { findings, checked }
}

// ------------------------------------------------------------------ runtime

const freePort = () => new Promise<number>((resolve, reject) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)) }); s.on('error', reject) })
type Proc = { port: number; stop: () => Promise<void>; output: () => string; exited: () => boolean }
async function startServer(dir: string, entry: string, env: Record<string, string>): Promise<Proc | { error: string }> {
  if (!existsSync(dir)) return { error: `the working directory ${dir} does not exist; the server was not started` }
  const port = await freePort()
  let out = '', exited = false
  const child = spawn('node', [entry], { cwd: dir, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp', PORT: String(port), NODE_ENV: 'test', ...env } as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', (d) => { out = (out + d).slice(-3000) }); child.stderr.on('data', (d) => { out = (out + d).slice(-3000) })
  child.on('exit', () => { exited = true })
  child.on('error', (e) => { exited = true; out = (out + `\nspawn error: ${String(e)}`).slice(-3000) })
  const stop = () => new Promise<void>((resolve) => { if (exited) return resolve(); child.once('exit', () => resolve()); child.kill('SIGTERM'); setTimeout(() => { if (!exited) child.kill('SIGKILL') }, 800) })
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (exited) return { error: `the server exited before it listened on PORT=${port}: ${out.split('\n').filter((l) => /Error|error|Cannot|ENOENT|not defined|SyntaxError/.test(l)).slice(0, 3).join(' | ') || out.slice(-300)}` }
    const ok = await new Promise<boolean>((r) => { const s = net.connect(port, '127.0.0.1', () => { s.destroy(); r(true) }); s.on('error', () => r(false)) })
    if (ok) return { port, stop, output: () => out, exited: () => exited }
    await new Promise((r) => setTimeout(r, 80))
  }
  await stop()
  return { error: `the server did not listen on PORT=${port} within 5s${out ? `: ${out.slice(-240)}` : ''}` }
}
type Res = { status: number; body: unknown; raw: string }
async function http(p: Proc, method: string, url: string, body?: unknown): Promise<Res> {
  try {
    const r = await fetch(`http://127.0.0.1:${p.port}${url}`, { method, headers: body !== undefined ? { 'content-type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(4000) })
    const raw = await r.text()
    let parsed: unknown = raw; try { parsed = JSON.parse(raw) } catch { /* not json */ }
    return { status: r.status, body: parsed, raw }
  } catch (e) { return { status: 0, body: null, raw: String(e) } }
}
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null)
const successSet = (r: ContractRoute) => r.statuses.filter((s) => s < 400)
const fmt = (b: Res) => `HTTP ${b.status} ${b.raw.replace(/\s+/g, ' ').slice(0, 140)}`

export async function runtimePreflight(root: string, c: ImplementationContract, opts: { entry?: string } = {}): Promise<{ findings: PreflightFinding[]; checked: string[]; skipped: string[] }> {
  const findings: PreflightFinding[] = [], checked: string[] = [], skipped: string[] = []
  let entry = opts.entry ?? 'server.mjs'
  try { const pj = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')); const m = /node\s+(\S+)/.exec(pj?.scripts?.start ?? ''); if (m && !opts.entry) entry = m[1] } catch { /* default entry */ }
  if (!existsSync(path.join(root, entry))) return { findings, checked, skipped: [`runtime: entry ${entry} does not exist yet`] }
  const dirs: string[] = []
  const copy = () => { const d = mkdtempSync(path.join(tmpdir(), 'pf-')); dirs.push(d); copyTreeNoLinks(root, d, (rel) => /node_modules|(^|\/)\.git(\/|$)|(^|\/)data(\/|$)/.test(rel)); return d }
  const add = (check: string, criterion: number | null, fact: string, expected: string, file: string | null = entry, recipe: string | null = null, st?: { route: string; expect: number; got: number }) => findings.push({ stage: 'RUNTIME', check, criterion, recipe, file, symbol: null, fact, expected, ...(st ?? {}) })
  const procs: Proc[] = []
  try {
    // ---------- 1. boot with the storage variable pointing at a file in an existing folder
    const dir = copy()
    const env: Record<string, string> = {}
    if (c.persistence.envVar) env[c.persistence.envVar] = path.join(dir, `${c.persistence.envVar}.preflight.json`)
    checked.push('runtime.boot')
    const a = await startServer(dir, entry, env)
    if ('error' in a) { add('STARTUP.boot', c.routes[0]?.criterion ?? null, a.error, 'the entry file starts and listens on process.env.PORT', entry, 'STARTUP'); return { findings, checked, skipped } }
    procs.push(a)
    const create = c.routes.find((r) => r.createsRecord) ?? c.routes.find((r) => r.method === 'POST' && !r.params.length && !r.compat && r.statuses.some((s) => s < 400))
    const list = create ? c.routes.find((r) => r.method === 'GET' && r.path === create.path) ?? { ...create, method: 'GET' as const, statuses: [], shape: null, id: `GET ${create.path}` } : null
    // ---------- 2. compat routes (existing endpoints keep answering)
    checked.push('runtime.compat')
    for (const r of c.routes.filter((x) => x.compat && x.method === 'GET')) { const res = await http(a, 'GET', r.sample); if (res.status === 0 || res.status >= 500 || res.status === 404) add('LEGACY_COMPAT.route', r.criterion, `${r.method} ${r.path} (an existing endpoint) answered ${fmt(res)}`, 'the existing endpoint keeps answering 200', entry, 'LEGACY_COMPAT') }
    if (c.ui.ids.length) {
      checked.push('runtime.page and client scripts are served')
      const pg = await http(a, 'GET', '/')
      if (pg.status !== 200 || typeof pg.body !== 'string') add('UI.page-served', c.ui.criteria[0] ?? null, `GET / answered ${fmt(pg)}`, 'HTTP 200 with the page', entry, 'API_UI_WIRING')
      else {
        const missing = c.ui.ids.filter((i) => !new RegExp(`\\bid\\s*=\\s*["']${i}["']`).test(pg.body as string))
        if (missing.length) add('UI.page-ids', c.ui.criteria[0] ?? null, `the page served at / has no element with id ${missing.join(', ')}`, `elements ${c.ui.ids.join(', ')}`, 'public/index.html', 'API_UI_WIRING')
        for (const m of (pg.body as string).matchAll(/<script[^>]*\bsrc\s*=\s*["']([^"']+)["']/g)) { const sr = await http(a, 'GET', m[1].startsWith('/') ? m[1] : `/${m[1]}`); if (sr.status !== 200 || !sr.raw.trim()) add('UI.script-served', c.ui.criteria[0] ?? null, `the page loads ${m[1]}, but GET ${m[1]} answered ${fmt(sr)}${sr.status >= 500 ? ' (the server fails while serving it)' : ''}`, 'HTTP 200 with the script text', entry, 'API_UI_WIRING') }
      }
    }
    if (!create) { skipped.push('runtime: no record-creating POST route in the contract; item checks skipped') } else {
      const bodyFor = (over: Record<string, unknown> = {}) => { const b: Record<string, unknown> = {}; for (const f of c.fields) if (f.required) b[f.name] = 'preflight item'; if (!Object.keys(b).length) b.name = 'preflight item'; return { ...b, ...over } }
      const created: Record<string, unknown>[] = []
      const make = async () => { const r = await http(a, 'POST', create.sample, bodyFor()); return r }
      checked.push(`runtime.${create.method} ${create.path} create`)
      const first = await make()
      const fo = obj(first.body)
      const okStatuses = successSet(create)
      if (okStatuses.length ? !okStatuses.includes(first.status) : first.status < 200 || first.status >= 300) add('ROUTE.create-status', create.criterion, `${create.method} ${create.path} with a valid body answered ${fmt(first)}`, `HTTP ${okStatuses.join(' or ') || '2xx'} with the created item`, entry, 'ROUTE_ORDER')
      const idOk = (v: unknown) => (c.idNumeric ? typeof v === 'number' : c.idString ? typeof v === 'string' && v !== '' : typeof v === 'number' || (typeof v === 'string' && v !== ''))
      if (fo && idOk(fo.id)) created.push(fo)
      else if (first.status >= 200 && first.status < 300) add('ROUTE.create-id', create.criterion, `${create.method} ${create.path} answered ${fmt(first)}: the created item has no ${c.idNumeric ? 'numeric ' : c.idString ? 'string ' : ''}id (its id is ${JSON.stringify(fo?.id)})`, `the created item with ${c.idNumeric ? 'a numeric ' : c.idString ? 'a string ' : 'an '}id`, entry, 'MONOTONIC_IDS')
      if (!created.length) { skipped.push('runtime: the create route did not produce an item; the checks that depend on a record were skipped'); await a.stop(); return { findings, checked, skipped } }
      // defaults the contract states
      if (fo) for (const f of c.fields.filter((x) => x.default !== null)) if (f.name in fo ? String(fo[f.name]) !== f.default : true) add('FIELD.default', f.criterion, `the created item has ${f.name}=${JSON.stringify(fo[f.name])}; the contract requires the default ${f.default}`, `${f.name} defaults to ${f.default}`, entry, 'JSON_FILE_STORE')
      // validation rules
      if (create.statuses.includes(400)) {
        checked.push('runtime.validation 400')
        for (const f of c.fields.filter((x) => x.values.length)) { const r = await http(a, 'POST', create.sample, bodyFor({ [f.name]: '__preflight_invalid__' })); if (r.status !== 400) add('STATUS.invalid-value', f.criterion, `${create.method} ${create.path} with ${f.name}="__preflight_invalid__" answered ${fmt(r)}`, `HTTP 400 for a ${f.name} outside {${f.values.join(', ')}}`, entry, 'REST_STATUS', { route: `${create.method} ${create.path}`, expect: 400, got: r.status }) }
        for (const f of c.fields.filter((x) => x.required)) {
          // "empty" covers the empty string, whitespace only and a missing field
          const variants: [string, Record<string, unknown>][] = [['empty', bodyFor({ [f.name]: '' })], ['whitespace-only', bodyFor({ [f.name]: '   ' })], ['missing', (() => { const b = bodyFor(); delete b[f.name]; return b })()]]
          for (const [label, body] of variants) { const r = await http(a, 'POST', create.sample, body); if (r.status !== 400) { add('STATUS.empty-required', f.criterion, `${create.method} ${create.path} with a ${label} ${f.name} answered ${fmt(r)}`, `HTTP 400 for an empty, whitespace-only or missing ${f.name}`, entry, 'REST_STATUS', { route: `${create.method} ${create.path}`, expect: 400, got: r.status }); break } }
        }
      }
      // every other contract route, each on a FRESH item so that actions cannot contaminate one another
      for (const r of c.routes.filter((x) => !x.compat && x !== create && x.id !== list?.id)) {
        checked.push(`runtime.${r.method} ${r.path}`)
        let item: Record<string, unknown> | null = null
        if (r.params.length) { const m = await make(); item = obj(m.body); if (!item || !idOk(item.id)) { skipped.push(`runtime: ${r.id} needs a record but create failed`); continue }; created.push(item) }
        const url = r.sample.replace(/\/1(?=\/|$)/, `/${item?.id ?? 1}`)
        const body = r.method === 'GET' ? undefined : {}
        let res = await http(a, r.method, url, body)
        if (r.method === 'PATCH' || r.method === 'PUT') {
          const field = r.bodyField
          if (!field || !c.transitions.length || !item) { skipped.push(`runtime: ${r.id} needs a request body the contract does not give; status not probed`); continue }
          const states = [...new Set(c.transitions.flatMap((t) => [t.from, t.to]))]
          const initial = c.fields.find((f) => f.name === field)?.default ?? c.transitions[0].from
          const allowedTo = c.transitions.filter((t) => t.from === initial).map((t) => t.to)
          const illegal = states.find((st) => st !== initial && !allowedTo.includes(st))
          checked.push(`runtime.${r.method} ${r.path} transitions`)
          const move = async (to: string, label: string, want: number[], recipe = 'STATE_ACTIONS') => { const m2 = await make(); const it2 = obj(m2.body); if (!it2) return; const res2 = await http(a, r.method, r.sample.replace(/\/1(?=\/|$)/, `/${it2.id}`), { [field]: to }); if (!want.includes(res2.status)) add('STATUS.transition', r.criterion, `${r.method} ${r.sample.replace(/\/1(?=\/|$)/, `/${it2.id}`)} {"${field}":"${to}"} (${label}) answered ${fmt(res2)}`, `HTTP ${want.join(' or ')} for ${label}`, entry, recipe, { route: `${r.method} ${r.path}`, expect: want[0], got: res2.status }); else if (want[0] < 300 && obj(res2.body) && obj(res2.body)![field] !== to) add('STATE.transition-applied', r.criterion, `${r.method} ${r.path} {"${field}":"${to}"} answered ${fmt(res2)}: ${field} is not "${to}"`, `${field} = ${to}`, entry, 'STATE_ACTIONS') }
          if (allowedTo[0]) await move(allowedTo[0], `the allowed move ${initial}->${allowedTo[0]}`, successSet(r).length ? successSet(r) : [200])
          if (illegal && r.statuses.includes(409)) await move(illegal, `the forbidden move ${initial}->${illegal}`, [409], 'REST_STATUS')
          if (r.statuses.includes(400)) await move('__preflight_invalid__', 'an unknown value', [400], 'REST_STATUS')
          continue
        }
        // a route that needs a body the contract does not describe answers 400 to an empty one: that proves the route is served, not that it is wrong
        if (res.status === 400 && r.method === 'POST' && !c.flags.some((f) => f.route === r.id) && !r.shape && !r.statuses.length) { skipped.push(`runtime: ${r.id} needs a request body the contract does not describe; only reachability was proven`); continue }
        const ok = successSet(r)
        const reachable = ok.length ? ok.includes(res.status) : res.status >= 200 && res.status < 300
        // an action may be legitimately rejected by a cross-flag rule on a fresh item only if the contract lists that status for it; a fresh item is never archived
        if (!reachable) add('ROUTE.reachable', r.criterion, `${r.method} ${url} answered ${fmt(res)}`, `HTTP ${ok.join(' or ') || '2xx'}`, entry, 'ROUTE_ORDER', { route: `${r.method} ${r.path}`, expect: ok[0] ?? 200, got: res.status })
        else {
          const rb = obj(res.body)
          for (const f of c.flags.filter((x) => x.route === r.id)) if (rb && f.name in rb && rb[f.name] !== f.sets) add('STATE.flag', f.criterion, `${r.method} ${url} answered ${fmt(res)}: ${f.name} is ${JSON.stringify(rb[f.name])}`, `${f.name} = ${f.sets}`, entry, 'STATE_ACTIONS')
          if (r.shape) {
            for (const [k, t] of Object.entries(r.shape)) {
              const v = rb?.[k]
              if (rb === null || !(k in rb)) add('SHAPE.key', r.criterion, `${r.method} ${r.path} answered ${fmt(res)}: the key "${k}" is missing`, `${JSON.stringify(r.shape).replace(/"n"/g, 'n')}`, entry, 'COUNTERS_AND_SHAPES')
              else if (t === 'n' && typeof v !== 'number') add('SHAPE.type', r.criterion, `${r.method} ${r.path} answered ${fmt(res)}: "${k}" is ${typeof v === 'object' ? 'an object' : typeof v}, not a number`, `${JSON.stringify(r.shape).replace(/"n"/g, 'n')} with a numeric ${k}`, entry, 'COUNTERS_AND_SHAPES')
            }
            if (rb && Object.keys(rb).length !== Object.keys(r.shape).length) add('SHAPE.extra-keys', r.criterion, `${r.method} ${r.path} answered ${fmt(res)}: keys differ from ${Object.keys(r.shape).join(', ')}`, `exactly ${Object.keys(r.shape).join(', ')}`, entry, 'COUNTERS_AND_SHAPES')
          }
        }
        if (r.params.length && r.statuses.includes(404)) { res = await http(a, r.method, r.sample.replace(/\/1(?=\/|$)/, '/987654'), body); if (res.status !== 404) add('STATUS.unknown-id', r.criterion, `${r.method} ${r.sample.replace(/\/1(?=\/|$)/, '/987654')} (an id that does not exist) answered ${fmt(res)}`, 'HTTP 404', entry, 'REST_STATUS', { route: `${r.method} ${r.path}`, expect: 404, got: res.status }) }
      }
      // conflicts the contract states ("after <setter>, <actions> are rejected with 409") and actions the contract calls harmless to repeat
      for (const k of c.conflicts) {
        const setter = c.routes.find((r) => r.id === k.setter)
        if (!setter) continue
        checked.push(`runtime.conflict ${k.setter}`)
        const m3 = await make(); const it3 = obj(m3.body)
        if (!it3 || !idOk(it3.id)) continue
        const at = (r: ContractRoute) => r.sample.replace(/\/1(?=\/|$)/, `/${it3.id}`)
        const s1 = await http(a, setter.method, at(setter), {})
        if (s1.status < 200 || s1.status >= 300) { add('STATUS.setter', k.criterion, `${setter.method} ${at(setter)} answered ${fmt(s1)}`, 'a 2xx answer that sets the flag', entry, 'STATE_ACTIONS'); continue }
        for (const bid of k.blocked) { const br = c.routes.find((r) => r.id === bid); if (!br) continue; const bres = await http(a, br.method, at(br), {}); if (bres.status !== k.status) add('STATUS.conflict', k.criterion, `${br.method} ${at(br)} on an item after ${setter.method} ${at(setter)} (${k.flag}=true) answered ${fmt(bres)}`, `HTTP ${k.status}`, entry, 'REST_STATUS', { route: `${br.method} ${br.path}`, expect: k.status, got: bres.status }) }
        if (setter.idempotent) { const again = await http(a, setter.method, at(setter), {}); if (again.status < 200 || again.status >= 300) add('STATE.idempotent', k.criterion, `repeating ${setter.method} ${at(setter)} answered ${fmt(again)}`, 'repeating the action is harmless (2xx)', entry, 'STATE_ACTIONS') }
      }
      // counters after a known state: shaped GET routes already ran; list + filters
      if (list) {
        checked.push(`runtime.GET ${list.path} list`)
        const lr = await http(a, 'GET', list.path)
        if (lr.status !== 200 || !Array.isArray(lr.body)) add('ROUTE.list', create.criterion, `GET ${list.path} answered ${fmt(lr)}`, 'HTTP 200 with a JSON array', entry, 'ROUTE_ORDER')
        for (const f of c.filters.filter((x) => x.route === list.id || x.route === create.id || x.route === null)) for (const v of f.values) {
          checked.push(`runtime.filter ${f.param}=${v}`)
          const fr = await http(a, 'GET', `${list.path}?${f.param}=${encodeURIComponent(v)}`)
          if (fr.status !== 200 || !Array.isArray(fr.body)) { add('FILTER.value', f.criterion, `GET ${list.path}?${f.param}=${v} answered ${fmt(fr)}`, 'HTTP 200 with a JSON array', entry, 'LIST_FILTER'); continue }
          const asField = Array.isArray(fr.body) && fr.body.length && fr.body.every((it) => obj(it) && f.param in (obj(it) as object))
          if (asField) { const wrong = (fr.body as Record<string, unknown>[]).filter((it) => String(it[f.param]) !== v); if (wrong.length) add('FILTER.content', f.criterion, `GET ${list.path}?${f.param}=${v} returned ${wrong.length} item(s) whose ${f.param} is not ${v}`, `only items with ${f.param}=${v}`, entry, 'LIST_FILTER') }
        }
      }
      // ---------- 3. persistence: restart on the same file
      if (c.persistence.required && list) {
        checked.push('runtime.restart persistence')
        const before = await http(a, 'GET', list.path)
        const idsBefore = Array.isArray(before.body) ? (before.body as Record<string, unknown>[]).map((i) => i.id).filter((i): i is number | string => idOk(i)) : []
        await a.stop()
        const b = await startServer(dir, entry, env)
        if ('error' in b) add('PERSISTENCE.restart-boot', c.persistence.criteria[0] ?? null, `after a stop the server did not start again on the same data file: ${b.error}`, 'the server restarts on its existing data file', entry, 'JSON_FILE_STORE')
        else {
          procs.push(b)
          const after = await http(b, 'GET', list.path)
          const idsAfter = Array.isArray(after.body) ? (after.body as Record<string, unknown>[]).map((i) => i.id).filter((i): i is number | string => idOk(i)) : []
          const lost = idsBefore.filter((i) => !idsAfter.includes(i))
          if (idsBefore.length && lost.length) add('PERSISTENCE.survives-restart', c.persistence.criteria[0] ?? null, `before the restart GET ${list.path} listed ${idsBefore.length} item(s); after it ${idsAfter.length} (missing ids ${lost.slice(0, 5).join(', ')})`, 'all stored data survives a restart', entry, 'JSON_FILE_STORE')
          else if (idsBefore.length) {
            const fresh = await http(b, 'POST', create.sample, bodyFor())
            const nid = obj(fresh.body)?.id
            const nums = idsBefore.filter((i): i is number => typeof i === 'number')
            const maxBefore = Math.max(...nums, 0)
            if (typeof nid === 'number' && nums.length === idsBefore.length && nid <= maxBefore) add('PERSISTENCE.ids-advance', c.persistence.criteria[0] ?? null, `after the restart a new item got id ${nid}, but ids up to ${maxBefore} were already issued`, 'ids keep increasing and are never reused', entry, 'MONOTONIC_IDS')
          }
          await b.stop()
          // a COLD create: the first request after a restart creates (nothing lists the data first). Code that loads its stored data lazily, only when it is listed or changed,
          // starts counting from 1 again here and overwrites what is stored.
          if (idsBefore.length && !lost.length) {
            const cold = await startServer(dir, entry, env)
            if (!('error' in cold)) {
              procs.push(cold)
              const fresh = await http(cold, 'POST', create.sample, bodyFor())
              const nid = obj(fresh.body)?.id
              const listed = await http(cold, 'GET', list.path)
              const idsNow = Array.isArray(listed.body) ? (listed.body as Record<string, unknown>[]).map((i) => i.id).filter((i): i is number | string => idOk(i)) : []
              const numsBefore = idsBefore.filter((i): i is number => typeof i === 'number')
              const reused = idsBefore.includes(nid as number | string) || (typeof nid === 'number' && numsBefore.length === idsBefore.length && nid <= Math.max(...numsBefore, 0))
              const erased = idsBefore.filter((i) => !idsNow.includes(i))
              if (fresh.status >= 200 && fresh.status < 300 && (reused || erased.length)) add('PERSISTENCE.cold-create', c.persistence.criteria[0] ?? null, `the first request after a restart was a create (${fmt(fresh)}) ${reused ? `and it got id ${String(nid)}, an id already issued before the restart` : 'and afterwards'}${erased.length ? ` the stored item(s) ${erased.slice(0, 5).join(', ')} were gone` : ''}: the stored data is only loaded when it is listed or changed, so a create that comes first starts from an empty list`, 'the stored data is loaded before ANY operation (at startup, or at the top of every function that reads or changes it, create included), so ids continue and nothing is overwritten', entry, 'MONOTONIC_IDS')
              await cold.stop()
            }
          }
        }
      } else if (c.persistence.required) skipped.push('runtime: no list route; restart persistence skipped')
      // ---------- list semantics: a population with one item per feasible flag combination, read back through every filter value and the default view
      if ((c.filterRules.length || c.defaultViews.length) && c.flags.some((f) => f.sets) && list) {
        checked.push('runtime.list semantics')
        const flagNames = [...new Set(c.flags.filter((f) => f.sets).map((f) => f.name))].slice(0, 3)
        const setterOf = (name: string) => c.routes.find((r) => r.id === c.flags.find((f) => f.sets && f.name === name)?.route)
        const semDir = c.persistence.envVar ? dir : copy()
        const semEnv: Record<string, string> = c.persistence.envVar ? { [c.persistence.envVar]: path.join(dir, `${c.persistence.envVar}.semantics.json`) } : {}
        const sem = await startServer(semDir, entry, semEnv)
        if ('error' in sem) skipped.push(`runtime: list semantics skipped (${sem.error.slice(0, 100)})`)
        else {
          procs.push(sem)
          type Member = { id: unknown; state: Record<string, boolean> }
          const members: Member[] = []
          for (let mask = 0; mask < 1 << flagNames.length; mask++) {
            const cr = await http(sem, 'POST', create.sample, bodyFor()); const co = obj(cr.body)
            if (!co || !idOk(co.id)) continue
            const state: Record<string, boolean> = Object.fromEntries(flagNames.map((f) => [f, false]))
            let feasible = true
            for (let i = 0; i < flagNames.length && feasible; i++) if (mask & (1 << i)) {
              const st = setterOf(flagNames[i]); if (!st) { feasible = false; break }
              const res = await http(sem, st.method, st.sample.replace(/\/1(?=\/|$)/, `/${co.id}`), {})
              if (res.status >= 200 && res.status < 300) state[flagNames[i]] = true; else feasible = false
            }
            if (feasible) members.push({ id: co.id, state })
          }
          const desc = (m: Member) => `id ${String(m.id)} (${flagNames.map((f) => `${f}=${m.state[f]}`).join(', ')})`
          const compare = async (label: string, url: string, requires: { flag: string; value: boolean }[], everything: boolean, clause: string, criterion: number) => {
            const want = members.filter((m) => everything || requires.every((q) => (m.state[q.flag] ?? false) === q.value))
            const res = await http(sem, 'GET', url)
            if (res.status !== 200 || !Array.isArray(res.body)) return
            const got = new Set((res.body as Record<string, unknown>[]).map((i) => String(i.id)))
            const wantIds = new Set(want.map((m) => String(m.id)))
            const extra = members.filter((m) => got.has(String(m.id)) && !wantIds.has(String(m.id)))
            const missing = want.filter((m) => !got.has(String(m.id)))
            if (extra.length || missing.length) add('FILTER.semantics', criterion, `GET ${url} (${label}) ${extra.length ? `wrongly includes ${extra.map(desc).join(', ')}` : ''}${extra.length && missing.length ? ' and ' : ''}${missing.length ? `omits ${missing.map(desc).join(', ')}` : ''}. The contract says: "${clause}"`, `exactly the items that satisfy ${everything ? 'no restriction (every item)' : requires.map((q) => `${q.flag}=${q.value}`).join(' and ')}`, entry, 'LIST_FILTER')
          }
          for (const dv of c.defaultViews) await compare('default view', list.path, dv.requires, false, dv.clause, dv.criterion)
          for (const fr of c.filterRules) await compare(`${fr.param}=${fr.value}`, `${list.path}?${fr.param}=${encodeURIComponent(fr.value)}`, fr.requires, fr.everything, fr.clause, fr.criterion)
          await sem.stop()
        }
      }
    }
    await a.stop()
    // ---------- 4. default storage path under a fresh working directory (no env override)
    if (c.persistence.required && c.persistence.defaultPath && create) {
      checked.push('runtime.default storage path')
      const d2 = copy()
      // containment: the default path is removed only when it stays strictly inside the private copy, and the copy itself is never removed
      const rel = safeRelativePath(c.persistence.defaultPath)
      const target = rel ? path.join(d2, rel) : null
      const inside = (t: string) => { const r = path.relative(d2, t); return !!r && !r.startsWith('..') && !path.isAbsolute(r) }
      if (!target || !inside(target)) { skipped.push(`runtime: default storage path "${c.persistence.defaultPath}" is not a path inside the workspace; the default-path probe was not run`) }
      else {
      removeContained(d2, target)
      const parent = path.dirname(target); if (parent !== d2 && inside(parent)) removeContained(d2, parent, { recursive: true })
      const p2 = await startServer(d2, entry, {})
      if ('error' in p2) add('PERSISTENCE.default-boot', c.persistence.criteria[0] ?? null, `without ${c.persistence.envVar ?? 'a storage variable'} the server does not start: ${p2.error}`, 'the server starts with the default storage path', entry, 'JSON_FILE_STORE')
      else {
        procs.push(p2)
        const r = await http(p2, 'POST', create.sample, (() => { const b: Record<string, unknown> = {}; for (const f of c.fields) if (f.required) b[f.name] = 'preflight item'; if (!Object.keys(b).length) b.name = 'preflight item'; return b })())
        await new Promise((res) => setTimeout(res, 150))
        const file = path.join(d2, c.persistence.defaultPath)
        if (!existsSync(file)) add('PERSISTENCE.default-path', c.persistence.criteria[0] ?? null, `with no ${c.persistence.envVar ?? 'storage variable'}, a create (${fmt(r)}) did not produce ${c.persistence.defaultPath} under the working directory${/ENOENT/.test(p2.output()) ? ' (the server reported ENOENT: the folder does not exist)' : ''}`, `${c.persistence.defaultPath} is created, including its folder`, entry, 'JSON_FILE_STORE')
        await p2.stop()
      }
      }
    }
  } catch (e) { skipped.push(`runtime: preflight aborted (${String(e).slice(0, 120)})`) } finally {
    for (const p of procs) await p.stop().catch(() => undefined)
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
  }
  return { findings, checked, skipped }
}

export async function runPreflight(root: string, c: ImplementationContract, opts: { recipes?: Recipe[]; baseline?: Record<string, string>; entry?: string; runtime?: boolean } = {}): Promise<PreflightReport> {
  const t0 = Date.now()
  const recipes = opts.recipes ?? matchRecipes(c)
  const files = readTree(root)
  const st = staticPreflight(files, c, recipes, opts.baseline)
  let rt: { findings: PreflightFinding[]; checked: string[]; skipped: string[] } = { findings: [], checked: [], skipped: ['runtime preflight disabled'] }
  // a file that does not even parse cannot be started: the static finding already says everything the runtime would
  if (opts.runtime !== false && !st.findings.some((f) => f.check === 'STARTUP.syntax' || f.check === 'STARTUP.import-resolves' || f.check === 'STARTUP.import-export')) rt = await runtimePreflight(root, c, { entry: opts.entry })
  else if (opts.runtime !== false) rt.skipped = ['runtime: skipped because a static finding (syntax or imports) already prevents the server from starting']
  const all = [...st.findings, ...rt.findings]
  // a latent risk becomes a defect once a runtime persistence check confirms the symptom
  const confirmed = rt.findings.some((f) => f.recipe === 'JSON_FILE_STORE' || f.recipe === 'MONOTONIC_IDS')
  const findings = all.filter((f) => !f.advisory || confirmed).map((f) => (f.advisory ? { ...f, advisory: false } : f))
  const advisories = all.filter((f) => f.advisory && !confirmed)
  return { findings, advisories, checked: [...st.checked, ...rt.checked], skipped: rt.skipped, passed: findings.length === 0, runtimeMs: Date.now() - t0 }
}

/** TAP-style failure text in the shape the repair loop already understands: a check name and the structured fact, never a log dump. */
/** The request fell through to the dispatcher's generic "not found": the route's path test does not match the real pathname (not a wrong status chosen by a handler). */
export const isFallThrough = (f: PreflightFinding): boolean => f.stage === 'RUNTIME' && f.got === 404 && f.expect !== 404 && /"error"\s*:\s*"not found"/.test(f.fact)
export function preflightTap(report: PreflightReport): string {
  if (!report.findings.length) return `ok 1 - implementation preflight\n# tests ${report.checked.length}\n# pass ${report.checked.length}\n# fail 0\n`
  // a status finding is written the way the repair loop's evidence builder reads a failing check: the required status in the name, the observed one as status=NNN
  const lines = report.findings.map((f, i) => {
    const name = isFallThrough(f) && f.route ? `${f.route} is not matched by the dispatcher [${f.check}]` : f.route && f.expect ? `${f.route} must answer ${f.expect} (${f.expect}) [${f.check}]` : `${f.fact.split(/[:(]/)[0].slice(0, 90)} [${f.check}]`
    const msg = f.route && f.got !== undefined ? `status=${f.got} ${f.fact}` : f.fact
    return `not ok ${i + 1} - ${name}\n  message: ${msg}\n  contract: ${f.criterion ? `C${f.criterion}` : 'n/a'}${f.file ? ` file: ${f.file}` : ''}${f.symbol ? ` symbol: ${f.symbol}` : ''}\n  expected: ${f.expected}\n`
  })
  return `${lines.join('')}# tests ${report.findings.length}\n# pass 0\n# fail ${report.findings.length}\n`
}
export const preflightFacts = (report: PreflightReport, cap = 2200): string => report.findings.map((f) => `- [${f.check}]${f.criterion ? ` C${f.criterion}` : ''}${f.file ? ` ${f.file}` : ''}${f.symbol ? ` ${f.symbol}` : ''}: ${f.fact}. EXPECTED: ${f.expected}`).join('\n').slice(0, cap)
export const ensureDir = (d: string) => mkdirSync(d, { recursive: true })

/** Relative modules an entry file imports (domain/storage files it depends on), in import order. */
export const localImports = (entryText: string, entryPath: string): string[] => [...entryText.matchAll(/from\s+['"](\.\.?\/[^'"]+)['"]/g)].map((m) => path.posix.normalize(path.posix.join(path.posix.dirname(entryPath), m[1])))

/**
 * Falsifiable hypotheses for the repair loop, one per preflight finding: what was observed, where the cause most likely lives, and what exactly to change.
 * The files are limited to the entry file and the modules it imports; the repair loop acts on one hypothesis per attempt and drops a refuted one.
 */
export function preflightHypotheses(findings: PreflightFinding[], entry: string, entryText: string): { check: string; statement: string; files: string[] }[] {
  const imports = localImports(entryText, entry).filter((f) => !/^public\//.test(f))
  const domain = imports.slice(0, 2)
  const fall = findings.filter(isFallThrough)
  const fallList = [...new Set(fall.map((f) => f.route ?? f.fact.slice(0, 60)))]
  return findings.map((f) => {
    const id = f.check
    const obs = f.fact.slice(0, 220)
    let statement: string, files: string[]
    if (isFallThrough(f)) { statement = `${obs}. The dispatcher in ${entry} falls through to its generic "not found" for ${fallList.length} route(s): ${fallList.join('; ')}. The path test of each of them does not match the real pathname. Match every route with an ANCHORED REGEX on url.pathname (for example /^\\/api\\/x\\/(\\d+)\\/(start|stop)$/) instead of split('/') index arithmetic, which silently skips segments; fix those path tests only and leave every other route untouched.`; files = [entry] }
    else if (id === 'ROUTE.reachable' && f.got === 404) { statement = `${obs}. The dispatcher in ${entry} falls through to its generic "not found" for this request: the path test for this route does not match the real pathname (check the segment indexes after split('/'): every leading segment of the path counts, so an id or action sits at a later index than it looks; or use a regex on url.pathname). Fix ONLY that route's path test; do not touch the other routes.`; files = [entry] }
    else if (id === 'ROUTE.reachable' || id === 'ROUTE.list' || id === 'ROUTE.create-status') { statement = `${obs}. The handler for this route in ${entry} (or the function it calls) throws or answers the wrong status for a valid request.`; files = [entry, ...domain] }
    else if (id.startsWith('UI.')) { statement = `${obs}. The code that serves the page or its script in ${entry} is wrong (check the file path, the encoding argument of readFileSync, and the content type).`; files = [entry] }
    else if (id.startsWith('STATUS.') || id === 'STATE.idempotent') { statement = `${obs}. The status for this case is decided by the domain function (it must throw an error carrying the contract status) and by the handler's catch block (it must answer err.status). Required: ${f.expected}.`; files = [...domain, entry] }
    else if (id.startsWith('SHAPE.') || id.startsWith('FIELD.') || id.startsWith('FILTER.') || id.startsWith('STATE.') || id.startsWith('PERSISTENCE.')) { statement = `${obs}. The function that computes this result (in ${domain.join(' or ') || entry}) returns the wrong value; the handler only forwards it. Required: ${f.expected}.`; files = [...domain, entry] }
    else { statement = `${obs}. Required: ${f.expected}.`; files = f.file ? [f.file] : [entry] }
    return { check: id, statement, files }
  })
}
