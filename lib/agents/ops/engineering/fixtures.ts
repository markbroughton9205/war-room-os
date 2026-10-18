import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/** A small, real, runnable Node application used as an isolated engineering fixture (never War Room source). */
export function makeNotesApp(root: string): string {
  const w = (rel: string, body: string) => { mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); writeFileSync(path.join(root, rel), body) }
  w('package.json', JSON.stringify({ name: 'notes-app', version: '1.0.0', type: 'module', scripts: { start: 'node server.mjs', test: 'node --test test/' } }, null, 2))
  w('src/notesStore.mjs', `import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export function storePath() {
  return process.env.NOTES_DATA_FILE || path.join(process.cwd(), 'data', 'notes.json')
}

export function loadNotes() {
  const file = storePath()
  if (!existsSync(file)) return []
  return JSON.parse(readFileSync(file, 'utf8'))
}

export function saveNotes(notes) {
  const file = storePath()
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(notes, null, 2))
}
`)
  w('src/notesService.mjs', `import { loadNotes, saveNotes } from './notesStore.mjs'

export function validateNote(input) {
  if (!input || typeof input.text !== 'string' || input.text.trim() === '') throw new Error('text is required')
  if (input.text.length > 500) throw new Error('text too long')
  return { text: input.text.trim() }
}

export function listNotes() {
  return loadNotes()
}

export function addNote(input) {
  const valid = validateNote(input)
  const notes = loadNotes()
  const note = { id: String(Date.now()) + '-' + notes.length, text: valid.text, createdAt: new Date().toISOString() }
  notes.push(note)
  saveNotes(notes)
  return note
}

export function removeNote(id) {
  const notes = loadNotes()
  const next = notes.filter((n) => n.id !== id)
  saveNotes(next)
  return next.length !== notes.length
}
`)
  w('server.mjs', `import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { addNote, listNotes, removeNote } from './src/notesService.mjs'

const port = Number(process.env.PORT || 3100)

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'content-type': type })
  res.end(typeof body === 'string' ? body : JSON.stringify(body))
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  try {
    if (url.pathname === '/' || url.pathname === '/index.html') return send(res, 200, readFileSync('public/index.html', 'utf8'), 'text/html')
    if (url.pathname === '/app.js') return send(res, 200, readFileSync('public/app.js', 'utf8'), 'text/javascript')
    if (url.pathname === '/api/notes' && req.method === 'GET') return send(res, 200, listNotes())
    if (url.pathname === '/api/notes' && req.method === 'POST') {
      let raw = ''
      for await (const chunk of req) raw += chunk
      return send(res, 201, addNote(JSON.parse(raw || '{}')))
    }
    if (url.pathname.startsWith('/api/notes/') && req.method === 'DELETE') return send(res, removeNote(url.pathname.split('/').pop()) ? 200 : 404, { ok: true })
    return send(res, 404, { error: 'not found' })
  } catch (err) {
    return send(res, 400, { error: String(err.message || err) })
  }
})

server.listen(port, () => console.log('notes-app listening on ' + port))
`)
  w('public/index.html', `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Notes</title></head>
<body>
  <!-- History tab: shows the history of notes. The history view is a visual label only. -->
  <h1>Notes</h1>
  <nav><a href="#history">History</a> <a href="#history">History view</a> <span>History</span></nav>
  <section id="history"><h2>History</h2></section>
  <form id="note-form"><input id="note-text" placeholder="write a note"><button type="submit">Add</button></form>
  <ul id="notes"></ul>
  <script src="/app.js"></script>
</body>
</html>
`)
  w('public/app.js', `async function refresh() {
  const res = await fetch('/api/notes')
  const notes = await res.json()
  const list = document.getElementById('notes')
  list.innerHTML = ''
  for (const n of notes) {
    const li = document.createElement('li')
    li.textContent = n.text
    list.appendChild(li)
  }
}

document.getElementById('note-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const input = document.getElementById('note-text')
  await fetch('/api/notes', { method: 'POST', body: JSON.stringify({ text: input.value }) })
  input.value = ''
  refresh()
})

refresh()
`)
  w('test/notesService.test.mjs', `import test from 'node:test'
import assert from 'node:assert'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

process.env.NOTES_DATA_FILE = path.join(mkdtempSync(path.join(tmpdir(), 'notes-')), 'notes.json')
const { addNote, listNotes, removeNote, validateNote } = await import('../src/notesService.mjs')

test('adds and lists notes', () => {
  const n = addNote({ text: ' hello ' })
  assert.strictEqual(n.text, 'hello')
  assert.strictEqual(listNotes().length, 1)
})

test('rejects empty text', () => {
  assert.throws(() => validateNote({ text: '   ' }), /required/)
})

test('removes notes', () => {
  const n = addNote({ text: 'bye' })
  assert.strictEqual(removeNote(n.id), true)
})
`)
  return root
}
