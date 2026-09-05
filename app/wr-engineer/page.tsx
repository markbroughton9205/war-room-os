import Link from 'next/link'
import { WarRoomUiModeProvider } from '@/components/war-room/WarRoomUiModeContext'
import { PanelErrorBoundary } from '@/components/war-room/runtime/PanelErrorBoundary'
import { WrEngineerConsole } from '@/components/war-room/wr-engineer/WrEngineerConsole'

export const dynamic = 'force-dynamic'

export default function WrEngineerPage() {
  return (
    <WarRoomUiModeProvider>
      <main className="min-h-screen bg-gradient-to-b from-neutral-950 to-black px-4 py-8 text-white">
        <div className="mx-auto max-w-[1600px]">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-emerald-500">War Room OS</p>
              <h1 className="text-xl font-bold uppercase tracking-widest text-emerald-300">WR-Engineer</h1>
              <p className="mt-1 max-w-3xl text-[11px] text-slate-400">War Room&apos;s sovereign software-engineering specialist. Pair a machine, register a repository, and work with WR-Engineer directly — inspection and validation are live today; proposed edits flow through the same governed Native Builder apply/validate/rollback pipeline everywhere else in War Room does.</p>
            </div>
            <Link href="/" className="rounded border border-emerald-900/60 px-3 py-1.5 text-[10px] uppercase tracking-widest text-emerald-300">Return to War Room</Link>
          </div>
          <PanelErrorBoundary label="WR-Engineer" note="No engineering action was executed by this failure.">
            <WrEngineerConsole />
          </PanelErrorBoundary>
        </div>
      </main>
    </WarRoomUiModeProvider>
  )
}
