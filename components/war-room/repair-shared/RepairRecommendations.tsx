import type { CouncilRepairPacket } from '@/lib/council-repair'

import { FieldList } from './FieldList'

function textOrAbsent(value: string, absentLabel: string): string[] {
  return value.trim() ? [value] : [absentLabel]
}

/** Council recommendation, Red Team recommendation, and proposed repair — explicit absent states, never fabricated. */
export function RepairRecommendations({ packet }: { packet: CouncilRepairPacket }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <FieldList
        title="Council Recommendation"
        items={textOrAbsent(packet.councilRecommendation, 'No Council recommendation recorded for this packet.')}
      />
      <FieldList
        title="Red Team Recommendation"
        items={textOrAbsent(packet.redTeamRecommendation, 'No Red Team recommendation recorded for this packet.')}
      />
      <div className="md:col-span-2">
        <FieldList
          title="Proposed Repair"
          items={textOrAbsent(packet.proposedRepair, 'No proposed repair recorded for this packet.')}
        />
      </div>
    </div>
  )
}
