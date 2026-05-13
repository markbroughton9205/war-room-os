import { NextResponse } from 'next/server'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'
const CLAUDE_MODEL = 'claude-sonnet-4-20250514'
const DEFAULT_MAX_TOKENS = 220
const EXPANDED_MAX_TOKENS = 520

const COUNCIL_INSTRUCTION = `You are in a live War Room council group chat. CRITICAL RULE: Never generate dialogue or words for Ra'el. Never simulate his responses. Only Ra'el speaks for Ra'el. Default to concise, high-signal responses unless expanded analysis has been approved. You may respond to him, respond to other families, ask questions, debate, joke, and continue discussion — but his voice is his alone. Use emoji mood indicators when they fit. Do not use theatrical stage directions. Read his tone and match it. Do not project heavy context unless he brings it up. Be a real distinct presence with your own personality. Keep it natural and alive.`

const TONE_INSTRUCTIONS: Record<string, string> = {
  casual: 'Tone mode: casual 😄. Natural personality, emojis, quick jokes, and group chat energy are welcome. Default to human and alive, not corporate.',
  build: 'Tone mode: build 🛠️. Stay focused, technical, implementation-minded, and clear. Prioritize concrete next steps.',
  business: 'Tone mode: business 📈. Think strategy, revenue, customers, positioning, and execution. Be direct and useful.',
  debate: 'Tone mode: debate 🔥. Challenge assumptions, compare positions, and push back respectfully. Keep it sharp but grounded.',
  reflection: 'Tone mode: reflection 🧭. Slow down, listen for meaning, and respond with warmth, clarity, and depth.',
}

async function callChatGPT(prompt: string, system: string, maxTokens = DEFAULT_MAX_TOKENS): Promise<string> {
  try {
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
          { role: 'user', content: prompt }
        ],
        max_tokens: maxTokens,
      }),
    })
    const data = await res.json()
    return data.choices?.[0]?.message?.content || 'ChatGPT did not respond'
  } catch (e) {
    return 'ChatGPT error: ' + String(e)
  }
}

async function callClaude(prompt: string, system: string, maxTokens = DEFAULT_MAX_TOKENS): Promise<string> {
  try {
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
    const data = await res.json()
    return data.content?.[0]?.text || 'Claude did not respond'
  } catch (e) {
    return 'Claude error: ' + String(e)
  }
}

export async function POST(req: Request) {
  const { message, profile, threadHistory, mode, toneMode = 'casual' } = await req.json()
  if (!message) return NextResponse.json({ error: 'No message' }, { status: 400 })

  const thread = threadHistory && threadHistory.length
    ? threadHistory.slice(-10).map((m: { sender: string; content: string }) => `${m.sender}: ${m.content}`).join('\n')
    : 'Session just started.'

  const toneInstruction = TONE_INSTRUCTIONS[toneMode] || TONE_INSTRUCTIONS.casual
  const responseDepth = mode === 'expanded'
    ? 'Expanded analysis approved. You may go deeper, but stay organized and avoid filler.'
    : 'Cost-control mode is active. Keep the answer concise by default.'
  const maxTokens = mode === 'expanded' ? EXPANDED_MAX_TOKENS : DEFAULT_MAX_TOKENS
  const gptSystem = `You are ChatGPT Family in Ra'el's War Room. Role: Strategy, Revenue, Synthesis. Personality: confident, direct, witty. ${COUNCIL_INSTRUCTION} ${toneInstruction} ${responseDepth} Ra'el profile when relevant: ${profile}`
  const claudeSystem = `You are Claude Family in Ra'el's War Room. Role: Architecture, Truth, Precision. Personality: honest, direct, dry humor. ${COUNCIL_INSTRUCTION} ${toneInstruction} ${responseDepth} Ra'el profile when relevant: ${profile}`

  if (mode === 'continue') {
    const gptPrompt = `Council thread:\n${thread}\n\nThe council discussion timer is active. Continue naturally as ChatGPT Family: ask Claude a useful follow-up, debate a point, refine a solution, or add a fresh research observation. Do not speak for Ra'el. Do not repeat points already made. Keep it concise and alive.`
    const claudePrompt = `Council thread:\n${thread}\n\nThe council discussion timer is active. Continue naturally as Claude Family: respond to ChatGPT, ask a useful follow-up, debate a point, refine a solution, or add a fresh research observation. Do not speak for Ra'el. Do not repeat points already made. Keep it concise and alive.`

    const [gpt, claude] = await Promise.all([
      callChatGPT(gptPrompt, gptSystem, maxTokens),
      callClaude(claudePrompt, claudeSystem, maxTokens)
    ])

    return NextResponse.json({ chatgpt: gpt, claude, showContinue: true })
  }

  const gptPrompt = `Council thread:\n${thread}\n\nRa'el: ${message}\n\nRespond as ChatGPT Family. Be concise unless expanded analysis is approved.`
  const gptResponse = await callChatGPT(gptPrompt, gptSystem, maxTokens)

  const claudePrompt = `Council thread:\n${thread}\n\nRa'el: ${message}\n\nChatGPT Family just said: "${gptResponse}"\n\nRespond as Claude Family. React to ChatGPT if you want. Match Ra'el's energy. Be concise unless expanded analysis is approved.`
  const claudeResponse = await callClaude(claudePrompt, claudeSystem, maxTokens)

  return NextResponse.json({
    chatgpt: gptResponse,
    claude: claudeResponse,
    showContinue: true
  })
}
