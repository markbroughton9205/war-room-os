import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { callClaudeFamilyWithEmptyContentRetry, ClaudeEmptyContentError, extractClaudeResponseText } from './claudeResponseParsing'

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

async function retryCases(): Promise<CaseResult[]> {
  const emptyThenSuccess = await retryEmptyThenSuccessCase()
  const bothEmpty = await retryBothEmptyCase()
  const timeoutCase = await retryNotUsedForTimeoutCase()
  const httpErrorCase = await retryNotUsedForHttpErrorCase()
  const firstAttemptSuccess = await retryNotUsedForFirstAttemptSuccessCase()

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
  ]
}

// --- Structural source checks -------------------------------------------------------------
// These guarantee properties that can't be exercised by calling the pure retry helper alone,
// since the actual family dispatch (execute.ts's `continue_single` switch) isn't independently
// invocable without the full Next.js route context. Modeled on the existing
// `noRecursiveSelfCallInSource` pattern in retryOrchestration.validation.ts.

function executeTsSource(): string {
  const sourcePath = fileURLToPath(new URL('../../app/api/chat/execute.ts', import.meta.url))
  return readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n')
}

function claudeAndRedTeamCaseBodies(source: string): { claude: string; redTeam: string } {
  const claudeMatch = source.match(/case 'claude': \{([\s\S]*?)\n {10}\}\n {10}case 'grok':/)
  const redTeamMatch = source.match(/case 'red_team': \{([\s\S]*?)\n {10}\}\n {10}case 'baby':/)
  return {
    claude: claudeMatch?.[1] ?? '',
    redTeam: redTeamMatch?.[1] ?? '',
  }
}

function structuralCases(): CaseResult[] {
  const source = executeTsSource()
  const { claude, redTeam } = claudeAndRedTeamCaseBodies(source)

  const otherCaseNames = ['chatgpt', 'grok', 'gemini', 'kimi', 'baby']
  const otherCasesUseRetryHelper = otherCaseNames.some(name => {
    const match = source.match(new RegExp(`case '${name}': \\{([\\s\\S]*?)\\n {10}\\}\\n {10}case `))
    return (match?.[1] ?? '').includes('callClaudeWithEmptyContentRetry')
  })

  const retryHelperSource = source.match(/const callClaudeWithEmptyContentRetry = [\s\S]*?\n {6}\n/)?.[0] ?? ''

  return [
    check(
      'claude_retry_structural_01_only_claude_and_red_team_cases_use_the_retry_wrapper',
      claude.includes('callClaudeWithEmptyContentRetry') && redTeam.includes('callClaudeWithEmptyContentRetry') && !otherCasesUseRetryHelper,
      `claudeUses=${claude.includes('callClaudeWithEmptyContentRetry')} redTeamUses=${redTeam.includes('callClaudeWithEmptyContentRetry')} otherFamilyUsesIt=${otherCasesUseRetryHelper}`,
    ),
    check(
      'claude_retry_structural_02_successful_retry_rejoins_normal_path_no_early_return_in_case_body',
      !claude.includes('return ') && !redTeam.includes('return '),
      `claudeHasReturn=${claude.includes('return ')} redTeamHasReturn=${redTeam.includes('return ')}`,
    ),
    check(
      'claude_retry_structural_03_progress_events_recorded_once_per_switch_not_inside_retry_helper',
      !retryHelperSource.includes('recordCouncilProgressProviderStart') && !retryHelperSource.includes('recordCouncilProgressProviderResult'),
      'retry helper body does not call progress-event recorders directly',
    ),
    check(
      'claude_retry_structural_04_retry_wrapper_has_no_loop_construct',
      !/const callClaudeWithEmptyContentRetry[\s\S]{0,400}?(for\s*\(|while\s*\()/.test(source),
      'no for/while near the wrapper definition',
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
