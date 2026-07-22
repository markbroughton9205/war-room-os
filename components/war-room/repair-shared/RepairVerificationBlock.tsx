import type { CouncilRepairPacket } from '@/lib/council-repair'

import { FieldList } from './FieldList'

/** rollbackPlan is the spec-aligned field; rollbackNotes is the legacy backing field with the same content today. */
export function sameStringArray(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index])
}

/** Verification requirements + rollback plan. Rollback Notes is only shown when it diverges from Rollback Plan, so a legacy/alternate field never goes silently missing. */
export function RepairVerificationBlock({ packet }: { packet: CouncilRepairPacket }) {
  const notesDiffer = packet.rollbackNotes.length > 0 && !sameStringArray(packet.rollbackPlan, packet.rollbackNotes)
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <FieldList title="Verification Requirements" items={packet.verificationRequirements} />
      <FieldList title="Rollback Plan" items={packet.rollbackPlan} />
      {notesDiffer ? <FieldList title="Rollback Notes" items={packet.rollbackNotes} /> : null}
    </div>
  )
}
