import { readFileSync } from 'node:fs'
import path from 'node:path'
import { IS_TEST, type FileEntry, type WorkspaceIndex } from './workspaceIndex'

export type LayerName = 'ui' | 'api' | 'domain' | 'storage' | 'tests' | 'config'
export type PlanEvidence = { kind: 'definition' | 'route' | 'storage' | 'import' | 'dependent' | 'test' | 'script' | 'path' | 'consumer' | 'mention-only'; file: string; line?: number; detail: string }
export type PlanFile = { path: string; layers: LayerName[]; role: 'implementation' | 'dependency' | 'dependent' | 'consumer'; score: number; why: PlanEvidence[]; action: 'modify' | 'inspect' }
export type Slice = { order: number; layer: LayerName; title: string; files: { path: string; action: 'modify' | 'create'; rationale: string }[]; validation: string[] }
export type EngineeringCodePlan = {
  request: string
  /** Keywords used ONLY to find where to look. They never decide the plan by themselves. */
  discoverySeeds: string[]
  what: string[]
  where: PlanFile[]
  dependsOnIt: PlanFile[]
  otherLayers: { layer: LayerName; files: string[]; reason: string }[]
  testsNow: { test: string; covers: string; how: 'imports' | 'naming' }[]
  testsToProve: { target: string; why: string; existing: string | null; proposedPath: string | null }[]
  runtimeEvidence: { kind: 'route' | 'page' | 'persistence' | 'command'; detail: string; file?: string }[]
  commands: { typecheck: string | null; test: string[]; start: string | null }
  slices: Slice[]
  evidence: PlanEvidence[]
  misleading: { term: string; file: string; why: string }[]
  uncertainties: string[]
  ranking: { evidence: string[]; naiveKeywordFrequency: string[]; diverges: boolean }
  index: { fileCount: number; truncated: boolean; builtAt: string }
}

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'should', 'would', 'could', 'make', 'add', 'update', 'change', 'new', 'feature', 'user', 'users', 'when', 'then', 'also', 'can', 'have', 'has', 'let', 'allow', 'show', 'work', 'works', 'use', 'using', 'please', 'want', 'need', 'each', 'every', 'all', 'any', 'its', 'are', 'was', 'not', 'but', 'get', 'set', 'page', 'app', 'application', 'support', 'ability', 'how', 'many', 'were', 'been', 'which', 'what', 'where', 'much', 'some', 'more', 'than', 'they', 'them', 'there', 'about', 'over', 'under', 'after', 'before', 'while', 'being', 'does', 'did', 'have', 'had', 'will', 'shall', 'may', 'might', 'via', 'per', 'out', 'off', 'own', 'one', 'two', 'number'])
const split = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
const norm = (t: string) => {
  let x = t
  if (x.length > 4 && x.endsWith('ies')) x = x.slice(0, -3) + 'y'
  else if (x.length > 3 && x.endsWith('s') && !x.endsWith('ss')) x = x.slice(0, -1)
  if (x.length > 5 && x.endsWith('ing')) x = x.slice(0, -3)
  else if (x.length > 4 && x.endsWith('ed')) x = x.slice(0, -2)
  return x
}
export function seedsFrom(request: string, hints: string[] = []): string[] {
  const out = new Set<string>()
  for (const t of [...split(request), ...hints.flatMap(split)]) { const n = norm(t); if (n.length >= 3 && !STOP.has(n) && !STOP.has(t)) out.add(n) }
  return [...out].slice(0, 16)
}
const tokenMatch = (tokens: string[], seed: string) => tokens.some((t) => norm(t) === seed || (seed.length >= 5 && t.startsWith(seed)))

export function layersOf(f: FileEntry): LayerName[] {
  const l: LayerName[] = []
  if (f.kind === 'test') return ['tests']
  if (f.kind === 'config') return ['config']
  if (f.apiRefs.some((a) => a.role === 'serves') || f.routeMethods.length || f.nodeImports.some((n) => /^(node:)?http(s)?$|^express$|^fastify$|^koa$/.test(n))) l.push('api')
  if (f.hasJsx || f.isHtml || f.apiRefs.some((a) => a.role === 'calls')) l.push('ui')
  if (f.storageRefs.some((s) => s.op !== 'read' || (s.path && /\.(json|jsonl|db|sqlite|sql|csv)$/i.test(s.path))) || f.kind === 'data') l.push('storage')
  if (!l.length && f.decls.some((d) => d.hasBody)) l.push('domain')
  if (l.length && f.decls.filter((d) => d.hasBody).length >= 2 && !l.includes('domain') && !(l.includes('ui') && f.hasJsx)) { /* mixed files keep their evidenced layers only */ }
  return l
}

type Scored = { f: FileEntry; score: number; why: PlanEvidence[]; mentionOnly: string[] }

export function planFromCode(index: WorkspaceIndex, input: { request: string; acceptance?: string[]; hints?: string[]; kind?: 'feature' | 'repair' }): EngineeringCodePlan {
  const seeds = seedsFrom(input.request, input.hints)
  const all = Object.values(index.files)
  const sourceFiles = all.filter((f) => f.kind === 'source' || f.kind === 'data')
  const scored = new Map<string, Scored>()
  const get = (f: FileEntry) => { let s = scored.get(f.path); if (!s) { s = { f, score: 0, why: [], mentionOnly: [] }; scored.set(f.path, s) } return s }
  // pass 1: which seeds have evidence where (document frequency): generic words must not dominate
  type Hit = { seed: string; kind: PlanEvidence['kind']; w: number; line?: number; detail: string }
  const hits = new Map<string, Hit[]>()
  const push = (f: FileEntry, h: Hit) => { (hits.get(f.path) ?? hits.set(f.path, []).get(f.path)!).push(h) }
  for (const f of all) {
    if (f.kind === 'doc') continue
    const pathTokens = split(f.path)
    for (const seed of seeds) {
      for (const d of f.decls) if (tokenMatch(split(d.name), seed)) push(f, { seed, kind: 'definition', w: (d.hasBody ? 3 : 1) + (d.exported ? 1 : 0), line: d.line, detail: `${d.kind} ${d.name}${d.exported ? ' (exported)' : ''} matches "${seed}"` })
      if (tokenMatch(pathTokens, seed)) push(f, { seed, kind: 'path', w: 1.5, detail: `path segment matches "${seed}"` })
      for (const a of f.apiRefs) if (tokenMatch(split(a.path), seed)) push(f, { seed, kind: 'route', w: a.role === 'serves' ? 2.5 : 1, line: a.line, detail: `${a.role} ${a.method ? a.method + ' ' : ''}${a.path} matches "${seed}"` })
      for (const st of f.storageRefs) if (st.path && tokenMatch(split(st.path), seed)) push(f, { seed, kind: 'storage', w: 2.5, line: st.line, detail: `${st.op} ${st.path} matches "${seed}"` })
    }
  }
  const df: Record<string, number> = Object.create(null)
  for (const list of hits.values()) for (const sd of new Set(list.map((h) => h.seed))) df[sd] = (df[sd] ?? 0) + 1
  const N = Math.max(1, sourceFiles.length)
  const idf = (sd: string) => Math.log(1 + N / (1 + (df[sd] ?? 0)))
  const maxIdf = Math.max(0.0001, ...seeds.filter((sd) => df[sd]).map(idf))
  const mult = (sd: string) => 0.4 + 1.6 * (idf(sd) / maxIdf)
  for (const [path_, list] of hits) {
    const f = index.files[path_]
    const s = get(f)
    // repeated hits of the same term/kind in one file (e.g. a manifest listing many paths) have sharply diminishing value
    const seen: Record<string, number> = Object.create(null)
    for (const h of list.sort((a, b) => b.w - a.w)) {
      const k = `${h.seed}|${h.kind}`
      const n = (seen[k] = (seen[k] ?? 0) + 1)
      const factor = n === 1 ? 1 : n <= 4 ? 0.3 : 0.02
      s.score += h.w * mult(h.seed) * factor
      if (n <= 2) s.why.push({ kind: h.kind, file: f.path, line: h.line, detail: h.detail })
    }
    const distinct = new Set(list.map((h) => h.seed)).size
    if (distinct > 1) { s.score += 1.5 * (distinct - 1); s.why.push({ kind: 'path', file: f.path, detail: `covers ${distinct} distinct request terms (${[...new Set(list.map((h) => h.seed))].join(', ')})` }) }
  }
  // mention-only: keyword appears only in comments / labels / strings of a file that has no definition/path/route/storage evidence for it
  for (const f of all) {
    if (f.kind === 'doc' || !f.mentionText) continue
    const evSeeds = new Set((hits.get(f.path) ?? []).map((h) => h.seed))
    const only = seeds.filter((seed) => f.mentionText.includes(seed) && !evSeeds.has(seed))
    if (only.length) { const x = get(f); x.mentionOnly = only; x.why.push({ kind: 'mention-only', file: f.path, detail: `"${only.join('", "')}" appear only in comments/labels/strings, not in any definition, route, storage or path` }) }
  }
  // graph proximity from the strongest anchors
  const maxScore = Math.max(0, ...[...scored.values()].map((s) => s.score))
  const anchors = [...scored.values()].filter((s) => s.score >= Math.max(3, maxScore * 0.4)).sort((a, b) => b.score - a.score).slice(0, 4)
  for (const a of anchors) {
    for (const i of a.f.imports) { const t = i.resolved && index.files[i.resolved]; if (t && t.kind === 'source') { const s = get(t); s.score += 1; s.why.push({ kind: 'import', file: t.path, detail: `imported by ${a.f.path}` }) } }
    for (const dep of index.dependents[a.f.path] ?? []) { const t = index.files[dep]; if (t && t.kind === 'source') { const s = get(t); s.score += 0.75; s.why.push({ kind: 'dependent', file: t.path, detail: `imports ${a.f.path}` }) } }
  }
  const behaviour = (f: FileEntry) => f.decls.some((d) => d.hasBody) || f.routeMethods.length > 0 || f.storageRefs.length > 0 || f.apiRefs.length > 0
  const ranked = [...scored.values()].filter((s) => s.f.kind === 'source' && behaviour(s.f)).sort((a, b) => b.score - a.score || a.f.path.localeCompare(b.f.path))
  const topScore = ranked[0]?.score ?? 0
  const isImpl = (s: Scored) => s.why.some((w) => w.kind === 'definition' || w.kind === 'storage' || (w.kind === 'route' && w.detail.startsWith('serves')))
  // strong text evidence stands alone; weaker evidence counts only when it is structurally attached to the two best anchors
  const topTwo = ranked.filter(isImpl).slice(0, 2)
  const adjacent = new Set<string>(topTwo.flatMap((a) => [...(index.dependents[a.f.path] ?? []), ...a.f.imports.map((i) => i.resolved).filter((x): x is string => !!x)]))
  const impl = ranked.filter((s) => isImpl(s) && s.score >= 2.5 && (s.score >= topScore * 0.5 || adjacent.has(s.f.path) || topTwo.some((a) => a.f.path === s.f.path) || s.why.some((w) => w.kind === 'storage') && s.score >= topScore * 0.3)).slice(0, 8)
  const toFile = (s: Scored, role: PlanFile['role'], action: PlanFile['action']): PlanFile => ({ path: s.f.path, layers: layersOf(s.f), role, score: Math.round(s.score * 100) / 100, why: s.why.filter((w) => w.kind !== 'mention-only').slice(0, 6), action })
  // cross-layer links: UI/clients that call an implemented route, and routes called by implemented clients
  const normP = (p: string) => p.replace(/\/$/, '')
  for (const s of impl) for (const ar of s.f.apiRefs) for (const other of all) {
    if (other === s.f || other.kind !== 'source') continue
    if (other.apiRefs.some((o) => normP(o.path) === normP(ar.path) && o.role !== ar.role)) { const t = get(other); if (!t.why.some((w) => w.kind === 'consumer' && w.detail.includes(`(linked to ${s.f.path})`))) { t.score += 1.5; t.why.push({ kind: 'consumer', file: other.path, detail: `${ar.role === 'serves' ? 'calls' : 'serves'} ${normP(ar.path)} (linked to ${s.f.path})` }) } }
  }
  const where = impl.map((s) => toFile(s, 'implementation', 'modify'))
  const implSet = new Set(where.map((w) => w.path))
  const dependsOnIt: PlanFile[] = [...new Set(impl.flatMap((s) => index.dependents[s.f.path] ?? []))].filter((p) => !implSet.has(p) && index.files[p]?.kind === 'source').map((p) => toFile(get(index.files[p]), 'dependent', 'inspect')).slice(0, 12)
  for (const s of [...scored.values()].filter((x) => x.f.kind === 'source').sort((a, b) => b.score - a.score)) if (!implSet.has(s.f.path) && s.why.some((w) => w.kind === 'consumer') && !dependsOnIt.some((d) => d.path === s.f.path)) dependsOnIt.push(toFile(s, 'consumer', 'modify'))
  // the page that hosts a consumer client script is part of the UI surface that must change with it
  for (const c of [...where, ...dependsOnIt].filter((d) => d.role === 'consumer' || d.layers.includes('ui'))) for (const host of index.dependents[c.path] ?? []) if (index.files[host]?.isHtml && !implSet.has(host) && !dependsOnIt.some((d) => d.path === host)) { const hs = get(index.files[host]); hs.why.push({ kind: 'consumer', file: host, detail: `loads ${c.path}` }); dependsOnIt.push(toFile(hs, 'consumer', 'modify')) }

  // naive keyword frequency baseline (what planning from request wording alone would do)
  const texts = new Map<string, string>()
  for (const f of all) if (f.kind === 'source') { try { texts.set(f.path, readFileSync(path.join(index.root, f.path), 'utf8').toLowerCase()) } catch { /* unreadable */ } }
  const ndf: Record<string, number> = Object.create(null)
  for (const sd of seeds) ndf[sd] = [...texts.values()].filter((t) => t.includes(sd)).length
  const naive = [...texts.entries()].map(([p, t]) => ({ path: p, n: Math.round(seeds.reduce((acc, sd) => acc + Math.log(1 + (t.split(sd).length - 1)) * Math.log(1 + texts.size / (1 + ndf[sd])), 0) * 100) / 100 })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n || a.path.localeCompare(b.path)).slice(0, 5)
  const evidenceTop = where.slice(0, 3).map((w) => w.path)
  const misleading: EngineeringCodePlan['misleading'] = []
  for (const n of naive.slice(0, 3)) {
    const s = scored.get(n.path)
    if (!implSet.has(n.path) && (!s || s.mentionOnly.length || s.score < 2.5)) misleading.push({ term: seeds.find((sd) => (s?.mentionOnly ?? []).includes(sd)) ?? seeds[0] ?? '', file: n.path, why: `a keyword-retrieval planner (TF-IDF score ${n.n}) would rank it, but code evidence shows no matching behavior there${s?.mentionOnly.length ? ` (mentions only: ${s.mentionOnly.join(', ')})` : ''}` })
  }

  // layers
  const layerFiles = new Map<LayerName, Set<string>>()
  const addLayer = (f: FileEntry) => { for (const l of layersOf(f)) (layerFiles.get(l) ?? layerFiles.set(l, new Set()).get(l)!).add(f.path) }
  for (const w of [...where, ...dependsOnIt]) addLayer(index.files[w.path])
  const otherLayers = [...layerFiles.entries()].map(([layer, set]) => ({ layer, files: [...set], reason: layer === 'ui' ? 'a consumer or UI surface depends on the changed behavior' : layer === 'api' ? 'an API route serves or is called by the changed behavior' : layer === 'storage' ? 'persisted data is read or written by the changed behavior' : 'implements the changed behavior' }))

  // tests
  const touched = [...implSet, ...dependsOnIt.map((d) => d.path)]
  const testsNow: EngineeringCodePlan['testsNow'] = []
  for (const p of touched) for (const t of index.testsFor[p] ?? []) if (!testsNow.some((x) => x.test === t && x.covers === p)) testsNow.push({ test: t, covers: p, how: 'imports' })
  for (const p of touched) { const base = p.replace(/\.(ts|tsx|js|mjs|jsx)$/, ''); for (const t of all) if (t.kind === 'test' && t.path.replace(/\.(test|spec|validation)\.(ts|tsx|js|mjs|jsx)$/, '') === base && !testsNow.some((x) => x.test === t.path && x.covers === p)) testsNow.push({ test: t.path, covers: p, how: 'naming' }) }
  const testDirs = [...new Set(all.filter((f) => f.kind === 'test').map((f) => path.posix.dirname(f.path)))]
  const proposeTest = (p: string) => { const ext = /\.mjs$/.test(p) ? 'mjs' : /\.tsx?$/.test(p) ? 'ts' : 'js'; const dir = testDirs.includes(path.posix.dirname(p)) || !testDirs.length ? path.posix.dirname(p) : testDirs[0]; return `${dir === '.' ? '' : dir + '/'}${path.posix.basename(p).replace(/\.\w+$/, '')}.test.${ext}` }
  const testsToProve: EngineeringCodePlan['testsToProve'] = where.map((w) => {
    const ex = testsNow.find((t) => t.covers === w.path)
    return { target: w.path, why: ex ? `existing test ${ex.test} establishes current behavior; extend it to prove the change` : 'no existing test imports this file: current behavior is unproven, add a test before/with the change', existing: ex?.test ?? null, proposedPath: ex ? null : proposeTest(w.path) }
  })
  for (const a of input.acceptance ?? []) testsToProve.push({ target: `acceptance: ${a.slice(0, 120)}`, why: 'acceptance criterion must be proven by an executable check', existing: null, proposedPath: null })

  // commands + runtime
  const sc = index.scripts
  const testScripts = Object.entries(sc).filter(([k, v]) => /test|validat|check/.test(k) && testsNow.some((t) => v.includes(t.test) || v.includes(path.posix.basename(t.test)))).map(([k]) => k)
  const typecheck = index.hasTsconfig ? 'npx tsc --noEmit --incremental false' : null
  const startScript = Object.keys(sc).find((k) => /^(start|dev|serve)$/.test(k)) ?? null
  const runtimeEvidence: EngineeringCodePlan['runtimeEvidence'] = []
  for (const w of [...where, ...dependsOnIt]) {
    const f = index.files[w.path]
    for (const a of f.apiRefs.filter((x) => x.role === 'serves')) runtimeEvidence.push({ kind: 'route', detail: `${a.method ?? ''} ${a.path}`.trim(), file: f.path })
    for (const s of f.storageRefs.filter((x) => x.path)) runtimeEvidence.push({ kind: 'persistence', detail: s.path!, file: f.path })
    if (f.hasJsx || f.isHtml) runtimeEvidence.push({ kind: 'page', detail: f.path, file: f.path })
  }
  if (startScript) runtimeEvidence.push({ kind: 'command', detail: `${startScript}: ${sc[startScript]}` })
  const dedupRuntime = runtimeEvidence.filter((r, i, a) => a.findIndex((x) => x.kind === r.kind && x.detail === r.detail) === i)

  // slices (feature): storage -> domain -> api -> ui -> tests
  const order: LayerName[] = ['storage', 'domain', 'api', 'ui', 'tests']
  const slices: Slice[] = []
  if ((input.kind ?? 'feature') === 'feature') {
    for (const layer of order) {
      const files: Slice['files'] = [...where, ...dependsOnIt]
        .filter((w) => w.action === 'modify' && !!index.files[w.path] && layersOf(index.files[w.path]).includes(layer))
        .map((w) => ({ path: w.path, action: 'modify' as const, rationale: w.why[0]?.detail ?? 'depends on the changed behavior' }))
      // new tests are proposed for code a worker can test directly; HTTP/UI layers are proven by runtime checks and acceptance criteria
      if (layer === 'tests') for (const t of testsToProve.filter((x) => x.proposedPath && index.files[x.target] && !layersOf(index.files[x.target]).some((l) => l === 'api' || l === 'ui'))) files.push({ path: t.proposedPath!, action: 'create' as const, rationale: t.why })
      if (layer === 'tests') for (const t of testsToProve.filter((x) => x.existing)) if (!files.some((f) => f.path === t.existing)) files.push({ path: t.existing!, action: 'modify' as const, rationale: t.why })
      if (!files.length) continue
      const checks = [...(typecheck ? [typecheck] : files.filter((f) => /\.m?js$/.test(f.path)).map((f) => `node --check ${f.path}`)), ...(layer === 'tests' || layer === 'domain' || layer === 'api' ? testScripts.map((s) => `${index.pm} run ${s}`) : [])]
      slices.push({ order: slices.length + 1, layer, title: `${layer}: ${files.map((f) => path.posix.basename(f.path)).join(', ')}`, files: orderByDeps(dedupFiles(files), index), validation: checks })
    }
  }

  const uncertainties: string[] = []
  if (!all.length) uncertainties.push('NO CODE EVIDENCE: the workspace contains no indexable source files (greenfield)')
  if (index.truncated) uncertainties.push(`index truncated at ${index.fileCount} files: some code was not inspected`)
  if (!where.length && all.length) uncertainties.push('UNDETERMINED: no file has definition/route/storage evidence matching the request; refine the request or hints before editing')
  if (where.length >= 4 && where[where.length - 1].score >= where[0].score * 0.6 && where.filter((w) => w.why.some((x) => x.kind === 'definition')).length === where.length) uncertainties.push(`AMBIGUOUS: ${where.length} files score within 60% of the best match on generic request terms; add file/symbol hints before editing beyond ${where[0].path}`)
  if (!index.hasTsconfig && all.some((f) => /\.tsx?$/.test(f.path))) uncertainties.push('TypeScript files without a tsconfig.json: type diagnostics UNAVAILABLE')
  if (!Object.keys(sc).length) uncertainties.push('no package.json scripts found: test and start commands UNKNOWN')
  const what = [
    `Behavior to change (from the request, localized by code evidence): ${input.request.trim().slice(0, 240)}`,
    ...where.slice(0, 3).map((w) => `${w.path} implements it (${w.why[0]?.detail ?? 'evidence'})`),
  ]
  return {
    request: input.request, discoverySeeds: seeds, what, where, dependsOnIt, otherLayers, testsNow, testsToProve,
    runtimeEvidence: dedupRuntime, commands: { typecheck, test: testScripts.map((s) => `${index.pm} run ${s}`), start: startScript ? `${index.pm} run ${startScript}` : null },
    slices, evidence: [...where, ...dependsOnIt].flatMap((w) => w.why).slice(0, 40), misleading, uncertainties,
    ranking: { evidence: where.map((w) => w.path), naiveKeywordFrequency: naive.map((n) => n.path), diverges: !!naive[0] && !!evidenceTop[0] && naive[0].path !== evidenceTop[0] },
    index: { fileCount: index.fileCount, truncated: index.truncated, builtAt: index.builtAt },
  }
}
/** Files that others in the same slice import come first. */
function orderByDeps(files: Slice['files'], index: WorkspaceIndex): Slice['files'] {
  const paths = new Set(files.map((f) => f.path))
  const dependsOn = (p: string) => new Set((index.files[p]?.imports ?? []).map((i) => i.resolved).filter((x): x is string => !!x && paths.has(x)))
  const out: Slice['files'] = []
  const done = new Set<string>()
  const visit = (f: Slice['files'][number], stack: Set<string>) => {
    if (done.has(f.path) || stack.has(f.path)) return
    stack.add(f.path)
    for (const d of dependsOn(f.path)) { const df = files.find((x) => x.path === d); if (df) visit(df, stack) }
    done.add(f.path); out.push(f)
  }
  for (const f of files) visit(f, new Set())
  return out
}
const dedupFiles = (f: Slice['files']) => f.filter((x, i, a) => a.findIndex((y) => y.path === x.path && y.action === x.action) === i)

/** Compact planning context for a model: what was selected and why (bounded). */
export function planContextForModel(plan: EngineeringCodePlan, maxChars = 3000): string {
  const lines = [
    `REQUEST: ${plan.request}`,
    `WHERE: ${plan.where.map((w) => `${w.path} [${w.layers.join('/')}] — ${w.why[0]?.detail ?? ''}`).join('; ')}`,
    `DEPENDENTS: ${plan.dependsOnIt.map((d) => d.path).join(', ') || 'none found'}`,
    `TESTS NOW: ${plan.testsNow.map((t) => `${t.test}→${t.covers}`).join(', ') || 'none'}`,
    `RUNTIME: ${plan.runtimeEvidence.map((r) => `${r.kind}:${r.detail}`).join(', ') || 'UNKNOWN'}`,
    plan.misleading.length ? `NOT THE PLACE (keyword-only): ${plan.misleading.map((m) => m.file).join(', ')}` : '',
    plan.uncertainties.length ? `UNCERTAIN: ${plan.uncertainties.join(' | ')}` : '',
  ].filter(Boolean)
  return lines.join('\n').slice(0, maxChars)
}
export { IS_TEST }
