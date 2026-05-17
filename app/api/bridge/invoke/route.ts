import { NextResponse } from 'next/server'
import { authenticateBridgeRequest } from '@/lib/bridge/auth'
import {
  claimNextBridgeInvocation,
  completeBridgeInvocation,
  enqueueBridgeInvocation,
  getBridgeStatus,
  listBridgeResults,
} from '@/lib/bridge/state'
import type { BridgeInvocationResult } from '@/lib/bridge/types'

export const dynamic = 'force-dynamic'

type InvokeBody = {
  action?: string
  request?: {
    action?: string
    provider?: string | null
    model?: string | null
    prompt?: string | null
  }
  result?: BridgeInvocationResult
}

export async function GET(request: Request) {
  const auth = authenticateBridgeRequest(request)
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status })

  const { searchParams } = new URL(request.url)
  if (searchParams.get('poll') !== '1') {
    return NextResponse.json({
      status: getBridgeStatus(),
      recentResults: listBridgeResults(),
    })
  }

  return NextResponse.json({
    request: claimNextBridgeInvocation(),
  })
}

export async function POST(request: Request) {
  const auth = authenticateBridgeRequest(request)
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status })

  let body: InvokeBody
  try {
    body = await request.json() as InvokeBody
  } catch {
    return NextResponse.json({ message: 'Invalid JSON body.' }, { status: 400 })
  }

  if (body.action === 'complete') {
    if (!body.result?.id) return NextResponse.json({ message: 'Invocation result id is required.' }, { status: 400 })
    return NextResponse.json({ result: completeBridgeInvocation(body.result) })
  }

  const enqueued = enqueueBridgeInvocation(body.request ?? body)
  if (!enqueued.ok) return NextResponse.json({ message: enqueued.message }, { status: enqueued.status })

  return NextResponse.json({
    request: enqueued.request,
    status: getBridgeStatus(),
  }, { status: 202 })
}
