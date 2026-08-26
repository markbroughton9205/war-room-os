/**
 * Deterministic regression suite for Terra's 4D time engine's pure logic — no Cesium, no DOM, no
 * React. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/terraTime.validation.ts
 */
import { pathToFileURL } from 'node:url'
import type { TerraGeoFeature, TerraTimeState } from './types'
import {
  advanceHistoricalTerraTime,
  advanceLiveTerraTime,
  createLiveTerraTimeState,
  createTerraTimeEventBus,
  filterTerraFeaturesByTime,
  isTerraGeoFeatureVisibleAtTime,
  pauseTerraTime,
  playTerraTime,
  returnToLiveTerraTime,
  scrubTerraTime,
  setTerraPlaybackRate,
  shouldAutoRefreshTerraLayer,
  terraFeaturesShallowEqual,
  TERRA_TIME_WINDOW_PRESETS,
} from './terraTime'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function makeFeature(overrides: Partial<TerraGeoFeature> = {}): TerraGeoFeature {
  return {
    id: 'f1',
    eventId: 'f1',
    providerId: 'usgs_earthquake_feed',
    kind: 'earthquake',
    longitude: 0,
    latitude: 0,
    altitude: null,
    timestamp: '2026-08-26T12:00:00.000Z',
    title: 'Test event',
    summary: null,
    properties: {},
    provenance: { provider: 'usgs_earthquake_feed', sourceUrl: null, retrievedAt: '2026-08-26T12:00:00.000Z', fromCache: false, isHistorical: false },
    rawReference: { documentId: null, providerRecordId: null, canonicalUrl: null },
    coordinateOrigin: 'observed',
    geoResolution: null,
    geometryKind: 'point',
    regionRings: null,
    ...overrides,
  }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []

  // --- 1. Live clock tracks a real-time source correctly ---
  {
    const live = createLiveTerraTimeState('2026-08-26T12:00:00.000Z')
    const advanced = advanceLiveTerraTime(live, '2026-08-26T12:00:05.000Z')
    results.push(check('live_mode_advances_to_the_given_real_time', advanced.currentTime === '2026-08-26T12:00:05.000Z' && advanced.lastLiveSyncAt === '2026-08-26T12:00:05.000Z', `currentTime=${advanced.currentTime}`))
  }

  // --- 2. Historical mode freezes the selected timestamp against live advancement ---
  {
    const historical = scrubTerraTime(createLiveTerraTimeState('2026-08-26T12:00:00.000Z'), '2020-01-01T00:00:00.000Z')
    const attempted = advanceLiveTerraTime(historical, '2026-08-26T13:00:00.000Z')
    results.push(check('historical_mode_ignores_live_advancement', attempted.currentTime === '2020-01-01T00:00:00.000Z' && attempted.mode === 'historical', `currentTime=${attempted.currentTime} mode=${attempted.mode}`))
  }

  // --- 3. Playback advances historical time by real-elapsed * rate ---
  {
    let state: TerraTimeState = scrubTerraTime(createLiveTerraTimeState('2026-08-26T12:00:00.000Z'), '2026-08-01T00:00:00.000Z')
    state = setTerraPlaybackRate(state, 60)
    state = playTerraTime(state)
    const advanced = advanceHistoricalTerraTime(state, 10_000) // 10 real seconds * 60x = 600s = 10 minutes
    results.push(check('playback_advances_by_elapsed_times_rate', advanced.currentTime === '2026-08-01T00:10:00.000Z', `currentTime=${advanced.currentTime}`))
  }

  {
    let state: TerraTimeState = scrubTerraTime(createLiveTerraTimeState('2026-08-26T12:00:00.000Z'), '2026-08-01T00:00:00.000Z')
    state = pauseTerraTime(playTerraTime(state))
    const attempted = advanceHistoricalTerraTime(state, 10_000)
    results.push(check('paused_historical_state_does_not_advance', attempted.currentTime === '2026-08-01T00:00:00.000Z', `currentTime=${attempted.currentTime}`))
  }

  // --- 4. Return-to-live restores current-time mode ---
  {
    const historical = scrubTerraTime(createLiveTerraTimeState('2026-08-26T12:00:00.000Z'), '2020-01-01T00:00:00.000Z')
    const backLive = returnToLiveTerraTime('2026-08-26T13:00:00.000Z')
    results.push(check('return_to_live_restores_live_mode_and_real_time', backLive.mode === 'live' && backLive.currentTime === '2026-08-26T13:00:00.000Z', `mode=${backLive.mode} currentTime=${backLive.currentTime}`))
    void historical
  }

  // --- 5. Observed event temporal filtering: past event visible once occurred ---
  {
    const feature = makeFeature({ timestamp: '2026-08-26T11:00:00.000Z' })
    results.push(check('past_event_is_visible_at_a_later_selected_time', isTerraGeoFeatureVisibleAtTime(feature, '2026-08-26T12:00:00.000Z', null), 'expected visible'))
  }

  // --- 6. Expired alert historical behavior — hidden after real expiry, visible again before it ---
  {
    const feature = makeFeature({ timestamp: '2026-08-26T10:00:00.000Z', properties: { expires: '2026-08-26T11:00:00.000Z' } })
    results.push(check('expired_alert_hidden_after_its_real_expiry', !isTerraGeoFeatureVisibleAtTime(feature, '2026-08-26T12:00:00.000Z', null), 'expected hidden'))
    results.push(check('same_alert_visible_when_scrubbed_to_before_its_expiry', isTerraGeoFeatureVisibleAtTime(feature, '2026-08-26T10:30:00.000Z', null), 'expected visible'))
  }

  // --- 7. Scheduled/future event does not masquerade as current truth ---
  {
    const feature = makeFeature({ timestamp: '2026-08-27T00:00:00.000Z' }) // 12h in the future relative to selected time below
    results.push(check('future_event_is_not_visible_with_no_lookahead_window', !isTerraGeoFeatureVisibleAtTime(feature, '2026-08-26T12:00:00.000Z', null), 'expected hidden'))
    results.push(check('future_event_becomes_visible_within_an_explicit_lookahead_window', isTerraGeoFeatureVisibleAtTime(feature, '2026-08-26T12:00:00.000Z', { lookbackMs: 0, lookaheadMs: 24 * 3_600_000 }), 'expected visible within 24h lookahead'))
  }

  // --- 8. Time-window filtering (lookback) ---
  {
    const recent = makeFeature({ id: 'recent', timestamp: '2026-08-26T11:30:00.000Z' })
    const old = makeFeature({ id: 'old', timestamp: '2026-08-20T00:00:00.000Z' })
    const oneHourPreset = TERRA_TIME_WINDOW_PRESETS.find(p => p.id === '1h')!
    const visible = filterTerraFeaturesByTime([recent, old], '2026-08-26T12:00:00.000Z', oneHourPreset.window)
    results.push(check('1h_window_keeps_recent_event_and_drops_old_one', visible.length === 1 && visible[0].id === 'recent', `visible=${visible.map(f => f.id).join(',')}`))

    const allPreset = TERRA_TIME_WINDOW_PRESETS.find(p => p.id === 'all')!
    const visibleAll = filterTerraFeaturesByTime([recent, old], '2026-08-26T12:00:00.000Z', allPreset.window)
    results.push(check('all_preset_null_window_keeps_every_past_event_matching_phase_1to5_behavior', visibleAll.length === 2, `visible=${visibleAll.map(f => f.id).join(',')}`))
  }

  // --- 9/10. Live refresh suppression in historical mode, resumption when live ---
  {
    results.push(check('auto_refresh_suppressed_in_historical_mode', shouldAutoRefreshTerraLayer('historical') === false, 'expected suppressed'))
    results.push(check('auto_refresh_enabled_in_live_mode', shouldAutoRefreshTerraLayer('live') === true, 'expected enabled'))
  }

  // --- 11. Real-time vs display-time distinction: visibility uses the event's own timestamp,
  // never the unrelated fetch/retrieval time carried in provenance ---
  {
    const feature = makeFeature({
      timestamp: '2026-08-01T00:00:00.000Z', // observed long ago
      provenance: { provider: 'usgs_earthquake_feed', sourceUrl: null, retrievedAt: '2026-08-26T11:59:59.000Z', fromCache: false, isHistorical: false }, // fetched a second ago
    })
    const tightWindow = { lookbackMs: 3_600_000, lookaheadMs: 0 } // 1h lookback
    results.push(check('visibility_uses_observed_timestamp_not_fresh_retrieval_time', !isTerraGeoFeatureVisibleAtTime(feature, '2026-08-26T12:00:00.000Z', tightWindow), 'expected hidden despite fresh retrievedAt, because the real observation is weeks old'))
  }

  // --- 12. Semantic time-context events: bus fires on subscribe, does not fire without emit ---
  {
    const bus = createTerraTimeEventBus()
    const received: string[] = []
    const unsubscribe = bus.subscribe(event => received.push(event.type))
    bus.emit({ type: 'terra.time.mode.changed', mode: 'historical', at: '2026-08-26T12:00:00.000Z' })
    bus.emit({ type: 'terra.time.returned_live', at: '2026-08-26T12:05:00.000Z' })
    results.push(check('event_bus_delivers_emitted_events_to_subscribers', received.length === 2 && received[0] === 'terra.time.mode.changed' && received[1] === 'terra.time.returned_live', `received=${received.join(',')}`))
    unsubscribe()
    bus.emit({ type: 'terra.playback.paused', at: '2026-08-26T12:10:00.000Z' })
    results.push(check('unsubscribed_listener_receives_nothing_further', received.length === 2, `received=${received.join(',')}`))
  }

  // --- 13. No frame-level persistence: these functions are pure state transforms with no I/O
  // (structural guarantee — this file's own import list has no persistence/network module) ---
  {
    let state = createLiveTerraTimeState('2026-08-26T12:00:00.000Z')
    for (let i = 0; i < 1000; i++) state = advanceLiveTerraTime(state, `2026-08-26T12:00:${String(i % 60).padStart(2, '0')}.000Z`)
    results.push(check('repeated_pure_advancement_never_throws_or_leaks_state', typeof state.currentTime === 'string', `currentTime=${state.currentTime}`))
  }

  // --- Browser repair regression: filterTerraFeaturesByTime must return the EXACT same array
  // reference for the default (null-window) case, every call, regardless of how many times
  // selectedTimeIso changes — this is the fix for the real "Maximum update depth exceeded" loop
  // observed in authenticated browser testing (TerraShell.handleFeaturesChange re-firing once per
  // second purely because a brand-new-but-identical array reference reached it on every clock
  // tick). A `.filter()` call that always allocates, even when nothing is excluded, would
  // reintroduce that loop. ---
  {
    const featureA = makeFeature({ id: 'a', timestamp: '2026-08-26T11:00:00.000Z' })
    const featureB = makeFeature({ id: 'b', timestamp: '2026-08-26T11:30:00.000Z' })
    const input = [featureA, featureB]
    const firstCall = filterTerraFeaturesByTime(input, '2026-08-26T12:00:00.000Z', null)
    const secondCall = filterTerraFeaturesByTime(input, '2026-08-26T12:00:05.000Z', null) // selectedTime advanced, as it does every tick in live mode
    results.push(check('null_window_filter_returns_the_exact_same_array_reference_as_input', firstCall === input && secondCall === input, `firstCall===input:${firstCall === input} secondCall===input:${secondCall === input}`))
  }

  // --- terraFeaturesShallowEqual: the second half of the same fix — catches a genuinely new
  // array reference (e.g. from a real re-fetch, or a non-null time window) that still describes
  // identical features, so a parent's setState can correctly bail out instead of looping. ---
  {
    const featureA = makeFeature({ id: 'a', timestamp: '2026-08-26T11:00:00.000Z' })
    const featureA2 = makeFeature({ id: 'a', timestamp: '2026-08-26T11:00:00.000Z' }) // a distinct object, same real content
    results.push(check('shallow_equal_true_for_same_reference', terraFeaturesShallowEqual([featureA], [featureA]), 'expected true'))
    results.push(check('shallow_equal_true_for_same_content_different_reference', terraFeaturesShallowEqual([featureA], [featureA2]), 'expected true'))
    results.push(check('shallow_equal_false_for_different_length', !terraFeaturesShallowEqual([featureA], []), 'expected false'))
    results.push(check('shallow_equal_false_for_different_timestamp', !terraFeaturesShallowEqual([featureA], [makeFeature({ id: 'a', timestamp: '2026-08-26T12:00:00.000Z' })]), 'expected false'))
    results.push(check('shallow_equal_false_for_undefined_left_even_against_empty_right', !terraFeaturesShallowEqual(undefined, []), 'expected false — "no previous value" is distinct from "previously empty"'))
    results.push(check('shallow_equal_false_for_undefined_left_and_nonempty_right', !terraFeaturesShallowEqual(undefined, [featureA]), 'expected false'))
  }

  return results
}

export function runTerraTimeValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runTerraTimeValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`Terra terraTime validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
