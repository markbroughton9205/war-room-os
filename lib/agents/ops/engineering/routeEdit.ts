import { routeFindings, routeTable, acceptanceRoutes } from './staticGates'
import type { RouteFinding } from './staticGates'

/**
 * Structural route edits over the parsed route table. A route's block (its `if (...)` line through the end of its braces) is moved, replaced, inserted or removed as
 * whole lines; every other byte of the file is preserved. Every operation fails CLOSED: a missing or ambiguous route changes nothing and says why.
 * Callers re-run the syntax gate, the route-conflict analysis and the original failing verifier on the result: this module never invents application semantics.
 */
export type RouteRef = { pattern: string; method?: string | null; line?: number }
export type RouteEditResult = { ok: true; text: string; changed: boolean; note: string } | { ok: false; reason: string }
export type RouteEditMode = 'MODEL_GENERATED' | 'MODEL_SELECTED_DETERMINISTIC_EDIT' | 'ENGINE_DETERMINISTIC_REPAIR'
export type RouteOp =
  | { op: 'MOVE_ROUTE_BEFORE'; route: RouteRef; anchor: RouteRef }
  | { op: 'MOVE_ROUTE_AFTER'; route: RouteRef; anchor: RouteRef }
  | { op: 'REPLACE_ROUTE_HANDLER'; route: RouteRef; block: string }
  | { op: 'INSERT_ROUTE'; anchor: RouteRef; where: 'before' | 'after'; block: string }
  | { op: 'DELETE_DUPLICATE_ROUTE'; route: RouteRef }

type R = ReturnType<typeof routeTable>[number]
const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason })
const describe = (r: RouteRef) => `${r.method ? `${r.method} ` : ''}${r.pattern}${r.line ? ` (line ${r.line})` : ''}`

function resolve(rs: R[], ref: RouteRef): { ok: true; route: R } | { ok: false; reason: string } {
  const hits = rs.filter((r) => r.pattern === ref.pattern && (ref.method === undefined || r.method === ref.method) && (ref.line === undefined || r.line === ref.line))
  if (!hits.length) return fail(`route ${describe(ref)} was not found in the dispatcher`)
  if (hits.length > 1) return fail(`route ${describe(ref)} is ambiguous: it matches ${hits.length} registrations (lines ${hits.map((h) => h.line).join(', ')}); name the line`)
  return { ok: true, route: hits[0] }
}
const overlaps = (a: R, b: R) => a.line <= b.end && b.line <= a.end
/** First line of the route's unit: its `if` line, plus an immediately preceding `const alias = ...` declaration the condition depends on. null = that declaration is shared with other code (moving it alone is unsafe). */
function startOf(lines: string[], r: R): number | null {
  let start = r.line
  for (let k = 0; k < 2; k++) {
    const prev = lines[start - 2]
    const m = prev === undefined || !/pathname/.test(prev) || !/\.(?:exec|match|test|search)\(/.test(prev) ? null : /^\s*(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/.exec(prev) // only a route-matching alias, never e.g. `const url = new URL(...)`
    if (!m || !new RegExp(`\\b${m[1]}\\b`).test(lines.slice(start - 1, r.end).join('\n'))) break
    const outside = [...lines.slice(0, start - 2), ...lines.slice(r.end)].join('\n')
    if (new RegExp(`\\b${m[1]}\\b`).test(outside)) return null
    start -= 1
  }
  return start
}
const block = (lines: string[], r: R) => lines.slice((startOf(lines, r) ?? r.line) - 1, r.end)

export function applyRouteOp(text: string, op: RouteOp): RouteEditResult {
  const rs = routeTable(text), lines = text.split('\n')
  if (op.op === 'INSERT_ROUTE') {
    const a = resolve(rs, op.anchor); if (!a.ok) return a
    const at = op.where === 'before' ? a.route.line - 1 : a.route.end
    const ins = op.block.replace(/\n+$/, '').split('\n')
    return { ok: true, text: [...lines.slice(0, at), ...ins, ...lines.slice(at)].join('\n'), changed: true, note: `inserted ${ins.length} line(s) ${op.where} ${describe(op.anchor)}` }
  }
  const t = resolve(rs, op.route); if (!t.ok) return t
  const r = t.route
  const rs0 = startOf(lines, r)
  if (rs0 === null) return fail(`${describe(op.route)} depends on a declaration shared with other code; moving it alone is unsafe`)
  if (op.op === 'REPLACE_ROUTE_HANDLER') {
    const repl = op.block.replace(/\n+$/, '').split('\n')
    const same = repl.join('\n') === block(lines, r).join('\n')
    return { ok: true, text: [...lines.slice(0, r.line - 1), ...repl, ...lines.slice(r.end)].join('\n'), changed: !same, note: same ? 'handler already identical' : `replaced the block of ${describe(op.route)}` }
  }
  if (op.op === 'DELETE_DUPLICATE_ROUTE') {
    if (op.route.line === undefined) return fail('a duplicate must be identified by its line')
    const earlier = rs.find((e) => e !== r && e.line < r.line && e.pattern === r.pattern && e.method === r.method && e.returns)
    if (!earlier) return fail(`${describe(op.route)} is not a duplicate of an earlier returning route`)
    return { ok: true, text: [...lines.slice(0, r.line - 1), ...lines.slice(r.end)].join('\n'), changed: true, note: `removed the later duplicate of ${describe(op.route)} (first at line ${earlier.line})` }
  }
  const a = resolve(rs, op.anchor); if (!a.ok) return a
  const anchor = a.route
  const as0 = startOf(lines, anchor) ?? anchor.line
  if (r === anchor || overlaps(r, anchor)) return fail(`${describe(op.route)} and ${describe(op.anchor)} overlap; a route cannot be moved relative to a block that contains it`)
  const moving = block(lines, r)
  if (op.op === 'MOVE_ROUTE_BEFORE') {
    if (rs0 < as0) return { ok: true, text, changed: false, note: `${describe(op.route)} is already before ${describe(op.anchor)}` }
    const rest = [...lines.slice(0, rs0 - 1), ...lines.slice(r.end)]
    return { ok: true, text: [...rest.slice(0, as0 - 1), ...moving, ...rest.slice(as0 - 1)].join('\n'), changed: true, note: `moved ${describe(op.route)} before ${describe(op.anchor)}` }
  }
  // MOVE_ROUTE_AFTER
  if (r.line > anchor.line) return { ok: true, text, changed: false, note: `${describe(op.route)} is already after ${describe(op.anchor)}` }
  const rest = [...lines.slice(0, rs0 - 1), ...lines.slice(r.end)]
  const anchorEnd = anchor.end - moving.length // the anchor sits after the removed block
  return { ok: true, text: [...rest.slice(0, anchorEnd), ...moving, ...rest.slice(anchorEnd)].join('\n'), changed: true, note: `moved ${describe(op.route)} after ${describe(op.anchor)}` }
}

/** The ordering operations an analyzer finding calls for. DUPLICATE is only removable when the two registrations are byte-identical. */
export function opsForFindings(text: string, findings: RouteFinding[]): RouteOp[] {
  const rs = routeTable(text), lines = text.split('\n')
  const ops: RouteOp[] = []
  for (const f of findings) {
    const hidden = rs.find((r) => r.line === f.hiddenLine && r.pattern === f.hidden), hiding = rs.find((r) => r.line === f.hidingLine && r.pattern === f.hiding)
    if (!hidden || !hiding) continue
    if (f.kind === 'DUPLICATE') { if (block(lines, hidden).join('\n') === block(lines, hiding).join('\n')) ops.push({ op: 'DELETE_DUPLICATE_ROUTE', route: { pattern: f.hidden, method: hidden.method, line: f.hiddenLine } }); continue }
    ops.push({ op: 'MOVE_ROUTE_BEFORE', route: { pattern: f.hidden, method: hidden.method, line: f.hiddenLine }, anchor: { pattern: f.hiding, method: hiding.method, line: f.hidingLine } })
  }
  return ops
}

/** Repairs a pure ordering/duplicate conflict structurally. Returns null when nothing changes or the sequence does not converge (the caller then falls back to a model correction). */
export function repairRouteOrder(rel: string, text: string, maxOps = 12): { text: string; ops: RouteOp[]; notes: string[]; mode: RouteEditMode } | null {
  let cur = text
  const done: RouteOp[] = [], notes: string[] = []
  for (let i = 0; i < maxOps; i++) {
    const findings = routeFindings(rel, cur)
    if (!findings.length) return done.length ? { text: cur, ops: done, notes, mode: 'ENGINE_DETERMINISTIC_REPAIR' } : null
    const ops = opsForFindings(cur, findings)
    if (!ops.length) return null
    const res = applyRouteOp(cur, ops[0])
    if (!res.ok || !res.changed) return null
    if (routeFindings(rel, res.text).length >= findings.length) return null // every structural step must strictly reduce the conflicts; otherwise it does not converge
    cur = res.text; done.push(ops[0]); notes.push(res.note)
  }
  return routeFindings(rel, cur).length ? null : { text: cur, ops: done, notes, mode: 'ENGINE_DETERMINISTIC_REPAIR' }
}

/**
 * METHOD + PATH + required status -> the route/handler responsible, and what to fix.
 * ROUTE_MISSING / ROUTE_ORDER are routing faults; HANDLER means the route is reachable but nothing it runs can produce the status; OK means it can.
 */
export type StatusDiagnosis = { method: string; path: string; status: string; target: 'OK' | 'ROUTE_MISSING' | 'ROUTE_ORDER' | 'HANDLER'; route?: string; reason: string }
export function statusDiagnosis(serverText: string, files: Record<string, string>, acceptance: string[]): StatusDiagnosis[] {
  const rs = routeTable(serverText), lines = serverText.split('\n'), out: StatusDiagnosis[] = []
  const mapped = /\b(?:reply|send|respond|writeHead|status)\s*\([^)\n]*\b(?:err|e|error)\.(?:status|statusCode|code)\b/.test(serverText)
  const others = Object.entries(files).filter(([p]) => /\.m?js$/.test(p) && !/^(test|node_modules|public)\//.test(p))
  for (const a of acceptance) {
    const statuses = [...new Set([...a.matchAll(/\b([45]\d\d)\b/g)].map((m) => m[1]))]
    if (!statuses.length) continue
    for (const ar of acceptanceRoutes([a])) {
      const matching = rs.filter((r) => (!r.method || r.method === ar.method) && r.matches(ar.sample))
      for (const status of statuses) {
        const base = { method: ar.method, path: ar.path, status }
        if (!matching.length) { out.push({ ...base, target: 'ROUTE_MISSING', reason: `no route answers ${ar.method} ${ar.sample}` }); continue }
        const first = matching[0], literalHit = matching.find((r) => r.kind === 'literal')
        if (literalHit && first !== literalHit && first.returns) { out.push({ ...base, target: 'ROUTE_ORDER', route: literalHit.pattern, reason: `${literalHit.pattern} (line ${literalHit.line}) is hidden by ${first.pattern} (line ${first.line})` }); continue }
        const handler = block(lines, first).join('\n')
        const callees = [...handler.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]).filter((n) => !/^(if|reply|send|respond|return|await|Number|String|JSON|parseInt|Object|new|URL)$/.test(n))
        const code = [handler, ...others.filter(([, t]) => callees.some((c) => new RegExp(`\\b${c}\\b`).test(t))).map(([, t]) => t)].join('\n')
        const can = new RegExp(`\\b${status}\\b`).test(code) || (mapped && /\b(?:status|statusCode)\s*[:=]/.test(code))
        out.push({ ...base, target: can ? 'OK' : 'HANDLER', route: first.pattern, reason: can ? `${first.pattern} can produce ${status}` : `${first.pattern} (line ${first.line}) is reachable but neither its block nor the functions it calls can produce ${status}` })
      }
    }
  }
  return out
}
