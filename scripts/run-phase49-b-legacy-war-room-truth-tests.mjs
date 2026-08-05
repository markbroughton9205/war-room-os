import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Phase 49-B-1 — Legacy /war-room route truthfulness.
// Pure static source assertions: no live provider, no Supabase, no network
// call, no file mutation. Mirrors scripts/run-phase49-a-truth-tests.mjs.

const root = process.cwd()
const read = path => readFileSync(join(root, path), 'utf8')

const page = read('app/(dashboard)/war-room/page.tsx')
const disclosure = read('components/war-room/LegacyRouteDisclosure.tsx')
const statusBar = read('components/war-room/StatusBar.tsx')
const sidebar = read('components/war-room/Sidebar.tsx')
const commandBar = read('components/war-room/CommandBar.tsx')
const councilTable = read('components/war-room/council/CouncilTable.tsx')
const familySeat = read('components/war-room/council/FamilySeat.tsx')
const sentinel = read('components/war-room/council/SentinelStatusPanel.tsx')
const babyObserver = read('components/war-room/council/BabyObserverNode.tsx')
const lazyPanels = read('components/war-room/WarRoomLazyPanels.tsx')

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  if (start === -1) throw new Error(`marker not found: ${startMarker}`)
  const end = endMarker ? source.indexOf(endMarker, start) : source.length
  if (endMarker && end === -1) throw new Error(`end marker not found: ${endMarker}`)
  return source.slice(start, end === -1 ? source.length : end)
}

const statusStyleBlock = sliceBetween(familySeat, 'const STATUS_STYLES', 'const SUB_AGENT_STYLES')

const cases = [
  // 1. The disclosure banner is rendered by the route, before any panel, so it is
  // visible immediately when the route loads.
  [
    'legacy_01_disclosure_rendered_first_on_route',
    page.includes("import { LegacyRouteDisclosure } from '@/components/war-room/LegacyRouteDisclosure'")
      && page.indexOf('<LegacyRouteDisclosure />') !== -1
      && page.indexOf('<LegacyRouteDisclosure />') < page.indexOf('<Phase3WarRoomPanels />')
      && page.indexOf('<LegacyRouteDisclosure />') < page.indexOf('<KpiGrid />'),
  ],
  // 2. The disclosure identifies the content as simulated/placeholder and legacy.
  [
    'legacy_02_disclosure_identifies_simulated_content',
    disclosure.includes('Legacy demo route')
      && disclosure.includes('simulated placeholder data')
      && disclosure.includes('data-testid="legacy-route-disclosure"'),
  ],
  // 3. The disclosure scopes the "not connected" claim to the named legacy sections
  // (Council seating, Sentinel metrics, Baby Observer) — it must not claim the whole
  // page is disconnected, and it must acknowledge other panels may use real backend data.
  [
    'legacy_03_disclosure_scoped_to_named_legacy_sections',
    ['Council seating', 'Sentinel metrics', 'Baby Observer'].every(section => disclosure.includes(section))
      && disclosure.includes('not connected to live providers or execution')
      && !disclosure.includes('This page is not connected to live providers or execution')
      && disclosure.includes('may use real backend data'),
  ],
  // 4. The disclosure provides direct navigation to the canonical Live Council (`/`).
  [
    'legacy_04_disclosure_links_to_canonical_live_council',
    disclosure.includes('href="/"') && disclosure.includes('Live Council'),
  ],
  // 5. Mock council seating must not present itself as live provider output.
  [
    'legacy_05_council_table_labeled_simulated_not_live',
    councilTable.includes('Simulated placeholder seating — not live provider output')
      && !councilTable.includes('>sync<'),
  ],
  // 6. Every family status badge is prefixed "Simulated" — mock states must not use
  // bare live/success language (Executing, Complete, Reviewing...) as if real.
  [
    'legacy_06_family_status_badges_prefixed_simulated',
    ['idle', 'standby', 'thinking', 'executing', 'reviewing', 'blocked', 'complete']
      .every(status => statusStyleBlock.includes(`label: 'Simulated ${status}'`)),
  ],
  // 7. No green/healthy/success styling remains on fabricated family states or
  // sub-agent dots, and the fabricated "active" pulse animation is gone.
  [
    'legacy_07_no_green_or_pulsing_fabricated_states',
    !familySeat.includes('animate-pulse')
      && !statusStyleBlock.includes('#00ff41')
      && !sliceBetween(familySeat, 'const SUB_AGENT_STYLES', 'const NODE_POSITIONS').includes('#00ff41')
      && familySeat.includes('Simulated sub-agent states — not live'),
  ],
  // 8. Sentinel mock metrics are suffixed "sim" and carry no green "nominal"
  // healthy-state coloring.
  [
    'legacy_08_sentinel_metrics_marked_sim_no_green_health',
    sentinel.includes('{value} · sim')
      && !sliceBetween(sentinel, 'const STATE_BADGE', 'const ROWS').includes('#00ff41'),
  ],
  // 9. Baby observer mock metrics carry an immediate simulated-data disclosure.
  [
    'legacy_09_baby_observer_disclosure_present',
    babyObserver.includes('Simulated placeholder metrics — not live observation'),
  ],
  // 10. Status bar must not show an unevidenced green "Secure" indicator or claim
  // the route is "truth-labeled" while mock data renders on it.
  [
    'legacy_10_status_bar_no_fake_secure_or_truth_claims',
    !statusBar.includes('Secure')
      && !statusBar.includes('bg-[#22c55e]')
      && !statusBar.includes('truth-labeled')
      && statusBar.includes('Legacy demo route')
      && statusBar.includes('simulated placeholder'),
  ],
  // 11. Sidebar nav buttons had no backend or navigation action — they must be
  // disabled and truthfully labeled, not presented as functional controls.
  [
    'legacy_11_sidebar_dead_nav_disabled_and_labeled',
    sidebar.includes('disabled')
      && sidebar.includes('section navigation is not connected on this legacy route')
      && sidebar.includes('Legacy demo route'),
  ],
  // 12. The command palette stays read-only with an honest "not connected" label —
  // it must not regress to an apparently functional input.
  [
    'legacy_12_command_bar_remains_truthfully_inert',
    commandBar.includes('readOnly') && commandBar.includes('not connected on this legacy route'),
  ],
  // 13. The council section header on the route states the data is simulated and
  // names its mock source.
  [
    'legacy_13_council_section_header_names_mock_source',
    lazyPanels.includes('simulated placeholder data') && lazyPanels.includes('lib/mockCouncilData.ts'),
  ],
  // 14. Page metadata must not present the route as the live command surface.
  [
    'legacy_14_metadata_marks_route_legacy_demo',
    page.includes('Legacy Demo Dashboard') && !page.includes("title: 'War Room OS — Command'"),
  ],
]

let failed = 0
for (const [name, ok] of cases) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) failed += 1
}

console.log(`\nPhase 49-B-1 legacy /war-room truth tests: ${cases.length - failed}/${cases.length} passed`)
if (failed > 0) process.exit(1)
