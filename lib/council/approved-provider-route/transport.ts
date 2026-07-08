import {
  APPROVED_PROVIDER_MODEL,
  OPENAI_APPROVED_PROVIDER_URL,
  type ApprovedProviderTransport,
  type ApprovedProviderTransportRequest,
  type ApprovedProviderTransportResponse,
  type NetworkSpyCall,
  type NetworkSpySnapshot,
  type OpenAIApprovedProviderPayload,
} from './types'

export const openAIApprovedProviderTransport: ApprovedProviderTransport = async (
  request
) => {
  const response = await fetch(request.url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${request.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(request.body),
    signal: request.signal,
  })
  let body: unknown

  try {
    body = await response.json()
  } catch {
    body = null
  }

  return {
    ok: response.ok,
    status: response.status,
    body,
  }
}

export function buildApprovedProviderPayload(input: {
  prompt: string
  systemInstruction: string
}): OpenAIApprovedProviderPayload {
  return {
    model: APPROVED_PROVIDER_MODEL,
    messages: [
      { role: 'system', content: input.systemInstruction },
      { role: 'user', content: input.prompt },
    ],
    temperature: 0,
    stream: false,
  }
}

export function bodyMatchesSingleApprovedShape(
  body: unknown
): body is OpenAIApprovedProviderPayload {
  if (!body || typeof body !== 'object') return false
  const candidate = body as Partial<OpenAIApprovedProviderPayload> & {
    tools?: unknown
    functions?: unknown
    tool_choice?: unknown
  }

  return (
    candidate.model === APPROVED_PROVIDER_MODEL &&
    candidate.temperature === 0 &&
    candidate.stream === false &&
    Array.isArray(candidate.messages) &&
    candidate.messages.length === 2 &&
    candidate.messages[0]?.role === 'system' &&
    typeof candidate.messages[0]?.content === 'string' &&
    candidate.messages[1]?.role === 'user' &&
    typeof candidate.messages[1]?.content === 'string' &&
    candidate.tools === undefined &&
    candidate.functions === undefined &&
    candidate.tool_choice === undefined
  )
}

export class ApprovedProviderSpyTransport {
  private readonly calls: NetworkSpyCall[] = []

  constructor(
    private readonly responseFactory: (
      request: ApprovedProviderTransportRequest
    ) => Promise<ApprovedProviderTransportResponse>
  ) {}

  transport: ApprovedProviderTransport = async (request) => {
    this.calls.push({
      targetHost: new URL(request.url).host,
      bodyMatchesSingleApprovedShape: bodyMatchesSingleApprovedShape(request.body),
    })

    return this.responseFactory(request)
  }

  snapshot(): NetworkSpySnapshot {
    return {
      requestCount: this.calls.length,
      calls: [...this.calls],
    }
  }
}

export function createSuccessfulSpyTransport(content: string): ApprovedProviderSpyTransport {
  return new ApprovedProviderSpyTransport(async () => ({
    ok: true,
    status: 200,
    body: {
      choices: [{ message: { content } }],
    },
  }))
}

export function createErrorSpyTransport(): ApprovedProviderSpyTransport {
  return new ApprovedProviderSpyTransport(async () => ({
    ok: false,
    status: 500,
    body: { error: { message: 'Simulated provider error.' } },
  }))
}

export function createInvalidOutputSpyTransport(): ApprovedProviderSpyTransport {
  return new ApprovedProviderSpyTransport(async () => ({
    ok: true,
    status: 200,
    body: { choices: [{ message: { content: '' } }] },
  }))
}

export function createTimeoutSpyTransport(): ApprovedProviderSpyTransport {
  return new ApprovedProviderSpyTransport(
    () =>
      new Promise<ApprovedProviderTransportResponse>(() => {
        // Intentionally unresolved for timeout validation.
      })
  )
}

export function createDefaultNoNetworkSpyTransport(): ApprovedProviderSpyTransport {
  return new ApprovedProviderSpyTransport(async () => ({
    ok: true,
    status: 200,
    body: { choices: [{ message: { content: 'unused' } }] },
  }))
}

export const APPROVED_PROVIDER_TRANSPORT_URL = OPENAI_APPROVED_PROVIDER_URL

