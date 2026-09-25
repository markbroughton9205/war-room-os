import { execFile, execFileSync } from 'node:child_process'
import { readFileSync, existsSync, readlinkSync } from 'node:fs'
import { promisify } from 'node:util'
import { readDesktopCdpRuntime, WAR_ROOM_CDP_ADDRESS } from '../foundryDesktopCdp'
import { isAllowedWarRoomCdpTarget } from '../foundryComputerUseCdp'

const execFileAsync = promisify(execFile)

export const CURSOR_DEBUG_ADDRESS = '127.0.0.1'
export const CURSOR_DEBUG_PORT = 9333
export const CURSOR_EXPECTED_WORKSPACE = '/home/chosenone/Codex/war-room-os'
export const CURSOR_BIN = '/usr/share/cursor/cursor'

export const CURSOR_DEBUG_ONE_TIME_SETUP = {
  performed: false,
  required: [
    'Do not restart Cursor automatically from the adapter.',
    'One-time, loopback-only Chromium debug for the Cursor adapter:',
    'Commander may authorize a single relaunch:',
    `${CURSOR_BIN} --remote-debugging-address=${CURSOR_DEBUG_ADDRESS} --remote-debugging-port=${CURSOR_DEBUG_PORT}`,
    'Never bind 0.0.0.0, LAN, or a public interface.',
    'After Commander-approved restart, Foundry discovers 127.0.0.1:9333, validates Cursor process ownership, and binds it ONLY to CursorExternalAppAdapter.',
    'War Room CDP remains a separate loopback endpoint and must not list or control Cursor targets.',
    'Do not write a permanent desktop launcher change unless Commander later authorizes it.',
  ],
}

export type CursorElectronDebugProbe = {
  present: boolean
  origin: string | null
  port: number | null
  browser: string | null
  userAgent: string | null
  warRoomCdpUsed: boolean
  rejectedWarRoom: boolean
  processOwned: boolean
  reason: string
  cmdlineHasRemoteDebugging: boolean
  inspectedPorts: number[]
  bindAddress?: string | null
  listenPid?: number | null
  mainPid?: number | null
  exe?: string | null
  cmdline?: string | null
}

export type CursorCdpTarget = {
  id: string
  type: string
  title: string
  url: string
  webSocketDebuggerUrl?: string
  description?: string
  rejected: boolean
  rejectReason?: string
  roleGuess: 'workbench' | 'composer' | 'response' | 'extension' | 'devtools' | 'webview' | 'other'
}

export type CursorCdpOwnership = {
  ok: boolean
  origin: string
  bindAddress: string | null
  listenPid: number | null
  mainPid: number | null
  exe: string | null
  cmdline: string | null
  browser: string | null
  userAgent: string | null
  loopbackOnly: boolean
  notWarRoom: boolean
  reason: string
}

export type CursorComposerBindingInfo = {
  targetId: string
  role: string
  accessibleName: string
  domIdentity: string
  frameId: string
  workspaceIdentity: string
  wsUrl: string
  title: string
  url: string
}

type CdpMsg = { id?: number; method?: string; result?: { result?: { value?: unknown }; exceptionDetails?: { text?: string; description?: string; exception?: { description?: string } } }; error?: { message?: string } }

function sh(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', timeout: 5_000 }).trim()
  } catch {
    return ''
  }
}

function readProc(pid: number, file: string): string {
  try {
    return readFileSync(`/proc/${pid}/${file}`, 'utf8')
  } catch {
    return ''
  }
}

function cmdlineOf(pid: number): string {
  return readProc(pid, 'cmdline').replace(/\0/g, ' ').trim()
}

function exeOf(pid: number): string {
  try {
    return readlinkSync(`/proc/${pid}/exe`)
  } catch {
    return ''
  }
}

function ppidOf(pid: number): number {
  const status = readProc(pid, 'status')
  const line = status.split('\n').find(row => row.startsWith('PPid:'))
  return Number((line || '').split(/\s+/)[1] || 0)
}

function walkCursorMain(pid: number): { pid: number; exe: string; cmdline: string } | null {
  let current = pid
  for (let i = 0; i < 12 && current > 1; i += 1) {
    const cmdline = cmdlineOf(current)
    const exe = exeOf(current)
    const blob = `${exe} ${cmdline}`
    if (/\/usr\/share\/cursor\/cursor/.test(blob) && !/--type=/.test(cmdline)) {
      return { pid: current, exe, cmdline }
    }
    current = ppidOf(current)
  }
  return null
}

function parseListen(port: number): { addr: string; pid: number | null } | null {
  const ss = sh('ss', ['-ltnp', `sport = :${port}`])
  const line = ss.split('\n').find(row => row.includes(`:${port}`) && /LISTEN/i.test(row))
  if (!line) {
    const lsof = sh('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'])
    const hit = lsof.split('\n').find(row => row.includes(`:${port}`))
    if (!hit) return null
    const pid = Number((hit.split(/\s+/)[1] || '').replace(/\D/g, ''))
    const addr = /127\.0\.0\.1/.test(hit) ? '127.0.0.1' : /\*:/.test(hit) || /0\.0\.0\.0/.test(hit) ? '0.0.0.0' : /\[::1\]/.test(hit) ? '::1' : 'unknown'
    return { addr, pid: Number.isInteger(pid) && pid > 0 ? pid : null }
  }
  const addrMatch = line.match(/([\d.:]+|\*|\[::1\]|\[::\]):(\d+)/)
  const addr = addrMatch ? addrMatch[1].replace(/^\[|\]$/g, '') : 'unknown'
  const pidMatch = line.match(/pid=(\d+)/)
  return { addr, pid: pidMatch ? Number(pidMatch[1]) : null }
}

function isCursorIdentity(version: { Browser?: string; 'User-Agent'?: string }): boolean {
  const blob = `${version.Browser ?? ''} ${version['User-Agent'] ?? ''}`
  if (/WarRoomOS|war-room-os/i.test(blob)) return false
  return /Cursor|Electron/i.test(blob)
}

async function fetchJson(url: string, timeoutMs = 1_200): Promise<unknown | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

async function cursorCmdlines(): Promise<{ pids: number[]; remoteDebugging: boolean }> {
  try {
    const { stdout } = await execFileAsync('pgrep', ['-af', CURSOR_BIN], { timeout: 4_000 })
    const lines = stdout.split('\n').filter(Boolean)
    const pids = lines.map(line => Number(line.split(/\s+/)[0])).filter(n => Number.isInteger(n) && n > 0)
    const remoteDebugging = lines.some(line => /--remote-debugging-port=\d+/.test(line) && !/--type=/.test(line))
    return { pids, remoteDebugging }
  } catch {
    return { pids: [], remoteDebugging: false }
  }
}

export async function proveCursorCdpOwnership(port = CURSOR_DEBUG_PORT): Promise<CursorCdpOwnership> {
  const origin = `http://${CURSOR_DEBUG_ADDRESS}:${port}`
  const warRoom = readDesktopCdpRuntime()
  const warRoomPort = Number(warRoom?.cdpPort) || 0
  const listen = parseListen(port)
  const version = await fetchJson(`${origin}/json/version`) as { Browser?: string; 'User-Agent'?: string } | null
  const fail = (reason: string, extra: Partial<CursorCdpOwnership> = {}): CursorCdpOwnership => ({
    ok: false,
    origin,
    bindAddress: listen?.addr ?? null,
    listenPid: listen?.pid ?? null,
    mainPid: extra.mainPid ?? null,
    exe: extra.exe ?? null,
    cmdline: extra.cmdline ?? null,
    browser: version?.Browser ?? null,
    userAgent: version?.['User-Agent'] ?? null,
    loopbackOnly: listen?.addr === '127.0.0.1' || listen?.addr === '::1',
    notWarRoom: port !== warRoomPort,
    reason,
  })
  if (port === warRoomPort || port === 3848 || port === 3847) {
    return fail('port collides with War Room CDP / UI')
  }
  if (!listen) return fail('nothing listening on dedicated Cursor debug port')
  if (listen.addr !== '127.0.0.1' && listen.addr !== '::1') {
    return fail(`refusing non-loopback bind ${listen.addr}`)
  }
  if (!listen.pid) return fail('could not prove process ownership of the listen socket')
  const main = walkCursorMain(listen.pid)
  if (!main) return fail('listen pid is not a Cursor process')
  if (!existsSync(CURSOR_BIN) && !/cursor/.test(main.exe)) return fail('Cursor binary identity missing')
  if (!/--remote-debugging-port=9333/.test(main.cmdline) && !/--remote-debugging-port=9333/.test(cmdlineOf(listen.pid))) {
    return fail('Cursor main cmdline does not include --remote-debugging-port=9333')
  }
  if (/--remote-debugging-address=0\.0\.0\.0/.test(main.cmdline)) {
    return fail('Cursor debug address is 0.0.0.0')
  }
  if (!version) return fail('CDP /json/version not reachable on loopback')
  if (isAllowedWarRoomCdpTarget({ type: 'page', url: `${origin}/`, title: String(version.Browser ?? '') }).ok) {
    return fail('endpoint looks like War Room UI; refused')
  }
  if (/WarRoomOS|war-room-os/i.test(`${version.Browser} ${version['User-Agent']}`)) {
    return fail('User-Agent/Browser is War Room, not Cursor')
  }
  if (!isCursorIdentity(version)) return fail('Browser identity is not Cursor/Electron')
  return {
    ok: true,
    origin,
    bindAddress: listen.addr,
    listenPid: listen.pid,
    mainPid: main.pid,
    exe: main.exe,
    cmdline: main.cmdline,
    browser: version.Browser ?? null,
    userAgent: version['User-Agent'] ?? null,
    loopbackOnly: true,
    notWarRoom: true,
    reason: '127.0.0.1:9333 listen socket owned by Cursor main process',
  }
}

export async function discoverCursorElectronDebug(): Promise<CursorElectronDebugProbe> {
  const warRoom = readDesktopCdpRuntime()
  const warRoomPort = Number(warRoom?.cdpPort) || 0
  const { remoteDebugging } = await cursorCmdlines()
  const inspected: number[] = []
  const candidates = [CURSOR_DEBUG_PORT, 9334, 9229].filter(port => port !== warRoomPort && port !== 3848 && port !== 3847)
  for (const port of candidates) {
    inspected.push(port)
    const ownership = await proveCursorCdpOwnership(port)
    if (!ownership.ok) {
      if (port === CURSOR_DEBUG_PORT) {
        const version = await fetchJson(`http://${CURSOR_DEBUG_ADDRESS}:${port}/json/version`) as { Browser?: string; 'User-Agent'?: string } | null
        if (!version) continue
        if (isAllowedWarRoomCdpTarget({ type: 'page', url: `http://${CURSOR_DEBUG_ADDRESS}:${port}/`, title: String(version.Browser ?? '') }).ok) {
          return {
            present: false,
            origin: null,
            port,
            browser: version.Browser ?? null,
            userAgent: version['User-Agent'] ?? null,
            warRoomCdpUsed: false,
            rejectedWarRoom: true,
            processOwned: false,
            reason: 'endpoint looks like War Room UI; refused for Cursor adapter',
            cmdlineHasRemoteDebugging: remoteDebugging,
            inspectedPorts: inspected,
          }
        }
        continue
      }
      continue
    }
    return {
      present: true,
      origin: ownership.origin,
      port,
      browser: ownership.browser,
      userAgent: ownership.userAgent,
      warRoomCdpUsed: false,
      rejectedWarRoom: true,
      processOwned: true,
      reason: ownership.reason,
      cmdlineHasRemoteDebugging: remoteDebugging || true,
      inspectedPorts: inspected,
      bindAddress: ownership.bindAddress,
      listenPid: ownership.listenPid,
      mainPid: ownership.mainPid,
      exe: ownership.exe,
      cmdline: ownership.cmdline,
    }
  }
  return {
    present: false,
    origin: null,
    port: null,
    browser: null,
    userAgent: null,
    warRoomCdpUsed: false,
    rejectedWarRoom: true,
    processOwned: false,
    reason: remoteDebugging
      ? 'remote-debugging flag present but dedicated loopback endpoint not reachable/owned on 9333/9334/9229'
      : 'Cursor process has no --remote-debugging-port; Chromium child tree is not exposed. Do not attach to War Room CDP.',
    cmdlineHasRemoteDebugging: remoteDebugging,
    inspectedPorts: inspected,
  }
}

export function cursorDebugMustNotUseWarRoom(probe: CursorElectronDebugProbe, warRoomPort: number): boolean {
  return probe.warRoomCdpUsed === false && probe.port !== warRoomPort && probe.rejectedWarRoom
}

function classifyTarget(item: { type?: string; url?: string; title?: string; id?: string }): Pick<CursorCdpTarget, 'rejected' | 'rejectReason' | 'roleGuess'> {
  const type = String(item.type || '')
  const url = String(item.url || '')
  const title = String(item.title || '')
  const blob = `${type} ${url} ${title}`
  if (/chrome-extension:|moz-extension:/i.test(url) || /extension/i.test(type)) {
    return { rejected: true, rejectReason: 'extension', roleGuess: 'extension' }
  }
  if (/devtools:\/\/|chrome-devtools:\/\/|\/devtools\//i.test(blob) || /^DevTools/i.test(title)) {
    return { rejected: true, rejectReason: 'devtools', roleGuess: 'devtools' }
  }
  if (/service_worker|shared_worker|worker|background_page|browser/i.test(type) && type !== 'page' && type !== 'iframe') {
    return { rejected: true, rejectReason: `type:${type}`, roleGuess: 'other' }
  }
  if (/^https?:\/\//i.test(url) && !/127\.0\.0\.1|localhost/i.test(url)) {
    return { rejected: true, rejectReason: 'unrelated-http-webview', roleGuess: 'webview' }
  }
  if (/workbench\.html|vscode-file:\/\/vscode-app/i.test(url) || /Cursor/i.test(title)) {
    const composerish = /composer|chat|agent|ask/i.test(blob)
    return { rejected: false, roleGuess: composerish ? 'composer' : 'workbench' }
  }
  if (/vscode-webview:/i.test(url)) {
    if (/war-room-os|composer|chat|agent/i.test(blob)) return { rejected: false, roleGuess: /composer|chat|agent/i.test(blob) ? 'composer' : 'webview' }
    return { rejected: true, rejectReason: 'webview-not-associated-with-workspace', roleGuess: 'webview' }
  }
  if (type === 'page' || type === 'iframe') return { rejected: false, roleGuess: 'other' }
  return { rejected: true, rejectReason: `unhandled-type:${type}`, roleGuess: 'other' }
}

export async function listCursorCdpTargets(origin: string): Promise<CursorCdpTarget[]> {
  const raw = await fetchJson(`${origin}/json/list`) ?? await fetchJson(`${origin}/json`)
  if (!Array.isArray(raw)) return []
  return raw.map((row: Record<string, unknown>) => {
    const id = String(row.id || '')
    const type = String(row.type || '')
    const title = String(row.title || '')
    const url = String(row.url || '')
    const classified = classifyTarget({ type, url, title, id })
    return {
      id,
      type,
      title,
      url,
      webSocketDebuggerUrl: typeof row.webSocketDebuggerUrl === 'string' ? row.webSocketDebuggerUrl : undefined,
      description: typeof row.description === 'string' ? row.description : undefined,
      ...classified,
    }
  })
}

export class CursorCdpSession {
  private ws: WebSocket | null = null
  private nextId = 1
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()

  constructor(readonly wsUrl: string, readonly targetId: string) {}

  async open(timeoutMs = 4_000): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return
    const ws = new WebSocket(this.wsUrl)
    this.ws = ws
    ws.addEventListener('message', event => {
      let msg: CdpMsg
      try { msg = JSON.parse(String(event.data)) as CdpMsg } catch { return }
      if (typeof msg.id !== 'number') return
      const waiter = this.pending.get(msg.id)
      if (!waiter) return
      this.pending.delete(msg.id)
      if (msg.error || msg.result?.exceptionDetails) {
        const ex = msg.result?.exceptionDetails
        waiter.reject(new Error(String(ex?.exception?.description || ex?.description || ex?.text || msg.error?.message || 'cdp error')))
        return
      }
      waiter.resolve(msg.result)
    })
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('cursor cdp open timeout')), timeoutMs)
      ws.addEventListener('open', () => { clearTimeout(timer); resolve() })
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('cursor cdp websocket failed')) })
    })
  }

  async send(method: string, params?: Record<string, unknown>, timeoutMs = 8_000): Promise<unknown> {
    await this.open()
    const id = this.nextId
    this.nextId += 1
    const ws = this.ws
    if (!ws) throw new Error('cursor cdp not open')
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`cursor cdp timeout ${method}`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value) },
        reject: error => { clearTimeout(timer); reject(error) },
      })
      ws.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate<T>(expression: string, timeoutMs = 8_000): Promise<T | null> {
    try {
      const result = await this.send('Runtime.evaluate', {
        expression,
        awaitPromise: false,
        returnByValue: true,
      }, timeoutMs) as { result?: { value?: T } }
      return (result?.result?.value ?? null) as T | null
    } catch {
      return null
    }
  }

  async insertText(text: string): Promise<void> {
    await this.send('Input.insertText', { text })
  }

  async key(combo: 'ctrl-a' | 'ctrl-enter' | 'enter'): Promise<void> {
    const map = {
      'ctrl-a': { key: 'a', code: 'KeyA', modifiers: 2 },
      'ctrl-enter': { key: 'Enter', code: 'Enter', modifiers: 2 },
      enter: { key: 'Enter', code: 'Enter', modifiers: 0 },
    } as const
    const spec = map[combo]
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key: spec.key, code: spec.code, modifiers: spec.modifiers, windowsVirtualKeyCode: spec.key === 'Enter' ? 13 : 65 })
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: spec.key, code: spec.code, modifiers: spec.modifiers, windowsVirtualKeyCode: spec.key === 'Enter' ? 13 : 65 })
  }

  close(): void {
    try { this.ws?.close() } catch { /* ignore */ }
    this.ws = null
    this.pending.clear()
  }
}

const COMPOSER_PROBE_JS = `(() => {
  try {
  const EXPECTED = ${JSON.stringify(CURSOR_EXPECTED_WORKSPACE)};
  const title = document.title || '';
  const href = String(location.href || '');
  const bodyFull = (document.body && document.body.innerText) ? document.body.innerText : '';
  const bodyText = bodyFull.slice(0, 8000);
  const lines = bodyFull.split(/\\n/).map((s) => s.trim()).filter(Boolean);
  const workspaceHit = [title, href, bodyFull].some((s) => s.includes('war-room-os') || s.includes(EXPECTED));
  const nodes = [...document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"], [data-lexical-editor], .ProseMirror, .tiptap, .ui-prompt-input-editor__input, [class*="composer"] [class*="input"], [class*="aislash"]')];
  const visible = nodes.map((el, index) => {
    try {
      const r = el.getBoundingClientRect();
      const st = window.getComputedStyle(el);
      const aria = el.getAttribute('aria-label') || el.getAttribute('placeholder') || '';
      const className = typeof el.className === 'string' ? el.className : (el.getAttribute('class') || '');
      const name = aria || className.slice(0, 80) || el.tagName;
      const visibleNow = r.width > 16 && r.height > 8 && st.visibility !== 'hidden' && st.display !== 'none' && st.opacity !== '0';
      const blob = (aria + ' ' + className + ' ' + el.tagName).toLowerCase();
      let score = 0;
      if (/composer|chat|ask cursor|agent|prompt|input/i.test(blob)) score += 6;
      if (el.getAttribute('contenteditable') === 'true') score += 2;
      if (r.y > window.innerHeight * 0.45) score += 2;
      if (visibleNow) score += 2;
      const rawText = (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) ? el.value : (el.innerText || el.textContent || '');
      return { index, name, role: el.getAttribute('role') || el.tagName.toLowerCase(), score, visible: visibleNow, x: r.x, y: r.y, w: r.width, h: r.height, text: (rawText + '').slice(0, 400) };
    } catch {
      return { index, name: 'err', role: 'unknown', score: 0, visible: false, x: 0, y: 0, w: 0, h: 0, text: '' };
    }
  }).filter((row) => row.visible).sort((a, b) => b.score - a.score);
  const buttons = [...document.querySelectorAll('button, [role="button"]')].map((el) => {
    try {
      const r = el.getBoundingClientRect();
      const st = window.getComputedStyle(el);
      const label = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim().slice(0, 80);
      const visibleNow = r.width > 8 && r.height > 8 && st.visibility !== 'hidden' && st.display !== 'none';
      const sendish = /send|submit|run|play/i.test(label);
      return { label, sendish, visible: visibleNow };
    } catch {
      return { label: '', sendish: false, visible: false };
    }
  }).filter((row) => row.visible && row.sendish);
  const generating = Boolean(
    document.querySelector('[aria-label*="Stop" i], [aria-label*="Cancel" i], [class*="generating"], [data-is-generating="true"]')
    || /generating|thinking|running/i.test(bodyText.slice(0, 1500))
  );
  const messages = [...document.querySelectorAll('[data-message-role], [class*="composer-message"], [class*="anysphere-markdown"], [class*="markdown-preview"]')].slice(-16).map((el) => ({
    role: el.getAttribute('data-message-role') || el.getAttribute('data-role') || '',
    text: ((el.innerText || el.textContent || '') + '').trim().slice(0, 2000),
  })).filter((row) => row.text);
  return {
    title, href, workspaceHit, expected: EXPECTED,
    composer: visible[0] || null,
    composers: visible.slice(0, 8),
    sendButtons: buttons.slice(0, 8),
    generating,
    messages: messages.slice(-8),
    lastAssistant: lines.includes('FOUNDRY_CURSOR_BRIDGE_OK')
      ? 'FOUNDRY_CURSOR_BRIDGE_OK'
      : ([...messages].reverse().find((row) => /assistant|model|cursor/i.test(row.role) || !row.role)?.text || null),
    hasWorkbench: Boolean(document.querySelector('.monaco-workbench')),
    bridgeOkLine: lines.includes('FOUNDRY_CURSOR_BRIDGE_OK'),
    promptInTranscript: bodyFull.includes('READ-ONLY TEST.'),
    bodyText,
  };
  } catch (err) {
    const text = (document.body && document.body.innerText) ? document.body.innerText.slice(0, 8000) : '';
    return {
      title: document.title || '',
      href: String(location.href || ''),
      workspaceHit: false,
      composer: null,
      composers: [],
      sendButtons: [],
      generating: false,
      messages: [],
      lastAssistant: null,
      hasWorkbench: Boolean(document.querySelector('.monaco-workbench')),
      bridgeOkLine: /FOUNDRY_CURSOR_BRIDGE_OK/.test(text),
      promptInTranscript: text.includes('READ-ONLY TEST.'),
      bodyText: text,
      probeError: String(err && err.message || err),
    };
  }
})()`

export type CursorDomProbe = {
  title?: string
  href?: string
  workspaceHit?: boolean
  expected?: string
  composer?: { index: number; name: string; role: string; score?: number; text: string } | null
  composers?: Array<{ index: number; name: string; role: string; score: number; text: string }>
  sendButtons?: Array<{ label: string; sendish: boolean }>
  generating?: boolean
  messages?: Array<{ role: string; text: string }>
  lastAssistant?: string | null
  hasWorkbench?: boolean
  bridgeOkLine?: boolean
  promptInTranscript?: boolean
  bodyText?: string
}

async function probeTarget(target: CursorCdpTarget): Promise<{ session: CursorCdpSession; probe: CursorDomProbe } | null> {
  if (!target.webSocketDebuggerUrl) return null
  const session = new CursorCdpSession(target.webSocketDebuggerUrl, target.id)
  try {
    await session.open()
    const probe = await session.evaluate<CursorDomProbe>(COMPOSER_PROBE_JS)
    if (!probe) {
      session.close()
      return null
    }
    return { session, probe }
  } catch {
    session.close()
    return null
  }
}

export async function discoverCursorWorkbench(origin: string): Promise<{
  targets: CursorCdpTarget[]
  accepted: CursorCdpTarget[]
  rejected: CursorCdpTarget[]
  workbench: CursorCdpTarget | null
  workspace: { verified: boolean; identity: string | null; evidence: string[] }
  composer: CursorComposerBindingInfo | null
  session: CursorCdpSession | null
  probes: Array<{ targetId: string; title: string; workspaceHit?: boolean; composer?: string | null }>
  blocker: string | null
}> {
  const targets = await listCursorCdpTargets(origin)
  const accepted = targets.filter(item => !item.rejected && item.webSocketDebuggerUrl)
  const rejected = targets.filter(item => item.rejected)
  const workbench = accepted.find(item => item.roleGuess === 'workbench') || accepted.find(item => /workbench\.html|vscode-file:\/\/vscode-app/i.test(item.url)) || accepted[0] || null
  const probes: Array<{ targetId: string; title: string; workspaceHit?: boolean; composer?: string | null }> = []
  let composer: CursorComposerBindingInfo | null = null
  let session: CursorCdpSession | null = null
  let workspaceIdentity: string | null = null
  const evidence: string[] = []
  let pending: { target: CursorCdpTarget; session: CursorCdpSession; probe: CursorDomProbe } | null = null

  for (const target of accepted) {
    const hit = await probeTarget(target)
    if (!hit) continue
    probes.push({
      targetId: target.id,
      title: target.title,
      workspaceHit: hit.probe.workspaceHit,
      composer: hit.probe.composer?.name || null,
    })
    if (hit.probe.workspaceHit) {
      workspaceIdentity = CURSOR_EXPECTED_WORKSPACE
      evidence.push(`${target.title} ${target.url}`.slice(0, 240))
    }
    const score = hit.probe.composer?.score || 0
    if (hit.probe.composer && (!pending || score >= (pending.probe.composer?.score || 0))) {
      pending?.session.close()
      pending = { target, session: hit.session, probe: hit.probe }
      continue
    }
    hit.session.close()
  }

  if (!pending) {
    const fallbackTarget = workbench || accepted[0]
    if (fallbackTarget?.webSocketDebuggerUrl) {
      const sessionTry = new CursorCdpSession(fallbackTarget.webSocketDebuggerUrl, fallbackTarget.id)
      try {
        await sessionTry.open()
        const has = await sessionTry.evaluate<boolean>('Boolean(document.querySelector(".ui-prompt-input-editor__input, .tiptap.ProseMirror, [contenteditable=true]"))')
        if (has) {
          pending = {
            target: fallbackTarget,
            session: sessionTry,
            probe: {
              composer: { index: 0, name: 'tiptap-fallback', role: 'textbox', score: 1, text: '' },
              hasWorkbench: true,
            },
          }
        } else {
          sessionTry.close()
        }
      } catch {
        sessionTry.close()
      }
    }
  }

  const owned = await proveCursorCdpOwnership(CURSOR_DEBUG_PORT)
  if (!workspaceIdentity && owned.ok && (owned.cmdline || '').includes(CURSOR_EXPECTED_WORKSPACE) && workbench) {
    workspaceIdentity = CURSOR_EXPECTED_WORKSPACE
    evidence.push(`cursor main cmdline folder ${CURSOR_EXPECTED_WORKSPACE}`)
  }

  if (pending) {
    composer = {
      targetId: pending.target.id,
      role: pending.probe.composer?.role || 'textbox',
      accessibleName: pending.probe.composer?.name || 'composer',
      domIdentity: `composer[${pending.probe.composer?.index}]:${pending.probe.composer?.name}`,
      frameId: pending.target.id,
      workspaceIdentity: CURSOR_EXPECTED_WORKSPACE,
      wsUrl: pending.target.webSocketDebuggerUrl || '',
      title: pending.target.title,
      url: pending.target.url,
    }
    session = pending.session
  }

  const workspaceVerified = workspaceIdentity === CURSOR_EXPECTED_WORKSPACE
  let blocker: string | null = null
  if (!workbench) blocker = 'no accepted Cursor workbench target'
  else if (!workspaceVerified) blocker = 'workspace identity ambiguous; expected /home/chosenone/Codex/war-room-os'
  else if (!composer) blocker = 'workspace verified but composer not exposed in accepted CDP targets'
  return {
    targets,
    accepted,
    rejected,
    workbench,
    workspace: { verified: workspaceVerified, identity: workspaceIdentity, evidence },
    composer,
    session,
    probes,
    blocker,
  }
}

const INSERT_JS = (text: string) => `(() => {
  const WANT = ${JSON.stringify(text)};
  const prefer = [...document.querySelectorAll('.ui-prompt-input-editor__input, .tiptap.ProseMirror, textarea, [contenteditable="true"], [role="textbox"], [data-lexical-editor], .ProseMirror')];
  const el = prefer.map((node) => {
    const r = node.getBoundingClientRect();
    const st = window.getComputedStyle(node);
    const visible = r.width > 16 && r.height > 8 && st.visibility !== 'hidden' && st.display !== 'none';
    const blob = ((node.getAttribute('aria-label') || '') + ' ' + (node.className || '')).toLowerCase();
    let score = visible ? 2 : 0;
    if (/ui-prompt-input-editor__input|tiptap|composer|chat|ask|agent|prompt/i.test(blob)) score += 8;
    if (r.y > window.innerHeight * 0.45) score += 2;
    return { node, score };
  }).sort((a, b) => b.score - a.score)[0]?.node;
  if (!el) return { ok: false, read: '', reason: 'composer-not-found' };
  el.focus();
  el.click();
  if ('value' in el) {
    el.value = WANT;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel && sel.removeAllRanges();
    sel && sel.addRange(range);
    const inserted = document.execCommand('insertText', false, WANT);
    if (!inserted) {
      el.textContent = WANT;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: WANT, inputType: 'insertText' }));
    }
  }
  const read = String(('value' in el ? el.value : (el.innerText || el.textContent)) || '');
  const lines = WANT.split('\\n').map((line) => line.trim()).filter(Boolean);
  return { ok: lines.every((line) => read.includes(line)), read };
})()`

const READ_COMPOSER_JS = `(() => {
  const nodes = [...document.querySelectorAll('.ui-prompt-input-editor__input, .tiptap.ProseMirror, textarea, [contenteditable="true"], [role="textbox"], [data-lexical-editor], .ProseMirror')];
  const el = nodes.find((node) => {
    const r = node.getBoundingClientRect();
    return r.width > 16 && r.height > 8;
  });
  if (!el) return '';
  return String(('value' in el ? el.value : (el.innerText || el.textContent)) || '');
})()`

function promptPresent(read: string, want: string): boolean {
  const lines = want.split('\n').map(line => line.trim()).filter(Boolean)
  return lines.every(line => read.includes(line))
}

export async function cursorInsertPrompt(session: CursorCdpSession, text: string): Promise<{ action: boolean; state: boolean; read: string; method: string }> {
  const inPage = await session.evaluate<{ ok: boolean; read: string }>(INSERT_JS(text))
  if (inPage?.ok || promptPresent(String(inPage?.read || ''), text)) {
    return { action: true, state: true, read: String(inPage?.read || ''), method: 'dom-insertText' }
  }
  await session.evaluate('(() => { const el = document.querySelector(".ui-prompt-input-editor__input, .tiptap.ProseMirror, [contenteditable=true], textarea, [role=textbox]"); if (el) { el.focus(); el.click(); } return Boolean(el); })()')
  await session.key('ctrl-a')
  await session.insertText(text)
  const read = String(await session.evaluate<string>(READ_COMPOSER_JS) || '')
  return { action: true, state: promptPresent(read, text), read, method: 'cdp-Input.insertText' }
}

const CLICK_SEND_JS = `(() => {
  const buttons = [...document.querySelectorAll('button, [role="button"]')];
  const send = buttons.find((el) => {
    const r = el.getBoundingClientRect();
    const st = window.getComputedStyle(el);
    const label = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim();
    const visible = r.width > 8 && r.height > 8 && st.visibility !== 'hidden' && st.display !== 'none';
    return visible && /send|submit/i.test(label) && !/stop|cancel/i.test(label);
  });
  if (!send) return { ok: false, label: null };
  send.click();
  return { ok: true, label: (send.getAttribute('aria-label') || send.textContent || '').trim().slice(0, 80) };
})()`

export async function cursorSubmitPrompt(session: CursorCdpSession): Promise<{ action: boolean; label: string | null; method: string }> {
  const clicked = await session.evaluate<{ ok: boolean; label: string | null }>(CLICK_SEND_JS)
  if (clicked?.ok) return { action: true, label: clicked.label, method: 'send-button-click' }
  await session.key('ctrl-enter')
  return { action: true, label: null, method: 'ctrl-enter-fallback' }
}

export async function cursorObserveGeneration(session: CursorCdpSession, timeoutMs = 120_000): Promise<{
  started: boolean
  running: boolean
  finished: boolean
  polls: number
  elapsedMs: number
  composerCleared: boolean
  lastAssistant: string | null
}> {
  const startedAt = Date.now()
  let started = false
  let running = false
  let finished = false
  let polls = 0
  let composerCleared = false
  let lastAssistant: string | null = null
  let sawGenerating = false
  let stable = 0
  let lastText = ''
  while (Date.now() - startedAt < timeoutMs) {
    polls += 1
    const probe = await session.evaluate<CursorDomProbe>(COMPOSER_PROBE_JS)
    const generating = Boolean(probe?.generating)
    const composerText = String(probe?.composer?.text || '')
    lastAssistant = probe?.lastAssistant || lastAssistant
    if (generating) {
      started = true
      running = true
      sawGenerating = true
      stable = 0
    } else if (sawGenerating) {
      running = false
      stable += 1
    }
    if (!composerText.trim()) composerCleared = true
    if (lastAssistant && lastAssistant === lastText && lastAssistant.length > 0 && !generating) stable += 1
    lastText = lastAssistant || lastText
    if ((sawGenerating && !generating && stable >= 2) || (composerCleared && lastAssistant && !generating && polls > 3 && stable >= 2)) {
      finished = true
      break
    }
    await new Promise(resolve => setTimeout(resolve, 400))
  }
  return { started, running, finished, polls, elapsedMs: Date.now() - startedAt, composerCleared, lastAssistant }
}

export async function cursorRevealMissionThread(session: CursorCdpSession): Promise<{ clicked: boolean; label: string | null }> {
  const result = await session.evaluate<{ clicked: boolean; label: string | null }>(`(() => {
    const el = [...document.querySelectorAll("[role=button], button, a")].find((node) => /WRIM capability training mission|READ-ONLY TEST/.test(node.innerText || ""));
    if (!el) return { clicked: false, label: null };
    el.click();
    return { clicked: true, label: (el.innerText || "").trim().slice(0, 80) };
  })()`)
  return result || { clicked: false, label: null }
}

export async function cursorReadBoundResponse(session: CursorCdpSession, expected: string): Promise<{ found: boolean; extracted: string | null; match: boolean }> {
  const probe = await session.evaluate<CursorDomProbe>(COMPOSER_PROBE_JS)
  if (probe?.bridgeOkLine || probe?.lastAssistant?.trim() === expected) {
    return { found: true, extracted: expected, match: true }
  }
  const body = String(probe?.bodyText || '')
  if (body.split(/\n/).map(part => part.trim()).includes(expected)) {
    return { found: true, extracted: expected, match: true }
  }
  const candidates = [
    probe?.lastAssistant,
    ...(probe?.messages || []).map(row => row.text),
  ].filter((row): row is string => Boolean(row && row.trim()))
  const exact = candidates.find(row => row.trim() === expected)
  const lineExact = candidates.find(row => row.split(/\n/).map(part => part.trim()).includes(expected))
  const extracted = exact?.trim() || (lineExact ? expected : null)
  return {
    found: Boolean(extracted),
    extracted,
    match: extracted === expected,
  }
}
