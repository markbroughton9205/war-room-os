import { NextResponse } from 'next/server'
import { describeRouter, listProviders, listRouterBackends, persistRoutedJob, routeCapability } from '@/lib/media-command/provider-router'
import { HVS_CAPABILITIES, type HvsCapability } from '@/lib/media-command/provider-registry'
import { HVS_WAVE2_PROVIDER_SPEND_AUTHORIZED } from '@/lib/media-command/policy'
import { stripSecrets } from '@/lib/media-command/secrets'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(stripSecrets({
    providers: listProviders(),
    backends: listRouterBackends().map(row => ({
      id: row.id,
      capability: row.capability,
      configured: row.configured,
      available: row.available,
      health: row.health,
      local: row.local,
      routeable: row.routeable,
      cost: row.cost.class,
    })),
    spendAuthorized: HVS_WAVE2_PROVIDER_SPEND_AUTHORIZED,
    note: describeRouter(),
  }))
}

export async function POST(req: Request) {
  let body: { capability?: HvsCapability; projectId?: string; prompt?: string; referenceAssetIds?: string[] } = {}
  try {
    body = await req.json() as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  if (!body.capability || !HVS_CAPABILITIES.includes(body.capability)) {
    return NextResponse.json({ error: 'capability is required.' }, { status: 400 })
  }
  const decision = routeCapability({
    capability: body.capability,
    projectId: body.projectId ?? 'router-probe',
    prompt: body.prompt,
    referenceAssetIds: body.referenceAssetIds,
  })
  const job = body.projectId
    ? persistRoutedJob({
        request: {
          capability: body.capability,
          projectId: body.projectId,
          prompt: body.prompt,
          referenceAssetIds: body.referenceAssetIds,
        },
        decision,
      })
    : null
  return NextResponse.json(stripSecrets({
    decision,
    job,
    spendAuthorized: HVS_WAVE2_PROVIDER_SPEND_AUTHORIZED,
  }))
}
