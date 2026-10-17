import { AgentOpsLog } from '../../log'
import { engineeringRepo, serviceDeps } from '../missions/service'
import { loopbackBaseUrl } from '../runtime/ollamaModel'
import { AutonomyController, type ControllerDeps } from './controller'
import { autonomyDir } from './config'
import { promoteInstall } from './promote'
import { proveInstalledBuild } from './uiproof'
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

export function buildControllerDeps(log: AgentOpsLog = new AgentOpsLog()): ControllerDeps {
  const runner = serviceDeps(log)
  const adir = autonomyDir(log.file.replace(/\/agent-foundry\.jsonl$/, ''))
  return {
    log, runner, adir, repo: () => engineeringRepo(log), draftJson: warmDraft(runner),
    proveUi: proveInstalledBuild, promote: ({ installPath }) => promoteInstall({ installPath }),
    post: (origin, family, content, metadata) => { void postToConversation(origin as never, family, content, metadata).catch(() => undefined); return null },
  }
}

/** One controller per server process (route handlers and the supervisor share it). */
export function autonomyController(): AutonomyController {
  const g = globalThis as unknown as Record<symbol, AutonomyController | undefined>
  return (g[KEY] ??= new AutonomyController(buildControllerDeps()))
}
