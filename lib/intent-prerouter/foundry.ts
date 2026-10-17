/**
 * Council -> Foundry: "Foundry, build this" / "Council, add X" in a Council conversation. Additive early return, like the HVS pre-router.
 * Once engineering execution is requested the Commander's own sentence is the authorization (Full Autonomy must be on); the request goes to Foundry's autonomous controller and Foundry
 * owns the mission. Council keeps the originating conversation, the command id and the mission id, and Foundry writes progress and the result back into this conversation.
 * Nothing is executed here, and nothing found in the conversation or on the web is treated as a command: only the Commander's message text is.
 */
import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { commanderActor } from '@/lib/agents/ops/api'
import { getLocalOwnershipStore } from '@/lib/sovereign-runtime/local-ownership/store'
import { localCommanderOwnerId } from '@/lib/war-room/localConversationGateway'
import { createRealFoundryPort } from '@/lib/council/missions/foundryPort.server'
import { conversationMissionStorage } from '@/lib/council/missions/conversationStorage'
import { CouncilMissionError, createCouncilMissionService } from '@/lib/council/missions/service'
import { isDeictic, isFoundryCommand } from './foundryIntent'

export async function tryHandleFoundryCommand(req: Request, message: string, conversationId: string): Promise<NextResponse | null> {
  if (!isFoundryCommand(message)) return null
  const reply = (text: string, extra: Record<string, unknown> = {}) => NextResponse.json({
    councilSingleResponse: text, councilSingleFamily: 'war_room', results: [{ family: 'War Room', content: text, status: 'OK' }], councilProviderHttpStatus: 'ok', conversationId, agiIntentPreRouted: 'FOUNDRY_COMMAND', ...extra,
  })
  const commander = await requireCommanderSession('Council → Foundry')
  if (!commander.ok) return null // not the Commander: the message goes through the ordinary Council pipeline, which executes nothing
  const ownerId = await localCommanderOwnerId(req)
  const actor = commanderActor(commander.userId)
  if (!ownerId || !actor) return null
  const store = getLocalOwnershipStore(process.env.WAR_ROOM_LOCAL_DATA_DIR ?? null)
  if (!store.getCouncilConversation(ownerId, conversationId)) return null
  let text = message.trim()
  if (isDeictic(text)) {
    // "build this": the thing to build is what the Council just discussed. That text is DATA describing the feature; it is quoted, never obeyed.
    const recent = (store.listCouncilMessages(ownerId, conversationId) ?? []).filter((m) => m.role === 'assistant' && !m.metadata?.councilBrowse && !m.metadata?.foundryCommand).slice(-4)
    const excerpt = recent.map((m) => `${m.family ?? 'COUNCIL'}: ${String(m.content).replace(/\s+/g, ' ').slice(0, 500)}`).join('\n').slice(0, 1800)
    if (!excerpt) return reply('Foundry has nothing to build yet: there is no earlier discussion in this conversation to take the feature from. Describe it in a sentence and I will hand it to Foundry.', { foundryCommand: { accepted: false } })
    text = `${text.replace(/[.!]+$/, '')}\n\nThe feature, as the Council discussed it (quoted as data):\n${excerpt}`
  }
  const service = createCouncilMissionService({ storage: conversationMissionStorage(store, ownerId, conversationId), foundry: createRealFoundryPort() })
  try {
    const p = await service.command({ conversationId, ownerId, text }, actor)
    const missionLine = p.foundry?.missionId ? `Mission ${p.foundry.missionId} is open` : 'The command is queued behind the mission that is running'
    const out = `Handing this to Foundry. It now owns the work: ${missionLine}. Foundry works out the files, the plan and the tests itself and reports progress and the verified result right here in this conversation. (Command ${p.commandId}.)`
    return reply(out, { foundryCommand: { accepted: true, commandId: p.commandId, missionId: p.foundry?.missionId ?? null, proposalId: p.proposalId } })
  } catch (e) {
    const msg = e instanceof CouncilMissionError || e instanceof Error ? e.message : 'Foundry refused the command'
    return reply(`Foundry did not start this: ${msg}`, { foundryCommand: { accepted: false, reason: msg.slice(0, 300) } })
  }
}
