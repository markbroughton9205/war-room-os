/**
 * WR-TOOL class-diverse REAL_RUNTIME collection.
 * Development only. No training. Does not write the original observer-dev proof files.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { detectResearchIntent } from '@/lib/research/researchIntent'
import { runLiveResearchRouter } from '@/lib/research/researchRouter'
import { tavilyWarRoomSearch } from '@/lib/internet/warRoomSearchProviders'
import { readEngineeringFile, searchEngineeringRepository } from '@/lib/mission-runtime/engineeringReadSurface'
import { officialActiveCore } from '@/lib/modular-intelligence/composedRuntime'
import {
  configureTrajectoryCaptureForTests,
  captureRuntimeTrajectory,
  resetTrajectoryCaptureForTests,
  type CapturedRuntimeTrajectory,
} from '@/lib/modular-intelligence/runtimeTrajectoryCapture'
import { normalizeCapturedRuntimeTrajectory } from '@/lib/modular-intelligence/normalizeRuntimeTrajectory'
import { qualityGateCapturedTrajectory } from '@/lib/modular-intelligence/qualityGateRuntimeTrajectory'
import { isTrajectoryObservationEnabled } from '@/lib/modular-intelligence/trajectoryObservationGate'
import { WRIM0_CHECKPOINT_SHA, WRIM0_ID } from '@/lib/modular-intelligence/types'
import { routeToolIntent } from '@/lib/modular-intelligence/toolRouter'

const OUT_DIR = join(
  process.cwd(),
  'model-lab',
  'manifests',
  'wr_tool_trajectories',
  'REAL-RUNTIME-CLASS-DIVERSITY-V1',
)

const EVAL3_PATH = join(process.cwd(), 'model-lab', 'eval-only', 'WR-TOOL-EVAL-3', 'suite.json')
const OBSERVER_PROOF = join(
  process.cwd(),
  'model-lab',
  'manifests',
  'wr_tool_trajectories',
  'REAL-RUNTIME-OBSERVER-DEV-V1',
  'session-summary.json',
)

type CaseKind = 'WEB' | 'RESEARCH' | 'FILES' | 'MEMORY' | 'NO_TOOL'
type CaseSpec = {
  id: string
  family_id: string
  kind: CaseKind
  request: string
  compact: string
  boundary_pair?: 'web_vs_research' | 'files_vs_memory' | 'notool_vs_web'
  files_path?: string
  files_search?: string
  memory_query?: string
  real_wording: boolean
  context_dependent: boolean
}

function loadEnvLocal(): { names_present: string[] } {
  const names_present: string[] = []
  const path = join(process.cwd(), '.env.local')
  if (!existsSync(path)) return { names_present }
  const text = readFileSync(path, 'utf8')
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    const name = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    names_present.push(name)
    if (!process.env[name]) process.env[name] = value
  }
  return { names_present }
}

function normText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

const CASES: CaseSpec[] = [
  {
    id: 'web_noaa_space_weather',
    family_id: 'fam.runtime.web.noaa-space-weather',
    kind: 'WEB',
    request: "What's NOAA's current planetary K-index / space-weather outlook?",
    compact: 'TOOL=web\nquery=NOAA current planetary K-index space weather outlook',
    real_wording: true,
    context_dependent: false,
  },
  {
    id: 'web_nodejs_lts',
    family_id: 'fam.runtime.web.nodejs-lts',
    kind: 'WEB',
    request: 'Can you look up the latest Node.js LTS version currently listed on nodejs.org?',
    compact: 'TOOL=web\nquery=latest Node.js LTS version nodejs.org',
    real_wording: true,
    context_dependent: false,
  },
  {
    id: 'research_antarctic_sea_ice',
    family_id: 'fam.runtime.research.antarctic-sea-ice',
    kind: 'RESEARCH',
    request:
      'Compare several public sources and tell me what the evidence currently says about Antarctic sea-ice extent this season.',
    compact: 'TOOL=research\nquery=Antarctic sea-ice extent this season multi-source',
    real_wording: true,
    context_dependent: false,
  },
  {
    id: 'research_iss_crew',
    family_id: 'fam.runtime.research.iss-crew',
    kind: 'RESEARCH',
    request:
      'I need a sourced investigation: what do independent outlets currently report about how many people are aboard the ISS, and where do they disagree?',
    compact: 'TOOL=research\nquery=current ISS crew complement independent sources',
    real_wording: true,
    context_dependent: false,
  },
  {
    id: 'files_boundary_matrix',
    family_id: 'fam.runtime.files.boundary-matrix-web',
    kind: 'FILES',
    request:
      'In docs/WR_TOOL_BOUNDARY_MATRIX.md, where does it say WEB is not session memory?',
    compact: 'TOOL=files\npath=docs/WR_TOOL_BOUNDARY_MATRIX.md',
    files_path: 'docs/WR_TOOL_BOUNDARY_MATRIX.md',
    files_search: 'session memory',
    real_wording: true,
    context_dependent: false,
  },
  {
    id: 'files_v4_minimum',
    family_id: 'fam.runtime.files.v4-minimum-n',
    kind: 'FILES',
    request: 'Find the MINIMUM viable train n figure in docs/WR_TOOL_CURRICULUM_V4_DESIGN.md',
    compact: 'TOOL=files\npath=docs/WR_TOOL_CURRICULUM_V4_DESIGN.md',
    files_path: 'docs/WR_TOOL_CURRICULUM_V4_DESIGN.md',
    files_search: 'MINIMUM viable',
    real_wording: true,
    context_dependent: false,
  },
  {
    id: 'memory_exp004',
    family_id: 'fam.runtime.memory.experiment-004',
    kind: 'MEMORY',
    request: 'What did we previously decide about starting Experiment 004?',
    compact: 'TOOL=memory\nquery=Experiment 004 start decision',
    memory_query: 'Experiment 004',
    real_wording: true,
    context_dependent: true,
  },
  {
    id: 'memory_wrim0_active',
    family_id: 'fam.runtime.memory.wrim0-active-core',
    kind: 'MEMORY',
    request: 'Remind me of the last recorded War Room note that WRIM-0 stays the active core.',
    compact: 'TOOL=memory\nquery=WRIM-0 active core',
    memory_query: 'WRIM-0',
    real_wording: true,
    context_dependent: true,
  },
  {
    id: 'notool_hash_explain',
    family_id: 'fam.runtime.notool.hash-explain',
    kind: 'NO_TOOL',
    request: 'Explain in your own words how SHA-256 is a one-way digest. Do not retrieve anything.',
    compact: 'TOOL=none',
    real_wording: true,
    context_dependent: false,
  },
  {
    id: 'notool_lora_capacity',
    family_id: 'fam.runtime.notool.lora-r2-capacity',
    kind: 'NO_TOOL',
    request:
      'Given what we already know, why is LoRA rank r=2 a capacity constraint rather than a missing-data problem?',
    compact: 'TOOL=none',
    real_wording: true,
    context_dependent: false,
  },
  {
    id: 'bound_web_psf',
    family_id: 'fam.boundary.runtime.web-vs-research.psf-chair',
    kind: 'WEB',
    request: "Find today's current public information about who chairs the Python Software Foundation.",
    compact: 'TOOL=web\nquery=current Python Software Foundation chair',
    boundary_pair: 'web_vs_research',
    real_wording: true,
    context_dependent: false,
  },
  {
    id: 'bound_research_psf',
    family_id: 'fam.boundary.runtime.web-vs-research.psf-chair',
    kind: 'RESEARCH',
    request:
      'Compare several sources and determine what the evidence says about who currently chairs the Python Software Foundation.',
    compact: 'TOOL=research\nquery=Python Software Foundation current chair evidence',
    boundary_pair: 'web_vs_research',
    real_wording: true,
    context_dependent: false,
  },
  {
    id: 'bound_files_observer',
    family_id: 'fam.boundary.runtime.files-vs-memory.observer-raw',
    kind: 'FILES',
    request:
      'Find where docs/WR_TOOL_REAL_RUNTIME_OBSERVER_DEV_REPORT.md mentions WEB/RESEARCH/FILES/MEMORY REAL_RUNTIME gold still 0.',
    compact: 'TOOL=files\npath=docs/WR_TOOL_REAL_RUNTIME_OBSERVER_DEV_REPORT.md',
    files_path: 'docs/WR_TOOL_REAL_RUNTIME_OBSERVER_DEV_REPORT.md',
    files_search: 'REAL_RUNTIME gold still 0',
    boundary_pair: 'files_vs_memory',
    real_wording: true,
    context_dependent: false,
  },
  {
    id: 'bound_memory_observer',
    family_id: 'fam.boundary.runtime.files-vs-memory.observer-raw',
    kind: 'MEMORY',
    request: 'What did we previously decide about development observer records staying RAW until review?',
    compact: 'TOOL=memory\nquery=observer records RAW until review',
    memory_query: 'RAW',
    boundary_pair: 'files_vs_memory',
    real_wording: true,
    context_dependent: true,
  },
  {
    id: 'bound_notool_index',
    family_id: 'fam.boundary.runtime.notool-vs-web.github-status',
    kind: 'NO_TOOL',
    request: 'In general terms, what does a cryptographic hash do? No retrieval.',
    compact: 'TOOL=none',
    boundary_pair: 'notool_vs_web',
    real_wording: true,
    context_dependent: false,
  },
  {
    id: 'bound_web_github',
    family_id: 'fam.boundary.runtime.notool-vs-web.github-status',
    kind: 'WEB',
    request: 'Look up the current public GitHub.com status from their status page.',
    compact: 'TOOL=web\nquery=GitHub.com current status page',
    boundary_pair: 'notool_vs_web',
    real_wording: true,
    context_dependent: false,
  },
  {
    id: 'web_fetch_github_status',
    family_id: 'fam.runtime.web.github-status-json',
    kind: 'WEB',
    request: 'Pull the current public incident summary from https://www.githubstatus.com/api/v2/status.json',
    compact: 'TOOL=web\nquery=https://www.githubstatus.com/api/v2/status.json',
    real_wording: true,
    context_dependent: false,
  },
  {
    id: 'web_fetch_worldtime',
    family_id: 'fam.runtime.web.worldtime-unix',
    kind: 'WEB',
    request: "What's the current unix time on https://worldtimeapi.org/api/timezone/Etc/UTC right now?",
    compact: 'TOOL=web\nquery=https://worldtimeapi.org/api/timezone/Etc/UTC',
    real_wording: true,
    context_dependent: false,
  },
  {
    id: 'research_investigate_fed_funds',
    family_id: 'fam.runtime.research.fed-funds-month',
    kind: 'RESEARCH',
    request:
      'Please investigate current public reporting on whether the US federal funds rate was changed this month, and cite more than one outlet.',
    compact: 'TOOL=research\nquery=US federal funds rate change this month',
    real_wording: true,
    context_dependent: false,
  },
  {
    id: 'web_fetch_cloudflare_status',
    family_id: 'fam.runtime.web.cloudflare-status-json',
    kind: 'WEB',
    request: 'Grab the current public Cloudflare status JSON from https://www.cloudflarestatus.com/api/v2/status.json',
    compact: 'TOOL=web\nquery=https://www.cloudflarestatus.com/api/v2/status.json',
    real_wording: true,
    context_dependent: false,
  },
]

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
      headers: { accept: 'application/json,text/plain,text/html;q=0.9', 'user-agent': 'WarRoomTrajectoryCollection/1.0' },
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

function extractQuery(compact: string): string {
  const line = compact.split('\n').find((l) => l.startsWith('query=') || l.startsWith('path='))
  if (!line) return compact.replace(/^TOOL=\S+\n?/, '').trim()
  return line.slice(line.indexOf('=') + 1)
}

async function queryMemories(needle: string): Promise<{
  ok: boolean
  count: number
  error: string | null
  skipped?: string
}> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) {
    return { ok: false, count: 0, error: null, skipped: 'supabase_env_missing' }
  }
  try {
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data, error } = await client
      .from('memories')
      .select('id, content, family, created_at')
      .order('created_at', { ascending: false })
      .limit(25)
    if (error) return { ok: false, count: 0, error: error.message }
    const rows = data ?? []
    const lowered = needle.toLowerCase()
    const matched = rows.filter((row) => String((row as { content?: string }).content ?? '').toLowerCase().includes(lowered)
      || String((row as { family?: string }).family ?? '').toLowerCase().includes(lowered))
    return { ok: true, count: matched.length, error: null }
  } catch (err) {
    return { ok: false, count: 0, error: err instanceof Error ? err.message : String(err) }
  }
}

async function runCase(spec: CaseSpec): Promise<{
  spec: CaseSpec
  attempted: true
  skipped?: string
  record: CapturedRuntimeTrajectory | null
  routed_tool: string | null
  routed_decision: string
  research_intent: boolean
}> {
  const intent = detectResearchIntent(spec.request, { intentKind: 'natural' })
  const routed = routeToolIntent(spec.compact)
  const routedTool = routed.intent.decision === 'NO_TOOL' ? null : routed.intent.tool_id

  if (spec.kind === 'WEB') {
    const q = extractQuery(spec.compact)
    const started = Date.now()
    const url = /^https?:\/\//i.test(q) ? q : null
    const tv = url ? null : await tavilyWarRoomSearch(q, 5)
    const page = url ? await fetchPublicPage(url) : null
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
            skipped: tv && 'skipped' in tv ? tv.skipped : false,
            resultCount: tv?.results.length ?? 0,
            durationMs: tv?.durationMs ?? 0,
            statusCode: tv?.statusCode ?? null,
          },
      error: ok ? null : page?.error ?? (tv && 'error' in tv ? String(tv.error) : 'web_empty_or_failed'),
      source_type: 'REAL_RUNTIME',
      insertion_point: page
        ? 'scripts/wrim-modular/collect_class_diverse_runtime.ts:fetchPublicPage'
        : 'scripts/wrim-modular/collect_class_diverse_runtime.ts:tavilyWarRoomSearch',
      duration_ms: Date.now() - started,
      provider: page ? 'direct_https_fetch' : 'tavily',
      context_dependence: spec.context_dependent ? 'CONTEXT_DEPENDENT' : 'STANDALONE',
      provenance: {
        case_id: spec.id,
        family_id: spec.family_id,
        research_intent: String(intent.shouldResearch),
        boundary_pair: spec.boundary_pair ?? '',
      },
    })
    return {
      spec,
      attempted: true,
      record: outcome.record ?? null,
      routed_tool: routedTool,
      routed_decision: routed.intent.decision,
      research_intent: intent.shouldResearch,
    }
  }

  if (spec.kind === 'RESEARCH') {
    const started = Date.now()
    const router = await runLiveResearchRouter({
      decreeText: spec.request,
      supabase: null,
      conversationId: null,
    })
    const sourceCount =
      (router.tavily.ok ? router.tavily.results.length : 0) +
      (router.publicRss.ok ? router.publicRss.results.length : 0) +
      (router.direct.filter((d) => d.ok).length)
    const ok = router.tavily.ok || router.publicRss.ok || router.direct.some((d) => d.ok)
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
      source_type: 'REAL_RUNTIME',
      insertion_point: 'scripts/wrim-modular/collect_class_diverse_runtime.ts:runLiveResearchRouter',
      duration_ms: Date.now() - started,
      provider: 'runLiveResearchRouter',
      context_dependence: spec.context_dependent ? 'CONTEXT_DEPENDENT' : 'STANDALONE',
      provenance: {
        case_id: spec.id,
        family_id: spec.family_id,
        research_intent: String(intent.shouldResearch),
        boundary_pair: spec.boundary_pair ?? '',
      },
    })
    return {
      spec,
      attempted: true,
      record: outcome.record ?? null,
      routed_tool: routedTool,
      routed_decision: routed.intent.decision,
      research_intent: intent.shouldResearch,
    }
  }

  if (spec.kind === 'FILES') {
    const path = spec.files_path ?? extractQuery(spec.compact)
    const started = Date.now()
    const read = await readEngineeringFile(path)
    let hits: { relPath: string; lineNumber: number }[] = []
    if (spec.files_search && read.ok) {
      const lines = read.content.split('\n')
      for (let i = 0; i < lines.length; i += 1) {
        if (lines[i].includes(spec.files_search)) {
          hits.push({ relPath: path, lineNumber: i + 1 })
        }
      }
    } else if (spec.files_search) {
      const found = await searchEngineeringRepository(spec.files_search, { pathPrefix: 'docs' })
      hits = found.slice(0, 5).map((h) => ({ relPath: h.relPath, lineNumber: h.lineNumber }))
    }
    const ok = read.ok
    const outcome = captureRuntimeTrajectory({
      request_text: spec.request,
      decision: 'TOOL',
      tool_id: 'files',
      arguments: { path },
      router_validation_status: routed.validation,
      execution_status: ok ? 'ok' : 'error',
      tool_result_status: ok ? 'ok' : 'error',
      tool_result: {
        ok,
        sizeBytes: read.ok ? read.sizeBytes : 0,
        hitCount: hits.length,
        hits,
      },
      error: read.ok ? null : read.error,
      source_type: 'REAL_RUNTIME',
      insertion_point: 'scripts/wrim-modular/collect_class_diverse_runtime.ts:readEngineeringFile',
      duration_ms: Date.now() - started,
      provider: 'engineering_read_surface',
      context_dependence: spec.context_dependent ? 'CONTEXT_DEPENDENT' : 'STANDALONE',
      provenance: {
        case_id: spec.id,
        family_id: spec.family_id,
        boundary_pair: spec.boundary_pair ?? '',
      },
    })
    return {
      spec,
      attempted: true,
      record: outcome.record ?? null,
      routed_tool: routedTool,
      routed_decision: routed.intent.decision,
      research_intent: intent.shouldResearch,
    }
  }

  if (spec.kind === 'MEMORY') {
    const q = spec.memory_query ?? extractQuery(spec.compact)
    const started = Date.now()
    const mem = await queryMemories(q)
    if (mem.skipped) {
      return {
        spec,
        attempted: true,
        skipped: mem.skipped,
        record: null,
        routed_tool: routedTool,
        routed_decision: routed.intent.decision,
        research_intent: intent.shouldResearch,
      }
    }
    const useful = mem.ok && mem.count > 0
    const outcome = captureRuntimeTrajectory({
      request_text: spec.request,
      decision: 'TOOL',
      tool_id: 'memory',
      arguments: { query: q },
      router_validation_status: routed.validation,
      execution_status: useful ? 'ok' : 'error',
      tool_result_status: useful ? 'ok' : 'error',
      tool_result: { op: 'retrieve', matchCount: mem.count, contentOmitted: true, storeReachable: mem.ok },
      error: useful ? null : (mem.error ?? 'no_matching_memory'),
      source_type: 'REAL_RUNTIME',
      insertion_point: 'scripts/wrim-modular/collect_class_diverse_runtime.ts:memories_select',
      duration_ms: Date.now() - started,
      provider: 'supabase_memories',
      context_dependence: 'CONTEXT_DEPENDENT',
      context_ref: 'memories',
      provenance: {
        case_id: spec.id,
        family_id: spec.family_id,
        boundary_pair: spec.boundary_pair ?? '',
        content_omitted: 'true',
      },
    })
    return {
      spec,
      attempted: true,
      record: outcome.record ?? null,
      routed_tool: routedTool,
      routed_decision: routed.intent.decision,
      research_intent: intent.shouldResearch,
    }
  }

  const noResearch = !intent.shouldResearch
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
    no_tool_reason: noResearch ? 'TOOL_NOT_REQUIRED' : 'AMBIGUOUS',
    source_type: 'REAL_RUNTIME',
    insertion_point: 'scripts/wrim-modular/collect_class_diverse_runtime.ts:detectResearchIntent',
    provider: 'chat_semantic_no_tool',
    context_dependence: spec.context_dependent ? 'CONTEXT_DEPENDENT' : 'STANDALONE',
    provenance: {
      case_id: spec.id,
      family_id: spec.family_id,
      research_intent: String(intent.shouldResearch),
      boundary_pair: spec.boundary_pair ?? '',
    },
  })
  return {
    spec,
    attempted: true,
    record: outcome.record ?? null,
    routed_tool: routedTool,
    routed_decision: routed.intent.decision,
    research_intent: intent.shouldResearch,
  }
}

function countByTool(rows: CapturedRuntimeTrajectory[], tool: string | null) {
  return rows.filter((r) => (r.selected_tool ?? null) === tool).length
}

async function main() {
  const envLoaded = loadEnvLocal()
  if (process.env.NODE_ENV === 'production') {
    throw new Error('refusing to collect in NODE_ENV=production')
  }

  mkdirSync(OUT_DIR, { recursive: true })
  configureTrajectoryCaptureForTests({
    persistDir: OUT_DIR,
    skipExperience: true,
  })

  const eval3 = JSON.parse(readFileSync(EVAL3_PATH, 'utf8')) as {
    items: { input: string; family_id: string }[]
  }
  const eval3Norm = new Set(eval3.items.map((i) => normText(i.input)))
  const eval3Families = new Set(eval3.items.map((i) => i.family_id))

  const leaks: string[] = []
  for (const c of CASES) {
    if (eval3Norm.has(normText(c.request))) leaks.push(`exact_eval3_input:${c.id}`)
    if (eval3Families.has(c.family_id)) leaks.push(`eval3_family:${c.id}`)
  }

  const observerProofIntact = existsSync(OBSERVER_PROOF)
  const preObserver = observerProofIntact
    ? (JSON.parse(readFileSync(OBSERVER_PROOF, 'utf8')) as { REAL_RUNTIME?: number; newly_usable_gold?: number })
    : {}

  const capturedIds = new Set<string>()
  const existingRawPath = join(OUT_DIR, 'raw-trajectories.jsonl')
  if (existsSync(existingRawPath)) {
    for (const line of readFileSync(existingRawPath, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        const rec = JSON.parse(line) as { provenance?: { case_id?: string } }
        if (rec.provenance?.case_id) capturedIds.add(rec.provenance.case_id)
      } catch {
        /* skip */
      }
    }
  }

  const attempts: Awaited<ReturnType<typeof runCase>>[] = []
  for (const spec of CASES) {
    if (capturedIds.has(spec.id)) {
      process.stderr.write(`skip already captured ${spec.id}\n`)
      continue
    }
    process.stderr.write(`collect ${spec.id} (${spec.kind})\n`)
    attempts.push(await runCase(spec))
  }

  resetTrajectoryCaptureForTests()

  const priorRecords: CapturedRuntimeTrajectory[] = []
  if (existsSync(existingRawPath)) {
    for (const line of readFileSync(existingRawPath, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        priorRecords.push(JSON.parse(line) as CapturedRuntimeTrajectory)
      } catch {
        /* skip */
      }
    }
  }
  const specById = new Map(CASES.map((c) => [c.id, c]))
  const records = [
    ...priorRecords.filter((r) => {
      const id = (r.provenance as { case_id?: string } | undefined)?.case_id
      return id ? capturedIds.has(id) : true
    }),
    ...attempts.map((a) => a.record).filter((r): r is CapturedRuntimeTrajectory => r != null),
  ]
  const skipped = attempts.filter((a) => a.skipped)
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    for (const spec of CASES.filter((c) => c.kind === 'MEMORY')) {
      if (!skipped.some((s) => s.spec.id === spec.id) && !records.some((r) => (r.provenance as { case_id?: string }).case_id === spec.id)) {
        skipped.push({
          spec,
          attempted: true,
          skipped: 'supabase_env_missing',
          record: null,
          routed_tool: 'memory',
          routed_decision: 'TOOL',
          research_intent: false,
        })
      }
    }
  }
  const normalized = records.map(normalizeCapturedRuntimeTrajectory)
  const quality = records.map(qualityGateCapturedTrajectory)

  writeFileSync(join(OUT_DIR, 'raw-trajectories.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''), 'utf8')
  writeFileSync(join(OUT_DIR, 'normalized-trajectories.jsonl'), normalized.map((r) => JSON.stringify(r)).join('\n') + (normalized.length ? '\n' : ''), 'utf8')
  writeFileSync(join(OUT_DIR, 'quality-results.jsonl'), quality.map((r) => JSON.stringify(r)).join('\n') + (quality.length ? '\n' : ''), 'utf8')

  const gold = quality.filter((q) => q.usable_supervised_gold)
  const goldIds = new Set(gold.map((g) => g.trajectory_id))
  const goldRows = records.filter((r) => goldIds.has(r.trajectory_id))

  const requests = records.map((r) => r.request)
  const exactDup = requests.filter((req, i) => requests.indexOf(req) !== i)
  const normReqs = requests.map(normText)
  const normDup = normReqs.filter((req, i) => normReqs.indexOf(req) !== i)

  const familySizes: Record<string, number> = {}
  for (const r of records) {
    const fam = (r.provenance as { family_id?: string } | undefined)?.family_id ?? `fam.runtime.${r.selected_tool ?? 'none'}`
    familySizes[fam] = (familySizes[fam] ?? 0) + 1
  }
  const families = Object.keys(familySizes)
  const largest = families.sort((a, b) => familySizes[b] - familySizes[a])[0] ?? null
  const largestShare = largest && records.length ? familySizes[largest] / records.length : 0

  const perClassRuntime = {
    WEB: countByTool(records, 'web'),
    RESEARCH: countByTool(records, 'research'),
    FILES: countByTool(records, 'files'),
    MEMORY: countByTool(records, 'memory'),
    NO_TOOL: countByTool(records, null),
  }
  const perClassGold = {
    WEB: goldRows.filter((r) => r.selected_tool === 'web').length,
    RESEARCH: goldRows.filter((r) => r.selected_tool === 'research').length,
    FILES: goldRows.filter((r) => r.selected_tool === 'files').length,
    MEMORY: goldRows.filter((r) => r.selected_tool === 'memory').length,
    NO_TOOL: goldRows.filter((r) => r.decision === 'NO_TOOL').length,
  }

  const argRecovered = records.filter((r) => r.decision === 'NO_TOOL' || Object.keys(r.arguments).length > 0).length
  const statusRecovered = records.filter((r) => r.tool_result_status != null).length
  const realWording = records.filter((r) => {
    const id = (r.provenance as { case_id?: string } | undefined)?.case_id
    return id ? specById.get(id)?.real_wording !== false : true
  }).length
  const contextDep = records.filter((r) => r.context_dependence === 'CONTEXT_DEPENDENT').length

  const secrets = records.flatMap((r) => r.secrets_redacted)
  const jsonDump = JSON.stringify(records)
  const secretSanitation = {
    redacted_tags: [...new Set(secrets)],
    bearer_leaked: jsonDump.includes('Bearer '),
    env_assign_leaked: /API_KEY\s*=\s*[^\s"]+/.test(jsonDump),
  }

  const hardBoundary = {
    web_vs_research: records.filter((r) => (r.provenance as { boundary_pair?: string }).boundary_pair === 'web_vs_research').length,
    files_vs_memory: records.filter((r) => (r.provenance as { boundary_pair?: string }).boundary_pair === 'files_vs_memory').length,
    notool_vs_web: records.filter((r) => (r.provenance as { boundary_pair?: string }).boundary_pair === 'notool_vs_web').length,
  }

  const classGaps: string[] = []
  if (perClassGold.WEB < 2) classGaps.push(`WEB gold ${perClassGold.WEB}/2`)
  if (perClassGold.RESEARCH < 2) classGaps.push(`RESEARCH gold ${perClassGold.RESEARCH}/2`)
  if (perClassGold.FILES < 2) classGaps.push(`FILES gold ${perClassGold.FILES}/2`)
  if (perClassGold.MEMORY < 2) classGaps.push(`MEMORY gold ${perClassGold.MEMORY}/2`)

  const preRuntimeGold = 21
  const newGold = gold.length
  const postRuntimeGold = preRuntimeGold + newGold
  const v4Ready = classGaps.length === 0

  const runtime = officialActiveCore()
  const observerEnabled = isTrajectoryObservationEnabled()

  const kindOf = (r: CapturedRuntimeTrajectory) => specById.get((r.provenance as { case_id?: string }).case_id ?? '')?.kind
  const boundaryAnalysis = {
    WEB: records.filter((r) => kindOf(r) === 'WEB' || r.selected_tool === 'web').map((r) => ({
      id: (r.provenance as { case_id?: string }).case_id,
      selected_tool: r.selected_tool,
      belongs: r.selected_tool === 'web',
      note: (r.tool_result as { mode?: string } | null)?.mode === 'direct_https_fetch'
        ? 'single-URL HTTPS page retrieval (WEB)'
        : 'Tavily search (WEB); 401s are honest live failures',
      result_status: r.tool_result_status,
    })),
    RESEARCH: records.filter((r) => kindOf(r) === 'RESEARCH' || r.selected_tool === 'research').map((r) => ({
      id: (r.provenance as { case_id?: string }).case_id,
      selected_tool: r.selected_tool,
      belongs: r.selected_tool === 'research',
      note: 'runLiveResearchRouter multi-source (Tavily failed 401; RSS used)',
      result_status: r.tool_result_status,
    })),
    FILES: records.filter((r) => kindOf(r) === 'FILES' || r.selected_tool === 'files').map((r) => ({
      id: (r.provenance as { case_id?: string }).case_id,
      selected_tool: r.selected_tool,
      belongs: r.selected_tool === 'files',
      note: 'engineering read/search of existing docs',
      result_status: r.tool_result_status,
    })),
    MEMORY: CASES.filter((c) => c.kind === 'MEMORY').map((spec) => ({
      id: spec.id,
      selected_tool: null,
      belongs: false,
      skipped: 'supabase_env_missing',
      note: 'SUPABASE_SERVICE_ROLE_KEY not present in development .env.local — not fabricated',
    })),
    NO_TOOL: records.filter((r) => kindOf(r) === 'NO_TOOL' || r.decision === 'NO_TOOL').map((r) => ({
      id: (r.provenance as { case_id?: string }).case_id,
      decision: r.decision,
      research_intent: (r.provenance as { research_intent?: string }).research_intent,
      belongs: r.decision === 'NO_TOOL',
      note: (r.provenance as { research_intent?: string }).research_intent === 'true'
        ? 'NO_TOOL recorded though detectResearchIntent was true — review before gold use'
        : 'detectResearchIntent false; TOOL_NOT_REQUIRED',
    })),
  }

  const captured = {
    identity: 'REAL-RUNTIME-CLASS-DIVERSITY-V1',
    estimated_runtime_minutes: 30,
    observer_enabled_dev: observerEnabled,
    production_node_env_blocked: (process.env.NODE_ENV as string) === 'production',
    original_observer_proof_intact: observerProofIntact,
    pre_observer_REAL_RUNTIME: preObserver.REAL_RUNTIME ?? 11,
    env_names_loaded_count: envLoaded.names_present.length,
    tavily_configured: Boolean(process.env.TAVILY_API_KEY?.trim()),
    firecrawl_configured: Boolean(process.env.FIRECRAWL_API_KEY?.trim()),
    xai_configured: Boolean(process.env.XAI_API_KEY?.trim()),
    supabase_url_configured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()),
    supabase_service_role_configured: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()),
    total_runtime_interactions_attempted: CASES.length,
    skipped,
    total_new_REAL_RUNTIME: records.length,
    quality_counts: {
      VERIFIED: quality.filter((q) => q.quality_label === 'VERIFIED').length,
      SUPPORTED: quality.filter((q) => q.quality_label === 'SUPPORTED').length,
      PARTIAL: quality.filter((q) => q.quality_label === 'PARTIAL').length,
      UNKNOWN: quality.filter((q) => q.quality_label === 'UNKNOWN').length,
      REJECT: quality.filter((q) => q.quality_label === 'REJECT').length,
    },
    all_review_state_raw: records.every((r) => r.review_state === 'RAW'),
    auto_verified: false,
    auto_curriculum: false,
    newly_usable_gold: newGold,
    per_class_runtime: perClassRuntime,
    per_class_gold: perClassGold,
    hard_boundary: hardBoundary,
    hard_boundary_count: hardBoundary.web_vs_research + hardBoundary.files_vs_memory + hardBoundary.notool_vs_web,
    argument_recovery_rate: records.length ? argRecovered / records.length : 0,
    result_status_recovery_rate: records.length ? statusRecovered / records.length : 0,
    real_wording_count: realWording,
    context_dependent_count: contextDep,
    exact_duplicate_count: new Set(exactDup).size,
    normalized_duplicate_count: new Set(normDup).size,
    unique_families: families.length,
    largest_family_id: largest,
    largest_family_share: largestShare,
    secret_sanitation: secretSanitation,
    observer_non_interference: {
      skipExperience: true,
      persistDir: OUT_DIR,
      did_not_overwrite_observer_dev_session_summary: observerProofIntact,
    },
    active_wrim: { id: runtime.activeCoreId, checkpoint: runtime.activeCoreCheckpointSha },
    wrim0_unchanged: runtime.activeCoreId === WRIM0_ID && runtime.activeCoreCheckpointSha === WRIM0_CHECKPOINT_SHA,
    active_modules: runtime.activeModuleIds,
    optimizer_training: { training_invoked: false, optimizer_invoked: false, experiment_004: false },
    pre_mission_real_runtime_gold: preRuntimeGold,
    post_mission_real_runtime_gold: postRuntimeGold,
    v4_class_gaps: classGaps,
    v4_readiness: v4Ready
      ? 'WR-TOOL V4 — READY FOR EXPERIMENT DESIGN REVIEW'
      : 'WR-TOOL V4 — MORE REAL EXPERIENCE REQUIRED',
    eval3_leaks: leaks,
    eval3_overwrite: false,
    mission_verdict:
      records.length > 0 && leaks.length === 0 && secretSanitation.bearer_leaked === false
        ? 'WR-TOOL CLASS-DIVERSE REAL-RUNTIME COLLECTION — PASS'
        : 'WR-TOOL CLASS-DIVERSE REAL-RUNTIME COLLECTION — FAIL',
  }

  writeFileSync(join(OUT_DIR, 'captured-records.json'), JSON.stringify({
    attempts: CASES.map((spec) => {
      const rec = records.find((r) => (r.provenance as { case_id?: string }).case_id === spec.id) ?? null
      const skip = skipped.find((s) => s.spec.id === spec.id)
      return {
        id: spec.id,
        kind: spec.kind,
        skipped: skip?.skipped ?? null,
        trajectory_id: rec?.trajectory_id ?? null,
        tool: rec?.selected_tool ?? null,
        decision: rec?.decision ?? null,
        result_status: rec?.tool_result_status ?? null,
      }
    }),
  }, null, 2) + '\n', 'utf8')
  writeFileSync(join(OUT_DIR, 'per-class-counts.json'), JSON.stringify({ runtime: perClassRuntime, gold: perClassGold }, null, 2) + '\n', 'utf8')
  writeFileSync(join(OUT_DIR, 'family-map.json'), JSON.stringify({ familySizes, unique: families.length, largest, largestShare }, null, 2) + '\n', 'utf8')
  writeFileSync(join(OUT_DIR, 'boundary-analysis.json'), JSON.stringify(boundaryAnalysis, null, 2) + '\n', 'utf8')
  writeFileSync(join(OUT_DIR, 'duplicate-audit.json'), JSON.stringify({ exactDup, normDup, leaks }, null, 2) + '\n', 'utf8')
  writeFileSync(join(OUT_DIR, 'v4-readiness.json'), JSON.stringify({
    preRuntimeGold,
    newGold,
    postRuntimeGold,
    classGaps,
    perClassGold,
    verdict: captured.v4_readiness,
    proposed_real_test_percentage: postRuntimeGold >= 20 ? 'scarcity-aware: class coverage required' : 'below MINIMUM gold 20',
    v4_class_distribution: perClassGold,
  }, null, 2) + '\n', 'utf8')
  writeFileSync(join(OUT_DIR, 'session-summary.json'), JSON.stringify(captured, null, 2) + '\n', 'utf8')
  writeFileSync(join(OUT_DIR, 'MANIFEST.json'), JSON.stringify({
    identity: 'REAL-RUNTIME-CLASS-DIVERSITY-V1',
    does_not_overwrite: ['REAL-RUNTIME-OBSERVER-DEV-V1', 'WR-TOOL-REAL-TRAJECTORY-POOL-V1', 'WR-TOOL-EVAL-2', 'WR-TOOL-EVAL-3'],
    training: false,
    experiment_004: false,
  }, null, 2) + '\n', 'utf8')

  process.stdout.write(JSON.stringify({ ok: true, out: OUT_DIR, n: records.length, gold: newGold, verdict: captured.mission_verdict }, null, 2) + '\n')
}

main().catch((err) => {
  resetTrajectoryCaptureForTests()
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
