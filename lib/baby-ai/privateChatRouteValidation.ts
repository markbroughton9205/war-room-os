import { readFileSync } from 'fs'
import { assertLiveActionsAllowed } from '@/lib/security/actionRoutePolicy'
import { handleBabyChatRequest, type BabyChatMemoryAdapter, type BabyChatProvider } from './privateChatRoute'

export type BabyChatValidationResult = {
  caseId: string
  description: string
  expected: string
  observed: string
  result: 'PASS' | 'FAIL'
  notes: string[]
}

const COMMANDER_ID = '11111111-1111-4111-8111-111111111111'
const JASMINE_ID = '22222222-2222-4222-8222-222222222222'

type Counters = {
  providerCalls: number
  memoryReads: number
  memoryWrites: number
}

export async function runBabyChatAuthorizationHardeningValidation(): Promise<BabyChatValidationResult[]> {
  const results: BabyChatValidationResult[] = []

  results.push(checkRouteEnvironmentGateFirst())
  results.push(checkNoDeprecatedSupabaseServerImport())

  results.push(await executeCase({
    caseId: 'baby46pb_01_no_session',
    description: 'No session is rejected before provider or memory access.',
    userId: null,
    body: { message: 'hello' },
    expectedStatus: 401,
    expectedProviderCalls: 0,
    expectedMemoryReads: 0,
    expectedMemoryWrites: 0,
  }))

  results.push(await executeCase({
    caseId: 'baby46pb_02_invalid_session',
    description: 'Invalid session is rejected before side effects.',
    userId: null,
    authError: 'Invalid session',
    body: { message: 'hello' },
    expectedStatus: 401,
    expectedProviderCalls: 0,
    expectedMemoryReads: 0,
    expectedMemoryWrites: 0,
  }))

  results.push(await executeCase({
    caseId: 'baby46pb_03_non_commander',
    description: 'Authenticated non-Commander is rejected before provider or memory access.',
    userId: JASMINE_ID,
    body: { message: 'hello' },
    expectedStatus: 403,
    expectedProviderCalls: 0,
    expectedMemoryReads: 0,
    expectedMemoryWrites: 0,
  }))

  results.push(await executeCase({
    caseId: 'baby46pb_04_missing_commander_config',
    description: 'Missing Commander UUID config fails closed before auth-dependent side effects.',
    commanderConfig: { ok: false, reason: 'missing', message: 'missing commander id' },
    userId: COMMANDER_ID,
    body: { message: 'hello' },
    expectedStatus: 503,
    expectedProviderCalls: 0,
    expectedMemoryReads: 0,
    expectedMemoryWrites: 0,
  }))

  results.push(await executeCase({
    caseId: 'baby46pb_05_malformed_commander_config',
    description: 'Malformed Commander UUID config fails closed.',
    commanderConfig: { ok: false, reason: 'malformed', message: 'malformed commander id' },
    userId: COMMANDER_ID,
    body: { message: 'hello' },
    expectedStatus: 503,
    expectedProviderCalls: 0,
    expectedMemoryReads: 0,
    expectedMemoryWrites: 0,
  }))

  results.push(checkEnvironmentPolicyCase(
    'baby46pb_06_preview_valid_commander_blocked',
    'Preview blocks before provider/persistence initialization.',
    { VERCEL_ENV: 'preview', OPENAI_API_KEY: 'present' }
  ))

  results.push(checkEnvironmentPolicyCase(
    'baby46pb_07_local_default_valid_commander_blocked',
    'Local default blocks before provider/persistence initialization.',
    {}
  ))

  results.push(await executeCase({
    caseId: 'baby46pb_08_client_supplied_role_ignored',
    description: 'Client-supplied Commander role/userId does not authorize non-Commander.',
    userId: JASMINE_ID,
    body: { message: 'hello', userId: COMMANDER_ID, role: 'commander', commander: true },
    expectedStatus: 403,
    expectedProviderCalls: 0,
    expectedMemoryReads: 0,
    expectedMemoryWrites: 0,
  }))

  results.push(await executeCase({
    caseId: 'baby46pb_09_empty_message',
    description: 'Empty message is rejected before provider call.',
    userId: COMMANDER_ID,
    body: { message: '   ' },
    expectedStatus: 400,
    expectedProviderCalls: 0,
    expectedMemoryReads: 0,
    expectedMemoryWrites: 0,
  }))

  results.push(await executeCase({
    caseId: 'baby46pb_10_malformed_json',
    description: 'Malformed JSON is rejected before provider call.',
    userId: COMMANDER_ID,
    rawBody: '{not-json',
    expectedStatus: 400,
    expectedProviderCalls: 0,
    expectedMemoryReads: 0,
    expectedMemoryWrites: 0,
  }))

  results.push(await executeCase({
    caseId: 'baby46pb_11_provider_failure',
    description: 'Provider failure is truthful and does not claim memory persistence.',
    userId: COMMANDER_ID,
    body: { message: 'hello' },
    providerFailure: 'fake provider failed',
    expectedStatus: 502,
    expectedProviderCalls: 1,
    expectedMemoryReads: 1,
    expectedMemoryWrites: 0,
    inspectBody: body => {
      const proposal = toRecord(body.memoryProposal)
      return body.memoryPersisted === false && proposal?.skipReason === 'provider_failed'
    },
  }))

  results.push(await executeCase({
    caseId: 'baby46pb_12_memory_read_failure',
    description: 'Memory read failure blocks before provider call with no service-role fallback.',
    userId: COMMANDER_ID,
    body: { message: 'hello' },
    memoryReadFailure: true,
    expectedStatus: 503,
    expectedProviderCalls: 0,
    expectedMemoryReads: 1,
    expectedMemoryWrites: 0,
  }))

  results.push(await executeCase({
    caseId: 'baby46pb_13_memory_write_failure_after_provider',
    description: 'Memory write failure after provider response is reported truthfully.',
    userId: COMMANDER_ID,
    body: { message: 'remember this' },
    providerReply: memoryProposalReply(),
    memoryWriteFailure: true,
    expectedStatus: 200,
    expectedProviderCalls: 1,
    expectedMemoryReads: 1,
    expectedMemoryWrites: 1,
    inspectBody: body => {
      const proposal = toRecord(body.memoryProposal)
      return body.memoryPersisted === false && proposal?.attempted === true
    },
  }))

  results.push(checkEnvironmentPolicyCase(
    'baby46pb_14_preview_provider_key_present',
    'Preview remains blocked even if provider key is present.',
    { VERCEL_ENV: 'preview', OPENAI_API_KEY: 'fake-openai-key' }
  ))

  results.push(await executeCase({
    caseId: 'baby46pb_15_direct_http_same_rules',
    description: 'Direct HTTP request without UI gets the same Commander-only authorization.',
    userId: JASMINE_ID,
    body: { message: 'direct call' },
    expectedStatus: 403,
    expectedProviderCalls: 0,
    expectedMemoryReads: 0,
    expectedMemoryWrites: 0,
  }))

  results.push(await executeCase({
    caseId: 'baby46pb_positive_production_equivalent_inert',
    description: 'Production-equivalent inert path calls provider once and uses authorized memory adapter.',
    userId: COMMANDER_ID,
    body: { message: 'remember this', history: [{ role: 'rael', content: 'private hello' }] },
    providerReply: memoryProposalReply(),
    expectedStatus: 200,
    expectedProviderCalls: 1,
    expectedMemoryReads: 1,
    expectedMemoryWrites: 1,
    inspectBody: body => typeof body.reply === 'string' &&
      body.reply.includes('Baby private reply') &&
      body.memoryPersisted === true,
  }))

  return results
}

function checkRouteEnvironmentGateFirst(): BabyChatValidationResult {
  const source = readFileSync('app/api/baby/chat/route.ts', 'utf8')
  const functionBody = source.match(/export async function POST\(req: Request\) \{\s*([\s\S]*?)\n\}/)?.[1] ?? ''
  const firstStatement = functionBody.trim().split('\n')[0]?.trim() ?? ''
  const passed = firstStatement === 'const environmentBlocked = assertLiveActionsAllowed()'
  return result(
    'baby46pb_static_environment_first',
    'Route-level first statement is environment policy.',
    'first statement assertLiveActionsAllowed',
    firstStatement,
    passed
  )
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function checkNoDeprecatedSupabaseServerImport(): BabyChatValidationResult {
  const source = readFileSync('app/api/baby/chat/route.ts', 'utf8')
  const deprecated = source.includes('@/lib/supabaseServer') || source.includes('lib/supabaseServer')
  return result(
    'baby46pb_static_no_deprecated_supabase_alias',
    'Baby chat route does not import deprecated service-role alias.',
    'no lib/supabaseServer import',
    deprecated ? 'deprecated import found' : 'no deprecated import',
    !deprecated
  )
}

function checkEnvironmentPolicyCase(
  caseId: string,
  description: string,
  env: Record<string, string | undefined>
): BabyChatValidationResult {
  const blocked = assertLiveActionsAllowed(env)
  return result(
    caseId,
    description,
    'blocked response before handler/provider/persistence',
    blocked ? `blocked:${blocked.status}` : 'allowed',
    Boolean(blocked)
  )
}

async function executeCase(input: {
  caseId: string
  description: string
  userId: string | null
  authError?: string
  body?: Record<string, unknown>
  rawBody?: string
  commanderConfig?: ReturnType<typeof commanderOk> | { ok: false; reason: 'missing' | 'malformed'; message: string }
  providerFailure?: string
  providerReply?: string
  memoryReadFailure?: boolean
  memoryWriteFailure?: boolean
  expectedStatus: number
  expectedProviderCalls: number
  expectedMemoryReads: number
  expectedMemoryWrites: number
  inspectBody?: (body: Record<string, unknown>) => boolean
}): Promise<BabyChatValidationResult> {
  const counters: Counters = { providerCalls: 0, memoryReads: 0, memoryWrites: 0 }
  const response = await handleBabyChatRequest(makeRequest(input.body, input.rawBody), {
    readCommanderConfig: () => input.commanderConfig ?? commanderOk(),
    resolveAuthenticatedUser: async () => ({
      user: input.userId ? { id: input.userId } : null,
      client: input.userId ? fakeClient() : null,
      errorMessage: input.authError ?? null,
    }),
    createMemoryAdapter: () => fakeMemoryAdapter(counters, input),
    provider: fakeProvider(counters, input.providerFailure, input.providerReply),
    runResearch: async () => ({
      researchUsed: false,
      researchError: null,
      sources: [],
      extractedContent: null,
    }),
  })
  const body = await response.json().catch(() => ({})) as Record<string, unknown>
  const passed = response.status === input.expectedStatus &&
    counters.providerCalls === input.expectedProviderCalls &&
    counters.memoryReads === input.expectedMemoryReads &&
    counters.memoryWrites === input.expectedMemoryWrites &&
    (input.inspectBody ? input.inspectBody(body) : true)

  const proposal = toRecord(body.memoryProposal)

  return {
    caseId: input.caseId,
    description: input.description,
    expected: `status=${input.expectedStatus}; provider=${input.expectedProviderCalls}; reads=${input.expectedMemoryReads}; writes=${input.expectedMemoryWrites}`,
    observed: `status=${response.status}; provider=${counters.providerCalls}; reads=${counters.memoryReads}; writes=${counters.memoryWrites}; body=${body.status ?? body.error ?? 'ok'}`,
    result: passed ? 'PASS' : 'FAIL',
    notes: proposal?.skipReason ? [String(proposal.skipReason)] : [],
  }
}

function commanderOk() {
  return { ok: true as const, commanderUserId: COMMANDER_ID }
}

function makeRequest(body?: Record<string, unknown>, rawBody?: string): Request {
  return new Request('http://localhost/api/baby/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: rawBody ?? JSON.stringify(body ?? {}),
  })
}

function fakeClient() {
  return {
    from() {
      return {
        select() {
          return {}
        },
        insert() {
          return {}
        },
      }
    },
  }
}

function fakeProvider(counters: Counters, failure?: string, reply?: string): BabyChatProvider {
  return {
    async call() {
      counters.providerCalls += 1
      if (failure) return { ok: false, error: failure }
      return { ok: true, reply: reply ?? 'Baby private reply' }
    },
  }
}

function fakeMemoryAdapter(
  counters: Counters,
  input: { memoryReadFailure?: boolean; memoryWriteFailure?: boolean }
): BabyChatMemoryAdapter {
  return {
    async loadContext() {
      counters.memoryReads += 1
      if (input.memoryReadFailure) {
        return {
          ok: false,
          memories: [],
          runtime: {
            state: 'OFFLINE',
            label: 'Durable Memory Offline',
            commanderPhrase: 'Memory unavailable.',
            persistenceAvailable: false,
            sessionOnly: true,
          },
          errorMessage: 'fake read failure',
        }
      }
      return {
        ok: true,
        memories: [{ content: 'Approved Baby context.' }],
        runtime: {
          state: 'ONLINE',
          label: 'Durable Memory Online',
          commanderPhrase: 'Memory active.',
          persistenceAvailable: true,
          sessionOnly: false,
        },
        errorMessage: null,
      }
    },
    async persistProposalFromModelOutput(responseText: string) {
      if (!responseText.includes('MEMORY_PROPOSAL:')) {
        return { attempted: false, inserted: false, skipReason: 'no_line' }
      }
      counters.memoryWrites += 1
      if (input.memoryWriteFailure) {
        return { attempted: true, inserted: false, skipReason: 'fake write failure' }
      }
      return { attempted: true, inserted: true, proposalId: 'fake-proposal-id' }
    },
  }
}

function memoryProposalReply(): string {
  return 'Baby private reply\nMEMORY_PROPOSAL: {"family_partition":"Baby AI Observer","title":"Private lesson","content":"Remember this private continuity lesson."}'
}

function result(
  caseId: string,
  description: string,
  expected: string,
  observed: string,
  passed: boolean
): BabyChatValidationResult {
  return { caseId, description, expected, observed, result: passed ? 'PASS' : 'FAIL', notes: [] }
}
