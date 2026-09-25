/**
 * PASS 011 — semantic walker / window correlation / bounds mapping (no live AT-SPI required).
 */
import { pathToFileURL } from 'node:url'
import {
  correlateWarRoomWindow,
  mapHitIntoWarRoomWindow,
  pointInsideWindow,
  REQUIRED_LIFECYCLE_CONTROLS,
  type ParsedWindow,
} from './foundryComputerUse'
import { localToolsForMission } from './foundryLocalModelRuntime'
import { startMissionInput } from './foundryMissionController'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

function windowOf(partial: Partial<ParsedWindow> & { title: string }): ParsedWindow {
  return {
    id: partial.id ?? '0x1',
    desktop: partial.desktop ?? '0',
    host: partial.host ?? 'electron',
    title: partial.title,
    x: partial.x,
    y: partial.y,
    width: partial.width,
    height: partial.height,
  }
}

async function run() {
  const results: CaseResult[] = []
  const windows = [
    windowOf({ id: '0xa', title: 'Cursor — war-room-os', x: 0, y: 0, width: 800, height: 600 }),
    windowOf({ id: '0xb', title: 'Google Chrome', x: 10, y: 10, width: 800, height: 600 }),
    windowOf({ id: '0xc', title: 'War Room — Higher Vision Inc', x: 100, y: 200, width: 1600, height: 900 }),
    windowOf({ id: '0xd', title: 'gnome-terminal', x: 0, y: 0, width: 400, height: 300 }),
  ]
  const correlated = correlateWarRoomWindow(windows)
  results.push(check(
    'window_correlation_prefers_war_room',
    correlated?.id === '0xc' && correlated.title.includes('Higher Vision'),
    JSON.stringify(correlated),
  ))

  const war = windows[2]
  results.push(check(
    'point_inside_window',
    pointInsideWindow(900, 650, war) && !pointInsideWindow(40, 40, war),
    'center vs outside',
  ))

  const localHit = { name: 'Restore', role: 'push button', x: 120, y: 80, width: 72, height: 24 }
  const originMapped = mapHitIntoWarRoomWindow(localHit, war)
  results.push(check(
    'bounds_origin_translation_inside',
    originMapped.insideWindow === true && originMapped.originTranslated === true && originMapped.center.x === Math.round(100 + 120 + 36),
    JSON.stringify({ inside: originMapped.insideWindow, scale: originMapped.scale, origin: originMapped.originTranslated, center: originMapped.center }),
  ))

  const restoreWindow = windowOf({ id: '0xe', title: 'War Room — Higher Vision Inc', x: 0, y: 262, width: 3200, height: 1800 })
  const restoreHit = { name: 'Restore', role: 'push button', x: 180, y: 2409, width: 80, height: 24 }
  const restoreDisplay = {
    id: 'DP-1',
    logical: { x: 0, y: 0, width: 1600, height: 900 },
    physical: { x: 0, y: 0, width: 3200, height: 1800 },
    scale: 2,
    primary: true,
    rotation: 0,
  }
  const restoreMapped = mapHitIntoWarRoomWindow(restoreHit, restoreWindow, {
    displays: [restoreDisplay],
    appFrameX11: { x: 0, y: 262, width: 3200, height: 1800 },
  })
  results.push(check(
    'hidpi_restore_inside_frame',
    restoreMapped.insideWindow === true
      && restoreMapped.normalized?.space === 'display-unscale'
      && pointInsideWindow(restoreMapped.center.x, restoreMapped.center.y, restoreWindow),
    JSON.stringify({ space: restoreMapped.normalized?.space, center: restoreMapped.center, inside: restoreMapped.insideWindow, raw: restoreMapped.raw, translated: restoreMapped.translated }),
  ))
  const restoreBlind = mapHitIntoWarRoomWindow(restoreHit, restoreWindow)
  results.push(check(
    'hidpi_without_runtime_scale_refuses',
    restoreBlind.insideWindow === false,
    JSON.stringify({ inside: restoreBlind.insideWindow, center: restoreBlind.center }),
  ))

  const outside = mapHitIntoWarRoomWindow({ name: 'Restore', x: 50_000, y: 50_000, width: 10, height: 10 }, war)
  results.push(check(
    'bounds_outside_window_detected',
    outside.insideWindow === false,
    JSON.stringify(outside.center),
  ))

  results.push(check(
    'required_lifecycle_controls',
    REQUIRED_LIFECYCLE_CONTROLS.size === 7
      && ['New Session', 'Rename', 'Save', 'Archive', 'Confirm Archive', 'Advanced / Operations', 'Restore'].every(name => REQUIRED_LIFECYCLE_CONTROLS.has(name)),
    `${REQUIRED_LIFECYCLE_CONTROLS.size}`,
  ))

  const locate = startMissionInput('Where is restoreFoundrySession defined? Search and read the owner file. Do not change files.')
  locate.constraints.push('READ_ONLY_INVESTIGATION')
  const before = localToolsForMission(locate)
  locate.toolCalls = [
    { at: new Date().toISOString(), tool: 'workspace.search', ok: true, reason: 'test', excerpt: '[{"relPath":"lib/native-builder/foundrySessions.ts"}]' },
    { at: new Date().toISOString(), tool: 'file.read', ok: true, reason: 'test', excerpt: 'PATH:\nlib/native-builder/foundrySessions.ts' },
  ]
  const after = localToolsForMission(locate)
  results.push(check(
    'locate_only_complete_after_search_read',
    before.some(tool => tool.name === 'workspace.search') && after.length === 0,
    JSON.stringify({ before: before.map(item => item.name), after: after.map(item => item.name) }),
  ))

  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  console.log(`Foundry PASS 011 walker: ${results.filter(item => item.pass).length}/${results.length} PASS`)
  if (results.some(item => !item.pass)) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
export { run as runFoundryPass011WalkerValidation }
