/**
 * Application Builder factory for Commander-local database-backed tools.
 * Outcome-derived brand and schema. Never clones Harbor Desk or Lane & Box.
 */
import type { FoundryAssetRequest, FoundryProductRequirements } from './foundryApplicationBuilderTypes'

export const LOCAL_DATA_WRITE_SET_PATHS = [
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

export type LocalDataFactoryInput = {
  requirements: FoundryProductRequirements
  previewOrigin: string
  productName: string
  includeLowStock: boolean
  port: number
}

export function displayBrandFromProductName(name: string): string {
  const cleaned = name.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!cleaned) return 'Local Inventory'
  return cleaned.replace(/\b\w/g, char => char.toUpperCase())
}

export function isInventoryStyleOutcome(text: string): boolean {
  return /inventory|stock|quantit|categor|\bitems\b/i.test(text)
}

export function stripItemsListRoute(serverSource: string): string {
  return serverSource.replace(
    /\/\* LIST_ITEMS \*\/[\s\S]*?\/\* END_LIST_ITEMS \*\//,
    '/* LIST_ROUTE_MISSING */',
  )
}

export function buildLocalDataAppFiles(input: LocalDataFactoryInput): {
  files: Record<string, string>
  assetRequests: FoundryAssetRequest[]
  databaseSchema: string[]
  apiContracts: string[]
} {
  const brand = displayBrandFromProductName(input.productName)
  const low = input.includeLowStock
  const port = input.port
  const files: Record<string, string> = {
    'package.json': packageJson(input.productName),
    '.env.example': `PORT=${port}\n# APP_DB_PATH=data/app.sqlite\n# LOW_STOCK_THRESHOLD=5\n`,
    'README.md': readme(brand, low),
    'data/.gitkeep': '',
    'db.mjs': dbModule(low),
    'server.mjs': serverModule(brand, port, low),
    'test.mjs': testModule(low),
    'public/index.html': indexHtml(brand, low),
    'public/styles.css': stylesCss(),
    'public/app.js': appJs(low),
    'public/logo.svg': logoSvg(),
  }
  return {
    files,
    assetRequests: [{
      kind: 'logo',
      purpose: 'Optional operator logo; a generated mark is used until Commander supplies one.',
      required: false,
    }],
    databaseSchema: [
      'items(id TEXT PK, name TEXT, quantity INTEGER, category TEXT, notes TEXT, created_at TEXT, updated_at TEXT)',
    ],
    apiContracts: [
      'GET /health',
      'GET /api/items?q=&category=&lowStock=',
      'POST /api/items',
      'PATCH /api/items/:id',
      'DELETE /api/items/:id',
    ],
  }
}

function packageJson(productName: string): string {
  const name = productName.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'local-data-app'
  return JSON.stringify({
    name,
    private: true,
    type: 'module',
    scripts: { start: 'node server.mjs', test: 'node --test test.mjs' },
  }, null, 2) + '\n'
}

function readme(brand: string, low: boolean): string {
  return [
    `# ${brand}`,
    '',
    'Local inventory manager. Records live in `data/app.sqlite` and survive process restart.',
    '',
    '```',
    'node server.mjs',
    'node --test test.mjs',
    '```',
    '',
    'Add, search, edit, and categorize items. Quantities are integers.',
    low ? 'Low-stock filter uses LOW_STOCK_THRESHOLD (default 5).' : '',
    '',
    'Loopback only. No deploy. No production database.',
    '',
  ].filter(item => item !== '').join('\n')
}

function dbModule(low: boolean): string {
  return `import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
export const LIMITS = { name: 120, category: 80, notes: 4000 }
export const DEFAULT_LOW_STOCK = Number(process.env.LOW_STOCK_THRESHOLD || 5)

export function defaultDbPath() {
  return process.env.APP_DB_PATH || path.join(ROOT, 'data', 'app.sqlite')
}

export function openDb(file) {
  const target = file || defaultDbPath()
  mkdirSync(path.dirname(target), { recursive: true })
  const db = new DatabaseSync(target)
  db.exec('PRAGMA journal_mode = WAL')
  migrate(db)
  return db
}

function migrate(db) {
  db.exec(\`CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0,
    category TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )\`)
}

function trim(value, max) {
  return String(value ?? '').trim().slice(0, max)
}

export function validateItem(input, partial) {
  const errors = []
  const name = input.name === undefined && partial ? undefined : trim(input.name, LIMITS.name)
  const category = input.category === undefined && partial ? undefined : trim(input.category, LIMITS.category)
  const notes = input.notes === undefined && partial ? undefined : trim(input.notes, LIMITS.notes)
  let quantity = input.quantity
  if (quantity !== undefined && quantity !== null && quantity !== '') {
    quantity = Number(quantity)
    if (!Number.isInteger(quantity) || quantity < 0) errors.push('quantity must be a non-negative integer')
  } else if (!partial) {
    quantity = 0
  }
  if (!partial && !name) errors.push('name is required')
  return { errors, name, category, notes, quantity }
}

export function listItems(db, query) {
  const q = String(query?.q || '').trim().toLowerCase()
  const category = String(query?.category || '').trim().toLowerCase()
  const lowStock = String(query?.lowStock || '') === '1' || query?.lowStock === true
  const threshold = Number(query?.threshold || DEFAULT_LOW_STOCK)
  let rows = db.prepare('SELECT * FROM items ORDER BY name COLLATE NOCASE').all()
  if (q) {
    rows = rows.filter(row => (row.name + ' ' + row.category + ' ' + row.notes).toLowerCase().includes(q))
  }
  if (category) {
    rows = rows.filter(row => String(row.category).toLowerCase() === category)
  }
  if (lowStock) {
    rows = rows.filter(row => Number(row.quantity) <= threshold)
  }
  return rows
}

export function getItem(db, id) {
  return db.prepare('SELECT * FROM items WHERE id = ?').get(id) || null
}

export function createItem(db, input) {
  const parsed = validateItem(input, false)
  if (parsed.errors.length) return { ok: false, errors: parsed.errors }
  const now = new Date().toISOString()
  const row = {
    id: randomUUID(),
    name: parsed.name,
    quantity: parsed.quantity,
    category: parsed.category || '',
    notes: parsed.notes || '',
    created_at: now,
    updated_at: now,
  }
  db.prepare('INSERT INTO items (id, name, quantity, category, notes, created_at, updated_at) VALUES (@id, @name, @quantity, @category, @notes, @created_at, @updated_at)').run(row)
  return { ok: true, item: row }
}

export function updateItem(db, id, input) {
  const existing = getItem(db, id)
  if (!existing) return { ok: false, errors: ['not found'] }
  const parsed = validateItem(input, true)
  if (parsed.errors.length) return { ok: false, errors: parsed.errors }
  const row = {
    ...existing,
    name: parsed.name === undefined ? existing.name : parsed.name,
    quantity: parsed.quantity === undefined ? existing.quantity : parsed.quantity,
    category: parsed.category === undefined ? existing.category : parsed.category,
    notes: parsed.notes === undefined ? existing.notes : parsed.notes,
    updated_at: new Date().toISOString(),
  }
  if (!row.name) return { ok: false, errors: ['name is required'] }
  db.prepare('UPDATE items SET name=@name, quantity=@quantity, category=@category, notes=@notes, updated_at=@updated_at WHERE id=@id').run({
    id: row.id,
    name: row.name,
    quantity: row.quantity,
    category: row.category,
    notes: row.notes,
    updated_at: row.updated_at,
  })
  return { ok: true, item: getItem(db, id) }
}

export function deleteItem(db, id) {
  const result = db.prepare('DELETE FROM items WHERE id = ?').run(id)
  return result.changes > 0
}

export const LOW_STOCK_ENABLED = ${low ? 'true' : 'false'}
`
}

function serverModule(brand: string, port: number, low: boolean): string {
  return `import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createItem, deleteItem, getItem, listItems, openDb, updateItem } from './db.mjs'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC = path.join(ROOT, 'public')
const PORT = Number(process.env.PORT || ${port})
const db = openDb()
const BRAND = ${JSON.stringify(brand)}
const LOW_STOCK = ${low ? 'true' : 'false'}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
}

function send(res, status, body, headers) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)
  res.writeHead(status, { 'cache-control': 'no-store', ...headers })
  res.end(payload)
}

function json(res, status, body) {
  send(res, status, body, { 'content-type': 'application/json; charset=utf-8' })
}

async function readJson(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw.trim()) return {}
  return JSON.parse(raw)
}

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1')
  let rel = decodeURIComponent(url.pathname)
  if (rel === '/') rel = '/index.html'
  const abs = path.normalize(path.join(PUBLIC, rel))
  if (!abs.startsWith(PUBLIC) || !existsSync(abs)) return false
  const ext = path.extname(abs)
  send(res, 200, readFileSync(abs), { 'content-type': TYPES[ext] || 'application/octet-stream' })
  return true
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (req.method === 'GET' && url.pathname === '/health') {
      return json(res, 200, { ok: true, brand: BRAND, db: 'sqlite', lowStock: LOW_STOCK })
    }
    /* LIST_ITEMS */
    if (req.method === 'GET' && url.pathname === '/api/items') {
      const items = listItems(db, {
        q: url.searchParams.get('q'),
        category: url.searchParams.get('category'),
        lowStock: url.searchParams.get('lowStock'),
      })
      return json(res, 200, { items })
    }
    /* END_LIST_ITEMS */
    if (req.method === 'POST' && url.pathname === '/api/items') {
      const created = createItem(db, await readJson(req))
      return json(res, created.ok ? 201 : 400, created)
    }
    const itemMatch = url.pathname.match(/^\\/api\\/items\\/([^/]+)$/)
    if (itemMatch && req.method === 'GET') {
      const item = getItem(db, itemMatch[1])
      return item ? json(res, 200, { item }) : json(res, 404, { errors: ['not found'] })
    }
    if (itemMatch && req.method === 'PATCH') {
      const updated = updateItem(db, itemMatch[1], await readJson(req))
      return json(res, updated.ok ? 200 : (updated.errors?.[0] === 'not found' ? 404 : 400), updated)
    }
    if (itemMatch && req.method === 'DELETE') {
      const ok = deleteItem(db, itemMatch[1])
      return json(res, ok ? 204 : 404, ok ? '' : { errors: ['not found'] })
    }
    if (req.method === 'GET' && serveStatic(req, res)) return
    json(res, 404, { errors: ['not found'] })
  } catch (error) {
    json(res, 500, { errors: [error instanceof Error ? error.message : String(error)] })
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log('listening http://127.0.0.1:' + PORT)
})
`
}

function testModule(low: boolean): string {
  return `import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createItem, listItems, openDb, updateItem, validateItem } from './db.mjs'

function tempDb() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'inv-'))
  const db = openDb(path.join(dir, 'app.sqlite'))
  return { db, dir }
}

test('rejects empty name', () => {
  const parsed = validateItem({ name: '  ', quantity: 1 }, false)
  assert.ok(parsed.errors.length)
})

test('create, search, edit, category persist in sqlite', () => {
  const { db, dir } = tempDb()
  try {
    const created = createItem(db, { name: 'Widget', quantity: 12, category: 'Hardware', notes: 'bin A' })
    assert.equal(created.ok, true)
    const listed = listItems(db, { q: 'wid' })
    assert.equal(listed.length, 1)
    const byCat = listItems(db, { category: 'Hardware' })
    assert.equal(byCat.length, 1)
    const updated = updateItem(db, created.item.id, { quantity: 4, notes: 'moved' })
    assert.equal(updated.ok, true)
    assert.equal(updated.item.quantity, 4)
    db.close()
    const reopened = openDb(path.join(dir, 'app.sqlite'))
    const again = listItems(reopened, {})
    assert.equal(again.length, 1)
    assert.equal(again[0].name, 'Widget')
    assert.equal(again[0].quantity, 4)
    reopened.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('quantity must be a non-negative integer', () => {
  const parsed = validateItem({ name: 'Bad', quantity: -2 }, false)
  assert.ok(parsed.errors.some(item => /quantity/.test(item)))
})
${low ? `
test('low-stock filter returns only at-or-below threshold', () => {
  const { db, dir } = tempDb()
  try {
    createItem(db, { name: 'Plenty', quantity: 40, category: 'A' })
    createItem(db, { name: 'Scarce', quantity: 2, category: 'A' })
    const lowRows = listItems(db, { lowStock: true, threshold: 5 })
    assert.equal(lowRows.length, 1)
    assert.equal(lowRows[0].name, 'Scarce')
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
` : ''}
`
}

function indexHtml(brand: string, low: boolean): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${brand}</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body data-testid="inventory-app">
  <header class="top">
    <img src="/logo.svg" alt="" width="36" height="36" />
    <div>
      <p class="eyebrow">Local inventory</p>
      <h1>${brand}</h1>
    </div>
  </header>
  <main>
    <section class="panel" aria-labelledby="add-heading">
      <h2 id="add-heading">Add item</h2>
      <form id="item-form" data-testid="item-form">
        <label>Name <input name="name" required maxlength="120" data-testid="item-name" /></label>
        <label>Quantity <input name="quantity" type="number" min="0" step="1" value="1" data-testid="item-quantity" /></label>
        <label>Category <input name="category" maxlength="80" data-testid="item-category" /></label>
        <label>Notes <textarea name="notes" maxlength="4000" data-testid="item-notes"></textarea></label>
        <button type="submit" data-testid="item-save">Save item</button>
      </form>
    </section>
    <section class="panel" aria-labelledby="list-heading">
      <h2 id="list-heading">Inventory</h2>
      <div class="filters">
        <label>Search <input id="search" data-testid="item-search" /></label>
        <label>Category <input id="category-filter" data-testid="item-category-filter" /></label>
        ${low ? '<label class="check"><input id="low-stock" type="checkbox" data-testid="low-stock-filter" /> Low stock</label>' : ''}
      </div>
      <p id="status" class="status" data-testid="item-status"></p>
      <table>
        <thead>
          <tr><th>Name</th><th>Qty</th><th>Category</th><th></th></tr>
        </thead>
        <tbody id="rows" data-testid="item-rows"></tbody>
      </table>
    </section>
  </main>
  <script src="/app.js"></script>
</body>
</html>
`
}

function stylesCss(): string {
  return `*{box-sizing:border-box}body{margin:0;font-family:ui-sans-serif,system-ui,sans-serif;background:#0f172a;color:#e2e8f0}
.top{display:flex;gap:12px;align-items:center;padding:20px 24px;background:#020617;border-bottom:1px solid #1e293b}
.eyebrow{margin:0;letter-spacing:.2em;text-transform:uppercase;font-size:11px;color:#34d399}
h1,h2{margin:4px 0}main{display:grid;gap:16px;padding:20px;grid-template-columns:minmax(240px,1fr) minmax(0,2fr)}
@media (max-width:800px){main{grid-template-columns:1fr}}
.panel{background:#111827;border:1px solid #1f2937;border-radius:12px;padding:16px}
form,.filters{display:grid;gap:10px}label{display:grid;gap:4px;font-size:13px}
input,textarea,button{font:inherit;border-radius:8px;border:1px solid #334155;background:#020617;color:#e2e8f0;padding:8px}
button{background:#059669;border:0;font-weight:700;cursor:pointer}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{padding:8px;border-bottom:1px solid #1f2937;text-align:left}
.status{min-height:1.2em;color:#94a3b8}.check{display:flex;align-items:center;gap:8px}
button.link{background:transparent;color:#67e8f9;padding:0}
`
}

function appJs(low: boolean): string {
  return `const form = document.getElementById('item-form')
const rows = document.getElementById('rows')
const search = document.getElementById('search')
const categoryFilter = document.getElementById('category-filter')
const lowStock = document.getElementById('low-stock')
const status = document.getElementById('status')
let editingId = null

async function api(path, options) {
  const res = await fetch(path, options)
  if (res.status === 204) return { ok: true }
  const body = await res.json()
  if (!res.ok) throw new Error((body.errors || ['request failed']).join(', '))
  return body
}

async function refresh() {
  const params = new URLSearchParams()
  if (search.value.trim()) params.set('q', search.value.trim())
  if (categoryFilter.value.trim()) params.set('category', categoryFilter.value.trim())
  ${low ? "if (lowStock && lowStock.checked) params.set('lowStock', '1')" : ''}
  const qs = params.toString()
  const data = await api('/api/items' + (qs ? '?' + qs : ''))
  rows.innerHTML = data.items.map(item => \`<tr data-id="\${item.id}">
    <td>\${escapeHtml(item.name)}</td>
    <td>\${item.quantity}</td>
    <td>\${escapeHtml(item.category || '')}</td>
    <td><button type="button" class="link" data-edit="\${item.id}">Edit</button></td>
  </tr>\`).join('') || '<tr><td colspan="4">No items yet.</td></tr>'
  status.textContent = data.items.length + ' item' + (data.items.length === 1 ? '' : 's')
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))
}

form.addEventListener('submit', async event => {
  event.preventDefault()
  const payload = Object.fromEntries(new FormData(form).entries())
  payload.quantity = Number(payload.quantity || 0)
  try {
    if (editingId) await api('/api/items/' + editingId, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
    else await api('/api/items', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
    editingId = null
    form.reset()
    form.quantity.value = '1'
    await refresh()
  } catch (error) {
    status.textContent = error.message
  }
})

rows.addEventListener('click', async event => {
  const id = event.target?.getAttribute?.('data-edit')
  if (!id) return
  const data = await api('/api/items/' + id)
  editingId = id
  form.name.value = data.item.name
  form.quantity.value = data.item.quantity
  form.category.value = data.item.category
  form.notes.value = data.item.notes
})

search.addEventListener('input', () => { refresh().catch(() => undefined) })
categoryFilter.addEventListener('input', () => { refresh().catch(() => undefined) })
${low ? "if (lowStock) lowStock.addEventListener('change', () => { refresh().catch(() => undefined) })" : ''}
refresh().catch(error => { status.textContent = error.message })
`
}

function logoSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Inventory mark"><rect width="64" height="64" rx="12" fill="#064e3b"/><rect x="14" y="18" width="36" height="10" rx="2" fill="#34d399"/><rect x="14" y="32" width="24" height="10" rx="2" fill="#6ee7b7"/><rect x="14" y="46" width="30" height="6" rx="2" fill="#a7f3d0"/></svg>
`
}
