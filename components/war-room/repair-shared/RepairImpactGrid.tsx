import type { CouncilRepairPacket } from '@/lib/council-repair'

import { FieldList } from './FieldList'

/** Security/user/reliability impact, three-column. */
export function RepairImpactGrid({ packet }: { packet: CouncilRepairPacket }) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <FieldList title="Security Impact" items={[packet.securityImpact]} />
      <FieldList title="User Impact" items={[packet.userImpact]} />
      <FieldList title="Reliability Impact" items={[packet.reliabilityImpact]} />
    </div>
  )
}
