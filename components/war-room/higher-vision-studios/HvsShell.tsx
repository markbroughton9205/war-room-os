'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import {
  HVS_CANONICAL_PATH,
  HVS_CREATE_BACKGROUND_DESKTOP_SRC,
  HVS_CREATE_BACKGROUND_MOBILE_SRC,
  HVS_PRIMARY_SECTIONS,
  HVS_TOOL_SECTIONS,
  hvsCharactersHref,
  hvsStudioHref,
  isHvsSectionActive,
  persistHvsResume,
  readHvsResume,
} from '@/lib/media-command/navigation'
import { isBrokenHvsOrigin } from '@/lib/media-command/war-room-integration'
import './hvs-ai-first.css'
import { isHvsProductionPath } from '@/lib/media-command/production-pages'
import { HvsHomeNav } from './HvsHomeNav'
import { HvsUnavailableState } from './HvsUnavailableState'

export function HvsShell({
  children,
  projectName,
}: {
  children: ReactNode
  projectName?: string
}) {
  const pathname = usePathname() || ''
  const [toolsOpen, setToolsOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [brokenOrigin, setBrokenOrigin] = useState(false)
  const [studioHref, setStudioHref] = useState(`${HVS_CANONICAL_PATH}/studio`)
  const [charactersHref, setCharactersHref] = useState(`${HVS_CANONICAL_PATH}/characters`)
  const studio = isHvsProductionPath(pathname)
  const cinema = !studio && (
    pathname === HVS_CANONICAL_PATH
    || /^\/higher-vision-studios\/projects\/[^/]+\/create\/?$/.test(pathname)
  )

  useEffect(() => {
    queueMicrotask(() => {
      setMounted(true)
      setBrokenOrigin(isBrokenHvsOrigin(window.location.protocol))
      const resume = readHvsResume()
      setStudioHref(hvsStudioHref(resume?.projectId))
      setCharactersHref(hvsCharactersHref(resume?.projectId))
    })
  }, [pathname])

  if (brokenOrigin) {
    return (
      <div className="min-h-screen bg-[#050403] p-6 text-amber-50" data-testid="hvs-shell" data-hvs-unavailable="1">
        <HvsUnavailableState />
      </div>
    )
  }

  return (
    <div className={cinema ? 'hvs-shell-cinema min-h-screen text-amber-50' : 'min-h-screen bg-[#050403] text-amber-50'} data-testid="hvs-shell" data-hvs-workspace={studio ? 'studio' : 'browse'} data-hvs-cinema={cinema ? '1' : '0'}>
      {cinema ? (
        <div
          className="hvs-cinema-bg"
          data-testid="hvs-cinema-background"
          data-hvs-bg-desktop={HVS_CREATE_BACKGROUND_DESKTOP_SRC}
          data-hvs-bg-mobile={HVS_CREATE_BACKGROUND_MOBILE_SRC}
          aria-hidden="true"
          style={{
            ['--hvs-bg-desktop' as string]: `url("${HVS_CREATE_BACKGROUND_DESKTOP_SRC}")`,
            ['--hvs-bg-mobile' as string]: `url("${HVS_CREATE_BACKGROUND_MOBILE_SRC}")`,
          }}
        >
          <div className="hvs-cinema-bg-scrim" />
        </div>
      ) : null}
      <div className={studio ? 'hvs-shell-foreground p-0' : 'hvs-shell-foreground px-2 py-2 lg:px-3'}>
      <div className={studio ? 'hidden' : undefined}>
        <HvsHomeNav projectName={projectName} compact={studio} />
      </div>
        {studio ? null : (
        <nav
          className="foundry-glass mb-1 flex flex-wrap items-center gap-1 rounded-lg border border-amber-900/40 px-2 py-1"
          aria-label="Higher Vision Studios primary"
          data-testid="hvs-primary-nav"
        >
          {HVS_PRIMARY_SECTIONS.map(section => {
            const href = section.id === 'editor' ? studioHref : section.href
            const active = mounted && isHvsSectionActive(section.id, pathname)
            return (
              <Link
                key={section.id}
                href={href}
                data-testid={`hvs-nav-${section.id}`}
                onClick={() => persistHvsResume({
                  basePath: href,
                  projectId: section.id === 'editor'
                    ? (pathname.match(/\/projects\/([^/]+)/)?.[1] ?? readHvsResume()?.projectId)
                    : null,
                  section: section.id,
                })}
                className="rounded px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest"
                style={{
                  border: active ? '1px solid rgba(232,200,114,0.7)' : '1px solid transparent',
                  color: active ? '#fff6df' : (cinema ? '#f3ead8' : '#94a3b8'),
                  background: active ? 'rgba(232,200,114,0.16)' : 'transparent',
                  textShadow: cinema ? '0 1px 8px rgba(0,0,0,0.7)' : undefined,
                }}
              >
                {section.label}
                {section.slice0 === 'boundary' ? (
                  <span className="ml-1 text-[8px] tracking-widest text-cyan-400/80">SHELL</span>
                ) : null}
              </Link>
            )
          })}
          <div className="relative ml-auto">
            <button
              type="button"
              className="rounded border border-white/10 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-300"
              data-testid="hvs-nav-tools"
              onClick={() => setToolsOpen(v => !v)}
            >
              Tools
            </button>
            {toolsOpen ? (
              <ul className="absolute right-0 z-40 mt-1 max-h-80 w-52 overflow-auto rounded-lg border border-amber-900/50 bg-[#0a0806] p-1 shadow-2xl">
                {HVS_TOOL_SECTIONS.map(section => {
                  const href = section.id === 'characters' ? charactersHref : section.href
                  return (
                  <li key={section.id}>
                    <Link
                      href={href}
                      data-testid={`hvs-nav-${section.id}`}
                      data-hvs-internal-route="1"
                      onClick={() => {
                        persistHvsResume({
                          basePath: href.split('?')[0],
                          projectId: section.id === 'characters' ? (readHvsResume()?.projectId ?? null) : null,
                          section: section.id,
                        })
                        setToolsOpen(false)
                      }}
                      className="block rounded px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:bg-white/5 hover:text-amber-100"
                    >
                      {section.label}
                      {section.slice0 === 'boundary' ? (
                        <span className="ml-1 text-[8px] tracking-widest text-cyan-400/80">SHELL</span>
                      ) : null}
                    </Link>
                  </li>
                  )
                })}
              </ul>
            ) : null}
          </div>
        </nav>
        )}
        <main className="min-w-0" data-hvs-studio={studio ? '1' : '0'}>{children}</main>
      </div>
    </div>
  )
}
