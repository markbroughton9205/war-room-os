/**
 * Foundry deployment abstraction. Never talks to a real external vendor in this pass
 * (DEPLOY = NO). The implementation is real: inspect/prepare/run/status/logs/verify/rollback
 * mutate a local fake target with actual files, an HTTP endpoint, and a state machine.
 *
 * Backend preference: official API → CLI → SSH → Git-triggered → Docker → browser → Computer Use.
 * The local fake target always selects API because it exposes an in-process HTTP control plane.
 */
import { createServer, type Server } from 'node:http'
import { mkdir, readFile, rm, writeFile, cp } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { logWarRoomRepoAudit } from '@/lib/war-room/repoAudit'
import { foundryDataHierarchy } from './foundryPaths'

export const DEPLOY_TOOL_NAMES = [
  'deploy.inspect',
  'deploy.prepare',
  'deploy.run',
  'deploy.status',
  'deploy.logs',
  'deploy.verify',
  'deploy.rollback',
] as const

export type DeployToolName = (typeof DEPLOY_TOOL_NAMES)[number]
export function isDeployToolName(value: string): value is DeployToolName {
  return (DEPLOY_TOOL_NAMES as readonly string[]).includes(value)
}

export type DeployBackend = 'api' | 'cli' | 'ssh' | 'git_triggered' | 'docker' | 'browser' | 'computer_use'
export type DeployPhase = 'IDLE' | 'PREPARED' | 'DEPLOYING' | 'SUCCESS' | 'FAILED' | 'ROLLED_BACK'

export type DeployTarget = {
  id: string
  kind: 'local_fake' | 'api' | 'cli' | 'ssh' | 'git_triggered' | 'docker' | 'browser' | 'computer_use'
  apiEndpoint?: string
  cliBin?: string
  sshHost?: string
  gitRemote?: string
  dockerImage?: string
}

type DeployState = {
  targetId: string
  phase: DeployPhase
  currentVersion: string | null
  previousVersion: string | null
  preparedVersion: string | null
  lastError: string | null
  logs: string[]
  origin: string | null
  backend: DeployBackend
  backendReason: string
  updatedAt: string
}

export type BrokerResult = { ok: boolean; tool: DeployToolName; result?: unknown; error?: string }

const LOCAL_TARGET: DeployTarget = { id: 'foundry-local-fake', kind: 'local_fake', apiEndpoint: 'in-process' }

let server: Server | null = null
let origin: string | null = null
let memory: DeployState | null = null

function now(): string {
  return new Date().toISOString()
}

function logLine(state: DeployState, line: string): void {
  state.logs.push(`${now()} ${line}`)
  if (state.logs.length > 200) state.logs.shift()
}

function dirs() {
  const root = foundryDataHierarchy().deploy
  return {
    root,
    stateFile: path.join(root, 'state.json'),
    prepared: path.join(root, 'prepared'),
    live: path.join(root, 'live'),
    previous: path.join(root, 'previous'),
  }
}

async function loadState(): Promise<DeployState> {
  if (memory) return memory
  const file = dirs().stateFile
  if (existsSync(file)) {
    try {
      memory = JSON.parse(await readFile(file, 'utf8')) as DeployState
      return memory
    } catch {
      /* fall through */
    }
  }
  memory = {
    targetId: LOCAL_TARGET.id,
    phase: 'IDLE',
    currentVersion: null,
    previousVersion: null,
    preparedVersion: null,
    lastError: null,
    logs: [],
    origin: origin,
    backend: 'api',
    backendReason: 'Local fake target exposes an official in-process HTTP API.',
    updatedAt: now(),
  }
  return memory
}

async function saveState(state: DeployState): Promise<void> {
  state.updatedAt = now()
  state.origin = origin
  memory = state
  await mkdir(dirs().root, { recursive: true })
  await writeFile(dirs().stateFile, JSON.stringify(state, null, 2), 'utf8')
}

function htmlFor(version: string, marker: string): string {
  return `<!doctype html><html><head><title>Foundry local deploy ${version}</title></head><body>
<h1>Foundry local fake deployment</h1>
<p id="version">FOUNDRY_DEPLOY_VERSION=${version}</p>
<p id="marker">${marker}</p>
<script>console.log("foundry-deploy-ready", ${JSON.stringify(version)})</script>
</body></html>`
}

async function ensureServer(): Promise<string> {
  if (server && origin) return origin
  server = createServer(async (req, res) => {
    const url = req.url ?? '/'
    if (url.startsWith('/api/health')) {
      const state = await loadState()
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: state.phase === 'SUCCESS' || state.phase === 'ROLLED_BACK' || state.phase === 'PREPARED', phase: state.phase, version: state.currentVersion }))
      return
    }
    const live = path.join(dirs().live, 'index.html')
    if (existsSync(live)) {
      const body = await readFile(live)
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(body)
      return
    }
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not deployed')
  })
  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject)
    server!.listen(0, '127.0.0.1', () => resolve())
  })
  server.unref()
  const addr = server.address() as AddressInfo
  origin = `http://127.0.0.1:${addr.port}`
  const state = await loadState()
  state.origin = origin
  await saveState(state)
  return origin
}

export function selectDeployBackend(target: DeployTarget): { backend: DeployBackend; reason: string } {
  if (target.kind === 'local_fake' || target.apiEndpoint) {
    return { backend: 'api', reason: 'Official API is available for this target (local fake in-process control plane).' }
  }
  if (target.cliBin) return { backend: 'cli', reason: 'No API advertised; official CLI binary is present.' }
  if (target.sshHost) return { backend: 'ssh', reason: 'No API/CLI; SSH host is configured.' }
  if (target.gitRemote) return { backend: 'git_triggered', reason: 'No API/CLI/SSH; Git-triggered deploy is configured.' }
  if (target.dockerImage) return { backend: 'docker', reason: 'No API/CLI/SSH/Git; container image is configured.' }
  if (target.kind === 'browser') return { backend: 'browser', reason: 'No machine API; browser automation is the remaining official path.' }
  return { backend: 'computer_use', reason: 'No API/CLI/SSH/Git/Docker/browser contract; Computer Use is last-resort fallback.' }
}

async function writeVersionTree(dir: string, version: string, marker: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'index.html'), htmlFor(version, marker), 'utf8')
  await writeFile(path.join(dir, 'VERSION'), version, 'utf8')
}

export async function executeDeployTool(
  tool: DeployToolName,
  input: Record<string, unknown>,
  ctx: { repairId: string },
): Promise<BrokerResult> {
  try {
    await ensureServer()
    const state = await loadState()
    const selected = selectDeployBackend(LOCAL_TARGET)
    state.backend = selected.backend
    state.backendReason = selected.reason

    switch (tool) {
      case 'deploy.inspect': {
        return {
          ok: true,
          tool,
          result: {
            target: LOCAL_TARGET,
            backend: selected,
            origin,
            state,
            liveExists: existsSync(path.join(dirs().live, 'index.html')),
          },
        }
      }
      case 'deploy.prepare': {
        const version = String(input.version ?? `v-${randomUUID().slice(0, 8)}`)
        const marker = String(input.marker ?? `FOUNDRY_DEPLOY_MARKER_${version}`)
        await rm(dirs().prepared, { recursive: true, force: true })
        await writeVersionTree(dirs().prepared, version, marker)
        state.phase = 'PREPARED'
        state.preparedVersion = version
        state.lastError = null
        logLine(state, `prepared ${version}`)
        await saveState(state)
        await logWarRoomRepoAudit('engineer: deploy.prepare', { missionId: ctx.repairId, version, origin })
        return { ok: true, tool, result: { phase: state.phase, version, origin, backend: selected } }
      }
      case 'deploy.run': {
        if (state.phase !== 'PREPARED' && state.phase !== 'FAILED' && state.phase !== 'SUCCESS' && state.phase !== 'ROLLED_BACK') {
          if (!existsSync(path.join(dirs().prepared, 'index.html'))) {
            return { ok: false, tool, error: 'Nothing prepared. Call deploy.prepare first.' }
          }
        }
        const induceFailure = input.fail === true || input.induceFailure === true
        state.phase = 'DEPLOYING'
        logLine(state, induceFailure ? 'deploying (induced failure)' : 'deploying')
        await saveState(state)
        if (induceFailure) {
          state.phase = 'FAILED'
          state.lastError = 'Induced local deployment failure (fail=true). Live tree left unchanged.'
          logLine(state, state.lastError)
          await saveState(state)
          await logWarRoomRepoAudit('engineer: deploy.run', { missionId: ctx.repairId, ok: false, inducedFailure: true })
          return { ok: false, tool, error: state.lastError, result: { phase: state.phase, origin, currentVersion: state.currentVersion } }
        }
        if (existsSync(dirs().live)) {
          await rm(dirs().previous, { recursive: true, force: true })
          await cp(dirs().live, dirs().previous, { recursive: true })
          state.previousVersion = state.currentVersion
        }
        await rm(dirs().live, { recursive: true, force: true })
        await cp(dirs().prepared, dirs().live, { recursive: true })
        const version = (await readFile(path.join(dirs().live, 'VERSION'), 'utf8')).trim()
        state.phase = 'SUCCESS'
        state.currentVersion = version
        state.lastError = null
        logLine(state, `success ${version}`)
        await saveState(state)
        await logWarRoomRepoAudit('engineer: deploy.run', { missionId: ctx.repairId, ok: true, version, origin })
        return { ok: true, tool, result: { phase: state.phase, version, origin, backend: selected } }
      }
      case 'deploy.status':
        return { ok: true, tool, result: { ...state, origin, backend: selected } }
      case 'deploy.logs': {
        const limit = typeof input.limit === 'number' ? input.limit : 50
        return { ok: true, tool, result: { lines: state.logs.slice(-limit), phase: state.phase } }
      }
      case 'deploy.verify': {
        if (!origin) return { ok: false, tool, error: 'Local deploy server is not listening.' }
        const response = await fetch(origin)
        const body = await response.text()
        const version = state.currentVersion
        const matched = Boolean(version && body.includes(`FOUNDRY_DEPLOY_VERSION=${version}`))
        const health = await fetch(`${origin}/api/health`).then(r => r.json()).catch(error => ({ ok: false, error: String(error) }))
        return {
          ok: matched && response.ok,
          tool,
          result: { httpStatus: response.status, matched, version, origin, health, snippet: body.slice(0, 400) },
          error: matched ? undefined : `Deployed page did not contain FOUNDRY_DEPLOY_VERSION=${version}`,
        }
      }
      case 'deploy.rollback': {
        if (!existsSync(path.join(dirs().previous, 'index.html'))) {
          return { ok: false, tool, error: 'No previous deployment to restore.' }
        }
        await rm(dirs().live, { recursive: true, force: true })
        await cp(dirs().previous, dirs().live, { recursive: true })
        const restored = (await readFile(path.join(dirs().live, 'VERSION'), 'utf8')).trim()
        state.phase = 'ROLLED_BACK'
        state.currentVersion = restored
        logLine(state, `rolled back to ${restored}`)
        await saveState(state)
        await logWarRoomRepoAudit('engineer: deploy.rollback', { missionId: ctx.repairId, restored, origin })
        return { ok: true, tool, result: { phase: state.phase, version: restored, origin } }
      }
      default: {
        const exhaustive: never = tool
        return { ok: false, tool: exhaustive, error: 'Unknown deploy tool.' }
      }
    }
  } catch (error) {
    return { ok: false, tool, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function foundryDeployOrigin(): Promise<string> {
  return ensureServer()
}
