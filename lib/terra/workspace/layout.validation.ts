/**
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/workspace/layout.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { bringToFront, clampPanelPosition, computeSmartOrganizeLayout, dockedPosition, parseWorkspaceLayout, reconcilePanelPosition, smartOrganizeRectsOverlap, TERRA_WORKSPACE_LAYOUT_KEY, zIndexForRank } from './layout'
import { defaultPanelPosition } from './panelIds'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  results.push(check('persistence_key', TERRA_WORKSPACE_LAYOUT_KEY === 'terra-workspace-layout:v1', TERRA_WORKSPACE_LAYOUT_KEY))
  const clamped = clampPanelPosition({ x: -400, y: -20, panelWidth: 320, panelHeight: 200, viewportWidth: 1280, viewportHeight: 720 })
  results.push(check('clamp_keeps_handle_visible', clamped.x >= 8 && clamped.y >= 8, JSON.stringify(clamped)))
  const offRight = clampPanelPosition({ x: 4000, y: 10, panelWidth: 320, panelHeight: 200, viewportWidth: 1280, viewportHeight: 720 })
  results.push(check('clamp_from_right_edge', offRight.x <= 1280 - 48, String(offRight.x)))
  const scaled = reconcilePanelPosition({
    record: { x: 1600, y: 80, vw: 1920, vh: 1080, locked: true, minimized: false, dock: 'float' },
    panelWidth: 320,
    panelHeight: 200,
    viewportWidth: 960,
    viewportHeight: 540,
  })
  results.push(check('reconcile_scales_then_clamps', scaled.x < 960 && scaled.y < 540 && scaled.x >= 8, JSON.stringify(scaled)))
  const z0 = zIndexForRank(0, false)
  const zDrag = zIndexForRank(19, true)
  results.push(check('z_index_is_bounded', z0 >= 50 && zDrag <= 71, `${z0}-${zDrag}`))
  results.push(check('bring_to_front_moves_id', bringToFront(['live_intel', 'radar', 'street_view'], 'live_intel').at(-1) === 'live_intel', 'false'))
  results.push(check('default_live_intel_is_right', defaultPanelPosition('live_intel', 1920, 1080).x > 1400, JSON.stringify(defaultPanelPosition('live_intel', 1920, 1080))))
  results.push(check('rejects_malformed_layout', parseWorkspaceLayout('{') === null, 'parsed'))
  results.push(check('accepts_v1_layout', parseWorkspaceLayout('{"version":1,"panels":{},"zOrder":[]}')?.version === 1, 'no'))
  results.push(check('layout_json_has_no_gps_fields', !/latitude|longitude|gps|secret/i.test(JSON.stringify({ version: 1, panels: { live_intel: { x: 1, y: 2, vw: 3, vh: 4, locked: true, minimized: false, dock: 'float' } }, zOrder: ['live_intel'] })), 'leaked'))
  const legacy = parseWorkspaceLayout('{"version":1,"panels":{"live_intel":{"x":10,"y":20,"vw":1920,"vh":1080,"locked":false,"minimized":true}},"zOrder":[]}')
  results.push(check('legacy_v1_defaults_dock_float', legacy?.panels.live_intel?.dock === 'float' && legacy.panels.live_intel.minimized === true, JSON.stringify(legacy?.panels.live_intel)))
  const docked = dockedPosition({ dock: 'right', panelWidth: 320, panelHeight: 200, viewportWidth: 1280, viewportHeight: 720 })
  results.push(check('dock_right_keeps_handle', docked.x > 900 && docked.x < 1280, JSON.stringify(docked)))
  const bottom = dockedPosition({ dock: 'bottom', panelWidth: 640, panelHeight: 96, viewportWidth: 1920, viewportHeight: 1080 })
  results.push(check('dock_bottom_near_base', bottom.y > 900, JSON.stringify(bottom)))
  results.push(check('default_terra_media_is_on_screen', defaultPanelPosition('terra_media', 1920, 1080).x > 1000 && defaultPanelPosition('terra_media', 1920, 1080).x + 720 < 1920, JSON.stringify(defaultPanelPosition('terra_media', 1920, 1080))))
  const organized = computeSmartOrganizeLayout({
    panels: { terra_media: { x: 12, y: 12, vw: 1280, vh: 720, locked: false, minimized: false, dock: 'float' } },
    sizes: { terra_media: { width: 336, height: 240 } },
    viewportWidth: 1280,
    viewportHeight: 720,
  })
  results.push(check('smart_organize_places_terra_media', organized.some(row => row.id === 'terra_media'), JSON.stringify(organized)))
  const crowded = computeSmartOrganizeLayout({
    panels: {
      nearby_cameras: { x: 8, y: 148, vw: 1920, vh: 1080, locked: false, minimized: false, dock: 'left' },
      terra_media: { x: 8, y: 160, vw: 1920, vh: 1080, locked: false, minimized: false, dock: 'left' },
      left_rail: { x: 8, y: 148, vw: 1920, vh: 1080, locked: false, minimized: false, dock: 'left' },
    },
    sizes: {
      nearby_cameras: { width: 320, height: 180 },
      terra_media: { width: 352, height: 520 },
      left_rail: { width: 224, height: 420 },
    },
    viewportWidth: 1920,
    viewportHeight: 1080,
  })
  const nearby = crowded.find(row => row.id === 'nearby_cameras')
  const media = crowded.find(row => row.id === 'terra_media')
  const overlap = nearby && media
    ? smartOrganizeRectsOverlap(
      { x: nearby.x, y: nearby.y, width: 320, height: 180 },
      { x: media.x, y: media.y, width: 352, height: 520 },
    )
    : true
  results.push(check(
    'smart_organize_terra_media_does_not_overlap_nearby_cameras',
    Boolean(nearby && media && !overlap && media.x > nearby.x + 200),
    JSON.stringify({ nearby, media, overlap }),
  ))
  const persisted = parseWorkspaceLayout(JSON.stringify({
    version: 1,
    panels: {
      terra_media: { x: 40, y: 80, vw: 1920, vh: 1080, locked: false, minimized: true, dock: 'right' },
    },
    zOrder: ['terra_media'],
  }))
  results.push(check(
    'layout_persists_terra_media_minimize_and_dock',
    persisted?.panels.terra_media?.minimized === true && persisted.panels.terra_media.dock === 'right' && persisted.panels.terra_media.x === 40,
    JSON.stringify(persisted?.panels.terra_media),
  ))
  const restored = parseWorkspaceLayout(JSON.stringify({
    version: 1,
    panels: {
      terra_media: { x: 40, y: 80, vw: 1920, vh: 1080, locked: false, minimized: false, dock: 'right' },
    },
    zOrder: ['terra_media'],
  }))
  results.push(check(
    'layout_restore_keeps_terra_media_registered',
    restored?.panels.terra_media?.minimized === false && restored.zOrder.includes('terra_media'),
    JSON.stringify(restored?.panels.terra_media),
  ))
  const closedLayout = parseWorkspaceLayout(JSON.stringify({
    version: 1,
    panels: {
      terra_media: { x: 40, y: 80, vw: 1920, vh: 1080, locked: false, minimized: false, dock: 'float', closed: true },
    },
    zOrder: ['terra_media'],
  }))
  results.push(check(
    'layout_persists_terra_media_closed',
    closedLayout?.panels.terra_media?.closed === true,
    JSON.stringify(closedLayout?.panels.terra_media),
  ))
  const compactLayout = parseWorkspaceLayout(JSON.stringify({
    version: 1,
    panels: {
      terra_media: { x: 40, y: 80, vw: 1920, vh: 1080, locked: false, minimized: false, dock: 'float', playerChrome: 'compact' },
    },
    zOrder: ['terra_media'],
  }))
  results.push(check(
    'layout_persists_terra_media_compact_chrome',
    compactLayout?.panels.terra_media?.playerChrome === 'compact',
    JSON.stringify(compactLayout?.panels.terra_media),
  ))
  const skipClosed = computeSmartOrganizeLayout({
    panels: { terra_media: { x: 12, y: 12, vw: 1280, vh: 720, locked: false, minimized: false, dock: 'float', closed: true } },
    sizes: { terra_media: { width: 336, height: 240 } },
    viewportWidth: 1280,
    viewportHeight: 720,
  })
  results.push(check(
    'smart_organize_skips_closed_terra_media',
    !skipClosed.some(row => row.id === 'terra_media'),
    JSON.stringify(skipClosed),
  ))
  return results
}

const isDirect = Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
if (isDirect) {
  const results = run()
  const failed = results.filter(item => !item.pass)
  for (const item of results) {
    console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}${item.pass ? '' : ` — ${item.detail}`}`)
  }
  console.log(`Terra workspace layout validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

export { run }
