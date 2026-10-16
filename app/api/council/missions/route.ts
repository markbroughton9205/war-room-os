import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { commanderActor } from '@/lib/agents/ops/api'
import { getLocalOwnershipStore } from '@/lib/sovereign-runtime/local-ownership/store'
import { localCommanderOwnerId } from '@/lib/war-room/localConversationGateway'
import { createRealFoundryPort } from '@/lib/council/missions/foundryPort.server'
import { conversationMissionStorage } from '@/lib/council/missions/conversationStorage'
import { CouncilMissionError, createCouncilMissionService } from '@/lib/council/missions/service'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function dataDir(): string | null { return process.env.WAR_ROOM_LOCAL_DATA_DIR ?? null }

const CONV_ID = /^[A-Za-z0-9_-]{6,80}$/
const PROPOSAL_ID = /^cm_[a-f0-9]{8,32}$/

async function context(req: Request, conversationId: string) {
  const commander = await requireCommanderSession('Council missions')
  if (!commander.ok) return { error: commander.response } as const
  const ownerId = await localCommanderOwnerId(req)
  if (!ownerId) return { error: NextResponse.json({ error: 'Local Commander session required.' }, { status: 401 }) } as const
  if (!CONV_ID.test(conversationId)) return { error: NextResponse.json({ error: 'invalid conversationId' }, { status: 400 }) } as const
  const store = getLocalOwnershipStore(dataDir())
  if (!store.getCouncilConversation(ownerId, conversationId)) return { error: NextResponse.json({ error: 'unknown conversation' }, { status: 404 }) } as const
  const foundry = createRealFoundryPort()
  const service = createCouncilMissionService({ storage: conversationMissionStorage(store, ownerId, conversationId), foundry })
  return { ok: true as const, commander, ownerId, store, foundry, service }
}

/** Mission proposals for one Council conversation, refreshed from Foundry's own mission records. */
export async function GET(req: Request) {
  const conversationId = new URL(req.url).searchParams.get('conversationId') ?? ''
  const ctx = await context(req, conversationId)
  if ('error' in ctx) return ctx.error
  try {
    const proposals = ctx.service.sync()
    const avail = ctx.foundry.availability()
    return NextResponse.json({ generatedAt: new Date().toISOString(), conversationId, foundry: avail, proposals })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 300) : 'failed' }, { status: 500 })
  }
}

/** Propose / approve / reject / cancel. Approval is the Commander's session plus a custom header (cross-site requests cannot set it). */
export async function POST(req: Request) {
  if (req.headers.get('x-wr-council-missions') !== '1') return NextResponse.json({ error: 'missing control header' }, { status: 400 })
  let body: Record<string, unknown>
  try {
    const raw = await req.json()
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('not an object')
    body = raw as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }
  if (JSON.stringify(body).length > 65_536) return NextResponse.json({ error: 'request too large' }, { status: 413 })
  const conversationId = String(body.conversationId ?? '')
  const ctx = await context(req, conversationId)
  if ('error' in ctx) return ctx.error
  const actor = commanderActor(ctx.commander.userId)
  if (!actor) return NextResponse.json({ error: 'Commander session required' }, { status: 403 })
  const action = String(body.action ?? '')
  try {
    if (action === 'propose') {
      const messages = ctx.store.listCouncilMessages(ctx.ownerId, conversationId) ?? []
      const recent = messages.slice(-12)
      const contributors = Array.from(new Map(recent.filter(m => m.role === 'assistant').map(m => {
        const model = typeof m.metadata.providerModel === 'string' ? (m.metadata.providerModel as string) : null
        return [m.family ?? 'COUNCIL', { member: m.family ?? 'COUNCIL', model }] as const
      })).values())
      const lastAssistant = [...recent].reverse().find(m => m.role === 'assistant' && !m.metadata.councilBrowse)
      const proposal = ctx.service.propose({
        conversationId,
        title: typeof body.title === 'string' ? body.title : undefined,
        request: String(body.request ?? ''),
        acceptance: Array.isArray(body.acceptance) ? (body.acceptance as unknown[]).map(String) : [],
        targets: Array.isArray(body.targets) ? (body.targets as Array<{ path: string; action?: string }>) : [],
        scopePaths: Array.isArray(body.scopePaths) ? (body.scopePaths as unknown[]).map(String) : undefined,
        scopeWrite: Array.isArray(body.scopeWrite) ? (body.scopeWrite as unknown[]).map(String) : undefined,
        discussion: { messageIds: recent.map(m => m.id), contributors, excerpt: lastAssistant?.content ?? '' },
      })
      return NextResponse.json({ proposal }, { status: 201 })
    }
    const proposalId = String(body.proposalId ?? '')
    if (!PROPOSAL_ID.test(proposalId)) return NextResponse.json({ error: 'invalid proposalId' }, { status: 400 })
    if (action === 'approve') return NextResponse.json({ proposal: await ctx.service.approve(proposalId, actor) }, { status: 202 })
    if (action === 'reject') return NextResponse.json({ proposal: ctx.service.reject(proposalId, actor, typeof body.reason === 'string' ? body.reason.slice(0, 200) : undefined) })
    if (action === 'cancel') return NextResponse.json({ proposal: ctx.service.cancel(proposalId, actor, typeof body.reason === 'string' ? body.reason.slice(0, 200) : undefined) }, { status: 202 })
    return NextResponse.json({ error: 'unknown action', actions: ['propose', 'approve', 'reject', 'cancel'] }, { status: 400 })
  } catch (e) {
    if (e instanceof CouncilMissionError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.code === 'NOT_FOUND' ? 404 : e.code === 'ILLEGAL' ? 409 : e.code === 'UNAVAILABLE' ? 503 : 400 })
    }
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 300) : 'failed' }, { status: 400 })
  }
}
