import Link from 'next/link'
import { WarRoomUiModeProvider } from '@/components/war-room/WarRoomUiModeContext'
import { FoundryShell } from '@/components/war-room/foundry/FoundryShell'

export const dynamic = 'force-dynamic'

export default function CodeOperatorAliasPage() {
  return (
    <WarRoomUiModeProvider>
      <main className="min-h-screen bg-gradient-to-b from-neutral-950 to-black px-4 py-8 text-white">
        <div className="mx-auto max-w-[1600px]">
          <div className="mb-4 flex items-end justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-emerald-500">Compatibility alias</p>
              <h1 className="text-xl font-bold uppercase tracking-widest text-emerald-300">The Foundry</h1>
            </div>
            <Link href="/war-room/engineering" className="rounded border border-emerald-900/60 px-3 py-1.5 text-[10px] uppercase tracking-widest text-emerald-300">Canonical Foundry route</Link>
          </div>
          <FoundryShell basePath="/war-room/code-operator" />
        </div>
      </main>
    </WarRoomUiModeProvider>
  )
}
