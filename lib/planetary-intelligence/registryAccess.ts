import { hostnameFromUrl } from '@/lib/intelligence/canonicalUrl'
import { retainOffline } from './offline'
import type { Wave1Candidate } from './registryTypes'

const LAWFUL_FULL_TEXT_HOSTS = [
  'federalregister.gov',
  'api.weather.gov',
  'weather.gov',
  'arxiv.org',
  'legislation.gov.uk',
]

function hostAllowsFullText(url: string): boolean {
  const host = (hostnameFromUrl(url) || '').replace(/^www\./, '').toLowerCase()
  return LAWFUL_FULL_TEXT_HOSTS.some(allowed => host === allowed || host.endsWith(`.${allowed}`))
}

export function retentionForCandidate(candidate: Wave1Candidate): 'METADATA_ONLY' | 'FULL_TEXT_LAWFUL' | 'HASH_ONLY' {
  if (candidate.retentionPolicy) return candidate.retentionPolicy
  if (hostAllowsFullText(candidate.homepage) || (candidate.endpointUrl && hostAllowsFullText(candidate.endpointUrl))) {
    return 'FULL_TEXT_LAWFUL'
  }
  return 'METADATA_ONLY'
}

export function robotsPolicyFor(candidate: Wave1Candidate): 'UNKNOWN' | 'ALLOWED' | 'DISALLOWED' {
  if (candidate.sourceRole === 'OFFICIAL' || candidate.sourceType === 'GOVERNMENT' || candidate.sourceType === 'OFFICIAL_RECORD') return 'ALLOWED'
  return 'UNKNOWN'
}

export function metadataOnlyIsDefaultForNews(candidate: Wave1Candidate): boolean {
  return candidate.sourceType === 'JOURNALISM' && retentionForCandidate(candidate) === 'METADATA_ONLY'
}

export function fullTextOverRetentionRejected(): boolean {
  const retained = retainOffline({
    url: 'https://www.example-news.test/story',
    title: 'Story',
    publisher: 'Example News',
    time: '2026-09-13T00:00:00.000Z',
    language: 'en',
    geography: 'EUROPE',
    sourceOrigin: 'independent:example',
    contentHash: 'abc',
    claims: ['event occurred'],
    storyCluster: 's1',
    syndicationCluster: null,
    verification: 'UNVERIFIED',
    licensePermitsFullText: false,
    termsPermitFullText: false,
    publicDomain: false,
    permissionExists: false,
  })
  return retained.fullTextRetained === false && retained.sourceMetadata === true
}
