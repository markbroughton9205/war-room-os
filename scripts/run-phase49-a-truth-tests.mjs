import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = path => readFileSync(join(root, path), 'utf8')

const signalRadar = read('components/war-room/signals/SignalRadarPanel.tsx')
const kpiGrid = read('components/war-room/KpiGrid.tsx')
const toolsFilesRoute = read('app/api/tools/files/route.ts')
const incomeSearchRoute = read('app/api/income/search/route.ts')
const gapFinder = read('components/war-room/operator/GapFinderPanel.tsx')
const deck = read('components/war-room/operator/OperatorCommandDeck.tsx')
const deckPersistence = read('lib/operator/deckPersistence.ts')
const osHeader = read('components/war-room/live-room/WarRoomOsHeader.tsx')

// Narrowly-scoped, source-level truth assertions not already covered by
// scripts/run-live-council-ui-fix-validation.mjs's operationalWiringCases block.
// Every case is a static string/slice check against real source — no live provider,
// no Supabase, no network call, no file mutation.

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  if (start === -1) throw new Error(`marker not found: ${startMarker}`)
  const end = endMarker ? source.indexOf(endMarker, start) : source.length
  if (endMarker && end === -1) throw new Error(`end marker not found: ${endMarker}`)
  return source.slice(start, end === -1 ? source.length : end)
}

const cases = [
  // 1. Loading must never be reported as the same state as a real, source-backed success.
  [
    'truth_01_signal_radar_loading_distinct_from_success',
    signalRadar.includes("state: loading ? 'loading' : 'not_loaded'")
      && signalRadar.includes("state: 'source_backed'")
      && signalRadar.indexOf("state: loading ? 'loading' : 'not_loaded'") < signalRadar.indexOf("state: 'source_backed'"),
  ],
  // 2. Degraded (partially working) must be a distinct state from both failure and success —
  // never folded into either.
  [
    'truth_02_signal_radar_degraded_states_distinct',
    ["state: 'error'", "state: 'migration_required'", "state: 'persistence_unavailable'", "state: 'sources_missing'", "state: 'no_results'", "state: 'source_backed'"]
      .every(literal => signalRadar.includes(literal)),
  ],
  // 3. Error state must be visibly rendered to the Commander, not swallowed into console-only
  // logging.
  [
    'truth_03_signal_radar_error_visible_not_swallowed',
    signalRadar.includes('{error ? <div') && signalRadar.includes('border-red-500/30') && signalRadar.includes('{error}</div>'),
  ],
  // 4. Stale data must stay a distinct, labeled bucket — never presented as an actionable/live
  // signal.
  [
    'truth_04_signal_radar_stale_data_labeled_not_actionable',
    signalRadar.includes('classificationBuckets.stale')
      && signalRadar.includes('no stale/unknown-date news as live opportunities'),
  ],
  // 5. KPI cards must not fabricate a count or numeric value — the legacy dashboard must not
  // import the mock KPI data source, and must say so.
  [
    'truth_05_kpi_grid_no_fabricated_counts',
    !kpiGrid.includes('MOCK_KPIS')
      && !kpiGrid.includes("from '@/lib/war-room/mock-kpis'")
      && kpiGrid.includes('does not display fabricated counts'),
  ],
  // 6. A failed/misconfigured tools route must return a real error status distinct from both its
  // "not yet configured" and "working" states — never a silent 200 with a placeholder body.
  [
    'truth_06_tools_files_route_error_distinct_from_success_and_config_needed',
    toolsFilesRoute.includes("status: 'error'")
      && toolsFilesRoute.includes("status: 'config_needed'")
      && toolsFilesRoute.includes("status: 'complete'")
      && toolsFilesRoute.includes('{ status: 503,')
      && toolsFilesRoute.includes('{ status: 500,'),
  ],
  // 7. Income web search must never return a generated/fallback opportunity when providers are
  // unconfigured or fail — only 'config_needed', 'found', 'no_results', or 'error'.
  [
    'truth_07_income_search_no_generated_fallback_opportunities',
    incomeSearchRoute.includes("status: 'config_needed'")
      && incomeSearchRoute.includes("status: result.opportunities.length ? 'found' : 'no_results'")
      && incomeSearchRoute.includes("status: 'error'")
      && incomeSearchRoute.includes('No fallback or generated opportunities'),
  ],
  // 8. Display-only Gap Finder issue list must not grant execution authority — it may show
  // real issues, but it must not render any button/action control.
  [
    'truth_08_gap_finder_active_issue_list_is_read_only',
    (() => {
      const section = sliceBetween(gapFinder, 'Active Issue List', 'SECTION_ORDER.map')
      return !section.includes('<button')
    })(),
  ],
  // 9. Unsupported packet actions (Modify/Reject/Archive) must be truthfully disabled with a
  // stated reason, and an already-approved/completed packet must not be re-approvable.
  [
    'truth_09_operator_packet_unsupported_and_completed_actions_disabled',
    deck.includes("disabled={loading || packet.status === 'approved' || packet.status === 'completed'}")
      && deck.includes('unsupportedPacketActionReason')
      && ['Modify', 'Reject', 'Archive'].every(label => deck.includes(`'${label}'`)),
  ],
  // 10. The only live operator-deck write path (approve_packet / approve_last_packet) must
  // perform no external action — no email, no payment call, no outbound fetch — only a Supabase
  // status update and an activity-log insert.
  [
    'truth_10_operator_approve_packet_performs_no_external_action',
    (() => {
      const block = sliceBetween(
        deckPersistence,
        "command.command === 'approve_last_packet' || command.command === 'approve_packet'",
        "command.command === 'manual_email_alert'",
      )
      const forbidden = ['sendEmail', 'stripe', 'Stripe', 'paymentProvider', "fetch('", 'fetch("', 'https://']
      return block.includes("supabase.client.from('war_room_operator_packets').update")
        && block.includes('insertActivity(')
        && forbidden.every(token => !block.includes(token))
    })(),
  ],
  // 11. The live-room header must not claim a resource-monitor reading ("Nominal") it never
  // connected — every resource line must name its missing dependency.
  [
    'truth_11_header_resource_status_no_fabricated_nominal_reading',
    !osHeader.includes('Nominal')
      && !osHeader.toLowerCase().includes('placeholder')
      && !osHeader.includes('CPU ·')
      && !osHeader.includes('Memory ·')
      && !osHeader.includes('Network ·')
      && osHeader.includes('System Health / Runtime Details'),
  ],
]

const failed = cases.filter(([, pass]) => !pass)
for (const [name, pass] of cases) {
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`)
}
console.log(`Phase 49-A truth tests: ${cases.length - failed.length}/${cases.length} PASS`)

if (failed.length) process.exit(1)
