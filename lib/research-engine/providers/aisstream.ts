import 'server-only'

/**
 * AISStream.io — server-side WebSocket only. API key never reaches the browser.
 * Without AISSTREAM_API_KEY the adapter returns not_configured (NEEDS_CREDENTIALS).
 *
 * Request/response path: open socket, subscribe bbox, collect a bounded snapshot, close.
 * Reconnect uses bounded exponential backoff (max 3 attempts). Memory is capped by unique MMSI.
 */
import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { isProviderEnvSatisfied, providerEnvDescriptor } from '@/lib/research-engine/config/providerEnv'
import { assertAllowedProviderUrl } from '@/lib/research-engine/security/hostAllowlist'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'
import { makeMaritimeVesselDocument, observationInBbox, parseMaritimeBbox } from '@/lib/research-engine/providers/maritimeAisShared'

const PROVIDER = 'aisstream' as const
const WS_URL = 'wss://stream.aisstream.io/v0/stream'
const MAX_RESULTS = 150
const SNAPSHOT_MS = 8_000
const MAX_ATTEMPTS = 3
const MAX_MESSAGES = 400

type AisStreamEnvelope = {
  MessageType?: string
  error?: string
  Error?: string
  MetaData?: {
    MMSI?: number
    ShipName?: string
    latitude?: number
    longitude?: number
    Latitude?: number
    Longitude?: number
    time_utc?: string
  }
  Message?: {
    PositionReport?: {
      UserID?: number
      Latitude?: number
      Longitude?: number
      Sog?: number
      Cog?: number
      TrueHeading?: number
      NavigationalStatus?: number
    }
  }
}

function backoffMs(attempt: number): number {
  return Math.min(250 * 3 ** attempt, 2_000)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function decodeFrame(data: unknown): AisStreamEnvelope | null {
  try {
    const text = typeof data === 'string'
      ? data
      : data instanceof ArrayBuffer
        ? new TextDecoder().decode(data)
        : Buffer.isBuffer(data) || ArrayBuffer.isView(data)
          ? new TextDecoder().decode(data as ArrayBufferView)
          : null
    if (!text) return null
    return JSON.parse(text) as AisStreamEnvelope
  } catch {
    return null
  }
}

async function decodeSocketData(data: unknown): Promise<AisStreamEnvelope | null> {
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    try {
      return decodeFrame(await data.text())
    } catch {
      return null
    }
  }
  return decodeFrame(data)
}

function collectSnapshot(bbox: { lamin: number; lomin: number; lamax: number; lomax: number }, apiKey: string): Promise<ReturnType<typeof makeMaritimeVesselDocument>[]> {
  assertAllowedProviderUrl(PROVIDER, WS_URL.replace('wss://', 'https://'))
  const WebSocketImpl = (globalThis as typeof globalThis & { WebSocket?: typeof WebSocket }).WebSocket
  if (!WebSocketImpl) {
    return Promise.reject(new Error('WebSocket runtime is not available in this Node process.'))
  }

  return new Promise((resolve, reject) => {
    const byMmsi = new Map<number, ReturnType<typeof makeMaritimeVesselDocument>>()
    let settled = false
    let messageCount = 0
    const socket = new WebSocketImpl(WS_URL)
    try { (socket as WebSocket).binaryType = 'arraybuffer' } catch { /* runtime may not expose binaryType */ }
    const timer = setTimeout(() => finish(), SNAPSHOT_MS)

    function finish(error?: Error) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { socket.close() } catch { /* already closed */ }
      if (error && byMmsi.size === 0) reject(error)
      else resolve([...byMmsi.values()])
    }

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({
        APIKey: apiKey,
        BoundingBoxes: [[[bbox.lamin, bbox.lomin], [bbox.lamax, bbox.lomax]]],
        FilterMessageTypes: ['PositionReport'],
      }))
    })
    socket.addEventListener('message', event => {
      messageCount += 1
      if (messageCount > MAX_MESSAGES) {
        finish()
        return
      }
      void decodeSocketData(event.data).then(envelope => {
        if (settled) return
        if (!envelope) return
        if (envelope.error || envelope.Error) {
          finish(new Error(String(envelope.error || envelope.Error)))
          return
        }
        const report = envelope.Message?.PositionReport
        const meta = envelope.MetaData
        const looksLikePosition = envelope.MessageType === 'PositionReport'
          || Boolean(report)
          || (typeof meta?.latitude === 'number' && typeof meta?.longitude === 'number')
        if (!looksLikePosition) return
      const mmsi = report?.UserID ?? meta?.MMSI
      const latitude = report?.Latitude ?? meta?.Latitude ?? meta?.latitude
      const longitude = report?.Longitude ?? meta?.Longitude ?? meta?.longitude
      if (typeof mmsi !== 'number' || typeof latitude !== 'number' || typeof longitude !== 'number') return
      if (!observationInBbox(latitude, longitude, bbox)) return
      byMmsi.set(mmsi, makeMaritimeVesselDocument(PROVIDER, {
        mmsi,
        latitude,
        longitude,
        name: meta?.ShipName,
        speedKnots: report?.Sog,
        courseDeg: report?.Cog,
        headingDeg: report?.TrueHeading,
        navStatCode: report?.NavigationalStatus,
        observedAtIso: meta?.time_utc ?? nowIso(),
        canonicalUrl: 'https://aisstream.io/documentation',
        sourceName: 'AISStream.io',
        organization: 'AISStream',
        license: 'AISStream Terms of Service',
      }))
      if (byMmsi.size >= MAX_RESULTS) finish()
      })
    })
    socket.addEventListener('error', () => finish(new Error('AISStream WebSocket error')))
    socket.addEventListener('close', () => finish())
  })
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const bbox = parseMaritimeBbox(query.text)
  if (!bbox) throw new Error('Query must be a bounding box "lamin,lomin,lamax,lomax".')
  const apiKey = process.env.AISSTREAM_API_KEY?.trim() ?? ''
  const limit = Math.max(1, Math.min(query.maxResults ?? 50, MAX_RESULTS))
  const cacheKey = `aisstream:${query.text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  let lastError: Error | null = null
  let documents: ReturnType<typeof makeMaritimeVesselDocument>[] = []
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      documents = await collectSnapshot(bbox, apiKey)
      lastError = null
      break
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (attempt < MAX_ATTEMPTS - 1) await sleep(backoffMs(attempt))
    }
  }
  if (lastError && documents.length === 0) throw lastError

  const response = okResponse(PROVIDER, { documents: documents.slice(0, limit), durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.liveFeed)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return notConfiguredResponse(PROVIDER, 'AISSTREAM_API_KEY is not configured.')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      return outcome.response
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'AISSTREAM_API_KEY missing', durationMs: null }
  }
  return { provider: PROVIDER, state: 'ready', checkedAt: nowIso(), detail: 'Adapter installed; key present (socket opens only on live query)', durationMs: 0 }
}

export const aisstreamAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
