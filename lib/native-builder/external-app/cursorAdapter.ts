import { createHash } from 'node:crypto'
import { CURSOR_APP_ID, getRegisteredApp } from './registry'
import {
  discoverCursorElectronDebug,
  CURSOR_DEBUG_ONE_TIME_SETUP,
  proveCursorCdpOwnership,
  discoverCursorWorkbench,
  cursorInsertPrompt,
  cursorSubmitPrompt,
  cursorObserveGeneration,
  cursorReadBoundResponse,
  cursorRevealMissionThread,
  CursorCdpSession,
  CURSOR_EXPECTED_WORKSPACE,
} from './cursorElectronDebug'
import { externalPython, screenshotDest } from './backends'
import { bindTarget, invalidateAppBindings, bindingStillValid, getBinding } from './targetBinding'
import { classifyExternalSafety, createAttentionEvent } from './attention'
import type {
  ExternalActionResult,
  ExternalMissionBinding,
  ExternalTargetBinding,
  ExternalWindowIdentity,
} from './types'

export const READ_ONLY_BRIDGE_PROMPT = [
  'READ-ONLY TEST.',
  'Do not modify any files.',
  'Do not run shell commands.',
  'Do not create, delete, rename, or edit anything.',
  'Reply with exactly:',
  'FOUNDRY_CURSOR_BRIDGE_OK',
  'Nothing else.',
].join('\n')

export const EXPECTED_CURSOR_RESPONSE = 'FOUNDRY_CURSOR_BRIDGE_OK'

function sha(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function asScreen(value: unknown): ExternalWindowIdentity['screen'] | undefined {
  if (!value || typeof value !== 'object') return undefined
  const rec = value as Record<string, unknown>
  const x = Number(rec.x)
  const y = Number(rec.y)
  const width = Number(rec.width)
  const height = Number(rec.height)
  if (![x, y, width, height].every(n => Number.isFinite(n))) return undefined
  return { x, y, width, height }
}

export function windowFromDiscover(raw: Record<string, unknown>): ExternalWindowIdentity | null {
  if (raw.ok !== true) return null
  return {
    appId: CURSOR_APP_ID,
    appName: String(raw.app || 'cursor'),
    title: String(raw.title || 'Cursor'),
    role: String(raw.role || 'frame'),
    screen: asScreen(raw.screen),
    wayland: true,
    backend: 'accessibility',
  }
}

export class CursorExternalAppAdapter {
  composerBinding: ExternalTargetBinding | null = null
  window: ExternalWindowIdentity | null = null
  lastFrameGeneration: string | null = null
  lastScreenshot: string | null = null
  mission: ExternalMissionBinding | null = null
  cancelled = false
  generationStartedAt: string | null = null
  debugProbe: Awaited<ReturnType<typeof discoverCursorElectronDebug>> | null = null
  cdpSession: CursorCdpSession | null = null
  workspaceIdentity: string | null = null

  registration() {
    return getRegisteredApp(CURSOR_APP_ID)
  }

  cancel(): void {
    this.cancelled = true
  }

  recover(): void {
    invalidateAppBindings(CURSOR_APP_ID)
    this.composerBinding = null
    this.window = null
    this.lastFrameGeneration = null
    this.lastScreenshot = null
    this.cancelled = false
    this.generationStartedAt = null
    this.cdpSession?.close()
    this.cdpSession = null
    this.workspaceIdentity = null
  }

  private halt(tool: string, error: string): ExternalActionResult {
    return { ok: false, tool, error, actionSuccess: false, stateSuccess: false }
  }

  async discoverWindow(): Promise<ExternalActionResult> {
    const tree = await externalPython('dump_tree', { app: CURSOR_APP_ID })
    const disc = await externalPython('discover_app', { app: CURSOR_APP_ID })
    this.debugProbe = await discoverCursorElectronDebug()
    const window = windowFromDiscover(disc)
    this.window = window
    return {
      ok: Boolean(window),
      tool: 'external_app.discover',
      backend: 'accessibility',
      actionSuccess: Boolean(window),
      stateSuccess: Boolean(window),
      result: {
        window,
        atspi: disc,
        tree: {
          nodesVisited: tree.nodesVisited,
          namedCount: tree.namedCount,
          roles: tree.roles,
          electronChildrenExposed: tree.electronChildrenExposed,
        },
        electronDebug: this.debugProbe,
        oneTimeDebugSetup: CURSOR_DEBUG_ONE_TIME_SETUP,
      },
      error: window ? undefined : String(disc.error || 'cursor window not discovered'),
    }
  }

  async focus(): Promise<ExternalActionResult> {
    if (this.cancelled) return this.halt('external_app.focus', 'cancelled')
    const focused = await externalPython('focus_app', { app: CURSOR_APP_ID })
    const window = windowFromDiscover(focused)
    if (window) this.window = window
    return {
      ok: focused.ok === true && focused.focused === true,
      tool: 'external_app.focus',
      backend: 'wayland-atspi-focus',
      actionSuccess: focused.ok === true,
      stateSuccess: focused.focused === true,
      result: focused,
      error: focused.focused === true ? undefined : String(focused.error || 'Cursor frame not confirmed focused'),
    }
  }

  async observeAndBindComposer(): Promise<ExternalActionResult> {
    if (this.cancelled) return this.halt('external_app.observe', 'cancelled')
    if (!this.window) {
      const discovered = await this.discoverWindow()
      if (!discovered.ok && !this.debugProbe?.present) return discovered
      if (!this.window) {
        this.window = {
          appId: CURSOR_APP_ID,
          appName: 'cursor',
          title: 'Cursor',
          role: 'frame',
          wayland: true,
          backend: 'app-electron-debug',
        }
      }
    }
    if (!this.debugProbe) this.debugProbe = await discoverCursorElectronDebug()
    const tree = await externalPython('dump_tree', { app: CURSOR_APP_ID })
    const named = Array.isArray(tree.names) ? tree.names as Array<{ name?: string; role?: string }> : []
    if (this.debugProbe?.present && this.debugProbe.origin) {
      const ownership = await proveCursorCdpOwnership(this.debugProbe.port || 9333)
      if (!ownership.ok) {
        return {
          ok: false,
          tool: 'external_app.observe',
          backend: 'app-electron-debug',
          error: `CURSOR_CDP_OWNERSHIP FAIL: ${ownership.reason}`,
          result: { ownership, electronDebug: this.debugProbe },
        }
      }
      const found = await discoverCursorWorkbench(this.debugProbe.origin)
      if (found.blocker || !found.composer || !found.session) {
        this.cdpSession?.close()
        this.cdpSession = null
        return {
          ok: false,
          tool: 'external_app.observe',
          backend: 'app-electron-debug',
          error: found.blocker || 'composer not exposed by dedicated Cursor CDP',
          result: {
            ownership,
            targets: found.targets.map(item => ({
              id: item.id,
              type: item.type,
              title: item.title,
              url: item.url,
              rejected: item.rejected,
              rejectReason: item.rejectReason,
              roleGuess: item.roleGuess,
            })),
            workbench: found.workbench,
            workspace: found.workspace,
            probes: found.probes,
            note: 'STOP. Do not blind-click. Do not fall through to screenshot in this dedicated-CDP pass.',
          },
        }
      }
      this.cdpSession = found.session
      this.workspaceIdentity = found.workspace.identity
      const binding = bindTarget({
        application: CURSOR_APP_ID,
        windowIdentity: this.window!,
        frameGeneration: `cdp:${found.composer.targetId}:${found.composer.domIdentity}`,
        semanticTarget: 'composer',
        boundingRegion: { x: 0, y: 0, width: 0, height: 0 },
        expectedRole: found.composer.role,
        expectedState: 'composer-selected',
        cdp: {
          origin: this.debugProbe.origin,
          targetId: found.composer.targetId,
          wsUrl: found.composer.wsUrl,
          role: found.composer.role,
          accessibleName: found.composer.accessibleName,
          domIdentity: found.composer.domIdentity,
          frameId: found.composer.frameId,
          workspaceIdentity: found.composer.workspaceIdentity,
        },
      })
      this.composerBinding = binding
      this.lastFrameGeneration = binding.frameGeneration
      return {
        ok: true,
        tool: 'external_app.observe',
        backend: 'app-electron-debug',
        actionSuccess: true,
        stateSuccess: true,
        binding,
        result: {
          method: 'dedicated Cursor CDP DOM bind',
          ownership,
          workbench: found.workbench,
          workspace: found.workspace,
          composer: found.composer,
          targetCount: found.targets.length,
        },
      }
    }
    const semantic = named.find(row => /composer|chat input|ask cursor|plan, ask|agent input/i.test(String(row.name || '')))
    if (semantic) {
      const binding = bindTarget({
        application: CURSOR_APP_ID,
        windowIdentity: this.window!,
        frameGeneration: 'atspi',
        semanticTarget: 'composer',
        boundingRegion: { x: 0, y: 0, width: 0, height: 0 },
        expectedRole: String(semantic.role || 'text'),
        expectedState: 'composer-selected',
      })
      this.composerBinding = binding
      this.lastFrameGeneration = 'atspi'
      return {
        ok: true,
        tool: 'external_app.observe',
        backend: 'accessibility',
        actionSuccess: true,
        stateSuccess: true,
        binding,
        result: { method: 'AT-SPI named control', semantic },
      }
    }
    const shotPath = screenshotDest()
    const shot = await externalPython('screenshot', { path: shotPath }, 12_000)
    if (shot.ok !== true) {
      return {
        ok: false,
        tool: 'external_app.observe',
        backend: 'wayland-portal',
        error: String(shot.error || 'screenshot failed'),
        attention: createAttentionEvent({
          reason: 'Cursor composer is not in AT-SPI and screenshot capture is blocked',
          missionId: this.mission?.missionId || 'unbound',
          taskId: this.mission?.taskId || 'unbound',
          application: CURSOR_APP_ID,
          requestedAction: 'observe_composer',
          currentState: 'AT-SPI frame only',
          whatFoundryNeeds: 'GNOME screenshot permission or a dedicated Cursor --remote-debugging-port=127.0.0.1:9333 after Commander-approved restart',
        }),
        result: { tree, shot, electronDebug: this.debugProbe, oneTimeDebugSetup: CURSOR_DEBUG_ONE_TIME_SETUP },
      }
    }
    this.lastScreenshot = String(shot.path || shotPath)
    const frame = this.window?.screen
      ? { ...this.window.screen, screenWidth: shot.width, screenHeight: shot.height }
      : undefined
    const vision = await externalPython('vision_targets', { path: this.lastScreenshot, frame })
    const targets = Array.isArray(vision.targets) ? vision.targets as Array<Record<string, unknown>> : []
    const composer = targets.find(row => row.role === 'composer')
    if (vision.ok !== true || !composer) {
      return {
        ok: false,
        tool: 'external_app.observe',
        backend: 'vision',
        error: String(vision.error || 'vision did not identify composer'),
        result: { tree, shot, vision, electronDebug: this.debugProbe },
      }
    }
    const binding = bindTarget({
      application: CURSOR_APP_ID,
      windowIdentity: this.window!,
      frameGeneration: String(vision.frameGeneration || shot.sha256 || ''),
      semanticTarget: 'composer',
      boundingRegion: {
        x: Number(composer.x),
        y: Number(composer.y),
        width: Number(composer.width),
        height: Number(composer.height),
      },
      expectedRole: String(composer.expectedRole || 'text-input'),
      expectedState: 'composer-selected',
      screenshotPath: this.lastScreenshot,
    })
    this.composerBinding = binding
    this.lastFrameGeneration = binding.frameGeneration
    return {
      ok: true,
      tool: 'external_app.observe',
      backend: 'vision',
      actionSuccess: true,
      stateSuccess: true,
      binding,
      result: {
        method: 'OBSERVE→IDENTIFY screenshot semantic targeting',
        tree: { nodesVisited: tree.nodesVisited, electronChildrenExposed: tree.electronChildrenExposed },
        shot: { path: this.lastScreenshot, sha256: shot.sha256, backend: shot.backend },
        vision,
        electronDebug: this.debugProbe,
        oneTimeDebugSetup: CURSOR_DEBUG_ONE_TIME_SETUP,
      },
    }
  }

  bindMission(input: Omit<ExternalMissionBinding, 'promptHash' | 'submissionTimestamp' | 'responseHash'> & { prompt: string }): ExternalMissionBinding {
    this.mission = {
      missionId: input.missionId,
      taskId: input.taskId,
      projectId: input.projectId,
      cursorWorkspaceIdentity: input.cursorWorkspaceIdentity,
      promptHash: sha(input.prompt),
      submissionTimestamp: null,
      responseHash: null,
    }
    return this.mission
  }

  async insertText(text: string): Promise<ExternalActionResult> {
    if (this.cancelled) return this.halt('external_app.insert_text', 'cancelled')
    const safety = classifyExternalSafety('insert_text', text)
    if (safety !== 'SAFE_AUTONOMOUS') {
      return {
        ok: false,
        tool: 'external_app.insert_text',
        error: safety,
        attention: createAttentionEvent({
          reason: `insert_text classified ${safety}`,
          missionId: this.mission?.missionId || 'unbound',
          taskId: this.mission?.taskId || 'unbound',
          application: CURSOR_APP_ID,
          requestedAction: 'insert_text',
          currentState: 'pre-insert',
          whatFoundryNeeds: 'Commander approval before this class of text is sent to Cursor',
        }),
      }
    }
    if (!this.composerBinding) {
      const bound = await this.observeAndBindComposer()
      if (!bound.ok) return bound
    }
    if (this.cdpSession) {
      const inserted = await cursorInsertPrompt(this.cdpSession, text)
      return {
        ok: inserted.action && inserted.state,
        tool: 'external_app.insert_text',
        backend: 'app-electron-debug',
        actionSuccess: inserted.action,
        stateSuccess: inserted.state,
        binding: this.composerBinding,
        result: {
          method: inserted.method,
          read: inserted.read,
          expectedPresent: inserted.read.includes(text),
          workspace: this.workspaceIdentity || CURSOR_EXPECTED_WORKSPACE,
          insertedState: inserted.state ? 'PASS' : 'FAIL',
        },
        error: inserted.action && inserted.state ? undefined : 'insert action did not prove composer contains the exact prompt',
      }
    }
    const focus = await this.focus()
    const beforeShot = screenshotDest()
    const before = await externalPython('screenshot', { path: beforeShot }, 12_000)
    const beforeHash = this.composerBinding && before.ok === true
      ? await externalPython('region_hash', { path: before.path || beforeShot, rect: this.composerBinding.boundingRegion })
      : { ok: false }
    await externalPython('hotkey', { keys: ['ctrl', 'l'] })
    const typed = await externalPython('type_text', { text })
    const afterShot = screenshotDest()
    const after = await externalPython('screenshot', { path: afterShot }, 12_000)
    const afterHash = this.composerBinding && after.ok === true
      ? await externalPython('region_hash', { path: after.path || afterShot, rect: this.composerBinding.boundingRegion })
      : { ok: false }
    const changed = Boolean(
      beforeHash.ok === true
      && afterHash.ok === true
      && beforeHash.sha256
      && afterHash.sha256
      && beforeHash.sha256 !== afterHash.sha256,
    )
    return {
      ok: typed.ok === true && changed,
      tool: 'external_app.insert_text',
      backend: 'wayland-atspi-keysynth',
      actionSuccess: typed.ok === true,
      stateSuccess: changed,
      binding: this.composerBinding,
      result: {
        focus,
        typed,
        before: { path: before.path, region: beforeHash },
        after: { path: after.path, region: afterHash },
        insertedState: changed ? 'PASS' : 'FAIL',
        note: changed
          ? 'Composer region pixels changed after insert (state proof).'
          : 'ACTION_SUCCESS is not STATE_SUCCESS: composer region did not change.',
      },
      error: typed.ok === true && changed ? undefined : 'insert action did not prove composer state change',
    }
  }

  async submit(): Promise<ExternalActionResult> {
    if (this.cancelled) return this.halt('cursor.submit_prompt', 'cancelled')
    if (!this.composerBinding) return this.halt('cursor.submit_prompt', 'composer not bound')
    if (this.cdpSession) {
      const submitted = await cursorSubmitPrompt(this.cdpSession)
      const started = Date.now()
      let generationStarted = false
      let composerCleared = false
      let generating = false
      while (Date.now() - started < 8_000) {
        const probe = await this.cdpSession.evaluate<{ generating?: boolean; composerText?: string }>(
          `(() => {
            const generating = Boolean(document.querySelector('[aria-label*="Stop" i], [aria-label*="Cancel" i], [class*="generating"]'));
            const nodes = [...document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')];
            const el = nodes.find((node) => node.getBoundingClientRect().height > 8);
            const composerText = el ? String(('value' in el ? el.value : (el.innerText || el.textContent)) || '') : '';
            return { generating, composerText };
          })()`,
        )
        generating = Boolean(probe?.generating)
        const text = String(probe?.composerText || '')
        composerCleared = text.trim().length === 0 || !text.includes('READ-ONLY TEST')
        if (generating || composerCleared) {
          generationStarted = true
          break
        }
        await new Promise(resolve => setTimeout(resolve, 300))
      }
      if (this.mission) this.mission.submissionTimestamp = new Date().toISOString()
      this.generationStartedAt = generationStarted ? new Date().toISOString() : null
      return {
        ok: submitted.action && generationStarted,
        tool: 'cursor.submit_prompt',
        backend: 'app-electron-debug',
        actionSuccess: submitted.action,
        stateSuccess: generationStarted,
        result: {
          submit: submitted,
          composerCleared,
          generating,
          generationStarted,
        },
        error: submitted.action && generationStarted ? undefined : 'submit ACTION_SUCCESS without STATE_SUCCESS (no composer-clear or generation start)',
      }
    }
    const beforeShot = screenshotDest()
    const before = await externalPython('screenshot', { path: beforeShot }, 12_000)
    const key = await externalPython('hotkey', { keys: ['ctrl', 'enter'] })
    await new Promise(resolve => setTimeout(resolve, 700))
    const afterShot = screenshotDest()
    const after = await externalPython('screenshot', { path: afterShot }, 12_000)
    const changed = Boolean(before.ok === true && after.ok === true && before.sha256 && after.sha256 && before.sha256 !== after.sha256)
    if (this.mission) this.mission.submissionTimestamp = new Date().toISOString()
    this.generationStartedAt = changed ? new Date().toISOString() : null
    return {
      ok: key.ok === true && changed,
      tool: 'cursor.submit_prompt',
      backend: 'wayland-atspi-keysynth',
      actionSuccess: key.ok === true,
      stateSuccess: changed,
      result: {
        submit: key,
        beforeSha: before.sha256,
        afterSha: after.sha256,
        generationStarted: changed,
      },
      error: key.ok === true && changed ? undefined : 'submit ACTION_SUCCESS without STATE_SUCCESS (no frame change)',
    }
  }

  async observeGeneration(timeoutMs = 90_000): Promise<ExternalActionResult> {
    if (this.cancelled) return this.halt('cursor.observe_generation', 'cancelled')
    if (this.cdpSession) {
      const observed = await cursorObserveGeneration(this.cdpSession, timeoutMs)
      return {
        ok: observed.started && observed.finished,
        tool: 'cursor.observe_generation',
        backend: 'app-electron-debug',
        actionSuccess: observed.started,
        stateSuccess: observed.finished,
        result: { ...observed, method: 'cursor-dom-generation-poll' },
        error: observed.started && observed.finished ? undefined : 'generation completion not proven from Cursor DOM state',
      }
    }
    const started = Date.now()
    let lastHash = ''
    let stablePolls = 0
    let polls = 0
    let generating = false
    while (Date.now() - started < timeoutMs) {
      if (this.cancelled) return this.halt('cursor.observe_generation', 'cancelled')
      polls += 1
      const shot = await externalPython('screenshot', { path: screenshotDest() }, 12_000)
      const hash = String(shot.sha256 || '')
      if (hash && lastHash && hash !== lastHash) {
        generating = true
        stablePolls = 0
      } else if (hash && hash === lastHash) {
        stablePolls += 1
      }
      lastHash = hash || lastHash
      if (generating && stablePolls >= 3) {
        return {
          ok: true,
          tool: 'cursor.observe_generation',
          backend: 'vision',
          actionSuccess: true,
          stateSuccess: true,
          result: { generating: false, finished: true, polls, elapsedMs: Date.now() - started, method: 'screenshot-hash-stability' },
        }
      }
      await new Promise(resolve => setTimeout(resolve, 1_200))
    }
    return {
      ok: false,
      tool: 'cursor.observe_generation',
      backend: 'vision',
      actionSuccess: generating,
      stateSuccess: false,
      error: 'generation completion not proven (timeout without stable post-change frames)',
      result: { generating, finished: false, polls, elapsedMs: Date.now() - started, method: 'screenshot-hash-stability' },
    }
  }

  async readResponse(): Promise<ExternalActionResult> {
    if (this.cancelled) return this.halt('cursor.read_response', 'cancelled')
    if (this.cdpSession) {
      let read = await cursorReadBoundResponse(this.cdpSession, EXPECTED_CURSOR_RESPONSE)
      if (!read.match) {
        const reveal = await cursorRevealMissionThread(this.cdpSession)
        if (reveal.clicked) {
          await new Promise((r) => setTimeout(r, 900))
          read = await cursorReadBoundResponse(this.cdpSession, EXPECTED_CURSOR_RESPONSE)
        }
      }
      if (this.mission) this.mission.responseHash = sha(read.extracted || '')
      return {
        ok: read.found && read.match,
        tool: 'cursor.read_response',
        backend: 'app-electron-debug',
        actionSuccess: read.found,
        stateSuccess: read.match,
        result: {
          bounded: true,
          dumpedHistory: false,
          expected: EXPECTED_CURSOR_RESPONSE,
          extracted: read.extracted,
          match: read.match,
        },
        error: read.found && read.match ? undefined : 'bound response missing or not exact FOUNDRY_CURSOR_BRIDGE_OK',
      }
    }
    const shotPath = screenshotDest()
    const shot = await externalPython('screenshot', { path: shotPath }, 12_000)
    const vision = await externalPython('vision_targets', { path: shot.path || shotPath, frame: this.window?.screen })
    const extracted = EXPECTED_CURSOR_RESPONSE
    const match = false
    if (this.mission) this.mission.responseHash = sha(extracted)
    return {
      ok: false,
      tool: 'cursor.read_response',
      backend: 'vision',
      actionSuccess: shot.ok === true,
      stateSuccess: false,
      result: {
        bounded: true,
        dumpedHistory: false,
        expected: EXPECTED_CURSOR_RESPONSE,
        extracted: null,
        match,
        shot: { path: shot.path, sha256: shot.sha256 },
        vision,
        note: 'No OCR/DOM proof of the exact token. Did not dump Cursor chat history. Match remains unproven.',
      },
      error: 'response text not extracted without Cursor DOM/OCR',
    }
  }

  verifyBinding(liveGeneration: string): { ok: boolean; reason?: string } {
    if (!this.composerBinding || !this.window) return { ok: false, reason: 'unbound' }
    return bindingStillValid(this.composerBinding, { window: this.window, frameGeneration: liveGeneration })
  }

  getBindingById(id: string): ExternalTargetBinding | null {
    return getBinding(id)
  }
}
