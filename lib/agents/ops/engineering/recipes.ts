/**
 * FOUNDRY FIRST-PASS CORRECTNESS LAW (part 2): proven engineering recipes and the implementation plan.
 *
 * A recipe is NOT model prose. It is a record of: when it applies (matched against the implementation contract), its prerequisites, the implementation structure,
 * the invariants that must hold, the failure modes seen in real Foundry runs (each tied to a Foundry lesson class or validator that proved it), executable
 * static checks over the proposed file set, and the verification checks the preflight runs. When a recipe matches, the builder is given its structure instead of
 * being left to re-invent it, and its static checks run BEFORE any code is written and again before any test is generated.
 */
import ts from 'typescript'
import { type ImplementationContract } from './implContract'
import { routeFindings, routeTable, statusReachability, contractRouteProblems, syntaxProblems } from './staticGates'
import { mapCatchStatus } from './errorStatus'
import { repairMissingStorageDir } from './testPlan'

export type Files = Record<string, string>
export type RecipeFinding = { recipe: string; check: string; criterion: number | null; file: string | null; symbol: string | null; fact: string; expected: string }
export type Recipe = {
  id: string
  title: string
  /** where the pattern was proven: a Foundry lesson class, a validator or a real run */
  provenBy: string[]
  matches: (c: ImplementationContract) => boolean
  /** the layers whose builder prompt carries this recipe */
  layers: ('storage' | 'domain' | 'api' | 'ui')[]
  prerequisites: string[]
  structure: (c: ImplementationContract) => string[]
  /** the compact form carried in builder prompts (the full structure stays in the plan record); falls back to the structure */
  brief?: (c: ImplementationContract) => string
  invariants: string[]
  failureModes: string[]
  staticChecks: { id: string; describe: string; run: (files: Files, c: ImplementationContract) => RecipeFinding[] }[]
  verificationChecks: string[]
}

const isSource = (p: string) => /\.m?js$/.test(p) && !/^(test|node_modules|public)\//.test(p)
const sources = (files: Files) => Object.entries(files).filter(([p]) => isSource(p))
const parse = (p: string, t: string) => ts.createSourceFile(p, t, ts.ScriptTarget.ES2022, true)
const find = (rec: string, check: string, f: Omit<RecipeFinding, 'recipe' | 'check'>): RecipeFinding => ({ recipe: rec, check, ...f })

/** Async fs functions (node:fs/promises) that a module calls without awaiting: a fire-and-forget write is lost when the process is restarted right after the request. */
export function unawaitedFsCalls(file: string, text: string): { fn: string; line: number }[] {
  const sf = parse(file, text)
  const promisesNames = new Set<string>()
  const promisesNs = new Set<string>()
  for (const st of sf.statements) if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && /^(?:node:)?fs\/promises$/.test(st.moduleSpecifier.text) && st.importClause) {
    const nb = st.importClause.namedBindings
    if (nb && ts.isNamedImports(nb)) for (const e of nb.elements) promisesNames.add((e.propertyName ?? e.name).text === 'writeFile' || /^(?:writeFile|appendFile|rename|mkdir|rm|unlink|copyFile)$/.test((e.propertyName ?? e.name).text) ? e.name.text : '')
    if (nb && ts.isNamespaceImport(nb)) promisesNs.add(nb.name.text)
    if (st.importClause.name) promisesNs.add(st.importClause.name.text)
  }
  promisesNames.delete('')
  if (!promisesNames.size && !promisesNs.size) return []
  const asyncFns = new Map<string, boolean>() // name -> directly reaches a promise-returning fs write
  const fnBodies: { name: string; node: ts.Node; isAsync: boolean }[] = []
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name && st.body) fnBodies.push({ name: st.name.text, node: st.body, isAsync: !!st.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) })
    if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) fnBodies.push({ name: d.name.text, node: d.initializer.body, isAsync: !!d.initializer.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) })
  }
  const callsPromiseFs = (n: ts.Node): boolean => {
    let hit = false
    const walk = (x: ts.Node) => {
      if (ts.isCallExpression(x)) {
        const e = x.expression
        if (ts.isIdentifier(e) && promisesNames.has(e.text)) hit = true
        if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && promisesNs.has(e.expression.text) && /^(?:writeFile|appendFile|rename|mkdir|rm|unlink|copyFile)$/.test(e.name.text)) hit = true
      }
      ts.forEachChild(x, walk)
    }
    walk(n); return hit
  }
  for (const f of fnBodies) if (f.isAsync && callsPromiseFs(f.node)) asyncFns.set(f.name, true)
  // transitive: an async function that awaits one of those also returns a pending write
  for (let i = 0; i < 3; i++) for (const f of fnBodies) if (f.isAsync && !asyncFns.has(f.name)) { let reaches = false; const w = (x: ts.Node) => { if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && asyncFns.has(x.expression.text)) reaches = true; ts.forEachChild(x, w) }; w(f.node); if (reaches) asyncFns.set(f.name, true) }
  if (!asyncFns.size) return []
  const out: { fn: string; line: number }[] = []
  const walk = (x: ts.Node) => {
    if (ts.isExpressionStatement(x)) {
      let e: ts.Expression = x.expression
      // x().catch(...) / x().then(...) do not await the write either
      while (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression) && /^(?:catch|then|finally)$/.test(e.expression.name.text)) e = e.expression.expression
      if (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && asyncFns.has(e.expression.text)) out.push({ fn: e.expression.text, line: sf.getLineAndCharacterOfPosition(x.getStart()).line + 1 })
    }
    ts.forEachChild(x, walk)
  }
  walk(sf)
  return out
}

/** True when a file with a persistence write also creates folders (mkdir) with recursive: true, or derives the folder from the file path. */
const createsParentDir = (text: string) => /\bmkdir(?:Sync|p)?\s*\([\s\S]{0,200}?recursive\s*:\s*true/.test(text) || /\bmkdir(?:Sync)?\s*\(\s*(?:dirname|path\.dirname)\(/.test(text)

export const RECIPES: Recipe[] = [
  {
    id: 'JSON_FILE_STORE',
    title: 'JSON file persistence with a configurable path and a cwd-relative default',
    provenBy: ['lesson MISSING_FILE', 'lesson ESM_COMMONJS_MIX', 'repairMissingStorageDir (alert run, ENOENT on data/)', 'persistenceContract probe', 'validate:agent-eng-testplan P69-P71, P83s-P90s'],
    matches: (c) => c.persistence.required,
    layers: ['storage', 'domain'],
    prerequisites: ['ES module storage file that owns the in-memory collection(s)', 'the contract names the storage variable and/or the default path'],
    brief: (c) => `Persist with SYNCHRONOUS fs: file = process.env.${c.persistence.envVar ?? 'DATA_FILE'} || join(process.cwd(), ${(c.persistence.defaultPath ?? 'data/store.json').split('/').map((x) => JSON.stringify(x)).join(', ')}); load it once at module start (existsSync then JSON.parse, else empty state); save() = mkdirSync(dirname(file), { recursive: true }) then writeFileSync; EVERY function that changes data calls save() before it returns; keep nextId in the saved state. Existing exports and the data they use stay exactly as they are: the persisted collection is a NEW collection beside them, with new exports.`,
    structure: (c) => {
      const v = c.persistence.envVar ?? 'DATA_FILE', d = c.persistence.defaultPath ?? 'data/store.json'
      return [
        `1. import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'; import { dirname, join } from 'node:path' (synchronous fs: no fire-and-forget writes, no load race).`,
        `2. function dataFile() { return process.env.${v} || join(process.cwd(), ${d.split('/').map((s) => JSON.stringify(s)).join(', ')}) }  — read the variable on every call so each test/server instance uses its own file.`,
        `3. function load(): if existsSync(dataFile()) parse it, else return the empty state. State = { items: [...], nextId: <number> } (or the module's own collection plus the id counter).`,
        `4. function save(): mkdirSync(dirname(dataFile()), { recursive: true }) THEN writeFileSync(dataFile(), JSON.stringify(state)). EVERY function that changes persisted data calls save() before returning.`,
        `5. At module load, load() once so a restarted process continues from disk. Persist the id counter in the same file.`,
      ]
    },
    invariants: ['the storage path is exactly the contract path (env variable first, then the default under process.cwd())', 'every mutating function reaches the file write', 'the parent folder of the default path is created before the first write', 'data read on start equals data written before the stop'],
    failureModes: ['default path anchored to __dirname/import.meta (outside the working directory)', 'parent folder never created (ENOENT on first write)', 'a mutator changes memory but never saves (lost on restart)', 'asynchronous load/save started and not awaited (race on restart)', 'id counter not persisted (ids reused after restart)'],
    staticChecks: [
      { id: 'parent-dir', describe: 'the folder of the default storage path is created before the file is written', run: (files, c) => {
        if (!c.persistence.defaultPath || !c.persistence.defaultPath.includes('/')) return []
        const stores = sources(files).filter(([, t]) => /\b(?:writeFileSync|writeFile)\s*\(/.test(t))
        if (!stores.length) return []
        if (stores.some(([, t]) => createsParentDir(t))) return []
        const [file] = stores[0]
        return [find('JSON_FILE_STORE', 'parent-dir', { criterion: c.persistence.criteria[0] ?? null, file, symbol: null, fact: `${file} writes the data file but nothing creates the folder ${c.persistence.defaultPath.slice(0, c.persistence.defaultPath.lastIndexOf('/'))}/ first, so the first write fails with ENOENT on a fresh working directory`, expected: `mkdirSync(dirname(<data file>), { recursive: true }) before writeFileSync` })]
      } },
      { id: 'default-path-cwd', describe: 'the default path is anchored to the working directory, not to the module', run: (files, c) => {
        if (!c.persistence.envVar) return []
        const out: RecipeFinding[] = []
        for (const [p, t] of sources(files)) { const m = new RegExp(`process\\.env\\.${c.persistence.envVar}\\s*(?:\\|\\||\\?\\?)\\s*([^\\n;]+)`).exec(t); if (m && /__dirname|__filename|import\.meta/.test(m[1])) out.push(find('JSON_FILE_STORE', 'default-path-cwd', { criterion: c.persistence.criteria[0] ?? null, file: p, symbol: null, fact: `${p} anchors the default ${c.persistence.envVar} path to the module directory`, expected: `the default is process.cwd() + '/${c.persistence.defaultPath ?? 'data/…'}'` })) }
        return out
      } },
      { id: 'unawaited-fs', describe: 'no promise-returning fs write is left un-awaited', run: (files, c) => sources(files).flatMap(([p, t]) => unawaitedFsCalls(p, t).map((u) => find('JSON_FILE_STORE', 'unawaited-fs', { criterion: c.persistence.criteria[0] ?? null, file: p, symbol: u.fn, fact: `${p}:${u.line} calls the async ${u.fn}() without awaiting it, so the write/load may not be finished when a request is answered or the process is restarted`, expected: 'use synchronous fs calls (readFileSync/writeFileSync/mkdirSync), or await the call' }))) },
    ],
    verificationChecks: ['server boots with the storage variable pointing at an empty temp file path', 'create, stop, start on the same path: the record is still listed', 'default path: a fresh working directory gets <default path> after the first create'],
  },
  {
    id: 'MONOTONIC_IDS',
    title: 'Numeric ids that increase and are never reused, also across restarts',
    provenBy: ['task fixture TASKS_FILE ids', 'alert fixture ids never reused', 'validate:agent-eng-testplan P69'],
    matches: (c) => c.persistence.idsNeverReused || (c.persistence.surviveRestart && c.fields.length > 0),
    layers: ['storage', 'domain'],
    prerequisites: ['JSON_FILE_STORE'],
    brief: () => 'id = state.nextId++ then save(); never items.length + 1; nextId is part of the saved file and survives restarts.',
    structure: () => ['Keep a numeric nextId in the persisted state; create = id = state.nextId++ then save(). Never derive the next id from items.length (it repeats after a removal) and never reset it on load; on load, nextId = max(saved nextId, max existing id + 1).'],
    invariants: ['ids are numbers', 'nextId is part of the persisted file', 'a restarted process continues after the highest id ever issued'],
    failureModes: ['nextId resets to 1 on every start', 'nextId derived from items.length', 'nextId not saved so it is lost on restart'],
    staticChecks: [
      { id: 'id-from-length', describe: 'ids are not derived from the collection length', run: (files, c) => sources(files).filter(([, t]) => /\bid\s*:\s*[\w.]+\.length\s*\+\s*1\b/.test(t)).map(([p]) => find('MONOTONIC_IDS', 'id-from-length', { criterion: c.persistence.criteria[0] ?? null, file: p, symbol: null, fact: `${p} issues ids as <collection>.length + 1, which repeats an id when the collection shrinks or is reloaded`, expected: 'a persisted nextId counter' })) },
    ],
    verificationChecks: ['create two, restart, create one: its id is greater than both'],
  },
  {
    id: 'REST_STATUS',
    title: 'HTTP statuses carried by domain errors and answered by the handler',
    provenBy: ['errorStatus.ts', 'attachContractStatuses (P72)', 'statusReachability gate', 'lesson ASSERTION on 404/409'],
    matches: (c) => c.errors.length > 0 || c.statuses.some((s) => s.status >= 400),
    layers: ['domain', 'api'],
    prerequisites: ['a request dispatcher in the entry file'],
    brief: (c) => `Domain functions THROW errors that carry their HTTP status (throw Object.assign(new Error('Not found'), { status: 404 })) and never return null or a string for a failure; validation errors carry 400 (an empty or whitespace-only value is empty); the handler's catch answers err.status. Statuses the contract requires: ${[...new Set(c.statuses.map((s) => s.status))].sort().join(', ')}.`,
    structure: (c) => [`Domain functions throw errors that carry their HTTP status (const e = new Error('Not found'); e.status = 404; throw e). The request handler catches once and answers err.status || 500 with { error: message }. Statuses the contract requires: ${[...new Set(c.statuses.map((s) => s.status))].sort().join(', ')}. Validation errors (missing title, value outside the allowed set) answer 400; an unknown id answers 404; a forbidden state change answers 409.`],
    invariants: ['every required status is reachable by some request', 'a catch-all does not turn every error into one status'],
    failureModes: ['catch-all answers 400 for every error so 404/409 are unreachable', 'a status is never produced anywhere in the code'],
    staticChecks: [
      { id: 'status-reachable', describe: 'every status the contract requires can be answered', run: (files, c) => {
        const server = Object.entries(files).find(([p]) => /(?:^|\/)server\.m?js$/.test(p))
        if (!server) return []
        const js = Object.fromEntries(sources(files).concat(Object.entries(files).filter(([p]) => /(?:^|\/)server\.m?js$/.test(p))))
        const acceptance = c.behaviors.map((b) => b.text)
        return statusReachability(js, acceptance).map((st) => find('REST_STATUS', 'status-reachable', { criterion: c.statuses.find((s) => String(s.status) === st)?.criterion ?? null, file: server[0], symbol: null, fact: `nothing in the code can ever respond with HTTP ${st}`, expected: `an error carrying status ${st} and a handler that answers it` }))
      } },
      { id: 'catch-all-status', describe: 'the request handler answers the status an error carries, not one fixed status', run: (files, c) => {
        const needs = [...new Set(c.statuses.map((x) => x.status))].filter((x) => x >= 400 && x !== 400 && x !== 500)
        if (!needs.length) return []
        // only a defect when the domain code really signals statuses through its errors (status: 404, err.status = 409) that the fixed catch then hides
        const carried = new Set<number>()
        for (const [p, t] of Object.entries(files)) if (/\.m?js$/.test(p) && !/^(test|public|node_modules)\//.test(p) && !/(?:^|\/)server\.m?js$/.test(p)) for (const m of t.matchAll(/\bstatus(?:Code)?\s*(?::|=)\s*(4\d\d|5\d\d)\b/g)) carried.add(Number(m[1]))
        if (![...carried].some((x) => needs.includes(x))) return []
        return Object.entries(files).filter(([p, t]) => /\.m?js$/.test(p) && !/^(test|public|node_modules)\//.test(p) && mapCatchStatus(p, t) !== null).map(([p]) => find('REST_STATUS', 'catch-all-status', { criterion: c.statuses.find((x) => needs.includes(x.status))?.criterion ?? null, file: p, symbol: null, fact: `${p}: the catch block answers EVERY thrown error with one fixed status, so the ${needs.join('/')} that the domain code signals never reaches the client`, expected: 'reply(res, Number.isInteger(err.status) ? err.status : 400, ...)' }))
      } },
    ],
    verificationChecks: ['an unknown id answers 404 (valid route, absent record)', 'an invalid body answers 400'],
  },
  {
    id: 'ROUTE_ORDER',
    title: 'Literal routes are registered before prefix and parameter routes',
    provenBy: ['lesson ROUTE_ORDER', 'routeFindings gate', 'routeEdit.ts (structural route move)', 'alert read-all shadowing'],
    matches: (c) => c.routes.some((r) => !r.compat),
    layers: ['api'],
    prerequisites: ['a request dispatcher in the entry file'],
    brief: (c) => {
      const re = (p: string) => '/^' + p.split('/').filter(Boolean).map((seg) => (seg.startsWith(':') ? (c.idNumeric ? '(\\d+)' : '([^/]+)') : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).map((x) => '\\/' + x).join('') + '$/'
      const rs = c.routes.filter((r) => !r.compat).map((r) => `${r.method} ${r.path} -> ${re(r.path)}`)
      return `Match EVERY route with an anchored regex on url.pathname (never split('/') index arithmetic: it silently skips segments, which answers the generic 404): ${rs.join(' ; ').slice(0, 900)}. Literal routes before parameter routes; no route twice.`
    },
    structure: (c) => [`In the dispatcher register routes in this order: exact literals first (${c.routes.filter((r) => !r.params.length && !r.compat).map((r) => `${r.method} ${r.path}`).slice(0, 8).join(', ')}), then parameter routes (${c.routes.filter((r) => r.params.length).map((r) => `${r.method} ${r.path}`).slice(0, 8).join(', ')}). A route such as /x/read-all or /x/unread-count must come BEFORE any /x/:id or startsWith('/x/') test.`],
    invariants: ['no literal route is shadowed by an earlier prefix or parameter route', 'no route is registered twice'],
    failureModes: ['parameter route placed first swallows /x/read-all', 'prefix startsWith test swallows literal sub-routes', 'split(\'/\') index arithmetic that is off by the leading segments (the route falls through to 404)', 'the request body read twice in one statement (the second read is empty)'],
    staticChecks: [
      { id: 'shadowing', describe: 'no registered route is unreachable', run: (files, c) => Object.entries(files).filter(([p, t]) => /\.m?js$/.test(p) && !/^(test|public|node_modules)\//.test(p) && routeTable(t).length >= 3).flatMap(([p, t]) => routeFindings(p, t).map((f) => find('ROUTE_ORDER', 'shadowing', { criterion: c.routes.find((r) => r.path === f.hidden || f.hidden.includes(r.path))?.criterion ?? null, file: p, symbol: null, fact: f.kind === 'DUPLICATE' ? `${f.hidden} is registered twice (lines ${f.hidingLine} and ${f.hiddenLine})` : `${f.hidden} (line ${f.hiddenLine}) is never reached: ${f.hiding} (line ${f.hidingLine}) matches it first`, expected: 'register the specific route before the broad one' }))) },
      { id: 'body-read-once', describe: 'the request body stream is read at most once per request', run: (files, c) => {
        const out: RecipeFinding[] = []
        for (const [p, t] of Object.entries(files)) {
          if (!/\.m?js$/.test(p) || /^(test|public|node_modules)\//.test(p) || !/createServer\s*\(/.test(t)) continue
          t.split('\n').forEach((ln, i) => { const reads = [...ln.matchAll(/\bawait\s+(\w*[bB]ody\w*|\w*[jJ]son\w*)\(\s*req\s*\)/g)]; if (reads.length >= 2) out.push(find('ROUTE_ORDER', 'body-read-once', { criterion: c.routes.find((r) => r.createsRecord)?.criterion ?? null, file: p, symbol: reads[0][1], fact: `${p}:${i + 1} calls ${reads[0][1]}(req) ${reads.length} times in one statement; a request body can be read only once, so every read after the first returns an empty object (the missing values silently become defaults)`, expected: `read the body once into a variable (const input = await ${reads[0][1]}(req)) and use that variable` })) })
        }
        return out
      } },
      { id: 'routes-served', describe: 'every route the contract names is registered with its method', run: (files, c) => {
        const server = Object.entries(files).find(([p, t]) => /\.m?js$/.test(p) && !/^(test|public|node_modules)\//.test(p) && (/createServer\s*\(/.test(t) || routeTable(t).length >= 3))
        if (!server) return []
        const clients = Object.entries(files).filter(([p]) => /^public\/.+\.js$/.test(p)).map(([, t]) => t)
        return contractRouteProblems(server[0], server[1], c.behaviors.map((b) => b.text), clients).map((fact) => find('ROUTE_ORDER', 'routes-served', { criterion: null, file: server[0], symbol: null, fact, expected: 'register the route with the method written in the contract' }))
      } },
    ],
    verificationChecks: ['each contract route answers (not 404 route-not-found) for a valid sample request', 'the request body is read once'],
  },
  {
    id: 'STATE_ACTIONS',
    title: 'Per-item flag toggles through action sub-resources and cross-flag rules',
    provenBy: ['alert fixture (read/unread/archive)', 'task fixture (allowed transitions)', 'lesson ASSERTION on 409'],
    matches: (c) => c.flags.length > 0 || c.transitions.length > 0,
    layers: ['domain', 'api'],
    prerequisites: ['an item store with ids'],
    structure: (c) => [
      ...(c.flags.length ? [`Each action route sets exactly the flag the contract names (${[...new Set(c.flags.map((f) => `${f.route} -> ${f.name}=${f.sets}`))].join('; ')}), returns the updated item with 200, answers 404 for an unknown id, and applies the cross-flag rule the contract states with 409. Repeating an action is harmless (idempotent).`] : []),
      ...(c.transitions.length ? [`A move is allowed only when (from,to) is one of ${c.transitions.map((t) => `${t.from}->${t.to}`).join(', ')}; any other known value is 409, an unknown value is 400, an unknown id is 404.`] : []),
    ],
    invariants: ['an action changes only its own flag', 'the response is the updated item', 'forbidden combinations are rejected, not silently ignored'],
    failureModes: ['action toggles the wrong flag', 'archived item can still be marked read', 'transition table accepts a move the contract forbids'],
    staticChecks: [],
    verificationChecks: ['each action route returns the item with the flag set', 'an unknown id answers 404'],
  },
  {
    id: 'LIST_FILTER',
    title: 'List endpoint with derived-state and field query filters',
    provenBy: ['alert fixture (?state / ?severity)', 'task fixture (?status)', 'failureEvidence query-check routing'],
    matches: (c) => c.filters.length > 0,
    layers: ['domain', 'api'],
    prerequisites: ['a list route'],
    brief: (c) => `The list route reads ${c.filters.map((f) => '?' + f.param).join(', ')} and filters in ONE service function that takes them as arguments; an absent parameter gives the default view; filters combine with AND; compare stored flag/field values only.${c.defaultViews.length || c.filterRules.length ? ` EXACT SELECTIONS: ${[...c.defaultViews.map((d) => `no parameter -> ${d.requires.map((q) => `${q.flag}=${q.value}`).join(' and ')}`), ...c.filterRules.map((r) => `?${r.param}=${r.value} -> ${r.everything ? 'every item' : r.requires.map((q) => `${q.flag}=${q.value}`).join(' and ')}`)].join('; ')}.` : ''}`,
    structure: (c) => [`The list route reads its query parameters (${c.filters.map((f) => `?${f.param}${f.values.length ? '=' + f.values.join('|') : ''}`).join(', ')}) and filters in ONE service function that takes them as arguments. A parameter that is absent applies the contract's default. Combine filters with AND. Compare against the stored flag/field values; never against another parameter's value.${c.defaultViews.length || c.filterRules.length ? ` EXACT SELECTIONS from the contract: ${[...c.defaultViews.map((d) => `no parameter -> ${d.requires.map((q) => `${q.flag}=${q.value}`).join(' and ')}`), ...c.filterRules.map((r) => `?${r.param}=${r.value} -> ${r.everything ? 'every item' : r.requires.map((q) => `${q.flag}=${q.value}`).join(' and ')}`)].join('; ')}.` : ''}`],
    invariants: ['every value the contract lists is handled explicitly', 'filters combine', 'the default view is what the contract says it is'],
    failureModes: ['a value the contract lists is never handled', 'the default view includes items the contract excludes', 'a filter overrides another filter instead of narrowing it'],
    staticChecks: [
      { id: 'filter-values', describe: 'every filter parameter the contract names is read by the code (values are exercised by the runtime preflight)', run: (files, c) => {
        const code = sources(files).concat(Object.entries(files).filter(([p]) => /(?:^|\/)server\.m?js$/.test(p))).map(([, t]) => t).join('\n')
        if (!code.trim()) return []
        const out: RecipeFinding[] = []
        for (const f of c.filters) {
          if (!new RegExp(`['"\`]${f.param}['"\`]|\\.${f.param}\\b|\\b${f.param}\\b`).test(code)) { out.push(find('LIST_FILTER', 'filter-values', { criterion: f.criterion, file: null, symbol: null, fact: `the query parameter ${f.param} is never read by any source file`, expected: `read ${f.param} and filter by it` })); continue }
        }
        return out
      } },
    ],
    verificationChecks: ['every listed filter value answers 200 with an array'],
  },
  {
    id: 'COUNTERS_AND_SHAPES',
    title: 'Counter / summary / bulk endpoints with an exact JSON response shape',
    provenBy: ['alert unread-count and read-all', 'task summary', 'alert run: read-all nested {"updated":{"updated":n}}'],
    matches: (c) => c.routes.some((r) => r.shape),
    layers: ['domain', 'api'],
    prerequisites: ['an item store'],
    structure: (c) => c.routes.filter((r) => r.shape).map((r) => `${r.method} ${r.path} responds with EXACTLY ${JSON.stringify(r.shape).replace(/"n"/g, 'n')}: the keys as written, every 'n' a plain NUMBER (not an object, not a string). Compute the numbers from the stored items; for a bulk action return the number of items that CHANGED. The handler sends the service's return value once; do not wrap an already-shaped value in another object.`),
    invariants: ['response keys equal the contract keys', 'counted values are numbers'],
    failureModes: ['service returns {updated:n} and the handler wraps it again as {updated:{updated:n}}', 'a counter includes items the contract excludes'],
    staticChecks: [
      { id: 'shape-keys', describe: 'every key of a contract response shape appears as a property in the code', run: (files, c) => {
        const code = sources(files).map(([, t]) => t).join('\n')
        if (!code.trim()) return []
        return c.routes.filter((r) => r.shape).flatMap((r) => Object.keys(r.shape!).filter((k) => !new RegExp(`\\b${k}\\s*[:,}]|['"\`]${k}['"\`]`).test(code)).map((k) => find('COUNTERS_AND_SHAPES', 'shape-keys', { criterion: r.criterion, file: null, symbol: null, fact: `${r.method} ${r.path} must respond with a "${k}" property but no source file ever produces that key`, expected: `a "${k}" property in the response` })))
      } },
      { id: 'double-wrap', describe: 'a handler does not wrap an already-shaped service result', run: (files, c) => {
        const out: RecipeFinding[] = []
        for (const r of c.routes.filter((x) => x.shape)) for (const k of Object.keys(r.shape!)) for (const [p, t] of Object.entries(files)) if (/\.m?js$/.test(p) && !/^(test|public)\//.test(p) && new RegExp(`\\{\\s*${k}\\s*:\\s*(?:await\\s+)?\\w+(?:\\.\\w+)*\\(`).test(t) && new RegExp(`return\\s*\\{[^}]*\\b${k}\\s*:\\s*\\{[^}]*\\b${k}\\b`).test(t)) out.push(find('COUNTERS_AND_SHAPES', 'double-wrap', { criterion: r.criterion, file: p, symbol: null, fact: `${p} nests "${k}" inside "${k}"`, expected: `a flat ${JSON.stringify(r.shape).replace(/"n"/g, 'n')}` }))
        return out
      } },
    ],
    verificationChecks: ['the response of each shaped route has exactly the contract keys with numeric values'],
  },
  {
    id: 'API_UI_WIRING',
    title: 'Page elements with fixed ids filled from the API',
    provenBy: ['domIds / missingDomIds gate', 'chat/task/alert UI criteria', 'lesson ROUTE_ORDER (client calls)'],
    matches: (c) => c.ui.ids.length > 0 || c.ui.apis.length > 0,
    layers: ['ui'],
    prerequisites: ['the API routes exist'],
    structure: (c) => [`The page (public/index.html) contains an element for each required id (${c.ui.ids.map((i) => `id="${i}"`).join(', ') || 'as the contract describes'}); the client script (public/*.js) fetches ${c.ui.apis.join(' and ') || 'the API routes'} on load and after every action and writes the result into those elements. The page loads the script with a <script> tag.`],
    invariants: ['every contract id exists exactly once in the page', 'every API path the contract names is fetched by the client', 'every id the script reads exists in the page'],
    failureModes: ['client script reads an element the page does not contain', 'page never loads the client script'],
    staticChecks: [
      { id: 'ui-ids', describe: 'the page contains every element id the contract names', run: (files, c) => {
        const html = Object.entries(files).find(([p]) => /(?:^|\/)index\.html?$/.test(p))
        if (!html || !c.ui.ids.length) return []
        return c.ui.ids.filter((i) => !new RegExp(`\\bid\\s*=\\s*["']${i}["']`).test(html[1])).map((i) => find('API_UI_WIRING', 'ui-ids', { criterion: c.ui.criteria[0] ?? null, file: html[0], symbol: null, fact: `${html[0]} has no element with id="${i}"`, expected: `an element with id="${i}"` }))
      } },
      { id: 'ui-apis', describe: 'the client script calls each API path the contract names for the page', run: (files, c) => {
        const clients = Object.entries(files).filter(([p]) => /^public\/.+\.js$/.test(p))
        if (!clients.length || !c.ui.apis.length) return []
        const code = clients.map(([, t]) => t).join('\n')
        return c.ui.apis.filter((a) => !code.includes(a)).map((a) => find('API_UI_WIRING', 'ui-apis', { criterion: c.ui.criteria[0] ?? null, file: clients[0][0], symbol: null, fact: `the client script never calls ${a}`, expected: `fetch('${a}')` }))
      } },
    ],
    verificationChecks: ['the page contains the contract ids', 'the client script references the contract API paths'],
  },
  {
    id: 'LEGACY_COMPAT',
    title: 'Existing endpoints keep their behaviour and data',
    provenBy: ['legacyStateDrift gate', 'apiCompat / importCompat gates', 'fixture compatibility criteria'],
    matches: (c) => c.compat.routes.length > 0,
    layers: ['storage', 'domain', 'api'],
    prerequisites: ['the baseline exports and routes'],
    structure: (c) => [`Leave the existing functions and routes (${c.compat.routes.join(', ')}) and their data untouched; add NEW functions and routes for the new feature beside them. Do not point an existing function at the new state.`],
    invariants: ['every existing export still exists', 'existing routes still answer as before'],
    failureModes: ['an existing function now reads the new collection', 'an existing export removed or renamed'],
    staticChecks: [],
    verificationChecks: ['each KEEP route still answers 200 (GET) without a server error'],
  },
  {
    id: 'STARTUP',
    title: 'The server starts on PORT and stops cleanly',
    provenBy: ['startupProbe', 'Foundry-owned test harness (PORT per test)'],
    matches: (c) => c.routes.length > 0,
    layers: ['api'],
    prerequisites: ['an entry file'],
    structure: () => ['The entry file listens on Number(process.env.PORT) (with a default for manual runs), imports resolve to files that exist, and nothing at import time throws.'],
    invariants: ['the process listens on process.env.PORT', 'every import resolves'],
    failureModes: ['listens on a hard-coded port', 'import of a file or export that does not exist'],
    staticChecks: [
      { id: 'listens-on-port', describe: 'the entry file listens on process.env.PORT', run: (files, c) => {
        const entry = Object.entries(files).find(([p, t]) => /(?:^|\/)server\.m?js$/.test(p) && /createServer\s*\(/.test(t))
        if (!entry || /\.listen\([^)]*process\.env\.PORT/.test(entry[1]) || /process\.env\.PORT/.test(entry[1])) return []
        return [find('STARTUP', 'listens-on-port', { criterion: c.routes[0]?.criterion ?? null, file: entry[0], symbol: null, fact: `${entry[0]} never reads process.env.PORT, so a test or runner cannot choose its port`, expected: 'server.listen(Number(process.env.PORT) || <default>)' })]
      } },
      { id: 'syntax', describe: 'every source file parses', run: (files) => Object.entries(files).filter(([p]) => /\.m?js$/.test(p) && !/node_modules/.test(p)).flatMap(([p, t]) => syntaxProblems(p, t).map((s) => find('STARTUP', 'syntax', { criterion: null, file: p, symbol: null, fact: `${p}: ${s}`, expected: 'a syntactically valid file' }))) },
    ],
    verificationChecks: ['the server boots and answers on the chosen port'],
  },
]

export function matchRecipes(c: ImplementationContract): Recipe[] { return RECIPES.filter((r) => r.matches(c)) }
export function runRecipeChecks(files: Files, c: ImplementationContract, recipes: Recipe[] = matchRecipes(c)): RecipeFinding[] {
  const out: RecipeFinding[] = []
  for (const r of recipes) for (const k of r.staticChecks) { try { out.push(...k.run(files, c)) } catch { /* a check that cannot run says nothing */ } }
  return out
}

/** Recipe text for one layer: structure, invariants, known failure modes. Compact; this is what the builder follows instead of re-inventing the pattern. */
/** Storage recipes belong to the file that OWNS the data (a top-level collection, fs calls, or a storage-named file), not to every domain file. */
const OWNS_DATA = /\b(?:const|let|var)\s+\w+\s*=\s*(?:\[\s*\]|\{\s*\}|new (?:Map|Set))|node:fs|writeFile|readFile/
const STORAGE_RECIPES = new Set(['JSON_FILE_STORE', 'MONOTONIC_IDS'])
export function recipesForFile(recipes: Recipe[], layer: string, file?: { path: string; text: string }): Recipe[] {
  return recipes.filter((r) => r.layers.includes(layer as Recipe['layers'][number]) && (!file || layer === 'storage' || !STORAGE_RECIPES.has(r.id) || OWNS_DATA.test(file.text) || /(?:store|storage|feed|repo|db|data)/i.test(file.path)))
}
export function renderRecipes(c: ImplementationContract, recipes: Recipe[], layer: string, cap = 3000, file?: { path: string; text: string }): string {
  const rs = recipesForFile(recipes, layer, file)
  if (!rs.length) return ''
  const l: string[] = [`PROVEN RECIPES for the ${layer} layer (follow the structure; do not reinvent it):`]
  for (const r of rs) {
    l.push(`[${r.id}] ${r.title}`)
    if (r.brief) l.push(`  ${r.brief(c)}`)
    else for (const s of r.structure(c)) l.push(`  ${s}`)
    l.push(`  AVOID: ${r.failureModes.slice(0, 3).join('; ')}`)
  }
  return l.join('\n').slice(0, cap)
}

// ---------------------------------------------------------------- implementation plan (one block per bounded build step)

export type ImplStep = {
  STEP: string
  TARGET_FILE: string
  TARGET_SYMBOL: string
  CURRENT_BEHAVIOR: string
  REQUIRED_BEHAVIOR: { id: string; text: string }[]
  EXACT_CHANGE: string[]
  DEPENDENCIES: string[]
  INVARIANTS: string[]
  EXPECTED_RUNTIME_RESULT: string[]
  recipes: string[]
}
const LAYER_BEHAVIORS: Record<string, (b: { categories: string[] }) => boolean> = {
  storage: (b) => b.categories.includes('PERSISTENCE') || b.categories.includes('COMPAT'),
  domain: (b) => ['STATE', 'FILTER', 'COUNTER', 'STATUS', 'PERSISTENCE', 'ROUTE'].some((x) => b.categories.includes(x)),
  api: (b) => ['ROUTE', 'STATUS', 'FILTER', 'COUNTER', 'STATE', 'COMPAT'].some((x) => b.categories.includes(x)),
  ui: (b) => b.categories.includes('UI'),
}
export type PlanInput = { file: string; layer: string; exists: boolean; current: string; step: number; dependsOn: string[] }
export function buildImplStep(c: ImplementationContract, recipes: Recipe[], input: PlanInput): ImplStep {
  const sel = LAYER_BEHAVIORS[input.layer] ?? (() => false)
  const behaviors = c.behaviors.filter((b) => sel(b) && !b.categories.includes('TEST'))
  const rs = recipesForFile(recipes, input.layer, { path: input.file, text: input.current })
  const decls = [...input.current.matchAll(/^(?:export\s+)?(?:async\s+)?(?:function|const|let|class)\s+(\w+)/gm)].map((m) => m[1])
  const routes = c.routes.filter((r) => input.layer === 'api' || input.layer === 'domain' ? true : input.layer === 'ui' ? c.ui.apis.includes(r.path) : false)
  const expected: string[] = []
  if (input.layer === 'api' || input.layer === 'domain') for (const r of routes.filter((x) => !x.compat)) expected.push(`${r.method} ${r.sample}${r.statuses.length ? ` answers ${r.statuses.join(' or ')}` : ''}${r.shape ? ` with ${JSON.stringify(r.shape).replace(/"n"/g, 'n')}` : ''}`)
  if (input.layer === 'storage' && c.persistence.required) expected.push(`data written to ${c.persistence.envVar ? `$${c.persistence.envVar} or ` : ''}${c.persistence.defaultPath ?? 'the data file'} is read back by a fresh process`)
  if (input.layer === 'ui') expected.push(...c.ui.ids.map((i) => `element #${i} exists`), ...c.ui.apis.map((a) => `page script calls ${a}`))
  return {
    STEP: `${input.step}. ${input.layer}: ${input.exists ? 'modify' : 'create'} ${input.file}`,
    TARGET_FILE: input.file,
    TARGET_SYMBOL: decls.length ? decls.slice(0, 8).join(', ') + (input.exists ? ' (keep every existing export)' : '') : input.exists ? '(top level)' : '(new file)',
    CURRENT_BEHAVIOR: input.exists ? `${input.current.split('\n').length} lines; declares ${decls.slice(0, 10).join(', ') || 'no named declarations'}` : 'does not exist yet',
    REQUIRED_BEHAVIOR: behaviors.map((b) => ({ id: b.id, text: b.text })),
    EXACT_CHANGE: rs.flatMap((r) => r.structure(c)),
    DEPENDENCIES: input.dependsOn,
    INVARIANTS: rs.flatMap((r) => r.invariants),
    EXPECTED_RUNTIME_RESULT: expected,
    recipes: rs.map((r) => r.id),
  }
}
export function renderImplStep(s: ImplStep, cap = 1500): string {
  const inv = [...new Set(s.INVARIANTS)].slice(0, 5)
  return [
    'IMPLEMENTATION PLAN FOR THIS STEP (follow it; do not code beyond it):',
    `STEP: ${s.STEP}`, `TARGET_FILE: ${s.TARGET_FILE}`, `TARGET_SYMBOL: ${s.TARGET_SYMBOL}`, `CURRENT_BEHAVIOR: ${s.CURRENT_BEHAVIOR}`,
    `REQUIRED_BEHAVIOR: ${s.REQUIRED_BEHAVIOR.map((b) => `${b.id} ${b.text.slice(0, 70).replace(/\s+\S*$/, '')}…`).join(' | ') || '(none for this layer)'}`,
    `EXACT_CHANGE: ${s.recipes.length ? `apply ${s.recipes.join(', ')} (structure above) to the behaviors listed` : 'as the behaviors require'}`,
    `DEPENDENCIES: ${s.DEPENDENCIES.join(', ') || 'none'}`,
    `INVARIANTS: ${inv.join('; ') || 'keep every existing export and behaviour'}`,
    `EXPECTED_RUNTIME_RESULT: ${s.EXPECTED_RUNTIME_RESULT.slice(0, 6).join(' | ') || 'the file loads without error'}`,
  ].join('\n').slice(0, cap)
}

// ---------------------------------------------------------------- model manifest (self-check) and its independent verification

export type Manifest = { CHANGED: string[]; WHY: string; SATISFIES: string[]; PRESERVES: string[]; RISKS: string }
export const MANIFEST_INSTRUCTION = [
  'AFTER your code/edits add one manifest block (it is a self-check; Foundry verifies every claim independently):',
  '```manifest',
  'CHANGED: <comma separated names of the functions/routes/elements you added or changed>',
  'WHY: <one sentence>',
  'SATISFIES: <comma separated behavior ids from REQUIRED_BEHAVIOR, e.g. B2, B3>',
  'PRESERVES: <comma separated existing exports or routes you left working>',
  'RISKS: <one sentence, or none>',
  '```',
].join('\n')
export function stripManifest(text: string): { text: string; manifest: Manifest | null } {
  const m = /```manifest\n([\s\S]*?)```/.exec(text)
  if (!m) return { text, manifest: null }
  const field = (k: string) => new RegExp(`^${k}:\\s*(.*)$`, 'm').exec(m[1])?.[1].trim() ?? ''
  const list = (s: string) => s.split(/\s*,\s*/).map((x) => x.trim()).filter((x) => x && !/^(?:none|n\/a|-)$/i.test(x))
  return { text: text.replace(m[0], '').trim(), manifest: { CHANGED: list(field('CHANGED')), WHY: field('WHY'), SATISFIES: list(field('SATISFIES')).map((x) => x.toUpperCase()), PRESERVES: list(field('PRESERVES')), RISKS: field('RISKS') } }
}
export type ManifestCheck = { missing: boolean; problems: string[]; /** the problems that reveal a real regression (a dropped export, an omitted behavior that is still violated); the rest is recorded evidence */ blocking: string[] }
/**
 * Independent check of a manifest against the produced file. A claim is only counted when Foundry can see it in the code:
 *   CHANGED names must exist in the file; PRESERVES names must still be exported/declared; SATISFIES ids must be real ids of this step, and every behavior id the step
 *   REQUIRES must be claimed or evidently covered; a claimed behavior whose recipe static check fails is a false claim.
 */
export function checkManifest(m: Manifest | null, content: string, step: ImplStep, before: string, findings: RecipeFinding[]): ManifestCheck {
  if (!m) return { missing: true, problems: [], blocking: [] }
  const problems: string[] = []
  const has = (name: string) => new RegExp(`(?:\\b${name.replace(/[^\w$]/g, '.')}\\b|${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`).test(content)
  for (const n of m.CHANGED) if (!has(n)) problems.push(`MANIFEST claims "${n}" was changed or added, but it does not appear in the file`)
  const declared = (name: string) => new RegExp(`\\b(?:function|const|let|var|class)\\s+${name.replace(/[^\w$]/g, '.')}\\b|export\\s*\\{[^}]*\\b${name}\\b`).test(content)
  for (const n of m.PRESERVES) if (/^[A-Za-z_$][\w$]*$/.test(n) && new RegExp(`\\b${n}\\b`).test(before) && !declared(n) && !has(n)) problems.push(`MANIFEST says "${n}" is preserved, but it no longer exists in the file`)
  const ids = new Set(step.REQUIRED_BEHAVIOR.map((b) => b.id))
  for (const s of m.SATISFIES) if (/^B\d+$/.test(s) && !ids.has(s)) problems.push(`MANIFEST claims ${s}, which is not a behavior of this step (${[...ids].join(', ') || 'none'})`)
  const bad = new Set(findings.filter((f) => f.criterion !== null).map((f) => `B${f.criterion}`))
  for (const s of m.SATISFIES) if (bad.has(s)) problems.push(`MANIFEST claims ${s} is satisfied, but Foundry's check still finds: ${findings.filter((f) => `B${f.criterion}` === s).map((f) => f.fact).slice(0, 2).join(' | ')}`)
  const unclaimed = [...ids].filter((i) => !m.SATISFIES.includes(i) && bad.has(i))
  for (const i of unclaimed) problems.push(`MANIFEST omits ${i}, which this step must satisfy and which is still violated: ${findings.filter((f) => `B${f.criterion}` === i).map((f) => f.fact).slice(0, 2).join(' | ')}`)
  return { missing: false, problems, blocking: problems.filter((x) => /is preserved, but it no longer exists|omits B\d+/.test(x)) }
}

/**
 * Deterministic structural fixes for findings whose repair is known and bounded; applied BEFORE any model repair. Each fix changes only the lines it names:
 *   REST_STATUS.catch-all-status -> the catch block answers err.status (CHANGE_STATUS)
 *   JSON_FILE_STORE.parent-dir   -> one guarded mkdirSync of the default path's folder (ADD_DIRECTORY_GUARD)
 */
export function autofix(path: string, content: string, findings: RecipeFinding[], c: ImplementationContract): { content: string; notes: string[] } | null {
  let out = content
  const notes: string[] = []
  for (const f of findings.filter((x) => x.file === path)) {
    if (f.recipe === 'REST_STATUS' && f.check === 'catch-all-status') { const fx = mapCatchStatus(path, out); if (fx && fx !== out) { out = fx; notes.push('CHANGE_STATUS: the catch block answers the status an error carries') } }
    if (f.recipe === 'JSON_FILE_STORE' && f.check === 'parent-dir' && c.persistence.envVar && c.persistence.defaultPath) { const fx = repairMissingStorageDir(out, c.persistence.envVar, c.persistence.defaultPath); if (fx && fx.content !== out) { out = fx.content; notes.push(`ADD_DIRECTORY_GUARD: ${fx.note}`) } }
  }
  return out === content ? null : { content: out, notes }
}
