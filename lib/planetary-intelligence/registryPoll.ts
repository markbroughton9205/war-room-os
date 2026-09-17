import type { RegistrySource } from './registryTypes'

export function recommendedPollInterval(source: Pick<RegistrySource, 'freshnessClass' | 'sourceType' | 'localityClass' | 'sourceRole'>): number {
  if (source.freshnessClass === 'BREAKING_EMERGENCY' || source.sourceRole === 'PUBLIC_SAFETY' || source.sourceRole === 'WEATHER' || source.sourceType === 'ALERT_FEED') {
    return 180
  }
  if (source.sourceType === 'SCIENTIFIC_SOURCE' || source.sourceType === 'ACADEMIC_SOURCE' || source.sourceRole === 'SCIENTIFIC' || source.sourceRole === 'EDUCATION') {
    return 86_400
  }
  if (source.localityClass === 'HYPERLOCAL' || source.localityClass === 'CITY_LOCAL' || source.freshnessClass === 'COMMUNITY_HYPERLOCAL') {
    return 3_600
  }
  if (source.freshnessClass === 'DORMANT') return 604_800
  return 900
}

export function pollingIsNotUniform(intervals: number[]): boolean {
  return new Set(intervals).size >= 3
}
