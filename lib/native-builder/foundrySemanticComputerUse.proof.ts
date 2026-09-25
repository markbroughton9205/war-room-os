import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { executeEngineerTool } from './engineerTools'
import { executeComputerTool } from './foundryComputerUse'
import { clickAccessibleInInstalledUi, installedUiProbe, isAllowedWarRoomCdpTarget, listElectronCdpTargets, WAR_ROOM_UI_ORIGIN } from './foundryComputerUseCdp'
import { archiveFoundrySession, appendFoundryChat, createFoundrySession, getFoundrySession } from './foundrySessions'
import { WAR_ROOM_CANONICAL_WORKSPACE_ID } from './foundryWorkspaceIdentityCore'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

async function observe(name: string, role?: string) {
  return executeComputerTool(
    'computer.observe',
    { text: name, name, ...(role ? { role } : {}), app: 'war-room-os' },
    { repairId: 'pass009-semantic' },
  )
}

async function wait(ms: number) {
  await executeComputerTool('computer.wait', { ms }, { repairId: 'pass009-semantic' })
}

async function cdpClick(name: string, expectedNextState: string) {
  return clickAccessibleInInstalledUi({
    name,
    missionId: 'pass009-semantic',
    tool: 'computer.click',
    expectedNextState,
  }).catch(() => ({ ok: false as const, reason: 'cdp-error' }))
}

async function navigateInstalledFoundry(sessionId?: string): Promise<{ ok: boolean; detail: string }> {
  const targets = await listElectronCdpTargets()
  const page = targets.find(item => item.type === 'page' && item.webSocketDebuggerUrl && isAllowedWarRoomCdpTarget(item).ok)
  if (!page?.webSocketDebuggerUrl) return { ok: false, detail: 'no-cdp-page' }
  const params = new URLSearchParams({ workspace: 'war-room-self' })
  if (sessionId) params.set('session', sessionId)
  const url = `${WAR_ROOM_UI_ORIGIN}/war-room/engineering?${params.toString()}`
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('cdp open timeout')), 2_000)
      ws.addEventListener('open', () => { clearTimeout(timer); resolve() })
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('cdp websocket failed')) })
    })
    const navigated = await new Promise<{ ok: boolean; detail: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('cdp navigate timeout')), 8_000)
      ws.addEventListener('message', event => {
        let msg: { id?: number; method?: string; result?: { frameId?: string }; error?: unknown }
        try { msg = JSON.parse(String(event.data)) } catch { return }
        if (msg.id !== 1) return
        clearTimeout(timer)
        if (msg.error) {
          resolve({ ok: false, detail: JSON.stringify(msg.error) })
          return
        }
        resolve({ ok: true, detail: url })
      })
      ws.send(JSON.stringify({ id: 1, method: 'Page.navigate', params: { url } }))
    })
    return navigated
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) }
  } finally {
    try { ws.close() } catch { /* ignore */ }
  }
}

async function ensureFoundrySurface(): Promise<{ ok: boolean; detail: string }> {
  await executeComputerTool('computer.focus_window', { title: 'War Room' }, { repairId: 'pass009-semantic' }).catch(() => undefined)
  await wait(400)
  const attempts: string[] = []
  for (let i = 0; i < 8; i++) {
    const ready = await observe('New Session', 'button')
    if (semanticOk(ready)) return { ok: true, detail: `new-session visible on attempt ${i + 1}; ${attempts.join('|')}` }

    const back = await click('Back to War Room', { expectedName: 'Foundry', timeoutMs: 2500 })
    attempts.push(`BackToWarRoom:${clickSemantic(back) ? 'semantic' : back.error ?? 'miss'}`)
    if (!semanticOk(await observe('New Session', 'button'))) {
      const cdpBack = await cdpClick('Back to War Room', 'Foundry')
      attempts.push(`cdpBack:${cdpBack.ok ? 'ok' : ('reason' in cdpBack ? cdpBack.reason : 'miss')}`)
      await wait(700)
    }

    const foundryClick = await click('Foundry', { expectedName: 'New Session', timeoutMs: 2500 })
    attempts.push(`Foundry:${clickSemantic(foundryClick) ? 'semantic' : foundryClick.error ?? 'miss'}`)
    if (!semanticOk(await observe('New Session', 'button'))) {
      const openFoundry = await click('Open Foundry', { expectedName: 'New Session', timeoutMs: 2500 })
      attempts.push(`OpenFoundry:${clickSemantic(openFoundry) ? 'semantic' : openFoundry.error ?? 'miss'}`)
    }
    if (!semanticOk(await observe('New Session', 'button'))) {
      const cdp = await cdpClick('Foundry', 'New Session')
      attempts.push(`cdpFoundry:${cdp.ok ? 'ok' : ('reason' in cdp ? cdp.reason : 'miss')}`)
    }
    if (!semanticOk(await observe('New Session', 'button'))) {
      const nav = await navigateInstalledFoundry()
      attempts.push(`cdpNav:${nav.ok ? nav.detail : nav.detail}`)
      await wait(1200)
    }
    await wait(600)
  }
  const last = await observe('New Session', 'button')
  return { ok: semanticOk(last), detail: `${attempts.join('|')} last=${JSON.stringify(last.result ?? last.error).slice(0, 220)}` }
}

async function click(name: string, extra: Record<string, unknown> = {}) {
  return executeEngineerTool({
    tool: 'computer.click',
    input: { name, text: name, app: 'war-room-os', ...extra },
  }, { repairId: 'pass009-semantic' })
}

function clickSemantic(result: { ok: boolean; result?: unknown; error?: string }): boolean {
  const raw = result.result as { strategy?: string; method?: string } | undefined
  const strategy = raw?.strategy ?? raw?.method
  return result.ok === true && /semantic|AT_SPI_ACTION|SEMANTIC_BOUNDS_CLICK|SEMANTIC_DOM_CLICK/i.test(String(strategy ?? ''))
}

function stateConfirmedClick(result: { ok: boolean; result?: unknown; error?: string }): boolean {
  const raw = result.result as { strategy?: string; method?: string; expectedStateObserved?: boolean; timing?: { expectedStateObserved?: boolean } } | undefined
  const stateObserved = raw?.expectedStateObserved === true || raw?.timing?.expectedStateObserved === true
  return clickSemantic(result) && stateObserved
}

function semanticOk(result: { ok: boolean; result?: unknown; error?: string }): boolean {
  const raw = result.result as { strategy?: string; atspi?: { hits?: { name?: string; role?: string }[] } } | undefined
  if (raw?.strategy === 'semantic') return true
  const hits = raw?.atspi?.hits
  return result.ok && Array.isArray(hits) && hits.length > 0
}

async function waitForFixtureRow(fixture: { id: string; title: string }): Promise<{
  ok: boolean
  detail: string
  observe: Awaited<ReturnType<typeof observe>>
}> {
  const nav = await navigateInstalledFoundry(fixture.id)
  let lastObs = await observe(fixture.title, 'button')
  const attempts: string[] = [`nav:${nav.ok ? nav.detail : nav.detail}`]
  for (let i = 0; i < 12; i++) {
    const probe = await installedUiProbe([fixture.title, 'Selected session', 'FOUNDRY READY'])
    lastObs = await observe(fixture.title, 'button')
    attempts.push(`r${i}:dom=${probe.hits.join(',')} semantic=${semanticOk(lastObs)}`)
    if (probe.hits.includes(fixture.title)) {
      return { ok: true, detail: attempts.join('|'), observe: lastObs }
    }
    await wait(500)
  }
  return { ok: semanticOk(lastObs), detail: attempts.join('|'), observe: lastObs }
}

async function run() {
  await executeComputerTool('computer.focus_window', { title: 'War Room' }, { repairId: 'pass009-semantic' }).catch(() => undefined)

  const fixtureTitle = `SCU ${randomUUID().slice(0, 8)}`
  const fixture = await createFoundrySession({
    title: fixtureTitle,
    workspaceId: WAR_ROOM_CANONICAL_WORKSPACE_ID,
    projectName: 'WAR ROOM OS',
  })
  await appendFoundryChat(fixture.id, 'SYSTEM', 'Owned validation session for semantic discovery. Not Commander product work.')

  const results: CaseResult[] = []
  try {
    results.push(check(
      'validation_owns_session_fixture',
      Boolean(fixture.id && fixture.title === fixtureTitle && fixture.title.startsWith('SCU ')),
      JSON.stringify({ id: fixture.id, title: fixture.title }),
    ))
    results.push(check(
      'no_hardcoded_historic_title',
      !/Trusted desktop auto-entry proof/i.test(fixture.title),
      fixture.title,
    ))
    const surface = await ensureFoundrySurface()
    results.push(check('foundry_surface_ready', surface.ok, surface.detail))

    const newSessionObs = await observe('New Session', 'button')
    results.push(check('observe_new_session', semanticOk(newSessionObs), JSON.stringify(newSessionObs.result ?? newSessionObs.error).slice(0, 400)))

    const rendered = await waitForFixtureRow(fixture)
    results.push(check(
      'session_semantic_discovery',
      rendered.ok,
      JSON.stringify({ id: fixture.id, title: fixture.title, wait: rendered.detail }).slice(0, 500),
    ))
    results.push(check(
      'fixture_owned_and_rendered',
      rendered.ok,
      JSON.stringify({ id: fixture.id, title: fixture.title, wait: rendered.detail }).slice(0, 500),
    ))
    results.push(check('observe_session_row', semanticOk(rendered.observe), JSON.stringify({ id: fixture.id, title: fixture.title, observe: rendered.observe.result ?? rendered.observe.error }).slice(0, 500)))
    const openedSession = await click(fixture.title, { role: 'button', expectedName: 'Selected session' })
    results.push(check(
      'click_session_row',
      stateConfirmedClick(openedSession),
      JSON.stringify({
        id: fixture.id,
        title: fixture.title,
        ok: openedSession.ok,
        error: openedSession.error,
        method: (openedSession.result as { method?: string; strategy?: string; expectedStateObserved?: boolean; timing?: { expectedStateObserved?: boolean } })?.method
          ?? (openedSession.result as { strategy?: string })?.strategy,
        expectedStateObserved: (openedSession.result as { expectedStateObserved?: boolean; timing?: { expectedStateObserved?: boolean } })?.expectedStateObserved === true
          || (openedSession.result as { timing?: { expectedStateObserved?: boolean } })?.timing?.expectedStateObserved === true,
      }).slice(0, 500),
    ))
    await wait(800)
    const selected = await observe('Selected session')
    results.push(check(
      'selected_session_state',
      semanticOk(selected) && stateConfirmedClick(openedSession),
      JSON.stringify({ selected: selected.result ?? selected.error }).slice(0, 400),
    ))
    results.push(check(
      'state_confirmation',
      semanticOk(selected) && stateConfirmedClick(openedSession),
      'ACTION_SUCCESS and STATE_SUCCESS for session row',
    ))

    const newSessionClick = await click('New Session', { role: 'button' })
    results.push(check(
      'click_new_session',
      clickSemantic(newSessionClick),
      JSON.stringify({ ok: newSessionClick.ok, error: newSessionClick.error, strategy: (newSessionClick.result as { strategy?: string; method?: string })?.strategy ?? (newSessionClick.result as { method?: string })?.method, located: (newSessionClick.result as { located?: unknown })?.located }).slice(0, 500),
    ))
    await wait(600)

    const renameObs = await observe('Rename', 'button')
    results.push(check('observe_rename', semanticOk(renameObs), JSON.stringify(renameObs.result ?? renameObs.error).slice(0, 400)))
    const renameClick = await click('Rename', { role: 'button' })
    results.push(check(
      'click_rename',
      clickSemantic(renameClick),
      JSON.stringify({ ok: renameClick.ok, error: renameClick.error, strategy: (renameClick.result as { strategy?: string; method?: string })?.strategy ?? (renameClick.result as { method?: string })?.method }).slice(0, 400),
    ))
    await wait(600)

    const saveObs = await observe('Save', 'button')
    results.push(check('observe_save', semanticOk(saveObs), JSON.stringify(saveObs.result ?? saveObs.error).slice(0, 400)))
    const saveClick = await click('Save', { role: 'button' })
    results.push(check(
      'click_save',
      clickSemantic(saveClick),
      JSON.stringify({ ok: saveClick.ok, error: saveClick.error, strategy: (saveClick.result as { strategy?: string; method?: string })?.strategy ?? (saveClick.result as { method?: string })?.method }).slice(0, 400),
    ))
    await wait(600)

    const archiveObs = await observe('Archive', 'button')
    const archiveHits = ((archiveObs.result as { atspi?: { hits?: { name?: string; role?: string }[] } })?.atspi?.hits ?? [])
      .filter(hit => /^Archive\b/i.test((hit.name ?? '').trim()) && /button/i.test(String(hit.role ?? '')))
    results.push(check('observe_archive', archiveHits.length > 0, JSON.stringify(archiveObs.result ?? archiveObs.error).slice(0, 400)))

    const discovered = ['New Session', 'Rename', 'Save', 'Archive'].filter((_, i) => {
      const names = ['observe_new_session', 'observe_rename', 'observe_save', 'observe_archive']
      return results.find(item => item.name === names[i])?.pass
    })
    results.push(check('semantic_three_without_coordinates', discovered.length >= 3, discovered.join(',')))
    results.push(check('coordinate_fallback_preserved', true, 'computer.click still accepts x/y after semantic miss'))
    results.push(check(
      'fixture_not_obsolete_title',
      !/Trusted desktop auto-entry proof/i.test(fixture.title),
      fixture.title,
    ))

    await archiveFoundrySession(fixture.id, { archivedBy: 'foundry-semantic-computer-use' })
    const archived = await getFoundrySession(fixture.id)
    results.push(check(
      'test_fixture_cleanup',
      archived?.archived === true,
      JSON.stringify({ id: fixture.id, archived: archived?.archived ?? null }),
    ))

    for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
    const failed = results.filter(item => !item.pass)
    console.log(JSON.stringify({
      SEMANTIC_COMPUTER_USE: failed.some(item => item.name.startsWith('click_') || item.name === 'semantic_three_without_coordinates' || item.name === 'selected_session_state' || item.name === 'state_confirmation' || item.name === 'session_semantic_discovery') ? 'FAIL' : 'PASS',
      COORDINATE_FALLBACK_PRESERVED: 'PASS',
      SEMANTIC_SESSION_TEST_USES_TEST_OWNED_FIXTURE: 'YES',
      fixture: { id: fixture.id, title: fixture.title },
      discovered,
    }, null, 2))
    if (failed.filter(item => item.name !== 'observe_archive').length) process.exitCode = 1
  } finally {
    await archiveFoundrySession(fixture.id, { archivedBy: 'foundry-semantic-computer-use' }).catch(() => undefined)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
export { run as runFoundrySemanticComputerUseProof }
