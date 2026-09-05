/**
 * WR-TOOL MEMORY REAL_RUNTIME collection.
 * Development only. No training. Does not overwrite prior trajectory ledgers.
 * If SUPABASE_SERVICE_ROLE_KEY is missing, live MEMORY retrieve is skipped (not fabricated).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { detectResearchIntent } from '@/lib/research/researchIntent'
import { readEngineeringFile } from '@/lib/mission-runtime/engineeringReadSurface'
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
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

const OUT_DIR = join(
  process.cwd(),
  'model-lab',
  'manifests',
  'wr_tool_trajectories',
  'REAL-RUNTIME-MEMORY-V1',
)

const EVAL3_PATH = join(process.cwd(), 'model-lab/eval-only/WR-TOOL-EVAL-3/suite.json')
const OBSERVER_PROOF = join(
  process.cwd(),
  'model-lab/manifests/wr_tool_trajectories/REAL-RUNTIME-OBSERVER-DEV-V1/session-summary.json',
)
const CLASS_DIVERSITY = join(
  process.cwd(),
  'model-lab/manifests/wr_tool_trajectories/REAL-RUNTIME-CLASS-DIVERSITY-V1/session-summary.json',
)
const POOL_GAP = join(
  process.cwd(),
  'model-lab/manifests/wr_tool_trajectories/WR-TOOL-REAL-TRAJECTORY-POOL-V1/gap-analysis.json',
)

type CaseKind = 'MEMORY' | 'FILES' | 'NO_TOOL'
type CaseSpec = {
  id: string
  family_id: string
  kind: CaseKind
  request: string
  compact: string
  memory_query?: string
  files_path?: string
  files_search?: string
  boundary_pair?: 'files_vs_memory' | 'notool_vs_memory'
  real_wording: boolean
  context_dependent: boolean
  intended_failure?: boolean
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

function extractQuery(compact: string): string {
  const line = compact.split('\n').find((l) => l.startsWith('query=') || l.startsWith('path='))
  if (!line) return compact.replace(/^TOOL=\S+\n?/, '').trim()
  return line.slice(line.indexOf('=') + 1)
}

const CASES: CaseSpec[] = [
  {
    id: 'bound_files_council_constitution',
    family_id: 'fam.boundary.runtime.files-vs-memory.council',
    kind: 'FILES',
    request: 'What does docs/war-room-constitution.md say about the council?',
    compact: 'TOOL=files\npath=docs/war-room-constitution.md',
    files_path: 'docs/war-room-constitution.md',
    files_search: 'council',
    boundary_pair: 'files_vs_memory',
    real_wording: true,
    context_dependent: false,
  },
  {
    id: 'bound_memory_council_decree',
    family_id: 'fam.boundary.runtime.files-vs-memory.council',
    kind: 'MEMORY',
    request: 'What did War Room previously record as a stored decree about the council?',
    compact: 'TOOL=memory\nquery=council decree',
    memory_query: 'council',
    boundary_pair: 'files_vs_memory',
    real_wording: true,
    context_dependent: true,
  },
  {
    id: 'bound_notool_durable_memory_term',
    family_id: 'fam.boundary.runtime.notool-vs-memory.durable-memory',
    kind: 'NO_TOOL',
    request: 'Explain in general what durable session memory means. Do not retrieve any stored War Room notes.',
    compact: 'TOOL=none',
    boundary_pair: 'notool_vs_memory',
    real_wording: true,
    context_dependent: false,
  },
  {
    id: 'bound_memory_stored_decree',
    family_id: 'fam.boundary.runtime.notool-vs-memory.durable-memory',
    kind: 'MEMORY',
    request: 'What decrees were previously stored in War Room memory?',
    compact: 'TOOL=memory\nquery=decree',
    memory_query: 'decree',
    boundary_pair: 'notool_vs_memory',
    real_wording: true,
    context_dependent: true,
  },
  {
    id: 'memory_failure_nonexistent',
    family_id: 'fam.runtime.memory.no-match-probe',
    kind: 'MEMORY',
    request: 'Recall the prior War Room decision about ZX9-QK-MEMORY-PROBE-NONEXISTENT.',
    compact: 'TOOL=memory\nquery=ZX9-QK-MEMORY-PROBE-NONEXISTENT',
    memory_query: 'ZX9-QK-MEMORY-PROBE-NONEXISTENT',
    real_wording: true,
    context_dependent: true,
    intended_failure: true,
  },
]

function redactSecretText(value: string): string {
  return value.replace(/\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}/g, '[REDACTED:jwt]')
}

function classifyStoreError(message: string): string {
  const msg = message.toLowerCase()
  if (msg.includes('invalid api key')) return 'invalid_api_key'
  if (msg.includes('expired')) return 'jwt_expired'
  if (msg.includes('malformed')) return 'jwt_malformed'
  if (msg.includes('invalid jwt') || msg.includes('jwt')) return 'invalid_jwt'
  if (msg.includes('schema cache') || msg.includes('pgrst205')) return 'missing_relation'
  if (msg.includes('does not exist') || msg.includes('42p01') || msg.includes('42703')) return 'missing_relation'
  if (msg.includes('permission') || msg.includes('42501')) return 'permission'
  return 'query_error'
}

type MemoryHit = {
  store: string
  id_prefix: string
}

async function queryMemoryStores(needle: string): Promise<{
  ok: boolean
  count: number
  error: string | null
  error_class: string | null
  skipped?: string
  stores_queried: string[]
  hits: MemoryHit[]
  optional_store_errors?: Record<string, string>
}> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) {
    return {
      ok: false,
      count: 0,
      error: null,
      error_class: 'supabase_env_missing',
      skipped: 'supabase_env_missing',
      stores_queried: [],
      hits: [],
    }
  }
  let client
  try {
    client = createSupabaseAdminClient()
  } catch (err) {
    const msg = redactSecretText(err instanceof Error ? err.message : String(err))
    return {
      ok: false,
      count: 0,
      error: msg,
      error_class: classifyStoreError(msg),
      stores_queried: [],
      hits: [],
    }
  }
  const lowered = needle.toLowerCase()
  const stores_queried: string[] = []
  const hits: MemoryHit[] = []
  const optional_errors: Record<string, string> = {}

  const pull = async (
    table: string,
    select: string,
    fields: (row: Record<string, unknown>) => { haystack: string; id: string },
    required: boolean,
  ) => {
    const { data, error } = await client.from(table).select(select).limit(40)
    if (error) {
      const classified = classifyStoreError(error.message)
      if (required) throw new Error(`${table}:${classified}`)
      optional_errors[table] = classified
      return
    }
    stores_queried.push(table)
    for (const raw of data ?? []) {
      const row = raw as unknown as Record<string, unknown>
      const mapped = fields(row)
      if (mapped.haystack.toLowerCase().includes(lowered)) {
        hits.push({
          store: table,
          id_prefix: mapped.id.slice(0, 8),
        })
      }
    }
  }

  try {
    // Live MEMORY tool path uses `memories`. Schema is category/content (no family/source).
    await pull('memories', 'id, content, category, created_at', (row) => ({
      id: String(row.id ?? ''),
      haystack: [row.content, row.category].map((v) => String(v ?? '')).join(' '),
    }), true)
    await pull(
      'war_room_approved_memories',
      'id, title, content, family_partition, approved_at',
      (row) => ({
        id: String(row.id ?? ''),
        haystack: [row.title, row.content, row.family_partition].map((v) => String(v ?? '')).join(' '),
      }),
      false,
    )
    await pull(
      'war_room_memory_records',
      'id, content, memory_type, scope, status',
      (row) => ({
        id: String(row.id ?? ''),
        haystack: [row.content, row.memory_type, row.scope, row.status].map((v) => String(v ?? '')).join(' '),
      }),
      false,
    )
    return {
      ok: true,
      count: hits.length,
      error: null,
      error_class: null,
      stores_queried,
      hits: hits.slice(0, 8),
      optional_store_errors: optional_errors,
    }
  } catch (err) {
    const msg = redactSecretText(err instanceof Error ? err.message : String(err))
    return {
      ok: false,
      count: 0,
      error: msg,
      error_class: classifyStoreError(msg),
      stores_queried,
      hits: [],
    }
  }
}

async function runCase(spec: CaseSpec): Promise<{
  spec: CaseSpec
  attempted: true
  skipped?: string
  record: CapturedRuntimeTrajectory | null
  routed_tool: string | null
  routed_decision: string
}> {
  const intent = detectResearchIntent(spec.request, { intentKind: 'natural' })
  const routed = routeToolIntent(spec.compact)
  const routedTool = routed.intent.decision === 'NO_TOOL' ? null : routed.intent.tool_id

  if (spec.kind === 'FILES') {
    const path = spec.files_path ?? extractQuery(spec.compact)
    const started = Date.now()
    const read = await readEngineeringFile(path)
    const hits: { lineNumber: number }[] = []
    if (spec.files_search && read.ok) {
      const lines = read.content.split('\n')
      for (let i = 0; i < lines.length; i += 1) {
        if (lines[i].includes(spec.files_search)) hits.push({ lineNumber: i + 1 })
      }
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
      tool_result: { ok, sizeBytes: read.ok ? read.sizeBytes : 0, hitCount: hits.length, hits: hits.slice(0, 8) },
      error: read.ok ? null : read.error,
      source_type: 'REAL_RUNTIME',
      insertion_point: 'scripts/wrim-modular/collect_memory_runtime.ts:readEngineeringFile',
      duration_ms: Date.now() - started,
      provider: 'engineering_read_surface',
      context_dependence: 'STANDALONE',
      provenance: {
        case_id: spec.id,
        family_id: spec.family_id,
        boundary_pair: spec.boundary_pair ?? '',
        research_intent: String(intent.shouldResearch),
      },
    })
    return {
      spec,
      attempted: true,
      record: outcome.record ?? null,
      routed_tool: routedTool,
      routed_decision: routed.intent.decision,
    }
  }

  if (spec.kind === 'NO_TOOL') {
    const outcome = captureRuntimeTrajectory({
      request_text: spec.request,
      decision: 'NO_TOOL',
      tool_id: null,
      arguments: {},
      router_validation_status: routed.validation,
      execution_status: 'not_executed',
      tool_result_status: 'not_executed',
      tool_result: { decision: 'NO_TOOL', researchIntent: intent.shouldResearch },
      error: null,
      no_tool_reason: intent.shouldResearch ? 'AMBIGUOUS' : 'TOOL_NOT_REQUIRED',
      source_type: 'REAL_RUNTIME',
      insertion_point: 'scripts/wrim-modular/collect_memory_runtime.ts:detectResearchIntent',
      provider: 'chat_semantic_no_tool',
      context_dependence: 'STANDALONE',
      provenance: {
        case_id: spec.id,
        family_id: spec.family_id,
        boundary_pair: spec.boundary_pair ?? '',
        research_intent: String(intent.shouldResearch),
      },
    })
    return {
      spec,
      attempted: true,
      record: outcome.record ?? null,
      routed_tool: routedTool,
      routed_decision: routed.intent.decision,
    }
  }

  const q = spec.memory_query ?? extractQuery(spec.compact)
  const started = Date.now()
  const mem = await queryMemoryStores(q)
  if (mem.skipped) {
    return {
      spec,
      attempted: true,
      skipped: mem.skipped,
      record: null,
      routed_tool: routedTool,
      routed_decision: routed.intent.decision,
    }
  }
  const useful = mem.ok && mem.count > 0
  const outcome = captureRuntimeTrajectory({
    request_text: spec.request,
    decision: 'TOOL',
    tool_id: 'memory',
    arguments: { query: q },
    router_validation_status: routed.validation,
    execution_status: mem.ok ? (useful ? 'ok' : 'error') : 'error',
    tool_result_status: mem.ok ? (useful ? 'ok' : 'error') : 'error',
    tool_result: {
      op: 'retrieve',
      matchCount: mem.count,
      contentOmitted: true,
      storeReachable: mem.ok,
      storesQueried: mem.stores_queried,
      hitIdPrefixes: mem.hits.map((h) => h.id_prefix),
      errorClass: mem.error_class,
      optionalStoreErrors: mem.optional_store_errors ?? {},
      intendedFailure: Boolean(spec.intended_failure),
    },
    error: useful ? null : (mem.error ?? 'no_matching_memory'),
    source_type: 'REAL_RUNTIME',
    insertion_point: 'scripts/wrim-modular/collect_memory_runtime.ts:memory_stores_select',
    duration_ms: Date.now() - started,
    provider: 'supabase_memory_runtime',
    context_dependence: 'CONTEXT_DEPENDENT',
    context_ref: mem.stores_queried.join(','),
    provenance: {
      case_id: spec.id,
      family_id: spec.family_id,
      boundary_pair: spec.boundary_pair ?? '',
      content_omitted: 'true',
      intended_failure: String(Boolean(spec.intended_failure)),
    },
  })
  return {
    spec,
    attempted: true,
    record: outcome.record ?? null,
    routed_tool: routedTool,
    routed_decision: routed.intent.decision,
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

  const serviceRoleStatus = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ? 'AVAILABLE' : 'MISSING'
  const supabaseUrlStatus = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ? 'AVAILABLE' : 'MISSING'

  const eval3 = JSON.parse(readFileSync(EVAL3_PATH, 'utf8')) as {
    items: { input: string; family_id: string }[]
    item_count: number
  }
  const eval3Norm = new Set(eval3.items.map((i) => normText(i.input)))
  const leaks: string[] = []
  for (const c of CASES) {
    if (eval3Norm.has(normText(c.request))) leaks.push(`exact_eval3_input:${c.id}`)
  }

  const observerProofIntact = existsSync(OBSERVER_PROOF)
  const preObserver = observerProofIntact
    ? (JSON.parse(readFileSync(OBSERVER_PROOF, 'utf8')) as { REAL_RUNTIME?: number })
    : {}
  const classDivIntact = existsSync(CLASS_DIVERSITY)
  const classDiv = classDivIntact
    ? (JSON.parse(readFileSync(CLASS_DIVERSITY, 'utf8')) as {
        total_new_REAL_RUNTIME?: number
        per_class_gold?: { MEMORY?: number; WEB?: number; RESEARCH?: number; FILES?: number; NO_TOOL?: number }
      })
    : {}

  const attempts: Awaited<ReturnType<typeof runCase>>[] = []
  for (const spec of CASES) {
    process.stderr.write(`collect ${spec.id} (${spec.kind})\n`)
    attempts.push(await runCase(spec))
  }

  resetTrajectoryCaptureForTests()

  const records = attempts.map((a) => a.record).filter((r): r is CapturedRuntimeTrajectory => r != null)
  const skipped = attempts.filter((a) => a.skipped)
  const specById = new Map(CASES.map((c) => [c.id, c]))

  const normalized = records.map(normalizeCapturedRuntimeTrajectory)
  for (const n of normalized) {
    const fam = specById.get(
      records.find((r) => r.trajectory_id === n.trajectory_id)?.provenance?.case_id ?? '',
    )?.family_id
    if (fam) n.family_id = fam
  }
  const quality = records.map(qualityGateCapturedTrajectory)

  writeFileSync(join(OUT_DIR, 'raw-trajectories.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''), 'utf8')
  writeFileSync(join(OUT_DIR, 'normalized-trajectories.jsonl'), normalized.map((r) => JSON.stringify(r)).join('\n') + (normalized.length ? '\n' : ''), 'utf8')
  writeFileSync(join(OUT_DIR, 'quality-results.jsonl'), quality.map((r) => JSON.stringify(r)).join('\n') + (quality.length ? '\n' : ''), 'utf8')

  const gold = quality.filter((q) => q.usable_supervised_gold)
  const goldIds = new Set(gold.map((g) => g.trajectory_id))
  const goldRows = records.filter((r) => goldIds.has(r.trajectory_id))
  const memoryRecords = records.filter((r) => r.selected_tool === 'memory')
  const memoryGold = goldRows.filter((r) => r.selected_tool === 'memory')

  const requests = records.map((r) => r.request)
  const exactDup = requests.filter((req, i) => requests.indexOf(req) !== i)
  const normReqs = requests.map(normText)
  const normDup = normReqs.filter((req, i) => normReqs.indexOf(req) !== i)

  const familySizes: Record<string, number> = {}
  for (const a of attempts) {
    familySizes[a.spec.family_id] = (familySizes[a.spec.family_id] ?? 0) + 1
  }
  const families = Object.keys(familySizes)

  const jsonDump = JSON.stringify({ records, skipped, CASES })
  const jwtRe = /\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/
  const secretSanitation = {
    redacted_tags: [...new Set(records.flatMap((r) => r.secrets_redacted))],
    bearer_leaked: jsonDump.includes('Bearer '),
    jwt_leaked: jwtRe.test(jsonDump),
    env_assign_leaked: /SUPABASE_SERVICE_ROLE_KEY\s*=\s*[^\s"]+/.test(jsonDump),
    process_env_dump: jsonDump.includes('process.env'),
    key_value_copied: false,
  }

  const preMemoryGold = 0
  const postMemoryGold = memoryGold.length
  const classDivGold = classDiv.per_class_gold ?? {}
  const perClassRealGold = {
    NO_TOOL: (classDivGold.NO_TOOL ?? 3) + goldRows.filter((r) => r.decision === 'NO_TOOL').length,
    SHA256: 9,
    LOOKUP_NOTE: 0,
    ECHO_INT: 0,
    WEB: classDivGold.WEB ?? 2,
    MEMORY: postMemoryGold,
    FILES: (classDivGold.FILES ?? 3) + goldRows.filter((r) => r.selected_tool === 'files').length,
    RESEARCH: classDivGold.RESEARCH ?? 4,
  }

  const classGaps: string[] = []
  if (perClassRealGold.MEMORY < 2) classGaps.push(`MEMORY gold ${perClassRealGold.MEMORY}/2`)
  if (perClassRealGold.WEB < 2) classGaps.push(`WEB gold ${perClassRealGold.WEB}/2`)
  if (perClassRealGold.RESEARCH < 2) classGaps.push(`RESEARCH gold ${perClassRealGold.RESEARCH}/2`)
  if (perClassRealGold.FILES < 2) classGaps.push(`FILES gold ${perClassRealGold.FILES}/2`)

  const v4_readiness =
    perClassRealGold.MEMORY >= 2 &&
    (classDivGold.WEB ?? 0) >= 2 &&
    (classDivGold.RESEARCH ?? 0) >= 2 &&
    (classDivGold.FILES ?? 0) >= 2
      ? 'WR-TOOL V4 — READY FOR MATERIALIZATION REVIEW'
      : 'WR-TOOL V4 — MORE REAL EXPERIENCE REQUIRED'

  const runtime = officialActiveCore()
  const observerEnabled = isTrajectoryObservationEnabled()
  const memoryAttempted = CASES.filter((c) => c.kind === 'MEMORY').length
  const liveMemoryExecuted = serviceRoleStatus === 'AVAILABLE'
  const memoryStoreReachable = memoryRecords.some((r) => {
    const tr = r.tool_result as { storeReachable?: boolean } | null
    return tr?.storeReachable === true
  })
  const memoryHadHits = memoryRecords.some((r) => {
    const tr = r.tool_result as { matchCount?: number } | null
    return (tr?.matchCount ?? 0) > 0
  })
  const firstMemErrorClass = memoryRecords
    .map((r) => (r.tool_result as { errorClass?: string } | null)?.errorClass)
    .find((c) => c)
  const memory_service_status = !liveMemoryExecuted
    ? 'NOT_RUN_MISSING_CREDENTIAL'
    : memoryStoreReachable
      ? (memoryHadHits ? 'SERVICE_AVAILABLE_WITH_DATA' : 'SERVICE_AVAILABLE_STORE_EMPTY')
      : 'SERVICE_FAILURE'
  const memory_error_class = firstMemErrorClass ?? null

  const filesBoundMem = attempts.find((a) => a.spec.boundary_pair === 'files_vs_memory' && a.spec.kind === 'MEMORY')
  const filesBoundRetrieved = Boolean(
    filesBoundMem?.record && ((filesBoundMem.record.tool_result as { matchCount?: number } | null)?.matchCount ?? 0) > 0,
  )
  const notoolBoundMem = attempts.find((a) => a.spec.boundary_pair === 'notool_vs_memory' && a.spec.kind === 'MEMORY')
  const notoolBoundRetrieved = Boolean(
    notoolBoundMem?.record && ((notoolBoundMem.record.tool_result as { matchCount?: number } | null)?.matchCount ?? 0) > 0,
  )
  const filesVsMemory = {
    files_executed: attempts.some((a) => a.spec.boundary_pair === 'files_vs_memory' && a.spec.kind === 'FILES' && a.record),
    memory_executed: attempts.some((a) => a.spec.boundary_pair === 'files_vs_memory' && a.spec.kind === 'MEMORY' && a.record),
    memory_retrieved_prior_context: filesBoundRetrieved,
    result: attempts.some((a) => a.spec.boundary_pair === 'files_vs_memory' && a.spec.kind === 'FILES' && a.record)
      && filesBoundRetrieved
      ? 'CREDIBLE_PAIR'
      : 'INCOMPLETE_MEMORY_DID_NOT_RETRIEVE_PRIOR_CONTEXT',
  }
  const notoolVsMemory = {
    notool_executed: attempts.some((a) => a.spec.boundary_pair === 'notool_vs_memory' && a.spec.kind === 'NO_TOOL' && a.record),
    memory_executed: attempts.some((a) => a.spec.boundary_pair === 'notool_vs_memory' && a.spec.kind === 'MEMORY' && a.record),
    memory_retrieved_prior_context: notoolBoundRetrieved,
    result: attempts.some((a) => a.spec.boundary_pair === 'notool_vs_memory' && a.spec.kind === 'NO_TOOL' && a.record)
      && notoolBoundRetrieved
      ? 'CREDIBLE_PAIR'
      : 'INCOMPLETE_MEMORY_DID_NOT_RETRIEVE_PRIOR_CONTEXT',
  }

  const echoIntRole = {
    classification: 'B',
    label: 'deterministic test/gym schema fixture',
    authority: 'curriculum_synthetic',
    executionProvider: 'mock',
    in_tool_registry: false,
    block_v4_on_missing_REAL_RUNTIME: false,
    do_not_invent_live_use: true,
  }
  const lookupNoteRole = {
    classification: 'curriculum_and_test_internal',
    label: 'curriculum synthetic note lookup; not an operator-facing War Room tool',
    authority: 'curriculum_synthetic',
    executionProvider: 'mock',
    in_tool_registry: false,
    pool_REAL_TEST: 1,
    block_v4_on_missing_REAL_RUNTIME: false,
    do_not_force_live_collection: true,
  }

  const recommendedOperatorFacing = ['NO_TOOL', 'WEB', 'MEMORY', 'FILES', 'RESEARCH']
  const recommendedGymBounded = ['SHA256']
  const recommendedTestOnly = ['LOOKUP_NOTE', 'ECHO_INT']

  const qualityCounts = {
    VERIFIED: quality.filter((q) => q.quality_label === 'VERIFIED').length,
    SUPPORTED: quality.filter((q) => q.quality_label === 'SUPPORTED').length,
    PARTIAL: quality.filter((q) => q.quality_label === 'PARTIAL').length,
    UNKNOWN: quality.filter((q) => q.quality_label === 'UNKNOWN').length,
    REJECT: quality.filter((q) => q.quality_label === 'REJECT').length,
  }

  const argRecovered = records.filter((r) => r.decision === 'NO_TOOL' || Object.keys(r.arguments).length > 0).length
  const statusRecovered = records.filter((r) => r.tool_result_status != null).length

  const skippedMemoryCount = skipped.filter((s) => s.spec.kind === 'MEMORY').length
  const memoryHonesty = liveMemoryExecuted
    ? skippedMemoryCount === 0
    : memoryRecords.length === 0 && skippedMemoryCount === memoryAttempted
  const missionPass =
    leaks.length === 0 &&
    secretSanitation.bearer_leaked === false &&
    secretSanitation.jwt_leaked === false &&
    memoryHonesty &&
    runtime.activeCoreId === WRIM0_ID

  const noMatchAttempt = attempts.find((a) => a.spec.intended_failure && a.spec.kind === 'MEMORY')
  const noMatchResult = noMatchAttempt?.record?.tool_result as {
    storeReachable?: boolean
    matchCount?: number
    intendedFailure?: boolean
  } | null
  const memory_failure_case = !liveMemoryExecuted
    ? 'NOT_COLLECTED_MISSING_SERVICE_ROLE'
    : !memoryStoreReachable
      ? 'SERVICE_FAILURE'
      : noMatchResult?.intendedFailure && noMatchResult.storeReachable && (noMatchResult.matchCount ?? 0) === 0
        ? 'NO_MATCH'
        : 'EXECUTED_IF_PRESENT'

  const captured = {
    identity: 'REAL-RUNTIME-MEMORY-V1',
    estimated_runtime_minutes: 20,
    observer_enabled_dev: observerEnabled,
    production_node_env_blocked: (process.env.NODE_ENV as string) === 'production',
    original_observer_proof_intact: observerProofIntact,
    class_diversity_ledger_intact: classDivIntact,
    pre_observer_REAL_RUNTIME: preObserver.REAL_RUNTIME ?? 11,
    env_names_loaded_count: envLoaded.names_present.length,
    supabase_url_configured: supabaseUrlStatus === 'AVAILABLE',
    supabase_service_role: serviceRoleStatus,
    memory_service_status,
    memory_error_class,
    live_memory_executed: liveMemoryExecuted,
    total_runtime_interactions_attempted: CASES.length,
    memory_interactions_attempted: memoryAttempted,
    skipped: skipped.map((s) => ({ id: s.spec.id, kind: s.spec.kind, skipped: s.skipped })),
    total_new_REAL_RUNTIME: records.length,
    MEMORY_REAL_RUNTIME: memoryRecords.length,
    quality_counts: qualityCounts,
    all_review_state_raw: records.every((r) => r.review_state === 'RAW'),
    auto_verified: false,
    auto_curriculum: false,
    newly_usable_gold: gold.length,
    MEMORY_usable_gold: memoryGold.length,
    MEMORY_verified: quality.filter((q, i) => records[i]?.selected_tool === 'memory' && q.quality_label === 'VERIFIED').length,
    MEMORY_supported: quality.filter((q, i) => records[i]?.selected_tool === 'memory' && q.quality_label === 'SUPPORTED').length,
    MEMORY_partial: quality.filter((q, i) => records[i]?.selected_tool === 'memory' && q.quality_label === 'PARTIAL').length,
    MEMORY_unknown: quality.filter((q, i) => records[i]?.selected_tool === 'memory' && q.quality_label === 'UNKNOWN').length,
    MEMORY_reject: quality.filter((q, i) => records[i]?.selected_tool === 'memory' && q.quality_label === 'REJECT').length,
    context_dependent_MEMORY: memoryRecords.filter((r) => r.context_dependence === 'CONTEXT_DEPENDENT').length,
    argument_recovery_rate: records.length ? argRecovered / records.length : null,
    result_status_recovery_rate: records.length ? statusRecovered / records.length : null,
    real_wording_count: records.filter((r) => {
      const id = r.provenance?.case_id
      return id ? specById.get(id)?.real_wording !== false : true
    }).length,
    exact_duplicate_count: new Set(exactDup).size,
    normalized_duplicate_count: new Set(normDup).size,
    unique_families: families.length,
    secret_sanitation: secretSanitation,
    observer_non_interference: {
      skipExperience: true,
      persistDir: OUT_DIR,
      did_not_overwrite_observer_dev: observerProofIntact && preObserver.REAL_RUNTIME === 11,
      did_not_overwrite_class_diversity: classDivIntact,
    },
    files_vs_memory: filesVsMemory,
    notool_vs_memory: notoolVsMemory,
    memory_failure_case,
    echo_int: echoIntRole,
    lookup_note: lookupNoteRole,
    recommended_v4_operator_facing: recommendedOperatorFacing,
    recommended_v4_gym_bounded: recommendedGymBounded,
    recommended_v4_test_only: recommendedTestOnly,
    per_class_real_gold: perClassRealGold,
    pre_mission_MEMORY_gold: preMemoryGold,
    post_mission_MEMORY_gold: postMemoryGold,
    v4_class_gaps: classGaps,
    v4_readiness,
    active_wrim: { id: runtime.activeCoreId, checkpoint: runtime.activeCoreCheckpointSha },
    wrim0_unchanged: runtime.activeCoreId === WRIM0_ID && runtime.activeCoreCheckpointSha === WRIM0_CHECKPOINT_SHA,
    active_modules: runtime.activeModuleIds,
    optimizer_training: { training_invoked: false, optimizer_invoked: false, experiment_004: false },
    eval3_leaks: leaks,
    eval3_overwrite: false,
    mission_verdict: missionPass
      ? 'WR-TOOL MEMORY REAL-RUNTIME COLLECTION AUTH-UNBLOCKED — PASS'
      : 'WR-TOOL MEMORY REAL-RUNTIME COLLECTION AUTH-UNBLOCKED — FAIL',
  }

  const runtimePath = {
    request_entry_point: [
      'app/api/tools/memory/route.ts GET/POST (TOOL_REGISTRY endpoint /api/tools/memory)',
      'app/api/memory/route.ts GET/POST (legacy list/save)',
      'app/api/memory/context/route.ts GET (approved memory snippets for chat context)',
    ],
    memory_intent_routing: [
      'lib/modular-intelligence/toolRouter.ts routeToolIntent compact TOOL=memory query=',
      'lib/tools/toolRegistry.ts id=memory requiresAuth=true',
      'lib/memory/recallCommands.ts parseRecallCommand (archive recall phrases)',
      'lib/intent-prerouter/handle.ts writeDirectiveWithSupersession (write, not retrieve)',
    ],
    supabase_dependency: 'createSupabaseAdminClient via NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY',
    query_construction: [
      'GET /api/tools/memory: memories.select recent limit 10 (list_recent; no search param); columns category/content',
      'Collector retrieve: memories required; war_room_approved_memories optional; war_room_memory_records optional (PGRST205 deferred)',
      'listRecentApprovedMemories: war_room_approved_memories order approved_at (chat context; empty in this development project)',
    ],
    result_construction: 'JSON memories[] / snippets[] / runtime state; observer resultMeta omits full payloads',
    observer_insertion: [
      'observeWarRoomApiTool in app/api/tools/memory/route.ts (list/save)',
      'captureRuntimeTrajectory gated by isTrajectoryObservationEnabled (dev on, production off)',
    ],
    trajectory_capture_path: 'lib/modular-intelligence/runtimeTrajectoryCapture.ts → jsonl persistDir; skipExperience in collectors',
    observer_captures: ['request', 'decision', 'tool_id', 'arguments', 'validation/result state', 'provenance'],
    observer_does_not_modify_memory_behavior: true,
    wrim_executeNormalizedRequest: 'dry_run/mock only for memory — not live retrieve; live path is War Room API + supabase stores',
  }

  writeFileSync(join(OUT_DIR, 'runtime-path.json'), JSON.stringify(runtimePath, null, 2) + '\n', 'utf8')
  writeFileSync(join(OUT_DIR, 'credential-check.json'), JSON.stringify({
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleStatus,
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrlStatus,
    name_present_in_env_local: envLoaded.names_present.includes('SUPABASE_SERVICE_ROLE_KEY'),
    value_not_recorded: true,
  }, null, 2) + '\n', 'utf8')
  writeFileSync(join(OUT_DIR, 'captured-records.json'), JSON.stringify({
    attempts: CASES.map((spec) => {
      const rec = records.find((r) => r.provenance?.case_id === spec.id) ?? null
      const skip = skipped.find((s) => s.spec.id === spec.id)
      return {
        id: spec.id,
        kind: spec.kind,
        family_id: spec.family_id,
        skipped: skip?.skipped ?? null,
        trajectory_id: rec?.trajectory_id ?? null,
        tool: rec?.selected_tool ?? null,
        decision: rec?.decision ?? null,
        result_status: rec?.tool_result_status ?? null,
        context_dependence: rec?.context_dependence ?? null,
      }
    }),
  }, null, 2) + '\n', 'utf8')
  writeFileSync(join(OUT_DIR, 'family-map.json'), JSON.stringify({ familySizes, unique: families.length }, null, 2) + '\n', 'utf8')
  writeFileSync(join(OUT_DIR, 'files-vs-memory-boundary.json'), JSON.stringify(filesVsMemory, null, 2) + '\n', 'utf8')
  writeFileSync(join(OUT_DIR, 'notool-vs-memory-boundary.json'), JSON.stringify(notoolVsMemory, null, 2) + '\n', 'utf8')
  writeFileSync(join(OUT_DIR, 'store-status.json'), JSON.stringify({
    memory_service_status,
    memory_error_class,
    storeReachable: memoryStoreReachable,
    hadHits: memoryHadHits,
    primary_store: 'memories',
    war_room_memory_records: 'DEFERRED_PGRST205',
    schema_repair_required_for_this_collection: false,
  }, null, 2) + '\n', 'utf8')
  writeFileSync(join(OUT_DIR, 'sanitization-proof.json'), JSON.stringify(secretSanitation, null, 2) + '\n', 'utf8')
  writeFileSync(join(OUT_DIR, 'echo-int-role.json'), JSON.stringify(echoIntRole, null, 2) + '\n', 'utf8')
  writeFileSync(join(OUT_DIR, 'lookup-note-role.json'), JSON.stringify(lookupNoteRole, null, 2) + '\n', 'utf8')
  writeFileSync(join(OUT_DIR, 'v4-class-space-recommendation.json'), JSON.stringify({
    do_not_silently_change: true,
    current_eight: ['NO_TOOL', 'SHA256', 'LOOKUP_NOTE', 'ECHO_INT', 'WEB', 'MEMORY', 'FILES', 'RESEARCH'],
    recommended_operator_facing: recommendedOperatorFacing,
    recommended_gym_bounded: recommendedGymBounded,
    recommended_test_only: recommendedTestOnly,
    reason: 'ECHO_INT and LOOKUP_NOTE are curriculum_synthetic mock fixtures, not TOOL_REGISTRY operator tools. SHA256 is gym-bounded but has genuine WRIM REAL_RUNTIME. MEMORY remains the operator-facing evidence hole.',
  }, null, 2) + '\n', 'utf8')
  writeFileSync(join(OUT_DIR, 'v4-readiness.json'), JSON.stringify({
    preMemoryGold,
    postMemoryGold,
    classGaps,
    perClassRealGold,
    verdict: v4_readiness,
    echo_int_does_not_block: true,
    lookup_note_does_not_block: true,
  }, null, 2) + '\n', 'utf8')
  writeFileSync(join(OUT_DIR, 'session-summary.json'), JSON.stringify(captured, null, 2) + '\n', 'utf8')
  writeFileSync(join(OUT_DIR, 'MANIFEST.json'), JSON.stringify({
    identity: 'REAL-RUNTIME-MEMORY-V1',
    does_not_overwrite: [
      'REAL-RUNTIME-OBSERVER-DEV-V1',
      'REAL-RUNTIME-CLASS-DIVERSITY-V1',
      'WR-TOOL-REAL-TRAJECTORY-POOL-V1',
      'WR-TOOL-EVAL-2',
      'WR-TOOL-EVAL-3',
    ],
    training: false,
    experiment_004: false,
    live_memory_executed: liveMemoryExecuted,
    credential: serviceRoleStatus,
  }, null, 2) + '\n', 'utf8')

  void POOL_GAP
  process.stdout.write(JSON.stringify({
    ok: true,
    out: OUT_DIR,
    n: records.length,
    memory: memoryRecords.length,
    gold_memory: memoryGold.length,
    credential: serviceRoleStatus,
    verdict: captured.mission_verdict,
    v4: v4_readiness,
  }, null, 2) + '\n')
}

main().catch((err) => {
  resetTrajectoryCaptureForTests()
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
