'use client'

import Link from 'next/link'
import { persistHvsResume, readHvsResume } from '@/lib/media-command/navigation'
import {
  HVS_PRODUCTION_PAGES,
  hvsProductionHref,
  type HvsProductionPageId,
} from '@/lib/media-command/production-pages'

const V3_MODES = ['edit', 'color', 'audio', 'vfx', 'ai', 'review'] as const
const V3_LABELS: Record<(typeof V3_MODES)[number], string> = {
  edit: 'EDIT',
  color: 'COLOR',
  audio: 'AUDIO',
  vfx: 'VFX',
  ai: 'AI',
  review: 'REVIEW',
}

export function HvsProductionBar({
  projectId,
  page,
  projectName,
  playheadSec,
  selectedClipId,
}: {
  projectId?: string | null
  page: HvsProductionPageId
  projectName?: string | null
  playheadSec?: number | null
  selectedClipId?: string | null
}) {
  function persist(href: string, itemId: HvsProductionPageId) {
    if (!projectId) return
    const resume = readHvsResume()
    persistHvsResume({
      basePath: href,
      projectId,
      section: itemId === 'edit' || itemId === 'cut' ? 'editor' : itemId === 'media' ? 'library' : itemId === 'deliver' ? 'render-queue' : 'editor',
      playheadSec: playheadSec ?? resume?.playheadSec ?? null,
      selectedClipId: selectedClipId ?? resume?.selectedClipId ?? null,
    })
  }

  return (
    <nav className="hvs-v3-modes" data-testid="hvs-workspace-nav" aria-label="Higher Vision Studios production pages">
      {V3_MODES.map(id => {
        const item = HVS_PRODUCTION_PAGES.find(p => p.id === id)
        if (!item) return null
        const label = V3_LABELS[id]
        const href = projectId ? hvsProductionHref(projectId, item.id) : '#'
        return (
          <Link
            key={item.id}
            href={href}
            data-testid={`hvs-surface-${item.id}`}
            data-active={page === id ? 'true' : 'false'}
            title={`${label} · ${item.status}`}
            onClick={() => persist(href, item.id)}
          >{label}</Link>
        )
      })}
      <details className="hvs-v3-more">
        <summary>More</summary>
        <div>
          {projectName ? (
            <span data-testid="hvs-production-project">{projectName}</span>
          ) : null}
          {(['media', 'cut', 'photo', 'deliver'] as HvsProductionPageId[]).map(id => {
            const item = HVS_PRODUCTION_PAGES.find(p => p.id === id)
            if (!item) return null
            const href = projectId ? hvsProductionHref(projectId, item.id) : '#'
            return (
              <Link
                key={item.id}
                href={href}
                data-testid={`hvs-surface-${item.id}`}
                data-active={page === item.id ? 'true' : 'false'}
                title={`${item.label} · ${item.status}`}
                onClick={() => persist(href, item.id)}
              >{item.label}</Link>
            )
          })}
        </div>
      </details>
    </nav>
  )
}
