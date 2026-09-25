/**
 * Disposable customer-support ticket manager for command-center acceptance.
 * Never clones Harbor Desk, Lane & Box, or Inventory Manager.
 */
export const TICKET_MANAGER_API_CONTRACT = {
  name: 'ticket-manager-api',
  version: '1',
  endpoints: [
    { method: 'GET', path: '/health', request: {}, response: { ok: true, brand: 'string' } },
    { method: 'GET', path: '/api/customers', request: { q: 'string?' }, response: { customers: 'Customer[]' } },
    { method: 'POST', path: '/api/customers', request: { name: 'string', email: 'string?', phone: 'string?' }, response: { customer: 'Customer' } },
    { method: 'GET', path: '/api/tickets', request: { q: 'string?', status: 'string?', customerId: 'string?' }, response: { tickets: 'Ticket[]' } },
    { method: 'POST', path: '/api/tickets', request: { customerId: 'string', title: 'string', status: 'string?', body: 'string?' }, response: { ticket: 'Ticket' } },
    { method: 'GET', path: '/api/tickets/:id', request: {}, response: { ticket: 'Ticket', notes: 'Note[]' } },
    { method: 'PATCH', path: '/api/tickets/:id', request: { title: 'string?', status: 'string?', body: 'string?' }, response: { ticket: 'Ticket' } },
    { method: 'POST', path: '/api/tickets/:id/notes', request: { body: 'string' }, response: { note: 'Note' } },
  ],
  statuses: ['open', 'pending', 'resolved', 'closed'],
} as const

export const TICKET_MANAGER_SCHEMA = {
  customers: 'customers(id TEXT PK, name TEXT, email TEXT, phone TEXT, created_at TEXT, updated_at TEXT)',
  tickets: 'tickets(id TEXT PK, customer_id TEXT, title TEXT, status TEXT, body TEXT, created_at TEXT, updated_at TEXT)',
  notes: 'notes(id TEXT PK, ticket_id TEXT, body TEXT, created_at TEXT)',
}

export const TICKET_ARCHITECT_FILES = ['.foundry/instructions.md', '.foundry/contracts/api.json', '.foundry/contracts/schema.json', 'package.json', 'README.md'] as const
export const TICKET_BACKEND_FILES = ['db.mjs', 'server.mjs'] as const
export const TICKET_FRONTEND_FILES = ['public/index.html', 'public/styles.css', 'public/app.js', 'public/logo.svg'] as const
export const TICKET_TEST_FILES = ['test.mjs'] as const

export function buildTicketManagerFiles(input: { brand: string; port: number }): Record<string, string> {
  const brand = input.brand
  const port = input.port
  return {
    'package.json': packageJson(),
    '.foundry/instructions.md': instructions(brand),
    '.foundry/contracts/api.json': JSON.stringify(TICKET_MANAGER_API_CONTRACT, null, 2) + '\n',
    '.foundry/contracts/schema.json': JSON.stringify(TICKET_MANAGER_SCHEMA, null, 2) + '\n',
    'README.md': `# ${brand}\n\nLocal customer support ticket manager. Customers, tickets, statuses, notes, search, SQLite persistence.\nLoopback only. No deploy.\n`,
    'db.mjs': dbModule(),
    'server.mjs': serverModule(brand, port),
    'test.mjs': testModule(),
    'public/index.html': indexHtml(brand),
    'public/styles.css': stylesCss(),
    'public/app.js': appJs(),
    'public/logo.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#064e3b"/><text x="32" y="40" text-anchor="middle" fill="#6ee7b7" font-size="20">TM</text></svg>\n`,
    'data/.gitkeep': '',
  }
}

export function filesForRole(role: 'ARCHITECT' | 'BACKEND' | 'FRONTEND' | 'TEST' | 'DATABASE'): string[] {
  if (role === 'ARCHITECT') return [...TICKET_ARCHITECT_FILES]
  if (role === 'DATABASE') return ['db.mjs', '.foundry/contracts/schema.json']
  if (role === 'BACKEND') return [...TICKET_BACKEND_FILES]
  if (role === 'FRONTEND') return [...TICKET_FRONTEND_FILES]
  return [...TICKET_TEST_FILES]
}

function packageJson(): string {
  return JSON.stringify({
    name: 'foundry-ticket-manager',
    private: true,
    type: 'module',
    scripts: { start: 'node server.mjs', test: 'node --test test.mjs' },
  }, null, 2) + '\n'
}

function instructions(brand: string): string {
  return [
    `# ${brand} instructions`,
    '',
    'Build against .foundry/contracts/api.json.',
    'Persistent user data lives in data/app.sqlite.',
    'Tests must set APP_DB_PATH to an isolated runtime database.',
    'Do not commit, push, or live-deploy.',
    'Do not modify Harbor Desk, Lane & Box, Inventory Manager, Terra, or WRIM.',
    '',
  ].join('\n')
}

function dbModule(): string {
  return `import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
export const STATUSES = ['open', 'pending', 'resolved', 'closed']

export function defaultDbPath() {
  return process.env.APP_DB_PATH || path.join(ROOT, 'data', 'app.sqlite')
}

export function openDb(file) {
  const target = file || defaultDbPath()
  mkdirSync(path.dirname(target), { recursive: true })
  const db = new DatabaseSync(target)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec(\`CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)\`)
  db.exec(\`CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)\`)
  db.exec(\`CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL)\`)
  return db
}

const trim = (v, n) => String(v ?? '').trim().slice(0, n)

export function createCustomer(db, input) {
  const name = trim(input.name, 120)
  if (!name) return { ok: false, errors: ['name is required'] }
  const now = new Date().toISOString()
  const row = { id: randomUUID(), name, email: trim(input.email, 120), phone: trim(input.phone, 40), created_at: now, updated_at: now }
  db.prepare('INSERT INTO customers (id,name,email,phone,created_at,updated_at) VALUES (@id,@name,@email,@phone,@created_at,@updated_at)').run(row)
  return { ok: true, customer: row }
}

export function listCustomers(db, q) {
  const query = String(q || '').toLowerCase()
  let rows = db.prepare('SELECT * FROM customers ORDER BY name COLLATE NOCASE').all()
  if (query) rows = rows.filter(r => (r.name + ' ' + r.email + ' ' + r.phone).toLowerCase().includes(query))
  return rows
}

export function createTicket(db, input) {
  const title = trim(input.title, 160)
  const customerId = trim(input.customerId, 80)
  if (!title || !customerId) return { ok: false, errors: ['customerId and title are required'] }
  const status = STATUSES.includes(input.status) ? input.status : 'open'
  const now = new Date().toISOString()
  const row = { id: randomUUID(), customer_id: customerId, title, status, body: trim(input.body, 4000), created_at: now, updated_at: now }
  db.prepare('INSERT INTO tickets (id,customer_id,title,status,body,created_at,updated_at) VALUES (@id,@customer_id,@title,@status,@body,@created_at,@updated_at)').run(row)
  return { ok: true, ticket: row }
}

export function listTickets(db, query) {
  const q = String(query?.q || '').toLowerCase()
  const status = String(query?.status || '')
  const customerId = String(query?.customerId || '')
  let rows = db.prepare('SELECT * FROM tickets ORDER BY updated_at DESC').all()
  if (q) rows = rows.filter(r => (r.title + ' ' + r.body + ' ' + r.status).toLowerCase().includes(q))
  if (status) rows = rows.filter(r => r.status === status)
  if (customerId) rows = rows.filter(r => r.customer_id === customerId)
  return rows
}

export function getTicket(db, id) {
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id)
  if (!ticket) return null
  const notes = db.prepare('SELECT * FROM notes WHERE ticket_id = ? ORDER BY created_at').all(id)
  return { ticket, notes }
}

export function updateTicket(db, id, input) {
  const existing = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id)
  if (!existing) return { ok: false, errors: ['not found'] }
  const status = input.status && STATUSES.includes(input.status) ? input.status : existing.status
  const row = {
    ...existing,
    title: input.title !== undefined ? trim(input.title, 160) : existing.title,
    status,
    body: input.body !== undefined ? trim(input.body, 4000) : existing.body,
    updated_at: new Date().toISOString(),
  }
  db.prepare('UPDATE tickets SET title=@title,status=@status,body=@body,updated_at=@updated_at WHERE id=@id').run({
    id: row.id,
    title: row.title,
    status: row.status,
    body: row.body,
    updated_at: row.updated_at,
  })
  return { ok: true, ticket: db.prepare('SELECT * FROM tickets WHERE id = ?').get(id) }
}

export function addNote(db, ticketId, body) {
  const text = trim(body, 4000)
  if (!text) return { ok: false, errors: ['body is required'] }
  const ticket = db.prepare('SELECT id FROM tickets WHERE id = ?').get(ticketId)
  if (!ticket) return { ok: false, errors: ['not found'] }
  const row = { id: randomUUID(), ticket_id: ticketId, body: text, created_at: new Date().toISOString() }
  db.prepare('INSERT INTO notes (id,ticket_id,body,created_at) VALUES (@id,@ticket_id,@body,@created_at)').run(row)
  return { ok: true, note: row }
}
`
}

function serverModule(brand: string, port: number): string {
  return `import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { addNote, createCustomer, createTicket, getTicket, listCustomers, listTickets, openDb, updateTicket } from './db.mjs'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC = path.join(ROOT, 'public')
const PORT = Number(process.env.PORT || ${port})
const db = openDb()
const BRAND = ${JSON.stringify(brand)}
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' }

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' ? body : JSON.stringify(body)
  res.writeHead(status, { 'content-type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', ...headers })
  res.end(data)
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
      if (!chunks.length) return resolve({})
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch (err) { reject(err) }
    })
  })
}

function serveStatic(url, res) {
  const rel = url === '/' ? '/index.html' : url
  const file = path.join(PUBLIC, rel)
  if (!file.startsWith(PUBLIC) || !existsSync(file)) return false
  const ext = path.extname(file)
  res.writeHead(200, { 'content-type': TYPES[ext] || 'application/octet-stream' })
  res.end(readFileSync(file))
  return true
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  try {
    if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, brand: BRAND })
    if (req.method === 'GET' && url.pathname === '/api/customers') return send(res, 200, { customers: listCustomers(db, url.searchParams.get('q')) })
    if (req.method === 'POST' && url.pathname === '/api/customers') {
      const result = createCustomer(db, await readJson(req))
      return send(res, result.ok ? 201 : 400, result)
    }
    if (req.method === 'GET' && url.pathname === '/api/tickets') {
      return send(res, 200, { tickets: listTickets(db, { q: url.searchParams.get('q'), status: url.searchParams.get('status'), customerId: url.searchParams.get('customerId') }) })
    }
    if (req.method === 'POST' && url.pathname === '/api/tickets') {
      const result = createTicket(db, await readJson(req))
      return send(res, result.ok ? 201 : 400, result)
    }
    const ticketMatch = url.pathname.match(/^\\/api\\/tickets\\/([^/]+)$/)
    if (req.method === 'GET' && ticketMatch) {
      const found = getTicket(db, ticketMatch[1])
      return found ? send(res, 200, found) : send(res, 404, { error: 'not found' })
    }
    if (req.method === 'PATCH' && ticketMatch) {
      const result = updateTicket(db, ticketMatch[1], await readJson(req))
      return send(res, result.ok ? 200 : 400, result)
    }
    const noteMatch = url.pathname.match(/^\\/api\\/tickets\\/([^/]+)\\/notes$/)
    if (req.method === 'POST' && noteMatch) {
      const body = await readJson(req)
      const result = addNote(db, noteMatch[1], body.body)
      return send(res, result.ok ? 201 : 400, result)
    }
    if (req.method === 'GET' && serveStatic(url.pathname, res)) return
    send(res, 404, { error: 'not found' })
  } catch (error) {
    send(res, 500, { error: String(error) })
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log('ticket-manager listening on http://127.0.0.1:' + PORT)
})
`
}

function testModule(): string {
  return `import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { addNote, createCustomer, createTicket, listCustomers, listTickets, openDb, updateTicket } from './db.mjs'

const db = openDb(path.join(mkdtempSync(path.join(os.tmpdir(), 'tm-')), 'test.sqlite'))

test('customers persist and search', () => {
  const created = createCustomer(db, { name: 'Ada Lovelace', email: 'ada@example.com' })
  assert.equal(created.ok, true)
  assert.equal(listCustomers(db, 'ada').length, 1)
})

test('tickets statuses notes and search', () => {
  const customer = createCustomer(db, { name: 'Grace Hopper' }).customer
  const ticket = createTicket(db, { customerId: customer.id, title: 'Printer jam', body: 'Cannot print' })
  assert.equal(ticket.ok, true)
  const note = addNote(db, ticket.ticket.id, 'Rebooted spooler')
  assert.equal(note.ok, true)
  const updated = updateTicket(db, ticket.ticket.id, { status: 'pending' })
  assert.equal(updated.ticket.status, 'pending')
  assert.equal(listTickets(db, { q: 'printer' }).length, 1)
})
`
}

function indexHtml(brand: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${brand}</title>
  <link rel="stylesheet" href="/styles.css"/>
</head>
<body>
  <header>
    <img src="/logo.svg" alt="" width="36" height="36"/>
    <h1 data-testid="brand">${brand}</h1>
  </header>
  <main>
    <section>
      <h2>Customers</h2>
      <form id="customer-form" data-testid="customer-form">
        <input name="name" placeholder="Name" required data-testid="customer-name"/>
        <input name="email" placeholder="Email" data-testid="customer-email"/>
        <input name="phone" placeholder="Phone" data-testid="customer-phone"/>
        <button type="submit">Add customer</button>
      </form>
    </section>
    <section>
      <h2>Tickets</h2>
      <input id="search" placeholder="Search tickets" data-testid="ticket-search"/>
      <form id="ticket-form" data-testid="ticket-form">
        <select name="customerId" data-testid="ticket-customer"></select>
        <input name="title" placeholder="Title" required data-testid="ticket-title"/>
        <select name="status" data-testid="ticket-status">
          <option value="open">open</option>
          <option value="pending">pending</option>
          <option value="resolved">resolved</option>
          <option value="closed">closed</option>
        </select>
        <textarea name="body" placeholder="Notes" data-testid="ticket-body"></textarea>
        <button type="submit">Create ticket</button>
      </form>
      <ul id="tickets" data-testid="ticket-list"></ul>
    </section>
  </main>
  <script src="/app.js"></script>
</body>
</html>
`
}

function stylesCss(): string {
  return `body{font-family:system-ui,sans-serif;margin:0;background:#042f2e;color:#ecfdf5}
header{display:flex;gap:12px;align-items:center;padding:16px 24px;background:#064e3b}
main{display:grid;gap:24px;padding:24px;grid-template-columns:1fr 1fr}
form,input,select,textarea,button{display:block;width:100%;margin:8px 0;padding:8px;border-radius:8px;border:1px solid #134e4a;background:#022c22;color:#ecfdf5}
button{background:#10b981;color:#022c22;font-weight:700;cursor:pointer}
#tickets{list-style:none;padding:0}
#tickets li{padding:10px;margin:8px 0;background:#022c22;border:1px solid #115e59;border-radius:8px}
`
}

function appJs(): string {
  return `const ticketsEl = document.getElementById('tickets')
const customerSelect = document.querySelector('[name="customerId"]')
const search = document.getElementById('search')

async function json(url, opts) {
  const res = await fetch(url, opts)
  return res.json()
}

async function refresh() {
  const customers = await json('/api/customers')
  customerSelect.innerHTML = (customers.customers || []).map(c => '<option value="'+c.id+'">'+c.name+'</option>').join('')
  const q = search.value || ''
  const tickets = await json('/api/tickets?q=' + encodeURIComponent(q))
  ticketsEl.innerHTML = (tickets.tickets || []).map(t => '<li data-testid="ticket-row"><strong>'+t.title+'</strong> · '+t.status+'</li>').join('')
}

document.getElementById('customer-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  const data = Object.fromEntries(new FormData(event.target))
  await json('/api/customers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) })
  event.target.reset()
  await refresh()
})

document.getElementById('ticket-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  const data = Object.fromEntries(new FormData(event.target))
  await json('/api/tickets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) })
  event.target.reset()
  await refresh()
})

search.addEventListener('input', () => { void refresh() })
void refresh()
`
}
