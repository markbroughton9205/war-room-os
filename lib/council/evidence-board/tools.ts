import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { LOCAL_CORE_ORIGIN, LOCAL_UI_ORIGIN } from '@/lib/sovereign-runtime/constants'
import { portInspect } from '@/lib/native-builder/portInspector'
import { probeOllama } from '@/lib/native-builder/ollamaClient'
import { recoverFromToolFailure } from '@/lib/council/gi/failureRecovery'
import { canonicalizeSourceKey } from '@/lib/council/gi/lumenQuality'
import { FOUNDRY_MUTATION_TOOLS, type EvidenceKind, type TemporalLayer, type ToolCallRecord } from './types'
import { toolFingerprint } from './board'

const execFileAsync = promisify(execFile)

export type ToolArgs = Record<string, unknown>
export type ToolRunner = (toolName: string, args?: ToolArgs) => Promise<ToolCallRecord>

export type ToolRuntimeOptions = {
  disabledTools?: readonly string[]
  denyBrowser?: boolean
  denyFoundryMutation?: boolean
  now?: () => string
  fetchImpl?: typeof fetch
  cache?: Map<string, ToolCallRecord>
}

function iso(now?: () => string): string {
  return now ? now() : new Date().toISOString()
}

function blocked(toolName: string, args: ToolArgs | undefined, reason: string, extra?: Partial<ToolCallRecord>): ToolCallRecord {
  return {
    tool_name: toolName,
    args_fingerprint: toolFingerprint(toolName, args ?? {}),
    ok: false,
    blocked: true,
    denied: /denied|not configured|authority/i.test(reason),
    summary: reason,
    pointer: extra?.pointer ?? toolName,
    url: extra?.url ?? null,
    title: extra?.title ?? null,
    status_code: extra?.status_code ?? null,
    kind: extra?.kind ?? 'tool_result',
    retrieved_at: extra?.retrieved_at ?? new Date().toISOString(),
    temporal_layer: extra?.temporal_layer ?? 'CURRENT_LIVE',
    payload: extra?.payload,
  }
}

async function httpProbe(url: string, fetchImpl: typeof fetch, timeoutMs = 2000): Promise<{ ok: boolean; status: number; body: string }> {
  try {
    const res = await fetchImpl(url, { method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) })
    const body = await res.text().catch(() => '')
    return { ok: res.ok, status: res.status, body: body.slice(0, 4_000) }
  } catch (error) {
    return { ok: false, status: 0, body: error instanceof Error ? error.message : String(error) }
  }
}

export function createToolRunner(options: ToolRuntimeOptions = {}): ToolRunner {
  const disabled = new Set(options.disabledTools ?? [])
  const cache = options.cache ?? new Map<string, ToolCallRecord>()
  const inflight = new Map<string, Promise<ToolCallRecord>>()
  const fetchImpl = options.fetchImpl ?? fetch
  const denyFoundry = options.denyFoundryMutation !== false

  return async (toolName, args = {}) => {
    const fingerprint = toolFingerprint(toolName, args)
    const cacheKey = toolName === 'broker.fetch'
      ? `broker.fetch:${String(args.query ?? args.url ?? args.objective ?? '').trim()}`
      : fingerprint
    const cached = cache.get(cacheKey) ?? cache.get(fingerprint)
    if (cached) {
      return { ...cached, coalesced_from: [...(cached.coalesced_from ?? []), fingerprint] }
    }
    const pending = inflight.get(cacheKey)
    if (pending) {
      const resolved = await pending
      return { ...resolved, coalesced_from: [...(resolved.coalesced_from ?? []), fingerprint] }
    }
    const work = (async (): Promise<ToolCallRecord> => {
    const retrieved_at = iso(options.now)

    if (disabled.has(toolName)) {
      const record = blocked(toolName, args, `Tool ${toolName} disabled`, { retrieved_at, kind: 'tool_result' })
      cache.set(fingerprint, record)
      return record
    }
    if (denyFoundry && (FOUNDRY_MUTATION_TOOLS as readonly string[]).includes(toolName)) {
      const record = blocked(toolName, args, `Council cannot execute Foundry mutation tool ${toolName}`, { retrieved_at, denied: true })
      cache.set(fingerprint, record)
      return record
    }

    let record: ToolCallRecord
    if (toolName === 'wr.core.health') {
      const probe = await httpProbe(`${LOCAL_CORE_ORIGIN}/api/local/health`, fetchImpl)
      record = {
        tool_name: toolName,
        args_fingerprint: fingerprint,
        ok: probe.ok,
        blocked: !probe.ok && probe.status === 0,
        denied: false,
        summary: probe.ok ? `Core health ${probe.status}` : `Core health failed ${probe.status || 'unreachable'}`,
        pointer: `${LOCAL_CORE_ORIGIN}/api/local/health`,
        status_code: probe.status || null,
        kind: 'live_telemetry',
        retrieved_at,
        temporal_layer: 'CURRENT_LIVE',
        payload: { status: probe.status, body: probe.body.slice(0, 500) },
      }
    } else if (toolName === 'wr.ui.health') {
      const probe = await httpProbe(`${LOCAL_UI_ORIGIN}/api/health`, fetchImpl)
      record = {
        tool_name: toolName,
        args_fingerprint: fingerprint,
        ok: probe.ok,
        blocked: !probe.ok && probe.status === 0,
        denied: false,
        summary: probe.ok ? `UI health ${probe.status}` : `UI health failed ${probe.status || 'unreachable'}`,
        pointer: `${LOCAL_UI_ORIGIN}/api/health`,
        status_code: probe.status || null,
        kind: 'live_telemetry',
        retrieved_at,
        temporal_layer: 'CURRENT_LIVE',
        payload: { status: probe.status, body: probe.body.slice(0, 500) },
      }
    } else if (toolName === 'wr.ports.list') {
      const inspected = await portInspect()
      if (!inspected.ok) {
        record = blocked(toolName, args, inspected.error, { retrieved_at, kind: 'tool_result' })
      } else {
        const critical = inspected.listeners.filter(row => row.port === 3847 || row.port === 3848)
        record = {
          tool_name: toolName,
          args_fingerprint: fingerprint,
          ok: true,
          blocked: false,
          denied: false,
          summary: `listeners=${inspected.listeners.length} critical=${critical.map(row => `${row.port}:${row.pid ?? '?'}`).join(',') || 'none'}`,
          pointer: 'ss:-ltnp',
          kind: 'live_telemetry',
          retrieved_at,
          temporal_layer: 'CURRENT_LIVE',
          payload: {
            listeners: inspected.listeners.map(row => ({
              port: row.port,
              pid: row.pid,
              processName: row.processName,
              knownRole: row.knownRole,
              address: row.address,
            })),
          },
        }
      }
    } else if (toolName === 'wr.council.backend') {
      const probe = await probeOllama()
      record = {
        tool_name: toolName,
        args_fingerprint: fingerprint,
        ok: probe.available,
        blocked: !probe.available,
        denied: false,
        summary: probe.available ? `Council local backend READY_LOCAL (${probe.detail})` : `Council local backend unreachable: ${probe.detail}`,
        pointer: probe.baseUrl,
        kind: 'live_telemetry',
        retrieved_at,
        temporal_layer: 'CURRENT_LIVE',
        payload: { available: probe.available, models: probe.models, detail: probe.detail, operational: probe.available ? 'READY_LOCAL' : 'UNAVAILABLE' },
      }
    } else if (toolName === 'wr.git.branch') {
      try {
        const { stdout: branch } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { timeout: 4000 })
        const { stdout: head } = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], { timeout: 4000 })
        record = {
          tool_name: toolName,
          args_fingerprint: fingerprint,
          ok: true,
          blocked: false,
          denied: false,
          summary: `branch ${branch.trim()} @ ${head.trim()}`,
          pointer: 'git:HEAD',
          kind: 'repo_config',
          retrieved_at,
          temporal_layer: 'LAST_VERIFIED',
          payload: { branch: branch.trim(), head: head.trim() },
        }
      } catch (error) {
        record = blocked(toolName, args, error instanceof Error ? error.message : String(error), { retrieved_at, kind: 'repo_config', temporal_layer: 'LAST_VERIFIED' as TemporalLayer })
      }
    } else if (toolName === 'wr.broker.status' || toolName === 'broker.fetch') {
      if (options.denyBrowser) {
        record = blocked(toolName, args, 'Browser Broker denied', { retrieved_at, kind: 'primary_external', denied: true })
      } else {
        try {
          const { getBrowserBroker } = await import('@/lib/browser-broker/broker')
          const broker = getBrowserBroker()
          const diag = broker.diagnostics()
          if (toolName === 'wr.broker.status') {
            const status = typeof broker.statusSnapshot === 'function' ? broker.statusSnapshot() : {
              broker_state: diag.brokerState,
              chromium_state: diag.chromiumState,
              chromium_pid: diag.chromiumPid,
              engine: 'playwright-chromium',
              engine_version: diag.engineVersion,
              executable: diag.chromiumExecutable,
              active_sessions: diag.activeSessions,
              active_tabs: diag.activeTabs,
              last_failure: diag.lastFailure,
              last_recovery: diag.lastRecovery,
              playwright_available: diag.playwrightAvailability === 'available',
              screenshot_capability: diag.screenshotCapability === true,
              research_capability: diag.researchCapability === true,
            }
            const configured = status.playwright_available && status.broker_state !== 'MISCONFIGURED'
            record = {
              tool_name: toolName,
              args_fingerprint: fingerprint,
              ok: configured,
              blocked: !configured,
              denied: !configured,
              summary: configured
                ? `Browser Broker ${status.broker_state} / Chromium ${status.chromium_state}`
                : 'Browser Broker not configured',
              pointer: 'broker:status',
              kind: 'live_telemetry',
              retrieved_at,
              temporal_layer: 'CURRENT_LIVE',
              payload: status,
            }
          } else if (diag.brokerState === 'MISCONFIGURED' || !diag.chromiumExecutable) {
            record = blocked(toolName, args, 'Browser Broker not configured', { retrieved_at, kind: 'primary_external', denied: true })
          } else {
            const query = String(args.query ?? args.url ?? args.objective ?? '')
            let research = await import('@/lib/browser-broker/councilClient').then(mod => mod.runCouncilBrowserResearch({
              query,
              maxSources: Number(args.maxSources) > 0 ? Math.min(Number(args.maxSources), 5) : 4,
              budgetMs: 90_000,
            }))
            if ((!research.ok || research.sources.length === 0) && research.error !== 'PROFILE_ACCESS_REQUIRED') {
              const recovery = recoverFromToolFailure({ tool_name: 'broker.fetch', ok: false, remaining_ok: 1 })
              if (recovery.continue_mission) {
                const alternate = /official documentation/i.test(query)
                  ? query.replace(/official documentation primary sources/i, 'primary sources').trim()
                  : `${query} primary sources`
                research = await import('@/lib/browser-broker/councilClient').then(mod => mod.runCouncilBrowserResearch({
                  query: alternate,
                  maxSources: 4,
                  budgetMs: 50_000,
                }))
              }
            }
            if (!research.ok || research.sources.length === 0) {
              record = blocked(toolName, args, research.error ?? 'NO_USABLE_SOURCES', {
                retrieved_at,
                kind: 'primary_external',
                denied: /denied|not configured/i.test(research.error ?? ''),
                url: null,
                payload: {
                  discovered_source_count: research.discovered_source_count ?? 0,
                  selected_source_count: research.selected_source_count ?? 0,
                  opened_source_count: research.opened_source_count ?? 0,
                  usable_source_count: 0,
                  unique_source_count: 0,
                  primary_source_count: 0,
                  failed_source_count: research.failed_source_count ?? 1,
                  candidates: research.candidates ?? [],
                  queries: research.queries ?? [query],
                  work_product: [],
                  research_domain: research.research_domain,
                  freshness_window_days: research.freshness_window_days ?? null,
                  failed_sources: research.failed_sources ?? [],
                  sources: (research.failed_sources ?? []).map(row => ({
                    url: row.url,
                    final_url: row.url,
                    title: row.title,
                    snippet: '',
                    retrieved_at,
                    tool_name: 'broker.fetch',
                    source_type: 'tool_result',
                    ok: false,
                    relevance_decision: row.reason,
                  })),
                },
              })
            } else {
              const seen = new Set<string>()
              const uniqueSources = research.sources.filter(source => {
                const key = canonicalizeSourceKey(source.finalUrl || source.url)
                if (!key || seen.has(key)) return false
                seen.add(key)
                return source.evidence.trim().length >= 80
              })
              const first = uniqueSources[0]
              if (!first) {
                record = blocked(toolName, args, 'NO_USABLE_SOURCES', {
                  retrieved_at,
                  kind: 'primary_external',
                  url: null,
                  payload: {
                    failed_sources: research.failed_sources ?? [],
                    research_domain: research.research_domain,
                    freshness_window_days: research.freshness_window_days ?? null,
                    sources: [],
                  },
                })
              } else {
              record = {
                tool_name: toolName,
                args_fingerprint: fingerprint,
                ok: true,
                blocked: false,
                denied: false,
                summary: `${first.title} — ${first.finalUrl || first.url}\n${first.evidence.slice(0, 400)}`.slice(0, 720),
                pointer: first.finalUrl || first.url,
                url: first.finalUrl || first.url,
                title: first.title,
                kind: 'primary_external',
                retrieved_at: research.finishedAt,
                temporal_layer: 'CURRENT_LIVE',
                payload: {
                  unique_source_count: uniqueSources.length,
                  discovered_source_count: research.discovered_source_count ?? uniqueSources.length,
                  selected_source_count: research.selected_source_count ?? uniqueSources.length,
                  opened_source_count: research.opened_source_count ?? uniqueSources.length,
                  usable_source_count: uniqueSources.length,
                  primary_source_count: research.primary_source_count ?? uniqueSources.filter(source => source.primary_or_secondary === 'primary').length,
                  failed_source_count: research.failed_source_count ?? 0,
                  candidates: research.candidates ?? [],
                  queries: research.queries ?? [query],
                  work_product: research.work_product ?? [],
                  research_domain: research.research_domain,
                  freshness_window_days: research.freshness_window_days ?? null,
                  failed_sources: research.failed_sources ?? [],
                  browser_session_type: research.sessionKind,
                  profile_id_hash: research.profileIdHash,
                  sources: [
                    ...uniqueSources.map(source => ({
                      url: source.url,
                      final_url: source.finalUrl,
                      title: source.title,
                      snippet: source.evidence.slice(0, 500),
                      retrieved_at: source.observed_at || research.finishedAt,
                      published_at: source.published_at ?? null,
                      tool_name: 'broker.fetch',
                      source_type: source.source_type || (source.primary_or_secondary === 'primary' ? 'primary_external' : 'secondary_external'),
                      browser_session_type: source.citation.browser_session_type ?? research.sessionKind,
                      profile_id_hash: source.citation.profile_id_hash ?? research.profileIdHash,
                      origin: source.citation.origin ?? null,
                      ok: true,
                      relevance_decision: source.relevance_decision || 'ACCEPT',
                      authority_class: source.authority_class,
                    })),
                    ...(research.failed_sources ?? []).map(source => ({
                      url: source.url,
                      final_url: source.url,
                      title: source.title || 'Unreachable source',
                      snippet: '',
                      retrieved_at: research.finishedAt,
                      published_at: null,
                      tool_name: 'broker.fetch',
                      source_type: 'tool_result',
                      browser_session_type: research.sessionKind,
                      profile_id_hash: research.profileIdHash,
                      origin: null,
                      ok: false,
                      failure_reason: source.reason === 'NAVIGATE_FAILED' ? 'selected source could not be opened' : source.reason,
                      relevance_decision: source.reason,
                    })),
                  ],
                },
              }
              }
            }
          }
        } catch (error) {
          record = blocked(toolName, args, error instanceof Error ? error.message : 'Browser Broker unavailable', { retrieved_at, kind: 'primary_external', denied: true })
        }
      }
    } else {
      record = blocked(toolName, args, `Unknown tool ${toolName}`, { retrieved_at, kind: 'tool_result' as EvidenceKind })
    }

    cache.set(fingerprint, record)
    cache.set(cacheKey, record)
    return record
    })()
    inflight.set(cacheKey, work)
    try {
      return await work
    } finally {
      inflight.delete(cacheKey)
    }
  }
}

export function evidenceKindFromTool(toolName: string, fallback: EvidenceKind = 'tool_result'): EvidenceKind {
  if (toolName === 'wr.core.health' || toolName === 'wr.ui.health' || toolName === 'wr.ports.list' || toolName === 'wr.council.backend' || toolName === 'wr.broker.status') {
    return 'live_telemetry'
  }
  if (toolName === 'wr.git.branch') return 'repo_config'
  if (toolName === 'broker.fetch') return 'primary_external'
  return fallback
}
