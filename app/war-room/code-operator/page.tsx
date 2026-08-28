import Link from 'next/link'
import { WarRoomUiModeProvider } from '@/components/war-room/WarRoomUiModeContext'
import { EngineeringMissionConsole } from '@/components/war-room/engineering/EngineeringMissionConsole'

export const dynamic = 'force-dynamic'

export default function CodeOperatorPage() {
  return (
    <WarRoomUiModeProvider>
      <main className="min-h-screen bg-gradient-to-b from-neutral-950 to-black px-4 py-8 text-white">
        <div className="mx-auto max-w-[1600px]">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-emerald-500">War Room OS</p>
              <h1 className="text-xl font-bold uppercase tracking-widest text-emerald-300">Native Code Operator</h1>
              <p className="mt-1 max-w-3xl text-[11px] text-slate-400">First-party secure coding agent on the shared Engineering Mission Runtime. Repository reads, proposals, diffs, validation, approval-gated file changes, rollback, and audit evidence use one authoritative execution surface.</p>
            </div>
            <Link href="/" className="rounded border border-emerald-900/60 px-3 py-1.5 text-[10px] uppercase tracking-widest text-emerald-300">Return to War Room</Link>
          </div>
          <section className="mb-4 grid gap-2 sm:grid-cols-3" aria-label="Code Operator security boundaries">
            <Boundary label="Workspace" value="war-room-os only" />
            <Boundary label="Secrets" value="protected and redacted" />
            <Boundary label="External action" value="Commander approval required" />
          </section>
          <EngineeringMissionConsole basePath="/war-room/code-operator" />
        </div>
      </main>
    </WarRoomUiModeProvider>
  )
}

function Boundary({ label, value }: { label: string; value: string }) {
  return <div className="rounded border border-emerald-900/40 bg-black/50 p-2"><div className="text-[9px] uppercase tracking-widest text-slate-600">{label}</div><div className="text-[11px] text-emerald-200">{value}</div></div>
}
