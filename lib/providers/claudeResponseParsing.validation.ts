import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  callClaudeFamilyWithEmptyContentRetry,
  ClaudeEmptyContentError,
  extractClaudeResponseText,
  type ClaudeRetryAttemptInfo,
} from './claudeResponseParsing'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

// --- Extraction cases --------------------------------------------------------------------

function extractionCases(): CaseResult[] {
  return [
    check(
      'claude_extraction_01_single_text_block',
      extractClaudeResponseText([{ type: 'text', text: 'Hello Ra\'el.' }]) === 'Hello Ra\'el.',
      extractClaudeResponseText([{ type: 'text', text: 'Hello Ra\'el.' }]),
    ),
    check(
      'claude_extraction_02_multiple_text_blocks_joined_without_artificial_separator',
      extractClaudeResponseText([
        { type: 'text', text: 'First part. ' },
        { type: 'text', text: 'Second part.' },
      ]) === 'First part. Second part.',
      extractClaudeResponseText([{ type: 'text', text: 'First part. ' }, { type: 'text', text: 'Second part.' }]),
    ),
    check(
      'claude_extraction_03_empty_content_array_yields_empty_string',
      extractClaudeResponseText([]) === '',
      JSON.stringify(extractClaudeResponseText([])),
    ),
    check(
      'claude_extraction_04_whitespace_only_text_is_preserved_but_not_trimmed_away_by_extractor',
      extractClaudeResponseText([{ type: 'text', text: '   ' }]) === '   ',
      JSON.stringify(extractClaudeResponseText([{ type: 'text', text: '   ' }])),
    ),
    check(
      'claude_extraction_05_non_text_only_content_yields_empty_string',
      extractClaudeResponseText([{ type: 'tool_use', input: { x: 1 } }]) === ''
        && extractClaudeResponseText([{ type: 'thinking', thinking: 'reasoning...' }]) === '',
      `tool_use=${JSON.stringify(extractClaudeResponseText([{ type: 'tool_use' }]))} thinking=${JSON.stringify(extractClaudeResponseText([{ type: 'thinking' }]))}`,
    ),
    check(
      'claude_extraction_06_mixed_non_text_and_text_blocks_extracts_only_text',
      extractClaudeResponseText([
        { type: 'tool_use', input: { x: 1 } },
        { type: 'text', text: 'Only this survives.' },
      ]) === 'Only this survives.',
      extractClaudeResponseText([{ type: 'tool_use' }, { type: 'text', text: 'Only this survives.' }]),
    ),
    check(
      'claude_extraction_07_text_block_not_at_index_zero',
      extractClaudeResponseText([
        { type: 'thinking', thinking: 'internal reasoning' },
        { type: 'tool_use', input: {} },
        { type: 'text', text: 'The real answer.' },
      ]) === 'The real answer.',
      extractClaudeResponseText([{ type: 'thinking' }, { type: 'tool_use' }, { type: 'text', text: 'The real answer.' }]),
    ),
    check(
      'claude_extraction_08_non_array_content_yields_empty_string',
      extractClaudeResponseText(undefined) === '' && extractClaudeResponseText(null) === '',
      `undefined=${JSON.stringify(extractClaudeResponseText(undefined))} null=${JSON.stringify(extractClaudeResponseText(null))}`,
    ),
  ]
}

// --- Retry cases ---------------------------------------------------------------------------

async function retryEmptyThenSuccessCase() {
  let calls = 0
  const result = await callClaudeFamilyWithEmptyContentRetry(async () => {
    calls += 1
    if (calls === 1) throw new ClaudeEmptyContentError('Claude returned empty content')
    return 'Second attempt succeeded.'
  })
  return { calls, result }
}

async function retryBothEmptyCase() {
  let calls = 0
  let thrown: unknown = null
  try {
    await callClaudeFamilyWithEmptyContentRetry(async () => {
      calls += 1
      throw new ClaudeEmptyContentError('Claude returned empty content')
    })
  } catch (err) {
    thrown = err
  }
  return { calls, isClaudeEmptyContentError: thrown instanceof ClaudeEmptyContentError }
}

async function retryNotUsedForTimeoutCase() {
  let calls = 0
  let thrown: unknown = null
  try {
    await callClaudeFamilyWithEmptyContentRetry(async () => {
      calls += 1
      throw new DOMException('The operation was aborted', 'AbortError')
    })
  } catch (err) {
    thrown = err
  }
  return { calls, isAbortError: thrown instanceof DOMException && thrown.name === 'AbortError' }
}

async function retryNotUsedForHttpErrorCase() {
  let calls = 0
  let thrown: unknown = null
  try {
    await callClaudeFamilyWithEmptyContentRetry(async () => {
      calls += 1
      throw new Error('Anthropic request failed (500)')
    })
  } catch (err) {
    thrown = err
  }
  return {
    calls,
    isPlainError: thrown instanceof Error && !(thrown instanceof ClaudeEmptyContentError),
    message: thrown instanceof Error ? thrown.message : String(thrown),
  }
}

async function retryNotUsedForFirstAttemptSuccessCase() {
  let calls = 0
  const result = await callClaudeFamilyWithEmptyContentRetry(async () => {
    calls += 1
    return 'First attempt already succeeded.'
  })
  return { calls, result }
}

async function retryTelemetryEmptyThenSuccessCase() {
  const attempts: ClaudeRetryAttemptInfo[] = []
  let calls = 0
  await callClaudeFamilyWithEmptyContentRetry(
    async () => {
      calls += 1
      if (calls === 1) throw new ClaudeEmptyContentError('Claude returned empty content')
      return 'Second attempt succeeded.'
    },
    info => attempts.push(info),
  )
  return attempts
}

async function retryTelemetryBothEmptyCase() {
  const attempts: ClaudeRetryAttemptInfo[] = []
  try {
    await callClaudeFamilyWithEmptyContentRetry(
      async () => {
        throw new ClaudeEmptyContentError('Claude returned empty content')
      },
      info => attempts.push(info),
    )
  } catch {
    // expected — both attempts empty
  }
  return attempts
}

async function retryTelemetryFirstAttemptSuccessCase() {
  const attempts: ClaudeRetryAttemptInfo[] = []
  await callClaudeFamilyWithEmptyContentRetry(
    async () => 'First attempt already succeeded.',
    info => attempts.push(info),
  )
  return attempts
}

async function retryTelemetryOtherErrorCase() {
  const attempts: ClaudeRetryAttemptInfo[] = []
  try {
    await callClaudeFamilyWithEmptyContentRetry(
      async () => {
        throw new Error('Anthropic request failed (500)')
      },
      info => attempts.push(info),
    )
  } catch {
    // expected — non-empty-content error propagates
  }
  return attempts
}

async function retryCases(): Promise<CaseResult[]> {
  const emptyThenSuccess = await retryEmptyThenSuccessCase()
  const bothEmpty = await retryBothEmptyCase()
  const timeoutCase = await retryNotUsedForTimeoutCase()
  const httpErrorCase = await retryNotUsedForHttpErrorCase()
  const firstAttemptSuccess = await retryNotUsedForFirstAttemptSuccessCase()
  const telemetryEmptyThenSuccess = await retryTelemetryEmptyThenSuccessCase()
  const telemetryBothEmpty = await retryTelemetryBothEmptyCase()
  const telemetryFirstAttemptSuccess = await retryTelemetryFirstAttemptSuccessCase()
  const telemetryOtherError = await retryTelemetryOtherErrorCase()

  return [
    check(
      'claude_retry_01_first_attempt_empty_second_succeeds',
      emptyThenSuccess.calls === 2 && emptyThenSuccess.result === 'Second attempt succeeded.',
      `calls=${emptyThenSuccess.calls} result=${emptyThenSuccess.result}`,
    ),
    check(
      'claude_retry_02_both_attempts_empty_produces_claude_empty_content_error_after_exactly_two_calls',
      bothEmpty.calls === 2 && bothEmpty.isClaudeEmptyContentError,
      `calls=${bothEmpty.calls} isClaudeEmptyContentError=${bothEmpty.isClaudeEmptyContentError}`,
    ),
    check(
      'claude_retry_03_timeout_abort_does_not_use_empty_content_retry',
      timeoutCase.calls === 1 && timeoutCase.isAbortError,
      `calls=${timeoutCase.calls} isAbortError=${timeoutCase.isAbortError}`,
    ),
    check(
      'claude_retry_04_http_provider_error_does_not_use_empty_content_retry',
      httpErrorCase.calls === 1 && httpErrorCase.isPlainError,
      `calls=${httpErrorCase.calls} message=${httpErrorCase.message}`,
    ),
    check(
      'claude_retry_05_successful_first_attempt_is_not_retried',
      firstAttemptSuccess.calls === 1,
      `calls=${firstAttemptSuccess.calls} result=${firstAttemptSuccess.result}`,
    ),
    check(
      'claude_retry_06_no_accidental_third_attempt_when_both_fail',
      bothEmpty.calls <= 2,
      `calls=${bothEmpty.calls}`,
    ),
    check(
      'claude_retry_telemetry_01_empty_first_attempt_emits_retry_evidence',
      telemetryEmptyThenSuccess.length === 2
        && telemetryEmptyThenSuccess[0]?.attempt === 1
        && telemetryEmptyThenSuccess[0]?.outcome === 'empty_content'
        && telemetryEmptyThenSuccess[1]?.attempt === 2
        && telemetryEmptyThenSuccess[1]?.outcome === 'success',
      JSON.stringify(telemetryEmptyThenSuccess),
    ),
    check(
      'claude_retry_telemetry_02_second_empty_response_emits_final_empty_content_failure_evidence',
      telemetryBothEmpty.length === 2
        && telemetryBothEmpty[0]?.outcome === 'empty_content'
        && telemetryBothEmpty[1]?.attempt === 2
        && telemetryBothEmpty[1]?.outcome === 'empty_content',
      JSON.stringify(telemetryBothEmpty),
    ),
    check(
      'claude_retry_telemetry_03_normal_first_attempt_success_emits_no_retry_event',
      telemetryFirstAttemptSuccess.length === 1 && telemetryFirstAttemptSuccess[0]?.outcome === 'success',
      JSON.stringify(telemetryFirstAttemptSuccess),
    ),
    check(
      'claude_retry_telemetry_04_unrelated_error_not_mislabeled_as_empty_content_retry',
      telemetryOtherError.length === 1 && telemetryOtherError[0]?.outcome === 'other_error',
      JSON.stringify(telemetryOtherError),
    ),
    check(
      'claude_retry_telemetry_05_telemetry_carries_no_content_fields',
      [...telemetryEmptyThenSuccess, ...telemetryBothEmpty, ...telemetryFirstAttemptSuccess, ...telemetryOtherError].every(
        info => Object.keys(info).sort().join(',') === 'attempt,outcome',
      ),
      'every telemetry event exposes only {attempt, outcome}',
    ),
  ]
}

// --- Structural source checks -------------------------------------------------------------
// The Claude family is no longer dispatched from app/api/chat/execute.ts: every seat goes through invokeCouncilSeat and the live adapters, which return a
// typed failure ({ ok: false, error: 'empty response body' }) for an empty reply instead of throwing, and the routing policy decides what happens next.
// What is left of the empty-content retry is the pure helper in claudeResponseParsing.ts. These checks pin exactly that: the retired wrapper is not
// wired anywhere, the adapters fail in a typed way, and the helper stays a bounded, content-free, side-effect-free retry.

const repoFile = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

function structuralCases(): CaseResult[] {
  const execute = repoFile('app/api/chat/execute.ts')
  const anthropic = repoFile('lib/council/live-orchestration/adapters/anthropic.ts')
  const direct = repoFile('lib/council/providerDirectCall.ts')
  const helper = repoFile('lib/providers/claudeResponseParsing.ts')
  const helperFn = helper.match(/export async function callClaudeFamilyWithEmptyContentRetry[\s\S]*?\n\}\n/)?.[0] ?? ''
  return [
    check(
      'claude_retry_structural_01_the_retired_execute_wrapper_is_not_wired_into_any_seat',
      !execute.includes('callClaudeWithEmptyContentRetry') && !execute.includes('recordClaudeRetryTelemetry') && execute.includes('invokeCouncilSeat'),
      'execute.ts dispatches through invokeCouncilSeat and holds no retry wrapper',
    ),
    check(
      'claude_retry_structural_02_live_adapters_fail_in_a_typed_way_on_an_empty_body',
      anthropic.includes("error: 'empty response body'") && direct.includes("error: 'empty response body'") && !anthropic.includes('ClaudeEmptyContentError') && !direct.includes('ClaudeEmptyContentError'),
      'empty replies become typed failures, never thrown empty-content errors',
    ),
    check(
      'claude_retry_structural_03_helper_records_no_progress_events',
      helperFn.length > 0 && !helperFn.includes('recordCouncilProgressProviderStart') && !helperFn.includes('recordCouncilProgressProviderResult'),
      'retry helper body does not call progress-event recorders',
    ),
    check(
      'claude_retry_structural_04_helper_has_no_loop_construct',
      helperFn.length > 0 && !/(for\s*\(|while\s*\()/.test(helperFn),
      'bounded to exactly two attempts, no for/while',
    ),
    check(
      'claude_retry_structural_05_helper_observer_receives_no_provider_content',
      /export type ClaudeRetryAttemptInfo = \{\s*attempt: 1 \| 2\s*outcome: ClaudeRetryAttemptOutcome\s*\}/.test(helper) && !/onAttempt\?\.\([^)]*(result|err\.message|prompt)/.test(helperFn),
      'the observer only gets the attempt number and a coarse outcome',
    ),
  ]
}

export async function runClaudeResponseParsingValidation(): Promise<CaseResult[]> {
  return [...extractionCases(), ...(await retryCases()), ...structuralCases()]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runClaudeResponseParsingValidation().then(results => {
    for (const result of results) {
      console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
    }
    const failed = results.filter(result => !result.pass)
    console.log(`Claude response parsing validation: ${results.length - failed.length}/${results.length} PASS`)
    if (failed.length) process.exit(1)
  })
}
