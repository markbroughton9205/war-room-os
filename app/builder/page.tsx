import { FoundryShell } from '@/components/war-room/foundry/FoundryShell'

export const dynamic = 'force-dynamic'

export default function BuilderAliasPage() {
  return (
    <main className="min-h-screen bg-black p-4 text-white">
      <div className="mx-auto max-w-[1600px]">
        <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-emerald-500">Compatibility alias</p>
        <h1 className="mb-3 text-lg font-bold uppercase tracking-widest text-emerald-300">The Foundry</h1>
        <FoundryShell basePath="/builder" />
      </div>
    </main>
  )
}
