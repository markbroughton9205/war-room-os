import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * FIXTURE C — "event-feed" baseline (in-memory event log) -> persistent alert center.
 * A different engineering shape from fixture A (sessions + messages) and fixture B (status state machine): per-item boolean flags toggled through
 * ACTION sub-resources (POST /api/alerts/:id/read|unread|archive), a derived-state list filter (unread/read/archived/all) combined with a severity filter,
 * a bulk operation (read-all), a counter endpoint whose numbers depend on two flags, a cross-flag rule (archived alerts cannot be marked read),
 * and flags + id sequence that must survive a restart. Same layers: storage, service, API, UI, tests, runtime.
 */
export const ALERT_FEATURE = {
  request: 'Turn the event feed into a persistent alert center: alerts have a title, a severity (info, warning or critical; default info), a read flag and an archived flag; the API can create alerts, mark them read or unread, archive (dismiss) them, list them with state and severity filters, mark all read, and report the unread count; alerts and their flags survive a server restart; and the page shows the alert list with an unread badge and a filter.',
  acceptance: [
    'POST /api/alerts with a title creates an alert (201) with a numeric id, severity "info" unless given, read false and archived false; an empty title or a severity other than info, warning or critical is rejected with 400',
    'POST /api/alerts/:id/read sets read to true and POST /api/alerts/:id/unread sets it back to false (both return the alert with 200); an unknown alert id returns 404',
    'POST /api/alerts/:id/archive sets archived to true (200, repeating it is harmless); marking an archived alert read or unread is rejected with 409',
    'GET /api/alerts lists alerts that are not archived; ?state=unread returns only unread alerts that are not archived, ?state=read only read alerts that are not archived, ?state=archived only archived alerts, ?state=all every alert; ?severity=critical (or warning, info) narrows any of these',
    'GET /api/alerts/unread-count returns {"unread":n,"critical":n}: the number of alerts that are unread and not archived, and how many of those are critical',
    'POST /api/alerts/read-all marks every non-archived alert read and returns {"updated":n} with the number of alerts that changed',
    'alerts, their read and archived flags and the id sequence are persisted to disk in the file named by the ALERTS_FILE environment variable (default: data/alerts.json under the working directory) and survive a server restart; alert ids are never reused',
    'the existing GET/POST /api/events endpoints keep working',
    'the page shows the alert list (element id alert-list), an unread badge (id unread-badge) and a filter control (id alert-filter), filled from /api/alerts and /api/alerts/unread-count, with a way to mark an alert read and to archive it',
    'node tests cover the new alert service functions',
  ],
  hints: ['alert', 'unread'],
}

const files: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'event-feed', version: '1.0.0', type: 'module', scripts: { start: 'node server.mjs', test: 'node --test test/' } }, null, 2),
  'src/eventFeed.mjs': `// In-memory event log (lost on restart).
const events = []
let nextId = 1

export function allEvents() {
  return events
}

export function pushEvent(event) {
  const stored = { id: nextId++, ...event }
  events.push(stored)
  return stored
}
`,
  'src/eventService.mjs': `import { allEvents, pushEvent } from './eventFeed.mjs'

export function checkMessage(message) {
  if (typeof message !== 'string' || message.trim() === '') throw new Error('message is required')
  if (message.length > 300) throw new Error('message too long')
  return message.trim()
}

export function listEvents() {
  return allEvents()
}

export function addEvent(input) {
  const message = checkMessage(input && input.message)
  return pushEvent({ message, at: new Date().toISOString() })
}
`,
  'server.mjs': `import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { addEvent, listEvents } from './src/eventService.mjs'

const port = Number(process.env.PORT || 3300)

function reply(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'content-type': type })
  res.end(typeof body === 'string' ? body : JSON.stringify(body))
}

async function body(req) {
  let raw = ''
  for await (const chunk of req) raw += chunk
  return raw ? JSON.parse(raw) : {}
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  try {
    if (url.pathname === '/') return reply(res, 200, readFileSync('public/index.html', 'utf8'), 'text/html')
    if (url.pathname === '/client.js') return reply(res, 200, readFileSync('public/client.js', 'utf8'), 'text/javascript')
    if (url.pathname === '/api/events' && req.method === 'GET') return reply(res, 200, listEvents())
    if (url.pathname === '/api/events' && req.method === 'POST') return reply(res, 201, addEvent(await body(req)))
    return reply(res, 404, { error: 'not found' })
  } catch (err) {
    return reply(res, 400, { error: String(err.message || err) })
  }
})

server.listen(port, '127.0.0.1', () => console.log('event-feed listening on ' + port))
`,
  'public/index.html': `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Event feed</title></head>
<body>
  <h1>Event feed</h1>
  <ul id="event-list"></ul>
  <form id="event-form"><input id="event-message" placeholder="what happened"><button type="submit">Post</button></form>
  <script src="/client.js"></script>
</body>
</html>
`,
  'public/client.js': `async function load() {
  const events = await (await fetch('/api/events')).json()
  const ul = document.getElementById('event-list')
  ul.innerHTML = ''
  for (const e of events) {
    const li = document.createElement('li')
    li.textContent = e.message
    ul.appendChild(li)
  }
}

document.getElementById('event-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const input = document.getElementById('event-message')
  await fetch('/api/events', { method: 'POST', body: JSON.stringify({ message: input.value }) })
  input.value = ''
  load()
})

load()
`,
  'test/eventService.test.mjs': `import test from 'node:test'
import assert from 'node:assert'
import { addEvent, listEvents, checkMessage } from '../src/eventService.mjs'

test('adds and lists events', () => {
  const e = addEvent({ message: ' deploy finished ' })
  assert.strictEqual(e.message, 'deploy finished')
  assert.ok(listEvents().some((x) => x.id === e.id))
})

test('rejects an empty message', () => {
  assert.throws(() => checkMessage('   '), /required/)
})
`,
}

export function makeAlertApp(root: string): string {
  for (const [rel, body] of Object.entries(files)) { mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); writeFileSync(path.join(root, rel), body) }
  return root
}

/** Independently written reference (used ONLY to validate the verifier and for scripted-mechanics tests; never shown to a model). */
export const ALERT_REFERENCE: Record<string, string> = {
  'src/alertStore.mjs': `import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export function alertsFile() {
  return process.env.ALERTS_FILE || path.join(process.cwd(), 'data', 'alerts.json')
}

export function readAlerts() {
  const file = alertsFile()
  if (!existsSync(file)) return { lastId: 0, alerts: [] }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return { lastId: Number(parsed.lastId) || 0, alerts: Array.isArray(parsed.alerts) ? parsed.alerts : [] }
  } catch {
    return { lastId: 0, alerts: [] }
  }
}

export function writeAlerts(state) {
  const file = alertsFile()
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(state, null, 2))
  renameSync(tmp, file)
}
`,
  'src/alertService.mjs': `import { readAlerts, writeAlerts } from './alertStore.mjs'

export const SEVERITIES = ['info', 'warning', 'critical']

export class AlertError extends Error {
  constructor(code, message) { super(message); this.code = code }
}

export function createAlert(input) {
  const title = input && typeof input.title === 'string' ? input.title.trim() : ''
  if (!title) throw new AlertError(400, 'title is required')
  const severity = input.severity === undefined ? 'info' : input.severity
  if (!SEVERITIES.includes(severity)) throw new AlertError(400, 'severity must be info, warning or critical')
  const state = readAlerts()
  const alert = { id: state.lastId + 1, title, severity, read: false, archived: false }
  state.lastId = alert.id
  state.alerts.push(alert)
  writeAlerts(state)
  return alert
}

function change(id, edit) {
  const state = readAlerts()
  const alert = state.alerts.find((a) => a.id === Number(id))
  if (!alert) throw new AlertError(404, 'alert not found')
  edit(alert)
  writeAlerts(state)
  return alert
}

export function markRead(id, read) {
  return change(id, (a) => {
    if (a.archived) throw new AlertError(409, 'archived alerts cannot be changed')
    a.read = read
  })
}

export function archiveAlert(id) {
  return change(id, (a) => { a.archived = true })
}

export function listAlerts(state, severity) {
  const want = state || 'active'
  return readAlerts().alerts.filter((a) => {
    if (severity && a.severity !== severity) return false
    if (want === 'all') return true
    if (want === 'archived') return a.archived
    if (a.archived) return false
    if (want === 'unread') return !a.read
    if (want === 'read') return a.read
    return true
  })
}

export function unreadCount() {
  const open = readAlerts().alerts.filter((a) => !a.archived && !a.read)
  return { unread: open.length, critical: open.filter((a) => a.severity === 'critical').length }
}

export function readAll() {
  const state = readAlerts()
  let updated = 0
  for (const a of state.alerts) if (!a.archived && !a.read) { a.read = true; updated += 1 }
  if (updated) writeAlerts(state)
  return { updated }
}
`,
  'server.mjs': `import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { addEvent, listEvents } from './src/eventService.mjs'
import { AlertError, archiveAlert, createAlert, listAlerts, markRead, readAll, unreadCount } from './src/alertService.mjs'

const port = Number(process.env.PORT || 3300)

function reply(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'content-type': type })
  res.end(typeof body === 'string' ? body : JSON.stringify(body))
}

async function body(req) {
  let raw = ''
  for await (const chunk of req) raw += chunk
  return raw ? JSON.parse(raw) : {}
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const action = /^\\/api\\/alerts\\/(\\d+)\\/(read|unread|archive)$/.exec(url.pathname)
  try {
    if (url.pathname === '/') return reply(res, 200, readFileSync('public/index.html', 'utf8'), 'text/html')
    if (url.pathname === '/client.js') return reply(res, 200, readFileSync('public/client.js', 'utf8'), 'text/javascript')
    if (url.pathname === '/api/events' && req.method === 'GET') return reply(res, 200, listEvents())
    if (url.pathname === '/api/events' && req.method === 'POST') return reply(res, 201, addEvent(await body(req)))
    if (url.pathname === '/api/alerts/unread-count' && req.method === 'GET') return reply(res, 200, unreadCount())
    if (url.pathname === '/api/alerts/read-all' && req.method === 'POST') return reply(res, 200, readAll())
    if (url.pathname === '/api/alerts' && req.method === 'GET') return reply(res, 200, listAlerts(url.searchParams.get('state'), url.searchParams.get('severity')))
    if (url.pathname === '/api/alerts' && req.method === 'POST') return reply(res, 201, createAlert(await body(req)))
    if (url.pathname.startsWith('/api/alerts/') && req.method === 'POST') {
      if (!action) return reply(res, 404, { error: 'alert not found' })
      if (action[2] === 'archive') return reply(res, 200, archiveAlert(action[1]))
      return reply(res, 200, markRead(action[1], action[2] === 'read'))
    }
    return reply(res, 404, { error: 'not found' })
  } catch (err) {
    if (err instanceof AlertError) return reply(res, err.code, { error: err.message })
    return reply(res, 400, { error: String(err.message || err) })
  }
})

server.listen(port, '127.0.0.1', () => console.log('event-feed listening on ' + port))
`,
  'public/index.html': `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Alert center</title></head>
<body>
  <h1>Alerts <span id="unread-badge">0</span></h1>
  <select id="alert-filter">
    <option value="active">Active</option>
    <option value="unread">Unread</option>
    <option value="read">Read</option>
    <option value="archived">Archived</option>
    <option value="all">All</option>
  </select>
  <ul id="alert-list"></ul>
  <form id="alert-form"><input id="alert-title" placeholder="new alert"><button type="submit">Add</button></form>
  <script src="/client.js"></script>
</body>
</html>
`,
  'public/client.js': `async function render() {
  const state = document.getElementById('alert-filter').value
  const alerts = await (await fetch('/api/alerts?state=' + state)).json()
  const count = await (await fetch('/api/alerts/unread-count')).json()
  document.getElementById('unread-badge').textContent = String(count.unread)
  const ul = document.getElementById('alert-list')
  ul.innerHTML = ''
  for (const a of alerts) {
    const li = document.createElement('li')
    li.textContent = '[' + a.severity + '] ' + a.title + (a.read ? ' (read) ' : ' ')
    const toggle = document.createElement('button')
    toggle.textContent = a.read ? 'mark unread' : 'mark read'
    toggle.addEventListener('click', async () => { await fetch('/api/alerts/' + a.id + '/' + (a.read ? 'unread' : 'read'), { method: 'POST' }); render() })
    const arch = document.createElement('button')
    arch.textContent = 'archive'
    arch.addEventListener('click', async () => { await fetch('/api/alerts/' + a.id + '/archive', { method: 'POST' }); render() })
    li.append(toggle, arch)
    ul.appendChild(li)
  }
}

document.getElementById('alert-filter').addEventListener('change', render)
document.getElementById('alert-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const input = document.getElementById('alert-title')
  await fetch('/api/alerts', { method: 'POST', body: JSON.stringify({ title: input.value }) })
  input.value = ''
  render()
})

render()
`,
  'test/alertService.test.mjs': `import test from 'node:test'
import assert from 'node:assert'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

process.env.ALERTS_FILE = path.join(mkdtempSync(path.join(tmpdir(), 'alerts-')), 'alerts.json')
const svc = await import('../src/alertService.mjs')

test('new alerts are unread, unarchived and info by default', () => {
  const a = svc.createAlert({ title: 'disk full' })
  assert.strictEqual(a.read, false)
  assert.strictEqual(a.archived, false)
  assert.strictEqual(a.severity, 'info')
})

test('archived alerts cannot be marked read', () => {
  const a = svc.createAlert({ title: 'old news' })
  svc.archiveAlert(a.id)
  assert.throws(() => svc.markRead(a.id, true), (e) => e.code === 409)
})

test('unread count ignores read and archived alerts', () => {
  const before = svc.unreadCount().unread
  const a = svc.createAlert({ title: 'fresh', severity: 'critical' })
  assert.strictEqual(svc.unreadCount().unread, before + 1)
  svc.markRead(a.id, true)
  assert.strictEqual(svc.unreadCount().unread, before)
})
`,
}

export const ALERT_VERIFY_SCRIPT = `import { spawn } from 'node:child_process'
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = process.argv[2]
const dataFile = path.join(mkdtempSync(path.join(tmpdir(), 'verify-alert-')), 'alerts.json')
let n = 0, pass = 0, fail = 0
const report = (ok, name, detail = '') => { n += 1; if (ok) pass += 1; else fail += 1; console.log((ok ? 'ok ' : 'not ok ') + n + ' - ' + name + (ok || !detail ? '' : '\\n  message: ' + String(detail).slice(0, 300))) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function start() {
  const port = 21000 + Math.floor(Math.random() * 15000)
  const child = spawn('node', ['server.mjs'], { cwd: root, env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), ALERTS_FILE: dataFile }, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  child.stdout.on('data', (d) => { out += d }); child.stderr.on('data', (d) => { out += d })
  const base = 'http://127.0.0.1:' + port
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error('server exited: ' + out.slice(-300))
    try { await fetch(base + '/', { signal: AbortSignal.timeout(300) }); return { base, child } } catch { await sleep(100) }
  }
  child.kill('SIGKILL'); throw new Error('server did not start: ' + out.slice(-300))
}
const stop = (c) => new Promise((r) => { if (c.exitCode !== null) return r(); c.once('exit', () => r()); c.kill('SIGTERM'); setTimeout(() => c.kill('SIGKILL'), 1500) })
const json = async (res) => { try { return await res.json() } catch { return null } }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const ids = (list) => Array.isArray(list) ? list.map((a) => a.id).sort((x, y) => x - y) : null

let srv
try {
  srv = await start()
  const send = (method, p, body) => fetch(srv.base + p, { method, body: body === undefined ? undefined : JSON.stringify(body) })
  const c1 = await send('POST', '/api/alerts', { title: 'disk full', severity: 'critical' }); const a1 = await json(c1)
  const cd = await json(await send('POST', '/api/alerts', { title: 'deploy done' })); const a2 = cd
  report(c1.status === 201 && a1 && typeof a1.id === 'number' && a1.severity === 'critical' && a1.read === false && a1.archived === false && a2 && a2.severity === 'info' && a2.read === false, 'POST /api/alerts creates unread, unarchived alerts with default severity info', 'status=' + c1.status + ' a1=' + JSON.stringify(a1) + ' a2=' + JSON.stringify(a2))
  const bad1 = await send('POST', '/api/alerts', { title: '  ' }); const bad2 = await send('POST', '/api/alerts', { title: 'x', severity: 'urgent' })
  report(bad1.status === 400 && bad2.status === 400, 'an empty title and an unknown severity are rejected with 400', 'title=' + bad1.status + ' severity=' + bad2.status)
  const a3 = await json(await send('POST', '/api/alerts', { title: 'cpu high', severity: 'warning' })); const a4 = await json(await send('POST', '/api/alerts', { title: 'cert expiring', severity: 'critical' }))
  const r1 = await send('POST', '/api/alerts/' + a2.id + '/read'); const rj = await json(r1)
  const u1 = await send('POST', '/api/alerts/' + a2.id + '/unread'); const uj = await json(u1)
  await send('POST', '/api/alerts/' + a2.id + '/read')
  report(r1.status === 200 && rj && rj.read === true && u1.status === 200 && uj && uj.read === false, 'POST /:id/read and /:id/unread toggle the read flag', 'read=' + r1.status + JSON.stringify(rj) + ' unread=' + u1.status + JSON.stringify(uj))
  const missing = await send('POST', '/api/alerts/99999/read'); const missingA = await send('POST', '/api/alerts/99999/archive')
  report(missing.status === 404 && missingA.status === 404, 'an unknown alert id returns 404', 'read=' + missing.status + ' archive=' + missingA.status)
  const ar = await send('POST', '/api/alerts/' + a3.id + '/archive'); const arj = await json(ar); const ar2 = await send('POST', '/api/alerts/' + a3.id + '/archive')
  const blockedRead = await send('POST', '/api/alerts/' + a3.id + '/read'); const blockedUnread = await send('POST', '/api/alerts/' + a3.id + '/unread')
  report(ar.status === 200 && arj && arj.archived === true && ar2.status === 200 && blockedRead.status === 409 && blockedUnread.status === 409, 'archiving works, is repeatable, and an archived alert cannot be marked read or unread (409)', 'archive=' + ar.status + JSON.stringify(arj) + ' again=' + ar2.status + ' read=' + blockedRead.status + ' unread=' + blockedUnread.status)
  const def = await json(await send('GET', '/api/alerts')); const un = await json(await send('GET', '/api/alerts?state=unread')); const rd = await json(await send('GET', '/api/alerts?state=read')); const arch = await json(await send('GET', '/api/alerts?state=archived')); const all = await json(await send('GET', '/api/alerts?state=all'))
  report(same(ids(def), [a1.id, a2.id, a4.id].sort((x, y) => x - y)) && same(ids(un), [a1.id, a4.id].sort((x, y) => x - y)) && same(ids(rd), [a2.id]) && same(ids(arch), [a3.id]) && same(ids(all), [a1.id, a2.id, a3.id, a4.id].sort((x, y) => x - y)), 'the list excludes archived by default and ?state=unread|read|archived|all select the right alerts', 'def=' + JSON.stringify(ids(def)) + ' unread=' + JSON.stringify(ids(un)) + ' read=' + JSON.stringify(ids(rd)) + ' archived=' + JSON.stringify(ids(arch)) + ' all=' + JSON.stringify(ids(all)))
  const crit = await json(await send('GET', '/api/alerts?severity=critical')); const critAll = await json(await send('GET', '/api/alerts?state=all&severity=warning')); const critUn = await json(await send('GET', '/api/alerts?state=unread&severity=info'))
  report(same(ids(crit), [a1.id, a4.id].sort((x, y) => x - y)) && same(ids(critAll), [a3.id]) && Array.isArray(critUn) && critUn.length === 0, 'the severity filter narrows any state filter', 'critical=' + JSON.stringify(ids(crit)) + ' warning/all=' + JSON.stringify(ids(critAll)) + ' info/unread=' + JSON.stringify(ids(critUn)))
  const cnt = await json(await send('GET', '/api/alerts/unread-count'))
  report(same(cnt, { unread: 2, critical: 2 }), 'GET /api/alerts/unread-count counts unread, non-archived alerts and how many are critical', JSON.stringify(cnt))
  const ra = await send('POST', '/api/alerts/read-all'); const raj = await json(ra); const cnt0 = await json(await send('GET', '/api/alerts/unread-count')); const ra2 = await json(await send('POST', '/api/alerts/read-all'))
  report(ra.status === 200 && same(raj, { updated: 2 }) && same(cnt0, { unread: 0, critical: 0 }) && same(ra2, { updated: 0 }), 'POST /api/alerts/read-all marks the non-archived alerts read and reports how many changed', 'status=' + ra.status + ' body=' + JSON.stringify(raj) + ' count=' + JSON.stringify(cnt0) + ' again=' + JSON.stringify(ra2))
  const legacyPost = await send('POST', '/api/events', { message: 'legacy' }); const legacy = await json(await send('GET', '/api/events'))
  report(legacyPost.status === 201 && Array.isArray(legacy) && legacy.some((e) => e.message === 'legacy'), 'the existing /api/events endpoints keep working', 'post=' + legacyPost.status + ' list=' + JSON.stringify(legacy))
  const html = await (await send('GET', '/')).text(); const js = await (await send('GET', '/client.js')).text()
  report(/id="alert-list"/.test(html) && /id="unread-badge"/.test(html) && /id="alert-filter"/.test(html) && /\\/api\\/alerts/.test(js) && /unread-count/.test(js), 'the page has the alert list, unread badge and filter, and the client script calls /api/alerts and /api/alerts/unread-count', 'list=' + /id="alert-list"/.test(html) + ' badge=' + /id="unread-badge"/.test(html) + ' filter=' + /id="alert-filter"/.test(html))
  const a5 = await json(await send('POST', '/api/alerts', { title: 'after read-all', severity: 'warning' }))
  const persisted = existsSync(dataFile) && /disk full/.test(readFileSync(dataFile, 'utf8'))
  await stop(srv.child)
  srv = await start()
  const afterAll = await json(await send('GET', '/api/alerts?state=all')); const afterArch = await json(await send('GET', '/api/alerts?state=archived')); const afterCnt = await json(await send('GET', '/api/alerts/unread-count'))
  const next = await json(await send('POST', '/api/alerts', { title: 'after restart' }))
  report(persisted && ids(afterAll) && ids(afterAll).length === 5 && same(ids(afterArch), [a3.id]) && same(afterCnt, { unread: 1, critical: 0 }) && next && next.id > Math.max(a1.id, a2.id, a3.id, a4.id, a5.id), 'alerts, their read/archived flags and the id sequence persist in ALERTS_FILE across a restart', 'persisted=' + persisted + ' all=' + JSON.stringify(ids(afterAll)) + ' archived=' + JSON.stringify(ids(afterArch)) + ' count=' + JSON.stringify(afterCnt) + ' next=' + JSON.stringify(next))
} catch (err) {
  report(false, 'verification could not complete', String(err.message || err))
} finally { if (srv) await stop(srv.child) }
console.log('# tests ' + n); console.log('# pass ' + pass); console.log('# fail ' + fail)
process.exit(fail === 0 && n >= 8 ? 0 : 1)
`
