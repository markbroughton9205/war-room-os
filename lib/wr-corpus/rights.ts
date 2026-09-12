/**
 * Map historical rights metadata into explicit current classifications.
 * Old allowedForTraining:true is NOT the modern eligibility field.
 */
export type TrainingEligibility =
  | 'NOT_ELIGIBLE'
  | 'REQUIRES_REVIEW'
  | 'HISTORICAL_DECLARED_ELIGIBLE_NOT_CURRENT'
  | 'ELIGIBLE'

export type RightsRecord = {
  rights_source: string
  license: string | null
  public_domain: boolean
  commander_owned: boolean
  commercial_use: 'UNKNOWN' | 'PERMITTED' | 'FORBIDDEN'
  redistribution: 'UNKNOWN' | 'PERMITTED' | 'FORBIDDEN' | 'ATTRIBUTION_REQUIRED'
  training_use: 'UNKNOWN' | 'PERMITTED' | 'FORBIDDEN' | 'HISTORICAL_DECLARED'
  training_eligibility: TrainingEligibility
  review_state: 'MAPPED' | 'REQUIRES_REVIEW'
}

export function mapHistoricalRights(input: {
  licenseId?: string | null
  licenseName?: string | null
  permitsTrainingUse?: boolean | null
  accessStatus?: string | null
  notes?: string | null
  unknown?: boolean
}): RightsRecord {
  if (input.unknown) {
    return {
      rights_source: 'unknown',
      license: null,
      public_domain: false,
      commander_owned: false,
      commercial_use: 'UNKNOWN',
      redistribution: 'UNKNOWN',
      training_use: 'UNKNOWN',
      training_eligibility: 'REQUIRES_REVIEW',
      review_state: 'REQUIRES_REVIEW',
    }
  }

  const licenseName = (input.licenseName ?? input.licenseId ?? '').trim()
  const publicDomain =
    (input.licenseId ?? '').toUpperCase() === 'PUBLIC_DOMAIN' ||
    /public domain/i.test(licenseName) ||
    input.accessStatus === 'public_domain'
  const commanderOwned =
    input.accessStatus === 'commander_owned' || /commander-owned/i.test(licenseName)

  if (publicDomain) {
    return {
      rights_source: 'historical_wrm001_document',
      license: input.licenseId ?? 'PUBLIC_DOMAIN',
      public_domain: true,
      commander_owned: false,
      commercial_use: 'PERMITTED',
      redistribution: 'ATTRIBUTION_REQUIRED',
      training_use: input.permitsTrainingUse ? 'HISTORICAL_DECLARED' : 'UNKNOWN',
      training_eligibility: 'HISTORICAL_DECLARED_ELIGIBLE_NOT_CURRENT',
      review_state: 'MAPPED',
    }
  }

  if (commanderOwned) {
    return {
      rights_source: 'historical_wrm001_document',
      license: 'commander_owned_private',
      public_domain: false,
      commander_owned: true,
      commercial_use: 'FORBIDDEN',
      redistribution: 'FORBIDDEN',
      training_use: input.permitsTrainingUse ? 'HISTORICAL_DECLARED' : 'UNKNOWN',
      training_eligibility: 'HISTORICAL_DECLARED_ELIGIBLE_NOT_CURRENT',
      review_state: 'MAPPED',
    }
  }

  return {
    rights_source: 'historical_unmapped',
    license: licenseName || null,
    public_domain: false,
    commander_owned: false,
    commercial_use: 'UNKNOWN',
    redistribution: 'UNKNOWN',
    training_use: 'UNKNOWN',
    training_eligibility: 'REQUIRES_REVIEW',
    review_state: 'REQUIRES_REVIEW',
  }
}

export function rightsForHardenedChunk(sourcePath: string): RightsRecord {
  const literary = /alice|frankenstein|pride|gutenberg|wonderland|prejudice/i.test(sourcePath)
  const commanderRepo = !literary
  if (literary) {
    return mapHistoricalRights({
      licenseId: 'PUBLIC_DOMAIN',
      licenseName: 'Public Domain',
      permitsTrainingUse: true,
      accessStatus: 'public_domain',
    })
  }
  if (commanderRepo) {
    return mapHistoricalRights({
      licenseName: 'Commander-owned, private',
      permitsTrainingUse: true,
      accessStatus: 'commander_owned',
    })
  }
  return mapHistoricalRights({ unknown: true })
}

export function rightsForLiveCandidate(input: { license?: string | null; provenance?: Record<string, unknown> }): RightsRecord {
  const license = (input.license ?? '').trim()
  if (!license) {
    return mapHistoricalRights({ unknown: true })
  }
  if (/public domain|cc0|gutenberg/i.test(license)) {
    return mapHistoricalRights({
      licenseId: 'PUBLIC_DOMAIN',
      licenseName: license,
      permitsTrainingUse: false,
      accessStatus: 'public_domain',
    })
  }
  return mapHistoricalRights({ unknown: true })
}
