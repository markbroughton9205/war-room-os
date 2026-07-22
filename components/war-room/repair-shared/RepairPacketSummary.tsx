import type { CouncilRepairPacket } from '@/lib/council-repair'

/** Title, summary, source panel, affected subsystem, and observation timestamps. */
export function RepairPacketSummary({ packet }: { packet: CouncilRepairPacket }) {
  return (
    <div>
      <h3 className="text-lg font-semibold text-white">{packet.title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-slate-400">{packet.summary}</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] text-slate-500 sm:grid-cols-4">
        <div>
          <dt className="uppercase tracking-widest text-slate-600">Source panel</dt>
          <dd className="text-slate-400">{packet.sourcePanel}</dd>
        </div>
        <div>
          <dt className="uppercase tracking-widest text-slate-600">Affected subsystem</dt>
          <dd className="text-slate-400">{packet.affectedSubsystem}</dd>
        </div>
        <div>
          <dt className="uppercase tracking-widest text-slate-600">Detected</dt>
          <dd className="text-slate-400">{new Date(packet.detectedAt).toLocaleString()}</dd>
        </div>
        <div>
          <dt className="uppercase tracking-widest text-slate-600">Last observed</dt>
          <dd className="text-slate-400">{new Date(packet.lastObservedAt).toLocaleString()}</dd>
        </div>
      </dl>
    </div>
  )
}
