'use client'

import { reasoningPanelModel, type ReasoningPanelInput } from '@/lib/native-builder/reasoning-kernel/brief-view'

export function FoundryReasoningKernelSection({
  brief,
  currentAction,
  lastObservation,
  verdict,
  recommendedWorker,
  selectedWorker,
  previousWorker,
  routingWhy,
  capabilityEvidence,
  routingMode,
  fallbackAllowed,
  workerSwitchCount,
}: {
  brief?: ReasoningPanelInput
  currentAction?: string | null
  lastObservation?: string | null
  verdict?: string | null
  recommendedWorker?: string | null
  selectedWorker?: string | null
  previousWorker?: string | null
  routingWhy?: string | null
  capabilityEvidence?: string | null
  routingMode?: string | null
  fallbackAllowed?: boolean | null
  workerSwitchCount?: number | null
}) {
  const model = reasoningPanelModel(brief ?? null)
  return (
    <div className="rounded border border-white/10 p-2" data-testid="foundry-reasoning-kernel">
      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Reasoning</p>
      <p className="text-[10px] text-slate-300">Reasoning Strategy: {model.strategy}</p>
      <p className="text-[10px] text-slate-300">Depth: {model.depth}</p>
      <p className="text-[10px] text-slate-300">Why: {model.why}</p>
      <p className="text-[10px] text-slate-300">Previous Strategy: {model.previousStrategy}</p>
      <p className="text-[10px] text-slate-300">Trigger: {model.trigger}</p>
      <p className="text-[10px] text-slate-300">Status: {model.status}</p>
      <p className="text-[9px] uppercase tracking-widest text-slate-500">Active Hypotheses</p>
      <ul className="text-[10px] text-slate-400">{model.hypotheses.slice(0, 4).map(item => <li key={item}>{item}</li>)}</ul>
      <p className="text-[10px] text-slate-300">Selected Plan: {model.plan}</p>
      <p className="text-[10px] text-slate-300">Current Action: {currentAction || model.nextAction}</p>
      <p className="text-[10px] text-slate-300">Last Observation: {lastObservation || 'none'}</p>
      <p className="text-[9px] uppercase tracking-widest text-slate-500">Evidence</p>
      <ul className="text-[10px] text-slate-400">{model.evidence.slice(0, 4).map(item => <li key={item}>{item}</li>)}</ul>
      <p className="text-[9px] uppercase tracking-widest text-slate-500">Contradictions</p>
      <ul className="text-[10px] text-slate-400">{model.contradictions.slice(0, 4).map(item => <li key={item}>{item}</li>)}</ul>
      <p className="text-[10px] text-slate-300">Verification: {model.verification}</p>
      <p className="text-[10px] text-slate-300">Verdict: {verdict || model.verification}</p>
      <p className="text-[9px] uppercase tracking-widest text-slate-500">Search Branches</p>
      <ul className="text-[10px] text-slate-400">{model.branches.slice(0, 6).map(item => <li key={item}>{item}</li>)}</ul>
      <p className="text-[10px] text-slate-300">Next Action: {model.nextAction}</p>
      <div data-testid="foundry-routing-state">
        <p className="text-[10px] text-slate-300">Recommended Worker: {recommendedWorker || selectedWorker || 'none'}</p>
        <p className="text-[10px] text-slate-300">Selected Worker: {selectedWorker || 'none'}</p>
        <p className="text-[10px] text-slate-300">Previous Worker: {previousWorker || 'none'}</p>
        <p className="text-[10px] text-slate-300">Routing Why: {routingWhy || 'none'}</p>
        <p className="text-[10px] text-slate-300">Capability Evidence: {capabilityEvidence || 'none'}</p>
        <p className="text-[10px] text-slate-300">Routing Mode: {routingMode || 'SHADOW'}</p>
        <p className="text-[10px] text-slate-300">Fallback Allowed: {fallbackAllowed ? 'yes' : 'no'}</p>
        <p className="text-[10px] text-slate-300">Worker Switch Count: {workerSwitchCount ?? 0}</p>
      </div>
    </div>
  )
}

