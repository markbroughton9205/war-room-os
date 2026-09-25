import { NextResponse } from 'next/server'
import { isFoundryWorkbenchW0Enabled } from '@/lib/native-builder/foundryWorkbenchW0'
import {
  foundryWorkbenchHealth,
  startFoundryWorkbench,
  stopFoundryWorkbench,
} from '@/lib/native-builder/foundryWorkbenchW0.host'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function stripSecrets(payload: Record<string, unknown>) {
  const { token: _token, authenticatedUrl: _url, ...rest } = payload
  return rest
}

export async function GET() {
  const enabled = isFoundryWorkbenchW0Enabled()
  if (!enabled) {
    return NextResponse.json({ enabled: false, ready: false, bind: '127.0.0.1', port: 3849 })
  }
  const health = await foundryWorkbenchHealth()
  return NextResponse.json({ enabled: true, ...stripSecrets(health) })
}

export async function POST(req: Request) {
  if (!isFoundryWorkbenchW0Enabled()) {
    return NextResponse.json({ error: 'FOUNDRY_WORKBENCH_W0 is off' }, { status: 403 })
  }
  let body: { action?: string } = {}
  try {
    const raw = await req.json()
    if (raw && typeof raw === 'object') body = raw as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  if (body.action === 'start') {
    const started = await startFoundryWorkbench()
    return NextResponse.json(stripSecrets(started))
  }
  if (body.action === 'stop') {
    const stopped = await stopFoundryWorkbench()
    return NextResponse.json(stripSecrets(stopped))
  }
  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}
