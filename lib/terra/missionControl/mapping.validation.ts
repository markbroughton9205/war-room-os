/**
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/missionControl/mapping.validation.ts
 *
 * Zero-loss contract: every workspace panel id must have a mission-control host.
 */
import { pathToFileURL } from 'node:url'
import { TERRA_WORKSPACE_PANEL_IDS } from '@/lib/terra/workspace/panelIds'
import { TERRA_SMART_CLICK_ROUTES } from '@/lib/terra/workspace/panelIds'
import {
  TERRA_MISSION_DRAWER_SECTIONS,
  TERRA_MISSION_PANEL_HOSTS,
  openTargetForPanel,
  openTargetForSmartClick,
  unmappedWorkspacePanels,
} from './mapping'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  const missing = unmappedWorkspacePanels()
  results.push(check('every_panel_mapped', missing.length === 0, missing.join(',') || 'all mapped'))
  results.push(check('panel_count_matches_registry', TERRA_WORKSPACE_PANEL_IDS.length === Object.keys(TERRA_MISSION_PANEL_HOSTS).length, String(TERRA_WORKSPACE_PANEL_IDS.length)))
  results.push(check('host_table_covers_registry', Object.keys(TERRA_MISSION_PANEL_HOSTS).length === TERRA_WORKSPACE_PANEL_IDS.length, String(Object.keys(TERRA_MISSION_PANEL_HOSTS).length)))

  for (const id of TERRA_WORKSPACE_PANEL_IDS) {
    const hosts = TERRA_MISSION_PANEL_HOSTS[id]
    results.push(check(`host_${id}`, hosts.length > 0, JSON.stringify(hosts)))
    for (const host of hosts) {
      if (host.kind !== 'drawer') continue
      const sections = host.drawer ? TERRA_MISSION_DRAWER_SECTIONS[host.drawer] : []
      results.push(check(
        `host_${id}_${host.drawer}_${host.section}`,
        Boolean(host.drawer && host.section && sections.includes(host.section)),
        JSON.stringify(host),
      ))
    }
  }

  for (const kind of Object.keys(TERRA_SMART_CLICK_ROUTES) as (keyof typeof TERRA_SMART_CLICK_ROUTES)[]) {
    const target = openTargetForSmartClick(kind)
    results.push(check(`smart_click_${kind}_opens_drawer`, Boolean(target), JSON.stringify(target)))
  }

  results.push(check('search_maps_to_navigate', openTargetForPanel('search_command')?.drawer === 'navigate', JSON.stringify(openTargetForPanel('search_command'))))
  results.push(check('timeline_maps_to_time', openTargetForPanel('timeline')?.drawer === 'time', JSON.stringify(openTargetForPanel('timeline'))))
  results.push(check('radar_maps_to_earth', openTargetForPanel('radar')?.drawer === 'earth', JSON.stringify(openTargetForPanel('radar'))))
  results.push(check('governor_rail_maps_to_earth_or_tools', TERRA_MISSION_PANEL_HOSTS.left_rail.some(host => host.drawer === 'earth' && host.section === 'automation') && TERRA_MISSION_PANEL_HOSTS.left_rail.some(host => host.drawer === 'tools' && host.section === 'layers'), JSON.stringify(TERRA_MISSION_PANEL_HOSTS.left_rail)))
  results.push(check('inspect_maps_to_intelligence', openTargetForPanel('gods_eye_inspect')?.section === 'inspect', JSON.stringify(openTargetForPanel('gods_eye_inspect'))))
  results.push(check('media_has_player_host', TERRA_MISSION_PANEL_HOSTS.terra_media.some(host => host.kind === 'player'), JSON.stringify(TERRA_MISSION_PANEL_HOSTS.terra_media)))
  results.push(check('weather_toast_is_banner', TERRA_MISSION_PANEL_HOSTS.weather_toast[0]?.kind === 'banner', JSON.stringify(TERRA_MISSION_PANEL_HOSTS.weather_toast)))
  results.push(check('camera_hover_stays_overlay', TERRA_MISSION_PANEL_HOSTS.camera_hover[0]?.kind === 'overlay', JSON.stringify(TERRA_MISSION_PANEL_HOSTS.camera_hover)))
  results.push(check('workspace_maps_to_tools_layout', openTargetForPanel('workspace_control')?.section === 'layout', JSON.stringify(openTargetForPanel('workspace_control'))))
  return results
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const results = run()
  const failed = results.filter(row => !row.pass)
  for (const row of results) console.log(`${row.pass ? 'PASS' : 'FAIL'} ${row.name} ${row.detail}`)
  if (failed.length) {
    console.error(`Terra mission-control mapping FAIL ${failed.length}/${results.length}`)
    process.exit(1)
  }
  console.log(`Terra mission-control mapping PASS ${results.length}/${results.length}`)
}

export { run }
