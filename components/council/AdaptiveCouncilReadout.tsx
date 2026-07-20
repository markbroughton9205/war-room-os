'use client'

import {
  adaptiveCouncilSynthesizerStatusLabel,
  createAdaptiveCouncilReadoutViewModel,
  type AdaptiveCouncilReadoutViewModel,
  type FamilyDisplayItem,
} from '@/lib/council/adaptive-assembly/shadowReadout'
import type { CouncilShadowSelectionReport } from '@/lib/council/adaptive-assembly/shadowTypes'

type AdaptiveCouncilReadoutProps = {
  report: CouncilShadowSelectionReport | null | undefined
  messageType: string
  responseComplete: boolean
  isUserMessage: boolean
}

function TruthPill({
  item,
  label,
  tone,
}: {
  item: FamilyDisplayItem
  label: string
  tone: 'overlap' | 'recommended' | 'actual'
}) {
  const color =
    tone === 'overlap'
      ? '#86EFAC'
      : tone === 'recommended'
        ? '#93C5FD'
        : '#FDE68A'
  return (
    <span
      className="inline-flex max-w-full items-center gap-1 rounded px-2 py-1 text-[10px] font-bold tracking-widest"
      style={{
        border: `1px solid ${color}55`,
        background: 'rgba(0,0,0,0.28)',
        color,
      }}
      title={`${item.label}: ${label}`}
    >
      <span className="truncate">{item.label}</span>
      <span className="text-[8px] font-normal normal-case tracking-normal" style={{ color: '#94A3B8' }}>
        {label}
      </span>
    </span>
  )
}

function ValueLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded px-2 py-2" style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.22)' }}>
      <div className="text-[9px] font-bold uppercase tracking-widest" style={{ color: '#94A3B8' }}>{label}</div>
      <div className="mt-1 break-words text-xs" style={{ color: '#E5E7EB' }}>{value}</div>
    </div>
  )
}

function FamilyGroup({
  title,
  items,
  empty,
  label,
  tone,
}: {
  title: string
  items: readonly FamilyDisplayItem[]
  empty: string
  label: string
  tone: 'overlap' | 'recommended' | 'actual'
}) {
  return (
    <section className="min-w-0 rounded px-3 py-2" style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.24)' }}>
      <h4 className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#CBD5E1' }}>{title}</h4>
      {items.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {items.map(item => <TruthPill key={`${title}-${item.id}`} item={item} label={label} tone={tone} />)}
        </div>
      ) : (
        <p className="mt-2 text-xs text-slate-500">{empty}</p>
      )}
    </section>
  )
}

function BooleanTruth({ value }: { value: boolean | null }) {
  if (value === null) return <span>Unknown</span>
  return <span>{value ? 'Yes' : 'No'}</span>
}

function ReadoutBody({ viewModel }: { viewModel: AdaptiveCouncilReadoutViewModel }) {
  return (
    <div className="mt-3 space-y-3">
      <section className="rounded px-3 py-2" style={{ border: '1px solid rgba(52,211,153,0.18)', background: 'rgba(0,0,0,0.22)' }}>
        <h3 className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#86EFAC' }}>Summary</h3>
        <p className="mt-1 text-xs leading-relaxed" style={{ color: '#CBD5E1' }}>{viewModel.statusExplanation}</p>
        <p className="mt-2 text-[10px] font-bold tracking-widest" style={{ color: '#FDE68A' }}>Advisory only — did not control execution.</p>
        <p className="mt-1 text-[10px] tracking-widest" style={{ color: viewModel.executionUnaffected ? '#86EFAC' : '#FDE68A' }}>
          {viewModel.executionUnaffected
            ? 'This recommendation did not control provider selection or execution.'
            : 'Execution-isolation confirmation unavailable.'}
        </p>
        {viewModel.failureMessage ? (
          <p className="mt-2 text-xs" style={{ color: '#FCA5A5' }}>{viewModel.failureMessage}</p>
        ) : null}
      </section>

      <section className="grid gap-2 md:grid-cols-2">
        <FamilyGroup
          title="Recommended Council"
          items={viewModel.recommendedFamilies}
          empty="No recommended Council families available."
          label="Recommended"
          tone="recommended"
        />
        <FamilyGroup
          title="Actual Council Used"
          items={viewModel.actualFamilies}
          empty="Actual Council selection unavailable."
          label="Used"
          tone="actual"
        />
      </section>

      <section className="grid gap-2 md:grid-cols-3">
        <FamilyGroup title="Recommended and used" items={viewModel.overlappingFamilies} empty="No overlap recorded." label="Recommended and used" tone="overlap" />
        <FamilyGroup title="Recommended, not used" items={viewModel.recommendedOnlyFamilies} empty="None." label="Recommended, not used" tone="recommended" />
        <FamilyGroup title="Used, not recommended" items={viewModel.actualOnlyFamilies} empty="None." label="Used, not recommended" tone="actual" />
      </section>

      <section className="rounded px-3 py-2" style={{ border: '1px solid rgba(147,197,253,0.16)', background: 'rgba(0,0,0,0.22)' }}>
        <h3 className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#93C5FD' }}>Why War Room Recommended It</h3>
        {viewModel.recommendationReasons.length ? (
          <ul className="mt-2 space-y-1 text-xs text-slate-300">
            {viewModel.recommendationReasons.map(reason => <li key={`${reason.label}-${reason.text}`}>{reason.label}: {reason.text}</li>)}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-slate-500">Recommendation reasoning unavailable.</p>
        )}
      </section>

      <section className="grid gap-2 md:grid-cols-3">
        <ValueLine label="Requested capabilities" value={viewModel.capabilitiesRequested.join(', ') || 'Unavailable'} />
        <ValueLine label="Covered capabilities" value={viewModel.capabilitiesCovered.join(', ') || 'Unavailable'} />
        <ValueLine label="Unresolved capabilities" value={viewModel.unresolvedCapabilities.join(', ') || 'None reported'} />
      </section>

      <section className="grid gap-2 md:grid-cols-2">
        <ValueLine label="Red Team recommended" value={viewModel.recommendedRedTeam === null ? 'Unknown' : viewModel.recommendedRedTeam ? 'Yes' : 'No'} />
        <ValueLine label="Red Team participated" value={viewModel.actualRedTeamIncluded === null ? 'Unknown' : viewModel.actualRedTeamIncluded ? 'Yes' : 'No'} />
        <ValueLine label="Evidence recommended" value={viewModel.evidenceRequired === null ? 'Unknown' : viewModel.evidenceRequired ? 'Yes' : 'No'} />
        <ValueLine label="Live information recommended" value={viewModel.liveDataRequired === null ? 'Unknown' : viewModel.liveDataRequired ? 'Yes' : 'No'} />
      </section>

      <section className="grid gap-2 md:grid-cols-3">
        <ValueLine label="Recommended synthesizer" value={viewModel.recommendedSynthesizer?.label ?? 'Recommended synthesizer unavailable'} />
        <ValueLine label="Actual synthesizer" value={viewModel.actualSynthesizer?.label ?? 'Actual synthesizer unavailable'} />
        <ValueLine label="Synthesizer comparison" value={adaptiveCouncilSynthesizerStatusLabel(viewModel.synthesizerStatus)} />
      </section>

      <section className="grid gap-2 md:grid-cols-2">
        <ValueLine label="Recommendation version" value={viewModel.recommendationVersion ?? 'Unavailable'} />
        <ValueLine label="Generated" value={viewModel.generatedAt ? new Date(viewModel.generatedAt).toLocaleString() : 'Unavailable'} />
        <ValueLine label="Diagnostic source" value={viewModel.sourceLabel} />
        <ValueLine label="Execution state" value="Execution remained unchanged" />
      </section>

      {viewModel.uncertaintyMessages.length ? (
        <section className="rounded px-3 py-2" style={{ border: '1px solid rgba(251,191,36,0.18)', background: 'rgba(0,0,0,0.22)' }}>
          <h3 className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#FDE68A' }}>Uncertainty</h3>
          <ul className="mt-2 space-y-1 text-xs text-slate-300">
            {viewModel.uncertaintyMessages.map(message => <li key={message}>- {message}</li>)}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

export function AdaptiveCouncilReadout(props: AdaptiveCouncilReadoutProps) {
  const viewModel = createAdaptiveCouncilReadoutViewModel(props.report, {
    messageType: props.messageType,
    responseComplete: props.responseComplete,
    isUserMessage: props.isUserMessage,
  })

  if (!viewModel.available) return null

  return (
    <details
      className="mt-2 w-full max-w-2xl overflow-hidden rounded px-3 py-2 text-xs"
      style={{
        border: '1px solid rgba(34,211,238,0.24)',
        background: 'rgba(8,47,73,0.18)',
        color: '#CBD5E1',
      }}
    >
      <summary
        className="flex min-h-10 cursor-pointer list-none flex-wrap items-center gap-2 font-bold tracking-widest outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 [&::-webkit-details-marker]:hidden"
        aria-label={`Adaptive Council readout: ${viewModel.statusLabel}. Advisory only.`}
      >
        <span style={{ color: '#67E8F9' }}>Adaptive Council</span>
        <span style={{ color: '#64748B' }}>·</span>
        <span>{viewModel.statusLabel}</span>
        <span className="rounded px-2 py-0.5 text-[9px] uppercase" style={{ border: '1px solid rgba(251,191,36,0.38)', color: '#FDE68A' }}>
          Advisory only
        </span>
      </summary>
      <ReadoutBody viewModel={viewModel} />
      <span className="sr-only">
        Recommendation compared with actual execution. This readout has no execution controls.
        Red Team recommended: <BooleanTruth value={viewModel.recommendedRedTeam} />.
        Red Team participated: <BooleanTruth value={viewModel.actualRedTeamIncluded} />.
      </span>
    </details>
  )
}
