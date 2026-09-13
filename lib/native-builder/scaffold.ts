/**
 * Deterministic greenfield scaffolding. Used when the Commander request matches a known
 * local-app pattern and the workspace is empty/new. Hosted coder can still generate other apps;
 * this path exists so Engineer can complete known local builds without a provider, honestly.
 */
import { createHash } from 'node:crypto'
import type { NativeIssueRecord, NativeRepairProposal } from './types'

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

const TASK_TRACKER_PACKAGE = `{
  "name": "task-tracker",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test test.mjs",
    "build": "node --check server.mjs && node --check app.mjs",
    "start": "node server.mjs"
  }
}
`

const TASK_TRACKER_APP = `import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export function createStore(persistPath) {
  /** @type {{ id: string, title: string, done: boolean }[]} */
  let tasks = []
  if (persistPath) {
    try { tasks = JSON.parse(readFileSync(persistPath, 'utf8')) } catch { tasks = [] }
  }
  function persist() {
    if (!persistPath) return
    mkdirSync(dirname(persistPath), { recursive: true })
    writeFileSync(persistPath, JSON.stringify(tasks, null, 2), 'utf8')
  }
  return {
    list() { return [...tasks] },
    create(title) {
      const task = { id: String(Date.now()) + Math.random().toString(16).slice(2), title: String(title), done: false }
      tasks = [...tasks, task]
      persist()
      return task
    },
    complete(id) {
      tasks = tasks.map(t => t.id === id ? { ...t, done: true } : t)
      persist()
      return tasks.find(t => t.id === id) ?? null
    },
    remove(id) {
      const before = tasks.length
      tasks = tasks.filter(t => t.id !== id)
      persist()
      return tasks.length !== before
    },
  }
}
`

const TASK_TRACKER_SERVER = `import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStore } from './app.mjs'

const persistPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'tasks.json')
const store = createStore(persistPath)
const PORT = Number(process.env.PORT || 18765)

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true })
  if (req.method === 'GET' && url.pathname === '/tasks') return json(res, 200, { tasks: store.list() })
  if (req.method === 'POST' && url.pathname === '/tasks') {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    return json(res, 201, { task: store.create(body.title || 'untitled') })
  }
  if (req.method === 'POST' && url.pathname.startsWith('/tasks/') && url.pathname.endsWith('/complete')) {
    const id = url.pathname.split('/')[2]
    const task = store.complete(id)
    return json(res, task ? 200 : 404, { task })
  }
  if (req.method === 'DELETE' && url.pathname.startsWith('/tasks/')) {
    const id = url.pathname.split('/')[2]
    return json(res, store.remove(id) ? 200 : 404, { ok: true })
  }
  json(res, 404, { error: 'not found' })
})

if (process.argv[1] && process.argv[1].endsWith('server.mjs')) {
  server.listen(PORT, '127.0.0.1', () => {
    console.log('task-tracker listening on ' + PORT)
  })
}
`

const TASK_TRACKER_TEST = `import test from 'node:test'
import assert from 'node:assert/strict'
import { createStore } from './app.mjs'

test('create, complete, and delete tasks', () => {
  const store = createStore()
  const created = store.create('Ship Engineer')
  assert.equal(created.title, 'Ship Engineer')
  assert.equal(created.done, false)
  const completed = store.complete(created.id)
  assert.equal(completed?.done, true)
  assert.equal(store.remove(created.id), true)
  assert.equal(store.list().length, 0)
})
`

export function isTaskTrackerRequest(text: string): boolean {
  const t = text.toLowerCase()
  return t.includes('task-tracker') || t.includes('task tracker') || (t.includes('create') && t.includes('complete') && t.includes('delete') && t.includes('task'))
}

export function isGreenfieldRequest(text: string): boolean {
  const t = text.toLowerCase()
  return isTaskTrackerRequest(text) || t.includes('from scratch') || t.includes('new project') || t.includes('build a') || t.includes('build me')
}

export function buildTaskTrackerProposal(issue: NativeIssueRecord): NativeRepairProposal {
  const files: Array<{ file: string; content: string; reason: string }> = [
    { file: 'package.json', content: TASK_TRACKER_PACKAGE, reason: 'Node package manifest with test/build/start scripts.' },
    { file: 'app.mjs', content: TASK_TRACKER_APP, reason: 'In-memory task store with create, complete, and delete.' },
    { file: 'server.mjs', content: TASK_TRACKER_SERVER, reason: 'Local HTTP API on 127.0.0.1:18765.' },
    { file: 'test.mjs', content: TASK_TRACKER_TEST, reason: 'node:test coverage for the store.' },
  ]
  return {
    issueId: issue.id,
    sourceKind: 'deterministic',
    proposerId: 'deterministic:task_tracker_scaffold',
    diagnosis: 'Empty workspace matching a local task-tracker request — scaffolding a Node HTTP app with tests.',
    confidence: 'high',
    relevantFiles: files.map(f => f.file),
    plannedChanges: files.map(f => ({
      file: f.file,
      reason: f.reason,
      operation: 'create_file' as const,
      patch: { operation: 'create_file' as const, file: f.file, newFileContent: f.content },
    })),
    validations: [
      { id: 'node_test' },
      { id: 'package_script', targets: ['build', 'npm'] },
    ],
    risks: ['Scaffold is a known local pattern, not a hosted-model novel design.'],
    rollbackPlan: 'Delete the created files via native-builder snapshots for this repair.',
    generatedAt: new Date().toISOString(),
  }
}

export function contentHash(text: string): string {
  return sha256(text)
}
