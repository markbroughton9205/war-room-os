import { insertInternetLog } from '@/lib/internet/warRoomInternetLog'
import { redactInternetQuery } from '@/lib/internet/redact'
import { safeUrlFetch } from '@/lib/internet/safeUrlFetch'
import { jsonWithPersistence, tryWarRoomSupabase } from '@/lib/war-room/persistence'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const sup = tryWarRoomSupabase()

  let body: { url?: string; conversationId?: string | null; actionId?: string | null; maxBytes?: number }
  try {
    body = await req.json()
  } catch {
    return jsonWithPersistence({ error: 'Invalid JSON body.' }, sup.ok, { status: 400 })
  }

  const url = typeof body.url === 'string' ? body.url.trim() : ''
  if (!url) {
    return jsonWithPersistence({ error: 'url is required.' }, sup.ok, { status: 400 })
  }

  const started = Date.now()
  const fetchResult = await safeUrlFetch(url, { maxBytes: typeof body.maxBytes === 'number' ? body.maxBytes : undefined })
  const durationMs = Date.now() - started

  if (!fetchResult.ok) {
    await insertInternetLog(sup.ok ? sup.client : null, {
      conversation_id: typeof body.conversationId === 'string' ? body.conversationId : null,
      action_id: typeof body.actionId === 'string' ? body.actionId : null,
      provider: 'fetch',
      operation: 'fetch',
      query: redactInternetQuery(url),
      status_code: null,
      duration_ms: durationMs,
      metadata: { error: fetchResult.error },
    })
    return jsonWithPersistence({ ok: false, error: fetchResult.error }, sup.ok, { status: 400 })
  }

  await insertInternetLog(sup.ok ? sup.client : null, {
    conversation_id: typeof body.conversationId === 'string' ? body.conversationId : null,
    action_id: typeof body.actionId === 'string' ? body.actionId : null,
    provider: 'fetch',
    operation: 'fetch',
    query: redactInternetQuery(url),
    status_code: fetchResult.status,
    duration_ms: durationMs,
    metadata: {
      bytesRead: fetchResult.bytesRead,
      truncated: fetchResult.truncated,
      contentType: fetchResult.contentType,
    },
  })

  return jsonWithPersistence(
    {
      ok: true,
      url: fetchResult.url,
      status: fetchResult.status,
      contentType: fetchResult.contentType,
      bytesRead: fetchResult.bytesRead,
      truncated: fetchResult.truncated,
      snippet: fetchResult.snippet,
    },
    sup.ok,
  )
}
