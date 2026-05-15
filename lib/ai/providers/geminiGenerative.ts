/**
 * Shared Google Generative Language API (v1beta) helpers for War Room.
 * Uses bare model IDs in URL paths (`.../models/{id}:generateContent`); list API returns `models/...` names — strip before comparing.
 */

export const GEMINI_REST_BASE = 'https://generativelanguage.googleapis.com/v1beta'

/** Council / probe fallback order (newest first per product request). */
export const GEMINI_COUNCIL_MODEL_FALLBACK = [
  'gemini-2.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-3-flash',
  'gemini-3.1-pro',
] as const

export type GeminiListModelsJson = {
  models?: { name?: string; supportedGenerationMethods?: string[] }[]
}

/** Strip a single leading `models/` from API `name` fields. */
export function geminiBareModelIdFromName(raw: string | undefined | null): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  let s = raw.trim()
  if (s.startsWith('models/')) s = s.slice('models/'.length)
  if (s.startsWith('models/')) s = s.slice('models/'.length)
  return s || null
}

/** Model IDs the account lists with `generateContent` support (bare ids). */
export function geminiAllowedGenerateContentIds(listJson: GeminiListModelsJson): Set<string> {
  const out = new Set<string>()
  for (const m of listJson.models ?? []) {
    if (!m.supportedGenerationMethods?.includes('generateContent')) continue
    const id = geminiBareModelIdFromName(m.name)
    if (id) out.add(id)
  }
  return out
}

export function geminiOrderedCandidates(allowed: Set<string>): string[] {
  return GEMINI_COUNCIL_MODEL_FALLBACK.filter(id => allowed.has(id))
}

export async function fetchGeminiListModelsJson(
  apiKey: string,
  signal: AbortSignal,
  pageSize = 256,
): Promise<{ ok: true; json: GeminiListModelsJson } | { ok: false; status: number }> {
  const listRes = await fetch(`${GEMINI_REST_BASE}/models?pageSize=${pageSize}`, {
    method: 'GET',
    headers: { 'x-goog-api-key': apiKey },
    signal,
    cache: 'no-store',
  })
  if (!listRes.ok) return { ok: false, status: listRes.status }
  const json = (await listRes.json()) as GeminiListModelsJson
  return { ok: true, json }
}

export type GeminiHttpFailureKind = 'quota_limited' | 'model_unavailable' | 'degraded'

export function classifyGeminiGenerateFailure(status: number): GeminiHttpFailureKind {
  if (status === 429) return 'quota_limited'
  if (status === 404) return 'model_unavailable'
  return 'degraded'
}

export function geminiDegradedNote(reason: GeminiHttpFailureKind): string {
  return `Gemini Family: degraded — reason: ${reason}`
}
