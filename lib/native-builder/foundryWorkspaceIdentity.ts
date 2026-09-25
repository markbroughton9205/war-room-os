/**
 * Foundry workspace identity. Path-based, never name-based.
 * Generated `WarRoomProjects\war-room-os` is not War Room source.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { resolveBaseRepoRoot } from '@/lib/repo/paths'
import {
  classifyWorkspaceRoot as classifyByNormalizedPath,
  presentFoundryWorkspace as presentCore,
  type FoundryMissionWorkspaceBinding,
} from './foundryWorkspaceIdentityCore'

export {
  WAR_ROOM_CANONICAL_WORKSPACE_ID,
  DEFAULT_CANONICAL_WAR_ROOM_SOURCE,
  DEFAULT_GENERATED_PROJECTS_ROOT,
  collisionSafeWorkspaceKey,
  isWarRoomSelfEditRequest,
  selfEditIsCertain,
  resolveFoundryMissionWorkspace,
  missionWorkspaceMismatch,
  assertPathInsideBoundWorkspace,
  presentFoundryWorkspace,
  type FoundryWorkspaceType,
  type FoundryMissionWorkspaceBinding,
  type FoundryWorkspacePresentation,
  type FoundryMissionWorkspaceResolution,
} from './foundryWorkspaceIdentityCore'

export function getGeneratedProjectsRoot(): string {
  const env = process.env.WAR_ROOM_PROJECTS_ROOT?.trim()
  if (env) return path.resolve(env)
  if (process.platform === 'win32') return 'C:\\Users\\markb\\WarRoomProjects'
  return path.join(os.homedir(), 'WarRoomProjects')
}

function pathInside(child: string, root: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(child))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

export function getCanonicalWarRoomSourceRoot(): string {
  const env = process.env.WAR_ROOM_CANONICAL_SOURCE?.trim()
  if (env) return path.resolve(env)
  const foundryMarker = path.join('components', 'war-room', 'foundry', 'FoundryShell.tsx')
  const knownCandidates = [
    'C:\\Users\\markb\\Documents\\Codex\\war-room-os',
    path.join(os.homedir(), 'Documents', 'Codex', 'war-room-os'),
    path.join(os.homedir(), 'Codex', 'war-room-os'),
    '/home/chosenone/Codex/war-room-os',
  ]
  const knownExisting = knownCandidates.map(item => path.resolve(item)).find(item => existsSync(path.join(item, foundryMarker)))
  const base = resolveBaseRepoRoot()
  const projects = getGeneratedProjectsRoot()
  const normalizedBase = base.replace(/\\/g, '/')
  const looksInstalled = /\/\.local\/opt\/.*\/resources\/runtime\/ui$/i.test(normalizedBase)
    || /\/Programs\/War Room OS/i.test(normalizedBase)
    || /\/opt\/War Room OS/i.test(normalizedBase)
  if (looksInstalled && knownExisting) return knownExisting
  if (pathInside(base, projects)) {
    return knownExisting ?? base
  }
  if (!looksInstalled && existsSync(path.join(base, foundryMarker))) return base
  if (knownExisting) return knownExisting
  return base
}

function defaultInstalledRoots(): string[] {
  const roots: string[] = [path.join(os.homedir(), '.local', 'opt')]
  const local = process.env.LOCALAPPDATA?.trim()
  if (local) {
    roots.push(
      path.join(local, 'Programs', 'War Room OS'),
      path.join(local, 'Programs', 'WARROO~1'),
    )
  }
  return roots
}

export function classifyWorkspaceRoot(
  root: string,
  opts?: { canonicalRoot?: string; projectsRoot?: string; installedRoots?: string[] },
) {
  return classifyByNormalizedPath(path.resolve(root), {
    canonicalRoot: path.resolve(opts?.canonicalRoot ?? getCanonicalWarRoomSourceRoot()),
    projectsRoot: path.resolve(opts?.projectsRoot ?? getGeneratedProjectsRoot()),
    installedRoots: (opts?.installedRoots ?? defaultInstalledRoots()).map(item => path.resolve(item)),
  })
}

export function decorateWorkspaceIdentity(input: {
  id: string
  root: string
  label?: string
  name?: string
}) {
  return presentCore({
    ...input,
    canonicalRoot: getCanonicalWarRoomSourceRoot(),
    projectsRoot: getGeneratedProjectsRoot(),
    installedRoots: defaultInstalledRoots(),
  })
}

export function hasGeneratedWarRoomOsNameCollision(workspaces: { root: string }[]): boolean {
  const canonical = path.resolve(getCanonicalWarRoomSourceRoot())
  return workspaces.some(w => {
    const type = classifyWorkspaceRoot(w.root)
    return type === 'GENERATED_PROJECT'
      && path.basename(w.root).toLowerCase() === 'war-room-os'
      && path.resolve(w.root).toLowerCase() !== canonical.toLowerCase()
  })
}

function gitValue(root: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd: root,
      timeout: 8000,
      windowsHide: true,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null
  } catch {
    return null
  }
}

export function readInstalledRuntimeSha(): string | null {
  for (const root of defaultInstalledRoots()) {
    const meta = path.join(root, 'resources', 'runtime', 'ui', '.next', 'build-meta.json')
    try {
      if (!existsSync(meta)) continue
      const parsed = JSON.parse(readFileSync(meta, 'utf8')) as { gitSha?: string; gitShort?: string }
      return parsed.gitSha || parsed.gitShort || null
    } catch {
      /* try next candidate */
    }
  }
  if (classifyWorkspaceRoot(process.cwd()) !== 'INSTALLED_RUNTIME') return null
  try {
    const local = path.join(process.cwd(), '.next', 'build-meta.json')
    if (!existsSync(local)) return null
    const parsed = JSON.parse(readFileSync(local, 'utf8')) as { gitSha?: string; gitShort?: string }
    return parsed.gitSha || parsed.gitShort || null
  } catch {
    return null
  }
}

export function describeSourceWorkspaceState(root: string): { head: string | null; branch: string | null; dirty: boolean } {
  const porcelain = gitValue(root, ['status', '--porcelain'])
  return {
    head: gitValue(root, ['rev-parse', 'HEAD']),
    branch: gitValue(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
    dirty: Boolean(porcelain && porcelain.length > 0),
  }
}

export function snapshotFoundryWorkspaceBinding(input: {
  workspaceId: string
  root: string
  canonicalRoot?: string
  projectsRoot?: string
}): FoundryMissionWorkspaceBinding {
  const canonical = input.canonicalRoot ?? getCanonicalWarRoomSourceRoot()
  const workspaceType = classifyWorkspaceRoot(input.root, {
    canonicalRoot: canonical,
    projectsRoot: input.projectsRoot,
  })
  const gitRoot = gitValue(input.root, ['rev-parse', '--show-toplevel']) || input.root
  const state = describeSourceWorkspaceState(input.root)
  const fingerprint = createHash('sha256')
    .update(`${workspaceType}\n${path.resolve(input.root)}\n${state.head ?? 'no-head'}`)
    .digest('hex')
    .slice(0, 16)
  return {
    workspace_id: input.workspaceId,
    workspace_type: workspaceType,
    canonical_path: canonical,
    repo_root: input.root,
    git_root: gitRoot,
    git_head_at_start: state.head,
    git_branch: state.branch,
    source_fingerprint: fingerprint,
    installed_runtime_relationship: 'source_not_installed',
    installed_sha: readInstalledRuntimeSha(),
  }
}

export const FOUNDRY_UI_SOURCE_MAP = {
  shell: 'components/war-room/foundry/FoundryShell.tsx',
  homeNav: 'components/war-room/foundry/FoundryHomeNav.tsx',
  contextMenu: 'components/war-room/foundry/FoundryContextMenu.tsx',
  entryLink: 'components/war-room/foundry/FoundryEntryLink.tsx',
  homeAppIcon: 'components/war-room/foundry/FoundryHomeAppIcon.tsx',
  inspector: 'components/war-room/builder/BuilderWorkspace.tsx',
  canonicalRoute: 'app/war-room/engineering/page.tsx',
  aliasCodeOperator: 'app/war-room/code-operator/page.tsx',
  aliasBuilder: 'app/builder/page.tsx',
  styles: 'components/war-room/foundry/FoundryShell.tsx',
  globalTokens: 'app/globals.css',
  matrixHome: 'components/MatrixCodeRain.tsx',
  matrixBackground: 'components/war-room/MatrixBackground.tsx',
  matrixTokens: 'lib/ui/matrixRuntimeColors.ts',
  uxContract: 'lib/native-builder/foundryUxContract.ts',
  visualState: 'lib/native-builder/foundryVisualState.ts',
  terraBackground: 'components/war-room/foundry/FoundryTerraBackground.tsx',
  terraContext: 'lib/native-builder/foundryTerraContext.ts',
} as const

export const FOUNDRY_CANONICAL_UI_FILES = Object.values(FOUNDRY_UI_SOURCE_MAP)
