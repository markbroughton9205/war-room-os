/**
 * Client-safe Foundry workspace identity. Path-based, never name-based.
 * Do not import Node fs/git from this module — FoundryShell is a client component.
 */
export const WAR_ROOM_CANONICAL_WORKSPACE_ID = 'war-room-self'
export const DEFAULT_CANONICAL_WAR_ROOM_SOURCE = 'C:\\Users\\markb\\Documents\\Codex\\war-room-os'
export const DEFAULT_GENERATED_PROJECTS_ROOT = 'C:\\Users\\markb\\WarRoomProjects'

export type FoundryWorkspaceType =
  | 'WAR_ROOM_CANONICAL_SOURCE'
  | 'GENERATED_PROJECT'
  | 'INSTALLED_RUNTIME'
  | 'EXTERNAL_PROJECT'

export type FoundryMissionWorkspaceBinding = {
  workspace_id: string
  workspace_type: FoundryWorkspaceType
  canonical_path: string
  repo_root: string
  git_root: string
  git_head_at_start: string | null
  git_branch: string | null
  source_fingerprint: string
  installed_runtime_relationship: 'source_not_installed'
  installed_sha: string | null
}

export type FoundryWorkspacePresentation = {
  id: string
  root: string
  workspaceType: FoundryWorkspaceType
  displayTitle: string
  displayKind: string
  pathLabel: string
}

export type FoundryMissionWorkspaceResolution = {
  kind: 'canonical' | 'selected' | 'create' | 'confirm'
  workspaceId?: string
  intent?: 'WAR_ROOM_SELF_EDIT_REQUEST'
  reason: string
  confirmTarget?: string
}

export function normalizeFsPath(input: string): string {
  return input
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .replace(/^([a-z]):/i, (_, d: string) => `${d.toUpperCase()}:`)
}

export function isPathInside(child: string, root: string): boolean {
  const c = normalizeFsPath(child).toLowerCase()
  const r = normalizeFsPath(root).toLowerCase()
  return c === r || c.startsWith(`${r}/`)
}

export function classifyWorkspaceRoot(
  root: string,
  opts?: { canonicalRoot?: string; projectsRoot?: string; installedRoots?: string[] },
): FoundryWorkspaceType {
  const n = normalizeFsPath(root)
  const canonical = normalizeFsPath(opts?.canonicalRoot ?? DEFAULT_CANONICAL_WAR_ROOM_SOURCE)
  const projects = normalizeFsPath(opts?.projectsRoot ?? DEFAULT_GENERATED_PROJECTS_ROOT)
  const installed = (opts?.installedRoots ?? []).map(normalizeFsPath)
  if (n.toLowerCase() === canonical.toLowerCase()) return 'WAR_ROOM_CANONICAL_SOURCE'
  if (installed.some(item => n.toLowerCase() === item.toLowerCase() || isPathInside(n, item))) return 'INSTALLED_RUNTIME'
  if (n.toLowerCase() === projects.toLowerCase() || isPathInside(n, projects)) return 'GENERATED_PROJECT'
  return 'EXTERNAL_PROJECT'
}

export function presentFoundryWorkspace(input: {
  id: string
  root: string
  label?: string
  name?: string
  canonicalRoot?: string
  projectsRoot?: string
  installedRoots?: string[]
}): FoundryWorkspacePresentation {
  const workspaceType = classifyWorkspaceRoot(input.root, {
    canonicalRoot: input.canonicalRoot,
    projectsRoot: input.projectsRoot,
    installedRoots: input.installedRoots,
  })
  const basename = input.root.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) || input.root
  if (workspaceType === 'WAR_ROOM_CANONICAL_SOURCE') {
    return {
      id: input.id,
      root: input.root,
      workspaceType,
      displayTitle: 'WAR ROOM OS',
      displayKind: 'Canonical Source',
      pathLabel: input.root,
    }
  }
  if (workspaceType === 'INSTALLED_RUNTIME') {
    return {
      id: input.id,
      root: input.root,
      workspaceType,
      displayTitle: 'Installed War Room',
      displayKind: 'Installed Runtime',
      pathLabel: input.root,
    }
  }
  return {
    id: input.id,
    root: input.root,
    workspaceType,
    displayTitle: input.label?.trim() || input.name?.trim() || basename,
    displayKind: workspaceType === 'GENERATED_PROJECT' ? 'Generated Project' : 'External Project',
    pathLabel: input.root,
  }
}

export function collisionSafeWorkspaceKey(root: string, opts?: { canonicalRoot?: string; projectsRoot?: string }): string {
  return `${classifyWorkspaceRoot(root, opts)}:${normalizeFsPath(root).toLowerCase()}`
}

const SELF_EDIT = /\b(war\s*room(\s+os)?|council\s+ui|terra(\s+ui)?|installed\s+war\s*room|canonical\s+source|the\s+foundry|foundry\s+(ui|shell|itself|visual|workspace|navigation|look|redesign|cyberpunk))\b/i
const FOUNDRY_UI_EDIT = /\bfoundry\b.{0,80}\b(ui|visual|redesign|cyberpunk|matrix|look and feel|interface|shell)\b|\brework the foundry\b/i
const NAME_ONLY = /(^|[^\w.-])war-room-os([^\w.-]|$)/i

export function isWarRoomSelfEditRequest(text: string): boolean {
  return SELF_EDIT.test(text) || FOUNDRY_UI_EDIT.test(text)
}

export function selfEditIsCertain(text: string): boolean {
  return isWarRoomSelfEditRequest(text)
}

export function resolveFoundryMissionWorkspace(input: {
  request: string
  requestedWorkspaceId?: string | null
  requestedWorkspaceType?: FoundryWorkspaceType | null
  generatedCollisionExists?: boolean
  confirmedWorkspaceId?: string | null
}): FoundryMissionWorkspaceResolution {
  if (input.confirmedWorkspaceId) {
    return {
      kind: 'selected',
      workspaceId: input.confirmedWorkspaceId,
      reason: 'Commander confirmed the target workspace.',
    }
  }
  if (isWarRoomSelfEditRequest(input.request)) {
    return {
      kind: 'canonical',
      workspaceId: WAR_ROOM_CANONICAL_WORKSPACE_ID,
      intent: 'WAR_ROOM_SELF_EDIT_REQUEST',
      reason: 'WAR_ROOM_SELF_EDIT_REQUEST targets canonical War Room source.',
    }
  }
  if (NAME_ONLY.test(input.request) && input.generatedCollisionExists) {
    return {
      kind: 'confirm',
      reason: 'Name war-room-os is ambiguous between canonical source and a generated project.',
      confirmTarget: 'War Room Canonical Source',
    }
  }
  if (input.requestedWorkspaceId) {
    return {
      kind: 'selected',
      workspaceId: input.requestedWorkspaceId,
      reason: 'Using Commander-selected workspace.',
    }
  }
  return { kind: 'create', reason: 'New generated project.' }
}

export function missionWorkspaceMismatch(
  binding: Pick<FoundryMissionWorkspaceBinding, 'repo_root' | 'workspace_type'>,
  activeRoot: string,
): string | null {
  if (normalizeFsPath(binding.repo_root).toLowerCase() !== normalizeFsPath(activeRoot).toLowerCase()) {
    return `Mission is bound to ${binding.repo_root} (${binding.workspace_type}) and cannot switch to ${activeRoot}.`
  }
  return null
}

export function assertPathInsideBoundWorkspace(boundRoot: string, candidate: string): { ok: true } | { ok: false; reason: string } {
  const root = normalizeFsPath(boundRoot)
  const abs = /^(?:[A-Za-z]:)?\//.test(candidate.replace(/\\/g, '/'))
    ? normalizeFsPath(candidate)
    : normalizeFsPath(`${boundRoot}/${candidate}`)
  if (isPathInside(abs, root)) return { ok: true }
  return { ok: false, reason: `Refusing path outside bound workspace ${boundRoot}: ${candidate}` }
}
