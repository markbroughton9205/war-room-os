/**
 * FOUNDRY FIRST-PASS CORRECTNESS LAW (part 1): the implementation contract.
 *
 * Before any source file is touched, the acceptance criteria are turned into ONE structured, deterministic contract: required behaviors, routes, response/status
 * requirements, state transitions and flags, filters, response shapes, persistence (storage variable, default path, restart, id monotonicity), UI elements, error cases
 * and compatibility constraints. The builder works from this contract; it is never asked to re-infer these facts during repair.
 *
 * Nothing here knows an entity name, a route name or a field name: every value is read from the criteria text. A fact that cannot be read is simply absent, and a
 * criterion whose meaning cannot be established is reported as an AMBIGUITY (resolved by a recorded rule, or the build does not start).
 */
import { storageEnvVars, wantsPersistence } from './persistenceContract'

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
export type BehaviorCategory = 'ROUTE' | 'STATUS' | 'STATE' | 'FILTER' | 'COUNTER' | 'PERSISTENCE' | 'UI' | 'COMPAT' | 'TEST' | 'OTHER'
export type ContractRoute = { id: string; method: Method; path: string; sample: string; criterion: number; statuses: number[]; params: string[]; shape: Record<string, 'n' | 'string' | 'boolean' | 'unknown'> | null; compat: boolean; createsRecord: boolean; /** PATCH/PUT body field named by the contract, e.g. {"status": ...} */ bodyField: string | null; /** the contract says repeating the action is harmless */ idempotent: boolean }
/** A state change that forbids other actions: after `setter` has run on an item, each `blocked` route must answer `status`. */
export type ContractConflict = { setter: string; flag: string; blocked: string[]; status: number; criterion: number }
export type ContractStatus = { status: number; criterion: number; clause: string; route: string | null }
/** A requirement on a per-item boolean flag, read from prose like "only unread alerts that are not archived" (unread = read false; not archived = archived false). */
export type FlagRequirement = { flag: string; value: boolean }
export type ContractFilterRule = { param: string; value: string; requires: FlagRequirement[]; everything: boolean; clause: string; criterion: number }
export type ContractDefaultView = { route: string; requires: FlagRequirement[]; clause: string; criterion: number }
export type ContractFilter = { param: string; values: string[]; route: string | null; criterion: number }
export type ContractFlag = { name: string; route: string; sets: boolean; criterion: number }
export type ContractTransition = { from: string; to: string; allowed: boolean; criterion: number }
export type ContractField = { name: string; default: string | null; values: string[]; required: boolean; criterion: number }
export type ContractAmbiguity = { kind: 'STATUS_WITHOUT_ROUTE' | 'PERSISTENCE_LOCATION_UNSPECIFIED' | 'CRITERION_UNMAPPED'; criterion: number; question: string; resolution: string | null; assumption: string | null }
export type ContractBehavior = { id: string; criterion: number; text: string; categories: BehaviorCategory[] }
export type ImplementationContract = {
  version: 1
  behaviors: ContractBehavior[]
  routes: ContractRoute[]
  statuses: ContractStatus[]
  fields: ContractField[]
  flags: ContractFlag[]
  transitions: ContractTransition[]
  conflicts: ContractConflict[]
  filters: ContractFilter[]
  filterRules: ContractFilterRule[]
  defaultViews: ContractDefaultView[]
  persistence: { required: boolean; envVar: string | null; defaultPath: string | null; surviveRestart: boolean; idsNeverReused: boolean; criteria: number[] }
  ui: { ids: string[]; apis: string[]; criteria: number[] }
  errors: { status: number; cause: string; criterion: number }[]
  restart: boolean
  /** the contract says ids are numeric (otherwise any id value is accepted) */
  idNumeric: boolean
  compat: { routes: string[]; criteria: number[] }
  tests: number[]
  ambiguities: ContractAmbiguity[]
}

const METHODS = 'GET|POST|PUT|PATCH|DELETE'
const clean = (s: string) => s.replace(/[.,;:]+$/, '')
const sampleOf = (p: string) => p.replace(/:\w+/g, '1')
const paramsOf = (p: string) => [...p.matchAll(/:(\w+)/g)].map((m) => m[1])

/** Splits a criterion into clauses on ';' that are not inside brackets/braces/quotes: a status belongs to the clause that names it. */
export function clausesOfCriterion(text: string): string[] {
  const out: string[] = []
  let depth = 0, cur = '', q: string | null = null
  for (const ch of text) {
    if (q) { cur += ch; if (ch === q) q = null; continue }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue }
    if ('([{'.includes(ch)) depth += 1
    if (')]}'.includes(ch)) depth = Math.max(0, depth - 1)
    if (ch === ';' && depth === 0) { out.push(cur.trim()); cur = ''; continue }
    cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}
const STATUS_WORDS = /(?:\(|\b(?:with|returns?|responds?(?: with)?|answers?(?: with)?|rejected with|status)\s+)([1-5]\d\d)\b/g
const shapeOf = (lit: string): ContractRoute['shape'] => {
  const keys = [...lit.matchAll(/"(\w+)"\s*:\s*("?[\w.]+"?)/g)]
  if (!keys.length) return null
  const shape: Record<string, 'n' | 'string' | 'boolean' | 'unknown'> = {}
  for (const k of keys) shape[k[1]] = k[2] === 'n' || /^\d+$/.test(k[2]) ? 'n' : /^"/.test(k[2]) ? 'string' : /^(true|false)$/.test(k[2]) ? 'boolean' : 'unknown'
  return shape
}

/** "unread alerts that are not archived" with flags {read, archived} -> read=false, archived=false. A flag word means true, un<flag> and "not <flag>" mean false. */
export function flagRequirements(desc: string, flags: string[]): FlagRequirement[] {
  let text = desc.toLowerCase()
  const out: FlagRequirement[] = []
  for (const f of flags) {
    const neg = new RegExp(`\\bnot\\s+${f}\\b`, 'g')
    if (neg.test(text)) { out.push({ flag: f, value: false }); text = text.replace(neg, ' ') }
  }
  for (const f of flags) {
    if (out.some((r) => r.flag === f)) continue
    if (new RegExp(`\\bun${f}\\b`).test(text)) out.push({ flag: f, value: false })
    else if (new RegExp(`\\b${f}\\b`).test(text)) out.push({ flag: f, value: true })
  }
  return out
}
export function deriveImplementationContract(acceptance: string[], request = ''): ImplementationContract {
  const c: ImplementationContract = {
    version: 1, behaviors: [], routes: [], statuses: [], fields: [], flags: [], transitions: [], conflicts: [], filters: [], filterRules: [], defaultViews: [],
    persistence: { required: false, envVar: null, defaultPath: null, surviveRestart: false, idsNeverReused: false, criteria: [] },
    ui: { ids: [], apis: [], criteria: [] }, errors: [], restart: false, idNumeric: false, compat: { routes: [], criteria: [] }, tests: [], ambiguities: [],
  }
  const routeKey = (m: string, p: string) => `${m} ${p}`
  let lastRoute: string | null = null
  acceptance.forEach((text, idx) => {
    const n = idx + 1
    const cats = new Set<BehaviorCategory>()
    const isCompat = /\bexisting\b[^.]*\b(?:keep|still|continue)s?\s+(?:working|to work)|\bunchanged\b|\bremain(?:s)? (?:working|available)\b/i.test(text)
    const isTest = /\b(?:node )?tests? (?:cover|prove|exercise)|unit tests?\b/i.test(text)
    const isUi = /\bthe page\b|\bpage shows\b|\bUI\b|\belement(?:s)? (?:with )?ids?\b|\b(?:element )?ids? [a-z][\w]*-[\w-]+/i.test(text) && !/^(?:POST|GET|PUT|PATCH|DELETE)\b/.test(text)
    if (isTest) { c.tests.push(n); cats.add('TEST') }
    if (/\bnumeric id\b/i.test(text)) c.idNumeric = true
    // ---- routes ("GET/POST /api/x", "POST /api/x/:id/read")
    const clauses = clausesOfCriterion(text)
    const routesHere: ContractRoute[] = []
    for (const m of text.matchAll(new RegExp(`\\b((?:${METHODS})(?:\\s*/\\s*(?:${METHODS}))*)\\s+(/[A-Za-z0-9_\\-/.:]+)`, 'g'))) {
      const path = clean(m[2])
      for (const method of m[1].split(/\s*\/\s*/) as Method[]) {
        const id = routeKey(method, path)
        if (c.routes.some((r) => r.id === id)) { const ex = c.routes.find((r) => r.id === id)!; routesHere.push(ex); continue }
        const lit = /\{"[^}]*\}/.exec(text.slice(m.index! + m[0].length))
        const sameClauseLit = lit && !/\b(?:POST|GET|PUT|PATCH|DELETE)\b/.test(text.slice(m.index! + m[0].length, m.index! + m[0].length + lit.index))
        const r: ContractRoute = { id, method, path, sample: sampleOf(path), criterion: n, statuses: [], params: paramsOf(path), shape: sameClauseLit && method === 'GET' || sameClauseLit && /returns?/.test(text.slice(m.index! + m[0].length, m.index! + m[0].length + (lit?.index ?? 0))) ? shapeOf(lit![0]) : null, compat: isCompat, createsRecord: false, bodyField: /\{\s*"(\w+)"\s*:\s*\.\.\.\s*\}/.exec(text)?.[1] ?? null, idempotent: false }
        c.routes.push(r); routesHere.push(r)
      }
    }
    if (routesHere.length) { cats.add(isCompat ? 'COMPAT' : 'ROUTE'); lastRoute = routesHere[0].id }
    // ---- statuses, clause by clause (the route of a clause is the last route named up to it)
    let carry: string | null = routesHere[0]?.id ?? null
    for (const cl of clauses) {
      const named = [...cl.matchAll(new RegExp(`\\b((?:${METHODS})(?:\\s*/\\s*(?:${METHODS}))*)\\s+(/[A-Za-z0-9_\\-/.:]+)`, 'g'))]
      if (named.length) carry = routeKey(named[0][1].split(/\s*\/\s*/)[0], clean(named[0][2]))
      for (const sm of cl.matchAll(STATUS_WORDS)) {
        const status = Number(sm[1])
        c.statuses.push({ status, criterion: n, clause: cl.slice(0, 160), route: carry })
        const r = c.routes.find((x) => x.id === carry)
        if (r && !r.statuses.includes(status)) r.statuses.push(status)
        if (status >= 400) c.errors.push({ status, cause: cl.replace(/^[^,]*?\b(?:and|but)\b\s*/, '').slice(0, 140), criterion: n })
        cats.add('STATUS')
      }
    }
    for (const r of routesHere) if (r.method === 'POST' && !r.params.length && r.statuses.includes(201)) r.createsRecord = true
    // a status with no route anywhere near it cannot be placed
    if (c.statuses.some((s) => s.criterion === n && !s.route) && !lastRoute && !isUi) c.ambiguities.push({ kind: 'STATUS_WITHOUT_ROUTE', criterion: n, question: `C${n} names an HTTP status but no route`, resolution: null, assumption: null })
    // ---- filters ("?state=unread|read|archived|all", "?status=doing", "?severity=critical (or warning, info)")
    for (const m of text.matchAll(/\?(\w+)=([\w|-]+)(?:\s*\(or ([\w ,|-]+)\))?/g)) {
      const values = [...new Set([...m[2].split('|'), ...(m[3] ?? '').split(/[, ]+(?:or )?|\s+or\s+/).filter((v) => /^[\w-]+$/.test(v) && v !== 'or')])].filter(Boolean)
      const ex = c.filters.find((f) => f.param === m[1])
      if (ex) ex.values = [...new Set([...ex.values, ...values])]
      else c.filters.push({ param: m[1], values, route: routesHere[0]?.id ?? lastRoute, criterion: n })
      cats.add('FILTER')
    }
    // ---- flags and their action routes ("POST /api/alerts/:id/read sets read to true")
    for (const cl of clauses) for (const m of cl.matchAll(new RegExp(`\\b(${METHODS})\\s+(/[A-Za-z0-9_\\-/.:]+)\\s+sets\\s+(\\w+)\\s+to\\s+(true|false)`, 'g'))) { c.flags.push({ name: m[3], route: routeKey(m[1], clean(m[2])), sets: m[4] === 'true', criterion: n }); cats.add('STATE') }
    for (const m of text.matchAll(new RegExp(`\\b(${METHODS})\\s+(/[A-Za-z0-9_\\-/.:]+)\\s+sets\\s+it\\s+back\\s+to\\s+(true|false)`, 'g'))) { const prev = c.flags.at(-1); if (prev) c.flags.push({ name: prev.name, route: routeKey(m[1], clean(m[2])), sets: m[3] === 'true', criterion: n }) }
    // ---- transitions ("allowed moves are todo->doing, doing->done; any other move is rejected with 409")
    const tr = /allowed (?:moves|transitions) (?:are|:)\s*([^;]+)/i.exec(text)
    if (tr) { for (const m of tr[1].matchAll(/([\w-]+)\s*(?:->|→)\s*([\w-]+)/g)) c.transitions.push({ from: m[1], to: m[2], allowed: true, criterion: n }); if (c.transitions.length) cats.add('STATE') }
    // ---- fields: defaults ("status "todo" and priority 2 unless given"), enums ("a severity other than info, warning or critical"), required ("an empty title")
    const unless = /unless (?:given|specified)/i.test(text)
    for (const m of text.matchAll(/\b([a-z]\w*)\s+("[\w-]+"|\d+)(?=[^;]*?unless (?:given|specified))/g)) if (unless && !/^(?:with|and|a|an|the|numeric|id|creates|returns|status code)$/.test(m[1])) { const name = m[1], val = m[2].replace(/"/g, ''); if (!c.fields.some((f) => f.name === name)) c.fields.push({ name, default: val, values: [], required: false, criterion: n }) }
    if (/\bcreates?\b/i.test(text)) for (const m of text.matchAll(/\b([a-z]\w*)\s+(true|false)\b/g)) if (!c.fields.some((f) => f.name === m[1])) c.fields.push({ name: m[1], default: m[2], values: [], required: false, criterion: n })
    for (const m of text.matchAll(/\ba (\w+) other than ([\w-]+(?:(?:,| or)\s*[\w-]+)*)/g)) { const values = m[2].split(/,\s*|\s+or\s+/).filter(Boolean); const f = c.fields.find((x) => x.name === m[1]); if (f) f.values = values; else c.fields.push({ name: m[1], default: null, values, required: false, criterion: n }) }
    for (const m of text.matchAll(/\ban empty (\w+)\b/g)) { const f = c.fields.find((x) => x.name === m[1]); if (f) f.required = true; else c.fields.push({ name: m[1], default: null, values: [], required: true, criterion: n }) }
    for (const m of text.matchAll(/\bwith an? (\w+)\b/g)) if (/creat/i.test(text) && !c.fields.some((x) => x.name === m[1]) && !/^(?:numeric|empty|new)$/.test(m[1])) c.fields.push({ name: m[1], default: null, values: [], required: /empty|reject/i.test(text), criterion: n })
    // ---- persistence
    if (wantsPersistence([text])) {
      c.persistence.required = true; c.persistence.criteria.push(n); cats.add('PERSISTENCE')
      if (/restart/i.test(text)) { c.persistence.surviveRestart = true; c.restart = true }
      if (/never reused|keep increasing|keeps? increasing|monoton|not reused/i.test(text)) c.persistence.idsNeverReused = true
    }
    for (const v of storageEnvVars([text])) { c.persistence.envVar ??= v; cats.add('PERSISTENCE') }
    const dp = /default:?\s*([\w./-]+\.\w+)/i.exec(text)
    if (dp) { c.persistence.defaultPath ??= dp[1].replace(/^\.?\//, ''); cats.add('PERSISTENCE') }
    // ---- response shapes on counters ("returns {"unread":n,"critical":n}") and counters in prose
    if (/\bcount|\bnumber of\b|\bhow many\b|\bper status\b/i.test(text)) cats.add('COUNTER')
    // ---- UI
    if (isUi) {
      c.ui.criteria.push(n); cats.add('UI')
      for (const m of text.matchAll(/\bids?\s+([a-z][\w]*-[\w-]+(?:\s*(?:,|and|,\s*and)\s*[a-z][\w]*-[\w-]+)*)/gi)) for (const id of m[1].split(/\s*(?:,|and)\s*/).map((x) => x.trim()).filter(Boolean)) if (!c.ui.ids.includes(id)) c.ui.ids.push(id)
      for (const m of text.matchAll(/(\/api\/[A-Za-z0-9_\-/.:]+)/g)) { const a = clean(m[1]); if (!c.ui.apis.includes(a)) c.ui.apis.push(a) }
    }
    if (isCompat) { c.compat.criteria.push(n); for (const r of routesHere) if (!c.compat.routes.includes(r.id)) c.compat.routes.push(r.id) }
    if (!cats.size) cats.add('OTHER')
    c.behaviors.push({ id: `B${n}`, criterion: n, text, categories: [...cats] })
  })
  // ---- list semantics: "GET /x lists items that are not archived; ?state=unread returns only unread items that are not archived, ?state=all every item"
  const flagNames = [...new Set(c.flags.map((f) => f.name))]
  if (flagNames.length) acceptance.forEach((text, idx) => {
    const n = idx + 1
    const q = [...text.matchAll(/\?(\w+)=([\w-]+)/g)]
    for (let i = 0; i < q.length; i++) {
      const from = q[i].index! + q[i][0].length
      const to = i + 1 < q.length ? q[i + 1].index! : text.length
      const desc = text.slice(from, to).split(';')[0].replace(/\([^)]*\)/g, ' ').slice(0, 160)
      if (!/\b(?:only|every|all)\b/i.test(desc)) continue
      const everything = /\b(?:every|all)\b/i.test(desc) && !/\bonly\b/i.test(desc)
      const requires = everything ? [] : flagRequirements(desc, flagNames)
      if (everything || requires.length) c.filterRules.push({ param: q[i][1], value: q[i][2], requires, everything, clause: (q[i][0] + desc).trim().slice(0, 160), criterion: n })
    }
    const dv = /\b(GET)\s+(\/[A-Za-z0-9_\-/.:]+)\s+lists?\s+([^;?]*)/i.exec(text)
    if (dv && q.length) { const requires = flagRequirements(dv[3], flagNames); if (requires.length) c.defaultViews.push({ route: `${dv[1].toUpperCase()} ${clean(dv[2])}`, requires, clause: dv[0].slice(0, 160), criterion: n }) }
  })
  // ---- conflicts: "<setter route> sets F to true ...; marking an F item read or unread is rejected with 409" -> after the setter ran, the named actions must answer 409
  for (const st of c.statuses.filter((x) => x.status >= 400 && x.status !== 400 && x.status !== 404)) {
    for (const f of c.flags.filter((x) => x.sets && x.criterion === st.criterion && new RegExp(`\\b${x.name}\\b`, 'i').test(st.clause))) {
      const words = new Set((st.clause.toLowerCase().match(/[a-z]+/g) ?? []))
      const blocked = c.routes.filter((r) => r.method === 'POST' && r.params.length && r.id !== f.route && words.has(r.path.split('/').filter(Boolean).at(-1)!.toLowerCase()) && !c.flags.some((g) => g.sets && g.route === r.id && g.name === f.name)).map((r) => r.id)
      if (blocked.length && !c.conflicts.some((k) => k.setter === f.route && k.status === st.status)) c.conflicts.push({ setter: f.route, flag: f.name, blocked, status: st.status, criterion: st.criterion })
    }
  }
  for (const r of c.routes) if (r.params.length && /\b(?:repeating it is harmless|repeatable|idempotent)\b/i.test(acceptance[r.criterion - 1] ?? '') && c.flags.some((f) => f.route === r.id && f.sets)) r.idempotent = true
  // ---- persistence location: a persisted feature with neither a storage variable nor a default path has no stated location
  if (c.persistence.required && !c.persistence.envVar && !c.persistence.defaultPath) {
    const coll = c.routes.find((r) => r.createsRecord) ?? c.routes.find((r) => r.method === 'GET' && !r.params.length && !r.compat)
    const res = coll?.path.split('/').filter((s) => s && s !== 'api').at(0)
    c.ambiguities.push({ kind: 'PERSISTENCE_LOCATION_UNSPECIFIED', criterion: c.persistence.criteria[0] ?? 0, question: 'persistence is required but the criteria name neither a storage variable nor a default file', resolution: res ? `data/${res}.json` : null, assumption: res ? `ASSUMPTION: the data file is data/${res}.json under the working directory, overridable through ${res.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_FILE` : null })
  }
  // ---- a criterion that maps to nothing structured is not buildable by guess: it must be a plain statement the builder can read (recorded, never invented)
  for (const b of c.behaviors) if (b.categories.length === 1 && b.categories[0] === 'OTHER') c.ambiguities.push({ kind: 'CRITERION_UNMAPPED', criterion: b.criterion, question: `C${b.criterion} maps to no route, status, state, persistence, UI or compatibility fact`, resolution: 'read as written', assumption: `ASSUMPTION: C${b.criterion} is satisfied by the behaviour it states in prose` })
  void request
  return c
}

/** Ambiguities are resolved by a recorded rule or the build does not start. Returns the unresolved ones. */
export function unresolvedAmbiguities(c: ImplementationContract): ContractAmbiguity[] { return c.ambiguities.filter((a) => a.resolution === null) }

/** Applies the deterministic resolutions (a persistence default location) to the contract; the assumptions stay listed. */
export function resolveContract(c: ImplementationContract): ImplementationContract {
  const out = { ...c, persistence: { ...c.persistence } }
  for (const a of c.ambiguities) if (a.kind === 'PERSISTENCE_LOCATION_UNSPECIFIED' && a.resolution) {
    out.persistence.defaultPath ??= a.resolution
    out.persistence.envVar ??= (/ (\w+_FILE)$/.exec(a.assumption ?? '') ?? [])[1] ?? null
  }
  return out
}

export function renderContract(c: ImplementationContract, cap = 3800): string {
  const l: string[] = ['IMPLEMENTATION CONTRACT (derived once from the acceptance criteria; the independent verifier checks exactly this):']
  for (const r of c.routes) l.push(`- ${r.compat ? 'KEEP ' : ''}${r.method} ${r.path}${r.statuses.length ? ` -> ${r.statuses.join('/')}` : ''}${r.shape ? ` returns ${JSON.stringify(r.shape).replace(/"n"/g, 'n')}` : ''}  [C${r.criterion}]`)
  for (const f of c.fields) l.push(`- field ${f.name}${f.default !== null ? ` default ${f.default}` : ''}${f.values.length ? ` not in {${f.values.join(',')}} -> 400` : ''}${f.required ? ' required' : ''}  [C${f.criterion}]`)
  for (const f of c.flags) l.push(`- ${f.route} sets ${f.name}=${f.sets}  [C${f.criterion}]`)
  for (const t of c.transitions) l.push(`- allowed transition ${t.from} -> ${t.to}; every other move is rejected  [C${t.criterion}]`)
  for (const f of c.filters) l.push(`- query ?${f.param}=${f.values.join('|') || '<value>'} on ${f.route ?? 'the list route'}  [C${f.criterion}]`)
  if (c.persistence.required) l.push(`- persistence: ${c.persistence.envVar ? `file named by env ${c.persistence.envVar}` : 'a data file'}, default ${c.persistence.defaultPath ?? '<unstated>'} under the working directory${c.persistence.surviveRestart ? '; all data survives a restart' : ''}${c.persistence.idsNeverReused ? '; ids are never reused and keep increasing across restarts' : ''}; the folder of the default path must exist before the first write`)
  if (c.ui.ids.length || c.ui.apis.length) l.push(`- ui: element ids ${c.ui.ids.join(', ') || '(none named)'}; page script calls ${c.ui.apis.join(', ') || '(none named)'}`)
  for (const a of c.ambiguities.filter((x) => x.assumption)) l.push(`- ${a.assumption}`)
  return l.join('\n').slice(0, cap)
}
