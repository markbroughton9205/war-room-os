import {
  buildIntegrityExpectationForPrompt,
  detectPromptIntent,
  detectsExplicitBrevityRequest,
} from './promptIntent'
import { validateProviderResponseIntegrity } from '@/lib/providers/responseIntegrity'
import { pathToFileURL } from 'node:url'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function integrityFor(decreeText: string, replyText: string) {
  const intent = detectPromptIntent(decreeText)
  const brevityRequested = detectsExplicitBrevityRequest(decreeText)
  return validateProviderResponseIntegrity(
    replyText,
    buildIntegrityExpectationForPrompt(intent, { minLength: 60, councilMode: true }, { brevityRequested }),
  )
}

export function runPromptIntentValidation(): CaseResult[] {
  const oneSentenceDecree = 'Post-promotion verification test: reply with a one-sentence confirmation that you are online.'
  const oneSentenceReply = integrityFor(oneSentenceDecree, 'Yes, I am online and ready.')

  const conciseSubstantiveReply = integrityFor(
    'Give me a brief answer: what is the single biggest risk in this plan?',
    'The rollout has no rollback path if the migration fails midway.',
  )

  const yesNoReply = integrityFor(
    'Should we ship this today — yes or no?',
    'No — the integrity test suite has not run against this build yet.',
  )

  const emptyReply = integrityFor(oneSentenceDecree, '')
  const whitespaceReply = integrityFor(oneSentenceDecree, '   \n\t  ')
  const fragmentReply = integrityFor(oneSentenceDecree, 'ok')

  const normalAnalyticalDecree = 'Analyze the tradeoffs of moving persistence to a new schema.'
  const shortReplyToAnalyticalPrompt = integrityFor(
    normalAnalyticalDecree,
    'Switching schemas is risky.',
  )
  const substantiveReplyToAnalyticalPrompt = integrityFor(
    normalAnalyticalDecree,
    'Moving persistence to a new schema trades short-term migration risk and downtime against long-term query performance and simpler indexing, and the safest path is a dual-write rollout with a verified backfill before cutover.',
  )

  return [
    check(
      'brevity_01_detects_one_sentence_marker',
      detectsExplicitBrevityRequest(oneSentenceDecree),
      String(detectsExplicitBrevityRequest(oneSentenceDecree)),
    ),
    check(
      'brevity_02_detects_yes_or_no_marker',
      detectsExplicitBrevityRequest('Should we ship this today — yes or no?'),
      String(detectsExplicitBrevityRequest('Should we ship this today — yes or no?')),
    ),
    check(
      'brevity_03_does_not_flag_ordinary_analytical_prompt',
      !detectsExplicitBrevityRequest(normalAnalyticalDecree),
      String(detectsExplicitBrevityRequest(normalAnalyticalDecree)),
    ),
    check(
      'brevity_04_one_sentence_confirmation_accepted',
      oneSentenceReply.integrity_status === 'COMPLETE',
      JSON.stringify(oneSentenceReply),
    ),
    check(
      'brevity_05_concise_substantive_answer_accepted',
      conciseSubstantiveReply.integrity_status === 'COMPLETE',
      JSON.stringify(conciseSubstantiveReply),
    ),
    check(
      'brevity_06_yes_no_answer_accepted_when_requested',
      yesNoReply.integrity_status === 'COMPLETE',
      JSON.stringify(yesNoReply),
    ),
    check(
      'brevity_07_empty_response_still_rejected',
      emptyReply.integrity_status !== 'COMPLETE',
      JSON.stringify(emptyReply),
    ),
    check(
      'brevity_08_whitespace_only_response_still_rejected',
      whitespaceReply.integrity_status !== 'COMPLETE',
      JSON.stringify(whitespaceReply),
    ),
    check(
      'brevity_09_meaningless_fragment_still_rejected',
      fragmentReply.integrity_status !== 'COMPLETE',
      JSON.stringify(fragmentReply),
    ),
    check(
      'brevity_10_normal_analytical_prompt_keeps_existing_threshold_for_short_reply',
      shortReplyToAnalyticalPrompt.integrity_status !== 'COMPLETE',
      JSON.stringify(shortReplyToAnalyticalPrompt),
    ),
    check(
      'brevity_11_normal_analytical_prompt_accepts_substantive_reply',
      substantiveReplyToAnalyticalPrompt.integrity_status === 'COMPLETE',
      JSON.stringify(substantiveReplyToAnalyticalPrompt),
    ),
  ]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runPromptIntentValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Prompt intent brevity validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
