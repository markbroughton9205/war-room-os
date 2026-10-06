/**
 * Real Playwright Chromium proofs for the shared Browser Broker.
 */
import { pathToFileURL } from 'node:url'
import { createServer, type Server } from 'node:http'
import { existsSync } from 'node:fs'
import { getBrowserBroker } from './broker'
import { runCouncilBrowserResearch } from './councilClient'
import { executeFoundryBrowserTool } from '@/lib/native-builder/foundryBrowserService'
import { classifyBrowserAction } from './actionClassifier'
import { playwrightTmpDir } from './paths'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

async function startFixture(): Promise<{ origin: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const url = req.url ?? '/'
    if (url.startsWith('/b')) {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<!doctype html><html><head><title>Session B</title></head><body><h1>SESSION_B</h1><div id="seen"></div><script>document.getElementById("seen").textContent=document.cookie+"|"+String(localStorage.getItem("wr-iso")||"")</script></body></html>')
      return
    }
    if (url.startsWith('/submit')) {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<!doctype html><html><head><title>Submit</title></head><body><form id="ext" action="/posted" method="post"><button type="submit">submit</button></form></body></html>')
      return
    }
    if (url.startsWith('/download')) {
      res.writeHead(200, { 'content-type': 'text/plain', 'content-disposition': 'attachment; filename="broker-download.txt"' })
      res.end('broker-download-ok')
      return
    }
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<!doctype html><html><head><title>Session A</title></head><body><h1>SESSION_A</h1><script>document.cookie="wr-iso=session-a; path=/";localStorage.setItem("wr-iso","session-a");console.log("broker-local-a")</script></body></html>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise(resolve => server.close(() => resolve())),
  }
}

async function run() {
  const results: CaseResult[] = []
  const add = (batch: CaseResult[]) => {
    results.push(...batch)
    for (const item of batch) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} ${item.detail}`)
  }
  const broker = getBrowserBroker()
  const fixture = await startFixture()
  try {
    const started = await broker.start()
    add([check('bb_01_lifecycle_start', started.ok && broker.getHealth() === 'READY', JSON.stringify(started))])
    add([check('bb_02_chromium_pid', started.ok && typeof started.result.pid === 'number' && started.result.pid > 1, JSON.stringify(started))])

    const sessionA = await broker.createSession({ owner: 'council', allowLocalhost: true })
    const sessionB = await broker.createSession({ owner: 'council', allowLocalhost: true })
    add([check('bb_03_session_a', sessionA.ok, JSON.stringify(sessionA))])
    add([check('bb_04_session_b', sessionB.ok && sessionA.ok && sessionA.result.sessionId !== sessionB.result.sessionId, JSON.stringify(sessionB))])

    if (sessionA.ok) {
      const nav = await broker.navigate({ owner: 'council', sessionId: sessionA.result.sessionId, url: `${fixture.origin}/` })
      add([check('bb_05_navigate', nav.ok && nav.result.title.includes('Session A'), JSON.stringify(nav))])
      const extracted = await broker.extract(sessionA.result.sessionId)
      add([check('bb_06_extract', extracted.ok && extracted.result.readableText.includes('SESSION_A'), extracted.ok ? extracted.result.title : extracted.error)])
      const shot = await broker.screenshot(sessionA.result.sessionId)
      add([check('bb_07_screenshot', shot.ok && existsSync(shot.result.path), JSON.stringify(shot))])
      const citation = await broker.cite(sessionA.result.sessionId)
      add([check(
        'bb_08_citation',
        citation.ok && Boolean(citation.result.url && citation.result.finalUrl && citation.result.pageTitle && citation.result.sessionId && citation.result.tabId && citation.result.evidence && citation.result.timestamp),
        JSON.stringify(citation),
      )])
      const cons = await broker.consoleLog(sessionA.result.sessionId)
      add([check('bb_09_console', cons.ok && cons.result.entries.some(entry => entry.text.includes('broker-local-a')), JSON.stringify(cons.ok ? cons.result.entries.slice(0, 3) : cons))])
    }

    if (sessionA.ok && sessionB.ok) {
      await broker.navigate({ owner: 'council', sessionId: sessionB.result.sessionId, url: `${fixture.origin}/b` })
      const seen = await broker.extract(sessionB.result.sessionId)
      const leak = seen.ok && /session-a/i.test(seen.result.readableText)
      add([check('bb_10_isolation', seen.ok && !leak, seen.ok ? seen.result.readableText.slice(0, 200) : seen.error)])
    }

    const gated = await broker.submit({ owner: 'council', sessionId: sessionA.ok ? sessionA.result.sessionId : '', selector: '#ext' })
    add([check('bb_11_approval_gate', !gated.ok && gated.verdict === 'ACTION_REQUIRES_APPROVAL', JSON.stringify(gated))])
    add([check(
      'bb_11b_classifier',
      classifyBrowserAction({ kind: 'submit', owner: 'council' }).verdict === 'ACTION_REQUIRES_APPROVAL',
      'classifier',
    )])

    const foundryStart = await executeFoundryBrowserTool('browser.start', {}, { repairId: 'broker-live' })
    add([check('bb_12_foundry_client', foundryStart.ok, JSON.stringify(foundryStart.result ?? foundryStart.error))])
    const foundryNav = await executeFoundryBrowserTool('browser.navigate', { url: `${fixture.origin}/` }, { repairId: 'broker-live' })
    add([check('bb_13_foundry_localhost', foundryNav.ok, JSON.stringify(foundryNav.result ?? foundryNav.error))])
    const foundryText = await executeFoundryBrowserTool('browser.get_text', {}, { repairId: 'broker-live' })
    add([check('bb_14_foundry_text', foundryText.ok && String((foundryText.result as { text?: string })?.text ?? '').includes('SESSION_A'), JSON.stringify(foundryText.result ?? foundryText.error))])

    const coreBefore = await fetch('http://127.0.0.1:3847/api/local/health', { signal: AbortSignal.timeout(4_000) }).then(res => res.status).catch(() => 0)
    const uiBefore = await fetch('http://127.0.0.1:3848/login', { signal: AbortSignal.timeout(4_000), redirect: 'manual' }).then(res => res.status).catch(() => 0)

    const loginSession = await broker.createSession({ owner: 'foundry', allowLocalhost: true })
    add([check('shot_login_session', loginSession.ok, JSON.stringify(loginSession))])
    if (loginSession.ok) {
      const loginNav = await broker.navigate({ owner: 'foundry', sessionId: loginSession.result.sessionId, url: 'http://127.0.0.1:3848/login' })
      add([check('shot_login_nav', loginNav.ok === true && /login/i.test(String(loginNav.ok ? loginNav.result.finalUrl : '')), JSON.stringify(loginNav))])
      const loginViewport = await broker.screenshot(loginSession.result.sessionId, undefined, { fullPage: false, repairId: 'broker-live' })
      add([check('shot_login_viewport', loginViewport.ok && existsSync(loginViewport.ok ? loginViewport.result.path : ''), JSON.stringify(loginViewport))])
      const stillUpAfterViewport = broker.isRunning()
      add([check('shot_login_viewport_continuity', stillUpAfterViewport, JSON.stringify(broker.diagnostics()))])
      const loginFull = await broker.screenshot(loginSession.result.sessionId, undefined, { fullPage: true, repairId: 'broker-live' })
      add([check('shot_login_fullpage', loginFull.ok && existsSync(loginFull.ok ? loginFull.result.path : ''), JSON.stringify(loginFull))])
      add([check('shot_login_fullpage_continuity', broker.isRunning(), broker.getHealth())])
      const homeNav = await broker.navigate({ owner: 'foundry', sessionId: loginSession.result.sessionId, url: 'http://127.0.0.1:3848/' })
      add([check('shot_then_navigate', homeNav.ok === true, JSON.stringify(homeNav))])
      const homeText = await broker.extract(loginSession.result.sessionId)
      add([check('SCREENSHOT-1', loginViewport.ok && existsSync(loginViewport.ok ? loginViewport.result.path : ''), 'installed login viewport')])
      add([check('SCREENSHOT-2', loginFull.ok && existsSync(loginFull.ok ? loginFull.result.path : ''), 'installed login full-page safe capture')])
      add([check('SCREENSHOT-3', homeNav.ok === true && homeText.ok, 'post-screenshot navigation')])
      const homeShot = await broker.screenshot(loginSession.result.sessionId, undefined, { fullPage: false, repairId: 'broker-live' })
      add([check('shot_home_viewport', homeShot.ok && existsSync(homeShot.ok ? homeShot.result.path : ''), JSON.stringify(homeShot))])
      const homeShot2 = await broker.screenshot(loginSession.result.sessionId, undefined, { fullPage: false, repairId: 'broker-live' })
      add([check('shot_repeat_same_session', homeShot2.ok && broker.isRunning(), JSON.stringify(homeShot2))])
      const secondSession = await broker.createSession({ owner: 'foundry', allowLocalhost: true })
      if (secondSession.ok) {
        await broker.navigate({ owner: 'foundry', sessionId: secondSession.result.sessionId, url: 'http://127.0.0.1:3848/login' })
        const otherShot = await broker.screenshot(secondSession.result.sessionId, undefined, { fullPage: false, repairId: 'broker-live' })
        add([check('shot_repeat_separate_session', otherShot.ok, JSON.stringify(otherShot))])
        await broker.closeSession(secondSession.result.sessionId).catch(() => undefined)
      } else {
        add([check('shot_repeat_separate_session', false, JSON.stringify(secondSession))])
      }
    }

    const foundryLogin = await executeFoundryBrowserTool('browser.navigate', { url: 'http://127.0.0.1:3848/' }, { repairId: 'broker-live' })
    const foundryShot = await executeFoundryBrowserTool('browser.screenshot', { fullPage: false }, { repairId: 'broker-live' })
    add([check('foundry_login_or_home_nav', foundryLogin.ok, JSON.stringify(foundryLogin.result ?? foundryLogin.error))])
    add([check('foundry_screenshot', foundryShot.ok, JSON.stringify(foundryShot.result ?? foundryShot.error))])
    add([check('foundry_after_shot_alive', broker.isRunning(), broker.getHealth())])

    const coreAfterShot = await fetch('http://127.0.0.1:3847/api/local/health', { signal: AbortSignal.timeout(4_000) }).then(res => res.status).catch(() => 0)
    const uiAfterShot = await fetch('http://127.0.0.1:3848/login', { signal: AbortSignal.timeout(4_000), redirect: 'manual' }).then(res => res.status).catch(() => 0)
    add([check('core_survived_screenshots', coreBefore > 0 && coreAfterShot > 0, JSON.stringify({ coreBefore, coreAfterShot }))])
    add([check('ui_survived_screenshots', uiBefore > 0 && uiAfterShot > 0, JSON.stringify({ uiBefore, uiAfterShot }))])
    add([check('playwright_tmp_off_slash_tmp', playwrightTmpDir().startsWith('/run/user/') && !playwrightTmpDir().startsWith('/tmp/'), playwrightTmpDir())])

    const fileDenied = await broker.navigate({
      owner: 'council',
      sessionId: sessionA.ok ? sessionA.result.sessionId : '',
      url: 'file:///etc/passwd',
    })
    add([check('bb_15_file_denied', !fileDenied.ok, JSON.stringify(fileDenied))])

    const diag = broker.diagnostics()
    add([check('bb_16_diagnostics', diag.brokerState === 'READY' && diag.chromiumState === 'RUNNING' && diag.activeSessions >= 2, JSON.stringify({ state: diag.brokerState, sessions: diag.activeSessions, pid: diag.chromiumPid }))])

    const pid = broker.chromiumPid()
    add([check('bb_17_pid_owned', typeof pid === 'number' && pid > 1, String(pid))])
    if (typeof pid === 'number' && pid > 1) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch (error) {
        add([check('bb_18_kill_owned_pid', false, error instanceof Error ? error.message : String(error))])
      }
      await new Promise(resolve => setTimeout(resolve, 800))
      const afterKill = broker.diagnostics()
      add([check(
        'BROWSER-STATUS-3',
        afterKill.chromiumState === 'CRASHED' || afterKill.brokerState === 'OFFLINE' || afterKill.chromiumState === 'STOPPED' || !broker.isRunning(),
        JSON.stringify(afterKill),
      )])
      const recovered = await broker.ensureStarted()
      add([check('bb_19_recovery', recovered.ok && broker.isRunning() && (broker.getHealth() === 'READY' || broker.getHealth() === 'DEGRADED' || broker.getHealth() === 'RECOVERING'), JSON.stringify({ recovered, health: broker.getHealth() }))])
      const sessionC = await broker.createSession({ owner: 'council', allowLocalhost: true })
      const navAfter = sessionC.ok
        ? await broker.navigate({ owner: 'council', sessionId: sessionC.result.sessionId, url: `${fixture.origin}/` })
        : { ok: false, error: 'no session' }
      add([check('bb_20_request_after_recovery', navAfter.ok === true, JSON.stringify(navAfter))])
      const shotAfterCrash = sessionC.ok ? await broker.screenshot(sessionC.result.sessionId) : { ok: false, error: 'no session' }
      add([check('SCREENSHOT-5', shotAfterCrash.ok === true && broker.isRunning(), JSON.stringify(shotAfterCrash))])
      const coreAfterCrash = await fetch('http://127.0.0.1:3847/api/local/health', { signal: AbortSignal.timeout(4_000) }).then(res => res.status).catch(() => 0)
      const uiAfterCrash = await fetch('http://127.0.0.1:3848/login', { signal: AbortSignal.timeout(4_000), redirect: 'manual' }).then(res => res.status).catch(() => 0)
      add([check('core_survived_crash_recovery', coreAfterCrash > 0, String(coreAfterCrash))])
      add([check('ui_survived_crash_recovery', uiAfterCrash > 0, String(uiAfterCrash))])
    }

    const research = await runCouncilBrowserResearch({
      query: 'Research the current official documentation for Playwright browser contexts and compare how isolated contexts differ from persistent browser profiles. Use multiple sources and return evidence with source URLs and titles.',
      maxSources: 2,
      budgetMs: 80_000,
    })
    add([check('bb_21_council_research_ok', research.ok && research.sources.length >= 2, JSON.stringify({ ok: research.ok, sources: research.sources.map(s => ({ title: s.title, url: s.finalUrl })), error: research.error, ms: research.durationMs }))])
    add([check(
      'bb_22_council_citations',
      research.citations.length >= 2 && research.sources.every(source => /^https?:\/\//.test(source.finalUrl) && source.title),
      JSON.stringify(research.citations.map(c => ({ title: c.pageTitle, url: c.finalUrl }))),
    )])
    add([check('bb_23_council_synthesis', research.synthesis.length > 80, research.synthesis.slice(0, 180))])
    add([check('research_after_screenshot_ready', broker.isRunning() && (broker.getHealth() === 'READY' || broker.diagnostics().screenshotCapability === true), JSON.stringify(broker.diagnostics()))])

    const isoA = await broker.createSession({ owner: 'council', allowLocalhost: true })
    const isoB = await broker.createSession({ owner: 'council', allowLocalhost: true })
    if (isoA.ok && isoB.ok) {
      await broker.navigate({ owner: 'council', sessionId: isoA.result.sessionId, url: `${fixture.origin}/` })
      await broker.setStorageMarker(isoA.result.sessionId, undefined, 'wr-iso', 'session-a')
      await broker.screenshot(isoA.result.sessionId).catch(() => undefined)
      await broker.navigate({ owner: 'council', sessionId: isoB.result.sessionId, url: `${fixture.origin}/b` })
      const afterShotIso = await broker.peekStorageMarker(isoB.result.sessionId, undefined, 'wr-iso')
      const leaked = afterShotIso.ok && /session-a/i.test(`${afterShotIso.result.cookie}|${afterShotIso.result.localStorage}|${afterShotIso.result.sessionStorage}`)
      add([check('isolation_after_screenshot', afterShotIso.ok && !leaked, JSON.stringify(afterShotIso))])
    } else {
      add([check('isolation_after_screenshot', false, JSON.stringify({ isoA, isoB }))])
    }
    const gatedAfter = await broker.submit({ owner: 'council', sessionId: isoA.ok ? isoA.result.sessionId : '', selector: '#ext' })
    add([check('approval_after_screenshot', !gatedAfter.ok && gatedAfter.verdict === 'ACTION_REQUIRES_APPROVAL', JSON.stringify(gatedAfter))])
  } finally {
    await executeFoundryBrowserTool('browser.stop', {}, { repairId: 'broker-live' }).catch(() => undefined)
    await getBrowserBroker().stop().catch(() => undefined)
    await fixture.close()
  }
  const failed = results.filter(item => !item.pass)
  console.log(`browser broker live-acceptance: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run()
}

export { run as runBrowserBrokerLiveAcceptance }
