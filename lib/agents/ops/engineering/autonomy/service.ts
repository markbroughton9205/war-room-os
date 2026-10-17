import { AgentOpsLog } from '../../log'
import { engineeringRepo, serviceDeps } from '../missions/service'
import { loopbackBaseUrl } from '../runtime/ollamaModel'
import { AutonomyController, type ControllerDeps } from './controller'
import { autonomyDir } from './config'
import { promoteInstall } from './promote'
import { bootInstalledServer, mintSession, proveInstalledBuild } from './uiproof'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ForgeStore } from '@/lib/agents/forge/store'
import { readResources } from './resources'
import type { CommandOrigin } from './types'

const KEY = Symbol.for('war-room.autonomy.controller')

/** Model help for wording only, and only when the builder is already resident: planning must never be the thing that loads a 14 GB model. */
function warmDraft(runner: ControllerDeps['runner']): ControllerDeps['draftJson'] {
  return async (system, prompt) => {
    try {
      const lineup = await runner.lineup()
      if (lineup.simulated) return null
      const ps = (await (await fetch(`${loopbackBaseUrl()}/api/ps`, { signal: AbortSignal.timeout(2000) })).json()) as { models?: { name: string }[] }
      if (!ps.models?.some((m) => m.name === lineup.builder.label)) return null
      const r = await lineup.builder.model.generate({ system, prompt, maxTokens: 400, timeoutMs: 25_000, json: true, temperature: 0 })
      return r.ok ? r.text : null
    } catch { return null }
  }
}

/** Writes a progress message into the Council conversation a command came from (owner-scoped; the origin carries the owner id captured from the Commander's session). */
async function postToConversation(origin: CommandOrigin & { ownerId?: string }, family: string, content: string, metadata: Record<string, unknown>): Promise<string | null> {
  if (origin.kind !== 'council' || !origin.ownerId) return null
  const { getLocalOwnershipStore } = await import('@/lib/sovereign-runtime/local-ownership/store')
  const store = getLocalOwnershipStore(process.env.WAR_ROOM_LOCAL_DATA_DIR ?? null)
  const msg = store.addCouncilMessage(origin.ownerId, origin.conversationId, { role: 'assistant', content, family, metadata: { responseSuccessful: true, ...metadata } })
  return msg?.id ?? null
}

/** Deployment acceptance: start the promoted build (sandboxed, private data dir), mint a session, and fetch the Foundry page. Anything else is a failed deployment. */
export async function deploymentHealthCheck(installPath: string): Promise<{ ok: boolean; detail: string }> {
  const data = mkdtempSync(path.join(os.tmpdir(), 'wr-health-data-'))
  let server: Awaited<ReturnType<typeof bootInstalledServer>> | null = null
  try {
    server = await bootInstalledServer(installPath, data, 90_000)
    const session = await mintSession(server)
    const r = await fetch(`${server.origin}/war-room/engineering`, { headers: { cookie: `wr_local_session=${session}` }, redirect: 'manual', signal: AbortSignal.timeout(30_000) })
    if (r.status >= 500) return { ok: false, detail: `the Foundry page answered HTTP ${r.status}` }
    return { ok: true, detail: `booted on a private port, session minted, /war-room/engineering answered HTTP ${r.status}` }
  } catch (e) { return { ok: false, detail: e instanceof Error ? e.message : String(e) } } finally { await server?.stop().catch(() => undefined); try { rmSync(data, { recursive: true, force: true }) } catch { /* best effort */ } }
}

/** Installed local models + the Forge's recorded role benchmarks: what escalation may choose from. */
async function specialistInputs() {
  const base = loopbackBaseUrl()
  const tags = (await (await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5000) })).json()) as { models?: { name: string; size: number }[] }
  const installed = (tags.models ?? []).map((m) => ({ name: m.name, sizeBytes: m.size }))
  const res = await readResources().catch(() => null)
  const free = res ? (res.gpuFreeMiB ?? 0) + res.residentModels.reduce((n, m) => n + m.vramMiB, 0) : null
  const ram = res?.ramAvailableMiB ?? null
  // a model fits when its weights can be split between the free GPU memory and the available RAM (Ollama offloads the rest)
  const fits = (m: { sizeBytes: number }) => free === null || ram === null ? true : m.sizeBytes / 1048576 <= free + ram - 4000
  return { installed, benchmarks: new ForgeStore().benchmarks(), fits }
}

export function buildControllerDeps(log: AgentOpsLog = new AgentOpsLog()): ControllerDeps {
  const runner = serviceDeps(log)
  const adir = autonomyDir(log.file.replace(/\/agent-foundry\.jsonl$/, ''))
  return {
    log, runner, adir, repo: () => engineeringRepo(log), draftJson: warmDraft(runner),
    proveUi: proveInstalledBuild, specialists: specialistInputs, promote: ({ installPath }) => promoteInstall({ installPath, healthCheck: deploymentHealthCheck }),
    post: (origin, family, content, metadata) => { void postToConversation(origin as never, family, content, metadata).catch(() => undefined); return null },
  }
}

/** One controller per server process (route handlers and the supervisor share it). */
export function autonomyController(): AutonomyController {
  const g = globalThis as unknown as Record<symbol, AutonomyController | undefined>
  return (g[KEY] ??= new AutonomyController(buildControllerDeps()))
}
