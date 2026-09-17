import type { EndpointType } from './types'
import type { Wave1Candidate } from './registryTypes'
import { WAVE4_PRIORITY_CELLS, type Wave4PriorityCell } from './wave4Cells'

export type Wave4Candidate = Wave1Candidate & {
  gapKey: string
  knownEndpointUrl?: string | null
  knownEndpointType?: EndpointType | null
  existingIdentity?: boolean
}

function candidate(input: Omit<Wave4Candidate, 'supportedLanguages' | 'discoveryMethod' | 'requestedDiscoveryLanguage' | 'actualQueryLanguage' | 'ownershipType' | 'continent'> & Partial<Wave4Candidate>): Wave4Candidate {
  return {
    continent: input.continent ?? (input.region.includes('AFRICA') ? 'Africa' : input.region.includes('ASIA') || input.region === 'MIDDLE_EAST' ? 'Asia' : input.region === 'EUROPE' ? 'Europe' : input.region === 'OCEANIA' ? 'Oceania' : 'Americas'),
    localityClass: input.localityClass ?? 'NATIONAL',
    sourceRole: input.sourceRole,
    supportedLanguages: input.supportedLanguages ?? [input.primaryLanguage],
    ownershipType: input.ownershipType ?? (input.sourceType === 'OFFICIAL_RECORD' || input.sourceType === 'ALERT_FEED' || input.sourceType === 'PRIMARY_PUBLIC_SIGNAL' ? 'GOVERNMENT' : 'INDEPENDENT'),
    discoveryMethod: input.discoveryMethod ?? 'wave4_precision_closure',
    requestedDiscoveryLanguage: input.primaryLanguage,
    actualQueryLanguage: input.primaryLanguage,
    existingIdentity: input.existingIdentity ?? false,
    knownEndpointUrl: input.knownEndpointUrl ?? input.endpointUrl ?? null,
    knownEndpointType: input.knownEndpointType ?? input.endpointType ?? null,
    ...input,
  }
}

export function wave4Catalog(): Wave4Candidate[] {
  const cells = Object.fromEntries(WAVE4_PRIORITY_CELLS.map(cell => [cell.gapKey, cell])) as Record<string, Wave4PriorityCell>
  return [
    candidate({ gapKey: 'ja-infra', canonicalName: 'NEXCO East', homepage: 'https://www.e-nexco.co.jp', country: 'Japan', region: 'EAST_ASIA', primaryLanguage: 'ja', sourceType: 'OFFICIAL_RECORD', sourceRole: 'OFFICIAL', publisher: 'NEXCO East', parentCompany: 'NEXCO East', endpointUrl: 'https://www.e-nexco.co.jp/bids/public_notice/const_kanto/const_kanto.xml', endpointType: 'RSS', gapPriority: 'ja-infra', topics: ['INFRASTRUCTURE'] }),

    candidate({ gapKey: 'id-infra', canonicalName: 'Antara', homepage: 'https://www.antaranews.com', country: 'Indonesia', region: 'SOUTHEAST_ASIA', primaryLanguage: 'id', sourceType: 'JOURNALISM', sourceRole: 'NATIONAL', publisher: 'LKBN Antara', parentCompany: 'LKBN Antara', endpointUrl: 'https://www.antaranews.com/rss/terkini', endpointType: 'RSS', existingIdentity: true, gapPriority: 'id-infra', topics: ['INFRASTRUCTURE'] }),
    candidate({ gapKey: 'id-infra', canonicalName: 'Tempo', homepage: 'https://www.tempo.co', country: 'Indonesia', region: 'SOUTHEAST_ASIA', primaryLanguage: 'id', sourceType: 'JOURNALISM', sourceRole: 'NATIONAL', publisher: 'Tempo Inti Media', parentCompany: 'Tempo Inti Media', endpointUrl: 'https://rss.tempo.co/', endpointType: 'RSS', existingIdentity: true, gapPriority: 'id-infra', topics: ['INFRASTRUCTURE'] }),
    candidate({ gapKey: 'id-infra', canonicalName: 'CNBC Indonesia', homepage: 'https://www.cnbcindonesia.com', country: 'Indonesia', region: 'SOUTHEAST_ASIA', primaryLanguage: 'id', sourceType: 'JOURNALISM', sourceRole: 'NATIONAL', publisher: 'CNBC Indonesia', parentCompany: 'Trans Media', endpointUrl: 'https://www.cnbcindonesia.com/news/rss', endpointType: 'RSS', gapPriority: 'id-infra', topics: ['INFRASTRUCTURE'] }),

    candidate({ gapKey: 'oceania-weather', canonicalName: 'MetService', homepage: 'https://www.metservice.com', country: 'New Zealand', region: 'OCEANIA', primaryLanguage: 'en', sourceType: 'ALERT_FEED', sourceRole: 'WEATHER', publisher: 'MetService', parentCompany: 'MetService', endpointUrl: 'https://alerts.metservice.com/cap/rss', endpointType: 'PUBLIC_ALERT_FEED', existingIdentity: true, gapPriority: 'oceania-weather', topics: ['WEATHER'] }),

    candidate({ gapKey: 'de-energy', canonicalName: 'Solarserver', homepage: 'https://www.solarserver.de', country: 'Germany', region: 'EUROPE', primaryLanguage: 'de', sourceType: 'TRADE_SOURCE', sourceRole: 'TRADE', publisher: 'Solarserver', parentCompany: 'Solarthemen Media', endpointUrl: 'https://www.solarserver.de/feed/', endpointType: 'RSS', gapPriority: 'de-energy', topics: ['ENERGY'] }),

    candidate({ gapKey: 'es-science', canonicalName: 'SciELO en Español', homepage: 'https://blog.scielo.org/es/', country: 'Brazil', region: 'LATIN_AMERICA', primaryLanguage: 'es', sourceType: 'SCIENTIFIC_SOURCE', sourceRole: 'SCIENTIFIC', publisher: 'SciELO', parentCompany: 'SciELO', endpointUrl: 'https://blog.scielo.org/es/feed/', endpointType: 'RSS', existingIdentity: true, gapPriority: 'es-science', topics: ['SCIENCE'] }),
    candidate({ gapKey: 'es-science', canonicalName: 'Agencia CyTA', homepage: 'https://www.agenciacyta.org.ar', country: 'Argentina', region: 'LATIN_AMERICA', primaryLanguage: 'es', sourceType: 'SCIENTIFIC_SOURCE', sourceRole: 'SCIENTIFIC', publisher: 'Agencia CyTA', parentCompany: 'Agencia CyTA', endpointUrl: 'https://www.agenciacyta.org.ar/feed/', endpointType: 'RSS', existingIdentity: true, gapPriority: 'es-science', topics: ['SCIENCE'] }),

    candidate({ gapKey: 'sw-health', canonicalName: 'Kenya Red Cross', homepage: 'https://www.redcross.or.ke', country: 'Kenya', region: 'EAST_AFRICA', primaryLanguage: 'sw', sourceType: 'COMMUNITY_SOURCE', sourceRole: 'HEALTH', publisher: 'Kenya Red Cross', parentCompany: 'Kenya Red Cross', supportedLanguages: ['sw', 'en'], endpointUrl: 'https://www.redcross.or.ke/feed', endpointType: 'RSS', gapPriority: 'sw-health', topics: ['HEALTH'] }),
    candidate({ gapKey: 'sw-health', canonicalName: 'CCBRT', homepage: 'https://www.ccbrt.or.tz', country: 'Tanzania', region: 'EAST_AFRICA', primaryLanguage: 'sw', sourceType: 'COMMUNITY_SOURCE', sourceRole: 'HEALTH', publisher: 'CCBRT', parentCompany: 'CCBRT', supportedLanguages: ['sw', 'en'], gapPriority: 'sw-health', topics: ['HEALTH'] }),
    candidate({ gapKey: 'sw-health', canonicalName: 'MDH Tanzania', homepage: 'https://www.mdh.or.tz', country: 'Tanzania', region: 'EAST_AFRICA', primaryLanguage: 'sw', sourceType: 'COMMUNITY_SOURCE', sourceRole: 'HEALTH', publisher: 'Management and Development for Health', parentCompany: 'Management and Development for Health', supportedLanguages: ['sw', 'en'], gapPriority: 'sw-health', topics: ['HEALTH'] }),
    candidate({ gapKey: 'sw-health', canonicalName: 'Sikika', homepage: 'https://sikika.or.tz', country: 'Tanzania', region: 'EAST_AFRICA', primaryLanguage: 'sw', sourceType: 'COMMUNITY_SOURCE', sourceRole: 'NGO', publisher: 'Sikika', parentCompany: 'Sikika', supportedLanguages: ['sw', 'en'], gapPriority: 'sw-health', topics: ['HEALTH'] }),
    candidate({ gapKey: 'sw-health', canonicalName: 'LVCT Health', homepage: 'https://www.lvcthealth.org', country: 'Kenya', region: 'EAST_AFRICA', primaryLanguage: 'sw', sourceType: 'COMMUNITY_SOURCE', sourceRole: 'HEALTH', publisher: 'LVCT Health', parentCompany: 'LVCT Health', supportedLanguages: ['sw', 'en'], gapPriority: 'sw-health', topics: ['HEALTH'] }),

    candidate({ gapKey: 'ar-safety', canonicalName: 'Saudi Civil Defence', homepage: 'https://998.gov.sa', country: 'Saudi Arabia', region: 'MIDDLE_EAST', primaryLanguage: 'ar', sourceType: 'PRIMARY_PUBLIC_SIGNAL', sourceRole: 'PUBLIC_SAFETY', publisher: 'General Directorate of Civil Defence', parentCompany: 'Saudi Civil Defence', gapPriority: 'ar-safety', topics: ['PUBLIC_SAFETY'] }),
    candidate({ gapKey: 'ar-safety', canonicalName: 'NCM Saudi', homepage: 'https://www.ncm.gov.sa', country: 'Saudi Arabia', region: 'MIDDLE_EAST', primaryLanguage: 'ar', sourceType: 'PRIMARY_PUBLIC_SIGNAL', sourceRole: 'PUBLIC_SAFETY', publisher: 'National Center for Meteorology', parentCompany: 'NCM Saudi', gapPriority: 'ar-safety', topics: ['PUBLIC_SAFETY'] }),
    candidate({ gapKey: 'ar-safety', canonicalName: 'NCEMA', homepage: 'https://www.ncema.gov.ae', country: 'United Arab Emirates', region: 'MIDDLE_EAST', primaryLanguage: 'ar', sourceType: 'PRIMARY_PUBLIC_SIGNAL', sourceRole: 'PUBLIC_SAFETY', publisher: 'NCEMA', parentCompany: 'NCEMA', gapPriority: 'ar-safety', topics: ['PUBLIC_SAFETY'] }),
    candidate({ gapKey: 'ar-safety', canonicalName: 'Jordan Civil Defence', homepage: 'https://www.cdd.gov.jo', country: 'Jordan', region: 'MIDDLE_EAST', primaryLanguage: 'ar', sourceType: 'PRIMARY_PUBLIC_SIGNAL', sourceRole: 'PUBLIC_SAFETY', publisher: 'Jordan Civil Defence', parentCompany: 'Jordan Civil Defence', gapPriority: 'ar-safety', topics: ['PUBLIC_SAFETY'] }),
    candidate({ gapKey: 'ar-safety', canonicalName: 'Kuwait Meteorology', homepage: 'https://www.met.gov.kw', country: 'Kuwait', region: 'MIDDLE_EAST', primaryLanguage: 'ar', sourceType: 'PRIMARY_PUBLIC_SIGNAL', sourceRole: 'PUBLIC_SAFETY', publisher: 'Kuwait Meteorology', parentCompany: 'Kuwait Meteorology', gapPriority: 'ar-safety', topics: ['PUBLIC_SAFETY'] }),
  ].map(row => ({ ...row, gapPriority: row.gapPriority ?? cells[row.gapKey]?.gapKey ?? row.gapKey }))
}

export function wave4CatalogForCell(gapKey: string): Wave4Candidate[] {
  return wave4Catalog().filter(item => item.gapKey === gapKey)
}
