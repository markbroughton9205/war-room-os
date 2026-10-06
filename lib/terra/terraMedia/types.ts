import type { TerraLiveIntelMediaAccessClass, TerraLiveIntelMediaPreview } from '@/lib/terra/liveIntelMedia'
import type { TerraMediaAssetState, TerraMediaLiveEvidence } from './broadcastState'

export const TERRA_MEDIA_EVENT_FAMILIES = [
  'NWS',
  'GDACS',
  'EONET',
  'USGS',
  'FIRMS',
  'CAMERA',
  'LIVE_INTEL',
] as const
export type TerraMediaEventFamily = (typeof TERRA_MEDIA_EVENT_FAMILIES)[number]

export const TERRA_MEDIA_AVAILABILITY = ['AVAILABLE', 'UNAVAILABLE', 'AUTH_REQUIRED'] as const
export type TerraMediaAvailability = (typeof TERRA_MEDIA_AVAILABILITY)[number]

export type TerraMediaCandidate = {
  id: string
  eventId: string
  family: TerraMediaEventFamily
  eventType: string
  eventTitle: string
  severity: string | null
  location: string | null
  source: string
  publisher: string
  timestamp: string | null
  mediaState: TerraMediaAssetState
  mediaStateReason: string
  liveEvidence: TerraMediaLiveEvidence | null
  provenance: string
  locationRelevance: string | null
  availability: TerraMediaAvailability
  authRequirement: TerraLiveIntelMediaAccessClass
  sourceUrl: string | null
  watchUrl: string | null
  listenStationId: string | null
  mediaPreview: TerraLiveIntelMediaPreview | null
  queuedAt: string
  autoplay: false
}

export type TerraMediaStoreSnapshot = {
  candidate: TerraMediaCandidate | null
  lastQueuedId: string | null
}
