/**
 * Validation for lib/ui/matrixStatusBus.ts — runs under Node via
 * `node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/ui/matrixStatusBus.validation.ts`
 *
 * The bus is client-only; we fake `globalThis.window` so the publish path runs,
 * and exercise legacy-kind mapping, channel priority, throttle, and auto-idle.
 */

import {
  getMatrixStatusServerSnapshot,
  getMatrixStatusSnapshot,
  MATRIX_CHANNEL_PRIORITY,
  matrixChannelStatus,
  matrixStatus,
  matrixStatusIdle,
  resolveMatrixChannel,
  type MatrixChannel,
} from './matrixStatusBus'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []

function expect(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail })
}

// Fake a client environment before any publish call.
;(globalThis as Record<string, unknown>).window = {}

// Legacy kind → channel mapping
const legacyMap: Array<[Parameters<typeof matrixStatus>[0] | 'idle', MatrixChannel]> = [
  ['idle', 'green'],
  ['working', 'amber'],
  ['success', 'green'],
  ['warning', 'amber'],
  ['error', 'red'],
]
for (const [kind, channel] of legacyMap) {
  expect(
    `legacy_${kind}_maps_to_${channel}`,
    resolveMatrixChannel(kind) === channel,
    `expected ${channel}; received ${resolveMatrixChannel(kind)}`,
  )
}

// Channel kinds resolve to themselves
for (const channel of ['cyan', 'violet', 'amber', 'green', 'red', 'white'] as const) {
  expect(
    `channel_${channel}_resolves_to_itself`,
    resolveMatrixChannel(channel) === channel,
    `expected ${channel}; received ${resolveMatrixChannel(channel)}`,
  )
}

// Priority ordering: red > white > violet == cyan > amber > green
const p = MATRIX_CHANNEL_PRIORITY
const orderingPass = p.red > p.white && p.white > p.violet && p.violet === p.cyan && p.cyan > p.amber && p.amber > p.green
expect(
  'priority_ordering_red_white_violet_cyan_amber_green',
  orderingPass,
  `red=${p.red} white=${p.white} violet=${p.violet} cyan=${p.cyan} amber=${p.amber} green=${p.green}`,
)

// SSR snapshot is the stable frozen idle baseline
expect(
  'server_snapshot_is_idle_green_baseline',
  getMatrixStatusServerSnapshot().kind === 'idle' && getMatrixStatusServerSnapshot().channel === 'green',
  `kind=${getMatrixStatusServerSnapshot().kind} channel=${getMatrixStatusServerSnapshot().channel}`,
)

// Legacy publish path: working → amber
matrixStatus('working', 'legacy working probe')
expect(
  'legacy_working_publishes_amber_channel',
  getMatrixStatusSnapshot().channel === 'amber' && getMatrixStatusSnapshot().kind === 'working',
  `channel=${getMatrixStatusSnapshot().channel} kind=${getMatrixStatusSnapshot().kind}`,
)

// Throttle drops same-or-lower priority inside the window (amber→amber)
matrixStatus('warning', 'should be throttled away')
expect(
  'throttle_drops_equal_priority_within_window',
  getMatrixStatusSnapshot().message === 'legacy working probe',
  `message=${getMatrixStatusSnapshot().message}`,
)

// Higher priority breaks through the throttle (amber→cyan)
matrixChannelStatus('cyan', 'intel inflow probe')
expect(
  'higher_priority_cyan_breaks_throttle_over_amber',
  getMatrixStatusSnapshot().channel === 'cyan' && getMatrixStatusSnapshot().message === 'intel inflow probe',
  `channel=${getMatrixStatusSnapshot().channel} message=${getMatrixStatusSnapshot().message}`,
)

// White outranks cyan inside the throttle window
matrixChannelStatus('white', 'verified completion probe')
expect(
  'white_outranks_cyan_within_throttle',
  getMatrixStatusSnapshot().channel === 'white',
  `channel=${getMatrixStatusSnapshot().channel}`,
)

// Red always breaks through, even against equal/higher current state
matrixChannelStatus('red', 'critical failure probe')
expect(
  'red_always_breaks_throttle',
  getMatrixStatusSnapshot().channel === 'red' && getMatrixStatusSnapshot().message === 'critical failure probe',
  `channel=${getMatrixStatusSnapshot().channel}`,
)

// Empty / whitespace messages are ignored
const beforeEmpty = getMatrixStatusSnapshot().tick
matrixChannelStatus('cyan', '   ')
expect(
  'blank_message_is_ignored',
  getMatrixStatusSnapshot().tick === beforeEmpty,
  `tick moved ${beforeEmpty} → ${getMatrixStatusSnapshot().tick}`,
)

// Emissions carry a client timestamp for flash-decay rendering
expect(
  'emission_records_emittedAtMs',
  getMatrixStatusSnapshot().emittedAtMs > 0,
  `emittedAtMs=${getMatrixStatusSnapshot().emittedAtMs}`,
)

// Auto-idle: violet auto-idles after 900ms → green baseline
matrixStatusIdle()
matrixChannelStatus('violet', 'outbound query probe')
await new Promise(resolve => setTimeout(resolve, 1_100))
expect(
  'violet_auto_idles_to_green_baseline',
  getMatrixStatusSnapshot().kind === 'idle' && getMatrixStatusSnapshot().channel === 'green',
  `kind=${getMatrixStatusSnapshot().kind} channel=${getMatrixStatusSnapshot().channel}`,
)

for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name}: ${result.detail}`)
if (results.some(result => !result.pass)) process.exitCode = 1
