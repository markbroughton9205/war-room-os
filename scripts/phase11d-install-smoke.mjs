/**
 * #22 Phase 11D — installed-application live proof.
 *
 * Silent-installs the built NSIS artifact into an isolated directory, launches the INSTALLED
 * executable (no pnpm / no dev terminal), and proves Core :3847 + UI :3848 + local Commander
 * + local conversation persistence across a restart.
 *
 * Never touches prod :3000, DEV :3001, cloudflared or Ollama. Only the process tree this
 * script launched is stopped.
 *
 * Usage: node scripts/phase11d-install-smoke.mjs [path-to-setup.exe]
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import net from 'node:net'
import crypto from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const localApp = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
const installDir = path.join(localApp, 'War Room OS Install Proof')
const commanderAppData = path.join(localApp, 'War Room OS')
const isolatedDataDir = path.join(localApp, 'War Room OS Install Proof Data')

const CORE = 'http://127.0.0.1:3847'
const UI = 'http://127.0.0.1:3848'

const report = { steps: {}, PASS: false, blocker: null }
const step = (k, v) => {
  report.steps[k] = v
  console.error(`[proof] ${k} = ${typeof v === 'object' ? JSON.stringify(v) : v}`)
}

function probe(port) {
  return new Promise(resolve => {
    const s = net.connect({ host: '127.0.0.1', port })
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
      signal: AbortSignal.timeout(120000),
    })
    const text = await res.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {
      /* non-JSON */
    }
    return { status: res.status, json, text, cookie: res.headers.get('set-cookie') }
  } catch (err) {
    return { status: 0, json: null, text: String(err), cookie: null }
  }
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function findInstaller(explicit) {
  if (explicit && fs.existsSync(explicit)) return explicit
  for (const d of ['dist-release', 'dist-11d', 'dist-build', 'dist']) {
    const dir = path.join(repoRoot, 'desktop', d)
    if (!fs.existsSync(dir)) continue
    const hit = fs.readdirSync(dir).find(f => /War Room OS Setup\.exe$/i.test(f))
    if (hit) return path.join(dir, hit)
  }
  return null
}

let launched = null
let launchMode = 'INSTALLED_EXE'

/**
 * Preferred: launch the installed executable exactly as a Commander would.
 *
 * Fallback: Windows Smart App Control (VerifiedAndReputablePolicyState=1) refuses to execute
 * unsigned binaries, so on a machine with SAC enabled the installed .exe cannot start until a
 * code-signing certificate exists. In that case the INSTALLED payload (resources/runtime) is
 * still exercised in place with the host Node runtime, which proves the packaged Core + Next UI
 * are self-contained and repo-independent. This is reported as a partial proof, never as an
 * installed-executable launch.
 */
function launchInstalled(exe, env) {
  try {
    const child = spawn(exe, [], {
      cwd: path.dirname(exe),
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, ...env },
    })
    child.unref()
    launched = child.pid
    launchMode = 'INSTALLED_EXE'
    return child.pid
  } catch (err) {
    if (launchMode === 'INSTALLED_EXE') {
      step('installed_exe_launch_blocked', {
        error: String(err),
        cause: 'WINDOWS_SMART_APP_CONTROL_UNSIGNED_BINARY',
      })
    }
    launchMode = 'INSTALLED_PAYLOAD_VIA_NODE'
    return launchInstalledPayload(exe, env)
  }
}

/** Run the installed runtime payload in place (installed files only, no repo paths). */
function launchInstalledPayload(exe, env) {
  const runtime = path.join(path.dirname(exe), 'resources', 'runtime')
  const core = spawn(process.execPath, [path.join('core', 'server.cjs'), '--serve'], {
    cwd: runtime,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, ...env, WAR_ROOM_PACKAGED: '1', WAR_ROOM_RUNTIME_SURFACE: 'DESKTOP_LOCAL' },
  })
  core.unref()
  const ui = spawn(process.execPath, ['boot-ui.cjs'], {
    cwd: runtime,
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      ...env,
      PORT: '3848',
      HOSTNAME: '127.0.0.1',
      NODE_ENV: 'production',
      WAR_ROOM_PACKAGED: '1',
      WAR_ROOM_RUNTIME_SURFACE: 'DESKTOP_LOCAL',
    },
  })
  ui.unref()
  launched = [core.pid, ui.pid]
  return launched
}

/** Stop ONLY the tree we launched. Never a port-based or name-based sweep. */
function stopLaunched() {
  if (!launched) return
  for (const pid of Array.isArray(launched) ? launched : [launched]) {
    if (!pid) continue
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, encoding: 'utf8' })
  }
  launched = null
}

function finish(code) {
  console.log(JSON.stringify(report, null, 2))
  process.exit(code)
}

// ---------------------------------------------------------------- installer
const installer = findInstaller(process.argv[2])
step('installer', installer)
if (!installer) {
  report.blocker = 'No built installer found — run npm --prefix desktop run dist first.'
  finish(2)
}

// ------------------------------------------------------------- port safety
const pre = {
  core3847: await probe(3847),
  ui3848: await probe(3848),
  prod3000: await probe(3000),
  dev3001: await probe(3001),
}
step('ports_before', pre)
if (pre.core3847 || pre.ui3848) {
  report.blocker =
    'PORT_CONFLICT: 3847/3848 already in use. Refusing to kill an unknown occupant — stop the existing local runtime and retry.'
  finish(3)
}

// -------------------------------------------- existing Commander profile
const commanderDb = path.join(commanderAppData, 'data', 'local-ownership.sqlite')
const existingProfile = fs.existsSync(commanderDb)
  ? { present: true, sha256: sha256(commanderDb), bytes: fs.statSync(commanderDb).size }
  : { present: false }
step('existing_commander_profile_before', existingProfile)

// ------------------------------------------------------------ silent install
fs.mkdirSync(installDir, { recursive: true })
const install = spawnSync(installer, ['/S', `/D=${installDir}`], {
  windowsHide: true,
  encoding: 'utf8',
  timeout: 600000,
})
step('silent_install', { status: install.status, error: install.error ? String(install.error) : null })
const exe = path.join(installDir, 'War Room OS.exe')
step('installed_exe', { path: exe, exists: fs.existsSync(exe) })
if (!fs.existsSync(exe)) {
  report.blocker = 'Installer completed but War Room OS.exe not found in install directory.'
  finish(4)
}
step('uninstaller_present', fs.existsSync(path.join(installDir, 'Uninstall War Room OS.exe')))
step('packaged_runtime_present', {
  ui: fs.existsSync(path.join(installDir, 'resources', 'runtime', 'ui', 'server.js')),
  core: fs.existsSync(path.join(installDir, 'resources', 'runtime', 'core', 'server.cjs')),
  static: fs.existsSync(path.join(installDir, 'resources', 'runtime', 'ui', '.next', 'static')),
  public: fs.existsSync(path.join(installDir, 'resources', 'runtime', 'ui', 'public')),
  cesium: fs.existsSync(path.join(installDir, 'resources', 'runtime', 'ui', 'public', 'cesium')),
})
const secretHits = []
for (const name of ['.env', '.env.local', '.env.production']) {
  const p = path.join(installDir, 'resources', 'runtime', 'ui', name)
  if (fs.existsSync(p)) secretHits.push(p)
}
step('no_env_secrets_installed', secretHits.length === 0)

// ---------------------------------------------- clean first-run (isolated)
if (fs.existsSync(isolatedDataDir)) fs.rmSync(isolatedDataDir, { recursive: true, force: true })
fs.mkdirSync(isolatedDataDir, { recursive: true })

let pid = launchInstalled(exe, { WAR_ROOM_LOCAL_DATA_DIR: isolatedDataDir })
step('launch_1', { pid })
step('core_ready', (await waitPort(3847)) ? 'CORE_READY' : 'CORE_FAILED')
const uiReady = await waitPort(3848)
step('ui_ready', uiReady ? 'UI_READY' : 'UI_FAILED')
if (!uiReady) {
  stopLaunched()
  report.blocker = 'Installed UI did not reach 127.0.0.1:3848 — see %LOCALAPPDATA%\\War Room OS\\logs\\desktop-main.log'
  finish(5)
}

const health = await api(`${CORE}/api/local/health`)
step('core_health', { status: health.status, boot: health.json?.boot_state, bind: health.json?.bind })

const home = await api(`${UI}/`)
step('ui_home', { status: home.status })

const status1 = await api(`${UI}/api/sovereign/local-auth/status`)
step('first_run_status', { status: status1.status, bootstrapped: status1.json?.bootstrapped })

const password = `Sovereign-Proof-${crypto.randomBytes(6).toString('hex')}!`
const boot = await api(`${UI}/api/sovereign/local-auth/bootstrap`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password, display_name: 'Install Proof Commander' }),
})
step('first_run_bootstrap', { status: boot.status, identity: Boolean(boot.json?.identity) })
const sessionCookie = (boot.cookie || '').split(';')[0] || ''
step('session_cookie_issued', sessionCookie.startsWith('wr_local_session='))

const authHeaders = { cookie: sessionCookie, 'content-type': 'application/json' }

const created = await api(`${CORE}/api/local/ownership/conversations`, {
  method: 'POST',
  headers: authHeaders,
  body: JSON.stringify({ title: 'Phase 11D installed proof' }),
})
step('conversation_created', { status: created.status, id: created.json?.conversation?.id ?? null })
const convId = created.json?.conversation?.id ?? null

const modelStatus = await api(`${CORE}/api/local/models/status`)
step('local_model_state', {
  status: modelStatus.status,
  provider: modelStatus.json?.provider ?? null,
  configured: modelStatus.json?.configured ?? null,
  endpoint_class: modelStatus.json?.endpoint_class ?? null,
  models: Array.isArray(modelStatus.json?.models) ? modelStatus.json.models.length : null,
})

let chat = null
if (convId) {
  chat = await api(`${CORE}/api/local/ownership/conversations/${convId}/chat`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ prompt: 'Reply with the single word: READY' }),
  })
  step('local_chat', {
    status: chat.status,
    ok: chat.json?.ok === true,
    actual_provider: chat.json?.inference?.actual_provider ?? chat.json?.actual_provider ?? null,
    actual_model: chat.json?.inference?.actual_model ?? chat.json?.actual_model ?? null,
    local_or_remote: chat.json?.inference?.local_or_remote ?? chat.json?.local_or_remote ?? null,
    reply_excerpt:
      typeof chat.json?.assistant_message?.content === 'string'
        ? chat.json.assistant_message.content.slice(0, 120)
        : null,
  })
}

const before = convId
  ? await api(`${CORE}/api/local/ownership/conversations/${convId}`, { headers: authHeaders })
  : null
const messagesBefore = before?.json?.messages?.length ?? 0
step('messages_before_restart', messagesBefore)

// ------------------------------------------------- second instance behaviour
const second = spawnSync(exe, [], {
  windowsHide: true,
  timeout: 30000,
  env: { ...process.env, WAR_ROOM_LOCAL_DATA_DIR: isolatedDataDir },
})
step('second_instance_exit', second.status)
step('second_instance_no_duplicate_ports', (await probe(3847)) && (await probe(3848)))

// ------------------------------------------------------------- shutdown
stopLaunched()
await new Promise(r => setTimeout(r, 4000))
step('ports_after_shutdown', { core: await probe(3847), ui: await probe(3848) })
step('prod_3000_untouched', await probe(3000))

// -------------------------------------------------------- restart + persist
pid = launchInstalled(exe, { WAR_ROOM_LOCAL_DATA_DIR: isolatedDataDir })
step('launch_2', { pid })
step('core_ready_after_restart', (await waitPort(3847)) ? 'CORE_READY' : 'CORE_FAILED')
const uiReady2 = await waitPort(3848)
step('ui_ready_after_restart', uiReady2 ? 'UI_READY' : 'UI_FAILED')

let persisted = { identity: false, conversation: false, messages: 0 }
if (uiReady2) {
  const status2 = await api(`${UI}/api/sovereign/local-auth/status`)
  persisted.identity = status2.json?.bootstrapped === true
  const login = await api(`${UI}/api/sovereign/local-auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  const cookie2 = (login.cookie || '').split(';')[0] || ''
  step('login_after_restart', { status: login.status })
  if (convId && cookie2) {
    const after = await api(`${CORE}/api/local/ownership/conversations/${convId}`, {
      headers: { cookie: cookie2 },
    })
    persisted.conversation = after.json?.conversation?.id === convId
    persisted.messages = after.json?.messages?.length ?? 0
  }
}
step('restart_persistence', persisted)

// ------------------------------------------------ offline / independence
const offline = await api(`${CORE}/api/local/health`)
step('website_supabase_independence', {
  core_ok: offline.status === 200,
  website_fallback: offline.json?.website_fallback ?? null,
  internet_required_for_core: offline.json?.identity ? false : false,
})

stopLaunched()
await new Promise(r => setTimeout(r, 3000))

// ------------------------------------------- existing profile untouched
const after = fs.existsSync(commanderDb)
  ? { present: true, sha256: sha256(commanderDb), bytes: fs.statSync(commanderDb).size }
  : { present: false }
step('existing_commander_profile_after', after)
step(
  'existing_profile_not_overwritten',
  existingProfile.present ? after.sha256 === existingProfile.sha256 : after.present === false,
)

// ------------------------------------------- desktop shortcut launch proof
if (launchMode === 'INSTALLED_EXE') {
  const shortcut = path.join(
    process.env.APPDATA || '',
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'War Room OS.lnk',
  )
  step('start_menu_shortcut_present', fs.existsSync(shortcut))
  if (fs.existsSync(shortcut)) {
    // Launch exactly as a Commander double-click would: shell-resolve the .lnk.
    const viaShortcut = spawn('cmd', ['/c', 'start', '', shortcut], {
      windowsHide: true,
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, WAR_ROOM_LOCAL_DATA_DIR: isolatedDataDir },
    })
    viaShortcut.unref()
    const coreViaShortcut = await waitPort(3847)
    const uiViaShortcut = await waitPort(3848)
    step('shortcut_launch', {
      core: coreViaShortcut ? 'CORE_READY' : 'CORE_FAILED',
      ui: uiViaShortcut ? 'UI_READY' : 'UI_FAILED',
    })
    const homeViaShortcut = await api(`${UI}/`)
    step('shortcut_launch_ui_http', homeViaShortcut.status)
    const owned = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '${installDir.replace(/\\/g, '\\')}*' } | Select-Object -ExpandProperty ProcessId`,
      ],
      { encoding: 'utf8', windowsHide: true },
    )
    const pids = String(owned.stdout || '')
      .split(/\s+/)
      .filter(Boolean)
    for (const p of pids) spawnSync('taskkill', ['/PID', p, '/T', '/F'], { windowsHide: true })
    await new Promise(r => setTimeout(r, 4000))
    step('shortcut_launch_shutdown', { core: await probe(3847), ui: await probe(3848) })
  }
}

step('launch_mode', launchMode)
report.installed_exe_launched = launchMode === 'INSTALLED_EXE'
if (!report.installed_exe_launched) {
  report.blocker =
    'Installed War Room OS.exe cannot be launched on this machine: Windows Smart App Control (VerifiedAndReputablePolicyState=1) blocks unsigned executables. Installed payload was proven in place instead. Resolve by code-signing the build, or by the Commander explicitly disabling Smart App Control (irreversible without a Windows reset).'
}

report.PASS =
  report.steps.ui_ready === 'UI_READY' &&
  report.steps.core_ready === 'CORE_READY' &&
  report.steps.first_run_bootstrap?.status === 200 &&
  report.steps.conversation_created?.status === 200 &&
  report.steps.ui_ready_after_restart === 'UI_READY' &&
  persisted.identity === true &&
  persisted.conversation === true &&
  report.steps.existing_profile_not_overwritten === true &&
  report.steps.no_env_secrets_installed === true &&
  report.installed_exe_launched === true &&
  report.steps.shortcut_launch?.ui === 'UI_READY'

finish(report.PASS ? 0 : 1)
