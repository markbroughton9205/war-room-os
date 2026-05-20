'use client'

import { memo } from 'react'
import type { NewsIntelStory } from '@/lib/intelligence/newsIntelWall'

function formatWhen(value: string | null): string {
  if (!value) return 'Publication time unavailable'
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : value
}

function StatusPill({
  label,
  tone,
}: {
  label: string
  tone: 'cyan' | 'emerald' | 'amber' | 'violet' | 'slate'
}) {
  const colors = {
    cyan: 'border-cyan-400/25 text-cyan-200',
    emerald: 'border-emerald-400/25 text-emerald-200',
    amber: 'border-amber-400/25 text-amber-200',
    violet: 'border-violet-400/25 text-violet-200',
    slate: 'border-white/10 text-slate-400',
  }
  return (
    <span className={`rounded border px-1 py-0.5 text-[7px] font-bold uppercase tracking-widest ${colors[tone]}`}>
      {label.replace(/_/g, ' ')}
    </span>
  )
}

export const NewsIntelStoryCard = memo(function NewsIntelStoryCard({
  story,
  onAskCouncil,
  onInvestigate,
  onSendToGrok,
  onCreateOpportunity,
  compact = false,
}: {
  story: NewsIntelStory
  onAskCouncil: (story: NewsIntelStory) => void
  onInvestigate?: (story: NewsIntelStory) => void
  onSendToGrok: (story: NewsIntelStory) => void
  onCreateOpportunity: (story: NewsIntelStory) => void
  compact?: boolean
}) {
  return (
    <article className="rounded border border-white/10 bg-slate-950/80 p-2.5">
      {story.url ? (
        <a
          href={story.url}
          target="_blank"
          rel="noopener noreferrer"
          className="line-clamp-2 text-[11px] font-semibold leading-snug text-slate-50 underline decoration-cyan-500/40 hover:text-cyan-100"
        >
          {story.headline}
        </a>
      ) : (
        <h4 className="line-clamp-2 text-[11px] font-semibold leading-snug text-slate-50">{story.headline}</h4>
      )}
      <StoryStatusPills story={story} />
      <p className="mt-1 w-full text-[8px] text-slate-500">
        <span className="text-slate-400">{story.source}</span>
        {' · Published '}
        {formatWhen(story.publishedAt)}
        {' · Ingested '}
        {formatWhen(story.ingestedAt)}
        {' · '}
        {story.provider}
      </p>
      {!compact ? (
        <>
          <p className="mt-2 text-[10px] leading-relaxed text-slate-300">{story.shortSummary}</p>
          <p className="mt-2 text-[9px] leading-snug text-amber-100/90">
            <span className="font-bold uppercase tracking-widest text-amber-200/80">Why it matters: </span>
            {story.whyItMatters}
          </p>
          {story.affectedMissions.length > 0 ? (
            <p className="mt-2 text-[8px] text-slate-500">
              <span className="font-bold uppercase tracking-widest text-slate-400">Affected missions: </span>
              {story.affectedMissions.join(' · ')}
            </p>
          ) : null}
          {story.contradictionGroupId ? (
            <p className="mt-1 text-[8px] uppercase tracking-widest text-rose-300">
              Contradiction group — compare peer narratives before acting
            </p>
          ) : null}
        </>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-1">
        {story.url ? (
          <a
            href={story.url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-cyan-400/30 px-2 py-1 text-[8px] font-bold uppercase tracking-widest text-cyan-200 hover:bg-cyan-400/10"
          >
            Open Source
          </a>
        ) : (
          <span className="text-[8px] uppercase tracking-widest text-slate-600">No URL</span>
        )}
        <button
          type="button"
          className="rounded border border-sky-300/20 px-2 py-1 text-[8px] font-bold uppercase tracking-widest text-sky-200 transition hover:border-sky-300/50"
          onClick={() => onAskCouncil(story)}
        >
          Ask Council
        </button>
        {onInvestigate ? (
          <button
            type="button"
            className="rounded border border-violet-400/25 px-2 py-1 text-[8px] font-bold uppercase tracking-widest text-violet-200 transition hover:border-violet-400/50"
            onClick={() => onInvestigate(story)}
          >
            Investigate
          </button>
        ) : null}
        <button
          type="button"
          className="rounded border border-orange-400/25 px-2 py-1 text-[8px] font-bold uppercase tracking-widest text-orange-200 transition hover:border-orange-400/50"
          onClick={() => onSendToGrok(story)}
        >
          Send to Grok
        </button>
        <button
          type="button"
          className="rounded border border-emerald-400/25 px-2 py-1 text-[8px] font-bold uppercase tracking-widest text-emerald-200 transition hover:border-emerald-400/50"
          onClick={() => onCreateOpportunity(story)}
        >
          Create Opportunity
        </button>
      </div>
    </article>
  )
})

function StoryStatusPills({ story }: { story: NewsIntelStory }) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      <StatusPill label={story.freshnessStatus} tone="cyan" />
      <StatusPill label={story.sourceStatus} tone="emerald" />
      <StatusPill label={story.operationalStatus} tone="amber" />
      <StatusPill label={story.displayLabel} tone="slate" />
      <StatusPill label={`${story.confidence}%`} tone="violet" />
      <StatusPill label={story.category} tone="slate" />
    </div>
  )
}
