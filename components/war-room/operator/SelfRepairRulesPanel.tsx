'use client'

import { memo } from 'react'

const RULES = [
  {
    title: 'No silent mutation',
    body: 'War Room never edits repo files from the browser. Every change is proposed, approved, and applied outside the UI.',
  },
  {
    title: 'No autonomous code execution',
    body: 'Validation commands (tsc, eslint, build) are listed for the operator to run locally — not executed from this panel.',
  },
  {
    title: 'Detect → Learn loop',
    body: 'Self-audit and inbox surface issues. Prepare a repair plan, approve it, copy to Cursor, apply manually, validate with gap checks, then capture a lesson.',
  },
  {
    title: 'Send to Cursor',
    body: 'Copies the full repair plan (files, expected behavior, validation, rollback, cursor command) via clipboard with manual-copy fallback.',
  },
  {
    title: 'Validate Repair',
    body: 'Re-runs known-gap verification plus self-audit recheck for the linked gap id. Fixed status requires evidence.',
  },
  {
    title: 'Session persistence',
    body: 'Repair records, upgrade queue, and lessons live in sessionStorage for this browser tab session only.',
  },
] as const

export const SelfRepairRulesPanel = memo(function SelfRepairRulesPanel() {
  return (
    <section
      className="rounded border border-slate-500/25 bg-black/30 p-3"
      data-testid="self-repair-rules-panel"
    >
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-300">
        Self-Repair Rules
      </p>
      <ul className="mt-3 space-y-2 text-[10px]">
        {RULES.map(rule => (
          <li key={rule.title} className="rounded border border-white/5 bg-black/25 px-2 py-1.5">
            <p className="font-bold tracking-wide text-violet-200/90">{rule.title}</p>
            <p className="mt-0.5 text-slate-400">{rule.body}</p>
          </li>
        ))}
      </ul>
    </section>
  )
})
