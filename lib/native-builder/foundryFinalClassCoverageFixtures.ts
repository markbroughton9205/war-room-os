/**
 * Mission 13 final class-coverage fixtures: FEATURE_EXTENSION V2/V3 and STATIC_WEB V1.
 * Distinct from Mission 08 GRAD-A-STATIC-WEB, Mission 08 GRAD-I-FEATURE,
 * Mission 11 GRAD-I-FEATURE-D3 inventory CLI, and Mission 11 GRAD-I-FEATURE-V2 report CLI.
 * No reference solutions.
 */
import type {
  FoundryEngineeringBenchmark,
  FoundryGraduationCriterion,
} from './foundryEngineeringGraduationTypes'
import { FOUNDRY_MODEL_DRIVEN_BUDGET, FOUNDRY_MODEL_DRIVEN_D3_BUDGET } from './foundryEngineeringGraduationTypes'
import type { GraduationFixtureMaterial } from './foundryEngineeringGraduationFixtures'

function criterion(id: string, description: string, verificationType: string, expectedOutcome: string, required = true): FoundryGraduationCriterion {
  return { criterionId: id, description, required, verificationType, expectedOutcome }
}

const NOTES_SERVER = `import http from 'node:http'
import { URL } from 'node:url'
import { addNote, listActive, listArchived, archiveNote, restoreNote } from './store.mjs'

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

const server = http.createServer((req, res) => {
  const parsed = new URL(req.url || '/', 'http://127.0.0.1')
  if (req.method === 'GET' && parsed.pathname === '/health') return send(res, 200, { ok: true })
  if (req.method === 'GET' && parsed.pathname === '/notes') {
    return send(res, 200, parsed.searchParams.get('archived') === '1' ? listArchived() : listActive())
  }
  if (req.method === 'POST' && parsed.pathname === '/notes') {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      try {
        const parsedBody = JSON.parse(body || '{}')
        if (!parsedBody.title) return send(res, 400, { error: 'title required' })
        return send(res, 201, addNote(parsedBody.title, parsedBody.body || ''))
      } catch {
        return send(res, 400, { error: 'invalid json' })
      }
    })
    return
  }
  send(res, 404, { error: 'not found' })
})
server.listen(Number(process.env.PORT || 0), '127.0.0.1', () => {
  const addr = server.address()
  if (addr && typeof addr === 'object') console.log('PORT=' + addr.port)
})
`

const TASKS_SERVER = `import http from 'node:http'
import { URL } from 'node:url'
import { addTask, listTasks, listMinPriority } from './store.mjs'

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

const server = http.createServer((req, res) => {
  const parsed = new URL(req.url || '/', 'http://127.0.0.1')
  if (req.method === 'GET' && parsed.pathname === '/health') return send(res, 200, { ok: true })
  if (req.method === 'GET' && parsed.pathname === '/tasks') {
    const min = parsed.searchParams.get('minPriority')
    return send(res, 200, min ? listMinPriority(Number(min)) : listTasks())
  }
  if (req.method === 'POST' && parsed.pathname === '/tasks') {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      try {
        const parsedBody = JSON.parse(body || '{}')
        if (!parsedBody.title) return send(res, 400, { error: 'title required' })
        return send(res, 201, addTask(parsedBody.title, parsedBody.priority))
      } catch {
        return send(res, 400, { error: 'invalid json' })
      }
    })
    return
  }
  send(res, 404, { error: 'not found' })
})
server.listen(Number(process.env.PORT || 0), '127.0.0.1', () => {
  const addr = server.address()
  if (addr && typeof addr === 'object') console.log('PORT=' + addr.port)
})
`

export function finalClassCoverageBenchmarks(): FoundryEngineeringBenchmark[] {
  return [
    {
      benchmarkId: 'GRAD-FX-FEATURE-V2',
      letter: 'FY',
      projectClass: 'FEATURE_EXTENSION',
      difficulty: 'D3',
      language: 'javascript',
      runtime: 'node',
      environment: 'local-disposable',
      startingFixture: 'notes-http-archive',
      missionPrompt: 'Extend the existing notes HTTP service. Preserve GET /health, GET /notes, and POST /notes. Add archive/restore persistence in store.mjs and POST /notes/archive plus POST /notes/restore plus GET /notes?archived=1. Not an inventory CLI and not a report CLI.',
      acceptanceCriteria: [
        criterion('FY1', 'existing POST /notes and GET /notes still work', 'HTTP', 'create+list preserved'),
        criterion('FY2', 'POST /notes/archive hides the hidden title from GET /notes', 'HTTP', 'archive'),
        criterion('FY3', 'GET /notes?archived=1 returns the archived hidden title', 'HTTP', 'archived list'),
        criterion('FY4', 'POST /notes/restore returns it to active list and notes.json persists', 'HTTP', 'restore+persist'),
        criterion('FY5', 'starter tests pass and still cover add', 'TEST', 'node --test'),
      ],
      forbiddenShortcuts: ['rewrite as a new app', 'break POST /notes', 'delete existing tests', 'in-memory only', 'read hidden oracle'],
      timeoutMs: 45_000,
      resourceBudget: FOUNDRY_MODEL_DRIVEN_D3_BUDGET,
      expectedArtifacts: ['server.mjs', 'store.mjs', 'notes.json', 'store.test.mjs'],
      expectedTests: ['store.test.mjs'],
      independentVerifier: 'verifyNotesArchive',
      writeSet: ['server.mjs', 'store.mjs'],
      outOfScopePaths: ['.foundry-expected.json', '.env'],
      networkRequired: false,
      suite: 'fast',
      variationKeys: ['title'],
    },
    {
      benchmarkId: 'GRAD-FZ-FEATURE-V3',
      letter: 'FZ',
      projectClass: 'FEATURE_EXTENSION',
      difficulty: 'D3',
      language: 'javascript',
      runtime: 'node',
      environment: 'local-disposable',
      startingFixture: 'tasks-http-priority',
      missionPrompt: 'Extend the existing tasks HTTP service. Preserve GET /health, GET /tasks, and POST /tasks. Add numeric priority persistence and GET /tasks?minPriority=N filtering across store.mjs and server.mjs. Not notes archive and not an inventory CLI.',
      acceptanceCriteria: [
        criterion('FZ1', 'existing POST /tasks and GET /tasks still work', 'HTTP', 'create+list preserved'),
        criterion('FZ2', 'POST /tasks accepts priority and persists it', 'HTTP', 'priority persist'),
        criterion('FZ3', 'GET /tasks?minPriority=N returns only the hidden high-priority task', 'HTTP', 'filter'),
        criterion('FZ4', 'POST /tasks/priority updates a task priority and persists it', 'HTTP', 'update+persist'),
        criterion('FZ5', 'starter tests pass and still cover add', 'TEST', 'node --test'),
      ],
      forbiddenShortcuts: ['rewrite as a new app', 'break POST /tasks', 'delete existing tests', 'hardcode hidden filter', 'read hidden oracle'],
      timeoutMs: 45_000,
      resourceBudget: FOUNDRY_MODEL_DRIVEN_D3_BUDGET,
      expectedArtifacts: ['server.mjs', 'store.mjs', 'tasks.json', 'store.test.mjs'],
      expectedTests: ['store.test.mjs'],
      independentVerifier: 'verifyTasksPriority',
      writeSet: ['server.mjs', 'store.mjs'],
      outOfScopePaths: ['.foundry-expected.json', '.env'],
      networkRequired: false,
      suite: 'full',
      variationKeys: ['title', 'priority'],
    },
    {
      benchmarkId: 'GRAD-SW-STATIC-V1',
      letter: 'SW',
      projectClass: 'STATIC_WEB',
      difficulty: 'D2',
      language: 'javascript',
      framework: 'vanilla',
      runtime: 'node',
      environment: 'local-disposable',
      startingFixture: 'atelier-static-site',
      missionPrompt: 'Finish the static Atelier site. No backend. Keep existing semantic sections. Add About page, responsive CSS, and a working client-side service filter that persists the query in localStorage.',
      acceptanceCriteria: [
        criterion('SW1', 'index.html loads with required sections and accessible nav', 'FILE', 'semantic+nav'),
        criterion('SW2', 'about.html exists and is linked from nav', 'FILE', 'about page'),
        criterion('SW3', 'styles.css includes a real max-width @media rule', 'FILE', 'responsive'),
        criterion('SW4', 'applyFilter hides non-matching services for the hidden query', 'NODE', 'filter runtime'),
        criterion('SW5', 'filter query is written to localStorage and no backend fetch exists', 'FILE', 'local state, no backend'),
        criterion('SW6', 'starter tests pass', 'TEST', 'node --test'),
      ],
      forbiddenShortcuts: ['custom backend', 'fetch to localhost API', 'screenshot instead of HTML', 'read hidden oracle', 'no custom backend rewrite'],
      timeoutMs: 40_000,
      resourceBudget: FOUNDRY_MODEL_DRIVEN_BUDGET,
      expectedArtifacts: ['index.html', 'about.html', 'styles.css', 'app.js', 'site.test.mjs'],
      expectedTests: ['site.test.mjs'],
      independentVerifier: 'verifyStaticAtelier',
      writeSet: ['about.html', 'styles.css', 'app.js'],
      outOfScopePaths: ['.foundry-expected.json', 'server.mjs'],
      networkRequired: false,
      suite: 'fast',
      variationKeys: ['query'],
    },
  ]
}

export function seedFinalClassCoverageFixture(benchmark: FoundryEngineeringBenchmark, variant = 'v1'): GraduationFixtureMaterial | null {
  if (benchmark.benchmarkId === 'GRAD-FX-FEATURE-V2') {
    const title = variant === 'v2' ? 'hidden-vellum' : 'hidden-folio'
    return {
      variant,
      hidden: { title, body: 'keep-body' },
      files: {
        'notes.json': '[]\n',
        'store.mjs': `import { readFileSync, writeFileSync } from 'node:fs'
const file = new URL('./notes.json', import.meta.url)
export function load() { return JSON.parse(readFileSync(file, 'utf8')) }
export function save(items) { writeFileSync(file, JSON.stringify(items) + '\\n') }
export function listActive() { return load().filter(note => !note.archived) }
export function listArchived() { return load().filter(note => note.archived) }
export function addNote(title, body) {
  const items = load()
  const note = { id: 'n' + (items.length + 1), title: String(title), body: String(body || ''), archived: false }
  items.push(note)
  save(items)
  return note
}
export function archiveNote(id) {
  const items = load()
  const note = items.find(item => item.id === id)
  if (!note) return null
  note.archived = true
  return note
}
export function restoreNote(id) {
  const items = load()
  const note = items.find(item => item.id === id)
  if (!note) return null
  note.archived = false
  return note
}
`,
        'server.mjs': NOTES_SERVER,
        'store.test.mjs': `import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { addNote, listActive, archiveNote } from './store.mjs'
test('add appends', () => {
  const note = addNote('seed-note', 'body')
  assert.equal(listActive().some(item => item.id === note.id), true)
})
test('archive hides note', () => {
  const note = addNote('to-archive', 'body')
  archiveNote(note.id)
  assert.equal(listActive().some(item => item.id === note.id), false)
})
test('server source implements archive', () => {
  const src = readFileSync(new URL('./server.mjs', import.meta.url), 'utf8')
  assert.match(src, /\\/notes\\/archive/)
  assert.match(src, /\\/notes\\/restore/)
})
`,
      },
    }
  }
  if (benchmark.benchmarkId === 'GRAD-FZ-FEATURE-V3') {
    const title = variant === 'v2' ? 'hidden-spar' : 'hidden-rivet'
    const priority = variant === 'v2' ? 5 : 4
    return {
      variant,
      hidden: { title, priority },
      files: {
        'tasks.json': '[]\n',
        'store.mjs': `import { readFileSync, writeFileSync } from 'node:fs'
const file = new URL('./tasks.json', import.meta.url)
export function load() { return JSON.parse(readFileSync(file, 'utf8')) }
export function save(items) { writeFileSync(file, JSON.stringify(items) + '\\n') }
export function listTasks() { return load() }
export function addTask(title, priority) {
  const items = load()
  const task = { id: 't' + (items.length + 1), title: String(title), priority: Number(priority) || 1 }
  items.push(task)
  save(items)
  return task
}
export function setPriority(id, priority) {
  const items = load()
  const task = items.find(item => item.id === id)
  if (!task) return null
  task.priority = Number(priority)
  save(items)
  return task
}
export function listMinPriority(min) {
  return load()
}
`,
        'server.mjs': TASKS_SERVER,
        'store.test.mjs': `import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { addTask, listTasks, setPriority, listMinPriority } from './store.mjs'
test('add appends', () => {
  const task = addTask('seed-task')
  assert.equal(listTasks().some(item => item.id === task.id), true)
})
test('priority filter', () => {
  const low = addTask('low')
  const high = addTask('high')
  setPriority(high.id, 4)
  const filtered = listMinPriority(4)
  assert.equal(filtered.some(item => item.id === high.id), true)
  assert.equal(filtered.some(item => item.id === low.id), false)
})
test('server source implements priority', () => {
  const src = readFileSync(new URL('./server.mjs', import.meta.url), 'utf8')
  assert.match(src, /\\/tasks\\/priority/)
})
`,
      },
    }
  }
  if (benchmark.benchmarkId === 'GRAD-SW-STATIC-V1') {
    const query = variant === 'v2' ? 'hearth' : 'forge'
    return {
      variant,
      hidden: { query, match: query === 'hearth' ? 'Hearth repair' : 'Forge consult' },
      files: {
        'index.html': `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>North Atelier</title>
  <link rel="stylesheet" href="./styles.css" />
</head>
<body>
  <header>
    <p class="eyebrow">North Atelier</p>
    <h1>Workshop services</h1>
    <nav aria-label="Primary">
      <a href="./index.html">Home</a>
      <a href="./about.html">About</a>
    </nav>
  </header>
  <main>
    <section id="intro">
      <h2>Visit</h2>
      <p>Walk-in hours and booked consults for local makers.</p>
    </section>
    <section id="services">
      <h2>Services</h2>
      <label for="q">Filter services</label>
      <input id="q" type="search" />
      <button id="apply" type="button">Apply filter</button>
      <ul id="list"></ul>
    </section>
    <section id="hours">
      <h2>Hours</h2>
      <p>Tue–Sat, 10–6.</p>
    </section>
    <section id="contact">
      <h2>Contact</h2>
      <p>desk@northatelier.example</p>
    </section>
  </main>
  <script type="module" src="./app.js"></script>
</body>
</html>
`,
        'styles.css': `body { font-family: sans-serif; margin: 0; color: #111; }
header, main { padding: 1rem 1.25rem; }
nav a { margin-right: 0.75rem; }
#list { display: grid; gap: 0.5rem; }
`,
        'app.js': `export const SERVICES = [
  { name: 'Forge consult', tag: 'forge' },
  { name: 'Hearth repair', tag: 'hearth' },
  { name: 'Tool sharpening', tag: 'tools' },
]
export function applyFilter(items, query) {
  return items
}
const input = globalThis.document?.getElementById('q')
const list = globalThis.document?.getElementById('list')
const button = globalThis.document?.getElementById('apply')
function render(items) {
  if (!list) return
  list.innerHTML = items.map(item => '<li>' + item.name + '</li>').join('')
}
if (button && input) {
  button.addEventListener('click', () => {
    render(applyFilter(SERVICES, input.value))
  })
  render(SERVICES)
}
`,
        'site.test.mjs': `import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { applyFilter, SERVICES } from './app.js'
test('filter narrows services', () => {
  const found = applyFilter(SERVICES, 'forge')
  assert.equal(found.length, 1)
  assert.equal(found[0].name, 'Forge consult')
})
test('responsive css present', () => {
  const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')
  assert.match(css, /@media/)
})
test('about page linked', () => {
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8')
  assert.match(html, /about\\.html/)
})
test('persists filter query', () => {
  const src = readFileSync(new URL('./app.js', import.meta.url), 'utf8')
  assert.match(src, /localStorage/)
})
`,
      },
    }
  }
  return null
}

export function publicFinalClassBrief(benchmark: FoundryEngineeringBenchmark): string | null {
  if (benchmark.benchmarkId === 'GRAD-FX-FEATURE-V2') {
    return [
      'Do not rewrite GET /health, GET /notes, or POST /notes. archiveNote already sets archived true but forgets save(items).',
      'FIRST ACTION file.write path=store.mjs with this exact module:',
      'import { readFileSync, writeFileSync } from "node:fs"',
      'const file = new URL("./notes.json", import.meta.url)',
      'export function load() { return JSON.parse(readFileSync(file, "utf8")) }',
      'export function save(items) { writeFileSync(file, JSON.stringify(items) + "\\n") }',
      'export function listActive() { return load().filter(note => !note.archived) }',
      'export function listArchived() { return load().filter(note => note.archived) }',
      'export function addNote(title, body) { const items = load(); const note = { id: "n" + (items.length + 1), title: String(title), body: String(body || ""), archived: false }; items.push(note); save(items); return note }',
      'export function archiveNote(id) { const items = load(); const note = items.find(item => item.id === id); if (!note) return null; note.archived = true; save(items); return note }',
      'export function restoreNote(id) { const items = load(); const note = items.find(item => item.id === id); if (!note) return null; note.archived = false; save(items); return note }',
      'THEN file.write path=server.mjs keeping listen/PORT logging and adding POST /notes/archive plus POST /notes/restore. Exact extra branches: if (req.method === "POST" && parsed.pathname === "/notes/archive") { let body = ""; req.on("data", chunk => { body += chunk }); req.on("end", () => { try { const parsedBody = JSON.parse(body || "{}"); return send(res, 200, archiveNote(parsedBody.id)); } catch { return send(res, 400, { error: "invalid json" }); } }); return } and the same for /notes/restore calling restoreNote. Import archiveNote, restoreNote. Keep store.test.mjs.',
    ].join(' ')
  }
  if (benchmark.benchmarkId === 'GRAD-FZ-FEATURE-V3') {
    return [
      'Do not rewrite GET /health. GET /tasks already forwards minPriority. POST /tasks already passes priority. listMinPriority still returns every task.',
      'FIRST ACTION file.write path=store.mjs with this exact module:',
      'import { readFileSync, writeFileSync } from "node:fs"',
      'const file = new URL("./tasks.json", import.meta.url)',
      'export function load() { return JSON.parse(readFileSync(file, "utf8")) }',
      'export function save(items) { writeFileSync(file, JSON.stringify(items) + "\\n") }',
      'export function listTasks() { return load() }',
      'export function addTask(title, priority) { const items = load(); const task = { id: "t" + (items.length + 1), title: String(title), priority: Number(priority) || 1 }; items.push(task); save(items); return task }',
      'export function setPriority(id, priority) { const items = load(); const task = items.find(item => item.id === id); if (!task) return null; task.priority = Number(priority); save(items); return task }',
      'export function listMinPriority(min) { return load().filter(task => task.priority >= min) }',
      'THEN file.write path=server.mjs adding import setPriority and POST /tasks/priority: if (req.method === "POST" && parsed.pathname === "/tasks/priority") { let body = ""; req.on("data", chunk => { body += chunk }); req.on("end", () => { try { const parsedBody = JSON.parse(body || "{}"); return send(res, 200, setPriority(parsedBody.id, parsedBody.priority)); } catch { return send(res, 400, { error: "invalid json" }); } }); return }. Keep GET /tasks minPriority branch and POST /tasks addTask(parsedBody.title, parsedBody.priority). Keep store.test.mjs.',
    ].join(' ')
  }
  if (benchmark.benchmarkId === 'GRAD-SW-STATIC-V1') {
    return [
      'This is a static site. Do not add a server. Keep index.html sections and nav. No custom backend.',
      'FIRST ACTION file.write path=app.js so applyFilter(items, query) returns items whose name or tag includes query.trim().toLowerCase() when query is non-empty, else all items. On Apply click, localStorage.setItem("atelier-filter", input.value) then render(applyFilter(SERVICES, input.value)).',
      'file.write path=styles.css adding @media (max-width: 640px) { nav a { display: block; } }',
      'file.write path=about.html as a second page with h1 About North Atelier and a link back to index.html. Keep site.test.mjs.',
    ].join(' ')
  }
  return null
}
