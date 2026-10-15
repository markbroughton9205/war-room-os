import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { getBrowserBroker } from '@/lib/browser-broker'
import { readBrowserAuditTail } from '@/lib/browser-broker/sessionAudit'
import { getLocalOwnershipStore } from '@/lib/sovereign-runtime/local-ownership/store'
import { localCommanderOwnerId } from '@/lib/war-room/localConversationGateway'
import { browseMessageText, councilBrowse } from '@/lib/council/computer/browse.server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * The visible Council computer: the shared browser broker (Playwright Chromium) seen through the Commander's session.
 * The ACTING OWNER is decided here, never taken from the request: "browse" runs as `council`; takeover, return, clicks, typing and
 * the sign-in flow run as `commander` and only while the Commander holds control. Typed text is never stored or logged.
 */
const SESSION_ID = /^sess-[0-9a-f-]{36}$/
const CONV_ID = /^[A-Za-z0-9_-]{6,80}$/

function dataDir(): string | null { return process.env.WAR_ROOM_LOCAL_DATA_DIR ?? null }

type Fail = { ok: false; error: string }
function fail(error: string, status = 400) { return NextResponse.json({ ok: false, error } satisfies Fail, { status, headers: { 'cache-control': 'no-store' } }) }

function sessionView(s: ReturnType<ReturnType<typeof getBrowserBroker>['diagnostics']>['sessions'][number]) {
  return {
    sessionId: s.sessionId,
    owner: s.owner,
    kind: s.kind,
    controlState: s.controlState ?? 'AGENT_CONTROL',
    profileId: s.profileId ?? null,
    tabs: s.tabs.map(t => ({ tabId: t.tabId, url: t.url, title: t.title, active: t.active })),
    hostname: s.hostname ?? null,
    lastAction: s.lastAction ?? null,
    lastActionAt: s.lastActionAt ?? null,
    createdAt: s.createdAt,
  }
}

export async function GET(req: Request) {
  const commander = await requireCommanderSession('Council computer')
  if (!commander.ok) return commander.response
  const params = new URL(req.url).searchParams
  const broker = getBrowserBroker()
  const frameFor = params.get('frame')
  if (frameFor) {
    if (!SESSION_ID.test(frameFor)) return fail('invalid sessionId')
    const frame = await broker.liveFrame(frameFor)
    if (!frame.ok) return fail(frame.error, 404)
    return new NextResponse(new Uint8Array(frame.result.jpeg), {
      headers: {
        'content-type': 'image/jpeg',
        'cache-control': 'no-store',
        'x-council-frame-width': String(frame.result.width),
        'x-council-frame-height': String(frame.result.height),
        'x-council-frame-url': encodeURIComponent(frame.result.url).slice(0, 500),
        'x-council-frame-title': encodeURIComponent(frame.result.title).slice(0, 300),
      },
    })
  }
  const diag = broker.diagnostics()
  const sessions = diag.sessions.filter(s => s.controlState !== 'CLOSED').map(sessionView)
  const sessionId = params.get('sessionId')
  const audit = readBrowserAuditTail(80)
    .filter(a => !sessionId || (a as { session_id?: string | null }).session_id === sessionId)
    .slice(-30)
    .map(a => ({ at: (a as { at?: string }).at ?? null, actor: (a as { actor?: string }).actor ?? null, action: (a as { action_type?: string }).action_type ?? null, result: (a as { result?: string }).result ?? null, host: (a as { hostname?: string | null }).hostname ?? null }))
  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    broker: {
      state: diag.brokerState,
      chromiumState: diag.chromiumState,
      chromiumSource: diag.chromiumSource ?? null,
      engine: diag.engine,
      available: diag.playwrightAvailability === 'available',
      lastFailure: diag.lastFailure ? { code: diag.lastFailure.code, at: diag.lastFailure.at } : null,
      profileStore: diag.profileStore ? { profiles: diag.profileStore.profileCount, encryption: diag.profileStore.encryption, keyState: diag.profileStore.key_state ?? null } : null,
    },
    sessions,
    activity: audit,
  }, { headers: { 'cache-control': 'no-store' } })
}

export async function POST(req: Request) {
  if (req.headers.get('x-wr-council-computer') !== '1') return fail('missing control header')
  const commander = await requireCommanderSession('Council computer')
  if (!commander.ok) return commander.response
  let body: Record<string, unknown>
  try {
    const raw = await req.json()
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('not an object')
    body = raw as Record<string, unknown>
  } catch { return fail('invalid JSON') }
  const action = String(body.action ?? '')
  const broker = getBrowserBroker()
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
  if (action !== 'open' && action !== 'browse' && action !== 'signin_start' && !SESSION_ID.test(sessionId)) return fail('invalid sessionId')
  const out = (r: { ok: boolean; error?: string } & Record<string, unknown>, status?: number) =>
    NextResponse.json(r.ok ? r : { ok: false, error: r.error ?? 'failed', verdict: (r as { verdict?: string }).verdict ?? null }, { status: status ?? (r.ok ? 200 : 409), headers: { 'cache-control': 'no-store' } })

  switch (action) {
    case 'open': {
      // With a profileId, Council uses a signed-in trusted profile the Commander created (the broker enforces allow_council and origins).
      const profileId = typeof body.profileId === 'string' && /^[A-Za-z0-9_-]{4,80}$/.test(body.profileId) ? body.profileId : undefined
      const r = await broker.createSession({
        owner: 'council',
        sessionMode: profileId ? 'TRUSTED_PROFILE' : 'EPHEMERAL',
        profileId,
        allowLocalhost: body.allowLocalhost === true,
      })
      return out(r.ok ? { ok: true, ...r.result } : r)
    }
    case 'browse': {
      // Council opens a page and reports what it read. Runs as `council`; the broker's origin policy and control state apply.
      const result = await councilBrowse({ url: String(body.url ?? ''), sessionId: SESSION_ID.test(sessionId) ? sessionId : undefined, allowLocalhost: body.allowLocalhost === true })
      if (!result.ok) return out({ ok: false, error: result.error, verdict: result.verdict, sessionId: result.sessionId } as never)
      let posted: string | null = null
      const conversationId = typeof body.conversationId === 'string' ? body.conversationId : ''
      if (conversationId && CONV_ID.test(conversationId)) {
        const ownerId = await localCommanderOwnerId(req)
        if (ownerId) {
          const store = getLocalOwnershipStore(dataDir())
          if (store.getCouncilConversation(ownerId, conversationId)) {
            const msg = store.addCouncilMessage(ownerId, conversationId, {
              role: 'assistant',
              family: 'COUNCIL',
              content: browseMessageText(result),
              metadata: {
                responseSuccessful: true,
                councilBrowse: { sessionId: result.sessionId, url: result.url, title: result.title, status: result.status, citationId: result.citationId },
              },
            })
            posted = msg?.id ?? null
          }
        }
      }
      return out({ ok: true, sessionId: result.sessionId, title: result.title, url: result.url, status: result.status, excerpt: result.excerpt, citationId: result.citationId, messageId: posted })
    }
    case 'takeover': {
      const r = await broker.executeAction({ kind: 'control.takeover', owner: 'commander', sessionId })
      return out(r.ok ? { ok: true, ...(r.result as object) } : r)
    }
    case 'return': {
      const r = await broker.executeAction({ kind: 'control.return', owner: 'commander', sessionId })
      if (!r.ok) return out(r)
      const result = r.result as { controlState?: string; extract?: { title?: string; finalUrl?: string } | null }
      return out({ ok: true, controlState: result.controlState ?? 'AGENT_CONTROL', page: result.extract ? { title: result.extract.title ?? '', url: result.extract.finalUrl ?? '' } : null })
    }
    case 'navigate': {
      // `as: 'commander'` is accepted only while the Commander holds control (the broker enforces ownership either way).
      const asCommander = body.as === 'commander'
      const url = String(body.url ?? '')
      if (!/^https?:\/\//i.test(url) || url.length > 1000) return fail('url must be http(s)')
      const r = await broker.navigate({ owner: asCommander ? 'commander' : 'council', sessionId, url, commanderApproved: asCommander })
      return out(r.ok ? { ok: true, ...r.result } : r)
    }
    case 'click': {
      const r = await broker.clickAt({ owner: 'commander', sessionId, x: Number(body.x), y: Number(body.y) })
      return out(r.ok ? { ok: true, ...r.result } : r)
    }
    case 'type': {
      const r = await broker.typeText({ owner: 'commander', sessionId, text: String(body.text ?? '') })
      return out(r.ok ? { ok: true, ...r.result } : r)
    }
    case 'press': {
      const r = await broker.press({ owner: 'commander', sessionId, text: String(body.key ?? 'Enter') })
      return out(r.ok ? { ok: true, ...r.result } : r)
    }
    case 'signin_start': {
      // Secure private sign-in: a trusted profile (encrypted storage, Council may only USE the resulting session) and a Commander-held
      // session. The Commander types the credentials into the page; they never pass through Council and are never logged.
      const origin = String(body.origin ?? '')
      let parsed: URL
      try { parsed = new URL(origin) } catch { return fail('origin must be a URL') }
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return fail('origin must be http(s)')
      const created = await broker.executeAction({
        kind: 'profile.create', owner: 'commander', displayName: String(body.displayName ?? parsed.hostname).slice(0, 80),
        allowedOrigins: [parsed.origin], allowCouncil: body.allowCouncil !== false, allowFoundry: false, actionPolicy: 'READ_ONLY',
      })
      if (!created.ok) return out(created)
      const profileId = (created.result as { profile: { profile_id: string } }).profile.profile_id
      const session = await broker.createSession({ owner: 'commander', sessionMode: 'TRUSTED_PROFILE', profileId, allowLocalhost: parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' })
      if (!session.ok) return out(session)
      const held = await broker.startTakeover('commander', session.result.sessionId)
      if (!held.ok) return out(held)
      const nav = await broker.navigate({ owner: 'commander', sessionId: session.result.sessionId, url: parsed.toString(), commanderApproved: true })
      return out({ ok: true, sessionId: session.result.sessionId, profileId, controlState: 'COMMANDER_CONTROL', navigated: nav.ok, url: nav.ok ? nav.result.finalUrl : null, error: nav.ok ? undefined : nav.error })
    }
    case 'close': {
      const r = await broker.closeSession(sessionId)
      return out(r.ok ? { ok: true, ...r.result } : r)
    }
    default:
      return fail('unknown action')
  }
}
