import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createCouncilStreamPostHandler } from '../../../app/api/chat/stream/route'
import {
  COUNCIL_STREAM_VERSION,
  createCouncilSseParser,
  createCouncilStreamReconciliationState,
  encodeCouncilStreamComment,
  encodeCouncilStreamEnvelope,
  postIncrementalCouncilChat,
  reconcileCouncilStreamEnvelope,
  sanitizeCouncilStreamError,
  validateCouncilStreamEnvelopeShape,
  type CouncilStreamEnvelope,
  type CouncilStreamFrameDiagnostic,
  type CouncilStreamParserEvent,
  type CouncilStreamProgress,
  type IncrementalCouncilChatOptions,
} from '@/lib/council/incremental-transport'
import type { CouncilChatJson } from '@/lib/council/liveChatPipeline'
import type { CouncilProgressEventObserver, CouncilProgressRuntimeSnapshot } from '@/lib/council/progress-events/runtime'
import type { CouncilProgressEventEnvelope } from '@/lib/council/progress-events/types'

type ValidationCase = {
  caseId: string
  category: string
  expected: 'valid' | 'invalid'
  observed: 'valid' | 'invalid'
  result: 'PASS' | 'FAIL'
  details: string[]
}

type ProgressObserver = CouncilProgressEventObserver

type CaseInput = {
  caseId: string
  category: string
  expected?: 'valid' | 'invalid'
  run: () => boolean | Promise<boolean>
  details?: string[]
}

const MUTATION_9_MAX_STREAM_FETCHES = 1
const MUTATION_9_MAX_TOTAL_FETCHES = 2

// Suite-wide ceiling: protects every mocked fetch/execution path in this file, not just
// mutation #9's own local harness. No legitimate case here needs more than ~2 fetch calls
// or ~2 executor invocations; these ceilings leave generous headroom while still tripping
// deterministically, in single-digit milliseconds, on any unbounded-recursion regression.
const SUITE_FETCH_CEILING = 20
const SUITE_EXECUTION_CEILING = 10

let currentSuiteCaseId = 'unassigned'
let suiteFetchCallCount = 0
let suiteExecutionCallCount = 0

function resetSuiteExecutionGuard(caseId: string): void {
  currentSuiteCaseId = caseId
  suiteFetchCallCount = 0
  suiteExecutionCallCount = 0
}

function suiteGuardError(operation: 'fetch' | 'execute', count: number, ceiling: number): Error {
  return new Error(`C4C suite execution ceiling exceeded: case=${currentSuiteCaseId} operation=${operation} count=${count} ceiling=${ceiling}`)
}

const STACK_LEAK_PATTERNS = [
  /\\Users\\/i,
  /\/users\//i,
  /\/(?:home|var|tmp|app|workspace|mnt)\//i,
  /(?:^|\s)at\s+\S+\(/,
  /[^\s()]+\.(?:ts|tsx|js|jsx|mjs|cjs):\d+(?::\d+)?/,
  /sk-[a-z0-9_-]{12,}/i,
  /xai-[a-z0-9_-]{12,}/i,
  /service[_-]?role/i,
  /supabase[_-]?service/i,
  /refresh_token|access_token/i,
  /bearer\s+[a-z0-9._-]{8,}/i,
  /raw internal prompt|you are in a live war room council/i,
]

function makeCase(
  caseId: string,
  category: string,
  expected: 'valid' | 'invalid',
  passed: boolean,
  details: string[] = [],
): ValidationCase {
  const observed = passed ? expected : expected === 'valid' ? 'invalid' : 'valid'
  return {
    caseId,
    category,
    expected,
    observed,
    result: passed ? 'PASS' : 'FAIL',
    details,
  }
}

async function runCase(input: CaseInput): Promise<ValidationCase> {
  const expected = input.expected ?? 'valid'
  resetSuiteExecutionGuard(input.caseId)
  try {
    return makeCase(input.caseId, input.category, expected, await input.run(), input.details)
  } catch (error) {
    return makeCase(input.caseId, input.category, expected, false, [
      ...(input.details ?? []),
      error instanceof Error ? error.message : String(error),
    ])
  }
}

function progressEvent(sequence = 1, requestId = 'runtime-validation'): CouncilProgressEventEnvelope {
  return {
    schemaVersion: '47c2.council-progress-event.v1',
    eventId: `event-${requestId}-${sequence}` as CouncilProgressEventEnvelope['eventId'],
    requestId: requestId as CouncilProgressEventEnvelope['requestId'],
    executionId: null,
    sequence,
    eventType: sequence === 1 ? 'request_created' : 'request_started',
    occurredAt: '2026-01-01T00:00:00.000Z',
    emittedAt: null,
    family: null,
    source: 'server_orchestrator',
    payload: {},
    visibility: {
      rendered: true,
      omitted: false,
      substituted: false,
      persisted: false,
      suppressed: false,
      diagnosticOnly: false,
    },
  }
}

function snapshot(requestId = 'runtime-validation', eventCount = 1): CouncilProgressRuntimeSnapshot {
  const events = Array.from({ length: eventCount }, (_, index) => progressEvent(index + 1, requestId))
  return {
    schemaVersion: '47c3.council-progress-runtime.v1',
    requestId,
    logicalRequestId: null,
    logicalTurnIndex: null,
    logicalTurnTotal: null,
    logicalExpectedFamilies: [],
    status: 'recording',
    eventCount: events.length,
    appliedEventCount: events.length,
    ignoredDuplicateCount: 0,
    rejectedEventCount: 0,
    events,
    state: {
      schemaVersion: '47c1.council-request-state.v1',
      requestId: requestId as CouncilProgressRuntimeSnapshot['state']['requestId'],
      parentRequestId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      commanderTurnRef: 'validation',
      flowMode: 'full_council',
      executionStrategy: 'server_parallel',
      expectedFamilies: [],
      selectedFamilies: [],
      familyExecutions: [],
      completionSummary: {
        derivedFrom: 'family_outcomes',
        expectedCount: 0,
        selectedCount: 0,
        dispatchedCount: 0,
        terminalCount: 0,
        completeCount: 0,
        incompleteCount: 0,
        failedCount: 0,
        timedOutCount: 0,
        notReachedCount: 0,
        fallbackUsedCount: 0,
        skippedByPolicyCount: 0,
        stoppedCount: 0,
        missingTerminalFamilies: [],
      },
      cancellation: { cancelled: false },
      redTeamAudit: {
        scope: 'not_audited',
        reviewType: 'not_audited',
        expectedFamilies: [],
        receivedFamilies: [],
        missingFamilies: [],
        currentTurnPriorResponsesReceived: false,
      },
    },
    diagnostics: [],
  }
}

function baseEnvelope(type: CouncilStreamEnvelope['envelopeType'], sequence = 1, requestId = 'runtime-validation'): CouncilStreamEnvelope {
  const base = {
    version: COUNCIL_STREAM_VERSION,
    requestId,
    operationId: requestId,
    sequence,
    emittedAt: '2026-01-01T00:00:00.000Z',
  }
  if (type === 'opened') return { ...base, envelopeType: 'opened', transport: 'sse', streamingSupported: true }
  if (type === 'progress') {
    return { ...base, envelopeType: 'progress', progressEvent: progressEvent(sequence, requestId), snapshot: snapshot(requestId, sequence) }
  }
  if (type === 'final') {
    return {
      ...base,
      envelopeType: 'final',
      httpStatus: 200,
      ok: true,
      status: 'completed',
      finalResponse: { results: [] },
      finalProgress: snapshot(requestId, sequence),
      readableContributionCount: 0,
      runtimeEventCount: 1,
      completedAt: '2026-07-23T00:00:00.000Z',
    }
  }
  if (type === 'error') {
    return {
      ...base,
      envelopeType: 'error',
      error: { code: 'validation_error', message: 'Validation error.', terminal: true, classification: 'validation' },
    }
  }
  return { ...base, envelopeType: 'closed', terminalState: 'execution_completed' }
}

function progressEnvelope(requestId: string, sequence: number, event: CouncilProgressEventEnvelope): CouncilStreamProgress {
  return {
    version: COUNCIL_STREAM_VERSION,
    envelopeType: 'progress',
    requestId,
    operationId: requestId,
    sequence,
    emittedAt: '2026-01-01T00:00:00.000Z',
    progressEvent: event,
    snapshot: snapshot(requestId, sequence),
  }
}

function parseFrames(input: string | string[]): CouncilStreamParserEvent[] {
  const events: CouncilStreamParserEvent[] = []
  const parser = createCouncilSseParser(event => events.push(event))
  for (const chunk of Array.isArray(input) ? input : [input]) parser.push(chunk)
  parser.flush()
  return events
}

function parseFramesWithDiagnostics(input: string | string[]): {
  events: CouncilStreamParserEvent[]
  frames: CouncilStreamFrameDiagnostic[]
} {
  const events: CouncilStreamParserEvent[] = []
  const frames: CouncilStreamFrameDiagnostic[] = []
  const parser = createCouncilSseParser(event => events.push(event), {
    onFrame: diagnostic => frames.push(diagnostic),
  })
  for (const chunk of Array.isArray(input) ? input : [input]) parser.push(chunk)
  parser.flush()
  return { events, frames }
}

function validParsed(events: CouncilStreamParserEvent[], count: number): boolean {
  return events.length === count && events.every(event => event.ok)
}

function responseStream(chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk)
      controller.close()
    },
  })
}

function eventStreamResponse(chunks: (string | Uint8Array)[], status = 200): Response {
  return new Response(responseStream(chunks), {
    status,
    headers: { 'content-type': 'text/event-stream; charset=utf-8' },
  })
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function withMockFetch<T>(fetchImpl: typeof fetch, task: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch
  // Every case that mocks fetch goes through this one function, so gating fetch calls
  // here (rather than in each case) gives suite-wide coverage without touching call sites.
  const guardedFetchImpl: typeof fetch = async (...args) => {
    suiteFetchCallCount += 1
    if (suiteFetchCallCount > SUITE_FETCH_CEILING) {
      throw suiteGuardError('fetch', suiteFetchCallCount, SUITE_FETCH_CEILING)
    }
    return fetchImpl(...args)
  }
  globalThis.fetch = guardedFetchImpl
  try {
    return await task()
  } finally {
    globalThis.fetch = original
  }
}

type StreamPostExecutor = NonNullable<Parameters<typeof createCouncilStreamPostHandler>[0]>

// Single choke point for the executor side: every case constructs its stream-route handler
// through this wrapper instead of calling createCouncilStreamPostHandler directly, so a
// regression that causes repeated executor invocation is caught regardless of which case
// triggers it, not only the cases that were built to test that specific failure mode.
function guardedStreamHandler(executor: StreamPostExecutor) {
  const guardedExecutor: StreamPostExecutor = async (req, options) => {
    suiteExecutionCallCount += 1
    if (suiteExecutionCallCount > SUITE_EXECUTION_CEILING) {
      throw suiteGuardError('execute', suiteExecutionCallCount, SUITE_EXECUTION_CEILING)
    }
    return executor(req, options)
  }
  return createCouncilStreamPostHandler(guardedExecutor)
}

function requestBody(): IncrementalCouncilChatOptions['body'] {
  return {
    message: 'Runtime validation',
    profile: 'Commander',
    threadHistory: [],
    mode: 'full',
    toneMode: 'build',
    councilSingleFamily: 'chatgpt',
    orchestrationAugment: '',
  }
}

async function collectRouteEnvelopes(response: Response): Promise<CouncilStreamEnvelope[]> {
  const text = await response.text()
  return parseFrames(text)
    .filter((event): event is Extract<CouncilStreamParserEvent, { ok: true }> => event.ok)
    .map(event => event.envelope)
}

async function readFirstEnvelopeThenAbort(response: Response, abort: () => void): Promise<CouncilStreamEnvelope[]> {
  const reader = response.body?.getReader()
  if (!reader) return []
  const decoder = new TextDecoder()
  const events: CouncilStreamEnvelope[] = []
  const parser = createCouncilSseParser(event => {
    if (event.ok) events.push(event.envelope)
  })
  const first = await reader.read()
  if (!first.done) parser.push(decoder.decode(first.value, { stream: true }))
  abort()
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    parser.push(decoder.decode(chunk.value, { stream: true }))
  }
  parser.flush()
  return events
}

function unsafeTokens(): string[] {
  return [
    'Error: failed\n    at run (C:\\Users\\markb\\warroom\\app\\api\\chat\\execute.ts:44:7)',
    'sk-test-provider-secret-1234567890',
    'xai-provider-secret-1234567890',
    'service_role key leaked',
    'access_token=abc.refresh',
    'refresh_token=abc',
    'Authorization: Bearer abcdefghijklmnop',
    'raw internal prompt: You are in a live War Room council',
    '/home/site/wwwroot/app/api/chat/execute.ts:88:12',
  ]
}

function sanitizedMessageLeaks(message: string): string | null {
  for (const pattern of STACK_LEAK_PATTERNS) {
    if (pattern.test(message)) return pattern.source
  }
  return null
}

function productionStackDiscriminationProof(): { passed: boolean; details: string[] } {
  const stackOnlyError = new Error('User-visible safe text')
  stackOnlyError.stack = 'Error: User-visible safe text\n    at handler (C:\\Users\\markb\\warroom\\app\\api\\chat\\execute.ts:44:7)\n    sk-live-bad-key-1234567890'

  const nestedCause = new Error('outer safe message', { cause: new Error('sk-nested-provider-secret-1234567890') })
  nestedCause.stack = 'Error: outer safe message\n    at run (C:\\Users\\markb\\warroom\\secret.ts:99:1)'

  const inputs: { label: string; value: unknown }[] = [
    { label: 'Error', value: stackOnlyError },
    { label: 'nested cause', value: nestedCause },
    { label: 'non-Error object', value: { stack: 'C:\\Users\\markb\\secret.ts:1:1', token: 'service_role', prompt: 'raw internal prompt: secret council instruction' } },
    { label: 'string', value: 'Failure at C:\\Users\\markb\\warroom\\x.ts:1:1 with Authorization: Bearer abcdefghijklmnop' },
    { label: 'null', value: null },
    { label: 'undefined', value: undefined },
  ]

  const details: string[] = []
  const discriminating = sanitizeCouncilStreamError(stackOnlyError)
  if (discriminating.message !== 'User-visible safe text') {
    details.push('sanitizeCouncilStreamError must preserve Error.message; using error.stack would fail this check')
  }
  if (discriminating.message.includes('execute.ts') || discriminating.message.includes('sk-live')) {
    details.push('Error.message path leaked stack-only content')
  }

  for (const input of inputs) {
    const sanitized = sanitizeCouncilStreamError(input.value)
    const leak = sanitizedMessageLeaks(sanitized.message)
    if (leak) details.push(`${input.label}: leaked ${leak}`)
  }

  return { passed: details.length === 0, details }
}

async function runMutation9BoundedHarness(): Promise<{ passed: boolean; details: string[] }> {
  const opened = encodeCouncilStreamEnvelope(baseEnvelope('opened', 0, 'mutation-9-a'))
  let streamFetches = 0
  let jsonFetches = 0
  let totalFetches = 0
  const details: string[] = []

  try {
    const result = await withMockFetch(async input => {
      totalFetches += 1
      if (totalFetches > MUTATION_9_MAX_TOTAL_FETCHES) {
        throw new Error(`mutation #9 harness exceeded bounded total fetch count (${MUTATION_9_MAX_TOTAL_FETCHES})`)
      }

      const url = String(input)
      if (url.includes('/api/chat/stream')) {
        streamFetches += 1
        if (streamFetches > MUTATION_9_MAX_STREAM_FETCHES) {
          throw new Error(`mutation #9 harness detected duplicate stream fetch #${streamFetches}; retry-after-ambiguous-failure must not recurse`)
        }
        return eventStreamResponse([opened])
      }

      if (url.includes('/api/chat')) {
        jsonFetches += 1
        if (jsonFetches > 1) {
          throw new Error(`mutation #9 harness detected duplicate JSON fallback fetch #${jsonFetches}`)
        }
        return jsonResponse({ results: [] }, 200)
      }

      throw new Error(`mutation #9 harness received unexpected fetch URL: ${url}`)
    }, async () => postIncrementalCouncilChat({
      body: requestBody(),
      fallback: 'final_snapshot_before_execution_only',
    }))

    if (streamFetches !== 1) details.push(`expected exactly one stream fetch, observed ${streamFetches}`)
    if (jsonFetches !== 0) details.push(`expected zero JSON fallback fetches after ambiguous stream failure, observed ${jsonFetches}`)
    if (result.error?.error.code !== 'stream_ended_without_final') {
      details.push(`expected stream_ended_without_final, observed ${result.error?.error.code ?? 'none'}`)
    }
    if (result.finalResponse !== null) details.push('ambiguous stream failure must not synthesize a final response')
  } catch (error) {
    details.push(error instanceof Error ? error.message : String(error))
  }

  return { passed: details.length === 0, details }
}

function runEnvelopeCases(): ValidationCase[] {
  const cases: ValidationCase[] = []
  const types: CouncilStreamEnvelope['envelopeType'][] = ['opened', 'progress', 'final', 'error', 'closed']
  types.forEach((type, index) => {
    cases.push(makeCase(`c4c_envelope_${index + 1}_${type}_accepted`, 'A. Envelope contract', 'valid', validateCouncilStreamEnvelopeShape(baseEnvelope(type, index))))
  })
  const invalids: [string, unknown][] = [
    ['unknown_version', { ...baseEnvelope('opened'), version: 'bad' }],
    ['unknown_type', { ...baseEnvelope('opened'), envelopeType: 'typing' }],
    ['missing_request_id', { ...baseEnvelope('opened'), requestId: '' }],
    ['bad_operation_id', { ...baseEnvelope('opened'), operationId: 44 }],
    ['bad_sequence', { ...baseEnvelope('opened'), sequence: 1.5 }],
    ['negative_sequence', { ...baseEnvelope('opened'), sequence: -1 }],
    ['missing_time', { ...baseEnvelope('opened'), emittedAt: '' }],
    ['progress_missing_event', { ...baseEnvelope('progress'), progressEvent: null }],
    ['progress_missing_snapshot', { ...baseEnvelope('progress'), snapshot: null }],
    ['final_missing_response', (() => { const v = baseEnvelope('final') as Record<string, unknown>; delete v.finalResponse; return v })()],
    ['error_missing_error', { ...baseEnvelope('error'), error: null }],
    ['closed_missing_state', (() => { const v = baseEnvelope('closed') as Record<string, unknown>; delete v.terminalState; return v })()],
  ]
  invalids.forEach(([name, value], index) => {
    cases.push(makeCase(`c4c_envelope_invalid_${index + 1}_${name}`, 'A. Envelope contract', 'invalid', !validateCouncilStreamEnvelopeShape(value)))
  })
  return cases
}

function runSseCases(): ValidationCase[] {
  const cases: ValidationCase[] = []
  const opened = encodeCouncilStreamEnvelope(baseEnvelope('opened', 0))
  const progress = encodeCouncilStreamEnvelope(baseEnvelope('progress', 1))
  const final = encodeCouncilStreamEnvelope(baseEnvelope('final', 2))
  cases.push(makeCase('c4c_sse_001_split_frame_across_chunks', 'B. SSE parser', 'valid', validParsed(parseFrames([progress.slice(0, 12), progress.slice(12)]), 1)))
  cases.push(makeCase('c4c_sse_002_multiple_frames_one_chunk', 'B. SSE parser', 'valid', validParsed(parseFrames(opened + progress + final), 3)))
  cases.push(makeCase('c4c_sse_003_crlf_and_lf_supported', 'B. SSE parser', 'valid', validParsed(parseFrames(opened.replace(/\n/g, '\r\n') + progress), 2)))
  cases.push(makeCase('c4c_sse_004_comment_heartbeat_ignored', 'B. SSE parser', 'valid', parseFrames(encodeCouncilStreamComment('heartbeat')).length === 0))
  const multilineEnvelope = {
    ...(baseEnvelope('error') as Extract<CouncilStreamEnvelope, { envelopeType: 'error' }>),
    error: { code: 'multi', message: 'line', terminal: true, classification: 'transport' as const },
  }
  const multiline = `event: error\n${JSON.stringify(multilineEnvelope, null, 2).split('\n').map(line => `data: ${line}`).join('\n')}\n\n`
  cases.push(makeCase('c4c_sse_005_multiline_data_supported', 'B. SSE parser', 'valid', validParsed(parseFrames(multiline), 1)))
  cases.push(makeCase('c4c_sse_006_malformed_json_rejected', 'B. SSE parser', 'invalid', parseFrames('event: progress\ndata: {bad-json}\n\n').some(event => !event.ok)))
  cases.push(makeCase('c4c_sse_007_unknown_version_rejected', 'B. SSE parser', 'invalid', parseFrames(encodeCouncilStreamEnvelope({ ...baseEnvelope('opened'), version: 'bad' as typeof COUNCIL_STREAM_VERSION })).some(event => !event.ok)))
  cases.push(makeCase('c4c_sse_008_unknown_type_rejected', 'B. SSE parser', 'invalid', parseFrames(`event: typing\ndata: ${JSON.stringify({ ...baseEnvelope('opened'), envelopeType: 'typing' })}\n\n`).some(event => !event.ok)))
  cases.push(makeCase('c4c_sse_009_missing_request_id_rejected', 'B. SSE parser', 'invalid', parseFrames(encodeCouncilStreamEnvelope({ ...baseEnvelope('opened'), requestId: '' })).some(event => !event.ok)))
  const namedFinal = parseFrames(`id: final-1\nevent: final\nretry: 1500\ndata: ${JSON.stringify(baseEnvelope('final', 2))}\n\n`)
  cases.push(makeCase('c4c_sse_010_named_final_event_accepted', 'B. SSE parser', 'valid', namedFinal.length === 1 && namedFinal[0]?.ok === true && namedFinal[0].eventName === 'final' && namedFinal[0].id === 'final-1' && namedFinal[0].retry === 1500))
  cases.push(makeCase('c4c_sse_011_event_name_mismatch_rejected', 'B. SSE parser', 'invalid', parseFrames(`event: progress\ndata: ${JSON.stringify(baseEnvelope('final', 2))}\n\n`).some(event => !event.ok && event.error.code === 'stream_event_name_mismatch')))
  const diagnostic = parseFramesWithDiagnostics(opened + encodeCouncilStreamComment('keepalive') + final)
  cases.push(makeCase('c4c_sse_012_frame_diagnostics_record_shape_only', 'B. SSE parser', 'valid', diagnostic.frames.length === 3 && diagnostic.frames[0]?.parseStatus === 'parsed' && diagnostic.frames[1]?.parseStatus === 'ignored_comment' && diagnostic.frames[2]?.envelopeType === 'final' && diagnostic.frames.every(frame => frame.dataCharLength >= 0)))
  return cases
}

function runReconcileCases(): ValidationCase[] {
  const cases: ValidationCase[] = []
  const state = createCouncilStreamReconciliationState()
  const opened = baseEnvelope('opened', 0, 'request-a')
  const progress = baseEnvelope('progress', 1, 'request-a')
  const final = baseEnvelope('final', 2, 'request-a')
  const closed = baseEnvelope('closed', 3, 'request-a')
  cases.push(makeCase('c4c_reconcile_001_opened_accepted', 'C. Reconciliation', 'valid', reconcileCouncilStreamEnvelope(state, opened).ok))
  cases.push(makeCase('c4c_reconcile_002_progress_accepted', 'C. Reconciliation', 'valid', reconcileCouncilStreamEnvelope(state, progress).ok))
  cases.push(makeCase('c4c_reconcile_003_final_once', 'C. Reconciliation', 'valid', reconcileCouncilStreamEnvelope(state, final).ok))
  cases.push(makeCase('c4c_reconcile_004_closed_once', 'C. Reconciliation', 'valid', reconcileCouncilStreamEnvelope(state, closed).ok))
  cases.push(makeCase('c4c_reconcile_005_data_after_closed_ignored', 'C. Reconciliation', 'valid', reconcileCouncilStreamEnvelope(state, baseEnvelope('progress', 4, 'request-a')).ok))
  const dupFinal = createCouncilStreamReconciliationState()
  cases.push(makeCase('c4c_reconcile_006_duplicate_final_rejected', 'C. Reconciliation', 'invalid', reconcileCouncilStreamEnvelope(dupFinal, final).ok && !reconcileCouncilStreamEnvelope(dupFinal, { ...final, sequence: 3 }).ok))
  const mismatch = createCouncilStreamReconciliationState()
  reconcileCouncilStreamEnvelope(mismatch, opened)
  cases.push(makeCase('c4c_reconcile_007_request_b_blocked_from_request_a', 'C. Reconciliation', 'invalid', !reconcileCouncilStreamEnvelope(mismatch, baseEnvelope('progress', 1, 'request-b')).ok))
  const duplicateProgress = createCouncilStreamReconciliationState()
  reconcileCouncilStreamEnvelope(duplicateProgress, progress)
  cases.push(makeCase('c4c_reconcile_008_duplicate_progress_ignored', 'C. Reconciliation', 'valid', reconcileCouncilStreamEnvelope(duplicateProgress, progress).ok))
  const closedWithoutFinal = createCouncilStreamReconciliationState()
  const closeResult = reconcileCouncilStreamEnvelope(closedWithoutFinal, closed)
  cases.push(makeCase('c4c_reconcile_009_close_without_final_uncertain', 'C. Reconciliation', 'valid', closeResult.ok && closedWithoutFinal.stale && !closedWithoutFinal.finalDelivered))
  return cases
}

async function runClientCases(): Promise<ValidationCase[]> {
  const cases: ValidationCase[] = []
  const opened = encodeCouncilStreamEnvelope(baseEnvelope('opened', 0, 'client-a'))
  const progress = encodeCouncilStreamEnvelope(baseEnvelope('progress', 1, 'client-a'))
  const final = encodeCouncilStreamEnvelope(baseEnvelope('final', 2, 'client-a'))
  const closed = encodeCouncilStreamEnvelope(baseEnvelope('closed', 3, 'client-a'))
  const encoder = new TextEncoder()
  const snowmanFrame = encodeCouncilStreamEnvelope({
    ...(baseEnvelope('error', 2, 'client-a') as Extract<CouncilStreamEnvelope, { envelopeType: 'error' }>),
    error: { code: 'utf8', message: 'Snowman ☃ transport', terminal: true, classification: 'transport' },
  })
  const snowmanBytes = encoder.encode(snowmanFrame)
  const splitAt = snowmanFrame.indexOf('☃')
  const splitBytesAt = encoder.encode(snowmanFrame.slice(0, splitAt)).length + 1

  const clientCaseInputs: CaseInput[] = [
    {
      caseId: 'c4c_client_001_split_sse_frame_across_chunks',
      category: 'D. Client parser',
      run: async () => withMockFetch(async () => eventStreamResponse([opened.slice(0, 8), opened.slice(8), progress, final, closed]), async () => {
        const result = await postIncrementalCouncilChat({ body: requestBody() })
        return result.finalResponse !== null && result.progressCount === 1 && result.closed?.terminalState === 'execution_completed'
      }),
    },
    {
      caseId: 'c4c_client_002_multiple_frames_one_chunk',
      category: 'D. Client parser',
      run: async () => withMockFetch(async () => eventStreamResponse([opened + progress + final + closed]), async () => {
        const result = await postIncrementalCouncilChat({ body: requestBody() })
        return result.finalResponse !== null && result.progressCount === 1
      }),
    },
    {
      caseId: 'c4c_client_003_utf8_boundary_split',
      category: 'D. Client parser',
      run: async () => withMockFetch(async () => eventStreamResponse([snowmanBytes.slice(0, splitBytesAt), snowmanBytes.slice(splitBytesAt)]), async () => {
        const result = await postIncrementalCouncilChat({ body: requestBody() })
        return result.error?.error.message.includes('Snowman ☃') === true
      }),
    },
    {
      caseId: 'c4c_client_004_crlf_and_lf',
      category: 'D. Client parser',
      run: async () => withMockFetch(async () => eventStreamResponse([(opened + progress).replace(/\n/g, '\r\n'), final, closed]), async () => {
        const result = await postIncrementalCouncilChat({ body: requestBody() })
        return result.finalResponse !== null && result.progressCount === 1
      }),
    },
    {
      caseId: 'c4c_client_005_comment_heartbeat_ignored',
      category: 'D. Client parser',
      run: async () => withMockFetch(async () => eventStreamResponse([encodeCouncilStreamComment('heartbeat'), opened, final, closed]), async () => {
        const result = await postIncrementalCouncilChat({ body: requestBody() })
        return result.finalResponse !== null && result.progressCount === 0
      }),
    },
    {
      caseId: 'c4c_client_006_multiline_data',
      category: 'D. Client parser',
      run: async () => {
        const multiline = `event: opened\n${JSON.stringify(baseEnvelope('opened', 0, 'client-a'), null, 2).split('\n').map(line => `data: ${line}`).join('\n')}\n\n`
        return withMockFetch(async () => eventStreamResponse([multiline, final, closed]), async () => {
          const result = await postIncrementalCouncilChat({ body: requestBody() })
          return result.finalResponse !== null
        })
      },
    },
    {
      caseId: 'c4c_client_007_malformed_json',
      category: 'D. Client parser',
      expected: 'invalid',
      run: async () => withMockFetch(async () => eventStreamResponse(['event: progress\ndata: {bad-json}\n\n']), async () => {
        const result = await postIncrementalCouncilChat({ body: requestBody() })
        return result.error?.error.code === 'malformed_stream_json'
      }),
    },
    {
      caseId: 'c4c_client_008_unknown_version',
      category: 'D. Client parser',
      expected: 'invalid',
      run: async () => withMockFetch(async () => eventStreamResponse([`event: opened\ndata: ${JSON.stringify({ ...baseEnvelope('opened', 0, 'client-a'), version: 'bad' })}\n\n`]), async () => {
        const result = await postIncrementalCouncilChat({ body: requestBody() })
        return result.error?.error.code === 'malformed_stream_envelope'
      }),
    },
    {
      caseId: 'c4c_client_009_unknown_envelope_type',
      category: 'D. Client parser',
      expected: 'invalid',
      run: async () => withMockFetch(async () => eventStreamResponse([`event: typing\ndata: ${JSON.stringify({ ...baseEnvelope('opened', 0, 'client-a'), envelopeType: 'typing' })}\n\n`]), async () => {
        const result = await postIncrementalCouncilChat({ body: requestBody() })
        return result.error?.error.code === 'malformed_stream_envelope'
      }),
    },
    {
      caseId: 'c4c_client_010_missing_request_id',
      category: 'D. Client parser',
      expected: 'invalid',
      run: async () => withMockFetch(async () => eventStreamResponse([`event: opened\ndata: ${JSON.stringify({ ...baseEnvelope('opened', 0, ''), requestId: '' })}\n\n`]), async () => {
        const result = await postIncrementalCouncilChat({ body: requestBody() })
        return result.error?.error.code === 'malformed_stream_envelope'
      }),
    },
    {
      caseId: 'c4c_client_011_mismatched_request_id',
      category: 'D. Client parser',
      expected: 'invalid',
      run: async () => withMockFetch(async () => eventStreamResponse([opened, encodeCouncilStreamEnvelope(baseEnvelope('progress', 1, 'client-b'))]), async () => {
        const result = await postIncrementalCouncilChat({ body: requestBody() })
        return result.error?.error.code === 'operation_identity_mismatch'
      }),
    },
    {
      caseId: 'c4c_client_012_duplicate_final',
      category: 'D. Client parser',
      expected: 'invalid',
      run: async () => withMockFetch(async () => eventStreamResponse([opened, final, encodeCouncilStreamEnvelope(baseEnvelope('final', 3, 'client-a'))]), async () => {
        const result = await postIncrementalCouncilChat({ body: requestBody() })
        return result.error?.error.code === 'duplicate_final_envelope'
      }),
    },
    {
      caseId: 'c4c_client_013_data_after_closed_ignored',
      category: 'D. Client parser',
      run: async () => withMockFetch(async () => eventStreamResponse([opened, final, closed, progress]), async () => {
        const result = await postIncrementalCouncilChat({ body: requestBody() })
        return result.finalResponse !== null && result.closed?.terminalState === 'execution_completed' && result.progressCount === 0
      }),
    },
    {
      caseId: 'c4c_client_014_truncated_stream',
      category: 'D. Client parser',
      expected: 'invalid',
      run: async () => withMockFetch(async () => eventStreamResponse([opened.slice(0, 10)]), async () => {
        const result = await postIncrementalCouncilChat({ body: requestBody() })
        return result.error?.error.code === 'stream_ended_without_final'
      }),
    },
    {
      caseId: 'c4c_client_015_abort_during_partial_frame',
      category: 'D. Client parser',
      expected: 'invalid',
      run: async () => {
        const controller = new AbortController()
        controller.abort()
        let callbacks = 0
        return withMockFetch(async (_input, init) => {
          if (init?.signal instanceof AbortSignal && init.signal.aborted) throw new DOMException('aborted', 'AbortError')
          return eventStreamResponse([opened.slice(0, 10)])
        }, async () => {
          try {
            await postIncrementalCouncilChat({
              body: requestBody(),
              signal: controller.signal,
              callbacks: { onOpened: () => { callbacks += 1 }, onProgress: () => { callbacks += 1 } },
            })
            return false
          } catch {
            return callbacks === 0
          }
        })
      },
    },
    {
      caseId: 'c4c_client_016_cleanup_after_normal_close',
      category: 'D. Client parser',
      run: async () => {
        const seen: string[] = []
        return withMockFetch(async () => eventStreamResponse([opened, progress, final, closed]), async () => {
          const result = await postIncrementalCouncilChat({
            body: requestBody(),
            callbacks: {
              onOpened: () => seen.push('opened'),
              onProgress: () => seen.push('progress'),
              onFinal: () => seen.push('final'),
              onClosed: () => seen.push('closed'),
            },
          })
          return result.error === null && seen.join(',') === 'opened,progress,final,closed'
        })
      },
    },
    {
      caseId: 'c4c_client_017_cleanup_after_malformed_frame',
      category: 'D. Client parser',
      expected: 'invalid',
      run: async () => withMockFetch(async () => eventStreamResponse(['event: progress\ndata: {bad-json}\n\n', final]), async () => {
        const result = await postIncrementalCouncilChat({ body: requestBody() })
        return result.error?.error.code === 'malformed_stream_json' && result.finalResponse === null
      }),
    },
    {
      caseId: 'c4c_client_018_no_stale_callback_after_abort',
      category: 'D. Client parser',
      expected: 'invalid',
      run: async () => {
        const controller = new AbortController()
        controller.abort()
        let stale = false
        return withMockFetch(async () => {
          throw new DOMException('aborted', 'AbortError')
        }, async () => {
          try {
            await postIncrementalCouncilChat({
              body: requestBody(),
              signal: controller.signal,
              callbacks: { onFinal: () => { stale = true }, onClosed: () => { stale = true } },
            })
            return false
          } catch {
            return !stale
          }
        })
      },
    },
  ]

  for (const input of clientCaseInputs) cases.push(await runCase(input))
  return cases
}

async function runRouteCases(): Promise<ValidationCase[]> {
  const cases: ValidationCase[] = []
  const successJson: CouncilChatJson = {
    results: [{ family: 'ChatGPT', content: 'Ready.', status: 'OK' }],
    councilProgress: snapshot('route-a', 1),
  }

  const routeCaseInputs: CaseInput[] = [
    {
      caseId: 'c4c_route_001_unauthenticated_equivalent_401',
      category: 'E. Stream route',
      expected: 'invalid',
      run: async () => {
        let calls = 0
        const handler = guardedStreamHandler(async () => {
          calls += 1
          return jsonResponse({ error: 'unauthorized' }, 401)
        })
        const events = await collectRouteEnvelopes(await handler(new Request('http://local/api/chat/stream', { method: 'POST', body: '{}' })))
        return calls === 1
          && events.some(event => event.envelopeType === 'error' && event.error.classification === 'transport')
          && events.at(-1)?.envelopeType === 'closed'
      },
    },
    {
      caseId: 'c4c_route_002_validation_failure_before_provider_execution',
      category: 'E. Stream route',
      expected: 'invalid',
      run: async () => {
        const handler = guardedStreamHandler(async () => jsonResponse({ error: 'invalid payload' }, 400))
        const events = await collectRouteEnvelopes(await handler(new Request('http://local/api/chat/stream', { method: 'POST', body: '{}' })))
        return events.some(event => event.envelopeType === 'error' && event.error.code === 'validation_failed_before_execution')
          && !events.some(event => event.envelopeType === 'final')
      },
    },
    {
      caseId: 'c4c_route_003_execution_called_exactly_once',
      category: 'E. Stream route',
      run: async () => {
        let calls = 0
        const handler = guardedStreamHandler(async (_req, options) => {
          calls += 1
          options?.progressEventObserver?.({ event: progressEvent(1, 'route-a'), snapshot: snapshot('route-a', 1) })
          return jsonResponse(successJson, 200)
        })
        await collectRouteEnvelopes(await handler(new Request('http://local/api/chat/stream', { method: 'POST', body: '{}' })))
        return calls === 1
      },
    },
    {
      caseId: 'c4c_route_004_opened_progress_final_closed_order',
      category: 'E. Stream route',
      run: async () => {
        const handler = guardedStreamHandler(async (_req, options) => {
          options?.progressEventObserver?.({ event: progressEvent(1, 'route-a'), snapshot: snapshot('route-a', 1) })
          return jsonResponse(successJson, 200)
        })
        const events = await collectRouteEnvelopes(await handler(new Request('http://local/api/chat/stream', { method: 'POST', body: '{}' })))
        return events.map(event => event.envelopeType).join(',') === 'opened,progress,final,closed'
      },
    },
    {
      caseId: 'c4c_route_005_error_once_no_final_after_terminal_error',
      category: 'E. Stream route',
      expected: 'invalid',
      run: async () => {
        const handler = guardedStreamHandler(async () => {
          throw new Error('boom')
        })
        const events = await collectRouteEnvelopes(await handler(new Request('http://local/api/chat/stream', { method: 'POST', body: '{}' })))
        return events.filter(event => event.envelopeType === 'error').length === 1
          && events.filter(event => event.envelopeType === 'final').length === 0
          && events.at(-1)?.envelopeType === 'closed'
      },
    },
    {
      caseId: 'c4c_route_006_abort_cleans_request_scoped_observer',
      category: 'E. Stream route',
      expected: 'invalid',
      run: async () => {
        const controller = new AbortController()
        const observers: ProgressObserver[] = []
        const handler = guardedStreamHandler(async (_req, options) => {
          if (options?.progressEventObserver) observers.push(options.progressEventObserver)
          options?.progressEventObserver?.({ event: progressEvent(1, 'route-abort'), snapshot: snapshot('route-abort', 1) })
          await new Promise(resolve => setTimeout(resolve, 50))
          return jsonResponse(successJson, 200)
        })
        const response = await handler(new Request('http://local/api/chat/stream', { method: 'POST', body: '{}', signal: controller.signal }))
        const events = await readFirstEnvelopeThenAbort(response, () => controller.abort())
        for (const observer of observers) observer({ event: progressEvent(2, 'route-abort'), snapshot: snapshot('route-abort', 2) })
        return events.some(event => event.envelopeType === 'closed' && event.terminalState === 'client_disconnected')
          && events.filter(event => event.envelopeType === 'final').length === 0
      },
    },
    {
      caseId: 'c4c_route_007_request_identity_stable',
      category: 'E. Stream route',
      run: async () => {
        const handler = guardedStreamHandler(async (_req, options) => {
          options?.progressEventObserver?.({ event: progressEvent(1, 'route-id'), snapshot: snapshot('route-id', 1) })
          return jsonResponse({ ...successJson, councilProgress: snapshot('route-id', 1) }, 200)
        })
        const events = await collectRouteEnvelopes(await handler(new Request('http://local/api/chat/stream', { method: 'POST', body: '{}' })))
        return events.length > 0 && events.every(event => event.requestId === 'route-id')
      },
    },
    {
      caseId: 'c4c_route_008_no_stack_or_secret_output',
      category: 'E. Stream route',
      expected: 'invalid',
      run: async () => {
        const handler = guardedStreamHandler(async () => {
          throw new Error('provider failed at C:\\Users\\markb\\warroom\\app\\api\\chat\\execute.ts:10:2 with sk-live-secret-123456789')
        })
        const text = await (await handler(new Request('http://local/api/chat/stream', { method: 'POST', body: '{}' }))).text()
        return !/C:\\Users|execute\.ts:\d+|sk-live-secret/i.test(text)
      },
    },
    {
      caseId: 'c4c_route_009_no_fallback_execution_after_ambiguous_failure',
      category: 'E. Stream route',
      expected: 'invalid',
      run: async () => {
        let calls = 0
        const handler = guardedStreamHandler(async (_req, options) => {
          calls += 1
          options?.progressEventObserver?.({ event: progressEvent(1, 'route-fail'), snapshot: snapshot('route-fail', 1) })
          throw new Error('ambiguous failure')
        })
        await collectRouteEnvelopes(await handler(new Request('http://local/api/chat/stream', { method: 'POST', body: '{}' })))
        return calls === 1
      },
    },
    {
      caseId: 'c4c_route_010_distinct_users_request_ids_isolated',
      category: 'E. Authenticated-equivalent route harness',
      run: async () => {
        const handler = guardedStreamHandler(async (req, options) => {
          const requestId = req.headers.get('x-test-request-id') ?? 'missing'
          options?.progressEventObserver?.({ event: progressEvent(1, requestId), snapshot: snapshot(requestId, 1) })
          return jsonResponse({ ...successJson, councilProgress: snapshot(requestId, 1) }, 200)
        })
        const a = await collectRouteEnvelopes(await handler(new Request('http://local/api/chat/stream', { method: 'POST', body: '{}', headers: { 'x-test-request-id': 'user-a' } })))
        const b = await collectRouteEnvelopes(await handler(new Request('http://local/api/chat/stream', { method: 'POST', body: '{}', headers: { 'x-test-request-id': 'user-b' } })))
        return a.every(event => event.requestId === 'user-a') && b.every(event => event.requestId === 'user-b')
      },
    },
  ]

  for (const input of routeCaseInputs) cases.push(await runCase(input))
  return cases
}

function runSanitizerCases(): ValidationCase[] {
  const cases: ValidationCase[] = []
  unsafeTokens().forEach((token, index) => {
    const sanitized = sanitizeCouncilStreamError(token)
    cases.push(makeCase(`c4c_sanitizer_${String(index + 1).padStart(2, '0')}_redacted`, 'F. Error sanitizer', 'valid', sanitized.message === 'Council stream failed with a redacted diagnostic.'))
  })
  const nested = new Error('outer safe message', { cause: new Error('sk-nested-provider-secret-1234567890') })
  const nestedSanitized = sanitizeCouncilStreamError(nested)
  cases.push(makeCase('c4c_sanitizer_010_nested_error_does_not_expose_cause', 'F. Error sanitizer', 'valid', !nestedSanitized.message.includes('sk-nested')))
  const objectSanitized = sanitizeCouncilStreamError({ stack: 'C:\\Users\\markb\\secret.ts:1:1', token: 'service_role' })
  cases.push(makeCase('c4c_sanitizer_011_non_error_object_generic', 'F. Error sanitizer', 'valid', objectSanitized.message === 'Council stream failed.'))
  const safe = sanitizeCouncilStreamError('Provider returned a temporary error.')
  cases.push(makeCase('c4c_sanitizer_012_safe_message_preserved', 'F. Error sanitizer', 'valid', safe.message === 'Provider returned a temporary error.'))
  const stackDiscrimination = productionStackDiscriminationProof()
  cases.push(makeCase(
    'c4c_sanitizer_013_production_stack_message_discrimination',
    'F. Error sanitizer',
    'valid',
    stackDiscrimination.passed,
    stackDiscrimination.details,
  ))
  cases.push(makeCase('c4c_sanitizer_014_secret_mutation_guard', 'F. Error sanitizer', 'invalid', sanitizeCouncilStreamError('sk-mutation-secret-1234567890').message !== 'sk-mutation-secret-1234567890'))
  return cases
}

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

function runStructuralCases(): ValidationCase[] {
  const cases: ValidationCase[] = []
  const jsonRoute = source('app/api/chat/route.ts')
  const streamRoute = source('app/api/chat/stream/route.ts')
  const client = source('lib/council/incremental-transport/client.ts')
  // Updated 2026-09-06 (nebula-council-streaming-runtime-repair cleanup): app/api/chat/route.ts
  // now assigns `const response = await executeCouncilChatRequest(req)` so it can fire-and-forget
  // an AGI-experience capture off a clone() of that same response before returning it — the
  // `return executeCouncilChatRequest(req)` inline-call shape this case used to require no longer
  // exists, but the invariant it exists to prove (executeCouncilChatRequest called exactly once,
  // and the value that call produced — not a second orchestration path's output — is what the
  // route returns) still holds. The regex below checks that invariant against the new shape
  // instead of the old literal pattern; c4c_structural_003 below separately guards against a
  // second real orchestration path being introduced.
  cases.push(makeCase('c4c_structural_001_json_route_calls_shared_execution_once', 'G. Structural execution proof', 'valid', (jsonRoute.match(/executeCouncilChatRequest/g) ?? []).length === 2 && /const response = await executeCouncilChatRequest\(req\)/.test(jsonRoute) && /return response\b/.test(jsonRoute)))
  cases.push(makeCase('c4c_structural_002_stream_route_has_one_executor_call_site', 'G. Structural execution proof', 'valid', (streamRoute.match(/executeRequest\(req/g) ?? []).length === 1))
  cases.push(makeCase('c4c_structural_003_no_second_orchestration_function_in_routes', 'G. Structural execution proof', 'valid', !/orchestrateProviderResponse|completeGeminiCouncilMessage|callXAIChat|ANTHROPIC_URL|OPENAI_URL/.test(jsonRoute + streamRoute)))
  cases.push(makeCase('c4c_structural_004_no_provider_adapter_import_in_stream_route', 'G. Structural execution proof', 'valid', !/providers\/|ai\/providers|completeGemini|callXAI|Anthropic|OpenAI/i.test(streamRoute)))
  cases.push(makeCase('c4c_structural_005_no_global_broadcaster', 'G. Structural execution proof', 'valid', !/EventEmitter|BroadcastChannel|globalThis\.[a-zA-Z0-9_]*stream|setInterval|websocket/i.test(streamRoute + client)))
  cases.push(makeCase('c4c_structural_006_progress_observer_request_scoped', 'G. Structural execution proof', 'valid', /progressEventObserver:\s*\(\{ event, snapshot \}\)/.test(streamRoute) && !/const\s+.*Observer\s*=.*progressEventObserver/.test(streamRoute)))
  cases.push(makeCase('c4c_structural_007_fallback_guarded_by_execution_started', 'G. Structural execution proof', 'valid', /fallback === 'final_snapshot_before_execution_only' && !executionStarted/.test(client)))
  cases.push(makeCase('c4c_structural_008_close_does_not_synthesize_completion', 'G. Structural execution proof', 'valid', /closed_without_final_state_uncertain/.test(source('lib/council/incremental-transport/reconcile.ts'))))
  return cases
}

async function runNegativeProofCases(): Promise<ValidationCase[]> {
  const cases: ValidationCase[] = []
  const opened = encodeCouncilStreamEnvelope(baseEnvelope('opened', 0, 'negative-a'))
  const progress = encodeCouncilStreamEnvelope(baseEnvelope('progress', 1, 'negative-a'))
  const inputs: CaseInput[] = [
    { caseId: 'c4c_negative_001_one_chunk_not_one_event', category: 'H. Negative proofs', run: () => parseFrames(opened + progress).length === 2 },
    { caseId: 'c4c_negative_002_missing_request_identity_rejected', category: 'H. Negative proofs', expected: 'invalid', run: () => parseFrames(`event: opened\ndata: ${JSON.stringify({ ...baseEnvelope('opened'), requestId: '' })}\n\n`).some(event => !event.ok) },
    { caseId: 'c4c_negative_003_duplicate_final_rejected', category: 'H. Negative proofs', expected: 'invalid', run: () => {
      const state = createCouncilStreamReconciliationState()
      return reconcileCouncilStreamEnvelope(state, baseEnvelope('final', 1, 'negative-a')).ok
        && !reconcileCouncilStreamEnvelope(state, baseEnvelope('final', 2, 'negative-a')).ok
    } },
    { caseId: 'c4c_negative_004_heartbeat_not_progress', category: 'H. Negative proofs', run: () => parseFrames(encodeCouncilStreamComment('heartbeat')).length === 0 },
    { caseId: 'c4c_negative_005_prose_failure_not_completion', category: 'H. Negative proofs', expected: 'invalid', run: async () => withMockFetch(async () => eventStreamResponse([opened]), async () => {
      const result = await postIncrementalCouncilChat({ body: requestBody() })
      return result.error?.error.code === 'stream_ended_without_final' && result.finalResponse === null
    }) },
    { caseId: 'c4c_negative_006_route_progress_without_final_not_complete', category: 'H. Negative proofs', expected: 'invalid', run: async () => {
      const handler = guardedStreamHandler(async (_req, options) => {
        options?.progressEventObserver?.({ event: progressEvent(1, 'negative-6'), snapshot: snapshot('negative-6', 1) })
        throw new Error('failed before final')
      })
      const events = await collectRouteEnvelopes(await handler(new Request('http://local/api/chat/stream', { method: 'POST', body: '{}' })))
      return events.some(event => event.envelopeType === 'progress')
        && !events.some(event => event.envelopeType === 'final')
        && events.some(event => event.envelopeType === 'error')
    } },
    { caseId: 'c4c_negative_007_client_started_progress_not_responded', category: 'H. Negative proofs', expected: 'invalid', run: async () => withMockFetch(async () => eventStreamResponse([
      encodeCouncilStreamEnvelope(baseEnvelope('opened', 0, 'negative-7')),
      encodeCouncilStreamEnvelope(progressEnvelope('negative-7', 1, { ...progressEvent(2, 'negative-7'), eventType: 'request_started' })),
    ]), async () => {
      const result = await postIncrementalCouncilChat({ body: requestBody() })
      return result.error?.error.code === 'stream_ended_without_final' && result.finalResponse === null && result.progressCount === 1
    }) },
    { caseId: 'c4c_negative_008_event_count_not_completion', category: 'H. Negative proofs', run: () => {
      const state = createCouncilStreamReconciliationState()
      reconcileCouncilStreamEnvelope(state, baseEnvelope('progress', 1, 'negative-a'))
      return !state.finalDelivered
    } },
    { caseId: 'c4c_negative_009_no_retry_after_ambiguous_failure', category: 'H. Negative proofs', expected: 'invalid', run: async () => {
      const proof = await runMutation9BoundedHarness()
      if (!proof.passed) throw new Error(proof.details.join('; '))
      return true
    } },
    { caseId: 'c4c_negative_010_observer_not_used_after_abort', category: 'H. Negative proofs', expected: 'invalid', run: async () => {
      const controller = new AbortController()
      const handler = guardedStreamHandler(async (_req, options) => {
        options?.progressEventObserver?.({ event: progressEvent(1, 'negative-abort'), snapshot: snapshot('negative-abort', 1) })
        await new Promise(resolve => setTimeout(resolve, 50))
        return jsonResponse({ results: [], councilProgress: snapshot('negative-abort', 1) }, 200)
      })
      const response = await handler(new Request('http://local/api/chat/stream', { method: 'POST', body: '{}', signal: controller.signal }))
      const events = await readFirstEnvelopeThenAbort(response, () => controller.abort())
      return events.some(event => event.envelopeType === 'closed' && event.terminalState === 'client_disconnected')
        && events.every(event => event.envelopeType !== 'final')
    } },
    { caseId: 'c4c_negative_011_request_b_not_attached_to_a', category: 'H. Negative proofs', expected: 'invalid', run: () => {
      const state = createCouncilStreamReconciliationState()
      reconcileCouncilStreamEnvelope(state, baseEnvelope('opened', 0, 'request-a'))
      return !reconcileCouncilStreamEnvelope(state, baseEnvelope('progress', 1, 'request-b')).ok
    } },
    { caseId: 'c4c_negative_012_stack_trace_redacted', category: 'H. Negative proofs', expected: 'invalid', run: () => sanitizeCouncilStreamError('C:\\Users\\markb\\warroom\\x.ts:1:1').message !== 'C:\\Users\\markb\\warroom\\x.ts:1:1' },
    { caseId: 'c4c_negative_013_fake_api_key_redacted', category: 'H. Negative proofs', expected: 'invalid', run: () => sanitizeCouncilStreamError('sk-fakefakefakefakefake').message !== 'sk-fakefakefakefakefake' },
    { caseId: 'c4c_negative_014_global_broadcaster_absent', category: 'H. Negative proofs', run: () => !/EventEmitter|BroadcastChannel|globalThis/i.test(source('app/api/chat/stream/route.ts')) },
    { caseId: 'c4c_negative_015_duplicate_orchestration_absent', category: 'H. Negative proofs', run: () => (source('app/api/chat/stream/route.ts').match(/executeRequest\(req/g) ?? []).length === 1 },
    { caseId: 'c4c_negative_016_snapshot_fallback_not_labeled_streaming', category: 'H. Negative proofs', run: async () => {
      let calls = 0
      return withMockFetch(async input => {
        calls += 1
        return String(input).includes('/api/chat/stream')
          ? jsonResponse({ error: 'stream unavailable' }, 503)
          : jsonResponse({ results: [] }, 200)
      }, async () => {
        const result = await postIncrementalCouncilChat({ body: requestBody(), fallback: 'final_snapshot_before_execution_only' })
        return calls === 2 && result.transportStarted === false
      })
    } },
    { caseId: 'c4c_negative_017_stream_close_not_completion', category: 'H. Negative proofs', expected: 'invalid', run: () => {
      const state = createCouncilStreamReconciliationState()
      reconcileCouncilStreamEnvelope(state, baseEnvelope('closed', 1, 'negative-a'))
      return state.stale && !state.finalDelivered
    } },
    { caseId: 'c4c_negative_018_disconnect_not_server_cancellation', category: 'H. Negative proofs', expected: 'invalid', run: async () => {
      const controller = new AbortController()
      const handler = guardedStreamHandler(async (_req, options) => {
        options?.progressEventObserver?.({ event: progressEvent(1, 'disconnect-a'), snapshot: snapshot('disconnect-a', 1) })
        await new Promise(resolve => setTimeout(resolve, 50))
        return jsonResponse({ results: [], councilProgress: snapshot('disconnect-a', 1) }, 200)
      })
      const response = await handler(new Request('http://local/api/chat/stream', { method: 'POST', body: '{}', signal: controller.signal }))
      const events = await readFirstEnvelopeThenAbort(response, () => controller.abort())
      return events.some(event => event.envelopeType === 'closed' && event.terminalState === 'client_disconnected')
        && !JSON.stringify(events).includes('server_cancelled')
    } },
  ]
  for (const input of inputs) cases.push(await runCase(input))
  return cases
}

export async function runIncrementalCouncilTransportValidation(): Promise<ValidationCase[]> {
  const retained = [
    ...runEnvelopeCases(),
    ...runSseCases(),
    ...runReconcileCases(),
    ...runSanitizerCases(),
    ...runStructuralCases(),
  ]
  const asyncCases = [
    ...(await runClientCases()),
    ...(await runRouteCases()),
    ...(await runNegativeProofCases()),
  ]
  const productionCategories = new Set([
    ...retained.map(item => item.category),
    ...asyncCases.map(item => item.category),
  ])
  const requiredCategories = [
    'A. Envelope contract',
    'B. SSE parser',
    'C. Reconciliation',
    'D. Client parser',
    'E. Stream route',
    'F. Error sanitizer',
    'G. Structural execution proof',
    'H. Negative proofs',
  ]
  const meaningfulCases = [...retained, ...asyncCases]
  return [
    ...meaningfulCases,
    makeCase(
      'c4c_meta_001_production_stream_version_roundtrip',
      'Z. Validation accounting',
      'valid',
      (() => {
        const encoded = encodeCouncilStreamEnvelope(baseEnvelope('opened'))
        const payload = encoded.split('\ndata: ')[1]?.split('\n\n')[0]
        if (!payload) return false
        try {
          const parsed = JSON.parse(payload) as unknown
          return validateCouncilStreamEnvelopeShape(parsed)
            && (parsed as CouncilStreamEnvelope).version === COUNCIL_STREAM_VERSION
        } catch {
          return false
        }
      })(),
    ),
    makeCase(
      'c4c_meta_002_production_module_coverage_present',
      'Z. Validation accounting',
      'valid',
      requiredCategories.every(category => productionCategories.has(category))
        && meaningfulCases.every(item => typeof item.caseId === 'string' && item.caseId.startsWith('c4c_')),
    ),
  ]
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const results = await runIncrementalCouncilTransportValidation()
  const failed = results.filter(result => result.result === 'FAIL')
  console.log(`Incremental Council transport validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) {
    for (const item of failed) console.error(`${item.caseId}: ${item.details.join('; ')}`)
    process.exit(1)
  }
}
