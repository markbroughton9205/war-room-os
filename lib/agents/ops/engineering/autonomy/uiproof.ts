import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { trackChild } from '../runtime/activity'
import { SandboxUnavailable, wrapSandboxed } from '../runtime/sandbox'
import type { UiProofResult } from './controller'
import type { CommandRecord, UiProofStep } from './types'

/**
 * UI proof: the delivered build is started from its own installation directory (the packaged runtime in node mode, on a free loopback port, with a private data directory and a private
 * trust secret) and driven in a real Chrome with real input events (CDP Input.dispatchMouseEvent: the browser itself turns them into pointer events, hit-testing included).
 * Nothing here touches the Commander's running War Room: other port, other data directory, other browser profile.
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const freePort = () => new Promise<number>((resolve, reject) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)) }); s.on('error', reject) })

export type CdpPage = {
  send: (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>
  eval: <T = unknown>(expr: string) => Promise<T>
  close: () => void
}

/** CDP over a pipe (--remote-debugging-pipe): there is no TCP debugging port for sandboxed app code to find. Messages are NUL-terminated JSON on fds 3 (to Chrome) and 4 (from Chrome). */
function connectPipe(chrome: ChildProcess): CdpPage & { ready: Promise<void> } {
  const toChrome = chrome.stdio[3] as import('node:stream').Writable, fromChrome = chrome.stdio[4] as import('node:stream').Readable
  let id = 0, buf = '', sessionId = ''
  const pending = new Map<number, { res: (r: Record<string, unknown>) => void; rej: (e: Error) => void }>()
  const failAll = (why: string) => { for (const [, p] of pending) p.rej(new Error(why)); pending.clear() }
  fromChrome.on('data', (d: Buffer) => {
    buf += d.toString('utf8')
    let i: number
    while ((i = buf.indexOf('\0')) >= 0) {
      const raw = buf.slice(0, i); buf = buf.slice(i + 1)
      let m: { id?: number; result?: Record<string, unknown>; error?: unknown }
      try { m = JSON.parse(raw) } catch { continue }
      if (m.id && pending.has(m.id)) { const p = pending.get(m.id)!; pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error).slice(0, 300))) : p.res(m.result ?? {}) }
    }
  })
  toChrome.on('error', () => failAll('the browser pipe failed')) // a write after Chrome died is an async EPIPE; unhandled it would take the server down
  fromChrome.on('close', () => failAll('the browser closed')); fromChrome.on('error', () => failAll('the browser pipe failed')); chrome.once('exit', () => failAll('the browser exited'))
  const raw = (method: string, params: Record<string, unknown>, sid?: string) => new Promise<Record<string, unknown>>((res, rej) => {
    const i = ++id; pending.set(i, { res, rej })
    const t = setTimeout(() => { if (pending.delete(i)) rej(new Error(`${method} timed out`)) }, 60_000); t.unref?.()
    try { toChrome.write(JSON.stringify({ id: i, method, params, ...(sid ? { sessionId: sid } : {}) }) + '\0') } catch (e) { pending.delete(i); rej(e instanceof Error ? e : new Error('write failed')) }
  })
  const send: CdpPage['send'] = (method, params = {}) => raw(method, params, sessionId || undefined)
  const ready = (async () => {
    const t = (await raw('Target.createTarget', { url: 'about:blank' })) as { targetId: string }
    const a = (await raw('Target.attachToTarget', { targetId: t.targetId, flatten: true })) as { sessionId: string }
    sessionId = a.sessionId
    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable')
  })()
  return {
    ready, send,
    async eval<T>(expr: string) { const r = (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })) as { result?: { value?: T }; exceptionDetails?: { exception?: { description?: string } } }; if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'evaluation failed'); return r.result?.value as T },
    close() { failAll('closed'); try { toChrome.destroy() } catch { /* closed */ } try { fromChrome.destroy() } catch { /* closed */ } },
  }
}

export type ServerHandle = { origin: string; port: number; secret: string; stop: () => Promise<void>; log: () => string }
/** Starts an installed build's UI server in node mode on a private port and data directory. */
export async function bootInstalledServer(installPath: string, dataDir: string, readyMs = 120_000): Promise<ServerHandle> {
  const app = path.join(installPath, 'opt', 'War-Room-OS')
  const exe = path.join(app, 'war-room-os')
  const rt = path.join(app, 'resources', 'runtime')
  if (!existsSync(exe) || !existsSync(path.join(rt, 'boot-ui.cjs'))) throw new Error(`not an installed War Room build: ${installPath}`)
  mkdirSync(dataDir, { recursive: true })
  const port = await freePort()
  const secret = randomBytes(32).toString('hex')
  // the freshly built app contains model-written code: it runs inside the OS sandbox (read-only host, empty HOME, writable private data directory only). Loopback is shared so the browser can reach it.
  let argv = [exe, 'boot-ui.cjs']
  try { argv = wrapSandboxed(argv, { rw: [dataDir], ro: [installPath], net: true, cwd: rt }).argv } catch (e) { if (e instanceof SandboxUnavailable) throw new Error(`refusing to run a freshly built app unsandboxed: ${e.message}`); throw e }
  const child: ChildProcess = spawn(argv[0], argv.slice(1), {
    cwd: rt, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: os.homedir(), ELECTRON_RUN_AS_NODE: '1', PORT: String(port), HOSTNAME: '127.0.0.1', WAR_ROOM_RUNTIME_SURFACE: 'DESKTOP_LOCAL', WAR_ROOM_PACKAGED: '1', NODE_ENV: 'production', WAR_ROOM_LOCAL_DATA_DIR: dataDir, WAR_ROOM_AGENT_FOUNDRY_DIR: path.join(dataDir, 'data', 'agent-foundry'), WAR_ROOM_DESKTOP_TRUST_SECRET: secret, WAR_ROOM_ENG_SUPERVISOR: 'off' },
  })
  trackChild(child, 'installed build server (UI proof)')
  let buf = ''
  child.stdout?.on('data', (d) => { buf += String(d) }); child.stderr?.on('data', (d) => { buf += String(d) })
  const origin = `http://127.0.0.1:${port}`
  const deadline = Date.now() + readyMs
  for (;;) {
    if (child.exitCode !== null) throw new Error(`the installed build exited early (${child.exitCode}): ${buf.slice(-400)}`)
    try { const r = await fetch(origin + '/', { signal: AbortSignal.timeout(1500), redirect: 'manual' }); void r; break } catch { if (Date.now() > deadline) { try { process.kill(-child.pid!, 'SIGKILL') } catch { /* gone */ } throw new Error('the installed build did not become ready') } await sleep(400) }
  }
  const stop = () => new Promise<void>((resolve) => { if (child.exitCode !== null || child.signalCode !== null) return resolve(); child.once('exit', () => resolve()); try { process.kill(-child.pid!, 'SIGTERM') } catch { /* gone */ } setTimeout(() => { try { process.kill(-child.pid!, 'SIGKILL') } catch { /* gone */ } }, 3000) })
  return { origin, port, secret, stop, log: () => buf.slice(-3000) }
}

/** The trusted-desktop session exactly as the Electron main mints it (secret + the origin the local policy knows). */
export async function mintSession(h: ServerHandle): Promise<string> {
  const r = await fetch(h.origin + '/api/sovereign/local-auth/trusted-desktop', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3848', 'x-war-room-desktop-trust': h.secret }, body: '{}' })
  const j = (await r.json().catch(() => null)) as { ok?: boolean; session_token?: string } | null
  if (!j?.ok || !j.session_token) throw new Error(`could not mint a trusted-desktop session (HTTP ${r.status})`)
  return j.session_token
}

async function launchChrome(): Promise<{ page: CdpPage; stop: () => void }> {
  const profile = mkdtempSync(path.join(os.tmpdir(), 'wr-proof-'))
  const bin = ['google-chrome', 'chromium', 'chromium-browser'].find((b) => existsSync(`/usr/bin/${b}`)) ?? 'google-chrome'
  const chrome = spawn(bin, ['--headless=new', '--remote-debugging-pipe', `--user-data-dir=${profile}`, '--window-size=1400,900', '--no-first-run', '--disable-gpu', '--force-device-scale-factor=1', '--blink-settings=primaryPointerType=4,availablePointerTypes=4,primaryHoverType=4,availableHoverTypes=4', 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], detached: true })
  trackChild(chrome, 'headless Chrome (UI proof)')
  const kill = () => { try { process.kill(-chrome.pid!, 'SIGKILL') } catch { /* gone */ } try { rmSync(profile, { recursive: true, force: true }) } catch { /* best effort */ } }
  try {
    const page = connectPipe(chrome)
    await page.ready
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false })
    return { page, stop: () => { page.close(); kill() } }
  } catch (e) { kill(); throw e }
}

const FIXTURE = `(() => {
  document.getElementById('__wr_proof')?.remove()
  const box = document.createElement('div'); box.id = '__wr_proof'
  box.style.cssText = 'position:fixed;left:40px;top:520px;width:560px;z-index:2147482000;background:#fff;color:#000;padding:10px;font:16px sans-serif;border:2px solid #333'
  box.innerHTML = '<button id="__wr_proof_btn" style="padding:8px 14px;font-size:16px">proof button</button> clicks: <b id="__wr_proof_count">0</b><p id="__wr_proof_text" style="margin:12px 0">Select this sentence with the mouse to prove text selection still works.</p><div id="__wr_proof_drag" style="width:70px;height:40px;background:#c33;color:#fff;display:flex;align-items:center;justify-content:center;user-select:none">drag</div><span id="__wr_proof_drag_out">0</span>'
  document.body.appendChild(box)
  let n = 0; document.getElementById('__wr_proof_btn').addEventListener('click', () => { n++; document.getElementById('__wr_proof_count').textContent = String(n) })
  const h = document.getElementById('__wr_proof_drag'); let start = null
  h.addEventListener('pointerdown', (e) => { start = { x: e.clientX, y: e.clientY } })
  window.addEventListener('pointermove', (e) => { if (start) document.getElementById('__wr_proof_drag_out').textContent = String(Math.round(Math.hypot(e.clientX - start.x, e.clientY - start.y))) })
  window.addEventListener('pointerup', () => { start = null })
  const r = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height } }
  return { btn: r('__wr_proof_btn'), text: r('__wr_proof_text'), drag: r('__wr_proof_drag') }
})()`

type Rect = { x: number; y: number; w: number; h: number }

export async function runProofSpec(base: string, session: string, steps: UiProofStep[], outDir: string, originalPoint: { x: number; y: number } = { x: 0, y: 0 }): Promise<UiProofResult> {
  void originalPoint
  mkdirSync(outDir, { recursive: true })
  const results: UiProofResult['steps'] = []
  const rec = (label: string, ok: boolean, detail: string) => results.push({ label, ok, detail: detail.slice(0, 300) })
  const { page, stop } = await launchChrome()
  const consoleErrors: string[] = []
  try {
    await page.send('Network.setCookie', { name: 'wr_local_session', value: session, domain: '127.0.0.1', path: '/', httpOnly: true })
    const deadline = Date.now() + 10 * 60_000 // a proof that cannot finish is a failed proof, not a stuck command
    let down = false
    const mouse = async (type: 'mouseMoved' | 'mousePressed' | 'mouseReleased', x: number, y: number) => {
      if (type === 'mousePressed') down = true
      await page.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !down ? 'none' : 'left', buttons: type === 'mouseReleased' || (type === 'mouseMoved' && !down) ? 0 : 1, clickCount: type === 'mouseMoved' ? 0 : 1 })
      if (type === 'mouseReleased') down = false
    }
    const moveTo = async (x: number, y: number, steps = 6, from = { x: 5, y: 5 }) => { for (let i = 1; i <= steps; i++) { await mouse('mouseMoved', from.x + ((x - from.x) * i) / steps, from.y + ((y - from.y) * i) / steps); await sleep(15) } }
    type Rects = { btn: Rect; text: Rect; drag: Rect }
    let rects = null as Rects | null
    let pointer = { x: 5, y: 5 }
    const shot = async (name: string) => { const r = (await page.send('Page.captureScreenshot', { format: 'png' })) as { data: string }; writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(r.data, 'base64')) }
    const center = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })
    for (const s of steps) {
      if (Date.now() > deadline) { rec('proof deadline', false, 'the proof did not finish within 10 minutes'); break }
      try {
        switch (s.do) {
          case 'goto': {
            await page.send('Page.navigate', { url: base + s.path })
            let ok = false
            for (let i = 0; i < 40; i++) { await sleep(500); if (await page.eval<boolean>(`document.readyState === 'complete' && !!document.body && document.body.innerText.length > 20`).catch(() => false)) { ok = true; break } }
            await sleep(2500) // hydration
            const bad = ok ? await page.eval<string>(`(document.body.innerText.match(/Application error|Internal Server Error|This page could not be found|404|Unhandled Runtime Error/) || [''])[0]`).catch(() => '') : ''
            rec(`load ${s.path}`, ok && !bad, !ok ? 'the page did not render' : bad ? `the page shows an error ("${bad}")` : 'the page rendered without an error message')
            break
          }
          case 'inject-fixture': rects = await page.eval<Rects>(FIXTURE); rec('proof fixture (button, sentence, drag handle) placed on the page', !!rects, 'a plain button, a sentence and a drag handle are used to check that normal interaction still works'); break
          case 'expect': { const n = await page.eval<number>(`document.querySelectorAll(${JSON.stringify(s.selector)}).length`); rec(s.label, s.present ? n > 0 : n === 0, `${n} element(s) match ${s.selector}`); break }
          case 'move': await moveTo(s.x, s.y, 6, pointer); pointer = { x: s.x, y: s.y }; break
          case 'expect-follows': {
            await sleep(200)
            // the element itself, or the glyph inside it: a full-viewport pointer-events:none wrapper that carries the test id and holds a small ship is a legitimate layout
            const r = await page.eval<{ x: number; y: number; of: string } | null>(`(() => { const e = document.querySelector(${JSON.stringify(s.selector)}); if (!e) return null; const vw = innerWidth * innerHeight; const cands = [e, ...e.querySelectorAll('*')].map((n) => { const b = n.getBoundingClientRect(); return { n, x: b.left + b.width / 2, y: b.top + b.height / 2, area: b.width * b.height } }).filter((c) => c.area > 0 && c.area < vw * 0.5); if (!cands.length) { const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, of: e.tagName } } cands.sort((a, b) => Math.hypot(a.x - ${s.x}, a.y - ${s.y}) - Math.hypot(b.x - ${s.x}, b.y - ${s.y})); const c = cands[0]; return { x: c.x, y: c.y, of: c.n.tagName.toLowerCase() } })()`)
            const d = r ? Math.hypot(r.x - s.x, r.y - s.y) : Infinity
            rec(s.label, d <= s.tolerance, r ? `ship (${r.of}) centre at (${Math.round(r.x)}, ${Math.round(r.y)}), pointer at (${s.x}, ${s.y}), distance ${Math.round(d)} px` : 'the ship element does not exist'); break
          }
          case 'click-xy': await mouse('mousePressed', s.x, s.y); await sleep(60); await mouse('mouseReleased', s.x, s.y); break
          case 'wait': await sleep(s.ms); break
          case 'expect-count': {
            const deadline = Date.now() + (s.waitMs ?? 0); let n = 0
            for (;;) { n = await page.eval<number>(`document.querySelectorAll(${JSON.stringify(s.selector)}).length`); const ok = n >= s.min && (s.max === undefined || n <= s.max); if (ok || Date.now() >= deadline) break; await sleep(80) }
            rec(s.label, n >= s.min && (s.max === undefined || n <= s.max), `${n} element(s) match ${s.selector}`); break
          }
          case 'click-selector': {
            const r = await page.eval<Rect | null>(`(() => { const e = document.querySelector(${JSON.stringify(s.selector)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height } })()`)
            if (!r) { rec(s.label, false, `no element matches ${s.selector}`); break }
            const c = center(r); await moveTo(c.x, c.y, 6, pointer); pointer = c; await mouse('mousePressed', c.x, c.y); await sleep(60); await mouse('mouseReleased', c.x, c.y); await sleep(400); rec(s.label, true, `clicked ${s.selector} at (${Math.round(c.x)}, ${Math.round(c.y)})`); break
          }
          case 'fixture-click-works': {
            if (!rects) { rec('normal clicking works', false, 'no fixture'); break }
            const c = center(rects.btn); await moveTo(c.x, c.y, 5, pointer); pointer = c
            const hit = await page.eval<string>(`document.elementFromPoint(${c.x}, ${c.y})?.id ?? ''`)
            await mouse('mousePressed', c.x, c.y); await sleep(50); await mouse('mouseReleased', c.x, c.y); await sleep(200)
            const n = await page.eval<string>(`document.getElementById('__wr_proof_count').textContent`)
            rec('normal clicking still works under the new cursor', n === '1' && hit === '__wr_proof_btn', `the click reached the page button (count ${n}); the element under the pointer is #${hit}`); break
          }
          case 'fixture-drag-selects': {
            if (!rects) { rec('text selection works', false, 'no fixture'); break }
            const t = rects.text; const y = t.y + t.h / 2
            await moveTo(t.x + 4, y, 4, pointer); await mouse('mousePressed', t.x + 4, y); await sleep(40)
            for (let i = 1; i <= 8; i++) { await mouse('mouseMoved', t.x + 4 + ((t.w - 40) * i) / 8, y); await sleep(15) }
            await mouse('mouseReleased', t.x + t.w - 36, y); pointer = { x: t.x + t.w - 36, y }
            const sel = await page.eval<string>(`window.getSelection().toString()`)
            rec('text selection still works under the new cursor', sel.trim().length >= 10, `${sel.trim().length} characters selected ("${sel.trim().slice(0, 40)}")`); break
          }
          case 'fixture-drag-moves': {
            if (!rects) { rec('dragging works', false, 'no fixture'); break }
            const c = center(rects.drag); await moveTo(c.x, c.y, 4, pointer); await mouse('mousePressed', c.x, c.y); await sleep(40)
            for (let i = 1; i <= 8; i++) { await mouse('mouseMoved', c.x + i * 20, c.y + i * 6); await sleep(15) }
            const out = await page.eval<string>(`document.getElementById('__wr_proof_drag_out').textContent`)
            await mouse('mouseReleased', c.x + 160, c.y + 48); pointer = { x: c.x + 160, y: c.y + 48 }
            rec('dragging still works under the new cursor', Number(out) > 100, `the drag handle saw ${out} px of pointer travel while pressed`); break
          }
          case 'expect-native-cursor': {
            const cur = await page.eval<string>(`getComputedStyle(document.elementFromPoint(300, 300) || document.body).cursor`)
            const ok = s.hidden ? cur === 'none' : cur !== 'none'
            rec(s.label, ok, `computed cursor over page content is "${cur}"`); break
          }
          case 'reload-keeps': {
            await page.send('Page.reload', {}); await sleep(5000)
            const n = await page.eval<number>(`document.querySelectorAll(${JSON.stringify(s.selector)}).length`)
            rec(s.label, s.present ? n > 0 : n === 0, `${n} element(s) match ${s.selector} after reload`); break
          }
          case 'screenshot': await shot(s.name); break
        }
      } catch (e) { rec(`step ${s.do}`, false, e instanceof Error ? e.message : String(e)) }
    }
    void consoleErrors
    writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ at: new Date().toISOString(), steps: results }, null, 1))
    return { passed: results.length > 0 && results.every((r) => r.ok), steps: results, dir: outDir }
  } finally { stop() }
}

/** The controller's proof stage: boot the installed build privately, mint a session, run the recipe's steps. A failure to RUN the proof is reported as such (error), never as a pass. */
export async function proveInstalledBuild(input: { command: CommandRecord; installPath: string; outDir: string }): Promise<UiProofResult> {
  const spec = input.command.interpretation.uiProof
  mkdirSync(input.outDir, { recursive: true })
  if (!spec) return { passed: true, steps: [], dir: input.outDir }
  const data = mkdtempSync(path.join(os.tmpdir(), 'wr-proof-data-'))
  let server: ServerHandle | null = null
  try {
    server = await bootInstalledServer(input.installPath, data)
    const session = await mintSession(server)
    const res = await Promise.race([runProofSpec(server.origin, session, spec.steps, input.outDir), new Promise<never>((_, rej) => { const t = setTimeout(() => rej(new Error('the proof exceeded its 15 minute limit')), 15 * 60_000); t.unref?.() })])
    writeFileSync(path.join(input.outDir, 'server-log.txt'), server.log())
    return res
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    writeFileSync(path.join(input.outDir, 'error.txt'), `${msg}\n${server?.log() ?? ''}`)
    return { passed: false, steps: [], dir: input.outDir, error: msg.slice(0, 300) }
  } finally { await server?.stop().catch(() => undefined); try { rmSync(data, { recursive: true, force: true }) } catch { /* best effort */ } }
}
