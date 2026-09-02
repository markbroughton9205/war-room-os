/**
 * Workers that actually exist on the live Council research path.
 * Do not claim research-engine domain adapters unless that path is invoked.
 */
export const LIVE_COUNCIL_RESEARCH_WORKERS = [
  { id: 'war_room_live_research_router', path: 'lib/research/researchRouter.ts', usedByChat: true },
  { id: 'tavily', path: 'lib/internet/warRoomSearchProviders.ts', usedByChat: true },
  { id: 'public_rss', path: 'lib/research/publicRssFeeds.ts', usedByChat: true },
  { id: 'nws_alerts', path: 'lib/research/nwsAlerts.ts', usedByChat: true },
  { id: 'grok_framing', path: 'lib/research/researchRouter.ts', usedByChat: true },
  { id: 'direct_url_fetch', path: 'lib/research/researchRouter.ts', usedByChat: true },
  { id: 'gemini_evidence_synthesis', path: 'lib/research/researchEvidence.ts', usedByChat: true },
  { id: 'research_engine_registry', path: 'lib/research-engine/providers/registry.ts', usedByChat: false },
] as const

export function researchWorkersForLiveCouncil(): string[] {
  return LIVE_COUNCIL_RESEARCH_WORKERS.filter(w => w.usedByChat).map(w => w.id)
}
