/**
 * Council Browser Client — research workflow over the shared Browser Broker.
 * Discovers URLs dynamically, unwraps search redirects, extracts usable sources.
 * Not an HTTP-fetch stand-in. Opens real pages, extracts evidence, keeps citations.
 */
import { getBrowserBroker } from './broker'
import { hashProfileId } from './profileStore'
import {
  extractionLooksUsable,
  fetchDuckDuckGoCandidates,
  paperIdentity,
  selectResearchCandidates,
  toCandidate,
  wantsCurrentInfo,
  wantsPrimarySources,
  type ResearchSourceCandidate,
} from './researchDiscovery'
import { classifyResearchIntent, evaluateSourceRelevance, identityKey, parseVisibleNewsroomReleases, preferredAuthorities, PARTIAL_FAILURE_URL, partialFailureRequested, type RelevanceDecision, type SourceAuthorityClass, type SourceRelevanceRecord } from './researchPolicy'
import { planResearchDiscovery } from '@/lib/council/engines/research-discovery/engine'
import { assessSourceAuthority } from '@/lib/council/engines/source-authority/engine'
import type { ResearchDiscoveryPlan } from '@/lib/council/engines/research-discovery/types'
import type { SourceAssessment } from '@/lib/council/engines/source-authority/types'
import type { BrowserCitation, BrowserExtractedPage } from './types'

export function councilNeedsTrustedProfile(query: string): boolean {
  return /\b(private repo|my github|authenticated dashboard|logged[- ]in account)\b/i.test(query)
}

export type CouncilBrowserResearchInput = {
  query: string
  maxSources?: number
  budgetMs?: number
  allowLocalhost?: boolean
  seedUrls?: string[]
  profileId?: string
  sessionMode?: 'EPHEMERAL' | 'TRUSTED_PROFILE'
}

export type CouncilBrowserSource = {
  url: string
  finalUrl: string
  title: string
  evidence: string
  headings: string[]
  citation: BrowserCitation
  source_type?: string
  primary_or_secondary?: 'primary' | 'secondary'
  published_at?: string | null
  updated_at?: string | null
  observed_at?: string
  relevance?: SourceRelevanceRecord
  authority_class?: SourceAuthorityClass
  relevance_decision?: RelevanceDecision
}

export type CouncilBrowserResearchResult = {
  ok: boolean
  sessionId: string | null
  brokerState: string
  query: string
  startedAt: string
  finishedAt: string
  durationMs: number
  sources: CouncilBrowserSource[]
  citations: BrowserCitation[]
  synthesis: string
  sessionKind: 'EPHEMERAL' | 'TRUSTED_PROFILE'
  profileIdHash: string | null
  error?: string
  candidates?: ResearchSourceCandidate[]
  queries?: string[]
  discovered_source_count?: number
  selected_source_count?: number
  opened_source_count?: number
  usable_source_count?: number
  unique_source_count?: number
  primary_source_count?: number
  failed_source_count?: number
  work_product?: Array<{
    source_url: string
    source_title: string
    source_identity: string
    source_type: string
    primary_or_secondary: 'primary' | 'secondary'
    finding: string
    support_scope: string
    observed_at: string
    published_at?: string | null
    relevance_decision?: RelevanceDecision
    authority_class?: SourceAuthorityClass
  }>
  failed_sources?: Array<{ url: string; title?: string; reason: RelevanceDecision | 'NAVIGATE_FAILED' }>
  research_domain?: string
  freshness_window_days?: number | null
  discovery_plan?: ResearchDiscoveryPlan
  source_assessments?: SourceAssessment[]
}

const DEFAULT_SEEDS: { match: RegExp; urls: string[] }[] = [
  {
    match: /playwright|browser context|persistent.?profile/i,
    urls: [
      'https://playwright.dev/docs/browser-contexts',
      'https://playwright.dev/docs/auth',
    ],
  },
  {
    match: /sparse expert|mixture-of-experts|mixture of experts|\bmoe\b|expert routing|switch transformer/i,
    urls: [
      'https://arxiv.org/abs/1701.06538',
      'https://arxiv.org/abs/2401.04088',
      'https://arxiv.org/abs/2101.03961',
    ],
  },
  {
    match: /last \d+\s+days|past \d+\s+days|current (?:ai|news|development)|\bthis (?:week|month)\b|\btoday\b|\blatest\b/i,
    urls: [
      'https://www.anthropic.com/news',
      'https://deepmind.google/blog/',
    ],
  },
]

function pickSeedUrls(query: string, extra?: string[]): string[] {
  const matched = DEFAULT_SEEDS.filter(item => item.match.test(query)).flatMap(item => item.urls)
  return [...(extra ?? []), ...matched].filter((url, index, all) => all.indexOf(url) === index).slice(0, 6)
}

function alternateUrl(url: string): string | null {
  const abs = url.match(/arxiv\.org\/abs\/([a-z\-]+\/\d{7}|\d{4}\.\d{4,5})/i)
  if (abs) return `https://arxiv.org/html/${abs[1]}`
  const html = url.match(/arxiv\.org\/html\/([a-z\-]+\/\d{7}|\d{4}\.\d{4,5})/i)
  if (html) return `https://arxiv.org/abs/${html[1]}`
  const pdf = url.match(/arxiv\.org\/pdf\/([a-z\-]+\/\d{7}|\d{4}\.\d{4,5})/i)
  if (pdf) return `https://arxiv.org/abs/${pdf[1]}`
  return null
}

function synthesize(query: string, pages: { title: string; url: string; text: string; headings: string[] }[]): string {
  if (!pages.length) return 'NO_USABLE_SOURCES'
  const lines = [
    `Council browser research for: ${query}`,
    `Inspected ${pages.length} live source(s) via the War Room Browser Broker.`,
    '',
  ]
  for (const page of pages) {
    const snippet = page.text.replace(/\s+/g, ' ').trim().slice(0, 700)
    lines.push(`SOURCE: ${page.title || '(untitled)'}`)
    lines.push(`URL: ${page.url}`)
    if (page.headings[0]) lines.push(`HEADING: ${page.headings[0]}`)
    lines.push(`EVIDENCE: ${snippet}`)
    lines.push('')
  }
  const isolation = pages.some(page => /isolat/i.test(`${page.title} ${page.text}`))
  const persistent = pages.some(page => /persistent|storageState|launchPersistentContext/i.test(`${page.title} ${page.text}`))
  if (isolation || persistent) {
    lines.push('COMPARISON:')
    if (isolation) lines.push('Isolated browser contexts do not share cookies, localStorage, or authenticated state with each other.')
    if (persistent) lines.push('Persistent profiles / storageState keep signed-in identity across launches when deliberately selected.')
  }
  return lines.join('\n').slice(0, 8_000)
}

function emptyResult(input: {
  query: string
  startedAt: string
  t0: number
  sessionId: string | null
  brokerState: string
  sessionKind: 'EPHEMERAL' | 'TRUSTED_PROFILE'
  profileIdHash: string | null
  error?: string
  sources?: CouncilBrowserSource[]
  citations?: BrowserCitation[]
  candidates?: ResearchSourceCandidate[]
  queries?: string[]
  failed?: number
}): CouncilBrowserResearchResult {
  const sources = input.sources ?? []
  return {
    ok: false,
    sessionId: input.sessionId,
    brokerState: input.brokerState,
    query: input.query,
    startedAt: input.startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - input.t0,
    sources,
    citations: input.citations ?? [],
    synthesis: 'NO_USABLE_SOURCES',
    sessionKind: input.sessionKind,
    profileIdHash: input.profileIdHash,
    error: input.error,
    candidates: input.candidates ?? [],
    queries: input.queries ?? [input.query],
    discovered_source_count: input.candidates?.length ?? 0,
    selected_source_count: 0,
    opened_source_count: input.failed ?? 0,
    usable_source_count: 0,
    unique_source_count: 0,
    primary_source_count: 0,
    failed_source_count: input.failed ?? 0,
    work_product: [],
    failed_sources: [],
    research_domain: classifyResearchIntent(input.query).research_domain,
    freshness_window_days: classifyResearchIntent(input.query).freshness_window_days,
  }
}

export async function runCouncilBrowserResearch(input: CouncilBrowserResearchInput): Promise<CouncilBrowserResearchResult> {
  const startedAt = new Date().toISOString()
  const t0 = Date.now()
  const budgetMs = Math.min(Math.max(input.budgetMs ?? 90_000, 8_000), 120_000)
  const deadline = t0 + budgetMs
  const maxSources = Math.min(Math.max(input.maxSources ?? 4, 2), 5)
  const broker = getBrowserBroker()
  const started = await broker.start()
  if (!started.ok) {
    return emptyResult({
      query: input.query,
      startedAt,
      t0,
      sessionId: null,
      brokerState: broker.getHealth(),
      sessionKind: 'EPHEMERAL',
      profileIdHash: null,
      error: started.error,
    })
  }
  const wantsTrusted = input.sessionMode === 'TRUSTED_PROFILE' || Boolean(input.profileId)
  if (councilNeedsTrustedProfile(input.query) && !wantsTrusted) {
    return emptyResult({
      query: input.query,
      startedAt,
      t0,
      sessionId: null,
      brokerState: broker.getHealth(),
      sessionKind: 'EPHEMERAL',
      profileIdHash: null,
      error: 'PROFILE_ACCESS_REQUIRED',
    })
  }
  const session = await broker.createSession({
    owner: 'council',
    allowLocalhost: input.allowLocalhost === true,
    sessionMode: wantsTrusted ? 'TRUSTED_PROFILE' : 'EPHEMERAL',
    profileId: input.profileId,
  })
  if (!session.ok) {
    return emptyResult({
      query: input.query,
      startedAt,
      t0,
      sessionId: null,
      brokerState: broker.getHealth(),
      sessionKind: wantsTrusted ? 'TRUSTED_PROFILE' : 'EPHEMERAL',
      profileIdHash: input.profileId ? hashProfileId(input.profileId) : null,
      error: session.error,
    })
  }

  const sources: CouncilBrowserSource[] = []
  const failedSources: Array<{ url: string; title?: string; reason: RelevanceDecision | 'NAVIGATE_FAILED' }> = []
  const inspected = new Set<string>()
  const remaining = () => deadline - Date.now()
  let opened = 0
  let failed = 0
  const intent = classifyResearchIntent(input.query)
  const discoveryPlan = planResearchDiscovery({
    mission_id: 'pulsar-browser-research',
    question: input.query,
    candidate_budget: maxSources,
  })
  const queries = [...discoveryPlan.primary_queries, ...discoveryPlan.alternate_queries]
  const discovered: ResearchSourceCandidate[] = []
  const wantsPrimary = wantsPrimarySources(input.query)
  const wantsCurrent = wantsCurrentInfo(input.query) || intent.freshness_window_days != null
  const minUsable = Math.min(2, maxSources)
  const partial = partialFailureRequested(input.query)
  let freshnessSkips = 0

  const acceptDatedReleases = async (page: BrowserExtractedPage, tabId: string): Promise<number> => {
    const preferred = preferredAuthorities(intent.research_domain)
    const pageUrl = page.finalUrl || page.url
    let taken = 0
    for (const release of page.releases ?? []) {
      if (taken >= 2 || sources.length >= (partial ? 2 : maxSources)) break
      let url = pageUrl
      if (release.url) {
        try {
          const resolved = new URL(release.url, pageUrl)
          const sameHost = resolved.hostname.replace(/^www\./, '') === new URL(pageUrl).hostname.replace(/^www\./, '')
          if (sameHost) url = resolved.href
        } catch {
          url = pageUrl
        }
      }
      const prose = [release.title, release.summary].filter(Boolean).join('. ')
      if (prose.length < 80) continue
      const relevance = evaluateSourceRelevance({
        prompt: input.query,
        intent,
        url,
        title: release.title,
        text: prose,
        published_at: release.date,
        extraction_ok: true,
      })
      if (relevance.relevance_decision !== 'ACCEPT' || !preferred.includes(relevance.authority_class)) continue
      const identity = identityKey(url)
      if (sources.some(source => identityKey(source.finalUrl || source.url) === identity)) continue
      const dateLine = `Published: ${relevance.freshness.source_published_at?.slice(0, 10) || release.date.slice(0, 10)}`
      const evidence = [dateLine, prose].join('\n')
      const citation = await broker.cite(session.result.sessionId, tabId, evidence)
      if (!citation.ok) continue
      inspected.add(identity)
      sources.push({
        url,
        finalUrl: url,
        title: release.title,
        evidence,
        headings: [release.title],
        citation: citation.result,
        source_type: 'lab_research',
        primary_or_secondary: 'primary',
        published_at: relevance.freshness.source_published_at,
        updated_at: relevance.freshness.source_updated_at,
        observed_at: new Date().toISOString(),
        relevance,
        authority_class: relevance.authority_class,
        relevance_decision: relevance.relevance_decision,
      })
      taken += 1
    }
    return taken
  }

  const inspectUrl = async (url: string, candidate?: ResearchSourceCandidate): Promise<boolean> => {
    const identity = identityKey(url)
    if (remaining() < 4_000) return false
    if (inspected.has(identity) || inspected.has(url)) return false
    inspected.add(identity)
    inspected.add(url)
    opened += 1
    const tab = sources.length === 0
      ? { ok: true as const, result: { tabId: session.result.tabId } }
      : await broker.openTab(session.result.sessionId)
    if (!tab.ok) {
      failed += 1
      failedSources.push({ url, title: candidate?.title, reason: 'NAVIGATE_FAILED' })
      return false
    }
    const tryOpen = async (target: string): Promise<'accepted' | 'skip' | 'miss'> => {
      const nav = await broker.navigate({
        owner: 'council',
        sessionId: session.result.sessionId,
        tabId: tab.result.tabId,
        url: target,
      })
      if (!nav.ok) return 'miss'
      const extracted = await broker.extract(session.result.sessionId, tab.result.tabId)
      if (!extracted.ok) return 'miss'
      const page: BrowserExtractedPage = extracted.result
      const visibleReleases = parseVisibleNewsroomReleases(`${page.title}\n${page.readableText}`)
      const releases = [...(page.releases ?? []), ...visibleReleases]
      if (intent.freshness_window_days != null && releases.length) {
        const taken = await acceptDatedReleases({ ...page, releases }, tab.result.tabId)
        if (taken > 0) return 'accepted'
        freshnessSkips += 1
        return 'skip'
      }
      const extractionOk = extractionLooksUsable({ title: page.title, text: page.readableText, url: page.finalUrl || page.url })
      const relevance = evaluateSourceRelevance({
        prompt: input.query,
        intent,
        url: page.finalUrl || page.url || target,
        title: page.title,
        text: `${page.metadata.description || ''}\n${page.readableText.slice(0, 2_400)}`,
        published_at: page.metadata.publishedTime,
        updated_at: page.metadata.updatedTime,
        retrieved_at: new Date().toISOString(),
        extraction_ok: extractionOk,
      })
      if (relevance.relevance_decision !== 'ACCEPT') {
        if (relevance.relevance_decision === 'REJECT_STALE') freshnessSkips += 1
        return 'skip'
      }
      const citation = await broker.cite(session.result.sessionId, tab.result.tabId, page.readableText.slice(0, 900))
      if (!citation.ok) return 'miss'
      const primary = candidate?.primary_candidate
        || relevance.authority_class === 'PRIMARY_RESEARCH'
        || relevance.authority_class === 'OFFICIAL_GOVERNMENT'
        || relevance.authority_class === 'REGULATORY_FILING'
        || relevance.authority_class === 'OFFICIAL_DOCUMENTATION'
        || relevance.authority_class === 'COURT_RECORD'
        || relevance.authority_class === 'OFFICIAL_COMPANY'
      const dateLine = relevance.freshness.source_published_at
        ? `Published: ${relevance.freshness.source_published_at.slice(0, 10)}`
        : relevance.freshness.source_updated_at
          ? `Updated: ${relevance.freshness.source_updated_at.slice(0, 10)}`
          : ''
      sources.push({
        url: page.requestedUrl,
        finalUrl: page.finalUrl,
        title: page.title,
        evidence: [dateLine, page.readableText.slice(0, 1200)].filter(Boolean).join('\n'),
        headings: page.headings,
        citation: citation.result,
        source_type: candidate?.source_type,
        primary_or_secondary: primary ? 'primary' : 'secondary',
        published_at: relevance.freshness.source_published_at,
        updated_at: relevance.freshness.source_updated_at,
        observed_at: new Date().toISOString(),
        relevance,
        authority_class: relevance.authority_class,
        relevance_decision: relevance.relevance_decision,
      })
      return 'accepted'
    }
    const first = await tryOpen(url)
    if (first === 'accepted') return true
    if (first === 'skip') {
      const recovered = alternateUrl(url)
      if (recovered && remaining() > 6_000) {
        const retry = await tryOpen(recovered)
        if (retry === 'accepted') return true
      }
      return false
    }
    const alt = alternateUrl(url)
    if (alt && remaining() > 6_000) {
      const second = await tryOpen(alt)
      if (second === 'accepted') return true
      if (second === 'skip') return false
    }
    failed += 1
    failedSources.push({ url, title: candidate?.title, reason: 'NAVIGATE_FAILED' })
    return false
  }

  try {
    if (remaining() > 8_000) {
      for (const searchQuery of queries) {
        if (remaining() < 8_000) break
        const search = remaining() > 14_000
          ? await broker.search({
            owner: 'council',
            sessionId: session.result.sessionId,
            query: searchQuery,
          })
          : { ok: false as const, error: 'budget' }
        if (search.ok) {
          search.result.results.forEach((row, index) => {
            const candidate = toCandidate({
              url: row.url,
              title: row.title,
              discovered_by: 'search',
              query: searchQuery,
              rank: index + 1,
            })
            if (candidate) discovered.push(candidate)
          })
        }
        if (!discovered.some(item => item.discovered_by === 'search')) {
          const htmlHits = await fetchDuckDuckGoCandidates(searchQuery, 8)
          discovered.push(...htmlHits)
        }
        if (discovered.filter(item => item.discovered_by === 'search').length >= (intent.freshness_window_days != null ? 8 : 4)) break
      }
    }

    const seeds = pickSeedUrls(input.query, input.seedUrls)
    seeds.forEach((url, index) => {
      const candidate = toCandidate({
        url,
        title: url,
        discovered_by: 'seed',
        query: input.query,
        rank: 50 + index,
        reason_selected: 'recovery_seed',
      })
      if (candidate) discovered.push(candidate)
    })

    const selected = selectResearchCandidates(discovered, {
      wantsPrimary,
      wantsCurrent,
      limit: intent.freshness_window_days != null ? 8 : maxSources,
      prompt: input.query,
    })
    const failCandidate = partial
      ? toCandidate({
        url: PARTIAL_FAILURE_URL,
        title: 'Unreachable selected source',
        discovered_by: 'search',
        query: input.query,
        rank: 0,
        reason_selected: 'partial_failure_control',
      })
      : null
    const seedPreferred = partial
      ? seeds.flatMap((url, index) => {
        const candidate = toCandidate({
          url,
          title: url,
          discovered_by: 'seed',
          query: input.query,
          rank: index + 1,
          reason_selected: 'partial_recovery_seed',
        })
        return candidate ? [candidate] : []
      })
      : []
    const realQueue: ResearchSourceCandidate[] = []
    const seenReal = new Set<string>()
    for (const item of [...seedPreferred, ...selected]) {
      if (item.url === PARTIAL_FAILURE_URL) continue
      const key = paperIdentity(item.url)
      if (!key || seenReal.has(key)) continue
      seenReal.add(key)
      realQueue.push(item)
      if (partial && realQueue.length >= 2) break
    }
    const queue = partial && failCandidate
      ? [failCandidate, ...realQueue.slice(0, 2)]
      : selected
    const successCap = partial ? 2 : maxSources

    for (const candidate of queue) {
      if (sources.length >= successCap || remaining() < 4_000 || freshnessSkips >= 6) break
      await inspectUrl(candidate.url, candidate)
      if (!partial && sources.length >= minUsable && remaining() < 12_000) break
    }

    if (!partial && sources.length < minUsable && remaining() > 8_000) {
      for (const seed of seeds) {
        if (sources.length >= maxSources || remaining() < 4_000) break
        await inspectUrl(seed, toCandidate({
          url: seed,
          discovered_by: 'seed',
          query: input.query,
          rank: 90,
          reason_selected: 'bounded_recovery_seed',
        }) ?? undefined)
      }
    }

    const uniqueKeys = new Set(sources.map(source => paperIdentity(source.finalUrl || source.url)))
    const work_product = sources.map(source => ({
      source_url: source.finalUrl || source.url,
      source_title: source.title,
      source_identity: (() => {
        try { return new URL(source.finalUrl || source.url).hostname } catch { return source.finalUrl }
      })(),
      source_type: source.source_type || 'unknown',
      primary_or_secondary: source.primary_or_secondary || 'secondary',
      finding: source.evidence.slice(0, 400),
      support_scope: source.headings[0] || source.title,
      observed_at: source.observed_at || new Date().toISOString(),
      published_at: source.published_at ?? null,
      relevance_decision: source.relevance_decision,
      authority_class: source.authority_class,
    }))
    const synthesis = sources.length
      ? synthesize(input.query, sources.map(source => ({
        title: source.title,
        url: source.finalUrl,
        text: source.evidence,
        headings: source.headings,
      })))
      : 'NO_USABLE_SOURCES'

    const citations = broker.listCitations(session.result.sessionId)
    return {
      ok: sources.length >= 1,
      sessionId: session.result.sessionId,
      brokerState: broker.getHealth(),
      query: input.query,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
      sources,
      citations,
      synthesis,
      sessionKind: session.result.profileId ? 'TRUSTED_PROFILE' : 'EPHEMERAL',
      profileIdHash: session.result.profileId ? hashProfileId(session.result.profileId) : null,
      error: sources.length ? undefined : 'NO_USABLE_SOURCES',
      candidates: queue.length ? queue : discovered.slice(0, 8),
      queries,
      discovered_source_count: discovered.length,
      selected_source_count: queue.length,
      opened_source_count: opened,
      usable_source_count: sources.length,
      unique_source_count: uniqueKeys.size,
      primary_source_count: sources.filter(source => source.primary_or_secondary === 'primary').length,
      failed_source_count: failed,
      work_product,
      failed_sources: failedSources,
      research_domain: intent.research_domain,
      freshness_window_days: intent.freshness_window_days,
      discovery_plan: discoveryPlan,
      source_assessments: sources.map(source => assessSourceAuthority({
        mission_id: 'pulsar-browser-research',
        prompt: input.query,
        url: source.finalUrl || source.url,
        title: source.title,
        text: source.evidence,
        published_at: source.published_at,
        updated_at: source.updated_at,
        extraction_ok: true,
      })),
    }
  } catch (error) {
    const citations = broker.listCitations(session.result.sessionId)
    return emptyResult({
      query: input.query,
      startedAt,
      t0,
      sessionId: session.result.sessionId,
      brokerState: broker.getHealth(),
      sessionKind: session.result.profileId ? 'TRUSTED_PROFILE' : 'EPHEMERAL',
      profileIdHash: session.result.profileId ? hashProfileId(session.result.profileId) : null,
      error: error instanceof Error ? error.message : String(error),
      sources,
      citations,
      candidates: discovered,
      queries,
      failed,
    })
  } finally {
    await broker.closeSession(session.result.sessionId).catch(() => undefined)
  }
}

export async function councilBrowserExtract(sessionId: string, tabId?: string): Promise<BrowserExtractedPage | null> {
  const extracted = await getBrowserBroker().extract(sessionId, tabId)
  return extracted.ok ? extracted.result : null
}
