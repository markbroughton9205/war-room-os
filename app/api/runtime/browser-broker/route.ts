import { NextResponse } from 'next/server'
import { getBrowserBroker, type BrowserActionKind, type BrowserOwner } from '@/lib/browser-broker'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

export async function GET() {
  const diagnostics = getBrowserBroker().diagnostics()
  return NextResponse.json(diagnostics, {
    headers: {
      'cache-control': 'no-store',
      'x-war-room-browser-broker': diagnostics.brokerState,
    },
  })
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as {
    kind?: BrowserActionKind
    owner?: BrowserOwner
    sessionId?: string
    tabId?: string
    url?: string
    query?: string
    selector?: string
    text?: string
    allowLocalhost?: boolean
    commanderApproved?: boolean
    fullPage?: boolean
    profileId?: string
    sessionMode?: 'EPHEMERAL' | 'TRUSTED_PROFILE'
    displayName?: string
    allowedOrigins?: string[]
    allowCouncil?: boolean
    allowFoundry?: boolean
    actionPolicy?: 'READ_ONLY' | 'RESEARCH' | 'INTERACTIVE_WITH_APPROVAL'
    missionId?: string
  }
  const owner = body.owner === 'foundry' || body.owner === 'council' || body.owner === 'broker' || body.owner === 'commander' ? body.owner : 'council'
  const kind = body.kind
  if (!kind) {
    return NextResponse.json({ error: 'kind is required' }, { status: 400, headers: { 'cache-control': 'no-store' } })
  }
  const broker = getBrowserBroker()
  if (kind === 'status') {
    const snapshot = broker.statusSnapshot()
    return NextResponse.json({
      ok: true,
      result: snapshot,
      diagnostics: broker.diagnostics(),
    }, {
      headers: { 'cache-control': 'no-store', 'x-war-room-browser-broker': snapshot.broker_state },
    })
  }
  const result = await broker.executeAction({
    kind,
    owner,
    sessionId: body.sessionId,
    tabId: body.tabId,
    url: body.url,
    query: body.query,
    selector: body.selector,
    text: body.text,
    allowLocalhost: body.allowLocalhost,
    commanderApproved: body.commanderApproved === true,
    fullPage: body.fullPage === true,
    profileId: body.profileId,
    sessionMode: body.sessionMode,
    displayName: body.displayName,
    allowedOrigins: body.allowedOrigins,
    allowCouncil: body.allowCouncil,
    allowFoundry: body.allowFoundry,
    actionPolicy: body.actionPolicy,
    missionId: body.missionId,
  })
  return NextResponse.json({
    ...result,
    diagnostics: broker.diagnostics(),
  }, {
    status: result.ok ? 200 : result.verdict === 'ACTION_REQUIRES_APPROVAL' || result.error === 'COMMANDER_CONTROL_ACTIVE' ? 403 : /PROFILE_|COMMANDER_ONLY|HUMAN_INTERACTION|SESSION_NOT_FOUND|TAB_NOT_FOUND/.test(result.error ?? '') ? 409 : 500,
    headers: { 'cache-control': 'no-store' },
  })
}
