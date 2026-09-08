'use client'

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { SEARCH_HANDOFF_STORAGE_KEY, SEARCH_RECENT_STORAGE_KEY } from '@/lib/war-room-search/types'
import type { FederatedSearchResponse, SearchRegionFilter, SearchResult, SearchSort } from '@/lib/war-room-search/types'

const REGIONS: { id: SearchRegionFilter; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'NORTH_AMERICA', label: 'North America' },
  { id: 'LATIN_AMERICA', label: 'Latin America' },
  { id: 'EUROPE', label: 'Europe' },
  { id: 'AFRICA', label: 'Africa' },
  { id: 'MIDDLE_EAST', label: 'Middle East' },
  { id: 'EAST_ASIA', label: 'East Asia' },
  { id: 'SOUTH_ASIA', label: 'South Asia' },
  { id: 'OCEANIA', label: 'Oceania' },
]

type SearchUiState = 'initial' | 'loading' | 'results' | 'empty' | 'error' | 'partial'

function badgeColor(badge: string): string {
  if (badge === 'PRIMARY' || badge === 'OFFICIAL') return '#6ee7b7'
  if (badge === 'ACADEMIC') return '#93c5fd'
  if (badge === 'REGIONAL') return '#fcd34d'
  return '#67e8f9'
}

function formatDate(value: string | null): string | null {
  if (!value) return null
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return value.slice(0, 10)
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function WarRoomSearchPanel() {
  const [query, setQuery] = useState('')
  const [primaryOnly, setPrimaryOnly] = useState(false)
  const [region, setRegion] = useState<SearchRegionFilter>('ALL')
  const [sort, setSort] = useState<SearchSort>('RELEVANCE')
  const [response, setResponse] = useState<FederatedSearchResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [recent, setRecent] = useState<string[]>([])
  const requestGen = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SEARCH_RECENT_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as unknown
        if (Array.isArray(parsed)) setRecent(parsed.filter((item): item is string => typeof item === 'string').slice(0, 8))
      }
    } catch {
      /* session-local only */
    }
    inputRef.current?.focus()
  }, [])

  const persistRecent = useCallback((nextQuery: string) => {
    const trimmed = nextQuery.trim()
    if (!trimmed) return
    setRecent(prev => {
      const next = [trimmed, ...prev.filter(item => item !== trimmed)].slice(0, 8)
      try {
        sessionStorage.setItem(SEARCH_RECENT_STORAGE_KEY, JSON.stringify(next))
      } catch {
        /* ignore quota */
      }
      return next
    })
  }, [])

  const runSearch = useCallback(async (nextQuery: string) => {
    const q = nextQuery.trim()
    if (!q) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const gen = ++requestGen.current
    setLoading(true)
    setError(null)
    setResponse(null)
    persistRecent(q)
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          query: q,
          options: {
            limit: 16,
            primaryOnly,
            region,
            sort,
          },
        }),
      })
      const body = await res.json() as FederatedSearchResponse & { error?: string }
      if (gen !== requestGen.current) return
      if (!res.ok && res.status !== 499) {
        setError(body.error || body.warnings?.[0] || `Search failed (${res.status})`)
        setResponse(null)
        return
      }
      setResponse(body)
    } catch (err) {
      if (gen !== requestGen.current) return
      if (err instanceof DOMException && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : 'Search failed')
      setResponse(null)
    } finally {
      if (gen === requestGen.current) setLoading(false)
    }
  }, [persistRecent, primaryOnly, region, sort])

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    void runSearch(query)
  }

  const uiState: SearchUiState = useMemo(() => {
    if (loading) return 'loading'
    if (error && !response) return 'error'
    if (!response) return 'initial'
    if (!response.results.length) return 'empty'
    if (response.warnings.length || response.timedOut || response.fallbackUsed) return 'partial'
    return 'results'
  }, [error, loading, response])

  const analyzeWithCouncil = () => {
    if (!response?.results.length) return
    const payload = { query: response.query, results: response.results }
    try {
      sessionStorage.setItem(SEARCH_HANDOFF_STORAGE_KEY, JSON.stringify(payload))
    } catch {
      setError('Could not store search evidence for Council handoff.')
      return
    }
    window.location.href = '/?searchAnalyze=1'
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10" data-testid="war-room-search-page">
      <header className="mb-8 flex items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.4em] text-emerald-500/80">War Room OS</p>
          <h1 className="mt-1 text-2xl font-bold tracking-[0.18em] text-emerald-200">SEARCH</h1>
          <p className="mt-2 text-[11px] tracking-wide text-slate-500">Live federated retrieval through existing War Room evidence systems.</p>
        </div>
        <Link href="/" className="text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-emerald-300">
          Live Council
        </Link>
      </header>

      <form onSubmit={onSubmit} className="space-y-3">
        <input
          ref={inputRef}
          data-testid="war-room-search-input"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Search the world..."
          className="w-full rounded-lg border border-emerald-900/50 bg-black/70 px-4 py-3 text-sm text-emerald-50 outline-none placeholder:text-slate-600 focus:border-emerald-400/60"
          style={{ boxShadow: '0 0 24px rgba(16,185,129,0.08)' }}
        />
        <div className="flex flex-wrap items-center gap-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={primaryOnly} onChange={event => setPrimaryOnly(event.target.checked)} data-testid="war-room-search-primary" />
            Primary sources only
          </label>
          <label className="flex items-center gap-2">
            Region
            <select
              value={region}
              onChange={event => setRegion(event.target.value as SearchRegionFilter)}
              className="rounded border border-emerald-900/40 bg-black px-2 py-1 text-[10px] text-emerald-200"
              data-testid="war-room-search-region"
            >
              {REGIONS.map(item => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            Sort
            <select
              value={sort}
              onChange={event => setSort(event.target.value as SearchSort)}
              className="rounded border border-emerald-900/40 bg-black px-2 py-1 text-[10px] text-emerald-200"
              data-testid="war-room-search-sort"
            >
              <option value="RELEVANCE">Relevance</option>
              <option value="NEWEST">Newest</option>
            </select>
          </label>
          <button
            type="submit"
            className="ml-auto rounded border border-emerald-500/40 bg-emerald-950/40 px-3 py-1.5 text-emerald-200 hover:bg-emerald-900/40"
            disabled={loading || !query.trim()}
          >
            {loading ? 'Searching…' : 'Search'}
          </button>
        </div>
      </form>

      {recent.length > 0 && uiState === 'initial' ? (
        <div className="mt-6" data-testid="war-room-search-recent">
          <p className="mb-2 text-[9px] font-bold uppercase tracking-widest text-slate-600">Recent this session</p>
          <div className="flex flex-wrap gap-2">
            {recent.map(item => (
              <button
                key={item}
                type="button"
                className="rounded border border-slate-800 px-2 py-1 text-[11px] text-slate-400 hover:border-emerald-700 hover:text-emerald-200"
                onClick={() => {
                  setQuery(item)
                  void runSearch(item)
                }}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {uiState === 'loading' ? (
        <p className="mt-10 text-center text-[11px] uppercase tracking-[0.3em] text-emerald-500/70" data-testid="war-room-search-loading">
          Retrieving live sources…
        </p>
      ) : null}

      {uiState === 'error' ? (
        <p className="mt-10 rounded border border-red-900/50 bg-red-950/20 px-4 py-3 text-sm text-red-200" data-testid="war-room-search-error">
          {error}
        </p>
      ) : null}

      {uiState === 'empty' ? (
        <p className="mt-10 text-center text-sm text-slate-400" data-testid="war-room-search-empty">
          No results found for “{response?.query}”.
        </p>
      ) : null}

      {response && (uiState === 'results' || uiState === 'partial') ? (
        <div className="mt-8 space-y-4" data-testid="war-room-search-results">
          <div className="flex flex-wrap items-center justify-between gap-3 text-[10px] uppercase tracking-widest text-slate-500">
            <span>
              {response.resultCount} results · {response.rawCount} raw · {response.deduplicatedCount} after collapse · {response.tookMs}ms
            </span>
            <button
              type="button"
              onClick={analyzeWithCouncil}
              className="rounded border border-yellow-700/50 px-3 py-1.5 font-bold text-yellow-200 hover:bg-yellow-950/30"
              data-testid="war-room-search-analyze"
            >
              Analyze with Council
            </button>
          </div>
          {uiState === 'partial' && response.warnings.length ? (
            <p className="rounded border border-yellow-900/40 bg-yellow-950/20 px-3 py-2 text-[11px] text-yellow-100/90" data-testid="war-room-search-warnings">
              {response.warnings.join(' · ')}
            </p>
          ) : null}
          <ol className="space-y-5">
            {response.results.map(result => (
              <SearchResultRow key={result.id} result={result} />
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  )
}

function SearchResultRow({ result }: { result: SearchResult }) {
  const date = formatDate(result.publishedAt)
  return (
    <li className="rounded-lg border border-emerald-950/60 bg-black/40 p-4" data-testid="war-room-search-result">
      <p className="text-[11px] text-emerald-600/90">{result.displayDomain || result.publisher || 'source'}</p>
      {result.url ? (
        <a
          href={result.url}
          target="_blank"
          rel="noreferrer"
          className="mt-0.5 block text-base text-emerald-100 hover:underline"
          data-testid="war-room-search-result-link"
        >
          {result.title}
        </a>
      ) : (
        <p className="mt-0.5 text-base text-emerald-100">{result.title}</p>
      )}
      <p className="mt-1 text-[13px] leading-relaxed text-slate-400">{result.snippet}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[9px] font-bold uppercase tracking-widest">
        {date ? <span className="text-slate-500">{date}</span> : null}
        {result.badges.map(badge => (
          <span key={badge} className="rounded border px-1.5 py-0.5" style={{ color: badgeColor(badge), borderColor: `${badgeColor(badge)}55` }}>
            {badge}
          </span>
        ))}
        {result.alsoReportedBy ? (
          <span className="text-slate-500">Also reported by {result.alsoReportedBy.count} other source{result.alsoReportedBy.count === 1 ? '' : 's'}</span>
        ) : null}
      </div>
    </li>
  )
}
