/**
 * Wrapper-only resource release for Application Builder.
 * Closes timers, browser validation contexts, and stdio/pipe handles belonging to the
 * mission wrapper. Does not delete project files and does not kill a retained preview.
 */
import http from 'node:http'
import { executeFoundryBrowserTool, isFoundryBrowserServiceRunning } from './foundryBrowserService'
import { markProjectProcessOwnership } from './foundryProjectProcessRegistry'
import { detachChildFromWrapper } from './processRegistry'
import { closeFoundryResearchTransport, releaseFoundryResearchMission } from './foundryResearchTransport'

export { detachChildFromWrapper }

const wrapperTimers = new Set<ReturnType<typeof setTimeout>>()

export type WrapperHandleSnapshot = {
  pipes: number
  timeouts: number
  tcp: number
  childProcesses: number
  fsWatchers: number
  other: number
  names: string[]
}

export function scheduleWrapperTimer(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
  const timer = setTimeout(() => {
    wrapperTimers.delete(timer)
    fn()
  }, ms)
  wrapperTimers.add(timer)
  return timer
}

export function clearWrapperTimers(): number {
  const count = wrapperTimers.size
  for (const timer of wrapperTimers) clearTimeout(timer)
  wrapperTimers.clear()
  return count
}

export function wrapperTimerCount(): number {
  return wrapperTimers.size
}

export function snapshotWrapperHandles(): WrapperHandleSnapshot {
  const names = typeof process.getActiveResourcesInfo === 'function'
    ? process.getActiveResourcesInfo()
    : []
  const count = (needle: RegExp) => names.filter(name => needle.test(name)).length
  return {
    pipes: count(/Pipe/i),
    timeouts: count(/Timeout/i),
    tcp: count(/TCP/i),
    childProcesses: count(/ChildProcess|Process/i),
    fsWatchers: count(/FSEvent|StatWatcher|FSReq/i),
    other: names.length,
    names,
  }
}

export async function httpGetNoKeepAlive(url: string): Promise<{ ok: boolean; status: number; text: string }> {
  return new Promise(resolve => {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      resolve({ ok: false, status: 0, text: 'invalid url' })
      return
    }
    if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1') {
      resolve({ ok: false, status: 0, text: 'loopback http only' })
      return
    }
    const req = http.request({
      host: parsed.hostname,
      port: parsed.port || '80',
      path: `${parsed.pathname}${parsed.search}`,
      method: 'GET',
      agent: false,
      timeout: 8000,
    }, res => {
      const chunks: Buffer[] = []
      res.on('data', chunk => chunks.push(Buffer.from(chunk)))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8').slice(0, 20_000)
        resolve({ ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 400, status: res.statusCode ?? 0, text })
      })
    })
    req.on('error', error => resolve({ ok: false, status: 0, text: error.message }))
    req.on('timeout', () => {
      req.destroy()
      resolve({ ok: false, status: 0, text: 'timeout' })
    })
    req.end()
  })
}

export async function releaseMissionWrapperResources(input: {
  missionId: string
  retainPreview?: boolean
  previewRecordId?: string
  closeResearchTransportIfIdle?: boolean
}): Promise<{
  browserStopped: boolean
  timersCleared: number
  previewRetained: boolean
  browserStillRunning: boolean
  researchReleased: boolean
}> {
  clearWrapperTimers()
  await executeFoundryBrowserTool('browser.stop', {}, { repairId: input.missionId }).catch(() => undefined)
  const research = releaseFoundryResearchMission(input.missionId, { terminal: true })
  if (input.closeResearchTransportIfIdle) {
    await closeFoundryResearchTransport({ ifIdle: true })
  }
  if (input.retainPreview && input.previewRecordId) {
    await markProjectProcessOwnership(input.previewRecordId, 'released-from-wrapper').catch(() => undefined)
  }
  return {
    browserStopped: true,
    timersCleared: 0,
    previewRetained: Boolean(input.retainPreview),
    browserStillRunning: isFoundryBrowserServiceRunning(),
    researchReleased: research.released,
  }
}

export function shouldRetainApplicationPreview(testArtifact: boolean | undefined): boolean {
  if (process.env.FOUNDRY_APP_BUILDER_RETAIN_PREVIEW === '0') return false
  if (process.env.FOUNDRY_APP_BUILDER_RETAIN_PREVIEW === '1') return true
  return testArtifact !== true
}

export async function inspectRetainedApplicationPreview(input: {
  projectRoot: string
  port?: number
}): Promise<{ httpOk: boolean; status: number; projectPreserved: boolean; url: string }> {
  const port = input.port ?? 18780
  const url = `http://127.0.0.1:${port}/`
  const page = await httpGetNoKeepAlive(url)
  const { existsSync } = await import('node:fs')
  const path = await import('node:path')
  return {
    httpOk: page.ok,
    status: page.status,
    projectPreserved: existsSync(path.join(input.projectRoot, 'index.html')) && existsSync(path.join(input.projectRoot, 'foundry-memory.json')),
    url,
  }
}
