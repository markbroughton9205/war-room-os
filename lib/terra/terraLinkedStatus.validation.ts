import { resolveTerraLinkedStatus, type TerraLinkedStatusSignal } from './terraLinkedStatus'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []

function expectLevel(name: string, signals: TerraLinkedStatusSignal[], expected: ReturnType<typeof resolveTerraLinkedStatus>['level']) {
  const actual = resolveTerraLinkedStatus(signals)
  results.push({ name, pass: actual.level === expected, detail: `expected ${expected}; received ${actual.level}; reasons=${actual.reasons.join(' | ') || '(none)'}` })
}

expectLevel('empty_results_are_neutral', [], 'NEUTRAL')
expectLevel('no_data_is_neutral', [{ kind: 'coverage', state: 'NO_DATA' }], 'NEUTRAL')
expectLevel('no_coverage_is_neutral', [{ kind: 'coverage', state: 'NO_COVERAGE' }], 'NEUTRAL')
expectLevel('unknown_is_neutral', [{ kind: 'coverage', state: 'UNKNOWN' }], 'NEUTRAL')
expectLevel('live_availability_alone_is_neutral', [{ kind: 'coverage', state: 'LIVE' }], 'NEUTRAL')
expectLevel('loading_is_neutral', [{ kind: 'coverage', state: 'LOADING' }], 'NEUTRAL')
expectLevel('stale_is_amber', [{ kind: 'coverage', state: 'STALE' }], 'AMBER')
expectLevel('offline_is_amber', [{ kind: 'coverage', state: 'OFFLINE' }], 'AMBER')
expectLevel('explicit_source_clear_is_green', [{ kind: 'source_status', status: 'cleared' }], 'GREEN')
expectLevel('explicit_source_healthy_is_green', [{ kind: 'source_status', status: 'HEALTHY' }], 'GREEN')
expectLevel('successful_http_like_text_is_not_green', [{ kind: 'source_status', status: '200 OK' }], 'NEUTRAL')
expectLevel('absence_language_is_not_green', [{ kind: 'source_status', status: 'no incidents' }], 'NEUTRAL')
expectLevel('red_overrides_positive_status', [
  { kind: 'source_status', status: 'operational' },
  { kind: 'traffic_event', severity: 'critical', isFullClosure: false },
], 'RED')
expectLevel('amber_overrides_positive_status', [
  { kind: 'source_status', status: 'normal' },
  { kind: 'camera_freshness', freshness: 'offline' },
], 'AMBER')

for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name}: ${result.detail}`)
if (results.some(result => !result.pass)) process.exitCode = 1
