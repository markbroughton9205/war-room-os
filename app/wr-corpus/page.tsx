import { PanelErrorBoundary } from '@/components/war-room/runtime/PanelErrorBoundary'
import { WrCorpusPanel } from '@/components/war-room/wr-corpus/WrCorpusPanel'
import { WrTokenizerPanel } from '@/components/war-room/wr-tokenizer/WrTokenizerPanel'
import { WrimReconciliationPanel } from '@/components/war-room/wrim/WrimReconciliationPanel'

export const dynamic = 'force-dynamic'

export default function WrCorpusPage() {
  return (
    <main className="min-h-screen bg-black p-6">
      <div className="mx-auto max-w-5xl">
        <h1 className="mb-4 text-lg font-bold uppercase tracking-widest text-emerald-300">WR-CORPUS</h1>
        <PanelErrorBoundary label="WR-CORPUS" note="No tokenizer or WRIM training was executed by this failure.">
          <WrCorpusPanel />
          <div className="mt-6">
            <WrTokenizerPanel />
          </div>
          <div className="mt-6">
            <WrimReconciliationPanel />
          </div>
        </PanelErrorBoundary>
      </div>
    </main>
  )
}
