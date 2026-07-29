import { PanelErrorBoundary } from '@/components/war-room/runtime/PanelErrorBoundary'
import { SovereignModelLabPanel } from '@/components/war-room/sovereign-model-lab/SovereignModelLabPanel'

export const dynamic = 'force-dynamic'

export default function SovereignModelLabPage() {
  return (
    <main className="min-h-screen bg-black p-6">
      <div className="mx-auto max-w-5xl">
        <h1 className="mb-4 text-lg font-bold uppercase tracking-widest text-emerald-300">Sovereign Model Lab</h1>
        <PanelErrorBoundary label="Sovereign Model Lab" note="No tokenizer training or approval action was executed by this failure.">
          <SovereignModelLabPanel />
        </PanelErrorBoundary>
      </div>
    </main>
  )
}
