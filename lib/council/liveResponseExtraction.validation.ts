import {
  extractReadableCouncilContributions,
  extractReadableCouncilResponse,
} from './liveResponseExtraction'
import { pathToFileURL } from 'node:url'

type CaseResult = {
  name: string
  pass: boolean
  detail: string
}

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const stableGroupResultOnly = extractReadableCouncilResponse({
  councilSingleResponse: '',
  councilSingleFamily: 'chatgpt',
  results: [
    {
      family: 'ChatGPT',
      content: 'ChatGPT response from provider results, suitable for transcript rendering.',
      status: 'OK',
    },
  ],
}, 'chatgpt')

const finalSynthesis = extractReadableCouncilResponse({
  councilSingleResponse: 'Final synthesis response from the primary response field.',
  councilSingleFamily: 'chatgpt',
  results: [
    {
      family: 'ChatGPT',
      content: 'Family fallback response that should not override final synthesis.',
      status: 'OK',
    },
  ],
}, 'chatgpt')

const mismatchedFamily = extractReadableCouncilResponse({
  councilSingleResponse: '',
  results: [
    {
      family: 'Claude',
      content: 'Claude response should not be used for a ChatGPT turn.',
      status: 'OK',
    },
  ],
}, 'chatgpt')

const emptyOperationalRows = extractReadableCouncilResponse({
  councilSingleResponse: '',
  results: [
    { family: 'SYSTEM', content: 'Request received.', status: 'OK' },
    { family: 'ChatGPT', content: '', status: 'OK' },
    { family: 'ChatGPT', content: 'Provider failed.', status: 'FAILED' },
    { family: 'RED TEAM', content: '⚠ ChatGPT: empty response', status: 'OK', messageType: 'integrity_flag' },
  ],
}, 'chatgpt')

const duplicateRows = extractReadableCouncilResponse({
  councilSingleResponse: '',
  results: [
    { family: 'ChatGPT', content: 'First usable provider response.', status: 'OK' },
    { family: 'ChatGPT', content: 'Duplicate provider response should not be selected first.', status: 'OK' },
  ],
}, 'chatgpt')

const singleResponseDeliberationFallback = extractReadableCouncilResponse({
  councilSingleResponse: '',
  results: [],
  familyDeliberation: {
    turns: [
      {
        turn_id: 'turn-chatgpt',
        output_message_id: 'message-chatgpt',
        provider_family: 'chatgpt',
        provider_label: 'ChatGPT',
        completion_status: 'complete',
        full_response: 'ChatGPT full deliberation response from familyDeliberation.turns.',
      },
    ],
  },
}, 'chatgpt')

const streamFinalContributions = extractReadableCouncilContributions({
  councilSingleResponse: '',
  results: [
    { family: 'ChatGPT', content: 'ChatGPT stream-final response from results content.', status: 'OK' },
    { family: 'Claude', content: 'Claude stream-final response from results content.', status: 'OK' },
    { family: 'SYSTEM', content: 'Request received only.', status: 'OK' },
    { family: 'RED TEAM', content: 'Integrity note only.', status: 'OK', messageType: 'integrity_flag' },
  ],
})

const deliberationTurnFallback = extractReadableCouncilContributions({
  councilSingleResponse: '',
  results: [],
  familyDeliberation: {
    turns: [
      {
        turn_id: 'turn-chatgpt',
        output_message_id: 'message-chatgpt',
        provider_family: 'chatgpt',
        provider_label: 'ChatGPT',
        completion_status: 'complete',
        full_response: 'ChatGPT full deliberation response from familyDeliberation.turns.',
      },
      {
        turn_id: 'turn-claude-empty',
        output_message_id: null,
        provider_family: 'claude',
        provider_label: 'Claude',
        completion_status: 'failed',
        full_response: '',
      },
    ],
  },
})

const duplicateContributionRows = extractReadableCouncilContributions({
  results: [
    { family: 'ChatGPT', content: 'Same readable provider response.', status: 'OK' },
    { family: 'ChatGPT', content: 'Same readable provider response.', status: 'OK' },
  ],
})

const integrityIncompleteFallback = extractReadableCouncilResponse({
  councilSingleResponse: '',
  results: [
    {
      family: 'ChatGPT',
      content: 'Provider response incomplete; fallback summary used',
      status: 'OK',
      messageType: 'integrity_incomplete',
    },
  ],
}, 'chatgpt')

const integrityIncompleteAlongsideUsableSibling = extractReadableCouncilResponse({
  councilSingleResponse: '',
  results: [
    {
      family: 'ChatGPT',
      content: 'Provider response incomplete; fallback summary used',
      status: 'OK',
      messageType: 'integrity_incomplete',
    },
    {
      family: 'Claude',
      content: 'Claude produced a complete, integrity-validated council response.',
      status: 'OK',
    },
  ],
})

const integrityIncompleteContributionExcluded = extractReadableCouncilContributions({
  results: [
    {
      family: 'ChatGPT',
      content: 'Provider response incomplete; fallback summary used',
      status: 'OK',
      messageType: 'integrity_incomplete',
    },
    { family: 'Claude', content: 'Claude usable contribution for synthesis.', status: 'OK' },
  ],
})

export function runLiveResponseExtractionValidation(): CaseResult[] {
  return [
    check(
      'live_response_01_results_content_used_when_final_missing',
      stableGroupResultOnly?.content === 'ChatGPT response from provider results, suitable for transcript rendering.'
        && stableGroupResultOnly.source === 'results.content',
      JSON.stringify(stableGroupResultOnly),
    ),
    check(
      'live_response_02_final_response_field_takes_precedence',
      finalSynthesis?.content === 'Final synthesis response from the primary response field.'
        && finalSynthesis.source === 'councilSingleResponse',
      JSON.stringify(finalSynthesis),
    ),
    check(
      'live_response_03_mismatched_family_not_inserted',
      mismatchedFamily === null,
      JSON.stringify(mismatchedFamily),
    ),
    check(
      'live_response_04_operational_rows_do_not_become_answers',
      emptyOperationalRows === null,
      JSON.stringify(emptyOperationalRows),
    ),
    check(
      'live_response_05_first_usable_duplicate_selected_once',
      duplicateRows?.content === 'First usable provider response.',
      JSON.stringify(duplicateRows),
    ),
    check(
      'live_response_06b_single_response_falls_back_to_deliberation_turn',
      singleResponseDeliberationFallback?.content === 'ChatGPT full deliberation response from familyDeliberation.turns.'
        && singleResponseDeliberationFallback.source === 'familyDeliberation.turn',
      JSON.stringify(singleResponseDeliberationFallback),
    ),
    check(
      'live_response_06_stream_final_results_extract_multiple_families',
      streamFinalContributions.length === 2
        && streamFinalContributions[0]?.family === 'ChatGPT'
        && streamFinalContributions[1]?.family === 'Claude',
      JSON.stringify(streamFinalContributions),
    ),
    check(
      'live_response_07_deliberation_turn_fallback_extracts_full_response',
      deliberationTurnFallback.length === 1
        && deliberationTurnFallback[0]?.source === 'familyDeliberation.turn'
        && deliberationTurnFallback[0]?.content === 'ChatGPT full deliberation response from familyDeliberation.turns.',
      JSON.stringify(deliberationTurnFallback),
    ),
    check(
      'live_response_08_duplicate_contributions_insert_once',
      duplicateContributionRows.length === 1,
      JSON.stringify(duplicateContributionRows),
    ),
    check(
      'live_response_09_integrity_incomplete_fallback_not_usable',
      integrityIncompleteFallback === null,
      JSON.stringify(integrityIncompleteFallback),
    ),
    check(
      'live_response_10_integrity_incomplete_skipped_for_usable_sibling',
      integrityIncompleteAlongsideUsableSibling?.content === 'Claude produced a complete, integrity-validated council response.'
        && integrityIncompleteAlongsideUsableSibling.family === 'Claude',
      JSON.stringify(integrityIncompleteAlongsideUsableSibling),
    ),
    check(
      'live_response_11_integrity_incomplete_excluded_from_contributions',
      integrityIncompleteContributionExcluded.length === 1
        && integrityIncompleteContributionExcluded[0]?.family === 'Claude',
      JSON.stringify(integrityIncompleteContributionExcluded),
    ),
  ]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runLiveResponseExtractionValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Live Council response extraction validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
