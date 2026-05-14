import { NextResponse } from 'next/server'
import { LOCAL_FAMILY_AGENTS } from '@/lib/local-agent/family-agents'
import { getLMStudioModels, invokeLMStudio, invokeOllama } from '@/lib/local-agent/providers'
import type { LocalModelProvider } from '@/lib/local-agent/types'

export const dynamic = 'force-dynamic'

type InvokeRequest = {
  familyAgentId?: string
  prompt?: string
  provider?: LocalModelProvider
  model?: string
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

  if (!agent) return NextResponse.json({ message: 'Unknown local family agent.' }, { status: 400 })
  if (!prompt) return NextResponse.json({ message: 'Prompt is required.' }, { status: 400 })

  const provider = body.provider ?? 'ollama'

  try {
    const result = provider === 'lm_studio'
      ? await (async () => {
        const lmStudio = await getLMStudioModels()
        const model = body.model?.trim() || lmStudio.models[0]?.id
        if (!model) throw new Error('LM Studio has no available model.')
        return invokeLMStudio(agent, prompt, model, lmStudio.baseUrl)
      })()
      : await invokeOllama(agent, prompt)

    return NextResponse.json({
      familyAgent: {
        id: agent.id,
        displayName: agent.displayName,
        family: agent.family,
        role: agent.role,
        model: result.model,
        provider: result.provider,
      },
      response: result.response,
      model: result.model,
      provider: result.provider,
      label: result.label,
      permissions: {
        internetAccess: false,
        requiresApproval: true,
        canExecuteCode: false,
        canModifyFiles: false,
      },
    })
  } catch (error) {
    return NextResponse.json({
      message: error instanceof Error ? error.message : 'Local invocation failed.',
    }, { status: 503 })
  }
}
