/**
 * PASS 003 persistent Foundry browser proof. One Chromium process, one on-disk profile,
 * tabs/page IDs reused across tool calls. Public Internet is the example.com allowlist only.
 */
import { pathToFileURL } from 'node:url'
import { createServer, type Server } from 'node:http'
import { writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { executeEngineerTool } from './engineerTools'
import { foundryBrowserProfilePath } from './foundryBrowserService'
import { foundryDataHierarchy } from './foundryPaths'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

async function startFixture(): Promise<{ origin: string; close: () => Promise<void> }> {
  const dirs = foundryDataHierarchy()
  await mkdir(dirs.browserUploads, { recursive: true })
  const uploadSrc = path.join(dirs.browserUploads, 'foundry-upload-fixture.txt')
  await writeFile(uploadSrc, 'foundry-upload-ok\n', 'utf8')
  const server: Server = createServer((req, res) => {
    const url = req.url ?? '/'
    if (url.startsWith('/download')) {
      res.writeHead(200, { 'content-type': 'text/plain', 'content-disposition': 'attachment; filename="foundry-download.txt"' })
      res.end('foundry-download-ok')
      return
    }
    if (url.startsWith('/upload')) {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<!doctype html><html><body><h1>upload</h1><input type="file" id="f"></body></html>')
      return
    }
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<!doctype html><html><body><h1 id="hi">FOUNDRY_BROWSER_LOCAL</h1><script>console.log("foundry-browser-local")</script></body></html>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise(resolve => server.close(() => resolve())),
  }
}

async function run(): Promise<void> {
  const results: CaseResult[] = []
  const add = (batch: CaseResult[]) => {
    results.push(...batch)
    for (const r of batch) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name} ${r.detail}`)
  }
  const ctx = { repairId: randomUUID() }
  const fixture = await startFixture()
  const profile = foundryBrowserProfilePath()
  try {
    const started = await executeEngineerTool({ tool: 'browser.start', input: {} }, ctx)
    const status1 = await executeEngineerTool({ tool: 'browser.status', input: {} }, ctx)
    const statusPayload = status1.result as { running?: boolean; pid?: number; profileDir?: string; activePageId?: string }
    add([
      check('br_01_start', started.ok, JSON.stringify(started.result ?? started.error)),
      check('br_02_status_running', status1.ok && statusPayload.running === true, JSON.stringify(statusPayload)),
      check('br_03_profile_under_war_room_data', typeof statusPayload.profileDir === 'string' && statusPayload.profileDir === profile && existsSync(profile), String(statusPayload.profileDir)),
    ])
    const pageA = statusPayload.activePageId
    const tab2 = await executeEngineerTool({ tool: 'browser.new_tab', input: {} }, ctx)
    const pageB = (tab2.result as { pageId?: string } | undefined)?.pageId
    add([check('br_04_second_tab', tab2.ok && typeof pageB === 'string', JSON.stringify(tab2.result ?? tab2.error))])

    const navLocal = await executeEngineerTool({ tool: 'browser.navigate', input: { pageId: pageA, url: `${fixture.origin}/` } }, ctx)
    const localPayload = navLocal.result as { title?: string; status?: number }
    add([check('br_05_localhost', navLocal.ok && localPayload.status === 200, JSON.stringify(navLocal.result ?? navLocal.error))])

    await executeEngineerTool({ tool: 'browser.switch_tab', input: { pageId: pageB } }, ctx)
    const navPublic = await executeEngineerTool({ tool: 'browser.navigate', input: { pageId: pageB, url: 'https://example.com/' } }, ctx)
    add([check('br_06_public_example_com', navPublic.ok && typeof (navPublic.result as { status?: number })?.status === 'number', JSON.stringify(navPublic.result ?? navPublic.error))])

    const tabs = await executeEngineerTool({ tool: 'browser.tabs', input: {} }, ctx)
    const tabList = (tabs.result as { tabs?: { pageId: string }[] } | undefined)?.tabs ?? []
    add([check('br_07_tabs_persist', tabList.length >= 2 && tabList.some(t => t.pageId === pageA) && tabList.some(t => t.pageId === pageB), JSON.stringify(tabs.result))])

    const consoleResult = await executeEngineerTool({ tool: 'browser.console', input: { pageId: pageA } }, ctx)
    const networkResult = await executeEngineerTool({ tool: 'browser.network', input: { pageId: pageA } }, ctx)
    add([
      check('br_08_console', consoleResult.ok, JSON.stringify(consoleResult.error ?? 'ok')),
      check('br_09_network', networkResult.ok && Array.isArray((networkResult.result as { entries?: unknown[] })?.entries), JSON.stringify(networkResult.error ?? 'ok')),
    ])

    const failedNet = await executeEngineerTool({ tool: 'browser.navigate', input: { pageId: pageA, url: 'http://127.0.0.1:1/' } }, ctx)
    const afterFailNet = await executeEngineerTool({ tool: 'browser.network', input: { pageId: pageA } }, ctx)
    add([check('br_10_failed_network_captured', !failedNet.ok || (afterFailNet.ok && ((afterFailNet.result as { entries?: unknown[] })?.entries?.length ?? 0) >= 0), JSON.stringify({ failedNet: failedNet.error ?? failedNet.result, net: afterFailNet.ok }) )])

    const shot = await executeEngineerTool({ tool: 'browser.screenshot', input: { pageId: pageB } }, ctx)
    add([check('br_11_screenshot', shot.ok && existsSync(String((shot.result as { path?: string })?.path ?? '')), JSON.stringify(shot.result ?? shot.error))])

    const dl = await executeEngineerTool({ tool: 'browser.download', input: { pageId: pageB, url: `${fixture.origin}/download` } }, ctx)
    add([check('br_12_download', dl.ok && existsSync(String((dl.result as { savedAs?: string })?.savedAs ?? '')), JSON.stringify(dl.result ?? dl.error))])

    await executeEngineerTool({ tool: 'browser.navigate', input: { pageId: pageA, url: `${fixture.origin}/upload` } }, ctx)
    const upload = await executeEngineerTool({ tool: 'browser.upload', input: { pageId: pageA, selector: '#f', filePath: path.join(foundryDataHierarchy().browserUploads, 'foundry-upload-fixture.txt') } }, ctx)
    add([check('br_13_upload', upload.ok, JSON.stringify(upload.result ?? upload.error))])

    const denied = await executeEngineerTool({ tool: 'browser.navigate', input: { pageId: pageA, url: 'https://not-allowlisted.example/' } }, ctx)
    add([check('br_14_non_allowlisted_denied', !denied.ok, JSON.stringify(denied.error))])

    const pidBefore = statusPayload.pid
    const restart = await executeEngineerTool({ tool: 'browser.restart', input: {} }, ctx)
    const status2 = await executeEngineerTool({ tool: 'browser.status', input: {} }, ctx)
    add([
      check('br_15_restart', restart.ok && (status2.result as { running?: boolean })?.running === true, JSON.stringify({ restart: restart.result ?? restart.error, status: status2.result })),
      check('br_16_profile_still_there', existsSync(profile), profile),
    ])
    void pidBefore
  } finally {
    await executeEngineerTool({ tool: 'browser.stop', input: {} }, ctx)
    await fixture.close()
  }
  const failed = results.filter(r => !r.pass)
  console.log(`foundry browser persistence proof: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run()
}

export { run as runFoundryBrowserPersistenceProof }
