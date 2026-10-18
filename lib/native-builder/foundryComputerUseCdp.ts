/**
 * Localhost-only Electron CDP fallback for Computer Use.
 *
 * Hierarchy (do not invert):
 *   AT-SPI semantic action → expected-state proof
 *   → CDP semantic aria-label activation if AT-SPI no-ops
 *   → expected-state proof
 *   → semantic bounds fallback (last resort)
 *
 * CDP is not primary control. It is a governed local safety net.
 * No generic "execute arbitrary CDP JS" tool is exposed.
 */
import { logWarRoomRepoAudit } from '@/lib/war-room/repoAudit'
import { discoverWarRoomCdpOrigin, readDesktopCdpRuntime, WAR_ROOM_CDP_ADDRESS, WAR_ROOM_CDP_PREFERRED_PORT } from './foundryDesktopCdp'

export const REMOTE_DEBUGGING_ADDRESS = WAR_ROOM_CDP_ADDRESS
/** Preferred try-first port only. Never exclusive ownership. Discover via warRoomCdpOrigin(). */
export const REMOTE_DEBUGGING_PORT = WAR_ROOM_CDP_PREFERRED_PORT
export const WAR_ROOM_UI_ORIGIN = 'http://127.0.0.1:3848'

const SECRET_KEYS = /cookie|token|secret|password|authorization|session|desktop.?trust|dom\b/i

export type CdpTarget = { type?: string; url?: string; title?: string; webSocketDebuggerUrl?: string; id?: string }

export type CdpScopeResult =
  | { ok: true; wsUrl: string; url: string; title: string; originClass: 'WAR_ROOM_LOCAL' }
  | { ok: false; reason: string }

export type CdpActionAudit = {
  missionId: string | null
  tool: string
  targetSemanticName: string
  pageOriginClass: string
  actionType: 'ACTIVATE' | 'TYPE' | 'SELECT' | 'PROBE' | 'REJECTED'
  expectedNextState: string
  success: boolean
  timestamp: string
}

export function isAllowedWarRoomCdpTarget(target: CdpTarget): { ok: boolean; reason?: string } {
  if (target.type && target.type !== 'page') return { ok: false, reason: 'wrong-target-type' }
  const url = String(target.url ?? '')
  const title = String(target.title ?? '')
  if (/cursor|chrome-devtools|devtools:\/\/|chrome-extension:|about:blank/i.test(url) || /Cursor|Google Chrome|^Chrome$/i.test(title)) {
    return { ok: false, reason: 'wrong-app' }
  }
  if (!/^https?:\/\/127\.0\.0\.1:3848(?:\/|$)/.test(url)) {
    return { ok: false, reason: 'wrong-origin' }
  }
  return { ok: true }
}

function sanitizeAudit(audit: CdpActionAudit): CdpActionAudit {
  const out = { ...audit }
  for (const key of Object.keys(out) as Array<keyof CdpActionAudit>) {
    if (SECRET_KEYS.test(String(key))) {
      ;(out as Record<string, unknown>)[key] = '[REDACTED]'
    }
  }
  return out
}

export async function auditCdpFallback(audit: CdpActionAudit): Promise<void> {
  await logWarRoomRepoAudit('engineer: computer.cdp_fallback', sanitizeAudit(audit))
}

async function resolveCdpOrigin(): Promise<string | null> {
  const discovered = await discoverWarRoomCdpOrigin({ isAllowedTarget: item => isAllowedWarRoomCdpTarget(item).ok })
  if (discovered?.origin) return discovered.origin
  const persisted = readDesktopCdpRuntime()
  const port = Number(persisted?.cdpPort)
  if (Number.isInteger(port) && port > 0) return `http://${REMOTE_DEBUGGING_ADDRESS}:${port}`
  return null
}

async function cdpJson<T>(pathname: string): Promise<T | null> {
  const origin = await resolveCdpOrigin()
  if (!origin) return null
  try {
    const res = await fetch(`${origin}${pathname}`, { signal: AbortSignal.timeout(1_200) })
    if (!res.ok) return null
    return await res.json() as T
  } catch {
    return null
  }
}

export async function warRoomCdpAvailable(): Promise<boolean> {
  const version = await cdpJson<Record<string, unknown>>('/json/version')
  return Boolean(version && (version.webSocketDebuggerUrl || version.Browser))
}

export async function resolveWarRoomCdpPage(): Promise<CdpScopeResult> {
  if (!(await warRoomCdpAvailable())) return { ok: false, reason: 'cdp-unavailable' }
  const targets = await cdpJson<CdpTarget[]>('/json/list') ?? await cdpJson<CdpTarget[]>('/json')
  if (!Array.isArray(targets)) return { ok: false, reason: 'no-targets' }
  const pages = targets.filter(item => item.type === 'page' && item.webSocketDebuggerUrl)
  const allowed = pages.find(item => isAllowedWarRoomCdpTarget(item).ok)
  if (!allowed?.webSocketDebuggerUrl) {
    const rejected = pages[0] ? isAllowedWarRoomCdpTarget(pages[0]).reason : 'no-page'
    return { ok: false, reason: rejected ?? 'wrong-origin' }
  }
  return {
    ok: true,
    wsUrl: allowed.webSocketDebuggerUrl,
    url: String(allowed.url ?? WAR_ROOM_UI_ORIGIN),
    title: String(allowed.title ?? 'War Room'),
    originClass: 'WAR_ROOM_LOCAL',
  }
}

export async function cdpEvaluate<T>(expression: string, timeoutMs = 6_000): Promise<{ ok: true; value: T | null; scope: Extract<CdpScopeResult, { ok: true }> } | { ok: false; reason: string }> {
  const scope = await resolveWarRoomCdpPage()
  if (!scope.ok) return { ok: false, reason: scope.reason }
  const ws = new WebSocket(scope.wsUrl)
  const id = 1
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('cdp open timeout')), 2_000)
      ws.addEventListener('open', () => { clearTimeout(timer); resolve() })
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('cdp websocket failed')) })
    })
    const result = await new Promise<T | null>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('cdp evaluate timeout')), timeoutMs)
      ws.addEventListener('message', event => {
        let msg: { id?: number; result?: { result?: { value?: T }; exceptionDetails?: { text?: string } }; error?: unknown }
        try { msg = JSON.parse(String(event.data)) } catch { return }
        if (msg.id !== id) return
        clearTimeout(timer)
        if (msg.error || msg.result?.exceptionDetails) {
          reject(new Error(String(msg.result?.exceptionDetails?.text ?? JSON.stringify(msg.error))))
          return
        }
        resolve((msg.result?.result?.value ?? null) as T | null)
      })
      ws.send(JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
      }))
    })
    return { ok: true, value: result, scope }
  } catch {
    return { ok: false, reason: 'evaluate-failed' }
  } finally {
    try { ws.close() } catch { /* ignore */ }
  }
}

async function record(input: {
  missionId?: string | null
  tool: string
  name: string
  actionType: CdpActionAudit['actionType']
  expectedNextState: string
  success: boolean
  pageOriginClass?: string
}): Promise<void> {
  await auditCdpFallback({
    missionId: input.missionId ?? null,
    tool: input.tool,
    targetSemanticName: input.name,
    pageOriginClass: input.pageOriginClass ?? 'WAR_ROOM_LOCAL',
    actionType: input.actionType,
    expectedNextState: input.expectedNextState,
    success: input.success,
    timestamp: new Date().toISOString(),
  }).catch(() => undefined)
}

export async function listElectronCdpTargets(): Promise<CdpTarget[]> {
  const targets = await cdpJson<CdpTarget[]>('/json/list') ?? await cdpJson<CdpTarget[]>('/json')
  return Array.isArray(targets) ? targets : []
}

export async function captureCdpTargetPng(urlNeedle: string, dest: string): Promise<{ ok: boolean; path?: string; url?: string; title?: string; reason?: string }> {
  const targets = await listElectronCdpTargets()
  const hit = targets.find(item => item.webSocketDebuggerUrl && String(item.url ?? '').includes(urlNeedle))
  if (!hit?.webSocketDebuggerUrl) return { ok: false, reason: `no-cdp-target:${urlNeedle}` }
  const ws = new WebSocket(hit.webSocketDebuggerUrl)
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('cdp open timeout')), 2_000)
      ws.addEventListener('open', () => { clearTimeout(timer); resolve() })
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('cdp websocket failed')) })
    })
    const data = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('cdp screenshot timeout')), 8_000)
      ws.addEventListener('message', event => {
        let msg: { id?: number; result?: { data?: string }; error?: unknown }
        try { msg = JSON.parse(String(event.data)) } catch { return }
        if (msg.id !== 1) return
        clearTimeout(timer)
        if (msg.error || !msg.result?.data) {
          reject(new Error(JSON.stringify(msg.error ?? 'no-data')))
          return
        }
        resolve(msg.result.data)
      })
      ws.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png', fromSurface: true } }))
    })
    const { mkdir, writeFile } = await import('node:fs/promises')
    const pathMod = await import('node:path')
    await mkdir(pathMod.dirname(dest), { recursive: true })
    await writeFile(dest, Buffer.from(data, 'base64'))
    return { ok: true, path: dest, url: hit.url, title: hit.title }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error), url: hit.url, title: hit.title }
  } finally {
    try { ws.close() } catch { /* ignore */ }
  }
}

export async function captureInstalledUiPng(dest: string): Promise<{ ok: boolean; path?: string; url?: string; reason?: string }> {
  const scope = await resolveWarRoomCdpPage()
  if (!scope.ok) return { ok: false, reason: scope.reason }
  const ws = new WebSocket(scope.wsUrl)
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('cdp open timeout')), 2_000)
      ws.addEventListener('open', () => { clearTimeout(timer); resolve() })
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('cdp websocket failed')) })
    })
    const data = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('cdp screenshot timeout')), 8_000)
      ws.addEventListener('message', event => {
        let msg: { id?: number; result?: { data?: string }; error?: unknown }
        try { msg = JSON.parse(String(event.data)) } catch { return }
        if (msg.id !== 1) return
        clearTimeout(timer)
        if (msg.error || !msg.result?.data) {
          reject(new Error(JSON.stringify(msg.error ?? 'no-data')))
          return
        }
        resolve(msg.result.data)
      })
      ws.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png', fromSurface: true } }))
    })
    const { mkdir, writeFile } = await import('node:fs/promises')
    const pathMod = await import('node:path')
    await mkdir(pathMod.dirname(dest), { recursive: true })
    await writeFile(dest, Buffer.from(data, 'base64'))
    return { ok: true, path: dest, url: scope.url }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  } finally {
    try { ws.close() } catch { /* ignore */ }
  }
}

export async function installedUiProbe(needles: string[]): Promise<{
  ok: boolean
  hits: string[]
  url: string | null
  address: string | null
  body: string
  mediaWindow: boolean
  mediaTabs: string[]
  headline: string | null
}> {
  const evaluated = await cdpEvaluate<{
    url?: string
    address?: string | null
    body?: string
    mediaWindow?: boolean
    mediaTabs?: string[]
    headline?: string | null
  }>(`
    (() => {
      const address = document.querySelector('[data-testid="war-room-browser-address"]');
      const tabs = Array.from(document.querySelectorAll('[data-testid^="media-tab-"]')).map(el => (el.textContent || '').replace(/\\s+/g, ' ').trim());
      const headline = document.querySelector('[data-testid="foundry-commander-status"], [data-testid="foundry-status-headline"], [data-testid="foundry-provider-rail"]');
      return {
        url: location.href,
        address: address instanceof HTMLInputElement ? address.value : (address?.textContent || null),
        body: (document.body?.innerText || '').slice(0, 12000),
        mediaWindow: Boolean(document.querySelector('[data-testid="media-window"]')),
        mediaTabs: tabs,
        headline: (headline?.textContent || '').replace(/\\s+/g, ' ').trim() || null,
      };
    })()
  `)
  if (!evaluated.ok || !evaluated.value) {
    return { ok: false, hits: [], url: null, address: null, body: '', mediaWindow: false, mediaTabs: [], headline: null }
  }
  const body = String(evaluated.value.body ?? '')
  const haystack = `${body}\n${evaluated.value.address ?? ''}\n${evaluated.value.headline ?? ''}`.toLowerCase()
  const hits = needles.filter(needle => haystack.includes(needle.toLowerCase()))
  return {
    ok: true,
    hits,
    url: evaluated.value.url ?? null,
    address: evaluated.value.address ?? null,
    body,
    mediaWindow: evaluated.value.mediaWindow === true,
    mediaTabs: evaluated.value.mediaTabs ?? [],
    headline: evaluated.value.headline ?? null,
  }
}

export async function clickAccessibleInInstalledUi(input: {
  name: string
  role?: string
  within?: string
  missionId?: string | null
  tool?: string
  expectedNextState?: string
}): Promise<{
  ok: boolean
  channel: 'ELECTRON_CDP'
  reason?: string
  tag?: string
  label?: string
  count?: number
  originClass?: string
}> {
  const name = String(input.name ?? '').trim()
  const expected = input.expectedNextState || name
  if (!name) {
    await record({ missionId: input.missionId, tool: input.tool ?? 'computer.click', name, actionType: 'REJECTED', expectedNextState: expected, success: false })
    return { ok: false, channel: 'ELECTRON_CDP', reason: 'empty-name' }
  }
  const evaluated = await cdpEvaluate<{ ok?: boolean; reason?: string; tag?: string; label?: string; count?: number }>(`
    (() => {
      const wanted = ${JSON.stringify(name)}.trim().toLowerCase();
      const role = ${JSON.stringify(input.role || '')}.trim().toLowerCase();
      const within = ${JSON.stringify(input.within || '')}.trim().toLowerCase();
      const nodes = Array.from(document.querySelectorAll('button, [role="button"], a[href], input, textarea, select, [aria-label], [data-testid]'));
      const matches = nodes.filter(el => {
        const label = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase();
        const testId = (el.getAttribute('data-testid') || '').toLowerCase();
        const roleName = (el.getAttribute('role') || el.tagName).toLowerCase();
        const nameOk = label === wanted || label.replace(/^\\+\\s*/, '') === wanted;
        const roleOk = !role || roleName.includes(role) || (role === 'button' && el.tagName === 'BUTTON') || (role === 'link' && el.tagName === 'A') || (role === 'entry' && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'));
        if (wanted === 'new session' && testId === 'foundry-new-session') return roleOk;
        if ((wanted === 'foundry' || wanted === 'the foundry') && /^nav-foundry/.test(testId)) return roleOk;
        if ((wanted === 'back to war room' || wanted === 'war room') && testId === 'war-room-back-control') return roleOk;
        if (within) {
          const card = el.closest('[data-testid="foundry-project-list"] > div, .rounded-lg, [data-testid="war-room-browser"], [data-testid="media-window"], [data-testid="foundry-real-terminal"]');
          const blob = ((card || el.parentElement)?.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase();
          if (!blob.includes(within) && !((el.getAttribute('aria-label') || '').toLowerCase().includes(within))) return false;
        }
        return nameOk && roleOk;
      });
      const visible = matches.find(el => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width >= 1 && rect.height >= 1 && style.visibility !== 'hidden' && style.display !== 'none';
      }) || matches[0];
      if (!visible) return { ok: false, reason: 'not-in-dom', count: matches.length };
      visible.focus({ preventScroll: false });
      visible.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse', buttons: 1 }));
      visible.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, buttons: 1 }));
      visible.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerType: 'mouse', buttons: 0 }));
      visible.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, buttons: 0 }));
      visible.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      if (typeof visible.click === 'function') visible.click();
      return { ok: true, tag: visible.tagName, label: visible.getAttribute('aria-label') || wanted, count: matches.length };
    })()
  `)
  if (!evaluated.ok) {
    await record({ missionId: input.missionId, tool: input.tool ?? 'computer.click', name, actionType: 'REJECTED', expectedNextState: expected, success: false, pageOriginClass: evaluated.reason })
    return { ok: false, channel: 'ELECTRON_CDP', reason: evaluated.reason }
  }
  const result = evaluated.value
  const ok = result?.ok === true
  await record({
    missionId: input.missionId,
    tool: input.tool ?? 'computer.click',
    name,
    actionType: 'ACTIVATE',
    expectedNextState: expected,
    success: ok,
    pageOriginClass: evaluated.scope.originClass,
  })
  return {
    ok,
    channel: 'ELECTRON_CDP',
    reason: result?.reason,
    tag: result?.tag,
    label: result?.label,
    count: result?.count,
    originClass: evaluated.scope.originClass,
  }
}

export async function typeAccessibleInInstalledUi(input: {
  name?: string
  text: string
  missionId?: string | null
}): Promise<{ ok: boolean; channel: 'ELECTRON_CDP'; reason?: string }> {
  const text = String(input.text ?? '')
  const evaluated = await cdpEvaluate<{ ok?: boolean; reason?: string }>(`
    (() => {
      const wanted = ${JSON.stringify(input.name || 'Session title')}.trim().toLowerCase();
      const text = ${JSON.stringify(text)};
      const nodes = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]'));
      const el = nodes.find(node => (node.getAttribute('aria-label') || node.getAttribute('title') || '').trim().toLowerCase() === wanted)
        || (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement ? document.activeElement : null);
      if (!el) return { ok: false, reason: 'no-textbox' };
      el.focus();
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(el, text);
      else el.value = text;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: text, inputType: 'insertText' }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    })()
  `)
  if (!evaluated.ok) return { ok: false, channel: 'ELECTRON_CDP', reason: evaluated.reason }
  const ok = evaluated.value?.ok === true
  await record({
    missionId: input.missionId,
    tool: 'computer.type',
    name: input.name || 'Session title',
    actionType: 'TYPE',
    expectedNextState: input.name || 'Session title',
    success: ok,
    pageOriginClass: evaluated.scope.originClass,
  })
  return { ok, channel: 'ELECTRON_CDP', reason: evaluated.value?.reason }
}

export async function selectAllAccessibleInInstalledUi(name = 'Session title', missionId?: string | null): Promise<{ ok: boolean; channel: 'ELECTRON_CDP' }> {
  const evaluated = await cdpEvaluate<{ ok?: boolean }>(`
    (() => {
      const wanted = ${JSON.stringify(name)}.trim().toLowerCase();
      const el = Array.from(document.querySelectorAll('input, textarea')).find(node => (node.getAttribute('aria-label') || '').trim().toLowerCase() === wanted)
        || document.activeElement;
      if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return { ok: false };
      el.focus();
      el.select();
      return { ok: true };
    })()
  `)
  const ok = evaluated.ok && evaluated.value?.ok === true
  await record({
    missionId,
    tool: 'computer.key',
    name,
    actionType: 'SELECT',
    expectedNextState: name,
    success: ok,
    pageOriginClass: evaluated.ok ? evaluated.scope.originClass : 'REJECTED',
  })
  return { ok, channel: 'ELECTRON_CDP' }
}

export async function domHasAccessibleName(name: string): Promise<boolean> {
  const evaluated = await cdpEvaluate<boolean>(`
    (() => {
      const wanted = ${JSON.stringify(name)}.trim().toLowerCase();
      return Array.from(document.querySelectorAll('button, [role="button"], a, input, textarea, [aria-label], p, span')).some(el => {
        const label = (el.getAttribute('aria-label') || el.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase();
        return label === wanted || label.replace(/^\\+\\s*/, '') === wanted;
      });
    })()
  `)
  return evaluated.ok && evaluated.value === true
}
