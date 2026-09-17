'use client'

import { IconBroadcast, IconCamera, IconNearby } from '@/components/war-room/council/CommandIcons'
import { AREA_LIVE_CATEGORIES, type AreaLiveCategory } from '@/lib/terra/godsEye/areaLiveMedia'
import {
  formatAreaLiveCount,
  type AreaLiveNearbyRow,
  type AreaLiveWorkspace,
} from '@/lib/terra/godsEye/areaLiveWorkspace'

const CATEGORY_HINT: Record<AreaLiveCategory, string> = {
  ALL: 'Cameras, verified video, local media, and events for the active area',
  CAMERAS: 'Verified public traffic cameras for the active area',
  VIDEO: 'Verified lawful video only — never invented',
  MEDIA: 'Live Intel and local media tied to the active area',
  EVENTS: 'Current events tied to the active area',
}

function RowIcon({ kind }: { kind: AreaLiveNearbyRow['kind'] }) {
  if (kind === 'CAMERA') return <IconCamera size={11} />
  if (kind === 'VIDEO') return <IconBroadcast size={11} />
  return <IconNearby size={11} />
}

export function TerraAreaLiveControl({
  open,
  category,
  workspace,
  selectedRowId,
  onToggle,
  onCategory,
  onViewRow,
  onPreviewRow,
  onPreviewEnd,
  onOpenOfficialViewer,
  onSourceRow,
  onSendRow,
}: {
  open: boolean
  category: AreaLiveCategory
  workspace: AreaLiveWorkspace | null
  selectedRowId?: string | null
  onToggle: () => void
  onCategory: (category: AreaLiveCategory) => void
  onViewRow: (row: AreaLiveNearbyRow) => void
  onPreviewRow?: (row: AreaLiveNearbyRow) => void
  onPreviewEnd?: () => void
  onOpenOfficialViewer?: () => void
  onSourceRow?: (row: AreaLiveNearbyRow) => void
  onSendRow?: (row: AreaLiveNearbyRow) => void
}) {
  return (
    <div
      className="pointer-events-auto flex max-w-[min(32rem,94vw)] flex-col gap-1 rounded border border-cyan-400/30 bg-black/80 px-2 py-1 text-[9px] uppercase tracking-widest text-slate-300 shadow-[0_0_18px_rgba(34,211,238,0.08)] backdrop-blur-md"
      data-testid="terra-area-live-control"
      data-coverage-state={workspace?.coverageState ?? 'UNAVAILABLE'}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={open}
          data-testid="terra-area-live-toggle"
          className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-bold ${
            open ? 'border-cyan-300/70 text-cyan-200' : 'border-white/15 text-slate-300 hover:border-cyan-300/50 hover:text-cyan-200'
          }`}
        >
          <IconCamera size={12} />
          Area Live
        </button>
        {open ? AREA_LIVE_CATEGORIES.map(item => (
          <button
            key={item}
            type="button"
            title={CATEGORY_HINT[item]}
            data-testid={`terra-area-live-category-${item.toLowerCase()}`}
            aria-pressed={category === item}
            onClick={() => onCategory(item)}
            className={`rounded border px-1.5 py-0.5 font-bold ${
              category === item
                ? 'border-cyan-300/70 text-cyan-200'
                : 'border-white/15 text-slate-400 hover:border-cyan-300/50 hover:text-cyan-200'
            }`}
          >
            {item}
          </button>
        )) : null}
      </div>
      {open ? (
        <div className="normal-case tracking-normal" data-testid="terra-area-live-panel">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-100" data-testid="terra-area-live-header">
            {workspace?.headerLabel ?? 'AREA LIVE'}
          </p>
          <div className="mt-1 grid grid-cols-4 gap-1 font-mono text-[9px] uppercase tracking-widest text-slate-400" data-testid="terra-area-live-counts">
            <span data-testid="terra-area-live-camera-count">Cameras {formatAreaLiveCount(workspace?.counts.cameras ?? { known: true, value: 0 })}</span>
            <span data-testid="terra-area-live-video-count">Live video {formatAreaLiveCount(workspace?.counts.liveVideo ?? { known: false })}</span>
            <span data-testid="terra-area-live-media-count">Media {formatAreaLiveCount(workspace?.counts.media ?? { known: false })}</span>
            <span data-testid="terra-area-live-event-count">Events {formatAreaLiveCount(workspace?.counts.events ?? { known: false })}</span>
          </div>
          <p className="mt-1 text-[9px] uppercase tracking-widest text-slate-500" data-testid="terra-area-live-coverage">
            {workspace?.coverageState ?? 'UNAVAILABLE'}
            {workspace?.coveringLabel ? ` · ${workspace.coveringLabel}` : ''}
          </p>
          {(workspace?.coverageState === 'PROVIDER_AUTH_REQUIRED' || workspace?.coverageState === 'PARTIAL') && workspace?.officialViewerUrl && onOpenOfficialViewer ? (
            <button
              type="button"
              onClick={onOpenOfficialViewer}
              className="mt-1 rounded border border-cyan-400/40 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-cyan-200 hover:border-cyan-300/70"
              data-testid="terra-area-live-open-official-viewer"
            >
              Open official view
            </button>
          ) : null}
          <div className="mt-2 max-h-[min(18rem,36vh)] overflow-y-auto" data-testid="terra-area-live-nearby">
            <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-slate-500">Nearby Live</p>
            {workspace?.rows.length === 0 ? (
              <p className="text-[10px] text-slate-500">No verified sources in this filter for the active location.</p>
            ) : (workspace?.rows ?? []).map(row => (
              <div
                key={row.id}
                className={`mb-1 flex items-center gap-2 rounded border px-1.5 py-1 ${
                  selectedRowId === row.id ? 'border-cyan-300/60 bg-cyan-950/40' : 'border-white/10 bg-black/30'
                }`}
                data-testid={`terra-area-live-row-${row.kind.toLowerCase()}`}
                onMouseEnter={() => onPreviewRow?.(row)}
                onMouseLeave={() => onPreviewEnd?.()}
                onFocus={() => onPreviewRow?.(row)}
                onBlur={() => onPreviewEnd?.()}
              >
                <span className="text-cyan-300"><RowIcon kind={row.kind} /></span>
                {row.media?.posterUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={row.media.posterUrl} alt="" className="h-8 w-12 shrink-0 rounded object-cover" />
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-semibold text-slate-100">{row.title}</p>
                  <p className="truncate text-[9px] uppercase tracking-widest text-slate-500">
                    {row.subtitle}
                    {row.publishedAt ? ` · ${row.publishedAt.replace('T', ' ').slice(0, 16)}` : ''}
                    {row.verificationState ? ` · ${row.verificationState}` : ''}
                    {row.locationRelevance ? ` · ${row.locationRelevance}` : row.distanceLabel ? ` · ${row.distanceLabel}` : ''}
                    {' · '}
                    {row.kind}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-0.5">
                  <button
                    type="button"
                    onClick={() => onViewRow(row)}
                    className="rounded border border-cyan-400/40 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-cyan-200 hover:border-cyan-300/70"
                    data-testid="terra-area-live-view"
                  >
                    View
                  </button>
                  {row.kind === 'VIDEO' || row.kind === 'MEDIA' ? (
                    <div className="flex gap-0.5">
                      {onSourceRow && row.sourceUrl ? (
                        <button
                          type="button"
                          onClick={() => onSourceRow(row)}
                          className="rounded border border-white/20 px-1 py-0.5 text-[8px] font-bold uppercase tracking-widest text-slate-300 hover:text-cyan-200"
                          data-testid="terra-area-live-source"
                        >
                          Source
                        </button>
                      ) : null}
                      {onSendRow ? (
                        <button
                          type="button"
                          onClick={() => onSendRow(row)}
                          className="rounded border border-cyan-400/30 px-1 py-0.5 text-[8px] font-bold uppercase tracking-widest text-cyan-200 hover:border-cyan-300/70"
                          data-testid="terra-area-live-send"
                        >
                          Send to Council
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
