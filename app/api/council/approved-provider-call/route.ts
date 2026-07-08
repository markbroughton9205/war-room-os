import { NextResponse } from 'next/server'

import { handleApprovedProviderCall } from '@/lib/council/approved-provider-route'

export async function POST(request: Request) {
  let body: unknown

  try {
    body = await request.json()
  } catch {
    body = null
  }

  const response = await handleApprovedProviderCall(body)

  return NextResponse.json(response)
}
