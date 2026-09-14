'use client'

import { memo } from 'react'

import type { LiveResearchClientUi } from '@/lib/runtime/liveResearchEvidencePacket'
import type { CommanderPresencePhase } from '@/lib/council/live-orchestration/rosterHealth'

const PRESENCE_LABEL: Record<CommanderPresencePhase, string> = {
  idle: 'Listening',
  understanding: 'Understanding',
  researching: 'Researching',
  verifying: 'Verifying',
  synthesizing: 'Synthesizing',
}

export const CommanderLiveIntelRail = memo(function CommanderLiveIntelRail({
  liveResearchHud,
  presencePhase,
  terraNote,
  sourcesPreview,
}: {
  liveResearchHud: LiveResearchClientUi | null
  presencePhase: CommanderPresencePhase
  terraNote?: string | null
  sourcesPreview?: string | null
}) {
  const researchActive = liveResearchHud && liveResearchHud.mode !== 'inactive'
  const sources = sourcesPreview || liveResearchHud?.intelligence?.sourcesPreview || null

  return (
    <aside
      className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-2xl border border-cyan-400/20 bg-[rgba(2,8,14,0.82)] shadow-[0_0_28px_rgba(0,40,60,0.35)] backdrop-blur-xl"
      data-testid="commander-live-intel-rail"
    >
      <div className="border-b border-white/10 px-3 py-2.5">
        <p className="text-[9px] font-bold uppercase tracking-[0.28em] text-cyan-300">Live Intel</p>
        <p className="mt-1 text-[10px] text-slate-500">Current signals for this conversation</p>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <section className="rounded-xl border border-white/8 bg-black/30 px-3 py-2.5">
          <p className="text-[8px] font-bold uppercase tracking-[0.22em] text-slate-500">War Room</p>
          <p
            className={`mt-1 text-[12px] font-semibold tracking-wide ${presencePhase === 'idle' ? 'text-emerald-200' : 'text-cyan-200'}`}
            data-testid="commander-presence-phase"
          >
            {PRESENCE_LABEL[presencePhase]}
          </p>
          {presencePhase !== 'idle' ? (
            <div className="mt-2 h-px w-full overflow-hidden rounded-full bg-cyan-900/50">
              <div className="commander-research-scan h-full w-1/2 bg-cyan-400/70" />
            </div>
          ) : null}
        </section>

        <section className="rounded-xl border border-white/8 bg-black/30 px-3 py-2.5">
          <p className="text-[8px] font-bold uppercase tracking-[0.22em] text-slate-500">Research</p>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-300">
            {researchActive ? liveResearchHud?.label : 'No live research on this turn.'}
          </p>
        </section>

        <section className="rounded-xl border border-white/8 bg-black/30 px-3 py-2.5">
          <p className="text-[8px] font-bold uppercase tracking-[0.22em] text-slate-500">Sources</p>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
            {sources || 'Evidence appears here when War Room retrieves live sources.'}
          </p>
          {liveResearchHud?.sourcesCount ? (
            <p className="mt-2 text-[10px] text-cyan-300/80">{liveResearchHud.sourcesCount} source{liveResearchHud.sourcesCount === 1 ? '' : 's'}</p>
          ) : null}
        </section>

        <section className="rounded-xl border border-white/8 bg-black/30 px-3 py-2.5">
          <p className="text-[8px] font-bold uppercase tracking-[0.22em] text-slate-500">Terra</p>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
            {terraNote || 'Living world context stays behind the conversation.'}
          </p>
        </section>
      </div>
    </aside>
  )
})
