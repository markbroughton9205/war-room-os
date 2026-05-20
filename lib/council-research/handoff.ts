import type { NewsIntelStory } from '@/lib/intelligence/newsIntelWall'
import type { CouncilResearchHandoff, CouncilStoryContext } from './types'

export function storyToResearchContext(story: NewsIntelStory): CouncilStoryContext {
  return {
    headline: story.headline,
    source: story.source,
    url: story.url,
    category: story.category,
    shortSummary: story.shortSummary,
    whyItMatters: story.whyItMatters,
    confidence: story.confidence,
    freshnessStatus: story.freshnessStatus,
    provider: story.provider,
  }
}

export function storyToResearchHandoff(
  story: NewsIntelStory,
  action: CouncilResearchHandoff['action'] = 'ask_council',
): CouncilResearchHandoff {
  const ctx = storyToResearchContext(story)
  const base = `Council, review this source-backed news signal from ${story.source}: ${story.headline}. Identify verified facts, operational relevance, contradictions, and unknowns. Summary: ${story.shortSummary}`
  const decree =
    action === 'investigate'
      ? `${base} Include verified, emerging, contradictions, unknowns, and source links.`
      : action === 'send_to_analysts'
        ? `Council research team — send analysts to investigate: ${story.headline} (${story.source}). ${story.whyItMatters}`
        : base
  return { decree, storyContext: ctx, action }
}
