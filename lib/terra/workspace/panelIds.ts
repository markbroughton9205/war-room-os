import type { TerraWorkspaceDock } from './layout'

export const TERRA_WORKSPACE_PANEL_IDS = [
  'workspace_control',
  'left_rail',
  'live_intel',
  'weather_toast',
  'weather_drawer',
  'area_live_viewer',
  'street_view',
  'gods_eye_inspect',
  'nearby_cameras',
  'radar',
  'search_command',
  'location_gps',
  'street_intel',
  'camera_directory',
  'timeline',
  'hazard_counters',
  'globe_status',
  'gods_eye_controls',
  'camera_discovery',
  'area_live_controls',
  'camera_hover',
] as const

export type TerraWorkspacePanelId = (typeof TERRA_WORKSPACE_PANEL_IDS)[number]

export const TERRA_WORKSPACE_DOCKABLE_IDS: readonly TerraWorkspacePanelId[] = [
  'live_intel',
  'weather_drawer',
  'weather_toast',
  'street_view',
  'area_live_viewer',
  'timeline',
  'left_rail',
  'nearby_cameras',
  'gods_eye_controls',
]

export const TERRA_WORKSPACE_FLOATING_MINIMIZE_IDS: readonly TerraWorkspacePanelId[] = TERRA_WORKSPACE_PANEL_IDS.filter(
  id => id !== 'workspace_control',
)

export function defaultPanelDock(id: TerraWorkspacePanelId): TerraWorkspaceDock {
  if (id === 'timeline') return 'bottom'
  if (id === 'left_rail') return 'left'
  if (id === 'live_intel') return 'right'
  return 'float'
}

export function defaultPanelPosition(id: TerraWorkspacePanelId, vw: number, vh: number): { x: number; y: number } {
  const right = (width: number) => Math.max(8, vw - width - 12)
  const bottom = (height: number) => Math.max(8, vh - height - 12)
  const centerX = (width: number) => Math.max(8, (vw - width) / 2)
  switch (id) {
    case 'workspace_control':
      return { x: 8, y: 8 }
    case 'search_command':
      return { x: Math.max(248, centerX(420)), y: 8 }
    case 'left_rail':
      return { x: 8, y: 148 }
    case 'live_intel':
      return { x: right(320), y: 12 }
    case 'weather_toast':
      return { x: centerX(352), y: 12 }
    case 'weather_drawer':
      return { x: right(416), y: bottom(420) }
    case 'area_live_viewer':
      return { x: right(448), y: bottom(400) }
    case 'street_view':
      return { x: centerX(448), y: bottom(400) }
    case 'gods_eye_inspect':
      return { x: 248, y: Math.max(12, vh * 0.28) }
    case 'nearby_cameras':
      return { x: 248, y: Math.max(12, vh * 0.58) }
    case 'radar':
      return { x: centerX(576), y: bottom(220) }
    case 'location_gps':
      return { x: Math.min(right(360), centerX(420) + 440), y: 8 }
    case 'street_intel':
      return { x: 248, y: 12 }
    case 'camera_directory':
      return { x: 248, y: Math.max(12, vh * 0.42) }
    case 'timeline':
      return { x: centerX(640), y: bottom(96) }
    case 'hazard_counters':
      return { x: right(420), y: 8 }
    case 'globe_status':
      return { x: right(280), y: 44 }
    case 'gods_eye_controls':
      return { x: right(420), y: 80 }
    case 'camera_discovery':
      return { x: right(280), y: 124 }
    case 'area_live_controls':
      return { x: right(280), y: 168 }
    case 'camera_hover':
      return { x: centerX(288), y: Math.max(12, vh * 0.35) }
  }
}

export const TERRA_WORKSPACE_PANEL_TITLE: Record<TerraWorkspacePanelId, string> = {
  workspace_control: 'Workspace',
  left_rail: 'Commander',
  live_intel: 'Live Intel',
  weather_toast: 'Weather Alert',
  weather_drawer: 'Weather',
  area_live_viewer: 'Area Live',
  street_view: 'Street View',
  gods_eye_inspect: 'Inspect',
  nearby_cameras: 'Nearby Cameras',
  radar: 'Radar',
  search_command: 'Search',
  location_gps: 'Location',
  street_intel: 'Street Intelligence',
  camera_directory: 'Camera Directory',
  timeline: 'Timeline',
  hazard_counters: 'Hazards',
  globe_status: 'Globe Status',
  gods_eye_controls: "God's Eye",
  camera_discovery: 'Camera Discovery',
  area_live_controls: 'Area Live Controls',
  camera_hover: 'Camera',
}

export const TERRA_GLOBE_FOCUS_MINIMIZE: readonly TerraWorkspacePanelId[] = [
  'live_intel',
  'nearby_cameras',
  'weather_drawer',
  'weather_toast',
  'street_view',
  'area_live_viewer',
  'gods_eye_inspect',
  'camera_directory',
  'street_intel',
  'hazard_counters',
  'globe_status',
  'radar',
  'camera_hover',
  'left_rail',
]

export const TERRA_INTEL_FOCUS_MINIMIZE: readonly TerraWorkspacePanelId[] = [
  'hazard_counters',
  'globe_status',
  'radar',
  'camera_discovery',
  'area_live_controls',
]
