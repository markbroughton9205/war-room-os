import { streamGeminiCouncil } from './gemini'

/**
 * Gemini Continue-mode truncation-regression repair. Proves the finishReason capture added to
 * streamGeminiCouncil() actually extracts a real value from a realistic SSE response shape (not
 * just that the types compile) - a real Gemini streamGenerateContent response reports
 * finishReason ('STOP'/'MAX_TOKENS'/etc.) on the candidate object of the chunk that terminates
 * generation, not every chunk.
 */

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function mockGeminiSseResponse(chunks: { text?: string; finishReason?: string }[]): Response {
  const frames = chunks.map(chunk => {
    const candidate: Record<string, unknown> = {}
    if (chunk.text !== undefined) candidate.content = { parts: [{ text: chunk.text }] }
    if (chunk.finishReason !== undefined) candidate.finishReason = chunk.finishReason
    return `data: ${JSON.stringify({ candidates: [candidate] })}\n\n`
  })
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame))
      controller.close()
    },
  })
  return { ok: true, status: 200, body: stream } as unknown as Response
}

export async function runGeminiFinishReasonValidation(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const original = globalThis.fetch

  // Case 1: a truncated response (MAX_TOKENS on the terminal chunk) must be captured.
  globalThis.fetch = (async () =>
    mockGeminiSseResponse([
      { text: 'War Room is ' },
      { text: 'currently oper' },
      { finishReason: 'MAX_TOKENS' },
    ])) as typeof fetch
  try {
    const result = await streamGeminiCouncil({
      apiKey: 'fake-test-key',
      modelId: 'gemini-test',
      system: 'test',
      prompt: 'test',
      maxTokens: 8,
      signal: new AbortController().signal,
      onDelta: () => {},
    })
    results.push(check(
      'gemini_finishReason_max_tokens_captured',
      result.ok === true && result.text === 'War Room is currently oper' && result.finishReason === 'MAX_TOKENS',
      `ok=${result.ok} text=${JSON.stringify(result.text)} finishReason=${result.finishReason}`,
    ))
  } finally {
    globalThis.fetch = original
  }

  // Case 2: a normal, non-truncated completion (STOP) must also be captured, not left undefined -
  // the signal is only useful if it distinguishes STOP from MAX_TOKENS, not just present/absent.
  globalThis.fetch = (async () =>
    mockGeminiSseResponse([
      { text: 'War Room is fully operational.' },
      { finishReason: 'STOP' },
    ])) as typeof fetch
  try {
    const result = await streamGeminiCouncil({
      apiKey: 'fake-test-key',
      modelId: 'gemini-test',
      system: 'test',
      prompt: 'test',
      maxTokens: 32,
      signal: new AbortController().signal,
      onDelta: () => {},
    })
    results.push(check(
      'gemini_finishReason_stop_captured_and_distinguishable',
      result.ok === true && result.finishReason === 'STOP',
      `ok=${result.ok} finishReason=${result.finishReason} (distinct from case 1's captured 'MAX_TOKENS', proving the field reflects the real API value rather than a constant)`,
    ))
  } finally {
    globalThis.fetch = original
  }

  return results
}
