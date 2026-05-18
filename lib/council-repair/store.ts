import type { CouncilRepairPacket, CouncilRepairRequest, CouncilRepairSnapshot } from './model'
import { COUNCIL_REPAIR_GUARDRAILS } from './model'

const MAX_ITEMS = 25
const requests: CouncilRepairRequest[] = []
const packets: CouncilRepairPacket[] = []

function unshiftCapped<T>(items: T[], item: T) {
  items.unshift(item)
  while (items.length > MAX_ITEMS) items.pop()
}

export function rememberRepairRequest(request: CouncilRepairRequest) {
  unshiftCapped(requests, request)
}

export function rememberRepairPacket(packet: CouncilRepairPacket) {
  unshiftCapped(packets, packet)
}

export function getRepairSnapshot(): CouncilRepairSnapshot {
  return {
    generatedAt: new Date().toISOString(),
    latestRequest: requests[0] ?? null,
    latestPacket: packets[0] ?? null,
    requests: [...requests],
    packets: [...packets],
    persistenceNote: 'In-process repair packet memory; creation is mirrored to the War Room event ledger when available.',
    guardrails: COUNCIL_REPAIR_GUARDRAILS,
  }
}
