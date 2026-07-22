import type { CouncilRepairPacket } from '@/lib/council-repair'

import { Badge } from './Badge'

/** Classification/severity/status/approvalStatus badge row shared across Approvals, Red Team, and RepairPacketPanel. */
export function RepairStatusBadges({ packet }: { packet: CouncilRepairPacket }) {
  return (
    <div className="flex flex-wrap gap-1">
      <Badge label={packet.classification} />
      <Badge label={packet.severity} />
      <Badge label={packet.status} />
      <Badge label={packet.approvalStatus} />
    </div>
  )
}
