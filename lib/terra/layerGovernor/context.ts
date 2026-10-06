import type { GovernorConfidence, GovernorContext, GovernorSnapshot, InferredContext } from './types'

export function inferGovernorContext(input: GovernorSnapshot): InferredContext {
  const evidence: string[] = []
  const push = (item: string) => { evidence.push(item) }

  if (input.timeMode === 'historical') {
    push('timeline is historical')
    return pack('HISTORICAL', input.flying || input.hasActiveLocation ? 'HIGH' : 'MEDIUM', evidence)
  }
  if (input.weatherSelected || (input.selectionLayerId === 'nws_severe_weather_alerts')) {
    push('severe weather event selected')
    if (input.radarHasFrame && input.radarCoverage) push('radar available')
    if (input.hasActiveLocation && input.radarCoverage) push('active location inside affected region')
    else if (input.hasActiveLocation) push('active location present')
    return pack('WEATHER', 'HIGH', evidence)
  }
  if (input.earthquakeSelected || input.selectionLayerId === 'usgs_earthquake_feed') {
    push('earthquake selected')
    return pack('HAZARD', 'HIGH', evidence)
  }
  if (input.weatherAlertCount > 0 && (input.scale === 'city' || input.scale === 'regional' || input.scale === 'local') && input.radarHasFrame) {
    push(`${input.weatherAlertCount} weather alerts`)
    push('radar frame present')
    return pack('WEATHER', 'MEDIUM', evidence)
  }
  if (input.mediaOpen) {
    push('War Room Media focused')
    return pack('MEDIA_CONTEXT', 'HIGH', evidence)
  }
  if (input.godsEyeMode === 'CAMERAS' || input.selectionKind === 'feature' && (input.selectionLayerId ?? '').includes('camera')) {
    push("God's Eye cameras")
    return pack('TRAFFIC', 'HIGH', evidence)
  }
  if (input.godsEyeMode === 'INTEL' || input.selectionLayerId === 'live_intel_overlay') {
    push('event intelligence surface')
    return pack('EVENT_INTELLIGENCE', 'HIGH', evidence)
  }
  if (input.scale === 'local' || input.scale === 'building') {
    push(`camera scale ${input.scale}`)
    if (input.hasActiveLocation) push('active location')
    return pack('STREET', 'HIGH', evidence)
  }
  if ((input.scale === 'city' || input.scale === 'regional') && input.hasActiveLocation) {
    push(`camera scale ${input.scale}`)
    push('active location')
    return pack('LOCAL_EXPLORATION', 'HIGH', evidence)
  }
  if (input.earthquakeCount > 0 && input.scale === 'global' && input.weatherAlertCount > 2) {
    push('global hazards present')
    return pack('HAZARD', 'MEDIUM', evidence)
  }
  push(`camera scale ${input.scale}`)
  if (input.orbiting) push('living orbit')
  return pack('PLANETARY', input.scale === 'global' ? 'HIGH' : 'MEDIUM', evidence)
}

function pack(context: GovernorContext, confidence: GovernorConfidence, evidence: string[]): InferredContext {
  return { context, confidence, evidence }
}
