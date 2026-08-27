'use client'

import type { TerraRelatedIntelligenceFeed } from './useTerraRelatedIntelligence'

const MEDIA_TYPE_LABEL: Record<string, string> = {
  news: 'News',
  article: 'Article',
  official_report: 'Official Source',
  video: 'Video',
  other: 'Source',
}

/**
 * External coverage about the selected event/location — deliberately a separate, differently
 * colored panel from Observed Data (the raw provider-reported event facts, rendered in
 * TerraShell.tsx's own panel). Never merges the two: this panel only ever shows normalized
 * TerraRelatedIntelligenceResult entries from lib/terra/relatedIntelligence.ts, sourced through
 * the existing Research Engine.
 */
export function TerraRelatedIntelligencePanel({ feed, active, compact = false }: {
  feed: TerraRelatedIntelligenceFeed
  active: boolean
  compact?: boolean
}) {
  return (
    <section className="rounded border border-amber-400/30 bg-black/75 p-3 backdrop-blur-sm" aria-label="Related intelligence" aria-live="polite" data-testid="terra-related-intelligence">
      <p className="text-[10px] font-bold uppercase tracking-widest text-amber-400/80">Related Intelligence</p>
      {!active ? (
        <p className="mt-1 text-[11px] leading-snug text-slate-500">Select an event marker to search current news, articles, and official reports about it.</p>
      ) : feed.state === 'loading' ? (
        <p className="mt-1 text-[11px] text-slate-400">Searching…</p>
      ) : feed.state === 'error' ? (
        <p className="mt-1 text-[11px] text-amber-300/90">{feed.lastErrorMessage ?? 'Related intelligence request failed.'}</p>
      ) : feed.results.length === 0 ? (
        <p className="mt-1 text-[11px] text-slate-500">No related news, articles, or official reports found for this event.</p>
      ) : (
        <ul className={`mt-1.5 space-y-2 overflow-y-auto ${compact ? 'max-h-40' : 'max-h-64'}`}>
          {feed.results.map(result => (
            <li key={result.id} className="border-t border-white/10 pt-1.5 first:border-t-0 first:pt-0">
              <div className="flex items-center gap-1.5">
                <span className={`rounded px-1 text-[9px] font-bold uppercase tracking-widest ${result.isOfficialSource ? 'bg-cyan-400/20 text-cyan-300' : 'bg-white/10 text-slate-400'}`}>
                  {MEDIA_TYPE_LABEL[result.mediaType] ?? 'Source'}
                </span>
                <span className="truncate text-[10px] text-slate-500">{result.sourceName}</span>
              </div>
              <p className="mt-0.5 line-clamp-2 text-[11.5px] font-medium text-slate-100">{result.title}</p>
              {result.snippet && !compact && <p className="mt-0.5 line-clamp-2 text-[10.5px] text-slate-500">{result.snippet}</p>}
              <div className="mt-0.5 flex items-center justify-between gap-2">
                <span className="text-[9.5px] text-slate-600">{result.publishedAt ? new Date(result.publishedAt).toLocaleString() : 'Published date unavailable'}</span>
                {result.sourceUrl && (
                  <a href={result.sourceUrl} target="_blank" rel="noreferrer" className="whitespace-nowrap text-[10px] text-cyan-400 hover:underline">
                    Open source ↗
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {active && feed.videoProviderMessage && (
        <p className="mt-2 border-t border-white/10 pt-1.5 text-[9.5px] text-slate-600">{feed.videoProviderMessage}</p>
      )}
    </section>
  )
}
