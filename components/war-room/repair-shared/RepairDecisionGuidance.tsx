import type { CouncilRepairPacket } from '@/lib/council-repair'

import { FieldList } from './FieldList'

const RECOMMENDED_COMMANDER_ACTION = [
  'Review the Council position and Red Team position above.',
  'Confirm the evidence actually supports the proposed repair before approving.',
  'Approve only the existing authorized manual workflow — approval does not execute the repair.',
  'If evidence or recommendations are missing or unclear, Reject or Defer instead of approving.',
]

/** Presents Council/Red Team positions side by side without claiming to auto-detect agreement or conflict. */
export function RepairDecisionGuidance({
  packet,
  unresolvedQuestions,
}: {
  packet: CouncilRepairPacket
  unresolvedQuestions?: string[]
}) {
  const councilPresent = packet.councilRecommendation.trim().length > 0
  const redTeamPresent = packet.redTeamRecommendation.trim().length > 0

  return (
    <section className="rounded border border-white/10 bg-black/20 p-3">
      <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-300">Decision Guidance</h4>

      <div className="mt-2 grid gap-3 md:grid-cols-2">
        <FieldList
          title="Council Position"
          items={[councilPresent ? packet.councilRecommendation : 'No Council recommendation is attached.']}
        />
        <FieldList
          title="Red Team Position"
          items={[redTeamPresent ? packet.redTeamRecommendation : 'No Red Team recommendation is attached.']}
        />
      </div>

      <p className="mt-3 rounded border border-amber-500/25 bg-amber-500/5 p-2 text-[10px] leading-relaxed text-amber-100">
        War Room does not algorithmically detect agreement or conflict between the Council and
        Red Team positions above — compare them manually before deciding.
        {!councilPresent || !redTeamPresent
          ? ' Decision context is incomplete: one or both positions above are missing.'
          : ''}
      </p>

      <div className="mt-3">
        <FieldList
          title="Unresolved Questions"
          items={unresolvedQuestions && unresolvedQuestions.length ? unresolvedQuestions : ['None recorded.']}
        />
      </div>

      <div className="mt-3">
        <FieldList title="Recommended Commander Action" items={RECOMMENDED_COMMANDER_ACTION} />
      </div>
    </section>
  )
}
