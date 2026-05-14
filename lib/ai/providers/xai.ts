export type XAIChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type XAIChatResult = {
  status: 'online' | 'standby' | 'error' | 'not_connected'
  text: string
  model: string
  error?: string
}

const XAI_CHAT_COMPLETIONS_URL = 'https://api.x.ai/v1/chat/completions'
const DEFAULT_XAI_MODEL = 'grok-4.3'

export function configuredXAIModel() {
  return process.env.XAI_MODEL?.trim() || DEFAULT_XAI_MODEL
}

export async function callXAIChat({
  messages,
  maxTokens = 220,
  timeoutMs = 30000,
}: {
  messages: XAIChatMessage[]
  maxTokens?: number
  timeoutMs?: number
}): Promise<XAIChatResult> {
  const apiKey = process.env.XAI_API_KEY?.trim()
  const model = configuredXAIModel()

  if (!apiKey) {
    return {
      status: 'not_connected',
      text: 'Grok Family is present in the War Room architecture, but XAI_API_KEY is not connected.',
      model,
      error: 'XAI_API_KEY missing',
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(XAI_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        stream: false,
      }),
    })
    const data = await response.json()

    if (!response.ok) {
      const message = data?.error?.message || data?.message || `xAI request failed with status ${response.status}`
      return {
        status: 'error',
        text: `Grok Family provider error: ${message}`,
        model,
        error: message,
      }
    }

    return {
      status: 'online',
      text: data?.choices?.[0]?.message?.content || 'Grok Family returned no text.',
      model: data?.model || model,
    }
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError'
    return {
      status: 'error',
      text: timedOut
        ? 'Grok Family timed out before completing a response.'
        : `Grok Family request failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      model,
      error: timedOut ? 'timeout' : error instanceof Error ? error.message : 'unknown error',
    }
  } finally {
    clearTimeout(timeout)
  }
}
