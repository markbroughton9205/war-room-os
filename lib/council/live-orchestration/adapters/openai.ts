import { readSseResponse } from '../sseParse'
import type { NormalizedProviderStreamResult, StreamDeltaHandler } from '../streamContract'

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'

export async function streamOpenAiChat(input: {
  apiKey: string
  model: string
  system: string
  prompt: string
  maxTokens: number
  signal: AbortSignal
  onDelta: StreamDeltaHandler
}): Promise<NormalizedProviderStreamResult> {
  const started = Date.now()
  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${input.apiKey}`,
    },
    signal: input.signal,
    body: JSON.stringify({
      model: input.model,
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: input.prompt },
      ],
      max_tokens: input.maxTokens,
      stream: true,
    }),
  })
  if (!res.ok) {
    let message = `OpenAI failed (${res.status})`
    try {
      const data = (await res.json()) as { error?: { message?: string } }
      if (data?.error?.message) message = data.error.message
    } catch {
      /* ignore */
    }
    return { ok: false, text: '', partial: false, httpStatus: res.status, error: message }
  }
  let text = ''
  let firstDeltaAt: number | undefined
  try {
    await readSseResponse(res, ({ data }) => {
      if (!data || data === '[DONE]') return
      const parsed = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] }
      const chunk = parsed.choices?.[0]?.delta?.content
      if (typeof chunk === 'string' && chunk) {
        if (!firstDeltaAt) firstDeltaAt = Date.now() - started
        text += chunk
        input.onDelta(chunk)
      }
    })
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError'
    if (text.trim()) {
      return { ok: false, text, partial: true, httpStatus: aborted ? 'timeout' : res.status, error: aborted ? 'stream aborted' : 'openai_stream_error', firstDeltaAt }
    }
    return { ok: false, text: '', partial: false, httpStatus: aborted ? 'timeout' : 'unavailable', error: aborted ? 'stream aborted' : 'openai_stream_error', parserError: !aborted }
  }
  if (!text.trim()) return { ok: false, text: '', partial: false, httpStatus: res.status, error: 'empty response body', firstDeltaAt }
  return { ok: true, text, partial: false, httpStatus: res.status, firstDeltaAt, completedAt: Date.now() - started }
}
