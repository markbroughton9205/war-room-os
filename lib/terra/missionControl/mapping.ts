/**
 * Terra Mission Control — zero-loss panel host map.
 *
 * Every TerraWorkspacePanelId has a new home. Panels stay mounted and keep their
 * existing handlers; chrome only changes WHERE they render. Do not delete a panel
 * from this table without Commander authorization.
 */
import {
  TERRA_SMART_CLICK_ROUTES,
  TERRA_WORKSPACE_PANEL_IDS,
  TERRA_WORKSPACE_PANEL_TITLE,
  type TerraSmartClickInteractionKind,
  type TerraWorkspacePanelId,
} from '@/lib/terra/workspace/panelIds'

export const TERRA_MISSION_DRAWER_IDS = ['navigate', 'earth', 'intelligence', 'time', 'tools', 'media'] as const
export type TerraMissionDrawerId = (typeof TERRA_MISSION_DRAWER_IDS)[number]

export const TERRA_MISSION_SECTION_IDS = [
  'search',
  'location',
  'weather',
  'radar',
  'pulse',
  'automation',
  'gods-eye',
  'inspect',
  'cameras',
  'nearby',
  'area-live',
  'camera-directory',
  'hazards',
  'live-intel',
  'street-intel',
  'weather-alert',
  'emergency',
  'timeline',
  'layout',
  'layers',
  'street-view',
  'media',
] as const
export type TerraMissionSectionId = (typeof TERRA_MISSION_SECTION_IDS)[number]

export type TerraMissionHostKind = 'drawer' | 'banner' | 'player' | 'overlay'

export type TerraMissionHost = {
  kind: TerraMissionHostKind
  drawer?: TerraMissionDrawerId
  section?: TerraMissionSectionId
}

export const TERRA_MISSION_DRAWER_LABEL: Record<TerraMissionDrawerId, string> = {
  navigate: 'Navigate',
  earth: 'Earth',
  intelligence: 'Intelligence',
  time: 'Time',
  tools: 'Tools',
  media: 'Media',
}

export const TERRA_MISSION_SECTION_LABEL: Record<TerraMissionSectionId, string> = {
  search: 'Search',
  location: 'Location',
  weather: 'Weather',
  radar: 'Radar',
  pulse: 'Pulse',
  automation: 'Automation',
  'gods-eye': "God's Eye",
  inspect: 'Inspect',
  cameras: 'Cameras',
  nearby: 'Nearby',
  'area-live': 'Area Live',
  'camera-directory': 'Directory',
  hazards: 'Hazards',
  'live-intel': 'Live Intel',
  'street-intel': 'Street Intel',
  'weather-alert': 'Alert',
  emergency: 'Emergency',
  timeline: 'Timeline',
  layout: 'Layout',
  layers: 'Layers',
  'street-view': 'Street View',
  media: 'Media',
}

export const TERRA_MISSION_DEFAULT_SECTION: Record<TerraMissionDrawerId, TerraMissionSectionId> = {
  navigate: 'search',
  earth: 'weather',
  intelligence: 'gods-eye',
  time: 'timeline',
  tools: 'layout',
  media: 'media',
}

export const TERRA_MISSION_DRAWER_SECTIONS: Record<TerraMissionDrawerId, readonly TerraMissionSectionId[]> = {
  navigate: ['search', 'location'],
  earth: ['weather', 'radar', 'pulse', 'automation'],
  intelligence: ['gods-eye', 'inspect', 'cameras', 'nearby', 'area-live', 'camera-directory', 'hazards', 'live-intel', 'street-intel', 'weather-alert', 'emergency'],
  time: ['timeline'],
  tools: ['layout', 'layers', 'street-view'],
  media: ['media'],
}

/** Primary host plus optional aliases so one mounted panel can appear in more than one section. */
export const TERRA_MISSION_PANEL_HOSTS: Record<TerraWorkspacePanelId, readonly TerraMissionHost[]> = {
  search_command: [{ kind: 'drawer', drawer: 'navigate', section: 'search' }],
  location_gps: [{ kind: 'drawer', drawer: 'navigate', section: 'location' }],
  radar: [{ kind: 'drawer', drawer: 'earth', section: 'radar' }, { kind: 'drawer', drawer: 'earth', section: 'weather' }],
  globe_status: [{ kind: 'drawer', drawer: 'earth', section: 'pulse' }, { kind: 'drawer', drawer: 'earth', section: 'weather' }],
  left_rail: [{ kind: 'drawer', drawer: 'tools', section: 'layers' }, { kind: 'drawer', drawer: 'earth', section: 'automation' }],
  workspace_control: [{ kind: 'drawer', drawer: 'tools', section: 'layout' }],
  timeline: [{ kind: 'drawer', drawer: 'time', section: 'timeline' }],
  gods_eye_controls: [{ kind: 'drawer', drawer: 'intelligence', section: 'gods-eye' }],
  camera_discovery: [{ kind: 'drawer', drawer: 'intelligence', section: 'cameras' }],
  area_live_controls: [{ kind: 'drawer', drawer: 'intelligence', section: 'area-live' }],
  nearby_cameras: [{ kind: 'drawer', drawer: 'intelligence', section: 'nearby' }],
  camera_directory: [{ kind: 'drawer', drawer: 'intelligence', section: 'camera-directory' }],
  gods_eye_inspect: [{ kind: 'drawer', drawer: 'intelligence', section: 'inspect' }],
  street_intel: [{ kind: 'drawer', drawer: 'intelligence', section: 'street-intel' }],
  live_intel: [{ kind: 'drawer', drawer: 'intelligence', section: 'live-intel' }],
  hazard_counters: [{ kind: 'drawer', drawer: 'intelligence', section: 'hazards' }],
  weather_drawer: [{ kind: 'drawer', drawer: 'intelligence', section: 'weather-alert' }],
  terra_emergency_report: [{ kind: 'drawer', drawer: 'intelligence', section: 'emergency' }],
  street_view: [{ kind: 'drawer', drawer: 'tools', section: 'street-view' }],
  terra_media: [{ kind: 'player' }, { kind: 'drawer', drawer: 'media', section: 'media' }],
  area_live_viewer: [{ kind: 'player' }],
  weather_toast: [{ kind: 'banner' }],
  camera_hover: [{ kind: 'overlay' }],
  flight_monitor: [{ kind: 'overlay' }],
}

export function hostsForPanel(id: TerraWorkspacePanelId): readonly TerraMissionHost[] {
  return TERRA_MISSION_PANEL_HOSTS[id]
}

export function primaryHostForPanel(id: TerraWorkspacePanelId): TerraMissionHost {
  return TERRA_MISSION_PANEL_HOSTS[id][0]!
}

export function openTargetForPanel(id: TerraWorkspacePanelId): { drawer: TerraMissionDrawerId; section: TerraMissionSectionId } | null {
  const hosted = TERRA_MISSION_PANEL_HOSTS[id].find(host => host.kind === 'drawer' && host.drawer && host.section)
  if (!hosted?.drawer || !hosted.section) return null
  return { drawer: hosted.drawer, section: hosted.section }
}

export function openTargetForSmartClick(kind: TerraSmartClickInteractionKind): { drawer: TerraMissionDrawerId; section: TerraMissionSectionId } | null {
  return openTargetForPanel(TERRA_SMART_CLICK_ROUTES[kind].primary)
}

export function slotKey(host: TerraMissionHost): string {
  if (host.kind === 'drawer') return `drawer:${host.drawer}:${host.section}`
  return host.kind
}

export function unmappedWorkspacePanels(): TerraWorkspacePanelId[] {
  return TERRA_WORKSPACE_PANEL_IDS.filter(id => !TERRA_MISSION_PANEL_HOSTS[id]?.length)
}

export function missionPanelTitle(id: TerraWorkspacePanelId): string {
  return TERRA_WORKSPACE_PANEL_TITLE[id]
}
