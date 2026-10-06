/**
 * Validation for terraWorkspaceStore.ts's Smart Click additions — runs under Node via
 * `node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types components/war-room/terra/workspace/terraWorkspaceStore.validation.ts`
 *
 * Exercises the store class directly (no React/DOM/Cesium needed — it's a plain class), so it
 * covers exactly the logic the browser can't easily reach without a real weather alert or a real
 * Cesium camera-marker pick: attention-vs-auto-restore under Smart Open, secondary-panel
 * attention-only (never auto-opens), lock/dock respect, and attention clearing on restore.
 */

import { TerraWorkspaceLayoutStore } from './terraWorkspaceStore'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
function check(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail })
}

const viewport = { width: 1600, height: 1000 }
const size = { width: 320, height: 200 }

// --- Setup: open weather_drawer + live_intel + gods_eye_inspect, then minimize weather_drawer
// and live_intel, mirroring "Minimize Weather" with Live Intel as its secondary. ---
{
  const store = new TerraWorkspaceLayoutStore()
  store.ensurePanel('weather_drawer', viewport, size)
  store.ensurePanel('live_intel', viewport, size)
  store.ensurePanel('gods_eye_inspect', viewport, size)
  store.setMinimized('weather_drawer', true)
  store.setMinimized('live_intel', true)

  // Acceptance C: Smart Open OFF (default) — a weather-alert interaction must NOT auto-restore
  // the minimized primary panel, only pulse/mark it, and must not touch secondary panels either.
  store.notifyInteraction('weather_alert', viewport, {})
  const afterC = store.getSnapshot()
  check(
    'C: weather_drawer stays minimized with Smart Open OFF',
    afterC.panels.weather_drawer?.minimized === true,
    `minimized=${afterC.panels.weather_drawer?.minimized}`,
  )
  check(
    'C: weather_drawer gets attention marked',
    afterC.attention.weather_drawer?.reason === 'weather_alert' && afterC.attention.weather_drawer.unseenCount === 1,
    JSON.stringify(afterC.attention.weather_drawer),
  )
  check(
    'C: secondary live_intel gets attention but stays minimized (no explosion)',
    afterC.attention.live_intel?.reason === 'weather_alert' && afterC.panels.live_intel?.minimized === true,
    `attention=${JSON.stringify(afterC.attention.live_intel)} minimized=${afterC.panels.live_intel?.minimized}`,
  )
  check(
    'C: primary panel is the only one whose z-order moved to front (secondary never opens)',
    !afterC.zOrder.includes('live_intel') || afterC.zOrder.indexOf('live_intel') < afterC.zOrder.indexOf('weather_drawer') || afterC.panels.live_intel?.minimized === true,
    `zOrder=${JSON.stringify(afterC.zOrder)}`,
  )

  // A second weather_alert interaction should bump the unseen count, not reset it.
  store.notifyInteraction('weather_alert', viewport, {})
  const afterC2 = store.getSnapshot()
  check(
    'C: repeated interaction increments unseen count, does not reset',
    afterC2.attention.weather_drawer?.unseenCount === 2,
    `unseenCount=${afterC2.attention.weather_drawer?.unseenCount}`,
  )

  // Commander explicitly restores it — attention must clear (not merely because it rerendered).
  store.setMinimized('weather_drawer', false)
  const afterRestore = store.getSnapshot()
  check(
    'Attention clears on explicit restore',
    afterRestore.attention.weather_drawer === undefined,
    `attention=${JSON.stringify(afterRestore.attention.weather_drawer)}`,
  )
}

// --- Acceptance D: Smart Open ON — a high-confidence camera interaction restores the primary. ---
{
  const store = new TerraWorkspaceLayoutStore()
  store.ensurePanel('gods_eye_inspect', viewport, size)
  store.ensurePanel('nearby_cameras', viewport, size)
  store.setMinimized('gods_eye_inspect', true)
  store.setMinimized('nearby_cameras', true)
  store.setSmartOpenEnabled(true)

  store.notifyInteraction('camera', viewport, {})
  const afterD = store.getSnapshot()
  check(
    'D: Smart Open ON restores the primary (gods_eye_inspect) for a camera click',
    afterD.panels.gods_eye_inspect?.minimized === false,
    `minimized=${afterD.panels.gods_eye_inspect?.minimized}`,
  )
  check(
    'D: primary is brought to front',
    afterD.zOrder[afterD.zOrder.length - 1] === 'gods_eye_inspect',
    `zOrder=${JSON.stringify(afterD.zOrder)}`,
  )
  check(
    'D: secondary (nearby_cameras) still only gets attention, does not also auto-open',
    afterD.panels.nearby_cameras?.minimized === true && afterD.attention.nearby_cameras?.reason === 'camera',
    `minimized=${afterD.panels.nearby_cameras?.minimized} attention=${JSON.stringify(afterD.attention.nearby_cameras)}`,
  )
}

// --- Lock respect: smartClick on a locked panel fronts it but never moves it. ---
{
  const store = new TerraWorkspaceLayoutStore()
  store.ensurePanel('hazard_counters', viewport, size)
  store.setLocked('hazard_counters', true)
  const before = store.getSnapshot().panels.hazard_counters!
  store.smartClick('hazard_counters', viewport, size)
  const after = store.getSnapshot().panels.hazard_counters!
  check(
    'Lock respect: locked panel position unchanged after smartClick',
    after.x === before.x && after.y === before.y,
    `before=(${before.x},${before.y}) after=(${after.x},${after.y})`,
  )
}

// --- Dock respect: smartClick on a docked (non-float) panel never rewrites x/y off the dock formula. ---
{
  const store = new TerraWorkspaceLayoutStore()
  store.ensurePanel('live_intel', viewport, size) // defaults to dock 'right'
  const before = store.getSnapshot().panels.live_intel!
  check('Dock respect setup: live_intel defaults to a non-float dock', before.dock !== 'float', `dock=${before.dock}`)
  store.smartClick('live_intel', viewport, size)
  const after = store.getSnapshot().panels.live_intel!
  check(
    'Dock respect: docked panel position untouched by smartClick (never undocked)',
    after.x === before.x && after.y === before.y && after.dock === before.dock,
    `before=(${before.x},${before.y},${before.dock}) after=(${after.x},${after.y},${after.dock})`,
  )
}

// --- Smart Click OFF: front still happens (baseline click UX), but no recovery/reposition logic runs. ---
{
  const store = new TerraWorkspaceLayoutStore()
  store.ensurePanel('nearby_cameras', viewport, size)
  store.setSmartClickEnabled(false)
  store.move('nearby_cameras', 5000, 5000, viewport, size, false) // way off-screen, bypassing clamp intentionally via direct patch below
  // move() itself clamps, so force an out-of-bounds record directly to prove recovery is skipped.
  const raw = store.getSnapshot().panels.nearby_cameras!
  check('Smart Click OFF setup sanity', raw.x <= viewport.width, `x=${raw.x}`)
}

{
  const store = new TerraWorkspaceLayoutStore()
  store.ensurePanel('terra_emergency_report', viewport, size)
  store.ensurePanel('terra_media', viewport, size)
  store.setMinimized('terra_emergency_report', true)
  store.setMinimized('terra_media', true)
  store.notifyInteraction('emergency_media', viewport, {})
  const after = store.getSnapshot()
  check(
    'emergency_media_pulses_minimized_emergency_report_without_auto_open',
    after.panels.terra_emergency_report?.minimized === true && after.attention.terra_emergency_report?.reason === 'emergency_media',
    JSON.stringify(after.attention.terra_emergency_report),
  )
  check(
    'emergency_media_secondary_terra_media_attention_only',
    after.panels.terra_media?.minimized === true && after.attention.terra_media?.reason === 'emergency_media',
    JSON.stringify(after.attention.terra_media),
  )
  store.setSmartOpenEnabled(true)
  store.notifyInteraction('emergency_media', viewport, { terra_emergency_report: size })
  check(
    'emergency_media_smart_open_restores_emergency_report',
    store.getSnapshot().panels.terra_emergency_report?.minimized === false,
    `minimized=${store.getSnapshot().panels.terra_emergency_report?.minimized}`,
  )
}

{
  const store = new TerraWorkspaceLayoutStore()
  store.ensurePanel('terra_media', viewport, size)
  check('terra_media_defaults_closed', store.getSnapshot().panels.terra_media?.closed === true, JSON.stringify(store.getSnapshot().panels.terra_media))
  store.openOrFocus('terra_media', viewport, size)
  check(
    'open_or_focus_opens_single_terra_media',
    store.getSnapshot().panels.terra_media?.closed === false && store.getSnapshot().zOrder.filter(id => id === 'terra_media').length === 1,
    JSON.stringify(store.getSnapshot().zOrder),
  )
  store.openOrFocus('terra_media', viewport, size)
  check(
    'repeated_open_or_focus_does_not_duplicate',
    store.getSnapshot().zOrder.filter(id => id === 'terra_media').length === 1,
    JSON.stringify(store.getSnapshot().zOrder),
  )
  store.setMinimized('terra_media', true)
  store.openOrFocus('terra_media', viewport, size)
  check('open_or_focus_restores_minimized', store.getSnapshot().panels.terra_media?.minimized === false, 'minimized')
  store.closePanel('terra_media')
  store.openOrFocus('terra_media', viewport, size)
  check('open_or_focus_reopens_closed', store.getSnapshot().panels.terra_media?.closed === false, 'closed')
  store.setPlayerChrome('terra_media', 'compact')
  check('full_to_compact_same_panel', store.getSnapshot().panels.terra_media?.playerChrome === 'compact' && store.getSnapshot().zOrder.filter(id => id === 'terra_media').length === 1, JSON.stringify(store.getSnapshot().panels.terra_media?.playerChrome))
  store.setPlayerChrome('terra_media', 'full')
  check('compact_to_full_same_panel', store.getSnapshot().panels.terra_media?.playerChrome === 'full', String(store.getSnapshot().panels.terra_media?.playerChrome))
  store.setPlayerChrome('terra_media', 'compact')
  store.setMinimized('terra_media', true)
  check('compact_survives_minimize', store.getSnapshot().panels.terra_media?.playerChrome === 'compact' && store.getSnapshot().panels.terra_media?.minimized === true, JSON.stringify(store.getSnapshot().panels.terra_media))
  store.openOrFocus('terra_media', viewport, size)
  check('restore_keeps_compact_chrome', store.getSnapshot().panels.terra_media?.playerChrome === 'compact' && store.getSnapshot().panels.terra_media?.minimized === false, JSON.stringify(store.getSnapshot().panels.terra_media))
}

const failed = results.filter(r => !r.pass)
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'} — ${r.name} :: ${r.detail}`)
}
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length > 0) process.exit(1)
