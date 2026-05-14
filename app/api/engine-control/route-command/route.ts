import { NextResponse } from 'next/server'

import { buildToolRoutingSnapshotFromOrigin, requestOriginFromHeaders } from '@/lib/engine-control/tool-snapshot'
import { routeCommand } from '@/lib/engine-control/router'
import { collectEngineStatuses, summarizeEngines } from '@/lib/engine-control/status'
import type { CommandApprovals, RouteCommandBody } from '@/lib/engine-control/types'
import { insertWarRoomAuditLog } from '@/lib/war-room/auditLog'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  let body: RouteCommandBody
  try {
    body = (await request.json()) as RouteCommandBody
  } catch {
    return NextResponse.json({ message: 'Invalid JSON body.' }, { status: 400 })
  }

  const command = typeof body.command === 'string' ? body.command : ''
  const approvals: CommandApprovals = {
    write: Boolean(body.approvals?.write),
    commit: Boolean(body.approvals?.commit),
    rollback: Boolean(body.approvals?.rollback),
    internet: Boolean(body.approvals?.internet),
    research: Boolean(body.approvals?.research),
    terminal: Boolean(body.approvals?.terminal),
  }

  const sup = tryWarRoomSupabase()

  try {
    const origin = await requestOriginFromHeaders()
    const tools = await buildToolRoutingSnapshotFromOrigin(origin)
    const engines = await collectEngineStatuses(tools)
    const routed = routeCommand({ command, engines, tools, approvals })

    await insertWarRoomAuditLog(sup.ok ? sup.client : null, {
      actor: 'system',
      category: 'engine',
      message: 'Engine route-command completed.',
      metadata: {
        commandPreview: command.slice(0, 200),
        selectedFamily: routed.selectedFamily,
        selectedEngine: routed.selectedEngine,
        canExecute: routed.canExecute,
        capabilityMatch: routed.capabilityMatch,
      },
    })

    return NextResponse.json({
      ...routed,
      enginesSummary: summarizeEngines(engines),
    })
  } catch (error) {
    await insertWarRoomAuditLog(sup.ok ? sup.client : null, {
      actor: 'system',
      category: 'engine',
      message: 'Engine route-command failed.',
      metadata: {
        commandPreview: command.slice(0, 200),
        error: error instanceof Error ? error.message : String(error),
      },
    })

    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : 'Route command failed.',
      },
      { status: 500 },
    )
  }
}
