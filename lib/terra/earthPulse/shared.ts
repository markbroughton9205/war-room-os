import type { EarthPulseDomain, EarthPulseDomainState, EarthPulseTruthState } from './types'
import { PHASE1_UNAVAILABLE } from './sources'
import { noneCoverage } from './freshness'

export function domainState(input: {
  domain: EarthPulseDomain
  source: string
  observedAt: string | null
  updatedAt: string | null
  freshness: EarthPulseTruthState
  coverage: EarthPulseDomainState['coverage']
  truth: EarthPulseDomainState['truth']
  note: string
  itemCount: number
}): EarthPulseDomainState {
  return {
    domain: input.domain,
    source: input.source,
    observedAt: input.observedAt,
    updatedAt: input.updatedAt,
    freshness: input.freshness,
    coverage: input.coverage,
    truthState: input.freshness,
    truth: input.truth,
    note: input.note,
    itemCount: input.itemCount,
  }
}

export function unavailableDomain(domain: EarthPulseDomain, source: string, note: string): EarthPulseDomainState {
  const truth = {
    source,
    license: 'n/a',
    auth: 'unavailable' as const,
    coverage: PHASE1_UNAVAILABLE,
    freshness: 'UNAVAILABLE' as const,
    temporalResolution: 'n/a',
    visualState: 'not rendered',
    docsUrl: '',
  }
  return domainState({
    domain,
    source,
    observedAt: null,
    updatedAt: null,
    freshness: 'UNAVAILABLE',
    coverage: noneCoverage(note),
    truth,
    note,
    itemCount: 0,
  })
}

export async function fetchText(url: string, timeoutMs: number): Promise<{ ok: true; status: number; text: string } | { ok: false; status: number; message: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'WarRoomOS-Terra/1.0 (earth-pulse@warroom.internal)' },
      signal: controller.signal,
      cache: 'no-store',
    })
    if (!response.ok) return { ok: false, status: response.status, message: `HTTP ${response.status}` }
    return { ok: true, status: response.status, text: await response.text() }
  } catch (error) {
    return { ok: false, status: 0, message: error instanceof Error ? error.message : 'fetch failed' }
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchBuffer(url: string, timeoutMs: number): Promise<{ ok: true; status: number; buffer: Buffer } | { ok: false; status: number; message: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'WarRoomOS-Terra/1.0 (earth-pulse@warroom.internal)' },
      signal: controller.signal,
      cache: 'no-store',
    })
    if (!response.ok) return { ok: false, status: response.status, message: `HTTP ${response.status}` }
    const buffer = Buffer.from(await response.arrayBuffer())
    return { ok: true, status: response.status, buffer }
  } catch (error) {
    return { ok: false, status: 0, message: error instanceof Error ? error.message : 'fetch failed' }
  } finally {
    clearTimeout(timer)
  }
}

export async function headOk(url: string, timeoutMs: number): Promise<{ ok: boolean; status: number; bytes: number }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'WarRoomOS-Terra/1.0 (earth-pulse@warroom.internal)', Range: 'bytes=0-64' },
      signal: controller.signal,
      cache: 'no-store',
    })
    const length = Number(response.headers.get('content-length') ?? 0)
    return { ok: response.ok, status: response.status, bytes: Number.isFinite(length) ? length : 0 }
  } catch {
    return { ok: false, status: 0, bytes: 0 }
  } finally {
    clearTimeout(timer)
  }
}

export function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

export function toUtcIsoMinutes(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}T${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:00Z`
}

export function alignToTenMinutes(date: Date): Date {
  const copy = new Date(date.getTime())
  copy.setUTCSeconds(0, 0)
  copy.setUTCMinutes(Math.floor(copy.getUTCMinutes() / 10) * 10)
  return copy
}

export function utcDayOfYear(date: Date): string {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0)
  const day = Math.floor((date.getTime() - start) / 86_400_000)
  return String(day).padStart(3, '0')
}
