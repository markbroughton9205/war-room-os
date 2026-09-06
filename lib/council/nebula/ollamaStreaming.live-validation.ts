import { probeOllama, requestOllamaStreamingCompletion } from '@/lib/native-builder/ollamaClient'
import { NEBULA_SHARED_LOCAL_MODEL_ID } from './modelProfile'
import { stripHiddenReasoning } from './thinkingStrip'

export type OllamaLiveProof = {
  name: string
  pass: boolean
  detail: string
  ttftMs: number | null
  tokensPerSecond: number | null
  totalMs: number | null
}

export async function runCouncilOllamaStreamingLiveProof(): Promise<OllamaLiveProof[]> {
  const probe = await probeOllama()
  const installed = probe.models.some(name => name === NEBULA_SHARED_LOCAL_MODEL_ID || name.startsWith(`${NEBULA_SHARED_LOCAL_MODEL_ID.split(':')[0]}:`))
  if (!probe.available || !installed) {
    return [{
      name: 'ollama_shared_qwen_available',
      pass: false,
      detail: probe.available ? `model missing; installed=${probe.models.join(',')}` : probe.detail,
      ttftMs: null,
      tokensPerSecond: null,
      totalMs: null,
    }]
  }
  let firstDeltaAt: number | null = null
  const started = Date.now()
  const result = await requestOllamaStreamingCompletion({
    model: NEBULA_SHARED_LOCAL_MODEL_ID,
    system: 'You are ORION in War Room. Answer in one short English sentence. No JSON. No thinking.',
    prompt: 'Say whether local Council routing can use the shared Qwen3 14B brain. One sentence.',
    onDelta: () => {
      if (firstDeltaAt == null) firstDeltaAt = Date.now()
    },
  })
  const visible = result.ok ? stripHiddenReasoning(result.text) : ''
  const pass = result.ok && visible.length > 0 && !visible.includes('<think') && !/[\u4e00-\u9fff]{8,}/.test(visible)
  return [
    {
      name: 'ollama_shared_qwen_stream',
      pass,
      detail: result.ok
        ? `model=${NEBULA_SHARED_LOCAL_MODEL_ID} ttft=${result.metrics.ttftMs}ms tps=${result.metrics.tokensPerSecond} text=${visible.slice(0, 180)}`
        : result.detail,
      ttftMs: result.ok ? result.metrics.ttftMs : firstDeltaAt == null ? null : firstDeltaAt - started,
      tokensPerSecond: result.ok ? result.metrics.tokensPerSecond : null,
      totalMs: result.ok ? result.metrics.totalMs : Date.now() - started,
    },
  ]
}
