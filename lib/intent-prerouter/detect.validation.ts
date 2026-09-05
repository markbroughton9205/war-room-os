import { pathToFileURL } from 'node:url'
import { detectPreRouterIntent } from './detect'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const CASES: Array<{ name: string; message: string; expectedIntent: string | null; expectedDirectiveContent?: string }> = [
  { name: 'whats_next_plain', message: "what's next", expectedIntent: 'WHATS_NEXT' },
  { name: 'whats_next_working_on', message: 'What are we working on?', expectedIntent: 'WHATS_NEXT' },
  { name: 'whats_next_waiting_on', message: 'what are we waiting on right now', expectedIntent: 'WHATS_NEXT' },
  { name: 'give_claude_next_prompt', message: 'Give Claude the next prompt', expectedIntent: 'GIVE_CLAUDE_NEXT_PROMPT' },
  { name: 'give_claude_code_next_prompt', message: 'give claude code the next prompt please', expectedIntent: 'GIVE_CLAUDE_NEXT_PROMPT' },
  { name: 'give_codex_build_prompt', message: 'give codex the build prompt', expectedIntent: 'GIVE_CODEX_BUILD_PROMPT' },
  { name: 'give_kimi_research_prompt', message: 'Give Kimi the research prompt', expectedIntent: 'GIVE_KIMI_RESEARCH_PROMPT' },
  { name: 'remember_that_prefix', message: 'Remember that we use Option A storage.', expectedIntent: 'REMEMBER_DIRECTIVE', expectedDirectiveContent: 'we use Option A storage.' },
  { name: 'remember_colon_prefix', message: 'Remember: ship the vertical slice first.', expectedIntent: 'REMEMBER_DIRECTIVE', expectedDirectiveContent: 'ship the vertical slice first.' },
  { name: 'decision_is_now_prefix', message: 'The decision is now: use Postgres, not Neo4j.', expectedIntent: 'REMEMBER_DIRECTIVE', expectedDirectiveContent: 'use Postgres, not Neo4j.' },
  { name: 'no_match_ordinary_message', message: 'Can you summarize the last deploy?', expectedIntent: null },
  { name: 'no_match_empty_string', message: '   ', expectedIntent: null },
  { name: 'no_false_positive_on_next_prompt_alone', message: 'the next prompt should probably wait', expectedIntent: null },
]

export function runIntentPreRouterDetectValidation(): CaseResult[] {
  return CASES.map(testCase => {
    const match = detectPreRouterIntent(testCase.message)
    const intentOk = (match?.intent ?? null) === testCase.expectedIntent
    const directiveOk = testCase.expectedDirectiveContent === undefined || match?.directiveContent === testCase.expectedDirectiveContent
    return check(testCase.name, intentOk && directiveOk, JSON.stringify(match))
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runIntentPreRouterDetectValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`Intent Pre-Router detect validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
