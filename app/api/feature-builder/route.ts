import { NextResponse } from 'next/server'

import { createFeatureBuilderPacket, listFeatureBuilderSnapshot } from '@/lib/feature-builder/persistence'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  return NextResponse.json(await listFeatureBuilderSnapshot())
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
  const idea = typeof input.idea === 'string' ? input.idea.trim() : ''
  if (!idea) {
    return NextResponse.json({ error: 'idea is required.' }, { status: 400 })
  }

  try {
    const result = await createFeatureBuilderPacket({
      idea,
      targetAppModule: typeof input.targetAppModule === 'string' ? input.targetAppModule : null,
      commanderContext: typeof input.commanderContext === 'string' ? input.commanderContext : null,
    })
    return NextResponse.json(result, {
      status: 201,
      headers: {
        'x-war-room-feature-builder-persistence': result.persistenceAvailable ? 'available' : 'unavailable',
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Feature Builder packet generation failed.' },
      { status: 500 },
    )
  }
}

