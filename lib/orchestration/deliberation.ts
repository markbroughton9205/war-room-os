import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import {
  getCouncilThreadState,
  listCognitiveBusEvents,
  patchCouncilThreadState,
} from '@/lib/cognitive-bus/bus'
import { applyCouncilRenderGate } from '@/lib/council/councilRenderGate'
import { buildStructuredProviderPacket, packetsConflict } from '@/lib/cognitive-bus/packet'
import type { ProviderPacketIntegrityStatus } from '@/lib/cognitive-bus/types'
import { publishAndPersistBusEvent, persistCouncilThreadState } from '@/lib/cognitive-bus/persistence'
import type { OperatorPacket, StructuredProviderPacket } from '@/lib/cognitive-bus/types'
import { priorProviderPacketsInThread } from '@/lib/council-routing/threadContext'
import { routeProviderMessage, auditProviderRouting } from '@/lib/council-routing/route'
import { logCognitiveBusAudit } from '@/lib/orchestration/cognitiveAudit'
import { applyPhaseTransition } from '@/lib/orchestration/cognitiveStateMachine'
import { scoreOrchestrationPriority } from '@/lib/orchestration/priority'
import { buildProviderMemoryInjection } from '@/lib/provider-memory/inject'
import { inferCouncilTaskType, rankedFamiliesForDecree, routeFamiliesForTask } from '@/lib/provider-specialization/routing'
import type { WarRoomSupabase } from '@/lib/war-room/persistence'

function mapRenderGateIntegrity(status: string): ProviderPacketIntegrityStatus {
  if (status === 'COMPLETE') return 'verified'
  if (status === 'DEGRADED_RESPONSE_QUALITY') return 'degraded'
  if (status === 'EMPTY' || status === 'UNKNOWN') return 'unknown'
  return 'incomplete'
}

export type DeliberationStepKind =
  | 'intake'
  | 'advance'
  | 'register_packet'
  | 'challenge'
  | 'synthesize'
  | 'approve_operator_packet'

export type DeliberationStepInput = {
  threadId: string
  kind: DeliberationStepKind
  decree?: string
  signalId?: string
  family?: CouncilOrchestrationFamily
  displayText?: string
  correlationId?: string
  approved?: boolean
}

export type DeliberationStepResult = {
  ok: boolean
  phase: string
  priority: number
  events: ReturnType<typeof listCognitiveBusEvents>
  operatorPacket: OperatorPacket | null
  routedFamilies: CouncilOrchestrationFamily[]
  consensusState: OperatorPacket['consensus_state'] | null
  error?: string
}

function collectPackets(threadId: string): StructuredProviderPacket[] {
  return priorProviderPacketsInThread(threadId)
}

function detectOpenContradictions(packets: StructuredProviderPacket[]): string[] {
  const conflicts: string[] = []
  for (let i = 0; i < packets.length; i += 1) {
    for (let j = i + 1; j < packets.length; j += 1) {
      if (packetsConflict(packets[i]!, packets[j]!)) {
        conflicts.push(`${packets[i]!.family}↔${packets[j]!.family}`)
      }
    }
  }
  return [...new Set(conflicts)]
}

function buildOperatorPacket(threadId: string, packets: StructuredProviderPacket[]): OperatorPacket {
  const open = detectOpenContradictions(packets)
  const escalationPending = packets.some(p => p.escalation_requests.length > 0)
  const consensus_state: OperatorPacket['consensus_state'] =
    open.length > 0 ? 'CONFLICTED' : packets.length >= 2 ? 'ALIGNED' : 'INSUFFICIENT_EVIDENCE'

  return {
    thread_id: threadId,
    status: 'PROPOSED',
    synthesis_summary:
      consensus_state === 'CONFLICTED'
        ? `Families disagree on ${open.join(', ')}. Commander review required; no fabricated consensus.`
        : packets.length
          ? `Synthesis from ${packets.length} structured family packet(s).`
          : 'Insufficient structured family packets for synthesis.',
    consensus_state,
    family_packets: packets,
    open_contradictions: open,
    escalation_pending: escalationPending,
    commander_approval_required: true,
    generated_at: new Date().toISOString(),
  }
}

export async function runDeliberationStep(
  client: WarRoomSupabase | null,
  input: DeliberationStepInput,
): Promise<DeliberationStepResult> {
  const threadId = input.threadId.trim()
  if (!threadId) {
    return {
      ok: false,
      phase: 'intake',
      priority: 0,
      events: [],
      operatorPacket: null,
      routedFamilies: [],
      consensusState: null,
      error: 'threadId required',
    }
  }

  let state = getCouncilThreadState(threadId)
  const taskType = inferCouncilTaskType(input.decree ?? '')
  let routedFamilies: CouncilOrchestrationFamily[] = []

  await logCognitiveBusAudit(client, {
    action: `deliberation_${input.kind}`,
    threadId,
    detail: { phase: state.phase, taskType },
  })

  if (input.kind === 'intake') {
    const decree = (input.decree ?? '').trim()
    await publishAndPersistBusEvent(client, {
      threadId,
      type: 'signal_received',
      correlationId: input.correlationId,
      payload: {
        decreePreview: decree.slice(0, 280),
        signalId: input.signalId ?? null,
        taskType,
      },
    })
    routedFamilies = rankedFamiliesForDecree(decree, 4)
    state = patchCouncilThreadState(threadId, {
      phase: 'intake',
      correlationId: input.correlationId ?? state.correlationId,
      inheritedContext: { lastDecree: decree.slice(0, 500), taskType, routedFamilies },
    })
    for (let i = 0; i < routedFamilies.length - 1; i += 1) {
      const from = routedFamilies[i]!
      const to = routedFamilies[i + 1]!
      routeProviderMessage({ threadId, fromFamily: from, toFamily: to, reason: `specialization_chain:${taskType}`, correlationId: input.correlationId })
      await auditProviderRouting(client, { threadId, from, to, reason: `specialization_chain:${taskType}` })
    }
    state = applyPhaseTransition(state)
  }

  if (input.kind === 'advance') {
    state = applyPhaseTransition(state)
    if (state.phase === 'specialize') {
      const decree = String(state.inheritedContext.lastDecree ?? input.decree ?? '')
      routedFamilies = routeFamiliesForTask(taskType, { includeRedTeam: false, maxFamilies: 4 })
      for (const family of routedFamilies) {
        const memory = await buildProviderMemoryInjection(client, family)
        await publishAndPersistBusEvent(client, {
          threadId,
          type: 'delegation',
          correlationId: input.correlationId,
          payload: {
            family,
            memorySnippetCount: memory.snippetCount,
            memoryDegraded: memory.degraded,
            priority: scoreOrchestrationPriority({ taskType, decree, escalationPending: false }),
          },
        })
      }
    }
  }

  if (input.kind === 'register_packet' && input.family && input.displayText) {
    const gate = applyCouncilRenderGate(input.family, input.displayText)
    if (gate.displayText.trim()) {
      const integrityStatus = mapRenderGateIntegrity(gate.integrityStatus)
      const packet = buildStructuredProviderPacket({
        family: input.family,
        displayText: gate.displayText,
        integrityStatus,
        confidence: gate.degraded ? 0.35 : integrityStatus === 'verified' ? 0.85 : undefined,
      })
      await publishAndPersistBusEvent(client, {
        threadId,
        type: 'provider_packet',
        correlationId: input.correlationId,
        payload: { packet },
      })
      const peers = collectPackets(threadId)
      for (const peer of peers) {
        if (packetsConflict(packet, peer)) {
          await publishAndPersistBusEvent(client, {
            threadId,
            type: 'contradiction_raised',
            payload: {
              families: [packet.family, peer.family],
              summary: `Structured outputs conflict between ${packet.family} and ${peer.family}.`,
            },
          })
        }
      }
    }
  }

  if (input.kind === 'challenge') {
    await publishAndPersistBusEvent(client, {
      threadId,
      type: 'challenge',
      correlationId: input.correlationId,
      payload: {
        challenger: 'red_team',
        target: input.family ?? 'council',
        note: 'Red Team challenge issued; disagreement preserved if evidence insufficient.',
      },
    })
    state = patchCouncilThreadState(threadId, { phase: 'red_team' })
  }

  if (input.kind === 'synthesize') {
    const packets = collectPackets(threadId)
    const open = detectOpenContradictions(packets)
    await publishAndPersistBusEvent(client, {
      threadId,
      type: 'synthesis_step',
      payload: {
        packetCount: packets.length,
        openContradictions: open,
        consensusState: open.length ? 'CONFLICTED' : packets.length >= 2 ? 'ALIGNED' : 'INSUFFICIENT_EVIDENCE',
      },
    })
    const operatorPacket = buildOperatorPacket(threadId, packets)
    await publishAndPersistBusEvent(client, {
      threadId,
      type: 'operator_packet',
      payload: { packet: operatorPacket },
    })
    state = patchCouncilThreadState(threadId, { phase: 'operator_packet', operatorPacket })
  }

  if (input.kind === 'approve_operator_packet') {
    if (!state.operatorPacket) {
      return {
        ok: false,
        phase: state.phase,
        priority: 0,
        events: listCognitiveBusEvents(threadId),
        operatorPacket: null,
        routedFamilies: [],
        consensusState: null,
        error: 'No operator packet to approve.',
      }
    }
    if (!input.approved) {
      state = patchCouncilThreadState(threadId, {
        operatorPacket: { ...state.operatorPacket, status: 'REJECTED' },
      })
    } else {
      state = patchCouncilThreadState(threadId, {
        operatorPacket: { ...state.operatorPacket, status: 'APPROVED', commander_approval_required: false },
      })
      await logCognitiveBusAudit(client, { action: 'commander_approved_operator_packet', threadId })
    }
  }

  await persistCouncilThreadState(client, state)

  const priority = scoreOrchestrationPriority({
    taskType,
    decree: String(state.inheritedContext.lastDecree ?? input.decree ?? ''),
    hasContradiction: Boolean(state.operatorPacket?.open_contradictions.length),
    escalationPending: state.operatorPacket?.escalation_pending,
  })

  return {
    ok: true,
    phase: state.phase,
    priority,
    events: listCognitiveBusEvents(threadId, 80),
    operatorPacket: state.operatorPacket,
    routedFamilies,
    consensusState: state.operatorPacket?.consensus_state ?? null,
  }
}

/** Server hook: register provider output on cognitive bus after Live Council response. */
export async function registerCouncilProviderPacketOnBus(opts: {
  client: WarRoomSupabase | null
  threadId: string
  family: CouncilOrchestrationFamily
  displayText: string
  correlationId?: string
}): Promise<void> {
  if (!opts.displayText.trim()) return
  await runDeliberationStep(opts.client, {
    threadId: opts.threadId,
    kind: 'register_packet',
    family: opts.family,
    displayText: opts.displayText,
    correlationId: opts.correlationId,
  })
}
