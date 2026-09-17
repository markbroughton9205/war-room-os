/**
 * Future War Room Phone → Nebula Genesis location ingest.
 * Interface only in this pass. No public broadcast endpoint. No unauthenticated ingest.
 */
import type { CommanderLocation } from './commanderLocation'

export const PHONE_LOCATION_BRIDGE_STATUS = 'INTERFACE_ONLY' as const
export const PHONE_LOCATION_BRIDGE_AUTH = 'COMMANDER_SESSION_REQUIRED' as const
export const PHONE_LOCATION_PUBLIC_BROADCAST = false

export type PhoneLocationEnvelope = {
  commanderId: string
  encryptedPayload: string
  issuedAt: string
  location?: CommanderLocation
}

export const PHONE_LOCATION_BRIDGE = {
  status: PHONE_LOCATION_BRIDGE_STATUS,
  auth: PHONE_LOCATION_BRIDGE_AUTH,
  publicBroadcast: PHONE_LOCATION_PUBLIC_BROADCAST,
  ingestRoute: null,
  note: 'War Room Phone may later push an authenticated encrypted CommanderLocation into CommanderLocationProvider. This pass does not open a public location endpoint.',
} as const
