import path from 'node:path'
import { assembleCodeIndex, lookupDependents, lookupSymbol, rankOwnersFromIndex, type FoundryCodeIndex } from '@/lib/native-builder/foundryCodeIntelligence'
import { reachableFns, scanSignals, type FetchCall, type FileSignals } from './signals'
import type { Snapshot } from './snapshot'
import type {
  AnalysisRequest, AnalysisResult, Basis, ChangeImpact, Claim, Depth, Evidence, FlowStep, Layer, MapEdge, MapNode, MapView, ResolvedTarget, RouteInfo, StateInfo, TestCoverage, UiConnection,
} from './types'

/**
 * The analysis itself: pure function of (snapshot, request). It reuses the Foundry code index (AST symbols, imports, dependents, test siblings, ownership ranking) and adds
 * route/fetch/persistence/state/UI signals. It performs no I/O of its own and runs no commands, so it is read-only by construction.
 */
export const DEPTH_PARAMS: Record<Depth, { owners: number; up: number; down: number; reverseHops: number; listCap: number; mapNodes: number }> = {
  quick: { owners: 3, up: 3, down: 3, reverseHops: 1, listCap: 8, mapNodes: 24 },
  standard: { owners: 5, up: 5, down: 5, reverseHops: 2, listCap: 16, mapNodes: 40 },
  deep: { owners: 8, up: 8, down: 8, reverseHops: 4, listCap: 40, mapNodes: 70 },
}

const TEST_RE = /\.(test|spec|validation|proof|resume)\.(t|j)sx?$|(^|\/)(tests?|__tests__)\//
export const isTestFile = (rel: string) => TEST_RE.test(rel)
const ROUTE_RE = /^app\/api\/(.+)\/route\.(ts|js)$/
const routePathOf = (rel: string) => { const m = ROUTE_RE.exec(rel); return m ? `/api/${m[1]}` : null }

class Book {
  list: Evidence[] = []
  private seen = new Map<string, string>()
  add(kind: Evidence['kind'], file: string, note: string, line?: number, symbol?: string): string {
    const k = `${kind}|${file}|${line ?? ''}|${symbol ?? ''}|${note}`
    const hit = this.seen.get(k); if (hit) return hit
    const id = `E${this.list.length + 1}`
    this.list.push({ id, kind, file, ...(line ? { line } : {}), ...(symbol ? { symbol } : {}), note })
    this.seen.set(k, id)
    return id
  }
}

function urlToRegex(routePath: string): RegExp {
  const esc = routePath.split('/').map((seg) => {
    if (/^\[\.\.\..+\]$/.test(seg)) return '.+'
    if (/^\[.+\]$/.test(seg)) return '[^/]+'
    return seg.replace(/[.*+?^${}()|\\]/g, '\\$&')
  }).join('/')
  return new RegExp(`^${esc}$`)
}
const normUrl = (u: string) => u.split('?')[0].split('#')[0].replace(/\{\}/g, 'x').replace(/\/+$/, '')

export type AnalysisOutput = {
  target: ResolvedTarget
  result: AnalysisResult
  evidence: Evidence[]
  provenance: { filesInspected: string[]; symbolsInspected: string[]; routesInspected: string[]; methods: string[]; deterministicTools: string[] }
  handoff: { seedPaths: string[]; targetFiles: string[]; tests: string[]; contextLines: string[] }
}

/** One snapshot's derived data is reused by the next analysis of the same tree (keyed by the content fingerprint, so any change invalidates it). */
let derived: { key: string; index: FoundryCodeIndex; sig: Map<string, FileSignals> } | null = null

export function analyzeSnapshot(snap: Snapshot, req: AnalysisRequest): AnalysisOutput {
  const P = DEPTH_PARAMS[req.depth]
  const book = new Book()
  const listed = [...snap.files.keys()]
  const key = `${snap.root}|${snap.fingerprint}`
  if (!derived || derived.key !== key) derived = { key, index: assembleCodeIndex(listed.map((rel) => ({ rel, content: snap.files.get(rel)! })), listed, { root: snap.root, sourceFingerprint: snap.fingerprint }), sig: new Map() }
  const index: FoundryCodeIndex = derived.index
  const sigMemo = derived.sig
  const sig = (rel: string): FileSignals => { let s = sigMemo.get(rel); if (!s) { s = scanSignals(rel, snap.files.get(rel) ?? ''); sigMemo.set(rel, s) } return s }
  const inspected = new Set<string>(), symbolsInspected = new Set<string>(), routesInspected = new Set<string>()
  const touch = (rel: string) => { inspected.add(rel); return rel }
  const methods = ['TypeScript AST index (foundryCodeIntelligence.assembleCodeIndex: symbols, imports, dependents, test siblings)']
  const risks: Claim[] = []

  // ---- route table (every route handler in the snapshot) -------------------------------------------------------------------------------------------------------
  const routeFiles = listed.filter((r) => ROUTE_RE.test(r))
  const routeRe = new Map(routeFiles.map((r) => [r, urlToRegex(routePathOf(r)!)]))
  const routeMethods = new Map<string, Set<string>>()
  const methodsOf = (r: string) => { let m = routeMethods.get(r); if (!m) { m = new Set(sig(r).methods.map((x) => x.method)); routeMethods.set(r, m) } return m }
  const dynCount = (r: string) => (r.match(/\[/g) ?? []).length
  /** Static routes win over dynamic ones; when the HTTP method is known the route must export it. */
  const routeForUrl = (u: string, method?: string): string | null => {
    const n = normUrl(u); if (!n.startsWith('/')) return null
    const hits = routeFiles.filter((r) => routeRe.get(r)!.test(n)).sort((a, b) => dynCount(a) - dynCount(b) || a.localeCompare(b))
    const ok = method && method !== 'UNKNOWN' ? hits.filter((r) => { const m = methodsOf(r); return m.size === 0 || m.has(method) }) : hits
    return ok[0] ?? null
  }

  // ---- 1. resolve the target -----------------------------------------------------------------------------------------------------------------------------------
  const target = resolveTarget(req.target, listed, index, P.owners, book, symbolsInspected)
  if (target.kind === 'unresolved' || target.owners.length === 0) {
    const reason = book.add('search', '(snapshot)', `no file, route, symbol or ranked owner matched "${req.target.slice(0, 120)}"`)
    risks.push({ text: `Foundry could not resolve "${req.target.slice(0, 120)}" to any file, route or symbol in ${snap.files.size} indexed files. Nothing was guessed; name a file path, a /api route, an exported symbol or more specific words.`, basis: 'UNKNOWN', evidence: [reason] })
    return emptyOutput(target, risks, book, snap, methods)
  }
  const owners = target.owners
  owners.forEach(touch)

  // ---- 2. reverse dependency traversal -------------------------------------------------------------------------------------------------------------------------
  const importLineOf = (from: string, to: string): number | undefined => {
    const base = path.posix.basename(to).replace(/\.(tsx|ts|jsx|js|mjs|cjs)$/, '')
    const lines = (snap.files.get(from) ?? '').split('\n')
    const i = lines.findIndex((l) => /\b(import|export|require)\b|from\s/.test(l) && l.includes(base) && /['"]/.test(l))
    return i >= 0 ? i + 1 : undefined
  }
  const importEv = (from: string, to: string) => book.add('import', from, `imports ${to}`, importLineOf(from, to))
  // dependents = files that import it, plus (for a route handler) files that fetch() it; both are evidenced edges
  const dependentsOf = (f: string): string[] => [...new Set([...lookupDependents(index, f), ...(callersOf.get(f) ?? []).map((c) => c.file)])]
  const reverseBfs = (start: string, hops: number) => {
    const dist = new Map<string, number>([[start, 0]]), parent = new Map<string, string>(); const q = [start]
    while (q.length) { const f = q.shift()!; const d = dist.get(f)!; if (d >= hops) continue; for (const dep of dependentsOf(f)) if (!dist.has(dep)) { dist.set(dep, d + 1); parent.set(dep, f); q.push(dep) } }
    return { dist, parent }
  }

  // ---- 3. fetch call sites -> routes (client callers) ---------------------------------------------------------------------------------------------------------
  const fetchFiles = listed.filter((r) => (snap.files.get(r) ?? '').includes('fetch('))
  const callersOf = new Map<string, { file: string; call: FetchCall }[]>()
  const fetchEdges: { from: string; to: string; call: FetchCall }[] = []
  for (const f of fetchFiles) {
    for (const c of sig(f).fetches) {
      const r = c.url === '(non-literal)' ? null : routeForUrl(c.url, c.method)
      if (!r) continue
      fetchEdges.push({ from: f, to: r, call: c })
      const a = callersOf.get(r) ?? []; a.push({ file: f, call: c }); callersOf.set(r, a)
    }
  }
  methods.push('fetch() literal URL -> app/api route-file matching (dynamic segments honoured)')
  const fetchFrom = new Map<string, typeof fetchEdges>()
  for (const e of fetchEdges) (fetchFrom.get(e.from) ?? fetchFrom.set(e.from, []).get(e.from)!).push(e)

  // ---- 4. layer classification ---------------------------------------------------------------------------------------------------------------------------------
  const writesState = (rel: string) => sig(rel).persist.some((p) => (p.op === 'create' || p.op === 'change' || p.op === 'delete' || p.op === 'db') && !/^(mkdir|mkdirSync)$/.test(p.api.split('.').pop() ?? ''))
  const layerOf = (rel: string): Layer => {
    if (isTestFile(rel)) return 'TEST'
    if (ROUTE_RE.test(rel)) return 'API'
    if (/^scripts\//.test(rel)) return 'SCRIPT'
    if (/\.(tsx|jsx)$/.test(rel) || /^app\/.*\/(page|layout)\./.test(rel)) return 'UI'
    if (fetchFrom.has(rel)) return 'CLIENT'
    if (writesState(rel)) return 'STORE'
    if (/^(lib|src)\//.test(rel)) return 'SERVICE'
    return 'OTHER'
  }

  // ---- 5. data flow: nearest UI upstream, nearest persistence downstream ---------------------------------------------------------------------------------------
  const primary = owners[0]
  type Edge = { from: string; to: string; kind: 'import' | 'fetch'; ev: string; dynamic: boolean }
  const downEdges = (f: string): Edge[] => {
    const out: Edge[] = []
    for (const imp of index.files[f]?.imports ?? []) if (index.files[imp] && !isTestFile(imp)) out.push({ from: f, to: imp, kind: 'import', ev: importEv(f, imp), dynamic: false })
    for (const e of fetchFrom.get(f) ?? []) out.push({ from: f, to: e.to, kind: 'fetch', ev: book.add('fetch', f, `${e.call.method} ${e.call.url} -> ${e.to}`, e.call.line), dynamic: e.call.dynamic })
    return out
  }
  const upEdges = (f: string): Edge[] => {
    const out: Edge[] = []
    for (const dep of lookupDependents(index, f)) if (!isTestFile(dep)) out.push({ from: dep, to: f, kind: 'import', ev: importEv(dep, f), dynamic: false })
    for (const e of callersOf.get(f) ?? []) out.push({ from: e.file, to: f, kind: 'fetch', ev: book.add('fetch', e.file, `${e.call.method} ${e.call.url} -> ${f}`, e.call.line), dynamic: e.call.dynamic })
    return out
  }
  const bfsPath = (start: string, maxHops: number, edgesOf: (f: string) => Edge[], goal: (f: string) => boolean, nodeCap = 4000): Edge[] | null => {
    const prev = new Map<string, Edge | null>([[start, null]]); const q: [string, number][] = [[start, 0]]
    while (q.length && prev.size < nodeCap) {
      const [f, d] = q.shift()!
      if (f !== start && goal(f)) { const path: Edge[] = []; let c: string = f; while (prev.get(c)) { const e = prev.get(c)!; path.unshift(e); c = e.from === c ? e.to : e.from } return path }
      if (d >= maxHops) continue
      for (const e of edgesOf(f)) { const n = e.from === f ? e.to : e.from; if (!prev.has(n)) { prev.set(n, e); q.push([n, d + 1]) } }
    }
    return null
  }
  // upward edges are stored as dependent -> owner, so walking "up" from f follows e.from; reuse with direction-aware step
  const bfsUp = (start: string, maxHops: number, goal: (f: string) => boolean): Edge[] | null => {
    const prev = new Map<string, Edge | null>([[start, null]]); const q: [string, number][] = [[start, 0]]
    while (q.length) {
      const [f, d] = q.shift()!
      if (f !== start && goal(f)) { const chain: Edge[] = []; let c = f; while (prev.get(c)) { const e = prev.get(c)!; chain.push(e); c = e.to } return chain }
      if (d >= maxHops) continue
      for (const e of upEdges(f)) if (!prev.has(e.from)) { prev.set(e.from, e); q.push([e.from, d + 1]) }
    }
    return null
  }
  const isUiRoot = (f: string) => layerOf(f) === 'UI'
  const up = isUiRoot(primary) ? [] : (bfsUp(primary, P.up, isUiRoot) ?? bfsUp(primary, P.up, (f) => layerOf(f) === 'API' || layerOf(f) === 'SCRIPT') ?? [])
  const persisted = (f: string) => writesState(f) && !isTestFile(f)
  const down = persisted(primary) ? [] : (bfsPath(primary, P.down, downEdges, persisted) ?? [])
  methods.push('breadth-first shortest chain upward to the nearest UI file and downward to the nearest persistence call')

  /** UI handlers of a file with the API calls reachable from each (handler -> intra-file call graph -> fetch). */
  const surfacesOf = (f: string) => {
    const s = sig(f)
    return s.ui.map((u) => {
      const fns = new Set<string>([...(u.handler ? reachableFns(s.calls, u.handler) : []), ...u.calls.flatMap((c) => [...reachableFns(s.calls, c)])])
      const reaches = [...new Set(s.fetches.filter((c) => c.enclosing && fns.has(c.enclosing) && c.url !== '(non-literal)').map((c) => `${c.method} ${c.url.split('?')[0]}`))]
      return { u, reaches }
    })
  }
  const steps: FlowStep[] = []
  const stepFor = (file: string, via: string, edgeEv: string[], basis: Basis, nextRoute?: string): FlowStep => {
    const l = layerOf(file); const s = sig(file)
    const pers = s.persist.find((p) => p.op === 'create' || p.op === 'change' || p.op === 'db' || p.op === 'delete')
    const m = s.methods.map((x) => x.method).join('/')
    let label = path.posix.basename(file)
    let line: number | undefined
    let viaGraph = false
    if (l === 'API' && m) { label = `${routePathOf(file)} [${m}]`; line = s.methods[0].line; routesInspected.add(routePathOf(file)!) }
    else if (l === 'UI' && s.ui.length) {
      const all = surfacesOf(file)
      const hit = (nextRoute && all.find((x) => x.reaches.some((r) => routeForUrl(r.split(' ').slice(1).join(' '), r.split(' ')[0]) === nextRoute))) || all.find((x) => x.reaches.length) || all[0]
      const u = hit.u; viaGraph = Boolean(hit.reaches.length); label = `${path.posix.basename(file)} - "${u.label}" ${u.event}${u.handler ? ' -> ' + u.handler : ''}`; line = u.line
    }
    else if ((l === 'STORE' || l === 'SERVICE') && pers) { label = `${path.posix.basename(file)} - ${pers.api}(${pers.target.slice(0, 40)})`; line = pers.line }
    const ev = [...edgeEv, book.add(l === 'API' ? 'route' : l === 'UI' ? 'ui' : l === 'STORE' ? 'persistence' : 'file', file, `${l} layer: ${label}`, line)]
    return { n: 0, layer: l, file, line, label, via, basis: viaGraph && basis === 'FACT' ? 'INFERENCE' : basis, evidence: ev }
  }
  const upChain = [...up] // dependent -> owner order from owner upward; reverse for display
  // bfsUp returns edges from the UI end (goal) back toward the owner: chain[0].from is the entry, each edge.to is the next step down
  if (upChain.length) {
    steps.push(stepFor(upChain[0].from, 'entry', [], 'FACT', upChain[0].to))
    for (const e of upChain) steps.push(stepFor(e.to, e.kind === 'fetch' ? 'fetch' : 'import', [e.ev], e.dynamic ? 'INFERENCE' : 'FACT'))
  } else steps.push(stepFor(primary, 'entry', [], 'FACT'))
  for (const e of down) steps.push(stepFor(e.to, e.kind === 'fetch' ? 'fetch' : 'import', [e.ev], e.dynamic ? 'INFERENCE' : 'FACT'))
  steps.forEach((s, i) => { s.n = i + 1 })
  steps.forEach((s) => touch(s.file))
  if (!up.length && !isUiRoot(primary)) risks.push({ text: `No UI file was found within ${P.up} hops upstream of ${primary}; where this is triggered from is not established.`, basis: 'UNKNOWN', evidence: [book.add('search', primary, `reverse traversal up to ${P.up} hops found no UI file`)] })
  if (!down.length && !persisted(primary)) risks.push({ text: `No persistence call (file write, database call) was found within ${P.down} hops downstream of ${primary}; where its data is stored is not established.`, basis: 'UNKNOWN', evidence: [book.add('search', primary, `downstream traversal up to ${P.down} hops found no persistence call`)] })

  // ---- 6. dependencies (direct) --------------------------------------------------------------------------------------------------------------------------------
  const dependencies = owners.map((f) => ({
    file: f,
    internal: (index.files[f]?.imports ?? []).filter((i) => index.files[i]).slice(0, P.listCap * 2).map((i) => ({ path: i, evidence: [importEv(f, i)] })),
    external: sig(f).external.slice(0, P.listCap * 2),
  }))

  // ---- 7. reverse dependents -----------------------------------------------------------------------------------------------------------------------------------
  const reverseDependents = owners.map((f) => {
    const { dist } = reverseBfs(f, P.reverseHops)
    const direct = dependentsOf(f).slice(0, P.listCap * 2).map((d) => ({ path: d, evidence: [lookupDependents(index, f).includes(d) ? importEv(d, f) : book.add('fetch', d, `fetch() of ${routePathOf(f)}`, (callersOf.get(f) ?? []).find((c) => c.file === d)?.call.line)] }))
    const transitive = [...dist].filter(([k, d]) => k !== f && d > 1).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).slice(0, P.listCap * 3).map(([k, d]) => ({ path: k, hops: d }))
    return { file: f, direct, transitive }
  })
  reverseDependents.forEach((r) => r.direct.forEach((d) => touch(d.path)))

  // ---- 8. routes -----------------------------------------------------------------------------------------------------------------------------------------------
  const routeSet = new Set<string>()
  for (const f of [...owners, ...steps.map((s) => s.file)]) if (ROUTE_RE.test(f)) routeSet.add(f)
  for (const f of owners) for (const e of fetchFrom.get(f) ?? []) routeSet.add(e.to)
  for (const d of reverseDependents) for (const x of d.direct) if (ROUTE_RE.test(x.path)) routeSet.add(x.path)
  const routes: RouteInfo[] = [...routeSet].slice(0, P.listCap).map((f) => {
    touch(f); const s = sig(f); const rp = routePathOf(f)!; routesInspected.add(rp)
    return {
      path: rp, file: f,
      methods: s.methods, statuses: s.statuses.filter((v, i, a) => a.findIndex((w) => w.status === v.status) === i), actions: s.actions.filter((v, i, a) => a.findIndex((w) => w.value === v.value) === i),
      callers: (callersOf.get(f) ?? []).slice(0, P.listCap).map((c) => ({ file: c.file, line: c.call.line, method: c.call.method })),
      evidence: [book.add('route', f, `route ${rp} methods ${s.methods.map((m) => m.method).join(',') || '(none exported)'}`, s.methods[0]?.line), ...s.statuses.slice(0, 6).map((st) => book.add('route', f, `responds with status ${st.status}`, st.line))],
    }
  })

  // ---- 9. state / storage --------------------------------------------------------------------------------------------------------------------------------------
  const scope = new Set<string>([...owners, ...steps.map((s) => s.file)])
  if (req.depth === 'deep') for (const f of [...scope]) for (const e of downEdges(f)) if (e.kind === 'import' && !isTestFile(e.to)) scope.add(e.to)
  const state: StateInfo = { states: [], assignments: [], storage: [] }
  for (const f of scope) {
    touch(f); const s = sig(f)
    for (const u of s.unions) state.states.push({ name: u.name, file: f, line: u.line, values: u.values, evidence: [book.add('state', f, `state vocabulary ${u.name} = ${u.values.join(' | ')}`, u.line)] })
    for (const a of s.assigns.slice(0, 40)) state.assignments.push({ file: f, line: a.line, field: a.field, value: a.value, evidence: [book.add('state', f, `${a.field} set to '${a.value}'`, a.line)] })
    for (const p of s.persist) state.storage.push({ file: f, line: p.line, op: p.op, api: p.api, target: p.target, evidence: [book.add(p.op === 'env' ? 'config' : 'persistence', f, `${p.api}${p.target ? `(${p.target.slice(0, 50)})` : ''} - ${p.op}`, p.line)] })
  }
  state.storage = state.storage.slice(0, P.listCap * 4); state.assignments = state.assignments.slice(0, P.listCap * 3)
  methods.push('AST scan for fs/db/browser-storage calls, useState, process.env, state unions and state-field assignments')

  // ---- 10. UI connections --------------------------------------------------------------------------------------------------------------------------------------
  const uiFiles = new Set<string>()
  for (const f of [...owners, ...steps.map((s) => s.file)]) if (layerOf(f) === 'UI') uiFiles.add(f)
  for (const r of reverseDependents) for (const d of r.direct) if (layerOf(d.path) === 'UI') uiFiles.add(d.path)
  for (const r of routes) for (const c of r.callers) if (layerOf(c.file) === 'UI') uiFiles.add(c.file)
  const ui: UiConnection[] = [...uiFiles].slice(0, P.listCap).map((f) => {
    touch(f); const s = sig(f)
    const surfaces = surfacesOf(f).slice(0, P.listCap * 2).map(({ u, reaches }) => ({ label: u.label, handler: u.handler, line: u.line, reachesApi: reaches, testId: u.testId }))
    return { file: f, surfaces, testIds: s.testIds.map((t) => t.id).slice(0, P.listCap * 2), evidence: [book.add('ui', f, `${s.ui.length} event handler(s), ${s.testIds.length} data-testid selector(s)`, s.ui[0]?.line)] }
  })
  methods.push('JSX onClick/onSubmit/onChange handlers followed through the intra-file call graph to fetch() calls')

  // ---- 11. tests -----------------------------------------------------------------------------------------------------------------------------------------------
  const relevantTests: TestCoverage['relevant'] = []
  const addTest = (p: string, why: string, basis: Basis, ev: string[], owner?: string) => { if (!relevantTests.some((t) => t.path === p && t.owner === owner)) relevantTests.push({ path: p, owner, why, basis, evidence: ev }) }
  const testFiles = listed.filter(isTestFile)
  for (const f of owners) {
    for (const t of lookupDependents(index, f)) if (isTestFile(t)) addTest(t, `imports ${f}`, 'FACT', [importEv(t, f)], f)
    for (const t of index.tests[f] ?? []) if (isTestFile(t)) addTest(t, `named as a test sibling of ${f} (naming convention, not proven to exercise it)`, 'INFERENCE', [book.add('test', t, `sibling test of ${f} by file name`)], f)
  }
  for (const r of routes) for (const t of testFiles) {
    const c = snap.files.get(t) ?? ''
    const re = new RegExp(r.path.replace(/[.*+?^${}()|\\[\]]/g, '\\$&') + '(?![\\w/\\[-])')
    const ln = c.split('\n').findIndex((l) => re.test(l)) + 1
    if (ln) addTest(t, `mentions route ${r.path}`, 'FACT', [book.add('test', t, `mentions ${r.path}`, ln)], r.path)
  }
  const incomplete = snap.truncated || snap.skipped.some((x) => x.reason.startsWith('larger'))
  const missing: Claim[] = []
  for (const f of owners.filter((o) => !isTestFile(o))) {
    const covered = relevantTests.some((t) => t.owner === f)
    if (!covered) missing.push({ text: `No test file in the snapshot imports ${f} or is named as its sibling. It may still be covered indirectly (a test that exercises a caller) or by a script; Foundry did not run tests.`, basis: 'FACT', evidence: [book.add('search', f, `no importing/sibling test found among ${testFiles.length} test-like files`)] })
  }
  for (const r of routes) if (!relevantTests.some((t) => t.owner === r.path)) missing.push({ text: `No test file mentions the route ${r.path}.`, basis: incomplete ? 'INFERENCE' : 'FACT', evidence: [book.add('search', r.file, `searched ${testFiles.length} test-like files for "${r.path}"`)] })
  const tests: TestCoverage = { relevant: relevantTests.slice(0, P.listCap * 2), missing: missing.slice(0, P.listCap) }
  relevantTests.forEach((t) => touch(t.path))

  // ---- 12. change impact ---------------------------------------------------------------------------------------------------------------------------------------
  const perOwner: ChangeImpact['perOwner'] = owners.filter((o) => !isTestFile(o)).map((f) => {
    const { dist } = reverseBfs(f, 30); const everything = [...dist.keys()].filter((k) => k !== f); const all = everything.filter((k) => !isTestFile(k))
    const routesAffected = [...new Set(all.filter((k) => ROUTE_RE.test(k)).map((k) => routePathOf(k)!))].slice(0, P.listCap)
    const uiAffected = all.filter((k) => layerOf(k) === 'UI').slice(0, P.listCap)
    const testsToRun = everything.filter(isTestFile).slice(0, P.listCap)
    const persists = writesState(f) || all.some((k) => !isTestFile(k) && writesState(k))
    const high = all.length >= 20 || (routesAffected.length > 0 && persists)
    const med = all.length >= 5 || routesAffected.length > 0 || uiAffected.length > 0
    return { file: f, directDependents: dependentsOf(f).length, transitiveDependents: all.length, routesAffected, uiAffected, testsToRun, risk: (high ? 'HIGH' : med ? 'MEDIUM' : 'LOW') as 'HIGH' | 'MEDIUM' | 'LOW', riskRule: 'HIGH: >=20 transitive dependents, or a route handler and a persistence call are reachable; MEDIUM: >=5 transitive dependents or any route/UI dependent; else LOW (heuristic classification of measured counts)' }
  })
  const impactSummary: Claim[] = perOwner.map((o) => ({
    text: `Changing ${o.file} reaches ${o.transitiveDependents} file(s) transitively (${o.directDependents} direct): ${o.routesAffected.length} route(s), ${o.uiAffected.length} UI file(s), ${o.testsToRun.length} test file(s). Risk class ${o.risk}.`,
    basis: 'INFERENCE', evidence: [book.add('count', o.file, `${o.directDependents} direct / ${o.transitiveDependents} transitive dependents from the import graph`)],
  }))
  const changeImpact: ChangeImpact = { perOwner, summary: impactSummary }

  // ---- 13. unknowns ---------------------------------------------------------------------------------------------------------------------------------------------
  if (snap.truncated) risks.push({ text: `The snapshot hit the ${snap.files.size}-file cap; files beyond it were not indexed, so some dependents, callers or tests may be missing.`, basis: 'UNKNOWN', evidence: [book.add('count', '(snapshot)', `file cap reached at ${snap.files.size}`)] })
  if (snap.skipped.some((s) => s.reason.startsWith('larger'))) risks.push({ text: `${snap.skipped.filter((s) => s.reason.startsWith('larger')).length} file(s) exceeded the size limit and were not analysed; relationships through them are not shown.`, basis: 'UNKNOWN', evidence: [book.add('count', '(snapshot)', 'oversized files skipped')] })
  const dyn = [...inspected].reduce((n, f) => n + (snap.files.has(f) ? sig(f).dynamicImports : 0), 0)
  if (dyn) risks.push({ text: `${dyn} dynamic import() call(s) in inspected files are not followed; modules loaded that way are not in the dependency or dependent lists.`, basis: 'UNKNOWN', evidence: [book.add('count', '(inspected files)', `${dyn} dynamic imports`)] })
  const nonLit = [...inspected].flatMap((f) => (snap.files.has(f) ? sig(f).fetches.filter((c) => c.url === '(non-literal)').map((c) => ({ f, c })) : []))
  if (nonLit.length) risks.push({ text: `${nonLit.length} fetch() call(s) in inspected files use a URL that is not a literal; the routes they reach cannot be established statically.`, basis: 'UNKNOWN', evidence: nonLit.slice(0, 5).map((x) => book.add('fetch', x.f, 'fetch with a non-literal URL', x.c.line)) })
  if (target.kind === 'feature') risks.push({ text: 'The target was a natural-language description; the owning files were chosen because they contain its significant terms in paths, symbols, string literals or bindings. Treat the owner set as INFERENCE and confirm it before relying on it.', basis: 'INFERENCE', evidence: [book.add('search', '(index)', `ranked ownership for "${req.target.slice(0, 80)}"`)] })
  if (steps.some((x) => x.layer === 'UI' && x.basis === 'INFERENCE')) risks.push({ text: 'The link from a UI button to its API call follows an intra-file, name-based call graph (a handler is matched to functions of the same name); it is INFERENCE, not a proven execution path.', basis: 'INFERENCE', evidence: steps.filter((x) => x.layer === 'UI').flatMap((x) => x.evidence).slice(0, 3) })
  risks.push({ text: 'Static analysis only: runtime wiring (dependency injection, reflection, feature flags, event buses, string-built URLs), generated code and anything outside the snapshot are not visible. No code was executed and no model was consulted.', basis: 'UNKNOWN', evidence: [book.add('config', '(analysis)', 'deterministic static analysis; no commands run')] })

  // ---- 14. summary ---------------------------------------------------------------------------------------------------------------------------------------------
  const layers = [...new Set(steps.map((s) => s.layer))]
  const summary: Claim[] = [
    { text: `"${req.target.slice(0, 100)}" resolved to ${owners.length} ${target.kind === 'feature' ? 'candidate owner file(s)' : 'file(s)'} (${target.how}): ${owners.slice(0, 6).join(', ')}${owners.length > 6 ? ', ...' : ''}.`, basis: target.basis, evidence: [book.add('search', owners[0], `target resolution: ${target.how}`)] },
  ]
  if (steps.length > 1) summary.push({ text: `The traced path runs ${steps.map((s) => s.layer).join(' -> ')} across ${steps.length} step(s): ${layers.join(', ')}.`, basis: steps.every((s) => s.basis === 'FACT') ? 'FACT' : 'INFERENCE', evidence: steps.flatMap((s) => s.evidence).slice(0, 8) })
  summary.push({ text: `${primary} is used directly by ${dependentsOf(primary).length} file(s) (imports${ROUTE_RE.test(primary) ? ' and fetch() calls' : ''})${reverseDependents[0]?.transitive.length ? ` and reached transitively by ${reverseDependents[0].transitive.length} more within ${P.reverseHops} hops` : ''}; it directly depends on ${dependencies[0]?.internal.length ?? 0} internal module(s).`, basis: 'FACT', evidence: [book.add('count', primary, 'import graph counts')] })
  const writes = state.storage.filter((s) => ['create', 'change', 'delete', 'db', 'browser-storage'].includes(s.op)).sort((a, b) => Number(/mkdir/i.test(a.api)) - Number(/mkdir/i.test(b.api)))
  if (writes.length) summary.push({ text: `State is written by ${new Set(writes.map((w) => w.file)).size} file(s) in scope, e.g. ${writes[0].file}:${writes[0].line} (${writes[0].api}).`, basis: 'FACT', evidence: writes.slice(0, 3).flatMap((w) => w.evidence) })
  if (routes.length) summary.push({ text: `${routes.length} API route(s) are involved: ${routes.map((r) => `${r.path} [${r.methods.map((m) => m.method).join('/') || 'no exported method'}]`).slice(0, 4).join('; ')}.`, basis: 'FACT', evidence: routes.flatMap((r) => r.evidence).slice(0, 4) })
  summary.push(...impactSummary.slice(0, 2))

  // ---- 15. maps ------------------------------------------------------------------------------------------------------------------------------------------------
  const nid = (f: string) => f
  const mkNode = (f: string): MapNode => ({ id: nid(f), label: path.posix.basename(f), layer: layerOf(f) })
  const flowNodes = steps.map((s) => ({ id: s.file, label: s.label, layer: s.layer }))
  const flowEdges: MapEdge[] = steps.slice(1).map((s, i) => ({ from: steps[i].file, to: s.file, kind: s.via, basis: s.basis, evidence: s.evidence.slice(0, 1) }))
  const flowText = steps.map((s, i) => `${i ? `   ↓ ${s.via}${s.basis !== 'FACT' ? ' (inferred)' : ''}\n` : ''}[${s.layer}] ${s.label}\n       ${s.file}${s.line ? ':' + s.line : ''}`).join('\n')
  const flowMap: MapView | null = steps.length > 0 ? { title: 'Data / call flow (shortest evidenced chain)', nodes: flowNodes, edges: flowEdges, text: flowText, truncated: false } : null

  const treeMap = (title: string, roots: string[], next: (f: string) => string[], cap: number, hops: number, reverse = false): MapView => {
    const nodes = new Map<string, MapNode>(), edges: MapEdge[] = [], lines: string[] = []; let truncated = false
    const visit = (f: string, depth: number, seen: Set<string>) => {
      if (!nodes.has(f)) { if (nodes.size >= cap) { truncated = true; return } nodes.set(f, mkNode(f)) }
      if (depth >= hops) return
      for (const n of next(f)) {
        if (seen.has(n)) continue
        if (nodes.size >= cap && !nodes.has(n)) { truncated = true; lines.push(`${'  '.repeat(depth + 1)}… (more, capped at ${cap} nodes)`); return }
        nodes.set(n, nodes.get(n) ?? mkNode(n))
        // reverse trees list dependents: the dependent n imports (or fetches) f, so the edge is drawn n -> f
        if (!reverse) edges.push({ from: f, to: n, kind: 'import', basis: 'FACT', evidence: [importEv(f, n)] })
        else if ((index.files[n]?.imports ?? []).includes(f)) edges.push({ from: n, to: f, kind: 'import', basis: 'FACT', evidence: [importEv(n, f)] })
        else { const c = (callersOf.get(f) ?? []).find((x) => x.file === n); edges.push({ from: n, to: f, kind: 'fetch', basis: 'FACT', evidence: [book.add('fetch', n, `fetch() of ${routePathOf(f) ?? f}`, c?.call.line)] }) }
        lines.push(`${'  '.repeat(depth + 1)}${f === n ? '' : '└ '}${n}`)
        visit(n, depth + 1, new Set([...seen, n]))
      }
    }
    for (const r of roots) { lines.push(r); visit(r, 0, new Set([r])) }
    return { title, nodes: [...nodes.values()], edges, text: lines.join('\n'), truncated }
  }
  const importsMap = treeMap('Imports (what the target depends on)', owners.slice(0, 3), (f) => (index.files[f]?.imports ?? []).filter((i) => index.files[i]), P.mapNodes, Math.min(P.reverseHops, 3))
  const reverseMap = treeMap('Reverse dependencies (what depends on the target)', owners.slice(0, 3), (f) => dependentsOf(f), P.mapNodes, P.reverseHops, true)
  // reverse edges point dependent -> owner; relabel text direction for readability
  const statesMap: MapView | null = state.states.length ? (() => {
    const nodes: MapNode[] = [], edges: MapEdge[] = []; const vals = new Set<string>()
    for (const s of state.states.slice(0, 3)) for (const v of s.values) vals.add(v)
    for (const v of vals) nodes.push({ id: `state:${v}`, label: v, layer: 'OTHER' })
    for (const a of state.assignments) if (vals.has(a.value)) { const id = `${a.file}:${a.line}`; if (!nodes.some((n) => n.id === id)) nodes.push({ id, label: id, layer: layerOf(a.file) }); edges.push({ from: id, to: `state:${a.value}`, kind: `sets ${a.field}`, basis: 'FACT', evidence: a.evidence }) }
    const text = [...state.states.slice(0, 3).map((s) => `${s.name} (${s.file}:${s.line}): ${s.values.join(' | ')}`), ...edges.slice(0, 30).map((e) => `  ${e.from} --${e.kind}--> ${e.to.replace('state:', '')}`)].join('\n')
    return { title: 'State vocabulary and where values are set (declared vocabulary; transitions are not inferred)', nodes, edges, text, truncated: edges.length > 30 }
  })() : null

  // ---- 16. entry points ----------------------------------------------------------------------------------------------------------------------------------------
  const entryPoints: AnalysisResult['entryPoints'] = []
  for (const f of owners) {
    const l = layerOf(f); const s = sig(f)
    if (l === 'API') for (const m of s.methods) entryPoints.push({ file: f, line: m.line, symbol: m.method, kind: `route handler ${routePathOf(f)}`, claim: { text: `${routePathOf(f)} ${m.method} handler`, basis: 'FACT', evidence: [book.add('route', f, `exports ${m.method}`, m.line)] } })
    else if (l === 'UI' && s.ui.length) for (const u of s.ui.slice(0, P.listCap)) entryPoints.push({ file: f, line: u.line, symbol: u.handler ?? undefined, kind: `UI ${u.event}`, claim: { text: `"${u.label}" ${u.event}${u.handler ? ' calls ' + u.handler : ''}`, basis: 'FACT', evidence: [book.add('ui', f, `${u.event} on "${u.label}"`, u.line)] } })
    else {
      const exp = (index.files[f]?.symbols ?? []).filter((x) => x.exported).slice(0, 4)
      const external = dependentsOf(f).filter((d) => !owners.includes(d)).length
      if (exp.length) for (const x of exp) { symbolsInspected.add(x.name); entryPoints.push({ file: f, line: x.line, symbol: x.name, kind: `exported ${x.kind}`, claim: { text: `${x.name} (exported ${x.kind}) - used by ${external} file(s) outside the target`, basis: 'FACT', evidence: [book.add('symbol', f, `exports ${x.name}`, x.line, x.name)] } }) }
      else entryPoints.push({ file: f, kind: 'file', claim: { text: `${f} exports no symbols (script or side-effect module)`, basis: 'FACT', evidence: [book.add('file', f, 'no exports')] } })
    }
  }

  // ---- 17. handoff ---------------------------------------------------------------------------------------------------------------------------------------------
  const nonTestOwners = owners.filter((o) => !isTestFile(o))
  const seedPaths = [...new Set([...nonTestOwners, ...dependencies.flatMap((d) => d.internal.map((i) => i.path)).slice(0, 12), ...tests.relevant.map((t) => t.path).slice(0, 8)])].slice(0, 30)
  const handoff = {
    seedPaths, targetFiles: nonTestOwners.slice(0, 12), tests: tests.relevant.map((t) => t.path).slice(0, 8),
    contextLines: [
      `Reverse Engineer: ${owners.length} owner file(s): ${owners.slice(0, 5).join(', ')}`,
      steps.length > 1 ? `Flow: ${steps.map((s) => `${s.layer}:${path.posix.basename(s.file)}`).join(' > ')}` : '',
      routes.length ? `Routes: ${routes.map((r) => `${r.path} [${r.methods.map((m) => m.method).join('/')}]`).slice(0, 4).join('; ')}` : '',
      perOwner[0] ? `Impact of ${perOwner[0].file}: ${perOwner[0].transitiveDependents} dependents, risk ${perOwner[0].risk}` : '',
      tests.relevant.length ? `Tests: ${tests.relevant.map((t) => t.path).slice(0, 4).join(', ')}` : 'Tests: none found for the owners',
      state.storage.some((s) => s.op === 'create' || s.op === 'change') ? `Writes state at: ${[...new Set(state.storage.filter((s) => s.op === 'create' || s.op === 'change').map((s) => s.file))].slice(0, 3).join(', ')}` : '',
    ].filter(Boolean),
  }
  for (const s of steps) symbolsInspected.add(s.label.split(' ')[0])
  const result: AnalysisResult = { summary, entryPoints, flow: steps, dependencies, reverseDependents, state, routes, ui, tests, changeImpact, risks, maps: { flow: flowMap, imports: importsMap, reverse: reverseMap, states: statesMap } }
  const cited = new Set(JSON.stringify(result).match(/"E\d+"/g)?.map((x) => x.slice(1, -1)) ?? [])
  return {
    target,
    result: { summary, entryPoints, flow: steps, dependencies, reverseDependents, state, routes, ui, tests, changeImpact, risks, maps: { flow: flowMap, imports: importsMap, reverse: reverseMap, states: statesMap } },
    evidence: book.list.filter((e) => cited.has(e.id)),
    provenance: { filesInspected: [...inspected].sort(), symbolsInspected: [...symbolsInspected].slice(0, 80), routesInspected: [...routesInspected].sort(), methods, deterministicTools: ['typescript compiler API (AST)', 'foundryCodeIntelligence index', 'in-memory import graph', 'sha256 snapshot fingerprint'] },
    handoff,
  }
}

function emptyOutput(target: ResolvedTarget, risks: Claim[], book: Book, snap: Snapshot, methods: string[]): AnalysisOutput {
  return {
    target,
    result: { summary: [{ text: 'The target could not be resolved; no analysis was produced.', basis: 'UNKNOWN', evidence: risks[0]?.evidence ?? [] }], entryPoints: [], flow: [], dependencies: [], reverseDependents: [], state: { states: [], assignments: [], storage: [] }, routes: [], ui: [], tests: { relevant: [], missing: [] }, changeImpact: { perOwner: [], summary: [] }, risks, maps: { flow: null, imports: null, reverse: null, states: null } },
    evidence: book.list, provenance: { filesInspected: [], symbolsInspected: [], routesInspected: [], methods, deterministicTools: ['typescript compiler API (AST)', 'foundryCodeIntelligence index'] },
    handoff: { seedPaths: [], targetFiles: [], tests: [], contextLines: [] },
  }
}

/** Target resolution, most specific first: file path, directory, API route, exact symbol, then ranked ownership for a natural-language description. */
export function resolveTarget(input: string, listed: string[], index: FoundryCodeIndex, ownersCap: number, book: Book, symbolsInspected: Set<string>): ResolvedTarget {
  const text = input.trim()
  const fileSet = new Set(listed)
  const norm = (s: string) => s.replace(/^\.\//, '').replace(/^\/+/, '').replace(/\\/g, '/')
  const tokens = text.split(/[\s,;()"'`]+/).filter(Boolean).map((t) => t.replace(/[.:]+$/, ''))
  const lineSuffix = (t: string) => t.replace(/:\d+(:\d+)?$/, '')
  // 1. an exact file path (whole input or a token inside a sentence)
  const paths = [...new Set([text, ...tokens].map((t) => norm(lineSuffix(t))).filter((t) => fileSet.has(t)))]
  if (paths.length) { const whole = norm(lineSuffix(text)) === paths[0]; book.add('file', paths[0], `target names this file`); return { input, kind: 'file', owners: paths.slice(0, ownersCap), how: whole ? 'exact file path' : 'file path mentioned inside a description', basis: whole ? 'FACT' : 'INFERENCE', candidates: [] } }
  // 2. a directory prefix
  const dirTok = [text, ...tokens].map((t) => norm(t).replace(/\/+$/, '')).find((t) => t.includes('/') && !t.startsWith('api/') && listed.some((f) => f.startsWith(t + '/')))
  if (dirTok) {
    const members = listed.filter((f) => f.startsWith(dirTok + '/') && !isTestFile(f))
    const ranked = members.map((f) => ({ f, n: (index.dependents[f] ?? []).length })).sort((a, b) => b.n - a.n || a.f.localeCompare(b.f)).slice(0, Math.max(ownersCap * 3, 8)).map((x) => x.f)
    book.add('file', dirTok, `directory with ${members.length} source file(s)`)
    return { input, kind: 'group', owners: ranked, how: `directory ${dirTok} (${members.length} files; the ${ranked.length} most-depended-on are the owners)`, basis: norm(text).replace(/\/+$/, '') === dirTok ? 'FACT' : 'INFERENCE', candidates: [] }
  }
  // 3. an API route (/api/...)
  const routeTok = [text, ...tokens].find((t) => /^\/api\/[\w\-./\[\]]+$/.test(t))
  if (routeTok) {
    const want = routeTok.replace(/\/+$/, '')
    const hits = listed.filter((f) => ROUTE_RE.test(f)).filter((f) => routePathOf(f) === want || urlToRegex(routePathOf(f)!).test(want))
    if (hits.length) { book.add('route', hits[0], `route ${routePathOf(hits[0])}`); return { input, kind: 'route', owners: hits.slice(0, ownersCap), how: `API route ${want}`, basis: 'FACT', candidates: [] } }
  }
  // 4. exact exported symbol(s)
  const symToks = [...new Set(tokens.filter((t) => /^[A-Za-z_$][\w$]{3,}$/.test(t) && Object.hasOwn(index.symbols, t) && Array.isArray(index.symbols[t])))]
  const exported = symToks.filter((t) => lookupSymbol(index, t).definitions.length && lookupSymbol(index, t).definitions.length <= 3)
  if (exported.length && exported.length <= 3 && (symToks.length === tokens.length || tokens.length <= 4)) {
    const owners = [...new Set(exported.flatMap((t) => lookupSymbol(index, t).definitions.map((d) => d.path)))]
    for (const t of exported) { symbolsInspected.add(t); const d = lookupSymbol(index, t).definitions[0]; book.add('symbol', d.path, `defines ${t} (${d.kind})`, d.line, t) }
    return { input, kind: 'symbol', owners: owners.slice(0, ownersCap), how: `symbol ${exported.join(', ')}`, basis: 'FACT', candidates: [] }
  }
  // 5. natural-language ownership. The shared ranker (rankOwnersFromIndex) adds structural bonuses (components, routes, dependents) that score even a nonsense query highly,
  //    so it is only used to ORDER candidates that first pass a relevance gate: the file must actually contain the query's significant terms.
  const terms = significantTerms(text)
  if (!terms.length) return { input, kind: 'unresolved', owners: [], how: 'the description contains no searchable terms', basis: 'UNKNOWN', candidates: [] }
  const ranked = new Map(rankOwnersFromIndex(text, index).map((r) => [r.path, r.score]))
  const scored = listed.filter((f) => !isTestFile(f) && index.files[f]).map((f) => {
    const fi = index.files[f]
    const pathText = f.toLowerCase()
    const names = [...fi.symbols.map((x) => x.name), ...fi.exports, fi.api ?? '', fi.route ?? ''].join(' ').toLowerCase()
    const body = [...(fi.literals ?? []), ...(fi.bindings ?? [])].join(' ').toLowerCase()
    let matched = 0, weight = 0
    for (const t of terms) {
      const inPath = pathText.includes(t), inNames = names.includes(t), inBody = body.includes(t)
      if (inPath || inNames || inBody) { matched += 1; weight += (inPath ? 3 : 0) + (inNames ? 2 : 0) + (inBody ? 1 : 0) }
    }
    return { path: f, matched, weight, score: ranked.get(f) ?? 0 }
  }).filter((x) => x.matched >= Math.max(1, Math.ceil(terms.length * 0.5)))
  if (!scored.length) return { input, kind: 'unresolved', owners: [], how: `no file contains the terms [${terms.join(', ')}]`, basis: 'UNKNOWN', candidates: [] }
  scored.sort((a, b) => b.matched - a.matched || b.weight - a.weight || b.score - a.score || a.path.localeCompare(b.path))
  const topMatched = scored[0].matched
  const picked = scored.filter((x) => x.matched === topMatched).slice(0, ownersCap)
  return { input, kind: 'feature', owners: picked.map((p) => p.path), how: `terms [${terms.join(', ')}] matched in ${topMatched}/${terms.length} (paths, symbols, string literals, bindings), ordered by the Foundry ownership score`, basis: 'INFERENCE', candidates: scored.slice(0, 10).map((x) => ({ path: x.path, score: x.matched * 100 + x.weight })) }
}

const STOP = new Set('the and for with from that this these those what when where which why how does did are was were has have had can could should would will not but all any its into onto out off over under about each every also than then them they their there here you your our who whom whose via per use used using explain show trace map find reverse engineer analyze analyse describe understand tell work works working feature subsystem please like need want make'.split(' '))
/** Lower-cased, lightly stemmed terms from a free-text description. */
export function significantTerms(text: string): string[] {
  const raw = text.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !STOP.has(t))
  const stem = (t: string) => t.length > 5 ? t.replace(/(ations?|ation|ings?|ing|edly|ed|ers?|es|s)$/, '') : t.replace(/s$/, '')
  return [...new Set(raw.map(stem).filter((t) => t.length >= 3))].slice(0, 8)
}
