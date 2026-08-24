import { BuilderWorkspace } from '@/components/war-room/builder/BuilderWorkspace'

export const dynamic = 'force-dynamic'

export default function BuilderPage() {
  return (
    <main className="min-h-screen bg-black p-4">
      <div className="mx-auto max-w-[1600px]">
        <h1 className="mb-3 text-lg font-bold uppercase tracking-widest text-emerald-300">War Room Builder</h1>
        <p className="mb-4 text-[11px] text-slate-500">
          Standalone Engineering Core client — thin client only. All coding/execution truth lives in
          native-builder via the Mission Runtime Engineering strategy.
        </p>
        <BuilderWorkspace />
      </div>
    </main>
  )
}
