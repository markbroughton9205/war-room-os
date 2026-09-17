'use client'

import { useEffect, useState } from 'react'
import type { TerraLiveFreshness, TerraLiveIntelSnapshot, TerraLiveGeoObject } from '@/lib/terra/liveGeoIntelligence'
import { TERRA_PROVIDER_STATUS_LABELS } from '@/lib/terra/maritimeProviderStatus'
import type {
  TerraEarthIntelPanelSnapshot,
  TerraLiveIntelCoverageState,
  TerraLiveIntelItem,
  TerraLiveIntelSection,
  TerraLiveIntelVerificationState,
} from '@/lib/terra/liveIntelPanelModel'
import { TerraWorldClockStrip } from './TerraWorldClockStrip'
import {
  applyLiveIntelTranslation,
  applyTranslationFailure,
  languageIsForeign,
  type TerraLiveIntelTranslationRecord,
} from '@/lib/terra/liveIntelLanguage'
import { resolveMediaPreview } from '@/lib/terra/liveIntelMedia'
import { LiveIntelPreviewSurface, useItemPreviewBindings, useLiveIntelPreview } from './LiveIntelPreviewController'

const FRESHNESS_CLASS: Record<TerraLiveFreshness, string> = {
  LIVE: 'text-emerald-400',
  RECENT: 'text-emerald-300',
  DELAYED: 'text-amber-300',
  CACHED: 'text-cyan-300',
  STALE: 'text-amber-500',
  STALE_LAST_GOOD: 'text-amber-500',
  EMPTY: 'text-slate-300',
  NO_COVERAGE: 'text-amber-200',
  READY: 'text-cyan-200',
  NEEDS_CREDENTIALS: 'text-amber-300',
  NEEDS_LOCAL_SENSOR: 'text-amber-300',
  NEEDS_COMMERCIAL_ACCOUNT: 'text-amber-300',
  HISTORICAL: 'text-amber-500',
  NOT_IMPLEMENTED: 'text-slate-500',
  DISABLED: 'text-slate-500',
  UNAVAILABLE: 'text-rose-400',
  ERROR_UPSTREAM: 'text-rose-400',
  AUTH_FAILED: 'text-rose-400',
  AUTH_REQUIRED: 'text-cyan-200',
  RATE_LIMITED: 'text-amber-300',
  PARTIAL: 'text-cyan-200',
  NOT_CONFIGURED: 'text-slate-500',
}

const COVERAGE_CLASS: Record<TerraLiveIntelCoverageState, string> = {
  LIVE: 'text-emerald-400',
  CACHED: 'text-cyan-300',
  STALE: 'text-amber-500',
  PARTIAL: 'text-cyan-200',
  NO_COVERAGE: 'text-amber-200',
  AUTH_REQUIRED: 'text-cyan-200',
  UNAVAILABLE: 'text-rose-400',
}

const HONESTY_CLASS: Record<TerraLiveIntelVerificationState, string> = {
  CONFIRMED: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300',
  REPORTED: 'border-cyan-400/40 bg-cyan-400/10 text-cyan-200',
  DISPUTED: 'border-amber-400/50 bg-amber-400/10 text-amber-200',
  UNVERIFIED: 'border-slate-500/50 bg-slate-500/10 text-slate-400',
}

function formatTime(value: string | null): string {
  if (!value) return 'time not reported'
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return value
  return new Date(ms).toLocaleString()
}

function HonestyBadge({ state }: { state: TerraLiveIntelVerificationState | null }) {
  if (!state) return null
  return (
    <span className={`rounded border px-1 py-px text-[7px] font-bold uppercase tracking-widest ${HONESTY_CLASS[state]}`}>
      {state}
    </span>
  )
}

function ItemRow({
  item,
  inspected,
  englishOpen,
  translationPending,
  onInspect,
  onFlyTo,
  onToggleEnglish,
}: {
  item: TerraLiveIntelItem
  inspected: boolean
  englishOpen: boolean
  translationPending: boolean
  onInspect: (item: TerraLiveIntelItem) => void
  onFlyTo?: (item: TerraLiveIntelItem) => void
  onToggleEnglish: (item: TerraLiveIntelItem) => void
}) {
  const foreign = languageIsForeign(item.originalLanguage)
  const preview = useItemPreviewBindings(item)
  const media = resolveMediaPreview(item.mediaPreview)
  const locationLabel = item.location
  const age = item.relativeAge ?? (item.timestamp ? formatTime(item.timestamp) : null)

  return (
    <li>
      <div
        className={`flex items-start gap-1.5 rounded-md border px-1 py-1 ${inspected ? 'border-cyan-300/50 bg-cyan-400/10' : 'border-white/8 bg-black/25 hover:border-cyan-400/25'}`}
        onPointerEnter={preview.requestMuted}
        onPointerLeave={preview.release}
        onFocus={preview.requestMuted}
        onBlur={preview.onBlur}
        data-testid="terra-live-intel-row"
        data-media-type={media.type}
      >
        {preview.enabled ? (
          <LiveIntelPreviewSurface item={item} slotRef={preview.slotRef} compact />
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex flex-wrap items-center gap-1">
            <span className="rounded border border-white/10 px-1 py-px text-[7px] font-bold uppercase tracking-[0.16em] text-slate-400">
              {item.category}
            </span>
            <HonestyBadge state={item.verificationState} />
            {item.severity !== null ? (
              <span className="rounded border border-amber-400/30 px-1 py-px text-[7px] font-bold uppercase tracking-widest text-amber-200">
                {String(item.severity)}
              </span>
            ) : null}
            <span className={`font-mono text-[7px] uppercase tracking-widest ${FRESHNESS_CLASS[item.freshnessState]}`}>
              {item.freshnessLabel ?? TERRA_PROVIDER_STATUS_LABELS[item.freshnessState]}
            </span>
          </div>
          <button
            type="button"
            onClick={() => onInspect(item)}
            title={item.originalSummary ?? item.originalHeadline}
            aria-label={`${item.category}. ${item.originalHeadline}${item.verificationState ? `. ${item.verificationState}` : ''}`}
            className="block w-full text-left"
          >
            <p className="truncate text-[11px] leading-tight text-slate-100">{item.originalHeadline}</p>
            {englishOpen && item.englishHeadline ? (
              <p className="truncate text-[10px] text-slate-300" title="English translation — presentation only, not verified Terra truth">
                EN · {item.englishHeadline}
              </p>
            ) : null}
            {englishOpen && item.translationState === 'TRANSLATION_FAILED' ? (
              <p className="text-[9px] text-amber-200">ENGLISH — translation failed. Original preserved.</p>
            ) : null}
            <p className="mt-0.5 truncate text-[8px] uppercase tracking-widest text-slate-500">
              {item.source}
              {item.provider && item.provider !== item.source ? ` · ${item.provider}` : ''}
              {item.originalLanguage ? ` · ${item.originalLanguage}` : ''}
              {age ? ` · ${age}` : ''}
              {locationLabel ? ` · ${locationLabel}` : ''}
              {item.sourceCount > 1 ? ` · ${item.sourceCount} sources` : ''}
              {` · ${item.coverageState}`}
            </p>
          </button>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          {foreign ? (
            <button
              type="button"
              onClick={() => onToggleEnglish(item)}
              aria-label={englishOpen ? 'Show Original' : 'Show English'}
              title={englishOpen ? 'Show Original' : 'Show English'}
              className="px-1 text-[8px] uppercase tracking-widest text-cyan-400 hover:text-cyan-100"
            >
              {translationPending ? '…' : englishOpen ? 'Orig' : 'EN'}
            </button>
          ) : null}
          {item.lat !== null && item.lon !== null && onFlyTo ? (
            <button
              type="button"
              onClick={() => onFlyTo(item)}
              title="Fly Terra to this location"
              aria-label="Fly Terra to this location"
              className="px-1 text-[10px] text-cyan-300 hover:text-cyan-100"
            >
              ⌖
            </button>
          ) : null}
          {item.sourceUrl ? (
            <a
              href={item.sourceUrl}
              target="_blank"
              rel="noreferrer"
              title="Open source"
              aria-label="Source"
              className="px-1 text-[10px] text-cyan-400 hover:underline"
            >
              ↗
            </a>
          ) : null}
        </div>
      </div>
    </li>
  )
}

function SectionBlock({
  section,
  inspectedId,
  englishOpen,
  translationPending,
  secondaryContext,
  onInspect,
  onFlyTo,
  onToggleEnglish,
}: {
  section: TerraLiveIntelSection
  inspectedId: string | null
  englishOpen: Record<string, boolean>
  translationPending: Record<string, boolean>
  secondaryContext?: string | null
  onInspect: (item: TerraLiveIntelItem) => void
  onFlyTo?: (item: TerraLiveIntelItem) => void
  onToggleEnglish: (item: TerraLiveIntelItem) => void
}) {
  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between gap-2">
        <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-300">{section.label}</span>
        <span className={`font-mono text-[9px] uppercase ${COVERAGE_CLASS[section.coverageState]}`} title={section.reason}>
          {section.id === 'LOCAL' ? section.displayCount : `${section.coverageState} · ${section.count}`}
        </span>
      </div>
      {section.id === 'LOCAL' && section.sourceMix?.length ? (
        <p className="mb-0.5 text-[9px] uppercase tracking-widest text-slate-500">
          {section.sourceMix.map(row => `${row.label} ${row.count}`).join(' · ')}
        </p>
      ) : null}
      {section.id === 'LOCAL' && section.runtimeHealth ? (
        <p className="mb-0.5 text-[9px] uppercase tracking-widest text-slate-500" data-testid="terra-local-runtime-health">
          {`cfg ${section.runtimeHealth.configured} · healthy ${section.runtimeHealth.currentlyHealthy} · stale ${section.runtimeHealth.stale} · blocked ${section.runtimeHealth.blocked} · unavailable ${section.runtimeHealth.unavailable}`}
        </p>
      ) : null}
      {section.id === 'LOCAL' && secondaryContext ? (
        <p className="mb-0.5 text-[9px] uppercase tracking-widest text-slate-600">Inside · {secondaryContext}</p>
      ) : null}
      {section.items.length ? (
        <ul className="space-y-1">
          {section.items.map(item => (
            <ItemRow
              key={item.id}
              item={item}
              inspected={inspectedId === item.id}
              englishOpen={Boolean(englishOpen[item.id])}
              translationPending={Boolean(translationPending[item.id])}
              onInspect={onInspect}
              onFlyTo={onFlyTo}
              onToggleEnglish={onToggleEnglish}
            />
          ))}
        </ul>
      ) : (
        <p className="text-[10px] text-slate-600" title={section.reason}>{section.reason}</p>
      )}
    </div>
  )
}

function InspectCard({
  item,
  englishOpen,
  translationPending,
  onToggleEnglish,
  onSendToCouncil,
  canSendToCouncil,
  onDismiss,
}: {
  item: TerraLiveIntelItem
  englishOpen: boolean
  translationPending: boolean
  onToggleEnglish: (item: TerraLiveIntelItem) => void
  onSendToCouncil?: (item: TerraLiveIntelItem) => void
  canSendToCouncil?: boolean
  onDismiss?: () => void
}) {
  const foreign = languageIsForeign(item.originalLanguage)
  const preview = useItemPreviewBindings(item)
  const media = resolveMediaPreview(item.mediaPreview)
  return (
    <dl className="space-y-0.5 border-t border-cyan-400/20 pt-2 text-[10px] text-slate-400" data-testid="terra-live-intel-inspect">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-cyan-300">Inspect</span>
        {onDismiss ? (
          <button type="button" onClick={onDismiss} className="text-[9px] uppercase tracking-widest text-slate-500 hover:text-slate-300" aria-label="Close inspect">
            Esc · close
          </button>
        ) : null}
      </div>
      {preview.enabled ? (
        <LiveIntelPreviewSurface
          item={item}
          slotRef={preview.slotRef}
          inspect
          active={preview.active}
          onPlay={preview.requestInspect}
        />
      ) : null}
      <div className="flex justify-between gap-2"><dt>Original</dt><dd className="text-slate-100">{item.originalHeadline}</dd></div>
      {item.originalSummary ? <div className="text-slate-300">{item.originalSummary}</div> : null}
      {foreign ? (
        <div className="mb-1 flex gap-1">
          <button
            type="button"
            onClick={() => onToggleEnglish(item)}
            aria-label={englishOpen ? 'Show Original' : 'Show English'}
            className={`rounded px-1.5 py-0.5 text-[9px] uppercase tracking-widest ${englishOpen ? 'bg-cyan-400/20 text-cyan-100' : 'text-slate-500'}`}
          >
            {translationPending ? 'English…' : englishOpen ? 'Show Original' : 'Show English'}
          </button>
        </div>
      ) : null}
      {englishOpen && item.englishHeadline ? (
        <div>
          <div className="flex justify-between gap-2"><dt>English</dt><dd className="text-slate-100">{item.englishHeadline}</dd></div>
          {item.englishSummary ? <div className="text-slate-400">{item.englishSummary}</div> : null}
          <p className="text-[9px] text-slate-600">Translation is presentation only. It does not verify the source claim.</p>
        </div>
      ) : null}
      {englishOpen && item.translationState === 'TRANSLATION_FAILED' ? (
        <p className="text-amber-200/90">ENGLISH — translation failed. Original source text is preserved.</p>
      ) : null}
      <div className="flex justify-between gap-2"><dt>Language</dt><dd className="text-slate-200">{item.originalLanguage ?? 'unknown'} · {item.translationState}</dd></div>
      {item.translation ? <div className="flex justify-between gap-2"><dt>Translator</dt><dd className="truncate text-slate-200">{item.translation.translationModel} · {item.translation.translatedAt}</dd></div> : null}
      <div className="flex justify-between gap-2"><dt>Category</dt><dd className="text-cyan-200">{item.category}</dd></div>
      <div className="flex justify-between gap-2"><dt>Source</dt><dd className="truncate text-slate-200">{item.source}</dd></div>
      <div className="flex justify-between gap-2"><dt>Provider</dt><dd className="truncate text-slate-200">{item.provider}</dd></div>
      {item.localSourceType ? <div className="flex justify-between gap-2"><dt>Type</dt><dd className="text-cyan-200">{item.localSourceType === 'TV' ? 'TV NEWS' : item.localSourceType === 'PUBLIC_AGENCY' || item.localSourceType === 'EMERGENCY' ? 'PUBLIC SAFETY' : item.localSourceType === 'TRANSPORTATION' ? 'TRAFFIC' : item.localSourceType}</dd></div> : null}
      {item.localServiceArea ? <div className="flex justify-between gap-2"><dt>Area</dt><dd className="truncate text-slate-200">{item.localServiceArea}</dd></div> : null}
      {item.localRelevance ? <div className="flex justify-between gap-2"><dt>Distance / relevance</dt><dd className="text-slate-200">{item.localRelevance}{item.distanceKm != null ? ` · ${item.distanceKm.toFixed(1)} km` : ''}</dd></div> : null}
      <div className="flex justify-between gap-2"><dt>Published</dt><dd className="font-mono text-slate-200">{formatTime(item.timestamp)}</dd></div>
      {item.localTime ? <div className="flex justify-between gap-2"><dt>Event local</dt><dd className="font-mono text-slate-200">{item.localTime}{item.timezone ? ` · ${item.timezone}` : ''}{item.utcOffset ? ` · ${item.utcOffset}` : ''}{item.dstActive === true ? ' · DST' : ''}</dd></div> : null}
      {item.utcTimestamp ? <div className="flex justify-between gap-2"><dt>UTC</dt><dd className="font-mono text-slate-200">{item.utcTimestamp}</dd></div> : null}
      {item.relativeAge ? <div className="flex justify-between gap-2"><dt>Age</dt><dd className="text-slate-200">{item.relativeAge}</dd></div> : null}
      <div className="flex justify-between gap-2"><dt>Retrieved</dt><dd className="font-mono text-slate-200">{formatTime(item.retrievedAt)}</dd></div>
      <div className="flex justify-between gap-2"><dt>Freshness</dt><dd className={FRESHNESS_CLASS[item.freshnessState]}>{item.freshnessLabel ?? TERRA_PROVIDER_STATUS_LABELS[item.freshnessState]}</dd></div>
      <div className="flex justify-between gap-2"><dt>Coverage</dt><dd className={COVERAGE_CLASS[item.coverageState]}>{item.coverageState}</dd></div>
      {item.verificationState ? <div className="flex justify-between gap-2"><dt>Status</dt><dd className="text-slate-200">{item.verificationState}</dd></div> : null}
      {item.severity !== null ? <div className="flex justify-between gap-2"><dt>Source severity</dt><dd className="text-slate-200">{String(item.severity)}</dd></div> : null}
      {item.location ? <div className="flex justify-between gap-2"><dt>Location</dt><dd className="truncate text-slate-200">{item.location}</dd></div> : null}
      {item.geoRelation ? <div className="flex justify-between gap-2"><dt>Geographic relation</dt><dd className="text-slate-200">{item.geoRelation}</dd></div> : null}
      {item.distanceKm != null ? <div className="flex justify-between gap-2"><dt>Distance</dt><dd className="font-mono text-slate-200">{item.distanceKm < 1 ? `${Math.round(item.distanceKm * 1000)} m` : `${item.distanceKm.toFixed(1)} km`}</dd></div> : null}
      {item.radiusTier ? <div className="flex justify-between gap-2"><dt>Radius tier</dt><dd className="text-slate-200">{item.radiusTier}</dd></div> : null}
      {item.nativeLocationName && item.englishLocationName && item.nativeLocationName !== item.englishLocationName ? (
        <div className="flex justify-between gap-2"><dt>Place names</dt><dd className="truncate text-slate-200">{item.nativeLocationName} / {item.englishLocationName}</dd></div>
      ) : null}
      {item.lat !== null && item.lon !== null ? (
        <div className="flex justify-between gap-2"><dt>Coordinates</dt><dd className="font-mono text-slate-200">{item.lat.toFixed(3)}, {item.lon.toFixed(3)}</dd></div>
      ) : (
        <div className="flex justify-between gap-2"><dt>Coordinates</dt><dd className="text-slate-500">not reported</dd></div>
      )}
      {item.dayNightState ? <div className="flex justify-between gap-2"><dt>Day / night</dt><dd className="text-slate-200">{item.dayNightState}</dd></div> : null}
      <div className="flex justify-between gap-2"><dt>Sources</dt><dd className="truncate text-slate-200">{item.sources.map(source => source.name).join(', ')}</dd></div>
      {item.breakingReason ? <div className="text-amber-200">{item.breakingReason}</div> : null}
      {media.type !== 'NONE' ? (
        <>
          <div className="flex justify-between gap-2"><dt>VIDEO SOURCE</dt><dd className="text-cyan-200">{media.provenance.officialChannelName ? 'Official YouTube channel' : (media.embedProvider ?? media.type)}</dd></div>
          {media.provenance.officialChannelName ? <div className="flex justify-between gap-2"><dt>Channel</dt><dd className="truncate text-slate-200">{media.provenance.officialChannelName}</dd></div> : null}
          {media.provenance.channelId ? <div className="flex justify-between gap-2"><dt>Channel ID</dt><dd className="font-mono text-slate-200">{media.provenance.channelId}</dd></div> : null}
          <div className="flex justify-between gap-2"><dt>Media</dt><dd className="text-cyan-200">{media.type}</dd></div>
          {media.embedProvider ? <div className="flex justify-between gap-2"><dt>Media provider</dt><dd className="text-slate-200">{media.embedProvider}</dd></div> : null}
          {media.youtubeVideoId ? <div className="flex justify-between gap-2"><dt>YouTube ID</dt><dd className="font-mono text-slate-200">{media.youtubeVideoId}</dd></div> : null}
          {media.provenance.mediaSourceUrl ? <div className="flex justify-between gap-2"><dt>Canonical video</dt><dd className="truncate text-slate-200">{media.provenance.mediaSourceUrl}</dd></div> : null}
          {media.provenance.feedUrl ? <div className="flex justify-between gap-2"><dt>Feed</dt><dd className="truncate text-slate-500">{media.provenance.feedUrl}</dd></div> : null}
          <p className="text-[9px] text-slate-600">Official channel video is Observed Data. It does not confirm the claim discussed.</p>
        </>
      ) : null}
      {item.sourceUrl ? (
        <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 block truncate text-cyan-400 hover:underline" aria-label="Source">
          {item.sourceUrl}
        </a>
      ) : (
        <p className="mt-1 text-slate-600">No source URL — not presented as verified live intelligence.</p>
      )}
      {onSendToCouncil ? (
        <button
          type="button"
          onClick={() => onSendToCouncil(item)}
          disabled={!canSendToCouncil}
          aria-label="Send to Council"
          className="mt-1.5 w-full rounded border border-emerald-400/40 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-300 disabled:cursor-not-allowed disabled:border-white/10 disabled:text-slate-600"
        >
          Send to Council
        </button>
      ) : null}
    </dl>
  )
}

export function TerraLiveIntelPanel({
  snapshot,
  selected,
  compact,
  glance,
  fetchError,
  authRequired,
  pending,
  panelOverride,
  inspectedItem,
  onInspectItem,
  onFlyToItem,
  onSendToCouncil,
  canSendToCouncil,
}: {
  snapshot: TerraLiveIntelSnapshot
  selected: TerraLiveGeoObject | null
  compact?: boolean
  glance?: boolean
  fetchError?: string | null
  authRequired?: boolean
  pending?: boolean
  panelOverride?: TerraEarthIntelPanelSnapshot | null
  inspectedItem?: TerraLiveIntelItem | null
  onInspectItem?: (item: TerraLiveIntelItem | null) => void
  onFlyToItem?: (item: TerraLiveIntelItem) => void
  onSendToCouncil?: (item: TerraLiveIntelItem) => void
  canSendToCouncil?: boolean
}) {
  const panel = panelOverride ?? snapshot.panel ?? null
  const previewApi = useLiveIntelPreview()
  const [localInspected, setLocalInspected] = useState<TerraLiveIntelItem | null>(null)
  const [translations, setTranslations] = useState<Record<string, TerraLiveIntelItem>>({})
  const [englishOpen, setEnglishOpen] = useState<Record<string, boolean>>({})
  const [translationPending, setTranslationPending] = useState<Record<string, boolean>>({})
  const inspected = inspectedItem ?? localInspected
  const inspect = onInspectItem ?? setLocalInspected
  const showPending = Boolean(pending) && !panel?.sections.some(section => section.count > 0)
  const viewItem = (item: TerraLiveIntelItem) => translations[item.id] ?? item
  const viewedInspected = inspected ? viewItem(inspected) : null

  const dismissInspect = () => {
    previewApi.teardown()
    inspect(null)
  }

  const toggleEnglish = async (item: TerraLiveIntelItem) => {
    const current = viewItem(item)
    if (englishOpen[item.id]) {
      setEnglishOpen(open => ({ ...open, [item.id]: false }))
      return
    }
    if (current.englishHeadline || current.translationState === 'TRANSLATION_AVAILABLE' || current.translationState === 'TRANSLATED') {
      setEnglishOpen(open => ({ ...open, [item.id]: true }))
      return
    }
    setTranslationPending(pendingIds => ({ ...pendingIds, [item.id]: true }))
    try {
      const response = await fetch('/api/terra/live-intel/translate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceText: current.originalHeadline,
          sourceLanguage: current.originalLanguage,
        }),
      })
      const payload = await response.json() as { ok?: boolean; translation?: TerraLiveIntelTranslationRecord; reason?: string }
      if (payload.ok && payload.translation) {
        setTranslations(rows => ({ ...rows, [item.id]: applyLiveIntelTranslation(current, payload.translation!) }))
      } else {
        setTranslations(rows => ({ ...rows, [item.id]: applyTranslationFailure(current) }))
      }
      setEnglishOpen(open => ({ ...open, [item.id]: true }))
    } catch {
      setTranslations(rows => ({ ...rows, [item.id]: applyTranslationFailure(current) }))
      setEnglishOpen(open => ({ ...open, [item.id]: true }))
    } finally {
      setTranslationPending(pendingIds => ({ ...pendingIds, [item.id]: false }))
    }
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      previewApi.teardown()
      inspect(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [inspect, previewApi])

  if (glance) {
    return (
      <div className="space-y-1">
        {authRequired ? <p className="text-[10px] text-cyan-200">PUBLIC INTEL ACTIVE — Protected sources require Commander session</p> : null}
        {fetchError ? <p className="text-[10px] text-rose-300">{fetchError}</p> : null}
        {showPending ? <p className="text-[10px] text-cyan-300">Loading live intel…</p> : null}
        {panel && !showPending ? (
          <ul className="flex flex-wrap gap-1" data-testid="terra-live-intel-glance-chips">
            {panel.sections.map(section => (
              <li
                key={section.id}
                className="flex items-center gap-1 rounded border border-white/10 bg-black/40 px-1.5 py-0.5"
                title={section.reason}
              >
                <span className="text-[8px] font-bold uppercase tracking-[0.14em] text-slate-400">{section.label}</span>
                <span className={`font-mono text-[8px] font-bold uppercase tracking-widest ${COVERAGE_CLASS[section.coverageState]}`}>
                  {section.displayCount}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[10px] text-slate-500">Loading categories…</p>
        )}
        {panel ? (
          <ul className="space-y-1">
            {panel.sections.flatMap(section => section.items.slice(0, section.id === 'BREAKING' ? 2 : 1)).slice(0, 4).map(item => (
              <ItemRow
                key={`glance-${item.id}`}
                item={viewItem(item)}
                inspected={inspected?.id === item.id}
                englishOpen={Boolean(englishOpen[item.id])}
                translationPending={Boolean(translationPending[item.id])}
                onInspect={inspect}
                onFlyTo={onFlyToItem}
                onToggleEnglish={toggleEnglish}
              />
            ))}
          </ul>
        ) : null}
        <p className="text-[9px] text-slate-600">{panel ? `Scope · ${panel.scope.label}` : 'Hover layers · click to inspect'}</p>
        {panel?.worldTime ? (
          <p className="truncate text-[9px] text-slate-500">
            World time · {panel.worldTime.label} · {panel.worldTime.localTime ?? 'UNAVAILABLE'}
            {panel.worldTime.dayNightState ? ` · ${panel.worldTime.dayNightState}` : ''}
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <div className={`pointer-events-auto ${compact ? '' : 'rounded border border-cyan-400/25 bg-black/75 p-3 backdrop-blur-sm'}`}>
      {!compact ? <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-300">Live globe intel</p> : null}
      {authRequired ? <p className="mb-1 text-[10px] text-cyan-200">PUBLIC INTEL ACTIVE — Protected sources require Commander session. Public Earth/RSS intel is shown; credentialed AIS/Exa stay gated.</p> : null}
      {fetchError ? <p className="mb-1 text-[10px] text-rose-300">{fetchError}</p> : null}
      {showPending ? <p className="mb-1 text-[10px] text-cyan-300">Loading live intel…</p> : null}
      {panel && !showPending ? (
        <div className="space-y-2">
          <p className="text-[9px] uppercase tracking-widest text-slate-500">Scope · {panel.scope.label}</p>
          {panel.worldTime && panel.worldClock ? <TerraWorldClockStrip worldTime={panel.worldTime} worldClock={panel.worldClock} /> : null}
          {panel.sections.map(section => (
            <SectionBlock
              key={section.id}
              section={{ ...section, items: section.items.map(viewItem) }}
              inspectedId={inspected?.id ?? null}
              englishOpen={englishOpen}
              translationPending={translationPending}
              secondaryContext={section.id === 'LOCAL' ? panel.scope.reverseSublocalityLabel : null}
              onInspect={inspect}
              onFlyTo={onFlyToItem}
              onToggleEnglish={toggleEnglish}
            />
          ))}
          {panel.zones.length ? (
            <div>
              <p className="mb-0.5 text-[9px] font-bold uppercase tracking-[0.18em] text-slate-300">Conflict zones</p>
              <ul className="space-y-1 text-[10px] text-slate-400">
                {panel.zones.map(zone => (
                  <li key={zone.name}>
                    <span className="text-slate-200">{zone.name}</span>
                    {' · '}
                    <span className={COVERAGE_CLASS[zone.coverageState]}>{zone.coverageState}</span>
                    {zone.localTime ? <span className="font-mono text-slate-400"> · {zone.localTime}</span> : null}
                    {zone.dayNightState ? <span className="text-slate-500"> · {zone.dayNightState}</span> : null}
                    <p className="text-[9px] text-slate-600">{zone.uncertainty}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-[10px] text-slate-600">Conflict zones · NO_COVERAGE — no battlefield-boundary dataset is wired.</p>
          )}
        </div>
      ) : null}
      {viewedInspected ? (
        <InspectCard
          item={viewedInspected}
          englishOpen={Boolean(englishOpen[viewedInspected.id])}
          translationPending={Boolean(translationPending[viewedInspected.id])}
          onToggleEnglish={toggleEnglish}
          onSendToCouncil={onSendToCouncil}
          canSendToCouncil={canSendToCouncil}
          onDismiss={dismissInspect}
        />
      ) : selected ? (
        <dl className="mt-2 space-y-0.5 border-t border-white/10 pt-2 text-[10px] text-slate-400">
          <div className="flex justify-between gap-2"><dt>Selected</dt><dd className="truncate text-slate-100">{selected.title}</dd></div>
          <div className="flex justify-between gap-2"><dt>Type</dt><dd className="text-cyan-200">{selected.type}</dd></div>
          <div className="flex justify-between gap-2"><dt>Time</dt><dd className="font-mono text-slate-200">{selected.observedAt ?? 'not reported'}</dd></div>
          <div className="flex justify-between gap-2"><dt>Source</dt><dd className="truncate text-slate-200">{selected.provider}</dd></div>
          <div className="flex justify-between gap-2"><dt>Freshness</dt><dd className={FRESHNESS_CLASS[selected.freshness]}>{TERRA_PROVIDER_STATUS_LABELS[selected.freshness]}</dd></div>
        </dl>
      ) : (
        <p className="mt-2 text-[10px] text-slate-500">Original language stays first. ENGLISH expands a translation without replacing source text.</p>
      )}
    </div>
  )
}
