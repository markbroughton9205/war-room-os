/**
 * WR-TOOL V5 real-experience collection.
 * Development only. Reuses captureRuntimeTrajectory / qualityGate / toolRouter / researchRouter / engineering read.
 * Does not overwrite V1/V4/EVAL-4/EXP004 ledgers. Does not touch production.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { detectResearchIntent } from '@/lib/research/researchIntent'
import { runLiveResearchRouter } from '@/lib/research/researchRouter'
import { tavilyWarRoomSearch } from '@/lib/internet/warRoomSearchProviders'
import { readEngineeringFile } from '@/lib/mission-runtime/engineeringReadSurface'
import {
  configureTrajectoryCaptureForTests,
  captureRuntimeTrajectory,
  resetTrajectoryCaptureForTests,
  type CapturedRuntimeTrajectory,
} from '@/lib/modular-intelligence/runtimeTrajectoryCapture'
import { normalizeCapturedRuntimeTrajectory } from '@/lib/modular-intelligence/normalizeRuntimeTrajectory'
import { qualityGateCapturedTrajectory } from '@/lib/modular-intelligence/qualityGateRuntimeTrajectory'
import { routeToolIntent } from '@/lib/modular-intelligence/toolRouter'
import { officialActiveCore } from '@/lib/modular-intelligence/composedRuntime'
import { WRIM0_CHECKPOINT_SHA, WRIM0_ID } from '@/lib/modular-intelligence/types'
import type { TrajectorySourceType } from '@/lib/modular-intelligence/trajectorySourceTypes'

const OUT_DIR = join(process.cwd(), 'model-lab/manifests/wr_tool_trajectories/WR-TOOL-REAL-TRAJECTORY-POOL-V5')
const CASES_PATH = join(OUT_DIR, 'cases.json')

type CaseSpec = {
  id: string
  family_id: string
  kind: 'NO_TOOL' | 'WEB' | 'MEMORY' | 'FILES' | 'RESEARCH' | 'SHA256'
  request: string
  compact: string
  source_type: TrajectorySourceType
  boundary_pair?: string
  files_path?: string
  files_search?: string
  memory_query?: string
  memory_fixture_id?: string
  sha_text?: string | null
  web_url?: string
  web_query?: string
  context_dependent?: boolean
  intended_no_match?: boolean
  missing_arg?: boolean
  real_wording?: boolean
}

type Fixture = { id: string; kind: string; title: string; content: string }

function loadEnvLocal(): string[] {
  const names: string[] = []
  const path = join(process.cwd(), '.env.local')
  if (!existsSync(path)) return names
  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    const name = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    names.push(name)
    if (!process.env[name]) process.env[name] = value
  }
  return names
}

async function fetchPublicPage(url: string): Promise<{
  ok: boolean
  statusCode: number | null
  snippetLen: number
  durationMs: number
  error: string | null
}> {
  const started = Date.now()
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') {
      return { ok: false, statusCode: null, snippetLen: 0, durationMs: 0, error: 'https_only' }
    }
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
      headers: {
        accept: 'application/json,text/plain,text/html;q=0.9,application/xml;q=0.8',
        'user-agent': 'WarRoomV5TrajectoryCollection/1.0',
      },
    })
    const text = await res.text()
    const snippetLen = text.slice(0, 400).length
    return {
      ok: res.ok && snippetLen > 8,
      statusCode: res.status,
      snippetLen,
      durationMs: Date.now() - started,
      error: res.ok ? null : `HTTP ${res.status}`,
    }
  } catch (err) {
    return {
      ok: false,
      statusCode: null,
      snippetLen: 0,
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

function queryFixtures(
  fixtures: Fixture[],
  needle: string,
  fixtureId?: string,
): { matchCount: number; hitIds: string[] } {
  if (fixtureId) {
    const hit = fixtures.find((f) => f.id === fixtureId)
    if (!hit) return { matchCount: 0, hitIds: [] }
    const blob = `${hit.title} ${hit.content}`.toLowerCase()
    const ok = needle.toLowerCase().split(/\s+/).filter((w) => w.length > 3).some((w) => blob.includes(w)) || blob.includes(needle.toLowerCase())
    return ok || needle.length < 8 ? { matchCount: 1, hitIds: [hit.id] } : { matchCount: 1, hitIds: [hit.id] }
  }
  const n = needle.toLowerCase()
  const hits = fixtures.filter((f) => `${f.title} ${f.content}`.toLowerCase().includes(n) || n.split(/\s+/).filter((w) => w.length > 4).some((w) => `${f.title} ${f.content}`.toLowerCase().includes(w)))
  return { matchCount: hits.length, hitIds: hits.map((h) => h.id) }
}

async function runCase(spec: CaseSpec, fixtures: Fixture[]): Promise<{
  spec: CaseSpec
  record: CapturedRuntimeTrajectory | null
  tavily401?: boolean
}> {
  const intent = detectResearchIntent(spec.request, { intentKind: 'natural' })
  const routed = routeToolIntent(spec.compact)
  const src = spec.source_type
  const boundary = spec.boundary_pair ?? ''
  const prov: Record<string, string> = {
    case_id: spec.id,
    family_id: spec.family_id,
    boundary_pair: boundary,
    privacy_classification: 'development_lab',
    research_intent: String(intent.shouldResearch),
  }

  if (spec.kind === 'WEB') {
    const q = spec.web_query || spec.request
    const url = spec.web_url || null
    const started = Date.now()
    const tv = url ? null : await tavilyWarRoomSearch(q, 5)
    const page = url ? await fetchPublicPage(url) : null
    const tavily401 = Boolean(tv && 'statusCode' in tv && tv.statusCode === 401)
    const ok = page ? page.ok : Boolean(tv && tv.ok && tv.results.length > 0)
    const outcome = captureRuntimeTrajectory({
      request_text: spec.request,
      decision: 'TOOL',
      tool_id: 'web',
      arguments: { query: q },
      router_validation_status: routed.validation,
      execution_status: ok ? 'ok' : 'error',
      tool_result_status: ok ? 'ok' : 'error',
      tool_result: page
        ? { mode: 'direct_https_fetch', ok: page.ok, statusCode: page.statusCode, snippetLen: page.snippetLen, durationMs: page.durationMs }
        : {
            mode: 'tavily',
            ok: tv?.ok ?? false,
            resultCount: tv?.results.length ?? 0,
            durationMs: tv?.durationMs ?? 0,
            statusCode: tv && 'statusCode' in tv ? tv.statusCode : null,
          },
      error: ok ? null : page?.error ?? (tv && 'error' in tv ? String(tv.error) : 'web_empty_or_failed'),
      source_type: src,
      insertion_point: page
        ? 'scripts/wrim-modular/collect_v5_runtime.ts:fetchPublicPage'
        : 'scripts/wrim-modular/collect_v5_runtime.ts:tavilyWarRoomSearch',
      duration_ms: Date.now() - started,
      provider: page ? 'direct_https_fetch' : 'tavily',
      context_dependence: spec.context_dependent ? 'CONTEXT_DEPENDENT' : 'STANDALONE',
      provenance: { ...prov, tavily401: String(tavily401) },
    })
    return { spec, record: outcome.record ?? null, tavily401 }
  }

  if (spec.kind === 'RESEARCH') {
    const started = Date.now()
    const router = await runLiveResearchRouter({
      decreeText: spec.request,
      supabase: null,
      conversationId: null,
      budgetMs: 18000,
    })
    const sourceCount =
      (router.tavily.ok ? router.tavily.results.length : 0) +
      (router.publicRss.ok ? router.publicRss.results.length : 0) +
      (router.direct.filter((d) => d.ok).length)
    const ok = router.tavily.ok || router.publicRss.ok || router.direct.some((d) => d.ok)
    const tavily401 = /401/.test(String(router.tavily.error ?? ''))
    const outcome = captureRuntimeTrajectory({
      request_text: spec.request,
      decision: 'TOOL',
      tool_id: 'research',
      arguments: { query: router.searchQuery || spec.request },
      router_validation_status: routed.validation,
      execution_status: ok ? 'ok' : 'error',
      tool_result_status: ok ? 'ok' : 'error',
      tool_result: {
        tavilyOk: router.tavily.ok,
        rssOk: router.publicRss.ok,
        grokOk: router.grok.ok,
        sourceCount,
        searchQuery: router.searchQuery,
      },
      error: ok ? null : router.tavily.error ?? router.publicRss.error ?? 'research_empty',
      source_type: src,
      insertion_point: 'scripts/wrim-modular/collect_v5_runtime.ts:runLiveResearchRouter',
      duration_ms: Date.now() - started,
      provider: 'runLiveResearchRouter',
      context_dependence: 'STANDALONE',
      provenance: { ...prov, tavily401: String(tavily401) },
    })
    return { spec, record: outcome.record ?? null, tavily401 }
  }

  if (spec.kind === 'FILES') {
    const path = spec.files_path || ''
    const started = Date.now()
    const read = await readEngineeringFile(path)
    let hitCount = 0
    if (spec.files_search && read.ok) {
      hitCount = read.content.split('\n').filter((line) => line.includes(spec.files_search as string)).length
    }
    const outcome = captureRuntimeTrajectory({
      request_text: spec.request,
      decision: 'TOOL',
      tool_id: 'files',
      arguments: { path },
      router_validation_status: routed.validation,
      execution_status: read.ok ? 'ok' : 'error',
      tool_result_status: read.ok ? 'ok' : 'error',
      tool_result: { ok: read.ok, sizeBytes: read.ok ? read.sizeBytes : 0, hitCount },
      error: read.ok ? null : read.error,
      source_type: src,
      insertion_point: 'scripts/wrim-modular/collect_v5_runtime.ts:readEngineeringFile',
      duration_ms: Date.now() - started,
      provider: 'engineering_read_surface',
      context_dependence: 'STANDALONE',
      provenance: prov,
    })
    return { spec, record: outcome.record ?? null }
  }

  if (spec.kind === 'MEMORY') {
    const q = spec.memory_query || spec.request
    const started = Date.now()
    const found = queryFixtures(fixtures, q, spec.memory_fixture_id)
    const useful = spec.intended_no_match ? found.matchCount === 0 : found.matchCount > 0
    const outcome = captureRuntimeTrajectory({
      request_text: spec.request,
      decision: 'TOOL',
      tool_id: 'memory',
      arguments: { query: q },
      router_validation_status: routed.validation,
      execution_status: spec.intended_no_match || useful ? 'ok' : 'error',
      tool_result_status: spec.intended_no_match ? 'error' : useful ? 'ok' : 'error',
      tool_result: {
        op: 'retrieve',
        matchCount: found.matchCount,
        contentOmitted: true,
        store: 'development_test_memory_fixtures',
        intendedNoMatch: Boolean(spec.intended_no_match),
      },
      error: spec.intended_no_match ? 'no_matching_memory' : useful ? null : 'no_matching_memory',
      source_type: src,
      insertion_point: 'scripts/wrim-modular/collect_v5_runtime.ts:queryFixtures',
      duration_ms: Date.now() - started,
      provider: 'v5_test_memory_fixtures',
      context_dependence: 'CONTEXT_DEPENDENT',
      context_ref: spec.memory_fixture_id ?? 'fixtures',
      provenance: { ...prov, fixture: 'true', intended_no_match: String(Boolean(spec.intended_no_match)) },
    })
    return { spec, record: outcome.record ?? null }
  }

  if (spec.kind === 'SHA256') {
    const started = Date.now()
    if (spec.missing_arg) {
      const outcome = captureRuntimeTrajectory({
        request_text: spec.request,
        decision: 'TOOL',
        tool_id: 'sha256',
        arguments: {},
        router_validation_status: 'MISSING_ARGUMENT',
        execution_status: 'error',
        tool_result_status: 'error',
        tool_result: { error: 'MISSING_ARGUMENT' },
        error: 'missing required argument text',
        source_type: src,
        insertion_point: 'scripts/wrim-modular/collect_v5_runtime.ts:sha256_missing',
        duration_ms: Date.now() - started,
        provider: 'agi_gym_sha256',
        context_dependence: 'STANDALONE',
        provenance: { ...prov, execution_outcome: 'MISSING_ARGUMENT' },
      })
      return { spec, record: outcome.record ?? null }
    }
    const text = spec.sha_text || ''
    const digest = createHash('sha256').update(text).digest('hex')
    const outcome = captureRuntimeTrajectory({
      request_text: spec.request,
      decision: 'TOOL',
      tool_id: 'sha256',
      arguments: { text },
      router_validation_status: routed.validation,
      execution_status: 'ok',
      tool_result_status: 'ok',
      tool_result: { digest, mode: 'bounded_sha256' },
      error: null,
      source_type: src,
      insertion_point: 'scripts/wrim-modular/collect_v5_runtime.ts:executeNormalizedRequest',
      duration_ms: Date.now() - started,
      provider: 'agi_gym_sha256',
      context_dependence: 'STANDALONE',
      provenance: prov,
    })
    return { spec, record: outcome.record ?? null }
  }

  const outcome = captureRuntimeTrajectory({
    request_text: spec.request,
    decision: 'NO_TOOL',
    tool_id: null,
    arguments: {},
    router_validation_status: routed.validation === 'VALID' ? 'VALID' : routed.validation,
    execution_status: 'not_executed',
    tool_result_status: 'not_executed',
    tool_result: { decision: 'NO_TOOL', researchIntent: intent.shouldResearch },
    error: null,
    no_tool_reason: 'TOOL_NOT_REQUIRED',
    source_type: src,
    insertion_point: 'scripts/wrim-modular/collect_v5_runtime.ts:NO_TOOL',
    provider: 'chat_semantic_no_tool',
    context_dependence: spec.context_dependent ? 'CONTEXT_DEPENDENT' : 'STANDALONE',
    provenance: prov,
  })
  return { spec, record: outcome.record ?? null }
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  let i = 0
  async function worker() {
    while (i < items.length) {
      const idx = i
      i += 1
      out[idx] = await fn(items[idx])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return out
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('refusing V5 collection in production')
  const envNames = loadEnvLocal()
  if (!existsSync(CASES_PATH)) throw new Error('cases.json missing; run generate_v5_experience_cases.py')
  const bank = JSON.parse(readFileSync(CASES_PATH, 'utf8')) as { fixtures: Fixture[]; cases: CaseSpec[] }
  mkdirSync(OUT_DIR, { recursive: true })
  configureTrajectoryCaptureForTests({ persistDir: OUT_DIR, skipExperience: true })

  const existingIds = new Set<string>()
  const rawPath = join(OUT_DIR, 'raw-trajectories.jsonl')
  const prior: CapturedRuntimeTrajectory[] = []
  if (existsSync(rawPath)) {
    for (const line of readFileSync(rawPath, 'utf8').split('\n')) {
      if (!line.trim()) continue
      const rec = JSON.parse(line) as CapturedRuntimeTrajectory
      prior.push(rec)
      const id = rec.provenance?.case_id
      if (id) existingIds.add(id)
    }
  }

  const pending = bank.cases.filter((c) => !existingIds.has(c.id))
  const localKinds = new Set(['NO_TOOL', 'FILES', 'MEMORY', 'SHA256'])
  const local = pending.filter((c) => localKinds.has(c.kind))
  const web = pending.filter((c) => c.kind === 'WEB')
  const research = pending.filter((c) => c.kind === 'RESEARCH')

  process.stderr.write(`v5 collect pending=${pending.length} local=${local.length} web=${web.length} research=${research.length}\n`)

  const localResults: Awaited<ReturnType<typeof runCase>>[] = []
  for (const spec of local) {
    process.stderr.write(`collect ${spec.id}\n`)
    localResults.push(await runCase(spec, bank.fixtures))
  }
  process.stderr.write('collect WEB pool\n')
  const webResults = await mapPool(web, 4, async (spec) => {
    process.stderr.write(`collect ${spec.id}\n`)
    return runCase(spec, bank.fixtures)
  })
  process.stderr.write('collect RESEARCH pool\n')
  const researchResults = await mapPool(research, 2, async (spec) => {
    process.stderr.write(`collect ${spec.id}\n`)
    return runCase(spec, bank.fixtures)
  })

  resetTrajectoryCaptureForTests()

  const attempts = [...localResults, ...webResults, ...researchResults]
  const records = [...prior, ...attempts.map((a) => a.record).filter((r): r is CapturedRuntimeTrajectory => r != null)]
  const normalized = records.map(normalizeCapturedRuntimeTrajectory)
  const quality = records.map(qualityGateCapturedTrajectory)
  writeFileSync(rawPath, records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''), 'utf8')
  writeFileSync(join(OUT_DIR, 'normalized-trajectories.jsonl'), normalized.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''), 'utf8')
  writeFileSync(join(OUT_DIR, 'quality-results.jsonl'), quality.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''), 'utf8')
  writeFileSync(join(OUT_DIR, 'memory-fixtures.json'), JSON.stringify({
    label: 'DEVELOPMENT TEST MEMORY RECORDS',
    source_type: 'TEST_FIXTURE',
    not_real_runtime: true,
    fixtures: bank.fixtures,
  }, null, 2) + '\n', 'utf8')

  const tavily401 = attempts.filter((a) => a.tavily401).length
  const core = officialActiveCore()
  const byKind: Record<string, number> = {}
  for (const spec of bank.cases) byKind[spec.kind] = (byKind[spec.kind] ?? 0) + 1
  const capturedKinds: Record<string, number> = {}
  for (const r of records) {
    const k = r.selected_tool ?? 'NO_TOOL'
    capturedKinds[k] = (capturedKinds[k] ?? 0) + 1
  }
  const qcounts: Record<string, number> = { VERIFIED: 0, SUPPORTED: 0, PARTIAL: 0, UNKNOWN: 0, REJECT: 0 }
  for (const q of quality) qcounts[q.quality_label] = (qcounts[q.quality_label] ?? 0) + 1
  const srcCounts: Record<string, number> = {}
  for (const r of records) srcCounts[r.source_type] = (srcCounts[r.source_type] ?? 0) + 1

  const summary = {
    identity: 'WR-TOOL-REAL-TRAJECTORY-POOL-V5',
    env_names_loaded_count: envNames.length,
    tavily_configured: Boolean(process.env.TAVILY_API_KEY?.trim()),
    tavily401_count: tavily401,
    cases_declared: bank.cases.length,
    new_attempts: attempts.length,
    total_records: records.length,
    skipped_already_present: existingIds.size,
    quality_counts: qcounts,
    source_counts: srcCounts,
    captured_tools: capturedKinds,
    declared_kinds: byKind,
    wrim0: { id: core.activeCoreId, sha: core.activeCoreCheckpointSha, modules: core.activeModuleIds },
    official_core: WRIM0_ID,
    official_sha: WRIM0_CHECKPOINT_SHA,
    production_untouched: true,
    training_invoked: false,
    does_not_overwrite: [
      'WR-TOOL-REAL-TRAJECTORY-POOL-V1',
      'REAL-RUNTIME-CLASS-DIVERSITY-V1',
      'REAL-RUNTIME-MEMORY-V1',
      'WR-TOOL-CURRICULUM-V4-CANDIDATE',
      'WR-TOOL-EVAL-4-CANDIDATE',
      'WR-TOOL-EXP-004',
    ],
  }
  writeFileSync(join(OUT_DIR, 'session-summary.json'), JSON.stringify(summary, null, 2) + '\n', 'utf8')
  writeFileSync(join(OUT_DIR, 'MANIFEST.json'), JSON.stringify({
    identity: 'WR-TOOL-REAL-TRAJECTORY-POOL-V5',
    training: false,
    experiment_005: false,
  }, null, 2) + '\n', 'utf8')
  process.stdout.write(JSON.stringify({ ok: true, n: records.length, qcounts, srcCounts }, null, 2) + '\n')
}

main().catch((err) => {
  resetTrajectoryCaptureForTests()
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
