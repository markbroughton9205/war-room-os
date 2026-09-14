import { hostnameFromUrl } from '@/lib/intelligence/canonicalUrl'

export type SourceIdentity = {
  domain: string
  outlet: string
  publisher: string
  parentCompany: string | null
  documentUrl: string
  storyOriginId: string
  independentEvidenceOriginId: string
}

const PARENT_COMPANIES: Array<{ host: RegExp; parent: string; publisher: string; outlet?: string }> = [
  { host: /(^|\.)reuters\.com$/i, parent: 'Thomson Reuters', publisher: 'Reuters', outlet: 'Reuters' },
  { host: /(^|\.)apnews\.com$/i, parent: 'Associated Press', publisher: 'Associated Press', outlet: 'AP News' },
  { host: /(^|\.)bbc\./i, parent: 'BBC', publisher: 'BBC', outlet: 'BBC News' },
  { host: /(^|\.)nytimes\.com$/i, parent: 'The New York Times Company', publisher: 'The New York Times', outlet: 'The New York Times' },
  { host: /(^|\.)cnn\.com$/i, parent: 'Warner Bros. Discovery', publisher: 'CNN', outlet: 'CNN' },
  { host: /(^|\.)foxnews\.com$/i, parent: 'Fox Corporation', publisher: 'Fox News', outlet: 'Fox News' },
  { host: /(^|\.)npr\.org$/i, parent: 'NPR', publisher: 'NPR', outlet: 'NPR' },
  { host: /(^|\.)theguardian\.com$/i, parent: 'Guardian Media Group', publisher: 'The Guardian', outlet: 'The Guardian' },
]

const WIRE_ORIGINS: Array<{ pattern: RegExp; origin: string }> = [
  { pattern: /\breuters\b/i, origin: 'reuters_wire' },
  { pattern: /\b(associated press|\(ap\)|\bap\b)\b/i, origin: 'associated_press_wire' },
  { pattern: /\b(afp|agence france[- ]presse)\b/i, origin: 'afp_wire' },
  { pattern: /\bxinhua\b/i, origin: 'xinhua_wire' },
  { pattern: /\bkyodo\b/i, origin: 'kyodo_wire' },
]

/**
 * DOMAIN != OUTLET != PUBLISHER != PARENT COMPANY != DOCUMENT != STORY ORIGIN != INDEPENDENT EVIDENCE ORIGIN
 *
 * 40 local stations owned by one corporation = 40 outlets, 1 corporate group.
 * 12 local sites copying AP = 12 distribution nodes, 1 evidence origin.
 */
export function resolveSourceIdentity(input: {
  url: string
  outletName?: string
  publisher?: string
  parentCompany?: string | null
  title?: string
  text?: string
  byline?: string | null
  wireAttribution?: string | null
}): SourceIdentity {
  const domain = hostnameFromUrl(input.url) || 'unknown.local'
  const known = PARENT_COMPANIES.find(entry => entry.host.test(domain))
  const blob = `${input.title ?? ''} ${input.text ?? ''} ${input.byline ?? ''} ${input.wireAttribution ?? ''}`
  const wire = WIRE_ORIGINS.find(entry => entry.pattern.test(blob) || entry.pattern.test(input.wireAttribution ?? ''))
  const outlet = input.outletName || known?.outlet || domain
  const publisher = input.publisher || known?.publisher || outlet
  const parentCompany = input.parentCompany ?? known?.parent ?? null
  const storyOriginId = wire?.origin || `origin:${publisher.toLowerCase().replace(/\s+/g, '_')}`
  const independentEvidenceOriginId = wire?.origin || `independent:${(parentCompany || publisher).toLowerCase().replace(/\s+/g, '_')}`
  return {
    domain,
    outlet,
    publisher,
    parentCompany,
    documentUrl: input.url,
    storyOriginId,
    independentEvidenceOriginId,
  }
}

export function ownershipDiversity(identities: SourceIdentity[]): {
  outletCount: number
  publisherCount: number
  parentCompanyCount: number
  independentOriginCount: number
} {
  return {
    outletCount: new Set(identities.map(item => item.outlet)).size,
    publisherCount: new Set(identities.map(item => item.publisher)).size,
    parentCompanyCount: new Set(identities.map(item => item.parentCompany || item.publisher)).size,
    independentOriginCount: new Set(identities.map(item => item.independentEvidenceOriginId)).size,
  }
}
