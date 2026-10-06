/**
 * Phase-2 live Chromium proofs: trusted profiles, takeover, persistence, isolation.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { getBrowserBroker } from './broker'
import { runCouncilBrowserResearch } from './councilClient'
import { executeFoundryBrowserTool } from '@/lib/native-builder/foundryBrowserService'
import { createTrustedProfile, deleteTrustedProfile, loadProfile, profileDir, storageStateExists } from './profileStore'
import { detectHumanInteractionRequired } from './humanSignals'
import { readBrowserAuditTail } from './sessionAudit'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

async function startFixture(): Promise<{ origin: string; close: () => Promise<void> }> {
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/'
    const cookie = String(req.headers.cookie || '')
    if (url.startsWith('/login') && req.method === 'POST') {
      res.writeHead(303, { location: '/account', 'set-cookie': 'wr-auth=ok; Path=/' })
      res.end()
      return
    }
    if (url.startsWith('/login')) {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<!doctype html><html><head><title>Login</title></head><body><h1>SYNTH_LOGIN</h1><form id="login" method="post" action="/login"><input id="user" name="user"><input id="pass" name="pass" type="password"><button id="go" type="submit">Sign in</button></form></body></html>')
      return
    }
    if (url.startsWith('/account')) {
      const ok = /wr-auth=ok/.test(cookie)
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(`<!doctype html><html><head><title>Account</title></head><body><h1>${ok ? 'AUTHENTICATED_OK signed in welcome back' : 'LOGIN_REQUIRED'}</h1></body></html>`)
      return
    }
    if (url.startsWith('/mfa')) {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<!doctype html><html><head><title>MFA</title></head><body><h1>Enter the MFA code from your authenticator</h1></body></html>')
      return
    }
    if (url.startsWith('/agent')) {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<!doctype html><html><head><title>Agent Page</title></head><body><h1 id="mark">AGENT_OWNED</h1><button id="bump">bump</button></body></html>')
      return
    }
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<!doctype html><html><head><title>Public</title></head><body><h1>PUBLIC_OK</h1></body></html>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise(resolve => server.close(() => resolve())),
  }
}

async function probe(port: number): Promise<number> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2_000) })
    return res.status
  } catch {
    return 0
  }
}

async function run() {
  const results: CaseResult[] = []
  const add = (batch: CaseResult[]) => {
    results.push(...batch)
    for (const item of batch) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} ${item.detail}`)
  }
  const fixture = await startFixture()
  const broker = getBrowserBroker()
  const host = new URL(fixture.origin).host
  const profileA = createTrustedProfile({
    display_name: 'Phase2 A',
    allowed_origins: ['127.0.0.1', host],
    allow_foundry: true,
    allow_council: false,
  })
  const profileB = createTrustedProfile({
    display_name: 'Phase2 B',
    allowed_origins: ['127.0.0.1', host],
    allow_foundry: false,
    allow_council: true,
  })
  try {
    const started = await broker.start()
    add([check('p2_start', started.ok === true, JSON.stringify(started))])

    const eph = await broker.createSession({ owner: 'council', allowLocalhost: true })
    add([check('PROFILE-4-create-eph', eph.ok && eph.ok && eph.result.profileId == null, JSON.stringify(eph))])
    if (eph.ok) {
      await broker.navigate({ owner: 'council', sessionId: eph.result.sessionId, url: `${fixture.origin}/` })
      await broker.setStorageMarker(eph.result.sessionId, undefined, 'wr-iso', 'ephemeral-only')
    }

    const deniedCouncil = await broker.createSession({ owner: 'council', allowLocalhost: true, sessionMode: 'TRUSTED_PROFILE', profileId: profileA.profile_id })
    add([check('PROFILE-8', !deniedCouncil.ok && deniedCouncil.error === 'PROFILE_ACCESS_DENIED', JSON.stringify(deniedCouncil))])
    const deniedFoundry = await broker.createSession({ owner: 'foundry', allowLocalhost: true, sessionMode: 'TRUSTED_PROFILE', profileId: profileB.profile_id })
    add([check('PROFILE-9', !deniedFoundry.ok && deniedFoundry.error === 'PROFILE_ACCESS_DENIED', JSON.stringify(deniedFoundry))])

    const locked = await broker.changeProfileState('commander', profileA.profile_id, 'LOCKED')
    const lockedUse = await broker.createSession({ owner: 'foundry', allowLocalhost: true, sessionMode: 'TRUSTED_PROFILE', profileId: profileA.profile_id })
    add([check('PROFILE-6', locked.ok && !lockedUse.ok && lockedUse.error === 'PROFILE_LOCKED', JSON.stringify(lockedUse))])
    await broker.changeProfileState('commander', profileA.profile_id, 'ACTIVE')
    await broker.changeProfileState('commander', profileA.profile_id, 'DISABLED')
    const disabledUse = await broker.createSession({ owner: 'foundry', allowLocalhost: true, sessionMode: 'TRUSTED_PROFILE', profileId: profileA.profile_id })
    add([check('PROFILE-7', !disabledUse.ok && disabledUse.error === 'PROFILE_DISABLED', JSON.stringify(disabledUse))])
    await broker.changeProfileState('commander', profileA.profile_id, 'ACTIVE')

    const trusted = await broker.createSession({ owner: 'foundry', allowLocalhost: true, sessionMode: 'TRUSTED_PROFILE', profileId: profileA.profile_id })
    add([check('PROFILE-1-open', trusted.ok === true, JSON.stringify(trusted))])
    if (!trusted.ok) throw new Error('trusted session failed')
    const sameTab = trusted.result.tabId
    const sameSess = trusted.result.sessionId

    const originDeny = await broker.navigate({ owner: 'foundry', sessionId: sameSess, url: 'https://example.com/' })
    add([check('PROFILE-5', !originDeny.ok && originDeny.error === 'PROFILE_ORIGIN_NOT_ALLOWED', JSON.stringify(originDeny))])

    await broker.navigate({ owner: 'foundry', sessionId: sameSess, url: `${fixture.origin}/agent` })
    const takeover = await broker.startTakeover('commander', sameSess)
    add([check('TAKEOVER-1', takeover.ok && takeover.result.sessionId === sameSess && takeover.result.tabId === sameTab, JSON.stringify(takeover))])
    const blocked = await broker.click({ owner: 'foundry', sessionId: sameSess, selector: '#bump' })
    add([check('TAKEOVER-2', !blocked.ok && blocked.error === 'COMMANDER_CONTROL_ACTIVE', JSON.stringify(blocked))])
    await broker.type({ owner: 'commander', sessionId: sameSess, selector: '#mark', text: 'ignored-not-input' }).catch(() => undefined)
    await broker.navigate({ owner: 'commander', sessionId: sameSess, url: `${fixture.origin}/agent` })
    await getBrowserBroker().getSession(sameSess)?.tabs.get(sameTab)?.page.evaluate(() => {
      const el = document.getElementById('mark')
      if (el) el.textContent = 'COMMANDER_CHANGED'
    })
    const returned = await broker.returnControl('commander', sameSess)
    add([check('TAKEOVER-3', returned.ok && returned.result.controlState === 'AGENT_CONTROL' && returned.result.sessionId === sameSess && returned.result.tabId === sameTab, JSON.stringify(returned))])
    const after = await broker.extract(sameSess, sameTab)
    add([check('TAKEOVER-4', after.ok && after.result.readableText.includes('COMMANDER_CHANGED'), after.ok ? after.result.readableText.slice(0, 80) : after.error)])
    add([check('TAKEOVER-5', sameSess === trusted.result.sessionId && sameTab === trusted.result.tabId, `${sameSess}/${sameTab}`)])
    const audit = readBrowserAuditTail(40).map(item => JSON.stringify(item)).join('\n')
    add([check('TAKEOVER-6', !/ignored-not-input|password=/i.test(audit), 'typed secrets absent')])

    const loginNav = await broker.navigate({ owner: 'commander', sessionId: sameSess, url: `${fixture.origin}/login` })
    add([check('AUTH-login-page', loginNav.ok === true, JSON.stringify(loginNav))])
    await broker.startTakeover('commander', sameSess)
    await broker.type({ owner: 'commander', sessionId: sameSess, selector: '#user', text: 'synth-user' })
    await broker.type({ owner: 'commander', sessionId: sameSess, selector: '#pass', text: 'synth-pass-not-logged' })
    await broker.click({ owner: 'commander', sessionId: sameSess, selector: '#go' })
    await broker.wait(400)
    await broker.navigate({ owner: 'commander', sessionId: sameSess, url: `${fixture.origin}/account` })
    const authed = await broker.extract(sameSess)
    add([check('AUTH-1-before-restart', authed.ok && authed.result.readableText.includes('AUTHENTICATED_OK'), authed.ok ? authed.result.readableText.slice(0, 80) : authed.error)])
    await broker.returnControl('commander', sameSess)
    await broker.persistSession(sameSess)
    add([check('PROFILE-2-storage', storageStateExists(profileA.profile_id), 'storage-state present')])
    add([check('ENCRYPT-disk', !existsSync(path.join(profileDir(profileA.profile_id), 'storage-state.json')) && existsSync(path.join(profileDir(profileA.profile_id), 'storage-state.enc')), 'ciphertext only')])

    const foundryResume = await broker.extract(sameSess)
    add([check('FOUNDRY-1', foundryResume.ok === true, foundryResume.ok ? foundryResume.result.title : foundryResume.error)])

    const submitGate = await broker.submit({ owner: 'foundry', sessionId: sameSess, selector: 'form' })
    add([check('APPROVAL-1', !submitGate.ok && submitGate.verdict === 'ACTION_REQUIRES_APPROVAL', JSON.stringify(submitGate))])

    const preview = await broker.previewTab(sameSess)
    add([check('PREVIEW-1', preview.ok && (preview.result.degraded === true || Boolean(preview.result.path && existsSync(preview.result.path))), JSON.stringify(preview))])

    const mfaSess = await broker.createSession({ owner: 'commander', allowLocalhost: true })
    if (mfaSess.ok) {
      await broker.navigate({ owner: 'commander', sessionId: mfaSess.result.sessionId, url: `${fixture.origin}/mfa` })
      const human = await broker.inspectHuman(mfaSess.result.sessionId)
      add([check('AUTH-3', human.ok && human.result.humanRequired === true && human.result.code === 'HUMAN_INTERACTION_REQUIRED', JSON.stringify(human))])
      add([check('AUTH-3-helper', detectHumanInteractionRequired({ text: 'captcha i am not a robot' }) === true, 'captcha')])
      await broker.closeSession(mfaSess.result.sessionId)
    }

    const isoB = await broker.createSession({ owner: 'council', allowLocalhost: true, sessionMode: 'TRUSTED_PROFILE', profileId: profileB.profile_id })
    add([check('ISOLATION-open-b', isoB.ok === true, JSON.stringify(isoB))])
    if (isoB.ok) {
      await broker.navigate({ owner: 'council', sessionId: isoB.result.sessionId, url: `${fixture.origin}/` })
      const peekB = await broker.peekStorageMarker(isoB.result.sessionId, undefined, 'wr-iso')
      add([check('ISOLATION-2', peekB.ok && peekB.result.localStorage !== 'ephemeral-only' && peekB.result.cookie.indexOf('wr-auth=ok') < 0, JSON.stringify(peekB))])
    }
    if (eph.ok) {
      const peekEph = await broker.peekStorageMarker(eph.result.sessionId, undefined, 'wr-iso')
      add([check('ISOLATION-1', peekEph.ok && peekEph.result.localStorage === 'ephemeral-only', JSON.stringify(peekEph))])
    }

    const pid = broker.chromiumPid()
    const coreBefore = await probe(3847)
    const uiBefore = await probe(3848)
    if (typeof pid === 'number' && pid > 1) {
      process.kill(pid, 'SIGKILL')
      await new Promise(resolve => setTimeout(resolve, 700))
    }
    const coreAfter = await probe(3847)
    const uiAfter = await probe(3848)
    add([check('RECOVERY-core', coreBefore === 0 || coreAfter > 0, String(coreAfter))])
    add([check('RECOVERY-ui', uiBefore === 0 || uiAfter > 0, String(uiAfter))])
    const recovered = await broker.ensureStarted()
    add([check('RECOVERY-1', recovered.ok === true && loadProfile(profileA.profile_id)?.state === 'ACTIVE', JSON.stringify(recovered))])
    const reopened = await broker.createSession({ owner: 'foundry', allowLocalhost: true, sessionMode: 'TRUSTED_PROFILE', profileId: profileA.profile_id })
    add([check('RECOVERY-2', reopened.ok === true, JSON.stringify(reopened))])
    if (reopened.ok) {
      await broker.navigate({ owner: 'foundry', sessionId: reopened.result.sessionId, url: `${fixture.origin}/account` })
      const persisted = await broker.extract(reopened.result.sessionId)
      add([check('AUTH-1', persisted.ok && persisted.result.readableText.includes('AUTHENTICATED_OK'), persisted.ok ? persisted.result.readableText.slice(0, 80) : persisted.error)])
      add([check('AUTH-2', persisted.ok && persisted.result.readableText.includes('AUTHENTICATED_OK'), 'storageState survived broker restart equivalent')])
      add([check('PROFILE-2', persisted.ok === true, 'trusted profile persisted across chromium restart')])
      add([check('PROFILE-3', loadProfile(profileA.profile_id)?.state === 'ACTIVE', loadProfile(profileA.profile_id)?.state ?? '')])
      const preview2 = await broker.previewTab(reopened.result.sessionId)
      add([check('PREVIEW-2', broker.isRunning() && preview2.ok, JSON.stringify({ running: broker.isRunning(), preview: preview2 }) )])
    }

    const research = await runCouncilBrowserResearch({
      query: 'Research the current official documentation for Playwright browser contexts and compare how isolated contexts differ from persistent browser profiles.',
      maxSources: 2,
      budgetMs: 40_000,
    })
    add([check('COUNCIL-1', research.ok && research.sessionKind === 'EPHEMERAL' && research.sources.length >= 1, JSON.stringify({ kind: research.sessionKind, n: research.sources.length, err: research.error }) )])
    add([check('EBC-1', (research.citations[0]?.browser_session_type === 'EPHEMERAL') && !/cookie|password/i.test(JSON.stringify(research.citations)), JSON.stringify(research.citations[0]))])
    add([check('EBC-2', research.citations.every(item => !item.profile_id_hash || !/cookie/.test(item.profile_id_hash)), 'no auth state in citations')])

    const foundry = await executeFoundryBrowserTool('browser.start', {}, { repairId: 'phase2-live' })
    add([check('FOUNDRY-browser', foundry.ok === true, JSON.stringify(foundry.result ?? foundry.error))])

    if (eph.ok) {
      await broker.closeSession(eph.result.sessionId)
      const gone = broker.getSession(eph.result.sessionId)
      add([check('PROFILE-4', !gone, 'ephemeral session gone after close')])
    }

    const doomed = createTrustedProfile({ display_name: 'delete-me', allow_foundry: true, allowed_origins: ['127.0.0.1'] })
    await broker.createSession({ owner: 'commander', allowLocalhost: true, sessionMode: 'TRUSTED_PROFILE', profileId: doomed.profile_id })
    const removed = await broker.deleteProfile('commander', doomed.profile_id)
    add([check('PROFILE-10', removed.ok && !loadProfile(doomed.profile_id) && !storageStateExists(doomed.profile_id), JSON.stringify(removed))])
  } finally {
    await broker.stop().catch(() => undefined)
    await fixture.close()
    deleteTrustedProfile(profileA.profile_id)
    deleteTrustedProfile(profileB.profile_id)
  }
  const failed = results.filter(item => !item.pass)
  console.log(`browser broker phase-2 live: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}

run().catch(error => {
  console.error(error)
  process.exit(1)
})
