import { NextResponse } from 'next/server'
import { LOCAL_FAMILY_AGENTS, localFamilyAgentSystemPrompt } from '@/lib/local-agent/family-agents'

export const dynamic = 'force-dynamic'

type InvokeRequest = {
  familyAgentId?: string
  prompt?: string
}

type OllamaGenerateResponse = {
  model?: string
  response?: string
  done?: boolean
}

export async function POST(request: Request) {
  let body: InvokeRequest

  try {
    body = await request.json() as InvokeRequest
  } catch {
    return NextResponse.json({ message: 'Invalid JSON body.' }, { status: 400 })
  }

  const prompt = body.prompt?.trim()
  const agent = LOCAL_FAMILY_AGENTS.find(item => item.id === body.familyAgentId)

  if (!agent) {
    return NextResponse.json({ message: 'Unknown local family agent.' }, { status: 400 })
  }

  if (!prompt) {
    return NextResponse.json({ message: 'Prompt is required.' }, { status: 400 })
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60000)

  try {
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: agent.preferredModel,
        prompt,
        system: localFamilyAgentSystemPrompt(agent),
        stream: false,
      }),
    })

    const data = await response.json() as OllamaGenerateResponse

    if (!response.ok) {
      return NextResponse.json({
        message: 'Ollama invocation failed.',
        detail: data,
      }, { status: response.status })
    }

    return NextResponse.json({
      familyAgent: {
        id: agent.id,
        displayName: agent.displayName,
        family: agent.family,
        role: agent.role,
        model: agent.preferredModel,
      },
      response: data.response ?? '',
      model: data.model ?? agent.preferredModel,
      label: 'local model response',
      permissions: {
        internetAccess: false,
        requiresApproval: true,
        canExecuteCode: false,
        canModifyFiles: false,
      },
    })
  } catch (error) {
    return NextResponse.json({
      message: error instanceof Error && error.name === 'AbortError'
        ? 'Ollama invocation timed out.'
        : 'Ollama is not reachable.',
    }, { status: 503 })
  } finally {
    clearTimeout(timeout)
  }
}
