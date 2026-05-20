import { NextResponse } from 'next/server'
import { getFederationStatusSnapshot, runFederatedSignalIngestion } from '@/lib/signals/router/federation'
import { getSignalSources } from '@/lib/signals/sources'

export const runtime = 'nodejs'

export async function GET() {
  const status = getFederationStatusSnapshot()
  return NextResponse.json({ ok: true, status })
}

export async function POST() {
  const capturedAt = new Date().toISOString()
  const sources = getSignalSources()
  const result = await runFederatedSignalIngestion({ capturedAt, sources })
  return NextResponse.json({
    ok: true,
    status: result.status,
    routing: result.routing,
    itemCount: result.items.length,
    diagnostics: result.diagnostics,
  })
}
