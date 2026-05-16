import {
  applyRuntimeStatePost,
  readRuntimeContinuityBundle,
  type RuntimeStatePostBody,
} from '@/lib/runtime/runtimeContinuityServer'
import { auditRuntimePersistenceEvent } from '@/lib/runtime/runtimeStatePersistenceGuards'
import { isRuntimeStatePersistenceConfigured } from '@/lib/runtime/runtimeStateStore'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(): Promise<Response> {
  try {
    const payload = await readRuntimeContinuityBundle()
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to read runtime state'
    auditRuntimePersistenceEvent('runtimeStateReadFailed', { phase: 'get_route_throw', message: msg })
    return new Response(
      JSON.stringify({
        persistenceConfigured: isRuntimeStatePersistenceConfigured(),
        bundle: null,
        runtimeStateReadFailed: true,
        error: msg,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        },
      },
    )
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as RuntimeStatePostBody
    const result = await applyRuntimeStatePost(body)
    if (!result.ok) {
      return new Response(JSON.stringify({ ok: false, error: result.error ?? 'Rejected' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      })
    }
    return new Response(
      JSON.stringify({
        ok: true,
        ...(result.persistenceUnavailable ? { persistenceUnavailable: true } : {}),
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      },
    )
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    })
  }
}
