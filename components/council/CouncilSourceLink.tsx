'use client'

import type { CouncilSourceLink as CouncilSourceLinkModel } from '@/lib/council/source-links'
import { useCouncilSourceNavigation } from './CouncilSourceNavigation'

export function CouncilSourceLink({
  link,
  compact = false,
}: {
  link: CouncilSourceLinkModel
  compact?: boolean
}) {
  const nav = useCouncilSourceNavigation()
  const copied = nav.copied === link.url
  const blocked = nav.lastBlock
  const web = link.internal_open_supported || link.external_open_supported
  return (
    <article
      className="rounded border px-2 py-1.5"
      data-testid="council-source-link"
      data-source-id={link.source_id}
      data-supporting={link.supporting ? 'true' : 'false'}
      data-freshness={link.freshness_state}
      style={{ borderColor: link.supporting ? 'rgba(147,197,253,0.35)' : 'rgba(248,113,113,0.28)', background: 'rgba(0,0,0,0.22)' }}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-[11px] font-semibold text-sky-100" data-testid="council-source-title">{link.title}</span>
        {link.domain ? <span className="font-mono text-[10px] text-slate-400" data-testid="council-source-domain">{link.domain}</span> : null}
        <span className="text-[9px] uppercase tracking-widest text-slate-500">{link.source_authority}</span>
        <span className="text-[9px] uppercase tracking-widest text-amber-200/80">{link.freshness_state}</span>
        {!link.supporting && link.rejection_reason ? (
          <span className="text-[9px] uppercase tracking-widest text-rose-300" data-testid="council-source-rejected">
            REJECTED — {link.rejection_reason}
          </span>
        ) : null}
      </div>
      {!compact && (link.claim_ids.length || link.evidence_ids.length) ? (
        <p className="mt-0.5 font-mono text-[10px] text-slate-500">
          {link.claim_ids.length ? `claims ${link.claim_ids.join(', ')}` : ''}
          {link.claim_ids.length && link.evidence_ids.length ? ' · ' : ''}
          {link.evidence_ids.length ? `evidence ${link.evidence_ids.join(', ')}` : ''}
        </p>
      ) : null}
      {web ? (
        <div className="mt-1 flex flex-wrap gap-1">
          <button type="button" data-testid="source-open-internal" className="rounded border border-cyan-400/30 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-cyan-100" onClick={() => void nav.openInternal(link)}>Open in War Room</button>
          <button type="button" data-testid="source-open-external" className="rounded border border-white/15 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-slate-200" onClick={() => void nav.openExternal(link)}>Open externally</button>
          <button type="button" data-testid="source-copy-link" className="rounded border border-white/15 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-slate-200" onClick={() => void nav.copyLink(link)}>{copied ? 'Copied' : 'Copy link'}</button>
          <button type="button" data-testid="source-view-evidence" className="rounded border border-emerald-400/25 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-emerald-100" onClick={() => nav.viewEvidence(link)}>View evidence</button>
        </div>
      ) : (
        <p className="mt-1 text-[10px] text-slate-500" data-testid="source-internal-identity">
          {link.source_type} · {link.source_id}
        </p>
      )}
      {blocked ? (
        <p className="mt-1 text-[10px] text-rose-300" data-testid="source-link-blocked">{blocked.reason} ({blocked.code})</p>
      ) : null}
    </article>
  )
}
