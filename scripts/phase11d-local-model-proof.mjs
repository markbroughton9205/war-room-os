/**
 * #22 Phase 11D — live local-model proof against the INSTALLED payload.
 *
 * Starts the installed Core + Next UI from the installed directory only, authenticates a local
 * Commander in an isolated data dir, and sends one harmless prompt through the canonical Phase 11B
 * local model route. Reports the real Ollama state — never claims a model reply that did not happen.
 *
 * Usage: node scripts/phase11d-local-model-proof.mjs [installDir]
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import net from 'node:net'
import crypto from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'

const localApp = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
const installDir = process.argv[2] || path.join(localApp, 'War Room OS Install Proof')
const runtime = path.join(installDir, 'resources', 'runtime')
const dataDir = path.join(localApp, 'War Room OS Model Proof Data')
const CORE = 'http://127.0.0.1:3847'
const UI = 'http://127.0.0.1:3848'

const out = { installDir, steps: {}, PASS: false }
const step = (k, v) => {
  out.steps[k] = v
  console.error(`[model-proof] ${k} = ${typeof v === 'object' ? JSON.stringify(v) : v}`)
}

function probe(port, host = '127.0.0.1') {
  return new Promise(resolve => {
    const s = net.connect({ host, port })
    const done = v => {
      s.removeAllListeners()
      s.destroy()
      resolve(v)
    }
    s.setTimeout(500)
    s.once('connect', () => done(true))
    s.once('timeout', () => done(false))
    s.once('error', () => done(false))
  })
}

async function waitPort(port, ms = 120000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (await probe(port)) return true
    await new Promise(r => setTimeout(r, 500))
  }
  return false
}

async function api(url, init = {}) {
  try {
    const res = await fetch(url, {
      ...init,
      redirect: 'manual',
      headers: { origin: UI, ...(init.headers || {}) },
      signal: AbortSignal.timeout(300000),
    })
    const text = await res.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {
      /* ignore */
    }
    return { status: res.status, json, text, cookie: res.headers.get('set-cookie') }
  } catch (err) {
    return { status: 0, json: null, text: String(err), cookie: null }
  }
}

const kids = []
function stopAll() {
  for (const pid of kids) {
    if (pid) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
  }
}
function finish(code) {
  stopAll()
  console.log(JSON.stringify(out, null, 2))
  process.exit(code)
}

if (!fs.existsSync(path.join(runtime, 'boot-ui.cjs'))) {
  step('installed_runtime', 'MISSING')
  finish(2)
}
step('installed_runtime', runtime)

if ((await probe(3847)) || (await probe(3848))) {
  step('ports', 'PORT_CONFLICT — refusing to kill occupant')
  finish(3)
}
step('ollama_daemon', (await probe(11434)) ? 'RUNNING' : 'STOPPED')

fs.mkdirSync(dataDir, { recursive: true })
const env = {
  ...process.env,
  WAR_ROOM_LOCAL_DATA_DIR: dataDir,
  WAR_ROOM_PACKAGED: '1',
  WAR_ROOM_RUNTIME_SURFACE: 'DESKTOP_LOCAL',
}
const core = spawn(process.execPath, [path.join('core', 'server.cjs'), '--serve'], {
  cwd: runtime,
  detached: true,
  stdio: 'ignore',
  env,
})
core.unref()
kids.push(core.pid)
const ui = spawn(process.execPath, ['boot-ui.cjs'], {
  cwd: runtime,
  detached: true,
  stdio: 'ignore',
  env: { ...env, PORT: '3848', HOSTNAME: '127.0.0.1', NODE_ENV: 'production' },
})
ui.unref()
kids.push(ui.pid)

step('core_ready', (await waitPort(3847)) ? 'CORE_READY' : 'CORE_FAILED')
step('ui_ready', (await waitPort(3848)) ? 'UI_READY' : 'UI_FAILED')

const discovery = await api(`${CORE}/api/local/models/status`)
step('local_model_discovery', {
  status: discovery.status,
  provider: discovery.json?.provider ?? null,
  configured: discovery.json?.configured ?? null,
  endpoint_class: discovery.json?.endpoint_class ?? null,
  runtime_state: discovery.json?.runtime_state ?? discovery.json?.state ?? null,
  models: Array.isArray(discovery.json?.models) ? discovery.json.models.length : null,
})

const status = await api(`${UI}/api/sovereign/local-auth/status`)
let cookie = ''
const password = `Sovereign-Model-${crypto.randomBytes(6).toString('hex')}!`
if (status.json?.bootstrapped) {
  step('profile', 'EXISTING_ISOLATED_PROFILE — cannot log in without its password')
  finish(4)
} else {
  const boot = await api(`${UI}/api/sovereign/local-auth/bootstrap`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password, display_name: 'Model Proof Commander' }),
  })
  step('bootstrap', boot.status)
  cookie = (boot.cookie || '').split(';')[0] || ''
}

const conv = await api(`${CORE}/api/local/ownership/conversations`, {
  method: 'POST',
  headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify({ title: 'Phase 11D local model proof' }),
})
const convId = conv.json?.conversation?.id ?? null
step('conversation', { status: conv.status, id: convId })

const chat = await api(`${CORE}/api/local/ownership/conversations/${convId}/chat`, {
  method: 'POST',
  headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify({ prompt: 'Reply with exactly one word: READY' }),
})
step('chat', {
  status: chat.status,
  ok: chat.json?.ok === true,
  actual_provider: chat.json?.inference?.actual_provider ?? chat.json?.actual_provider ?? null,
  actual_model: chat.json?.inference?.actual_model ?? chat.json?.actual_model ?? null,
  result_status: chat.json?.inference?.result_status ?? chat.json?.result_status ?? null,
  local_or_remote: chat.json?.inference?.local_or_remote ?? chat.json?.local_or_remote ?? null,
})
const reply =
  chat.json?.assistant_message?.content ??
  chat.json?.message?.content ??
  chat.json?.inference?.text ??
  chat.json?.text ??
  null
step('assistant_reply_excerpt', typeof reply === 'string' ? reply.slice(0, 200) : null)

const read = await api(`${CORE}/api/local/ownership/conversations/${convId}`, { headers: { cookie } })
step('messages_persisted', read.json?.messages?.length ?? 0)

out.PASS =
  out.steps.core_ready === 'CORE_READY' &&
  out.steps.ui_ready === 'UI_READY' &&
  out.steps.chat?.status === 200 &&
  (out.steps.messages_persisted ?? 0) >= 2

finish(out.PASS ? 0 : 1)
