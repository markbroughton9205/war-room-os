/**
 * Higher Vision Studios ↔ War Room home navigation.
 * Always relative installed routes. Never localhost:3000 / :3001. Never history.back().
 * Canonical user-facing name: HIGHER VISION STUDIOS. Internal kernel: media-command.
 */
import {
  WAR_ROOM_HOME_HREF,
  isInstalledRelativeHref,
  matchesHomeShortcut,
} from '@/lib/native-builder/foundryNavigation'

export { WAR_ROOM_HOME_HREF, isInstalledRelativeHref, matchesHomeShortcut }

export const HVS_DISPLAY_NAME = 'HIGHER VISION STUDIOS'
export const HVS_TAGLINE = 'AI-FIRST FILM & MEDIA PRODUCTION'
export const HVS_KERNEL_NAMESPACE = 'media-command'
export const HVS_CANONICAL_PATH = '/higher-vision-studios'
/** Commander-saved Higher Vision Studios icon (television + tree). Archived; homepage uses HvsStudioMark. */
export const HVS_HOME_ICON_SRC = '/hvs/higher-vision-studios-icon.png'
/** Light-loop derived from the archived PNG. Not used as the homepage card identity. */
export const HVS_HOME_ICON_ANIMATED_SRC = '/hvs/higher-vision-studios-icon-animated.webp'
export const HVS_HOME_ICON_ANIMATED_GIF_SRC = '/hvs/higher-vision-studios-icon-animated.gif'
/**
 * Commander-provided Higher Vision Studios create-page artwork.
 * Source file (untouched): `/home/chosenone/higher vision studio background.png`
 * Repo original: `public/hvs/higher-vision-studio-background-original.png`
 * Byte-identical archive: `public/hvs/higher-vision-studio-background.png`
 * Live presentation uses derived desktop/mobile WebP variants. The source art is not replaced.
 */
export const HVS_CREATE_BACKGROUND_SRC = '/hvs/higher-vision-studio-background.png'
export const HVS_CREATE_BACKGROUND_ORIGINAL_SRC = '/hvs/higher-vision-studio-background-original.png'
export const HVS_CREATE_BACKGROUND_DESKTOP_SRC = '/hvs/higher-vision-studio-background-desktop.webp'
export const HVS_CREATE_BACKGROUND_MOBILE_SRC = '/hvs/higher-vision-studio-background-mobile.webp'
export const HVS_RESUME_STORAGE_KEY = 'war-room-hvs-resume'
export const HVS_HOME_SHORTCUT_HINT = 'Alt+H'
export const HVS_SLICE = 'HVS-P1-SLICE-G'
export const HVS_PROGRAM_WAVE = 'HVS-WAVE-9'
export const HVS_AI_FIRST_SLICE = 'HVS-AI-FIRST-UX'
export const HVS_AI_PRODUCER_SLICE = 'HVS-AI-PRODUCER-S2'
export const HVS_AI_PRODUCER_SLICE3 = 'HVS-AI-PRODUCER-S3'
export const HVS_AI_PRODUCER_SLICE4 = 'HVS-AI-PRODUCER-S4'
export const HVS_3D_DIRECTOR_SLICE = 'HVS-3D-DIRECTOR-FOUNDATION'
export const HVS_CINEMA_DIRECTOR_SLICE = 'HVS-CINEMA-DIRECTOR-FOUNDATION'
export const HVS_DIRECTOR_ORCHESTRATION_SLICE = 'HVS-DIRECTOR-ORCHESTRATION'
export const HVS_DIGITAL_HUMAN_SLICE = 'HVS-DIGITAL-HUMAN-FOUNDATION'

export type HvsSectionId =
  | 'home'
  | 'projects'
  | 'editor'
  | 'studio'
  | 'library'
  | 'generate'
  | 'ai-director'
  | '3d-director'
  | 'video-intelligence'
  | 'ai-video'
  | 'ai-images'
  | 'storyboards'
  | 'scripts'
  | 'characters'
  | 'camera'
  | 'tracking'
  | 'effects'
  | 'filters'
  | 'themes'
  | 'color'
  | 'audio'
  | 'voice'
  | 'music'
  | 'render-queue'
  | 'destruction-previs'

export const HVS_PRIMARY_SECTION_IDS: HvsSectionId[] = [
  'home',
  'projects',
  'library',
]

export const HVS_SECTIONS: Array<{ id: HvsSectionId; label: string; href: string; slice0: 'live' | 'boundary' }> = [
  { id: 'home', label: 'Create', href: HVS_CANONICAL_PATH, slice0: 'live' },
  { id: 'projects', label: 'My Projects', href: `${HVS_CANONICAL_PATH}/projects`, slice0: 'live' },
  { id: 'editor', label: 'Advanced Editor', href: `${HVS_CANONICAL_PATH}/studio`, slice0: 'live' },
  { id: 'library', label: 'Assets', href: `${HVS_CANONICAL_PATH}/library`, slice0: 'live' },
  { id: 'generate', label: 'Generate', href: `${HVS_CANONICAL_PATH}/generate`, slice0: 'boundary' },
  { id: 'video-intelligence', label: 'Video Intelligence', href: `${HVS_CANONICAL_PATH}/video-intelligence`, slice0: 'boundary' },
  { id: 'render-queue', label: 'Render Queue', href: `${HVS_CANONICAL_PATH}/render-queue`, slice0: 'live' },
  { id: 'ai-director', label: 'AI Director', href: `${HVS_CANONICAL_PATH}/ai-director`, slice0: 'live' },
  { id: '3d-director', label: '3D Director', href: `${HVS_CANONICAL_PATH}/3d-director`, slice0: 'live' },
  { id: 'ai-video', label: 'AI Video', href: `${HVS_CANONICAL_PATH}/ai-video`, slice0: 'boundary' },
  { id: 'ai-images', label: 'AI Images', href: `${HVS_CANONICAL_PATH}/ai-images`, slice0: 'boundary' },
  { id: 'storyboards', label: 'Storyboards', href: `${HVS_CANONICAL_PATH}/storyboards`, slice0: 'boundary' },
  { id: 'scripts', label: 'Scripts', href: `${HVS_CANONICAL_PATH}/scripts`, slice0: 'boundary' },
  { id: 'characters', label: 'Characters', href: `${HVS_CANONICAL_PATH}/characters`, slice0: 'live' },
  { id: 'camera', label: 'Cinema Director', href: `${HVS_CANONICAL_PATH}/camera`, slice0: 'live' },
  { id: 'destruction-previs', label: 'Destruction Previs', href: `${HVS_CANONICAL_PATH}/destruction-previs`, slice0: 'live' },
  { id: 'tracking', label: 'Tracking', href: `${HVS_CANONICAL_PATH}/tracking`, slice0: 'live' },
  { id: 'effects', label: 'Effects', href: `${HVS_CANONICAL_PATH}/effects`, slice0: 'boundary' },
  { id: 'filters', label: 'Filters', href: `${HVS_CANONICAL_PATH}/filters`, slice0: 'live' },
  { id: 'themes', label: 'Themes', href: `${HVS_CANONICAL_PATH}/themes`, slice0: 'live' },
  { id: 'color', label: 'Color', href: `${HVS_CANONICAL_PATH}/color`, slice0: 'live' },
  { id: 'audio', label: 'Audio', href: `${HVS_CANONICAL_PATH}/audio`, slice0: 'live' },
  { id: 'voice', label: 'Voice', href: `${HVS_CANONICAL_PATH}/voice`, slice0: 'boundary' },
  { id: 'music', label: 'Music / SFX', href: `${HVS_CANONICAL_PATH}/music`, slice0: 'live' },
]

export const HVS_PRIMARY_SECTIONS = HVS_SECTIONS.filter(section => HVS_PRIMARY_SECTION_IDS.includes(section.id))
export const HVS_TOOL_SECTIONS = HVS_SECTIONS.filter(section => !HVS_PRIMARY_SECTION_IDS.includes(section.id))

export type HvsResumeState = {
  basePath: string
  projectId?: string | null
  section?: HvsSectionId | null
  playheadSec?: number | null
  selectedClipId?: string | null
}

export type HvsResumeStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function memoryHvsResumeStorage(seed?: Record<string, string>): HvsResumeStorage {
  const map = new Map<string, string>(Object.entries(seed ?? {}))
  return {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value)
    },
  }
}

function browserStorage(): HvsResumeStorage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

export function buildHvsResumeHref(state: HvsResumeState): string {
  const base = state.basePath?.startsWith('/') ? state.basePath.split('?')[0] : HVS_CANONICAL_PATH
  const params = new URLSearchParams()
  if (state.projectId) params.set('project', state.projectId)
  if (state.section) params.set('section', state.section)
  const query = params.toString()
  const href = query ? `${base}?${query}` : base
  return isInstalledRelativeHref(href) ? href : HVS_CANONICAL_PATH
}

export function persistHvsResume(state: HvsResumeState, storage: HvsResumeStorage | null = browserStorage()): void {
  if (!storage) return
  storage.setItem(HVS_RESUME_STORAGE_KEY, JSON.stringify({
    basePath: state.basePath?.startsWith('/') ? state.basePath.split('?')[0] : HVS_CANONICAL_PATH,
    projectId: state.projectId ?? null,
    section: state.section ?? null,
    playheadSec: typeof state.playheadSec === 'number' ? state.playheadSec : null,
    selectedClipId: typeof state.selectedClipId === 'string' ? state.selectedClipId : null,
  } satisfies HvsResumeState))
}

export function readHvsResume(storage: HvsResumeStorage | null = browserStorage()): HvsResumeState | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(HVS_RESUME_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as HvsResumeState
    if (!parsed || typeof parsed !== 'object') return null
    return {
      basePath: typeof parsed.basePath === 'string' && parsed.basePath.startsWith('/') ? parsed.basePath : HVS_CANONICAL_PATH,
      projectId: typeof parsed.projectId === 'string' ? parsed.projectId : null,
      section: typeof parsed.section === 'string' ? parsed.section as HvsSectionId : null,
      playheadSec: typeof parsed.playheadSec === 'number' ? parsed.playheadSec : null,
      selectedClipId: typeof parsed.selectedClipId === 'string' ? parsed.selectedClipId : null,
    }
  } catch {
    return null
  }
}

export function readHvsResumeHref(storage: HvsResumeStorage | null = browserStorage()): string {
  const saved = readHvsResume(storage)
  return saved ? buildHvsResumeHref(saved) : HVS_CANONICAL_PATH
}

export function hvsProjectHref(projectId: string, view: 'overview' | 'editor' = 'overview'): string {
  const base = `${HVS_CANONICAL_PATH}/projects/${encodeURIComponent(projectId)}`
  return view === 'editor' ? `${base}/editor` : base
}

export function hvsStudioHref(projectId?: string | null): string {
  return projectId ? hvsProjectHref(projectId, 'editor') : `${HVS_CANONICAL_PATH}/studio`
}

export function hvsCreateHref(projectId?: string | null): string {
  return projectId
    ? `${HVS_CANONICAL_PATH}/projects/${encodeURIComponent(projectId)}/create`
    : HVS_CANONICAL_PATH
}

export function hvsCharactersHref(projectId?: string | null): string {
  const base = `${HVS_CANONICAL_PATH}/characters`
  if (!projectId) return base
  const href = `${base}?project=${encodeURIComponent(projectId)}`
  return isInstalledRelativeHref(href) ? href : base
}

export function isHvsStudioPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  return (
    pathname === `${HVS_CANONICAL_PATH}/studio`
    || pathname === `${HVS_CANONICAL_PATH}/editor`
    || (pathname.includes('/projects/') && (pathname.endsWith('/editor') || pathname.endsWith('/cut')))
    || pathname.startsWith(`${HVS_CANONICAL_PATH}/ai-director`)
    || pathname.startsWith(`${HVS_CANONICAL_PATH}/3d-director`)
  )
}

export function isHvsSectionActive(sectionId: HvsSectionId, pathname: string): boolean {
  if (sectionId === 'home') return pathname === HVS_CANONICAL_PATH
  if (sectionId === 'editor' || sectionId === 'studio') return isHvsStudioPath(pathname)
  if (sectionId === 'projects') {
    return pathname === `${HVS_CANONICAL_PATH}/projects`
      || (pathname.startsWith(`${HVS_CANONICAL_PATH}/projects/`) && !pathname.endsWith('/editor'))
  }
  const section = HVS_SECTIONS.find(item => item.id === sectionId)
  if (!section) return false
  return pathname === section.href || pathname.startsWith(`${section.href}/`)
}

export function isMediaCommandEnabled(): boolean {
  return process.env.MEDIA_COMMAND_ENABLED !== 'false'
}
