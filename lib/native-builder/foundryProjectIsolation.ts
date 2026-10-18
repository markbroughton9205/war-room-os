/**
 * Application Builder project isolation.
 * New apps live under ~/FoundryProjects/<project-id>/ — never throughout the War Room repo.
 */
import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { resolveBaseRepoRoot } from '@/lib/repo/paths'
import { logWarRoomRepoAudit } from '@/lib/war-room/repoAudit'
import { classifyArgv, classifyCommandCwd } from './commandPolicy'
import { recordBoundaryViolation } from './boundaryLog'
import { foundryDataHierarchy } from './foundryPaths'
import { assertResolvedArgvNotDangerousEquivalent } from './validationRunner'
import {
  decorateProjectVisibility,
} from './foundryProjectVisibility'
import {
  getEngineerAllowedRoots,
  isPathInsideRoot,
  type WorkspaceRecord,
} from './workspaceRegistry'
import { detachChildFromWrapper, registerActiveProcess } from './processRegistry'
import { registerProjectProcess, type FoundryProjectProcessType } from './foundryProjectProcessRegistry'
import type { FoundryMissionRecord } from './foundryMissionTypes'
import {
  APPLICATION_BUILDER_GOVERNANCE,
  type FoundryApplicationMemory,
  type FoundryNewProjectRecord,
  type FoundryProjectType,
} from './foundryApplicationBuilderTypes'
import { posixRel, REFUSED_OUTSIDE_WRITE_SET, REFUSED_PROTECTED_SUBSYSTEM } from './foundryMissionWriteSet'

const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/
const SECRET_PATTERN = /(?:api[_-]?key|secret|password|private[_-]?key|bearer\s+[a-z0-9._-]{12,}|sk_live_|sk_test_[a-z0-9]{8,})/i

export function getFoundryProjectsRoot(): string {
  const env = process.env.FOUNDRY_PROJECTS_ROOT?.trim()
  if (env) return path.resolve(env)
  return path.join(os.homedir(), 'FoundryProjects')
}

/** Installed Electron uses execPath=war-room-os and a PATH without `node`. */
export function foundryNodeExecutable(): string {
  const exec = process.execPath
  const base = path.basename(exec).replace(/\.exe$/i, '').toLowerCase()
  if (base === 'node') return exec
  const candidates = [
    process.env.npm_node_execpath?.trim(),
    '/usr/bin/node',
    '/usr/local/bin/node',
  ].filter((item): item is string => Boolean(item))
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return 'node'
}

export function isFoundryProjectsTempRoot(root = getFoundryProjectsRoot()): boolean {
  return /wr-engineer-e2e|wr-foundry-e2e|(?:^|[\\/])(?:tmp|temp)[\\/]|appdata[\\/]local[\\/]temp/i.test(root)
}

export async function ensureFoundryProjectsRoot(): Promise<string> {
  const root = getFoundryProjectsRoot()
  await mkdir(root, { recursive: true })
  return realpath(root)
}

export function applicationBuilderMetaDir(): string {
  const dir = path.join(foundryDataHierarchy().foundryRoot, 'application-builder')
  return dir
}

export function isApplicationBuilderMission(mission: Pick<FoundryMissionRecord, 'kind' | 'capabilityLane' | 'userRequest'>): boolean {
  return mission.kind === 'app_builder' || mission.capabilityLane === 'APPLICATION_BUILDER'
}

export function slugProjectName(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return slug || 'foundry-project'
}

export async function assertInsideFoundryProject(projectRoot: string, candidate: string): Promise<{ ok: true; abs: string; rel: string } | { ok: false; code: string; error: string }> {
  const root = path.resolve(projectRoot)
  const abs = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(root, candidate)
  const rel = path.relative(root, abs).split(path.sep).join('/')
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    await recordBoundaryViolation({ action: 'application-builder-write', attemptedPath: abs, reason: 'outside project root' })
    return { ok: false, code: REFUSED_OUTSIDE_WRITE_SET, error: `${REFUSED_OUTSIDE_WRITE_SET}: path is outside the application project root.` }
  }
  if (!rel) {
    return { ok: true, abs, rel: '.' }
  }
  const warRoom = path.resolve(resolveBaseRepoRoot())
  if (isPathInsideRoot(abs, warRoom)) {
    return { ok: false, code: REFUSED_PROTECTED_SUBSYSTEM, error: `${REFUSED_PROTECTED_SUBSYSTEM}: Application Builder cannot write War Room, Terra, or WRIM.` }
  }
  const projectsRoot = path.resolve(getFoundryProjectsRoot())
  if (!isPathInsideRoot(abs, projectsRoot)) {
    return { ok: false, code: REFUSED_OUTSIDE_WRITE_SET, error: `${REFUSED_OUTSIDE_WRITE_SET}: path is not under FoundryProjects.` }
  }
  const projectRel = path.relative(projectsRoot, abs).split(path.sep).join('/')
  const otherProject = projectRel.split('/')[0]
  const thisProject = path.basename(root)
  if (otherProject && otherProject !== thisProject) {
    return { ok: false, code: REFUSED_OUTSIDE_WRITE_SET, error: `${REFUSED_OUTSIDE_WRITE_SET}: cannot write another Foundry project (${otherProject}).` }
  }
  return { ok: true, abs, rel: posixRel(rel) }
}

export function scanForHardcodedSecrets(content: string): string | null {
  if (SECRET_PATTERN.test(content) && !/\.env\.example|placeholder|YOUR_|CHANGE_ME|example\.com/i.test(content)) {
    return 'SECRET_DISCLOSURE: refusing hardcoded credential-like material.'
  }
  return null
}

export async function writeProjectFile(input: {
  projectRoot: string
  relPath: string
  content: string
  reason: string
  missionId: string
}): Promise<{ ok: true; rel: string } | { ok: false; error: string }> {
  const contained = await assertInsideFoundryProject(input.projectRoot, input.relPath)
  if (!contained.ok) return { ok: false, error: contained.error }
  if (/(^|\/)\.env$/i.test(contained.rel) || /(^|\/)\.env\.(local|production|development)$/i.test(contained.rel)) {
    return { ok: false, error: 'SECRET_DISCLOSURE: actual secret files are not writable. Generate .env.example placeholders only.' }
  }
  const secret = scanForHardcodedSecrets(input.content)
  if (secret) return { ok: false, error: secret }
  await mkdir(path.dirname(contained.abs), { recursive: true })
  await writeFile(contained.abs, input.content, 'utf8')
  await logWarRoomRepoAudit('foundry-application-builder: write', {
    missionId: input.missionId,
    path: contained.rel,
    reason: input.reason,
    sha256: createHash('sha256').update(input.content, 'utf8').digest('hex'),
    governance: APPLICATION_BUILDER_GOVERNANCE,
  })
  return { ok: true, rel: contained.rel }
}

export async function runProjectCommand(input: {
  projectRoot: string
  cmd: string
  args: string[]
  missionId: string
  timeoutMs?: number
}): Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number }> {
  const policy = classifyArgv(input.cmd, input.args)
  if (policy.policyClass !== 'SAFE_LOCAL') {
    return { ok: false, stdout: '', stderr: policy.reason, exitCode: 1 }
  }
  const cwdPolicy = classifyCommandCwd(input.projectRoot, input.projectRoot)
  if (cwdPolicy.policyClass !== 'SAFE_LOCAL') {
    return { ok: false, stdout: '', stderr: cwdPolicy.reason, exitCode: 1 }
  }
  const bypass = assertResolvedArgvNotDangerousEquivalent(input.cmd, input.args)
  if (bypass) return { ok: false, stdout: '', stderr: bypass, exitCode: 1 }
  const contained = await assertInsideFoundryProject(input.projectRoot, '.')
  if (!contained.ok) return { ok: false, stdout: '', stderr: contained.error, exitCode: 1 }
  const started = Date.now()
  const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>(resolve => {
    const child = spawn(input.cmd, input.args, {
      cwd: input.projectRoot,
      windowsHide: true,
      shell: false,
      env: { ...process.env, npm_config_audit: 'false' },
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', chunk => { stdout += String(chunk) })
    child.stderr?.on('data', chunk => { stderr += String(chunk) })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
    }, input.timeoutMs ?? 60_000)
    child.on('close', code => {
      clearTimeout(timer)
      resolve({ stdout: stdout.slice(0, 20_000), stderr: stderr.slice(0, 20_000), exitCode: code ?? 1 })
    })
    child.on('error', error => {
      clearTimeout(timer)
      resolve({ stdout, stderr: error.message, exitCode: 1 })
    })
  })
  await logWarRoomRepoAudit('foundry-application-builder: command', {
    missionId: input.missionId,
    cmd: input.cmd,
    args: input.args,
    cwd: input.projectRoot,
    exitCode: result.exitCode,
    durationMs: Date.now() - started,
  })
  return { ok: result.exitCode === 0, ...result }
}

export async function startProjectProcess(input: {
  projectRoot: string
  cmd: string
  args: string[]
  label: string
  missionId: string
  env?: Record<string, string>
  projectId?: string
  port?: number
  processType?: FoundryProjectProcessType
  retainAfterWrapper?: boolean
}): Promise<{ ok: boolean; pid?: number; error?: string; recordId?: string; retained?: boolean }> {
  const policy = classifyArgv(input.cmd, input.args)
  if (policy.policyClass !== 'SAFE_LOCAL') return { ok: false, error: policy.reason }
  const cwdPolicy = classifyCommandCwd(input.projectRoot, input.projectRoot)
  if (cwdPolicy.policyClass !== 'SAFE_LOCAL') return { ok: false, error: cwdPolicy.reason }
  const bypass = assertResolvedArgvNotDangerousEquivalent(input.cmd, input.args)
  if (bypass) return { ok: false, error: bypass }
  const contained = await assertInsideFoundryProject(input.projectRoot, '.')
  if (!contained.ok) return { ok: false, error: contained.error }
  const retain = input.retainAfterWrapper !== false
  const child = spawn(input.cmd, input.args, {
    cwd: input.projectRoot,
    windowsHide: true,
    shell: false,
    detached: process.platform !== 'win32',
    stdio: retain ? 'ignore' : 'pipe',
    env: { ...process.env, ...input.env },
  })
  registerActiveProcess(input.missionId, child, input.label)
  if (typeof child.pid !== 'number') return { ok: false, error: 'Process did not start.' }
  if (retain) detachChildFromWrapper(child)
  let recordId: string | undefined
  if (input.projectId) {
    const record = await registerProjectProcess({
      recordId: `${input.projectId}-${child.pid}`,
      projectId: input.projectId,
      missionId: input.missionId,
      pid: child.pid,
      port: input.port ?? null,
      cwd: input.projectRoot,
      startedAt: new Date().toISOString(),
      processType: input.processType ?? 'preview',
      ownership: retain ? 'released-from-wrapper' : 'owned',
      label: input.label,
      command: input.cmd,
      args: input.args,
    })
    recordId = record.recordId
  }
  await logWarRoomRepoAudit('foundry-application-builder: process.start', {
    missionId: input.missionId,
    pid: child.pid,
    label: input.label,
    cwd: input.projectRoot,
    retain,
  })
  return { ok: true, pid: child.pid, recordId, retained: retain }
}

export async function pickFreeLoopbackPort(preferred = 18780): Promise<number> {
  for (let port = preferred; port < preferred + 20; port += 1) {
    const free = await new Promise<boolean>(resolve => {
      const server = createServer()
      server.once('error', () => resolve(false))
      server.listen(port, '127.0.0.1', () => {
        server.close(() => resolve(true))
      })
    })
    if (free) return port
  }
  return preferred
}

export async function createFoundryApplicationWorkspace(input: {
  name: string
  missionId: string
  projectType?: FoundryProjectType
  label?: string
}): Promise<FoundryNewProjectRecord> {
  const name = input.name.trim()
  if (!NAME_PATTERN.test(name)) {
    throw new Error('Project name must be 1–63 characters: letters, digits, dot, underscore, hyphen.')
  }
  const projectsRoot = await ensureFoundryProjectsRoot()
  const allowed = await getEngineerAllowedRoots()
  let folderName = name
  let dest = path.join(projectsRoot, folderName)
  if (existsSync(dest)) {
    folderName = `${name}-${randomUUID().slice(0, 8)}`
    dest = path.join(projectsRoot, folderName)
  }
  if (existsSync(dest)) {
    throw new Error(`Project directory already exists: ${dest}`)
  }
  await mkdir(dest, { recursive: true })
  const canonical = await realpath(dest)
  if (!allowed.some(root => isPathInsideRoot(canonical, root)) && !isPathInsideRoot(canonical, projectsRoot)) {
    await recordBoundaryViolation({ action: 'create_foundry_project', attemptedPath: canonical, reason: 'outside FoundryProjects' })
    throw new Error('Created project path is outside FoundryProjects.')
  }
  const now = new Date().toISOString()
  const project: FoundryNewProjectRecord = {
    projectId: randomUUID(),
    projectName: input.label?.trim() || folderName,
    projectRoot: canonical,
    missionId: input.missionId,
    projectType: input.projectType ?? 'static_website',
    createdAt: now,
    stack: null,
    requirements: null,
    researchSources: [],
    acceptanceCriteria: [],
    status: 'NEW_PROJECT',
  }
  await writeFile(path.join(canonical, 'commander-facts.json'), `${JSON.stringify({
    workingBrand: folderName,
    projectId: project.projectId,
    identityResolved: false,
  }, null, 2)}\n`, 'utf8')
  await writeFile(path.join(canonical, 'foundry-memory.json'), `${JSON.stringify({ projectId: project.projectId }, null, 2)}\n`, 'utf8')
  await persistProjectIndex(project)
  await logWarRoomRepoAudit('foundry-application-builder: new-project', {
    projectId: project.projectId,
    projectRoot: project.projectRoot,
    missionId: input.missionId,
  })
  return project
}

function indexPath(): string {
  return path.join(applicationBuilderMetaDir(), 'projects.json')
}

async function readProjectIndex(): Promise<FoundryNewProjectRecord[]> {
  try {
    const parsed = JSON.parse(await readFile(indexPath(), 'utf8')) as FoundryNewProjectRecord[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export async function writeProjectIndex(all: FoundryNewProjectRecord[]): Promise<void> {
  await mkdir(applicationBuilderMetaDir(), { recursive: true })
  await writeFile(indexPath(), JSON.stringify(all, null, 2), 'utf8')
}

async function persistProjectIndex(project: FoundryNewProjectRecord): Promise<void> {
  const all = await readProjectIndex()
  const clash = all.find(item => item.projectRoot === project.projectRoot && item.projectId !== project.projectId)
  if (clash) {
    throw new Error(`Project root already indexed as ${clash.projectId}; refusing to rebind identity.`)
  }
  const next = [...all.filter(item => item.projectId !== project.projectId), project]
  await writeProjectIndex(next)
}

export async function listFoundryApplicationProjects(options?: { includeArchived?: boolean }): Promise<FoundryNewProjectRecord[]> {
  const all = await readProjectIndex()
  const root = path.resolve(getFoundryProjectsRoot())
  return all.filter(item => {
    if (!isPathInsideRoot(path.resolve(item.projectRoot), root)) return false
    if (!options?.includeArchived && item.archived === true) return false
    return true
  })
}

export async function findFoundryApplicationProject(projectId: string): Promise<FoundryNewProjectRecord | null> {
  const listed = await listFoundryApplicationProjects()
  return listed.find(item => item.projectId === projectId) ?? null
}

export async function ensureApplicationPreview(input: {
  projectId: string
  missionId?: string
}): Promise<{ ok: boolean; url?: string; started: boolean; alreadyRunning: boolean; error?: string; port?: number }> {
  const { adoptLoopbackPreview, findLiveProjectPreview, probeLoopback } = await import('./foundryProjectProcessRegistry')
  const { preferredPreviewPort } = await import('./foundryCommanderExperience')
  const project = await findFoundryApplicationProject(input.projectId)
  if (!project) return { ok: false, started: false, alreadyRunning: false, error: 'Unknown application project.' }
  const live = await findLiveProjectPreview({ projectId: project.projectId, projectRoot: project.projectRoot })
  if (live?.port) {
    return { ok: true, url: `http://127.0.0.1:${live.port}`, started: false, alreadyRunning: true, port: live.port }
  }
  const preferred = preferredPreviewPort(project)
  if (await probeLoopback(preferred)) {
    return { ok: true, url: `http://127.0.0.1:${preferred}`, started: false, alreadyRunning: true, port: preferred }
  }
  const adopted = await adoptLoopbackPreview({
    projectId: project.projectId,
    projectRoot: project.projectRoot,
    missionId: input.missionId ?? `preview:${project.projectId}`,
    port: preferred,
  })
  if (adopted?.port) {
    return { ok: true, url: `http://127.0.0.1:${adopted.port}`, started: false, alreadyRunning: true, port: adopted.port }
  }
  const server = path.join(project.projectRoot, 'server.mjs')
  if (!existsSync(server)) return { ok: false, started: false, alreadyRunning: false, error: 'No preview server in this project.' }
  const port = await pickFreeLoopbackPort(preferred)
  if (port !== preferred && await probeLoopback(preferred)) {
    return { ok: true, url: `http://127.0.0.1:${preferred}`, started: false, alreadyRunning: true, port: preferred }
  }
  const started = await startProjectProcess({
    projectRoot: project.projectRoot,
    cmd: foundryNodeExecutable(),
    args: ['server.mjs'],
    label: 'foundry-app-preview',
    missionId: input.missionId ?? `preview:${project.projectId}`,
    env: { PORT: String(port) },
    projectId: project.projectId,
    port,
    processType: 'preview',
    retainAfterWrapper: true,
  })
  if (!started.ok) return { ok: false, started: false, alreadyRunning: false, error: started.error ?? 'Preview did not start.' }
  for (let i = 0; i < 10; i += 1) {
    if (await probeLoopback(port)) {
      return { ok: true, url: `http://127.0.0.1:${port}`, started: true, alreadyRunning: false, port }
    }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  return { ok: true, url: `http://127.0.0.1:${port}`, started: true, alreadyRunning: false, port }
}

export async function findContinuableProject(request: string): Promise<FoundryNewProjectRecord | null> {
  const hay = request.toLowerCase()
  const listed = await listFoundryApplicationProjects()
  const scored = listed
    .map(project => {
      const name = `${project.projectName} ${path.basename(project.projectRoot)}`.toLowerCase()
      const tokens = name.split(/[^a-z0-9]+/).filter(t => t.length > 3)
      let hits = tokens.filter(token => hay.includes(token)).length
      if (/transport|truck|freight|box/.test(hay) && /transport|truck|freight|box/.test(name)) hits += 3
      if (/website|site/.test(hay) && /website|transport|truck/.test(name)) hits += 1
      if (/\bcrm\b/.test(hay) && /crm/.test(name)) hits += 8
      if (/follow-up|follow up/.test(hay) && /crm/.test(name)) hits += 4
      if (/\bcrm\b/.test(hay) && /transport|truck|website/.test(name) && !/crm/.test(name)) hits -= 8
      return { project, hits }
    })
    .filter(item => item.hits > 0)
    .sort((a, b) => b.hits - a.hits)
  return scored[0]?.project ?? null
}

export async function writeProjectMemory(projectRoot: string, memory: FoundryApplicationMemory): Promise<void> {
  const contained = await assertInsideFoundryProject(projectRoot, 'foundry-memory.json')
  if (!contained.ok) return
  await writeFile(contained.abs, JSON.stringify(memory, null, 2), 'utf8')
}

export async function readProjectMemoryFile(projectRoot: string): Promise<FoundryApplicationMemory | null> {
  try {
    const contained = await assertInsideFoundryProject(projectRoot, 'foundry-memory.json')
    if (!contained.ok) return null
    return JSON.parse(await readFile(contained.abs, 'utf8')) as FoundryApplicationMemory
  } catch {
    return null
  }
}

export async function listProjectFiles(projectRoot: string): Promise<string[]> {
  const out: string[] = []
  async function walk(dir: string): Promise<void> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.war-room') continue
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(abs)
      else out.push(path.relative(projectRoot, abs).split(path.sep).join('/'))
    }
  }
  await walk(projectRoot)
  return out.sort()
}

export function toWorkspaceRecord(project: FoundryNewProjectRecord): WorkspaceRecord {
  const test = isFoundryProjectsTempRoot(path.dirname(project.projectRoot))
  return decorateProjectVisibility({
    id: project.projectId,
    root: project.projectRoot,
    label: project.projectName,
    name: project.projectName,
    createdAt: project.createdAt,
    projectType: 'new_project',
    classification: test || project.archived === true ? 'SYSTEM_TEST' : 'COMMANDER_REAL',
    visibility: test || project.archived === true ? 'system' : 'commander',
    testArtifact: test || project.archived === true,
    archived: test || project.archived === true,
  })
}

const IDENTITY_SEED_FILES = new Set(['commander-facts.json', 'foundry-memory.json'])

export async function directoryIsEmpty(root: string): Promise<boolean> {
  try {
    const info = await stat(root)
    if (!info.isDirectory()) return false
    const entries = (await readdir(root)).filter(name => name !== '.git' && name !== '.war-room' && !IDENTITY_SEED_FILES.has(name))
    return entries.length === 0
  } catch {
    return true
  }
}
