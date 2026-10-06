/**
 * Run:
 * node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/flightIntelligence/flightIntelligence.validation.ts
 */
import { observationFromAdsbAircraft, parseAdsbFeed } from './adapters'
import { classifyAircraftType } from './classification'
import { federateAircraftObservations } from './federation'
import { godsEyeAircraftIdentity, godsEyeAircraftSections } from './godsEye'
import { resolveAircraftIdentity } from './identity'
import { flightAlerts, classifyFlightSearch } from './monitor'
import { flightTruthToFeature } from './project'
import { selectPrimaryObservation } from './quality'
import { blankObservation } from './adapters'
import type { AircraftProviderObservation } from './types'

function check(name: string, pass: boolean, detail: string) {
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${detail}`)
  return pass
}

function obs(partial: Partial<AircraftProviderObservation> & Pick<AircraftProviderObservation, 'provider'>): AircraftProviderObservation {
  return { ...blankObservation(partial.provider, '2026-09-24T00:00:00.000Z'), ...partial }
}

const now = Date.parse('2026-09-24T00:00:10.000Z')

function run() {
  const results: boolean[] = []
  const adsb = obs({ provider: 'adsb_exchange', icaoHex: 'ae1460', callsign: 'SAME', lat: 40, lon: -80, positionSource: 'ADS-B', positionAgeSec: 1, nic: 9, rc: 75, receivedAt: '2026-09-24T00:00:09.000Z' })
  const live = obs({ provider: 'airplanes_live', icaoHex: 'ae1460', callsign: 'SAME', lat: 40.01, lon: -80.01, positionSource: 'ADS-B', positionAgeSec: 2, nic: 8, receivedAt: '2026-09-24T00:00:08.000Z' })
  const other = obs({ provider: 'opensky', icaoHex: 'abc123', callsign: 'SAME', lat: 41, lon: -81, positionAgeSec: 3, receivedAt: '2026-09-24T00:00:07.000Z' })
  const federated = federateAircraftObservations([adsb, live, other], now)
  results.push(check('same_icao_one_identity', federated.length === 2 && federated.filter(item => item.identity.icaoHex === 'ae1460').length === 1, String(federated.length)))
  results.push(check('same_callsign_different_icao', federated.filter(item => item.primary?.callsign === 'SAME').length === 2, 'two aircraft'))
  const missing = obs({ provider: 'airplanes_live', icaoHex: null, providerAircraftId: 'stable-1', registration: null, lat: 1, lon: 2 })
  results.push(check('missing_icao_fallback', resolveAircraftIdentity(missing).basis === 'provider_aircraft_id', resolveAircraftIdentity(missing).key))

  const fresh = obs({ provider: 'opensky', icaoHex: 'aaaaaa', lat: 1, lon: 2, positionSource: 'ADS-B', positionAgeSec: 2 })
  const stale = obs({ provider: 'adsb_exchange', icaoHex: 'aaaaaa', lat: 9, lon: 9, positionSource: 'ADS-B', positionAgeSec: 400 })
  const selected = selectPrimaryObservation([stale, fresh], now)
  results.push(check('fresh_adsb_over_stale', selected.primary?.provider === 'opensky' && selected.primary.lat === 1, selected.reason))

  const mlat = obs({ provider: 'airplanes_live', icaoHex: 'bbbbbb', lat: 3, lon: 4, positionSource: 'MLAT', positionAgeSec: 4 })
  const oldAdsb = obs({ provider: 'adsb_exchange', icaoHex: 'bbbbbb', lat: 8, lon: 8, positionSource: 'ADS-B', positionAgeSec: 500 })
  results.push(check('fresh_mlat_over_stale_adsb', selectPrimaryObservation([oldAdsb, mlat], now).primary?.positionSource === 'MLAT', 'mlat'))

  const invalid = obs({ provider: 'opensky', icaoHex: 'cccccc', lat: 400, lon: 1, positionSource: 'ADS-B', positionAgeSec: 1 })
  const valid = obs({ provider: 'airplanes_live', icaoHex: 'cccccc', lat: 10, lon: 10, positionSource: 'MLAT', positionAgeSec: 20 })
  results.push(check('invalid_coordinates', selectPrimaryObservation([invalid, valid], now).primary?.lat === 10, 'valid only'))

  const positionless = obs({ provider: 'opensky', icaoHex: 'dddddd', lat: null, lon: null, positionSource: 'MODE-S' })
  const positioned = obs({ provider: 'adsb_exchange', icaoHex: 'dddddd', lat: 5, lon: 5, positionSource: 'ADS-B', positionAgeSec: 30 })
  results.push(check('positionless_not_primary', selectPrimaryObservation([positionless, positioned], now).primary?.lat === 5, 'positioned'))

  const missingQuality = [
    obs({ provider: 'opensky', icaoHex: 'eeeeee', lat: 1, lon: 1, positionSource: 'UNKNOWN', positionAgeSec: 5, nic: null }),
    obs({ provider: 'airplanes_live', icaoHex: 'eeeeee', lat: 2, lon: 2, positionSource: 'UNKNOWN', positionAgeSec: 5, nic: null }),
  ]
  const tie = selectPrimaryObservation(missingQuality, now)
  results.push(check('missing_quality_deterministic', tie.primary?.provider === 'airplanes_live', tie.primary?.provider ?? 'none'))

  results.push(check('e6b_classification', classifyAircraftType('E6').id === 'e6b_mercury' && classifyAircraftType('E6').classes.includes('STRATEGIC') && classifyAircraftType('E6').missionInferred === false, classifyAircraftType('E6').id ?? 'none'))

  const e6 = observationFromAdsbAircraft('airplanes_live', { hex: 'ae1461', t: 'E6', flight: 'EVAL', lat: 39, lon: -77, type: 'adsb_icao', alt_baro: 28000, gs: 450, track: 90, seen_pos: 1, nic: 9 }, '2026-09-24T00:00:10.000Z', 1_000_000)
  const e6Truth = federateAircraftObservations(e6 ? [e6] : [], now)[0]
  const e6Feature = e6Truth ? flightTruthToFeature(e6Truth) : null
  results.push(check('e6_general_path', e6Feature?.kind === 'aircraft_state' && e6Truth.classification.id === 'e6b_mercury' && godsEyeAircraftIdentity(e6Feature) === e6Feature?.id, e6Truth?.classification.id ?? 'none'))
  const sections = godsEyeAircraftSections(e6Truth)
  results.push(check('gods_eye_same_identity', sections.IDENTITY?.some(field => field.value === e6Feature?.id) === true, e6Feature?.id ?? 'none'))

  const lost = federateAircraftObservations([], now)
  results.push(check('provider_loss_keeps_identity_function', godsEyeAircraftIdentity(e6Feature) === 'ae1461' && lost.length === 0, 'loss isolated'))

  const updated = e6 ? federateAircraftObservations([{ ...e6, lat: 39.1, positionAgeSec: 2 }], now)[0] : null
  const updatedFeature = updated ? flightTruthToFeature(updated) : null
  results.push(check('gods_eye_refresh_same_key', godsEyeAircraftIdentity(updatedFeature) === godsEyeAircraftIdentity(e6Feature), updatedFeature?.id ?? 'none'))

  results.push(check('auth_required_distinct', parseAdsbFeed('adsb_exchange', '{', '2026-09-24T00:00:00.000Z').state.state === 'PROVIDER_UNAVAILABLE', 'bad json'))
  results.push(check('search_types', classifyFlightSearch('ae1460')?.kind === 'AIRCRAFT' && classifyFlightSearch('type E6')?.kind === 'AIRCRAFT_TYPE' && classifyFlightSearch('Austin') === null, 'typed'))
  const visible = flightAlerts([], e6Truth ? [e6Truth] : [])
  const again = flightAlerts(e6Truth ? [{ ...e6Truth, watched: true }] : [], e6Truth ? [{ ...e6Truth, watched: true, freshness: 'LIVE' }] : [])
  results.push(check('alerts_not_on_refresh', visible.length === 0 && again.length === 0, String(again.length)))

  const failed = results.filter(item => !item).length
  console.log(`Terra flight intelligence validation: ${results.length - failed}/${results.length} PASS`)
  if (failed) process.exit(1)
}

run()
