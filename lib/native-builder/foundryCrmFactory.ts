/**
 * Application Builder factory for a local small-business lead/customer CRM.
 * Original UI copy. No proprietary CRM text. Database stays in the project data directory.
 */
import type { FoundryAssetRequest, FoundryProductRequirements } from './foundryApplicationBuilderTypes'

export const CRM_BRAND = 'Harbor Desk'
export const CRM_TAGLINE = 'Leads and customers for a small local business'
export const CRM_WRITE_SET_PATHS = [
  'server.mjs',
  'db.mjs',
  'test.mjs',
  'package.json',
  '.env.example',
  'README.md',
  'foundry-memory.json',
  'data/.gitkeep',
  'public/index.html',
  'public/styles.css',
  'public/app.js',
  'public/logo.svg',
]

export type CrmFactoryInput = {
  requirements: FoundryProductRequirements
  previewOrigin: string
  includeFollowUp: boolean
}

export function buildCrmFiles(input: CrmFactoryInput): {
  files: Record<string, string>
  assetRequests: FoundryAssetRequest[]
  databaseSchema: string[]
  apiContracts: string[]
} {
  const followUp = input.includeFollowUp
  const files: Record<string, string> = {
    'package.json': packageJson(),
    '.env.example': 'PORT=18810\n# CRM_DB_PATH=data/crm.sqlite\n',
    'README.md': readme(followUp),
    'data/.gitkeep': '',
    'db.mjs': dbModule(followUp),
    'server.mjs': serverModule(),
    'test.mjs': testModule(followUp),
    'public/index.html': indexHtml(followUp),
    'public/styles.css': stylesCss(),
    'public/app.js': appJs(followUp),
    'public/logo.svg': logoSvg(),
  }
  return {
    files,
    assetRequests: [
      {
        id: 'logo-operator',
        kind: 'logo',
        purpose: 'Replace the working Harbor Desk mark with the operator mark when supplied.',
        whyUnavailable: 'Commander did not supply a logo. An original SVG working mark is used instead of scraped brand assets.',
      },
    ],
    databaseSchema: [
      'leads(id, first_name, last_name, company, email, phone, service_interest, status, converted_at, created_at, updated_at' + (followUp ? ', follow_up_date' : '') + ')',
      'lead_notes(id, lead_id, body, created_at) — append-only history',
    ],
    apiContracts: [
      'GET /health',
      'GET /api/dashboard',
      'GET /api/leads?q=&status=',
      'GET /api/leads/:id',
      'POST /api/leads',
      'PATCH /api/leads/:id',
      'POST /api/leads/:id/notes',
      'POST /api/leads/:id/status',
      'POST /api/leads/:id/convert',
      'GET /api/customers',
    ],
  }
}

export function stripConvertRoute(serverSource: string): string {
  return serverSource.replace(
    /\/\* CONVERT_TO_CUSTOMER \*\/[\s\S]*?\/\* END_CONVERT_TO_CUSTOMER \*\//,
    '/* CONVERT_ROUTE_MISSING */',
  )
}

function packageJson(): string {
  return JSON.stringify({
    name: 'small-business-crm',
    private: true,
    type: 'module',
    scripts: { start: 'node server.mjs', test: 'node --test test.mjs' },
  }, null, 2) + '\n'
}

function readme(followUp: boolean): string {
  return [
    '# Harbor Desk',
    '',
    'Local small-business lead and customer CRM. Data lives in `data/crm.sqlite`.',
    '',
    '```',
    'node server.mjs',
    'node --test test.mjs',
    '```',
    '',
    'Pipeline: New → Contacted → Qualified → Customer (explicit convert) or Lost.',
    'Notes are stored as a history, not a single overwritten field.',
    followUp ? 'Follow-up dates are stored on the lead record after schema migration.' : '',
    '',
    'Loopback only. No deploy. No production database.',
    '',
  ].filter(Boolean).join('\n')
}

function dbModule(followUp: boolean): string {
  const followMigrate = followUp
    ? `  const names = db.prepare('PRAGMA table_info(leads)').all().map(function (row) { return row.name })
  if (names.indexOf('follow_up_date') === -1) {
    db.exec('ALTER TABLE leads ADD COLUMN follow_up_date TEXT')
  }`
    : ''
  return `import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
export const STATUSES = ['new', 'contacted', 'qualified', 'customer', 'lost']
export const LIMITS = { name: 80, company: 120, email: 120, phone: 40, service: 120, note: 4000 }
const EMAIL_RE = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/
const PHONE_RE = /^[0-9+()\\-\\.\\s]{0,40}$/

export function defaultDbPath() {
  return process.env.CRM_DB_PATH || path.join(ROOT, 'data', 'crm.sqlite')
}

export function openDb(file) {
  const target = file || defaultDbPath()
  mkdirSync(path.dirname(target), { recursive: true })
  const db = new DatabaseSync(target)
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA journal_mode = WAL')
  migrate(db)
  return db
}

function migrate(db) {
  db.exec(\`CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    company TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    service_interest TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('new','contacted','qualified','customer','lost')),
    converted_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )\`)
  db.exec(\`CREATE TABLE IF NOT EXISTS lead_notes (
    id TEXT PRIMARY KEY,
    lead_id TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
  )\`)
${followMigrate}
}

function clip(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max)
}

export function validateLeadInput(input, options) {
  const partial = Boolean(options && options.partial)
  const errors = []
  const value = {
    first_name: clip(input.first_name ?? input.firstName, LIMITS.name),
    last_name: clip(input.last_name ?? input.lastName, LIMITS.name),
    company: clip(input.company, LIMITS.company),
    email: clip(input.email, LIMITS.email).toLowerCase(),
    phone: clip(input.phone, LIMITS.phone),
    service_interest: clip(input.service_interest ?? input.serviceInterest, LIMITS.service),
    status: clip(input.status || 'new', 32).toLowerCase(),
    follow_up_date: clip(input.follow_up_date ?? input.followUpDate, 32) || null,
  }
  if (!partial || input.first_name != null || input.firstName != null) {
    if (!value.first_name) errors.push('First name is required.')
  }
  if (!partial || input.last_name != null || input.lastName != null) {
    if (!value.last_name) errors.push('Last name is required.')
  }
  if (!partial || input.company != null) {
    if (!value.company) errors.push('Company is required.')
  }
  if (!partial || input.email != null) {
    if (!value.email) errors.push('Email is required.')
    else if (!EMAIL_RE.test(value.email)) errors.push('Email is not valid.')
  }
  if (value.phone && !PHONE_RE.test(value.phone)) errors.push('Phone contains unsupported characters.')
  if (!partial || input.service_interest != null || input.serviceInterest != null) {
    if (!value.service_interest) errors.push('Service interest is required.')
  }
  if (value.status && STATUSES.indexOf(value.status) === -1) errors.push('Status is not recognized.')
  if (value.follow_up_date && !/^\\d{4}-\\d{2}-\\d{2}$/.test(value.follow_up_date)) {
    errors.push('Follow-up date must be YYYY-MM-DD.')
  }
  return { ok: errors.length === 0, errors: errors, value: value }
}

function mapLead(row, notes) {
  if (!row) return null
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    company: row.company,
    email: row.email,
    phone: row.phone,
    serviceInterest: row.service_interest,
    status: row.status,
    convertedAt: row.converted_at,
    followUpDate: row.follow_up_date == null ? null : row.follow_up_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    notes: notes || [],
  }
}

export function createLead(db, input) {
  const checked = validateLeadInput(input, { partial: false })
  if (!checked.ok) return { ok: false, status: 400, errors: checked.errors }
  if (checked.value.status === 'customer') {
    return { ok: false, status: 400, errors: ['Create the lead first, then convert it to a customer.'] }
  }
  const now = new Date().toISOString()
  const id = randomUUID()
  const hasFollow = columnExists(db, 'follow_up_date')
  if (hasFollow) {
    db.prepare('INSERT INTO leads (id, first_name, last_name, company, email, phone, service_interest, status, converted_at, follow_up_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)')
      .run(id, checked.value.first_name, checked.value.last_name, checked.value.company, checked.value.email, checked.value.phone, checked.value.service_interest, checked.value.status === 'customer' ? 'new' : checked.value.status, checked.value.follow_up_date, now, now)
  } else {
    db.prepare('INSERT INTO leads (id, first_name, last_name, company, email, phone, service_interest, status, converted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)')
      .run(id, checked.value.first_name, checked.value.last_name, checked.value.company, checked.value.email, checked.value.phone, checked.value.service_interest, checked.value.status === 'customer' ? 'new' : checked.value.status, now, now)
  }
  const note = clip(input.notes ?? input.note, LIMITS.note)
  if (note) addNote(db, id, note)
  return { ok: true, status: 201, lead: getLead(db, id) }
}

function columnExists(db, name) {
  return db.prepare('PRAGMA table_info(leads)').all().some(function (row) { return row.name === name })
}

export function getLead(db, id) {
  const row = db.prepare('SELECT * FROM leads WHERE id = ?').get(id)
  if (!row) return null
  const notes = db.prepare('SELECT id, body, created_at AS createdAt FROM lead_notes WHERE lead_id = ? ORDER BY created_at ASC').all(id)
  return mapLead(row, notes)
}

export function listLeads(db, query) {
  const q = clip((query && query.q) || '', 80).toLowerCase()
  const status = clip((query && query.status) || '', 32).toLowerCase()
  const needsFollow = Boolean(query && (query.needsFollowUp === '1' || query.needsFollowUp === true))
  let sql = 'SELECT * FROM leads WHERE 1=1'
  const params = []
  if (status && STATUSES.indexOf(status) !== -1) {
    sql += ' AND status = ?'
    params.push(status)
  }
  if (q) {
    sql += ' AND (instr(lower(first_name), ?) > 0 OR instr(lower(last_name), ?) > 0 OR instr(lower(company), ?) > 0 OR instr(lower(email), ?) > 0 OR instr(lower(phone), ?) > 0 OR instr(lower(service_interest), ?) > 0)'
    params.push(q, q, q, q, q, q)
  }
  if (needsFollow && columnExists(db, 'follow_up_date')) {
    sql += " AND follow_up_date IS NOT NULL AND follow_up_date <= date('now')"
  }
  sql += ' ORDER BY updated_at DESC'
  const rows = db.prepare(sql).all(...params)
  return rows.map(function (row) { return mapLead(row, []) })
}

export function updateLead(db, id, input) {
  const existing = db.prepare('SELECT * FROM leads WHERE id = ?').get(id)
  if (!existing) return { ok: false, status: 404, errors: ['Lead not found.'] }
  const checked = validateLeadInput({ ...existing, ...input, firstName: input.firstName ?? input.first_name, lastName: input.lastName ?? input.last_name, serviceInterest: input.serviceInterest ?? input.service_interest }, { partial: true })
  if (!checked.ok) return { ok: false, status: 400, errors: checked.errors }
  const next = {
    first_name: input.firstName != null || input.first_name != null ? checked.value.first_name : existing.first_name,
    last_name: input.lastName != null || input.last_name != null ? checked.value.last_name : existing.last_name,
    company: input.company != null ? checked.value.company : existing.company,
    email: input.email != null ? checked.value.email : existing.email,
    phone: input.phone != null ? checked.value.phone : existing.phone,
    service_interest: input.serviceInterest != null || input.service_interest != null ? checked.value.service_interest : existing.service_interest,
  }
  const now = new Date().toISOString()
  if (columnExists(db, 'follow_up_date') && (input.followUpDate != null || input.follow_up_date != null)) {
    db.prepare('UPDATE leads SET first_name = ?, last_name = ?, company = ?, email = ?, phone = ?, service_interest = ?, follow_up_date = ?, updated_at = ? WHERE id = ?')
      .run(next.first_name, next.last_name, next.company, next.email, next.phone, next.service_interest, checked.value.follow_up_date, now, id)
  } else {
    db.prepare('UPDATE leads SET first_name = ?, last_name = ?, company = ?, email = ?, phone = ?, service_interest = ?, updated_at = ? WHERE id = ?')
      .run(next.first_name, next.last_name, next.company, next.email, next.phone, next.service_interest, now, id)
  }
  return { ok: true, status: 200, lead: getLead(db, id) }
}

export function changeStatus(db, id, status) {
  const existing = db.prepare('SELECT * FROM leads WHERE id = ?').get(id)
  if (!existing) return { ok: false, status: 404, errors: ['Lead not found.'] }
  const next = clip(status, 32).toLowerCase()
  if (STATUSES.indexOf(next) === -1) return { ok: false, status: 400, errors: ['Status is not recognized.'] }
  if (next === 'customer') return { ok: false, status: 400, errors: ['Use Convert to customer from a qualified lead.'] }
  db.prepare('UPDATE leads SET status = ?, updated_at = ? WHERE id = ?').run(next, new Date().toISOString(), id)
  return { ok: true, status: 200, lead: getLead(db, id) }
}

export function convertLead(db, id) {
  const existing = db.prepare('SELECT * FROM leads WHERE id = ?').get(id)
  if (!existing) return { ok: false, status: 404, errors: ['Lead not found.'] }
  if (existing.status === 'customer') return { ok: true, status: 200, lead: getLead(db, id) }
  if (existing.status !== 'qualified') {
    return { ok: false, status: 409, errors: ['Only qualified leads can be converted to customers.'] }
  }
  const now = new Date().toISOString()
  db.prepare('UPDATE leads SET status = ?, converted_at = ?, updated_at = ? WHERE id = ?').run('customer', now, now, id)
  return { ok: true, status: 200, lead: getLead(db, id) }
}

export function addNote(db, id, body) {
  const existing = db.prepare('SELECT id FROM leads WHERE id = ?').get(id)
  if (!existing) return { ok: false, status: 404, errors: ['Lead not found.'] }
  const text = clip(body, LIMITS.note)
  if (!text) return { ok: false, status: 400, errors: ['Note text is required.'] }
  db.prepare('INSERT INTO lead_notes (id, lead_id, body, created_at) VALUES (?, ?, ?, ?)').run(randomUUID(), id, text, new Date().toISOString())
  db.prepare('UPDATE leads SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), id)
  return { ok: true, status: 201, lead: getLead(db, id) }
}

export function dashboardCounts(db) {
  const rows = db.prepare('SELECT status, COUNT(*) AS n FROM leads GROUP BY status').all()
  const by = { new: 0, contacted: 0, qualified: 0, customer: 0, lost: 0 }
  let total = 0
  for (const row of rows) {
    by[row.status] = Number(row.n)
    total += Number(row.n)
  }
  const result = {
    totalLeads: total,
    pipeline: by.new + by.contacted + by.qualified,
    new: by.new,
    contacted: by.contacted,
    qualified: by.qualified,
    customers: by.customer,
    lost: by.lost,
  }
  if (columnExists(db, 'follow_up_date')) {
    result.dueFollowUps = Number(db.prepare("SELECT COUNT(*) AS n FROM leads WHERE follow_up_date IS NOT NULL AND follow_up_date <= date('now') AND status != 'lost'").get().n)
  }
  return result
}

export function listCustomers(db) {
  return listLeads(db, { status: 'customer' })
}
`
}

function serverModule(): string {
  return `import { createReadStream, existsSync, statSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  addNote,
  changeStatus,
  convertLead,
  createLead,
  dashboardCounts,
  defaultDbPath,
  getLead,
  listCustomers,
  listLeads,
  openDb,
  updateLead,
} from './db.mjs'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC = path.join(ROOT, 'public')
const MAX_BODY = 32 * 1024
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
}

function json(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  })
  res.end(payload)
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    const chunks = []
    let size = 0
    req.on('data', function (chunk) {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('payload too large'), { status: 413 }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')) })
    req.on('error', reject)
  })
}

async function parseJson(req) {
  const raw = await readBody(req)
  if (!raw.trim()) return {}
  try { return JSON.parse(raw) } catch {
    const error = new Error('invalid json')
    error.status = 400
    throw error
  }
}

function serveStatic(req, res) {
  let rel = decodeURIComponent((req.url || '/').split('?')[0])
  if (rel === '/') rel = '/index.html'
  const abs = path.normalize(path.join(PUBLIC, rel))
  if (!abs.startsWith(PUBLIC)) {
    res.writeHead(403)
    res.end('forbidden')
    return
  }
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    if (!path.extname(rel)) {
      const index = path.join(PUBLIC, 'index.html')
      res.writeHead(200, { 'content-type': MIME['.html'] })
      createReadStream(index).pipe(res)
      return
    }
    res.writeHead(404)
    res.end('not found')
    return
  }
  const ext = path.extname(abs)
  res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' })
  createReadStream(abs).pipe(res)
}

export function createCrmServer(dbPath) {
  const db = openDb(dbPath || defaultDbPath())
  const server = http.createServer(async function (req, res) {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      const method = req.method || 'GET'
      if (url.pathname === '/health' || url.pathname === '/api/health') {
        json(res, 200, { ok: true, service: 'harbor-desk' })
        return
      }
      if (method === 'GET' && url.pathname === '/api/dashboard') {
        json(res, 200, dashboardCounts(db))
        return
      }
      if (method === 'GET' && url.pathname === '/api/customers') {
        json(res, 200, { leads: listCustomers(db) })
        return
      }
      if (method === 'GET' && url.pathname === '/api/leads') {
        json(res, 200, { leads: listLeads(db, { q: url.searchParams.get('q') || '', status: url.searchParams.get('status') || '', needsFollowUp: url.searchParams.get('needsFollowUp') || '' }) })
        return
      }
      const leadGet = url.pathname.match(/^\\/api\\/leads\\/([^/]+)$/)
      if (method === 'GET' && leadGet) {
        const lead = getLead(db, leadGet[1])
        if (!lead) return json(res, 404, { errors: ['Lead not found.'] })
        return json(res, 200, { lead: lead })
      }
      if (method === 'POST' && url.pathname === '/api/leads') {
        const body = await parseJson(req)
        const result = createLead(db, body)
        return json(res, result.status, result.ok ? { lead: result.lead } : { errors: result.errors })
      }
      if (method === 'PATCH' && leadGet) {
        const body = await parseJson(req)
        const result = updateLead(db, leadGet[1], body)
        return json(res, result.status, result.ok ? { lead: result.lead } : { errors: result.errors })
      }
      const noteMatch = url.pathname.match(/^\\/api\\/leads\\/([^/]+)\\/notes$/)
      if (method === 'POST' && noteMatch) {
        const body = await parseJson(req)
        const result = addNote(db, noteMatch[1], body.body || body.note || '')
        return json(res, result.status, result.ok ? { lead: result.lead } : { errors: result.errors })
      }
      const statusMatch = url.pathname.match(/^\\/api\\/leads\\/([^/]+)\\/status$/)
      if (method === 'POST' && statusMatch) {
        const body = await parseJson(req)
        const result = changeStatus(db, statusMatch[1], body.status)
        return json(res, result.status, result.ok ? { lead: result.lead } : { errors: result.errors })
      }
      /* CONVERT_TO_CUSTOMER */
      const convertMatch = url.pathname.match(/^\\/api\\/leads\\/([^/]+)\\/convert$/)
      if (method === 'POST' && convertMatch) {
        const result = convertLead(db, convertMatch[1])
        return json(res, result.status, result.ok ? { lead: result.lead } : { errors: result.errors })
      }
      /* END_CONVERT_TO_CUSTOMER */
      if (url.pathname.startsWith('/api/')) {
        return json(res, 404, { errors: ['Unknown API route.'] })
      }
      serveStatic(req, res)
    } catch (error) {
      const status = error && error.status ? error.status : 500
      json(res, status, { errors: [status === 413 ? 'Payload too large.' : status === 400 ? 'Invalid JSON.' : 'Request failed.'] })
    }
  })
  server.db = db
  return server
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 18810)
  const server = createCrmServer()
  server.listen(port, '127.0.0.1', function () {
    process.stdout.write('Harbor Desk listening on http://127.0.0.1:' + port + '\\n')
  })
}
`
}

function testModule(followUp: boolean): string {
  const followTests = followUp
    ? `
test('follow-up date migrates without dropping rows', () => {
  const file = tempDb()
  const db = openDb(file)
  const created = createLead(db, sample({ company: 'Keep Me LLC' }))
  db.close()
  const reopened = openDb(file)
  const names = reopened.prepare('PRAGMA table_info(leads)').all().map(row => row.name)
  assert.ok(names.includes('follow_up_date'))
  const lead = getLead(reopened, created.lead.id)
  assert.equal(lead.company, 'Keep Me LLC')
  const updated = updateLead(reopened, lead.id, { followUpDate: '2026-09-22' })
  assert.equal(updated.lead.followUpDate, '2026-09-22')
  reopened.close()
})
`
    : ''
  return `import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  addNote,
  changeStatus,
  convertLead,
  createLead,
  dashboardCounts,
  getLead,
  listLeads,
  openDb,
  updateLead,
} from './db.mjs'
import { createCrmServer } from './server.mjs'

const ROOT = path.dirname(fileURLToPath(import.meta.url))

function tempDb() {
  return path.join(tmpdir(), 'harbor-desk-' + process.pid + '-' + Math.random().toString(16).slice(2) + '.sqlite')
}

function sample(overrides) {
  return {
    firstName: 'Riley',
    lastName: 'Chen',
    company: 'Cedar Supply',
    email: 'riley@example.test',
    phone: '555-0144',
    serviceInterest: 'Inventory setup',
    ...overrides,
  }
}

test('create lead persists after reopen', () => {
  const file = tempDb()
  const db = openDb(file)
  const created = createLead(db, sample())
  assert.equal(created.ok, true)
  db.close()
  const reopened = openDb(file)
  const lead = getLead(reopened, created.lead.id)
  assert.equal(lead.email, 'riley@example.test')
  assert.equal(lead.company, 'Cedar Supply')
  reopened.close()
})

test('create lead requires fields and valid email', () => {
  const db = openDb(tempDb())
  const missing = createLead(db, { firstName: '', lastName: 'X', company: 'A', email: 'nope', phone: '', serviceInterest: '' })
  assert.equal(missing.ok, false)
  assert.ok(missing.errors.length >= 2)
  db.close()
})

test('update lead persists', () => {
  const db = openDb(tempDb())
  const created = createLead(db, sample())
  const updated = updateLead(db, created.lead.id, { company: 'Cedar Supply West' })
  assert.equal(updated.lead.company, 'Cedar Supply West')
  db.close()
})

test('search matches name company email phone', () => {
  const db = openDb(tempDb())
  createLead(db, sample({ firstName: 'Alex', lastName: 'Johnson', company: 'Northstar Logistics', email: 'alex@example.test', phone: '555-0101' }))
  createLead(db, sample({ firstName: 'Sam', email: 'sam@example.test' }))
  const found = listLeads(db, { q: 'Alex' })
  assert.equal(found.length, 1)
  assert.equal(found[0].company, 'Northstar Logistics')
  const byPhone = listLeads(db, { q: '555-0101' })
  assert.equal(byPhone.length, 1)
  db.close()
})

test('filter by status', () => {
  const db = openDb(tempDb())
  const a = createLead(db, sample({ email: 'a@example.test' }))
  const b = createLead(db, sample({ firstName: 'Pat', email: 'pat@example.test' }))
  changeStatus(db, b.lead.id, 'contacted')
  const onlyNew = listLeads(db, { status: 'new' })
  assert.equal(onlyNew.length, 1)
  assert.equal(onlyNew[0].id, a.lead.id)
  db.close()
})

test('status transition rejects customer shortcut', () => {
  const db = openDb(tempDb())
  const created = createLead(db, sample())
  const bad = changeStatus(db, created.lead.id, 'customer')
  assert.equal(bad.ok, false)
  const ok = changeStatus(db, created.lead.id, 'contacted')
  assert.equal(ok.lead.status, 'contacted')
  db.close()
})

test('notes append and persist', () => {
  const db = openDb(tempDb())
  const created = createLead(db, sample({ notes: 'Intro call scheduled.' }))
  addNote(db, created.lead.id, 'Sent service overview.')
  const lead = getLead(db, created.lead.id)
  assert.equal(lead.notes.length, 2)
  db.close()
})

test('qualified lead converts to customer', () => {
  const db = openDb(tempDb())
  const created = createLead(db, sample())
  const tooSoon = convertLead(db, created.lead.id)
  assert.equal(tooSoon.ok, false)
  changeStatus(db, created.lead.id, 'qualified')
  const converted = convertLead(db, created.lead.id)
  assert.equal(converted.lead.status, 'customer')
  assert.ok(converted.lead.convertedAt)
  db.close()
})

test('dashboard counts come from stored rows', () => {
  const db = openDb(tempDb())
  const a = createLead(db, sample({ email: 'one@example.test' }))
  const b = createLead(db, sample({ firstName: 'Kim', email: 'two@example.test' }))
  changeStatus(db, a.lead.id, 'qualified')
  convertLead(db, a.lead.id)
  changeStatus(db, b.lead.id, 'contacted')
  const counts = dashboardCounts(db)
  assert.equal(counts.totalLeads, 2)
  assert.equal(counts.customers, 1)
  assert.equal(counts.contacted, 1)
  assert.equal(counts.new, 0)
  db.close()
})

test('convert-to-customer route is implemented', () => {
  const src = readFileSync(path.join(ROOT, 'server.mjs'), 'utf8')
  assert.match(src, /CONVERT_TO_CUSTOMER/)
  assert.doesNotMatch(src, /CONVERT_ROUTE_MISSING/)
})

test('http create search and dashboard', async () => {
  const file = tempDb()
  const server = createCrmServer(file)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const origin = 'http://127.0.0.1:' + port
  const created = await fetch(origin + '/api/leads', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sample({ email: 'http@example.test' })),
  })
  assert.equal(created.status, 201)
  const listed = await fetch(origin + '/api/leads?q=http')
  const listedBody = await listed.json()
  assert.equal(listedBody.leads.length, 1)
  const dash = await fetch(origin + '/api/dashboard')
  const counts = await dash.json()
  assert.equal(counts.totalLeads, 1)
  assert.equal(counts.new, 1)
  server.close()
  server.db.close()
})
${followTests}
`
}

function indexHtml(followUp: boolean): string {
  const followField = followUp
    ? `<label>Follow-up date
        <input id="follow-up-date" name="followUpDate" type="date" data-testid="follow-up-date">
      </label>`
    : ''
  const followFilter = followUp
    ? `<label class="check"><input type="checkbox" id="needs-follow-up" data-testid="needs-follow-up"> Due follow-up</label>`
    : ''
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${CRM_BRAND} · Lead CRM</title>
  <meta name="description" content="Keep leads, notes, and customers in one local workspace.">
  <meta name="robots" content="noindex,nofollow">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <a class="skip" href="#main">Skip to content</a>
  <div class="app" data-testid="crm-shell">
    <header class="top">
      <a class="brand" href="#dashboard">
        <img src="/logo.svg" width="36" height="36" alt="">
        <span>
          <strong>${CRM_BRAND}</strong>
          <small>${CRM_TAGLINE}</small>
        </span>
      </a>
      <button class="menu" type="button" aria-expanded="false" aria-controls="app-nav" data-testid="nav-toggle">Menu</button>
      <nav id="app-nav" data-testid="app-nav">
        <a href="#dashboard" data-nav="dashboard">Dashboard</a>
        <a href="#leads" data-nav="leads" data-testid="nav-leads">Leads</a>
        <a href="#customers" data-nav="customers" data-testid="nav-customers">Customers</a>
        <a href="#new" data-nav="new" data-testid="nav-new">Add lead</a>
      </nav>
    </header>
    <main id="main">
      <section id="view-dashboard" data-testid="dashboard" hidden>
        <h1>Pipeline at a glance</h1>
        <p class="lede">Counts come from records stored on this computer.</p>
        <div class="stats" data-testid="dashboard-stats"></div>
      </section>
      <section id="view-leads" hidden>
        <div class="toolbar">
          <h1>Leads</h1>
          <a class="btn" href="#new">New lead</a>
        </div>
        <div class="filters">
          <label>Search
            <input id="lead-search" data-testid="lead-search" type="search" placeholder="Name, company, email, or phone">
          </label>
          <label>Status
            <select id="lead-filter" data-testid="lead-filter">
              <option value="">All statuses</option>
              <option value="new">New</option>
              <option value="contacted">Contacted</option>
              <option value="qualified">Qualified</option>
              <option value="customer">Customer</option>
              <option value="lost">Lost</option>
            </select>
          </label>
          ${followFilter}
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Company</th>
                <th>Service</th>
                <th>Status</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody data-testid="lead-list"></tbody>
          </table>
        </div>
      </section>
      <section id="view-customers" hidden>
        <h1>Customers</h1>
        <p class="lede">Leads converted with an explicit Convert to customer action.</p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Company</th><th>Service</th><th>Converted</th></tr></thead>
            <tbody data-testid="customer-list"></tbody>
          </table>
        </div>
      </section>
      <section id="view-new" hidden>
        <h1>Add a lead</h1>
        <form data-testid="lead-form" id="lead-form">
          <div class="grid">
            <label>First name <input name="firstName" required maxlength="80" autocomplete="given-name"></label>
            <label>Last name <input name="lastName" required maxlength="80" autocomplete="family-name"></label>
            <label>Company <input name="company" required maxlength="120" autocomplete="organization"></label>
            <label>Email <input name="email" type="email" required maxlength="120" autocomplete="email"></label>
            <label>Phone <input name="phone" maxlength="40" autocomplete="tel"></label>
            <label>Service interest <input name="serviceInterest" required maxlength="120"></label>
          </div>
          <label>Opening note
            <textarea name="notes" maxlength="4000" rows="3" placeholder="Optional context from the first conversation"></textarea>
          </label>
          <p class="form-error" data-testid="form-error" hidden></p>
          <button class="btn" type="submit">Save lead</button>
        </form>
      </section>
      <section id="view-detail" data-testid="lead-detail" hidden>
        <p><a href="#leads">Back to leads</a></p>
        <h1 data-testid="detail-name"></h1>
        <p class="status-pill" data-testid="detail-status"></p>
        <form id="edit-form" data-testid="edit-form">
          <div class="grid">
            <label>First name <input name="firstName" required maxlength="80"></label>
            <label>Last name <input name="lastName" required maxlength="80"></label>
            <label>Company <input name="company" required maxlength="120" data-testid="edit-company"></label>
            <label>Email <input name="email" type="email" required maxlength="120"></label>
            <label>Phone <input name="phone" maxlength="40"></label>
            <label>Service interest <input name="serviceInterest" required maxlength="120"></label>
            ${followField}
          </div>
          <button class="btn secondary" type="submit">Save changes</button>
        </form>
        <div class="actions">
          <label>Status
            <select id="status-select" data-testid="status-select">
              <option value="new">New</option>
              <option value="contacted">Contacted</option>
              <option value="qualified">Qualified</option>
              <option value="lost">Lost</option>
            </select>
          </label>
          <button class="btn" type="button" id="save-status" data-testid="save-status">Update status</button>
          <button class="btn accent" type="button" id="convert" data-testid="convert-customer">Convert to customer</button>
        </div>
        <h2>Notes</h2>
        <ol class="notes" data-testid="note-list"></ol>
        <form id="note-form" data-testid="note-form">
          <label>Add a note
            <textarea name="body" required maxlength="4000" rows="3" data-testid="note-body"></textarea>
          </label>
          <button class="btn secondary" type="submit">Save note</button>
        </form>
      </section>
    </main>
  </div>
  <script src="/app.js" defer></script>
</body>
</html>
`
}

function stylesCss(): string {
  return `:root {
  --ink: #142033;
  --muted: #5b6b82;
  --line: #d7deea;
  --paper: #f6f3ee;
  --card: #fffdf9;
  --accent: #1f6a5a;
  --accent-2: #c9782a;
  --danger: #9b2c2c;
}
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; background: var(--paper); color: var(--ink); font: 16px/1.5 "Source Sans 3", "Segoe UI", sans-serif; }
.skip { position: absolute; left: -999px; }
.skip:focus { left: 12px; top: 12px; background: #fff; padding: 8px; }
.app { max-width: 1100px; margin: 0 auto; padding: 0 20px 48px; }
.top { display: flex; align-items: center; gap: 16px; padding: 18px 0; border-bottom: 1px solid var(--line); }
.brand { display: flex; gap: 10px; align-items: center; color: inherit; text-decoration: none; }
.brand small { display: block; color: var(--muted); font-size: 12px; }
nav { margin-left: auto; display: flex; gap: 8px; flex-wrap: wrap; }
nav a { color: var(--ink); text-decoration: none; padding: 8px 12px; border-radius: 999px; }
nav a.is-active, nav a:hover { background: #e7eee9; }
.menu { display: none; }
h1 { font-size: 1.8rem; margin: 24px 0 8px; font-family: "Iowan Old Style", Georgia, serif; }
.lede { color: var(--muted); margin-top: 0; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-top: 20px; }
.stat { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 16px; }
.stat strong { display: block; font-size: 1.8rem; }
.toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.filters { display: flex; gap: 12px; flex-wrap: wrap; margin: 12px 0 16px; }
label { display: flex; flex-direction: column; gap: 6px; font-size: 14px; color: var(--muted); }
input, select, textarea { font: inherit; color: var(--ink); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; background: #fff; }
input:focus, select:focus, textarea:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.btn { display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: 999px; padding: 10px 16px; background: var(--accent); color: #fff; text-decoration: none; cursor: pointer; font: inherit; }
.btn.secondary { background: #2d3b52; }
.btn.accent { background: var(--accent-2); }
.table-wrap { overflow: auto; background: var(--card); border: 1px solid var(--line); border-radius: 16px; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 12px 14px; border-bottom: 1px solid var(--line); }
tbody tr { cursor: pointer; }
tbody tr:hover { background: #f3f7f4; }
.status-pill { display: inline-block; padding: 4px 10px; border-radius: 999px; background: #e7eee9; }
.actions { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; margin: 20px 0; }
.notes { padding-left: 18px; }
.form-error { color: var(--danger); }
.check { flex-direction: row; align-items: center; }
@media (max-width: 720px) {
  .grid { grid-template-columns: 1fr; }
  .menu { display: inline-flex; margin-left: auto; }
  nav { display: none; position: absolute; right: 20px; top: 70px; background: #fff; border: 1px solid var(--line); padding: 8px; border-radius: 12px; flex-direction: column; }
  nav.is-open { display: flex; }
  .top { position: relative; }
}
`
}

function appJs(followUp: boolean): string {
  const followRead = followUp
    ? `if (form.followUpDate) payload.followUpDate = form.followUpDate.value || null;`
    : ''
  const followWrite = followUp
    ? `if (form.followUpDate) form.followUpDate.value = lead.followUpDate || '';`
    : ''
  const followFilter = followUp
    ? `if (document.getElementById('needs-follow-up') && document.getElementById('needs-follow-up').checked) params.set('needsFollowUp', '1');`
    : ''
  return `const views = ['dashboard', 'leads', 'customers', 'new', 'detail']
let currentLeadId = null

function $(sel) { return document.querySelector(sel) }
function show(name) {
  views.forEach(function (id) {
    const el = document.getElementById('view-' + id)
    if (el) el.hidden = id !== name
  })
  document.querySelectorAll('[data-nav]').forEach(function (link) {
    link.classList.toggle('is-active', link.getAttribute('data-nav') === name)
  })
}

async function api(path, options) {
  const res = await fetch(path, Object.assign({ headers: { 'content-type': 'application/json' } }, options || {}))
  const body = await res.json().catch(function () { return {} })
  if (!res.ok) throw new Error((body.errors && body.errors[0]) || 'Request failed')
  return body
}

function formatStatus(status) {
  return ({ new: 'New', contacted: 'Contacted', qualified: 'Qualified', customer: 'Customer', lost: 'Lost' })[status] || status
}

async function renderDashboard() {
  show('dashboard')
  const counts = await api('/api/dashboard')
  const items = [
    ['Total records', counts.totalLeads],
    ['New', counts.new],
    ['Contacted', counts.contacted],
    ['Qualified', counts.qualified],
    ['Customers', counts.customers],
    ['Lost', counts.lost],
  ]
  if (counts.dueFollowUps != null) items.push(['Due follow-up', counts.dueFollowUps])
  $('[data-testid="dashboard-stats"]').innerHTML = items.map(function (pair) {
    return '<article class="stat"><span>' + pair[0] + '</span><strong>' + pair[1] + '</strong></article>'
  }).join('')
}

function rowHtml(lead, extra) {
  return '<tr data-id="' + lead.id + '"><td>' + lead.firstName + ' ' + lead.lastName + '</td><td>' + lead.company + '</td><td>' + (extra || lead.serviceInterest) + '</td><td>' + formatStatus(lead.status) + '</td><td>' + String(lead.updatedAt || lead.convertedAt || '').slice(0, 10) + '</td></tr>'
}

async function renderLeads() {
  show('leads')
  const params = new URLSearchParams()
  const q = $('[data-testid="lead-search"]').value.trim()
  const status = $('[data-testid="lead-filter"]').value
  if (q) params.set('q', q)
  if (status) params.set('status', status)
  ${followFilter}
  const data = await api('/api/leads?' + params.toString())
  const body = $('[data-testid="lead-list"]')
  body.innerHTML = data.leads.map(function (lead) { return rowHtml(lead) }).join('') || '<tr><td colspan="5">No matching leads.</td></tr>'
}

async function renderCustomers() {
  show('customers')
  const data = await api('/api/customers')
  const body = $('[data-testid="customer-list"]')
  body.innerHTML = data.leads.map(function (lead) {
    return '<tr data-id="' + lead.id + '"><td>' + lead.firstName + ' ' + lead.lastName + '</td><td>' + lead.company + '</td><td>' + lead.serviceInterest + '</td><td>' + String(lead.convertedAt || '').slice(0, 10) + '</td></tr>'
  }).join('') || '<tr><td colspan="4">No customers yet.</td></tr>'
}

async function renderDetail(id) {
  currentLeadId = id
  const data = await api('/api/leads/' + id)
  const lead = data.lead
  show('detail')
  $('[data-testid="detail-name"]').textContent = lead.firstName + ' ' + lead.lastName
  $('[data-testid="detail-status"]').textContent = formatStatus(lead.status)
  const form = document.getElementById('edit-form')
  form.firstName.value = lead.firstName
  form.lastName.value = lead.lastName
  form.company.value = lead.company
  form.email.value = lead.email
  form.phone.value = lead.phone
  form.serviceInterest.value = lead.serviceInterest
  ${followWrite}
  const statusSelect = document.getElementById('status-select')
  statusSelect.value = lead.status === 'customer' ? 'qualified' : lead.status
  statusSelect.disabled = lead.status === 'customer'
  document.getElementById('convert').disabled = lead.status !== 'qualified'
  $('[data-testid="note-list"]').innerHTML = (lead.notes || []).map(function (note) {
    return '<li>' + note.body + ' <small>' + String(note.createdAt).slice(0, 16).replace('T', ' ') + '</small></li>'
  }).join('') || '<li>No notes yet.</li>'
}

function route() {
  const hash = (location.hash || '#dashboard').slice(1)
  const parts = hash.split('/')
  if (parts[0] === 'lead' && parts[1]) return renderDetail(parts[1]).catch(console.error)
  if (parts[0] === 'leads') return renderLeads().catch(console.error)
  if (parts[0] === 'customers') return renderCustomers().catch(console.error)
  if (parts[0] === 'new') { show('new'); return }
  return renderDashboard().catch(console.error)
}

document.getElementById('lead-form').addEventListener('submit', async function (event) {
  event.preventDefault()
  const err = $('[data-testid="form-error"]')
  err.hidden = true
  const form = event.currentTarget
  try {
    const created = await api('/api/leads', {
      method: 'POST',
      body: JSON.stringify({
        firstName: form.firstName.value,
        lastName: form.lastName.value,
        company: form.company.value,
        email: form.email.value,
        phone: form.phone.value,
        serviceInterest: form.serviceInterest.value,
        notes: form.notes.value,
      }),
    })
    location.hash = '#lead/' + created.lead.id
  } catch (error) {
    err.hidden = false
    err.textContent = error.message
  }
})

document.getElementById('edit-form').addEventListener('submit', async function (event) {
  event.preventDefault()
  const form = event.currentTarget
  const payload = {
    firstName: form.firstName.value,
    lastName: form.lastName.value,
    company: form.company.value,
    email: form.email.value,
    phone: form.phone.value,
    serviceInterest: form.serviceInterest.value,
  }
  ${followRead}
  await api('/api/leads/' + currentLeadId, { method: 'PATCH', body: JSON.stringify(payload) })
  await renderDetail(currentLeadId)
})

document.getElementById('save-status').addEventListener('click', async function () {
  await api('/api/leads/' + currentLeadId + '/status', {
    method: 'POST',
    body: JSON.stringify({ status: document.getElementById('status-select').value }),
  })
  await renderDetail(currentLeadId)
})

document.getElementById('convert').addEventListener('click', async function () {
  await api('/api/leads/' + currentLeadId + '/convert', { method: 'POST', body: '{}' })
  await renderDetail(currentLeadId)
})

document.getElementById('note-form').addEventListener('submit', async function (event) {
  event.preventDefault()
  const field = event.currentTarget.querySelector('[name="body"]')
  const body = field ? field.value : ''
  await api('/api/leads/' + currentLeadId + '/notes', { method: 'POST', body: JSON.stringify({ body: body }) })
  event.currentTarget.reset()
  await renderDetail(currentLeadId)
})

$('[data-testid="lead-list"]').addEventListener('click', function (event) {
  const row = event.target.closest('tr[data-id]')
  if (row) location.hash = '#lead/' + row.getAttribute('data-id')
})
$('[data-testid="customer-list"]').addEventListener('click', function (event) {
  const row = event.target.closest('tr[data-id]')
  if (row) location.hash = '#lead/' + row.getAttribute('data-id')
})
$('[data-testid="lead-search"]').addEventListener('input', function () { renderLeads().catch(console.error) })
$('[data-testid="lead-filter"]').addEventListener('change', function () { renderLeads().catch(console.error) })
${followUp ? `const due = document.getElementById('needs-follow-up')
if (due) due.addEventListener('change', function () { renderLeads().catch(console.error) })` : ''}

const toggle = document.querySelector('[data-testid="nav-toggle"]')
const nav = document.querySelector('[data-testid="app-nav"]')
toggle.addEventListener('click', function () {
  const open = nav.classList.toggle('is-open')
  toggle.setAttribute('aria-expanded', open ? 'true' : 'false')
})

window.addEventListener('hashchange', route)
route()
`
}

function logoSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Harbor Desk">
  <rect width="64" height="64" rx="14" fill="#1f6a5a"/>
  <path d="M12 40h40v6H12z" fill="#f6f3ee"/>
  <path d="M20 22h24v14H20z" fill="#c9782a"/>
  <circle cx="32" cy="18" r="5" fill="#f6f3ee"/>
</svg>
`
}
