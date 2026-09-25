/**
 * Independent verifiers for Mission 13 FEATURE_EXTENSION V2/V3 and STATIC_WEB V1.
 * HTTP runtime for notes/tasks. File + Node runtime for the static site.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import http from 'node:http'
import { foundryNodeExecutable } from './foundryProjectIsolation'
import type {
  FoundryEngineeringBenchmark,
  FoundryGraduationCriterionResult,
  FoundryGraduationHiddenOracle,
  FoundryGraduationVerificationMethod,
} from './foundryEngineeringGraduationTypes'
import type { IndependentVerifyResult } from './foundryEngineeringGraduationVerifiers'

function row(criterionId: string, required: boolean, passed: boolean, method: FoundryGraduationVerificationMethod, detail: string): FoundryGraduationCriterionResult {
  return { criterionId, required, passed, method, detail }
}

function read(projectRoot: string, rel: string): string | null {
  const abs = path.join(projectRoot, rel)
  if (!existsSync(abs) || !statSync(abs).isFile()) return null
  return readFileSync(abs, 'utf8')
}

function nodeRun(projectRoot: string, args: string[], timeoutMs = 8000): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(foundryNodeExecutable(), args, { cwd: projectRoot, encoding: 'utf8', timeout: timeoutMs })
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' }
}

async function waitPort(childStdout: Promise<string>, timeoutMs = 4000): Promise<number> {
  const text = await Promise.race([
    childStdout,
    new Promise<string>(resolve => setTimeout(() => resolve(''), timeoutMs)),
  ])
  const match = /PORT=(\d+)/.exec(text)
  return match ? Number(match[1]) : 0
}

function startServer(projectRoot: string, file: string): { proc: ReturnType<typeof spawn>; stdout: Promise<string> } {
  const proc = spawn(foundryNodeExecutable(), [file], { cwd: projectRoot, env: { ...process.env, PORT: '0' } })
  let buf = ''
  const stdout = new Promise<string>(resolve => {
    proc.stdout?.on('data', chunk => {
      buf += String(chunk)
      if (buf.includes('PORT=')) resolve(buf)
    })
    proc.on('exit', () => resolve(buf))
  })
  return { proc, stdout }
}

async function httpJson(port: number, method: string, urlPath: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  return await new Promise(resolve => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: urlPath,
      headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {},
    }, res => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        let json: unknown = null
        try { json = data ? JSON.parse(data) : null } catch { json = data }
        resolve({ status: res.statusCode ?? 0, json })
      })
    })
    req.on('error', () => resolve({ status: 0, json: null }))
    if (payload) req.write(payload)
    req.end()
  })
}

export async function verifyFinalClassCoverage(input: {
  benchmark: FoundryEngineeringBenchmark
  projectRoot: string
  hidden: FoundryGraduationHiddenOracle | null
}): Promise<IndependentVerifyResult | null> {
  const { benchmark, projectRoot, hidden } = input
  const methods: FoundryGraduationVerificationMethod[] = ['FILE_INSPECT']
  const notes: string[] = []
  const forbiddenShortcutHits: string[] = []
  const criteria: FoundryGraduationCriterionResult[] = []
  const id = benchmark.benchmarkId

  if (id === 'GRAD-FX-FEATURE-V2') {
    methods.push('HTTP', 'JSON_PERSISTENCE', 'TEST_RUNNER', 'NODE_RUNTIME')
    const tests = existsSync(path.join(projectRoot, 'store.test.mjs')) ? nodeRun(projectRoot, ['--test', 'store.test.mjs']) : { status: 1, stdout: '', stderr: 'missing tests' }
    const testSrc = read(projectRoot, 'store.test.mjs') || ''
    const storeSrc = read(projectRoot, 'store.mjs') || ''
    const serverSrc = read(projectRoot, 'server.mjs') || ''
    if (!/addNote/.test(storeSrc) || !existsSync(path.join(projectRoot, 'store.mjs'))) forbiddenShortcutHits.push('rewrite as a new app')
    if (!/add appends/.test(testSrc)) forbiddenShortcutHits.push('delete existing tests')
    const title = String(hidden?.values.title ?? 'hidden-folio')
    const started = startServer(projectRoot, 'server.mjs')
    try {
      const port = await waitPort(started.stdout)
      const health = await httpJson(port, 'GET', '/health')
      const created = await httpJson(port, 'POST', '/notes', { title, body: 'keep-body' })
      const createdJson = created.json as { id?: string; title?: string } | null
      const listed = await httpJson(port, 'GET', '/notes')
      const list = Array.isArray(listed.json) ? listed.json as Array<{ id?: string; title?: string }> : []
      const archived = await httpJson(port, 'POST', '/notes/archive', { id: createdJson?.id })
      const activeAfter = await httpJson(port, 'GET', '/notes')
      const activeList = Array.isArray(activeAfter.json) ? activeAfter.json as Array<{ title?: string }> : []
      const archivedListRes = await httpJson(port, 'GET', '/notes?archived=1')
      const archivedList = Array.isArray(archivedListRes.json) ? archivedListRes.json as Array<{ title?: string }> : []
      const restored = await httpJson(port, 'POST', '/notes/restore', { id: createdJson?.id })
      const activeRestored = await httpJson(port, 'GET', '/notes')
      const restoredList = Array.isArray(activeRestored.json) ? activeRestored.json as Array<{ title?: string }> : []
      const disk = read(projectRoot, 'notes.json') || ''
      criteria.push(row('FY1', true, health.status === 200 && created.status === 201 && list.some(item => item.title === title), 'HTTP', `health=${health.status} create=${created.status}`))
      criteria.push(row('FY2', true, archived.status >= 200 && archived.status < 300 && !activeList.some(item => item.title === title), 'HTTP', JSON.stringify(activeList)))
      criteria.push(row('FY3', true, archivedList.some(item => item.title === title), 'HTTP', JSON.stringify(archivedList)))
      criteria.push(row('FY4', true, restored.status >= 200 && restored.status < 300 && restoredList.some(item => item.title === title) && disk.includes(title), 'JSON_PERSISTENCE', disk.slice(0, 120)))
      criteria.push(row('FY5', true, tests.status === 0 && /add appends/.test(testSrc), 'TEST_RUNNER', tests.stderr.slice(0, 80)))
    } finally {
      started.proc.kill('SIGTERM')
    }
    notes.push('feature-extension=notes-archive not inventory-cli')
    if (/fetch\(['\"]https?:/.test(serverSrc)) forbiddenShortcutHits.push('external backend')
    return { criteria, methods: [...new Set(methods)], forbiddenShortcutHits, notes, uiVerificationMethod: 'HTTP' }
  }

  if (id === 'GRAD-FZ-FEATURE-V3') {
    methods.push('HTTP', 'JSON_PERSISTENCE', 'TEST_RUNNER', 'NODE_RUNTIME')
    const tests = existsSync(path.join(projectRoot, 'store.test.mjs')) ? nodeRun(projectRoot, ['--test', 'store.test.mjs']) : { status: 1, stdout: '', stderr: 'missing tests' }
    const testSrc = read(projectRoot, 'store.test.mjs') || ''
    const storeSrc = read(projectRoot, 'store.mjs') || ''
    if (!/addTask/.test(storeSrc)) forbiddenShortcutHits.push('rewrite as a new app')
    if (!/add appends/.test(testSrc)) forbiddenShortcutHits.push('delete existing tests')
    const title = String(hidden?.values.title ?? 'hidden-rivet')
    const priority = Number(hidden?.values.priority ?? 4)
    const started = startServer(projectRoot, 'server.mjs')
    try {
      const port = await waitPort(started.stdout)
      const health = await httpJson(port, 'GET', '/health')
      const low = await httpJson(port, 'POST', '/tasks', { title: 'seed-low' })
      const high = await httpJson(port, 'POST', '/tasks', { title, priority })
      const highJson = high.json as { id?: string; title?: string; priority?: number } | null
      const listed = await httpJson(port, 'GET', '/tasks')
      const list = Array.isArray(listed.json) ? listed.json as Array<{ title?: string }> : []
      const filtered = await httpJson(port, 'GET', `/tasks?minPriority=${priority}`)
      const filteredList = Array.isArray(filtered.json) ? filtered.json as Array<{ title?: string; priority?: number }> : []
      const lowId = (low.json as { id?: string } | null)?.id
      const updated = await httpJson(port, 'POST', '/tasks/priority', { id: lowId, priority: 9 })
      const disk = read(projectRoot, 'tasks.json') || ''
      let diskTasks: Array<{ id?: string; priority?: number }> = []
      try { diskTasks = JSON.parse(disk) as Array<{ id?: string; priority?: number }> } catch { diskTasks = [] }
      criteria.push(row('FZ1', true, health.status === 200 && high.status === 201 && list.some(item => item.title === title), 'HTTP', `health=${health.status} create=${high.status}`))
      criteria.push(row('FZ2', true, Number(highJson?.priority) === priority && disk.includes(title), 'JSON_PERSISTENCE', JSON.stringify(highJson)))
      criteria.push(row('FZ3', true, filteredList.some(item => item.title === title) && filteredList.every(item => Number(item.priority) >= priority), 'HTTP', JSON.stringify(filteredList)))
      criteria.push(row('FZ4', true, updated.status >= 200 && updated.status < 300 && diskTasks.some(item => item.id === lowId && Number(item.priority) === 9), 'JSON_PERSISTENCE', disk.slice(0, 160)))
      criteria.push(row('FZ5', true, tests.status === 0 && /add appends/.test(testSrc), 'TEST_RUNNER', tests.stderr.slice(0, 80)))
    } finally {
      started.proc.kill('SIGTERM')
    }
    notes.push('feature-extension=tasks-priority not notes-archive')
    return { criteria, methods: [...new Set(methods)], forbiddenShortcutHits, notes, uiVerificationMethod: 'HTTP' }
  }

  if (id === 'GRAD-SW-STATIC-V1') {
    methods.push('DOM_PARSE', 'NODE_RUNTIME', 'TEST_RUNNER')
    const index = read(projectRoot, 'index.html') || ''
    const about = read(projectRoot, 'about.html') || ''
    const css = read(projectRoot, 'styles.css') || ''
    const app = read(projectRoot, 'app.js') || ''
    const tests = existsSync(path.join(projectRoot, 'site.test.mjs')) ? nodeRun(projectRoot, ['--test', 'site.test.mjs']) : { status: 1, stdout: '', stderr: 'missing tests' }
    const query = String(hidden?.values.query ?? 'forge')
    const match = String(hidden?.values.match ?? 'Forge consult')
    const url = pathToFileURL(path.join(projectRoot, 'app.js')).href
    const run = nodeRun(projectRoot, ['--input-type=module', '-e', `
import { applyFilter, SERVICES } from '${url}'
const found = applyFilter(SERVICES, ${JSON.stringify(query)})
console.log(JSON.stringify({ names: found.map(item => item.name), n: found.length }))
`])
    let parsed: { names?: string[]; n?: number } = {}
    try { parsed = JSON.parse(run.stdout.trim().split('\n').at(-1) || '{}') } catch { notes.push(run.stderr) }
    if (/fetch\s*\(|XMLHttpRequest|http\.createServer/.test(app) || existsSync(path.join(projectRoot, 'server.mjs'))) {
      forbiddenShortcutHits.push('custom backend')
    }
    const sections = ['intro', 'services', 'hours', 'contact'].every(idName => index.includes(`id="${idName}"`) || index.includes(`id='${idName}'`))
    criteria.push(row('SW1', true, /<nav[^>]*aria-label/.test(index) && /North Atelier/.test(index) && sections, 'DOM_PARSE', 'nav+sections'))
    criteria.push(row('SW2', true, /about\.html/.test(index) && /<h1/i.test(about) && /About/i.test(about), 'FILE_INSPECT', about.slice(0, 80)))
    criteria.push(row('SW3', true, /@media[^{]+\{/.test(css) && /max-width/.test(css), 'FILE_INSPECT', css.slice(0, 120)))
    criteria.push(row('SW4', true, Array.isArray(parsed.names) && parsed.names.includes(match) && parsed.n === 1, 'NODE_RUNTIME', JSON.stringify(parsed)))
    criteria.push(row('SW5', true, /localStorage/.test(app) && !/fetch\s*\(/.test(app) && !existsSync(path.join(projectRoot, 'server.mjs')), 'FILE_INSPECT', 'localStorage/no backend'))
    criteria.push(row('SW6', true, tests.status === 0, 'TEST_RUNNER', tests.stderr.slice(0, 80)))
    notes.push('static-web=html/css/js no custom backend')
    return { criteria, methods: [...new Set(methods)], forbiddenShortcutHits, notes, uiVerificationMethod: 'DOM_PARSE' }
  }

  return null
}
