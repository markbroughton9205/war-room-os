/**
 * Foundry public-research connection lifecycle validation.
 * Does not rebuild or delete the Commander transportation project.
 * Does not stop the retained 127.0.0.1:18780 preview.
 */
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'
import { classifyResearchRequest, RESEARCH_REFUSED_SIDE_EFFECT, RESEARCH_REFUSED_PRIVATE } from './foundryInternetResearch'
import {
  abortFoundryResearchMission,
  beginFoundryResearchMission,
  closeFoundryResearchTransport,
  foundryResearchFetch,
  FOUNDRY_RESEARCH_KEEPALIVE_MS,
  FOUNDRY_RESEARCH_MAX_SOCKETS,
  getFoundryResearchTransportDiagnostics,
  releaseFoundryResearchMission,
  sameFoundryResearchAgents,
} from './foundryResearchTransport'
import { inspectRetainedApplicationPreview } from './foundryApplicationBuilderLifecycle'
import { findListenerPidOnLoopback, isPidAlive } from './foundryProjectProcessRegistry'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

const LIVE_PROJECT = path.join(os.homedir(), 'FoundryProjects', 'professional-website-for-a')
const LIVE_PORT = 18780

function startFixtureServer(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<{
  port: number
  close: () => Promise<void>
}> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('fixture server has no port'))
        return
      }
      resolve({
        port: address.port,
        close: () => new Promise(done => server.close(() => done())),
      })
    })
  })
}

async function run(): Promise<void> {
  const liveBefore = await inspectRetainedApplicationPreview({ projectRoot: LIVE_PROJECT, port: LIVE_PORT })
  const previewPidBefore = findListenerPidOnLoopback(LIVE_PORT)
  const results: CaseResult[] = []

  results.push(check('loopback_preview_http_before', liveBefore.httpOk && liveBefore.status === 200, String(liveBefore.status)))
  results.push(check('project_preserved_before', liveBefore.projectPreserved, LIVE_PROJECT))

  const getOk = classifyResearchRequest({ url: 'https://developer.mozilla.org/en-US/docs/Web/HTML/Element/label', method: 'GET' })
  const headOk = classifyResearchRequest({ url: 'https://developer.mozilla.org/en-US/docs/Web/HTML', method: 'HEAD' })
  results.push(check('public_get_head_policy_unchanged', getOk.ok === true && headOk.ok === true, JSON.stringify({ getOk, headOk })))

  const postNo = classifyResearchRequest({ url: 'https://example.com/form', method: 'POST', body: 'x' })
  const loginNo = classifyResearchRequest({ url: 'https://example.com/login?session=1&submit=1', method: 'GET' })
  const checkoutNo = classifyResearchRequest({ url: 'https://example.com/checkout?submit=1', method: 'GET' })
  const privateNo = classifyResearchRequest({ url: 'http://127.0.0.1:18780/', method: 'GET' })
  results.push(check(
    'post_login_checkout_refusal_unchanged',
    !postNo.ok && (postNo as { code?: string }).code === RESEARCH_REFUSED_SIDE_EFFECT
      && !loginNo.ok && !checkoutNo.ok
      && !privateNo.ok && (privateNo as { code?: string }).code === RESEARCH_REFUSED_PRIVATE,
    JSON.stringify({ postNo, loginNo, checkoutNo, privateNo }),
  ))

  const okServer = await startFixtureServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('research-ok')
  })
  const hangServer = await startFixtureServer(() => { /* never responds */ })
  const failServer = await startFixtureServer((_req, res) => {
    res.writeHead(500, { 'content-type': 'text/plain' })
    res.end('research-fail')
  })

  try {
    beginFoundryResearchMission('research-success')
    const ok = await foundryResearchFetch(`http://127.0.0.1:${okServer.port}/`, { method: 'GET' }, { missionId: 'research-success' })
    const text = await ok.text()
    releaseFoundryResearchMission('research-success', { terminal: true })
    const afterSuccess = getFoundryResearchTransportDiagnostics()
    results.push(check(
      'successful_research_mission_releases_handles',
      ok.ok && text === 'research-ok' && afterSuccess.activeMissions === 0 && afterSuccess.inFlight === 0,
      `status=${ok.status} missions=${afterSuccess.activeMissions} inFlight=${afterSuccess.inFlight}`,
    ))

    beginFoundryResearchMission('research-failed')
    const failed = await foundryResearchFetch(`http://127.0.0.1:${failServer.port}/`, { method: 'GET' }, { missionId: 'research-failed' })
    releaseFoundryResearchMission('research-failed', { terminal: true })
    const afterFail = getFoundryResearchTransportDiagnostics()
    results.push(check(
      'failed_research_mission_releases_handles',
      failed.status === 500 && afterFail.activeMissions === 0 && afterFail.inFlight === 0,
      `status=${failed.status} missions=${afterFail.activeMissions}`,
    ))

    beginFoundryResearchMission('research-cancel')
    const pending = foundryResearchFetch(`http://127.0.0.1:${hangServer.port}/hang`, { method: 'GET' }, {
      missionId: 'research-cancel',
      timeoutMs: 8_000,
    })
    await new Promise(resolve => setTimeout(resolve, 40))
    const aborted = abortFoundryResearchMission('research-cancel')
    let abortName = ''
    try {
      await pending
    } catch (error) {
      abortName = error instanceof Error ? error.name : String(error)
    }
    releaseFoundryResearchMission('research-cancel', { terminal: true })
    results.push(check(
      'cancelled_research_aborts_owned_request',
      aborted.aborted && abortName === 'AbortError',
      `aborted=${aborted.aborted} name=${abortName}`,
    ))

    beginFoundryResearchMission('shared-a')
    beginFoundryResearchMission('shared-b')
    const same = sameFoundryResearchAgents()
    const diagShared = getFoundryResearchTransportDiagnostics()
    releaseFoundryResearchMission('shared-a', { terminal: true })
    releaseFoundryResearchMission('shared-b', { terminal: true })
    results.push(check(
      'shared_pool_does_not_duplicate_per_mission',
      same && diagShared.maxSockets === FOUNDRY_RESEARCH_MAX_SOCKETS && diagShared.keepAliveMs === FOUNDRY_RESEARCH_KEEPALIVE_MS,
      JSON.stringify({ same, generation: diagShared.agentGeneration, maxSockets: diagShared.maxSockets }),
    ))

    const peaks: number[] = []
    for (let i = 0; i < 6; i += 1) {
      const id = `repeat-${i}`
      beginFoundryResearchMission(id)
      await foundryResearchFetch(`http://127.0.0.1:${okServer.port}/`, { method: 'GET' }, { missionId: id })
      peaks.push(getFoundryResearchTransportDiagnostics().totalSockets)
      releaseFoundryResearchMission(id, { terminal: true })
    }
    const afterRepeat = getFoundryResearchTransportDiagnostics()
    results.push(check(
      'repeated_missions_do_not_grow_sockets_unbounded',
      Math.max(...peaks) <= FOUNDRY_RESEARCH_MAX_SOCKETS && afterRepeat.activeMissions === 0,
      `peaks=${peaks.join(',')} max=${FOUNDRY_RESEARCH_MAX_SOCKETS} leftover=${afterRepeat.totalSockets}`,
    ))

    const liveMid = await inspectRetainedApplicationPreview({ projectRoot: LIVE_PROJECT, port: LIVE_PORT })
    const previewPidMid = findListenerPidOnLoopback(LIVE_PORT)
    results.push(check('loopback_preview_http_mid', liveMid.httpOk && liveMid.status === 200, String(liveMid.status)))
    results.push(check(
      'preview_process_stays_alive',
      previewPidBefore != null && isPidAlive(previewPidBefore) && previewPidMid === previewPidBefore,
      `before=${previewPidBefore} mid=${previewPidMid}`,
    ))
    results.push(check('no_unrelated_process_kill', previewPidBefore != null && isPidAlive(previewPidBefore), String(previewPidBefore)))
    results.push(check(
      'research_result_behavior_unchanged',
      getOk.ok && text === 'research-ok',
      'GET policy + fixture body',
    ))
  } finally {
    await okServer.close()
    await hangServer.close()
    await failServer.close()
    await closeFoundryResearchTransport({ ifIdle: true })
  }

  const liveAfter = await inspectRetainedApplicationPreview({ projectRoot: LIVE_PROJECT, port: LIVE_PORT })
  results.push(check('loopback_preview_http_after', liveAfter.httpOk && liveAfter.status === 200, String(liveAfter.status)))
  results.push(check(
    'project_preserved_after',
    liveAfter.projectPreserved && existsSync(path.join(LIVE_PROJECT, 'faq.html')),
    LIVE_PROJECT,
  ))

  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(result => !result.pass)
  console.log(`Foundry Application Builder research lifecycle: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
  process.exit(0)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
export { run as runFoundryResearchLifecycleValidation }
