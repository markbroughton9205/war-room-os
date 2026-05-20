'use client'

import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import type { CommanderLocationState } from '@/lib/intelligence/environment/locationPolicy'
import { INTELLIGENCE_CATEGORIES } from '@/lib/signals/classification/types'
import {
  buildNewsIntelWall,
  fetchNewsIntelWallData,
  filterNewsIntelSections,
  NEWS_INTEL_SECTION_LABELS,
  NEWS_INTEL_WATCH_SECTIONS,
  type NewsIntelSourceMixKey,
  type NewsIntelStory,
  type NewsIntelWallFilters,
  type NewsIntelWallPayload,
  type NewsIntelWatchSection,
} from '@/lib/intelligence/newsIntelWall'
import { NewsIntelStoryCard } from '@/components/intelligence/NewsIntelStoryCard'
import { storyToResearchHandoff } from '@/lib/council-research/handoff'
import type { CouncilResearchHandoff } from '@/lib/council-research/types'

const SOURCE_MIX_LABELS: Record<NewsIntelSourceMixKey, string> = {
  rss: 'RSS',
  guardian: 'Guardian',
  newsapi: 'NewsAPI',
  tavily: 'Tavily',
  cache: 'Cache',
  manual: 'Manual',
  brave: 'Brave',
  firecrawl: 'Firecrawl',
  other: 'Other',
}

const DEFAULT_FILTERS: NewsIntelWallFilters = {
  liveOnly: false,
  recentOnly: false,
  source: 'all',
  category: 'all',
  minConfidence: 0,
  missionImpactOnly: false,
  localGlobal: 'all',
}

export const NewsIntelCommandWall = memo(function NewsIntelCommandWall({
  open,
  onClose,
  location,
  onCouncilHandoff,
  onCouncilResearchHandoff,
  threadId,
}: {
  open: boolean
  onClose: () => void
  location: CommanderLocationState
  onCouncilHandoff?: (decree: string) => void
  onCouncilResearchHandoff?: (payload: CouncilResearchHandoff) => void
  threadId?: string
}) {
  const [payload, setPayload] = useState<NewsIntelWallPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<NewsIntelWallFilters>(DEFAULT_FILTERS)
  const [notice, setNotice] = useState<string | null>(null)
  const [guidanceOpen, setGuidanceOpen] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      const { newsCards, signals } = await fetchNewsIntelWallData(location)
      setPayload(buildNewsIntelWall({ newsCards, signals }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'News Intel wall load failed')
    } finally {
      setLoading(false)
    }
  }, [location])

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [open, load])

  const filteredSections = useMemo(() => {
    if (!payload) return null
    return filterNewsIntelSections(payload.sections, filters)
  }, [payload, filters])

  const handleAskCouncil = useCallback((story: NewsIntelStory) => {
    const payload = storyToResearchHandoff(story, 'ask_council')
    if (onCouncilResearchHandoff) {
      onCouncilResearchHandoff(payload)
      return
    }
    onCouncilHandoff?.(payload.decree)
  }, [onCouncilHandoff, onCouncilResearchHandoff])

  const handleInvestigate = useCallback((story: NewsIntelStory) => {
    const payload = storyToResearchHandoff(story, 'investigate')
    if (onCouncilResearchHandoff) {
      onCouncilResearchHandoff(payload)
      return
    }
    onCouncilHandoff?.(payload.decree)
  }, [onCouncilHandoff, onCouncilResearchHandoff])

  const handleSendToGrok = useCallback((story: NewsIntelStory) => {
    onCouncilHandoff?.(
      `Grok, investigate this source-backed signal and report verified, emerging, contradictions, and unknowns: ${story.headline} (${story.source}). ${story.whyItMatters}`,
    )
  }, [onCouncilHandoff])

  const handleCreateOpportunity = useCallback(async (story: NewsIntelStory) => {
    setNotice(null)
    try {
      const res = await fetch('/api/opportunities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: threadId ?? 'live-environment',
          family: 'grok',
          story: {
            headline: story.headline,
            source: story.source,
            url: story.url,
            whyNow: story.whyItMatters,
            confidence: story.confidence,
          },
        }),
      })
      const body = await res.json() as { ok?: boolean; error?: string; commanderNote?: string }
      if (!res.ok) throw new Error(body.error ?? 'Opportunity proposal failed')
      setNotice(body.commanderNote ?? 'Opportunity registered as PROPOSED — Commander approval required.')
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Opportunity proposal failed')
    }
  }, [threadId])

  if (!open) return null

  return (
    <IntelWallOverlay>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-500/20 px-4 py-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-sky-300">News Intelligence Command Wall</p>
          <p className="text-[9px] uppercase tracking-widest text-slate-500">Source-backed only · manual refresh · no fabricated stories</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded border border-sky-400/30 px-3 py-1 text-[9px] font-bold uppercase tracking-widest text-sky-200 hover:bg-sky-400/10"
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            type="button"
            className="rounded border border-white/20 px-3 py-1 text-[9px] font-bold uppercase tracking-widest text-slate-300 hover:bg-white/5"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        <div className="mx-auto max-w-6xl space-y-4">
          <OperatorGuidance open={guidanceOpen} onToggle={() => setGuidanceOpen(prev => !prev)} />
          <FilterBar filters={filters} onChange={setFilters} />
          {payload ? <SourceMixBar mix={payload.sourceMix} loadedAt={payload.loadedAt} /> : null}
          {error ? (
            <p className="rounded border border-rose-400/30 bg-rose-950/30 px-3 py-2 text-[10px] text-rose-200">{error}</p>
          ) : null}
          {notice ? (
            <p className="rounded border border-emerald-400/20 bg-emerald-950/20 px-3 py-2 text-[10px] text-emerald-200">{notice}</p>
          ) : null}
          {loading && !payload ? (
            <p className="text-[10px] uppercase tracking-widest text-slate-500">Loading source-backed intel…</p>
          ) : null}
          {payload && !payload.hasLiveSourceBackedIntel && !loading ? (
            <p className="rounded border border-amber-400/25 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-100">
              No live source-backed intel available. Configure RSS, Guardian, NewsAPI, or run a Signal scan — War Room will not fabricate headlines.
            </p>
          ) : null}
          {filteredSections && payload ? (
            <div className="space-y-6">
              {NEWS_INTEL_WATCH_SECTIONS.map(section => (
                <WallSection
                  key={section}
                  section={section}
                  stories={filteredSections[section]}
                  contradictionGroups={section === 'contradictions' ? payload.contradictionGroups : undefined}
                  allStories={payload.stories}
                  onAskCouncil={handleAskCouncil}
                  onInvestigate={handleInvestigate}
                  onSendToGrok={handleSendToGrok}
                  onCreateOpportunity={story => void handleCreateOpportunity(story)}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </IntelWallOverlay>
  )
})

function IntelWallOverlay({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col bg-slate-950/95 font-mono backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="News Intelligence Command Wall"
    >
      {children}
    </div>
  )
}

function OperatorGuidance({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <details open={open} className="rounded border border-sky-500/15 bg-sky-950/20 px-3 py-2 text-[10px] text-slate-300">
      <summary className="cursor-pointer text-[9px] font-bold uppercase tracking-widest text-sky-200" onClick={onToggle}>
        Operator guidance
      </summary>
      <div className="mt-2 space-y-2 leading-relaxed">
        <p>
          <strong className="text-slate-100">News Intel</strong> aggregates RSS, Guardian, NewsAPI, federation routers, and Signal Radar results.
          Only source-backed cards with real URLs appear — stale or unverified items stay labeled honestly.
        </p>
        <ul className="list-inside list-disc space-y-1 text-slate-400">
          <li><strong className="text-slate-200">Open Source</strong> — opens the publisher URL in a new tab.</li>
          <li><strong className="text-slate-200">Ask Council</strong> — injects a review decree into Live Council (you confirm send).</li>
          <li><strong className="text-slate-200">Send to Grok</strong> — prefills a Grok-family investigation decree; no autonomous outreach.</li>
          <li><strong className="text-slate-200">Create Opportunity</strong> — registers a PROPOSED scout opportunity; Commander must approve before action.</li>
        </ul>
      </div>
    </details>
  )
}

function FilterBar({
  filters,
  onChange,
}: {
  filters: NewsIntelWallFilters
  onChange: (next: NewsIntelWallFilters) => void
}) {
  return (
    <div className="rounded border border-white/10 bg-black/30 p-2">
      <p className="mb-2 text-[9px] font-bold uppercase tracking-widest text-slate-400">Filters</p>
      <div className="flex flex-wrap gap-3 text-[9px]">
        <label className="flex items-center gap-1 text-slate-400">
          <input
            type="checkbox"
            checked={filters.liveOnly}
            onChange={e => onChange({ ...filters, liveOnly: e.target.checked, recentOnly: e.target.checked ? false : filters.recentOnly })}
          />
          Live only
        </label>
        <label className="flex items-center gap-1 text-slate-400">
          <input
            type="checkbox"
            checked={filters.recentOnly}
            onChange={e => onChange({ ...filters, recentOnly: e.target.checked, liveOnly: e.target.checked ? false : filters.liveOnly })}
          />
          Recent
        </label>
        <label className="flex items-center gap-1 text-slate-400">
          <input
            type="checkbox"
            checked={filters.missionImpactOnly}
            onChange={e => onChange({ ...filters, missionImpactOnly: e.target.checked })}
          />
          Mission impact
        </label>
        <label className="text-slate-500">
          Source
          <select
            className="ml-1 rounded border border-white/10 bg-slate-950 px-1 py-0.5 text-slate-300"
            value={filters.source}
            onChange={e => onChange({ ...filters, source: e.target.value as NewsIntelWallFilters['source'] })}
          >
            <option value="all">All</option>
            {(Object.keys(SOURCE_MIX_LABELS) as NewsIntelSourceMixKey[]).map(key => (
              <option key={key} value={key}>{SOURCE_MIX_LABELS[key]}</option>
            ))}
          </select>
        </label>
        <label className="text-slate-500">
          Category
          <select
            className="ml-1 rounded border border-white/10 bg-slate-950 px-1 py-0.5 text-slate-300"
            value={filters.category}
            onChange={e => onChange({ ...filters, category: e.target.value as NewsIntelWallFilters['category'] })}
          >
            <option value="all">All</option>
            {INTELLIGENCE_CATEGORIES.map(cat => (
              <option key={cat} value={cat}>{cat.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </label>
        <label className="text-slate-500">
          Min confidence
          <input
            type="number"
            min={0}
            max={100}
            className="ml-1 w-12 rounded border border-white/10 bg-slate-950 px-1 py-0.5 text-slate-300"
            value={filters.minConfidence}
            onChange={e => onChange({ ...filters, minConfidence: Number(e.target.value) || 0 })}
          />
        </label>
        <label className="text-slate-500">
          Scope
          <select
            className="ml-1 rounded border border-white/10 bg-slate-950 px-1 py-0.5 text-slate-300"
            value={filters.localGlobal}
            onChange={e => onChange({ ...filters, localGlobal: e.target.value as NewsIntelWallFilters['localGlobal'] })}
          >
            <option value="all">All</option>
            <option value="local">Local</option>
            <option value="global">Global</option>
          </select>
        </label>
      </div>
    </div>
  )
}

function SourceMixBar({
  mix,
  loadedAt,
}: {
  mix: NewsIntelWallPayload['sourceMix']
  loadedAt: string
}) {
  const entries = (Object.keys(SOURCE_MIX_LABELS) as NewsIntelSourceMixKey[]).filter(key => mix[key] > 0)
  return (
    <div className="flex flex-wrap items-center gap-2 text-[8px] uppercase tracking-widest text-slate-500">
      <span className="text-slate-400">Source mix:</span>
      {entries.length ? entries.map(key => (
        <span key={key} className="rounded border border-white/10 px-1.5 py-0.5 text-slate-400">
          {SOURCE_MIX_LABELS[key]} {mix[key]}
        </span>
      )) : (
        <span>No ingested sources in current load</span>
      )}
      <span className="text-slate-600">· loaded {new Date(loadedAt).toLocaleString()}</span>
    </div>
  )
}

function WallSection({
  section,
  stories,
  contradictionGroups,
  allStories,
  onAskCouncil,
  onInvestigate,
  onSendToGrok,
  onCreateOpportunity,
}: {
  section: NewsIntelWatchSection
  stories: NewsIntelStory[]
  contradictionGroups?: NewsIntelWallPayload['contradictionGroups']
  allStories: NewsIntelStory[]
  onAskCouncil: (story: NewsIntelStory) => void
  onInvestigate: (story: NewsIntelStory) => void
  onSendToGrok: (story: NewsIntelStory) => void
  onCreateOpportunity: (story: NewsIntelStory) => void
}) {
  if (!stories.length && section !== 'contradictions') return null

  return (
    <section>
      <h3 className="mb-2 text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-200">
        {NEWS_INTEL_SECTION_LABELS[section]}
        <span className="ml-2 text-slate-600">({stories.length})</span>
      </h3>

      {section === 'contradictions' && contradictionGroups?.length ? (
        <div className="mb-3 space-y-3">
          {contradictionGroups.map(group => {
            const groupStories = allStories.filter(s => group.storyIds.includes(s.id))
            if (!groupStories.length) return null
            return (
              <ContradictionGroupBlock key={group.id} group={group} stories={groupStories} onAskCouncil={onAskCouncil} onInvestigate={onInvestigate} onSendToGrok={onSendToGrok} onCreateOpportunity={onCreateOpportunity} />
            )
          })}
        </div>
      ) : null}

      {stories.length ? (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {stories.map(story => (
            <NewsIntelStoryCard
              key={story.id}
              story={story}
              onAskCouncil={onAskCouncil}
              onInvestigate={onInvestigate}
              onSendToGrok={onSendToGrok}
              onCreateOpportunity={onCreateOpportunity}
            />
          ))}
        </div>
      ) : section === 'contradictions' ? (
        <p className="text-[9px] text-slate-600">No contradiction groups in current source-backed set.</p>
      ) : null}
    </section>
  )
}

function ContradictionGroupBlock({
  group,
  stories,
  onAskCouncil,
  onInvestigate,
  onSendToGrok,
  onCreateOpportunity,
}: {
  group: NewsIntelWallPayload['contradictionGroups'][number]
  stories: NewsIntelStory[]
  onAskCouncil: (story: NewsIntelStory) => void
  onInvestigate: (story: NewsIntelStory) => void
  onSendToGrok: (story: NewsIntelStory) => void
  onCreateOpportunity: (story: NewsIntelStory) => void
}) {
  return (
    <div className="rounded border border-rose-400/20 bg-rose-950/10 p-2">
      <p className="text-[9px] font-bold uppercase tracking-widest text-rose-200">
        Conflicting narratives · {group.headlineHint}
      </p>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        {stories.map(story => (
          <NewsIntelStoryCard
            key={story.id}
            story={story}
            onAskCouncil={onAskCouncil}
            onInvestigate={onInvestigate}
            onSendToGrok={onSendToGrok}
            onCreateOpportunity={onCreateOpportunity}
            compact
          />
        ))}
      </div>
    </div>
  )
}
