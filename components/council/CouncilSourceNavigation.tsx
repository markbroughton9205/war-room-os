'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useWarRoomBrowser } from '@/components/war-room/browser/WarRoomBrowserProvider'
import {
  classifyCouncilSourceUrl,
  navigableUrl,
  type CouncilSourceLink,
  type CouncilSourceOpenContext,
  type SourceBlockCode,
} from '@/lib/council/source-links'

type FocusTarget = {
  missionId: string | null
  evidenceId: string | null
  claimId: string | null
}

type SourceNavApi = {
  lastBlock: { code: SourceBlockCode; reason: string } | null
  copied: string | null
  focus: FocusTarget | null
  context: CouncilSourceOpenContext | null
  openInternal: (link: CouncilSourceLink) => Promise<{ ok: boolean; code?: SourceBlockCode; reason?: string }>
  openExternal: (link: CouncilSourceLink) => Promise<{ ok: boolean; code?: SourceBlockCode; reason?: string }>
  copyLink: (link: CouncilSourceLink) => Promise<{ ok: boolean; url?: string; code?: SourceBlockCode; reason?: string }>
  viewEvidence: (link: CouncilSourceLink) => void
  backToMission: () => void
}

const SourceNavContext = createContext<SourceNavApi | null>(null)

function toContext(link: CouncilSourceLink, url: string): CouncilSourceOpenContext {
  return {
    mission_id: link.mission_id,
    session_id: link.session_id,
    source_id: link.source_id,
    claim_ids: link.claim_ids,
    evidence_ids: link.evidence_ids,
    url,
    title: link.title,
    verification_status: link.usable ? (link.supporting ? 'VERIFIED_OR_INSPECTED' : 'INSPECTED') : 'REJECTED',
    source_authority: link.source_authority,
    freshness_state: link.freshness_state,
    rejection_reason: link.rejection_reason,
    supporting: link.supporting,
  }
}

export function CouncilSourceNavigationProvider({ children }: { children: ReactNode }) {
  const browser = useWarRoomBrowser()
  const [lastBlock, setLastBlock] = useState<SourceNavApi['lastBlock']>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [focus, setFocus] = useState<FocusTarget | null>(null)
  const [context, setContext] = useState<CouncilSourceOpenContext | null>(null)

  const guard = useCallback((link: CouncilSourceLink) => {
    if (!link.internal_open_supported && !link.external_open_supported) {
      return { ok: false as const, code: 'INVALID_URL' as const, reason: 'LINK BLOCKED — source has no web URL' }
    }
    const raw = navigableUrl(link)
    const classified = classifyCouncilSourceUrl(raw)
    if (!classified.ok) {
      setLastBlock({ code: classified.code, reason: classified.reason })
      return classified
    }
    setLastBlock(null)
    return classified
  }, [])

  const openInternal = useCallback(async (link: CouncilSourceLink) => {
    const classified = guard(link)
    if (!classified.ok) return classified
    setContext(toContext(link, classified.url))
    await browser.openUrl(classified.url, toContext(link, classified.url))
    return { ok: true as const }
  }, [browser, guard])

  const openExternal = useCallback(async (link: CouncilSourceLink) => {
    const classified = guard(link)
    if (!classified.ok) return classified
    await browser.openExternally(classified.url)
    return { ok: true as const }
  }, [browser, guard])

  const copyLink = useCallback(async (link: CouncilSourceLink) => {
    const classified = guard(link)
    if (!classified.ok) return classified
    try {
      await navigator.clipboard.writeText(classified.url)
      setCopied(classified.url)
      window.setTimeout(() => setCopied(current => current === classified.url ? null : current), 1600)
      return { ok: true as const, url: classified.url }
    } catch {
      return { ok: false as const, code: 'INVALID_URL' as const, reason: 'clipboard unavailable' }
    }
  }, [guard])

  const viewEvidence = useCallback((link: CouncilSourceLink) => {
    const next = {
      missionId: link.mission_id,
      evidenceId: link.evidence_ids[0] ?? null,
      claimId: link.claim_ids[0] ?? null,
    }
    setFocus(next)
    const node = document.querySelector('[data-testid="evidence-board-council"]')
    if (node instanceof HTMLElement) node.scrollIntoView({ block: 'nearest' })
    if (next.evidenceId) {
      const evidence = document.querySelector(`[data-evidence-id="${CSS.escape(next.evidenceId)}"]`)
      if (evidence instanceof HTMLElement) evidence.scrollIntoView({ block: 'nearest' })
    }
  }, [])

  const backToMission = useCallback(() => {
    browser.close()
    const node = document.querySelector('[data-testid="evidence-board-advanced"], [data-testid="evidence-board-council"]')
    if (node instanceof HTMLElement) node.scrollIntoView({ block: 'nearest' })
  }, [browser])

  const api = useMemo<SourceNavApi>(() => ({
    lastBlock,
    copied,
    focus,
    context,
    openInternal,
    openExternal,
    copyLink,
    viewEvidence,
    backToMission,
  }), [backToMission, context, copied, copyLink, focus, lastBlock, openExternal, openInternal, viewEvidence])

  return <SourceNavContext.Provider value={api}>{children}</SourceNavContext.Provider>
}

export function useCouncilSourceNavigation(): SourceNavApi {
  const ctx = useContext(SourceNavContext)
  if (ctx) return ctx
  return {
    lastBlock: null,
    copied: null,
    focus: null,
    context: null,
    openInternal: async () => ({ ok: false, code: 'INVALID_URL', reason: 'source navigation unavailable' }),
    openExternal: async () => ({ ok: false, code: 'INVALID_URL', reason: 'source navigation unavailable' }),
    copyLink: async () => ({ ok: false, code: 'INVALID_URL', reason: 'source navigation unavailable' }),
    viewEvidence: () => undefined,
    backToMission: () => undefined,
  }
}
