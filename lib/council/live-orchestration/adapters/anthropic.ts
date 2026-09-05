import { readSseResponse } from '../sseParse'
import type { NormalizedProviderStreamResult, StreamDeltaHandler } from '../streamContract'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

export async function streamAnthropicMessages(input: {
  apiKey: string
  model: string
  system: string
  prompt: string
  maxTokens: number
  signal: AbortSignal
  onDelta: StreamDeltaHandler
}): Promise<NormalizedProviderStreamResult> {
  const started = Date.now()
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': input.apiKey,
      'anthropic-version': '2023-06-01',
    },
    signal: input.signal,
    body: JSON.stringify({
      model: input.model,
      max_tokens: input.maxTokens,
      system: input.system,
      messages: [{ role: 'user', content: input.prompt }],
      stream: true,
    }),
  })
  if (!res.ok) {
    let message = `Anthropic failed (${res.status})`
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
  let parserError = false
  try {
    await readSseResponse(res, ({ event, data }) => {
      if (!data || event === 'ping') return
      if (event === 'error') {
        parserError = true
        return
      }
      let parsed: { type?: string; delta?: { type?: string; text?: string } }
      try {
        parsed = JSON.parse(data) as { type?: string; delta?: { type?: string; text?: string } }
      } catch {
        parserError = true
        return
      }
      const type = event || parsed.type
      if (type === 'content_block_delta' && parsed.delta?.type === 'text_delta' && typeof parsed.delta.text === 'string') {
        if (!firstDeltaAt) firstDeltaAt = Date.now() - started
        text += parsed.delta.text
        input.onDelta(parsed.delta.text)
      }
    })
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError'
    if (text.trim()) {
      return { ok: false, text, partial: true, httpStatus: aborted ? 'timeout' : res.status, error: aborted ? 'stream aborted' : 'anthropic_stream_error', firstDeltaAt, parserError }
    }
    return { ok: false, text: '', partial: false, httpStatus: aborted ? 'timeout' : 'unavailable', error: aborted ? 'stream aborted' : 'anthropic_stream_error', parserError: parserError || !aborted }
  }
  if (!text.trim()) {
    return { ok: false, text: '', partial: false, httpStatus: res.status, error: 'empty response body', firstDeltaAt, parserError }
  }
  return { ok: true, text, partial: false, httpStatus: res.status, firstDeltaAt, completedAt: Date.now() - started, parserError }
}
