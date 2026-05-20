'use client'

import type { OperatorNextStepsReport } from '@/lib/operator/nextStepsReport'
import { formatOperatorNextStepsMarkdown, isNoOperatorActionRequired } from '@/lib/operator/nextStepsReport'

const SECTIONS: Array<{ key: keyof OperatorNextStepsReport; label: string }> = [
  { key: 'environmentChanges', label: 'Environment' },
  { key: 'sqlMigrations', label: 'SQL / migrations' },
  { key: 'restartRequirements', label: 'Restart' },
  { key: 'verificationRoutes', label: 'Verify routes' },
  { key: 'expectedSuccessOutput', label: 'Expected output' },
  { key: 'featureFlags', label: 'Feature flags' },
  { key: 'uiChanges', label: 'UI changes' },
  { key: 'rollbackInstructions', label: 'Rollback' },
]

type Props = {
  report?: OperatorNextStepsReport | null
  markdown?: string | null
  compact?: boolean
}

export function OperatorNextStepsBlock({ report, markdown, compact = false }: Props) {
  const resolvedMarkdown = markdown?.trim()
    || (report ? formatOperatorNextStepsMarkdown(report) : '')
  const noAction = report ? isNoOperatorActionRequired(report) : resolvedMarkdown.includes('No operator action required.')

  if (!resolvedMarkdown && !report) return null

  if (compact && report && !noAction) {
    return (
      <section className="rounded border border-emerald-500/30 bg-emerald-500/5 p-3">
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-emerald-300">
          Next steps for operator
        </h4>
        <ol className="mt-2 list-decimal space-y-2 pl-4 text-[10px] leading-relaxed text-slate-300">
          {SECTIONS.map(({ key, label }) => {
            const lines = (report[key] ?? []).filter(line => line.trim().length > 0)
            if (!lines.length) return null
            return (
              <li key={key}>
                <span className="font-semibold text-slate-200">{label}: </span>
                {lines.join(' ')}
              </li>
            )
          })}
        </ol>
      </section>
    )
  }

  return (
    <section className="rounded border border-emerald-500/30 bg-emerald-500/5 p-3">
      <h4 className="text-[10px] font-bold uppercase tracking-widest text-emerald-300">
        Next steps for operator
      </h4>
      <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap font-sans text-[10px] leading-relaxed text-slate-300">
        {noAction && !report
          ? 'No operator action required.'
          : resolvedMarkdown.replace(/^## NEXT STEPS FOR OPERATOR\n*/i, '')}
      </pre>
    </section>
  )
}
