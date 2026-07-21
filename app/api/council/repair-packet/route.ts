import { NextResponse } from 'next/server'
import { isCouncilStabilityMode } from '@/lib/council/stabilityMode'

import {
  getRepairSnapshot,
  rememberRepairPacket,
  rememberRepairRequest,
  tryCreateCouncilRepairPacket,
} from '@/lib/council-repair'
import { emitEvent } from '@/lib/events/bus'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'

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
  if (isCouncilStabilityMode()) {
    return NextResponse.json(
      { error: 'repair_packet_disabled', message: 'Repair packets are disabled while Minimal Stable Council Mode is active.' },
      { status: 503 },
    )
  }
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

  const created = tryCreateCouncilRepairPacket({
    decree,
    sourceMessageId: text(input.sourceMessageId) || null,
    sourceFamily: text(input.sourceFamily) || null,
    sourceContent: text(input.sourceContent) || null,
  })

  rememberRepairRequest(created.request)

  if (!created.ok) {
    return NextResponse.json(
      {
        scope: created.scope,
        clarification: created.clarification,
        affectedPanelRoute: created.affectedPanelRoute,
        request: created.request,
        guardrails: {
          advisoryOnly: true,
          approvalRequired: true,
          canExecute: false,
          canMutateFiles: false,
        },
      },
      {
        status: 422,
        headers: {
          'cache-control': 'no-store',
          'x-war-room-repair': 'needs-scope',
        },
      },
    )
  }

  const { packet, request } = created
  rememberRepairPacket(packet)

  const supabase = tryWarRoomSupabase()
  const event = await emitEvent({
    supabase: supabase.ok ? supabase.client : null,
    type: 'council.repair_packet.created',
    source: 'user',
    correlationId: packet.id,
    payload: {
      packetId: packet.id,
      requestId: request.id,
      classification: packet.classification,
      title: packet.title,
      concreteIssue: packet.concreteIssue,
      affectedPanelRoute: packet.affectedPanelRoute,
      approvalStatus: packet.approvalStatus,
      status: packet.status,
      severity: packet.severity,
      sourceFamily: packet.source.sourceFamily,
      connectedSurfaces: packet.connectedSurfaces,
      guardrails: packet.guardrails,
      babyLessonCandidate: packet.babyLessonCandidate.summary,
    },
  })

  return NextResponse.json({
    request,
    packet,
    operatorNextSteps: packet.operatorNextSteps,
    operatorNextStepsMarkdown: packet.operatorNextStepsMarkdown,
    ledger: {
      eventType: 'council.repair_packet.created',
      eventId: event.event?.id ?? null,
      persisted: event.persisted,
      auditWritten: event.auditWritten,
    },
    activity: {
      message: 'Repair packet created for Engineering Lane manual Cursor handoff.',
      canExecute: false,
      canMutateFiles: false,
      cursorInvoked: false,
    },
  }, {
    status: 201,
    headers: {
      'cache-control': 'no-store',
      'x-war-room-repair': 'packet-created-advisory-only',
      'x-war-room-persistence': supabase.ok ? 'available' : 'unavailable',
    },
  })
}
