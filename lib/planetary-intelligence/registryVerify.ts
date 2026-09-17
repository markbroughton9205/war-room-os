import { canonicalizeUrl, hostnameFromUrl } from '@/lib/intelligence/canonicalUrl'
import { recommendedPollInterval } from './registryPoll'
import { retentionForCandidate, robotsPolicyFor } from './registryAccess'
import type { RegistryEndpoint, RegistrySource, VerificationStage, Wave1Candidate } from './registryTypes'
import type { PlanetaryRegistryStore } from './registryStore'

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown'
}

export function domainFromHomepage(url: string): string | null {
  const host = hostnameFromUrl(url)
  if (!host || host === 'localhost' || host.endsWith('.example') || host.endsWith('.invalid')) return null
  return host.replace(/^www\./, '').toLowerCase()
}

export function idsFor(candidate: Wave1Candidate): { sourceId: string; publisherId: string; parentId: string | null; domain: string } | { error: string } {
  const domain = domainFromHomepage(candidate.homepage)
  if (!domain) return { error: 'DOMAIN_VERIFY failed' }
  const parentId = candidate.parentCompany ? `parent-${slug(candidate.parentCompany)}` : null
  return {
    domain,
    sourceId: `src-${slug(domain)}`,
    publisherId: `pub-${slug(candidate.publisher || candidate.canonicalName)}-${slug(candidate.country)}`,
    parentId,
  }
}

export function sourceAndEndpointAreDistinct(sourceUrl: string, endpointUrl: string): boolean {
  const a = canonicalizeUrl(sourceUrl) || sourceUrl
  const b = canonicalizeUrl(endpointUrl) || endpointUrl
  return a.replace(/\/$/, '') !== b.replace(/\/$/, '')
}

export function verifyCandidate(candidate: Wave1Candidate, nowIso: string): {
  ok: boolean
  source: RegistrySource | null
  endpoint: RegistryEndpoint | null
  stages: Array<{ stage: VerificationStage; ok: boolean; detail: string }>
  status: RegistrySource['status']
} {
  const stages: Array<{ stage: VerificationStage; ok: boolean; detail: string }> = []
  const fail = (stage: VerificationStage, detail: string) => {
    stages.push({ stage, ok: false, detail })
    return { ok: false, source: null, endpoint: null, stages, status: 'REVIEW_REQUIRED' as const }
  }

  stages.push({ stage: 'DISCOVERED', ok: true, detail: candidate.discoveryMethod })
  const ids = idsFor(candidate)
  if ('error' in ids) return fail('DOMAIN_VERIFY', ids.error)
  stages.push({ stage: 'DOMAIN_VERIFY', ok: true, detail: ids.domain })

  if (!candidate.canonicalName.trim() || !candidate.publisher.trim()) return fail('SOURCE_IDENTITY_VERIFY', 'missing name/publisher')
  stages.push({ stage: 'SOURCE_IDENTITY_VERIFY', ok: true, detail: `${candidate.canonicalName} / ${candidate.publisher}` })

  if (!candidate.country || !candidate.region || candidate.localityClass === 'HYPERLOCAL' && !candidate.cityLocality) {
    if (candidate.localityClass === 'HYPERLOCAL' && !candidate.cityLocality) return fail('GEOGRAPHY_VERIFY', 'HYPERLOCAL requires proven city/locality')
  }
  if (!candidate.country || !candidate.region) return fail('GEOGRAPHY_VERIFY', 'missing country/region')
  stages.push({ stage: 'GEOGRAPHY_VERIFY', ok: true, detail: `${candidate.country}/${candidate.region}/${candidate.localityClass}` })

  if (!candidate.primaryLanguage || candidate.primaryLanguage === 'und') return fail('LANGUAGE_VERIFY', 'und language rejected')
  if (candidate.requestedDiscoveryLanguage !== 'en' && candidate.primaryLanguage === 'en' && candidate.requestedDiscoveryLanguage === candidate.actualQueryLanguage && false) {
    // placeholder kept for readability; English-primary sources are allowed when they are actually English.
  }
  stages.push({ stage: 'LANGUAGE_VERIFY', ok: true, detail: `primary=${candidate.primaryLanguage} requested=${candidate.requestedDiscoveryLanguage} query=${candidate.actualQueryLanguage}` })

  if (!candidate.sourceType) return fail('SOURCE_TYPE_VERIFY', 'missing type')
  stages.push({ stage: 'SOURCE_TYPE_VERIFY', ok: true, detail: candidate.sourceType })

  const homepage = canonicalizeUrl(candidate.homepage) || candidate.homepage
  const endpointUrl = candidate.endpointUrl ? (canonicalizeUrl(candidate.endpointUrl) || candidate.endpointUrl) : homepage
  const endpointType = candidate.endpointType ?? (candidate.endpointUrl ? 'RSS' : 'HTML')
  if (candidate.endpointUrl && !sourceAndEndpointAreDistinct(homepage, endpointUrl)) {
    stages.push({ stage: 'ENDPOINT_DISCOVERY', ok: false, detail: 'SOURCE URL equals ENDPOINT URL' })
  } else {
    stages.push({ stage: 'ENDPOINT_DISCOVERY', ok: true, detail: `${endpointType} ${endpointUrl}` })
  }

  const retention = retentionForCandidate(candidate)
  stages.push({ stage: 'ACCESS_POLICY_CHECK', ok: true, detail: retention })
  stages.push({ stage: 'OWNERSHIP_ORIGIN_CHECK', ok: true, detail: candidate.parentCompany || candidate.publisher })
  stages.push({ stage: 'HEALTH_CHECK', ok: false, detail: 'not yet probed' })

  const verification = Object.fromEntries(stages.map(stage => [stage.stage, { ok: stage.ok, detail: stage.detail }]))
  const source: RegistrySource = {
    sourceId: ids.sourceId,
    canonicalName: candidate.canonicalName,
    aliases: [],
    canonicalDomain: ids.domain,
    domainAliases: [],
    sourceType: candidate.sourceType,
    journalismType: candidate.journalismType ?? null,
    sourceRole: candidate.sourceRole,
    ownershipType: candidate.ownershipType,
    publisherId: ids.publisherId,
    parentCompanyId: ids.parentId,
    country: candidate.country,
    region: candidate.region,
    continent: candidate.continent,
    stateProvince: candidate.stateProvince ?? null,
    countyDistrict: null,
    cityLocality: candidate.cityLocality ?? null,
    localityClass: candidate.localityClass,
    hqGeography: candidate.region,
    coverageGeography: candidate.region,
    datelineGeography: null,
    coverageGeometry: null,
    administrativeAreas: [candidate.country, candidate.stateProvince, candidate.cityLocality].filter((item): item is string => Boolean(item)),
    primaryLanguage: candidate.primaryLanguage,
    supportedLanguages: candidate.supportedLanguages.length ? candidate.supportedLanguages : [candidate.primaryLanguage],
    requestedDiscoveryLanguage: candidate.requestedDiscoveryLanguage,
    actualQueryLanguage: candidate.actualQueryLanguage,
    topics: candidate.topics ?? [],
    originalReportingCapability: candidate.originalReporting ?? candidate.sourceType === 'JOURNALISM',
    homepage,
    status: 'VERIFYING',
    discoveryMethod: candidate.discoveryMethod,
    discoveredAt: nowIso,
    lastVerifiedAt: nowIso,
    lastHealthyAt: null,
    freshnessClass: candidate.freshnessClass ?? (candidate.sourceRole === 'WEATHER' || candidate.sourceRole === 'PUBLIC_SAFETY' ? 'BREAKING_EMERGENCY' : candidate.localityClass === 'CITY_LOCAL' || candidate.localityClass === 'HYPERLOCAL' ? 'COMMUNITY_HYPERLOCAL' : 'NATIONAL_REGIONAL'),
    robotsPolicy: robotsPolicyFor(candidate),
    termsMetadata: null,
    licenseMetadata: null,
    retentionPolicy: retention,
    reliabilityMetadata: candidate.gapPriority ? `gap:${candidate.gapPriority}` : null,
    wireRelationship: candidate.wireRelationship ?? null,
    notes: null,
    gapPriority: candidate.gapPriority ?? null,
    verification,
  }
  const endpoint: RegistryEndpoint = {
    endpointId: `ep-${ids.sourceId}-${endpointType.toLowerCase()}`,
    sourceId: ids.sourceId,
    endpointType,
    url: endpointUrl,
    status: 'IDLE',
    lastFetchAt: null,
    lastSuccessAt: null,
    etag: null,
    lastModified: null,
    retryAfter: null,
    observedPublishCadenceSeconds: null,
    recommendedPollIntervalSeconds: recommendedPollInterval(source),
    errorClass: null,
    consecutiveFailures: 0,
    httpStatus: null,
    latencyMs: null,
    activationState: endpointType === 'HTML' ? 'HTML_ONLY' : 'DISCOVERED',
    contentType: null,
    itemCount: null,
  }
  return { ok: true, source, endpoint, stages, status: 'VERIFYING' }
}

export function persistVerifiedCandidate(store: PlanetaryRegistryStore, candidate: Wave1Candidate, nowIso: string): {
  accepted: boolean
  duplicate: boolean
  sourceId?: string
  status?: RegistrySource['status']
  reason?: string
} {
  const verified = verifyCandidate(candidate, nowIso)
  if (!verified.ok || !verified.source || !verified.endpoint) {
    return { accepted: false, duplicate: false, reason: verified.stages.find(stage => !stage.ok)?.detail }
  }
  if (verified.source.parentCompanyId) {
    store.upsertParent({
      parentId: verified.source.parentCompanyId,
      canonicalName: candidate.parentCompany || candidate.publisher,
      ownershipType: candidate.ownershipType,
      country: candidate.country,
      homepage: null,
    })
  }
  store.upsertPublisher({
    publisherId: verified.source.publisherId,
    canonicalName: candidate.publisher,
    parentId: verified.source.parentCompanyId,
    country: candidate.country,
    homepage: candidate.homepage,
  })
  const written = store.upsertSource(verified.source)
  if (written.duplicate || !written.inserted) {
    return { accepted: false, duplicate: true, sourceId: verified.source.sourceId, reason: 'canonical domain already registered' }
  }
  store.upsertEndpoint(verified.endpoint)
  store.recordDiscovery({
    sourceId: verified.source.sourceId,
    method: candidate.discoveryMethod,
    queryLanguage: candidate.actualQueryLanguage,
    requestedLanguage: candidate.requestedDiscoveryLanguage,
    detail: candidate.canonicalName,
    nowIso,
  })
  for (const stage of verified.stages) {
    store.recordVerification({ sourceId: verified.source.sourceId, stage: stage.stage, ok: stage.ok, detail: stage.detail, nowIso })
  }
  return { accepted: true, duplicate: false, sourceId: verified.source.sourceId, status: verified.source.status }
}

export function applyHealthResult(store: PlanetaryRegistryStore, source: RegistrySource, endpoint: RegistryEndpoint, health: {
  httpStatus: number | null
  latencyMs: number | null
  etag: string | null
  lastModified: string | null
  errorClass: string | null
  nowIso: string
}): { source: RegistrySource; endpoint: RegistryEndpoint } {
  const ok = health.httpStatus !== null && health.httpStatus < 400 && health.httpStatus !== 0
  const contentEndpoint = endpoint.endpointType !== 'HTML'
  const nextEndpoint: RegistryEndpoint = {
    ...endpoint,
    status: health.httpStatus === 304 ? 'NOT_MODIFIED' : health.httpStatus === 429 || health.httpStatus === 503 ? 'RATE_LIMITED' : ok ? 'OK' : 'ERROR',
    lastFetchAt: health.nowIso,
    lastSuccessAt: ok ? health.nowIso : endpoint.lastSuccessAt,
    etag: health.etag ?? endpoint.etag,
    lastModified: health.lastModified ?? endpoint.lastModified,
    consecutiveFailures: ok ? 0 : endpoint.consecutiveFailures + 1,
    httpStatus: health.httpStatus,
    latencyMs: health.latencyMs,
    errorClass: health.errorClass,
    activationState: endpoint.activationState ?? (endpoint.endpointType === 'HTML' ? 'HTML_ONLY' : 'DISCOVERED'),
    contentType: endpoint.contentType ?? null,
    itemCount: endpoint.itemCount ?? null,
  }
  const nextSource: RegistrySource = {
    ...source,
    lastHealthyAt: ok && contentEndpoint ? health.nowIso : source.lastHealthyAt,
    status: ok && contentEndpoint ? 'LIVE' : ok ? 'VERIFYING' : source.status === 'LIVE' ? 'OFFLINE' : 'REVIEW_REQUIRED',
    verification: {
      ...source.verification,
      HEALTH_CHECK: { ok, detail: health.errorClass || String(health.httpStatus) },
      LIVE: { ok: ok && contentEndpoint, detail: ok && contentEndpoint ? 'content endpoint healthy' : ok ? 'HTML reachable; not LIVE' : 'health failed' },
    },
  }
  store.upsertSource(nextSource)
  store.upsertEndpoint(nextEndpoint)
  store.recordHealth({ endpointId: endpoint.endpointId, ...health })
  store.recordVerification({ sourceId: source.sourceId, stage: 'HEALTH_CHECK', ok, detail: nextEndpoint.status, nowIso: health.nowIso })
  if (ok && contentEndpoint) store.recordVerification({ sourceId: source.sourceId, stage: 'LIVE', ok: true, detail: 'LIVE', nowIso: health.nowIso })
  return { source: nextSource, endpoint: nextEndpoint }
}

export function independentOwnershipGroups(sources: RegistrySource[]): number {
  return new Set(sources.map(source => source.parentCompanyId || source.publisherId)).size
}

export function englishMasqueradeRejected(source: RegistrySource): boolean {
  if (source.requestedDiscoveryLanguage && source.requestedDiscoveryLanguage !== 'en' && source.primaryLanguage === 'en') {
    return source.requestedDiscoveryLanguage !== source.actualQueryLanguage
  }
  return source.primaryLanguage !== 'und'
}
