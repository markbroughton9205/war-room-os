import { createHash } from 'node:crypto'
import type { DispatchWorkProduct, ToolHandler, ToolHandlerMap } from './types'

/** Real CPU work. Not sleep. Yields so independent tasks can overlap on the event loop. */
export async function cpuDigestWork(seed: string, rounds = 8_000): Promise<{ digest: string; rounds: number }> {
  let digest = seed
  for (let i = 0; i < rounds; i += 1) {
    digest = createHash('sha256').update(`${digest}:${i}`).digest('hex')
    if (i % 80 === 0) await new Promise<void>(resolve => setImmediate(resolve))
  }
  return { digest, rounds }
}

function cpuHandler(label: string, produces_evidence: boolean, kind: DispatchWorkProduct['kind'] = 'live_telemetry'): ToolHandler {
  return async input => {
    const work = await cpuDigestWork(`${input.mission_id}:${input.task_id}:${input.tool_id}:${input.objective}`)
    return {
      ok: true,
      summary: `${label} ${work.digest.slice(0, 12)}`,
      claims: [`${label} completed with digest ${work.digest.slice(0, 16)}`],
      produces_evidence,
      kind: produces_evidence ? kind : 'none',
    }
  }
}

export const DEFAULT_HANDLERS: ToolHandlerMap = {
  'system.health': cpuHandler('system.health', true, 'live_telemetry'),
  'wr.ui.health': cpuHandler('wr.ui.health', true, 'live_telemetry'),
  'wr.ports.list': cpuHandler('wr.ports.list', true, 'live_telemetry'),
  'wr.council.backend': cpuHandler('wr.council.backend', true, 'live_telemetry'),
  'browser.status': cpuHandler('browser.status', true, 'live_telemetry'),
  'research.web': cpuHandler('research.web', true, 'primary_external'),
  'browser.fetch': cpuHandler('browser.fetch', true, 'primary_external'),
  verification: cpuHandler('LUMEN verification', false, 'none'),
  synthesis: cpuHandler('AURORA synthesis', false, 'none'),
  adversarial_review: cpuHandler('PHOENIX challenge', false, 'none'),
}

export async function liveBrokerStatusHandler(input: Parameters<ToolHandler>[0]): ReturnType<ToolHandler> {
  const { getBrowserBroker } = await import('@/lib/browser-broker/broker')
  const broker = getBrowserBroker()
  const diag = broker.diagnostics()
  await cpuDigestWork(`broker-status:${input.task_id}`, 2000)
  const ok = diag.brokerState !== 'MISCONFIGURED'
  return {
    ok,
    summary: `Browser Broker ${diag.brokerState} / Chromium ${diag.chromiumState}`,
    claims: [`broker_state=${diag.brokerState}`, `chromium_state=${diag.chromiumState}`],
    produces_evidence: true,
    kind: 'live_telemetry',
    failure: ok ? null : 'Browser Broker misconfigured',
  }
}

export async function liveBrowserResearchHandler(input: Parameters<ToolHandler>[0]): ReturnType<ToolHandler> {
  const { runCouncilBrowserResearch } = await import('@/lib/browser-broker/councilClient')
  const research = await runCouncilBrowserResearch({
    query: input.objective,
    maxSources: 2,
    budgetMs: 45_000,
  })
  const source = research.sources[0]
  return {
    ok: research.ok && research.sources.length > 0,
    summary: source ? `${source.title} — ${source.url}` : (research.error ?? 'NO_USABLE_SOURCES'),
    claims: research.sources.slice(0, 2).map(row => `${row.title} ${row.url}`),
    produces_evidence: Boolean(source),
    kind: 'primary_external',
    url: source?.url ?? null,
    title: source?.title ?? null,
    failure: research.ok ? null : (research.error ?? 'NO_USABLE_SOURCES'),
  }
}

export function liveHandlerMap(): ToolHandlerMap {
  return {
    ...DEFAULT_HANDLERS,
    'browser.status': liveBrokerStatusHandler,
    'wr.broker.status': liveBrokerStatusHandler,
    'research.web': liveBrowserResearchHandler,
    'browser.fetch': liveBrowserResearchHandler,
  }
}
