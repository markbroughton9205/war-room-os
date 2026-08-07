import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { GIBS_LAYERS } from '@/lib/earth-intelligence/gibsLayers'
import { getGibsServerConfigStatus } from '@/lib/earth-intelligence/gibsServerConfig'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'nasa_gibs' as const

/**
 * Thin Research Engine wiring around the existing, reviewed NASA GIBS module
 * (lib/earth-intelligence/*) — it is NOT reimplemented here. `run` lists the
 * curated available layers as map-layer documents; actual tile rendering
 * continues to go through lib/earth-intelligence/gibsTileUrl.ts directly.
 */
async function run(query: ResearchQuery) {
  const status = getGibsServerConfigStatus()
  if (!status.baseUrlConfigured) {
    return notConfiguredResponse(PROVIDER, 'NASA_GIBS_WMTS_BASE_URL is not configured or does not match the reviewed public base URL.')
  }
  const started = Date.now()
  const needle = query.text.trim().toLowerCase()
  const layers = GIBS_LAYERS.filter(layer => !needle || layer.label.toLowerCase().includes(needle) || layer.description.toLowerCase().includes(needle))
  const documents = layers.map(layer => makeDocument({
    id: `nasa_gibs:${layer.id}`,
    provider: PROVIDER,
    providerRecordId: layer.identifier,
    title: layer.label,
    summary: layer.description,
    contentSnippet: layer.caveat ?? null,
    canonicalUrl: 'https://gibs.earthdata.nasa.gov/',
    sourceUrl: 'https://gibs.earthdata.nasa.gov/',
    sourceName: 'NASA GIBS',
    contentType: 'map_layer',
    authors: [],
    organization: 'NASA',
    publishedAt: null,
    updatedAt: layer.defaultDate ?? null,
    geography: 'global',
    language: 'en',
    identifiers: { gibs_layer_id: layer.id, gibs_identifier: layer.identifier },
    subjects: [layer.temporalResolution ?? ''].filter(Boolean),
    license: null,
    accessStatus: layer.status === 'available' ? 'open' : 'restricted',
    warnings: layer.status === 'unavailable' && layer.unavailableReason ? [layer.unavailableReason] : [],
  }))
  return okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const status = getGibsServerConfigStatus()
  return {
    provider: PROVIDER,
    state: status.baseUrlConfigured ? 'ready' : 'not_configured',
    checkedAt: nowIso(),
    detail: status.baseUrlConfigured ? 'NASA_GIBS_WMTS_BASE_URL matches the reviewed public base URL.' : 'NASA_GIBS_WMTS_BASE_URL missing or mismatched.',
    durationMs: 0,
  }
}

export const nasaGibsAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
