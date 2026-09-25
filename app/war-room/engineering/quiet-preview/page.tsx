/**
 * Quiet Execution fixture preview (validation only).
 * @route /war-room/engineering/quiet-preview?case=A..L[&open=1]
 *
 * Renders the real FoundryQuietThread and FoundryComposer from the shared fixture states that
 * foundryQuietPresentation.validation.ts proves. It reads no mission, starts nothing, and writes nothing.
 */
'use client'

import { Suspense, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { FoundryComposer } from '@/components/war-room/foundry/FoundryComposer'
import { FoundryQuietThread } from '@/components/war-room/foundry/FoundryQuietThread'
import { buildContextView, buildModelRegistryView, type FoundryComposerMode } from '@/lib/native-builder/foundryComposerModel'
import { FIXTURE_REQUEST, quietFixtureCases } from '@/lib/native-builder/foundryQuietFixtures'
import { buildQuietThread } from '@/lib/native-builder/foundryQuietPresentation'

function Preview() {
  const params = useSearchParams()
  const cases = quietFixtureCases()
  const active = cases.find(item => item.id === (params.get('case') ?? 'I').toUpperCase()) ?? cases[8]
  const thread = buildQuietThread(active.input)
  const [mode, setMode] = useState<FoundryComposerMode>('agent')
  const [request, setRequest] = useState('')
  const promptRef = useRef<HTMLTextAreaElement | null>(null)
  const registry = buildModelRegistryView({
    known: true,
    local: { state: active.id === 'K' ? 'ERROR' : 'READY', label: 'Qwen 2.5 Coder 14B', model: 'qwen2.5-coder:14b', detail: 'Local worker' },
    brain: null,
    providers: [{ family: 'claude', configured: false }, { family: 'gpt', configured: true }],
  })
  const files = ['backend/api.py', 'frontend/view.py', 'shared/contract.py', 'tests/test_tickets.py']
  return (
    <main className="min-h-screen bg-[#020403] p-3 text-slate-200">
      <p className="mb-2 text-[10px] uppercase tracking-[0.25em] text-amber-300/80">Fixture preview — validation only, not a live mission</p>
      <nav className="mb-3 flex flex-wrap gap-1.5 text-[11px]" aria-label="Fixture cases">
        {cases.map(item => (
          <a key={item.id} href={`?case=${item.id}${params.get('open') ? '&open=1' : ''}`} className={`rounded px-2 py-0.5 ${item.id === active.id ? 'bg-white/10 text-slate-100' : 'text-slate-500 hover:text-slate-300'}`}>
            {item.id} · {item.label}
          </a>
        ))}
      </nav>
      <section className="foundry-glass mx-auto flex h-[calc(100vh-8rem)] max-w-3xl flex-col rounded-lg" data-testid="foundry-chat">
        <div className="foundry-q-thread min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          <div className="foundry-q-msg">
            <p className="text-[10px] uppercase tracking-[0.2em] text-emerald-400/55">You</p>
            <p className="mt-0.5 text-[15px] leading-[1.55] text-slate-100">{FIXTURE_REQUEST}</p>
          </div>
          <FoundryQuietThread
            thread={thread}
            defaultActivityOpen={params.get('open') === '1'}
            onOpenFile={() => undefined}
            onOpenRaw={() => undefined}
            onStop={() => undefined}
            onRetry={() => undefined}
            onReviewProblem={() => undefined}
            onOpenModels={() => undefined}
            onViewChanges={() => undefined}
            onOpenPreview={() => undefined}
            onOpenFiles={() => undefined}
            onRunTests={() => undefined}
          />
        </div>
        <div className="px-4 pb-3 pt-1">
          <FoundryComposer
            request={request}
            onRequestChange={setRequest}
            promptRef={promptRef}
            onSend={() => undefined}
            onStop={() => undefined}
            busy={null}
            hasMission={active.id !== 'A' && active.id !== 'K'}
            missionRunning={thread.progress.working && active.id !== 'A'}
            mode={mode}
            onModeChange={setMode}
            registry={registry}
            context={buildContextView({ files, changedFiles: ['backend/api.py'] })}
            onInsertContext={reference => setRequest(current => `${current}@${reference} `)}
            localReady={active.id !== 'K'}
            webReady
            terminalOpen={false}
            onToggleTerminal={() => undefined}
          />
        </div>
      </section>
    </main>
  )
}

export default function QuietPreviewPage() {
  return (
    <Suspense fallback={null}>
      <Preview />
    </Suspense>
  )
}
