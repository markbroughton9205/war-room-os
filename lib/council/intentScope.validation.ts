import { stripForbiddenScopeLines, type ActiveScope } from './intentScope'
import { pathToFileURL } from 'node:url'

type CaseResult = {
  name: string
  pass: boolean
  detail: string
}

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const GREETING_SCOPE: ActiveScope = {
  intent: 'greeting',
  businessTopicsAllowed: false,
  allowedTopics: ['tone', 'presence', 'coordination'],
  forbiddenTopics: ['panama', 'panama canal', 'revenue', 'invoice', 'payroll', 'sovereignty'],
  responseLength: 'brief',
  responseStyle: 'warm',
  familyPermissions: { maxResponsesPerFamily: 1, maxCharsPerFamily: 900 },
  crossTalkAllowed: false,
  sessionDuration: 'single_burst',
}

const NO_FORBIDDEN_SCOPE: ActiveScope = { ...GREETING_SCOPE, forbiddenTopics: [] }

/** Reproduces the observed Full Council defect: a real single-paragraph greeting reply
 * that merely disclaims an off-scope topic ("no Panama analysis needed") previously got
 * reduced to nothing, silently vanishing a genuine response from the transcript. */
const singleLineIncidentalMention = stripForbiddenScopeLines(
  "Hey Ra'el 👋 No decree here, just a hello — so I'll keep it that way. No Panama analysis, no risk review, no business drift to flag.",
  GREETING_SCOPE,
)

const multiLinePartialOffTopic = stripForbiddenScopeLines(
  [
    'Line one is a clean greeting with no forbidden topic mentions at all.',
    'Line two references the panama canal project which is genuinely out of scope here.',
    'Line three closes out the reply cleanly with no forbidden topic mentions either.',
  ].join('\n'),
  GREETING_SCOPE,
)

const allLinesOffTopic = stripForbiddenScopeLines(
  [
    'This whole line is about revenue and invoice processing for the quarter.',
    'This other line covers payroll and sovereignty concerns for the region.',
  ].join('\n'),
  GREETING_SCOPE,
)

const emptyInput = stripForbiddenScopeLines('   ', GREETING_SCOPE)
const noForbiddenTopicsConfigured = stripForbiddenScopeLines(
  'Mentions panama canal and revenue freely since this scope has no forbidden topics.',
  NO_FORBIDDEN_SCOPE,
)

export function runIntentScopeValidation(): CaseResult[] {
  return [
    check(
      'intent_scope_01_single_paragraph_incidental_mention_preserved',
      singleLineIncidentalMention.text.length > 0
        && singleLineIncidentalMention.text.includes('No decree here')
        && singleLineIncidentalMention.stripped === 0,
      JSON.stringify(singleLineIncidentalMention),
    ),
    check(
      'intent_scope_02_partial_off_topic_lines_still_stripped',
      multiLinePartialOffTopic.text.includes('Line one')
        && multiLinePartialOffTopic.text.includes('Line three')
        && !multiLinePartialOffTopic.text.includes('panama canal project')
        && multiLinePartialOffTopic.stripped === 1,
      JSON.stringify(multiLinePartialOffTopic),
    ),
    check(
      'intent_scope_03_full_match_falls_back_to_original_instead_of_vanishing',
      allLinesOffTopic.text.length > 0
        && allLinesOffTopic.text.includes('revenue and invoice')
        && allLinesOffTopic.stripped === 0,
      JSON.stringify(allLinesOffTopic),
    ),
    check(
      'intent_scope_04_empty_input_stays_empty',
      emptyInput.text === '   ' && emptyInput.stripped === 0,
      JSON.stringify(emptyInput),
    ),
    check(
      'intent_scope_05_no_forbidden_topics_configured_passthrough',
      noForbiddenTopicsConfigured.text.includes('panama canal and revenue')
        && noForbiddenTopicsConfigured.stripped === 0,
      JSON.stringify(noForbiddenTopicsConfigured),
    ),
  ]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runIntentScopeValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Intent scope stripping validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
