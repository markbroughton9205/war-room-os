import { NextResponse } from 'next/server'
import { completeGeminiCouncilMessage } from '@/lib/ai/providers/geminiCouncil'
import { callXAIChat } from '@/lib/ai/providers/xai'
import { councilSingleFamilyToMemoryPartition, tryPersistMemoryProposalFromModelOutput } from '@/lib/memory/ingestFromModel'
import { insertWarRoomAuditLog } from '@/lib/war-room/auditLog'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import { coerceCouncilCommand } from '@/lib/council/councilCommandTypes'
import { applyGovernor, COUNCIL_GOVERNOR_SILENT_SKIP } from '@/lib/council/responseGovernor'
import { resolveCurrentIntent } from '@/lib/council/currentIntent'
import { buildActiveScope } from '@/lib/council/intentScope'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'
const CLAUDE_MODEL = 'claude-sonnet-4-20250514'
const DEFAULT_MAX_TOKENS = 220
const EXPANDED_MAX_TOKENS = 520
const GROK_TIMEOUT_MS = 30000

const COUNCIL_THREAD_MESSAGES = 16

const COUNCIL_INSTRUCTION = `You are in a live War Room council group chat. CRITICAL RULE: Never generate dialogue or words for Ra'el. Never simulate his responses. Only Ra'el speaks for Ra'el. Default to concise, high-signal responses unless expanded analysis has been approved. You may respond to him, respond to other families, ask questions, debate, joke, and continue discussion — but his voice is his alone. Use emoji mood indicators when they fit. Do not use theatrical stage directions. Read his tone and match it. Do not project heavy context unless he brings it up. Be a real distinct presence with your own personality. Keep it natural and alive.`

const TONE_INSTRUCTIONS: Record<string, string> = {
  casual: 'Tone mode: casual 😄. Natural personality, emojis, quick jokes, and group chat energy are welcome. Default to human and alive, not corporate.',
  build: 'Tone mode: build 🛠️. Stay focused, technical, implementation-minded, and clear. Prioritize concrete next steps.',
  business: 'Tone mode: business 📈. Think strategy, revenue, customers, positioning, and execution. Be direct and useful.',
  debate: 'Tone mode: debate 🔥. Challenge assumptions, compare positions, and push back respectfully. Keep it sharp but grounded.',
  reflection: 'Tone mode: reflection 🧭. Slow down, listen for meaning, and respond with warmth, clarity, and depth.',
}

export type CouncilSingleFamily =
  | 'chatgpt'
  | 'claude'
  | 'grok'
  | 'gemini'
  | 'red_team'
  | 'baby'
  | 'kimi'
  | 'bridge_architect'

async function callChatGPT(prompt: string, system: string, maxTokens = DEFAULT_MAX_TOKENS): Promise<string> {
  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${process.env.OPENAI_API_KEY || ''}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      max_tokens: maxTokens,
    }),
  })
  const data = await res.json() as { choices?: { message?: { content?: string } }[]; error?: { message?: string } }
  if (!res.ok) {
    throw new Error(data?.error?.message || `OpenAI request failed (${res.status})`)
  }
  const text = data.choices?.[0]?.message?.content
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('ChatGPT returned empty content')
  }
  return text.trim()
}

async function callClaude(prompt: string, system: string, maxTokens = DEFAULT_MAX_TOKENS): Promise<string> {
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
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  const data = await res.json() as { content?: { text?: string }[]; error?: { message?: string } }
  if (!res.ok) {
    throw new Error(data?.error?.message || `Anthropic request failed (${res.status})`)
  }
  const text = data.content?.[0]?.text
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('Claude returned empty content')
  }
  return text.trim()
}

async function callGrok(prompt: string, system: string, maxTokens = DEFAULT_MAX_TOKENS): Promise<string> {
  const result = await callXAIChat({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ],
    maxTokens,
    timeoutMs: GROK_TIMEOUT_MS,
  })

  if (result.status !== 'online') {
    throw new Error(result.error || result.text || 'Grok provider unavailable')
  }
  if (!result.text?.trim()) {
    throw new Error('Grok returned empty content')
  }
  return result.text.trim()
}

function buildThread(threadHistory: unknown) {
  if (!threadHistory || !Array.isArray(threadHistory) || !threadHistory.length) return 'Session just started.'
  const slice = threadHistory.slice(-COUNCIL_THREAD_MESSAGES) as { sender: string; content: string }[]
  return slice.map(m => `${m.sender}: ${m.content}`).join('\n')
}

function buildCouncilUserPrompt(args: {
  raelDirectiveText: string
  threadBlock: string
  augmentBlock: string
  intentLabel: string
}): string {
  const { raelDirectiveText, threadBlock, augmentBlock, intentLabel } = args
  return [
    `CURRENT DECREE (authoritative — stay on this topic; do not let prior chat override it):`,
    raelDirectiveText,
    '',
    `Decree intent (routing only): ${intentLabel}`,
    '',
    `Prior council thread (continuity only — preserve tone, but do not resurrect or pivot topics forbidden by the decree):`,
    threadBlock,
    '',
    `Continue the council with one response for your family only.${augmentBlock}`,
    `Do not speak for Ra'el. Add new substance; avoid repeating the previous speaker verbatim.`,
  ].join('\n')
}

export async function POST(req: Request) {
  let body: Record<string, unknown>
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const message = typeof body.message === 'string' ? body.message : ''
  if (!message) return NextResponse.json({ error: 'No message' }, { status: 400 })

  const profile = typeof body.profile === 'string' ? body.profile : ''
  const threadHistory = body.threadHistory
  const mode = body.mode as string | undefined
  const toneMode = typeof body.toneMode === 'string' ? body.toneMode : 'casual'
  const councilSingleFamily = body.councilSingleFamily as CouncilSingleFamily | undefined
  const orchestrationAugment = typeof body.orchestrationAugment === 'string' ? body.orchestrationAugment : ''
  const conversationId =
    typeof body.conversationId === 'string' && /^[0-9a-f-]{36}$/i.test(body.conversationId.trim())
      ? body.conversationId.trim()
      : null

  const councilCommand = coerceCouncilCommand(body.councilCommand)
  const raelDirectiveText =
    typeof body.raelDirectiveText === 'string' && body.raelDirectiveText.trim()
      ? body.raelDirectiveText.trim()
      : message

  const thread = buildThread(threadHistory)
  const intentState = resolveCurrentIntent({ latestRaelDecreeText: raelDirectiveText })
  const scopeForGovernor = buildActiveScope({
    decreeText: raelDirectiveText,
    councilCommand,
    intent: intentState.intent,
  })

  const expandedAnalysis = mode === 'expanded'
  const toneInstruction = TONE_INSTRUCTIONS[toneMode] || TONE_INSTRUCTIONS.casual
  const responseDepth = expandedAnalysis
    ? 'Expanded analysis approved. You may go deeper, but stay organized and avoid filler.'
    : 'Cost-control mode is active. Keep the answer concise by default.'
  const maxTokens = expandedAnalysis ? EXPANDED_MAX_TOKENS : DEFAULT_MAX_TOKENS
  const gptSystem = `You are ChatGPT Family in Ra'el's War Room. Role: Strategy, Revenue, Synthesis. Personality: confident, direct, witty. ${COUNCIL_INSTRUCTION} ${toneInstruction} ${responseDepth} Ra'el profile when relevant: ${profile}`
  const claudeSystem = `You are Claude Family in Ra'el's War Room. Role: Architecture, Truth, Precision. Personality: honest, direct, dry humor. ${COUNCIL_INSTRUCTION} ${toneInstruction} ${responseDepth} Ra'el profile when relevant: ${profile}`
  const grokSystem = `You are Grok Family in Ra'el's War Room. Role: realtime radar, signal detection, X/web intelligence framing, current-event monitoring, and sharp contradiction spotting. Personality: fast, candid, observant, a little mischievous but grounded. ${COUNCIL_INSTRUCTION} ${toneInstruction} ${responseDepth} Important: if live tools are not provided in the prompt, do not pretend you searched X or the web. Ra'el profile when relevant: ${profile}`
  const geminiSystem = `You are Gemini Family in Ra'el's War Room. Role: reasoning, synthesis, multimodal interpretation when the thread actually includes images/PDFs or pasted excerpts, research-assist framing, and large-context analysis. Personality: structured, curious, precise. ${COUNCIL_INSTRUCTION} ${toneInstruction} ${responseDepth} Do not claim live web, image/PDF ingestion, or tools you were not given in the prompt. Ra'el profile when relevant: ${profile}`

  const augmentBlock = orchestrationAugment.trim()
    ? `\n\nCouncil orchestration directives:\n${orchestrationAugment.trim()}`
    : ''

  const sup = tryWarRoomSupabase()
  const auditCouncil = (meta: Record<string, unknown>) =>
    insertWarRoomAuditLog(sup.ok ? sup.client : null, {
      actor: 'system',
      category: 'engine',
      message: meta.success === false ? 'Council /api/chat failed or aborted' : 'Council /api/chat completed',
      metadata: {
        route: '/api/chat',
        toneMode,
        mode: mode ?? null,
        ...meta,
      },
    })

  try {
    if (mode === 'continue' && councilSingleFamily) {
      if (councilSingleFamily === 'kimi' || councilSingleFamily === 'bridge_architect') {
        await auditCouncil({
          success: false,
          flow: 'continue_single',
          councilSingleFamily,
          reason: 'cloud_path_unavailable_use_local_agent',
        })
        return NextResponse.json(
          {
            error: 'use_local_agent',
            message: `${councilSingleFamily} is invoked via POST /api/local-agent/invoke only.`,
          },
          { status: 400 },
        )
      }

      const userPrompt = buildCouncilUserPrompt({
        raelDirectiveText,
        threadBlock: thread,
        augmentBlock,
        intentLabel: intentState.intent,
      })

      let responseText = ''
      let geminiDegradedReason: string | null = null
      switch (councilSingleFamily) {
        case 'chatgpt':
          responseText = await callChatGPT(userPrompt, gptSystem, maxTokens)
          break
        case 'claude':
          responseText = await callClaude(userPrompt, claudeSystem, maxTokens)
          break
        case 'grok':
          responseText = await callGrok(userPrompt, grokSystem, maxTokens)
          break
        case 'gemini': {
          const geminiResult = await completeGeminiCouncilMessage({
            userPrompt,
            systemPrompt: geminiSystem,
            maxOutputTokens: maxTokens,
          })
          if (!geminiResult.ok) {
            if (geminiResult.degraded) {
              responseText = geminiResult.note
              geminiDegradedReason = geminiResult.reason
              break
            }
            await auditCouncil({
              success: false,
              flow: 'continue_single',
              councilSingleFamily: 'gemini',
              reason: 'gemini_provider_error',
            })
            return NextResponse.json(
              { error: 'gemini_provider_error', message: geminiResult.error },
              { status: 502 },
            )
          }
          responseText = geminiResult.text.trim()
          if (!responseText) throw new Error('Gemini returned empty content')
          break
        }
        case 'red_team': {
          const redSystem = `You are Red Team in Ra'el's War Room — internal adversary and risk hunter. Hunt contradictions, blind spots, and overconfidence. ${COUNCIL_INSTRUCTION} ${toneInstruction} ${responseDepth} Ra'el profile when relevant: ${profile}`
          responseText = await callClaude(userPrompt, redSystem, maxTokens)
          break
        }
        case 'baby': {
          const babySystem = `You are Baby AI — observational council witness in Ra'el's War Room. Note patterns, tone, and alignment risks. You may end with one short sentence suggesting whether a Chronicle memory save could be useful (recommendation only — never imply it was saved). ${COUNCIL_INSTRUCTION} ${toneInstruction} ${responseDepth} Ra'el profile when relevant: ${profile}`
          responseText = await callChatGPT(userPrompt, babySystem, maxTokens)
          break
        }
        default:
          await auditCouncil({
            success: false,
            flow: 'continue_single',
            reason: 'unknown_councilSingleFamily',
            councilSingleFamily: String(councilSingleFamily),
          })
          return NextResponse.json({ error: 'Unknown councilSingleFamily' }, { status: 400 })
      }

      if (!responseText.trim()) {
        throw new Error(`${councilSingleFamily} returned empty body`)
      }

      const governed = applyGovernor(responseText, councilSingleFamily, councilCommand, {
        raelDirectiveText,
        councilIntentKind: intentState.intent,
        councilActiveScope: scopeForGovernor,
      })
      if (governed.warnings?.includes(COUNCIL_GOVERNOR_SILENT_SKIP)) {
        await auditCouncil({
          success: true,
          flow: 'continue_single',
          councilSingleFamily,
          expanded: expandedAnalysis,
          councilGovernorSkipped: true,
          councilDisciplineMode: councilCommand.mode,
          ...(geminiDegradedReason !== null
            ? { geminiDegraded: true, geminiDegradedReason }
            : {}),
          models:
            councilSingleFamily === 'grok'
              ? { primary: 'xai' }
              : councilSingleFamily === 'claude' || councilSingleFamily === 'red_team'
                ? { primary: 'anthropic' }
                : councilSingleFamily === 'gemini'
                  ? { primary: 'google_gemini' }
                  : { primary: 'openai' },
        })
        return NextResponse.json({
          councilSingleResponse: '',
          councilSingleFamily,
          showContinue: true,
          councilGovernorSkipped: true,
        })
      }
      responseText = governed.text
      if (!responseText.trim()) {
        throw new Error(`${councilSingleFamily} returned empty body after governor`)
      }

      await auditCouncil({
        success: true,
        flow: 'continue_single',
        councilSingleFamily,
        expanded: expandedAnalysis,
        councilDisciplineMode: councilCommand.mode,
        ...(geminiDegradedReason !== null
          ? { geminiDegraded: true, geminiDegradedReason }
          : {}),
        models:
          councilSingleFamily === 'grok'
            ? { primary: 'xai' }
            : councilSingleFamily === 'claude' || councilSingleFamily === 'red_team'
              ? { primary: 'anthropic' }
              : councilSingleFamily === 'gemini'
                ? { primary: 'google_gemini' }
                : { primary: 'openai' },
      })

      if (geminiDegradedReason === null) {
        await tryPersistMemoryProposalFromModelOutput({
          client: sup.ok ? sup.client : null,
          responseText,
          fallbackPartition: councilSingleFamilyToMemoryPartition(councilSingleFamily),
          conversationId,
          extraMetadata: { councilSingleFamily, route: '/api/chat' },
        })
      }

      return NextResponse.json({
        councilSingleResponse: responseText,
        councilSingleFamily,
        showContinue: true,
      })
    }

    await auditCouncil({
      success: false,
      flow: 'unsupported',
      reason: 'require_continue_single',
      mode: mode ?? null,
    })
    return NextResponse.json(
      {
        error: 'unsupported_flow',
        message: 'Live Council requires mode "continue" with councilSingleFamily (one provider per request).',
      },
      { status: 400 },
    )
  } catch (e) {
    await auditCouncil({
      success: false,
      flow: 'council',
      error: e instanceof Error ? e.message : String(e),
    })
    return NextResponse.json({
      error: 'council_provider_failed',
      message: e instanceof Error ? e.message : String(e),
    }, { status: 503 })
  }
}
