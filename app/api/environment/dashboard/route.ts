import { NextResponse } from 'next/server'

import { DEFAULT_COMMANDER_LOCATION, type CommanderLocationState } from '@/lib/intelligence/environment/locationPolicy'
import { buildFinanceDashboardSnapshot } from '@/lib/intelligence/environment/financeProvider'
import { buildNewsDashboardSnapshot } from '@/lib/intelligence/environment/newsProvider'
import { buildWeatherDashboardSnapshot } from '@/lib/intelligence/environment/weatherProvider'
import type { LiveEnvironmentDashboardPayload } from '@/lib/intelligence/environment/liveEnvironmentTypes'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function normalizeLocation(input: unknown): CommanderLocationState {
  if (!input || typeof input !== 'object') return DEFAULT_COMMANDER_LOCATION
  const record = input as Partial<CommanderLocationState>
  const mode = record.mode === 'off' || record.mode === 'city_only' || record.mode === 'neighborhood' || record.mode === 'precise_temporary'
    ? record.mode
    : DEFAULT_COMMANDER_LOCATION.mode
  return {
    mode,
    city: typeof record.city === 'string' ? record.city.slice(0, 120) : DEFAULT_COMMANDER_LOCATION.city,
    neighborhood: typeof record.neighborhood === 'string' ? record.neighborhood.slice(0, 120) : undefined,
    preciseExpiresAt: typeof record.preciseExpiresAt === 'string' ? record.preciseExpiresAt.slice(0, 80) : undefined,
    historyStored: Boolean(record.historyStored),
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { location?: unknown }
  const location = normalizeLocation(body.location)
  const [weather, news, finance] = await Promise.all([
    buildWeatherDashboardSnapshot(location),
    buildNewsDashboardSnapshot(),
    buildFinanceDashboardSnapshot(),
  ])

  const payload: LiveEnvironmentDashboardPayload = {
    weather,
    news,
    finance,
    generatedAt: new Date().toISOString(),
    safety: {
      exposesSecretValues: false,
      runtimeTruthOnly: true,
      sourceBackedOnly: true,
    },
  }

  return NextResponse.json(payload)
}
