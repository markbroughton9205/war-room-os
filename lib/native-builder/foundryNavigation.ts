/**
 * Foundry ↔ War Room home navigation.
 * Always relative installed routes. Never localhost:3000 / :3001. Never history.back().
 */

export const WAR_ROOM_HOME_HREF = '/'
export const FOUNDRY_CANONICAL_PATH = '/war-room/engineering'
export const FOUNDRY_RESUME_STORAGE_KEY = 'war-room-foundry-resume'
export const FOUNDRY_HOME_SHORTCUT_HINT = 'Alt+H'
/** Exact Commander-saved Foundry app icon. Do not regenerate or substitute. */
export const FOUNDRY_HOME_ICON_SRC = '/foundry/foundry-icon.png'

export type FoundryResumeState = {
  basePath: string
  workspace?: string | null
  session?: string | null
  mission?: string | null
}

export type FoundryResumeStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function memoryResumeStorage(seed?: Record<string, string>): FoundryResumeStorage {
  const map = new Map<string, string>(Object.entries(seed ?? {}))
  return {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value)
    },
  }
}

function browserStorage(): FoundryResumeStorage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

export function isInstalledRelativeHref(href: string): boolean {
  if (!href.startsWith('/') || href.startsWith('//')) return false
  if (/localhost:\d+/i.test(href)) return false
  if (/:(3000|3001)\b/.test(href)) return false
  if (/^https?:/i.test(href)) return false
  return true
}

export function buildFoundryResumeHref(state: FoundryResumeState): string {
  const base = state.basePath?.startsWith('/') ? state.basePath.split('?')[0] : FOUNDRY_CANONICAL_PATH
  const params = new URLSearchParams()
  if (state.workspace) params.set('workspace', state.workspace)
  if (state.session) params.set('session', state.session)
  if (state.mission) params.set('mission', state.mission)
  const query = params.toString()
  const href = query ? `${base}?${query}` : base
  return isInstalledRelativeHref(href) ? href : FOUNDRY_CANONICAL_PATH
}

export function persistFoundryResume(state: FoundryResumeState, storage: FoundryResumeStorage | null = browserStorage()): void {
  if (!storage) return
  storage.setItem(FOUNDRY_RESUME_STORAGE_KEY, JSON.stringify({
    basePath: FOUNDRY_CANONICAL_PATH,
    workspace: state.workspace ?? null,
    session: state.session ?? null,
    mission: state.mission ?? null,
  } satisfies FoundryResumeState))
}

export function readFoundryResume(storage: FoundryResumeStorage | null = browserStorage()): FoundryResumeState | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(FOUNDRY_RESUME_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as FoundryResumeState
    if (!parsed || typeof parsed !== 'object') return null
    return {
      basePath: FOUNDRY_CANONICAL_PATH,
      workspace: typeof parsed.workspace === 'string' ? parsed.workspace : null,
      session: typeof parsed.session === 'string' ? parsed.session : null,
      mission: typeof parsed.mission === 'string' ? parsed.mission : null,
    }
  } catch {
    return null
  }
}

export function readFoundryResumeHref(storage: FoundryResumeStorage | null = browserStorage()): string {
  const saved = readFoundryResume(storage)
  return saved ? buildFoundryResumeHref(saved) : FOUNDRY_CANONICAL_PATH
}

export function matchesHomeShortcut(event: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; key: string }): boolean {
  return event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'h'
}
