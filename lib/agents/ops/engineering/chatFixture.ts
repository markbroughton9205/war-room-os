import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/** Baseline "chat-app": in-memory messages only. The feature to build: persistent named chat sessions (storage + service + API + UI + tests + runtime). */
export const CHAT_FEATURE = {
  request: 'Add persistent chat sessions: users can create named sessions, each session keeps its own message history that survives a server restart, and the page lists the sessions and shows the selected session\'s messages.',
  acceptance: [
    'POST /api/sessions with a name creates a session (201) and rejects an empty name (400)',
    'GET /api/sessions lists sessions; GET /api/sessions/:id returns one session with its messages; unknown ids return 404',
    'POST /api/sessions/:id/messages stores a message in that session only',
    'sessions and their messages are persisted to disk and survive a server restart',
    'the data file path comes from the CHAT_DATA_FILE environment variable (default: data/sessions.json under the working directory)',
    'the existing GET/POST /api/messages endpoints keep working',
    'the page lists the sessions and lets the user create a session and select one to see its messages',
    'node tests cover the new session service functions',
  ],
  hints: ['session', 'persist'],
}

const files: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'chat-app', version: '1.0.0', type: 'module', scripts: { start: 'node server.mjs', test: 'node --test test/' } }, null, 2),
  'src/messageStore.mjs': `// In-memory message store (lost on restart).
const messages = []

export function allMessages() {
  return messages
}

export function pushMessage(message) {
  messages.push(message)
  return message
}
`,
  'src/chatService.mjs': `import { allMessages, pushMessage } from './messageStore.mjs'

export function validateMessage(input) {
  if (!input || typeof input.text !== 'string' || input.text.trim() === '') throw new Error('text is required')
  if (input.text.length > 1000) throw new Error('text too long')
  return { text: input.text.trim(), author: typeof input.author === 'string' && input.author.trim() ? input.author.trim() : 'anonymous' }
}

export function listMessages() {
  return allMessages()
}

export function addMessage(input) {
  const valid = validateMessage(input)
  return pushMessage({ id: String(allMessages().length + 1), text: valid.text, author: valid.author, at: new Date().toISOString() })
}
`,
  'server.mjs': `import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { addMessage, listMessages } from './src/chatService.mjs'

const port = Number(process.env.PORT || 3200)

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'content-type': type })
  res.end(typeof body === 'string' ? body : JSON.stringify(body))
}

async function readJson(req) {
  let raw = ''
  for await (const chunk of req) raw += chunk
  return JSON.parse(raw || '{}')
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  try {
    if (url.pathname === '/' || url.pathname === '/index.html') return send(res, 200, readFileSync('public/index.html', 'utf8'), 'text/html')
    if (url.pathname === '/app.js') return send(res, 200, readFileSync('public/app.js', 'utf8'), 'text/javascript')
    if (url.pathname === '/api/messages' && req.method === 'GET') return send(res, 200, listMessages())
    if (url.pathname === '/api/messages' && req.method === 'POST') return send(res, 201, addMessage(await readJson(req)))
    return send(res, 404, { error: 'not found' })
  } catch (err) {
    return send(res, 400, { error: String(err.message || err) })
  }
})

server.listen(port, '127.0.0.1', () => console.log('chat-app listening on ' + port))
`,
  'public/index.html': `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Chat</title></head>
<body>
  <h1>Chat</h1>
  <ul id="messages"></ul>
  <form id="chat-form"><input id="chat-text" placeholder="say something"><button type="submit">Send</button></form>
  <script src="/app.js"></script>
</body>
</html>
`,
  'public/app.js': `async function refresh() {
  const res = await fetch('/api/messages')
  const messages = await res.json()
  const list = document.getElementById('messages')
  list.innerHTML = ''
  for (const m of messages) {
    const li = document.createElement('li')
    li.textContent = m.author + ': ' + m.text
    list.appendChild(li)
  }
}

document.getElementById('chat-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const input = document.getElementById('chat-text')
  await fetch('/api/messages', { method: 'POST', body: JSON.stringify({ text: input.value }) })
  input.value = ''
  refresh()
})

refresh()
`,
  'test/chatService.test.mjs': `import test from 'node:test'
import assert from 'node:assert'
import { addMessage, listMessages, validateMessage } from '../src/chatService.mjs'

test('adds and lists messages', () => {
  const m = addMessage({ text: ' hello ', author: 'mark' })
  assert.strictEqual(m.text, 'hello')
  assert.ok(listMessages().some((x) => x.id === m.id))
})

test('rejects empty text', () => {
  assert.throws(() => validateMessage({ text: '  ' }), /required/)
})
`,
}

export function makeChatApp(root: string): string {
  for (const [rel, body] of Object.entries(files)) { mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); writeFileSync(path.join(root, rel), body) }
  return root
}

/** A correct reference implementation of the feature (used ONLY to validate the verifier and the scripted-model mechanics tests). */
export const CHAT_REFERENCE: Record<string, string> = {
  'src/messageStore.mjs': `import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export function dataFile() {
  return process.env.CHAT_DATA_FILE || path.join(process.cwd(), 'data', 'sessions.json')
}

export function loadSessions() {
  const file = dataFile()
  if (!existsSync(file)) return []
  return JSON.parse(readFileSync(file, 'utf8'))
}

export function saveSessions(sessions) {
  const file = dataFile()
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(sessions, null, 2))
}

// Legacy helpers kept for the existing endpoints: they operate on the default session.
export function allMessages() {
  const s = loadSessions().find((x) => x.id === 'default')
  return s ? s.messages : []
}

export function pushMessage(message) {
  const sessions = loadSessions()
  let s = sessions.find((x) => x.id === 'default')
  if (!s) { s = { id: 'default', name: 'default', createdAt: new Date().toISOString(), messages: [] }; sessions.push(s) }
  s.messages.push(message)
  saveSessions(sessions)
  return message
}
`,
  'src/chatService.mjs': `import { allMessages, loadSessions, pushMessage, saveSessions } from './messageStore.mjs'

export function validateMessage(input) {
  if (!input || typeof input.text !== 'string' || input.text.trim() === '') throw new Error('text is required')
  if (input.text.length > 1000) throw new Error('text too long')
  return { text: input.text.trim(), author: typeof input.author === 'string' && input.author.trim() ? input.author.trim() : 'anonymous' }
}

export function listMessages() {
  return allMessages()
}

export function addMessage(input) {
  const valid = validateMessage(input)
  return pushMessage({ id: String(allMessages().length + 1), text: valid.text, author: valid.author, at: new Date().toISOString() })
}

export function createSession(name) {
  if (typeof name !== 'string' || name.trim() === '') throw new Error('name is required')
  const sessions = loadSessions()
  const session = { id: 's' + Date.now() + '-' + sessions.length, name: name.trim(), createdAt: new Date().toISOString(), messages: [] }
  sessions.push(session)
  saveSessions(sessions)
  return session
}

export function listSessions() {
  return loadSessions().map((s) => ({ id: s.id, name: s.name, createdAt: s.createdAt, messageCount: s.messages.length }))
}

export function getSession(id) {
  return loadSessions().find((s) => s.id === id) || null
}

export function addSessionMessage(id, input) {
  const valid = validateMessage(input)
  const sessions = loadSessions()
  const s = sessions.find((x) => x.id === id)
  if (!s) return null
  const message = { id: String(s.messages.length + 1), text: valid.text, author: valid.author, at: new Date().toISOString() }
  s.messages.push(message)
  saveSessions(sessions)
  return message
}
`,
  'server.mjs': `import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { addMessage, addSessionMessage, createSession, getSession, listMessages, listSessions } from './src/chatService.mjs'

const port = Number(process.env.PORT || 3200)

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'content-type': type })
  res.end(typeof body === 'string' ? body : JSON.stringify(body))
}

async function readJson(req) {
  let raw = ''
  for await (const chunk of req) raw += chunk
  return JSON.parse(raw || '{}')
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  try {
    if (url.pathname === '/' || url.pathname === '/index.html') return send(res, 200, readFileSync('public/index.html', 'utf8'), 'text/html')
    if (url.pathname === '/app.js') return send(res, 200, readFileSync('public/app.js', 'utf8'), 'text/javascript')
    if (url.pathname === '/api/messages' && req.method === 'GET') return send(res, 200, listMessages())
    if (url.pathname === '/api/messages' && req.method === 'POST') return send(res, 201, addMessage(await readJson(req)))
    if (url.pathname === '/api/sessions' && req.method === 'GET') return send(res, 200, listSessions())
    if (url.pathname === '/api/sessions' && req.method === 'POST') return send(res, 201, createSession((await readJson(req)).name))
    const m = /^\\/api\\/sessions\\/([^/]+)(\\/messages)?$/.exec(url.pathname)
    if (m) {
      const id = decodeURIComponent(m[1])
      if (!m[2] && req.method === 'GET') { const s = getSession(id); return s ? send(res, 200, s) : send(res, 404, { error: 'session not found' }) }
      if (m[2] && req.method === 'POST') { const msg = addSessionMessage(id, await readJson(req)); return msg ? send(res, 201, msg) : send(res, 404, { error: 'session not found' }) }
    }
    return send(res, 404, { error: 'not found' })
  } catch (err) {
    return send(res, 400, { error: String(err.message || err) })
  }
})

server.listen(port, '127.0.0.1', () => console.log('chat-app listening on ' + port))
`,
  'public/index.html': `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Chat</title></head>
<body>
  <h1>Chat</h1>
  <aside>
    <h2>Sessions</h2>
    <ul id="sessions"></ul>
    <form id="session-form"><input id="session-name" placeholder="new session name"><button type="submit">Create session</button></form>
  </aside>
  <ul id="messages"></ul>
  <form id="chat-form"><input id="chat-text" placeholder="say something"><button type="submit">Send</button></form>
  <script src="/app.js"></script>
</body>
</html>
`,
  'public/app.js': `let currentSession = null

async function loadSessions() {
  const res = await fetch('/api/sessions')
  const sessions = await res.json()
  const list = document.getElementById('sessions')
  list.innerHTML = ''
  for (const s of sessions) {
    const li = document.createElement('li')
    li.textContent = s.name + ' (' + s.messageCount + ')'
    li.addEventListener('click', () => { currentSession = s.id; loadMessages() })
    list.appendChild(li)
  }
}

async function loadMessages() {
  const list = document.getElementById('messages')
  list.innerHTML = ''
  if (!currentSession) return
  const res = await fetch('/api/sessions/' + currentSession)
  const session = await res.json()
  for (const m of session.messages) {
    const li = document.createElement('li')
    li.textContent = m.author + ': ' + m.text
    list.appendChild(li)
  }
}

document.getElementById('session-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const input = document.getElementById('session-name')
  await fetch('/api/sessions', { method: 'POST', body: JSON.stringify({ name: input.value }) })
  input.value = ''
  loadSessions()
})

document.getElementById('chat-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const input = document.getElementById('chat-text')
  if (currentSession) await fetch('/api/sessions/' + currentSession + '/messages', { method: 'POST', body: JSON.stringify({ text: input.value }) })
  input.value = ''
  loadSessions()
  loadMessages()
})

loadSessions()
`,
  'test/chatSessions.test.mjs': `import test from 'node:test'
import assert from 'node:assert'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

process.env.CHAT_DATA_FILE = path.join(mkdtempSync(path.join(tmpdir(), 'chat-')), 'sessions.json')
const svc = await import('../src/chatService.mjs')

test('creates and lists sessions', () => {
  const s = svc.createSession('alpha')
  assert.strictEqual(s.name, 'alpha')
  assert.ok(svc.listSessions().some((x) => x.id === s.id))
})

test('rejects empty session names', () => {
  assert.throws(() => svc.createSession('  '), /required/)
})

test('keeps messages per session and persists them', () => {
  const a = svc.createSession('a')
  const b = svc.createSession('b')
  svc.addSessionMessage(a.id, { text: 'hi a' })
  assert.strictEqual(svc.getSession(a.id).messages.length, 1)
  assert.strictEqual(svc.getSession(b.id).messages.length, 0)
})
`,
}

/** Independent verifier. It lives OUTSIDE the workspace, is not visible to the engineering worker, and exercises the real server over HTTP including a restart. */
export const CHAT_VERIFY_SCRIPT = `import { spawn } from 'node:child_process'
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = process.argv[2]
const dataFile = path.join(mkdtempSync(path.join(tmpdir(), 'verify-chat-')), 'sessions.json')
let n = 0, pass = 0, fail = 0
const report = (ok, name, detail = '') => { n += 1; if (ok) pass += 1; else fail += 1; console.log((ok ? 'ok ' : 'not ok ') + n + ' - ' + name + (ok || !detail ? '' : '\\n  message: ' + String(detail).slice(0, 300))) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function start() {
  const port = 21000 + Math.floor(Math.random() * 15000)
  const child = spawn('node', ['server.mjs'], { cwd: root, env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), CHAT_DATA_FILE: dataFile }, stdio: ['ignore', 'pipe', 'pipe'] })
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

let srv
try {
  srv = await start()
  const post = (p, body) => fetch(srv.base + p, { method: 'POST', body: JSON.stringify(body) })
  const r1 = await post('/api/sessions', { name: 'alpha' }); const s1 = await json(r1)
  report(r1.status === 201 && s1 && typeof s1.id === 'string' && s1.name === 'alpha', 'POST /api/sessions creates a named session', 'status=' + r1.status + ' body=' + JSON.stringify(s1))
  const r2 = await post('/api/sessions', { name: '   ' })
  report(r2.status === 400, 'empty session name is rejected with 400', 'status=' + r2.status)
  const s2 = await json(await post('/api/sessions', { name: 'beta' }))
  const m1 = await post('/api/sessions/' + s1.id + '/messages', { text: 'hello alpha', author: 'mark' }); const mm1 = await json(m1)
  report(m1.status === 201 && mm1 && mm1.text === 'hello alpha', 'POST /api/sessions/:id/messages stores a message', 'status=' + m1.status)
  const g1 = await json(await fetch(srv.base + '/api/sessions/' + s1.id)); const g2 = await json(await fetch(srv.base + '/api/sessions/' + s2.id))
  report(g1 && Array.isArray(g1.messages) && g1.messages.length === 1 && g1.messages[0].text === 'hello alpha', 'GET /api/sessions/:id returns that session with its messages', JSON.stringify(g1))
  report(g2 && Array.isArray(g2.messages) && g2.messages.length === 0, 'messages stay inside their own session', JSON.stringify(g2))
  const list = await json(await fetch(srv.base + '/api/sessions'))
  report(Array.isArray(list) && list.some((s) => s.name === 'alpha') && list.some((s) => s.name === 'beta'), 'GET /api/sessions lists sessions', JSON.stringify(list))
  const nf = await fetch(srv.base + '/api/sessions/does-not-exist'); const nfp = await post('/api/sessions/does-not-exist/messages', { text: 'x' })
  report(nf.status === 404 && nfp.status === 404, 'unknown session ids return 404', 'get=' + nf.status + ' post=' + nfp.status)
  const legacyPost = await post('/api/messages', { text: 'legacy' }); const legacy = await json(await fetch(srv.base + '/api/messages'))
  report(legacyPost.status === 201 && Array.isArray(legacy), 'existing /api/messages endpoints keep working', 'post=' + legacyPost.status)
  const html = await (await fetch(srv.base + '/')).text(); const js = await (await fetch(srv.base + '/app.js')).text()
  report(/id="sessions"/.test(html) && /\\/api\\/sessions/.test(js), 'the page has a sessions list and the client script calls the sessions API', 'html has #sessions=' + /id="sessions"/.test(html))
  report(existsSync(dataFile) && /alpha/.test(readFileSync(dataFile, 'utf8')), 'sessions are persisted to disk')
  await stop(srv.child)
  srv = await start()
  const after = await json(await fetch(srv.base + '/api/sessions/' + s1.id)); const listAfter = await json(await fetch(srv.base + '/api/sessions'))
  report(after && after.messages && after.messages.length === 1 && after.messages[0].text === 'hello alpha', 'a session and its messages survive a server restart', JSON.stringify(after))
  report(Array.isArray(listAfter) && listAfter.length >= 2, 'the session list survives a server restart', JSON.stringify(listAfter))
} catch (err) {
  report(false, 'verification could not complete', String(err.message || err))
} finally { if (srv) await stop(srv.child) }
console.log('# tests ' + n); console.log('# pass ' + pass); console.log('# fail ' + fail)
process.exit(fail === 0 && n >= 8 ? 0 : 1)
`
