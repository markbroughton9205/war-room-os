'use client'

import { splitSafeCouncilText } from '@/lib/council/source-links'
import { councilSourceFromDeliberationRef } from '@/lib/council/source-links/fromEvidence'
import { useCouncilSourceNavigation } from './CouncilSourceNavigation'

export function SafeCouncilText({
  text,
  className,
}: {
  text: string
  className?: string
}) {
  const nav = useCouncilSourceNavigation()
  const parts = splitSafeCouncilText(text)
  return (
    <span className={className} data-testid="safe-council-text">
      {parts.map((part, index) => {
        if (part.kind === 'text') return <span key={index}>{part.text}</span>
        const link = councilSourceFromDeliberationRef({
          evidence_reference_id: `plain-${index}`,
          label: part.text,
          source_kind: 'plain_url',
          url: part.url,
        })
        return (
          <button
            key={`${part.url}-${index}`}
            type="button"
            className="text-sky-300 underline decoration-sky-500/40 underline-offset-2"
            data-testid="safe-council-plain-link"
            title={`${part.domain} — choose War Room or external`}
            onClick={() => void nav.openInternal(link)}
          >
            {part.text}
          </button>
        )
      })}
    </span>
  )
}
