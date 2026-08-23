import { extractUsStateArea, NWS_ALERTS_ENDPOINT, skippedWeatherAlertsLeg } from './nwsAlerts'
import { pathToFileURL } from 'node:url'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const skipped = skippedWeatherAlertsLeg()

export function runNwsAlertsValidation(): CaseResult[] {
  return [
    check(
      'nws_alerts_01_endpoint_is_active_alerts_not_dead_cap_us_php',
      NWS_ALERTS_ENDPOINT === 'https://api.weather.gov/alerts/active',
      NWS_ALERTS_ENDPOINT,
    ),
    check(
      'nws_alerts_02_state_name_maps_to_abbreviation',
      extractUsStateArea('any storm warnings for Florida today') === 'FL',
      String(extractUsStateArea('any storm warnings for Florida today')),
    ),
    check(
      'nws_alerts_03_bare_two_letter_abbreviation_recognized',
      extractUsStateArea('active alerts for CA') === 'CA',
      String(extractUsStateArea('active alerts for CA')),
    ),
    check(
      'nws_alerts_04_no_state_mentioned_returns_undefined',
      extractUsStateArea('what is the weather like') === undefined,
      String(extractUsStateArea('what is the weather like')),
    ),
    check(
      'nws_alerts_05_random_capitalized_word_not_mistaken_for_state',
      extractUsStateArea('is AI going to replace jobs') === undefined,
      String(extractUsStateArea('is AI going to replace jobs')),
    ),
    check(
      'nws_alerts_06_skipped_leg_is_ok_not_a_failure',
      skipped.ok === true && skipped.queried === false && skipped.results.length === 0,
      JSON.stringify(skipped),
    ),
  ]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runNwsAlertsValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`NWS alerts validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
