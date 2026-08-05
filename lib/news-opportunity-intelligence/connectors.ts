import { getOpportunitySourceAdapter } from '@/lib/opportunity-agents/sources/adapters'
import { sha256Text } from './hash'
import { neutralizeRemoteText, safeFetchText } from './network'
import { canUseSourceInProduction, getSourcePermission } from './sourcePermissionRegistry'
import type { ConnectorResult, LegislativeState, NewsSignal, OfficialSourceRecord, SamReuseResult, UsaSpendingReuseRecord } from './types'

function nowIso(): string {
  return new Date().toISOString()
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asObject) : []
}

function signalId(sourceId: string, title: string, url: string): string {
  return `${sourceId}_${sha256Text(`${title}|${url}`).slice(0, 16)}`
}

export async function fetchGdeltSignals(query: string, fetchImpl?: typeof fetch): Promise<ConnectorResult<NewsSignal>> {
  const permission = getSourcePermission('gdelt')
  const url = new URL('https://api.gdeltproject.org/api/v2/doc/doc')
  url.searchParams.set('query', query)
  url.searchParams.set('mode', 'artlist')
  url.searchParams.set('format', 'json')
  url.searchParams.set('maxrecords', '10')
  const response = await safeFetchText(url.toString(), { allowedHosts: ['api.gdeltproject.org'], fetchImpl })
  if (!response.ok) return { sourceId: 'gdelt', status: 'failed', records: [], failure: response.error ?? 'gdelt_failed', externalActionsExecuted: false }
  const data = asObject(JSON.parse(response.body || '{}'))
  return {
    sourceId: 'gdelt',
    status: 'success',
    failure: null,
    externalActionsExecuted: false,
    records: rows(data.articles).flatMap(article => {
      const title = text(article.title)
      const urlValue = text(article.url)
      if (!title || !urlValue) return []
      const snippet = neutralizeRemoteText(text(article.description) ?? title, 240)
      return [{
        signalId: signalId('gdelt', title, urlValue),
        sourceId: permission.sourceId,
        title,
        publisher: text(article.domain) ?? 'unknown',
        url: urlValue,
        publicationTimestamp: text(article.seendate),
        retrievalTimestamp: nowIso(),
        language: text(article.language),
        geographicContext: [text(article.sourcecountry)].filter((item): item is string => Boolean(item)),
        snippet,
        contentHash: sha256Text(`${title}|${urlValue}|${snippet}`),
        truthLabels: ['NEWS_SIGNAL_ONLY'],
        retainedFullText: false,
      }]
    }),
  }
}

export async function fetchFederalRegisterDocuments(query: string, fetchImpl?: typeof fetch): Promise<ConnectorResult<OfficialSourceRecord>> {
  const url = new URL('https://www.federalregister.gov/api/v1/documents.json')
  url.searchParams.set('conditions[term]', query)
  url.searchParams.set('per_page', '10')
  url.searchParams.set('order', 'newest')
  const response = await safeFetchText(url.toString(), { allowedHosts: ['www.federalregister.gov'], fetchImpl })
  if (!response.ok) return { sourceId: 'federal_register', status: 'failed', records: [], failure: response.error ?? 'federal_register_failed', externalActionsExecuted: false }
  const data = asObject(JSON.parse(response.body || '{}'))
  return {
    sourceId: 'federal_register',
    status: 'success',
    failure: null,
    externalActionsExecuted: false,
    records: rows(data.results).flatMap(item => {
      const title = text(item.title)
      const officialUrl = text(item.html_url) ?? text(item.pdf_url)
      if (!title || !officialUrl) return []
      const documentType = text(item.type)
      const legalStatus = documentType === 'Rule' ? 'effective' : documentType === 'Proposed Rule' ? 'proposed' : 'pending'
      const agencies = rows(item.agencies).map(agency => text(agency.name)).filter((agency): agency is string => Boolean(agency))
      return [{
        sourceId: 'federal_register',
        sourceName: 'Federal Register API',
        title,
        officialUrl,
        documentNumber: text(item.document_number),
        documentType,
        agency: agencies[0] ?? null,
        agencies,
        publicationDate: text(item.publication_date),
        enactedDate: null,
        effectiveDate: text(item.effective_on),
        expirationDate: null,
        commentDeadline: text(item.comments_close_on),
        jurisdiction: 'United States federal',
        citation: text(item.citation),
        precedentialStatus: null,
        caseStatus: null,
        legalStatus,
        truthLabels: legalStatus === 'proposed' ? ['PROPOSED_NOT_LAW'] : ['PRIMARY_SOURCE_CONFIRMED'],
        rawMetadata: item,
      }]
    }),
  }
}

export function classifyCongressLegislativeState(input: { latestAction?: string | null; laws?: unknown[] | null; status?: string | null }): LegislativeState {
  const haystack = `${input.status ?? ''} ${input.latestAction ?? ''}`.toLowerCase()
  if (Array.isArray(input.laws) && input.laws.length > 0) return 'SIGNED_INTO_LAW'
  if (haystack.includes('became public law') || haystack.includes('signed by president')) return 'SIGNED_INTO_LAW'
  if (haystack.includes('presented to president') || haystack.includes('enrolled')) return 'ENROLLED'
  if (haystack.includes('passed senate')) return 'PASSED_SENATE'
  if (haystack.includes('passed house')) return 'PASSED_HOUSE'
  if (haystack.includes('committee')) return 'IN_COMMITTEE'
  if (haystack.includes('veto')) return 'VETOED'
  if (haystack.includes('failed')) return 'FAILED'
  if (haystack.includes('introduced')) return 'INTRODUCED'
  return 'UNKNOWN'
}

export function congressGovBoundary(env: NodeJS.ProcessEnv = process.env): ConnectorResult<OfficialSourceRecord> {
  if (!env.CONGRESS_GOV_API_KEY?.trim()) return { sourceId: 'congress_gov', status: 'not_configured', records: [], failure: 'CONGRESS_GOV_API_KEY is required for read-only legislative metadata.', externalActionsExecuted: false }
  return { sourceId: 'congress_gov', status: 'boundary_only', records: [], failure: 'Read-only connector boundary prepared; live call requires explicit implementation review.', externalActionsExecuted: false }
}

export function regulationsGovBoundary(env: NodeJS.ProcessEnv = process.env): ConnectorResult<OfficialSourceRecord> {
  if (!env.REGULATIONS_GOV_API_KEY?.trim()) return { sourceId: 'regulations_gov', status: 'not_configured', records: [], failure: 'REGULATIONS_GOV_API_KEY is required for read-only docket metadata.', externalActionsExecuted: false }
  return { sourceId: 'regulations_gov', status: 'boundary_only', records: [], failure: 'Read-only connector boundary prepared; comment submission is not implemented.', externalActionsExecuted: false }
}

export function simplerGrantsBoundary(env: NodeJS.ProcessEnv = process.env): ConnectorResult<OfficialSourceRecord> {
  if (!env.SIMPLER_GRANTS_API_KEY?.trim()) return { sourceId: 'simpler_grants', status: 'not_configured', records: [], failure: 'SIMPLER_GRANTS_API_KEY is required before grant metadata reads.', externalActionsExecuted: false }
  return { sourceId: 'simpler_grants', status: 'boundary_only', records: [], failure: 'Read-only grant metadata boundary prepared; eligibility remains unconfirmed.', externalActionsExecuted: false }
}

export function guardianBoundary(env: NodeJS.ProcessEnv = process.env): ConnectorResult<NewsSignal> {
  return {
    sourceId: 'guardian',
    status: canUseSourceInProduction('guardian', env) ? 'success' : 'terms_review_required',
    records: [],
    failure: 'GUARDIAN_API_KEY presence does not prove commercial license; Production remains TERMS_REVIEW_REQUIRED.',
    externalActionsExecuted: false,
  }
}

export function newsApiBoundary(env: NodeJS.ProcessEnv = process.env): ConnectorResult<NewsSignal> {
  const configured = Boolean(env.NEWS_API_KEY?.trim())
  return {
    sourceId: 'newsapi',
    status: configured && env.NODE_ENV !== 'production' ? 'boundary_only' : 'not_configured',
    records: [],
    failure: configured ? 'NewsAPI developer/free access is Development-only and cannot become Production-connected.' : 'NEWS_API_KEY not configured.',
    externalActionsExecuted: false,
  }
}

export async function fetchCourtListenerOpinions(query: string, fetchImpl?: typeof fetch): Promise<ConnectorResult<OfficialSourceRecord>> {
  const url = new URL('https://www.courtlistener.com/api/rest/v3/search/')
  url.searchParams.set('q', query)
  url.searchParams.set('type', 'o')
  const response = await safeFetchText(url.toString(), { allowedHosts: ['www.courtlistener.com'], fetchImpl })
  if (!response.ok) return { sourceId: 'courtlistener', status: 'failed', records: [], failure: response.error ?? 'courtlistener_failed', externalActionsExecuted: false }
  const data = asObject(JSON.parse(response.body || '{}'))
  return {
    sourceId: 'courtlistener',
    status: 'success',
    failure: null,
    externalActionsExecuted: false,
    records: rows(data.results).flatMap(item => {
      const caseName = text(item.caseName) ?? text(item.caseNameFull)
      const absoluteUrl = text(item.absolute_url)
      if (!caseName || !absoluteUrl) return []
      return [{
        sourceId: 'courtlistener',
        sourceName: 'CourtListener',
        title: caseName,
        officialUrl: `https://www.courtlistener.com${absoluteUrl}`,
        documentNumber: text(item.docketNumber),
        documentType: 'court_opinion',
        agency: text(item.court),
        agencies: [text(item.court)].filter((agency): agency is string => Boolean(agency)),
        publicationDate: text(item.dateFiled),
        enactedDate: null,
        effectiveDate: null,
        expirationDate: null,
        commentDeadline: null,
        jurisdiction: text(item.court) ?? 'jurisdiction unknown',
        citation: text(item.citation) ?? text(item.cite) ?? text(item.neutralCite),
        precedentialStatus: text(item.precedentialStatus) ?? text(item.status),
        caseStatus: text(item.caseStatus),
        legalStatus: 'enacted',
        truthLabels: ['COURT_AUTHORITY_FOUND', 'JURISDICTION_LIMITED'],
        rawMetadata: item,
      }]
    }),
  }
}

export async function refreshSamGovThroughPhase49C(env: NodeJS.ProcessEnv = process.env): Promise<SamReuseResult> {
  return getOpportunitySourceAdapter('sam_gov', env).refresh({ limit: 25, maxPages: 3, maxRecords: 75 })
}

export async function refreshUsaSpendingThroughPhase49C(): Promise<ConnectorResult<UsaSpendingReuseRecord>> {
  const result = await getOpportunitySourceAdapter('usaspending').refresh({ limit: 10 })
  return {
    sourceId: 'usaspending',
    status: result.status === 'success' ? 'success' : 'failed',
    records: result.records,
    failure: result.failure,
    externalActionsExecuted: false,
  }
}
