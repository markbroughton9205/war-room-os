import 'server-only'

import { callXAIChat } from '@/lib/ai/providers/xai'
import { completeGeminiCouncilMessage } from '@/lib/ai/providers/geminiCouncil'
import { applyCouncilRenderGate } from '@/lib/council/councilRenderGate'
import type { CouncilResearchRole } from './roles'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'
const CLAUDE_MODEL = 'claude-sonnet-4-20250514'

async function callOpenAi(user: string, system: string, maxTokens: number): Promise<string> {
  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.OPENAI_API_KEY || ''}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: maxTokens,
    }),
  })
  const data = await res.json() as { choices?: { message?: { content?: string } }[]; error?: { message?: string } }
  if (!res.ok) throw new Error(data?.error?.message || `OpenAI failed (${res.status})`)
  const text = data.choices?.[0]?.message?.content
  if (!text?.trim()) throw new Error('OpenAI returned empty content')
  return text.trim()
}

async function callClaude(user: string, system: string, maxTokens: number): Promise<string> {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY || '',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  })
  const data = await res.json() as { content?: { text?: string }[]; error?: { message?: string } }
  if (!res.ok) throw new Error(data?.error?.message || `Anthropic failed (${res.status})`)
  const text = data.content?.[0]?.text
  if (!text?.trim()) throw new Error('Claude returned empty content')
  return text.trim()
}

async function callGrok(user: string, system: string, maxTokens: number): Promise<string> {
  const result = await callXAIChat({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    maxTokens,
    timeoutMs: 22_000,
  })
  if (result.status !== 'online' || !result.text?.trim()) {
    throw new Error(result.error || 'Grok unavailable')
  }
  return result.text.trim()
}

async function callGemini(user: string, system: string, maxTokens: number): Promise<string> {
  const result = await completeGeminiCouncilMessage({
    userPrompt: user,
    systemPrompt: system,
    maxOutputTokens: maxTokens,
    timeoutMs: 20_000,
  })
  if (!result.ok) {
    if (result.degraded && result.note) return result.note
    throw new Error(result.degraded ? result.note : ('error' in result ? result.error : 'Gemini unavailable'))
  }
  let text = result.text.trim()
  const gate = applyCouncilRenderGate('gemini', text)
  if (!gate.renderable) text = gate.displayText
  return text
}

const SHARED =
  'Never fabricate live events. Separate evidence from inference. Never speak as Ra\'el.'

const ROLE_SYSTEM: Record<CouncilResearchRole, string> = {
  grok: `Grok Family — signal scout. ${SHARED}`,
  claude: `Claude Family — structure and business risk. ${SHARED}`,
  gemini: `Gemini Family — cross-check sources. ${SHARED}`,
  chatgpt: `ChatGPT Family — final plain-language synthesis for Commander. ${SHARED}`,
  red_team: `Red Team — adversarial review; flag weak evidence and scams. ${SHARED}`,
  baby: `Baby Observer — lesson candidate only; do NOT answer the decree. ${SHARED}`,
}

export async function invokeCouncilResearchRole(args: {
  role: CouncilResearchRole
  userPrompt: string
}): Promise<{ content: string; ok: boolean; error?: string }> {
  const system = ROLE_SYSTEM[args.role]
  try {
    if (args.role === 'grok') {
      if (!process.env.XAI_API_KEY?.trim()) {
        return { content: '', ok: false, error: 'Grok unavailable (no API key)' }
      }
      return { content: await callGrok(args.userPrompt, system, 480), ok: true }
    }
    if (args.role === 'claude' || args.role === 'red_team') {
      if (!process.env.ANTHROPIC_API_KEY?.trim()) {
        return { content: '', ok: false, error: 'Claude unavailable (no API key)' }
      }
      return { content: await callClaude(args.userPrompt, system, args.role === 'red_team' ? 420 : 520), ok: true }
    }
    if (args.role === 'gemini') {
      if (!process.env.GEMINI_API_KEY?.trim()) {
        return { content: '', ok: false, error: 'Gemini unavailable (no API key)' }
      }
      return { content: await callGemini(args.userPrompt, system, 520), ok: true }
    }
    if (args.role === 'chatgpt' || args.role === 'baby') {
      if (!process.env.OPENAI_API_KEY?.trim()) {
        return { content: '', ok: false, error: 'ChatGPT unavailable (no API key)' }
      }
      return {
        content: await callOpenAi(args.userPrompt, system, args.role === 'baby' ? 120 : 900),
        ok: true,
      }
    }
    return { content: '', ok: false, error: 'Unknown role' }
  } catch (e) {
    return { content: '', ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
