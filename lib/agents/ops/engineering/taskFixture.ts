import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * FIXTURE B — "todo-app" baseline (in-memory todo list) -> persistent task board (work items with a status workflow).
 * Deliberately a different shape from fixture A (chat sessions): a state machine with transition rules, PATCH updates, query filtering,
 * an aggregate endpoint, monotonic ids that must survive restarts, and a three-column board UI. Same layers: storage, service, API, UI, tests, runtime.
 */
export const TASK_FEATURE = {
  request: 'Turn the todo list into a persistent task board: tasks have a title, a priority (1-3, default 2) and a status (todo, doing, done) that moves only along allowed transitions; the API can create, move, list, filter and summarise tasks; tasks survive a server restart; and the page shows a three-column board.',
  acceptance: [
    'POST /api/tasks with a title creates a task (201) with a numeric id, status "todo" and priority 2 unless given; an empty title or a priority outside 1-3 is rejected with 400',
    'PATCH /api/tasks/:id with {"status": ...} moves a task; allowed moves are todo->doing, doing->done, doing->todo and done->doing; any other move (for example todo->done) is rejected with 409, an unknown status value with 400, an unknown task id with 404',
    'GET /api/tasks lists all tasks; GET /api/tasks?status=doing returns only tasks in that status',
    'GET /api/tasks/summary returns the number of tasks per status as {"todo":n,"doing":n,"done":n}',
    'tasks are persisted to disk in the file named by the TASKS_FILE environment variable (default: data/tasks.json under the working directory) and survive a server restart, including their statuses; task ids keep increasing after a restart and are never reused',
    'the existing GET/POST /api/todos endpoints keep working',
    'the page shows three board columns (elements with ids col-todo, col-doing, col-done) filled from /api/tasks, with a way to add a task and to move a task',
    'node tests cover the new task service functions',
  ],
  hints: ['task', 'status'],
}

const files: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'todo-app', version: '1.0.0', type: 'module', scripts: { start: 'node server.mjs', test: 'node --test test/' } }, null, 2),
  'src/todoList.mjs': `// In-memory todo list (lost on restart).
const items = []
let nextId = 1

export function allItems() {
  return items
}

export function pushItem(item) {
  const stored = { id: nextId++, ...item }
  items.push(stored)
  return stored
}
`,
  'src/todoService.mjs': `import { allItems, pushItem } from './todoList.mjs'

export function checkTitle(title) {
  if (typeof title !== 'string' || title.trim() === '') throw new Error('title is required')
  if (title.length > 200) throw new Error('title too long')
  return title.trim()
}

export function listTodos() {
  return allItems()
}

export function addTodo(input) {
  const title = checkTitle(input && input.title)
  return pushItem({ title, done: false })
}
`,
  'server.mjs': `import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { addTodo, listTodos } from './src/todoService.mjs'

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
    if (url.pathname === '/api/todos' && req.method === 'GET') return reply(res, 200, listTodos())
    if (url.pathname === '/api/todos' && req.method === 'POST') return reply(res, 201, addTodo(await body(req)))
    return reply(res, 404, { error: 'not found' })
  } catch (err) {
    return reply(res, 400, { error: String(err.message || err) })
  }
})

server.listen(port, '127.0.0.1', () => console.log('todo-app listening on ' + port))
`,
  'public/index.html': `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Todos</title></head>
<body>
  <h1>Todos</h1>
  <ul id="todo-list"></ul>
  <form id="todo-form"><input id="todo-title" placeholder="what needs doing"><button type="submit">Add</button></form>
  <script src="/client.js"></script>
</body>
</html>
`,
  'public/client.js': `async function load() {
  const todos = await (await fetch('/api/todos')).json()
  const ul = document.getElementById('todo-list')
  ul.innerHTML = ''
  for (const t of todos) {
    const li = document.createElement('li')
    li.textContent = t.title
    ul.appendChild(li)
  }
}

document.getElementById('todo-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const input = document.getElementById('todo-title')
  await fetch('/api/todos', { method: 'POST', body: JSON.stringify({ title: input.value }) })
  input.value = ''
  load()
})

load()
`,
  'test/todoService.test.mjs': `import test from 'node:test'
import assert from 'node:assert'
import { addTodo, listTodos, checkTitle } from '../src/todoService.mjs'

test('adds and lists todos', () => {
  const t = addTodo({ title: ' write docs ' })
  assert.strictEqual(t.title, 'write docs')
  assert.ok(listTodos().some((x) => x.id === t.id))
})

test('rejects an empty title', () => {
  assert.throws(() => checkTitle('   '), /required/)
})
`,
}

export function makeTaskApp(root: string): string {
  for (const [rel, body] of Object.entries(files)) { mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); writeFileSync(path.join(root, rel), body) }
  return root
}

/** Independently written reference (used ONLY to validate the verifier and for scripted-mechanics tests; never shown to a model). */
export const TASK_REFERENCE: Record<string, string> = {
  'src/taskStore.mjs': `import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export function tasksFile() {
  return process.env.TASKS_FILE || path.join(process.cwd(), 'data', 'tasks.json')
}

const EMPTY = { lastId: 0, tasks: [] }

export function readBoard() {
  const file = tasksFile()
  if (!existsSync(file)) return { ...EMPTY, tasks: [] }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return { lastId: Number(parsed.lastId) || 0, tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [] }
  } catch {
    return { ...EMPTY, tasks: [] }
  }
}

export function writeBoard(board) {
  const file = tasksFile()
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(board, null, 2))
  renameSync(tmp, file)
}
`,
  'src/taskService.mjs': `import { readBoard, writeBoard } from './taskStore.mjs'

export const STATUSES = ['todo', 'doing', 'done']
const MOVES = { todo: ['doing'], doing: ['done', 'todo'], done: ['doing'] }

export class TaskError extends Error {
  constructor(code, message) { super(message); this.code = code }
}

export function createTask(input) {
  const title = input && typeof input.title === 'string' ? input.title.trim() : ''
  if (!title) throw new TaskError(400, 'title is required')
  const priority = input.priority === undefined ? 2 : input.priority
  if (!Number.isInteger(priority) || priority < 1 || priority > 3) throw new TaskError(400, 'priority must be 1-3')
  const board = readBoard()
  const task = { id: board.lastId + 1, title, priority, status: 'todo' }
  board.lastId = task.id
  board.tasks.push(task)
  writeBoard(board)
  return task
}

export function moveTask(id, status) {
  if (!STATUSES.includes(status)) throw new TaskError(400, 'unknown status')
  const board = readBoard()
  const task = board.tasks.find((t) => t.id === Number(id))
  if (!task) throw new TaskError(404, 'task not found')
  if (!MOVES[task.status].includes(status)) throw new TaskError(409, 'cannot move ' + task.status + ' to ' + status)
  task.status = status
  writeBoard(board)
  return task
}

export function listTasks(status) {
  const all = readBoard().tasks
  return status ? all.filter((t) => t.status === status) : all
}

export function summary() {
  const out = { todo: 0, doing: 0, done: 0 }
  for (const t of readBoard().tasks) out[t.status] += 1
  return out
}
`,
  'server.mjs': `import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { addTodo, listTodos } from './src/todoService.mjs'
import { createTask, listTasks, moveTask, summary, TaskError } from './src/taskService.mjs'

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
  const taskId = /^\\/api\\/tasks\\/(\\d+)$/.exec(url.pathname)
  try {
    if (url.pathname === '/') return reply(res, 200, readFileSync('public/index.html', 'utf8'), 'text/html')
    if (url.pathname === '/client.js') return reply(res, 200, readFileSync('public/client.js', 'utf8'), 'text/javascript')
    if (url.pathname === '/api/todos' && req.method === 'GET') return reply(res, 200, listTodos())
    if (url.pathname === '/api/todos' && req.method === 'POST') return reply(res, 201, addTodo(await body(req)))
    if (url.pathname === '/api/tasks/summary' && req.method === 'GET') return reply(res, 200, summary())
    if (url.pathname === '/api/tasks' && req.method === 'GET') return reply(res, 200, listTasks(url.searchParams.get('status')))
    if (url.pathname === '/api/tasks' && req.method === 'POST') return reply(res, 201, createTask(await body(req)))
    if (url.pathname.startsWith('/api/tasks/') && req.method === 'PATCH') {
      if (!taskId) return reply(res, 404, { error: 'task not found' })
      return reply(res, 200, moveTask(taskId[1], (await body(req)).status))
    }
    return reply(res, 404, { error: 'not found' })
  } catch (err) {
    if (err instanceof TaskError) return reply(res, err.code, { error: err.message })
    return reply(res, 400, { error: String(err.message || err) })
  }
})

server.listen(port, '127.0.0.1', () => console.log('todo-app listening on ' + port))
`,
  'public/index.html': `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Task board</title></head>
<body>
  <h1>Task board</h1>
  <form id="task-form"><input id="task-title" placeholder="new task"><button type="submit">Add</button></form>
  <div class="board">
    <section><h2>To do</h2><ul id="col-todo"></ul></section>
    <section><h2>Doing</h2><ul id="col-doing"></ul></section>
    <section><h2>Done</h2><ul id="col-done"></ul></section>
  </div>
  <script src="/client.js"></script>
</body>
</html>
`,
  'public/client.js': `const NEXT = { todo: ['doing'], doing: ['done', 'todo'], done: ['doing'] }

async function render() {
  const tasks = await (await fetch('/api/tasks')).json()
  for (const status of ['todo', 'doing', 'done']) {
    const col = document.getElementById('col-' + status)
    col.innerHTML = ''
    for (const t of tasks.filter((x) => x.status === status)) {
      const li = document.createElement('li')
      li.textContent = t.title + ' '
      for (const target of NEXT[status]) {
        const b = document.createElement('button')
        b.textContent = '-> ' + target
        b.addEventListener('click', async () => {
          await fetch('/api/tasks/' + t.id, { method: 'PATCH', body: JSON.stringify({ status: target }) })
          render()
        })
        li.appendChild(b)
      }
      col.appendChild(li)
    }
  }
}

document.getElementById('task-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const input = document.getElementById('task-title')
  await fetch('/api/tasks', { method: 'POST', body: JSON.stringify({ title: input.value }) })
  input.value = ''
  render()
})

render()
`,
  'test/taskService.test.mjs': `import test from 'node:test'
import assert from 'node:assert'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

process.env.TASKS_FILE = path.join(mkdtempSync(path.join(tmpdir(), 'tasks-')), 'tasks.json')
const svc = await import('../src/taskService.mjs')

test('new tasks start in todo with default priority', () => {
  const t = svc.createTask({ title: 'ship it' })
  assert.strictEqual(t.status, 'todo')
  assert.strictEqual(t.priority, 2)
})

test('moves follow the workflow', () => {
  const t = svc.createTask({ title: 'flow' })
  assert.throws(() => svc.moveTask(t.id, 'done'), (e) => e.code === 409)
  assert.strictEqual(svc.moveTask(t.id, 'doing').status, 'doing')
  assert.strictEqual(svc.moveTask(t.id, 'done').status, 'done')
})

test('summary counts by status', () => {
  const s = svc.summary()
  assert.strictEqual(s.todo + s.doing + s.done, svc.listTasks().length)
})
`,
}

export const TASK_VERIFY_SCRIPT = `import { spawn } from 'node:child_process'
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = process.argv[2]
const dataFile = path.join(mkdtempSync(path.join(tmpdir(), 'verify-task-')), 'tasks.json')
let n = 0, pass = 0, fail = 0
const report = (ok, name, detail = '') => { n += 1; if (ok) pass += 1; else fail += 1; console.log((ok ? 'ok ' : 'not ok ') + n + ' - ' + name + (ok || !detail ? '' : '\\n  message: ' + String(detail).slice(0, 300))) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function start() {
  const port = 21000 + Math.floor(Math.random() * 15000)
  const child = spawn('node', ['server.mjs'], { cwd: root, env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), TASKS_FILE: dataFile }, stdio: ['ignore', 'pipe', 'pipe'] })
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

let srv
try {
  srv = await start()
  const send = (method, p, body) => fetch(srv.base + p, { method, body: body === undefined ? undefined : JSON.stringify(body) })
  const c1 = await send('POST', '/api/tasks', { title: 'write spec' }); const t1 = await json(c1)
  report(c1.status === 201 && t1 && typeof t1.id === 'number' && t1.title === 'write spec' && t1.status === 'todo' && t1.priority === 2, 'POST /api/tasks creates a todo task with default priority', 'status=' + c1.status + ' body=' + JSON.stringify(t1))
  const bad1 = await send('POST', '/api/tasks', { title: '  ' }); const bad2 = await send('POST', '/api/tasks', { title: 'x', priority: 5 })
  report(bad1.status === 400 && bad2.status === 400, 'empty title and out-of-range priority are rejected with 400', 'title=' + bad1.status + ' priority=' + bad2.status)
  const t2 = await json(await send('POST', '/api/tasks', { title: 'review', priority: 3 })); const t3 = await json(await send('POST', '/api/tasks', { title: 'deploy', priority: 1 }))
  const m1 = await send('PATCH', '/api/tasks/' + t1.id, { status: 'doing' }); const mt1 = await json(m1)
  report(m1.status === 200 && mt1 && mt1.status === 'doing', 'PATCH moves todo -> doing', 'status=' + m1.status + ' body=' + JSON.stringify(mt1))
  const skip = await send('PATCH', '/api/tasks/' + t2.id, { status: 'done' }); const weird = await send('PATCH', '/api/tasks/' + t2.id, { status: 'blocked' })
  report(skip.status === 409 && weird.status === 400, 'todo -> done is rejected with 409 and an unknown status with 400', 'skip=' + skip.status + ' weird=' + weird.status)
  const missing = await send('PATCH', '/api/tasks/99999', { status: 'doing' })
  report(missing.status === 404, 'moving an unknown task returns 404', 'status=' + missing.status)
  const done = await send('PATCH', '/api/tasks/' + t1.id, { status: 'done' }); const reopen = await send('PATCH', '/api/tasks/' + t1.id, { status: 'doing' })
  report(done.status === 200 && reopen.status === 200 && (await json(reopen)).status === 'doing', 'doing -> done and done -> doing (reopen) are allowed', 'done=' + done.status + ' reopen=' + reopen.status)
  await send('PATCH', '/api/tasks/' + t3.id, { status: 'doing' }); await send('PATCH', '/api/tasks/' + t3.id, { status: 'done' })
  const all = await json(await send('GET', '/api/tasks'))
  report(Array.isArray(all) && all.length === 3 && [t1.id, t2.id, t3.id].every((id) => all.some((t) => t.id === id)), 'GET /api/tasks lists all tasks', JSON.stringify(all))
  const doing = await json(await send('GET', '/api/tasks?status=doing'))
  report(Array.isArray(doing) && doing.length === 1 && doing[0].id === t1.id, 'GET /api/tasks?status=doing returns only doing tasks', JSON.stringify(doing))
  const sum = await json(await send('GET', '/api/tasks/summary'))
  report(same(sum, { todo: 1, doing: 1, done: 1 }), 'GET /api/tasks/summary counts tasks per status', JSON.stringify(sum))
  const legacyPost = await send('POST', '/api/todos', { title: 'legacy' }); const legacy = await json(await send('GET', '/api/todos'))
  const html = await (await send('GET', '/')).text(); const js = await (await send('GET', '/client.js')).text()
  report(legacyPost.status === 201 && Array.isArray(legacy), 'the existing /api/todos endpoints keep working', 'post=' + legacyPost.status)
  report(/id="col-todo"/.test(html) && /id="col-doing"/.test(html) && /id="col-done"/.test(html) && /\\/api\\/tasks/.test(js), 'the page has the three board columns and the client script calls /api/tasks', 'cols=' + /id="col-doing"/.test(html))
  const persisted = existsSync(dataFile) && /write spec/.test(readFileSync(dataFile, 'utf8'))
  await stop(srv.child)
  srv = await start()
  const afterAll = await json(await send('GET', '/api/tasks')); const afterSum = await json(await send('GET', '/api/tasks/summary'))
  const next = await json(await send('POST', '/api/tasks', { title: 'after restart' }))
  report(persisted && Array.isArray(afterAll) && afterAll.length === 3 && same(afterSum, { todo: 1, doing: 1, done: 1 }) && next && next.id > Math.max(t1.id, t2.id, t3.id), 'tasks, statuses and id sequence persist in TASKS_FILE across a restart', 'persisted=' + persisted + ' after=' + JSON.stringify(afterAll) + ' next=' + JSON.stringify(next))
} catch (err) {
  report(false, 'verification could not complete', String(err.message || err))
} finally { if (srv) await stop(srv.child) }
console.log('# tests ' + n); console.log('# pass ' + pass); console.log('# fail ' + fail)
process.exit(fail === 0 && n >= 8 ? 0 : 1)
`
