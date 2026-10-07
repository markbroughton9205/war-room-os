import { type Route, acceptanceRoutes, contractRouteProblems, legacyStateDrift, routeFindings, routeTable, statusReachability, syntaxProblems, undefinedNames, domIds, missingDomIds } from './staticGates'
import { persistenceProblems, type PersistenceProbe } from './persistenceContract'

/**
 * Verifier-to-planner feedback. A failing independent check is NOT passed on as prose: it is parsed, mapped to the implicated route / symbol / storage path /
 * file, enriched with facts read from the code (dependency + caller context), and turned into an ORDERED set of explicit, falsifiable hypotheses.
 * The repair loop acts on one hypothesis at a time, compares the failure before/after, and never repeats a refuted one.
 */
export type CheckKind = 'SERVER_START' | 'ROUTE_MISSING' | 'STATUS_MISMATCH' | 'RESPONSE_SHAPE' | 'LOOKUP_AFTER_CREATE' | 'LEGACY_REGRESSION' | 'UI_PAGE' | 'PERSISTENCE' | 'GENERIC'
export type Hypothesis = { key: string; kind: CheckKind; statement: string; files: string[]; check: number }
export type CheckFailure = { n: number; name: string; message: string; kind: CheckKind; facts: string[]; hypotheses: Hypothesis[] }
export type StructuredEvidence = { checks: CheckFailure[]; queue: Hypothesis[]; files: string[]; signatureOf: (n: number) => string }
export type EvidenceInput = { output: string; acceptance: string[]; files: Record<string, string>; baseline?: Record<string, string>; changed?: string[]; probe?: PersistenceProbe | null; startupOutput?: string }

const PRIORITY: CheckKind[] = ['SERVER_START', 'ROUTE_MISSING', 'STATUS_MISMATCH', 'RESPONSE_SHAPE', 'LOOKUP_AFTER_CREATE', 'LEGACY_REGRESSION', 'UI_PAGE', 'PERSISTENCE', 'GENERIC']
export function parseChecks(out: string): { n: number; name: string; message: string }[] {
  const lines = out.split('\n'), res: { n: number; name: string; message: string }[] = []
  lines.forEach((ln, i) => {
    const m = /^not ok (\d+) - (.+)$/.exec(ln); if (!m) return
    let message = ''
    for (let j = i + 1; j < Math.min(i + 6, lines.length) && !/^(not )?ok \d+/.test(lines[j]); j++) { const x = /^\s*message:\s*(.*)$/.exec(lines[j]); if (x) { message = x[1]; break } }
    res.push({ n: Number(m[1]), name: m[2].trim(), message })
  })
  return res
}

const SOURCE = (p: string) => /\.m?js$/.test(p) && !/^(test|node_modules|public)\//.test(p)
const exportedBy = (files: Record<string, string>, name: string): string | null => Object.entries(files).find(([p, t]) => SOURCE(p) && new RegExp(`export\\s+(?:async\\s+)?(?:function|const|let)\\s+${name}\\b|export\\s*\\{[^}]*\\b${name}\\b`).test(t))?.[0] ?? null

export function buildEvidence(inp: EvidenceInput): StructuredEvidence {
  const checks = parseChecks(inp.output)
  const files = inp.files
  const serverFile = Object.keys(files).find((p) => SOURCE(p) && /createServer\s*\(/.test(files[p])) ?? 'server.mjs'
  const serverText = files[serverFile] ?? ''
  const routes = routeTable(serverText)
  const lines = serverText.split('\n')
  const clientFiles = Object.keys(files).filter((p) => /^public\/.+\.js$/.test(p))
  const created = [...inp.output.matchAll(/status=20[01] body=\{"id":("?)([^,"}]+)/g)].map((m) => ({ quoted: !!m[1], id: m[2] }))
  const catchLine = lines.findIndex((l) => /\bcatch\s*\(/.test(l))
  const catchStatus = catchLine >= 0 ? /\b(?:reply|send|writeHead)\s*\(\s*(?:res\s*,\s*)?(\d{3})/.exec(lines.slice(catchLine, catchLine + 8).join('\n'))?.[1] ?? null : null
  const catchMaps = catchLine >= 0 && /(?:err|e|error)\.(?:status|statusCode|code)/.test(lines.slice(catchLine, catchLine + 8).join('\n'))
  const handlerFor = (name: string, message = '') => {
    const paths = [...name.matchAll(/\/api\/[\w\-/:.]+/g)].map((m) => m[0].replace(/:\w+/g, '1'))
    const toks = (`${name} ${[...message.matchAll(/(\w+)=/g)].map((m) => m[1]).join(' ')}`.toLowerCase().match(/[a-z][a-z-]{2,}/g) ?? []).filter((t) => !['marks', 'returns', 'reports', 'excludes', 'default', 'rejected', 'unknown', 'alert', 'alerts', 'session', 'sessions', 'tasks', 'task', 'todo', 'with', 'that', 'only', 'survive', 'across', 'server', 'stores', 'message', 'messages', 'creates', 'their', 'flags', 'select', 'right', 'filter', 'narrows', 'state'].includes(t))
    const words = (t: string) => new Set(t.toLowerCase().match(/[a-z]+/g) ?? [])
    const scored = routes.map((r) => { const w = words(r.pattern); return { r, s: (paths.some((p) => r.matches(p)) ? 3 : 0) + [...new Set(toks.flatMap((t) => t.split('-')))].filter((t) => w.has(t)).length } })
    return scored.filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.r.line - b.r.line)[0]?.r ?? null
  }
  const handlerBody = (r: Route | null) => (r ? lines.slice(r.line - 1, r.end).join('\n') : '')
  const calleeFiles = (body: string): { fn: string; file: string }[] => [...new Set([...body.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)].map((m) => m[1]))].map((fn) => ({ fn, file: exportedBy(files, fn) ?? '' })).filter((x) => x.file && x.file !== serverFile)
  const drift = Object.entries(files).filter(([p]) => SOURCE(p)).flatMap(([p, t]) => legacyStateDrift(p, inp.baseline?.[p] ?? '', t).map((d) => ({ ...d, file: p })))
  const changedLegacy = Object.entries(files).filter(([p]) => SOURCE(p) && inp.baseline?.[p]).flatMap(([p, t]) => {
    const exportsOf = (text: string) => new Map([...text.matchAll(/export\s+(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/g)].map((m) => [m[1], m[2].replace(/\s+/g, ' ').trim()]))
    const b = exportsOf(inp.baseline![p]), a = exportsOf(t)
    return [...b].filter(([fn, body]) => a.has(fn) && a.get(fn) !== body).map(([fn]) => ({ fn, file: p }))
  })
  const persistIssues = persistenceProblems(files, inp.acceptance)
  const srcProblems = Object.entries(files).filter(([p]) => SOURCE(p) || /^public\//.test(p)).flatMap(([p, t]) => syntaxProblems(p, t).map((m) => ({ file: p, msg: m })))
  const missingStatus = statusReachability(files, inp.acceptance)

  const out: CheckFailure[] = checks.map((c) => {
    const text = `${c.name} ${c.message}`
    const facts: string[] = [], hyps: Hypothesis[] = []
    const H = (kind: CheckKind, key: string, statement: string, fs: string[]) => hyps.push({ key, kind, statement, files: [...new Set(fs.filter(Boolean))].slice(0, 2), check: c.n })
    let kind: CheckKind = 'GENERIC'
    const expected = [...c.name.matchAll(/\b([1-5]\d\d)\b/g)].map((m) => Number(m[1]))
    const observedPairs = [...c.message.matchAll(/(\w[\w/-]*)=(\d{3})\b/g)].map((m) => ({ key: m[1], code: Number(m[2]) }))
    const mism: { key: string; code: number; exp: number }[] = expected.length && observedPairs.length ? observedPairs.map((o, i) => ({ ...o, exp: expected.length === observedPairs.length ? expected[i] : expected[0] })).filter((o) => o.code !== o.exp && !(expected.length !== observedPairs.length && expected.includes(o.code))) : []
    // setup steps that legitimately answered 2xx are not the failing condition when the contract expects an error status
    if (expected.some((e) => e >= 400) && mism.some((m) => m.code >= 400)) { const keep = mism.filter((m) => m.code >= 400); mism.length = 0; mism.push(...keep) }
    if (/could not complete|server exited|did not start/i.test(text)) kind = 'SERVER_START'
    else if (/persist|surviv|restart|durab/i.test(c.name)) kind = 'PERSISTENCE'
    else if (/existing .*(keep|still) working|legacy/i.test(c.name)) kind = 'LEGACY_REGRESSION'
    else if (/\bpage\b|\bui\b|badge/i.test(c.name)) kind = 'UI_PAGE'
    else if (mism.length) kind = 'STATUS_MISMATCH'
    else if (!expected.length && /status=([45]\d\d)/.test(c.message)) { kind = Number(/status=([45]\d\d)/.exec(c.message)![1]) === 404 ? 'ROUTE_MISSING' : 'STATUS_MISMATCH'; if (kind === 'STATUS_MISMATCH') mism.push({ key: 'status', code: Number(/status=([45]\d\d)/.exec(c.message)![1]), exp: 200 }) }
    else if (/=null\b|=\{\}|\[\]/.test(c.message)) kind = 'RESPONSE_SHAPE'
    else if (/404|not found/i.test(text)) kind = created.length ? 'LOOKUP_AFTER_CREATE' : 'ROUTE_MISSING'

    let h: Route | null = handlerFor(c.name, c.message)
    if (!h && kind === 'STATUS_MISMATCH') h = routes.find((r) => r.method !== 'GET' && r.kind !== 'literal') ?? routes.find((r) => r.method === 'PATCH' || r.method === 'PUT') ?? null
    const body = handlerBody(h)
    const callees = calleeFiles(body)
    const route = h ? `${h.method ?? 'ANY'} ${h.pattern} (${serverFile}:${h.line})` : null
    if (route) facts.push(`implicated route: ${route}`)
    if (callees.length) facts.push(`the handler calls ${callees.map((x) => `${x.fn}() from ${x.file}`).join(', ')}`)

    if (kind === 'SERVER_START') {
      const crash = inp.startupOutput ? /(?:file:\/\/)?(?:[\w./-]*\/)?((?:[\w.-]+\/)*[\w.-]+\.m?js):(\d+)[\s\S]*?\n(\w*Error:[^\n]+)/.exec(inp.startupOutput) : null
      if (crash) { const f = Object.keys(files).find((x) => x === crash[1] || x.endsWith('/' + crash[1].split('/').pop()!)); facts.push(`the engine reproduced the start-up failure: ${crash[3].slice(0, 160)} at ${crash[1]}:${crash[2]}`); if (f) H(kind, `startup:error:${f}`, `starting the server fails with "${crash[3].slice(0, 140)}" at ${f}:${crash[2]}`, [f]) }
      const sp = srcProblems[0]
      if (sp) { facts.push(`syntax error: ${sp.file} ${sp.msg}`); H(kind, `syntax:${sp.file}`, `${sp.file} has a syntax error (${sp.msg}); the server cannot start`, [sp.file]) }
      const un = Object.entries(files).filter(([p]) => SOURCE(p)).flatMap(([p, t]) => undefinedNames(p, t).map((n) => ({ p, n })))
      if (un.length) { facts.push(`undeclared names: ${un.map((u) => `${u.n} in ${u.p}`).join(', ')}`); H(kind, `undefined:${un[0].p}`, `${un[0].p} uses ${un[0].n} without declaring or importing it`, [un[0].p]) }
      const imp = /The requested module '([^']+)' does not provide an export named '([^']+)'/.exec(`${inp.output}\n${inp.startupOutput ?? ''}`)
      if (imp) { const mod = Object.keys(files).find((f) => f.endsWith(imp[1].replace(/^\.\/?/, '').replace(/^\.\.\//, ''))) ?? ''; if (mod) { facts.push(`${mod} does not export ${imp[2]}, which another module imports`); H(kind, `export:${mod}:${imp[2]}`, `${mod} must export ${imp[2]} (it is imported by another module and the process fails at load time)`, [mod]) } }
      const named = Object.keys(files).filter((f) => SOURCE(f) && f !== serverFile && `${inp.output}\n${inp.startupOutput ?? ''}`.includes(f.split('/').pop()!))
      if (named.length) H(kind, `startup:named:${named[0]}`, `the startup failure names ${named[0]} (${c.message.slice(0, 120)})`, [named[0]])
      H(kind, `startup:${serverFile}`, `the server process exits at startup (${c.message.slice(0, 120)}); the startup path in ${serverFile} or the modules it imports at load time throws`, [serverFile])
      hyps.sort((a, b) => (a.key.startsWith('export:') ? 0 : 1) - (b.key.startsWith('export:') ? 0 : 1)) // a missing export names the module that must change, not the importer
    }
    if (kind === 'ROUTE_MISSING' || kind === 'RESPONSE_SHAPE' || kind === 'UI_PAGE') {
      const cp = contractRouteProblems(serverFile, serverText, inp.acceptance, clientFiles.map((f) => files[f]))
      for (const p of cp) { facts.push(`contract route problem: ${p}`); H(kind === 'UI_PAGE' ? 'ROUTE_MISSING' : kind, `route:${p.slice(0, 60)}`, `${p}: the dispatcher in ${serverFile} must register this route (before any prefix or id route that matches it)`, [serverFile]) }
      for (const f of routeFindings(serverFile, serverText)) { facts.push(`route conflict: ${f.hidden} (line ${f.hiddenLine}) is hidden by ${f.hiding} (line ${f.hidingLine}) [${f.kind}]`); H('ROUTE_MISSING', `shadow:${f.hidden}`, `${f.hidden} is unreachable because ${f.hiding} (line ${f.hidingLine}) matches first`, [serverFile]) }
    }
    if (kind === 'STATUS_MISMATCH') {
      const m0 = mism[0]
      for (const f of routeFindings(serverFile, serverText)) if (c.name.toLowerCase().includes(f.hidden.split('/').pop()!.toLowerCase())) { facts.push(`route conflict: ${f.hidden} (line ${f.hiddenLine}) is hidden by ${f.hiding} (line ${f.hidingLine}) [${f.kind}]`); H(kind, `shadow:${f.hidden}`, `${f.hidden} is unreachable because ${f.hiding} (line ${f.hidingLine}) matches first and answers ${m0.code}`, [serverFile]) }
      facts.push(`status contract: expected ${m0.exp}, observed ${m0.code} (${m0.key})`)
      if (catchStatus) facts.push(`${serverFile} error handler (line ${catchLine + 1}) answers thrown errors with ${catchStatus}${catchMaps ? ' unless the error carries a status' : ' without reading any status from the error'}`)
      if (missingStatus.includes(String(m0.exp))) facts.push(`no code in the workspace can ever respond ${m0.exp}`)
      const thrower = callees.find((x) => /throw\s+new\s+\w*Error\(/.test(files[x.file] ?? ''))
      const svc = thrower?.file ?? callees[0]?.file
      if (catchStatus && Number(catchStatus) === m0.code && !catchMaps) H(kind, `status:map:${serverFile}`, `errors are not mapped to the contract status: the error handler in ${serverFile} always answers ${catchStatus}, while the contract requires ${m0.exp} for this condition. Make the failing condition raise an error that carries status ${m0.exp} and make the handler answer with the error's status`, [svc ?? '', serverFile])
      if (svc) H(kind, `status:raise:${svc}`, `${svc} signals the condition behind "${c.name.slice(0, 70)}" with a generic error; it must signal ${m0.exp} (and ${m0.code === m0.exp ? 'keep' : 'not'} ${m0.code} for this case)`, [svc, serverFile])
      H(kind, `status:inline:${serverFile}`, `${serverFile} chooses the wrong status for this condition; the contract requires ${m0.exp}`, [serverFile])
    }
    if (kind === 'RESPONSE_SHAPE') {
      for (const x of callees.slice(0, 2)) H(kind, `shape:${x.file}:${x.fn}`, `${x.fn}() in ${x.file} returns a value of the wrong shape or ignores the query parameters named in the contract (${c.message.slice(0, 100)})`, [x.file, serverFile])
      H(kind, `shape:${serverFile}`, `${serverFile} answers this request with the wrong payload (${c.message.slice(0, 100)})`, [serverFile])
    }
    if (kind === 'LOOKUP_AFTER_CREATE') {
      const numeric = created.some((x) => !x.quoted)
      facts.push(`created ids look ${numeric ? 'numeric' : 'like strings'} (${created.slice(0, 2).map((x) => x.id).join(', ')})`)
      const parse = /split\('\/'\)\[(\d)\]|decodeURIComponent\([^)]*\)|\(\\d\+\)|\[\^\/\]\+/.exec(body)?.[0]
      if (parse) facts.push(`the route reads the id with ${parse}${/Number\(|parseInt\(|\+\w/.test(body) ? ' (converted)' : ' (left as a string)'}`)
      H(kind, `id:type:${serverFile}`, `the id from the URL is a string but stored ids are ${numeric ? 'numbers' : 'strings'} (or the other way round), so the lookup in ${callees[0]?.file ?? serverFile} never matches. Convert once at the boundary and compare like with like`, [callees[0]?.file ?? '', serverFile])
      H(kind, `id:route:${serverFile}`, `${serverFile} extracts the id from the wrong URL segment or never registers this route (${route ?? 'no handler found'})`, [serverFile])
    }
    if (kind === 'LEGACY_REGRESSION') {
      for (const ch of changedLegacy.slice(0, 3)) { facts.push(`existing export changed: ${ch.fn} in ${ch.file}`); H(kind, `legacy:${ch.file}:${ch.fn}`, `the existing function ${ch.fn} in ${ch.file} was changed and no longer returns what the existing endpoint returned before; restore its original behaviour and add new functions for the new feature`, [ch.file]) }
      for (const d of drift) H(kind, `legacy-drift:${d.file}:${d.fn}`, `existing export ${d.fn} used ${d.was} and now uses the new state ${d.now}`, [d.file])
      H(kind, `legacy:${serverFile}`, `the existing route handlers in ${serverFile} were altered; restore the original response shape`, [serverFile])
    }
    if (kind === 'UI_PAGE') {
      const html = Object.entries(files).filter(([p]) => /\.html?$/.test(p)).map(([, t]) => t).join('\n')
      const miss = missingDomIds(html, clientFiles.flatMap((f) => domIds(files[f])))
      if (miss.length) facts.push(`the page lacks ids the client reads: ${miss.join(', ')}`)
      const enc = /readFileSync\([^,)]+,\s*'(?!utf8|utf-8|latin1|ascii|base64|hex)[^']*'\)/.exec(serverText)?.[0]
      if (enc) { facts.push(`${serverFile} reads a static file with an invalid encoding argument: ${enc}`); H(kind, `static:${serverFile}`, `${serverFile} serves a static file with ${enc}; the second argument of readFileSync must be an encoding such as 'utf8', not a content type`, [serverFile]) }
      if (miss.length) H(kind, 'ui:dom-ids', `the page is missing elements the client script reads (${miss.join(', ')})`, Object.keys(files).filter((p) => /\.html?$/.test(p)))
      H(kind, 'ui:client', `the client script does not call the endpoints named in the contract or does not render the results`, clientFiles)
    }
    if (kind === 'PERSISTENCE') {
      if (inp.probe) facts.push(`storage round-trip probe: ${inp.probe.verdict} - ${inp.probe.detail}`)
      for (const d of drift) { facts.push(`legacy state drift: ${d.file} ${d.fn}() ${d.was} -> ${d.now}`); H(kind, `persist:legacy-drift:${d.file}`, `${d.fn}() in ${d.file} is an existing export that used ${d.was}; it now reads/writes the NEW state ${d.now}, so data of the old feature leaks into the new entity (and the reverse). Keep it on its own state and add new functions for the new entity`, [d.file]) }
      for (const p of persistIssues) { facts.push(p); H(kind, `persist:contract:${p.slice(0, 50)}`, p, [/^[^:]+: (\S+)/.exec(p)?.[1] ?? Object.keys(files).find((f) => /store|feed|repo|db/i.test(f) && SOURCE(f)) ?? ''].filter((f) => files[f] !== undefined)) }
      if (inp.probe?.verdict === 'FAIL' && inp.probe.module) H(kind, `persist:roundtrip:${inp.probe.module}`, `round trip through ${inp.probe.module} fails: ${inp.probe.detail}`, [inp.probe.module])
      H(kind, 'persist:cascade', `the storage round trip itself is not broken; this check fails on data produced by earlier functional defects in the same scenario. Fix the other failing checks first and re-run`, [])
    }
    return { n: c.n, name: c.name, message: c.message, kind, facts, hypotheses: hyps }
  })
  out.sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind) || a.n - b.n)
  const seen = new Set<string>(), queue: Hypothesis[] = []
  for (const c of out) for (const h of c.hypotheses) if (!seen.has(h.key)) { seen.add(h.key); queue.push(h) }
  // a cascade hypothesis has no files of its own: it points at the files of the other failing checks
  for (const h of queue) if (!h.files.length) h.files = [...new Set(queue.filter((x) => x.key !== h.key).flatMap((x) => x.files))].slice(0, 2)
  const sig = new Map(out.map((c) => [c.n, `${c.name}::${c.message.replace(/\d{6,}/g, '<n>').replace(/\/[\w./-]+\//g, '<path>/')}`]))
  return { checks: out, queue, files: [...new Set(queue.flatMap((h) => h.files))], signatureOf: (n) => sig.get(n) ?? '' }
}

/** Text handed to the analyst/repair prompts: facts and the hypothesis to act on, not raw verifier prose. */
export function renderEvidence(ev: StructuredEvidence, focus: Hypothesis | null, refuted: { key: string; why: string }[]): string {
  const rows = ev.checks.slice(0, 6).map((c) => `- check ${c.n} [${c.kind}] ${c.name}\n    observed: ${c.message.slice(0, 200) || 'n/a'}${c.facts.length ? '\n' + c.facts.slice(0, 6).map((f) => `    fact: ${f}`).join('\n') : ''}`)
  return [
    'ENGINE EVIDENCE (deterministic: derived from the failing checks and the code, not guessed):',
    ...rows,
    focus ? `HYPOTHESIS TO ACT ON NOW (${focus.key}): ${focus.statement}` : '',
    refuted.length ? `REFUTED HYPOTHESES (acted on, the failing check did not change; do NOT repeat them):\n${refuted.map((r) => `- ${r.key}: ${r.why}`).join('\n')}` : '',
  ].filter(Boolean).join('\n')
}
export { acceptanceRoutes }
