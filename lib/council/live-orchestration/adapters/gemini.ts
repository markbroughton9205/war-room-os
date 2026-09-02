import { GEMINI_REST_BASE } from '@/lib/ai/providers/geminiGenerative'
import { readSseResponse } from '../sseParse'
import type { NormalizedProviderStreamResult, StreamDeltaHandler } from '../streamContract'

export async function streamGeminiCouncil(input: {
  apiKey: string
  modelId: string
  system: string
  prompt: string
  maxTokens: number
  signal: AbortSignal
  onDelta: StreamDeltaHandler
}): Promise<NormalizedProviderStreamResult> {
  const started = Date.now()
  const res = await fetch(
    `${GEMINI_REST_BASE}/models/${encodeURIComponent(input.modelId)}:streamGenerateContent?alt=sse`,
    {
      method: 'POST',
      headers: {
        'x-goog-api-key': input.apiKey,
        'Content-Type': 'application/json',
      },
      signal: input.signal,
      cache: 'no-store',
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: input.system }] },
        contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
        generationConfig: { maxOutputTokens: input.maxTokens },
      }),
    },
  )
  if (!res.ok) {
    return { ok: false, text: '', partial: false, httpStatus: res.status, error: `Gemini stream failed (${res.status})` }
  }
  let text = ''
  let firstDeltaAt: number | undefined
  try {
    await readSseResponse(res, ({ data }) => {
      if (!data) return
      const parsed = JSON.parse(data) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
      const chunk = parsed.candidates?.[0]?.content?.parts?.map(part => part.text ?? '').join('') ?? ''
      if (chunk) {
        if (!firstDeltaAt) firstDeltaAt = Date.now() - started
        text += chunk
        input.onDelta(chunk)
      }
    })
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError'
    if (text.trim()) {
      return { ok: false, text, partial: true, httpStatus: aborted ? 'timeout' : res.status, error: aborted ? 'stream aborted' : 'gemini_stream_error', firstDeltaAt }
    }
    return { ok: false, text: '', partial: false, httpStatus: aborted ? 'timeout' : 'unavailable', error: aborted ? 'stream aborted' : 'gemini_stream_error', parserError: !aborted }
  }
  if (!text.trim()) return { ok: false, text: '', partial: false, httpStatus: res.status, error: 'empty response body', firstDeltaAt }
  return { ok: true, text, partial: false, httpStatus: res.status, firstDeltaAt, completedAt: Date.now() - started }
}
