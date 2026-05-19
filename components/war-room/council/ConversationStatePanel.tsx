'use client'

import type { ReactNode } from 'react'

import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { ConversationRuntimeSnapshot } from '@/lib/conversation-runtime/types'
import type { ProviderFamilyConversationState } from '@/lib/provider-state/types'

const MOMENTUM_STYLE: Record<ConversationRuntimeSnapshot['councilMomentum'], string> = {
  rising: 'text-[#34D399] border-[#34D399]/40',
  stable: 'text-[#60A5FA] border-[#60A5FA]/40',
  decaying: 'text-amber-300 border-amber-500/40',
  idle: 'text-slate-500 border-white/10',
}

const FOCUS_STYLE: Record<ProviderFamilyConversationState['focusLabel'], string> = {
  active: 'text-[#00ff41]',
  watching: 'text-[#FFD700]',
  idle: 'text-slate-500',
}

function familyLabel(family: CouncilOrchestrationFamily): string {
  if (family === 'red_team') return 'Red Team'
  if (family === 'bridge_architect') return 'Bridge'
  return family.charAt(0).toUpperCase() + family.slice(1)
}

export function ConversationStatePanel({
  runtime,
  className = '',
}: {
  runtime: ConversationRuntimeSnapshot | null
  className?: string
}) {
  if (!runtime) {
    return (
      <section
        className={[
          'rounded-xl border border-white/10 bg-black/40 p-3 font-mono text-[10px] text-slate-500',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        aria-label="Council conversation state"
      >
        <p className="text-[9px] uppercase tracking-widest text-slate-600">Conversation runtime loading…</p>
      </section>
    )
  }

  const providerEntries = Object.entries(runtime.providerStates).filter(
    (entry): entry is [CouncilOrchestrationFamily, ProviderFamilyConversationState] =>
      Boolean(entry[1]?.family),
  )

  return (
    <section
      className={[
        'rounded-xl border border-[#00ff41]/15 bg-black/45 p-3 font-mono text-[10px] text-slate-300 shadow-[0_0_24px_rgba(0,255,65,0.06)]',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label="Council conversation state"
    >
      <header className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2">
        <h3 className="text-[9px] font-semibold uppercase tracking-[0.3em] text-[#FFD700]">Council state</h3>
        <span
          className={[
            'rounded border px-2 py-0.5 text-[8px] uppercase tracking-wide',
            MOMENTUM_STYLE[runtime.councilMomentum],
          ].join(' ')}
        >
          {runtime.councilMomentum}
        </span>
      </header>

      <dl className="space-y-2">
        <StateRow label="Active topic" value={runtime.activeTopic} />
        <StateRow label="Turns" value={String(runtime.turnCount)} />
        {runtime.idleExpired ? (
          <p className="text-[9px] text-amber-400/90">Session idle (&gt;24h). Refresh or send a decree to resume.</p>
        ) : null}
        {runtime.latestSynthesis ? <StateRow label="Latest synthesis" value={runtime.latestSynthesis} /> : null}
      </dl>

      {runtime.unresolvedInvestigations.length > 0 ? (
        <StateBlock title="Open investigations">
          <ul className="list-inside list-disc space-y-1 text-[9px] text-slate-400">
            {runtime.unresolvedInvestigations.slice(0, 5).map(item => (
              <li key={item.slice(0, 40)}>{item}</li>
            ))}
          </ul>
        </StateBlock>
      ) : null}

      {Object.keys(runtime.contradictionMap).length > 0 ? (
        <StateBlock title="Contradiction map">
          <ul className="space-y-1 text-[9px]">
            {Object.entries(runtime.contradictionMap)
              .slice(0, 6)
              .map(([family, items]) => (
                <li key={family}>
                  <span className="text-[#EAB308]">{family}</span>
                  <span className="text-slate-500"> — {items.slice(0, 2).join('; ') || 'flagged'}</span>
                </li>
              ))}
          </ul>
        </StateBlock>
      ) : null}

      {providerEntries.length > 0 ? (
        <StateBlock title="Provider focus">
          <ul className="grid gap-1 sm:grid-cols-2">
            {providerEntries.slice(0, 8).map(([family, state]) => (
              <li
                key={family}
                className="rounded border border-white/5 bg-white/[0.02] px-2 py-1.5"
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[9px] text-slate-400">{familyLabel(family)}</span>
                  <span className={`text-[8px] uppercase ${FOCUS_STYLE[state.focusLabel]}`}>{state.focusLabel}</span>
                </div>
                <p className="mt-0.5 truncate text-[8px] text-slate-500" title={state.topicFocus}>
                  {state.topicFocus}
                </p>
              </li>
            ))}
          </ul>
        </StateBlock>
      ) : null}

      {runtime.rollingSummary ? (
        <StateBlock title="Compressed context">
          <p className="max-h-24 overflow-y-auto text-[9px] leading-relaxed text-slate-500">
            {runtime.rollingSummary.slice(0, 480)}
            {runtime.rollingSummary.length > 480 ? '…' : ''}
          </p>
        </StateBlock>
      ) : null}

      <p className="mt-2 text-[8px] text-slate-600">
        Ra&apos;el authority preserved — conversational continuation only.
      </p>
    </section>
  )
}

function StateRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[8px] uppercase tracking-widest text-slate-600">{label}</dt>
      <dd className="mt-0.5 text-[9px] leading-snug text-slate-300">{value}</dd>
    </div>
  )
}

function StateBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-3 border-t border-white/5 pt-2">
      <p className="mb-1 text-[8px] uppercase tracking-widest text-slate-600">{title}</p>
      {children}
    </div>
  )
}