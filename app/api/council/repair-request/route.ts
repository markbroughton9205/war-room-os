import { NextResponse } from 'next/server'

import { createCouncilRepairRequest, getRepairSnapshot, rememberRepairRequest } from '@/lib/council-repair'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export async function GET() {
  return NextResponse.json(getRepairSnapshot(), {
    headers: {
      'cache-control': 'no-store',
      'x-war-room-repair': 'advisory-only',
    },
  })
}

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Expected a JSON object.' }, { status: 400 })
  }

  const input = body as Record<string, unknown>
  const decree = text(input.decree)
  if (!decree) {
    return NextResponse.json({ error: 'decree is required.' }, { status: 400 })
  }

  const request = createCouncilRepairRequest({
    decree,
    sourceMessageId: text(input.sourceMessageId) || null,
    sourceFamily: text(input.sourceFamily) || null,
    sourceContent: text(input.sourceContent) || null,
  })
  rememberRepairRequest(request)

  return NextResponse.json({
    request,
    guardrails: {
      advisoryOnly: true,
      approvalRequired: true,
      canExecute: false,
      canMutateFiles: false,
    },
  }, {
    status: 201,
    headers: {
      'cache-control': 'no-store',
      'x-war-room-repair': 'request-classified',
    },
  })
}
