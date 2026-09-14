export type OfflineRetentionRecord = {
  sourceMetadata: true
  url: string
  title: string
  publisher: string
  time: string | null
  language: string
  geography: string | null
  sourceOrigin: string | null
  contentHash: string
  claims: string[]
  entities: string[]
  storyCluster: string | null
  syndicationCluster: string | null
  verification: string
  provenance: string
  coverageHistory: string[]
  fullTextRetained: boolean
  fullTextLawfulBasis: string | null
}

export function retainOffline(input: {
  url: string
  title: string
  publisher: string
  time: string | null
  language: string
  geography: string | null
  sourceOrigin: string | null
  contentHash: string
  claims: string[]
  storyCluster: string | null
  syndicationCluster: string | null
  verification: string
  licensePermitsFullText: boolean
  termsPermitFullText: boolean
  publicDomain: boolean
  permissionExists: boolean
}): OfflineRetentionRecord {
  const lawful = input.licensePermitsFullText || input.termsPermitFullText || input.publicDomain || input.permissionExists
  return {
    sourceMetadata: true,
    url: input.url,
    title: input.title,
    publisher: input.publisher,
    time: input.time,
    language: input.language,
    geography: input.geography,
    sourceOrigin: input.sourceOrigin,
    contentHash: input.contentHash,
    claims: input.claims,
    entities: [],
    storyCluster: input.storyCluster,
    syndicationCluster: input.syndicationCluster,
    verification: input.verification,
    provenance: 'planetary-intelligence-p0',
    coverageHistory: [],
    fullTextRetained: lawful,
    fullTextLawfulBasis: lawful
      ? (input.publicDomain ? 'public_domain' : input.permissionExists ? 'permission' : input.licensePermitsFullText ? 'license' : 'terms')
      : null,
  }
}

export function offlineTruth(input: { connected: boolean; eventTime: string; lastKnownTime: string }): {
  canReasonOverKnown: boolean
  claimsEventsAfterDisconnect: boolean
} {
  const event = Date.parse(input.eventTime)
  const last = Date.parse(input.lastKnownTime)
  return {
    canReasonOverKnown: true,
    claimsEventsAfterDisconnect: input.connected ? false : event > last,
  }
}
