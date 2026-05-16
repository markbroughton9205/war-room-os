import {
  GEMINI_REST_BASE,
  classifyGeminiGenerateFailure,
  fetchGeminiListModelsJson,
  geminiAllowedGenerateContentIds,
  geminiDegradedNote,
  geminiOrderedCandidates,
  type GeminiHttpFailureKind,
} from '@/lib/ai/providers/geminiGenerative'

type GenJson = {
  candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[]
  error?: { message?: string }
}

export type GeminiCouncilMessageResult =
  | { ok: true; text: string; finishReason?: string }
  | { ok: false; degraded: true; note: string; reason: GeminiHttpFailureKind }
  | { ok: false; degraded: false; error: string }

function aggregateFailureReason(failures: GeminiHttpFailureKind[]): GeminiHttpFailureKind {
  if (failures.length === 0) return 'model_unavailable'
  if (failures.every(f => f === 'quota_limited')) return 'quota_limited'
  if (failures.every(f => f === 'model_unavailable')) return 'model_unavailable'
  if (failures.some(f => f === 'quota_limited')) return 'quota_limited'
  return 'degraded'
}

/**
 * Council-only Gemini completion: lists models, intersects with the council fallback chain,
 * then calls `generateContent` at most once per candidate (bare model id in the URL path).
 */
export async function completeGeminiCouncilMessage(params: {
  userPrompt: string
  systemPrompt: string
  maxOutputTokens: number
  timeoutMs?: number
}): Promise<GeminiCouncilMessageResult> {
  const rawKey = process.env.GEMINI_API_KEY
  if (typeof rawKey !== 'string' || !rawKey.trim()) {
    return { ok: false, degraded: false, error: 'Gemini not configured (GEMINI_API_KEY).' }
  }
  const apiKey = rawKey.trim()
  const timeoutMs = params.timeoutMs ?? 60_000
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const listed = await fetchGeminiListModelsJson(apiKey, controller.signal)
    if (!listed.ok) {
      return { ok: false, degraded: false, error: `Gemini list models failed (HTTP ${listed.status}).` }
    }

    const allowed = geminiAllowedGenerateContentIds(listed.json)
    const candidates = geminiOrderedCandidates(allowed)
    if (candidates.length === 0) {
      const reason: GeminiHttpFailureKind = 'model_unavailable'
      return { ok: false, degraded: true, note: geminiDegradedNote(reason), reason }
    }

    const headers = { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' }
    const body = {
      systemInstruction: { parts: [{ text: params.systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: params.userPrompt }] }],
      generationConfig: { maxOutputTokens: params.maxOutputTokens },
    }
    const failureKinds: GeminiHttpFailureKind[] = []

    for (const modelId of candidates) {
      const res = await fetch(`${GEMINI_REST_BASE}/models/${encodeURIComponent(modelId)}:generateContent`, {
        method: 'POST',
        headers,
        signal: controller.signal,
        cache: 'no-store',
        body: JSON.stringify(body),
      })
      let data: GenJson
      try {
        data = (await res.json()) as GenJson
      } catch {
        failureKinds.push('degraded')
        continue
      }
      const cand0 = data.candidates?.[0]
      const text = cand0?.content?.parts?.map(p => p.text).filter(Boolean).join('') ?? ''
      const finishReason =
        typeof cand0?.finishReason === 'string' && cand0.finishReason.trim()
          ? cand0.finishReason.trim()
          : undefined
      if (res.ok && text.trim()) {
        return { ok: true, text: text.trim(), ...(finishReason ? { finishReason } : {}) }
      }
      if (!res.ok) {
        failureKinds.push(classifyGeminiGenerateFailure(res.status))
        continue
      }
      failureKinds.push('degraded')
    }

    const reason = aggregateFailureReason(failureKinds)
    return { ok: false, degraded: true, note: geminiDegradedNote(reason), reason }
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError'
    return {
      ok: false,
      degraded: false,
      error: aborted ? 'Gemini request timed out.' : e instanceof Error ? e.message : String(e),
    }
  } finally {
    clearTimeout(t)
  }
}
