import { probeGeminiApi } from '@/lib/engine-control/status'

const GEMINI_REST_BASE = 'https://generativelanguage.googleapis.com/v1beta'

type GenJson = {
  candidates?: { content?: { parts?: { text?: string }[] } }[]
  error?: { message?: string }
}

/**
 * Council-only Gemini completion: runs the same probe as engine-control first; no call when not functional.
 */
export async function completeGeminiCouncilMessage(params: {
  userPrompt: string
  systemPrompt: string
  maxOutputTokens: number
  timeoutMs?: number
}): Promise<{ text: string } | { error: string }> {
  const rawKey = process.env.GEMINI_API_KEY
  if (typeof rawKey !== 'string' || !rawKey.trim()) {
    return { error: 'Gemini not configured (GEMINI_API_KEY).' }
  }
  const apiKey = rawKey.trim()
  const timeoutMs = params.timeoutMs ?? 60_000
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const probe = await probeGeminiApi(apiKey, controller.signal)
    if (!probe.functional || !probe.functionalModelId) {
      return {
        error:
          'Gemini is not functional (see GET /api/engine-control status). War Room skips Gemini until the probe succeeds.',
      }
    }
    const modelId = probe.functionalModelId
    const bodyA = {
      systemInstruction: { parts: [{ text: params.systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: params.userPrompt }] }],
      generationConfig: { maxOutputTokens: params.maxOutputTokens },
    }
    let res = await fetch(`${GEMINI_REST_BASE}/models/${encodeURIComponent(modelId)}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
      body: JSON.stringify(bodyA),
    })
    let data = (await res.json()) as GenJson
    if (!res.ok || !data.candidates?.length) {
      const combined = `Council context:\n${params.systemPrompt}\n\n${params.userPrompt}`
      res = await fetch(`${GEMINI_REST_BASE}/models/${encodeURIComponent(modelId)}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
        signal: controller.signal,
        cache: 'no-store',
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: combined }] }],
          generationConfig: { maxOutputTokens: params.maxOutputTokens },
        }),
      })
      data = (await res.json()) as GenJson
    }
    const text =
      data.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('') ?? ''
    if (!res.ok) {
      return { error: data.error?.message ?? `Gemini HTTP ${res.status}` }
    }
    if (!text.trim()) return { error: 'Gemini returned an empty response' }
    return { text: text.trim() }
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError'
    return { error: aborted ? 'Gemini request timed out.' : e instanceof Error ? e.message : String(e) }
  } finally {
    clearTimeout(t)
  }
}
