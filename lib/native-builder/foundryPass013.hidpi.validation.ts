/**
 * PASS 013 HiDPI / multi-monitor AT-SPI normalization.
 * Synthetic coordinate spaces only — does not launch production.
 */
import { pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'
import { resolveRepoRoot } from '@/lib/repo/paths'
import {
  logicalToPhysicalPoint,
  normalizeAccessiblePointToScreen,
  pickSafeInteriorPoint,
  rectsOverlapMeaningfully,
  type DisplayTopology,
  type Rect,
} from './foundryComputerUseGeometry'
import { REQUIRED_LIFECYCLE_CONTROLS } from './foundryComputerUse'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

function display(id: string, logical: Rect, scale: number, primary = false): DisplayTopology {
  return {
    id,
    connector: id,
    logical,
    physical: {
      x: logical.x * scale,
      y: logical.y * scale,
      width: logical.width * scale,
      height: logical.height * scale,
    },
    scale,
    primary,
    rotation: 0,
  }
}

async function run() {
  const results: CaseResult[] = []
  const computer = await readFile(resolveRepoRoot() + '/lib/native-builder/foundryComputerUse.ts', 'utf8')
  const geometry = await readFile(resolveRepoRoot() + '/lib/native-builder/foundryComputerUseGeometry.ts', 'utf8')
  const backend = await readFile(resolveRepoRoot() + '/scripts/foundry/computer-use-backend.py', 'utf8')

  results.push(check(
    'no_hardcoded_scale_guesses',
    !/for \(const scale of \[2, 1\.5, 1\.25\]\)/.test(computer)
      && /normalizeAccessiblePointToScreen/.test(computer)
      && /normalizeAccessiblePointToScreen/.test(geometry),
    'single normalizeAccessiblePointToScreen layer; no [2,1.5,1.25] scan',
  ))
  results.push(check(
    'no_raw_atspi_mouse_event',
    !/generate_mouse_event\(/.test(backend),
    'activate_control does not blind-click raw AT-SPI SCREEN coords',
  ))
  results.push(check(
    'required_controls_include_confirm_and_restore',
    REQUIRED_LIFECYCLE_CONTROLS.has('Confirm Archive') && REQUIRED_LIFECYCLE_CONTROLS.has('Restore') && REQUIRED_LIFECYCLE_CONTROLS.has('Advanced / Operations'),
    [...REQUIRED_LIFECYCLE_CONTROLS].join(','),
  ))

  const scaleCases: Array<{ scale: number; logical: Rect }> = [
    { scale: 1, logical: { x: 0, y: 0, width: 1920, height: 1080 } },
    { scale: 1.25, logical: { x: 0, y: 0, width: 1920, height: 1080 } },
    { scale: 1.5, logical: { x: 0, y: 0, width: 1920, height: 1080 } },
    { scale: 2, logical: { x: 0, y: 0, width: 1920, height: 1080 } },
  ]
  for (const item of scaleCases) {
    const d = display(`s${item.scale}`, item.logical, item.scale, true)
    const frame: Rect = {
      x: d.physical.x + 40,
      y: d.physical.y + 40,
      width: Math.floor(d.physical.width * 0.5),
      height: Math.floor(d.physical.height * 0.5),
    }
    const logicalHit = { x: item.logical.x + 80, y: item.logical.y + 90, width: 40, height: 20 }
    const physicalHit = logicalToPhysicalPoint(logicalHit, d)
    const mapped = normalizeAccessiblePointToScreen(
      { ...logicalHit, width: 40, height: 20 },
      { displays: [d], appFrameX11: frame, appFrameAtspi: item.logical },
    )
    const physicalMapped = normalizeAccessiblePointToScreen(
      { x: physicalHit.x, y: physicalHit.y, width: 40 * item.scale, height: 20 * item.scale },
      { displays: [d], appFrameX11: frame, appFrameAtspi: { x: frame.x / item.scale, y: frame.y / item.scale, width: frame.width / item.scale, height: frame.height / item.scale } },
    )
    results.push(check(
      `scale_${String(item.scale).replace('.', '_')}_inside_frame`,
      mapped.insideAppFrame === true || physicalMapped.insideAppFrame === true,
      JSON.stringify({ mapped, physicalMapped, frame }),
    ))
  }

  const left = display('HDMI-1', { x: 0, y: 0, width: 1920, height: 1080 }, 2, true)
  const right = display('DP-1', { x: 1920, y: 0, width: 960, height: 540 }, 2, false)
  right.physical = { x: 3840, y: 0, width: 1920, height: 1080 }
  const mixed = [left, right]
  const warRoom: Rect = { x: 3840, y: 74, width: 1920, height: 1006 }
  const atspiFrame: Rect = { x: 1920, y: 37, width: 960, height: 503 }
  const newSession = normalizeAccessiblePointToScreen(
    { x: 5512, y: 946, width: 194, height: 40 },
    { displays: mixed, appFrameX11: warRoom, appFrameAtspi: atspiFrame },
  )
  results.push(check(
    'right_display_physical_new_session',
    newSession.insideAppFrame === true && newSession.displayId === 'DP-1',
    JSON.stringify(newSession),
  ))

  const archiveUnscale = normalizeAccessiblePointToScreen(
    { x: 5569, y: 2199, width: 129, height: 40 },
    { displays: mixed, appFrameX11: { x: 3840, y: 74, width: 1970, height: 1130 }, appFrameAtspi: atspiFrame },
  )
  results.push(check(
    'right_display_inflated_y_normalizes_or_refuses',
    archiveUnscale.insideAppFrame === true || archiveUnscale.refused === 'AT_SPI_POINT_OUTSIDE_APP_FRAME',
    JSON.stringify(archiveUnscale),
  ))
  results.push(check(
    'outside_frame_refuses_without_click',
    pickSafeInteriorPoint({ x: 10, y: 10, width: 20, height: 20 }, warRoom).error === 'AT_SPI_POINT_OUTSIDE_APP_FRAME',
    'AT_SPI_POINT_OUTSIDE_APP_FRAME',
  ))

  const negative = display('LEFT', { x: -1920, y: 0, width: 1920, height: 1080 }, 1, false)
  negative.physical = { x: -1920, y: 0, width: 1920, height: 1080 }
  const negFrame = { x: -1800, y: 80, width: 1600, height: 900 }
  const negHit = normalizeAccessiblePointToScreen(
    { x: -1700, y: 200, width: 80, height: 24 },
    { displays: [negative, display('PRIMARY', { x: 0, y: 0, width: 1920, height: 1080 }, 1, true)], appFrameX11: negFrame },
  )
  results.push(check('negative_origin_left_display', negHit.insideAppFrame === true, JSON.stringify(negHit)))

  const above = display('ABOVE', { x: 0, y: -1080, width: 1920, height: 1080 }, 1)
  above.physical = { x: 0, y: -1080, width: 1920, height: 1080 }
  const aboveFrame = { x: 100, y: -900, width: 800, height: 600 }
  const aboveHit = normalizeAccessiblePointToScreen(
    { x: 140, y: -800, width: 50, height: 20 },
    { displays: [above], appFrameX11: aboveFrame },
  )
  results.push(check('above_primary_display', aboveHit.insideAppFrame === true, JSON.stringify(aboveHit)))

  const spanning = { x: 1700, y: 200, width: 500, height: 400 }
  const spanHit = normalizeAccessiblePointToScreen(
    { x: 1750, y: 220, width: 80, height: 24 },
    { displays: [display('A', { x: 0, y: 0, width: 1920, height: 1080 }, 1, true), display('B', { x: 1920, y: 0, width: 1920, height: 1080 }, 1)], appFrameX11: spanning },
  )
  results.push(check('window_spanning_displays', spanHit.insideAppFrame === true, JSON.stringify(spanHit)))

  const mixedLeft = display('HDMI-1', { x: 0, y: 0, width: 1920, height: 1080 }, 1, true)
  mixedLeft.physical = { x: 0, y: 0, width: 1920, height: 1080 }
  const mixedRight = display('DP-1', { x: 1920, y: 0, width: 960, height: 540 }, 2, false)
  mixedRight.physical = { x: 1920, y: 0, width: 1920, height: 1080 }
  const mixedFrame = { x: 1920, y: 40, width: 1600, height: 900 }
  const mixedHit = normalizeAccessiblePointToScreen(
    { x: 2000, y: 120, width: 80, height: 24 },
    { displays: [mixedLeft, mixedRight], appFrameX11: mixedFrame, appFrameAtspi: { x: 1920, y: 20, width: 800, height: 450 } },
  )
  results.push(check(
    'mixed_scale_right_display',
    mixedHit.insideAppFrame === true && mixedHit.displayId === 'DP-1',
    JSON.stringify(mixedHit),
  ))

  results.push(check(
    'intersection_required',
    rectsOverlapMeaningfully({ x: 3840, y: 80, width: 40, height: 40 }, warRoom) === true
      && rectsOverlapMeaningfully({ x: 10, y: 10, width: 20, height: 20 }, warRoom) === false,
    'meaningful overlap vs none',
  ))
  results.push(check(
    'discovery_not_dropped_on_geometry',
    computer.includes("blocker: mapping.insideWindow ? undefined : 'AT_SPI_POINT_OUTSIDE_APP_FRAME'")
      && computer.includes("strategy: 'semantic'"),
    'named AT-SPI hits remain discoverable when geometry is unmappable',
  ))

  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(item => !item.pass)
  console.log(JSON.stringify({ VALIDATE_HIDPI_RESULT: failed.length ? 'FAIL' : 'PASS', passed: results.length - failed.length, total: results.length }, null, 2))
  if (failed.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
export { run as runFoundryPass013HidpiValidation }
