import { applyRuntimeStatePost, readRuntimeContinuityBundle, type RuntimeStatePostBody } from '@/lib/runtime/runtimeContinuityServer'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(): Promise<Response> {
  try {
    const { persistenceConfigured, bundle } = await readRuntimeContinuityBundle()
    return new Response(
      JSON.stringify({
        persistenceConfigured,
        bundle,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        },
      },
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to read runtime state'
    return new Response(JSON.stringify({ persistenceConfigured: false, bundle: null, error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    })
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
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    })
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    })
  }
}
